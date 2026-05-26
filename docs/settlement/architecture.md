# VynX Settlement V1 — Architecture Reference

> Compiler: `solc 0.8.35` | OZ v5 | Base L2 (L2 contracts) + Ethereum L1 (Registry)
> Contracts: 6 production (5 immutable, 1 UUPS proxy) | 14 Solidity source files

---

## 1. System Overview

VynX V1 is a cross-chain intent settlement protocol built for AI agents. An agent locks USDC on Base
L2 into an escrow contract; a winning solver fulfils the payment on the destination chain; the relayer
issues an EIP-712 voucher authorising the release of funds. The five production contracts form a
deliberately minimal, immutable-first architecture — only `VynxAdmin` is upgradeable.

```
Ethereum L1                          Base L2
┌─────────────────┐      CCTP       ┌────────────────┐   relayerKey    ┌──────────────────┐
│  VynxRegistry   │ ─────────────── │   VynxAdmin    │ ──(read)──────► │  VynxSettlement  │
│  (solver SHF)   │                 │ (UUPS proxy)   │                 │  (immutable)     │
└─────────────────┘                 │                │ ──syncConfig──► │                  │
                                    │                │                 └──────────────────┘
                                    │                │                         │ fee
                                    │                │                         ▼
                                    │                │                 ┌──────────────────┐
                                    │                │ ──setPaused───► │  VynxTreasury    │
                                    │                │                 │  (immutable)     │
                                    └────────────────┘                 └────────┬─────────┘
                                                                                │ yield
                                                                                ▼
                                                                       ┌──────────────────┐
                                                                       │  StakingRewards  │◄── $VYNX
                                                                       │  (immutable)     │    (VynxToken)
                                                                       └──────────────────┘

                                    ┌────────────────┐
                                    │  VynxToken     │  $VYNX — ERC20 + Permit
                                    │  (immutable)   │  owner = multisig
                                    └────────────────┘
```

---

## 2. Contract Summaries

### 2.0 VynxToken — `src/tokens/VynxToken.sol` (Base L2)

| Property | Value |
|---|---|
| Network | Base Mainnet |
| Upgradeability | None — immutable |
| Inherits | OZ v5 `ERC20`, `ERC20Permit`, `Ownable` |
| Key state | Standard ERC-20 balances; no additional storage |

The native `$VYNX` governance and staking token. `StakingRewards` accepts `$VYNX` as the staking token and distributes USDC yield proportionally to staked balances. `VynxToken.mint` is guarded by `onlyOwner` — only the multisig (set as `initialOwner` at deployment) can create new supply. EIP-2612 `permit` support enables gasless approvals for on-chain staking flows.

**Key security property:** Minting rights are non-delegatable. The `Ownable` owner is set to `multisig` in the L2 deployment script (`DeployL2.s.sol`); transferring ownership requires an explicit multisig transaction.

---

### 2.1 VynxRegistry — `src/l1/VynxRegistry.sol` (Ethereum L1)

| Property | Value |
|---|---|
| Network | Ethereum Mainnet |
| Upgradeability | None — immutable |
| Access Control | OZ v5 `AccessControl` — `ADMIN_ROLE`, `KEEPER_ROLE` |
| Key state | `mapping(address => SolverInfo) solvers` |

Manages solver onboarding and collateral health. Solvers register by depositing collateral into a
`IVaultAdapter`-conforming vault. The Keeper Bot calls `executeSlash` to confiscate collateral on
protocol breach. `getSHF` gates intent assignment: a solver is eligible only when
`collateral * 100 / intentValue >= SHF_THRESHOLD` (default 120 = 1.20× over-collateralisation).

**Critical security property:** `executeSlash` requires `KEEPER_ROLE`. An account holding `ADMIN_ROLE`
but not `KEEPER_ROLE` will revert — the roles are fully segregated by OZ AccessControl.

---

### 2.1a DirectVaultAdapter — `src/adapters/DirectVaultAdapter.sol` (Ethereum L1)

| Property | Value |
|---|---|
| Network | Ethereum Mainnet |
| Upgradeability | None — immutable |
| Collateral model | Direct ERC-20 custody — no underlying yield protocol |
| Interface | `IVaultAdapter` |

The V1 reference implementation of `IVaultAdapter`. Solver collateral is held directly in the
adapter's ERC-20 balance — no yield-bearing wrapper in V1. Three `nonReentrant` mutating functions:

- **`deposit(solver, amount)`** — pulls tokens from solver via `safeTransferFrom` (solver must approve this contract, **not** VynxRegistry).
- **`withdraw(solver, amount)`** — returns tokens to solver on voluntary deregistration.
- **`slash(solver, amount)`** — decrements the solver's internal balance without transferring tokens out. Slashed tokens accumulate in the adapter's balance as the **slash pool**, awaiting off-chain CCTP bridging to Base L2 for agent compensation via `batchCompensate`.

**Design note:** `totalCustody()` equals the sum of all solver balances plus the slash pool at all
times. The slash pool is not tracked per-solver on-chain — off-chain accounting maps slashed amounts
to affected agents.

---

### 2.2 VynxAdmin — `src/l2/VynxAdmin.sol` (Base L2)

| Property | Value |
|---|---|
| Network | Base Mainnet |
| Upgradeability | UUPS — `multisig` is the sole upgrade authority |
| Roles | `watchdog` (pause + key rotation), `multisig` (unpause + upgrade + config) |
| Key state | `relayerKey`, `takeRateBps`, `settlement`, `treasury`, `stakingRewards` |

The **sole upgradeable contract** in V1. Holds the protocol's mutable configuration and acts as the
"source-of-truth hub" — `VynxSettlement` reads `relayerKey` from this contract on every call. The
asymmetric pause model is a hard invariant: `watchdog` can pause but never unpause; `multisig` can
unpause but never pause. This prevents any single key from cycling the protocol through pause/unpause.

**Upgrade guard:** `_authorizeUpgrade` reverts for any caller other than `multisig`, preventing
self-authorization by the implementation contract.

---

### 2.3 VynxSettlement — `src/l2/VynxSettlement.sol` (Base L2)

| Property | Value |
|---|---|
| Network | Base Mainnet |
| Upgradeability | None — immutable forever |
| EIP-712 Domain | `name = "VynxSettlement"`, `version = "1"` |
| Escrow token | Any ERC-20 (USDC, USDT, WETH, cbBTC, wstETH in practice) |
| Escrow window | `DEFAULT_DEADLINE = 900 seconds` from lock time |

The core escrow engine. Enforces the strict unidirectional state machine:

```
UNKNOWN ──(lockIntent)──► LOCKED ──(claimFunds)──► REDEEMED
                              └────(refundIntent)──► REFUNDED
```

Once an intent reaches `REDEEMED` or `REFUNDED`, no further state transitions are possible. The
`UNKNOWN` default (slot value = 0) acts as replay protection — unregistered intent IDs fail all
transition checks automatically.

**No local key cache:** `relayerKey` is read from `IVynxAdmin(admin).relayerKey()` on every
`lockIntent` and `claimFunds` call. Key rotations take effect with zero propagation delay.

---

### 2.4 VynxTreasury — `src/l2/VynxTreasury.sol` (Base L2)

| Property | Value |
|---|---|
| Network | Base Mainnet |
| Upgradeability | None — immutable |
| Token model | Passive custody — tokens arrive via Settlement's `safeTransfer` before `receiveTakeRate` |
| Revenue split | 40% yield / 50% buyback / 10% POL |

Three-bucket revenue router. The POL allocation absorbs integer-division remainder, guaranteeing
`toYield + toBuyback + toPol == amount` (zero leakage) for any input. Yield is distributed to
`StakingRewards` via `distributeRealYield` (CEI: accumulator zeroed before transfer).

---

### 2.5 StakingRewards — `src/l2/StakingRewards.sol` (Base L2)

| Property | Value |
|---|---|
| Network | Base Mainnet |
| Upgradeability | None — immutable |
| Model | Synthetix time-weighted accumulator (`rewardPerTokenStored`) |
| Staking token | `$VYNX` (WETH in test harness) |
| Rewards token | USDC |
| Period | `rewardsDuration = 604800` seconds (7 days) |

Distributes USDC yield proportionally to staked `$VYNX` holders. Withdrawal is never blocked by
the pause flag — users can always exit. `notifyRewardAmount` rolls over any undistributed rewards
from the current period into the next rate calculation.

**Supply conservation invariant:** `IERC20(stakingToken).balanceOf(address(this))` equals
`_totalSupply` at all times (verified by the stateful invariant suite).

---

## 3. The "Source of Truth" Pattern

VynxSettlement reads configuration from VynxAdmin cross-contract on every hot-path call rather than
caching values locally. This is the single most important security pattern in V1.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  lockIntent / claimFunds (every call)                                        │
│                                                                              │
│  1. address signer = IVynxAdmin(admin).relayerKey()   ← live cross-call     │
│  2. ECDSA.recover(digest, sig) == signer ?                                  │
│         yes → proceed                                                        │
│         no  → revert InvalidIntentSignature / InvalidVoucherSignature        │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why this matters:** If the relayer key is compromised, `watchdog` calls
`VynxAdmin.setRelayerKey(newKey)`. On the very next transaction — with no deployment or migration
needed — Settlement rejects vouchers signed by the old key. There is no window during which an
attacker can drain funds with the old key after the rotation has been executed.

**Key rotation liveness test (blueprint §8.6):**
1. Lock an intent with OLD_PK signature.
2. Rotate relayer key to NEW_PK via `watchdog`.
3. Attempt `claimFunds` with OLD_PK voucher → `InvalidVoucherSignature`. ✓
4. Attempt `claimFunds` with NEW_PK voucher → `REDEEMED`. ✓

---

## 4. EIP-712 Schemas

### 4.1 Domain Separator

```
EIP712Domain(
    string  name              = "VynxSettlement"
    string  version           = "1"
    uint256 chainId           = <chain id at deployment>
    address verifyingContract = <settlement address>
)
```

The `chainId` field in the domain separator prevents cross-chain replay: a voucher signed for Base
(chainId = 8453) will fail verification on any other chain because the recovered signer will not
match `relayerKey`.

### 4.2 Intent TypeHash

```
INTENT_TYPEHASH = keccak256(
    "Intent(uint256 nonce,address user,address token,uint256 amount,"
    "uint256 destinationChainId,uint256 deadline)"
)
```

Note: the field is named `user` in the typehash (off-chain convention) but maps to `intent.agent`
in the struct. This is intentional — the Go relayer SDK and AgentKit plugin use the `user` name.
The nonce field provides replay protection at the intent level (distinct from the chain-level
`chainId` in the domain separator).

### 4.3 Voucher TypeHash

```
VOUCHER_TYPEHASH = keccak256(
    "Voucher(bytes32 intentId,address solver,uint256 amount)"
)
```

The relayer signs over `(intentId, solver, amount)` only. `destTxHash` and `issuedAt` are off-chain
metadata included in the struct for audit trail purposes but excluded from the EIP-712 signed
payload — they do not affect on-chain security.

### 4.4 Digest Construction

```solidity
bytes32 digest = keccak256(
    abi.encodePacked("\x19\x01", domainSeparator, structHash)
);
address signer = ECDSA.recover(digest, signature);
```

Signature format: `abi.encodePacked(r, s, v)` — compact 65-byte ECDSA encoding.

---

## 5. Revenue Split Logic

Every `claimFunds` call that results in a non-zero fee executes a two-step operation:

```
Step 1 (Settlement):
    fee = amount * takeRateBps / 10_000
    if fee > 0:
        IERC20(token).safeTransfer(treasury, fee)
        IVynxTreasury(treasury).receiveTakeRate(token, fee)
    IERC20(token).safeTransfer(solver, amount - fee)

Step 2 (Treasury — receiveTakeRate):
    toYield   = fee * 40 / 100           // integer division
    toBuyback = fee * 50 / 100           // integer division
    toPol     = fee - toYield - toBuyback // remainder — absorbs dust
    yieldAccumulator[token]   += toYield
    buybackAccumulator[token] += toBuyback
    polAccumulator[token]     += toPol

    Invariant: toYield + toBuyback + toPol == fee  (zero leakage, any input)
```

```
Fee flow at 10 bps on a 1,000 USDC intent:
    fee           =  1.00 USDC (100,000 units at 6 decimals)
    toYield  (40%) =  0.40 USDC  → yieldAccumulator
    toBuyback(50%) =  0.50 USDC  → buybackAccumulator
    toPol    (10%) =  0.10 USDC  → polAccumulator
    net to solver  = 999.00 USDC
```

Yield is not distributed immediately. The Keeper Bot calls `distributeRealYield` on a regular cadence
(e.g., weekly), which transfers `yieldAccumulator[token]` to `StakingRewards` and calls
`notifyRewardAmount` to start a new 7-day reward period. CEI ordering is enforced: the accumulator
is zeroed before the external transfer.

---

## 6. Deployment Order

The three L2 immutable contracts have circular constructor dependencies. They are resolved by
pre-computing CREATE addresses before any deployment:

```
L2 deployment (base nonce n):
    n+0  →  VynxAdmin implementation
    n+1  →  ERC1967Proxy  (adminProxy — this is the live address)
    n+2  →  StakingRewards(rewardsToken, stakingToken, predictedTreasury, adminProxy)
    n+3  →  VynxTreasury  (adminProxy, predictedSettlement, stakingRewards, keeper, multisig)
    n+4  →  VynxSettlement(adminProxy, treasury, takeRateBps)

Post-deploy:
    adminProxy.setContractAddresses(settlement, treasury, stakingRewards)
```

---

## 7. Access Control Matrix

| Action | watchdog | multisig | keeper | settlement | anyone |
|---|:---:|:---:|:---:|:---:|:---:|
| `VynxAdmin.pauseAll` | ✓ | — | — | — | — |
| `VynxAdmin.unpauseAll` | — | ✓ | — | — | — |
| `VynxAdmin.setRelayerKey` | ✓ | — | — | — | — |
| `VynxAdmin.setTakeRate` | — | ✓ | — | — | — |
| `VynxAdmin.upgradeTo` | — | ✓ | — | — | — |
| `VynxSettlement.lockIntent` | — | — | — | — | ✓ (relayer sig req.) |
| `VynxSettlement.claimFunds` | — | — | — | — | ✓ (relayer sig req.) |
| `VynxSettlement.refundIntent` | — | — | — | — | ✓ (after deadline) |
| `VynxTreasury.receiveTakeRate` | — | — | — | ✓ | — |
| `VynxTreasury.distributeRealYield` | ✓ (admin) | — | ✓ | — | — |
| `VynxTreasury.sweepForBuyback` | — | ✓ | — | — | — |
| `VynxTreasury.batchCompensate` | — | — | ✓ | — | — |
| `VynxRegistry.executeSlash` | — | — | ✓ (KEEPER_ROLE) | — | — |

---

## 8. Test Coverage Summary

| Suite | File | Tests | Status |
|---|---|---|---|
| Unit | `test/unit/VynxAdmin.t.sol` | 30 | PASS |
| Unit | `test/unit/VynxToken.t.sol` | 10 | PASS |
| Unit | `test/unit/VynxSettlement.t.sol` | 27 | PASS |
| Unit | `test/unit/VynxTreasury.t.sol` | 19 | PASS |
| Unit | `test/unit/StakingRewards.t.sol` | 20 | PASS |
| Unit | `test/unit/VynxRegistry.t.sol` | 18 | PASS |
| Unit | `test/unit/DirectVaultAdapter.t.sol` | 18 | PASS |
| Integration | `test/integration/FullFlow.t.sol` | 5 | PASS |
| Fuzz | `test/fuzz/Fuzz.t.sol` | 5 × 1024 runs | PASS |
| Invariant | `test/invariant/Invariants.t.sol` | 5 invariants | PASS |
| **Total** | | **147 deterministic + 5120 fuzz** | **ALL PASS** |
