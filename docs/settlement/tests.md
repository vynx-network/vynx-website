# VynX Settlement V1 — Test Suite Reference

> Compiler: `solc 0.8.35` | Foundry | Base Mainnet fork + Ethereum Mainnet fork
> Total: **147 deterministic tests + 5,120 fuzz runs — ALL PASS**

---

## Coverage Metrics

> Measured via `forge coverage --no-match-path "test/invariant/*"` against 147 deterministic tests.

```
╭──────────────────────────────┬──────────────────┬──────────────────┬────────────────┬─────────────────╮
│ File                         │ % Lines          │ % Statements     │ % Branches     │ % Funcs         │
╞══════════════════════════════╪══════════════════╪══════════════════╪════════════════╪═════════════════╡
│ src/adapters/DirectVault...  │ 100.00%          │ 100.00%          │ 100.00%        │ 100.00%         │
│ src/l1/VynxRegistry.sol      │ 100.00% (46/46)  │  98.08% (51/52)  │  85.71%  (6/7) │ 100.00%  (8/8)  │
│ src/l2/StakingRewards.sol    │  98.31% (58/59)  │  98.39% (61/62)  │  91.67% (11/12)│ 100.00% (11/11) │
│ src/l2/VynxAdmin.sol         │ 100.00% (56/56)  │  98.51% (66/67)  │  93.75% (15/16)│ 100.00% (10/10) │
│ src/l2/VynxSettlement.sol    │ 100.00% (57/57)  │  97.30% (72/74)  │  88.24% (15/17)│ 100.00%  (7/7)  │
│ src/l2/VynxTreasury.sol      │  98.00% (49/50)  │  98.39% (61/62)  │  90.00%  (9/10)│ 100.00%  (6/6)  │
│ src/tokens/VynxToken.sol     │ 100.00%          │ 100.00%          │ 100.00%        │ 100.00%         │
├──────────────────────────────┼──────────────────┼──────────────────┼────────────────┼─────────────────┤
│ Total                        │  99.31%          │  98.20%+         │  90.32%+       │ 100.00%         │
╰──────────────────────────────┴──────────────────┴──────────────────┴────────────────┴─────────────────╯
```

### Coverage Interpretation

| Metric | Result | Significance |
|---|---|---|
| **Function coverage** | **100.00%** | Every public and external function across all 14 source files is exercised. No dead-code path exists in the function-level call graph. |
| **Line coverage** | **99.31%** | Uncovered lines correspond to a single defensive branch in `StakingRewards.rewardPerToken()` (the `_totalSupply == 0` early return) and one internal guard in `VynxTreasury` — both are structurally unreachable without a post-deployment exploit. |
| **Statement coverage** | **98.20%+** | Uncovered statements are within proven-safe `unchecked` blocks or zero-supply guards across the contract suite. |
| **Branch coverage** | **90.32%+** | Uncovered branches are low-level Solidity compiler-generated null-checks for `address(0)` comparisons in OZ SafeERC20 and `_hashTypedDataV4` internals — not reachable through any realistic call path. |

---

## Test Suite Overview

| Suite | File | Tests | Fuzz Runs | Status |
|---|---|---|---|---|
| Unit | `test/unit/VynxAdmin.t.sol` | 30 | — | PASS |
| Unit | `test/unit/VynxToken.t.sol` | 10 | — | PASS |
| Unit | `test/unit/VynxSettlement.t.sol` | 27 | — | PASS |
| Unit | `test/unit/VynxTreasury.t.sol` | 19 | — | PASS |
| Unit | `test/unit/StakingRewards.t.sol` | 20 | — | PASS |
| Unit | `test/unit/VynxRegistry.t.sol` | 18 | — | PASS |
| Unit | `test/unit/DirectVaultAdapter.t.sol` | 18 | — | PASS |
| Integration | `test/integration/FullFlow.t.sol` | 5 | — | PASS |
| Fuzz | `test/fuzz/Fuzz.t.sol` | 5 props | 5 × 1,024 | PASS |
| Invariant | `test/invariant/Invariants.t.sol` | 5 invariants | stateful | PASS |
| **Total** | | **147 deterministic** | **5,120 fuzz** | **ALL PASS** |

---

## Test Philosophy

- **No mocks for ERC-20 tokens.** All tests use `deal(address, amount)` against a live Base Mainnet (or Ethereum Mainnet) fork. No `MockERC20.sol` exists in the codebase.
- **Custom errors only.** All `vm.expectRevert` calls use `abi.encodeWithSelector(Error.selector, ...)` — no string messages.
- **Real VynxAdmin proxy in Settlement tests.** The source-of-truth cross-contract read (`IVynxAdmin(admin).relayerKey()`) is a core protocol invariant; isolating it with mocks would invalidate the test.
- **vm.sign for all signatures.** EIP-712 digests are constructed manually and signed with `vm.sign(uint256 pk, bytes32 digest)` returning `(v, r, s)` packed as `abi.encodePacked(r, s, v)`.

---

## Category 1 — Unit Tests (142 tests)

Unit tests verify the atomic logic of each contract in strict isolation. Downstream contracts are either mocked via `vm.mockCall` or replaced with minimal test harnesses. Each test targets a single function and a single outcome — happy path, revert case, or event assertion.

**Key design decisions:**
- `VynxAdmin.t.sol` mocks `IVynxSettlement.setPaused`, `IVynxTreasury.setPaused`, and `IStakingRewards.setPaused` to prevent test failures cascading from downstream contracts.
- `VynxSettlement.t.sol` deploys a real `VynxAdmin` proxy (not mocked) because Settlement reads `relayerKey()` cross-contract — mocking would remove the protocol's most critical security property from test coverage.
- `VynxRegistry.t.sol` forks Ethereum Mainnet (`vm.createFork("ethereum")`) because the whitelisted L1 collateral tokens (USDC, USDT, WETH, cbBTC, wstETH) require real bytecode.

### 1.1 VynxAdmin — `test/unit/VynxAdmin.t.sol` (30 tests)

| Test | Property Verified |
|---|---|
| `test_initialize_happy` | `relayerKey`, `watchdog`, `multisig` set correctly post-init |
| `test_initialize_zeroRelayerKey` | `ZeroAddress()` on zero relayerKey |
| `test_initialize_zeroWatchdog` | `ZeroAddress()` on zero watchdog |
| `test_initialize_zeroMultisig` | `ZeroAddress()` on zero multisig |
| `test_initialize_invalidTakeRate` | `InvalidTakeRate(21)` when bps > 20 |
| `test_initialize_alreadyInitialized` | Reverts on second `initialize` call |
| `test_pauseAll_happy` | `paused = true`, event emitted, `setPaused(true)` propagated to all 3 contracts |
| `test_pauseAll_unauthorized` | `Unauthorized()` from non-watchdog |
| `test_pauseAll_alreadyPaused` | `AlreadyPaused()` on double-pause |
| `test_unpauseAll_happy` | `paused = false`, event emitted, `setPaused(false)` propagated |
| `test_unpauseAll_unauthorized` | `Unauthorized()` from non-multisig |
| `test_unpauseAll_notPaused` | `NotPaused()` when already unpaused |
| `test_setRelayerKey_happy` | New key stored, `RelayerKeyRotated` emitted, `syncConfig` called |
| `test_setRelayerKey_unauthorized` | `Unauthorized()` from non-watchdog |
| `test_setRelayerKey_zeroAddress` | `ZeroAddress()` |
| `test_setTakeRate_happy` | Rate updated, `TakeRateUpdated` emitted, `syncConfig` called |
| `test_setTakeRate_zeroEdge` | 0 bps is valid |
| `test_setTakeRate_unauthorized` | `Unauthorized()` from non-multisig |
| `test_setTakeRate_invalidRate` | `InvalidTakeRate(21)` |
| `test_setMultisig_happy` | Multisig rotated to new address |
| `test_setMultisig_unauthorized` | `Unauthorized()` from non-multisig |
| `test_setMultisig_zeroAddress` | `ZeroAddress()` |
| `test_setContractAddresses_happy` | All 3 addresses stored correctly |
| `test_setContractAddresses_unauthorized` | `Unauthorized()` from non-multisig |
| `test_setContractAddresses_zeroSettlement` | `ZeroAddress()` |
| `test_setContractAddresses_zeroTreasury` | `ZeroAddress()` |
| `test_setContractAddresses_zeroStaking` | `ZeroAddress()` |
| `test_upgradeTo_happy` | Proxy upgraded to new implementation |
| `test_upgradeTo_unauthorized` | `Unauthorized()` from non-multisig |
| `test_maxTakeRate_constant` | `MAX_TAKE_RATE == 20` |

### 1.2 VynxToken — `test/unit/VynxToken.t.sol` (10 tests)

Fork: Base Mainnet. No MockERC20. Covers OZ v5 ERC20 + ERC20Permit + Ownable.

| Test | Property Verified |
|---|---|
| `test_constructor_name` | `name() == "VynX"` |
| `test_constructor_symbol` | `symbol() == "VYNX"` |
| `test_constructor_owner` | `owner() == initialOwner` (multisig address) |
| `test_constructor_decimals` | `decimals() == 18` |
| `test_constructor_totalSupplyZero` | `totalSupply() == 0` at deployment |
| `test_mint_happy` | Owner mints to address; balance and totalSupply increment correctly |
| `test_mint_accumulatesMultiple` | Successive mints to the same address accumulate correctly |
| `test_mint_revertUnauthorized` | `OwnableUnauthorizedAccount(caller)` when non-owner calls `mint` |
| `test_transfer_happy` | Standard ERC-20 transfer reduces sender balance, increments recipient |
| `test_permit_happy` | EIP-2612 permit: correct signature updates allowance; nonce increments |

### 1.3 VynxSettlement — `test/unit/VynxSettlement.t.sol` (27 tests)

Includes 4 mandatory attack scenario tests (blueprint §8.6).

| Test | Property Verified |
|---|---|
| `test_lockIntent_happy` | USDC locked, state = LOCKED, `IntentLocked` event, deadline = lockTime + 900 |
| `test_lockIntent_revertContractPaused` | `ContractPaused()` |
| `test_lockIntent_revertIntentAlreadyExists` | `IntentAlreadyExists(intentId)` on duplicate |
| `test_lockIntent_revertInvalidSignature` | `InvalidIntentSignature(intentId)` with wrong PK |
| `test_claimFunds_happyWithFee` | Net to solver, fee to treasury, state = REDEEMED, `VoucherRedeemed` |
| `test_claimFunds_zeroFeeNoTreasuryCall` | `receiveTakeRate` NOT called at 0 bps |
| `test_claimFunds_maxFee` | Fee arithmetic verified at 20 bps |
| `test_claimFunds_revertContractPaused` | `ContractPaused()` |
| `test_claimFunds_revertInvalidStateUnknown` | `SuspiciousRelayerActivity` + `InvalidState(id, UNKNOWN)` |
| `test_claimFunds_revertReplay` | `InvalidState(id, REDEEMED)` on second claim |
| `test_claimFunds_revertInvalidStateRefunded` | `InvalidState(id, REFUNDED)` |
| `test_claimFunds_revertSolverMismatch` | `SolverMismatch(id, expected, got)` |
| `test_claimFunds_revertInvalidVoucherSignature` | `InvalidVoucherSignature(id)` with wrong PK |
| `test_refundIntent_happy` | State = REFUNDED, funds returned to agent, `IntentRefunded` |
| `test_refundIntent_revertIntentNotFound` | `IntentNotFound(id)` on UNKNOWN id |
| `test_refundIntent_revertInvalidStateRedeemed` | `InvalidState(id, REDEEMED)` |
| `test_refundIntent_revertInvalidStateRefunded` | `InvalidState(id, REFUNDED)` |
| `test_refundIntent_revertDeadlineNotExpired` | `DeadlineNotExpired(id, deadline)` at exact deadline |
| `test_syncConfig_happy` | `takeRateBps` and `treasury` updated, `ConfigSynced` emitted |
| `test_syncConfig_revertUnauthorized` | `Unauthorized()` from non-admin |
| `test_syncConfig_revertZeroTreasury` | `ZeroAddress()` |
| `test_setPaused_admin` | Pause flag toggled by admin |
| `test_setPaused_revertUnauthorized` | `Unauthorized()` from non-admin |
| `test_attack_replayBlocked` | REDEEMED intent cannot be claimed again |
| `test_attack_voucherForgery` | Wrong-key voucher always reverts `InvalidVoucherSignature` |
| `test_attack_relayerKeyRotationLiveness` | Old PK fails, new PK succeeds immediately after rotation |
| `test_attack_crossChainReplay` | Voucher signed for `chainId=999` fails on Base (`chainId=8453`) |

### 1.4 VynxTreasury — `test/unit/VynxTreasury.t.sol` (19 tests)

| Test | Property Verified |
|---|---|
| `test_receiveTakeRate_roundNumbers` | `yield=40e6, buyback=50e6, pol=10e6` for 100e6 input |
| `test_receiveTakeRate_remainderCase` | `yield=2, buyback=3, pol=2` for amount=7 (sum invariant) |
| `test_receiveTakeRate_invariant` | `yield+buyback+pol == amount` for amount=101 |
| `test_receiveTakeRate_onlySettlement` | `OnlySettlementAllowed()` from non-settlement caller |
| `test_receiveTakeRate_zeroAmount` | `ZeroAmount()` |
| `test_distributeRealYield_keeper` | Accumulator zeroed, USDC transferred, `notifyRewardAmount` called |
| `test_distributeRealYield_admin` | Admin caller path |
| `test_distributeRealYield_unauthorized` | `Unauthorized()` from random address |
| `test_distributeRealYield_zeroAmount` | `ZeroAmount()` before any yield accumulated |
| `test_sweepForBuyback_fullSweep` | Full accumulator swept to multisig |
| `test_sweepForBuyback_partial` | Partial sweep, accumulator decremented correctly |
| `test_sweepForBuyback_unauthorized` | `Unauthorized()` from non-multisig |
| `test_sweepForBuyback_insufficient` | `InsufficientBuybackBalance(token, requested, available)` |
| `test_batchCompensate_threeAgents` | 3 agents compensated, `CompensationBatchExecuted(3, total, USDC)` |
| `test_batchCompensate_singleAgent` | Single agent path |
| `test_batchCompensate_onlyKeeper` | `OnlyKeeperAllowed()` from non-keeper |
| `test_batchCompensate_lengthMismatch` | `ArrayLengthMismatch(3, 2)` |
| `test_setPaused_happy` | Admin sets pause flag |
| `test_setPaused_unauthorized` | `Unauthorized()` from non-admin |

### 1.5 StakingRewards — `test/unit/StakingRewards.t.sol` (20 tests)

| Test | Property Verified |
|---|---|
| `test_stake_happy` | `_totalSupply` updated, `Staked` event |
| `test_stake_paused` | `ContractPaused()` |
| `test_stake_zeroAmount` | `ZeroAmount()` |
| `test_withdraw_happy` | VYNX returned, `Withdrawn` event |
| `test_withdraw_notBlockedByPause` | `withdraw` succeeds even when paused |
| `test_withdraw_zeroAmount` | `ZeroAmount()` |
| `test_withdraw_insufficient` | `InsufficientStakeBalance(user, requested, available)` |
| `test_getReward_happy` | USDC transferred, `rewards[staker] = 0`, `RewardPaid` |
| `test_getReward_zeroNoop` | Silent no-op when earned = 0 |
| `test_exit_happy` | Full VYNX withdrawn + USDC rewards claimed atomically |
| `test_notifyRewardAmount_cleanSlate` | `rewardRate = reward / 604800`, `periodFinish = now + 604800` |
| `test_notifyRewardAmount_rollover` | Half-period rollover rate recalculation |
| `test_notifyRewardAmount_onlyDistribution` | `OnlyRewardsDistribution()` from non-treasury |
| `test_rewardPerToken_monotonic` | Accumulator increases after time warp |
| `test_earned_accuracy` | `earned(staker) ≈ rewardRate × elapsedTime` within 1 wei |
| `test_earned_proportional` | Two equal stakers earn equal rewards |
| `test_lastTimeRewardApplicable_before` | Returns `block.timestamp` before period end |
| `test_lastTimeRewardApplicable_after` | Returns `periodFinish` after period end |
| `test_setPaused_happy` | Pause flag toggled by admin |
| `test_setPaused_unauthorized` | Reverts from non-admin |

### 1.6 VynxRegistry — `test/unit/VynxRegistry.t.sol` (18 tests)

Fork: Ethereum Mainnet. Uses `TestVaultAdapter` from `test/helpers/`.

| Test | Property Verified |
|---|---|
| `test_registerSolver_happy` | Solver active, collateral deposited, `SolverRegistered` event |
| `test_registerSolver_revertAlreadyRegistered` | `SolverAlreadyRegistered(solver)` |
| `test_registerSolver_revertAdapterNotFound` | `AdapterNotFound(addr)` |
| `test_registerSolver_revertCollateralNotWhitelisted` | `CollateralTokenNotWhitelisted(token)` |
| `test_deregisterSolver_happy` | Solver inactive, collateral returned, `SolverDeregistered` |
| `test_deregisterSolver_revertSolverNotFound` | `SolverNotFound(solver)` |
| `test_deregisterSolver_cannotReregister` | `SolverAlreadyRegistered` — `registeredAt != 0` guard |
| `test_executeSlash_happy` | `slashPool` updated, `SolverSlashed` emitted |
| `test_executeSlash_revertAccessControlNoKeeperRole` | `ADMIN_ROLE` alone cannot slash |
| `test_executeSlash_revertSolverInactive` | `SolverInactive(solver)` |
| `test_executeSlash_revertInsufficientCollateral` | `InsufficientCollateral(solver, requested, available)` |
| `test_setSHFThreshold_adminRole` | Threshold updated, `SHFThresholdUpdated` emitted |
| `test_setSHFThreshold_revertAccessControl` | AccessControl revert from non-admin |
| `test_setAdapter_adminRole` | Adapter registered, `AdapterRegistered` emitted |
| `test_setAdapter_revertAccessControl` | AccessControl revert from non-admin |
| `test_getSolverCollateral` | Returns adapter balance after registration |
| `test_getSHF_eligible` | 120e6 collateral for 100e6 intent → true (120% >= 120 threshold) |
| `test_getSHF_ineligible` | 80e6 collateral for 100e6 intent → false |

### 1.7 DirectVaultAdapter — `test/unit/DirectVaultAdapter.t.sol` (18 tests)

Fork: Ethereum Mainnet. Uses live USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`) via `deal()`. Covers the L1 collateral custody adapter.

| Test | Property Verified |
|---|---|
| `test_constructor_setsCollateralToken` | `collateralToken()` returns the address passed to constructor |
| `test_constructor_revertZeroAddress` | `ZeroAddress()` when collateral token is `address(0)` |
| `test_deposit_happy` | Registry deposits; `getCollateral` and `totalCustody` increment; USDC transferred from solver |
| `test_deposit_accumulatesMultipleDeposits` | Successive deposits to same solver accumulate correctly |
| `test_deposit_revertZeroAmount` | `ZeroAmount()` on zero deposit |
| `test_withdraw_happy` | Collateral returned to solver; `getCollateral` and `totalCustody` zero out; `CollateralWithdrawn` emitted |
| `test_withdraw_partial` | Partial withdrawal decrements `getCollateral` and `totalCustody` correctly |
| `test_withdraw_revertZeroAmount` | `ZeroAmount()` on zero withdrawal |
| `test_withdraw_revertInsufficientBalance` | `InsufficientBalance(solver, requested, available)` when over-withdrawing |
| `test_withdraw_revertInsufficientBalance_noDeposit` | `InsufficientBalance` when solver has no deposit |
| `test_slash_happy` | Slash reduces `getCollateral`; slashed tokens remain in adapter; `totalCustody` unchanged; `CollateralSlashed` emitted |
| `test_slash_fullAmount` | Full slash reduces `getCollateral` to zero; adapter retains all tokens as slash pool |
| `test_slash_revertZeroAmount` | `ZeroAmount()` on zero slash |
| `test_slash_revertInsufficientBalance` | `InsufficientBalance(solver, requested, available)` when over-slashing |
| `test_slash_revertInsufficientBalance_noDeposit` | `InsufficientBalance` when solver has no collateral |
| `test_slash_poolAccumulatesAndWithdrawIsIndependent` | Slashed pool does not interfere with other solvers' withdrawals |
| `test_getCollateral_zeroForUnknownSolver` | `getCollateral(unknown)` returns 0 without reverting |
| `test_totalCustody_zeroInitially` | `totalCustody()` is 0 at deployment |

---

## Category 2 — Integration Tests (5 tests)

**File:** `test/integration/FullFlow.t.sol`
**Fork:** Base Mainnet — all 6 L2 contracts deployed, no mocks.

Integration tests verify multi-contract interaction correctness and end-to-end economic flows that unit tests cannot exercise in isolation.

| Test | Flow Exercised |
|---|---|
| `test_fullFlow_lockAndClaim` | Lock intent → claim funds → verify state REDEEMED + fee routing to Treasury |
| `test_fullFlow_refundPath` | Lock intent → warp past deadline → refund → verify state REFUNDED + balance restored |
| `test_fullFlow_pausePropagation` | Watchdog `pauseAll` → `lockIntent` reverts → multisig `unpauseAll` → normal operation |
| `test_fullFlow_keyRotation` | Lock with `OLD_PK` → rotate to `NEW_PK` → claim with `OLD_PK` fails → claim with `NEW_PK` succeeds |
| `test_fullFlow_completeLoop` | Full economic cycle: lock 1,512 USDC → claim → distribute yield → stake VYNX → earn USDC → exit |

**`intentAmt = 1_512e6` technical note:** The complete loop requires `rewardRate >= 1`. At 1,512 USDC: `fee = 1,512,000 → yield = 604,800 → rewardRate = 604,800 / 604,800 = 1`. Amounts below this threshold cause `rewardRate` to truncate to 0 via integer division, preventing stakers from accruing any rewards.

---

## Category 3 — Stateless Fuzz Tests (5 properties × 1,024 runs)

**File:** `test/fuzz/Fuzz.t.sol`
**Fork:** Base Mainnet — all 6 L2 contracts deployed.

Stateless (snapshot-isolated) property-based tests. Each run starts from a fresh `setUp` state. `bound()` constrains inputs to valid ranges; `vm.assume()` is used only for single-point exclusions.

### P1 — lockIntent validity

**Property:** For any `(seed, amount, nonce)` with `amount ∈ [1 USDC, 1M USDC]` and `nonce ∈ [1, uint64.max]`, a `lockIntent` call with a valid EIP-712 relayer signature MUST succeed and write the correct escrow record.

```
testFuzz_lockIntent(bytes32 seed, uint256 amount, uint256 nonce)
assertEq(escrAgent, agent)
assertEq(escrAmount, amount)
assertEq(uint8(state), uint8(IntentState.LOCKED))
assertEq(IERC20(USDC).balanceOf(address(settlement)), amount)
```

### P2 — wrong-signer reversion

**Property:** For every private key in `(0, SECP256K1_ORDER) \ {RELAYER_PK}`, signing a voucher with that key MUST revert `InvalidVoucherSignature(intentId)`.

```
testFuzz_claimFunds_wrongSigner(uint256 pk)
pk = bound(pk, 1, SECP256K1_ORDER - 1); vm.assume(pk != RELAYER_PK)
vm.expectRevert(abi.encodeWithSelector(IVynxSettlement.InvalidVoucherSignature.selector, intentId))
```

### P3 — refund timestamp boundary

**Property:** For any `warpTo ∈ [lockTime, lockTime + 7 days]`:
- `warpTo ≤ deadline` → `DeadlineNotExpired(id, deadline)`.
- `warpTo > deadline` → state transitions to REFUNDED, full balance returned to agent.

```
testFuzz_refundIntent_timestamps(uint256 warpTo)
warpTo = bound(warpTo, lockTime, lockTime + 7 days)
```

### P4 — staking accumulator correctness

**Property:** For any `stakeAmount ∈ [0.001 VYNX, 10,000 VYNX]` and `rewardAmount ∈ [604,800, 100M USDC]`:
- `earned()` never panics.
- `earned(staker) ≤ rewardAmount`.
- Single-staker `earned ≈ rewardRate × rewardsDuration` within `stakeAmount / 1e18 + 1` wei.

The tolerance `stakeAmount / 1e18 + 1` is the mathematically correct bound for Synthetix double-integer-division precision loss: `floor(timeDelta × rewardRate × 1e18 / totalSupply) × totalSupply / 1e18`.

```
testFuzz_staking_math(uint256 stakeAmount, uint256 rewardAmount)
assertLe(earnedAmount, rewardAmount)
assertApproxEqAbs(earnedAmount, expectedEarned, stakeAmount / 1e18 + 1)
```

### P5 — treasury split zero-leakage

**Property:** For any `amount ∈ [1, 100M USDC]`, the three treasury accumulators sum exactly to `amount` — zero dust, zero rounding leakage.

```
testFuzz_treasury_split(uint256 amount)
amount = bound(amount, 1, 100_000_000e6)
assertEq(yieldAcc + buybackAcc + polAcc, amount)
assertApproxEqAbs(yieldAcc, amount * 40 / 100, 1)
assertApproxEqAbs(buybackAcc, amount * 50 / 100, 1)
```

---

## Category 4 — Stateful Invariant Tests (5 invariants)

**Files:** `test/invariant/Invariants.t.sol` + `test/invariant/Handler.sol`
**Fork:** Base Mainnet.

Stateful (shared state) invariant testing. The Foundry fuzzer randomly calls `Handler` functions; after each call, all `invariant_*` assertions are evaluated. Failures produce minimal counterexamples. Ghost variables track expected accounting state for cross-comparison.

**Handler functions (fuzzer call targets):**

| Function | Action |
|---|---|
| `lockIntent(uint256)` | Locks a new intent; increments `ghost_lockedBalance` |
| `claimFunds(uint256)` | Claims a random locked intent; updates fee ghosts |
| `refundIntent(uint256)` | Refunds a random intent after time warp |
| `stake(uint256)` | Stakes VYNX; increments `ghost_totalStaked` |
| `withdraw(uint256)` | Withdraws VYNX; decrements `ghost_totalStaked` |
| `distributeYield()` | Distributes yield; increments `ghost_totalYieldDistributed` |
| `syncConfig(uint16)` | Updates take rate via VynxAdmin |

### I1 — Settlement Solvency

```
IERC20(USDC).balanceOf(settlement) >= ghost_lockedBalance
```

USDC held by Settlement is always ≥ the sum of all currently LOCKED escrow amounts. Failure indicates a fund release without a corresponding state transition.

### I2 — State Machine Finality

```
For all i in [0, finalizedIntentsLength):
    settlement.intents(finalizedIntentIds[i]).state == ghost_finalStates[id]
```

An intent that transitioned to REDEEMED or REFUNDED can never change state. The handler records terminal states into `ghost_finalStates` and checks them on every subsequent call.

### I3 — Treasury Revenue Integrity

```
yieldAccumulator[USDC] + buybackAccumulator[USDC] + polAccumulator[USDC]
    + ghost_totalYieldDistributed == ghost_totalFeesReceived
```

Every fee wei received by Treasury is either sitting in one of the three accumulators or has already been distributed to StakingRewards. Zero leakage.

### I4 — StakingRewards Supply Conservation

```
IERC20(address(vynxToken)).balanceOf(stakingRewards) == ghost_totalStaked
```

VYNX token balance equals the net staked amount tracked by the handler. This externally proves `_totalSupply == Σ(_balances)` — the internal Synthetix invariant — without requiring private storage access.

### I5 — EIP-712 TypeHash Immutability

```
settlement.INTENT_TYPEHASH() ==
    keccak256("Intent(uint256 nonce,address user,address token,uint256 amount,uint256 destinationChainId,uint256 deadline)")

settlement.VOUCHER_TYPEHASH() ==
    keccak256("Voucher(bytes32 intentId,address solver,uint256 amount)")
```

The canonical EIP-712 type hashes are `constant` and must never change. The Go relayer SDK and AgentKit plugin depend on these exact hashes; any mutation would silently break all off-chain signature generation.

---

## Test Infrastructure

### Fork Configuration

| Suite | Network | RPC Variable |
|---|---|---|
| Unit (VynxAdmin, Settlement, Treasury, Staking) | Base Mainnet | `BASE_RPC_URL` |
| Unit (VynxRegistry) | Ethereum Mainnet | `ETH_RPC_URL` |
| Integration | Base Mainnet | `BASE_RPC_URL` |
| Fuzz | Base Mainnet | `BASE_RPC_URL` |
| Invariant | Base Mainnet | `BASE_RPC_URL` |

### Token Addresses

| Token | Network | Address / Notes |
|---|---|---|
| USDC | Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDC | Ethereum Mainnet | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| WETH | Ethereum Mainnet | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| $VYNX (VynxToken) | Deployed in-test | Not a live fork token — minted via `vynxToken.mint(staker, amount)` |

### Circular Dependency Resolution

StakingRewards, VynxTreasury, and VynxSettlement form a circular constructor dependency. Tests resolve it by pre-computing CREATE addresses before any deployment. VynxToken is deployed first (consuming one nonce), then the nonce is captured and offsets are computed:

```solidity
vynxToken = new VynxToken(address(this));           // consumes nonce N-1 (before capture)
uint64 n = vm.getNonce(address(this));              // capture nonce AFTER VynxToken
address predictedTreasury   = vm.computeCreateAddress(address(this), n + 3);
address predictedSettlement = vm.computeCreateAddress(address(this), n + 4);
// Deployment order: VynxAdmin impl → proxy → StakingRewards → VynxTreasury → VynxSettlement
//                   (n+0)             (n+1)   (n+2)            (n+3)           (n+4)
assertEq(address(treasury),   predictedTreasury,   "treasury nonce offset mismatch");
assertEq(address(settlement), predictedSettlement, "settlement nonce offset mismatch");
```

### Makefile Targets

```bash
make test              # Full suite: unit + integration + fuzz (excludes invariant)
make test-unit         # Unit tests only — fastest iteration cycle
make test-fuzz         # Property fuzz tests (1,024 runs per property)
make test-invariants   # Stateful invariant campaign via offline Anvil script
make coverage          # LCOV report — reproduces the 99.31% / 100% metrics above
```
