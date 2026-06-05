# VynX Settlement V1 — Test Suite Reference

The protocol ships with **234 Foundry test functions**:

- **214 fork-free** functions (unit + fuzz) running against locally deployed protocol bytecode
  and the sanctioned `MockUSDC3009` token replica — deterministic, zero RPC.
- **13 fork-based parity** functions (`test/integration/UsdcRevertParity.t.sol`) probing real
  Circle USDC bytecode on a pinned Base Mainnet fork.
- **5 fork-based integration** functions (`test/integration/FullFlow.t.sol`) — the real-USDC
  proof of correctness for the gasless custody path.
- **7 fork-free stateful invariants** (`test/invariant/`) making zero RPC calls.

`make test` runs the 227 non-invariant functions: **227 passed / 0 failed**.
`make test-invariants` runs the stateful campaign: **7 passed / 0 failed** (256 runs × 15
depth = 3,840 fuzzer calls, in roughly 1 second with no network access).

---

## 1. Per-File Breakdown

| File | Functions | Tier |
| --- | --- | --- |
| `test/unit/VynxSettlement.t.sol` | 50 | Unit (fork-free, MockUSDC3009) |
| `test/unit/VynxAdmin.t.sol` | 30 | Unit |
| `test/unit/MockUSDC3009.t.sol` | 23 | Mock self-tests (fork-free) |
| `test/unit/DirectVaultAdapter.t.sol` | 21 | Unit (Ethereum fork) |
| `test/unit/StakingRewards.t.sol` | 20 | Unit |
| `test/unit/VynxRegistry.t.sol` | 19 | Unit (Ethereum fork) |
| `test/unit/VynxTreasury.t.sol` | 19 | Unit |
| `test/unit/VynxToken.t.sol` | 10 | Unit |
| `test/unit/IntentNonceLib.t.sol` | 8 | Unit (incl. cross-language vector drift guard) |
| `test/fuzz/Fuzz.t.sol` | 9 | Fuzz (fork-free, MockUSDC3009 etched at canonical USDC) |
| `test/integration/UsdcRevertParity.t.sol` | 13 | Integration (Base fork, REAL USDC + mock) |
| `test/integration/FullFlow.t.sol` | 5 | Integration (Base fork, REAL USDC) |
| `test/invariant/Invariants.t.sol` | 7 | Stateful invariants (fork-free) |
| **Total** | **234** | |

---

## 2. Testing Philosophy — No Protocol Mocks, Tiered Token Fidelity (§D6.3)

The suite forbids mocking protocol contracts: every test deploys the real VynX bytecode. Token
fidelity follows the design doc's ratified tier mandate:

| Tier | Token | Why |
| --- | --- | --- |
| Unit | `MockUSDC3009` (local instance) | Deterministic, fork-free; probes every revert path incl. crafted signatures, windows, malleability, blacklist/pause |
| Fuzz | `MockUSDC3009` (`vm.etch`ed at the canonical USDC address) | Same; fuzzing the 8-field tamper matrix needs cheap local signing |
| Invariant | `MockUSDC3009` (`vm.etch`ed at the canonical USDC address) | The campaign must stay fork-free / zero-RPC while the Handler drives the full gasless `receiveWithAuthorization` lock path |
| Integration | **Real Circle USDC** on a pinned Base Mainnet fork | Non-negotiable gate: only genuine Circle bytecode proves the digest, domain, and call shape |

`MockUSDC3009` is a TOKEN mock (the single sanctioned local token), not a protocol mock — it
replicates Circle FiatTokenV2_2's EIP-3009 layer including its exact revert strings, which the
parity suite (Section 5) pins byte-for-byte against deployed bytecode. Fork-based suites fund
actors with `deal(...)`; fork-free suites use the mock's test-only `mint`.

**Assertion discipline:** VynX's own custom errors are asserted by selector. Failures that
bubble from the USDC layer are asserted by OUTCOME (revert + no escrow + nonce unused) — never
by third-party revert string. The parity suite records string fidelity; it is not a license
for brittle string assertions elsewhere.

---

## 3. Unit Suites (fork-free unless noted)

- **VynxSettlement (50)** — the §D8 security-invariant matrix over the gasless `lockIntent`
  custody path (#1–#4, #6–#8, #10–#11, #13–#14, #16–#20: happy path, wrong key, expiry incl.
  the exact `now == deadline` boundary, tampered nonce, dual replay layers, atomicity,
  Option A provenance, token lock, cancellation race, pause, malleability, blacklist/pause
  inheritance and strand-and-recover cases, zero amount, cross-deployment binding,
  `agent == solver`); `claimFunds` (fee, zero-fee, max-fee, paused, UNKNOWN, replay, refunded,
  solver mismatch, bad voucher signature); `refundIntent` (happy + not-found / redeemed /
  refunded / deadline-not-expired); `syncConfig` / `setPaused` authorization; constructor
  guards; and the attack group (replay, voucher forgery, key rotation liveness, cross-chain
  replay).
- **VynxAdmin (30)** — initialize, pause/unpause asymmetry, setters, UUPS upgrade gates.
- **MockUSDC3009 self-tests (23)** — §D6.2 fidelity: domain shape, Circle typehashes, strict
  window boundaries, payee rule, malleability gates, cancel, blacklist/pause toggles, events,
  and the caller-not-screened rule (Sprint 1.3 parity fix).
- **DirectVaultAdapter (21)** / **VynxRegistry (19)** — L1 custody + 5/5 slash distribution
  (Ethereum Mainnet fork).
- **StakingRewards (20)** — stake/withdraw/getReward/exit, reward math, notify rollover.
- **VynxTreasury (19)** — 40/50/10 split with zero leakage, distribute/sweep/compensate.
- **VynxToken (10)** — ERC-20 + EIP-2612 permit.
- **IntentNonceLib (8)** — §D2 nonce schema: domain tag, encoding, and the cross-language
  test-vector drift guard (parses `test/fixtures/intent-nonce-vector.json` against the
  Solidity mirror).

---

## 4. Fuzz Suite — `test/fuzz/Fuzz.t.sol` (9, fork-free)

`MockUSDC3009` is etched at the canonical USDC address (StakingRewards/Treasury are
constructed against the canonical constant). Properties:

- `testFuzz_lockIntent` — a valid agent-signed EIP-3009 authorization with bounded amount
  always locks; escrow correct, `escrow.solver == msg.sender`, nonce marked used.
- `testFuzz_lockIntent_tamperedTermNeverLocks` + concrete 8-field matrix — §D8 #9: sign X,
  submit X′ differing in one signed field ⇒ revert, zero state.
- `testFuzz_lockIntent_omittedTermNeverLocks` + concrete 9-case matrix — §D8 #5: any 8-term
  pre-image variant (each term omitted, incl. the domain tag) never verifies.
- `testFuzz_claimFunds_wrongSigner` — any key ≠ relayer ⇒ `InvalidVoucherSignature`.
- `testFuzz_refundIntent_timestamps` — refund reverts iff `block.timestamp <= deadline`.
- `testFuzz_staking_math` / `testFuzz_treasury_split` — reward-math and split-conservation
  properties.

---

## 5. Integration Suites (Base Mainnet fork, REAL Circle USDC)

### `FullFlow.t.sol` (5) — the proof of correctness

Pinned fork (block 46,800,000). The agent signs ONE EIP-3009 authorization against USDC's
LIVE domain separator read from the forked contract; the solver locks and pays gas.

- `test_fullFlow_completeLoop` — lock (nonce false→true inside Circle bytecode, agent debited
  exactly, `escrow.solver == msg.sender`) → claim → treasury split → distribute → stake →
  reward.
- `test_fullFlow_refundPath`, `test_fullFlow_pausePropagation` (nonce untouched while paused;
  the same authorization locks after unpause), `test_fullFlow_buybackSweep`,
  `test_fullFlow_mixedSettlement`.

### `UsdcRevertParity.t.sol` (13) — revert-string parity record (Sprint 1.3)

Each failure mode is triggered on BOTH real USDC (Circle's live `blacklister()` / `pauser()`
roles impersonated via `vm.prank`) and the local `MockUSDC3009`, asserting identical revert
bytes — the executable byte-for-byte parity proof. Captured ground truth:

| Failure mode | Exact revert string (verified on deployed Base USDC) |
| --- | --- |
| Expired window (incl. `now == validBefore` boundary) | `FiatTokenV2: authorization is expired` |
| Not yet valid (incl. `now == validAfter` boundary) | `FiatTokenV2: authorization is not yet valid` |
| Used or canceled nonce | `FiatTokenV2: authorization is used or canceled` |
| Caller is not the payee | `FiatTokenV2: caller must be the payee` |
| Wrong signer | `FiatTokenV2: invalid signature` |
| Malleated high-`s` | `ECRecover: invalid signature 's' value` |
| `v` outside {27, 28} | `ECRecover: invalid signature 'v' value` |
| Blacklisted `from` or payee | `Blacklistable: account is blacklisted` |
| Global pause | `Pausable: paused` |

Check-order ground truth (pinned by the two order probes): the validity window is checked
**before** the signature; a blacklisted **third-party caller** is rejected by the payee rule,
never by a blacklist check (Circle screens only `from`/`to` — this probe caught and fixed the
mock's extra `msg.sender` gate, the Sprint 1.3 P0 parity fix).

---

## 6. Invariant Suite — `test/invariant/` (7, fork-free, zero RPC)

`setUp` etches the EIP-3009-capable `MockUSDC3009` at the canonical USDC address, so the
fuzzer makes zero RPC calls while the Handler drives the full gasless custody path: agent-key
`vm.sign` authorizations against the etched token's live domain, §D2 nonces via
`IntentNonceLib`, locks from the solver address (§D5 Option A). The action space includes
`lockIntentValid` (must never revert) and `lockIntentInvalid` (six adversarial scenarios:
wrong key, expired, tampered term, tampered nonce, protocol replay, cancellation race —
violations travel through ghost state because `fail_on_revert = false` swallows in-handler
asserts), plus claim, refund, stake, withdraw, yield distribution, and take-rate sync.

| # | Invariant | What a failure means |
| --- | --- | --- |
| 1 | `invariant_settlementSolvency` (§D8 #12) | USDC released without a state transition — insolvency |
| 2 | `invariant_stateMachineFinality` | a REDEEMED/REFUNDED intent mutated — terminal-state bypass |
| 3 | `invariant_treasuryRevenueIntegrity` | fee wei unaccounted — revenue leakage |
| 4 | `invariant_stakingSupplyConservation` | VYNX balance ≠ Σ staked — custody drift |
| 5 | `invariant_typehashImmutability` (§D8 #15) | VOUCHER_TYPEHASH / nonce domain tag / §D2.5 vector drifted — cross-repo schema break |
| 6 | `invariant_lockedEscrowImpliesUsedNonce` | a LOCKED escrow without a used-nonce mark — custody-path forgery |
| 7 | `invariant_adversarialLockRejection` | an invalid/expired/tampered/replayed/canceled authorization locked or left residue |

### Non-vacuity evidence (Sprint 1.3 campaign record)

Recorded run: `FOUNDRY_FUZZ_SEED=0x5391731`, 256 runs × depth 15 = 3,840 fuzzer calls,
campaign metrics (forge `show_metrics`):

| Handler action | Calls | Reverts |
| --- | --- | --- |
| `lockIntentValid` (successful gasless locks = nonces marked used) | 463 | 0 |
| `lockIntentInvalid` (adversarial attempts, all cleanly rejected) | 490 | 0 |
| `claimFunds` | 475 | 0 |
| `refundIntent` | 452 | 0 |
| `distributeYield` | 481 | 0 |
| `stake` / `withdraw` / `syncConfig` | 494 / 527 / 458 | 0 |

463 locks reached LOCKED through real `receiveWithAuthorization` calls (zero reverts proves
the digest/domain/call shape), 490 adversarial attempts were all rejected with zero residue
(`ghost_invalidLockAttempts == ghost_invalidLockRejected`, violation flag never set), and the
used-nonce ghost set grew by one entry per lock — invariants 1–3, 6 and 7 are exercised
non-vacuously. (Sprint 1.2's transitional vacuity is closed; the re-arm also exposed and fixed
a latent Handler bug where the treasury keeper was mis-wired, silently killing the yield
path.)

---

## 7. Fork-Free Invariant Design (`vm.etch`)

In `setUp`, a local `MockUSDC3009` is deployed and its runtime code is placed at the canonical
USDC address via `vm.etch(USDC, ...)`. The mock is etch-safe: `DOMAIN_SEPARATOR()` is computed
dynamically from `address(this)` and no constructor-set storage is read. The fuzzer therefore
makes **zero RPC calls** during its heavy, concurrent state access — eliminating provider
rate-limiting and making the campaign fully deterministic for a given seed. Real-USDC
behaviour remains covered by the integration tier; revert-string fidelity of the mock is
pinned byte-for-byte by `UsdcRevertParity.t.sol`. The token is etched before nonce capture so
the `computeCreateAddress` offset pre-computation stays valid.

---

## 8. Gas Snapshot (Sprint 1.3 baseline)

`.gas-snapshot` (repo root, created by `forge snapshot --no-match-path "test/invariant/*"`) is
the first recorded baseline — no prior snapshot existed. Headline custody-path numbers
(`forge test --gas-report`):

| Path | lockIntent gas (vs real USDC, FullFlow fork) | lockIntent gas (vs mock, unit tier) |
| --- | --- | --- |
| Successful lock (max) | 205,621 | 192,633 |
| Early-revert floor (min) | 32,402 | 32,390 |

Dollar cost on Base (method: live `cast gas-price` on Base = 0.006 gwei at capture time ×
max real-USDC gas, plus the post-EIP-4844 L1 data fee, which is fractions of a cent for the
~450-byte calldata):

- ETH @ $2,500 → **$0.0031** per lock
- ETH @ $4,000 → **$0.0049** per lock
- ETH @ $6,000 → **$0.0074** per lock

The `< $0.01` target holds with the extra `receiveWithAuthorization` external call — and the
agent's cost is **zero** (one off-chain signature; the solver pays the lock gas).

---

## 9. Tooling and Configuration

### Makefile targets

| Target | Action |
| --- | --- |
| `make build` | `forge build`. |
| `make test` | Unit + integration + fuzz, excluding invariants (`--no-match-path "test/invariant/*"`). |
| `make test-unit` | Unit suites. |
| `make test-fuzz` | Fuzz suite (1024 runs). |
| `make test-invariants` | Fork-free invariant campaign (prints the metrics table). |
| `make coverage` | Coverage summary via `forge coverage --ir-minimum`, excluding the invariant path. |
| `make slither` | Static analysis, filtering `lib/`. |

### foundry.toml

- `solc_version = "0.8.35"`; `optimizer = true`, `optimizer_runs = 500`, `via_ir = true`.
- `fuzz = { runs = 256 }`; `invariant = { runs = 256, depth = 15, fail_on_revert = false }` —
  `fail_on_revert` is pinned explicitly: the Handler routes adversarial-lock violations
  through ghost state, so in-handler reverts must stay tolerated.
- `no_match_coverage = "script|test"` focuses coverage on `src/`.
- Reproduce the recorded invariant campaign with
  `FOUNDRY_FUZZ_SEED=0x5391731 make test-invariants`.
- `.gas-snapshot` is generated with `forge snapshot --no-match-path "test/invariant/*"`;
  any `--check` comparison must use the same filter (invariant campaign gas is
  seed-dependent and excluded by design).
