# VynX Settlement V1 — Contract Reference

Per-contract technical reference for the VynX Settlement V1 protocol. Every state variable,
constant, function signature, custom error, event, and invariant below is taken directly from
the source in `src/`. The code is canonical.

Common conventions across the codebase:
- Solidity `0.8.35`; OpenZeppelin v5 via git submodules.
- All revert conditions use custom errors (no revert strings).
- State variables are never initialised to default values (forcing the `PUSH0` opcode).

---

## Shared Types — `src/types/VynxTypes.sol`

### `enum IntentState`

| Value | Name | Meaning |
| --- | --- | --- |
| 0 | `UNKNOWN` | Default slot; never written. Acts as replay protection. |
| 1 | `LOCKED` | Funds held in escrow, awaiting voucher settlement. |
| 2 | `REDEEMED` | Voucher redeemed; net proceeds released to the solver. |
| 3 | `REFUNDED` | Deadline expired; full amount returned to the agent. |

### `struct Intent`

| Field | Type | Notes |
| --- | --- | --- |
| `intentId` | `bytes32` | Unique identifier (derived off-chain). |
| `agent` | `address` | Originating AI agent wallet. Encoded as `user` in the EIP-712 struct hash. |
| `token` | `address` | ERC-20 token to lock. |
| `amount` | `uint256` | Amount to lock in escrow. |
| `solver` | `address` | Winning solver assigned to fulfil the payment. |
| `nonce` | `uint256` | Monotonic counter; prevents intent replay. |
| `destinationChainId` | `uint256` | Target chain for the off-chain payment leg. |
| `deadline` | `uint256` | EIP-712 signature validity cutoff. |

### `struct IntentEscrow`

| Field | Type | Notes |
| --- | --- | --- |
| `agent` | `address` | Refund recipient on deadline expiry. |
| `token` | `address` | Token held in escrow. |
| `amount` | `uint256` | Amount locked. |
| `solver` | `address` | Sole authorized recipient of net proceeds. |
| `deadline` | `uint64` | `block.timestamp + DEFAULT_DEADLINE`. |
| `state` | `IntentState` | Current lifecycle position. |

### `struct Voucher`

| Field | Type | Signed? | Notes |
| --- | --- | --- | --- |
| `intentId` | `bytes32` | Yes | Intent this voucher settles. |
| `solver` | `address` | Yes | Validated against `IntentEscrow.solver`. |
| `amount` | `uint256` | Yes | Amount being claimed. |
| `destTxHash` | `bytes32` | No | Off-chain metadata only. |
| `issuedAt` | `int64` | No | Off-chain metadata only. |
| `signature` | `bytes` | — | EIP-712 signature over `{intentId, solver, amount}`. |

### `struct SolverInfo`

| Field | Type | Notes |
| --- | --- | --- |
| `adapter` | `address` | Adapter custodying this solver's collateral. |
| `collateralToken` | `address` | Posted collateral token (whitelist entry). |
| `totalCollateral` | `uint256` | Current collateral; decremented on each slash. |
| `registeredAt` | `uint256` | `block.timestamp` at registration. |
| `active` | `bool` | Set false permanently on deregistration. |

### `struct SlashPayload`

| Field | Type | Notes |
| --- | --- | --- |
| `intentId` | `bytes32` | Intent that triggered the slash. |
| `solver` | `address` | Solver whose collateral is seized. |
| `agent` | `address` | Affected agent; recipient of the 5%-of-input share. |
| `inputAmount` | `uint256` | Defaulted order input; the 10% total and 5%/5% split are derived from this on-chain. |
| `issuedAt` | `int64` | Timestamp the Keeper Bot issued the payload. |
| `signature` | `bytes` | ECDSA signature retained for off-chain audit trails. **Not verified on-chain.** |

---

## VynxRegistry — `src/l1/VynxRegistry.sol`

Immutable solver collateral registry on Ethereum L1. Inherits `AccessControl` and
`ReentrancyGuard`.

### Roles & Constants

| Name | Type | Value | Notes |
| --- | --- | --- | --- |
| `ADMIN_ROLE` | `bytes32` | `DEFAULT_ADMIN_ROLE` | Governs `setSHFThreshold`, `setAdapter`. |
| `KEEPER_ROLE` | `bytes32` | `keccak256("KEEPER_ROLE")` | Governs `executeSlash`. |
| `REBALANCE_EPOCH` | `uint32` | `604_800` | **Vestigial** public constant. No rebalance logic consumes it; it remains as an ABI getter only. |
| `SLASH_TOTAL_BPS` | `uint256` | `1000` | Slash total = 10% of input. |
| `AGENT_SHARE_BPS` | `uint256` | `500` | Agent compensation = 5% of input. |

### State Variables

| Name | Type | Notes |
| --- | --- | --- |
| `SHF_THRESHOLD` | `uint16` | Solver Health Factor threshold (default 120 = 1.20×). |
| `treasury` | `address immutable` | Protocol treasury recipient of the treasury slash share (L1). |
| `solvers` | `mapping(address => SolverInfo)` | Solver registry. |
| `adapters` | `mapping(address => IVaultAdapter)` | Approved adapters keyed by adapter address. |
| `slashPool` | `mapping(address => uint256)` | **Cumulative accounting ledger** of total slashed per solver. Holds no funds. |
| `_whitelistedCollateral` | `mapping(address => bool)` (private) | Whitelisted L1 collateral tokens. |

Whitelisted L1 collateral (set in constructor): USDC `0xA0b8…eB48`, USDT `0xdAC1…ec7`,
WETH `0xC02a…Cc2`, cbBTC `0xcbB7…33Bf`, wstETH `0x7f39…2Ca0`.

### Functions

| Signature | Access | Notes |
| --- | --- | --- |
| `registerSolver(address adapterAddr, address token, uint256 amount)` | `external nonReentrant` | Permissionless; registers `msg.sender`. Solver must approve the adapter (not the registry). |
| `deregisterSolver()` | `external nonReentrant` | Permissionless; sets `active = false`, withdraws full collateral. |
| `executeSlash(SlashPayload calldata payload)` | `external nonReentrant onlyRole(KEEPER_ROLE)` | Derives 10% total and 5%/5% split; distributes on-chain. |
| `setSHFThreshold(uint16 newThreshold)` | `external onlyRole(ADMIN_ROLE)` | Emits `SHFThresholdUpdated`. |
| `setAdapter(address protocol, address adapterAddr)` | `external onlyRole(ADMIN_ROLE)` | Emits `AdapterRegistered`. |
| `getSolverCollateral(address solver)` | `external view` | Reads adapter balance. |
| `getSHF(address solver, uint256 intentValue)` | `external view` | Eligible iff `getCollateral >= intentValue * SHF_THRESHOLD / 100`. |

### Custom Errors

| Error | Trigger |
| --- | --- |
| `SolverAlreadyRegistered(address solver)` | Register while already registered/active. |
| `SolverNotFound(address solver)` | Operation on an unregistered solver. |
| `SolverInactive(address solver)` | Slash targets a non-active solver. |
| `AdapterNotFound(address protocol)` | Register with an unregistered adapter. |
| `CollateralTokenNotWhitelisted(address token)` | Register with a non-whitelisted token. |
| `InsufficientCollateral(address solver, uint256 required, uint256 available)` | Adapter balance below slash total. |
| `ZeroAddress` | Constructor argument is zero (implementation-level guard). |

### Events

- `SolverRegistered(address indexed solver, address adapter, address token, uint256 amount)`
- `SolverSlashed(address indexed solver, bytes32 indexed intentId, uint256 inputAmount, uint256 slashTotal, address agent, uint256 agentShare, address treasury, uint256 treasuryShare, address adapter)` — **9 fields**.
- `SolverDeregistered(address indexed solver, uint256 collateralReturned)`
- `SHFThresholdUpdated(uint16 oldThreshold, uint16 newThreshold)`
- `AdapterRegistered(address indexed protocol, address indexed adapter)`

### Invariants

- The registry holds zero net token balance from a slash: it receives `slashTotal` from the
  adapter and forwards `agentShare + treasuryShare == slashTotal` in the same call.
- `agentShare + treasuryShare == slashTotal` exactly (treasury absorbs integer-division dust).
- `slashPool[solver]` only ever increases and is an accounting ledger, never a custody balance.

---

## DirectVaultAdapter — `src/adapters/DirectVaultAdapter.sol`

Production V1 adapter providing direct ERC-20 custody of solver collateral (no underlying
yield-bearing protocol). Inherits `ReentrancyGuard`.

### Immutables & State

| Name | Type | Notes |
| --- | --- | --- |
| `collateralToken` | `address immutable` | ERC-20 token this adapter custodies. |
| `registry` | `address immutable` | The sole authorized slasher; receives seized funds. |
| `_balances` | `mapping(address => uint256)` (private) | Per-solver custodied balance. |

### Functions

| Signature | Access | Notes |
| --- | --- | --- |
| `deposit(address solver, uint256 amount)` | `external nonReentrant` | No caller restriction; registry is the intended caller. Pulls tokens from `solver` via `safeTransferFrom` — the solver must approve **this adapter**, not the registry. |
| `withdraw(address solver, uint256 amount)` | `external nonReentrant` | No caller restriction; registry is the intended caller. Returns tokens to `solver`. |
| `slash(address solver, uint256 amount)` | `external nonReentrant onlyRegistry` | Transfers the seized amount to the registry. |
| `getCollateral(address solver)` | `external view` | Returns `_balances[solver]`. |
| `totalCustody()` | `external view` | Returns the adapter's ERC-20 balance of `collateralToken`. |

### Custom Errors

| Error | Trigger |
| --- | --- |
| `ZeroAddress` | Constructor token or registry is zero. |
| `ZeroAmount` | `deposit`/`withdraw`/`slash` with amount `0`. |
| `NotRegistry` | `slash` caller is not the registry. |
| `InsufficientBalance(address solver, uint256 requested, uint256 available)` | Withdraw or slash exceeds `_balances[solver]`. |

### Events

- `CollateralDeposited(address indexed solver, uint256 amount)`
- `CollateralWithdrawn(address indexed solver, uint256 amount)`
- `CollateralSlashed(address indexed solver, uint256 amount)`

### Invariants

- No funds are retained after a slash: the seized amount is transferred to the registry within
  the same call.
- `totalCustody()` equals the sum of all active solver `_balances` under honest accounting.

---

## VynxToken — `src/tokens/VynxToken.sol`

The $VYNX governance and staking token. `ERC20("VynX", "VYNX")` + `ERC20Permit("VynX")` +
`Ownable`.

| Signature | Access | Notes |
| --- | --- | --- |
| `constructor(address initialOwner)` | — | Sets the owner (the multisig). |
| `mint(address to, uint256 amount)` | `external onlyOwner` | Mints to `to`. |

EIP-2612 permit is inherited from `ERC20Permit`, enabling gasless approvals. There is no fixed
cap and no custom error surface beyond the inherited OpenZeppelin behaviour.

---

## VynxAdmin — `src/l2/VynxAdmin.sol`

UUPS-upgradeable protocol administration hub on Base L2. **The only upgradeable contract in the
system.** Inherits `UUPSUpgradeable` and `Initializable`. `OwnableUpgradeable` is **not** used —
ownership is replaced by explicit `watchdog` and `multisig` role addresses.

### Constants

| Name | Type | Value | Notes |
| --- | --- | --- | --- |
| `MAX_TAKE_RATE` | `uint16` | `20` | Hard cap on the take rate (0.20%). |

### State Variables

| Name | Type | Notes |
| --- | --- | --- |
| `relayerKey` | `address` | Read cross-contract by Settlement on every call; never cached there. |
| `takeRateBps` | `uint16` | Protocol take rate in `[0, MAX_TAKE_RATE]`. |
| `settlement` | `address` | Registered Settlement; target of `syncConfig`/`setPaused`. |
| `treasury` | `address` | Registered Treasury. |
| `stakingRewards` | `address` | Registered StakingRewards; target of `setPaused`. |
| `watchdog` | `address` | Pause + relayer-key rotation. Can NEVER unpause. |
| `multisig` | `address` | Unpause + upgrade + config. Can NEVER pause. |
| `paused` | `bool` | Global pause flag. |

### Functions

| Signature | Access | Notes |
| --- | --- | --- |
| `constructor()` | — | Calls `_disableInitializers()` to lock the implementation. |
| `initialize(address _relayerKey, address _watchdog, address _multisig, uint16 _takeRateBps)` | `external initializer` | One-time proxy init. |
| `pauseAll()` | `watchdog` only | Propagates `setPaused(true)` to Settlement, Treasury, StakingRewards. Reverts `AlreadyPaused`. |
| `unpauseAll()` | `multisig` only | Propagates `setPaused(false)` to all three. Reverts `NotPaused`. |
| `setRelayerKey(address newKey)` | `watchdog` only | Rotates the key; then calls `settlement.syncConfig(takeRateBps, treasury)`. |
| `setTakeRate(uint16 bps)` | `multisig` only | `bps <= MAX_TAKE_RATE`; propagates via `syncConfig`. |
| `setMultisig(address newMs)` | `multisig` only | Transfers the multisig role. |
| `upgradeTo(address newImpl)` | `multisig` only | Calls `upgradeToAndCall(newImpl, "")`. |
| `setContractAddresses(address _settlement, address _treasury, address _stakingRewards)` | `multisig` only | One-time post-deployment wiring. |
| `_authorizeUpgrade(address)` | `internal view override` | Second multisig gate on the UUPS path. |

### Custom Errors

| Error | Trigger |
| --- | --- |
| `Unauthorized` | Caller is not the required role. |
| `InvalidTakeRate(uint16 bps)` | Proposed rate exceeds `MAX_TAKE_RATE`. |
| `ZeroAddress` | Required address argument is zero. |
| `AlreadyPaused` | `pauseAll` while already paused. |
| `NotPaused` | `unpauseAll` while not paused. |

### Events

- `RelayerKeyRotated(address oldKey, address newKey)`
- `TakeRateUpdated(uint16 oldBps, uint16 newBps)`
- `ProtocolPaused(address indexed by, uint256 timestamp)`
- `ProtocolUnpaused(address indexed by, uint256 timestamp)`

### Invariants

- The watchdog can never unpause; the multisig can never pause (asymmetric authority).
- Only the multisig can authorise a UUPS upgrade (gated in both `upgradeTo` and
  `_authorizeUpgrade`).
- `relayerKey` is never propagated to Settlement via `syncConfig`; it is read on demand.

---

## VynxSettlement — `src/l2/VynxSettlement.sol`

Immutable intent escrow and settlement contract on Base L2. Inherits `ReentrancyGuard` and
`EIP712`.

### Constants

```solidity
bytes32 public constant INTENT_TYPEHASH = keccak256(
    "Intent(uint256 nonce,address user,address token,uint256 amount,uint256 destinationChainId,uint256 deadline)"
);
bytes32 public constant VOUCHER_TYPEHASH = keccak256(
    "Voucher(bytes32 intentId,address solver,uint256 amount)"
);
uint64 public constant DEFAULT_DEADLINE = 900; // 15 minutes
```

EIP-712 domain: `EIP712("VynxSettlement", "1")` — commits to name, version, `chainId`,
`verifyingContract`.

### State Variables

| Name | Type | Notes |
| --- | --- | --- |
| `admin` | `address immutable` | VynxAdmin; source of truth for `relayerKey`; sole caller of `syncConfig`/`setPaused`. |
| `treasury` | `address` | Take-rate recipient; updated via `syncConfig`. |
| `takeRateBps` | `uint16` | Take rate in `[0, 20]`; updated via `syncConfig`. |
| `paused` | `bool` | When true, `lockIntent` and `claimFunds` revert. |
| `intents` | `mapping(bytes32 => IntentEscrow)` | Central escrow registry. |

### Functions

| Signature | Access | Notes |
| --- | --- | --- |
| `lockIntent(Intent calldata intent, bytes calldata relayerSig)` | `external nonReentrant` | UNKNOWN → LOCKED. Verifies EIP-712 over the intent vs `relayerKey()`. Sets `deadline = now + 900`; pulls tokens from `intent.agent`. |
| `claimFunds(Voucher calldata voucher)` | `external nonReentrant` | LOCKED → REDEEMED. Verifies voucher signature; pays `net` to solver, `fee` to treasury. |
| `refundIntent(bytes32 intentId)` | `external nonReentrant` | Permissionless after deadline. LOCKED → REFUNDED. Returns full amount to agent. |
| `syncConfig(uint16 newTakeRateBps, address newTreasury)` | `admin` only | Updates economic params. Emits `ConfigSynced`. |
| `setPaused(bool _paused)` | `admin` only | Pause propagation. |
| `_deductTakeRate(uint256 amount)` | `internal view` | `fee = amount * takeRateBps / 10_000` (`unchecked`); `net = amount - fee`. |

`claimFunds` fee handling: `fee = amount * takeRateBps / 10_000` (integer floor; the remainder
accrues to the solver and is never lost). When `fee > 0`, the fee is transferred to the treasury
and `IVynxTreasury(treasury).receiveTakeRate(token, fee)` is called. A second `claimFunds` on a
REDEEMED intent reverts `InvalidState`. If the escrow is `UNKNOWN` on a claim, the contract
emits `SuspiciousRelayerActivity` and reverts `InvalidState`.

### Custom Errors

| Error | Trigger |
| --- | --- |
| `IntentAlreadyExists(bytes32 intentId)` | Lock with a non-UNKNOWN intent ID. |
| `IntentNotFound(bytes32 intentId)` | Refund an intent with no escrow record. |
| `InvalidState(bytes32 intentId, IntentState current)` | Operation against an intent in the wrong state. |
| `DeadlineNotExpired(bytes32 intentId, uint64 deadline)` | Refund before `block.timestamp > deadline`. |
| `InvalidVoucherSignature(bytes32 intentId)` | Voucher signer != `relayerKey()`. |
| `InvalidIntentSignature(bytes32 intentId)` | Intent signer != `relayerKey()`. |
| `SolverMismatch(bytes32 intentId, address expected, address got)` | `voucher.solver` != escrow solver. |
| `ContractPaused` | `lockIntent`/`claimFunds` while paused. |
| `Unauthorized` | `syncConfig`/`setPaused` caller != `admin`. |
| `ZeroAddress` | Constructor/`syncConfig` zero treasury (implementation-level guard). |
| `InvalidTakeRate(uint16 bps)` | Constructor take rate > 20 (implementation-level guard). |

### Events

- `IntentLocked(bytes32 indexed intentId, address indexed agent, address indexed solver, address token, uint256 amount, uint64 deadline)`
- `VoucherRedeemed(bytes32 indexed intentId, address indexed solver, uint256 netAmount, uint256 fee)`
- `IntentRefunded(bytes32 indexed intentId, address indexed agent, uint256 amount)`
- `SuspiciousRelayerActivity(bytes32 indexed intentId, address indexed attacker, bytes32 spoofedIntentId)`
- `ConfigSynced(uint16 newTakeRateBps, address newTreasury)`

### Invariants

- State transitions are unidirectional; REDEEMED/REFUNDED are terminal.
- `net + fee == amount` for every redeemed intent.
- The escrow USDC balance is always at least the sum of all LOCKED amounts (solvency).

---

## VynxTreasury — `src/l2/VynxTreasury.sol`

Immutable protocol treasury on Base L2. Inherits `ReentrancyGuard`.

### Constants

| Name | Type | Value | Notes |
| --- | --- | --- | --- |
| `realYieldBps` | `uint8` | `40` | **Vestigial** ABI getter. The split logic hardcodes the literal `40/100`; this constant is not read by the logic. |
| `buybackBps` | `uint8` | `50` | **Vestigial** ABI getter. The split logic hardcodes `50/100`; not read by the logic. |
| `polBps` | `uint8` | `10` | **Vestigial** ABI getter. POL is computed as the arithmetic remainder; not read by the logic. |

### State Variables

| Name | Type | Notes |
| --- | --- | --- |
| `admin` | `address immutable` | Sole caller of `setPaused`. |
| `settlement` | `address immutable` | Only address permitted to call `receiveTakeRate`. |
| `stakingRewards` | `address immutable` | Real-yield destination. |
| `keeper` | `address` | `batchCompensate` and `distributeRealYield`. |
| `multisig` | `address` | `sweepForBuyback`. |
| `paused` | `bool` | Stored flag; **no Treasury function reads it** (pause is enforced in Settlement). |
| `yieldAccumulator` | `mapping(address => uint256)` | Per-token yield awaiting distribution. |
| `buybackAccumulator` | `mapping(address => uint256)` | Per-token buyback awaiting sweep. |
| `polAccumulator` | `mapping(address => uint256)` | Per-token POL retained. |
| `pendingCompensations` | `mapping(address => uint256)` | Per-agent pending compensation balances. |

### Functions

| Signature | Access | Notes |
| --- | --- | --- |
| `receiveTakeRate(address token, uint256 amount)` | `settlement` only | Pure accounting (tokens already transferred in). `toYield = amount*40/100`, `toBuyback = amount*50/100`, `toPol = amount - toYield - toBuyback`. |
| `batchCompensate(address token, address[] agents, uint256[] amounts)` | `keeper` only, `nonReentrant` | Direct on-chain (Base L2) compensation transfers. |
| `distributeRealYield(address token)` | `admin` or `keeper` | CEI: zeroes accumulator, transfers to StakingRewards, calls `notifyRewardAmount`. |
| `sweepForBuyback(address token, uint256 amount)` | `multisig` only | CEI: decrements accumulator, transfers to multisig. |
| `setPaused(bool _paused)` | `admin` only | Stores the flag (unenforced here). |

### Custom Errors

| Error | Trigger |
| --- | --- |
| `OnlySettlementAllowed` | `receiveTakeRate` caller != settlement. |
| `OnlyKeeperAllowed` | `batchCompensate` caller != keeper. |
| `ArrayLengthMismatch(uint256 agents, uint256 amounts)` | `batchCompensate` length mismatch. |
| `ZeroAmount` | `receiveTakeRate` amount `0` or `distributeRealYield` empty accumulator. |
| `InsufficientBuybackBalance(address token, uint256 requested, uint256 available)` | Sweep exceeds buyback accumulator. |
| `ZeroAddress` | Constructor argument is zero (implementation-level guard). |
| `Unauthorized` | `distributeRealYield`/`sweepForBuyback`/`setPaused` caller lacks the role. |

### Events

- `TakeRateReceived(address indexed token, uint256 amount, uint256 toYield, uint256 toBuyback, uint256 toPol)`
- `CompensationBatchExecuted(uint256 agentCount, uint256 totalAmount, address token)`
- `RealYieldDistributed(address indexed token, uint256 amount)`
- `BuybackFundsSwept(address indexed token, uint256 amount, address indexed to)`

### Invariants

- `toYield + toBuyback + toPol == amount` for every inflow (no rounding leakage; POL absorbs
  truncation).
- Every received fee wei is either held in one of the three accumulators or has been distributed
  to StakingRewards.

---

## StakingRewards — `src/l2/StakingRewards.sol`

Immutable Synthetix-pattern staking contract on Base L2, rewritten from scratch for 0.8.35 with
zero SafeMath. Inherits `ReentrancyGuard`. Stakers deposit $VYNX and earn USDC real yield.

### Constants & Immutables

| Name | Type | Value / Notes |
| --- | --- | --- |
| `rewardsDuration` | `uint256` | `604800` (7 days). |
| `rewardsToken` | `address immutable` | USDC on Base. |
| `stakingToken` | `address immutable` | $VYNX. |
| `rewardsDistribution` | `address immutable` | VynxTreasury; sole caller of `notifyRewardAmount`. |
| `admin` | `address immutable` | VynxAdmin; sole caller of `setPaused`. |

### State Variables

| Name | Type | Notes |
| --- | --- | --- |
| `rewardRate` | `uint256` | USDC-per-second emission across all stakers. |
| `rewardPerTokenStored` | `uint256` | Global accumulator, scaled by 1e18; monotonically non-decreasing. |
| `lastUpdateTime` | `uint256` | Last accumulator update timestamp. |
| `periodFinish` | `uint256` | End of the current emission period. |
| `userRewardPerTokenPaid` | `mapping(address => uint256)` | Per-user watermark. |
| `rewards` | `mapping(address => uint256)` | Per-user accrued, unclaimed USDC. |
| `_totalSupply` | `uint256` (private) | Total $VYNX staked. |
| `_balances` | `mapping(address => uint256)` (private) | Per-user staked balance. |
| `paused` | `bool` | Only `stake` checks this flag. |

### Functions

| Signature | Access | Notes |
| --- | --- | --- |
| `stake(uint256 amount)` | `public nonReentrant updateReward(msg.sender)` | Reverts `ContractPaused`/`ZeroAmount`. |
| `withdraw(uint256 amount)` | `public nonReentrant updateReward(msg.sender)` | **Not pausable** — users can always exit. |
| `getReward()` | `public nonReentrant updateReward(msg.sender)` | Zeroes `rewards[msg.sender]` before transfer (no double-claim); no-op if zero. |
| `exit()` | `external` | `withdraw(_balances[msg.sender])` then `getReward()`. |
| `notifyRewardAmount(uint256 reward)` | `rewardsDistribution` only, `updateReward(address(0))` | New period or rollover of remaining rewards. |
| `setPaused(bool _paused)` | `admin` only | Toggles `paused` (only affects `stake`). |
| `lastTimeRewardApplicable()` | `public view` | `min(block.timestamp, periodFinish)`. |
| `rewardPerToken()` | `public view` | Returns `rewardPerTokenStored` when `_totalSupply == 0`. |
| `earned(address account)` | `public view` | `_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account]`. |

`unchecked` proofs (documented in source):
- `rewardPerToken()` — the accumulation term `(timeDelta * rewardRate * 1e18 / _totalSupply)`
  has a proven maximum (≈ 4.4e34) far below `uint256.max`; the subtraction
  `lastTimeRewardApplicable() - lastUpdateTime` cannot underflow because `lastUpdateTime` is
  always set to `lastTimeRewardApplicable()`.
- `earned()` — `rewardPerToken() >= userRewardPerTokenPaid[account]` always holds (monotonic
  accumulator), so the subtraction is safe under checked arithmetic.

### Custom Errors

| Error | Trigger |
| --- | --- |
| `ZeroAmount` | `stake`/`withdraw` with amount `0`. |
| `OnlyRewardsDistribution` | `notifyRewardAmount` caller != `rewardsDistribution`. |
| `InsufficientStakeBalance(address user, uint256 requested, uint256 available)` | Withdraw exceeds staked balance. |
| `ContractPaused` | `stake` while paused. |
| `ZeroAddress` | Constructor argument is zero (implementation-level guard). |
| `Unauthorized` | `setPaused` caller != `admin`. |

### Events

- `Staked(address indexed user, uint256 amount)`
- `Withdrawn(address indexed user, uint256 amount)`
- `RewardPaid(address indexed user, uint256 reward)`
- `RewardAdded(uint256 reward)`

### Invariants

- Supply conservation: `_totalSupply == Σ(_balances)`; the contract's $VYNX balance equals the
  net staked amount.
- No double-claim: `rewards[account] == 0` immediately after `getReward`.
- `rewardPerToken()` is monotonically non-decreasing.
