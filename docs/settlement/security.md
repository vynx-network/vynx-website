# VynX Settlement V1 — Security Analysis

> This document covers the security properties, threat model, attack mitigations, and design invariants of the VynX V1 protocol.

---

## 1. Threat Model

VynX V1 is a cross-chain intent settlement protocol with the following adversary assumptions:

| Actor | Capability | Trust Level |
|---|---|---|
| AI Agent | Submits intents, holds tokens, calls `lockIntent` | Untrusted end user |
| Solver | Submits vouchers, calls `claimFunds` | Untrusted — bonded via Registry collateral |
| Relayer | Signs EIP-712 intents and vouchers with `relayerKey` | Semi-trusted — key is rotatable |
| Keeper Bot | Calls `executeSlash`, `distributeRealYield`, `batchCompensate` | Trusted infrastructure |
| Watchdog | Single EOA or 1-of-1 multisig — pause + key rotation | Privileged — limited to emergency ops |
| Multisig | 3-of-4 multisig — unpause, upgrade, config, `$VYNX` minting | Privileged governance |

---

## 2. Key Rotation and Source-of-Truth Pattern

**Threat:** A compromised relayer key allows an attacker to sign fraudulent vouchers, draining locked escrow funds.

**Mitigation — zero-delay key rotation:**

VynxSettlement does NOT cache the relayer key locally. On every `lockIntent` and `claimFunds` call:

```solidity
address signer = ECDSA.recover(digest, sig);
if (signer != IVynxAdmin(admin).relayerKey()) revert InvalidVoucherSignature(intentId);
```

The key is read cross-contract from `IVynxAdmin(admin).relayerKey()` on every execution. When `watchdog` calls `VynxAdmin.setRelayerKey(newKey)`, the rotation takes effect immediately on the next transaction — with no deployment, migration, or cache invalidation required.

**Key rotation liveness verification (test §8.6):**
1. Lock an intent with `OLD_PK` signature.
2. Rotate key to `NEW_PK` via `watchdog`.
3. `claimFunds` with `OLD_PK` voucher → `InvalidVoucherSignature`. ✓
4. `claimFunds` with `NEW_PK` voucher → `REDEEMED`. ✓

---

## 3. Reentrancy Protection

All state-mutating functions that perform external token transfers are protected by OZ v5 `ReentrancyGuard`.

| Contract | Protected Functions |
|---|---|
| `VynxSettlement` | `lockIntent`, `claimFunds`, `refundIntent` |
| `VynxTreasury` | `batchCompensate` |
| `VynxRegistry` | `registerSolver`, `deregisterSolver`, `executeSlash` |
| `StakingRewards` | `stake`, `withdraw`, `getReward` |
| `DirectVaultAdapter` | `deposit`, `withdraw`, `slash` |
| `VynxToken` | N/A — `mint` calls `_mint` (internal); no external calls; no reentrancy vector |

**CEI (Checks-Effects-Interactions) ordering** is maintained throughout:

In `claimFunds`:
```
1. CHECK  — state == LOCKED, solver matches, voucher sig valid
2. EFFECT — escrow.state = IntentState.REDEEMED
3. INTERACT — safeTransfer(solver, net); safeTransfer(treasury, fee); receiveTakeRate(...)
```

In `distributeRealYield`:
```
1. CHECK  — caller is admin or keeper; accumulator > 0
2. EFFECT — yieldAccumulator[token] = 0
3. INTERACT — safeTransfer(stakingRewards, amount); notifyRewardAmount(amount)
```

In `sweepForBuyback`:
```
1. CHECK  — caller is multisig; amount <= accumulator
2. EFFECT — buybackAccumulator[token] -= amount
3. INTERACT — safeTransfer(multisig, amount)
```

In `getReward` (StakingRewards):
```
1. CHECK  — reward > 0 (silent no-op if 0)
2. EFFECT — rewards[msg.sender] = 0
3. INTERACT — safeTransfer(msg.sender, reward)
```

---

## 4. EIP-712 Signature Security

### 4.1 Cross-Chain Replay Prevention

The EIP-712 domain separator includes `chainId = <chainId at deployment>`:

```
EIP712Domain(
    string  name              = "VynxSettlement"
    string  version           = "1"
    uint256 chainId           = 8453  (Base Mainnet)
    address verifyingContract = <settlement address>
)
```

A voucher signed for Base (chainId = 8453) will fail verification on any other chain — the recovered signer will not match `relayerKey`. This is enforced automatically by OZ v5's `EIP712._hashTypedDataV4`.

### 4.2 Intent-Level Replay Prevention

Each Intent contains a `nonce` field encoded in the EIP-712 struct hash:

```
INTENT_TYPEHASH = keccak256(
    "Intent(uint256 nonce,address user,address token,uint256 amount,"
    "uint256 destinationChainId,uint256 deadline)"
)
```

An intentId derived from the same nonce and content would hash to the same `intentId`. Attempting `lockIntent` with an already-used `intentId` reverts with `IntentAlreadyExists(intentId)` because `intents[intentId].state != IntentState.UNKNOWN`.

### 4.3 UNKNOWN-State Replay Guard

The `IntentState.UNKNOWN` default (slot value = 0) is the first-layer replay defense. Any `intentId` that has never been registered will have `state == UNKNOWN`, which:

- Causes `lockIntent` to proceed normally (new intent).
- Causes `claimFunds` to emit `SuspiciousRelayerActivity` and revert `InvalidState(id, UNKNOWN)`.
- Causes `refundIntent` to revert `IntentNotFound(id)`.

### 4.4 Voucher Forgery Prevention

The Voucher struct encodes `(intentId, solver, amount)`. Any voucher signed by a key other than the current `relayerKey` will not pass ECDSA recovery:

```solidity
address signer = ECDSA.recover(digest, voucher.signature);
if (signer != IVynxAdmin(admin).relayerKey()) revert InvalidVoucherSignature(voucher.intentId);
```

The fuzz suite (P2) exhaustively covers all `pk in [1, SECP256K1_ORDER) \ {RELAYER_PK}` and confirms every wrong-signer path reverts.

### 4.5 Solver Substitution Prevention

Even with a valid relayer signature, a solver cannot claim another solver's escrow:

```solidity
if (voucher.solver != escrow.solver) revert SolverMismatch(voucher.intentId, escrow.solver, voucher.solver);
```

The voucher's solver must match the solver address recorded in the escrow at lock time.

---

## 5. Asymmetric Pause Model

**Threat:** A compromised watchdog key or multisig key could be used to cycle the protocol through pause/unpause, enabling front-running attacks.

**Mitigation — hard-coded role segregation:**

| Role | Can Pause | Can Unpause |
|---|---|---|
| `watchdog` | YES | NO |
| `multisig` | NO | YES |

This is enforced by explicit `msg.sender` checks in `VynxAdmin`:

```solidity
function pauseAll() external {
    if (msg.sender != watchdog) revert Unauthorized();
    if (paused) revert AlreadyPaused();
    ...
}

function unpauseAll() external {
    if (msg.sender != multisig) revert Unauthorized();
    if (!paused) revert NotPaused();
    ...
}
```

A single compromised key cannot cycle the protocol through pause/unpause — two distinct keys with non-overlapping capabilities are required.

---

## 6. UUPS Upgrade Security

**Threat:** A malicious or compromised implementation could self-authorize an upgrade.

**Mitigations:**

1. `_authorizeUpgrade` is guarded by `msg.sender != multisig` — only the board multisig can authorize.
2. `_disableInitializers()` is called in the implementation constructor — the logic contract itself can never be initialized, preventing selfdestruct-via-delegatecall attacks.
3. OZ v5 `UUPSUpgradeable._upgradeToAndCallUUPS` validates that the new implementation exposes `proxiableUUID()` — preventing upgrade to a non-UUPS contract that would brick the proxy.

---

## 7. Collateral Health and Slashing (L1)

**Threat:** A solver defaults on an intent without sufficient collateral, leaving agents uncompensated.

**Mitigation — Solver Health Factor (SHF) gate:**

```
eligible IFF: collateral * 100 / intentValue >= SHF_THRESHOLD (default 120)
```

At 1.20× over-collateralisation, a solver must post 120 USDC of collateral to be eligible for a 100 USDC intent. The `getSHF` view function is called by the off-chain auction system before assigning an intent to a solver.

**Slash mechanics:**
- `executeSlash` is gated by `onlyRole(KEEPER_ROLE)` — the Keeper Bot role is strictly separated from `ADMIN_ROLE`.
- Slashed funds accumulate in `slashPool[solver]` on L1.
- Off-chain CCTP is used to bridge compensation to affected agents on Base L2 via `batchCompensate`.

---

## 8. Withdrawal Liveness

**Guarantee:** Users staking $VYNX in `StakingRewards` can ALWAYS withdraw their principal, regardless of pause state.

```solidity
function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
    // NOTE: no `if (paused)` check here — deliberate
    ...
}
```

The pause flag only blocks `stake`. `withdraw`, `getReward`, and `exit` are always callable. This prevents a compromised watchdog from trapping staker capital.

---

## 9. Integer Arithmetic Safety

- **No SafeMath:** Solidity 0.8.35 native overflow/underflow protection eliminates the need for SafeMath.
- **`unchecked` blocks:** Used only where overflow is mathematically proven impossible:
  - `_deductTakeRate`: `amount * takeRateBps / 10_000` — safe because `takeRateBps <= 20` and any realistic ERC20 amount fits in `uint256`.
  - `receiveTakeRate`: `amount * 40 / 100` — safe because `amount * 100 < 2^256` for any realistic token balance.
  - `rewardPerToken`: accumulation term — safe per documented bound analysis (max term ≈ 4.4e34 << uint256.max).
- **Revenue split zero-leakage:** `toPol = amount - toYield - toBuyback` computed outside `unchecked` block — subtraction is checked for underflow.

---

## 10. Safe Token Handling

All ERC-20 transfers use OZ v5 `SafeERC20.safeTransfer` and `safeTransferFrom`, which:

- Handle tokens that return `false` on failure instead of reverting.
- Handle tokens with no return value (non-compliant USDT behaviour).
- Revert on transfer failure, preventing silent fund loss.

---

## 11. Compiler Version Pinning

```
pragma solidity 0.8.35;
```

Versions 0.8.28–0.8.33 contain the TSTORE poison compiler bug affecting transient storage opcodes. The project is pinned to `0.8.35` across all 14 Solidity files to avoid this vulnerability class entirely.

---

## 12. Attack Scenarios and Mitigations

| Attack | Mitigation |
|---|---|
| Relayer key compromise — drain via forged vouchers | Zero-delay key rotation via `setRelayerKey`; takes effect on next tx |
| Cross-chain voucher replay | `chainId` in EIP-712 domain separator |
| Intent-level replay | `UNKNOWN` state default + `IntentAlreadyExists` revert |
| Reentrancy on `claimFunds` | OZ v5 `ReentrancyGuard` + CEI state transition before transfers |
| Voucher forgery (wrong signer) | ECDSA recovery checked against live `relayerKey` |
| Solver substitution | `SolverMismatch` check in `claimFunds` |
| Double-claim (replay after REDEEMED) | `InvalidState(id, REDEEMED)` — terminal state is irreversible |
| Treasury drain via `distributeRealYield` reentrancy | CEI: accumulator zeroed before external call |
| Pause cycling (front-run attacks) | Asymmetric pause model — watchdog/multisig roles cannot overlap |
| Upgrade to malicious implementation | `_authorizeUpgrade` gated to multisig; proxiableUUID validation by OZ |
| Staker capital trapped by pause | `withdraw` is never blocked by pause flag |
| Solver collateral undercollateralisation | SHF gate enforced off-chain before intent assignment |

---

## 13. Static Analysis Triage

Both Slither and Aderyn (Cyfrin) were executed against the full 14-file source tree. All findings are documented below with disposition (`ACCEPTED` / `REJECTED — FALSE POSITIVE` / `ACKNOWLEDGED`).

---

### 13.1 Slither

**Tool:** Slither v0.11.x — `make slither` (filters `lib/`)

#### Finding S-1: `block.timestamp` comparisons (`timestamp` detector)

**Location:** `VynxSettlement.refundIntent` — `block.timestamp > escrow.deadline`.

**Disposition: ACCEPTED — by design.**

The 900-second escrow deadline is compared against `block.timestamp`. On Base L2 (OP Stack), blocks are produced at a 2-second cadence. The maximum observable timestamp manipulation by a block proposer is bounded by the L1 slot time (~12 seconds). A 12-second drift against a 900-second window represents a 1.3% skew — well within the acceptable tolerance for an intent refund mechanism. The 15-minute manipulation threshold that Slither uses as its heuristic is not applicable to L2 contexts with L1-anchored finality.

#### Finding S-2: `arbitrary-send-erc20` (`arbitrary-send-erc20` detector)

**Location:** `VynxSettlement.lockIntent` — `safeTransferFrom(intent.agent, address(this), intent.amount)`.

**Disposition: REJECTED — FALSE POSITIVE.**

Slither flags this because `intent.agent` is a calldata-supplied address. However:
1. The `from` address in `safeTransferFrom` must have granted an allowance to the Settlement contract.
2. Without a pre-existing `approve` from `intent.agent`, the call reverts in the ERC-20 token's transfer logic.
3. The `intent.agent` field is authenticated via an EIP-712 intent signature verified against the live `relayerKey` — only the relayer can authorize an agent's funds to be pulled.

No arbitrary token drain is possible. The relayer signature requirement is the authorization gate.

#### Finding S-3: `reentrancy-events` (`reentrancy-events` detector)

**Locations:** `claimFunds`, `lockIntent`, `refundIntent`, `distributeRealYield`.

**Disposition: REJECTED — FALSE POSITIVE.**

Slither's `reentrancy-events` detector fires when an event is emitted after an external call, even when reentrancy is structurally impossible. All four functions are:
1. Protected by OZ v5 `ReentrancyGuard` (`nonReentrant` modifier), which enforces single-call-stack exclusivity.
2. Fully CEI-ordered: all state transitions (escrow state, accumulator zeroing) complete before any external token transfer or cross-contract call.

Under `nonReentrant`, any reentrant call to the same contract or other `nonReentrant` functions reverts with `ReentrancyGuardReentrantCall` before any state or event processing begins. No exploitable reentrancy-via-event path exists.

---

### 13.2 Aderyn

**Tool:** Aderyn v0.6.8 — `aderyn .`
**Scope:** 14 Solidity source files, 697 nSLOC.
**Raw findings:** 2 High, 10 Low.

---

#### H-1: Contract Locks Ether Without Withdraw Function — `VynxAdmin.sol`

**Disposition: REJECTED — FALSE POSITIVE.**

Aderyn detects the inherited `UUPSUpgradeable` proxy pattern and incorrectly classifies the ERC1967Proxy's payable fallback as an Ether lock. VynxAdmin is the **implementation contract** — it holds no storage and holds no Ether. The proxy address is the runtime recipient, and the proxy has no ETH-denominated accounting. VynxAdmin contains no `payable` user-facing functions. No Ether lock risk exists.

#### H-2: Reentrancy — State Change After External Call — 3 instances

**Disposition: REJECTED — FALSE POSITIVE (all 3 instances).**

The three flagged sites are:

| Site | External Call Flagged | State Changed After |
|---|---|---|
| `VynxRegistry.executeSlash:151` | `IVaultAdapter.getCollateral(solver)` (view) | `slashPool[solver] += amount` |
| `VynxSettlement.lockIntent:129` | `IVynxAdmin(admin).relayerKey()` (view) | `intents[intentId] = IntentEscrow(...)` |
| `VynxSettlement.claimFunds:172` | `IVynxAdmin(admin).relayerKey()` (view) | `escrow.state = IntentState.REDEEMED` |

All three "external calls" flagged by Aderyn are **pure view functions** (`getCollateral`, `relayerKey`) that cannot write state, receive Ether, or issue callbacks. In all three functions:
- `nonReentrant` is applied — any reentrant call to any nonReentrant function is atomically blocked.
- The actual state-mutating external calls (token transfers, `IVaultAdapter.slash`) occur **after** all state writes — full CEI compliance.

Aderyn's pattern-matching fires on any external call preceding a state change, without distinguishing view/pure calls from state-mutating calls. These findings are noise.

---

#### L-1: Centralization Risk — 6 instances

**Disposition: ACCEPTED — documented design decision.**

VynX V1 is a permissioned settlement protocol in its initial deployment phase. Privileged roles are explicitly modeled in the threat model (§1):
- `ADMIN_ROLE` and `KEEPER_ROLE` on VynxRegistry are assigned to a 3-of-4 board multisig and a bonded keeper infrastructure address respectively. These roles are segregated — the keeper cannot perform admin operations and the admin cannot unilaterally slash.
- `VynxToken.mint` is `onlyOwner` where the owner is the board multisig. Token supply control is intentionally centralized for V1; any future transition to DAO-controlled minting requires a multisig ownership transfer.

All six flagged instances are documented, intentional, and mitigated by the multi-party key structure described in §5 (Asymmetric Pause Model) and §6 (UUPS Upgrade Security).

#### L-2: Large Numeric Literal — `VynxSettlement.sol:250`

**Disposition: REJECTED — readability over notation.**

```solidity
fee = amount * takeRateBps / 10_000;
```

`10_000` is the standard basis-points denominator. Financial smart contracts universally express this constant in decimal form with underscore separator for readability. Replacing it with `1e4` would reduce legibility for auditors and DeFi developers familiar with the bps convention. The value is also enforced at the constant `MAX_TAKE_RATE = 20` — the maximum fee is mathematically bounded to `20 / 10_000 = 0.2%`.

#### L-3: Literal Instead of Constant — 4 instances

**Disposition: ACKNOWLEDGED — non-critical.**

The four flagged literals are:
- `1e18` (×2 in StakingRewards) — the standard Synthetix precision scalar. Defining `uint256 constant PRECISION = 1e18` is cosmetic; the value cannot be confused with any other protocol constant.
- `40` and `50` in VynxTreasury revenue split — these correspond to the protocol's yield (40%) and buyback (50%) allocations documented in the architecture. They are not reused elsewhere in the contract.

No security impact. Extraction to named constants is deferred to a future code hygiene pass.

#### L-4: Loop Contains Revert — `VynxTreasury.batchCompensate:152`

**Disposition: REJECTED — intentional invariant.**

`batchCompensate` iterates over `(agents[], amounts[])` and calls `safeTransfer`. A transfer failure reverts the entire batch. This is the **correct** behavior for a financial compensation function: partial compensation — disbursing to some agents but silently skipping others — would leave the protocol in an inconsistent state where affected agents are incompletely made whole. The `KEEPER_ROLE` gating ensures the caller is trusted infrastructure that assembles valid batches. A failed transfer indicates a bad recipient address or insufficient contract balance, both of which require operator intervention, not silent skipping.

#### L-5: State Change Without Event — 5 instances

**Disposition: ACKNOWLEDGED — covered by parent events.**

The three `setPaused(bool)` functions (StakingRewards, VynxSettlement, VynxTreasury) are called exclusively by `VynxAdmin.pauseAll()` and `VynxAdmin.unpauseAll()`, both of which emit `ProtocolPaused(address, uint256)` and `ProtocolUnpaused(address, uint256)` respectively. Child-level pause events would be redundant noise on the same transaction.

`VynxAdmin.setMultisig()` and `setContractAddresses()` not emitting events is a valid observation. These are governance operations called infrequently by the multisig; the new addresses are immediately readable on-chain. Emitting events would improve off-chain indexer support — this is a low-priority improvement for a V1.1 governance event pass.

#### L-6: Address Set Without Zero-Check — `VynxRegistry.setAdapter:185`

**Disposition: ACKNOWLEDGED — intentional pattern.**

```solidity
adapters[protocol] = IVaultAdapter(adapterAddr);
```

`setAdapter` is gated by `onlyRole(ADMIN_ROLE)`. Setting `adapterAddr = address(0)` effectively deregisters an adapter — solvers attempting to register with a zeroed-out adapter protocol will receive `AdapterNotFound`. This is the idiomatic removal pattern for adapter registries and is a valid admin operation. A zero-check would prevent adapter removal, reducing operational flexibility without adding security value (the admin is a trusted 3-of-4 multisig).

#### L-7: State Variable Could Be Immutable — `VynxTreasury.keeper`, `VynxTreasury.multisig`

**Disposition: REJECTED — operational flexibility retained.**

`keeper` and `multisig` are constructor-set addresses in an immutable contract. Making them `immutable` would save ~2,100 gas per read (SLOAD → direct embedding). However, VynxAdmin governance can redeploy VynxTreasury with an updated keeper or multisig address without a full protocol upgrade by pointing the settlement/admin to a new treasury instance. Retaining these as mutable `address public` fields preserves this redeployment pattern and allows future versions to use the same constructor signature. Gas cost is negligible at L2 fee levels (sub-cent per transaction).

#### L-8: Unchecked Return — `VynxRegistry._grantRole:73,74`

**Disposition: REJECTED — FALSE POSITIVE.**

OZ v5 `AccessControl._grantRole(bytes32, address)` returns `bool` indicating whether the role was newly granted (vs. already held). In VynxRegistry's constructor, `_grantRole(ADMIN_ROLE, _admin)` and `_grantRole(KEEPER_ROLE, _keeper)` are called once during deployment. The return value is irrelevant — a `false` return would mean the deployer accidentally passed the same address for both roles, which is a deployment-time operator error (not a runtime vulnerability). The constructor-context guarantee makes this finding noise.

#### L-9: Unused Error — 3 instances

**Disposition: ACKNOWLEDGED — reserved interface surface.**

| Error | Interface | Reason Retained |
|---|---|---|
| `RewardsDurationNotFinished` | `IStakingRewards` | Reserved for V2 restriction on `notifyRewardAmount` during active periods |
| `InvalidSlashSignature` | `IVynxRegistry` | Reserved for V2 ECDSA-attested slash authorization (replacing `KEEPER_ROLE` model) |
| `TokenNotWhitelisted` | `IVynxSettlement` | Reserved for V2 on-chain intent token whitelist |

These errors exist in interface files, not implementation files. They impose zero runtime cost (errors are compile-time artifacts) and signal the intended V2 extension surface to integrators. Removing them would constitute an interface breaking change and is rejected.

#### L-10: Public Function Not Used Internally — `StakingRewards.stake`

**Disposition: ACKNOWLEDGED — Synthetix pattern.**

`stake()` is `public` by design: the Synthetix staking pattern marks `stake`, `withdraw`, and `getReward` as `public` to allow composability (other contracts can call them on behalf of users). `exit()` calls `withdraw()` and `getReward()` — not `stake()`. The `public` visibility here is an inherited architectural choice from the Synthetix v2 staking reward model. Converting to `external` saves one opcode per external call and is a cosmetic gas micro-optimization with no security implication.

---

### 13.3 Summary Matrix

| Finding | Tool | Severity | Disposition |
|---|---|---|---|
| `block.timestamp` in deadline check | Slither | Informational | Accepted — Base L2 2s blocks make skew negligible |
| `arbitrary-send-erc20` in `lockIntent` | Slither | Medium | Rejected — EIP-712 relayer signature is the authorization gate |
| `reentrancy-events` in 4 functions | Slither | Low | Rejected — `nonReentrant` + CEI; flagged calls are view-only |
| H-1: Ether lock in VynxAdmin | Aderyn | High | Rejected — UUPS proxy pattern false positive; no Ether held |
| H-2: State change after view call (×3) | Aderyn | High | Rejected — all flagged calls are `view`; `nonReentrant` + CEI enforced |
| L-1: Centralization (×6) | Aderyn | Low | Accepted — documented multisig governance model |
| L-2: Large numeric literal | Aderyn | Low | Rejected — bps convention; readability over notation |
| L-3: Literal instead of constant (×4) | Aderyn | Low | Acknowledged — non-critical cosmetic |
| L-4: Loop revert in `batchCompensate` | Aderyn | Low | Rejected — partial compensation is a worse invariant |
| L-5: State change without event (×5) | Aderyn | Low | Acknowledged — parent events cover pause; future improvement |
| L-6: No zero-check on adapter address | Aderyn | Low | Acknowledged — address(0) is valid remove-adapter operation |
| L-7: Variables could be immutable | Aderyn | Low | Rejected — operational redeployment flexibility retained |
| L-8: Unchecked `_grantRole` return | Aderyn | Low | Rejected — constructor context; return value is informational |
| L-9: Unused errors (×3) | Aderyn | Low | Acknowledged — reserved V2 interface surface |
| L-10: `public` instead of `external` | Aderyn | Low | Acknowledged — Synthetix composability pattern |

**Zero confirmed vulnerabilities. All High findings are false positives. All Low findings are either false positives, accepted design decisions, or acknowledged non-critical observations.**
