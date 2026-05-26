# VynX — Relayer + Signer

Technical reference for `cmd/relayer` and `cmd/signer`. Every constant, threshold, and goroutine name below is verified against the current source. Where the spec said X and the code says Y, this document records Y.

---

## 1. Overview

`cmd/relayer` runs two paths in one process:

- **Hot Path** — the 200 ms sealed-bid auction. Pure RAM. Zero I/O (Invariant 8). Drains intents and bids, produces an `AuctionResult`, hands off to the SLA tracker.
- **Cold Path** — everything that touches RDS, RPC, or the UDS signer. Witness service, reputation manager, DB writer, RPC pool health monitor, on-chain watcher.

`cmd/signer` runs as a second container in the same Fargate task. Communicates with the relayer over a UNIX Domain Socket at `/run/vynx/voucher-signer.sock`. Holds the only `kms:Sign` credentials in Box 1 (Invariant 3). Validates the intent row in PostgreSQL under a `SELECT ... FOR SHARE` lock, signs the EIP-712 voucher, and caches the signature for idempotency.

The two processes share a `vynx-socket-vol` ephemeral volume; everything else is private to its container.

---

## 2. Hot Path

### Gatekeeper (`internal/relayer/hotpath/gatekeeper/gatekeeper.go`)

O(1) intent and bid validation backed by an in-memory `SolverHealth` cache.

`ValidateIntent` checks three immutable config fields with no lock:
- `Token == inputToken` (USDC — Invariant 6)
- `InputAmount >= MIN_INTENT_USDC` ($50, 6 decimals)
- `DestinationChainID ∈ {Base, Ethereum, Arbitrum, Optimism, Polygon}`

`ValidateBid` holds `solverMu.RLock` for the entire body to prevent TOCTOU on the `*big.Int` fields:
- Jail check: `JailLevel > 0 && now < PenaltyExpiry → ErrSolverJailed`
- SHF: `FreeCollateral = Total − InFlight`; `Required = InputAmount × SHF_THRESHOLD / 100`; fail if `Free < Required` (SHF_THRESHOLD = 120, i.e. 1.20×)
- Exposure: `InFlight / Total ≥ MAX_SOLVER_EXPOSURE / 100` (80 %) → fail

Cache invalidation is one-way: the Cold Path emits `SolverHealthDelta` over `EventBus.SolverHealthUpdate`; `ApplyDelta` takes `solverMu.Lock` and mutates. The Hot Path never writes the cache directly.

### Mempool (`internal/relayer/hotpath/mempool/mempool.go`)

`Mempool` is `[256]shard` keyed by `intentID[0]`. Each shard holds its own `sync.Mutex` + `map[common.Hash]*types.Intent`. 256 concurrent auctions across distinct intent IDs (modulo the same first byte) never contend.

Operations: `Add`, `Get`, `Delete`, `Len`. `Add` returns `ErrIntentExists` if the intent ID is already present.

### Auction Engine (`internal/relayer/hotpath/engine/auction.go`)

```
RunAuction(ctx, intent, bidCh, gk, tracker, events, log, mc)
```

- Window: `OFA_WINDOW = 200 ms` enforced by `context.WithTimeout` on the parent context.
- Per-bid validation budget: `bidValidationBudget = 5 ms`.
- Solver dedup: `solverBids map[common.Address]Bid` — one bid per solver; last bid replaces previous (a solver has no legitimate reason to submit more than one bid).
- Distinct solver cap: `maxBidsPerIntent = 1000`. New solvers beyond the cap are dropped; an already-bidding solver may still replace its bid.
- Selection: sort by `OutputAmount.Cmp` (max wins); tie-break by `HealthFactor` (higher SHF wins).
- Minimum acceptable: `bid.OutputAmount >= intent.MinOutputAmount`.
- Emission: `SendDrop(events.AuctionConcluded, …)` on success, `SendDrop(events.IntentTimeout, …)` with `Reason: "no_bids"` on empty selection.
- The auction immediately calls `tracker.TrackSLA(intentID, slaExpiry, winner)` after winner selection — a pure RAM op, valid inside the hot path.

`RunAuction` is annotated as an Invariant 8 enforcement point: no disk I/O, no network I/O, no RPC. DogStatsD UDP emits via `mc.Timing` / `mc.Count` are async and acceptable.

### SLA Tracker (`internal/relayer/hotpath/sla/sla.go`)

Single sweep goroutine (G1). 500 ms tick.

Two phases per entry:
- `phaseSLA` — waiting for `IntentLocked`. Tracked against `slaExpiry = now + SLA_COMMIT_TIMEOUT (10 s)`.
- `phaseDeadline` — promoted by `Promote(intentID, solver, onChainDeadline)` when `IntentLocked` is observed. Tracked against on-chain `block.timestamp`-derived deadline.

`sweep()` walks `entries` under `t.mu`, collects expired entries into local slices, releases the lock, then emits `SendDrop(events.IntentTimeout, …)` with `Reason: "sla_expired"` or `"deadline_expired"`. Channel sends never hold the mutex.

No per-intent goroutines. One ticker, one sweep, one mutex.

---

## 3. Cold Path

### Witness Service (`internal/relayer/coldpath/witness/witness.go`)

Consumes `EventBus.PaymentNoticeReceived`. For each notice:
1. Look up the intent via `IntentLookup` (mempool first, fallback to DB).
2. Fetch the destination tx receipt via the chain-specific `RPCClient`.
3. Wait for finality — confirmations per chain from `internal/types/constants.go`:

   | Chain | Confirmations |
   |---|---|
   | Base | 2 |
   | Ethereum | 12 |
   | Arbitrum | 1 |
   | Optimism | 2 |
   | Polygon | 256 |
4. Compute the EIP-712 voucher hash (Signer side — see §4) and request a signature via UDS.
5. Emit `SendWait(events.CrossChainPaymentVerified, voucher)` — Pattern B because losing a signed voucher loses a settlement.
6. Record `intentID` in `verified sync.Map` so the mTLS `IsVerified` endpoint can answer.

### Reputation Manager (`internal/relayer/coldpath/reputation/reputation.go`)

Five jail levels (durations in `constants.go`):
```
level 1: 60 s    level 4: 86 400 s
level 2: 600 s   level 5: permanent (1<<63 − 1)
level 3: 3600 s
```

Grouping rule: timeouts within `SLA_GROUP_WINDOW = 30 s` of the previous timeout for the same solver are treated as one incident — operationally a single network blip should not climb the ladder five times. Deadline-expired timeouts are **not** grouped (a missed deadline is a clean fault).

Amnesty: `AMNESTY_EPOCH = 90 days`. The G7 goroutine resets jail levels on schedule; the Hot Path receives `ReputationReset` over the 1-capacity broadcast channel.

### DB Writer (`internal/relayer/coldpath/persistence/writer.go`)

Single goroutine (G2). All PostgreSQL writes from the Cold Path go through it.

- Batch flush every 100 ms or 500 pending rows, whichever comes first.
- Connects with `vynx_relayer` role (`GRANT ALL PRIVILEGES ON SCHEMA public`).
- Pool: `MaxConns = 10`, `MinConns = 2`, session-level `statement_timeout = 5000 ms`, `lock_timeout = 2000 ms`.

### RPC Pool (`internal/shared/rpc/pool.go`)

Three-state circuit breaker per Base RPC node group:

```
PoolStateHealthy  = 0   (default)
PoolStateDegraded = 1   (>30 % Base nodes unhealthy)
PoolStateHalted   = 2   (>50 % Base nodes unhealthy)
```

`DegradedCh()` is closed once when the pool enters Degraded; `HaltCh()` is closed once when it enters Halted (closure is permanent — a full process restart re-evaluates).

The HTTP intent endpoint reads pool state at the top of `POST /v1/intent`:
- Healthy → accept.
- Degraded or Halted → reject with HTTP 503. The user sees the error immediately rather than waiting for the auction to time out on missing RPC quorum.

A separate G6 goroutine refreshes RPC node health on a fixed interval and updates the state machine.

### IntentLocked Watcher (G8)

Subscribes to `VynxSettlement.IntentLocked` on Base. On each event:
- Emits `IntentLocked` on the EventBus.
- Calls `tracker.Promote(intentID, solver, deadline)` to transition the SLA tracker entry into `phaseDeadline`.

The watcher is gated on `INTENT_LOCKED_WATCHER_ENABLED` — feature flag retained from rollout; the goroutine block in `cmd/relayer/main.go:185` only launches if the flag is true.

---

## 4. Signer Sidecar (`cmd/signer` + `internal/signer/**`)

### UDS Wire Protocol (`internal/types/signer.go`)

```
SignRequest:
  Kind     string    // "" (default) | "get_address"
  IntentID common.Hash
  Solver   common.Address
  Amount   string    // decimal string — JSON float precision-safe
SignResponse:
  Signature []byte
  Address   string
  Error     string
```

`Kind == "get_address"` returns the KMS-derived Ethereum address; used by the relayer at startup to confirm the KMS key matches `RELAYER_SIGNER` env var.

### EIP-712 Hashing (`internal/signer/eip712.go`)

`DomainSeparator(chainID, contractAddr)` computes the EIP712Domain hash once at startup using `EIP712DomainName` and `EIP712DomainVersion` from `internal/types`. Cached for the process lifetime.

`ComputeVoucherHash(domainSep, intentID, solver, amount)` accepts **only three arguments**. Adding a fourth would require modifying the function signature — that is the language-level gate enforcing Invariant 2. The function packs `(voucherTypeHash, intentID, solver, amount)` and produces the EIP-712 digest.

A field-count assertion test (`TestComputeVoucherHash_FieldCount`) confirms `types.VoucherTypeString` declares exactly three fields. The `destTxHash` and `issuedAt` fields visible in the on-chain `Voucher` struct are appended after signing and are not part of the hash.

### Validator (`internal/signer/validator.go`)

`BeginValidation(ctx, intentID, solver)`:
1. `BeginTx` with default options.
2. `SET LOCAL lock_timeout = '2000ms'` (fail fast under contention).
3. `SELECT solver_address, status FROM intents WHERE id = $1 FOR SHARE` — row lock held until the caller commits or rolls back.
4. Reject if status ≠ `LOCKED` or solver mismatches.

The `FOR SHARE` lock is held across the KMS call. A concurrent UPDATE on this row (refund, status change) blocks until the signer commits.

`CacheSignature(ctx, tx, intentID, sig)`:
```sql
UPDATE intents
   SET issued_voucher_signature = $2
 WHERE id = $1
   AND issued_voucher_signature IS NULL
```

The `IS NULL` guard is the second half of the TOCTOU fix: even if two signer instances race past the `FOR SHARE` check, only the first `UPDATE` succeeds. The second sees a row with a non-NULL signature and the UPDATE matches zero rows.

`GetCachedSignature` returns the previously persisted signature without taking the row lock — the column is immutable once written, so a plain `SELECT` is safe.

### Server (`internal/signer/server.go`)

Per request, in order:
1. Decode `SignRequest`. `Kind == "get_address"` short-circuits with the cached address.
2. Token bucket: `rate.NewLimiter(50, 10)` — 50 rps with burst 10. Protects KMS quota from a compromised relayer.
3. `GetCachedSignature` — if present, return it without touching KMS.
4. `BeginValidation` opens the FOR SHARE transaction. `defer tx.Rollback(ctx)` (pgx no-ops Rollback on committed tx).
5. Parse `Amount` decimal string into `*big.Int`.
6. `ComputeVoucherHash` (Invariant 2 — three fields).
7. `kms.SignHash(ctx, digest)` — the row lock is held across this call.
8. `CacheSignature(tx, sig)` then `tx.Commit`.
9. Return `SignResponse{Signature: sig}`.

Errors at any step return `SignResponse{Error: …}`. KMS errors during step 7 leave the row lock to be released on rollback; the cache write does not execute.

### UDS Listener (`cmd/signer/main.go`)

```go
ln, err := net.Listen("unix", types.SocketPath)
// INVARIANT 9 — immediate next call:
if err := os.Chmod(types.SocketPath, 0660); err != nil { ... }
```

The chmod is the literal next executable statement after `net.Listen` — no `defer`, no waiting for the first connection. `check-invariants` greps for this exact arrangement.

### UID / GID Model

Set in the Dockerfiles:
- Signer container: UID 2000:2000 — owns the socket.
- Relayer container: UID 1000:2000 — same group, no socket ownership.

The 0660 permission grants read/write to the signer (owner) and read/write to GID 2000 (the shared group). The relayer can read and write the socket; it cannot `unlink` it because POSIX requires the owner UID for that operation.

---

## 5. API Layer

### POST /v1/intent

Middleware order (outer → inner):
- `RecoveryMiddleware` — catches panics, logs the stack trace, returns 500 (`internal/relayer/api/http/middleware.go:79`).
- `BodyLimitMiddleware(4096)` — `http.MaxBytesReader`; Slowloris and memory-exhaustion defence.
- `RateLimit` — per-IP `rate.Limiter`, lazy map (`internal/relayer/api/http/middleware.go:50`).
- `RequestID` — adds a request-scoped UUID to logs.

Handler-level checks before any work:
- RPC pool state: `pool.State() != PoolStateHealthy → 503 Service Unavailable`.
- Gatekeeper: `ValidateIntent`. Failures → 400.
- Mempool: `Add` returns `ErrIntentExists` → 409.

Successful path returns 202 with `auctionExpiry` set to `now + OFA_WINDOW`.

### POST /v1/payment-notice

- Looks up the intent state. Requires `MATCHED`. Anything else → 409.
- Emits `SendDrop(events.PaymentNoticeReceived, …)`.

### GET /v1/ws — WebSocket bid intake (`internal/relayer/api/ws/handler.go`)

- One reader goroutine per connection. A second drainer goroutine pulls from a per-connection `bidCh` into the engine.
- Read deadline `s.readDeadline` set at handshake and after every read.
- Write deadline `s.writeDeadline` applied before each write.
- Backpressure: if the drainer is behind, the read goroutine drops the bid (the engine's `solverBids` map dedup eliminates the impact).

### GET :8443/internal/witness/verified/{intentId} (`internal/relayer/api/mtls/server.go`)

- TLS config: `MinVersion: tls.VersionTLS13`, `ClientAuth: tls.RequireAndVerifyClientCert`.
- Server certs from `MTLS_SERVER_CERT_PATH`, `MTLS_SERVER_KEY_PATH`; client CA from `MTLS_CA_CERT_PATH`.
- Handler (`handler.go:11`): rejects with HTTP 403 if the client cert CN ≠ `"watchdog.vynx.internal"`. Hardcoded; any client cert with a different CN fails.
- `http.Server` config: `ReadHeaderTimeout: 2s`, `ReadTimeout: 10s`, `WriteTimeout: 10s`, `IdleTimeout: 120s`, `MaxHeaderBytes: 8192`.
- Returns JSON `{verified: true|false}` based on `witness.IsVerified(intentID)`.

---

## 6. Startup Sequence (`cmd/relayer/main.go`)

Goroutines launched at startup, in declaration order:

| Tag | Goroutine | Role |
|---|---|---|
| G1 | `sla-tracker` | SLA + deadline sweep, 500 ms tick |
| G2 | `db-writer` | Cold Path → PostgreSQL, 100 ms batch flush |
| G3 | `drain-reputation` | reputation manager event consumer |
| G4 | `drain-health-deltas` | applies `SolverHealthDelta` into the gatekeeper |
| G5 | `witness` | cross-chain payment verification |
| G6 | `rpc-health` | RPC pool state machine |
| G7 | `amnesty` | 90-day jail reset, sends `ReputationReset` |
| G8 | `intent-locked-watcher` | conditional — on-chain `IntentLocked` subscription |
| G9 | `mtls-server` | conditional — `:8443` mTLS listener for fraud verification |
| G10 | `ws-push-worker` | if `d.wsServer != nil` — `d.wsServer.RunPushWorker(ctx)` — drains `IntentAccepted` and `AuctionConcludedPush` channels; broadcasts `IntentAnnouncedFrame` to all connected solvers and unicasts `AuctionWonFrame` to the winning solver |

### KMS Address Verification

Both `cmd/relayer/main.go` and `cmd/signer/main.go` derive the Ethereum address from the configured KMS key at startup and compare against the expected env var:

- Signer (`cmd/signer/main.go`): `kms.GetPublicKey` → derive address → fatal if it does not match `RELAYER_SIGNER`.
- Relayer (`cmd/relayer/main.go:85-97`): UDS `get_address` request → compare against `RELAYER_SIGNER` → fatal log `"FATAL: KMS key address mismatch — wrong key configured for RELAYER_SIGNER"` with fields `kms_derived` and `expected`.

The mismatch fatal carries the derived address in the log — this is the probe-task pattern used by the rotation runbook to read the new address after a KMS key swap. See [`docs/secrets_rotation.md`](secrets_rotation.md) §1.

### Graceful Shutdown

`context.Context` is cancelled on SIGTERM. Each goroutine respects `<-ctx.Done()` and returns. The DB writer flushes its pending batch on exit. The mTLS server gets a 5 s shutdown timeout. ALB `deregistration_delay = 30` (`docs/infrastructure.md` §7) gives in-flight 200 ms auctions room to settle.

---

## 7. WebSocket Push Protocol

`/v1/ws` is bidirectional. Solvers must keep a persistent connection open and identify themselves at upgrade with `?solver=0x...`. The relayer drops the connection if the query parameter is missing or not a hex address.

### Why push?

The 200 ms OFA window is incompatible with polling. By the time a solver finishes a HTTP `GET /v1/intents` poll, the auction window is already closed. The push channel sends `IntentAnnouncedFrame` as soon as the relayer accepts an intent — at most a few milliseconds before the auction window opens.

### Frames

```json
// Broadcast to every connected solver, before the 200 ms auction window opens.
{
  "type":              "intent_announced",
  "intentId":          "0x…",
  "inputAmount":       "100000000",
  "inputToken":        "0x…",
  "originChainId":     8453,
  "targetToken":       "0x…",
  "targetChainId":     1,
  "auctionDeadlineMs": 1700000000000
}

// Unicast to the winning solver only, after the auction concludes.
{
  "type":          "auction_won",
  "intentId":      "0x…",
  "winningAmount": "102000000",
  "slaExpiry":     1700000500
}
```

`inputToken == targetToken` under INV-6 (USDC-only). `auctionDeadlineMs = time.Now().UnixMilli() + types.OFA_WINDOW.Milliseconds()` at intent intake.

### Data flow

```
HTTP POST /v1/intent
        │
        ▼
IntentIntakeHandler → mempool → SendDrop(events.IntentAccepted)
                                       │
                                       ▼
                               RunPushWorker (G10)
                                       │
                                       ▼
                            SolverRegistry.Broadcast
                                       │
                                       ▼
                            [all connected solvers]

RunAuction (Hot Path, 200 ms)
        │
        ├── SendDrop(events.AuctionConcluded) ── DB writer → status='MATCHED'
        │
        └── SendDrop(events.AuctionConcludedPush)
                                       │
                                       ▼
                               RunPushWorker (G10)
                                       │
                                       ▼
                       SolverRegistry.SendToSolver(winner)
                                       │
                                       ▼
                          [winning solver only]
```

`events.AuctionConcluded` (DB writer) and `events.AuctionConcludedPush` (push worker) are parallel channels — emitting to both keeps INV-8 intact (the Hot Path performs no I/O) while letting the WS worker drain on its own goroutine.

### Connection lifecycle

1. Solver dials `ws://relayer/v1/ws?solver=<addr>`.
2. Server validates `solver` is a hex address — 400 if not, BEFORE upgrade.
3. After upgrade, the address is added to `SolverRegistry`.
4. Read loop forwards bids to `BidRouter` exactly as before (INVARIANT 8 — no Hot Path call from here).
5. `RunPushWorker` writes push frames to this conn whenever events fire.
6. On connection close (read error, normal close, OR any failed push write), the address is removed from `SolverRegistry`. Subsequent broadcasts and unicasts silently skip it.

### Invariant callouts

- **INV-WS-1** — `RunPushWorker` is the sole goroutine that writes push frames. `ServeHTTP` is read-only.
- **INV-WS-2** — Both `IntentAccepted` and `AuctionConcludedPush` use `SendDrop`. A saturated channel drops the announcement rather than blocking the HTTP handler that just accepted an intent or the auction engine that just selected a winner. Settlement is unaffected — the on-chain path proceeds regardless.

---

## See also

- [`docs/architecture.md`](architecture.md) — invariants, EventBus model, trust boundaries
- [`docs/infrastructure.md`](infrastructure.md) — Fargate task definition, ALB / WAF, RDS pool settings
- [`docs/onchain_contracts.md`](onchain_contracts.md) — `VynxSettlement` ABI, Intent/Voucher structs
- [`docs/watchdog.md`](watchdog.md) — the only consumer of `:8443/internal/witness/verified/`
- [`docs/secrets_rotation.md`](secrets_rotation.md) — RelayerMasterKey rotation
