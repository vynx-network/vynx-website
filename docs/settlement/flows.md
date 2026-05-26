# VynX Settlement V1 — Protocol Flows

> Sequence diagrams for the three primary protocol flows. All diagrams use Mermaid syntax.

---

## 1. Intent Lifecycle — Happy Path

The complete flow from AI agent intent creation to solver settlement and optional refund.

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Relayer as Relayer Service
    participant Settlement as VynxSettlement (L2)
    participant Admin as VynxAdmin (L2)
    participant Treasury as VynxTreasury (L2)
    participant Solver as Solver

    Note over Agent,Relayer: Off-chain: Agent submits intent to Relayer
    Agent->>Relayer: Submit Intent(intentId, agent, token, amount, solver, nonce, destChainId)

    Note over Relayer: Relayer verifies solver eligibility via Registry.getSHF()
    Note over Relayer: Relayer signs EIP-712 Intent struct with relayerKey

    Relayer-->>Agent: Return relayerSig (EIP-712 signature)

    Note over Agent,Settlement: On-chain: Agent locks funds
    Agent->>Settlement: lockIntent(intent, relayerSig)
    Settlement->>Admin: relayerKey() [cross-contract read]
    Admin-->>Settlement: address relayerKey
    Settlement->>Settlement: ECDSA.recover(intentDigest, relayerSig) == relayerKey ?
    Settlement->>Settlement: state UNKNOWN → LOCKED
    Settlement->>Agent: safeTransferFrom(agent, settlement, amount)
    Settlement-->>Agent: emit IntentLocked(intentId, agent, solver, token, amount, deadline)

    Note over Solver,Relayer: Off-chain: Solver executes payment on destination chain
    Solver->>Relayer: Submit proof of destTx (destTxHash)
    Note over Relayer: Relayer verifies dest tx; signs EIP-712 Voucher(intentId, solver, amount)
    Relayer-->>Solver: Return voucher with relayer signature

    Note over Solver,Settlement: On-chain: Solver claims escrow funds
    Solver->>Settlement: claimFunds(voucher)
    Settlement->>Admin: relayerKey() [cross-contract read]
    Admin-->>Settlement: address relayerKey
    Settlement->>Settlement: ECDSA.recover(voucherDigest, voucher.sig) == relayerKey ?
    Settlement->>Settlement: voucher.solver == escrow.solver ?
    Settlement->>Settlement: state LOCKED → REDEEMED
    Settlement->>Solver: safeTransfer(solver, amount - fee)
    Settlement->>Treasury: safeTransfer(treasury, fee)
    Settlement->>Treasury: receiveTakeRate(token, fee)
    Settlement-->>Solver: emit VoucherRedeemed(intentId, solver, netAmount, fee)
```

---

## 2. Intent Refund Flow

When a solver fails to submit a voucher before the 900-second escrow deadline, anyone can trigger a refund.

```mermaid
sequenceDiagram
    participant Anyone as Anyone (agent, keeper, or third party)
    participant Settlement as VynxSettlement (L2)
    participant Agent as AI Agent

    Note over Agent: Intent was locked; solver never submitted voucher
    Note over Anyone: block.timestamp > escrow.deadline (900 seconds after lock)

    Anyone->>Settlement: refundIntent(intentId)
    Settlement->>Settlement: state == LOCKED ?
    Settlement->>Settlement: block.timestamp > deadline ?
    Settlement->>Settlement: state LOCKED → REFUNDED
    Settlement->>Agent: safeTransfer(agent, amount)
    Settlement-->>Anyone: emit IntentRefunded(intentId, agent, amount)
```

---

## 3. Revenue Distribution Flow

How protocol fees flow from Settlement through Treasury and into StakingRewards for `$VYNX` stakers. `$VYNX` (`VynxToken.sol`) is the native staking token — holders stake `$VYNX` and earn USDC yield proportional to their share of the staked supply.

```mermaid
sequenceDiagram
    participant Settlement as VynxSettlement (L2)
    participant Treasury as VynxTreasury (L2)
    participant StakingRewards as StakingRewards (L2)
    participant Staker as $VYNX Staker (VynxToken holder)
    participant Multisig as Board Multisig
    participant Keeper as Keeper Bot

    Note over Settlement,Treasury: Step 1 — Fee routing on every claimFunds call
    Settlement->>Treasury: safeTransfer(treasury, fee)
    Settlement->>Treasury: receiveTakeRate(token, fee)
    Treasury->>Treasury: toYield   = fee * 40 / 100
    Treasury->>Treasury: toBuyback = fee * 50 / 100
    Treasury->>Treasury: toPol     = fee - toYield - toBuyback  (remainder)
    Treasury->>Treasury: yieldAccumulator[token]   += toYield
    Treasury->>Treasury: buybackAccumulator[token] += toBuyback
    Treasury->>Treasury: polAccumulator[token]     += toPol
    Treasury-->>Settlement: emit TakeRateReceived(token, fee, toYield, toBuyback, toPol)

    Note over Treasury,StakingRewards: Step 2 — Weekly yield distribution (Keeper Bot)
    Keeper->>Treasury: distributeRealYield(USDC)
    Treasury->>Treasury: amount = yieldAccumulator[USDC]
    Treasury->>Treasury: yieldAccumulator[USDC] = 0  (CEI: zero before transfer)
    Treasury->>StakingRewards: safeTransfer(stakingRewards, amount)
    Treasury->>StakingRewards: notifyRewardAmount(amount)
    StakingRewards->>StakingRewards: rewardRate = amount / 604800
    StakingRewards->>StakingRewards: periodFinish = block.timestamp + 604800
    Treasury-->>Keeper: emit RealYieldDistributed(USDC, amount)

    Note over StakingRewards,Staker: Step 3 — $VYNX staker claims USDC rewards
    Note over Staker: Staker must first stake $VYNX via stakingRewards.stake(amount)
    Staker->>StakingRewards: getReward()
    StakingRewards->>StakingRewards: reward = earned(staker)
    StakingRewards->>StakingRewards: rewards[staker] = 0  (CEI: zero before transfer)
    StakingRewards->>Staker: safeTransfer(staker, reward)
    StakingRewards-->>Staker: emit RewardPaid(staker, reward)

    Note over Treasury,Multisig: Step 4 — Buyback execution (Board Multisig)
    Multisig->>Treasury: sweepForBuyback(USDC, amount)
    Treasury->>Treasury: buybackAccumulator[USDC] -= amount  (CEI)
    Treasury->>Multisig: safeTransfer(multisig, amount)
    Treasury-->>Multisig: emit BuybackFundsSwept(USDC, amount, multisig)
```

---

## 4. Key Rotation Flow

Emergency procedure when the relayer key is compromised. The watchdog can rotate immediately without pausing the protocol.

```mermaid
sequenceDiagram
    participant Watchdog as Watchdog
    participant Admin as VynxAdmin (L2)
    participant Settlement as VynxSettlement (L2)
    participant Relayer as Relayer Service

    Note over Watchdog: Relayer key compromise detected

    Watchdog->>Admin: setRelayerKey(newKey)
    Admin->>Admin: relayerKey = newKey
    Admin->>Settlement: syncConfig(takeRateBps, treasury)
    Admin-->>Watchdog: emit RelayerKeyRotated(oldKey, newKey)

    Note over Settlement: On the VERY NEXT transaction, Settlement reads newKey cross-contract
    Note over Settlement: Any voucher signed by oldKey → InvalidVoucherSignature

    Note over Relayer: Relayer service rotates to new signing key
    Note over Relayer: New vouchers signed by newKey → accepted immediately
```

---

## 5. Pause / Unpause Flow

Emergency pause propagation across all L2 contracts.

```mermaid
sequenceDiagram
    participant Watchdog as Watchdog
    participant Multisig as Board Multisig
    participant Admin as VynxAdmin (L2)
    participant Settlement as VynxSettlement (L2)
    participant Treasury as VynxTreasury (L2)
    participant Staking as StakingRewards (L2)

    Note over Watchdog: Emergency detected — pause initiated

    Watchdog->>Admin: pauseAll()
    Admin->>Admin: paused = true
    Admin->>Settlement: setPaused(true)
    Admin->>Treasury: setPaused(true)
    Admin->>Staking: setPaused(true)
    Admin-->>Watchdog: emit ProtocolPaused(watchdog, timestamp)

    Note over Settlement: lockIntent and claimFunds now revert ContractPaused()
    Note over Staking: stake() now reverts ContractPaused() — withdraw() still works

    Note over Multisig: Emergency resolved — unpause initiated

    Multisig->>Admin: unpauseAll()
    Admin->>Admin: paused = false
    Admin->>Settlement: setPaused(false)
    Admin->>Treasury: setPaused(false)
    Admin->>Staking: setPaused(false)
    Admin-->>Multisig: emit ProtocolUnpaused(multisig, timestamp)
```

---

## 6. Solver Slashing Flow

L1 collateral confiscation when a solver defaults on an intent obligation.

```mermaid
sequenceDiagram
    participant Keeper as Keeper Bot
    participant Registry as VynxRegistry (L1)
    participant Adapter as IVaultAdapter (L1)
    participant Treasury as VynxTreasury (L2)
    participant Agent as AI Agent

    Note over Keeper: Solver default detected off-chain

    Keeper->>Registry: executeSlash(SlashPayload{solver, intentId, amount})
    Registry->>Registry: onlyRole(KEEPER_ROLE) check
    Registry->>Adapter: getCollateral(solver)
    Adapter-->>Registry: available collateral
    Registry->>Registry: slashPool[solver] += amount
    Registry->>Registry: solvers[solver].totalCollateral -= amount
    Registry->>Adapter: slash(solver, amount)
    Registry-->>Keeper: emit SolverSlashed(solver, intentId, amount, adapter)

    Note over Keeper,Treasury: Off-chain CCTP bridges slashed funds from L1 to L2

    Keeper->>Treasury: batchCompensate(USDC, [agent], [amount])
    Treasury->>Agent: safeTransfer(agent, amount)
    Treasury-->>Keeper: emit CompensationBatchExecuted(1, amount, USDC)
```
