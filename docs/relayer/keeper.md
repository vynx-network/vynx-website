# VynX — Keeper

Technical reference for `cmd/keeper`. Runs as an AWS Fargate Scheduled Task in Box 3 (vynx-treasury-prod, us-west-2). One invocation per week (`REBALANCE_EPOCH = 7d`, EventBridge cron `cron(0 0 ? * SUN *)`). Performs the cross-chain JOIN that turns last week's slashing events into a `batchCompensate` payload on Base L2.

> **Invariant 5.** The Keeper does not bridge collateral. It calls `VynxTreasury.batchCompensate` directly on Base L2. There is no Iris polling, no L1 burn, no message-bridge attestation step.

---

## 1. Overview

| Concern | Source |
|---|---|
| Schedule | EventBridge cron `cron(0 0 ? * SUN *)` (`infra/box3/eventbridge.tf`) |
| Execution | Fargate one-shot task, max runtime 4 h (`epochSafetyTimeout`) |
| Lock | DynamoDB `vynx-keeper-lock` (`KEEPER_EPOCH_LOCK` row) |
| State | DynamoDB `vynx-keeper-epochs` (one row per epoch) |
| Reads | L1 `VynxRegistry.SolverSlashed` + L2 `VynxSettlement.IntentRefunded` |
| Writes | L2 `VynxTreasury.batchCompensate`, then `distributeRealYield(USDC)` |
| Keys | `BridgeKey_L2` (KMS `alias/vynx-keeper-l2`) — Base L2 signing only |

The Keeper is a daemon-less binary. It boots, runs one epoch, exits. EventBridge's at-least-once delivery is safe because the DynamoDB lock causes the second invocation to exit 0 without paging.

---

## 2. Box 3 Isolation

Before Sprint 13 the Keeper ran in Box 1 alongside the Relayer and the Signer. That meant:

- A Box 1 IAM compromise included `kms:Sign` on `alias/vynx-keeper-l2` (then in Box 1).
- The Keeper held a direct PostgreSQL connection reading `public.debt_registry` for agent addresses, which made the Relayer database a trust dependency of treasury disbursement.
- `pg_try_advisory_lock` in PostgreSQL meant the lock and the state were in the same datastore as the protocol's hot-path database.

Sprint 13 collapsed all three problems by moving the Keeper into its own AWS account:

- `BridgeKey_L2` lives in vynx-treasury-prod (`infra/box3/kms.tf`, alias `alias/vynx-keeper-l2`).
- The Keeper has zero network path to Box 1 or Box 2. It reaches Base L2 and Ethereum L1 via public RPC endpoints (`assign_public_ip = true` on the Fargate task — `infra/box3/eventbridge.tf`).
- The PostgreSQL dependency was eliminated entirely. Agent addresses come exclusively from L2 `IntentRefunded` events.
- DynamoDB replaces both the advisory lock and the state table.

The IAM role `vynx-keeper-role` in Box 3 (`infra/box3/iam.tf`) has `kms:Sign` + `kms:GetPublicKey` on `bridge_l2` only, DynamoDB scoped to the two tables, and CloudWatch log access to `/vynx/keeper`. Nothing else.

---

## 3. DynamoDB Epoch Lock (`internal/keeper/dynamo_lock.go`)

```go
const (
    keeperLockID = "KEEPER_EPOCH_LOCK"
    lockTTLHours = 4
)
```

`TryAcquire(ctx)`:
```
PutItem(
  TableName:           "vynx-keeper-lock",
  Item: {
    lock_id:     "KEEPER_EPOCH_LOCK",
    instance_id: <Fargate task ARN>,
    acquired_at: <RFC3339>,
    expires_at:  <unix epoch seconds, now+4h>,
  },
  ConditionExpression: "attribute_not_exists(lock_id)",
)
```

On `ConditionalCheckFailedException` returns `(false, nil)` — a sibling task already holds the lock. The caller (`runKeeper` in `cmd/keeper/main.go`) propagates this as `ErrLockHeld` and `main()` translates that into exit 0 (the log line is `"previous epoch still running, yielding"`). EventBridge sees a successful task and does not page.

`Release(ctx)` deletes the row with `ConditionExpression: "instance_id = :id"`. A foreign-owned row (after TTL expiry + new acquisition) cannot be deleted by this task; the conditional failure is downgraded to a `Warn` log so a `defer lock.Release(...)` is safe on the happy path.

**TTL auto-release.** The DynamoDB table has TTL on `expires_at` (`infra/box3/dynamodb.tf`). A crashed Fargate task leaves the lock row in place; DynamoDB removes it within minutes of the 4 h expiry, so the next epoch invocation succeeds without manual intervention.

**Fencing token semantics.** The DynamoDB state store's `UpdateStatus` uses a `ConditionExpression` that enforces valid status transitions. A "zombie" task that lost the lock but is still running cannot overwrite the state written by the successor task — the conditional update fails. EventBridge at-least-once delivery is safe because the second invocation either finds the lock held (`ErrLockHeld` → exit 0) or finds the state already advanced (no work to do).

**Instance ID** is the Fargate task ARN, read from the ECS metadata endpoint (`ECS_CONTAINER_METADATA_URI_V4`). The fallback is `hostname-PID` for the reviewer-demo and local tests.

---

## 4. Cross-Chain Event JOIN (`internal/keeper/extractor.go`)

The capital-critical function. Pseudocode of the JOIN:

```
l1Events = registry.SolverSlashedBetween(epochStart, epochEnd)   // L1
l2Events = settlement.IntentRefundedBetween(epochStart, epochEnd) // L2

byIntentL1 = map[intentId]→(solver, amount, adapter)             // from l1Events
for refund in l2Events:
    if processedSet.Contains(refund.IntentID): continue          // already paid out
    slash = byIntentL1[refund.IntentID]
    if slash == nil:                                             // L2 refund w/o L1 slash
        log "excluded — no L1 slash"
        continue
    compensation = slash.Amount × AGENT_COMPENSATION_BPS / 10000
    agents[refund.Agent]  += compensation
    amounts[refund.Agent] += compensation

sort agents[] ascending (by address)                             // deterministic
payloadHash = keccak256(abi.encode(agents, amounts))
```

### Source of every field

| Field | Source | Notes |
|---|---|---|
| `agent` (compensation recipient) | L2 `IntentRefunded.agent` | **Never from a database.** Reading the agent from Postgres would re-introduce the trust dependency Sprint 13 eliminated. |
| `solver` (slashed party) | L1 `SolverSlashed.solver` | Used for accounting and metrics, not for payout. |
| `amount` (slashed amount) | L1 `SolverSlashed.amount` | Source of the compensation calculation. |
| `compensationBps` | `CompensationBpsReader` | Currently a stub (`internal/keeper/bps.go`) returning `AGENT_COMPENSATION_BPS`. |

### TODOs in `internal/keeper/bps.go`

```
// TODO(post-yellow-paper): replace constBpsReader with an on-chain getter once
//                          VynxRegistry exposes agentCompensationBps().
```

> `AGENT_COMPENSATION_BPS = 5000` (50%) is verified against Yellow Paper v1.1.0 — 50% to agent, 50% to VynxTreasury.

The interface is shaped to swap implementations transparently — production currently wires `NewConstBpsReader(types.AGENT_COMPENSATION_BPS)` (`cmd/keeper/main.go:160`). After the Yellow Paper is finalised, an on-chain reader will replace this without changing the Extractor.

### Deterministic payload hash

`sort.Slice(agents, ...)` sorts addresses ascending, then `computePayloadHash(agents, amounts)` ABI-encodes the two arrays and keccaks the result. Two independent Keeper runs over the same epoch window must produce the same `payloadHash` — that property is what makes the resume logic in §5 safe.

`computePayloadHash` is the same expression the `MintExecutor.VerifyPayloadHash` re-runs before broadcast (§6).

### Exclusion set

`ProcessedSet` (implemented by `DynamoStateStore`) returns the set of `intentId`s already paid out in prior epochs. Any L2 refund whose intent ID is in this set is excluded from the JOIN. Re-running the keeper for an already-processed epoch produces an empty payload — `MintExecutor.Execute` then short-circuits without broadcasting.

---

## 5. Epoch State Machine (`internal/keeper/epoch.go` + `internal/keeper/schema.go`)

```
DERIVATION_COMPLETE ──► L2_MINT_PENDING ──► YIELD_PENDING ──► COMPLETED
```

| Status constant (`schema.go`) | Meaning |
|---|---|
| `StatusDerivationComplete` | extractor finished, row inserted; payload not yet broadcast |
| `StatusL2MintPending` | `batchCompensate` broadcast; receipt not yet confirmed |
| `StatusYieldPending` | `distributeRealYield` broadcast; receipt not yet confirmed |
| `StatusCompleted` | both receipts confirmed `Status = 1` |

### Crash recovery (`EpochRunner.Run`)

On entry:

1. Scan `vynx-keeper-epochs` for any row with `epoch_timestamp < epochEnd` that is not COMPLETED. Resume each older batch first.
2. If a row for `epochEnd` already exists:
   - `COMPLETED` → return `nil` (this week's epoch is done).
   - any other status → call `resume(currentBatch)`.
3. Otherwise start fresh: extract, insert (`StatusDerivationComplete`), then advance.

### resume() per status

- **`StatusDerivationComplete`** — re-run the extractor with the same epoch window, recompute `payloadHash`. If it does not match the stored hash, return an error (a deterministic JOIN must produce the same hash). Otherwise broadcast `batchCompensate`.
- **`StatusL2MintPending`** — `l2_mint_tx_hash` must be present (otherwise error). Wait for the receipt; if confirmed, move on to `distributeRealYield`.
- **`StatusYieldPending`** — `l2_yield_tx_hash` must be present. Wait for the receipt; on confirmation set `StatusCompleted`.

The state machine is forward-only. There is no rollback path; a fatal error during execution leaves the row in its current state and the next epoch invocation resumes from there.

---

## 6. Mint Executor (`internal/keeper/executor.go`)

`MintExecutor` is the narrow surface for the two L2 broadcasts. Constructed against the Treasury Transactor binding (`bindings/treasury`) and a `bind.TransactOpts` derived from the BridgeKey_L2 KMS signer.

### Execute (batchCompensate)

```go
treasury.BatchCompensate(opts, usdc, agents, amounts)
```

Pre-flight:
- `VerifyPayloadHash(r)` recomputes `keccak256(abi.encode(agents, amounts))` and compares against `r.PayloadHash` from the extractor result. A mismatch is an integrity error (someone mutated `r.Agents` or `r.Amounts` between extractor and executor) and the broadcast does not proceed.
- The `token` argument is hard-wired to `USDC_ADDRESS_BASE` (`cmd/keeper/main.go:144`). USDC-only collateral (Invariant 6) means USDC-only compensation.

On broadcast: log the tx hash; the EpochRunner persists it via `state.UpdateStatus(epochEnd, StatusL2MintPending, &mintHash, nil)` and waits for the receipt.

### ExecuteDistributeYield

```go
treasury.DistributeRealYield(opts, USDC_ADDRESS_BASE)
```

After `batchCompensate` confirms, the Keeper drains the protocol take-rate accumulator on `VynxTreasury` into the staking rewards pool. Single-argument call (token).

---

## 7. Startup Sequence (`cmd/keeper/main.go`)

`main()`:
1. Default cold-path logger (slog + JSON).
2. `context.WithTimeout(context.Background(), 4h)` — `epochSafetyTimeout`. Hard ceiling because Fargate's max runtime for a scheduled task is 4 h.
3. `build(ctx, log)` constructs every collaborator (see below).
4. `runKeeper(ctx, d)`:
   - `d.lock.TryAcquire(ctx)` — if `ErrLockHeld`, log `"previous epoch still running, yielding"` and exit 0.
   - `defer lock.Release(...)`.
   - `epochEnd = now.UTC().Truncate(24h)`; `epochStart = epochEnd − REBALANCE_EPOCH`.
   - `runner.Run(ctx, epochStart, epochEnd)`.
5. Final log `"keeper shutdown complete"`.

`build(ctx, log)`:
- `loadKMSClient(ctx)` builds the BridgeKey_L2 transact-opts. Address verification: derive the Ethereum address from the KMS key, compare against `KEEPER_ADDRESS`, fatal on mismatch (probe-task pattern in [`docs/secrets_rotation.md`](secrets_rotation.md) §4).
- `awsconfig.LoadDefaultConfig(ctx)` — picks up region from the Fargate environment (`AWS_REGION = us-west-2`).
- DynamoDB client; `DYNAMODB_ENDPOINT` override is honoured for the reviewer-demo (DynamoDB Local) but is unset in production.
- `KEEPER_LOCK_TABLE` defaults to `vynx-keeper-lock`, `KEEPER_EPOCHS_TABLE` defaults to `vynx-keeper-epochs`.
- `instanceID = GetFargateTaskARN(ctx)` — falls back to `hostname-PID` outside ECS.
- Two ethclient dials: `ETH_RPC_URL` (first comma-split entry) and `BASE_RPC_URL`.
- Bindings: `registry.NewRegistryFilterer`, `settlement.NewSettlementFilterer`, `treasury.NewTreasuryTransactor`.
- `BindingEventSource` wires the L1/L2 event readers; `Extractor` consumes them.
- `MintExecutor` wraps the Treasury transactor with `usdc = USDC_ADDRESS_BASE`.
- `pollingConfirmer` waits 2 s between `TransactionReceipt` polls. The Keeper does not need Redis (no nonce rooms, no RBF — one-shot tasks have nothing to share).
- `metrics.NewClient("keeper")` for DogStatsD; `EpochRunner` ties it all together.

### Required env vars

`ETH_RPC_URL`, `BASE_RPC_URL`, `VYNX_REGISTRY_ADDRESS`, `VYNX_SETTLEMENT_ADDRESS`, `VYNX_TREASURY_ADDRESS`, `USDC_ADDRESS_BASE`, `KMS_KEY_ID_BRIDGE_L2`, `KEEPER_ADDRESS`. Optional: `KEEPER_LOCK_TABLE`, `KEEPER_EPOCHS_TABLE`, `DYNAMODB_ENDPOINT`, `ECS_CONTAINER_METADATA_URI_V4`.

There is **no** `VYNX_KEEPER_DB_DSN`. Any code reaching for PostgreSQL inside `internal/keeper/` is a P0 regression (`check-invariants` greps for `pgx` imports under that path).

---

## See also

- [`docs/architecture.md`](architecture.md) — Invariant 5 (no CCTP), trust model
- [`docs/infrastructure.md`](infrastructure.md) — Box 3 isolation, DynamoDB tables, EventBridge cron, BridgeKey_L2 KMS
- [`docs/onchain_contracts.md`](onchain_contracts.md) — `batchCompensate`, `distributeRealYield`, `SolverSlashed`, `IntentRefunded`
- [`docs/secrets_rotation.md`](secrets_rotation.md) §4 — BridgeKey_L2 rotation
