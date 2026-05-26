# VynX — Watchdog

Technical reference for `cmd/watchdog`. Runs in Box 2 (vynx-sentinel-prod, us-east-2). The Watchdog is the punisher and circuit breaker: it sweeps deadlines, refunds intents, slashes solvers, and pauses the protocol on suspicious activity.

> **Invariant 4.** Every `SlashPayload` field is derived exclusively from on-chain events cached in Redis. The Watchdog never reads PostgreSQL and never trusts Relayer-supplied data. The two binaries share no database surface.

---

## 1. Overview

| Concern | Source |
|---|---|
| Deadline detection | Redis ZSET scored by on-chain `block.timestamp`, swept every 500 ms |
| Refund execution | `VynxSettlement.refundIntent` on Base L2 |
| Slash execution | `VynxRegistry.executeSlash` on Ethereum L1, routed through Flashbots Protect |
| Emergency pause | `VynxAdmin.pauseAll` on Base L2, signed with RelayerAdminKey |
| Fraud signal | mTLS request to Relayer `:8443/internal/witness/verified/{intentId}` |
| Authoritative clock | `chain:{chainId}:latest_safe_ts` in Redis (Invariant 7) — never `time.Now()` |

The binary holds two KMS keys: `SlashingKey` (`alias/vynx-watchdog-slashing`) and `RelayerAdminKey` (`alias/vynx-watchdog-admin`). Both live in the vynx-sentinel-prod account; the IAM role `vynx-watchdog-role` has `kms:Sign` and `kms:GetPublicKey` on both, nothing else (`infra/box2/iam.tf`).

---

## 2. Redis State Layer

`internal/watchdog/state/keys.go` is the schema. Every Redis key the Watchdog touches is built from a function in this file.

### Key Schema

| Key | Type | Purpose |
|---|---|---|
| `intent:{intentId}` | HASH | per-intent state machine; fields `state`, `agent`, `solver`, `token`, `amount`, `srcChainId`, `deadline`, `lockedAtBlock`, `lockedAtTxHash` |
| `deadline:queue:{chainId}` | ZSET | intentId → on-chain `block.timestamp` score (NEVER wall-clock) |
| `chain:{chainId}:latest_safe_ts` | STRING | authoritative on-chain clock — sole comparand for the deadline sweeper |
| `slash:pending` | ZSET | intentIds queued for L1 slash; score = `issuedAt` |
| `slash:payload:{intentId}` | HASH | per-intent slash payload; fields `intentId`, `solver`, `amount`, `issuedAt` |
| `lock:leader` | STRING | leader election token (SET NX EX) |
| `lock:exec:{intentId}` | STRING | per-intent execution lock |
| `lock:nonce:{chainId}:{wallet}` | STRING | per-wallet nonce lock |
| `tx:pending:{chainId}:{txHash}` | HASH | pending transaction record for RBF |
| `tx:pending:index:{chainId}` | SET | index of pending tx hashes per chain |
| `chain:{chainId}:block:{n}` | HASH | block record for reorg detection |

### Intent State Machine

Stored in the `state` field of `intent:{intentId}`. Transitions are atomic Lua scripts in `internal/watchdog/state/lua.go`.

```
       (IntentLocked event)
              │
              ▼
          ┌────────┐
          │ LOCKED │
          └────┬───┘
               │ deadline passed
               ▼ (ScriptTransitionToRefundPending)
       ┌────────────────┐
       │ REFUND_PENDING │
       └───────┬────────┘
               │ refundIntent broadcast
               ▼
       ┌─────────────────┐
       │ REFUND_INFLIGHT │
       └───────┬─────────┘
               │ on-chain confirm   │ tx failure
               ▼                    ▼
          ┌────────┐         (reset to REFUND_PENDING)
          │REFUNDED│
          └────┬───┘
               │ (ScriptTransitionToSlashQueued)
               ▼
       ┌──────────────┐
       │ SLASH_QUEUED │
       └──────┬───────┘
              │ executeSlash via Flashbots
              ▼
       ┌─────────────────┐
       │ SLASH_EXECUTED  │
       └─────────────────┘
```

### Atomic Lua Scripts

- **`ScriptTransitionToRefundPending`** — `LOCKED → REFUND_PENDING`. Refuses the transition if the intent does not exist, is in any other state, or if `lock:exec:{intentId}` is already held by another worker (acquired here via `SET NX EX`).

- **`ScriptTransitionToSlashQueued`** — `REFUNDED → SLASH_QUEUED`. Refuses the transition from any other state. The same script `ZADD`s `slash:pending` with `issuedAt` as the score, atomically pairing the state flip with queue insertion. This is the only place double-slash can be prevented; a non-atomic implementation would race.

- **`ScriptUpdateLatestSafeTS`** — monotonic update for `chain:{chainId}:latest_safe_ts`. Refuses to write a value less than or equal to the current value. Reorgs cannot rewind the protocol clock.

These three scripts are the only way to mutate state machine fields. Direct `HSET intent:* state ...` is not done anywhere in the codebase; `check-invariants` enforces this.

---

## 3. Leader Election

`internal/watchdog/state/leader.go`. Pattern: Redis `SET NX EX`, 15 s TTL, 5 s renewal cadence, three consecutive renewal failures → dethrone.

The renewal uses a Lua script that runs `PEXPIRE` only when the current value equals this instance's `instanceID` — a zombie watchdog that lost the lock cannot extend a successor's TTL.

```go
const leaderTTL = 15 * time.Second
```

Goroutines split by leadership:

- **Always-on** (W1 = leader elector; W2 = RPC health monitor) run on every replica.
- **Leader-only** (W3 sweeper; W4 refund executor; W5 slash executor; W6 tx-manager nonce rooms; W7 watcher subscriptions if enabled) start when `AcquiredCh()` fires and stop when `LostCh()` fires.

Desired ECS count is 1, so the lock is rarely contested; the architecture supports rolling restarts without losing the deadline sweep.

---

## 4. On-Chain Watchers (`internal/watchdog/watcher/watcher.go`)

Four event subscriptions on Base L2, all on `VynxSettlement`:

| Event | Handler | Outcome |
|---|---|---|
| `IntentLocked` | `HandleIntentLocked` | HSET `intent:{id}` with `state=LOCKED`, agent/solver/token/amount/srcChainId/deadline/lockedAtBlock/lockedAtTxHash; ZADD `deadline:queue:{srcChainId}` |
| `VoucherRedeemed` | `HandleVoucherRedeemed` | mark intent REDEEMED and remove from `deadline:queue` |
| `IntentRefunded` | `HandleIntentRefunded` | read original intent record, mark REFUNDED, run `ScriptTransitionToSlashQueued` to ZADD `slash:pending` |
| `SuspiciousRelayerActivity` | `HandleSuspiciousActivity` | trigger fraud verification flow (§7) |

`IntentRefunded` does not carry `solver` or `amount`. The handler re-reads `intent:{id}` (written previously by `HandleIntentLocked`) to recover those fields. This is the canonical example of Invariant 4: every slash field originates from a Settlement event that the Watchdog itself observed.

Subscriptions reconnect on disconnect with exponential backoff. A failed subscription does not halt the leader; only the affected chain's events stop flowing until reconnect.

### Finality and the Chain Clock

`ScriptUpdateLatestSafeTS` advances `chain:{chainId}:latest_safe_ts` from the head of each chain minus its finality confirmation count (`internal/types/constants.go`: Base 2, Eth 12, Arbitrum 1, Optimism 2, Polygon 256). A block that has not yet cleared its confirmation count is not eligible to advance the clock.

This is the only clock the Watchdog will compare deadlines against (Invariant 7). `time.Now()` is not imported anywhere in `internal/watchdog/scheduler/` or `internal/watchdog/executor/`.

---

## 5. Deadline Sweeper (`internal/watchdog/scheduler/sweeper.go`)

```go
const SweepInterval = 500 * time.Millisecond
```

Per tick, per chain ID:

1. `GET chain:{chainId}:latest_safe_ts`. If missing (`redis.Nil`), the sweeper logs `"latest_safe_ts missing — skipping chain"` and skips this chain entirely. **A missing chain clock can never produce a slash decision.**
2. `ZRANGEBYSCORE deadline:queue:{chainId} -inf <latest_safe_ts>` — every intent whose on-chain deadline has been beaten by a finalised block.
3. For each candidate, run `ScriptTransitionToRefundPending`. On `INVALID_STATE` or `LOCKED` (per-intent exec lock held), the candidate is skipped — another worker is handling it, or the intent already advanced.
4. For each successfully transitioned candidate, emit `RefundTask` onto the executor's work channel.

The sweeper holds no DB connections, no RPC connections, and no KMS credentials. It is a pure Redis-to-channel pump.

---

## 6. Executors

### Refund Executor (`internal/watchdog/executor/refund.go`)

Consumes `RefundTask`. Per task:

1. Build a `bind.TransactOpts` for the Watchdog wallet on Base L2 using the SlashingKey (yes — Base L2 refunds are signed with the same address that signs L1 slashes; the on-chain `VynxSettlement.refundIntent` is gated on the Watchdog role).
2. `intent.state ← REFUND_INFLIGHT`.
3. Broadcast `VynxSettlement.refundIntent(intentId)`. Standard Base RPC — not Flashbots; refund transactions on L2 are not MEV-sensitive.
4. On receipt with status 1: `intent.state ← REFUNDED`. The `IntentRefunded` event handler will pick it up and queue the slash.
5. On RPC failure or revert: reset to `REFUND_PENDING` so the next sweeper tick retries.

### Slash Executor (`internal/watchdog/executor/slash.go`)

```go
type SlashBroadcaster interface {
    ExecuteSlash(opts *bind.TransactOpts, payload registry.SlashPayload) (*ethtypes.Transaction, error)
}
```

**Single-argument ExecuteSlash** (Invariant 1) — the signature is the fifth field of `payload`.

Per task pulled from `slash:pending`:

1. Read `slash:payload:{intentId}` (HASH) — every field (intentId, solver, amount, issuedAt) is in Redis already, written by the IntentRefunded handler.
2. Compute the slash digest, sign with the SlashingKey via `internal/shared/kms/signer.go`.
3. Populate `payload.signature`.
4. Broadcast via the Flashbots-routed ethclient. The transactor was constructed against `FLASHBOTS_RPC_URL`; the transaction never enters the public Ethereum mempool.
5. On confirmation: `intent.state ← SLASH_EXECUTED`.

**Flashbots assertion at startup.** `cmd/watchdog/main.go:180-182` calls `slashExec.AssertFlashbots()`. The helper rejects any URL that is not in the known private-mempool allow-list (Flashbots Protect, MEV-Blocker). `ErrFlashbotsRequired = "slash: flashbots URL required — public mempool forbidden for executeSlash"` is a fatal at boot — the watchdog will not start without it.

**Why never the public mempool.** A slash transaction that leaks into the public mempool can be censored by builders, front-run by solvers attempting to evade the slash, or sandwich-attacked. Flashbots Protect and MEV-Blocker both relay directly to block builders; the transaction either lands in the next block or fails silently. `FLASHBOTS_RPC_URL` is required (`cmd/watchdog/main.go:130`).

### EmergencyPause (`internal/watchdog/pause/pause.go`)

```go
// Triggered by SuspiciousRelayerActivity after mTLS fraud verification.
```

1. Build `bind.TransactOpts` with the RelayerAdminKey (`alias/vynx-watchdog-admin`).
2. Call `VynxAdmin.pauseAll()` on Base L2 (UUPS proxy at `VYNX_ADMIN_ADDRESS`).
3. Wait for the receipt.
4. **Idempotency**: if the revert reason matches the `AlreadyPaused()` custom error, return `nil`. Re-pausing an already-paused protocol is not an error — different watchdog replicas may both observe the same suspicious event.

`isAlreadyPaused(err)` parses the revert data for the 4-byte selector of `AlreadyPaused()`. On any other revert, the error propagates and a P0 alarm fires.

Unpause is intentionally not implementable by the Watchdog — `VynxAdmin.unpauseAll` is multisig-only.

---

## 7. Fail-Closed Fraud Verification

The flow when `SuspiciousRelayerActivity(intentId, attacker, spoofedIntentId)` is observed on Base:

```
watcher  ──► fraud.Verifier.IsLegit(intentID)
              ├── HTTP GET https://relayer.internal:8443/internal/witness/verified/{intentId}
              ├── mTLS client cert: MTLS_CLIENT_CERT_PATH (CN = watchdog.vynx.internal)
              ├── CA: MTLS_CA_CERT_PATH
              │
              ├── 200 + {verified: true}  → benign → no pause
              ├── 200 + {verified: false} → suspicious → pause
              └── ANY OTHER OUTCOME      → fail closed → pause
                  (network error, TLS handshake error, non-200, JSON parse error)
```

Any error path leads to pause. The reasoning is documented in `internal/watchdog/fraud/verifier.go:82`. A relayer that returns a malformed response, drops the TCP connection, or fails TLS handshake is treated identically to a relayer that returned `verified: false`. A working relayer must positively confirm verification for the Watchdog to skip the pause.

`RELAYER_INTERNAL_ENDPOINT` defaults to `https://relayer.internal:8443` (`internal/watchdog/fraud/verifier.go:66-69`).

---

## 8. Transaction Manager

`internal/watchdog/txmgr/` (W6). Per-wallet nonce rooms backed by Redis `lock:nonce:{chainId}:{wallet}`. Replace-by-fee thresholds:

| Chain | RBF window | Bump factor |
|---|---|---|
| L1 (Ethereum) | 30 min | 1.25× tip/maxfee |
| L2 (Base) | 10 min | 1.25× tip/maxfee |

RBF reuses the same nonce; if the original transaction lands, the RBF transaction is a no-op (same nonce).

`tx:pending:{chainId}:{txHash}` records the submitted-at wall-clock time. This is the one place where the Watchdog uses `time.Now()` — RBF stall detection is a process-local concern, not on-chain deadline evaluation, so Invariant 7 explicitly does not apply (noted inline in `internal/watchdog/state/keys.go:80-88`).

---

## 9. Startup Sequence (`cmd/watchdog/main.go`)

Required env vars (selected): `KMS_KEY_ID_SLASHING`, `KMS_KEY_ID_RELAYER_ADMIN`, `WATCHDOG_ADDRESS`, `REDIS_URL`, `FLASHBOTS_RPC_URL`, `BASE_RPC_URL`, `ETH_RPC_URL`, `VYNX_REGISTRY_ADDRESS`, `VYNX_SETTLEMENT_ADDRESS`, `VYNX_ADMIN_ADDRESS`.

Sequence:

1. Connect to Redis (single client, no PSync — AOF persistence is the durability layer).
2. Build KMS clients for both keys. Derive Ethereum addresses; fatal if either does not match `WATCHDOG_ADDRESS` (`cmd/watchdog/main.go:130` reads the env var; the address-derivation fatal is the same probe-task pattern documented in [`docs/secrets_rotation.md`](secrets_rotation.md)).
3. Build the Flashbots-routed ethclient for L1 broadcast.
4. Construct `SlashExecutor`. Call `slashExec.AssertFlashbots()` (`:180-182`); fatal on failure.
5. Construct Refund Executor, Pause Executor, Watcher, Sweeper, Tx Manager.
6. Launch goroutines:

   | Tag | Goroutine | Notes |
   |---|---|---|
   | W1 | leader | always on |
   | W2 | rpc-health | always on |
   | W3 | sweeper | leader only |
   | W4 | refund-executor | leader only |
   | W5 | slash-executor | leader only |
   | W6 | txmgr-nonce-rooms | leader only |
   | W7 | watcher-subs | leader only (conditional on watcher being enabled) |

7. Log `"watchdog ready"`. Block on `ctx.Done()`.

Shutdown: `SIGTERM` cancels the root context. Leader-only goroutines stop first; the leader voluntarily releases `lock:leader` so the next replica can acquire it in ≤ 15 s.

---

## See also

- [`docs/architecture.md`](architecture.md) — invariants 1, 4, 7, EventBus, trust model
- [`docs/infrastructure.md`](infrastructure.md) — Box 2 VPC, KMS keys, Redis AOF config
- [`docs/onchain_contracts.md`](onchain_contracts.md) — `executeSlash`, `refundIntent`, `pauseAll`, `SuspiciousRelayerActivity`
- [`docs/relayer.md`](relayer.md) — the `:8443` mTLS endpoint consumed by the fraud verifier
- [`docs/secrets_rotation.md`](secrets_rotation.md) — SlashingKey + RelayerAdminKey rotation
