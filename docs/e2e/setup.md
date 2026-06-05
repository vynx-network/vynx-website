# Setup — running the vynx-e2e suite

This guide takes you from a clean checkout to a green `make e2e`. The suite stands up a full
live stack, so the prerequisites are real: a Go toolchain, Node, Docker, Foundry, and RPC
access to five chains.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Go | 1.23+ | builds `bin/relayer`, `bin/watchdog` (from `../vynx-relayer`) and `bin/solver` |
| Node.js | 20+ | runs the vitest harness and the SDK fixtures |
| Docker | recent | PostgreSQL 16 + Redis 7 via `docker-compose.yml` |
| Foundry | recent | `anvil` (forks) + `forge` (contract deploy) + `cast` |

The sibling repositories must be checked out next to `vynx-e2e`:

```
vynx/
  vynx-e2e/         <- you are here
  vynx-relayer/     <- $RELAYER_REPO (default ../vynx-relayer)
  vynx-settlement/  <- $SETTLEMENT_REPO (default ../vynx-settlement)
  vynx-sdk/         <- installed as file:../vynx-sdk
```

---

## 2. RPC endpoints

`e2e.sh` forks five chains. **Base and Eth fork public testnets** (Sepolia); the **three
destinations fork their real mainnets**. You need one RPC URL per chain (Alchemy or
equivalent). Rate-limited or unreachable destination endpoints degrade that single chain to
a Base sim (see `docs/architecture.md` §3); Base and Eth must always be reachable.

| Env var | Forked network | Local anvil |
|---|---|---|
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia | `http://localhost:8545` (chain-id 84532) |
| `ETH_SEPOLIA_RPC_URL` | Eth Sepolia | `http://localhost:8546` (chain-id 1) |
| `ARBITRUM_RPC_URL` | Arbitrum mainnet | `http://localhost:8547` (chain-id 42161) |
| `OPTIMISM_RPC_URL` | Optimism mainnet | `http://localhost:8548` (chain-id 10) |
| `POLYGON_RPC_URL` | Polygon mainnet | `http://localhost:8549` (chain-id 137) |

---

## 3. Configure `.env`

```bash
cp .env.example .env
# Fill in your five RPC URLs. The wallet keys and role keys in .env.example are
# anvil deterministic accounts — fine for local testing, never for production.
```

`.env` is gitignored; `.env.example` is the tracked template. The example ships with the
anvil test keys and placeholder contract addresses (the contract addresses are overwritten
at runtime by `e2e.sh` with the freshly deployed addresses).

### Key environment variables

| Var | Read by | Notes |
|---|---|---|
| `BASE_ANVIL_URL` … `POLYGON_ANVIL_URL` | harness + solver | local anvil endpoints |
| `RELAYER_BASE_URL` / `RELAYER_WS_URL` | SDK / solver | relayer HTTP `:8080` and WS |
| `RELAYER_BIN_PATH` / `WATCHDOG_BIN_PATH` | `e2e.sh` | launched binaries (`./bin/...`) |
| `E2E_RELAYER_KEY` / `RELAYER_SIGNER` | relayer | in-process EIP-712 signing; `RELAYER_SIGNER` must equal the address of `E2E_RELAYER_KEY` |
| `REDIS_URL` | watchdog + harness | **env-wired** |
| `SOLVER_*_PK`, `AGENT_*_PK`, `WATCHDOG_PK`, `DEPLOYER_PK`, `MULTISIG_PK`, `KEEPER_PK` | fixtures / `e2e.sh` | anvil deterministic accounts |
| `E2E_TIMEOUT_MS` | `vitest.config.ts` | per-test timeout (default 30000) |

### `POSTGRES_URL` — RELAYER hardcoded, HARNESS env-wired (read this)

The RELAYER's DB coordinates are a **hardcoded** DSN passed by `e2e.sh`
(`VYNX_RELAYER_DB_DSN=postgres://vynx:vynx@127.0.0.1:5432/vynx_e2e?sslmode=disable`), so
changing `POSTGRES_URL` does NOT repoint the relayer.

But `POSTGRES_URL` **is** read by the HARNESS as of Sprint 5.2: `fixtures/pg-utils.ts`
(node-postgres) connects with it to read `solver_health.jail_level` for the
jail-time-sla-breach DB assertion. Keep `POSTGRES_URL` pointed at the same Docker Postgres as
the hardcoded relayer DSN; if you change the `docker-compose.yml` credentials/port, update
BOTH the DSN in `e2e.sh` and `POSTGRES_URL`.

---

## 4. Build and run

```bash
make install        # npm ci (TypeScript deps)
make e2e            # build binaries, deploy contracts, run the full suite
```

`make e2e` expands to `make install-bins solver-build && bash scripts/e2e.sh`:

- `install-bins` builds `bin/relayer` and `bin/watchdog` from `$RELAYER_REPO` with
  `-tags e2e`. (It does **not** build a signer binary — the relayer signs in-process.)
- `solver-build` compiles `bin/solver` from `solver/main.go`.
- `e2e.sh` brings up Postgres + Redis, the five anvil forks, deploys the real
  `vynx-settlement` contracts, funds wallets, launches the relayer + watchdog, runs
  `vitest`, and tears everything down.

A green run ends with **51 passed** (51 it() across 37 files). The FASE 5 / project-final
gate requires this to pass twice consecutively (`make e2e` ×2).

### Useful sub-commands

```bash
make typecheck      # tsc --strict --noEmit
make lint           # eslint fixtures/ tests/ --max-warnings 0
make solver-build   # rebuild just the test solver
make clean          # remove bin/ and tear down the Docker stack
```

---

## 5. Troubleshooting

- **A destination "FALLBACK to Base sim".** That destination's RPC was unreachable or
  rate-limited. The run is still valid (the chain degrades to a Base sim); re-run for true
  cross-chain coverage on that chain. Check `/tmp/anvil-<name>.log`.
- **Relayer/watchdog/solver logs.** `/tmp/relayer.log`, `/tmp/watchdog.log`,
  `/tmp/<solver-id>.log`, `/tmp/anvil-*.log`.
- **Port already in use (8545–8549, 8080, 5432, 6379).** A previous run left orphans —
  `make clean`, then ensure no stray `anvil`/`relayer`/`watchdog` processes remain.
- **Postgres/Redis won't start.** Confirm Docker is running and the ports are free;
  `docker compose up -d` is invoked by `e2e.sh`.

See also: `docs/architecture.md`, `docs/tests.md`, `docs/fixtures.md`.
