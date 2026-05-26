# VynX Pre-Mainnet Checklist

**Protocol:** VynX Network v1.0.0
**Network:** Base Mainnet + Ethereum Mainnet
**Date:** ___________
**Signed by:** ___________

---

## Security

- [ ] All 12 critical invariants verified by `check-invariants` skill — EXIT 0
      ```
      # Run from project root
      grep -r 'welthee' go.mod go.sum && echo FAIL || echo PASS
      grep 'time\.Now' internal/watchdog/scheduler/sweeper.go && echo FAIL || echo PASS
      grep -r 'pgx\.\|database/sql' internal/watchdog/ && echo FAIL || echo PASS
      ```

- [ ] `go test -race -count=1 ./...` passes — EXIT 0
      ```
      go test -race -count=1 -timeout 10m ./...
      ```

- [ ] `make build-all` with `CGO_ENABLED=0` passes — EXIT 0
      ```
      CGO_ENABLED=0 make build-all
      ```

- [ ] No `welthee` library in `go.mod` or `go.sum`
      ```
      grep welthee go.mod go.sum && echo FAIL || echo PASS
      ```

- [ ] KMS address verification active in all three binaries (Sprint 11, Task 11.1)
      Evidence: startup logs confirm no address-mismatch fatal on testnet deployment

- [ ] mTLS certs issued by production CA (not self-signed demo certs)
      Evidence: `openssl x509 -issuer -noout -in <cert>` shows production CA

- [ ] Terraform IAM policies reviewed — relayer Fargate task role has ZERO `kms:Sign`
      ```
      grep -A 30 'relayer_task' infra/box1/iam.tf | grep 'kms:Sign' && echo FAIL || echo PASS
      ```

- [ ] `FOR SHARE` row lock present in `internal/signer/validator.go` — TOCTOU guard on voucher signing
      ```
      grep 'FOR SHARE' internal/signer/validator.go && echo PASS || echo FAIL
      ```

- [ ] Signature idempotency active — `issued_voucher_signature IS NULL` guard prevents duplicate KMS calls
      ```
      grep 'issued_voucher_signature IS NULL' internal/signer/validator.go && echo PASS || echo FAIL
      ```

- [ ] KMS retry backoff configured — `signRetryBackoff` (50 / 100 / 200 ms, 4 attempts max)
      ```
      grep 'signRetryBackoff' internal/shared/kms/signer.go && echo PASS || echo FAIL
      ```

- [ ] RPC partial degradation circuit breaker active — HTTP 503 returned when pool state ≠ Healthy
      ```
      grep 'StatusServiceUnavailable' internal/relayer/api/http/intent.go && echo PASS || echo FAIL
      ```

- [ ] EventBus non-blocking helpers present — `SendDrop` and `SendWait` defined; no blocking channel sends in hot path
      ```
      grep -c 'func Send' internal/types/eventbus_send.go   # must be 2 (SendDrop + SendWait)
      ```

- [ ] Flashbots + MEV-Blocker configured for all L1 slash transactions
      Evidence: `FLASHBOTS_RPC_URL` is set; `AssertFlashbots()` passes in watchdog startup

- [x] `AGENT_COMPENSATION_BPS` verified against Yellow Paper — resolved 2026-05-18
      Evidence: Yellow Paper v1.1.0 confirms 5000 bps (50% agent, 50% VynxTreasury); TODO removed from `internal/types/constants.go`

## Infrastructure

- [ ] `terraform apply` completed on `infra/box1` — no pending changes
      ```
      cd infra/box1 && terraform plan -var-file=staging.tfvars
      ```

- [ ] `terraform apply` completed on `infra/box2` — no pending changes
      ```
      cd infra/box2 && terraform plan -var-file=staging.tfvars
      ```

- [ ] `infra/box2/` declares exactly **two** KMS key resources (`SlashingKey` and `RelayerAdminKey`)
      ```
      grep 'resource "aws_kms_key"' infra/box2/*.tf | wc -l   # must be 2
      ```

- [ ] RDS Multi-AZ enabled and verified
      ```
      aws rds describe-db-instances --query 'DBInstances[*].MultiAZ'
      ```

- [ ] Redis AOF enabled — `appendonly yes`, `appendfsync everysec`
      ```
      redis-cli config get appendonly
      redis-cli config get appendfsync
      ```

- [ ] All 4 Docker images pushed to ECR with production tags
      ```
      aws ecr describe-images --repository-name vynx-relayer --query 'sort_by(imageDetails, &imagePushedAt)[-1]'
      ```

- [ ] CloudWatch alarms active — P0/P1/P2 verified in Datadog
      Evidence: `make observe` exits 0; each alarm has a verified action

- [ ] PagerDuty integration tested — test alert sent and received
      Evidence: incident ID from test alert, resolved before mainnet

- [ ] Box 3 (vynx-treasury-prod) Terraform applied — DynamoDB, KMS, ECS, EventBridge all provisioned
      ```
      cd infra/box3 && terraform plan
      ```

- [ ] DynamoDB epoch-lock table declared — `keeper_lock` with TTL on `expires_at`
      ```
      grep 'keeper_lock' infra/box3/dynamodb.tf && echo PASS || echo FAIL
      ```

- [ ] Keeper task role in Box 3 has ZERO permissions on Box 1 or Box 2 resources
      ```
      grep -E 's3|rds|elasticache|box1|box2' infra/box3/iam.tf && echo FAIL || echo PASS
      ```

- [ ] `BridgeKey_L2` KMS key is in Box 3 (not Box 1)
      Evidence: `infra/box3/kms.tf` declares `aws_kms_key.bridge_l2` (alias `alias/vynx-keeper-l2`)

- [ ] EventBridge cron rule active — `cron(0 0 ? * SUN *)` matches `REBALANCE_EPOCH`
      ```
      grep -F 'cron(0 0 ? * SUN *)' infra/box3/eventbridge.tf
      ```

- [ ] Keeper is a blind on-chain reader — no PostgreSQL imports remain
      ```
      grep -r 'pgx\.\|pgxpool\.\|debt_registry\|VYNX_KEEPER_DB_DSN' internal/keeper/ cmd/keeper/ && echo FAIL || echo PASS
      ```

## Protocol

- [ ] VynxRegistry deployed and verified on Ethereum Mainnet
      Evidence: contract address + `etherscan.io` verification URL

- [ ] VynxSettlement deployed and verified on Base Mainnet
      Evidence: contract address + `basescan.org` verification URL

- [ ] VynxTreasury deployed and verified on Base Mainnet
      Evidence: contract address + `basescan.org` verification URL

- [ ] VynxAdmin (proxy + impl) deployed and verified on Base Mainnet
      Evidence: proxy address, impl address, both verified

- [ ] DirectVaultAdapter (USDC) deployed and verified on Base Mainnet
      Evidence: contract address + verification URL

- [ ] Contract addresses updated in production `.env` / Secrets Manager
      ```
      # Verify all contract env vars are set
      aws secretsmanager get-secret-value --secret-id vynx/production/contracts | jq .
      ```

- [ ] `RELAYER_SIGNER` address matches deployed RelayerMasterKey
      Evidence: startup log of `cmd/signer` shows no address-mismatch fatal

- [ ] `WATCHDOG_ADDRESS` matches deployed SlashingKey
      Evidence: startup log of `cmd/watchdog` shows no address-mismatch fatal

- [ ] `KEEPER_ADDRESS` matches deployed BridgeKey_L2
      Evidence: test keeper epoch log shows no address-mismatch fatal

- [ ] Multisig (3/4) tested — pause and unpause verified on testnet
      Evidence: `VynxAdmin.pauseAll()` tx hash on testnet; `VynxAdmin.unpauseAll()` tx hash on testnet

- [x] `AGENT_COMPENSATION_BPS` TODO item resolved (see Security section)

## Operational

- [ ] `make reviewer-demo` passes end-to-end — EXIT 0 with zero `FTL` lines
      ```
      make reviewer-demo 2>&1 | tee /tmp/demo.log
      grep -c FTL /tmp/demo.log   # must be 0
      ```

- [ ] E2E flow tests pass against testnet
      ```
      go test -tags e2e -v -timeout 10m ./e2e/tests/
      ```

- [ ] Keeper epoch tested on testnet — at least one `COMPLETED` epoch row in DynamoDB
      ```bash
      aws dynamodb scan \
        --table-name vynx-keeper-epochs \
        --filter-expression "#s = :completed" \
        --expression-attribute-names '{"#s":"status"}' \
        --expression-attribute-values '{":completed":{"S":"COMPLETED"}}' \
        --region us-west-2 --profile vynx-treasury-prod
      ```

- [ ] Watchdog slash path tested on testnet — at least one `SlashExecuted` event
      ```
      cast logs --address <registry-addr> 'SolverSlashed(address,bytes32,uint256,address)'
      ```

- [ ] Graceful shutdown verified — no `FTL` errors on SIGTERM
      Evidence: `make reviewer-demo` log contains no `FTL` lines

- [ ] Secrets rotation runbook reviewed by at least one other person
      Evidence: reviewer name and date: ___________

- [ ] `.env` production file stored in AWS Secrets Manager (not on disk)
      ```
      aws secretsmanager describe-secret --secret-id vynx/production/relayer
      ```

## Multi-Account & Network

- [ ] AWS Organizations created — vynx-core-prod, vynx-sentinel-prod, vynx-treasury-prod accounts exist
- [ ] Box 1 Terraform applied in vynx-core-prod account
- [ ] Box 2 Terraform applied in vynx-sentinel-prod account
- [ ] Box 3 Terraform applied in vynx-treasury-prod account
- [ ] VPC Peering connection status = active for Box 1 ↔ Box 2 (verify AWS Console on both accounts)
- [ ] Box 3 has NO VPC peering to Box 1 or Box 2 (by design — verify in infra/box3 there is no vpc_peering.tf)
- [ ] mTLS traffic routes via VPC Peering — verify no public internet hops:
      `traceroute` from Watchdog container to Relayer :8443 shows RFC1918 hops only
- [ ] WAF deployed and associated with Box 1 ALB
- [ ] WAF test: send 200 requests from same IP within 5 minutes — confirm 100+ blocked
- [ ] WAF WebSocket test: open 15 new WS connections from same IP within 5 minutes — confirm blocked after 10
- [ ] WAF `WSReconnectionStormLimit` rule present — 10 WS connections per IP per 5 min
      ```
      grep 'WSReconnectionStormLimit' infra/box1/waf.tf && echo PASS || echo FAIL
      ```
- [ ] CloudTrail org trail active — logs appear in management account S3 bucket
- [ ] CloudTrail S3 policy has Confused Deputy mitigation (`aws:SourceArn` condition)
- [ ] `infra/**/*.tfvars` absent from git history:
      `git log --all --full-history -- 'infra/**/*.tfvars'` returns empty

## Final Gate

- [ ] All items above checked ✅
- [ ] 24-hour testnet soak with real intent flow (no failures or FTL logs)
      Evidence: Datadog dashboard screenshot showing 24 h window

- [ ] Mainnet deployment approved by multisig (3/4 signers)
      Evidence: multisig tx hash

---

## Container & Database Hardening

- [ ] Signer runs as UID 2000:2000, Relayer as UID 1000:2000
      ```
      docker inspect vynx/signer:latest | jq '.[0].Config.User'    # "2000:2000"
      docker inspect vynx/relayer:latest | jq '.[0].Config.User'   # "1000:2000"
      ```

- [ ] Signer cannot have its socket unlinked by Relayer (POSIX owner check)
      Evidence: socket owner = UID 2000, permissions = 0660, Relayer UID 1000 ≠ owner

- [ ] `initProcessEnabled: true` in every container definition (PID namespace isolation)
      ```
      grep -c 'initProcessEnabled.*true' deployments/fargate/*.json
      # relayer-signer:2  watchdog:1  keeper:1
      ```

- [ ] `readonlyRootFilesystem: true` on signer and watchdog containers
      ```
      grep 'readonlyRootFilesystem.*true' deployments/fargate/relayer-signer.task.json
      grep 'readonlyRootFilesystem.*true' deployments/fargate/watchdog.task.json
      ```

- [ ] Signer AWS credentials in signer container secrets only — not in relayer or task-level env
      ```
      jq '[.containerDefinitions[] | select(.name=="relayer") | .secrets // [] | .[] | select(.name | test("AWS_"))] | length' \
        deployments/fargate/relayer-signer.task.json    # 0
      jq '[.containerDefinitions[] | select(.name=="signer") | .secrets | .[] | select(.name | test("AWS_"))] | length' \
        deployments/fargate/relayer-signer.task.json    # 2
      ```

- [ ] PostgreSQL `statement_timeout = 5000ms` on all DB pools
      ```
      grep statement_timeout internal/shared/db/pool.go
      ```

- [ ] PostgreSQL `lock_timeout = 2000ms` on all DB pools
      ```
      grep lock_timeout internal/shared/db/pool.go
      ```

- [ ] No raw `pgxpool.New` or `pgx.Connect` calls — all pools created via `db.NewPool`
      ```
      grep -rn 'pgxpool\.New\b\|pgx\.Connect' cmd/ internal/ | grep -v internal/shared/db/pool.go
      # expected: 0 lines
      ```

- [ ] ALB TLS policy = `ELBSecurityPolicy-TLS13-1-2-2021-06` (TLS 1.3 enforced)
      ```
      grep 'ELBSecurityPolicy-TLS13' infra/box1/alb.tf
      ```

- [ ] ALB access logs enabled and writing to S3 (`vynx-alb-logs-<account>`)
      ```
      grep -A2 'access_logs' infra/box1/alb.tf
      ```

- [ ] ALB `deregistration_delay = 30` (connection draining active)
      ```
      grep 'deregistration_delay.*30' infra/box1/alb.tf
      ```

---

*All items must be ✅ before any mainnet contract deployment or traffic routing begins.*

See also: [`docs/secrets_rotation.md`](secrets_rotation.md), [`docs/infrastructure.md`](infrastructure.md), [`docs/architecture.md`](architecture.md).
