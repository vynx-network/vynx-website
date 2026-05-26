# On-Chain Contracts

Authoritative ABI reference for the six contracts that make up VynX v1.0.0. All function/event/error signatures below are extracted from `bindings/abi/*.json`. Deployed testnet addresses are in `.env.example`; mainnet addresses are filled in at deployment time.

---

## 1. Deployed Addresses

### Ethereum Sepolia (chain 11155111)

| Contract | Env var | Address |
|---|---|---|
| VynxRegistry | `VYNX_REGISTRY_ADDRESS` | `0xDFFA630b9E137a88215d99c4c8A267FfC7fBCB3C` |
| DirectVaultAdapter (USDC) | `DIRECT_VAULT_ADAPTER_USDC` | `0xf048D63f4D4bBA9819e4284B2e4f5a2102e47cBA` |

### Base Sepolia (chain 84532)

| Contract | Env var | Address |
|---|---|---|
| VynxSettlement | `VYNX_SETTLEMENT_ADDRESS` | `0xA8cA9d84e35ac8F5af6F1D91fe4bE1C0BAf44296` |
| VynxTreasury | `VYNX_TREASURY_ADDRESS` | `0x653D9C2dF3A32B872aEa4E3b4e7436577C5eEB62` |
| VynxAdmin (UUPS proxy) | `VYNX_ADMIN_ADDRESS` | `0xcCa54463BD2aEDF1773E9c3f45c6a954Aa9D9706` |
| StakingRewards | `STAKING_REWARDS_ADDRESS` | `0x312510B911fA47D55c9f1a055B1987D51853A7DE` |

### Canonical USDC

| Token | Chain | Env var | Address |
|---|---|---|---|
| USDC | Base mainnet | `USDC_ADDRESS_BASE` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDC | Ethereum mainnet | `USDC_ADDRESS_ETH` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |

Mainnet contract addresses are placeholders (`0x000…000`) in `.env.example` until deployment.

---

## 2. VynxSettlement (Base L2)

The protocol-side settlement contract. Holds the agent's USDC during the auction window, releases it to the winning solver on voucher redemption, and refunds the agent on deadline expiry.

### Key functions

```solidity
lockIntent(Intent intent, bytes relayerSig)
claimFunds(Voucher voucher)
refundIntent(bytes32 intentId)
syncConfig(uint16 newTakeRateBps, address newTreasury)
setPaused(bool _paused)

DEFAULT_DEADLINE() returns (uint256)
INTENT_TYPEHASH()   returns (bytes32)
VOUCHER_TYPEHASH()  returns (bytes32)
eip712Domain()
intents(bytes32) returns (Intent)
admin() · treasury() · takeRateBps() · paused()
```

### Intent struct (8 fields)

```solidity
struct Intent {
    bytes32 intentId;
    address agent;
    address token;             // must equal USDC (Invariant 6)
    uint256 amount;
    address solver;            // chosen by the relayer
    uint256 nonce;
    uint256 destinationChainId;
    uint256 deadline;
}
```

### Voucher struct (6 fields on-chain; only 3 are signed)

```solidity
struct Voucher {
    bytes32 intentId;
    address solver;
    uint256 amount;
    bytes32 destTxHash;        // off-chain metadata — NOT in VOUCHER_TYPEHASH
    int64   issuedAt;          // off-chain metadata — NOT in VOUCHER_TYPEHASH
    bytes   signature;
}
```

**Invariant 2.** `VOUCHER_TYPEHASH` signs exactly `(intentId, solver, amount)`. `destTxHash` and `issuedAt` are passed in the on-chain call for audit trail but are explicitly excluded from the EIP-712 hash; see `internal/signer/eip712.go:31` and `:66-72`.

### Events

```
IntentLocked(bytes32 indexed intentId, address indexed agent, address indexed solver,
             address token, uint256 amount, uint64 deadline)
VoucherRedeemed(bytes32 indexed intentId, address indexed solver,
                uint256 netAmount, uint256 fee)
IntentRefunded(bytes32 indexed intentId, address indexed agent, uint256 amount)
SuspiciousRelayerActivity(bytes32 indexed intentId, address attacker, bytes32 spoofedIntentId)
ConfigSynced(uint16 newTakeRateBps, address newTreasury)
EIP712DomainChanged()
```

`SuspiciousRelayerActivity` is the trigger for the watchdog's EmergencyPause flow (see `docs/watchdog.md`).

### Custom errors (selected)

```
ContractPaused()
DeadlineNotExpired(bytes32 intentId, uint64 deadline)
IntentAlreadyExists(bytes32 intentId)
IntentNotFound(bytes32 intentId)
InvalidIntentSignature(bytes32 intentId)
InvalidVoucherSignature(bytes32 intentId)
InvalidState(bytes32 intentId, uint8 current)
SolverMismatch(bytes32 intentId, address expected, address got)
TokenNotWhitelisted(address token)
```

---

## 3. VynxRegistry (Ethereum L1)

Solver registry and slash executor. Tracks collateral via `DirectVaultAdapter` and exposes `executeSlash` as the only slashing entry point.

### Key functions

```solidity
registerSolver(address adapterAddr, address token, uint256 amount)
deregisterSolver()
executeSlash(SlashPayload payload)        // ONE argument — Invariant 1
getSHF(address solver, uint256 intentValue) returns (bool eligible)
getSolverCollateral(address solver) returns (uint256)
setAdapter(address protocol, address adapterAddr)
setSHFThreshold(uint16 newThreshold)

SHF_THRESHOLD()    returns (uint256)
REBALANCE_EPOCH()  returns (uint256)
solvers(address)   returns (SolverProfile)
adapters(address)  returns (address)
slashPool(address) returns (uint256)
```

### SlashPayload struct (5 fields; the signature is embedded)

```solidity
struct SlashPayload {
    bytes32 intentId;
    address solver;
    uint256 amount;
    int64   issuedAt;
    bytes   signature;        // Invariant 1 — Signature IS the 5th field, NOT a separate arg
}
```

**Invariant 1.** Production code must call `executeSlash(payload)` with a single argument. Passing `(payload, sig)` separately is forbidden and is flagged by `check-invariants`. The watchdog assembles the `signature` field inside `internal/watchdog/executor/slash.go` from the SlashingKey before broadcast.

### Events

```
SolverRegistered(address indexed solver, address adapter, address token, uint256 amount)
SolverDeregistered(address indexed solver, uint256 collateralReturned)
SolverSlashed(address indexed solver, bytes32 indexed intentId, uint256 amount, address adapter)
AdapterRegistered(address indexed protocol, address adapter)
SHFThresholdUpdated(uint16 oldThreshold, uint16 newThreshold)
```

`SolverSlashed` is the L1 event the Keeper reads during the cross-chain JOIN (`docs/keeper.md` §4).

### Roles

```
DEFAULT_ADMIN_ROLE
ADMIN_ROLE
KEEPER_ROLE                   // granted to the Keeper for slash-pool draining
```

### Custom errors (selected)

```
InvalidSlashSignature(bytes32 intentId)
InsufficientCollateral(address solver, uint256 required, uint256 available)
SolverAlreadyRegistered(address solver)
SolverInactive(address solver)
SolverNotFound(address solver)
AdapterNotFound(address protocol)
CollateralTokenNotWhitelisted(address token)
```

---

## 4. VynxTreasury (Base L2)

Receives take-rate from `VynxSettlement`, distributes real yield to `StakingRewards`, and disburses slash-derived compensation to affected agents. Direct L2 settlement only — no CCTP (Invariant 5).

### Key functions

```solidity
batchCompensate(address token, address[] agents, uint256[] amounts)   // Keeper only
distributeRealYield(address token)                                     // Keeper only
receiveTakeRate(address token, uint256 amount)                         // Settlement only
sweepForBuyback(address token, uint256 amount)                         // Multisig only
setPaused(bool _paused)

keeper() · multisig() · settlement() · stakingRewards() · admin() · paused()
realYieldBps() · buybackBps() · polBps()
pendingCompensations(address) returns (uint256)
yieldAccumulator(address)     returns (uint256)
buybackAccumulator(address)   returns (uint256)
polAccumulator(address)       returns (uint256)
```

### Events

```
CompensationBatchExecuted(uint256 agentCount, uint256 totalAmount, address token)
RealYieldDistributed(address indexed token, uint256 amount)
TakeRateReceived(address indexed token, uint256 amount,
                 uint256 toYield, uint256 toBuyback, uint256 toPol)
BuybackFundsSwept(address indexed token, uint256 amount, address indexed to)
```

### Custom errors (selected)

```
OnlyKeeperAllowed()
OnlySettlementAllowed()
ArrayLengthMismatch(uint256 agents, uint256 amounts)
InsufficientBuybackBalance(address token, uint256 requested, uint256 available)
```

---

## 5. VynxAdmin (Base L2, ERC1967 UUPS Proxy)

Protocol governance — pause kill-switch, take-rate updates, and contract address synchronisation. The watchdog calls `pauseAll` with the RelayerAdminKey on `SuspiciousRelayerActivity`; multisig (3/4) is required for `unpauseAll`, `setRelayerKey` rotation, and `upgradeTo`.

### Key functions

```solidity
initialize(address _relayerKey, address _watchdog, address _multisig, uint16 _takeRateBps)
pauseAll()                    // watchdog OR relayerKey
unpauseAll()                  // multisig only
setContractAddresses(address _settlement, address _treasury, address _stakingRewards)
setRelayerKey(address newKey) // multisig only — rotation entry point
setMultisig(address newMs)
setTakeRate(uint16 bps)       // bounded by MAX_TAKE_RATE
upgradeTo(address newImpl)
upgradeToAndCall(address newImplementation, bytes data)

settlement() · treasury() · stakingRewards()
relayerKey() · watchdog() · multisig() · takeRateBps() · paused()
MAX_TAKE_RATE() · UPGRADE_INTERFACE_VERSION() · proxiableUUID()
```

### Events

```
ProtocolPaused(address by, uint256 timestamp)
ProtocolUnpaused(address by, uint256 timestamp)
RelayerKeyRotated(address indexed oldKey, address indexed newKey)
TakeRateUpdated(uint16 oldBps, uint16 newBps)
Upgraded(address indexed implementation)
Initialized(uint64 version)
```

### Custom errors (selected)

```
AlreadyPaused()
NotPaused()
InvalidTakeRate(uint16 bps)
Unauthorized()
UUPSUnsupportedProxiableUUID(bytes32 slot)
UUPSUnauthorizedCallContext()
ERC1967InvalidImplementation(address implementation)
```

**Note on pause idempotency.** The watchdog's `pause` executor must treat `AlreadyPaused()` revert as success (`docs/watchdog.md` §7) — re-pausing an already-paused protocol is not an error.

---

## 6. DirectVaultAdapter (Ethereum L1, USDC only)

The single collateral adapter for VynX v1.0.0. WETH and wstETH adapters exist in the bindings tree but are not deployed (Invariant 6 — USDC-only). Called by `VynxRegistry`; never called directly by any VynX binary.

### Key functions

```solidity
deposit(address solver, uint256 amount)      // VynxRegistry only
withdraw(address solver, uint256 amount)     // VynxRegistry only
slash(address solver, uint256 amount)        // VynxRegistry only
getCollateral(address solver) returns (uint256)
totalCustody() returns (uint256)
collateralToken() returns (address)          // USDC_ADDRESS_ETH
```

### Events

```
CollateralDeposited(address indexed solver, uint256 amount)
CollateralWithdrawn(address indexed solver, uint256 amount)
CollateralSlashed(address indexed solver, uint256 amount)
```

### Custom errors

```
InsufficientBalance(address solver, uint256 requested, uint256 available)
ZeroAddress()
ZeroAmount()
SafeERC20FailedOperation(address token)
ReentrancyGuardReentrantCall()
```

---

## 7. StakingRewards (Base L2)

Synthetix-style staking pool funded by `VynxTreasury.distributeRealYield`. Stakes the VynX governance token; rewards in USDC.

### Key functions

```solidity
stake(uint256 amount)
withdraw(uint256 amount)
getReward()
exit()                                   // withdraw + getReward
notifyRewardAmount(uint256 reward)       // rewardsDistribution only (Treasury)
setPaused(bool _paused)

earned(address account) returns (uint256)
rewardPerToken()        returns (uint256)
lastTimeRewardApplicable()
periodFinish() · rewardRate() · rewardsDuration() · lastUpdateTime()
stakingToken() · rewardsToken() · admin() · rewardsDistribution() · paused()
```

### Events

```
Staked(address indexed user, uint256 amount)
Withdrawn(address indexed user, uint256 amount)
RewardPaid(address indexed user, uint256 reward)
RewardAdded(uint256 reward)
```

### Custom errors (selected)

```
ContractPaused()
InsufficientStakeBalance(address user, uint256 requested, uint256 available)
OnlyRewardsDistribution()
RewardsDurationNotFinished(uint256 periodFinish)
```

---

## See also

- [`docs/architecture.md`](architecture.md) — protocol overview, invariants, trust model
- [`docs/relayer.md`](relayer.md) — how `lockIntent` and `claimFunds` are invoked
- [`docs/watchdog.md`](watchdog.md) — how `executeSlash` and `pauseAll` are invoked
- [`docs/keeper.md`](keeper.md) — how `batchCompensate` and `distributeRealYield` are invoked
- `bindings/abi/*.json` — the source ABIs that produced this reference
