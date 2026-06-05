# On-Chain Contracts

> Authoritative reference for the six VynX contracts. Every signature below is
> extracted from `bindings/abi/*.json` (regenerate Go bindings with
> `make gen-bindings`). Where this doc and the ABI disagree, the **ABI wins**.

| Contract | Chain | Role |
|---|---|---|
| `VynxRegistry` | Ethereum **L1** | Solver registration, SHF, **slashing**. |
| `DirectVaultAdapter` | Ethereum **L1** | USDC collateral custody for the registry. |
| `VynxSettlement` | Base **L2** | Intent lock, voucher redemption, refund. |
| `VynxTreasury` | Base **L2** | `batchCompensate`, yield, take-rate accounting. |
| `VynxAdmin` | Base **L2** | UUPS proxy / governance: pause, config, upgrades. |
| `StakingRewards` | Base **L2** | Synthetix-style staking rewards. |

Two invariants are anchored in these ABIs:

- **Invariant 1** — `VynxRegistry.executeSlash(tuple)` takes **one** struct argument
  (`SlashPayload`); the signature is embedded *inside* it.
- **Invariant 2** — `VynxSettlement.VOUCHER_TYPEHASH` signs only `(intentId, solver,
  amount)`.

---

## 1. VynxRegistry (L1)

**Key functions**

| Function | Mutability | Notes |
|---|---|---|
| `executeSlash(tuple payload)` | nonpayable | **ONE arg** (Invariant 1). Slashing is `KEEPER_ROLE`-wallet-gated. |
| `registerSolver(address adapter, address token, uint256 amount)` | nonpayable | |
| `deregisterSolver()` | nonpayable | |
| `getSHF(address solver, uint256 intentValue)` | view | Returns `eligible bool`. |
| `getSolverCollateral(address)` / `slashPool(address)` / `solvers(address)` | view | |
| `setAdapter`, `setSHFThreshold` | nonpayable | |
| `AGENT_SHARE_BPS`, `SLASH_TOTAL_BPS`, `SHF_THRESHOLD`, `REBALANCE_EPOCH` | view | Protocol constants. |
| `ADMIN_ROLE`, `KEEPER_ROLE`, `grantRole`, `hasRole`, … | — | OpenZeppelin AccessControl. |

**`SlashPayload` struct** (the `executeSlash` tuple):

```
intentId   bytes32
solver     address
agent      address
inputAmount uint256
issuedAt   int64
signature  bytes      ← embedded; never a separate argument
```

**Events**

| Event | Fields |
|---|---|
| `SolverSlashed` | `solver, intentId, inputAmount, slashTotal, agent, agentShare, treasury, treasuryShare, adapter` — **9 fields** (BLINDAJE A.2; the agent's 5% on-chain share is in `agentShare`). |
| `SolverRegistered` | `solver, adapter, token, amount` |
| `SolverDeregistered` | `solver, collateralReturned` |
| `AdapterRegistered`, `SHFThresholdUpdated`, `Role{Granted,Revoked,AdminChanged}` | — |

> **Binding drift (known):** the ABI still lists the error `InvalidSlashSignature`,
> but the on-chain contract no longer reverts with it — slashing moved to
> `KEEPER_ROLE`-wallet gating. Re-extract on the next `make gen-bindings`. Tracked
> in [`mainnet_checklist.md`](mainnet_checklist.md).

---

## 2. VynxSettlement (L2)

**Key functions**

| Function | Mutability | Notes |
|---|---|---|
| `lockIntent(tuple intent, tuple auth)` | nonpayable | **GASLESS REDESIGN** — the **winning solver** locks the agent's input USDC, paying the gas. `intent` is the 9-field struct (8 agent-signed terms + `solver`; caller must equal `intent.solver` — `SolverMismatchOnLock`); `auth` is the agent's EIP-3009 signature as `(uint8 v, bytes32 r, bytes32 s)` (the 65-byte `r‖s‖v` from `AuctionWonFrame.authorization`, split). The contract recomputes the terms-nonce and calls `USDC.receiveWithAuthorization` — Circle verifies the agent's signature. Emits `IntentLocked`. |
| `claimFunds(tuple voucher)` | nonpayable | Solver redeems the relayer-signed voucher (Invariant 2 `VOUCHER_TYPEHASH`; replay-protected, BLINDAJE A.19). `voucher` is the 6-field struct `(intentId, solver, amount, destTxHash, issuedAt, signature)` — only the first three are EIP-712-signed; the signature must recover to `IVynxAdmin(admin).relayerKey()` (read cross-contract on every call) and its last byte must be Ethereum-form `v ∈ {27,28}` (the witness emits raw `{0,1}` — consumers normalize, see [`solver.md`](solver.md) §6.2). Pays `escrow.amount − fee` to `voucher.solver` and the `fee = amount·takeRateBps/10_000` to the treasury (which also gets `receiveTakeRate` called). Emits `VoucherRedeemed`. |
| `refundIntent(bytes32 intentId)` | nonpayable | **Permissionless**, deadline + state gated (BLINDAJE A.17). The Watchdog's W4 calls it. |
| `takeRateBps()` / `setPaused(bool)` / `syncConfig(uint16, address)` | view/nonpayable | Take-rate math, BLINDAJE A.18. |
| `VOUCHER_TYPEHASH`, `eip712Domain`, `intents(bytes32)`, `usdc()`, `DEFAULT_DEADLINE`, `paused`, `treasury` | view | No `INTENT_TYPEHASH` anymore — intent authenticity is EIP-3009 (the agent signs USDC's domain, not the settlement's). |

**Events**

| Event | Fields |
|---|---|
| `IntentLocked` | `intentId, agent, token, solver?, amount, deadline(uint64)` |
| `IntentRefunded` | `intentId, agent, amount` — the Keeper reads these as its blind agent source. |
| `VoucherRedeemed` | `intentId (indexed), solver (indexed), netAmount, fee` — watched by the relayer's G13 `VoucherRedeemedWatcher` (archives the intent, closing voucher delivery). |
| `SuspiciousRelayerActivity` | `intentId, relayer, reason` — drives the Watchdog fraud path. |
| `ConfigSynced`, `EIP712DomainChanged` | — |

Key errors: `DeadlineNotExpired`, `InvalidVoucherSignature`, `InvalidState`,
`SolverMismatch`, `SolverMismatchOnLock`, `IntentAlreadyExists`,
`TokenNotSupported`, `ContractPaused`.

---

## 3. VynxAdmin (L2 — UUPS proxy)

The protocol's governance and **upgradeable proxy** (UUPS: `upgradeTo`,
`upgradeToAndCall`, `proxiableUUID`, `UPGRADE_INTERFACE_VERSION`). Always interact
through the proxy address.

| Function | Notes |
|---|---|
| `pauseAll()` / `unpauseAll()` | Emergency circuit breaker (BLINDAJE A.20). `pauseAll` is signed by the Watchdog's **RelayerAdminKey**. |
| `setRelayerKey(address)` | Rotate the relayer signer (emits `RelayerKeyRotated`). |
| `setTakeRate(uint16)`, `MAX_TAKE_RATE`, `setContractAddresses`, `setMultisig` | Config. |
| `watchdog()`, `relayerKey()`, `multisig()`, `settlement()`, `treasury()`, `stakingRewards()` | Wiring views. |

Events: `ProtocolPaused(account, timestamp)`, `ProtocolUnpaused`, `RelayerKeyRotated`,
`TakeRateUpdated`, `Upgraded`, `Initialized`.

---

## 4. VynxTreasury (L2)

| Function | Mutability | Notes |
|---|---|---|
| `batchCompensate(address token, address[] agents, uint256[] amounts)` | nonpayable | **Invariant 5** — direct L2 transfer; `OnlyKeeperAllowed`. No bridge. |
| `distributeRealYield(address token)` | nonpayable | Keeper yield leg. |
| `receiveTakeRate(address, uint256)` | nonpayable | `OnlySettlementAllowed`. |
| `sweepForBuyback`, `pendingCompensations`, `yieldAccumulator`, `polAccumulator`, `buybackAccumulator`, `realYieldBps`, `polBps`, `buybackBps` | — | Take-rate split accounting. |

Events: `CompensationBatchExecuted(count, total, token)`, `RealYieldDistributed`,
`TakeRateReceived`, `BuybackFundsSwept`. Errors: `OnlyKeeperAllowed`,
`OnlySettlementAllowed`, `ArrayLengthMismatch`.

---

## 5. DirectVaultAdapter (L1)

Collateral custody for the registry. `deposit(address, uint256)`,
`withdraw(address, uint256)`, `slash(address, uint256)` (registry-only),
`getCollateral(address)`, `totalCustody()`, `collateralToken()`, `registry()`.
Events: `CollateralDeposited`, `CollateralSlashed`, `CollateralWithdrawn`. Errors:
`NotRegistry`, `InsufficientBalance`.

---

## 6. StakingRewards (L2)

Synthetix-style staking: `stake`, `withdraw`, `getReward`, `exit`,
`notifyRewardAmount`, plus the reward-accounting views (`earned`, `rewardPerToken`,
`rewardRate`, `periodFinish`, …). Events: `Staked`, `Withdrawn`, `RewardPaid`,
`RewardAdded`.

---

See also: [`watchdog.md`](watchdog.md) (executeSlash, pauseAll), [`keeper.md`](keeper.md)
(batchCompensate), [`signer.md`](signer.md) (VOUCHER_TYPEHASH), [`relayer.md`](relayer.md)
(lockIntent / refundIntent).
