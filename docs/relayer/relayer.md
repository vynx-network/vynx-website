# Relayer — `cmd/relayer`

> Box 1 (us-east-1, `vynx-core-prod`). The agent-facing settlement engine: it
> accepts cross-chain transfer intents, runs a **200ms sealed-bid Order-Flow
> Auction** entirely from RAM, verifies the winning solver's destination payment,
> and drives on-chain settlement. Pairs with the [Signer](signer.md) sidecar over
> a UDS for EIP-712 voucher signing.

The Relayer is split into a **Hot Path** (the 200ms auction — pure RAM, zero I/O)
and a **Cold Path** (RPC watching, witness verification, PostgreSQL persistence).
A typed `EventBus` separates them; the Hot Path never blocks on the Cold Path.

---

## 1. Governing invariants

| # | Invariant | Where |
|---|---|---|
| **3** | The Relayer has zero `kms:Sign`; voucher signing happens only in the Signer sidecar over UDS. | wiring; see [`signer.md`](signer.md) |
| **6** | USDC-only collateral and intents — direct integer comparison, no oracle. | `hotpath/gatekeeper/gatekeeper.go:126` |
| **8** | The Hot Path (200ms auction) performs **zero** disk/network/RPC/KMS I/O. | `hotpath/engine/auction.go:38` |
| **11** | INV-WS-1 — `(*ws.Server).RunPushWorker` is the **sole** writer of push frames; `ServeHTTP` never writes one. | `api/ws/push.go:54` |
| **12** | INV-WS-2 — `IntentAccepted` / `AuctionConcludedPush` are **SendDrop-only** (advisory; dropped on saturation, never backpressuring). | `api/http/intent.go:168`, `api/ws/push.go` |

---

## 2. Boot & wiring (`cmd/relayer/main.go`)

- USDC token = `USDC_ADDRESS_BASE`; **`tvlCapUsdc = mustU64Env("TVL_CAP_USDC")`**
  (mandatory — see §9 Known gaps).
- Gatekeeper: `NewGatekeeper(usdcToken, tvlCapUsdc)`.
- RPC pool over all five chains; a Base subscription client for the cold-path
  watcher; PostgreSQL pool on `VYNX_RELAYER_DB_DSN`.
- `originChainID = VYNX_CHAIN_ID`; `intentDomainSep = DomainSeparator(originChainID,
  VYNX_SETTLEMENT_ADDRESS)` — the EIP-712 domain used to verify agent intent
  signatures at intake.
- WebSocket server `ws.NewServer(gk, bidRouter, solverRegistry, events,
  originChainID, …)`.
- Optional `SolverSlashedWatcher` (G12) if `VYNX_REGISTRY_ADDRESS` is set
  (BLINDAJE A.10).
- mTLS internal server on **`:8443`** (`MTLS_SERVER_CERT_PATH` /
  `MTLS_SERVER_KEY_PATH` / `MTLS_CA_CERT_PATH`) — the fraud-verification endpoint
  the Watchdog calls.
- Public HTTP/WS on **`PORT`** (default `8080`).

Long-running goroutines are launched with a `G`-prefixed naming scheme (e.g.
`G10-ws-push-worker`, `G12-solver-slashed-watcher`), distinct from the Watchdog's
`W`-series.

---

## 3. Intake — `POST /v1/intent` (`api/http/intent.go`)

The intake pipeline applies guards in order; each precedes the next:

| Step | Check | Failure |
|---|---|---|
| 1 | Method is `POST`. | `405` |
| 2 | RPC pool is `Healthy` (partial-degradation circuit breaker). In-flight intents continue; **fresh** ones are rejected. | `503` |
| 3 | JSON decodes; `signature` field present; `parseIntent` (valid addresses/amounts, `destinationChainId`/`deadline` non-zero). | `400` |
| 4 | **F2 — deadline not already expired** (`deadline > now`). Rejects intents no solver could win. (Intake-side reject only; the authoritative deadline clock is the Watchdog's, Invariant 7.) | `400` |
| 5 | **F1 — agent EIP-712 signature** (`verifyAgentSignature`): recovers the signer over `(nonce, agent, token, inputAmount, destChainID, deadline)` via `ComputeIntentHash` and compares to `intent.Agent`. | `401` |
| 6 | `gatekeeper.ValidateIntent` (token whitelist, MIN/MAX intent, destination-chain whitelist). | `400` |
| 7 | `gatekeeper.ReserveIntent` — atomic TVL check-and-register (BLINDAJE A.12). | `400` |
| 8 | `mempool.Add` (duplicate ID ⇒ `409`, releasing the reservation). | `409`/`500` |

On success: emit `IntentVerified` (→ persistence, `SendDrop`), register a per-intent
bid channel, **announce** the intent to all solvers via `IntentAccepted`
(`SendDrop`, INV-WS-2), launch `RunAuction`, and return **`202 Accepted`** with the
auction expiry.

> **F1 nuance (honest):** `verifyAgentSignature` bypasses three input classes for
> backward compatibility — absent, non-65-byte, and the **all-zero placeholder**
> the SDK currently sends (`intent_builder.ts:82`, client-side signing not yet
> implemented). Any *real* 65-byte signature is fully recovered and a mismatch
> returns `401`. A 65-byte-length signature that is **not valid hex** is malformed
> — not one of the three bypass classes — and returns `401` (previously a hex-decode
> error was silently accepted; corrected). The verification path is wired;
> enforcement becomes total once the SDK signs.

`GET` intent status is served separately by `api/http/status.go`.

---

## 4. Gatekeeper (`hotpath/gatekeeper/gatekeeper.go`)

O(1), zero-I/O validation against RAM state.

- **`ValidateIntent`** — token == USDC, `MIN_INTENT_USDC ≤ amount ≤ MAX_INTENT_USDC`
  (BLINDAJE A.11), destination chain ∈ {Base, Eth, Arbitrum, Optimism, Polygon}
  (A.13). Errors: `ErrTokenNotWhitelisted`, `ErrBelowMinimum`, `ErrAboveMaximum`,
  `ErrInvalidDestChain`.
- **TVL ceiling (A.12)** — `ReserveIntent` / `ReleaseIntent` guard a RAM reservation
  counter (`tvlMu`). Reserve is atomic check-and-register and idempotent; Release is
  idempotent and wired into **every** terminal outcome (`sla_expired`,
  `deadline_expired`, `no_bids`, `SETTLED`). The counter is **ephemeral across
  relayer restarts** (BLINDAJE A.9 minimal recovery), matching the mempool / SLA
  model.
- **`ValidateBid`** — `RLock` held for the whole function (TOCTOU-safe over
  `*big.Int`). Checks: solver not jailed; **SHF** `FreeCollateral ≥ InputAmount ×
  1.20` (`SHF_THRESHOLD = 120`); **exposure** `InFlight / Total < 80%`
  (`MAX_SOLVER_EXPOSURE`). **Invariant 6** — pure USDC integer math, no oracle.
- **`ApplyDelta`** — the Cold Path mutates the solver-health cache here (collateral
  deposit/slash, in-flight increase/release, jail level/expiry).

---

## 5. Hot Path — the 200ms auction (`hotpath/engine/auction.go`)

`RunAuction` runs one sealed-bid OFA per intent. **Invariant 8**: no disk, network,
RPC, or KMS calls — only RAM (DogStatsD UDP emits are async/non-blocking and
permitted).

1. **Collection** — drain the bid channel until `OFA_WINDOW` (200ms) expires:
   - **F3 first-bid-wins** — the first bid per solver is canonical; duplicates are
     rejected and a `BidRejected` event is emitted (→ `bid_rejected` frame).
   - Cap of **1000 distinct solvers** per intent (spam bound).
   - Each `ValidateBid` is budgeted to **5ms**; bids below `MinOutputAmount` are dropped.
   - Late bids (arriving after the window) are simply not collected (BLINDAJE A.16).
2. **Selection** — sort by `Max(OutputAmount)`, tie-break by higher `HealthFactor`;
   winner is `bids[0]`. If **no bids**, emit `IntentTimeout{no_bids}` and release the
   TVL reservation.
3. **Emission** — build `AuctionResult` (winner, amount, `SLAExpiry`, agent,
   `OutputToken`, `MinOutputAmount`), register SLA tracking, then `SendDrop` to two
   channels: `AuctionConcluded` (→ DB writer) and `AuctionConcludedPush` (→ WS push
   worker, INV-WS-2).

The lock-sharded `mempool` (256 shards keyed by `intentID[0]`) and the SLA `Tracker`
(a single 500ms sweep goroutine — no per-intent goroutines) are the other Hot-Path
RAM structures.

---

## 6. WebSocket push channel (`api/ws/`)

Solvers connect to `/v1/ws` for bid intake and push frames. **INV-WS-1**:
`RunPushWorker` is the *only* goroutine that writes push frames; it drains three
event-bus channels and never shares that responsibility with `ServeHTTP`.

| Frame | Cast | Trigger |
|---|---|---|
| `IntentAnnouncedFrame` (`intent_announced`) | broadcast | `IntentAccepted` — sent to all solvers before the window opens. `InputToken == TargetToken` (USDC-only, INV-6). |
| `AuctionWonFrame` (`auction_won`) | unicast (winner) | `AuctionConcludedPush` — carries `Agent`, `OutputToken`, `MinOutputAmount` so the solver can build the destination transfer and the witness can validate it. |
| `BidRejectedFrame` (`bid_rejected`) | unicast (solver) | `BidRejected` — duplicate bid (F3). |

Per **INV-WS-2**, the `IntentAccepted` and `AuctionConcludedPush` sends are
`SendDrop`: a saturated push channel drops the frame rather than backpressuring the
HTTP handler or the auction engine. Push frames are advisory — protocol settlement
does not depend on them landing. `SolverRegistry` has its own `sync.RWMutex`, scoped
to that struct and independent of `BidRouter`'s mutex.

---

## 7. Cold Path

Runs off the Hot Path, consuming `EventBus` channels.

- **Witness (`coldpath/witness/`)** — the trust anchor (BLINDAJE A.4). After a
  solver claims to have paid the agent on the destination chain, the witness
  validates that destination-chain ERC20 transfer against the intent's
  `OutputToken`, `MinOutputAmount`, and agent recipient, waiting the chain-specific
  finality confirmation count before the payment is accepted. Only then is the
  voucher eligible for issuance/redemption.
- **RPC watcher (`coldpath/rpc/`)** — subscribes to `IntentLocked` and related Base
  L2 events; an RPC pool with a circuit breaker exposes `HaltCh()` on Base quorum
  loss, which drives the intake `503` gate (§3 step 2). `OutputToken` is plumbed
  through domain → intake → persistence → witness → auction frame (A.5).
- **Persistence (`coldpath/persistence/`)** — a single-goroutine DB writer batches
  all PostgreSQL writes from the Cold Path (100ms flush). PostgreSQL is the
  cold-path audit/state store; it is **never** read by the Watchdog (Invariant 4).
- **Reputation / SLA jail (A.15)** — a solver that wins but misses its SLA commit is
  jailed with escalating durations; `ApplyDelta` propagates jail level + expiry into
  the gatekeeper's solver-health cache, where `ValidateBid` enforces it.
- **`SolverSlashedWatcher` (G12, A.10)** — watches `VynxRegistry.SolverSlashed` and
  applies the post-slash collateral delta so the gatekeeper's SHF view stays correct.

---

## 8. Internal mTLS (fraud verification)

The Relayer hosts an mTLS server on `:8443`. The Watchdog is the client: on a
`SuspiciousActivity` signal it calls this endpoint, and the check is **fail-closed**
— any error (network, TLS, non-200) triggers `EmergencyPause` rather than skipping
it. Demo certs are self-signed; production replaces them with CA-issued certs (see
[`secrets_rotation.md`](secrets_rotation.md)).

---

## 9. Configuration & known gaps

| Env | Required | Meaning |
|---|---|---|
| `TVL_CAP_USDC` | **yes** | Global in-flight USDC ceiling, 6-decimal atomic units. Boot panics if unset. |
| `USDC_ADDRESS_BASE` | yes | The whitelisted input token. |
| `VYNX_RELAYER_DB_DSN` | yes | `vynx_relayer`-role PostgreSQL DSN. |
| `VYNX_CHAIN_ID` | yes | Origin chain / EIP-712 domain (8453). |
| `VYNX_SETTLEMENT_ADDRESS`, `RELAYER_SIGNER` | yes | Settlement contract; expected signer address. |
| `BASE_RPC_URL` … `POLYGON_RPC_URL` | yes | RPC endpoints. |
| `MTLS_SERVER_CERT_PATH`, `MTLS_SERVER_KEY_PATH`, `MTLS_CA_CERT_PATH` | yes | mTLS server identity. |
| `PORT` | no | Public HTTP/WS port (default `8080`). |
| `VYNX_REGISTRY_ADDRESS` | no | Enables the SolverSlashedWatcher (G12). |

**Note:** `TVL_CAP_USDC` is mandatory at boot in every relayer environment. The
`make e2e-local` harness now injects it via `Env()` (`e2e/harness/harness.go`), so
the former "must be ambient" e2e gap is closed; a standalone relayer outside the
harness still needs it set. See [`getting_started.md`](getting_started.md).

See also: [`signer.md`](signer.md), [`watchdog.md`](watchdog.md),
[`architecture.md`](architecture.md), [`onchain_contracts.md`](onchain_contracts.md).
