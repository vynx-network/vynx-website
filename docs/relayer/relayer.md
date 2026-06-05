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
| **11** | INV-WS-1 — `(*ws.Server).RunPushWorker` is the **sole** writer of push frames; `ServeHTTP` never writes one. | `api/ws/push.go:70` |
| **12** | INV-WS-2 — `IntentAccepted` / `AuctionConcludedPush` are **SendDrop-only** (advisory; dropped on saturation, never backpressuring). | `api/http/intent.go:186`, `api/ws/push.go` |

---

## 2. Boot & wiring (`cmd/relayer/main.go`)

- USDC token = `USDC_ADDRESS_BASE`; **`tvlCapUsdc = mustU64Env("TVL_CAP_USDC")`**
  (mandatory — see §9 Known gaps).
- Gatekeeper: `NewGatekeeper(usdcToken, tvlCapUsdc)`.
- RPC pool over all five chains; a Base subscription client for the cold-path
  watcher; PostgreSQL pool on `VYNX_RELAYER_DB_DSN`.
- `originChainID = VYNX_CHAIN_ID`; `usdcDomainSep =
  resolveUSDCDomainSeparator(originChainID)` — the USDC EIP-712 domain
  separator used to verify agent EIP-3009 authorizations at intake (GASLESS
  REDESIGN). Resolution is **build-tag gated** (Sprint 3.2):
  - `usdcsep_prod.go` (`//go:build !e2e`) — the **pinned** per-chain
    separators only (`signer.USDCDomainSeparator`; pinned because the live
    USDC domain *name* differs per chain: "USD Coin" on 8453, "USDC" on
    84532); startup is **fatal** if the origin chain has no pinned value.
    The production binary contains **no override path at all** — it never
    reads `VYNX_E2E_USDC_DOMAIN_SEPARATOR` (the env-var string is absent
    from the compiled binary).
  - `usdcsep_e2e.go` (`//go:build e2e`) — honors the
    `VYNX_E2E_USDC_DOMAIN_SEPARATOR` override first (harness MockUSDC at a
    dynamic address), pinned constants otherwise. Test builds only.
- WebSocket server `ws.NewServer(gk, bidRouter, solverRegistry, events,
  tracker, originChainID, …)` — the SLA tracker rides along as the narrow
  `AckTracker` the read loop calls on inbound `won_ack` frames (Sprint 4.3).
- Optional `SolverSlashedWatcher` (G12) if `VYNX_REGISTRY_ADDRESS` is set
  (BLINDAJE A.10).
- mTLS internal server on **`:8443`** (`MTLS_SERVER_CERT_PATH` /
  `MTLS_SERVER_KEY_PATH` / `MTLS_CA_CERT_PATH`) — the fraud-verification endpoint
  the Watchdog calls.
- Public HTTP/WS on **`PORT`** (default `8080`).

Long-running goroutines are launched with a `G`-prefixed naming scheme (e.g.
`G10-ws-push-worker`, `G12-solver-slashed-watcher`,
`G13-voucher-redeemed-watcher`), distinct from the Watchdog's `W`-series.

---

## 3. Intake — `POST /v1/intent` (`api/http/intent.go`)

The intake pipeline applies guards in order; each precedes the next:

The body is the FASE 2→3 wire contract (the SDK's `IntentSubmitRequest`):
exactly nine keys — `intentId, agent, token, inputAmount, outputToken,
minOutputAmount, destinationChainId, deadline, authorization` — decoded with
`DisallowUnknownFields`, so the retired `nonce`/`signature` keys (or any other
extra key) are a `400`. `authorization` is the agent's 65-byte EIP-3009
`ReceiveWithAuthorization` signature (`r ‖ s ‖ v`, `v ∈ {27, 28}`); the
authorization nonce is **never transported** — it is always recomputed from
the submitted terms.

| Step | Check | Failure |
|---|---|---|
| 1 | Method is `POST`. | `405` |
| 2 | RPC pool is `Healthy` (partial-degradation circuit breaker). In-flight intents continue; **fresh** ones are rejected. | `503` |
| 3 | Strict JSON decode (unknown keys rejected); `parseIntent` (valid 32-byte `intentId`, valid `agent`/`token`/`outputToken` addresses, positive amounts, `destinationChainId`/`deadline` non-zero). | `400` |
| 4 | **F2 — deadline not already expired** (`deadline > now`). Rejects intents no solver could win. (Intake-side reject only; the authoritative deadline clock is the Watchdog's, Invariant 7.) | `400` |
| 5 | `parseAuthorization`: exactly 65 bytes of hex, not all-zero, `v ∈ {27, 28}`. **No bypass classes exist** — every submission must carry a real authorization. | `400` |
| 6 | **F1 — agent EIP-3009 authorization** (`verifyAgentAuthorization`): recompute `nonce = ComputeIntentNonce(terms)` (§D2 — domain tag + the 8 signed terms), reconstruct the `ReceiveWithAuthorization` digest `{from: agent, to: settlement, value: inputAmount, validAfter: 0, validBefore: deadline, nonce}` against the **pinned** origin-USDC domain separator, recover the signer (high-`s` malleation rejected), require signer == `intent.Agent`. Runs **before** any reservation or auction. | `401` |
| 7 | `gatekeeper.ValidateIntent` (token whitelist, MIN/MAX intent, destination-chain whitelist). | `400` |
| 8 | `gatekeeper.ReserveIntent` — atomic TVL check-and-register (BLINDAJE A.12). | `400` |
| 9 | `mempool.Add` (duplicate ID ⇒ `409`, releasing the reservation). | `409`/`500` |

On success: emit `IntentVerified` (→ persistence, `SendDrop`), register a per-intent
bid channel, **announce** the intent to all solvers via `IntentAccepted`
(`SendDrop`, INV-WS-2 — the announcement never includes the authorization), launch
`RunAuction` with the verified authorization riding as a **sibling** of the intent
(Sprint 3.2 — `types.Intent` stays the pure calldata mirror; the auth flows only
intake → engine → `AuctionConcludedPush` → unicast `AuctionWonFrame`), and return
**`202 Accepted`** with the auction expiry.

> **GASLESS REDESIGN:** the relayer **no longer signs intents** — it only
> verifies the agent's. A tampered term (any of the eight) changes the
> recomputed nonce, the reconstructed digest no longer matches the agent's
> signature, and intake rejects with `401` before the auction ever runs. The
> relayer's signing key signs **vouchers only**.

`GET` intent status is served separately by `api/http/status.go`. Since the
gasless redesign, `MATCHED`/`LOCKED` responses carry only `{intentId, status}`
— there is no `intent`/`relayerSig` payload (the SDK treats those states as
match-progress; the winning solver receives the terms + the agent's
authorization via the `AuctionWonFrame`).

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
3. **Emission** — register the **pending win** against the winning solver via
   `tracker.TrackPendingWin(push, runnerUps)` (Sprint 4.3 **arm-on-ack**: the
   10s SLA clock is NOT started here — it arms only when the winner acks the
   frame; the frame's `slaExpiry` is a provisional, conservative bound). Up to
   `WON_RUNNER_UP_CAP` next-best bids are retained for the anti-stall forfeit
   ladder (§7 Reputation/SLA). Then `SendDrop` to two channels: the lean
   `AuctionResult` (winner, amount, `SLAExpiry`) on `AuctionConcluded`
   (→ DB writer), and `AuctionWonPush` — the full 8-term intent **plus the agent's
   EIP-3009 authorization**, transported verbatim — on `AuctionConcludedPush`
   (→ WS push worker, INV-WS-2). The push channel, the tracker's bounded
   re-pushes, and the authenticated `GET /v1/won` pull fallback are the
   authorization's **only** onward paths: it never reaches the DB writer and is
   never logged (`types.Authorization` is transport-only with redacted
   `String`/`MarshalJSON`).

The lock-sharded `mempool` (256 shards keyed by `intentID[0]`) and the SLA `Tracker`
(a single 500ms sweep goroutine — no per-intent goroutines; it also holds the
pending-win payloads until lock/forfeit) are the other Hot-Path RAM structures.

---

## 6. WebSocket push channel (`api/ws/`)

Solvers connect to `/v1/ws` for bid intake and push frames. **INV-WS-1**:
`RunPushWorker` is the *only* goroutine that writes push frames; it drains three
event-bus channels and never shares that responsibility with `ServeHTTP`.

| Frame | Cast | Trigger |
|---|---|---|
| `IntentAnnouncedFrame` (`intent_announced`) | broadcast | `IntentAccepted` — sent to all solvers before the window opens. `InputToken == TargetToken` (USDC-only, INV-6). **Never carries the agent authorization** — solvers bid blind on the public terms. |
| `AuctionWonFrame` (`auction_won`) | unicast (winner) | `AuctionConcludedPush` — the **FASE 3→4 interface contract** (see below). Re-sent by the SLA tracker's bounded re-push ladder while unacked (Sprint 4.3) — duplicates are expected; the solver re-acks and never re-locks. |
| `BidRejectedFrame` (`bid_rejected`) | unicast (solver) | `BidRejected` — duplicate bid (F3). |
| `VoucherReadyFrame` (`voucher_ready`) | unicast (winner) | `VoucherReadyPush` — the witness signed the voucher (Sprint 4.3 push-then-pull). Carries ONLY the intentId; the solver reacts by pulling `GET /v1/voucher/{id}`. |

**Inbound, besides bids (Sprint 4.3):** `{"type":"won_ack","intentId":"0x…"}` —
the winner's acknowledgement of `auction_won`. The read loop sniffs the optional
`type` discriminator (typeless messages remain bids — wire back-compat), binds
the ack to the **connection's** solver address (never a body-declared one), and
calls `tracker.AckWon` — a pure RAM op; no push frame is written (INV-WS-1
intact). The ack is idempotent and gets no response frame: the relayer's
re-push ladder is the retry mechanism for a lost ack.

**`AuctionWonFrame` — the FASE 3→4 interface contract (Sprint 3.2).** The frame
the winning solver consumes in FASE 4 to build and send
`VynxSettlement.lockIntent(intent, auth)` — paying the gas — **without correlating
any prior frame**. It is self-contained:

```json
{
  "type": "auction_won",
  "intentId": "0x…32B",          // ┐
  "agent": "0x…20B",             // │
  "token": "0x…20B",             // │ the 8 agent-signed terms —
  "inputAmount": "decimal",      // │ the exact calldata Intent fields;
  "outputToken": "0x…20B",       // │ the solver fills intent.solver
  "minOutputAmount": "decimal",  // │ with its own address
  "destinationChainId": 1,       // │
  "deadline": 1700000900,        // ┘
  "authorization": "0x…65B",     // the agent's EIP-3009 signature (r‖s‖v)
  "winningAmount": "decimal",    // the solver's own winning bid
  "slaExpiry": 1700000500        // Unix s — lock must land before this (SLA jail)
}
```

The `authorization` is **unicast-only**: it goes exclusively to the auction
winner, is never present in the broadcast `intent_announced`, and never reaches
a logger anywhere in the relayer (no-key-logging rule extended to the
authorization — `types.Authorization` redacts `String()`/`MarshalJSON`; only its
explicit `Hex()` serializes it, here).

The **consumer side** of this contract (Sprint 4.1) is specified in
[`solver.md`](solver.md): build the Intent tuple from the 8 terms with
`solver = self`, split the 65-byte authorization into `(v, r, s)`, send **one**
`lockIntent` on Base paying gas before `slaExpiry` — never blind-retry the
lock. Reference consumers: `e2e/solverkit` (canonical, unit-tested against the
real settlement ABI) and the sibling repo's `vynx-e2e/solver/main.go` (the
orchestrator's real solver process).

Per **INV-WS-2**, the `IntentAccepted`, `AuctionConcludedPush`, and
`VoucherReadyPush` sends are `SendDrop`: a saturated push channel drops the frame
rather than backpressuring the HTTP handler, the auction engine, or the witness.
Push frames are advisory — protocol settlement does not depend on them landing
(a lost `auction_won` is covered by the re-push ladder + `GET /v1/won`; a lost
`voucher_ready` by the solver's bounded fallback poll). `SolverRegistry` has its
own `sync.RWMutex`, scoped to that struct and independent of `BidRouter`'s mutex.

**Won-frame pull fallback (`api/http/won.go`, `GET /v1/won/{intentId}`, Sprint
4.3).** A winner whose unicast was lost recovers the FULL frame over HTTP:
winner-gated by the same EIP-191 challenge pattern as the voucher endpoint
(canonical message `vynx-won:{intentId}:{unix-ts}` — domain-separated so a
captured challenge cannot be replayed across endpoints), served ONLY while the
win is live (pushed or acked, not yet locked/forfeited/expired; otherwise 404 —
before the winner check, so a non-winner cannot distinguish; wrong caller 403).
The response is built by `ws.BuildAuctionWonFrame` — the single
`Authorization.Hex()` site — and this endpoint is the **second sanctioned
authorization wire site** (check-invariants #7); the handler holds no logger. A
200 is provable frame receipt, so the pull **counts as the ack** and arms the
SLA clock idempotently.

---

## 7. Cold Path

Runs off the Hot Path, consuming `EventBus` channels.

- **Payment notice (`api/http/payment.go`, `POST /v1/payment-notice`)** — the
  solver reports its destination payment (`intentId, solver, destTxHash`). The
  DB-state gate accepts intents in **`MATCHED` or `LOCKED`** (Sprint 4.1): under
  the gasless ordering the solver locks on-chain *before* paying, so `LOCKED`
  (written by the IntentLocked watcher) is the steady-state at notice time;
  `MATCHED` is still accepted to tolerate watcher latency. Anything else is `404`.
- **Witness (`coldpath/witness/`)** — the trust anchor (BLINDAJE A.4). After a
  solver claims to have paid the agent on the destination chain, the witness
  validates that destination-chain ERC20 transfer against the intent's
  `OutputToken`, `MinOutputAmount`, and agent recipient, waiting the chain-specific
  finality confirmation count before the payment is accepted. Only then is the
  voucher eligible for issuance/redemption.
- **Voucher delivery (`api/http/voucher.go`, `GET /v1/voucher/{intentId}`, Sprint
  4.2; push-then-pull since 4.3)** — the authenticated PULL endpoint the winning
  solver hits after its payment notice. The steady state is **signal-driven**:
  when the witness signs the voucher it emits `VoucherReadyPush` (right after
  `CrossChainPaymentVerified`) and the push worker unicasts `voucher_ready`; the
  solver pulls on that signal instead of burning a fixed poll budget against
  unknown destination-chain finality (the 4.2 fragility this removes). A bounded
  fallback poll covers a lost signal. Winner-gated by an **EIP-191 challenge**:
  the caller signs `vynx-voucher:{intentId}:{unix-ts}` with its own key and sends
  `X-Vynx-Solver` / `X-Vynx-Timestamp` (±60s freshness — API auth, not protocol
  deadline evaluation) / `X-Vynx-Signature`; the recovered address must equal both
  the declared header and the intent's recorded winner. Serves the witness-signed
  voucher (`intentId, solver, amount = the SIGNED MinOutputAmount, destTxHash,
  issuedAt, signature`) **only while the row is `SETTLED`** — pre-settlement and
  post-redemption (ARCHIVED) both `404`, non-winner `403`. **Normalized serve
  (ratified 4.2-d, shipped 4.3):** the SERVED signature carries the on-chain
  Ethereum convention `v ∈ {27,28}` so a third-party solver can pass the voucher
  straight into `claimFunds`; the DB row stays byte-exact in the witness's raw
  `{0,1}` form. The voucher signature is never logged (check-invariants #8); the
  response body is its only wire site. Backed by migration `0009`
  (`voucher_amount`, `voucher_issued_at`, written by the DB writer at SETTLED).
  See [`solver.md`](solver.md) §6 for the consumer side.
- **RPC watcher (`coldpath/rpc/`)** — subscribes to `IntentLocked` and related Base
  L2 events; an RPC pool with a circuit breaker exposes `HaltCh()` on Base quorum
  loss, which drives the intake `503` gate (§3 step 2). `OutputToken` is plumbed
  through domain → intake → persistence → witness → auction frame (A.5).
- **`VoucherRedeemedWatcher` (G13, Sprint 4.2)** — watches
  `VynxSettlement.VoucherRedeemed` on Base and emits the archive event the DB
  writer turns into `status = ARCHIVED`, which simultaneously closes voucher
  delivery for that intent (the endpoint's `SETTLED` gate). The status endpoint
  keeps reporting `SETTLED` to the SDK for archived rows.
- **Persistence (`coldpath/persistence/`)** — a single-goroutine DB writer batches
  all PostgreSQL writes from the Cold Path (100ms flush). PostgreSQL is the
  cold-path audit/state store; it is **never** read by the Watchdog (Invariant 4).
  **Status-precedence guards (Sprint 4.2):** `opUpdateMatched` carries
  `status NOT IN ('LOCKED','SETTLED','ARCHIVED','FAILED')` and `opUpdateLocked`
  carries `status NOT IN ('SETTLED','ARCHIVED','FAILED')` (mirroring
  `opUpdateFailed`), so a late event drained from a parallel channel can never
  move an intent backwards (e.g. MATCHED-after-LOCKED under concurrent drain).
- **Reputation / SLA jail (A.15; arm-on-ack since Sprint 4.3)** — the SLA only
  penalizes what the solver controls. The tracker holds a fresh win in
  `phaseAwaitAck`: the **10s lock clock arms only when the winner acks** receipt
  of the `auction_won` frame (WS `won_ack`, or implicitly via a 200 on
  `GET /v1/won`, or — strongest — the on-chain lock itself, which `Promote`s
  from any phase). A solver that acks but misses the lock within 10s of ITS ack
  is jailed with escalating durations; `ApplyDelta` propagates jail level +
  expiry into the gatekeeper's solver-health cache, where `ValidateBid` enforces
  it. A **lost frame is a relayer-side delivery failure, never a jail cause**.
  - **Anti-stall forfeit ladder:** no ack within `WON_ACK_WINDOW` (2s) → the
    frame is re-pushed up to `WON_ACK_MAX_REPUSH` (2) times; still no ack → the
    win is **forfeited** and re-auctioned to the next-best retained bid (up to
    `WON_RUNNER_UP_CAP`, each with its own ack ladder; the DB MATCHED row
    follows via a re-emitted `AuctionConcluded`); no runner-up left → the
    intent fails (`IntentTimeout{won_never_acked, Solver: zero}` → `FAILED`;
    the agent's on-chain deadline refund covers funds). The forfeited winner is
    **never jailed** — the forfeit path emits nothing on the jail channel.
  - **Incentive compatibility:** a never-acking solver gains nothing — it loses
    the win in ~6s and walks away unjailed but empty-handed; a legitimate
    winner always acks immediately because the ack is what starts the fair
    clock it can actually honor (it cannot safely build the lock before
    receiving the frame, so delaying the ack has zero upside and risks
    forfeiture); locking without acking is still honored via `Promote`
    (on-chain truth), so no honest path is punished. Stalling is strictly
    dominated; acking is strictly dominant.
  - **Channel split (Sprint 4.3 fix):** solver-attributed timeouts
    (`sla_expired`, `deadline_expired`) are emitted on BOTH `IntentTimeout`
    (→ DB writer, FAILED row) and `SolverTimeout` (→ `drainReputation`, jail).
    They were previously ONE channel with two competing receivers — Go delivers
    each send to exactly one, so jail vs FAILED was a race-steal coin flip.
    Solver-less events (`no_bids`, `won_never_acked`) ride `IntentTimeout`
    only, making "the forfeited winner is not jailed" true by construction.
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
| `VYNX_CHAIN_ID` | yes | Origin chain (8453); selects the pinned USDC domain separator for F1 verification. |
| `VYNX_SETTLEMENT_ADDRESS`, `RELAYER_SIGNER` | yes | Settlement contract; expected signer address. |
| `BASE_RPC_URL` … `POLYGON_RPC_URL` | yes | RPC endpoints. `BASE_RPC_URL` (and `ETH_RPC_URL` when G12 is enabled) must be **ws://** — the IntentLocked / IntentRefunded / SolverSlashed watchers use `eth_subscribe`. The e2e harness exports ws:// anvil URLs accordingly (Sprint 4.1; anvil serves HTTP+WS on one port). |
| `MTLS_SERVER_CERT_PATH`, `MTLS_SERVER_KEY_PATH`, `MTLS_CA_CERT_PATH` | yes | mTLS server identity. |
| `PORT` | no | Public HTTP/WS port (default `8080`). |
| `VYNX_REGISTRY_ADDRESS` | no | Enables the SolverSlashedWatcher (G12). |
| `VYNX_E2E_USDC_DOMAIN_SEPARATOR` | **e2e builds only** | USDC domain-separator override for harness MockUSDC deployments. Compiled in **only** under `-tags e2e` (`usdcsep_e2e.go`); the production binary neither reads nor contains it — the override is impossible to activate in prod. |

**Note:** `TVL_CAP_USDC` is mandatory at boot in every relayer environment. The
`make e2e-local` harness now injects it via `Env()` (`e2e/harness/harness.go`), so
the former "must be ambient" e2e gap is closed; a standalone relayer outside the
harness still needs it set. See [`getting_started.md`](getting_started.md).

See also: [`signer.md`](signer.md), [`watchdog.md`](watchdog.md),
[`architecture.md`](architecture.md), [`onchain_contracts.md`](onchain_contracts.md).
