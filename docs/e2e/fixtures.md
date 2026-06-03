# Harness API — `fixtures/`

The harness is a set of small, composable TypeScript helpers. There is **no single
`NewStandalone`-style factory**: a test composes the pieces it needs — take a snapshot,
bring up its solver topology, drive a swap, assert, then revert. Each suite is fully
isolated (INV-E2E-3) via `evm_snapshot`/`evm_revert`.

All helpers are plain functions; tests import them directly. Everything talks to the live
stack — nothing is mocked (INV-E2E-1, INV-E2E-2).

---

## `anvil-utils.ts` — chain control + the W8 clock

Thin JSON-RPC helpers (over `fetch`, no viem except `dealErc20`) plus the finality-clock
reset.

| Export | Purpose |
|---|---|
| `takeSnapshot(rpcUrl)` | `evm_snapshot` → snapshot id |
| `revertSnapshot(rpcUrl, id)` | `evm_revert` (30 s timeout guard) **then** `resetChainClocks()` |
| `setNextBlockTimestamp(rpcUrl, ts)` / `mineBlock(rpcUrl)` | warp time + mine (the +16 min deadline crossing) |
| `mineBlocks(rpcUrl, count, intervalSec=0)` | advance block **number** without advancing time (confirmation depth) |
| `setBalance(rpcUrl, addr, wei)` | `anvil_setBalance` (top up gas) |
| `getBlockNumber(rpcUrl)` | head block, to anchor `eth_getLogs` to the post-fork range |
| `queryEventLogs(rpcUrl, address, topics, fromBlock)` | `eth_getLogs` wrapper (e.g. poll `SolverSlashed`) |
| `readErc20Balance` / `readUsdcBalance` | ERC-20 `balanceOf` via `eth_call` |
| `dealErc20(rpcUrl, token, holder, amount, slot=9n)` | storage-slot deal of real USDC (Circle FiatTokenV2_2, no public mint); reads back and asserts |
| `resetUsdcAllowance(rpcUrl, holder, spender)` | impersonate + set allowance to 0 (drives `lock-intent-revert`) |
| `waitForUsdcBelow` / `waitForApproval` | poll until a balance drops / an `Approval` log appears |
| `now()` / `wait(ms)` | time helpers |

### `revertSnapshot` → `resetChainClocks` (the load-bearing detail)

```
revertSnapshot(rpcUrl, id)
  └─ evm_revert(id)          // rewinds the anvil CHAIN
  └─ resetChainClocks()      // DELs the W8 Redis keys
```

`resetChainClocks()` deletes `chain:8453:latest_safe_ts` and `chain:1:latest_safe_ts` (the
constant `CHAIN_CLOCK_CHAIN_IDS = [8453, 1]`).

**Why this exists.** The relayer watchdog's FinalityWatcher (W8) is the sole writer of the
on-chain finality clock in Redis, derived from real `block.timestamp`s and **monotonic**.
Time-warping tests push that clock far into the future. `evm_revert` rewinds the chain but
**not** Redis, so without the reset the clock would stay pinned at the warped timestamp and
the deadline sweeper would flood-refund every later intent (reverting on-chain with
`DeadlineNotExpired`). Deleting the keys lets W8 re-derive the clock from the reverted chain
on its next tick.

It is **best-effort**: if `REDIS_URL` is unset (an isolated, no-stack run) it no-ops; a
Redis error is logged but never undoes the chain revert. This is the **only** place in the
harness that knows the `latest_safe_ts` key format (mirrors
`vynx-relayer/internal/watchdog/state/keys.go`).

> **Rule for new tests/components.** `resetChainClocks` clears only the finality clock. If
> you add a component that projects chain-derived state into Redis, add its key(s) to
> `CHAIN_CLOCK_CHAIN_IDS` / `resetChainClocks`, or snapshot reverts will leave stale state
> behind. (This is the one remaining generalisation debt in the harness — it is specific to
> the finality clock today.)

---

## `solver-manager.ts` — per-test solver topology

One compiled `bin/solver`, many flag configs (INV-E2E-4). Readiness resolves when the
solver logs `ws connected`.

| Export | Spawns |
|---|---|
| `startAllSolvers()` | the standard trio: a=undercut, b=midpoint, c=aggressive |
| `startSolver(id, strategy)` | a single well-behaved solver |
| `startNoFulfillSolver(id, strategy)` | `--no-fulfill` (never pays) |
| `startWrongTokenSolver(id, strategy, addr)` | `--wrong-token-address` |
| `startWrongRecipientSolver(id, strategy, addr)` | `--pay-recipient` |
| `startUnderpayingSolver(id, strategy, underpayBy, payMinimumOnly=true)` | `--underpay-by` + `--pay-minimum-only` |
| `startDoubleBidSolver(id, strategy)` | `--double-bid` |
| `startLateBidSolver(id, strategy)` | `--late-bid` (500 ms) |
| `stopSolver(proc)` | SIGTERM → SIGKILL after 3 s |

`Strategy = 'undercut' | 'midpoint' | 'aggressive'`. The `id` selects the solver wallet
(`pickPk`): `solver-a/b/c`, `solver-refund`, `solver-race`, `solver-slash`, `solver-shf`,
`solver-jail`, and the witness-boundary wallets.

---

## `admin-utils.ts` — on-chain protocol control (Tests 17–18 and friends)

| Export | Purpose |
|---|---|
| `pauseProtocol(watchdogPk, adminAddress, rpcUrl)` | `VynxAdmin.pauseAll()` (watchdog-signed) |
| `unpauseProtocol(multisigPk, adminAddress, rpcUrl)` | `VynxAdmin.unpauseAll()` (multisig-signed) |
| `readIntentEscrow(settlementAddress, intentId, rpcUrl)` | reads the `intents(bytes32)` tuple → `IntentEscrow` |
| `signVoucher(relayerKey, {intentId, solver, amount}, settlementAddress)` | EIP-712 voucher signature; matches the relayer (`VOUCHER_TYPEHASH` over 3 fields; domain `name="VynxSettlement"`, `version="1"`, `chainId=84532`) |
| `callClaimFunds(callerPk, settlementAddress, voucher, rpcUrl)` | submits `claimFunds(voucher)`; any funded key works (signature, not msg.sender, is validated) |
| `callRefundIntent(callerPk, settlementAddress, intentId, rpcUrl)` | **simulates** `refundIntent` and returns the decoded custom-error name (negative-path) |

Constants `INTENT_STATE_UNKNOWN/LOCKED/REDEEMED/REFUNDED` (0/1/2/3) mirror the on-chain
`IntentState` enum. Note: settled escrows stay **LOCKED** on-chain in e2e (no keeper runs),
which is why `readIntentEscrow` + `signVoucher` + `callClaimFunds` can drive the take-rate
and voucher tests.

---

## Agent entry points

Each agent surface is a thin wrapper over `@vynx/sdk` with `localQuoter` (1:1) by default.
All three pin to `baseSepolia` (chain-id 84532) and the local Base anvil.

| File | Export | Surface |
|---|---|---|
| `agent-core.ts` | `executeSwap(params)` | `VynxCore.executeSwap` — used by the four protocol tests; errors propagate (no try/catch) so tests assert on `errorCode` |
| `agent-agentkit.ts` | `executeSwapViaAgentKit(params)` | `createVynxActionProvider().executeSwap` → parsed JSON. Imports `reflect-metadata` first (AgentKit decorators). No CDP env — local anvil only |
| `agent-eliza.ts` | `executeSwapViaEliza(params)` | `createVynxPlugin()`; invokes the first registered action's `handler` → `{ success, destTxHash, ... }` |

`SwapParams = { targetToken, amountUSD, targetChainId: 1|10|137|8453|42161, quoter? }`.
`@coinbase/agentkit` and `@elizaos/core` are peer dependencies of `@vynx/sdk` required by
the two adapter tests.

Quoters: `local-quoter.ts` (`localQuoter`, 1:1) and `inflated-quoter.ts` (`inflatedQuoter`,
2× — forces all bids below minimum for `all-bids-below-minimum`).

---

## Other helpers

| File | Exports | Purpose |
|---|---|---|
| `http-intent.ts` | `submitRawIntent(params)`, `randomIntentId()` | POST `/v1/intent` raw, bypassing SDK validation — drives the intake-guard tests |
| `process-lifecycle.ts` | `killRelayer`/`startRelayer`, `killWatchdog`/`startWatchdog`, `ensureRelayerAlive`/`ensureWatchdogAlive`, `killProcess`, `waitForLogLine` | kill/restart binaries via PID/manifest; used by the lifecycle suites |
| `redis-utils.ts` | `zsetMembers(redisUrl, key)`, `waitForZsetNonEmpty(...)` | inspect the watchdog slash queue (`slash:pending`) |
| `setup.ts` | (bootstrap, no exports) | one-shot funding: solver/agent wallets, solver collateral, real-USDC deals on the destination forks; run by `e2e.sh` Phase 4 |

---

## Typical suite shape

```ts
const snap = await takeSnapshot(BASE_ANVIL_URL);
const solvers = await startAllSolvers();
try {
  const receipt = await executeSwap({ targetToken, amountUSD, targetChainId });
  expect(receipt.status).toBe('complete');
} finally {
  await Promise.all(solvers.map(stopSolver));
  await revertSnapshot(BASE_ANVIL_URL, snap); // also resets the W8 clock
}
```

See also: `docs/architecture.md` (the stack), `docs/tests.md` (what each suite asserts).
