# VynX Settlement V1 — Security

This document describes the security properties, mitigations, and design invariants of the
VynX Settlement V1 protocol. Every claim is grounded in the source under `src/`.

---

## 1. Checks-Effects-Interactions (CEI) Ordering

Every value-moving path writes state before performing external token transfers.

### `VynxSettlement.lockIntent` (UNKNOWN → LOCKED) — §D3.6 canonical order

1. **Checks** — not paused; `intents[id].state == UNKNOWN`; `intent.token == usdc` (on-chain
   token lock); `intent.inputAmount > 0`; `msg.sender == intent.solver` (§D5 Option A). Then
   `expectedNonce = IntentNonceLib.computeNonce(8 intent terms)` — the nonce is recomputed
   on-chain, never taken from calldata.
2. **Effects** — the escrow record is written (`solver = msg.sender`,
   `deadline = now + DEFAULT_DEADLINE`, `state = LOCKED`).
3. **Interactions** — `IUSDCAuthorization(usdc).receiveWithAuthorization(agent, address(this),
   inputAmount, 0, intent.deadline, expectedNonce, v, r, s)`. Circle's audited code verifies the
   agent's EIP-3009 signature and moves the funds; any revert (invalid/expired signature, used
   or canceled nonce, insufficient balance, blacklist, pause) unwinds the escrow write
   atomically with the whole transaction.

The escrow write preceding the external USDC call is pinned by the design doc (§D3.6); any
inverted order is a CEI regression. `nonReentrant` is retained as defense-in-depth.

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

## 3. Signature Replay Prevention

### Intent authorizations (EIP-3009, agent-signed)

The agent's single `ReceiveWithAuthorization` signature is protected by **two independent
on-chain replay layers** (§D1.4):

1. **USDC authorization state** — Circle's FiatTokenV2_2 marks
   `_authorizationStates[agent][nonce] = true` on use (and on `cancelAuthorization`); any
   resubmission of the same authorization reverts inside USDC, regardless of caller or intent
   wrapper.
2. **The `IntentState` machine** — a second `lockIntent` with the same `intentId` reverts
   `IntentAlreadyExists`, even when carrying a fresh, distinct authorization.

Cross-chain and cross-deployment replay are killed by the 3009 envelope itself (§D2.4): the
agent signs `to = settlement` inside Circle's typed struct against **USDC's own EIP-712
domain** (which binds the live `chainId` and the USDC contract address), and Circle enforces
`msg.sender == to` — so an authorization is spendable only through the exact deployment it
names. Cross-protocol replay of the nonce pre-image is killed by `INTENT_NONCE_DOMAIN_TAG`
(term #0 of the §D2.2 schema). Signature malleability (high-`s`, `v ∉ {27, 28}`) is rejected
by Circle's ECRecover before recovery.

The legacy monotonic intent `nonce` was removed (§D1.4): with the two layers above, a third
sequential counter added nothing and would have forced per-agent nonce tracking in the SDK.

### Vouchers (EIP-712, relayer-signed — unchanged)

1. **Domain `chainId`** — `VynxSettlement` uses `EIP712("VynxSettlement", "1")`, so the domain
   separator binds the `chainId` and the verifying contract address. A voucher signature
   produced for Base cannot be replayed on any other chain or against any other contract.
2. **State-machine finality** — REDEEMED/REFUNDED are terminal. A voucher that was already
   redeemed cannot be redeemed again: the second `claimFunds` observes a non-LOCKED state and
   reverts `InvalidState`.

The relayer key used to verify vouchers is read live from `IVynxAdmin(admin).relayerKey()` on
every call. The relayer signs **vouchers only** — it no longer signs intents.

---

## 3a. Solver Provenance on Lock (§D5 Option A)

`solver` is the single unsigned field of the Intent (the auction winner does not exist at
signing time). To bind its provenance, `lockIntent` requires `msg.sender == intent.solver` and
stores `escrow.solver = msg.sender`. Consequences:

- **Mis-locks are self-identifying** — anyone consuming an agent's authorization with the
  unaltered terms must do it from the address written into the escrow, enabling the existing
  penalty machinery (relayer mismatch detection → jail → slash) and making unregistered
  attackers pay gas for an attributable, zero-payout, ≤ 15-minute nuisance.
- **Framing an innocent solver is impossible** — nobody can plant another solver's address in
  the escrow record.
- **Severity stays DoS-bounded, never theft** — without a relayer-signed voucher there is no
  `claimFunds`; the only exits are claim-by-the-approved-solver or refund-to-agent after 900s.
- `agent == solver` is **allowed, defined behavior** (ratified): a self-filling registered
  solver pays itself through escrow and still forfeits the take-rate fee — economically
  self-punishing, not an attack.

---

## 3b. Inherited USDC Compliance-Layer Risk (§D3.5 — accepted)

"Funds can never strand" holds at the protocol layer but NOT against Circle's compliance
layer. FiatTokenV2_2 carries blacklist gates and a global pause on its transfer paths:

- If the refund/claim **recipient** (agent or solver) is blacklisted by Circle while funds sit
  in escrow, the outbound `safeTransfer` reverts and the escrow strands **LOCKED** (no silent
  fund loss; state and balance intact) until Circle un-blacklists or unpauses.
- USDC paused mid-flight blocks lock, claim, and refund until unpause.
- A blacklisted **agent** cannot be pulled from (`receiveWithAuthorization` checks `from`) — the
  lock reverts cleanly, nothing written. A blacklisted solver EOA is invisible to USDC at lock
  time: USDC's `msg.sender` is the settlement contract, and Circle blacklist-screens only
  `from`/`to` — never the caller, as pinned against deployed Circle bytecode by
  `test_parity_checkOrder_strangerCallerBlacklisted`. The blacklisted solver surfaces at claim
  time as the recipient case above (`test_claimFunds_blacklistedSolverStrandsEscrow`); a
  blacklisted *settlement* blocks every lock (`test_lockIntent_revertSettlementBlacklisted`).
  The design doc's original §D3.5 claim that a blacklisted solver "cannot lock" was an erratum,
  corrected in Sprint 1.3.

This risk is **accepted and documented** (ratified Q7): it is inherited from USDC, exists
identically in the previous `safeTransferFrom` design, and in every USDC escrow on Base.

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
| Cross-chain signature replay | Reuse a Base signature on another chain | Vouchers: EIP-712 domain binds `chainId` + verifying contract. Intents: USDC's own domain binds `chainId` + the USDC address (§D2.4). |
| Voucher forgery | Sign with a non-relayer key | `ECDSA.recover` != `relayerKey()` → `InvalidVoucherSignature`. |
| Intent forgery | Lock with a signature from any key ≠ agent | Circle's USDC recovers the 3009 digest to `from = intent.agent`; mismatch reverts inside USDC (§D8 #2). |
| Term tampering | Alter any signed intent field between signing and lock | The recomputed nonce diverges from the signed one → USDC signature check fails (§D8 #4/#5/#9 — 8-field tamper matrix + omitted-term exhaustiveness, fuzzed). |
| Authorization replay | Re-submit a consumed agent authorization | USDC `_authorizationStates` (layer 1) + `IntentAlreadyExists` (layer 2) — §D8 #6/#7. |
| Stale authorization | Lock after the agent's deadline | USDC enforces strict `now < validBefore (= intent.deadline)`, including the exact `now == deadline` boundary (§D8 #3). |
| Signature mauling | High-`s` / flipped-`v` twin of a valid authorization | Circle's ECRecover malleability gates reject before recovery (§D8 #16). |
| Anonymous mis-lock / solver framing | Lock with someone else's `solver` value | `msg.sender == intent.solver` + `escrow.solver = msg.sender` (§D5 Option A; §D8 #10). |
| Token smuggling | Lock a malicious ERC-20 with a valid signature over it | `intent.token != usdc` → `TokenNotSupported` before any signature work (§D8 #11). |
| Empty-escrow pollution | Lock with `inputAmount == 0` | `ZeroAmount()` before any external call (§D8 #18). |
| Cross-deployment replay | Consume an authorization through a second deployment | Circle enforces `msg.sender == to`; the signed `to` names exactly one settlement (§D8 #19). |
| Cancellation race | Agent cancels before the solver's lock lands | `cancelAuthorization` kills the nonce inside USDC; `lockIntent` reverts cleanly, nothing written (§D8 #13). |
| Compromised relayer key | Continued use of a leaked key | Watchdog `setRelayerKey`; Settlement reads the key live every call (zero-delay rotation). Blast radius is now vouchers only — the relayer cannot sign or alter intents. |
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
5. **Canonical constant immutability** — `VOUCHER_TYPEHASH`, `INTENT_NONCE_DOMAIN_TAG`, and the
   §D2.2 nonce schema (asserted against the cross-language test vector) never change.
6. **Slash neutrality** — the registry retains no slashed value; `agentShare + treasuryShare ==
   slashTotal` and both are transferred out in the same call.
7. **Lock/authorization atomicity** — a LOCKED escrow exists only if the matching EIP-3009
   nonce is marked used inside USDC; locks and authorization consumption succeed or fail
   together (§D8 #1/#6/#8).
8. **Solver provenance** — `escrow.solver` always equals the `msg.sender` of the lock
   transaction (§D5 Option A); mis-locks are attributable, framing is impossible.
9. **Nonce exhaustiveness** — the 3009 nonce commits to all 8 intent terms under the protocol
   domain tag; no single-term tampering or term omission can produce a lockable signature
   (§D8 #5/#9).

These invariants are continuously exercised by the unit/fuzz suites and the stateful invariant
campaign. The Sprint 1.2 transitional vacuity is resolved: since Sprint 1.3 the token etched at
the canonical USDC address in the invariant suite is the EIP-3009-capable `MockUSDC3009`, so the
Handler drives the full gasless lock path fork-free — agent-key signed authorizations, §D2
nonces via `IntentNonceLib`, locks from the solver address, plus randomized adversarial
attempts (wrong key, expired, tampered term, tampered nonce, replay, cancellation race). Seven
`invariant_*` functions assert solvency, finality, treasury integrity, staking conservation,
constant immutability, locked-escrow ⇒ used-nonce (invariant 7 above), and adversarial lock
rejection after every fuzzer call; the campaign's non-vacuity evidence (locks succeeded,
adversarial attempts rejected, seed) is recorded in `tests.md` §6.
