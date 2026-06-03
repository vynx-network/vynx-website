# Keeper — `cmd/keeper`

> Box 3 (us-west-2, `vynx-treasury-prod`), an isolated AWS account with **zero
> network path** to Box 1 or Box 2. A Fargate **Scheduled Task** that runs once a
> week (`cron(0 0 ? * SUN *)`), reconciles the prior epoch's slash/refund events,
> and broadcasts compensation + yield on Base L2 using **BridgeKey_L2**.

The Keeper is a one-shot cron job, not a long-running service. It acquires a
DynamoDB epoch lock, runs a resumable four-state pipeline, and exits.

---

## 1. Invariant 5 — no bridge

The Keeper does **not** bridge slashed collateral across chains. From
`internal/keeper/schema.go` and `cmd/keeper/main.go`:

> *"the Keeper does not bridge slashed collateral across chains. It calls
> `VynxTreasury.batchCompensate` (and optionally `distributeRealYield`) directly
> on Base L2. There is no message-bridge poll, no burn on L1, no external
> attestation step."*

There is no CCTP, no Iris API, no L1 transaction. The only on-chain writes are the
two Base-L2 calls below. (The literal token "CCTP" appears nowhere in the code.)

---

## 2. Trigger, locking, and the epoch window

- **Schedule:** EventBridge `cron(0 0 ? * SUN *)` — weekly.
- **Safety timeout:** the whole process runs under a **4-hour** context
  (`epochSafetyTimeout`).
- **DynamoDB epoch lock** (`vynx-keeper-lock`, `KEEPER_EPOCH_LOCK` row): `runKeeper`
  calls `lock.TryAcquire`. If another epoch is still running it returns
  `ErrLockHeld` and `main()` **exits 0 without paging** ("previous epoch still
  running, yielding"). This prevents double execution if EventBridge double-fires.
  `instanceID` is the Fargate task ARN, used as the fencing token.
- **Epoch window:** `epochEnd = now (UTC, truncated to 24h)`;
  `epochStart = epochEnd − REBALANCE_EPOCH` (`REBALANCE_EPOCH = 7d`).

---

## 3. Extraction — the cross-chain JOIN (blind on-chain reader)

`Extractor` (over `BindingEventSource`) JOINs, for the epoch window:

- **L1** `VynxRegistry.SolverSlashed` events (read via `registryFilterer` on
  `ETH_RPC_URL`), and
- **L2** `VynxSettlement.IntentRefunded` events (read via `settlementFilterer` on
  `BASE_RPC_URL`).

Agent addresses are derived **exclusively from on-chain `IntentRefunded` events** —
the Keeper is a *blind on-chain reader*. It reads **no PostgreSQL** and trusts no
Relayer-supplied data (Box 3 has no path to Box 1/2). `ConstBpsReader` applies
`AGENT_COMPENSATION_BPS = 5000` (50% of `slashTotal` = 5% of the input) to derive
each agent's share. The result carries `Agents`, `TotalAmount`, and a `PayloadHash`.

---

## 4. The four-state pipeline (`internal/keeper/epoch.go`)

```
DERIVATION_COMPLETE ──▶ L2_MINT_PENDING ──▶ YIELD_PENDING ──▶ COMPLETED
        │                     │                   │
        │             batchCompensate     distributeRealYield
        │              (Base L2)               (Base L2)
        └── (no agents this epoch) ──────────────────────────▶ COMPLETED
```

- **Idempotent & resumable.** `Run` first loads incomplete batches: a batch for the
  current epoch is **resumed** from its stored status; older incomplete batches are
  finished first. A `DERIVATION_COMPLETE` resume **re-extracts** and asserts the
  recomputed `PayloadHash` still matches (catches silent DB corruption).
- **Receipts gate transitions.** Each broadcast is followed by `WaitMined`; a
  receipt with `Status != 1` returns `ErrTxReverted` — the Keeper **does not retry**;
  a revert requires operator review.
- **Empty epoch:** if extraction yields no agents, the batch is written straight to
  `COMPLETED`.

---

## 5. `KEEPER_AGENT_COMPENSATION` — gated, default false (BLINDAJE A.14)

This flag (`cmd/keeper/main.go`) controls whether the **off-chain** agent
compensation runs. **Default `false`.**

| Flag | Path | Why |
|---|---|---|
| **`false` (default)** | `runFromMint` **skips `batchCompensate` and the entire `L2_MINT_PENDING` state**, advancing `DERIVATION_COMPLETE → YIELD_PENDING` directly. | The agent is already paid **5% on-chain** by `VynxRegistry.executeSlash`. Running `batchCompensate` too would **double-pay** the agent (Critical Finding #4). |
| `true` | Legacy `compensate → yield` path (`batchCompensate`, then `distributeRealYield`). | Retained for reversibility only. |

`distributeRealYield` runs in **both** modes — only the compensation leg is gated.
The `AGENT_COMPENSATION_BPS = 5000` constant is kept (compile-time); the env var
`AGENT_COMPENSATION_RATE_BPS` was removed (zero readers).

> **`L2_MINT_PENDING` deploy edge case:** the only situation that flips the flag on
> is an explicit operator decision to restore the legacy off-chain path. In the
> default deployment the `L2_MINT_PENDING` state is never entered.

---

## 6. State store (DynamoDB, Sprint 13 — no PostgreSQL)

The Keeper holds no PostgreSQL connection. State lives in two DynamoDB tables:

| Table | Role |
|---|---|
| `vynx-keeper-lock` | Epoch lock. Conditional Put `attribute_not_exists(lock_id)` with a 4-hour TTL acts as a **fencing token** — a zombie task that lost the lock cannot overwrite the successor's state. |
| `vynx-keeper-epochs` | `ReconciliationBatch` rows (status, `l2_mint_tx_hash`, `l2_yield_tx_hash`, `payload_hash`). Point-in-time recovery enabled. |

`DYNAMODB_ENDPOINT` points the client at DynamoDB Local for `reviewer-demo` /
`make e2e-local`; unset in production (regional endpoint).

---

## 7. Executor and confirmation

- `MintExecutor` wraps `VynxTreasury` (`treasuryTxor` on `l2Client`):
  `VerifyPayloadHash`, `ExecuteCompensate` → `batchCompensate(token, agents[],
  amounts[])`, `ExecuteDistributeYield` → `distributeRealYield(token)`.
- `pollingConfirmer.WaitMined` polls `TransactionReceipt` every 2s — no Redis,
  no nonce coordination, no RBF (the Keeper is a one-shot task with no shared state).

---

## 8. Configuration

| Env | Required | Meaning |
|---|---|---|
| `KMS_KEY_ID_BRIDGE_L2` | yes | BridgeKey_L2 (signs the two L2 txs). |
| `ETH_RPC_URL`, `BASE_RPC_URL` | yes | L1 (event read) and L2 (event read + writes). |
| `VYNX_REGISTRY_ADDRESS`, `VYNX_SETTLEMENT_ADDRESS`, `VYNX_TREASURY_ADDRESS`, `USDC_ADDRESS_BASE` | yes | Contracts + token. |
| `KEEPER_LOCK_TABLE`, `KEEPER_EPOCHS_TABLE` | no | Default `vynx-keeper-lock` / `vynx-keeper-epochs`. |
| `KEEPER_AGENT_COMPENSATION` | no | Default `false` (off-chain compensation off; see §5). |
| `DYNAMODB_ENDPOINT` | no | DynamoDB Local override for demo/e2e. |

**Open item:** `TODO(post-yellow-paper)` — swap `ConstBpsReader` for an on-chain
getter once `VynxRegistry` exposes `agentCompensationBps()`.

See also: [`onchain_contracts.md`](onchain_contracts.md), [`watchdog.md`](watchdog.md),
[`architecture.md`](architecture.md), [`infrastructure.md`](infrastructure.md).
