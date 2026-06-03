# Test reference — vynx-e2e

The acceptance suite is **39 `it()` cases across 35 test files** (`tests/*.test.ts`),
verified by the `make e2e` run output. The suite runs serially against a live stack (real
relayer, real watchdog, real contracts on forks, real test solver). There are **no skipped
cases**.

The "BLINDAJE" column references the canonical change catalog in
`reports/12-PHASE5-DELTA.md` (`A.1`–`A.26`). Every case below was read from source; the
asserted property describes what the test body actually checks.

> Multi-case files: `minout-boundary` (2), `refund-authorization` (2),
> `multichain-destination` (3). Every other file holds exactly one `it()`.

---

## Core protocol (the original four)

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `happy-path.test.ts` | 3 solvers compete: winner delivers `ExecutionReceipt` | receipt `status='complete'`, `destTxHash`/`trackingRef` hex, `outputAmount > 0`, `executionTimeMs > 0` | A.23, A.24 |
| `no-liquidity.test.ts` | intent with no active solvers rejects with `ERR_SWAP_NO_LIQUIDITY` | zero solvers running → `executeSwap` rejects `ERR_SWAP_NO_LIQUIDITY` | A.24 |
| `refund.test.ts` | solver wins but never pays: capital recovered via automatic refund | `--no-fulfill`, warp +16 min, SDK throws `ERR_SWAP_TIMEOUT` with `refundTxHash`, agent balance restored | A.17 |
| `race-condition.test.ts` | solver claims while SDK attempts refund: one wins, zero funds lost | `--no-fulfill`, warp +16 min with refund poller active; exactly one of (solver win, SDK refund); agent balance unchanged | A.17 |

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
| `wrong-token-paid.test.ts` | solver pays the wrong ERC20: witness rejects, intent refunds at deadline | `--wrong-token-address`; witness rejects (`Transfer.from != intent.OutputToken`); warp → `ERR_SWAP_TIMEOUT`, balance restored | A.4, A.5 |
| `wrong-recipient.test.ts` | solver pays the wrong recipient: witness rejects, intent refunds at deadline | `--pay-recipient`; witness rejects (`Transfer.to != intent.Agent`); warp → refund | A.4 |
| `solver-underpayment.test.ts` | solver pays minOut − 1: witness rejects, intent refunds at deadline | `--underpay-by 1`; witness rejects the `>=` boundary; warp → refund | A.4 |
| `minout-boundary.test.ts` | solver pays exactly MinOutputAmount: witness accepts, intent settles | `--pay-minimum-only`, underpay 0 → settles `complete` | A.4 |
| `minout-boundary.test.ts` | solver pays MinOutputAmount − 1: witness rejects, intent refunds at deadline | underpay 1 → witness rejects; warp → `ERR_SWAP_TIMEOUT` | A.4 |

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
| `tvl-cap.test.ts` | reservation rejects oversubscription and releases on deadline expiry | A locks $50; B ($50) → HTTP 400 `exceeds TVL cap`; warp past A's deadline → reservation released → C ($50) → HTTP 202 | A.12 |

## Auction mechanics

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `multiple-bids-same-solver.test.ts` | intent settles on first bid; duplicate bid is rejected by auction engine | `--double-bid`; first bid selected, no corruption; settles `complete` | A.8 (F3) |
| `late-bid.test.ts` | a bid after the 200 ms OFA window is dropped; the on-time solvers still settle | `--late-bid` (500 ms); late solver never wins; on-time solver settles | A.16 |
| `concurrent-intents.test.ts` | two concurrent intents both settle independently | two simultaneous `executeSwap` → both `complete` with distinct `destTxHash` | A.24 |
| `all-bids-below-minimum.test.ts` | all solver bids rejected when minOutputAmount exceeds any possible bid | inflated quoter (`minOut` 2× input) → `ERR_SWAP_NO_LIQUIDITY` | A.24 |
| `lock-intent-revert.test.ts` | mid-flow allowance reset forces lockIntent revert: SDK throws without hanging | `resetUsdcAllowance` between approve and lock → `lockIntent` reverts; SDK throws, no hang | A.21 |

## Economic exactness & vouchers

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `take-rate-exactness.test.ts` | treasury receives exactly fee; solver receives exactly net; zero leakage | read still-LOCKED escrow, `fee = gross * takeRateBps / 10000`, `claimFunds`; treasury += fee, solver += gross − fee, net + fee = gross | A.18 |
| `voucher-replay.test.ts` | first claimFunds succeeds; replay reverts InvalidState | locally re-sign voucher with relayer key; 1st `claimFunds` LOCKED→REDEEMED; 2nd reverts `InvalidState` | A.19 |
| `voucher-wrong-key.test.ts` | claimFunds reverts when voucher is signed by a non-relayerKey | voucher signed with `WATCHDOG_PK` → `claimFunds` reverts `InvalidVoucherSignature` | A.19 |
| `refund-authorization.test.ts` | refundIntent before the deadline reverts DeadlineNotExpired | simulate `refundIntent` pre-deadline → custom error `DeadlineNotExpired`; intent stays LOCKED | A.17 |
| `refund-authorization.test.ts` | refundIntent on an already-refunded (non-LOCKED) intent reverts InvalidState | warp, SDK refunds (→REFUNDED), 2nd `refundIntent` simulate → `InvalidState` | A.17 |

## Emergency controls & collateral

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `pause-mid-flow.test.ts` | pause blocks lockIntent; unpause restores normal flow | pre-pause swap completes; watchdog `pauseAll()` → mid-flow lock reverts `ContractPaused`; multisig `unpauseAll()` → post-unpause swap completes | A.20 |
| `solver-shf-insufficient.test.ts` | undercollateralized solver bid rejected, intent filled by eligible solver | `solver-shf` (not in `solver_health`, highest bid) rejected at SHF gate; eligible solver fills | A.10 |
| `jail-time-sla-breach.test.ts` | winning solver that misses the 10 s commit SLA is jailed and excluded | `VYNX_TEST_SKIP_LOCK` → SDK `ERR_INTERNAL`; relayer jails solver; next swap → `ERR_SWAP_NO_LIQUIDITY` | A.15, A.21 |

## Slash path (watchdog → L1)

| File | `it()` | Asserts | BLINDAJE |
|---|---|---|---|
| `slash-path.test.ts` | solver defaults: SDK refunds and the watchdog executes the L1 slash | no-pay → SDK refunds at deadline → watchdog observes `IntentRefunded`, executes L1 slash → `SolverSlashed` on the Eth fork | A.1 |
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
| `solver-disconnect-after-win.test.ts` | solver process killed post-lock: deadline-based refund; SDK does not hang | solver wins + lock confirmed, then killed; warp +16 min → `ERR_SWAP_TIMEOUT` with `refundTxHash`; balance restored | A.9 |

---

## Time-warping suites

Twelve suites warp Base anvil +16 min (`setNextBlockTimestamp` + `mineBlock`) to cross the
on-chain deadline: `refund`, `race-condition`, `solver-disconnect-after-win`,
`solver-underpayment`, `wrong-token-paid`, `wrong-recipient`, `minout-boundary`,
`refund-authorization`, `tvl-cap`, `slash-path`, `slash-distribution`,
`watchdog-restart-pending-slash`. Every one relies on `revertSnapshot` resetting the W8
finality clock afterward (see `docs/architecture.md` §6 and `docs/fixtures.md`).

## Known gaps (honest)

- **Relayer `TestSlashPath` is `t.Skip`.** In the `vynx-relayer` Go e2e-local harness,
  `TestSlashPath` is skipped because HTTP anvil lacks `eth_subscribe`. The slash mechanism
  is **covered here instead**, end-to-end, by `slash-path.test.ts`,
  `slash-distribution.test.ts`, and `watchdog-restart-pending-slash.test.ts`.
- **Settled escrows stay LOCKED on-chain.** No keeper binary runs in e2e, so `claimFunds`
  is not called on-chain during normal settlement; settlement is a relayer DB state change.
  `take-rate-exactness` and the voucher tests deliberately read/claim the still-LOCKED
  escrow to assert the on-chain math. See `docs/architecture.md` §2.
- **`POSTGRES_URL` is not consumed by the suite** — the relayer DSN is hardcoded in
  `e2e.sh`. See `docs/setup.md`.
