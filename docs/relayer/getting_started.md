# Getting Started — VynX Relayer

## What is VynX

VynX is a 200 ms sealed-bid Order Flow Auction (OFA) settlement layer for AI agent cross-chain transfer intents on Base L2: competitive solvers bid within the auction window, payment is verified off-chain, and settlement is issued via EIP-712 voucher on `VynxSettlement`. The defining architectural constraint is that the entire 200 ms hot path performs zero disk I/O, zero network I/O, and zero RPC calls — all auction state lives in the lock-sharded in-process mempool.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Go | ≥ 1.26 | `brew install go@1.26` or [go.dev/dl](https://go.dev/dl/) |
| Foundry (anvil, cast, forge) | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Docker | ≥ 24 | `brew install --cask docker` or [docs.docker.com](https://docs.docker.com/get-docker/) |
| jq | any | `brew install jq` / `apt install jq` |
| openssl | any | pre-installed on macOS; `apt install openssl` on Linux |
| Base Sepolia RPC URL | — | [alchemy.com](https://alchemy.com/) free tier — `wss://base-sepolia.g.alchemy.com/v2/YOUR_KEY` |
| Ethereum Sepolia RPC URL | — | [alchemy.com](https://alchemy.com/) free tier — `wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY` |

---

## Testnet Deployments

**Ethereum Sepolia (Chain 11155111)**

| Contract | Env var | Address |
|---|---|---|
| VynxRegistry | `VYNX_REGISTRY_ADDRESS` | `0xDFFA630b9E137a88215d99c4c8A267FfC7fBCB3C` |
| DirectVaultAdapter (USDC) | `DIRECT_VAULT_ADAPTER_USDC` | `0xf048D63f4D4bBA9819e4284B2e4f5a2102e47cBA` |

**Base Sepolia (Chain 84532)**

| Contract | Env var | Address |
|---|---|---|
| VynxSettlement | `VYNX_SETTLEMENT_ADDRESS` | `0xA8cA9d84e35ac8F5af6F1D91fe4bE1C0BAf44296` |
| VynxTreasury | `VYNX_TREASURY_ADDRESS` | `0x653D9C2dF3A32B872aEa4E3b4e7436577C5eEB62` |
| VynxAdmin (UUPS proxy) | `VYNX_ADMIN_ADDRESS` | `0xcCa54463BD2aEDF1773E9c3f45c6a954Aa9D9706` |
| StakingRewards | `STAKING_REWARDS_ADDRESS` | `0x312510B911fA47D55c9f1a055B1987D51853A7DE` |

**Canonical USDC**

| Token | Chain | Env var | Address |
|---|---|---|---|
| USDC | Base Mainnet | `USDC_ADDRESS_BASE` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDC | Ethereum Mainnet | `USDC_ADDRESS_ETH` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |

---

## Run the Demo

```bash
export BASE_SEPOLIA_RPC_URL=wss://base-sepolia.g.alchemy.com/v2/YOUR_KEY
export ETH_SEPOLIA_RPC_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
make reviewer-demo
```

The script (`scripts/reviewer-demo.sh`) runs the full intent lifecycle without AWS credentials:

1. **Infrastructure** — Starts PostgreSQL 16-alpine on `:5432` and Redis 7-alpine on `:6379` via Docker. Applies all DB migrations.
2. **Anvil forks** — Base Sepolia fork on `:8545` (chain 84532) and Ethereum Sepolia fork on `:8546` (chain 11155111). If RPC URLs are set, both forks pin to live testnet state; otherwise they run standalone.
3. **Contracts** — Deploys MockUSDC (6-decimal ERC-20) and MockSettlement (emits the real `VoucherRedeemed(bytes32,address,uint256,uint256)` event signature) on the Base fork. Mints 10,000 USDC each to the test agent and solver wallets.
4. **Relayer** — Builds the relayer binary with `-tags e2e` (software ECDSA signing; no KMS required). Polls `GET /healthz` until HTTP 200.
5. **Intent submission** — `POST /v1/intent` with a 50 USDC intent. The relayer returns HTTP 202 with `auctionExpiry`.
6. **Auction window** — The 200 ms sealed-bid window closes. The auction result is seeded directly into the DB; no live WebSocket solver client is required for the demo.
7. **Payment** — Solver sends USDC to MockSettlement on-chain. `POST /v1/payment-notice` triggers the witness service, which fetches the receipt and passes 2-block finality depth.
8. **Voucher issuance** — Relayer signs an EIP-712 voucher with the 3-field typehash (`intentId`, `solver`, `amount`). `destTxHash` and `issuedAt` are excluded from the signed payload.
9. **Settlement** — Solver calls `claimFunds` on MockSettlement. The script polls for the `VoucherRedeemed` event and prints the tx hash.

Expected terminal output:

```
=== VynX Demo Complete ===

    Intent ID:        0x...
    Auction winner:   0x...
    Dest TX:          0x...  (solver USDC payment)
    VoucherRedeemed:  0x...  (on-chain settlement — different from Dest TX)
    Settlement:       0x...
    MockUSDC:         0x...
```

On `EXIT`, all Docker containers and background processes are cleaned up automatically.

---

## Verify On-Chain

After the demo completes, confirm the settlement event on the local Anvil fork. Replace `<SETTLEMENT_ADDR>` with the MockSettlement address printed by the demo:

```bash
cast logs \
  --rpc-url http://127.0.0.1:8545 \
  --address <SETTLEMENT_ADDR> \
  --from-block 0 \
  'VoucherRedeemed(bytes32,address,uint256,uint256)'
```

Event signature source: [`docs/onchain_contracts.md`](onchain_contracts.md) §2 — `VoucherRedeemed(bytes32 indexed intentId, address indexed solver, uint256 netAmount, uint256 fee)`.

For the full E2E test suite against testnet forks (requires both RPC URLs):

```bash
go test -v -tags e2e -timeout 10m ./e2e/tests/
```

Three tests: `TestHappyPath_IntentToVoucherRedeemed`, `TestSlashPath_SLATimeoutToSlashExecuted`, `TestKeeperPath_EpochCompensatesAgent`.

---

## Architecture in 60 Seconds

```
┌──────────────────────────────────────────────────────────┐
│  Box 1 · us-east-1 · vynx-core-prod                      │
│  cmd/relayer  — 200ms OFA auction + cold path settlement │
│  cmd/signer   — UDS sidecar; RelayerMasterKey (AWS KMS)  │
│  RDS PostgreSQL 16 Multi-AZ · WAF v2 on ALB              │
└─────────────────────┬────────────────────────────────────┘
                      │ mTLS :8443 via VPC Peering (RFC1918)
┌─────────────────────▼────────────────────────────────────┐
│  Box 2 · us-east-2 · vynx-sentinel-prod                  │
│  cmd/watchdog  — deadline sweeper + slash executor       │
│  SlashingKey + RelayerAdminKey (AWS KMS)                 │
│  ElastiCache Redis 7.2 (AOF) · chain clock in Redis      │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Box 3 · us-west-2 · vynx-treasury-prod                  │
│  cmd/keeper  — weekly batchCompensate on Base L2         │
│  BridgeKey_L2 (AWS KMS) · DynamoDB epoch lock            │
│  Zero network path to Box 1 or Box 2                     │
└──────────────────────────────────────────────────────────┘
```

Contracts: VynxRegistry + DirectVaultAdapter on Ethereum L1. VynxSettlement + VynxTreasury + VynxAdmin (UUPS proxy) + StakingRewards on Base L2.

`/v1/ws` is bidirectional. Solver → relayer carries `BidMessage` frames (unchanged). Relayer → solver pushes two new frames: `IntentAnnouncedFrame` (JSON field `"type": "intent_announced"` — broadcast to all connected solvers the moment an intent is accepted, before the 200 ms auction window opens) and `AuctionWonFrame` (JSON field `"type": "auction_won"` — unicast to the winning solver only, once the auction concludes). Solvers identify themselves at upgrade with `?solver=0x...`. See `docs/relayer.md` §7 for the full schemas and data flow.

---

## Security Model

- **Zero I/O in the hot path (Invariant 8).** `internal/relayer/hotpath/engine/` is a pure RAM state machine. The EventBus separates hot path from cold path via non-blocking `SendDrop`/`SendWait` generics — a saturated channel drops the event rather than blocking the 200 ms auction window.

- **TOCTOU-proof voucher signing (Invariant 2).** `internal/signer/validator.go` holds a `SELECT ... FOR SHARE` row lock across the KMS sign call. An `issued_voucher_signature IS NULL` guard in the same query makes KMS invocations idempotent — a concurrent retry never re-signs the same intent.

- **MEV-resistant slash on chain-clock time only (Invariant 7).** `cmd/watchdog` routes all `executeSlash` calls through Flashbots Protect (`FLASHBOTS_RPC_URL`) and MEV-Blocker — slash transactions never enter the public mempool. Deadline evaluation uses `chain:{chainId}:latest_safe_ts` from Redis; wall-clock `time.Now()` is never compared against a deadline.

- **Multi-account blast radius isolation (Invariant 3).** Box 1 IAM compromise grants zero access to Box 2 KMS keys (separate `vynx-sentinel-prod` AWS account) and zero access to Box 3 treasury disbursements (separate `vynx-treasury-prod` account). WAF `WSReconnectionStormLimit` caps WebSocket reconnection storms at 10 new connections/IP/5min at the Box 1 perimeter.

- **UID/GID socket ownership segregation (Invariant 9).** The Signer container runs as UID 2000:2000 (socket owner) and calls `os.Chmod(socketPath, 0660)` as the immediate next statement after `net.Listen`. The Relayer runs as UID 1000:2000 — group write access without socket ownership, so it cannot unlink the socket.

---

## Go Deeper

- [`docs/architecture.md`](architecture.md) — Protocol overview, 12 critical invariants, EventBus model, academic foundation
- [`docs/infrastructure.md`](infrastructure.md) — Three-box AWS topology, Organizations, KMS keys, Fargate, WAF, observability
- [`docs/relayer.md`](relayer.md) — Hot path engine, cold path services, signer sidecar, API layer, startup
- [`docs/watchdog.md`](watchdog.md) — Redis state machine, deadline sweeper, slash executor, EmergencyPause
- [`docs/keeper.md`](keeper.md) — Box 3 isolation, DynamoDB epoch lock, cross-chain JOIN, batchCompensate
- [`docs/onchain_contracts.md`](onchain_contracts.md) — Full ABI reference: function signatures, custom errors, events for all six contracts
- [`docs/mainnet_checklist.md`](mainnet_checklist.md) — Every gate that must be ✅ before mainnet deployment
- [`docs/secrets_rotation.md`](secrets_rotation.md) — Key rotation procedures for all four KMS keys
- [`CHANGELOG.md`](../CHANGELOG.md) — Architectural evolution v0.1.0 → v1.0.0 with rationale per security decision
