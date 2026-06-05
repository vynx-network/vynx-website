# Getting Started

VynX is a **200ms sealed-bid Order-Flow Auction** settlement layer for AI-agent
cross-chain transfers on Base L2. This guide gets the four binaries building and the
local end-to-end suite running. For the system overview, start with
[`architecture.md`](architecture.md).

---

## 1. Prerequisites

- **Go 1.26+** (`CGO_ENABLED=0` builds).
- **Docker** + Docker Compose (the e2e harness manages PostgreSQL, Redis, Anvil, and
  DynamoDB Local).
- **Foundry / Anvil** (`run-anvil-fork` skill; forks Base + Ethereum).
- **AWS CLI** (used by `make e2e-local` to create DynamoDB Local tables; any dummy
  credentials work locally).
- For the full demo / fork tests: `BASE_SEPOLIA_RPC_URL` and `ETH_SEPOLIA_RPC_URL`.

Copy `.env.example` to `.env` and fill in values. Note the **mandatory**
`TVL_CAP_USDC` (the relayer panics at boot without it).

---

## 2. The four binaries

| Binary | What it is |
|---|---|
| `cmd/relayer` | Intake + 200ms auction + settlement ([`relayer.md`](relayer.md)). |
| `cmd/signer` | UDS EIP-712 voucher signer ([`signer.md`](signer.md)). |
| `cmd/watchdog` | Leader-elected punisher + chain clock ([`watchdog.md`](watchdog.md)). |
| `cmd/keeper` | Weekly epoch reconciliation ([`keeper.md`](keeper.md)). |

```bash
make build-all      # build all four (runs gen-bindings first; CGO_ENABLED=0)
make test-race      # unit tests with the race detector
make gen-bindings   # regenerate Go bindings from bindings/abi/*.json (abigen v1.17.3)
```

---

## 3. Local end-to-end (`make e2e-local`)

```bash
make e2e-local      # harness brings up pg + redis + anvil + dynamodb-local,
                    # then runs: go test -tags e2e -timeout 10m ./e2e/tests/
```

Four flows live in `e2e/tests/`:

| Test | Status | Notes |
|---|---|---|
| `happy_path` | **PASS** | The FULL gasless loop (Sprint 4.2): intake (F1 verify) → auction → the solver executes the REAL `lockIntent(intent, auth)` on a harness-deployed `VynxSettlement` (escrow pulled via `receiveWithAuthorization`) → destination payment → witness → SETTLED → winner-gated voucher pull (`GET /v1/voucher`, EIP-191 challenge; non-winner 403 / pre-settlement 404 probed) → ONE `claimFunds` from the solver's key → on-chain REDEEMED with the 10 bps net/fee split and the post-redemption 404 asserted. |
| `keeper_path` | **PASS** | Weekly epoch reconciliation (DynamoDB Local). |
| `refund_clock_path` | **PASS** | The W8 chain-clock proof — the FinalityWatcher advances `latest_safe_ts` from real `block.timestamp`s and drives a deadline refund. |
| `slash_path` | **PASS** | Re-enabled in Sprint 4.1: the harness now fronts Anvil over **WebSocket** (`Env()` exports ws:// RPC URLs), the Redis fixture matches the W7 payload schema (`inputAmount`/`agent`), and the StubRegistry was recompiled with the real 6-field `SlashPayload` tuple. W5 executes the slash and `SolverSlashed` is asserted on the Eth fork. |

> `TVL_CAP_USDC` is mandatory at relayer boot (`mustU64Env`). The `make e2e-local`
> harness now injects it automatically (`e2e/harness/harness.go` `Env()` — 10,000
> USDC); set it yourself only when running a relayer outside the harness.

---

## 4. Zero-AWS reviewer demo

```bash
make reviewer-demo  # full local flow in <5 min (needs the two *_SEPOLIA_RPC_URL vars)
make observe        # validate the observability config (no live AWS)
```

---

## 5. Before you commit

Run the constitutional gates (see `CLAUDE.md` §6):

```bash
go build ./... && go build -tags e2e ./...   # both tag configs
go vet ./...                                  # and: go vet -tags e2e ./...
golangci-lint run ./...
go test ./...
```

Plus the skills: `check-invariants` (all 12 protocol invariants), `go-test-race`,
`go-lint`. Any invariant violation or data race is a P0 blocker.

See also: [`infrastructure.md`](infrastructure.md), [`mainnet_checklist.md`](mainnet_checklist.md).
