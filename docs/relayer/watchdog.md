# Watchdog — `cmd/watchdog`

> Box 2 (us-east-2, `vynx-sentinel-prod`). The protocol's enforcement plane:
> the only binary allowed to call `VynxRegistry.executeSlash` (L1) or
> `VynxAdmin.pauseAll` (L2). Holds two KMS keys — **SlashingKey** (L1) and
> **RelayerAdminKey** (L2) — through two separate KMS clients.

The Watchdog is a distributed, leader-elected service. Every replica runs the
leader elector and an RPC-health monitor; exactly one replica (the leader) runs
the executors, the sweeper, the event subscriber, and the chain clock. It reads
its entire decision surface from **Redis** and never touches PostgreSQL.

---

## 1. Governing invariants

| # | Invariant | Where enforced |
|---|---|---|
| **1** | `executeSlash` takes ONE `SlashPayload` struct argument; the signature is embedded inside it. | `internal/watchdog/executor/slash.go` |
| **4** | The `SlashPayload` is built **exclusively from Redis** (`slash:payload:{intentId}`). No PostgreSQL imports exist in this binary or in `internal/watchdog/`. | `internal/watchdog/state/keys.go:42`, package boundary |
| **7** | Deadlines are evaluated against `chain:{chainId}:latest_safe_ts` (an on-chain `block.timestamp`), **never** wall-clock. | `internal/watchdog/scheduler/sweeper.go`, `state/keys.go` |
| **10** | The KMS adapter is native AWS SDK v2 — no `welthee` or any third-party signer. | `internal/shared/kms/` |

These are P0. A wall-clock comparison in the sweeper, a PostgreSQL import in
`internal/watchdog/`, or a two-argument `executeSlash` is a protocol failure.

---

## 2. Process model: leader election

Leadership is a Redis lock at `lock:leader`, taken with `SET NX EX`
(`internal/watchdog/state/leader.go`).

- **TTL 15s, renewed every 5s.** Renewal is a compare-and-renew Lua snippet:
  `PEXPIRE` only fires if `GET lock:leader == instanceID`.
- **Three consecutive renewal failures dethrone** the instance: it clears its
  leader flag and closes `LostCh`, which the long-running goroutines select on
  to self-terminate. A fresh `LostCh` is re-armed for the next tenure.
- `AcquiredCh` closes once, the first time leadership is won; `run()` blocks on
  it before launching the leader-only goroutines.
- `instanceID` is `hostname:pid`.

A **standby** replica (one whose `AcquiredCh` never closes) runs **only W1 + W2**.
This is the canonical safety property — a standby is a pure observer and can
never execute a slash or a pause. `cmd/watchdog/main_test.go` asserts it.

---

## 3. The eight workers (W1–W8)

The authoritative list is the sequence of `launch(...)` calls in
`cmd/watchdog/main.go` (`run()`). W1–W2 start unconditionally; W3–W8 start only
after `AcquiredCh` closes.

| W | Name | Gating | Role | Source |
|---|---|---|---|---|
| **W1** | `W1-leader` | all replicas | Leader election acquire/renew loop. | `state/leader.go` |
| **W2** | `W2-rpc-health` | all replicas | RPC pool health monitor; circuit breaker on quorum loss. | `internal/shared/rpc` |
| **W3** | `W3-sweeper` | leader-only | Deadline sweeper: every 500ms reads the chain clock, finds expired intents, transitions `LOCKED → REFUND_PENDING`. | `scheduler/sweeper.go` |
| **W4** | `W4-refund-executor` | leader-only | Broadcasts `VynxSettlement.refundIntent` on Base L2 for each `RefundTask`. | `executor/refund.go` |
| **W5** | `W5-slash-executor` | leader-only | Broadcasts `VynxRegistry.executeSlash` on Ethereum L1 **via Flashbots** (private mempool). | `executor/slash.go` |
| **W6** | `W6-txmgr-nonce-rooms` | leader-only | Per-wallet nonce management and replace-by-fee for in-flight txs. | `txmgr/` |
| **W7** | `W7-watcher-subs` | leader-only | Subscribes to `VynxSettlement` events on Base L2 (deployed L2-only, so one subscriber covers all events) → drives state + fraud → `EmergencyPause`. | `watcher/`, `fraud/`, `pause/` |
| **W8** | `W8-finality-clock` | leader-only | **The chain clock.** Advances `chain:{chainId}:latest_safe_ts` from each watched chain's finality-deep `block.timestamp`. **New; now live.** | `watcher/finality.go`, `cmd/watchdog/finality.go` |

> Note on numbering: a stale inline comment in `scheduler/sweeper.go` calls the
> sweeper "W4". The authoritative runtime numbering is the `launch()` order in
> `main.go` — the sweeper is **W3**. (Tracked as a comment-only cleanup; it does
> not affect behavior.)

---

## 4. W8 — the chain clock (Invariant 7), now live

This is the most important recent change to the Watchdog. It closes a wiring gap
in which the chain clock was **never started in production**.

### 4.1 What it does

`internal/watchdog/watcher/finality.go` — `FinalityWatcher`:

- `Run(ctx, clients)` ticks every **2 seconds**, calling `AdvanceOnce` for each
  watched `(chainID, headerClient)` pair.
- `AdvanceOnce(ctx, chainID, hc)`:
  1. `head = hc.HeaderByNumber(nil)` — current head.
  2. `conf = confirmationsFor(chainID)`; if `headN < conf`, the chain is too
     young — skip.
  3. `safeN = headN - conf` — the finality-deep block (reorg safety).
  4. `safeHeader = hc.HeaderByNumber(safeN)`; `ts = safeHeader.Time`.
  5. **Future-timestamp sanity clamp** — if `ts > now + fwClockFutureTolerance`
     (`120s`), the tick is **rejected**: no Redis write, the clock stays at its
     last known-good value, and a WARN is logged. See §4.5.
  6. `ScriptUpdateLatestSafeTS` writes `ts` to `chain:{chainId}:latest_safe_ts`
     **monotonically** — an older `block.timestamp` returns `0` and leaves the
     key unchanged.

### 4.2 Per-chain finality depth

`confirmationsFor` (`internal/types/constants.go`):

| Chain | Chain ID | Confirmations |
|---|---|---|
| Base | 8453 | **2** |
| Ethereum | 1 | **12** |
| Arbitrum | 42161 | **1** |
| Optimism | 10 | **2** |
| Polygon | 137 | **256** |

The clock therefore always trails the unsafe head by the chain's finality depth;
the sweeper never acts on a reorg-able timestamp.

### 4.3 Wiring (`cmd/watchdog/finality.go`)

`watcher.HeaderClient.HeaderByNumber(ctx, number any)` is **not** satisfied by
`*ethclient.Client` (which takes `*big.Int`). `cmd/watchdog/finality.go` supplies:

- `headerClientAdapter` — an `any → *big.Int` adapter (`nil→nil`,
  `uint64→SetUint64`, `int64→big.NewInt`, `*big.Int` passthrough).
- `buildFinalityClients(ctx, watchedChainIDs())` — dials one read-only
  `*ethclient.Client` per watched chain and returns the client map + a cleanup.

W8 is launched **leader-only** in `run()`: the clock is shared Redis state, so a
single authoritative writer (like W3–W7) avoids redundant RPC and split-brain.
The monotonic Lua guard makes accidental double-writes harmless regardless.

### 4.4 Why it matters — the gap this closed

The sweeper (`scheduler/sweeper.go`) hard-depends on the clock:

```
tsRaw, err := GET chain:{chainId}:latest_safe_ts
if err == redis.Nil {
    log.Warn("sweeper: latest_safe_ts missing — skipping chain")
    return            // ← no sweep, no LOCKED→REFUND_PENDING, no refund
}
```

- **Before W8:** `NewFinality` existed but nothing called `Run` in any binary.
  In production the key was never written, so the sweeper skipped **every** chain
  and deadline-driven refunds **never fired**. The test harnesses masked this by
  `SET`-ting the key to a low block *number* at t=0 — far below any real
  `block.timestamp` deadline (~1.7×10⁹), so the sweeper found a value but matched
  nothing.
- **After W8:** the leader advances the clock from real `block.timestamp`s every
  2s; the sweeper processes each chain; expired intents transition and are
  refunded as designed.

### 4.5 Future-timestamp sanity clamp (poisoned-clock defence)

The clock is **monotonic** — it only moves forward. Monotonicity alone does not
protect against a *poisoned* clock: a faulty RPC returning a `block.timestamp`
far in the future would be **accepted** by the monotonic guard (it is larger
than the current value), pin `latest_safe_ts` high, and make the sweeper treat
every locked intent as expired — **refund-flooding all of them**. Because the
clock can only advance, it would then stay pinned at that future value until
someone manually `DEL`s the Redis key.

`AdvanceOnce` therefore applies an **upper-bound sanity clamp** to the candidate
timestamp, **before** the monotonic Lua guard and **before** any Redis write:

```
const fwClockFutureTolerance = 120 * time.Second   // watcher/finality.go
if candidate_ts > now + fwClockFutureTolerance {
    log.WARN(chain, candidate_ts, now, delta)      // future alerting signal
    return                                          // skip — do NOT write Redis
}
```

- **Tolerance = 120s.** A confirmed, finality-deep block is never meaningfully
  in the future; 120s absorbs NTP drift and block-time variance.
- **Reject, never clamp-to-now.** The tick is dropped entirely. Clamping to
  `now` would still advance the (poisoned) clock to an approximate value;
  rejection leaves it at the last known-good value, which is correct.
- **Upper bound only.** The lower bound is already covered by the monotonic
  guard (older timestamps return `0` and are ignored). The clamp does not touch
  that path.
- **Self-recovering, no manual intervention.** The next tick that returns a sane
  `block.timestamp` advances the clock normally.
- **Not Invariant-7 wall-clock evaluation.** This compares a *block.timestamp*
  against wall-clock purely as a plausibility bound; deadlines are still only
  ever evaluated against `chain:{chainId}:latest_safe_ts` (Invariant 7 holds).

**Stall vs poison.** A *stalled* clock (RPC down, clock does not advance) is the
safe failure mode: refunds are merely delayed and the clock self-recovers when
the RPC heals — nothing is lost. A *poisoned* clock (jump to the future) is
catastrophic for safety-of-funds. The clamp converts the poison case into the
stall case.

**Tunable bound (test harnesses only).** The `120s` default is the value baked
into `fwClockFutureTolerance`. `cmd/watchdog` exposes an override,
`FINALITY_CLOCK_FUTURE_TOLERANCE_SECONDS`, plumbed through
`watcher.NewFinality(..., watcher.WithFutureTolerance(d))`. It exists for one
reason: the E2E harness forks Anvil and **warps the chain clock minutes ahead of
wall-clock** to expire intent deadlines on demand (`e2e/tests/refund_clock_path_test.go`),
so those legitimate synthetic timestamps would otherwise be rejected as poison.
The harness sets it to `86400`. **In production this variable must remain unset**
— real finality-deep blocks are always in the past, so the 120s default is
correct and the override would only weaken the poison defence.

---

## 5. Intent state machine (Redis)

State lives in the `intent:{intentId}` HASH (`state/keys.go`). Transitions are
atomic Lua scripts (`state/lua.go`) — non-atomic transitions would enable
double-refund or double-slash.

```
LOCKED ──(W3 sweeper: deadline passed)──▶ REFUND_PENDING
                                              │ (W4 broadcasts refundIntent on Base L2)
                                              ▼
                                          REFUNDED ──(conditions met)──▶ SLASH_QUEUED
                                                                            │ (W5 executeSlash on L1 via Flashbots)
                                                                            ▼
                                                                         (slashed)
```

| Script | Transition | Guard |
|---|---|---|
| `ScriptTransitionToRefundPending` | `LOCKED → REFUND_PENDING` | Requires `state==LOCKED` and a free `lock:exec:{id}` (`SET NX EX`, 120s TTL). Returns the agent address. |
| `ScriptTransitionToSlashQueued` | `REFUNDED → SLASH_QUEUED` | Requires `state==REFUNDED`; `ZADD slash:pending` with `score=issuedAt`. |
| `ScriptUpdateLatestSafeTS` | clock advance | Monotonic; older timestamp is a no-op. |

---

## 6. Redis key reference (`state/keys.go`)

| Key | Type | Purpose |
|---|---|---|
| `intent:{intentId}` | HASH | Per-intent tracking state (`state`, `agent`, `solver`, `deadline` = on-chain `block.timestamp`, …). |
| `deadline:queue:{chainId}` | ZSET | Members = intentIds; **scores = on-chain `block.timestamp`** (never wall-clock). |
| `chain:{chainId}:latest_safe_ts` | STRING | The authoritative chain clock (Invariant 7). Written by **W8**. |
| `slash:pending` | ZSET | IntentIds queued for L1 slash; scores = `issuedAt`. |
| `slash:payload:{intentId}` | HASH | Source of the `SlashPayload` (**Invariant 4** — never from PostgreSQL). |
| `chain:{chainId}:block:{n}` | HASH | Cached block for reorg detection. |
| `lock:leader` | STRING | Leader election lock (`SET NX EX`). |
| `lock:exec:{intentId}` | STRING | Per-intent execution lock. |
| `lock:nonce:{chainId}:{wallet}` | STRING | Per-wallet nonce lock. |
| `tx:pending:{chainId}:{txHash}` | HASH | In-flight tx (replace-by-fee). |

---

## 7. Slashing (W5) and the dual-KMS architecture

- **SlashingKey (L1)** signs `VynxRegistry.executeSlash`. The registry transactor
  is backed by the **Flashbots** client, so the slash never enters the public
  mempool. `AssertFlashbots()` is checked at boot.
- **RelayerAdminKey (L2)** signs `VynxAdmin.pauseAll` for `EmergencyPause`.
- The two keys are held by **two separate KMS clients**
  (`KMS_KEY_ID_SLASHING`, `KMS_KEY_ID_RELAYER_ADMIN`).

`executeSlash` is called with a single `SlashPayload` argument (Invariant 1). The
payload `{intentId, solver, agent, inputAmount, issuedAt, signature}` is assembled
solely from the `slash:payload:{intentId}` Redis hash (Invariant 4); the slash
signature is produced by the SlashingKey and embedded in the struct.

Fraud verification (W7) is **fail-closed**: any error from the fraud check
(network, TLS, non-200) triggers `EmergencyPause` rather than skipping it.

---

## 8. Configuration

| Env | Required | Meaning |
|---|---|---|
| `REDIS_URL` | yes | Redis endpoint (defaults to `localhost:6379` if unset). |
| `BASE_RPC_URL`, `ETH_RPC_URL`, `ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`, `POLYGON_RPC_URL` | yes | Comma-separated; first is primary, rest failover. Also dialed by W8. |
| `FLASHBOTS_RPC_URL` | yes | Private mempool for L1 slash txs. |
| `KMS_KEY_ID_SLASHING`, `KMS_KEY_ID_RELAYER_ADMIN` | yes | The two Box 2 KMS keys. |
| `VYNX_REGISTRY_ADDRESS`, `VYNX_SETTLEMENT_ADDRESS`, `VYNX_ADMIN_ADDRESS` | yes | Contract addresses. |
| `WATCHED_CHAINS` | no | CSV of chain IDs the sweeper/clock cover. Unset ⇒ all 5 production chains (`watchedChainIDs()`). |

---

## 9. Known gaps

- **`slash_path` e2e-local fails** — the local harness fronts Anvil over **HTTP**,
  which lacks `eth_subscribe`; W7 cannot subscribe to `IntentLocked`, so the
  slash flow can't complete locally. The slash mechanism **is** covered by the
  sibling `vynx-e2e` suite (`slash-path` + `slash-distribution`). This is a
  local-harness limitation, not a protocol gap.
- **Monotonic-clock hardening** — see §4.5.

See also: [`architecture.md`](architecture.md), [`onchain_contracts.md`](onchain_contracts.md),
[`keeper.md`](keeper.md), [`infrastructure.md`](infrastructure.md).
