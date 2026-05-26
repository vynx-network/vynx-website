# VynX — Infrastructure

How VynX is deployed on AWS. Every section below is derived from `infra/**/*.tf` and `deployments/fargate/*.task.json`; if Terraform says X and this doc says Y, Terraform wins and this doc is wrong.

---

## 1. Three-Box Topology

The protocol runs across three AWS accounts under one AWS Organization. The split is enforced by the IAM blast-radius rules in [`docs/architecture.md`](architecture.md) §5.

```
┌────────────────────────────────────────────────────────────────┐
│  Box 1 — vynx-core-prod — us-east-1                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ subnet_public  (10.0.1.0/24, 10.0.2.0/24)                │  │
│  │   ECS Service relayer-signer (1 task, 2 containers):     │  │
│  │     • relayer  — UID 1000:2000 — no kms:Sign             │  │
│  │     • signer   — UID 2000:2000 — kms:Sign on RelayerKey  │  │
│  │     shared UDS volume: /run/vynx/voucher-signer.sock     │  │
│  │   ALB :443 — TLS 1.3 — fronts relayer                    │  │
│  │   Port :8443 mTLS — scoped to Box 2 CIDR only            │  │
│  │                                                          │  │
│  │ subnet_data    (10.0.21.0/24, 10.0.22.0/24)              │  │
│  │   RDS PostgreSQL 16 — Multi-AZ — TLS only                │  │
│  │                                                          │  │
│  │ subnet_private (10.0.11.0/24, 10.0.12.0/24) — unused     │  │
│  │   (legacy keeper subnets; Sprint 13 moved keeper to Box 3)│ │
│  └──────────────────────────────────────────────────────────┘  │
│            ▲                                          ▲        │
│            │ HTTPS 443 (agents, solvers)              │ mTLS   │
│            │                                          │ 8443   │
└────────────┼──────────────────────────────────────────┼────────┘
             │                                          │
       internet (WAF v2)                          VPC Peering
                                                        │
┌───────────────────────────────────────────────────────┼────────┐
│  Box 2 — vynx-sentinel-prod — us-east-2               │        │
│  ┌────────────────────────────────────────────────────┴─────┐  │
│  │ ECS Service watchdog (1 task, 1 container)               │  │
│  │   readonlyRootFilesystem: true   initProcessEnabled: true│  │
│  │   kms:Sign on SlashingKey + RelayerAdminKey              │  │
│  │ ElastiCache Redis 7.2 — appendonly yes, fsync everysec   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Box 3 — vynx-treasury-prod — us-west-2                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ EventBridge cron(0 0 ? * SUN *) → ECS Scheduled Task     │  │
│  │   container: keeper (Fargate, 256 CPU / 512 MB)          │  │
│  │   assign_public_ip = true (no VPC peering by design)     │  │
│  │   kms:Sign on BridgeKey_L2 only                          │  │
│  │ DynamoDB:  vynx-keeper-lock (TTL),                       │  │
│  │            vynx-keeper-epochs (PITR enabled)             │  │
│  │ ZERO network path to Box 1 or Box 2                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

Total: three regions, three accounts, four binaries, three datastores (PostgreSQL, Redis, DynamoDB).

---

## 2. AWS Organizations

Before Sprint 12, the protocol ran in a single AWS account. A full IAM compromise of that account would grant the attacker `kms:Sign` on every key, including SlashingKey and RelayerAdminKey. That was the single point of failure the multi-account refactor eliminated.

`infra/org/main.tf` declares:

```
aws_organizations_organization.vynx     (feature_set = "ALL")
aws_organizations_account.core          (vynx-core-prod)
aws_organizations_account.sentinel      (vynx-sentinel-prod)
aws_organizations_account.treasury      (vynx-treasury-prod)
```

Each member account is created with `role_name = "OrganizationAccountAccessRole"` — the standard pattern for management-account access into member accounts. Cross-account access into Box 2 or Box 3 from Box 1 requires explicit assumption of that role, which is auditable in CloudTrail and disabled in production runbooks.

`prevent_destroy = true` is set on every account resource. `terraform destroy` cannot be used against `infra/org/` — AWS account deletion requires contacting AWS Support, so the destroy lifecycle is a footgun the module pre-emptively disables.

---

## 3. Network Architecture

### Box 1 VPC (`infra/box1/vpc.tf`)

- VPC CIDR `10.0.0.0/16`, two AZs (`{region}a`, `{region}b`).
- Three subnet tiers, each 2 AZs:
  - `subnet_public` (`10.0.1.0/24`, `10.0.2.0/24`) — relayer + signer ECS service.
  - `subnet_private` (`10.0.11.0/24`, `10.0.12.0/24`) — legacy keeper subnets (Sprint 13 moved keeper to Box 3).
  - `subnet_data` (`10.0.21.0/24`, `10.0.22.0/24`) — RDS Multi-AZ. **No default route** — DB is only reachable from within the VPC.
- Single Internet Gateway; single NAT Gateway in `public[0]`.

### Box 1 Security Groups

| SG | Ingress | Egress |
|---|---|---|
| `sg_public` | TCP 443 from `0.0.0.0/0`; TCP 8443 from Box 2 watchdog subnet CIDR only (added by `vpc_peering.tf`) | All |
| `sg_private` | None | All |
| `sg_data` | TCP 5432 from `subnet_public` + `subnet_private` CIDRs only | (default) |

### Box 1 ↔ Box 2 VPC Peering (`infra/box1/vpc_peering.tf`)

- Requester: Box 1 (`aws.core`); accepter: Box 2 (`aws.sentinel`); `auto_accept = false`.
- Box 1 private route table adds `var.box2_vpc_cidr → peering_connection_id`.
- DNS resolution over the peering is **disabled** (`allow_remote_vpc_dns_resolution` is intentionally not set). The Watchdog connects to the Relayer by private IP only.
- The 8443 mTLS port is opened on Box 1 `sg_public` exclusively to `var.box2_watchdog_subnet_cidr` — no other source can reach the mTLS endpoint.

**Why peering, not the public internet.** mTLS traffic from Watchdog → Relayer carries fraud-pause signals. Routing those over the public internet means an attacker who controls a BGP path can drop the traffic and silently neutralise the kill-switch. VPC Peering keeps the traffic on the AWS backbone where the attack surface is AWS itself.

### Box 3 — no VPC peering by design

`infra/box3/eventbridge.tf` runs the keeper Fargate task with `assign_public_ip = true` and no VPC peering to Box 1 or Box 2. The keeper reaches Base L2 and Ethereum L1 via public RPC endpoints; it shares no internal route with the core protocol path. Adding peering to Box 3 is a security violation that §9 below (Step 5) explicitly flags.

---

## 4. KMS Key Inventory

There are exactly four protocol KMS keys. Every key is `ECC_SECG_P256K1` / `SIGN_VERIFY` (secp256k1, suitable for Ethereum). `enable_key_rotation = false` is **correct** — AWS KMS does not support automatic rotation for asymmetric keys; setting it to true would fail `terraform apply`. Rotation is manual; the runbook is in [`docs/secrets_rotation.md`](secrets_rotation.md). `deletion_window_in_days = 30` applies uniformly.

| Key | Account | Region | Terraform | Alias | Used by |
|---|---|---|---|---|---|
| RelayerMasterKey | vynx-core-prod | us-east-1 | `infra/box1/iam.tf` (alias scope) | `alias/vynx-signer` | `cmd/signer` |
| SlashingKey | vynx-sentinel-prod | us-east-2 | `infra/box2/kms.tf` | `alias/vynx-watchdog-slashing` | `cmd/watchdog` (executeSlash on L1) |
| RelayerAdminKey | vynx-sentinel-prod | us-east-2 | `infra/box2/kms.tf` | `alias/vynx-watchdog-admin` | `cmd/watchdog` (pauseAll on L2) |
| BridgeKey_L2 | vynx-treasury-prod | us-west-2 | `infra/box3/kms.tf` | `alias/vynx-keeper-l2` | `cmd/keeper` (batchCompensate on L2) |

> **Note on the Signer key alias.** The `.env.example` value `VYNX_SIGNER_KMS_KEY_ID=alias/vynx-signer-voucher` is the binary-facing alias (what the Signer reads at startup), while `infra/box1/iam.tf:83` scopes IAM to `alias/vynx-signer`. Both alias names point at the same physical key.

**Pre-mainnet check.** `infra/box2/kms.tf` declares EXACTLY two `aws_kms_key` resources. A `for_each` or merged-key shortcut would defeat Invariant 3 by collapsing two independent risk surfaces into one — the file leads with this warning.

---

## 5. Fargate Task Definitions

`deployments/fargate/*.task.json` is the source of truth for Fargate runtime configuration. The Terraform `aws_ecs_task_definition` resources mirror these JSONs.

### `relayer-signer.task.json` (Box 1)

- Task family `relayer-signer`, 512 CPU, 1024 MB memory.
- `ephemeralStorage.sizeInGiB = 5` — used for the UDS socket shared volume.
- Single named volume `vynx-socket-vol` mounted at `/run/vynx` in both containers (`readOnly: false`).
- Two containers:

  | Field | relayer | signer |
  |---|---|---|
  | image | `vynx/relayer:latest` | `vynx/signer:latest` |
  | cpu / memory | 384 / 768 | 128 / 256 |
  | `readonlyRootFilesystem` | false | **true** |
  | `linuxParameters.initProcessEnabled` | true | true |
  | `secrets` | `[]` (empty — Invariant 3) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (from Secrets Manager) |
  | port mappings | 443/tcp | none |
  | log group | `/vynx/relayer` | `/vynx/signer` |

  The relayer's `secrets: []` is the wire-level enforcement of Invariant 3: AWS credentials are scoped at container level, not at task level, so the relayer process has no environment-supplied path to KMS credentials.

**Relayer boot-time gatekeeper hydration.** Before accepting traffic, the relayer calls `reputation.Manager.HydrateGatekeeper(ctx)` with a 30-second timeout (`cmd/relayer/main.go`). This method reads all `solver_health` rows where `total_collateral > 0` and emits `DeltaCollateralDeposit` deltas into the gatekeeper's RAM cache. Without this hydration step, the cache starts empty and every bid is rejected as `ErrSHFBelowThreshold`. The ALB health check (`GET /healthz`, `healthy_threshold = 2`) provides an additional gate: the relayer only registers as healthy after hydration completes, so the ALB does not route live traffic to a cold-cache container.

### `watchdog.task.json` (Box 2)

- 512 CPU / 1024 MB memory, one container.
- `readonlyRootFilesystem: true`, `initProcessEnabled: true`.
- No port mappings — the watchdog initiates all connections (mTLS client, Redis client, RPC client) and serves none.
- Log group `/vynx/watchdog`.

### `keeper.task.json` (Box 3)

Defined in `infra/box3/ecs.tf` as `aws_ecs_task_definition.keeper`:
- 256 CPU / 512 MB memory; environment block injects `KEEPER_LOCK_TABLE`, `KEEPER_EPOCHS_TABLE`, `KMS_KEY_ID_BRIDGE_L2`, `AWS_REGION`.
- Log group `/vynx/keeper` with `retention_in_days = 90`.
- Launched by EventBridge target (`infra/box3/eventbridge.tf`); never long-running.

---

## 6. Data Layer

### PostgreSQL — Box 1 (`infra/box1/data/rds.tf`)

- `aws_db_instance.vynx`: engine `postgres` 16, `db.t3.medium`, 20 GB gp3, `storage_encrypted = true`, `multi_az = true`, `deletion_protection = true`, `publicly_accessible = false`.
- DB name `vynx`, master user `vynx_admin`. Final-snapshot identifier `vynx-postgres-final`.

### Two SQL roles (`infra/box1/data/rds_init.sql`)

This script is **not** run by Terraform; it is applied manually as `vynx_admin` after RDS provisioning.

- `vynx_relayer` — `GRANT ALL PRIVILEGES ON SCHEMA public TO vynx_relayer` — used by `cmd/relayer`.
- `vynx_signer` — `GRANT SELECT (id, solver_address, status) ON public.intents` — only three columns, only on the intents table. Used by `cmd/signer`.

### Connection pool tuning (`internal/shared/db/pool.go`)

- `MaxConns = 10` for relayer, `5` for signer, `MinConns = 2` for both.
- `statement_timeout` and `lock_timeout` are injected as session-level `RuntimeParams` so they apply to every statement on every connection. The mainnet checklist verifies `statement_timeout = 5000ms` and `lock_timeout = 2000ms`.
- No raw `pgxpool.New` or `pgx.Connect` outside `internal/shared/db/pool.go`; `check-invariants` enforces this.

### Redis — Box 2 (`infra/box2/data/redis.tf`)

- `aws_elasticache_replication_group.vynx`, Redis 7.2, `cache.t3.medium`, single cache cluster.
- `at_rest_encryption_enabled = true`, `transit_encryption_enabled = true`.
- Custom parameter group `vynx_aof`:
  - `appendonly = yes`
  - `appendfsync = everysec`
- Both parameters are mandatory. `chain:{chainId}:latest_safe_ts` is the authoritative protocol clock (Invariant 7); losing it on a restart stalls the deadline sweeper until the next block. AOF ensures durability across cache cluster restarts.

### DynamoDB — Box 3 (`infra/box3/dynamodb.tf`)

- `vynx-keeper-lock` — `billing_mode = "PAY_PER_REQUEST"`, hash key `lock_id` (string). TTL on `expires_at` (4 h, matching Fargate max runtime). Replaces `pg_try_advisory_lock`.
- `vynx-keeper-epochs` — pay-per-request, hash key `epoch_timestamp` (string). `point_in_time_recovery.enabled = true` — financial data.

---

## 7. WAF and ALB

### WAF v2 (`infra/box1/waf.tf`)

Three rules, scoped REGIONAL, default action `allow`.

| Priority | Name | Action | Purpose |
|---|---|---|---|
| 1 | `RateLimitPerIP` | block | 100 req / 5 min per IP — JSON flood and intent spam |
| 2 | `AWSManagedRulesCommonRuleSet` | (managed) | OWASP-adjacent payload filtering |
| 3 | `WSReconnectionStormLimit` | block | 10 WebSocket handshakes / 5 min per IP |

The WebSocket rule is rate-limited on **new handshakes**, not on long-lived connections. WAF evaluates HTTP requests; it cannot see persistent TCP frames. The scope-down statement matches `Upgrade: websocket` (lowercased), so the rule only fires on new Upgrade requests. A legitimate solver holding 50 long-lived WS connections is unaffected; an attacker reconnecting at 11+ handshakes per 5 min from one IP is blocked. The reasoning is documented inline in `waf.tf`.

A CloudWatch alarm `vynx-p1-waf-blocked-spike` fires at >1000 blocked req/min — early signal for a DDoS in progress.

### ALB (`infra/box1/alb.tf`)

- `aws_lb.relayer` — internet-facing, type `application`, fronted by `sg_public`.
- Access logs written to `vynx-alb-logs-{account-id}` S3 bucket with `prevent_destroy = true`.
- Target group `vynx-relayer-tg`: `target_type = "ip"` (Fargate awsvpc), `deregistration_delay = 30` (gives the 200 ms auctions room to settle during scale-in).
- Health check: HTTPS GET `/healthz`, `healthy_threshold = 2`, `unhealthy_threshold = 3`, `interval = 10s`, `timeout = 5s`, matcher 200.
- HTTPS listener on 443: `ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"` — TLS 1.3 enforced.

---

## 8. Observability Stack

### CloudWatch Log Groups

| Log group | Source | Region |
|---|---|---|
| `/vynx/relayer` | relayer container | us-east-1 |
| `/vynx/signer` | signer container | us-east-1 |
| `/vynx/keeper` | keeper container | us-west-2 |
| `/vynx/watchdog` | watchdog container | us-east-2 |

### Metric Filters (`infra/box1/metric_filters.tf`)

Eight `aws_cloudwatch_log_metric_filter` resources parse structured `event=` log fields and emit CloudWatch metrics:

- `base_rpc_quorum_lost`, `slash_execute_failed`, `emergency_pause`, `keeper_epoch_failed`,
- `slash_executed`, `refund_executed`, `auction_timeout`, `shf_below_threshold`.

### Alarms (`infra/box1/alarms.tf`)

Seven CloudWatch alarms in three severity tiers route to three SNS topics (`p0`, `p1`, `p2`), each subscribed to a PagerDuty integration:

| Tier | Alarm | Trigger |
|---|---|---|
| P0 | `vynx-p0-base-rpc-quorum-lost` | Base RPC quorum lost |
| P0 | `vynx-p0-slash-execute-failed` | `executeSlash` reverted |
| P1 | `vynx-p1-auction-p99-latency` | OFA window p99 latency breach |
| P1 | `vynx-p1-intent-timeout-rate` | timeout rate above threshold |
| P1 | `vynx-p1-keeper-epoch-missing` | weekly Keeper epoch did not run |
| P1 | `vynx-p1-waf-blocked-spike` | WAF blocking >1000 req/min |
| P2 | `vynx-p2-witness-latency-p90` | cross-chain payment witness latency |
| P2 | `vynx-p2-rpc-pool-degraded` | RPC pool transitioned to Degraded |

Additional Datadog DogStatsD metrics are emitted directly from the binaries (`internal/shared/metrics/metrics.go`); `make observe` validates that metric names in implementation match the dashboard.

### CloudTrail org trail (`infra/org/cloudtrail.tf`)

- `aws_cloudtrail.org` — multi-region, organization trail, log file validation enabled.
- S3 bucket `vynx-cloudtrail-org-{management_account}` with `prevent_destroy = true`.
- S3 bucket policy includes **Confused Deputy mitigation**: both the `GetBucketAcl` and `PutObject` statements require `aws:SourceArn = arn:aws:cloudtrail:us-east-1:{mgmt}:trail/vynx-org-trail`. Without this condition any CloudTrail in any account could read or write into the bucket by impersonating `cloudtrail.amazonaws.com`.

---

## 9. Apply Order

> **⚠️ Never run `terraform destroy` on `infra/org/`.**
> AWS account deletion requires contacting AWS Support. Terraform cannot delete AWS Organizations member accounts.

### First-time Production Deployment

#### Step 0 — Create AWS Organization (ONE TIME ONLY)

Requires management account root or admin credentials.

```bash
cd infra/org
terraform init
terraform apply -target=aws_organizations_organization.vynx
terraform apply
```

Record outputs:
- `core_account_id`     → Account ID for vynx-core-prod
- `sentinel_account_id` → Account ID for vynx-sentinel-prod
- `treasury_account_id` → Account ID for vynx-treasury-prod (Sprint 13)

#### Step 1 — Deploy Box 1 (vynx-core-prod, us-east-1)

```bash
cd infra/box1
terraform init
terraform apply \
  -var="core_account_id=<from step 0>"
```

Record outputs:
- `vpc_id`
- `vpc_cidr`
- `relayer_subnet_cidr`
- `vpc_peering_connection_id`

#### Step 2 — Deploy Box 2 (vynx-sentinel-prod, us-east-2)

```bash
cd infra/box2
terraform init
terraform apply \
  -var="sentinel_account_id=<from step 0>" \
  -var="box1_peering_connection_id=<from step 1>" \
  -var="box1_vpc_cidr=<from step 1>" \
  -var="box1_relayer_subnet_cidr=<from step 1>"
```

Record outputs:
- `vpc_id`
- `vpc_cidr`
- `watchdog_subnet_cidr`

#### Step 3 — Re-apply Box 1 to add VPC routes

The VPC Peering connection must be accepted by Box 2 before Box 1 can add routes. This step completes the private routing setup.

```bash
cd infra/box1
terraform apply \
  -var="core_account_id=<from step 0>" \
  -var="box2_vpc_id=<from step 2>" \
  -var="box2_vpc_cidr=<from step 2>" \
  -var="box2_watchdog_subnet_cidr=<from step 2>"
```

#### Step 4 — Deploy CloudTrail org trail

```bash
cd infra/org
terraform apply -target=aws_cloudtrail.org
```

#### Step 5 — Deploy Box 3 (vynx-treasury-prod, us-west-2)

```bash
cd infra/box3
terraform init
terraform apply \
  -var="treasury_account_id=<from step 0>" \
  -var="environment=production" \
  -var='keeper_subnet_ids=["<subnet-id>"]'
```

Record outputs:
- `bridge_l2_kms_key_arn`
- `keeper_lock_table`
- `keeper_epochs_table`
- `keeper_task_definition`

> ⚠️ Box 3 has NO network peering with Box 1 or Box 2. This is by design. The Keeper reaches Base L2 and Ethereum L1 via public RPC endpoints only. Any attempt to add VPC peering to Box 3 is a security violation.

#### Step 6 — Verify

1. AWS Console → VPC Peering Connections → Status: Active (Box 1 ↔ Box 2)
2. Send test traffic to verify WAF blocks at 100 req/5min per IP
3. Confirm CloudTrail logs appear in management account S3 bucket
4. Box 3: `aws dynamodb describe-table --table-name vynx-keeper-epochs` shows PITR enabled
5. Box 3: EventBridge rule `vynx-keeper-weekly` is `ENABLED`

### Subsequent applies (normal operations)

Box 1, Box 2, and Box 3 can be applied independently after initial setup. The org module is only touched for account-level or CloudTrail changes.

---

## See also

- [`docs/architecture.md`](architecture.md) — protocol design, invariants, trust model
- [`docs/relayer.md`](relayer.md) — relayer + signer runtime behaviour
- [`docs/watchdog.md`](watchdog.md) — watchdog runtime behaviour
- [`docs/keeper.md`](keeper.md) — keeper runtime behaviour
- [`docs/secrets_rotation.md`](secrets_rotation.md) — KMS / DB / mTLS / RPC rotation runbook
- [`docs/mainnet_checklist.md`](mainnet_checklist.md) — every infrastructure gate before mainnet
