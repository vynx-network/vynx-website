# VynX Settlement V1 — Architecture

This document describes the on-chain architecture of the VynX Settlement V1 protocol as
implemented in `src/`. The code is the single source of truth; this document mirrors it.

VynX is a cross-chain settlement protocol for AI agents, built on the **trust-minimized,
single-signature gasless custody model** (design doc
`docs/design/GASLESS-REDESIGN-CRYPTO-DESIGN.md`). The agent signs **one** EIP-3009
`receiveWithAuthorization` off-chain — for free — whose nonce is the keccak256 hash of every
trade term (§D2). The winning solver executes `lockIntent` on Base L2 and pays all gas; the
escrowed USDC is pulled in by Circle's audited USDC contract, which verifies the agent's
signature. The solver fulfils the corresponding payment on a destination chain off-chain and
redeems a relayer-signed voucher to release the escrowed funds (minus a small take rate).
The relayer validates and orchestrates the auction but **never signs intents** — no actor
between the agent and the contract can alter the agent's terms. Solver accountability is
enforced by an over-collateralisation registry on Ethereum L1 with a wallet-gated slashing
mechanism.

---

## 1. System Overview

The protocol spans two independent chains and consists of seven contracts.

### Ethereum L1 (Mainnet)

| Contract | Mutability | Purpose |
| --- | --- | --- |
| `VynxRegistry` | Immutable (AccessControl) | Solver onboarding, SHF eligibility gate, KEEPER_ROLE-gated slashing with on-chain distribution. |
| `DirectVaultAdapter` (×3) | Immutable | Direct ERC-20 custody of solver collateral (one adapter per collateral token). |

### Base L2

| Contract | Mutability | Purpose |
| --- | --- | --- |
| `VynxAdmin` | UUPS upgradeable (the ONLY upgradeable contract) | Source of truth for the relayer key, take rate, and global pause state. |
| `VynxSettlement` | Immutable (EIP-712 for vouchers) | Intent escrow and settlement; pulls agent funds gaslessly via EIP-3009 `receiveWithAuthorization` on `lockIntent` (immutable `usdc`); verifies relayer voucher signatures on `claimFunds`; runs the intent state machine. |
| `VynxTreasury` | Immutable | Receives take-rate fees; splits revenue 40/50/10 across yield, buyback, and POL buckets. |
| `StakingRewards` | Immutable (Synthetix pattern) | Stakers deposit $VYNX, earn USDC real yield. |
| `VynxToken` | Immutable (ERC20 + ERC20Permit + Ownable) | The $VYNX governance and staking token. |

---

## 2. Topology — No On-Chain Bridge Between L1 and L2

There is **no on-chain link between the Ethereum L1 contracts and the Base L2 contracts**.
The registry on L1 and the settlement stack on L2 never call each other and never move funds
across the two chains on-chain. They are coordinated exclusively by the off-chain relayer and
the off-chain Keeper Bot, which observe both chains and submit transactions to each chain
independently.

```
            Ethereum L1                                       Base L2
┌──────────────────────────────────┐        ┌────────────────┐  relayerKey   ┌──────────────────┐
│  VynxRegistry                     │        │   VynxAdmin    │ ──(read)────► │  VynxSettlement  │
│   • solver SHF eligibility gate   │        │  (UUPS proxy)  │               │   (immutable)    │
│   • executeSlash  (KEEPER_ROLE)   │        │                │ ─syncConfig─► │   EIP-712 escrow │
│       └─ 5% agent / 5% treasury   │        │  source of     │               └────────┬─────────┘
│          distributed ON-CHAIN     │        │  truth for     │                        │ take-rate fee
│                                   │        │  relayerKey,   │                        ▼
│  DirectVaultAdapter (custody x3)  │        │  takeRate,     │ ─setPaused──► ┌──────────────────┐
└──────────────────────────────────┘        │  pause         │               │  VynxTreasury    │
                                             │                │               │   (immutable)    │
   No on-chain link between L1 and L2 —      └────────────────┘               └────────┬─────────┘
   they communicate only through the                                                  │ real yield 40%
   off-chain relayer & Keeper Bot.                                                     ▼
                                                                             ┌──────────────────┐
                                                                             │  StakingRewards  │◄─ $VYNX
                                                                             │   (immutable)    │   stakers
                                                                             └──────────────────┘
```

The slashing economy lives entirely on L1: when a solver defaults, the Keeper Bot calls
`VynxRegistry.executeSlash` on Ethereum, the seized collateral is moved out of the adapter into
the registry, and the registry immediately distributes the agent and treasury shares in the
**adapter's own collateral token** on L1. No slashed value is ever transferred to L2 on-chain.
On L2, the take-rate revenue cycle is self-contained: Settlement → Treasury → StakingRewards.

---

## 3. Source-of-Truth Relayer Key Pattern (Zero-Delay Rotation)

`VynxAdmin` is the single source of truth for the relayer signing key. `VynxSettlement`
**never caches the key locally**. On every `claimFunds` call (the only function that still
verifies a relayer signature — `lockIntent` is verified by Circle's USDC since the gasless
redesign), Settlement reads `IVynxAdmin(admin).relayerKey()` cross-contract and uses that
value to verify the EIP-712 voucher signature:

```solidity
if (signer != IVynxAdmin(admin).relayerKey()) revert InvalidVoucherSignature(voucher.intentId);
```

Because the key is read fresh on every verification, a rotation via
`VynxAdmin.setRelayerKey(newKey)` (watchdog-only) takes effect **immediately** for all future
calls — there is no propagation step and no window in which a compromised key remains accepted.
Note that `setRelayerKey` also invokes `settlement.syncConfig(takeRateBps, treasury)`, but the
key itself is never passed through `syncConfig`; only the economic parameters are.

---

## 4. Signature Domains — 3009 Custody vs 712 Vouchers

The two signed artifacts in the protocol live in **different cryptographic domains**:

### Intent custody — the agent's EIP-3009 authorization (USDC's domain)

`lockIntent` carries no protocol signature at all. The agent signs Circle's
`ReceiveWithAuthorization(from,to,value,validAfter,validBefore,nonce)` struct against
**USDC's own EIP-712 domain**, where the `nonce` is not random but the keccak256 hash of all
eight intent terms prefixed by the `INTENT_NONCE_DOMAIN_TAG` protocol constant (§D2.2 — the
single `internal pure` implementation is `IntentNonceLib.computeNonce`). At lock time the
contract recomputes the nonce from the submitted intent and hands verification to Circle's
audited code: any tampered term changes the recomputed nonce, the signature no longer
matches, and USDC reverts. Deployment binding comes from `to = address(settlement)` inside
the signed 3009 envelope plus USDC's own domain separator (live `chainId` + USDC address) —
§D2.4. The former `INTENT_TYPEHASH` and the `InvalidIntentSignature` error were **removed**
in Sprint 1.2.

### Voucher settlement — the relayer's EIP-712 signature (Settlement's domain)

`VynxSettlement` initialises its EIP-712 domain in the constructor as
`EIP712("VynxSettlement", "1")` — used exclusively for vouchers. The domain separator commits
to the name, version, `chainId`, and `verifyingContract` (the Settlement address). The
inclusion of `chainId` in the domain is what prevents a voucher signed for Base from being
replayed on any other chain.

### VOUCHER_TYPEHASH (3 fields)

```solidity
bytes32 public constant VOUCHER_TYPEHASH = keccak256(
    "Voucher(bytes32 intentId,address solver,uint256 amount)"
);
```

Only `intentId`, `solver`, and `amount` are signed. The `destTxHash` and `issuedAt` fields of
the `Voucher` struct are off-chain audit metadata and are **not** part of the signed payload.

---

## 5. Intent State Machine

`VynxSettlement` enforces a strictly unidirectional state machine over each intent ID:

```
UNKNOWN ──lockIntent──► LOCKED ──claimFunds──► REDEEMED
                          │
                          └────refundIntent───► REFUNDED
```

- `UNKNOWN` (enum value 0) is the default storage slot. It doubles as replay protection: an
  intent ID that has never been locked automatically fails every state-transition check.
- `LOCKED` holds escrowed funds awaiting voucher settlement or deadline-based refund.
- `REDEEMED` and `REFUNDED` are terminal. Neither can transition to any other state, which is
  what blocks a second `claimFunds` (voucher replay) on an already-settled intent.

The escrow deadline is `block.timestamp + DEFAULT_DEADLINE`, where `DEFAULT_DEADLINE = 900`
seconds (15 minutes).

---

## 6. Take-Rate Revenue Cycle (L2)

On every successful `claimFunds`, Settlement computes
`fee = amount * takeRateBps / 10_000` (integer floor; the remainder accrues to the solver) and,
if `fee > 0`, transfers the fee to the Treasury and calls `receiveTakeRate(token, fee)`. The
take rate is capped at 20 bps (0.20%) by `VynxAdmin.MAX_TAKE_RATE` and by the Settlement
constructor guard.

`VynxTreasury.receiveTakeRate` is pure accounting (the tokens are already in the Treasury
balance, transferred by Settlement) and splits the inflow into three accumulators:

- 40% → yield accumulator (later flushed to StakingRewards via `distributeRealYield`)
- 50% → buyback accumulator (later swept by the multisig via `sweepForBuyback`)
- 10% → POL accumulator, computed as the arithmetic remainder so the three buckets sum exactly
  to the inflow with no rounding leakage.

`distributeRealYield` transfers the accumulated yield to `StakingRewards` and calls
`notifyRewardAmount`, which starts (or rolls over) a 7-day reward emission period over which
$VYNX stakers accrue USDC.

---

## 7. On-Chain Slash Distribution (L1)

Slashing is wallet-gated, not signature-gated. The Keeper Bot holds `KEEPER_ROLE` on the
registry and calls:

```solidity
function executeSlash(SlashPayload calldata payload) external nonReentrant onlyRole(KEEPER_ROLE)
```

The `SlashPayload.signature` field is retained for off-chain audit trails and is **not verified
on-chain** — authorisation is enforced entirely by `KEEPER_ROLE`.

The slash size and split are derived on-chain from `payload.inputAmount`:

| Quantity | Formula | Value |
| --- | --- | --- |
| `slashTotal` | `inputAmount * SLASH_TOTAL_BPS / 10000` | 10% of input |
| `agentShare` | `inputAmount * AGENT_SHARE_BPS / 10000` | 5% of input |
| `treasuryShare` | `slashTotal - agentShare` | remainder (absorbs integer-division dust) |

where `SLASH_TOTAL_BPS = 1000` and `AGENT_SHARE_BPS = 500`.

Custody flow, all on Ethereum L1, all in the adapter's collateral token
(`adapter.collateralToken()`):

1. `slashPool[solver] += slashTotal` — a **cumulative accounting ledger** that holds no funds.
2. `solvers[solver].totalCollateral -= slashTotal`.
3. `adapter.slash(solver, slashTotal)` (the adapter is `onlyRegistry`) transfers the seized
   total **out of the adapter into the registry**.
4. `IERC20(token).safeTransfer(agent, agentShare)` and
   `IERC20(token).safeTransfer(treasury, treasuryShare)` distribute the two shares.

The registry nets to zero balance for the operation: it receives `slashTotal` and immediately
forwards `agentShare + treasuryShare == slashTotal`. The `treasury` recipient here is the
**protocol treasury address on L1** (an immutable constructor argument of the registry), not the
L2 `VynxTreasury` contract.

Reverts:
- `SolverInactive(solver)` if the target solver is not active.
- `InsufficientCollateral(solver, required, available)` if the adapter's recorded balance is
  below `slashTotal`.

On success, the registry emits `SolverSlashed` with exactly nine fields (see `contracts.md`).

---

## 8. Deployment — Address Pre-Computation Order

### Base L2 (`script/DeployL2.s.sol`)

`StakingRewards`, `VynxTreasury`, and `VynxSettlement` form a constructor dependency cycle
(StakingRewards needs the treasury address; Treasury needs the settlement address). The script
resolves it with `vm.computeCreateAddress(deployer, nonce)`, deploying in a deterministic order
that matches the pre-computed nonce offsets:

| Nonce | Contract | Key constructor arguments |
| --- | --- | --- |
| n+0 | `VynxToken` | owner = multisig |
| n+1 | `VynxAdmin` (implementation) | — (`_disableInitializers` in constructor) |
| n+2 | `ERC1967Proxy` (the live admin) | `initialize(relayerSigner, watchdog, multisig, takeRateBps)` |
| n+3 | `StakingRewards` | `(usdc, VynxToken, predictedTreasury, adminProxy)` |
| n+4 | `VynxTreasury` | `(adminProxy, predictedSettlement, stakingRewards, keeper, multisig)` |
| n+5 | `VynxSettlement` | `(adminProxy, treasury, takeRateBps, usdc)` |

After deployment, the multisig calls
`adminProxy.setContractAddresses(settlement, treasury, stakingRewards)`.

The `usdc` constructor argument (the settlement's **immutable** input token and EIP-3009
custody contract) is resolved by the script from `block.chainid`:

| Chain | ID | USDC |
| --- | --- | --- |
| Base Mainnet | 8453 | `USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle official, Q8-verified EIP-3009 capable) |

Any other chain aborts the deploy. `DEFAULT_TAKE_RATE_BPS = 10`.

Deployed addresses (Base Sepolia testnet, FASE 1 close-out) are recorded in
[`docs/deployments.md`](deployments.md), together with the post-deploy smoke cycle —
one real EIP-3009 gasless lock followed by a post-deadline refund
(`script/SmokeTestnet.s.sol`).

### Ethereum L1 (`script/DeployL1.s.sol`)

1. `VynxRegistry(deployer, keeper, shfThreshold, treasury)` — deployer temporarily holds
   `ADMIN_ROLE`; keeper permanently holds `KEEPER_ROLE`; the L1 treasury address is immutable.
2. Three `DirectVaultAdapter` deployments (USDC, WETH, wstETH), each pointing at the registry.
3. `registry.setAdapter(adapter, adapter)` for each adapter (the adapter's own address is the
   mapping key, matching the direct-lookup pattern used in `registerSolver`).
4. `registry.grantRole(ADMIN_ROLE, multisig)`.
5. `registry.renounceRole(ADMIN_ROLE, deployer)` — after this, only the multisig holds
   `ADMIN_ROLE`.

`DEFAULT_SHF_THRESHOLD = 120` (1.20× over-collateralisation).

---

## 9. Access-Control Matrix

| Contract | Function | Authorized caller |
| --- | --- | --- |
| VynxRegistry | `registerSolver` | Permissionless (operates on `msg.sender`) |
| VynxRegistry | `deregisterSolver` | Permissionless (operates on `msg.sender`) |
| VynxRegistry | `executeSlash` | `KEEPER_ROLE` |
| VynxRegistry | `setSHFThreshold` | `ADMIN_ROLE` (= `DEFAULT_ADMIN_ROLE`) |
| VynxRegistry | `setAdapter` | `ADMIN_ROLE` |
| DirectVaultAdapter | `deposit` | Any caller (intended: registry); pulls tokens from `solver` |
| DirectVaultAdapter | `withdraw` | Any caller (intended: registry) |
| DirectVaultAdapter | `slash` | `onlyRegistry` |
| VynxAdmin | `pauseAll` | `watchdog` |
| VynxAdmin | `setRelayerKey` | `watchdog` |
| VynxAdmin | `unpauseAll` | `multisig` |
| VynxAdmin | `setTakeRate` | `multisig` |
| VynxAdmin | `setMultisig` | `multisig` |
| VynxAdmin | `setContractAddresses` | `multisig` |
| VynxAdmin | `upgradeTo` / `_authorizeUpgrade` | `multisig` |
| VynxSettlement | `lockIntent` | Winning solver only (`msg.sender == intent.solver`, §D5 Option A; requires the agent's valid EIP-3009 authorization) |
| VynxSettlement | `claimFunds` | Permissionless (requires valid relayer voucher) |
| VynxSettlement | `refundIntent` | Permissionless (after deadline) |
| VynxSettlement | `syncConfig` | `admin` (VynxAdmin) |
| VynxSettlement | `setPaused` | `admin` (VynxAdmin) |
| VynxTreasury | `receiveTakeRate` | `settlement` |
| VynxTreasury | `batchCompensate` | `keeper` |
| VynxTreasury | `distributeRealYield` | `admin` or `keeper` |
| VynxTreasury | `sweepForBuyback` | `multisig` |
| VynxTreasury | `setPaused` | `admin` (VynxAdmin) |
| StakingRewards | `stake` / `withdraw` / `getReward` / `exit` | Permissionless (per-caller) |
| StakingRewards | `notifyRewardAmount` | `rewardsDistribution` (VynxTreasury) |
| StakingRewards | `setPaused` | `admin` (VynxAdmin) |
| VynxToken | `mint` | `owner` (multisig) |

The watchdog/multisig split is **asymmetric**: the watchdog can pause but can never unpause; the
multisig can unpause but can never pause. This guarantees that a fast, low-privilege actor can
halt the protocol while only the high-privilege board can resume it.

---

## 10. Off-Chain Components (Out of Scope for This Repository)

The on-chain contracts rely on two off-chain actors whose implementation lives in separate
repositories:

- **Relayer** — validates submitted intents (input chain, token, destination whitelist,
  MIN/MAX, deadline) and the agent's EIP-3009 authorization, orchestrates the sealed 200 ms
  auction, validates the destination-chain payment via an integrity witness (correct output
  token, recipient equal to the agent, value at or above the **agent-signed**
  `minOutputAmount`), and signs **vouchers only** with the relayer key — it no longer signs
  intents and cannot alter their terms.
- **Keeper Bot** — holds `KEEPER_ROLE` on the L1 registry and the keeper role on the L2
  treasury; triggers slashing on default and orchestrates yield distribution and agent
  compensation.

Neither actor moves funds across chains on-chain; the two chains remain on-chain-independent.
