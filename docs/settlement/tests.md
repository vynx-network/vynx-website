# VynX Settlement V1 — Test Suite Reference

The protocol ships with **161 Foundry test functions**:

- **156 fork-based** functions (unit + integration + fuzz) that run against live Base Mainnet
  and Ethereum Mainnet forks. `make test` runs this set: **156 passed / 0 failed**.
- **5 fork-free stateful invariants** that make zero RPC calls.
  `forge test --match-path "test/invariant/*"` runs in roughly 1.2 seconds with no network
  access.

Coverage is **100% function coverage** (50/50 functions) and **98.36% line coverage**
(299/304 lines) across `src/`, reproduced via `make coverage` (which runs
`forge coverage --ir-minimum`). The few uncovered lines are hard-to-reach defensive guards.

---

## 1. Per-File Breakdown

| File | Functions | Type |
| --- | --- | --- |
| `test/unit/VynxAdmin.t.sol` | 30 | Unit (fork) |
| `test/unit/VynxSettlement.t.sol` | 27 | Unit (fork) |
| `test/unit/DirectVaultAdapter.t.sol` | 21 | Unit (fork) |
| `test/unit/StakingRewards.t.sol` | 20 | Unit (fork) |
| `test/unit/VynxRegistry.t.sol` | 19 | Unit (fork) |
| `test/unit/VynxTreasury.t.sol` | 19 | Unit (fork) |
| `test/unit/VynxToken.t.sol` | 10 | Unit (fork) |
| `test/integration/FullFlow.t.sol` | 5 | Integration (fork) |
| `test/fuzz/Fuzz.t.sol` | 5 | Fuzz (fork) |
| `test/invariant/Invariants.t.sol` | 5 | Invariant (fork-free) |
| **Total** | **161** | |

The 156 fork-based functions are the seven unit suites (146) + integration (5) + fuzz (5). The
5 invariants are fork-free.

---

## 2. Testing Philosophy — No Protocol Mocks

The suite forbids mocking protocol contracts. The fork-based suites deploy the real VynX
bytecode and use real mainnet token bytecode (USDC on Base, USDC/WETH/wstETH on Ethereum),
funding actors with Foundry's `deal(...)` cheatcode rather than fabricated token stubs. This
guarantees the tests exercise the exact ERC-20 semantics the protocol will meet in production.

The single sanctioned local token, `test/invariant/MockERC20.sol`, is a plain 6-decimal ERC-20
used **only** by the fork-free invariant suite (see Section 5). It is a standard token, not a
protocol mock — no VynX contract is ever mocked.

---

## 3. Unit Suites (fork-based)

Each contract has an isolated unit suite covering happy paths, every revert branch, and access
control.

- **VynxAdmin (30)** — `initialize` state and all four zero-address / invalid-take-rate /
  already-initialized reverts; `pauseAll` / `unpauseAll` happy paths plus unauthorized and
  already-paused / not-paused reverts; `setRelayerKey`, `setTakeRate` (including zero bps),
  `setMultisig`, `setContractAddresses` (each with unauthorized and zero-address reverts);
  `upgradeTo` happy + unauthorized; the `MAX_TAKE_RATE` constant.
- **VynxSettlement (27)** — `lockIntent` happy + paused / already-exists / invalid-signature;
  `claimFunds` with fee, zero-fee (no treasury call), max fee, paused, UNKNOWN state, replay,
  refunded state, solver mismatch, invalid voucher signature; `refundIntent` happy + not-found /
  redeemed / refunded / deadline-not-expired; `syncConfig` and `setPaused` authorisation; and a
  dedicated attack group: replay blocked, voucher forgery, relayer-key rotation liveness, and
  cross-chain replay.
- **DirectVaultAdapter (21)** — constructor wiring and zero-address reverts; `deposit`
  (single + accumulating + zero-amount revert); `withdraw` (full / partial / zero / insufficient
  / no-deposit); `slash` (happy / full amount / not-registry / zero / insufficient / no-deposit /
  transfers-to-registry-and-withdraw-independence); `getCollateral` and `totalCustody` views.
- **StakingRewards (20)** — `stake` happy + paused + zero; `withdraw` happy + not-blocked-by-pause
  + zero + insufficient; `getReward` happy + no-op-if-zero; `exit`; `notifyRewardAmount` new
  period + rollover + only-rewards-distribution; `rewardPerToken` monotonicity; `earned`
  accuracy and proportional split; `lastTimeRewardApplicable` before / after period; `setPaused`
  toggle + unauthorized.
- **VynxRegistry (19)** — `registerSolver` happy + already-registered + adapter-not-found +
  collateral-not-whitelisted; `deregisterSolver` happy + not-found + cannot-re-register;
  `executeSlash` happy + split-and-dust + no-keeper-role + solver-inactive +
  insufficient-collateral; `setSHFThreshold` and `setAdapter` admin-role + access-control;
  `getSolverCollateral`; `getSHF` eligible / ineligible.
- **VynxTreasury (19)** — `receiveTakeRate` round numbers + remainder-no-dust + no-leakage
  invariant + only-settlement + zero-amount; `distributeRealYield` keeper / admin / unauthorized
  / zero-amount; `sweepForBuyback` full / partial / unauthorized / insufficient-balance;
  `batchCompensate` batch / single / only-keeper / array-length-mismatch; `setPaused` admin +
  unauthorized.
- **VynxToken (10)** — constructor name / symbol / owner / decimals / zero total supply; `mint`
  happy + accumulating + unauthorized; ERC-20 `transfer`; EIP-2612 `permit`.

---

## 4. Integration Suite — `test/integration/FullFlow.t.sol` (5, fork-based)

End-to-end validation of the complete L2 accounting loop on a pinned Base Mainnet fork, using
the real circular-dependency deployment resolved via `computeCreateAddress`:

- `test_fullFlow_completeLoop` — stake → lockIntent → claimFunds → treasury 40/50/10 split →
  distributeRealYield → 7-day warp → staker `getReward`, asserting net/fee, the no-leakage split,
  positive reward rate, accrued yield within 1 wei, and no double-claim.
- `test_fullFlow_refundPath` — expired intent returns the full escrow to the agent.
- `test_fullFlow_pausePropagation` — watchdog `pauseAll` blocks `lockIntent`; multisig
  `unpauseAll` restores it.
- `test_fullFlow_buybackSweep` — fees accumulate, multisig sweeps the buyback bucket to itself.
- `test_fullFlow_mixedSettlement` — two intents, one claimed and one refunded; treasury
  accounting reflects only the claimed fee.

---

## 5. Fuzz Suite — `test/fuzz/Fuzz.t.sol` (5, fork-based)

Property-based tests on a pinned Base Mainnet fork. The properties are:

- `testFuzz_lockIntent` — a valid relayer-signed EIP-712 intent with a bounded USDC amount and
  arbitrary nonce always succeeds and writes a correct LOCKED escrow record.
- `testFuzz_claimFunds_wrongSigner` — any private key other than the relayer key always causes
  `claimFunds` to revert `InvalidVoucherSignature`, exercising the full ECDSA wrong-signer space.
- `testFuzz_refundIntent_timestamps` — refund reverts `DeadlineNotExpired` iff
  `block.timestamp <= deadline`, and succeeds (transition to REFUNDED, full return to agent)
  strictly after.
- `testFuzz_staking_math` — `earned()` never panics, never exceeds the distributed reward, and a
  single staker captures `rewardRate * rewardsDuration` within the documented precision
  tolerance.
- `testFuzz_treasury_split` — `toYield + toBuyback + toPol == amount` for any fee in
  `[1, 100M USDC]` (zero leakage), with the 40/50/10 ratios within 1 wei.

---

## 6. Invariant Suite — `test/invariant/Invariants.t.sol` (5, fork-free)

Stateful invariants driven by `test/invariant/Handler.sol`. The Foundry fuzzer randomly calls
Handler functions (`lockIntent`, `claimFunds`, `refundIntent`, `stake`, `withdraw`,
`distributeYield`, `syncConfig`); after each call every `invariant_*` assertion is re-checked
against ghost variables.

The five invariants:

1. **Settlement Solvency** — `invariant_settlementSolvency`: the USDC balance of Settlement is
   always at least `ghost_lockedBalance` (the sum of all LOCKED escrow amounts).
2. **State-Machine Finality** — `invariant_stateMachineFinality`: every intent the handler
   finalized (REDEEMED or REFUNDED) still holds its recorded terminal state on-chain.
3. **Treasury Revenue Integrity** — `invariant_treasuryRevenueIntegrity`: yield + buyback + POL
   accumulators + total distributed yield equals total fees received (no leakage).
4. **StakingRewards Supply Conservation** — `invariant_stakingSupplyConservation`: the $VYNX
   balance of StakingRewards equals `ghost_totalStaked` (the net staked amount).
5. **EIP-712 TypeHash Immutability** — `invariant_typehashImmutability`: `INTENT_TYPEHASH` and
   `VOUCHER_TYPEHASH` still equal their canonical `keccak256` definitions and never mutate.

---

## 7. Fork-Free Invariant Design (`vm.etch`)

The invariant suite is fork-free by design. In `setUp`, a local standard 6-decimal ERC-20
(`MockERC20`) is deployed and its runtime code is placed at the canonical USDC address via
`vm.etch(USDC, address(localUsdc).code)`. The fuzzer therefore makes **zero RPC calls** during
its heavy, concurrent state access — eliminating provider rate-limiting and making the campaign
fully deterministic for a given seed. Real-USDC behaviour remains covered by the forking unit and
integration suites. The token is etched before nonce capture so the
`computeCreateAddress` offset pre-computation stays valid.

---

## 8. Tooling and Configuration

### Makefile targets

| Target | Action |
| --- | --- |
| `make build` | `forge build`. |
| `make test` | Unit + integration + fuzz, excluding invariants (`--no-match-path "test/invariant/*"`). |
| `make test-unit` | Unit suites against the Base fork. |
| `make test-fuzz` | Fuzz suite against the Base fork (1024 runs). |
| `make test-invariants` | Fork-free invariant campaign. |
| `make coverage` | Coverage summary via `forge coverage --ir-minimum`, excluding the invariant path. |
| `make slither` | Static analysis, filtering `lib/`. |

### foundry.toml

- `solc_version = "0.8.35"`; `optimizer = true`, `optimizer_runs = 500`, `via_ir = true`.
- `fuzz = { runs = 256 }`.
- `invariant = { runs = 256, depth = 15 }`.
- `no_match_coverage = "script|test"` focuses coverage on `src/`.

(The fuzz suite is run at 1024 runs via the `make test-fuzz` flag, overriding the 256 default.)
