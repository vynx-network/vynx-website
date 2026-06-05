# Test reference — vynx-e2e

The acceptance suite is **51 `it()` cases across 37 test files** (`tests/*.test.ts`),
verified by the `make e2e` run output. The suite runs serially against a live stack (real
relayer, real watchdog, real contracts on forks, real test solver). There are **no skipped
cases**.

GASLESS REDESIGN (FASE 5): the agent signs ONE EIP-3009 authorization and sends ZERO
transactions; the solver locks/pays/claims (escrow → REDEEMED); a never-settled escrow is
recovered by the PROTOCOL's permissionless `refundIntent`, which the suite calls on-chain
after `warpPastEscrowDeadline` (drift-immune) and asserts REFUNDED + agent made whole. Every
case below describes what the test body actually checks.

> Multi-case files: `minout-boundary` (2), `refund-authorization` (2),
> `multichain-destination` (3), `trust-minimization` (10), `intent-nonce-vector` (2). Every
> other file holds exactly one `it()`.

---

## Core protocol (the original four)

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `happy-path.test.ts` | 3 solvers compete: winner delivers `ExecutionReceipt` | receipt `status='complete'`, `destTxHash`/`trackingRef` hex, `outputAmount > 0`, `executionTimeMs > 0` | A.23, A.24 |
| `no-liquidity.test.ts` | intent with no active solvers rejects with `ERR_SWAP_NO_LIQUIDITY` | zero solvers running → `executeSwap` rejects `ERR_SWAP_NO_LIQUIDITY` | A.24 |
| `refund.test.ts` | locked escrow never settled: capital recovered via the permissionless refund | gasless lock on-chain (`callLockIntent`), `warpPastEscrowDeadline`, keeper `sendRefundIntent` → escrow REFUNDED, agent whole, zero agent txs | A.17 |
| `race-condition.test.ts` | refund and claim are mutually exclusive: one terminal wins, zero funds lost | lock → warp → `refundIntent` (REFUNDED) → a validly-signed `claimFunds` then reverts `InvalidState`; agent whole | A.17 |

## Adapter smoke tests (the original two)

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `adapter-agentkit.test.ts` | AgentKit action provider delivers `ExecutionReceipt` | `createVynxActionProvider().executeSwap` → JSON with hex `destTxHash`, `outputAmount > 0`, `executionTimeMs > 0` | A.24 |
| `adapter-eliza.test.ts` | elizaOS plugin delivers success result | `createVynxPlugin()` first action `handler` → `success: true`, hex `destTxHash` | A.24 |

## Witness destination-payment validation

The witness is the trust anchor: it validates the destination payment's token, recipient,
and amount before the relayer issues a settlement voucher (A.4/A.5).

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `wrong-token-paid.test.ts` | solver pays the wrong ERC20: witness rejects, escrow refunds at deadline | `--wrong-token-address` (real solver locks then mis-pays); witness rejects (`Transfer.from != intent.OutputToken`); `warpPastEscrowDeadline` → `refundIntent` → REFUNDED, real-USDC balance restored | A.4, A.5 |
| `wrong-recipient.test.ts` | solver pays the wrong recipient: witness rejects, intent refunds at deadline | `--pay-recipient`; witness rejects (`Transfer.to != intent.Agent`); warp → refund | A.4 |
| `solver-underpayment.test.ts` | solver pays minOut − 1: witness rejects, intent refunds at deadline | `--underpay-by 1`; witness rejects the `>=` boundary; warp → refund | A.4 |
| `minout-boundary.test.ts` | solver pays exactly MinOutputAmount: witness accepts, intent settles | `--pay-minimum-only`, underpay 0 → settles `complete` | A.4 |
| `minout-boundary.test.ts` | solver pays MinOutputAmount − 1: witness rejects, escrow refunds at deadline | underpay 1 → witness rejects; `warpPastEscrowDeadline` → `refundIntent` → REFUNDED | A.4 |

## Intake hardening (gatekeeper)

Raw-HTTP intents (`fixtures/http-intent.ts`) probe the relayer's intake guards directly,
bypassing SDK-side validation.

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `invalid-signature.test.ts` | relayer returns 401 when recovered signer != intent.Agent | garbage 65-byte signature → HTTP 401 | A.6 (F1) |
| `expired-deadline.test.ts` | relayer returns 400 when `deadline <= now()` | deadline 60 s in the past → HTTP 400 | A.7 (F2) |
| `duplicate-intentid.test.ts` | relayer returns 202 then 409 for the same intentId | first submit → 202, resubmit same id → 409 | A.7 |
| `maximum-intent.test.ts` | relayer returns 400 when inputAmount exceeds `MAX_INTENT_USDC` ($500) | $501 → HTTP 400 `gatekeeper: intent amount above maximum` | A.11 |
| `minimum-intent.test.ts` | intent below minimum is rejected before auction | `amountUSD=10` → client-side `ERR_BELOW_MINIMUM` before the relayer | A.11 |
| `unsupported-destination-chain.test.ts` | relayer returns 400 when destinationChainId is not whitelisted | `destinationChainId=999` → HTTP 400 `gatekeeper: destination chain not whitelisted` | A.13 |
| `tvl-cap.test.ts` | reservation rejects oversubscription and releases on deadline expiry | `--lock-only` solver (dedicated `solver-tvl`) locks A ($50); B ($50) → HTTP 400 `exceeds TVL cap`; warp + on-chain `refundIntent` releases A's reservation (warp contained in a nested snapshot) → C ($50) → HTTP 202 | A.12 |

## Trust-minimization (the thesis)

The agent's single EIP-3009 signature binds all 8 trade terms via the §D2 nonce; no party on
the path can alter the deal.

| File | `it()` | Asserts |
|---|---|---|
| `trust-minimization.test.ts` | each of the 8 signed terms is rejected at intake (F1) | sign valid terms A, submit with ONE term mutated under the A-signature → HTTP 401, for every term (intentId, agent, token, inputAmount, outputToken, minOutputAmount, destinationChainId, deadline); + the untampered intent → 202 |
| `trust-minimization.test.ts` | the on-chain nonce binding holds at the contract | `callLockIntent` with untampered terms → escrow LOCKED (positive control); with a tampered term → reverts (Circle rejects the recomputed §D2 nonce) |
| `intent-nonce-vector.test.ts` | agent-core reproduces the canonical §D2 expectedNonce | `computeIntentNonce(vector terms)` == vendored `expectedNonce`; flipping any term changes it (stackless) |

## Auction mechanics

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `multiple-bids-same-solver.test.ts` | intent settles on first bid; duplicate bid is rejected by auction engine | `--double-bid`; first bid selected, no corruption; settles `complete` | A.8 (F3) |
| `late-bid.test.ts` | a bid after the 200 ms OFA window is dropped; the on-time solvers still settle | `--late-bid` (500 ms); late solver never wins; on-time solver settles | A.16 |
| `concurrent-intents.test.ts` | two concurrent intents both settle independently | two simultaneous `executeSwap` → both `complete` with distinct `destTxHash` | A.24 |
| `all-bids-below-minimum.test.ts` | all solver bids rejected when minOutputAmount exceeds any possible bid | inflated quoter (`minOut` 2× input) → `ERR_SWAP_NO_LIQUIDITY` | A.24 |
| `lock-intent-revert.test.ts` | mid-flow balance drain forces lockIntent revert: intent FAILS, no escrow | submit raw, drain the agent on the winner's `auction_won` → the solver's `lockIntent` reverts (insufficient balance); relayer terminal `FAILED("sla_expired")` via `GET /v1/intent/{id}`; escrow stays UNKNOWN | A.21 |

## Economic exactness & vouchers

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `take-rate-exactness.test.ts` | treasury receives exactly fee; solver nets exactly net − payment; zero leakage | the winner claims its OWN voucher (wait REDEEMED); treasury += `gross*takeRateBps/10000`, claim tx from the winning solver, agent zero txs, net + fee = gross | A.18 |
| `voucher-replay.test.ts` | the solver's own claim redeems; replay reverts InvalidState | winner auto-claims → escrow REDEEMED; a validly re-signed voucher replayed → reverts `InvalidState` | A.19 |
| `voucher-wrong-key.test.ts` | claimFunds reverts when voucher is signed by a non-relayerKey | voucher signed with `WATCHDOG_PK` → `claimFunds` reverts `InvalidVoucherSignature` | A.19 |
| `refund-authorization.test.ts` | refundIntent before the deadline reverts DeadlineNotExpired | simulate `refundIntent` pre-deadline → custom error `DeadlineNotExpired`; intent stays LOCKED | A.17 |
| `refund-authorization.test.ts` | refundIntent on an already-refunded (non-LOCKED) intent reverts InvalidState | `warpPastEscrowDeadline` + keeper `refundIntent` (→REFUNDED), then a `refundIntent` simulate → `InvalidState` | A.17 |

## Emergency controls & collateral

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `pause-mid-flow.test.ts` | pause blocks lockIntent; unpause restores normal flow | pre-pause swap completes; watchdog `pauseAll()` → mid-flow lock reverts `ContractPaused`; multisig `unpauseAll()` → post-unpause swap completes | A.20 |
| `solver-shf-insufficient.test.ts` | undercollateralized solver bid rejected, intent filled by eligible solver | `solver-shf` (not in `solver_health`, highest bid) rejected at SHF gate; eligible solver fills | A.10 |
| `jail-time-sla-breach.test.ts` | winning solver that misses the 10 s commit SLA is jailed and excluded | `--no-fulfill` (win → ack → never lock) → `sla_expired`; jail asserted 3 ways: relayer reputation log + `solver_health.jail_level > 0` (`pg-utils`) + exclusion (`ERR_SWAP_NO_LIQUIDITY`) | A.15, A.21 |

## Slash path (watchdog → L1)

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `slash-path.test.ts` | solver defaults: keeper refunds on-chain and the watchdog executes the L1 slash | gasless lock on-chain; solver spawned only to deposit collateral; `warpPastEscrowDeadline` + keeper `refundIntent` → watchdog observes `IntentRefunded`, executes L1 slash → `SolverSlashed` on the Eth fork | A.1 |
| `slash-distribution.test.ts` | slash routes exactly 5% of input to the agent and 5% to the treasury | `SolverSlashed` carries `slashTotal=10%`, `agentShare=5%`, `treasuryShare=5%`; on-chain balance deltas match emitted shares exactly, zero leakage | A.1, A.2 |
| `watchdog-restart-pending-slash.test.ts` | watchdog killed after slash queued in Redis: restart drains pending slash to L1 | slash queued (`slash:pending` ZADD); kill watchdog before the 5 s tick; restart → executor drains Redis, executes L1 slash | A.1, A.9 |

## Cross-chain settlement (multi-fork)

This suite settles against the live destination forks and is ordered to run **first** (fresh
connection pool) by the `StableSuiteSequencer`; see `docs/architecture.md` §7.

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `multichain-destination.test.ts` | Arbitrum destination (chainId 42161) | solver pays real Arbitrum USDC on the Arbitrum fork; witness validates; receipt `complete` | A.22, A.25 |
| `multichain-destination.test.ts` | Optimism destination (chainId 10) | solver pays real Optimism USDC on the Optimism fork; receipt `complete` | A.22, A.25 |
| `multichain-destination.test.ts` | Polygon destination (chainId 137) | solver pays real Polygon USDC on the Polygon fork; receipt `complete` | A.22, A.25 |

## Process-lifecycle resilience (run last)

These suites kill and restart binaries; the `StableSuiteSequencer` (`vitest.config.ts`)
forces them to run after every other suite. (The same sequencer runs
`multichain-destination` **first**, on a fresh connection pool — see below.)

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `relayer-restart.test.ts` | in-flight intent surfaces a terminal error after relayer restart (F4 minimal) | kill relayer mid-flight, restart; SDK rejects with a terminal error within 10 s, does not hang | A.9 (F4) |
| `solver-disconnect-after-win.test.ts` | winning solver vanishes post-lock: escrow recovered by permissionless refund | gasless lock on-chain (the post-lock-death state), `warpPastEscrowDeadline` + keeper `refundIntent` → escrow REFUNDED, agent whole | A.9 |

---

## Time-warping suites

The refund/slash/witness/tvl suites cross the on-chain deadline via
`warpPastEscrowDeadline(settlement, intentId, rpc)` — it reads `escrow.deadline` ON-CHAIN and
warps to `deadline + buffer`, so it is immune to chain↔wall drift (a wall-based `now()+16min`
under-shot a chain that had run ahead and reverted `refundIntent` with DeadlineNotExpired).
The pure refund/slash/voucher suites lock DIRECTLY on-chain (`callLockIntent`, no relayer
auction → no TVL reservation, no SLA-jail leakage); the witness suites use the real
(mis-paying) solver. `tvl-cap` brackets its warp in a nested snapshot reverted inside the
`it()` (it is the only suite that warps while actively driving the relayer). Every warp is
undone by `revertSnapshot`, which also resets the W8 finality clock and re-anchors the chain
to wall (see `docs/architecture.md` §6 / §3.1 and `docs/fixtures.md`).

## Known gaps (honest)

- **Relayer `TestSlashPath` is `t.Skip`.** In the `vynx-relayer` Go e2e-local harness,
  `TestSlashPath` is skipped because HTTP anvil lacks `eth_subscribe`. The slash mechanism
  is **covered here instead**, end-to-end, by `slash-path.test.ts`,
  `slash-distribution.test.ts`, and `watchdog-restart-pending-slash.test.ts`.
- **Settled escrows reach REDEEMED on-chain** (GASLESS): the winning solver pulls its
  voucher and calls `claimFunds` itself, so `take-rate-exactness`/`voucher-replay` assert the
  REDEEMED escrow's economics; never-settled escrows reach REFUNDED via the protocol's
  permissionless `refundIntent`. (The old "stays LOCKED, no keeper claims" note is obsolete.)
- **`POSTGRES_URL` is now consumed by the HARNESS** (`fixtures/pg-utils.ts`, the jail DB
  assertion), though the relayer's DSN remains hardcoded in `e2e.sh`. See `docs/setup.md`.
- **The SDK's autonomous-refund timing on a warped fork is the SDK's own test responsibility**
  — the e2e proves the PROTOCOL's permissionless refund (`refundIntent` on-chain), not the
  SDK's client-side refund driver (Sprint 5.2 ratified decision ii).
