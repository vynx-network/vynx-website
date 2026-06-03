# Architecture

> **Tier 1 reference.** This document supersedes other architecture material in the
> repo. Where a doc says X and the code does Y, the **code wins** and this document
> tracks the code.

VynX is a **200ms sealed-bid Order-Flow Auction (OFA)** settlement layer for AI-agent
cross-chain transfer intents on Base L2. An agent locks USDC on Base, competitive
solvers bid to fulfil the transfer on a destination chain, the winner pays the agent
off-chain, a witness verifies that payment, and the solver redeems an EIP-712 voucher
for the agent's locked funds (minus a take-rate). Deadline misses are refunded and
slashed by an independent watchdog.

---

## 1. Four binaries, three boxes

| Binary | Box | Region / Account | Role |
|---|---|---|---|
| [`cmd/relayer`](relayer.md) | Box 1 | us-east-1 `vynx-core-prod` | Intake, 200ms auction, witness, settlement. |
| [`cmd/signer`](signer.md) | Box 1 | (same Fargate task as relayer) | UDS EIP-712 voucher signer — **RelayerMasterKey**. |
| [`cmd/watchdog`](watchdog.md) | Box 2 | us-east-2 `vynx-sentinel-prod` | Leader-elected punisher + circuit breaker — **SlashingKey** (L1) + **RelayerAdminKey** (L2). |
| [`cmd/keeper`](keeper.md) | Box 3 | us-west-2 `vynx-treasury-prod` | Weekly epoch reconciliation — **BridgeKey_L2**. |

Each box is a **separate AWS account** under AWS Organizations. A full IAM compromise
of one box grants zero API access to another's KMS keys. See [`infrastructure.md`](infrastructure.md).

On-chain ([`onchain_contracts.md`](onchain_contracts.md)): collateral and slashing live
on **Ethereum L1** (`VynxRegistry`, `DirectVaultAdapter`); intent settlement, treasury,
governance, and staking live on **Base L2** (`VynxSettlement`, `VynxTreasury`,
`VynxAdmin`, `StakingRewards`).

---

## 2. The intent lifecycle

### Happy path

1. **Lock** — the agent calls `VynxSettlement.lockIntent` on Base L2, locking input
   USDC (`IntentLocked`).
2. **Intake** — the agent POSTs the intent to the Relayer, which verifies the EIP-712
   agent signature (F1), checks the deadline (F2), runs the gatekeeper (USDC-only,
   MIN/MAX, destination whitelist), and reserves TVL.
3. **Auction** — a **200ms** sealed-bid OFA runs entirely from RAM. Solvers bid the
   output amount they will deliver; the highest `OutputAmount` wins (HealthFactor
   tie-break). First-bid-per-solver wins (F3).
4. **Fulfilment** — the winning solver pays the agent on the **destination chain**
   (the `AuctionWonFrame` carries agent, output token, min output).
5. **Witness** — the Relayer's Cold Path validates that destination-chain payment
   against `MinOutputAmount` and the agent recipient, after chain-specific finality.
6. **Voucher** — the Relayer requests an EIP-712 voucher `(intentId, solver, amount)`
   from the Signer over UDS, and the solver redeems it via `claimFunds` on Base L2,
   receiving the agent's locked USDC minus the take-rate (to `VynxTreasury`).

### Failure path (deadline miss)

7. **Refund** — if the solver misses the deadline, the Watchdog's deadline sweeper
   (driven by the **chain clock**, §4) transitions the intent and W4 calls
   `VynxSettlement.refundIntent` on Base L2 — the agent is made whole.
8. **Slash** — when conditions are met, W5 calls `VynxRegistry.executeSlash` on
   Ethereum L1 **via Flashbots** (`SolverSlashed`): the slashed collateral is split
   **5% to the agent, 5% to the treasury, on-chain** (BLINDAJE A.1).

### Weekly reconciliation

9. The **Keeper** JOINs the prior week's L1 `SolverSlashed` and L2 `IntentRefunded`
   events and broadcasts `distributeRealYield` on Base L2 (and, only if the gated
   `KEEPER_AGENT_COMPENSATION` flag is on, `batchCompensate`). No bridge (Invariant 5).

---

## 3. Hot Path vs Cold Path (`internal/relayer`)

The Relayer is split by a typed `EventBus`:

- **Hot Path** — the 200ms auction, lock-sharded mempool, gatekeeper, SLA tracker.
  **Invariant 8**: zero disk/network/RPC/KMS I/O. Everything runs from RAM; sends to
  the Cold Path are non-blocking `SendDrop`/`SendWait`.
- **Cold Path** — RPC event watching, witness verification, single-goroutine
  PostgreSQL writer, reputation/jail. PostgreSQL is the relayer/signer audit store; it
  is **never** read by the Watchdog (Invariant 4).

---

## 4. The chain clock (Invariant 7) — now live

Deadlines are **never** evaluated against wall-clock. The Watchdog's deadline sweeper
compares intent deadlines against `chain:{chainId}:latest_safe_ts` in Redis — an
on-chain `block.timestamp` from the chain's finality-deep block.

That key is written by **W8, the FinalityWatcher** (`watcher/finality.go`), a
leader-only goroutine that advances each watched chain's clock every 2s from
`head − confirmationsFor(chain)` (Base 2, Eth 12, Arb 1, Opt 2, Polygon 256), via a
monotonic Lua script. W8 is **newly wired and now live**: before it, the clock was
never written in production and the sweeper skipped every chain, so deadline-driven
refunds never fired. See [`watchdog.md`](watchdog.md) §4.

---

## 5. Trust and key model

- **Relayer has zero `kms:Sign`** (Invariant 3). All voucher signing happens in the
  Signer sidecar over UDS; KMS credentials are injected only into the Signer container.
- **Four KMS keys, isolated by box:** RelayerMasterKey (Box 1 signer), SlashingKey +
  RelayerAdminKey (Box 2 watchdog), BridgeKey_L2 (Box 3 keeper).
- **Watchdog reads only Redis** for slash decisions (Invariant 4) and writes slashes
  through Flashbots (private mempool).
- **USDC-only** throughout (Invariant 6) — integer math, no oracle.

---

## 6. The twelve invariants

| # | Invariant |
|---|---|
| 1 | `executeSlash` takes ONE `SlashPayload` arg; signature embedded. |
| 2 | `VOUCHER_TYPEHASH` signs only `(intentId, solver, amount)`. |
| 3 | Relayer task role has zero `kms:Sign`. |
| 4 | Watchdog builds `SlashPayload` from Redis only — never PostgreSQL. |
| 5 | No bridge/CCTP — Keeper calls `batchCompensate` directly on Base L2. |
| 6 | USDC-only collateral — no oracle. |
| 7 | Deadlines use `chain:{id}:latest_safe_ts` — never wall-clock (live via W8). |
| 8 | Hot Path (200ms) performs zero disk/network/RPC I/O. |
| 9 | `os.Chmod(socket, 0660)` is the immediate next call after `net.Listen`. |
| 10 | No `welthee` — native AWS SDK v2 KMS only. |
| 11 | INV-WS-1 — `RunPushWorker` is the sole writer of push frames. |
| 12 | INV-WS-2 — `IntentAccepted` / `AuctionConcludedPush` are SendDrop-only. |

Component detail: [`relayer.md`](relayer.md), [`signer.md`](signer.md),
[`watchdog.md`](watchdog.md), [`keeper.md`](keeper.md), [`onchain_contracts.md`](onchain_contracts.md),
[`infrastructure.md`](infrastructure.md).
