# Solver — the FASE 4 gasless-lock and redemption integration flow

> How a winning solver acks its `AuctionWonFrame` (Sprint 4.3 — what arms its
> fair SLA clock), executes the gasless lock (Sprint 4.1), and pulls + redeems
> its voucher (Sprint 4.2; signal-driven push-then-pull since 4.3).
> This is the consumer side of the **FASE 3→4 interface contract** produced
> by the relayer ([`relayer.md`](relayer.md) §6). The solver is **not** one
> of the four protocol binaries — it is an external participant; this doc
> specifies the integration contract and points at the reference
> implementations.

---

## 1. The flow at a glance

```
ws /v1/ws (?solver=0x…)
   │
   ├── intent_announced (broadcast) ──→ bid blind on the public terms
   │                                    (NO authorization in this frame)
   ├── auction_won (unicast, winner) ─→ 0. ACK IT: send {"type":"won_ack",
   │      (re-pushed while unacked;          "intentId":…} — this is what arms
   │       GET /v1/won is the pull           the fair 10s SLA clock; a never-
   │       fallback for a lost frame)        acked win is FORFEITED in ~6s
   │                                    1. build Intent from the frame, solver = self
   │                                    2. split the 65-byte authorization → (v, r, s)
   │                                    3. if now ≥ slaExpiry: self-abort (no gas);
   │                                       else ONE lockIntent(intent, auth) on
   │                                       Base, solver pays gas
   │                                    4. lock mined OK → pay the agent
   │                                       ≥ minOutputAmount on the destination chain
   │                                    5. POST /v1/payment-notice (real destTxHash)
   │                                    6. relayer witness verifies → voucher,
   │                                       intent SETTLED
   ├── voucher_ready (unicast, winner) → 7. THE SIGNAL to pull the voucher
   └── GET /v1/voucher/{intentId} ────→ 8. pull on the signal (EIP-191 winner
                                           challenge; bounded fallback poll
                                           covers a lost signal)
                                        9. ONE claimFunds(voucher) on Base →
                                           VoucherRedeemed: net to the solver,
                                           take-rate fee to the treasury
```

The agent signed once, off-chain, for free; **the solver pays all gas** — the
lock on Base, the payment on the destination chain, and the claim on Base.

## 2. Consume the `AuctionWonFrame` — self-contained, no correlation

The unicast `auction_won` frame carries everything needed to build
`VynxSettlement.lockIntent(intent, auth)`. **Do not correlate it with the
earlier `intent_announced` broadcast** — the frame is the contract:

| Frame field | Use |
|---|---|
| `intentId`, `agent`, `token`, `inputAmount`, `outputToken`, `minOutputAmount`, `destinationChainId`, `deadline` | The 8 agent-signed terms → the on-chain `Intent` tuple, 1:1. |
| `authorization` | The agent's 65-byte EIP-3009 signature (`0x`-hex, `r‖s‖v`) → `lockIntent`'s second argument. |
| `winningAmount` | The solver's own winning bid — the destination payment amount. |
| `slaExpiry` | Unix seconds — the relayer's PROVISIONAL lock bound. The authoritative clock arms at YOUR ack (ack-time + 10s ≥ this value), so treat the frame value as the conservative self-abort threshold: if `now ≥ slaExpiry`, skip the lock (§4). Missing the armed clock after acking is jailable (SLA). |

### 2.1 Ack the win — mandatory (Sprint 4.3 arm-on-ack)

On receiving `auction_won`, immediately send `{"type":"won_ack","intentId":"0x…"}`
back over the SAME WebSocket connection. The relayer binds the ack to the
connection's solver identity and **arms the 10s SLA lock clock at ack time** —
the clock does not run while the frame is provably undelivered, so a lost
unicast can never jail you. The ack is idempotent: the relayer re-pushes an
unacked frame (bounded), and every duplicate should simply be re-acked — never
re-dispatch the lock for a duplicate frame (one lock per win). **Incentives:**
never acking forfeits the win in ~6s (re-auctioned to the next-best bid; you
are NOT jailed, but you gained nothing); acking late only risks the forfeit
with zero upside, since you cannot build the lock before having the frame
anyway. Locking without acking still works — the on-chain lock is itself the
strongest proof of receipt — but it races the relayer's forfeit ladder, so a
re-auctioned runner-up may waste a reverted lock attempt. Ack first. Always.

### 2.2 Pull fallback — `GET /v1/won/{intentId}` (lost-frame recovery)

If the win is suspected but the frame never arrived (e.g. a reconnect right
after a win), pull it: the endpoint serves the byte-identical
`AuctionWonFrame` — including the authorization — to the recorded winner ONLY,
and ONLY while the win is live (not yet locked/forfeited/expired). Auth is the
same EIP-191 challenge pattern as the voucher endpoint (§6.1) with the
domain-separated canonical string `vynx-won:{intentId 0x-lowercase}:{unix-seconds}`
and the same three `X-Vynx-*` headers. `404` = not live (or unknown); `403` =
not the winner. A `200` counts as your ack — the SLA clock arms exactly as if
you had sent `won_ack`.

## 3. Build the lock inputs

- **Intent tuple** (9 fields): the 8 frame terms in order, then
  `intent.solver = THIS SOLVER'S OWN ADDRESS`. The solver is the single
  non-signed, post-auction field; the contract enforces
  `msg.sender == intent.solver` and reverts with `SolverMismatchOnLock`
  otherwise — a stolen frame is useless to anyone but the winner under its
  own key.
- **Authorization split**: decode the 65-byte hex; `r = bytes [0,32)`,
  `s = bytes [32,64)`, `v = byte 64`, with `v ∈ {27, 28}` — the
  `(uint8 v, bytes32 r, bytes32 s)` struct the ABI expects.
- Validate strictly before broadcasting: a solver must never send a lock
  built from a frame it could not fully decode.

The contract recomputes the terms-nonce from the calldata Intent and passes
it to `USDC.receiveWithAuthorization` — Circle's audited code verifies the
agent's signature. Any tampered term changes the nonce and the lock reverts:
the intent is cryptographically the agent's, end to end.

## 4. Send the lock — one attempt, solver pays gas

**Self-abort first (Sprint 4.3):** if `now ≥ slaExpiry` (the frame's
provisional bound), do NOT broadcast — the relayer has already moved on
(forfeit/re-auction, or the watchdog's refund sweep) and the lock would only
burn gas. This is a gas/sanity optimization, not a safety gate: the on-chain
deadline + refund remain the real protection. Log and stop; the one-attempt
discipline is unchanged (a skipped attempt is not a retry).

Otherwise send `lockIntent(intent, auth)` on **Base** (the origin chain) from
the solver's own key, within the SLA window (10s from YOUR ack — the frame's
`slaExpiry` is the conservative bound).

**One-lock-per-win discipline (by design):** the solver sends the lock
exactly once and never blind-retries. Failure surface:

| Revert | Meaning |
|---|---|
| `FiatTokenV2: authorization is used or canceled` | The agent's authorization was already consumed (or canceled via `cancelAuthorization`). |
| `FiatTokenV2: authorization is expired` | `block.timestamp ≥ deadline` (the EIP-3009 `validBefore`). |
| USDC pause / blacklist require-strings | Circle compliance gates on the agent or the settlement. |
| `SolverMismatchOnLock` | `msg.sender != intent.solver` — wrong key or stolen frame. |
| `IntentAlreadyExists` | Replay — the intentId already has a non-UNKNOWN escrow state. |
| `TokenNotSupported`, `ZeroAmount`, `ContractPaused` | Protocol gates. |

A failed or late lock is **the solver's own SLA exposure**: the relayer's
tracker armed the 10s clock at YOUR ack (arm-on-ack — you provably had the
frame), and `sla_expired` jails the solver that did not land the lock. With no
escrow there is nothing to refund and nothing to pay — surface the failure and
stop.

## 5. After the lock — destination payment and settlement

Only after the lock mines with status 1:

1. Pay the agent **≥ `minOutputAmount`** of `outputToken` on
   `destinationChainId` (pay `winningAmount` — that was the bid).
2. `POST /v1/payment-notice` with the **real** destination tx hash. The
   relayer accepts the notice for an intent in `MATCHED` **or** `LOCKED`
   state (the lock now precedes the payment; `MATCHED` tolerates
   IntentLocked-watcher latency).
3. The relayer's witness fetches the receipt on the destination chain, waits
   chain-specific finality, validates the ERC20 `Transfer`
   (emitter == `outputToken`, recipient == `agent`, amount ≥
   `minOutputAmount`), signs the EIP-712 voucher, and the intent settles
   (status `SETTLED`).

## 6. Voucher pull + redemption (Sprint 4.2)

### 6.1 Pull — `GET /v1/voucher/{intentId}`, winner-gated

The relayer serves the witness-signed voucher only to the auction winner and
only while the intent is `SETTLED` (signed, not yet redeemed). **Push-then-pull
(Sprint 4.3):** the moment the witness signs, the relayer unicasts a
`voucher_ready` frame (`{"type":"voucher_ready","intentId":…}`) — pull on that
signal (only the relayer's ~100ms cold-path commit separates the signal from a
`200`, so a short 500ms-cadence burst suffices). Register your signal listener
BEFORE posting the payment notice so it cannot be missed. Keep a **bounded
fallback poll** (e.g. every 2s under a generous overall budget) for a lost
signal — the frame is advisory/SendDrop — but the steady state is
signal-driven: destination-chain finality (what the witness actually waits
for) is chain-dependent, and no fixed poll budget models it correctly. That
fixed-budget fragility is exactly what this removes.

**Auth — EIP-191 solver challenge.** Per request, sign the canonical string

```
vynx-voucher:{intentId 0x-lowercase}:{unix-seconds}
```

with the solver's own tx key (`personal_sign` / `accounts.TextHash`) and send:

| Header | Value |
|---|---|
| `X-Vynx-Solver` | The solver's address (must match the recovered signer). |
| `X-Vynx-Timestamp` | The unix seconds used in the challenge — must be within ±60s of the relayer's clock (API freshness bound, not a protocol deadline). |
| `X-Vynx-Signature` | The 65-byte `0x`-hex EIP-191 signature. |

Responses:

| Code | Meaning |
|---|---|
| `200` | The voucher JSON: `{intentId, solver, amount, destTxHash, issuedAt, signature}`. `amount` is the **signed** `minOutputAmount` — never the bid. |
| `404` | Not settled yet (keep polling), already redeemed (archived), or unknown intent. |
| `403` | The recovered signer is not the recorded winner (or stale timestamp / spoofed header) — abort, polling cannot fix it. |

The voucher `signature` is winner-sensitive: the relayer never logs it and a
solver must treat it the same way (handle it as the wire string only).

### 6.2 Redeem — one `claimFunds(voucher)`, solver pays gas

Build the 6-field `Voucher` tuple from the response 1:1. **The served
signature is on-chain-ready since Sprint 4.3** (ratified 4.2-d): the endpoint
serves `v ∈ {27,28}`, so the voucher passes straight into `claimFunds` with no
consumer-side normalization. (The reference consumers keep a defensive
tolerance — add 27 when `v ∈ {0,1}`, reject anything outside `{0,1,27,28}` —
for any producer still serving the witness's raw form.) Send
`claimFunds(voucher)` on **Base** from the solver's own key.

**One-claim-per-win discipline (mirrors the lock):** send exactly once,
never blind-retry. Failure surface:

| Revert | Meaning |
|---|---|
| `InvalidVoucherSignature` | The signature does not recover to `VynxAdmin.relayerKey()` — corrupted voucher or un-normalized `v`. |
| `SolverMismatch` | `voucher.solver != escrow.solver` — not the winner's voucher. |
| `InvalidState` | The escrow is not `LOCKED` — already redeemed, or refunded after deadline expiry. Terminal on-chain truth; retrying cannot change it. |
| `ContractPaused` | Protocol circuit breaker. |

On success `VoucherRedeemed(intentId, solver, netAmount, fee)` fires: the
solver receives the escrowed input USDC net of the take-rate
(`fee = amount · takeRateBps / 10_000`, capped at 20 bps) and the treasury
receives the fee. The relayer's `VoucherRedeemedWatcher` archives the intent,
which also closes voucher delivery (the endpoint 404s from then on).

## 7. Reference implementations

| Where | What |
|---|---|
| `vynx-e2e/solver/main.go` (sibling repo) | The real solver process the E2E orchestrator spawns (×3, competing strategies). The read loop acks every `auction_won` (§2.1, dedup via a per-intent once-map) and routes `voucher_ready` to the per-intent puller; `lockThenFulfill` implements §2–§5 with the slaExpiry self-abort first; `pullAndClaim` implements §6 signal-driven (bounded fallback poll). All WS writes are serialized through one mutex-guarded helper. Requires `VYNX_SETTLEMENT_ADDRESS` in its environment. |
| `e2e/solverkit/` (this repo) | The canonical, unit-tested consumer: `ParseAuctionWonFrame` / `BuildLockInputs` / `SplitAuthorization` (lock), `WonAckFrame` / `WonChallenge` / `SignWonChallenge` / `ParseVoucherReadyFrame` (Sprint 4.3 delivery resilience), and `SignVoucherChallenge` / `ParseVoucher` / `BuildClaimInputs` (redemption) against the real `bindings/settlement` types. Used by the e2e happy path's in-test solver, which acks, exercises `GET /v1/won`, executes the lock AND the signal-driven claim for real against the harness-deployed `VynxSettlement` + EIP-3009 MockUSDC. |

Both implementations are intentionally mirror images (the vynx-e2e solver is
its own Go module and cannot import this repo); if the frame contract, the
`won_ack`/`voucher_ready` frames, the voucher response shape, or either
challenge string changes, change `internal/relayer/api/ws/push.go` +
`internal/relayer/api/ws/handler.go` + `internal/relayer/api/http/voucher.go`
+ `internal/relayer/api/http/won.go`, `e2e/solverkit`, and
`vynx-e2e/solver/main.go` together.

See also: [`architecture.md`](architecture.md) §2 (the lifecycle),
[`relayer.md`](relayer.md) §6 (the producer side of the frame),
[`onchain_contracts.md`](onchain_contracts.md) §2 (`lockIntent` ABI).
