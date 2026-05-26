# VynX — Architecture

> Tier 1 reference. This document supersedes all other architecture material in this repo. Where a doc says X and the code does Y, the code wins and this document tracks the code.

---

## 1. Protocol Overview

VynX is a 200 ms sealed-bid Order Flow Auction (OFA) settlement layer for cross-chain transfer intents issued by AI agents. The protocol matches an agent's intent to the solver that bids the highest output, settles payment off-chain, and issues an EIP-712 voucher that the winning solver redeems on-chain.

**Why Base L2.** Settlement happens on Base because Base offers L1-grade security via fault proofs, predictable sub-second blocks, and Coinbase-issued USDC as the canonical collateral and settlement token. Agents and solvers can both reach Base cheaply from any major L2 or L1.

**Why USDC-only.** A single collateral token (Invariant 6) eliminates the price-oracle attack surface that any multi-collateral design carries. The Gatekeeper compares integers; there is no conversion factor anywhere in the protocol. The Yellow Paper rules out any other collateral until USDC liquidity is replaced by a depegged stablecoin or the protocol is forked.

**Single-round philosophy.** Every intent runs through one 200 ms auction. There are no batch auctions, no second rounds, no retries. If no solver bids inside the window the intent is refunded. The simplicity buys the property that any state observable at `t + 200 ms` is final for that intent — no race between auctions, no need for batch settlement.

---

## 2. Core Design Laws

Three laws are applied to every implementation decision. They are listed in this exact order because the order matters when they conflict.

1. **Pareto (80/20).** Eighty per cent of protocol-critical behaviour is concentrated in twenty per cent of the surface area: the 200 ms hot path, the EIP-712 voucher hash, the slash payload construction, and the Keeper's cross-chain JOIN. Everywhere else, defer to the simplest implementation that works.
2. **Occam's Razor.** The smallest implementation that satisfies the spec wins. No CCTP. No oracle. No second auction round. No multi-collateral abstractions waiting for a future need. If a feature is not on the v1.0.0 critical path it is not in v1.0.0.
3. **Minimalism with consistency.** When several call sites need the same primitive they share the same primitive. The EventBus `SendDrop` / `SendWait` generics in `internal/types/eventbus_send.go` exist because every hot-path channel send must be either drop-safe or 5 ms-bounded; rather than open-coding the pattern at each site, a single primitive enforces the contract.

The concrete numbers these laws produced are in `internal/types/constants.go`:

```
OFA_WINDOW          = 200 ms          // auction window
SLA_COMMIT_TIMEOUT  = 10 s            // winner must lock intent within
DEFAULT_DEADLINE    = 15 min          // intent expiry from lock
SLA_GROUP_WINDOW    = 30 s            // reputation grouping rule
SHF_THRESHOLD       = 120             // 1.20× — solver health floor
MAX_SOLVER_EXPOSURE = 80              // % of collateral that can be in-flight
TAKE_RATE_BPS       = 10              // 10 bps protocol fee
MAX_TAKE_RATE_BPS   = 20
SLASH_RATE_PCT      = 10              // 10 % of collateral on slash
AMNESTY_EPOCH       = 90 days         // reputation reset cadence
REBALANCE_EPOCH     = 7 days          // keeper invocation cadence
MIN_INTENT_USDC     = 50_000_000      // $50 USDC (6 decimals)
AGENT_COMPENSATION_BPS = 5000         // 50 % of slashed amount to agent
```

Jail durations escalate: 60 s, 600 s, 3600 s, 86400 s, permanent.
Finality confirmations: Base 2, Ethereum 12, Arbitrum 1, Optimism 2, Polygon 256.

---

## 3. Binary Architecture

The protocol is implemented as four binaries on three AWS accounts. The split is driven by blast-radius isolation, not modularity for its own sake.

| Binary | Account | Region | Role |
|---|---|---|---|
| `cmd/relayer` | vynx-core-prod | us-east-1 | Hot Path auction + Cold Path settlement |
| `cmd/signer` | vynx-core-prod | us-east-1 | UDS sidecar — EIP-712 voucher signing |
| `cmd/watchdog` | vynx-sentinel-prod | us-east-2 | Deadline sweeper + slash executor + emergency pause |
| `cmd/keeper` | vynx-treasury-prod | us-west-2 | Weekly cross-chain JOIN + `batchCompensate` on Base L2 |

**Why four binaries.**

- *Relayer* and *signer* are split so that the Fargate task role for the relayer can have zero `kms:Sign` permissions (Invariant 3). A compromised relayer cannot mint vouchers because the KMS credentials live exclusively inside the signer container.
- *Watchdog* is split into its own AWS account because the same operator who can deploy the relayer must not be able to suppress slashing. The watchdog enforces the protocol against the relayer; their IAM roles share no surface.
- *Keeper* is split into its own AWS account because it is the only binary that can move USDC out of the treasury contract. A compromised core-prod account must give zero ability to redirect treasury disbursements.

The four binaries communicate only through (a) on-chain events, (b) PostgreSQL (relayer ↔ signer only), (c) the UDS socket at `/run/vynx/voucher-signer.sock` (relayer → signer), and (d) the relayer's `:8443` mTLS endpoint (watchdog → relayer, fraud verification only). The Keeper is a blind on-chain reader and writer; it shares no datastore with any other binary.

---

## 4. Critical Invariants

Each invariant was surfaced through an audit or contract verification round. Each is enforced by the `check-invariants` skill before any commit; violating any of them is a P0 protocol failure.

| # | Invariant | Why |
|---|---|---|
| 1 | `executeSlash` takes ONE argument — `Signature` is embedded in `SlashPayload` | Removes an entire class of "wrong-signature" footguns at the call site; the ABI matches the on-chain function exactly |
| 2 | `VOUCHER_TYPEHASH` signs only `(intentId, solver, amount)` | `destTxHash` and `issuedAt` are off-chain metadata; signing them would couple the EIP-712 hash to mutable replay data |
| 3 | Relayer Fargate task role has zero `kms:Sign` permissions | A relayer compromise cannot mint vouchers; KMS credentials live only in the signer container's secrets block |
| 4 | Watchdog derives `SlashPayload` exclusively from Redis (cached on-chain events) | Watchdog and Relayer share no trust boundary; reading from PostgreSQL would let a compromised relayer poison slash decisions |
| 5 | No CCTP — Keeper calls `batchCompensate` directly on Base L2 | Burns on L1 + Iris attestations introduce a second trust assumption (Circle); direct disbursement avoids it |
| 6 | USDC-only collateral — no oracle conversion | A price oracle is a remote-code-execution surface in a settlement contract; single-collateral elimi­nates it |
| 7 | Deadline evaluation uses `chain:{chainId}:latest_safe_ts` — never wall-clock | `time.Now()` on a Watchdog host can drift; using on-chain time makes slashing deterministic against the source chain's view |
| 8 | Hot Path (200 ms) performs zero disk I/O, network I/O, or RPC calls | The 200 ms budget cannot accommodate any I/O round-trip; all hot-path state is in RAM via the shard-locked mempool and `SolverHealthCache` |
| 9 | `os.Chmod(socketPath, 0660)` is the immediate next call after `net.Listen` | Closing the world-writable window between `Listen` and `Chmod` — any deferred chmod is a race window |
| 10 | No `welthee` library — native AWS SDK v2 only for KMS | Third-party KMS wrappers have historically silently downgraded signature verification; native implementation in `internal/shared/kms/signer.go` is auditable |
| INV-WS-1 | `RunPushWorker` is the sole writer of push frames. `IntentAnnouncedFrame` and `AuctionWonFrame` are written exclusively by `(*ws.Server).RunPushWorker`. `ServeHTTP` is read-only and must never call `conn.WriteMessage` for a push frame. | Separating push writes into a single goroutine eliminates data races on the WebSocket connection without a per-connection mutex in the handler path |
| INV-WS-2 | `IntentAccepted` and `AuctionConcludedPush` are SendDrop-only. A saturated push channel drops the frame rather than backpressuring the HTTP handler or auction engine. Push frames are advisory; protocol settlement does not depend on them landing. | Backpressure from WS clients must never propagate into the 200 ms hot path — dropped push frames are harmless; blocked channel sends in the hot path violate Invariant 8 |

---

## 5. Trust Model

The system is zero-trust between every pair of binaries.

- **Relayer ↔ Signer.** The signer never trusts the relayer's intent state. `internal/signer/validator.go` re-reads the intent row inside a `SELECT ... FOR SHARE` transaction and enforces `issued_voucher_signature IS NULL` before calling KMS. Even if the relayer is fully compromised it cannot get a voucher signed twice for the same intent.
- **Relayer ↔ Watchdog.** The watchdog never reads PostgreSQL. It builds `SlashPayload` from `SolverSlashed` / `IntentLocked` / `IntentRefunded` events cached in Redis (Invariant 4). The only relayer → watchdog message channel is the `:8443/internal/witness/verified/{intentId}` mTLS endpoint, used by the watchdog to fail-closed-pause on suspicious activity.
- **Relayer / Watchdog ↔ Keeper.** The keeper reads no relayer or watchdog state. It derives the agent list for `batchCompensate` exclusively from L2 `IntentRefunded` event logs and the L1 `SolverSlashed` event logs (cross-chain JOIN in `internal/keeper/extractor.go`). Agent addresses never come from a database.

**The Fargate task roles encode the same model.**

- `vynx-relayer-task-role` (Box 1): zero `kms:Sign`, PostgreSQL DSN for `vynx_relayer` user only.
- `vynx-signer-role` (Box 1): `kms:Sign` and `kms:GetPublicKey` on the RelayerMasterKey alias only.
- `vynx-watchdog-role` (Box 2): `kms:Sign` on the SlashingKey and RelayerAdminKey aliases; no DB access of any kind; Redis access scoped to one ElastiCache cluster.
- `vynx-keeper-role` (Box 3): `kms:Sign` on the BridgeKey_L2 alias only; DynamoDB read/write on the `vynx-keeper-lock` and `vynx-keeper-epochs` tables only; zero IAM access to any Box 1 or Box 2 resource.

---

## 6. EventBus Architecture

The Hot Path (gatekeeper → engine → mempool → SLA tracker) and the Cold Path (witness → reputation → persistence) are separated by a single struct of typed Go channels declared in `internal/types/events.go`. No package-level mutex is shared between the two paths.

```
Hot Path                                       Cold Path
─────────                                      ─────────
gatekeeper          ── IntentVerified         ──► persistence writer
engine              ── AuctionConcluded       ──► persistence writer
http POST /v1/...   ── PaymentNoticeReceived  ──► witness
SLA tracker         ── IntentTimeout          ──► persistence writer
RPC watcher         ── IntentLocked           ──► SLA tracker promote
                                                   ↓
                                              witness — sign — record
                                                   ↓
                       ◄── SolverHealthUpdate ── reputation
                       ◄── ReputationReset    ── amnesty
```

Channel capacities are deliberately small and asymmetric. The EventBus carries 11 channels:

```
IntentVerified            4096   PaymentNoticeReceived     2048
IntentAccepted            4096   CrossChainPaymentVerified 2048
AuctionConcluded          4096   IntentTimeout             1024
AuctionConcludedPush      4096   SolverHealthUpdate         512
VoucherRedeemed           2048   ReputationReset              1
IntentLocked              1024
```

The 4096-capacity hot-path channels are sized to never fill under expected load; the 512-capacity `SolverHealthUpdate` is small on purpose so a runaway producer cannot stall the gatekeeper cache. `IntentAccepted` and `AuctionConcludedPush` are the two push-worker feed channels added for the WebSocket push protocol (see `docs/relayer.md` §7).

**SendDrop vs SendWait.** Two generic helpers in `internal/types/eventbus_send.go` enforce the only two valid send patterns in the hot path:

- `SendDrop[T]` — non-blocking. If the channel is full, the value is dropped and `onDrop(channel)` fires. Used for telemetry-grade channels where loss is acceptable (`IntentTimeout`, `AuctionConcluded`, `IntentVerified`, `PaymentNoticeReceived`, `IntentLocked`, `ReputationReset`, `VoucherRedeemed`, `IntentAccepted`, `AuctionConcludedPush`).
- `SendWait[T]` — non-blocking with a 5 ms timer (`EventBusSendBudget`). On timer expiry the value is dropped and `onDrop` fires. Used for cache-critical channels where silent loss corrupts state (`SolverHealthUpdate` corrupts the gatekeeper cache; `CrossChainPaymentVerified` loses a settlement).

A bare `events.X <- value` is forbidden in production code and is flagged by `check-invariants`. The reasoning is Invariant 8: any unbounded channel send in the hot path is potentially an unbounded wait, which violates the 200 ms budget.

---

## 7. Academic Foundation

VynX implements two AFT (Advances in Financial Technologies) findings as protocol-level mechanics.

- **Fox, Pai & Resnick (AFT 2023, [arXiv 2301.13321](https://arxiv.org/abs/2301.13321)) §7.2 — "Censorship Resistance in On-Chain Auctions."** The paper establishes that sealed-bid first-price auctions on a public ledger are censorship-resistant when, and only when, the auctioneer cannot observe bids during the auction window. VynX achieves this by holding the entire auction window in-memory on a single Relayer process: bids are submitted over a WebSocket connection, accumulated in the lock-sharded mempool, and never written to disk or to any external system until after the 200 ms window closes. There is no place to censor a bid because there is no out-of-process observer of bids until settlement.
- **Chitra, Ferreira & Kulkarni (AFT 2024, [arXiv 2301.12532](https://arxiv.org/abs/2301.12532)) — "Stake-Weighted Reputation in Order Flow Auctions."** The paper shows that an OFA without solver reputation is dominated by Sybil bidding strategies, while a reputation system that resets too slowly creates a permanent moat against new solvers. VynX's compromise is the 90-day amnesty epoch (`AMNESTY_EPOCH`) combined with the five-level jail ladder: a slashed solver climbs the jail levels predictably (60 s → 600 s → 1 h → 24 h → permanent), and after 90 days of clean operation all jail levels reset. This bounds the cost of an honest mistake without rewarding repeat offenders.

The numbers (`AMNESTY_EPOCH = 90 days`, jail level multipliers) are placeholders pending Yellow Paper finalization. `AGENT_COMPENSATION_BPS = 5000` (50% to agent, 50% to VynxTreasury) has been verified against Yellow Paper v1.1.0 and is no longer a placeholder.

---

## See also

- [`docs/infrastructure.md`](infrastructure.md) — AWS topology, IAM, KMS inventory, Fargate, data layer, WAF, observability
- [`docs/relayer.md`](relayer.md) — Hot Path / Cold Path / Signer sidecar / API layer
- [`docs/watchdog.md`](watchdog.md) — Redis state machine, leader election, deadline sweeper, slash executor
- [`docs/keeper.md`](keeper.md) — Box 3 isolation, DynamoDB epoch lock, cross-chain JOIN
- [`docs/onchain_contracts.md`](onchain_contracts.md) — All six contract ABIs, function signatures, events
- [`docs/mainnet_checklist.md`](mainnet_checklist.md) — Pre-mainnet gates
- [`docs/secrets_rotation.md`](secrets_rotation.md) — Key rotation runbook
