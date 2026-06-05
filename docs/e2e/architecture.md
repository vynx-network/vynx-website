# Architecture — vynx-e2e control plane

`vynx-e2e` contains **no protocol logic**. It is the control plane that stands up a
complete, live VynX Protocol V1 stack on local forks and drives the 51-case (37-file)
acceptance suite against it. Everything here is orchestration: spawn the real binaries,
deploy the real contracts, fund wallets, run the tests, tear down.

**The model under test is GASLESS (FASE 5).** The agent signs ONE EIP-3009
`ReceiveWithAuthorization` off-chain (its nonce is the §D2 keccak256 of all 8 trade terms)
and sends ZERO on-chain transactions; the winning solver pays the lock gas
(`lockIntent`), pays the destination, pulls the relayer-signed voucher, and claims
(`claimFunds`). A never-settled escrow is recovered by the protocol's PERMISSIONLESS
`refundIntent`, which the suite exercises directly on-chain (it is the chain's guarantee;
the SDK's autonomous-refund timing is the SDK's own test responsibility).

This document describes how the control plane is wired. The canonical source is
`scripts/e2e.sh` (the orchestrator), `fixtures/` (the harness), and `docker-compose.yml`.
Line references point at the current source.

---

## 1. The four-repo stack

The protocol code under test lives in three sibling repositories; `vynx-e2e` builds and
runs their artifacts:

| Repo | Artifact used by e2e | How |
|---|---|---|
| `vynx-relayer` | `bin/relayer`, `bin/watchdog` (Go, built with `-tags e2e`) | `make install-bins` builds them from `$RELAYER_REPO` into `./bin/` |
| `vynx-settlement` | Solidity contracts (`DeployL1` / `DeployL2`) | `e2e.sh` deploys them onto the anvil forks via `forge script` |
| `vynx-sdk` | `@vynx/sdk` (TypeScript) | installed as `file:../vynx-sdk`; the agent fixtures call it |
| `vynx-e2e` | `bin/solver` (Go test solver) | `make solver-build` compiles `solver/main.go` |

The relayer is built with `-tags e2e`: it signs vouchers **in-process** from
`E2E_RELAYER_KEY` — no AWS KMS, no standalone signer binary, no UDS socket
(`e2e.sh:534`). Consequently `make install-bins` builds only the relayer and watchdog;
`cmd/signer` is **not** built or launched here.

---

## 2. Orchestration sequence (`scripts/e2e.sh`)

`make e2e` = `make install-bins solver-build && bash scripts/e2e.sh`. The script runs a
fixed phase sequence and always tears down in reverse order:

1. **INFRA** — `docker compose up -d` brings up PostgreSQL + Redis and waits for both to be
   healthy (`e2e.sh:103-105`).
2. **ANVIL** — five anvil forks come up (§3). The Base fork is PINNED at the block before
   the live FASE 1 deployment, then its clock is RE-ANCHORED to wall-time (see §3.1).
3. **DEPLOY** — `DeployL2` is **REPLAYED on the pinned Base fork as the live deployer** (key
   from the settlement repo's `.env`) so every contract lands byte-identical at its LIVE
   testnet address — VynxSettlement at the SDK pin `0xac13…`, with real Circle Base Sepolia
   USDC `0x036C…` as the input token (the EIP-3009 domain the SDK signs against and the
   relayer pins). `DeployL1` deploys VynxRegistry + DirectVaultAdapter on the Eth fork. The
   freshly deployed addresses are exported, overriding the placeholders in `.env`.
4. **FIXTURES** — `fixtures/setup.ts` funds the solver/agent wallets (storage-slot deals of
   real Circle USDC — no public mint), funds the keeper for the permissionless refund, seeds
   solver collateral, and deals each destination chain's real USDC.
5. **RELAYER** — `bin/relayer` is launched in the background (`e2e.sh:591`), then the
   **watchdog** `bin/watchdog` (`e2e.sh:674`).
6. **TESTS** — `npx vitest run tests/` executes the suite.
7. **TEARDOWN** — every spawned process and the Docker stack are stopped (always, even on
   failure).

The **solver** is not started by `e2e.sh`. Each test owns its own solver topology through
`fixtures/solver-manager.ts` (§4), because different tests need 3 solvers, 0 solvers, or 1
misbehaving solver.

### Processes the control plane runs

| Process | Started by | Notes |
|---|---|---|
| 5 × `anvil` | `e2e.sh` | Base + Eth + Arbitrum + Optimism + Polygon forks |
| `bin/relayer` | `e2e.sh:591` | in-process EIP-712 signing; serves HTTP `:8080` + WS |
| `bin/watchdog` | `e2e.sh:674` | FinalityWatcher (W8), slash executor; `WATCHED_CHAINS="8453,1"` |
| `bin/solver` | `solver-manager.ts` (per test) | one binary, many flag configs (INV-E2E-4) |

**Not run in e2e:** the standalone **signer** binary (relayer signs in-process) and the
**keeper** binary. `KEEPER_ROLE` is granted to the watchdog so it can execute slashes
(`e2e.sh`); no keeper *process* runs. The `KEEPER_PK` key IS used by the harness, however:
it is the funded, non-agent EOA that broadcasts the protocol's PERMISSIONLESS `refundIntent`
in the refund/slash suites (keeping the agent at zero transactions).

**Settlement state (GASLESS):** the winning solver pulls its voucher and calls `claimFunds`
itself, so a settled escrow reaches **REDEEMED** on-chain (the suites wait for REDEEMED via
`waitForEscrowState`). The old BLINDAJE assumption that "settled escrows stay LOCKED because
no keeper claims" is obsolete. The economics/voucher suites assert the REDEEMED on-chain
math (take-rate split, voucher replay → InvalidState) directly.

---

## 3. Multi-fork anvil topology

Five anvil instances run in parallel. **Base and Eth fork public testnets** (Sepolia) with
their chain-ids overridden to the mainnet values the protocol expects; the **three
destination chains fork their real mainnets**. (`e2e.sh:125-182`.)

| Logical chain | Port | `--chain-id` | Fork source | Role |
|---|---|---|---|---|
| Base (origin) | 8545 | `84532` | `BASE_SEPOLIA_RPC_URL` (Base Sepolia) | origin chain: lock + auction + settlement; serves `IntentLocked` over WS |
| Eth (L1) | 8546 | `1` | `ETH_SEPOLIA_RPC_URL` (Eth Sepolia) | collateral + L1 slash; chain-id forced to `1` so L1 txs are not rejected (`e2e.sh:129`) |
| Arbitrum (dest) | 8547 | `42161` | `ARBITRUM_RPC_URL` (Arbitrum mainnet) | cross-chain destination payment |
| Optimism (dest) | 8548 | `10` | `OPTIMISM_RPC_URL` (Optimism mainnet) | cross-chain destination payment |
| Polygon (dest) | 8549 | `137` | `POLYGON_RPC_URL` (Polygon mainnet) | cross-chain destination payment |

The relayer is configured with `VYNX_CHAIN_ID="84532"` (`e2e.sh:585/619`); all of its EVM
RPC pools point at the local anvils.

### Per-destination degradation

Each destination fork is started with a startup timeout. If a destination RPC is
unreachable or rate-limited, that single chain **degrades to a Base sim**: its `*_ANVIL_URL`
is repointed at the Base anvil and the chain is dropped from `MULTIFORK_REAL_CHAINS`
(`e2e.sh:157-182`). The solver then pays that destination on Base instead of the real fork.
Base and Eth never degrade. When all three destinations come up real (the normal case), the
`multichain-destination` test exercises true cross-chain settlement: the solver pays each
chain's **real** USDC at its real address and the witness validates against that fork.

### 3.1 Gasless bootstrap (pinned replay · wall re-anchor · EOA-only agents)

Three load-bearing properties make the gasless model testable on the pinned Base fork:

- **Pinned-block replay → SDK-pinned addresses.** The SDK's `ADDRESSES[84532]` are PINNED
  constants (no env override): the agent's EIP-3009 signature binds `to = VynxSettlement
  0xac13…` and `verifyingContract = USDC 0x036C…`. So the fork must present the LIVE
  deployment at those exact addresses — achieved by forking at `deployBlock − 1` and
  replaying `DeployL2` as the live deployer (CREATE addresses = f(sender, nonce)).
- **Wall-time re-anchor.** The pinned block's timestamp is ~16h behind wall. `lockIntent`
  stores `escrow.deadline = block.timestamp + DEFAULT_DEADLINE(900)` (chain-relative) but the
  relayer's SLA sweep is wall-clock; left un-anchored, every escrow is born already-expired.
  `e2e.sh` re-anchors the Base anvil to wall-time (`evm_setNextBlockTimestamp` + mine) right
  after the fork comes up. The harness keeps it anchored thereafter — `revertSnapshot` nudges
  the reverted chain forward onto wall (forward-only, best-effort & time-bounded, §6) so the
  shared anvil never accumulates behind-drift across suites.
- **Chain-relative fixture deadline.** Because the Base fork can momentarily run *ahead* of
  wall (warp suites + `--block-time`), `fixtures/agent-core.ts buildIntentTerms` sets the
  agent's default `deadline` (= EIP-3009 `validBefore`) to `block.timestamp + 900` read from
  the chain head, NOT wall `now()+900` — so the authorization is valid at the SOLVER's lock
  block.timestamp regardless of drift. (Explicit overrides, e.g. expired-deadline's past
  value, are honoured verbatim.)
- **EOA-only agents (EIP-7702/1271 V1 limit).** Agent keys are FRESH `cast wallet new` EOAs,
  NOT anvil's deterministic accounts: the well-known anvil addresses carry EIP-7702
  delegation designators on real Base Sepolia, so Circle's `SignatureChecker` takes the
  ERC-1271 contract path and the gasless lock reverts "FiatTokenV2: invalid signature". V1 is
  EOA-only; `e2e.sh` asserts the agent keys are code-less.

---

## 4. The test solver (`solver/main.go` + `fixtures/solver-manager.ts`)

Per **INV-E2E-4**, the solver binary is never duplicated: the "three solvers" are one
compiled binary (`bin/solver`) spawned with different flags. `solver-manager.ts` spawns it
and resolves readiness when the solver logs `ws connected`.

Base flags: `--id`, `--bid-strategy {undercut|midpoint|aggressive}`, `--solver-pk`,
`--relayer-url`, `--base-rpc`, `--eth-rpc`, and (multi-fork) `--dest-rpc <id>=<url>,...`
built from `MULTIFORK_REAL_CHAINS`.

Misbehavior flags let a single binary drive negative-path tests:

| Flag | Helper | Behavior under test |
|---|---|---|
| `--no-fulfill` | `startNoFulfillSolver` | win → ACK → NEVER lock (arms then breaches the 10s commit SLA → `sla_expired` jail) |
| `--lock-only` | `startLockOnlySolver` | win → ack → real `lockIntent` → skip the destination payment (the live-escrow mode for the relayer-driven refund-clock suites, e.g. tvl-cap) |
| `--wrong-token-address` | `startWrongTokenSolver` | pays a different ERC-20 → witness rejects |
| `--pay-recipient` | `startWrongRecipientSolver` | pays the wrong recipient → witness rejects |
| `--pay-minimum-only` + `--underpay-by` | `startUnderpayingSolver` | probes the witness `>= minOut` boundary exactly |
| `--double-bid` | `startDoubleBidSolver` | sends a duplicate bid → first-bid-wins dedup |
| `--late-bid` | `startLateBidSolver` | bids after the 200 ms OFA window → dropped |

`startAllSolvers()` brings up the standard trio (a=undercut, b=midpoint, c=aggressive).

---

## 5. Services (Docker)

`docker-compose.yml` defines exactly two services:

| Service | Image | Port |
|---|---|---|
| postgres | `postgres:16-alpine` | `5432` |
| redis | `redis:7-alpine` | `6379` |

Both use fixed local-only credentials (`vynx`/`vynx`, db `vynx_e2e`) and have no named
volumes — the e2e database is ephemeral and recreated each run.

**DynamoDB is not part of the e2e stack.** The relayer's `-tags e2e` build relies on
PostgreSQL + Redis only. (DynamoDB is a production relayer dependency; it is not started or
referenced by `e2e.sh` or `docker-compose.yml`.)

### Database wiring asymmetry (documented honestly)

- **Redis is env-wired:** the watchdog (and harness) read `REDIS_URL` from the environment
  (`e2e.sh:663`).
- **PostgreSQL — split:** the RELAYER's DSN is **hardcoded** by `e2e.sh`
  (`VYNX_RELAYER_DB_DSN=postgres://vynx:vynx@127.0.0.1:5432/vynx_e2e?sslmode=disable`), so
  changing `POSTGRES_URL` does not repoint the relayer. But `POSTGRES_URL` **is** now read by
  the HARNESS: `fixtures/pg-utils.ts` connects with it to read `solver_health.jail_level` for
  the jail-time-sla-breach DB assertion. See `docs/setup.md`.

---

## 6. The W8 FinalityWatcher chain clock (LIVE)

This is the most important harness property to understand before adding any test that
time-warps Base anvil.

**What W8 is.** The relayer watchdog runs a leader-only worker (invariant-7
`FinalityWatcher`, "W8"). It is the **sole writer** of `chain:{chainId}:latest_safe_ts` in
Redis — a monotonic on-chain clock derived from real `block.timestamp`s. The deadline
sweeper reads that clock to decide which intents have passed their refund deadline. W8
keys the clock by the watchdog's configured **logical** chain ids (`WATCHED_CHAINS="8453,1"`
→ `chain:8453:latest_safe_ts` for Base, `chain:1:latest_safe_ts` for Eth), reading
timestamps from the Base/Eth anvil RPCs. Note the label nuance: the Base anvil reports
chain-id `84532`, but the watchdog watches it under the logical id `8453`; the Redis key
uses the logical id.

**Why the harness must reset it.** Twelve tests warp Base anvil time forward (+16 min) to
cross the on-chain deadline and exercise refunds/slashes. W8 reads that warped timestamp
into the clock and, because the advance is monotonic, never lowers it again. A test's
snapshot revert (`evm_revert`, for INV-E2E-3 isolation) rewinds the **anvil chain** but not
**Redis**. Left alone, `latest_safe_ts` would stay pinned at the warped value, and the
sweeper would treat every subsequent intent as already past its deadline — a refund flood
that reverts on-chain with `DeadlineNotExpired`.

**The fix lives in the harness, not the protocol.** `fixtures/anvil-utils.ts`
`revertSnapshot()` calls `resetChainClocks()` after every `evm_revert`. That helper `DEL`s
`chain:8453:latest_safe_ts` and `chain:1:latest_safe_ts` (the constant
`CHAIN_CLOCK_CHAIN_IDS = [8453, 1]`, `anvil-utils.ts:78`), so W8 re-derives the clock from
the reverted chain on its next tick. It is best-effort: if `REDIS_URL` is unset (an isolated
run with no live stack) it no-ops, and a Redis blip is logged but never undoes the chain
revert. This is the **only** place in the harness that knows the `latest_safe_ts` key
format; it mirrors `vynx-relayer/internal/watchdog/state/keys.go`.

**Rule for future tests.** `resetChainClocks` currently clears only the finality clock. Any
new component that projects chain-derived state into Redis must add its key(s) to
`CHAIN_CLOCK_CHAIN_IDS` / `resetChainClocks`, or snapshot reverts will leave stale state
behind. See `docs/fixtures.md`.

---

## 7. Test isolation

- **Snapshot/revert (INV-E2E-3).** Each suite takes an `evm_snapshot` and reverts it
  (`revertSnapshot`, which also resets the W8 clock) so no on-chain state leaks between
  suites.
- **Serial execution.** `vitest.config.ts` pins `pool: 'threads'`, `singleThread: true`,
  `fileParallelism: false` — the live shared stack cannot be driven concurrently.
- **Pinned suite order.** A custom `StableSuiteSequencer` (`vitest.config.ts`) pins file
  order at both ends. `multichain-destination` runs **first**, on a fresh undici connection
  pool — run mid-suite, after the `+16min` time-warp/timeout suites whose `ERR_SWAP_TIMEOUT`
  background pollers saturate the pool, its calls to the live destination forks starve and
  its first case blows the 60s window (it is 3/3 in ~4s in isolation). The three
  process-lifecycle suites (`relayer-restart`, `solver-disconnect-after-win`,
  `watchdog-restart-pending-slash`) run **last**, so a killed/restarted binary cannot
  cascade into earlier suites.
- **Timeouts.** `testTimeout = E2E_TIMEOUT_MS` (default 30000); `hookTimeout = 120000` for
  the heavy setup/teardown hooks.

---

## See also

- `docs/setup.md` — environment, RPC URLs, Docker, running the suite.
- `docs/tests.md` — the 39-case reference and what each asserts.
- `docs/fixtures.md` — the harness API.
- `CLAUDE.md` — invariants, agent/skill registries, contributor rules.
