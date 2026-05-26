# VynX Settlement V1 — Contract Reference

> Compiler: `solc 0.8.35` | OZ v5 | Base L2 (L2 contracts) + Ethereum L1 (Registry)

---

## Table of Contents

1. [VynxRegistry (L1)](#1-vynxregistry-l1)
2. [DirectVaultAdapter (L1)](#2-directvaultadapter-l1)
3. [VynxToken (L2)](#3-vynxtoken-l2)
4. [VynxAdmin (L2)](#4-vynxadmin-l2)
5. [VynxSettlement (L2)](#5-vynxsettlement-l2)
6. [VynxTreasury (L2)](#6-vynxtreasury-l2)
7. [StakingRewards (L2)](#7-stakingrewards-l2)
8. [Shared Types](#8-shared-types)

---

## 1. VynxRegistry (L1)

**File:** `src/l1/VynxRegistry.sol`
**Network:** Ethereum Mainnet
**Upgradeability:** None — immutable

### State Variables

| Variable | Type | Description |
|---|---|---|
| `SHF_THRESHOLD` | `uint16` | Solver Health Factor minimum (default: 120 = 1.20×). |
| `solvers` | `mapping(address => SolverInfo)` | Registry of all solvers (active or deregistered). |
| `adapters` | `mapping(address => IVaultAdapter)` | Approved vault adapters keyed by address. |
| `slashPool` | `mapping(address => uint256)` | Confiscated collateral per solver. |

### Constants / Roles

| Name | Value | Description |
|---|---|---|
| `ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | Governance role — adapters, thresholds. |
| `KEEPER_ROLE` | `keccak256("KEEPER_ROLE")` | Keeper Bot role — sole slash executor. |
| `REBALANCE_EPOCH` | `604_800` | Minimum seconds between collateral rebalances (7 days). |

### Functions

| Signature | Access | Description |
|---|---|---|
| `registerSolver(address adapterAddr, address token, uint256 amount)` | Any | Deposits collateral via adapter, sets solver active. |
| `deregisterSolver()` | Solver | Withdraws full collateral, sets active = false permanently. |
| `executeSlash(SlashPayload calldata payload)` | `KEEPER_ROLE` | Slashes solver collateral; funds held in `slashPool`. |
| `setSHFThreshold(uint16 newThreshold)` | `ADMIN_ROLE` | Updates the SHF eligibility threshold. |
| `setAdapter(address protocol, address adapterAddr)` | `ADMIN_ROLE` | Registers or replaces a vault adapter. |
| `getSolverCollateral(address solver)` | View | Returns live collateral from the adapter. |
| `getSHF(address solver, uint256 intentValue)` | View | Returns true IFF `collateral >= intentValue * SHF_THRESHOLD / 100`. |

### Custom Errors

| Error | Trigger |
|---|---|
| `SolverAlreadyRegistered(address)` | `registerSolver` on an already-registered solver. |
| `SolverNotFound(address)` | `deregisterSolver` on an unregistered or inactive solver. |
| `SolverInactive(address)` | `executeSlash` on a non-active solver. |
| `AdapterNotFound(address)` | `registerSolver` with an unregistered adapter address. |
| `CollateralTokenNotWhitelisted(address)` | `registerSolver` with a non-whitelisted token. |
| `InsufficientCollateral(address, uint256, uint256)` | `executeSlash` amount exceeds available adapter balance. |
| `ZeroAddress()` | Constructor: any address arg is `address(0)`. |

### Events

| Event | Emitted by |
|---|---|
| `SolverRegistered(address solver, address adapter, address token, uint256 amount)` | `registerSolver` |
| `SolverDeregistered(address solver, uint256 collateral)` | `deregisterSolver` |
| `SolverSlashed(address solver, bytes32 intentId, uint256 amount, address adapter)` | `executeSlash` |
| `SHFThresholdUpdated(uint16 oldThreshold, uint16 newThreshold)` | `setSHFThreshold` |
| `AdapterRegistered(address protocol, address adapterAddr)` | `setAdapter` |

### Key Invariants

- `executeSlash` requires `KEEPER_ROLE`. An account with `ADMIN_ROLE` but not `KEEPER_ROLE` reverts.
- A solver deregistered once can **never** re-register (checked via `registeredAt != 0`).
- Slashed collateral accumulates in `slashPool` on L1; off-chain CCTP is used for L2 agent compensation.

---

## 2. DirectVaultAdapter (L1)

**File:** `src/adapters/DirectVaultAdapter.sol`
**Network:** Ethereum Mainnet
**Upgradeability:** None — immutable
**Interface:** `IVaultAdapter`

### State Variables

| Variable | Type | Description |
|---|---|---|
| `collateralToken` | `address immutable` | The single ERC-20 token accepted by this adapter instance. |
| `_balances` | `mapping(address => uint256) private` | Per-solver internal balance; decremented on withdraw or slash. |

### Functions

| Signature | Access | Description |
|---|---|---|
| `deposit(address solver, uint256 amount)` | Any (called by Registry) | Pulls `amount` from `solver` via `safeTransferFrom`; increments `_balances[solver]`. Solver must approve this contract. |
| `withdraw(address solver, uint256 amount)` | Any (called by Registry) | Transfers `amount` back to `solver`; decrements `_balances[solver]`. |
| `slash(address solver, uint256 amount)` | Any (called by Registry Keeper) | Decrements `_balances[solver]` without transferring — tokens stay as slash pool for CCTP compensation. |
| `getCollateral(address solver)` | View | Returns `_balances[solver]` — the solver's unslashed collateral. |
| `totalCustody()` | View | Returns `IERC20(collateralToken).balanceOf(address(this))` — all solver balances plus accumulated slash pool. |

### Custom Errors

| Error | Trigger |
|---|---|
| `ZeroAddress()` | Constructor: `_collateralToken == address(0)`. |
| `ZeroAmount()` | `deposit`, `withdraw`, or `slash` called with `amount == 0`. |
| `InsufficientBalance(address solver, uint256 requested, uint256 available)` | `withdraw` or `slash` when `amount > _balances[solver]`. |

### Events

| Event | Emitted by |
|---|---|
| `CollateralDeposited(address indexed solver, uint256 amount)` | `deposit` |
| `CollateralWithdrawn(address indexed solver, uint256 amount)` | `withdraw` |
| `CollateralSlashed(address indexed solver, uint256 amount)` | `slash` |

### Key Invariants

- `totalCustody() >= sum(_balances[all solvers])` at all times (slash pool delta is always non-negative).
- Slashed tokens never leave the adapter — `slash` emits `CollateralSlashed` but performs no `safeTransfer`.
- All three mutating functions are `nonReentrant` — defense-in-depth on top of Registry's own gate.
- One adapter instance per collateral token; the V1 deployment registers three: USDC, WETH, wstETH.

---

## 3. VynxToken (L2)

**File:** `src/tokens/VynxToken.sol`
**Network:** Base Mainnet
**Upgradeability:** None — immutable
**Inherits:** OZ v5 `ERC20`, `ERC20Permit`, `Ownable`

### State Variables

| Variable | Type | Description |
|---|---|---|
| (ERC-20 standard) | — | `balances`, `allowances`, `totalSupply` inherited from OZ v5 `ERC20`. |
| (ERC20Permit) | — | `nonces`, `DOMAIN_SEPARATOR` inherited from OZ v5 `ERC20Permit`. |
| `_owner` | `address private` | OZ v5 `Ownable` — set to `multisig` at deployment; controls `mint`. |

### Constructor

```solidity
constructor(address initialOwner)
    ERC20("VynX", "VYNX")
    ERC20Permit("VynX")
    Ownable(initialOwner)
```

`initialOwner` is the multisig address. Ownership is non-renounced by default; transfer requires an explicit multisig transaction.

### Functions

| Signature | Access | Description |
|---|---|---|
| `mint(address to, uint256 amount)` | `onlyOwner` (multisig) | Mints `amount` $VYNX to `to`. Only the current `owner` may call this. |
| `transfer(address to, uint256 amount)` | Holder | Standard ERC-20 transfer. |
| `approve(address spender, uint256 amount)` | Holder | Standard ERC-20 approval. |
| `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)` | Anyone | EIP-2612 gasless approval. Verifies off-chain signature against `nonces[owner]`. |
| `transferOwnership(address newOwner)` | `onlyOwner` | Transfers minting authority to a new address. |

### Custom Errors

VynxToken itself defines no custom errors. Reverts originate from OZ v5 inherited contracts:

| Error | Origin | Trigger |
|---|---|---|
| `OwnableUnauthorizedAccount(address)` | OZ `Ownable` | `mint` called by any account other than the current owner. |
| `ERC2612ExpiredSignature(uint256)` | OZ `ERC20Permit` | `permit` called after `deadline`. |
| `ERC2612InvalidSigner(address,address)` | OZ `ERC20Permit` | `permit` signature does not match `owner`. |

### Events

| Event | Emitted by |
|---|---|
| `Transfer(address indexed from, address indexed to, uint256 value)` | `mint`, `transfer`, `transferFrom` (ERC-20 standard) |
| `Approval(address indexed owner, address indexed spender, uint256 value)` | `approve`, `permit` (ERC-20 standard) |
| `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)` | `transferOwnership` (OZ Ownable) |

### Key Invariants

- `mint` is exclusively callable by the `owner` (multisig). No other path creates supply.
- EIP-2612 `permit` nonces are strictly monotonically increasing — replay of a consumed permit is impossible.
- No `ReentrancyGuard` is needed: `mint` only calls `_mint` which performs no external calls.

---

## 4. VynxAdmin (L2)

**File:** `src/l2/VynxAdmin.sol`
**Network:** Base Mainnet
**Upgradeability:** UUPS — `multisig` is the sole upgrade authority

### State Variables

| Variable | Type | Description |
|---|---|---|
| `relayerKey` | `address` | Relayer signing key — read cross-contract by Settlement on every call. |
| `takeRateBps` | `uint16` | Protocol fee rate in basis points. Range: [0, 20]. |
| `settlement` | `address` | Registered VynxSettlement address. |
| `treasury` | `address` | Registered VynxTreasury address. |
| `stakingRewards` | `address` | Registered StakingRewards address. |
| `watchdog` | `address` | RelayerAdmin — pause + key rotation only. |
| `multisig` | `address` | Board multisig — unpause + upgrade + config only. |
| `paused` | `bool` | Global protocol pause flag. |

### Constants

| Name | Value | Description |
|---|---|---|
| `MAX_TAKE_RATE` | `20` | Hard cap on take rate in basis points (0.20%). |

### Functions

| Signature | Access | Description |
|---|---|---|
| `initialize(address relayerKey, address watchdog, address multisig, uint16 takeRateBps)` | Once | UUPS proxy initializer. |
| `pauseAll()` | `watchdog` | Pauses protocol; propagates `setPaused(true)` to all L2 contracts. |
| `unpauseAll()` | `multisig` | Unpauses protocol; propagates `setPaused(false)` to all L2 contracts. |
| `setRelayerKey(address newKey)` | `watchdog` | Rotates the relayer key; calls `syncConfig` on Settlement. |
| `setTakeRate(uint16 bps)` | `multisig` | Updates take rate; propagates via `syncConfig`. |
| `setMultisig(address newMs)` | `multisig` | Transfers the multisig role. |
| `upgradeTo(address newImpl)` | `multisig` | Executes UUPS upgrade to new implementation. |
| `setContractAddresses(address, address, address)` | `multisig` | Wires Settlement, Treasury, StakingRewards post-deploy. |

### Custom Errors

| Error | Trigger |
|---|---|
| `Unauthorized()` | Caller lacks the required role. |
| `InvalidTakeRate(uint16)` | `takeRateBps > MAX_TAKE_RATE`. |
| `ZeroAddress()` | Any address argument is `address(0)`. |
| `AlreadyPaused()` | `pauseAll` when already paused. |
| `NotPaused()` | `unpauseAll` when not paused. |

### Events

| Event | Emitted by |
|---|---|
| `RelayerKeyRotated(address oldKey, address newKey)` | `setRelayerKey` |
| `TakeRateUpdated(uint16 oldBps, uint16 newBps)` | `setTakeRate` |
| `ProtocolPaused(address indexed by, uint256 timestamp)` | `pauseAll` |
| `ProtocolUnpaused(address indexed by, uint256 timestamp)` | `unpauseAll` |

### Key Invariants

- **Asymmetric pause:** `watchdog` can pause but NEVER unpause; `multisig` can unpause but NEVER pause.
- **Upgrade guard:** `_authorizeUpgrade` reverts for any caller other than `multisig`.
- `_disableInitializers()` is called in the implementation constructor — the logic contract can never be initialized directly.

---

## 5. VynxSettlement (L2)

**File:** `src/l2/VynxSettlement.sol`
**Network:** Base Mainnet
**Upgradeability:** None — immutable forever

### State Variables

| Variable | Type | Description |
|---|---|---|
| `admin` | `address immutable` | VynxAdmin proxy address — source of truth for `relayerKey`. |
| `treasury` | `address` | Treasury address for take-rate fee routing. |
| `takeRateBps` | `uint16` | Current take rate in basis points. |
| `paused` | `bool` | Pause flag — set by VynxAdmin propagation only. |
| `intents` | `mapping(bytes32 => IntentEscrow)` | Central escrow registry keyed by intentId. |

### Constants

| Name | Value | Description |
|---|---|---|
| `DEFAULT_DEADLINE` | `900` | Escrow window in seconds (15 minutes). |
| `INTENT_TYPEHASH` | `keccak256(...)` | EIP-712 type hash for the Intent struct. |
| `VOUCHER_TYPEHASH` | `keccak256(...)` | EIP-712 type hash for the Voucher struct. |

### EIP-712 Type Hashes

```
INTENT_TYPEHASH = keccak256(
    "Intent(uint256 nonce,address user,address token,uint256 amount,"
    "uint256 destinationChainId,uint256 deadline)"
)

VOUCHER_TYPEHASH = keccak256(
    "Voucher(bytes32 intentId,address solver,uint256 amount)"
)
```

> The field is named `user` in the typehash (off-chain convention) but maps to `intent.agent` in the struct.
> `destTxHash` and `issuedAt` are off-chain metadata excluded from the signed payload.

### State Machine

```
UNKNOWN (0) ──lockIntent──► LOCKED ──claimFunds──► REDEEMED
                                 └──refundIntent──► REFUNDED
```

Terminal states (`REDEEMED`, `REFUNDED`) are irreversible. `UNKNOWN` is the default slot value and provides automatic replay protection.

### Functions

| Signature | Access | Description |
|---|---|---|
| `lockIntent(Intent calldata intent, bytes calldata relayerSig)` | Any | Locks agent USDC; verifies EIP-712 intent sig; state UNKNOWN → LOCKED. |
| `claimFunds(Voucher calldata voucher)` | Any | Verifies voucher sig; deducts fee; sends net to solver; state LOCKED → REDEEMED. |
| `refundIntent(bytes32 intentId)` | Any | Returns funds to agent after deadline expires; state LOCKED → REFUNDED. |
| `syncConfig(uint16 newTakeRateBps, address newTreasury)` | `admin` | Propagates economic params from VynxAdmin. |
| `setPaused(bool _paused)` | `admin` | Sets pause flag (called by VynxAdmin pause propagation). |

### Custom Errors

| Error | Trigger |
|---|---|
| `IntentAlreadyExists(bytes32)` | `lockIntent` on a duplicate intentId. |
| `IntentNotFound(bytes32)` | `refundIntent` on an UNKNOWN intentId. |
| `InvalidState(bytes32, IntentState)` | Transition requested for wrong current state. |
| `DeadlineNotExpired(bytes32, uint64)` | `refundIntent` before `block.timestamp > deadline`. |
| `InvalidVoucherSignature(bytes32)` | Voucher ECDSA recovery ≠ `relayerKey`. |
| `InvalidIntentSignature(bytes32)` | Intent ECDSA recovery ≠ `relayerKey`. |
| `SolverMismatch(bytes32, address, address)` | `voucher.solver` ≠ `escrow.solver`. |
| `ContractPaused()` | Any mutating call when `paused == true`. |
| `Unauthorized()` | `syncConfig` or `setPaused` from non-admin. |
| `ZeroAddress()` | Constructor or `syncConfig` with zero address. |
| `InvalidTakeRate(uint16)` | Constructor with `bps > 20`. |

### Events

| Event | Emitted by |
|---|---|
| `IntentLocked(bytes32 indexed, address indexed, address indexed, address, uint256, uint64)` | `lockIntent` |
| `VoucherRedeemed(bytes32 indexed, address indexed, uint256 netAmount, uint256 fee)` | `claimFunds` |
| `IntentRefunded(bytes32 indexed, address indexed, uint256)` | `refundIntent` |
| `SuspiciousRelayerActivity(bytes32 indexed, address indexed, bytes32)` | `claimFunds` (UNKNOWN state guard) |
| `ConfigSynced(uint16, address)` | `syncConfig` |

### Key Invariants

- **Source-of-truth:** `relayerKey` is read cross-contract on every `lockIntent` and `claimFunds` — never cached locally.
- **State finality:** Once `REDEEMED` or `REFUNDED`, no further transitions are possible.
- **Solvency:** `IERC20(token).balanceOf(address(this)) >= Σ(escrow.amount for all LOCKED intents)`.

---

## 6. VynxTreasury (L2)

**File:** `src/l2/VynxTreasury.sol`
**Network:** Base Mainnet
**Upgradeability:** None — immutable

### State Variables

| Variable | Type | Description |
|---|---|---|
| `admin` | `address immutable` | VynxAdmin address — calls `setPaused`. |
| `settlement` | `address immutable` | VynxSettlement — sole caller of `receiveTakeRate`. |
| `stakingRewards` | `address immutable` | Real yield destination. |
| `keeper` | `address` | Keeper Bot — `batchCompensate` + `distributeRealYield`. |
| `multisig` | `address` | Board multisig — `sweepForBuyback`. |
| `paused` | `bool` | Pause flag — stored but not enforced in Treasury (enforcement is in Settlement). |
| `yieldAccumulator` | `mapping(address => uint256)` | Real yield awaiting distribution to StakingRewards. |
| `buybackAccumulator` | `mapping(address => uint256)` | Buyback reserve awaiting multisig sweep. |
| `polAccumulator` | `mapping(address => uint256)` | Protocol-owned liquidity accumulator (retained). |
| `pendingCompensations` | `mapping(address => uint256)` | Per-agent pending compensation after slashing. |

### Revenue Split Constants

| Constant | Value | Description |
|---|---|---|
| `realYieldBps` | `40` | 40% of every fee → `yieldAccumulator`. |
| `buybackBps` | `50` | 50% of every fee → `buybackAccumulator`. |
| `polBps` | `10` | 10% remainder → `polAccumulator` (absorbs rounding). |

### Functions

| Signature | Access | Description |
|---|---|---|
| `receiveTakeRate(address token, uint256 amount)` | `settlement` | Allocates fee across 3 buckets; no token movements (tokens pre-transferred by Settlement). |
| `batchCompensate(address token, address[] agents, uint256[] amounts)` | `keeper` | Transfers USDC to each agent directly from treasury balance. |
| `distributeRealYield(address token)` | `admin` or `keeper` | Zeroes yield accumulator; transfers USDC to StakingRewards; calls `notifyRewardAmount`. |
| `sweepForBuyback(address token, uint256 amount)` | `multisig` | Decrements buyback accumulator; transfers to multisig for on-chain execution. |
| `setPaused(bool _paused)` | `admin` | Stores pause flag (propagated by VynxAdmin). |

### Custom Errors

| Error | Trigger |
|---|---|
| `OnlySettlementAllowed()` | `receiveTakeRate` from non-settlement caller. |
| `OnlyKeeperAllowed()` | `batchCompensate` from non-keeper caller. |
| `ArrayLengthMismatch(uint256, uint256)` | `batchCompensate` with mismatched array lengths. |
| `ZeroAmount()` | `receiveTakeRate` or `distributeRealYield` with zero amount. |
| `InsufficientBuybackBalance(address, uint256, uint256)` | `sweepForBuyback` amount > accumulator balance. |
| `ZeroAddress()` | Constructor: any address arg is `address(0)`. |
| `Unauthorized()` | `distributeRealYield` from non-admin/non-keeper; `sweepForBuyback` from non-multisig. |

### Events

| Event | Emitted by |
|---|---|
| `TakeRateReceived(address indexed, uint256, uint256, uint256, uint256)` | `receiveTakeRate` |
| `CompensationBatchExecuted(uint256, uint256, address)` | `batchCompensate` |
| `RealYieldDistributed(address indexed, uint256)` | `distributeRealYield` |
| `BuybackFundsSwept(address indexed, uint256, address indexed)` | `sweepForBuyback` |

### Key Invariants

- **Zero leakage:** `toYield + toBuyback + toPol == amount` for any input, guaranteed by computing `toPol` as the arithmetic remainder.
- **CEI ordering:** `yieldAccumulator[token] = 0` is written BEFORE the external transfer in `distributeRealYield`.
- **CEI ordering:** `buybackAccumulator[token] -= amount` is written BEFORE the external transfer in `sweepForBuyback`.

---

## 7. StakingRewards (L2)

**File:** `src/l2/StakingRewards.sol`
**Network:** Base Mainnet
**Upgradeability:** None — immutable

### Immutables

| Variable | Description |
|---|---|
| `rewardsToken` | USDC on Base — distributed as real yield. |
| `stakingToken` | $VYNX token — staked by users. |
| `rewardsDistribution` | VynxTreasury — sole caller of `notifyRewardAmount`. |
| `admin` | VynxAdmin — sole caller of `setPaused`. |

### State Variables

| Variable | Type | Description |
|---|---|---|
| `rewardRate` | `uint256` | Current USDC-per-second emission across all stakers. |
| `rewardPerTokenStored` | `uint256` | Global cumulative reward-per-staked-token (scaled by 1e18). |
| `lastUpdateTime` | `uint256` | Timestamp of last accumulator update. |
| `periodFinish` | `uint256` | Timestamp at which the current emission period ends. |
| `userRewardPerTokenPaid` | `mapping(address => uint256)` | Per-user watermark for delta calculations. |
| `rewards` | `mapping(address => uint256)` | Accumulated but unclaimed USDC per user. |
| `paused` | `bool` | When true, `stake` reverts. `withdraw` and `getReward` are always available. |

### Constants

| Name | Value | Description |
|---|---|---|
| `rewardsDuration` | `604800` | 7-day reward period in seconds. |

### Functions

| Signature | Access | Description |
|---|---|---|
| `stake(uint256 amount)` | Any (not paused) | Stakes $VYNX; checkpoints accumulator via `updateReward`. |
| `withdraw(uint256 amount)` | Any (always) | Returns staked $VYNX; never blocked by pause. |
| `getReward()` | Any | Claims pending USDC rewards; zeroes `rewards[msg.sender]` before transfer. |
| `exit()` | Any | Atomically withdraws full balance and claims all rewards. |
| `notifyRewardAmount(uint256 reward)` | `rewardsDistribution` | Recalculates `rewardRate`; handles period rollover. |
| `setPaused(bool _paused)` | `admin` | Blocks `stake` when true; `withdraw` unaffected. |

### View Functions

| Signature | Description |
|---|---|
| `lastTimeRewardApplicable()` | `min(block.timestamp, periodFinish)`. |
| `rewardPerToken()` | Cumulative reward per staked token, scaled by 1e18. |
| `earned(address account)` | Total USDC accrued by account, not yet claimed. |

### Custom Errors

| Error | Trigger |
|---|---|
| `ZeroAmount()` | `stake(0)` or `withdraw(0)`. |
| `OnlyRewardsDistribution()` | `notifyRewardAmount` from non-treasury caller. |
| `InsufficientStakeBalance(address, uint256, uint256)` | `withdraw` amount > staked balance. |
| `ContractPaused()` | `stake` when `paused == true`. |
| `ZeroAddress()` | Constructor: any address arg is `address(0)`. |
| `Unauthorized()` | `setPaused` from non-admin. |

### Events

| Event | Emitted by |
|---|---|
| `Staked(address indexed, uint256)` | `stake` |
| `Withdrawn(address indexed, uint256)` | `withdraw` |
| `RewardPaid(address indexed, uint256)` | `getReward` |
| `RewardAdded(uint256)` | `notifyRewardAmount` |

### Key Invariants

- **Supply conservation:** `IERC20(stakingToken).balanceOf(address(this)) == _totalSupply` at all times.
- **No double-claim:** After `getReward`, `rewards[msg.sender] == 0`.
- **Monotonic accumulator:** `rewardPerToken()` is non-decreasing; subtraction in `earned()` never underflows.
- **Withdraw always available:** Pause flag only blocks `stake`. Users can always exit.

---

## 8. Shared Types

**File:** `src/types/VynxTypes.sol`

### IntentState Enum

```solidity
enum IntentState {
    UNKNOWN,   // Default slot value (0). Replay protection.
    LOCKED,    // Funds held in escrow.
    REDEEMED,  // Voucher redeemed; proceeds released to solver.
    REFUNDED   // Deadline expired; funds returned to agent.
}
```

### Structs

| Struct | Fields | Used by |
|---|---|---|
| `Intent` | `intentId, agent, token, amount, solver, nonce, destinationChainId, deadline` | `lockIntent` calldata |
| `IntentEscrow` | `agent, token, amount, solver, deadline, state` | `intents` mapping storage |
| `Voucher` | `intentId, solver, amount, destTxHash, issuedAt, signature` | `claimFunds` calldata |
| `SolverInfo` | `adapter, collateralToken, totalCollateral, registeredAt, active` | `solvers` mapping storage |
| `SlashPayload` | `intentId, solver, amount, issuedAt, signature` | `executeSlash` calldata |
