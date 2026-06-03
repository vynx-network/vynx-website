# VynX Settlement V1 — Security

This document describes the security properties, mitigations, and design invariants of the
VynX Settlement V1 protocol. Every claim is grounded in the source under `src/`.

---

## 1. Checks-Effects-Interactions (CEI) Ordering

Every value-moving path writes state before performing external token transfers.

### `VynxSettlement.claimFunds` (LOCKED → REDEEMED)
1. **Checks** — not paused; escrow is LOCKED (UNKNOWN emits `SuspiciousRelayerActivity` then
   reverts); `voucher.solver == escrow.solver`; EIP-712 signature recovers to `relayerKey()`.
2. **Effects** — `escrow.state = REDEEMED`; `_deductTakeRate` computes `net`/`fee`.
3. **Interactions** — `safeTransfer(solver, net)`; if `fee > 0`, `safeTransfer(treasury, fee)`
   and `receiveTakeRate(token, fee)`.

The state flips to REDEEMED **before** any transfer, so a re-entrant call observes a terminal
state and reverts `InvalidState`.

### `VynxSettlement.refundIntent` (LOCKED → REFUNDED)
State is set to REFUNDED before `safeTransfer(agent, amount)`. A re-entrant call sees REFUNDED
and reverts.

### `VynxTreasury.distributeRealYield`
`yieldAccumulator[token]` is zeroed **before** `safeTransfer(stakingRewards, amount)` and
`notifyRewardAmount(amount)`.

### `VynxTreasury.sweepForBuyback`
`buybackAccumulator[token]` is decremented **before** `safeTransfer(multisig, amount)`.

### `StakingRewards.getReward`
`rewards[msg.sender]` is zeroed **before** `safeTransfer(msg.sender, reward)`, eliminating any
double-claim window.

### `VynxRegistry.executeSlash`
`slashPool[solver]` and `solvers[solver].totalCollateral` are updated **before** the external
calls (`adapter.slash`, then the two `safeTransfer` distributions).

---

## 2. Reentrancy Protection

The protocol relies on OpenZeppelin v5 `ReentrancyGuard` in addition to CEI:

| Contract | `nonReentrant` functions |
| --- | --- |
| VynxRegistry | `registerSolver`, `deregisterSolver`, `executeSlash` |
| DirectVaultAdapter | `deposit`, `withdraw`, `slash` |
| VynxSettlement | `lockIntent`, `claimFunds`, `refundIntent` |
| VynxTreasury | `batchCompensate` |
| StakingRewards | `stake`, `withdraw`, `getReward` |

`DirectVaultAdapter` carries its own `nonReentrant` guards as defense-in-depth: the registry
already guards `executeSlash`, but adapter-level protection ensures safety if an adapter is ever
called directly. `exit()` in StakingRewards is itself not guarded, but it calls `withdraw` then
`getReward`, each of which acquires and releases the reentrancy lock independently.

---

## 3. Signature Replay Prevention (EIP-712)

Two independent layers prevent replay:

1. **Domain `chainId`** — `VynxSettlement` uses `EIP712("VynxSettlement", "1")`, so the domain
   separator binds the `chainId` and the verifying contract address. A signature produced for
   Base cannot be replayed on any other chain or against any other contract, because the
   recovered digest differs. This is the cross-chain replay defense.
2. **State-machine finality** — within the same chain, an intent ID can only move
   UNKNOWN → LOCKED → {REDEEMED | REFUNDED}, and REDEEMED/REFUNDED are terminal. A voucher that
   was already redeemed cannot be redeemed again: the second `claimFunds` observes a non-LOCKED
   state and reverts `InvalidState`. This is the voucher-replay defense.

The intent's `nonce` field is part of the signed Intent struct hash, giving each intent a
unique digest even for otherwise identical parameters. The relayer key used to verify both
intents and vouchers is read live from `IVynxAdmin(admin).relayerKey()` on every call.

---

## 4. Suspicious Activity Detection

If `claimFunds` is called against an intent whose escrow state is `UNKNOWN` (i.e. it was never
locked), the contract emits `SuspiciousRelayerActivity(intentId, msg.sender, voucher.intentId)`
before reverting `InvalidState`. This surfaces a potential front-run or rogue-relayer attempt
to off-chain monitoring without permitting any state change.

---

## 5. Asymmetric Pause Authority

`VynxAdmin` separates emergency authority from recovery authority:

- **watchdog** — may `pauseAll()` (and rotate the relayer key). Can NEVER unpause.
- **multisig** — may `unpauseAll()`. Can NEVER pause.

`pauseAll` reverts `AlreadyPaused` if already paused; `unpauseAll` reverts `NotPaused` if not
paused. Both propagate the flag to Settlement, Treasury, and StakingRewards. Pause is enforced
where it matters: `lockIntent`/`claimFunds` (Settlement) and `stake` (StakingRewards) revert
while paused; `withdraw`/`getReward` remain available so stakers can always exit, and
`refundIntent` is not pause-gated so locked funds can always be reclaimed after deadline. The
`paused` flag on Treasury is stored but never read by Treasury logic.

This asymmetry means a single fast low-privilege key can halt the protocol during an incident,
while only the high-threshold board can resume operations after review.

---

## 6. UUPS Upgrade Safety

`VynxAdmin` is the only upgradeable contract. Its upgrade surface is doubly gated:

- The implementation constructor calls `_disableInitializers()`, so the logic contract can never
  be initialised directly — only the proxy is initialised once via `initialize`.
- `upgradeTo(newImpl)` requires `msg.sender == multisig`, and `_authorizeUpgrade` (invoked
  internally by `upgradeToAndCall`) re-checks `msg.sender == multisig`. UUPS compatibility of
  the new implementation is validated by OpenZeppelin via `proxiableUUID()`.

All other contracts (Registry, Adapter, Settlement, Treasury, StakingRewards, Token) are
immutable with no proxy, removing upgrade risk for the value-holding contracts entirely.

---

## 7. On-Chain Slash Custody Model

Slashing moves real value on L1 within a single transaction; there is no custody pool and no
cross-chain transfer of slashed funds.

- `slashPool[solver]` is a **cumulative accounting ledger** that only ever increases. It holds
  no tokens. Its purpose is record-keeping of the total amount ever slashed from a solver.
- The seized total is transferred out of the adapter into the registry, then immediately split:
  `agentShare` (5% of input) to the affected agent and `treasuryShare` (the remainder) to the
  L1 protocol treasury address. The two shares sum exactly to `slashTotal` because the treasury
  share absorbs any integer-division dust.
- The token moved is the adapter's real custodied token (`adapter.collateralToken()`), not
  necessarily `SolverInfo.collateralToken`.
- Authorisation is by `KEEPER_ROLE` (wallet-gated). The `SlashPayload.signature` is retained
  for off-chain audit trails and is not verified on-chain.

The registry nets to a zero balance change for the operation: it never retains slashed value.

---

## 8. DirectVaultAdapter Access Nuance

`slash` is `onlyRegistry` because it moves real tokens out of custody. `deposit` and `withdraw`
have **no caller restriction** beyond `nonReentrant`; the registry is the intended caller, but
the functions are technically callable directly. The important property is that `deposit` pulls
tokens via `safeTransferFrom(solver, address(this), amount)`, so a solver must approve **the
adapter contract**, not the registry. A direct call to `deposit`/`withdraw` cannot extract value
beyond the per-solver `_balances` accounting it maintains, and `withdraw` reverts
`InsufficientBalance` if it would exceed the recorded balance. Slashing — the only value-seizing
operation — remains strictly registry-gated.

---

## 9. Arithmetic Safety

- Solidity 0.8.35 native checked arithmetic everywhere; zero `SafeMath` imports.
- `unchecked` blocks are used only where overflow/underflow is mathematically impossible by
  adjacent bounds:
  - `VynxSettlement._deductTakeRate` — `takeRateBps <= 20` (enforced by VynxAdmin and the
    constructor), so `amount * takeRateBps` cannot overflow for realistic balances.
  - `VynxTreasury.receiveTakeRate` — the `40/100` and `50/100` multiplications are bounded; POL
    is the remainder, guaranteeing `toYield + toBuyback + toPol == amount` with no leakage.
  - `StakingRewards.rewardPerToken` / `earned` — see the documented bounds in `contracts.md`.
- The compiler is pinned to `0.8.35` (`foundry.toml`), explicitly avoiding the 0.8.28–0.8.33
  range affected by the TSTORE Poison bug.

---

## 10. Off-Chain Integrity Gate (Relayer Witness)

Before the relayer signs a voucher, it validates the destination-chain payment against an
integrity witness: it confirms the output token is correct, the recipient equals the agent, and
the value is at or above the minimum output amount on a single `Transfer` log. Only after this
witness passes does the relayer issue the EIP-712 voucher that the solver redeems on-chain. This
gate lives in the relayer repository and is the off-chain precondition for any `claimFunds`
settlement; the on-chain contract trusts the relayer signature for payment correctness while
still enforcing all on-chain invariants (state machine, solver match, solvency).

---

## 11. Attack-Scenario Matrix

| Scenario | Vector | Mitigation |
| --- | --- | --- |
| Voucher replay | Redeem a settled voucher twice | State machine: REDEEMED is terminal; second `claimFunds` reverts `InvalidState`. |
| Cross-chain signature replay | Reuse a Base signature on another chain | EIP-712 domain binds `chainId` + verifying contract; digest differs, recovery fails. |
| Voucher forgery | Sign with a non-relayer key | `ECDSA.recover` != `relayerKey()` → `InvalidVoucherSignature`. |
| Intent forgery | Lock with a forged intent signature | `ECDSA.recover` != `relayerKey()` → `InvalidIntentSignature`. |
| Compromised relayer key | Continued use of a leaked key | Watchdog `setRelayerKey`; Settlement reads the key live every call (zero-delay rotation). |
| Reentrancy on settlement | Re-enter during a transfer | CEI (state set first) + `nonReentrant`. |
| Solver substitution | Claim with a mismatched solver | `voucher.solver != escrow.solver` → `SolverMismatch`. |
| Premature refund | Refund before deadline | `block.timestamp <= deadline` → `DeadlineNotExpired`. |
| Unauthorized slash | Non-keeper calls `executeSlash` | `onlyRole(KEEPER_ROLE)`. |
| Over-slash | Slash beyond collateral | `available < slashTotal` → `InsufficientCollateral`. |
| Direct adapter drain | Call `slash` directly | `onlyRegistry`. |
| Unauthorized config / pause | Wrong caller for admin functions | Per-function `watchdog`/`multisig`/`admin` checks; asymmetric pause. |
| Unauthorized upgrade | Push a malicious implementation | Multisig gate in both `upgradeTo` and `_authorizeUpgrade`; only VynxAdmin is upgradeable. |
| Double-claim of rewards | Claim staking rewards twice | `rewards[account]` zeroed before transfer in `getReward`. |
| Treasury fund injection | Non-Settlement calls `receiveTakeRate` | `OnlySettlementAllowed`. |
| Rounding leakage | Lose dust in revenue split or slash | POL / treasury share computed as remainder; sums are exact. |

---

## 12. Core Design Invariants

1. **Settlement solvency** — the Settlement token balance is always at least the sum of all
   LOCKED escrow amounts.
2. **State-machine finality** — once REDEEMED or REFUNDED, an intent never changes state.
3. **Treasury revenue integrity** — every received fee wei is accounted for in an accumulator or
   distributed; `toYield + toBuyback + toPol == amount`.
4. **Staking supply conservation** — the StakingRewards $VYNX balance equals the net staked
   amount (`_totalSupply == Σ(_balances)`).
5. **EIP-712 typehash immutability** — `INTENT_TYPEHASH` and `VOUCHER_TYPEHASH` are compile-time
   constants and never change.
6. **Slash neutrality** — the registry retains no slashed value; `agentShare + treasuryShare ==
   slashTotal` and both are transferred out in the same call.

These invariants are continuously exercised by the stateful invariant suite (see `tests.md`).
