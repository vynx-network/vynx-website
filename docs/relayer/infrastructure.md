# Infrastructure

> How VynX deploys on AWS. Derived from `infra/**/*.tf` and
> `deployments/fargate/*.task.json`. If Terraform says X and this doc says Y,
> **Terraform wins**. No Kubernetes — Fargate only.

---

## 1. Three boxes, three AWS accounts

VynX runs in three separate AWS accounts under AWS Organizations. A full IAM
compromise of one box grants **zero** API access to another's KMS keys.

| Box | Account / Region | Services | KMS | Data store |
|---|---|---|---|---|
| **Box 1** | `vynx-core-prod` / us-east-1 | Relayer + Signer (one Fargate task), ALB, WAF | RelayerMasterKey (`alias/vynx-signer`) | RDS PostgreSQL |
| **Box 2** | `vynx-sentinel-prod` / us-east-2 | Watchdog (ECS service) | **SlashingKey + RelayerAdminKey** | ElastiCache Redis |
| **Box 3** | `vynx-treasury-prod` / us-west-2 | Keeper (Fargate Scheduled Task) | BridgeKey_L2 | DynamoDB |

Terraform layout: `infra/box1`, `infra/box2`, `infra/box3`, `infra/shared`,
`infra/org` (CloudTrail org trail). The `terraform-plan` skill pre-flight asserts
**box2 declares exactly two `aws_kms_key` resources**.

---

## 2. KMS keys and Invariant 3

All keys are `ECC_SECG_P256K1`, `SIGN_VERIFY`, `enable_key_rotation = false`
(asymmetric keys are rotated manually — see [`secrets_rotation.md`](secrets_rotation.md)).

| Key | Box | Declared | Used for |
|---|---|---|---|
| SlashingKey | 2 | `infra/box2/kms.tf` (`slashing`) | `executeSlash` on VynxRegistry (L1) |
| RelayerAdminKey | 2 | `infra/box2/kms.tf` (`relayer_admin`) | `pauseAll` / `setRelayerKey` on VynxAdmin (L2) |
| BridgeKey_L2 | 3 | `infra/box3/kms.tf` (`bridge_l2`) | `batchCompensate` / `distributeRealYield` (L2) |
| RelayerMasterKey | 1 | referenced via `alias/vynx-signer` | EIP-712 voucher signing (Signer) |

> `box2/kms.tf` carries a load-bearing comment: *"EXACTLY TWO separate aws_kms_key
> resources. Do NOT merge into a single key or use for_each."*

**Invariant 3 (`infra/box1/iam.tf`):** the `vynx-relayer-task-role` policy grants
**only** `logs:CreateLogStream` + `logs:PutLogEvents` — *zero* KMS. A separate
`vynx-signer-role` grants `kms:Sign` scoped to `alias/vynx-signer` **only**, plus
`secretsmanager:GetSecretValue` for the signer's key-id/secret. KMS credentials reach
the Signer container as **container secrets**, never the task level or the Relayer.

---

## 3. The Relayer/Signer sidecar (`deployments/`)

`deployments/fargate/relayer-signer.task.json` defines **one task** with both
containers; `keeper.task.json` and `watchdog.task.json` are separate. Dockerfiles:
`Dockerfile.{relayer,signer,watchdog,keeper}` — distroless (no shell).

- **Shared ephemeral volume** carries the UDS socket between the two containers.
- **UID/GID segregation:** Signer runs `2000:2000` and owns the socket; Relayer runs
  `1000:2000` (same gid → `0660` group-write, but it cannot unlink the socket).
- **Invariant 9:** the Signer `chmod`s the socket `0660` immediately after
  `net.Listen` (see [`signer.md`](signer.md)).
- `readonlyRootFilesystem: true` on Signer and Watchdog; `initProcessEnabled: true`
  (PID-namespace isolation) on all containers.

---

## 4. Network

- **VPC peering Box 1 ↔ Box 2** over the AWS Global Backbone — mTLS traffic from the
  Watchdog to the Relayer never traverses the public internet.
- **mTLS** (`internal/relayer/api/mtls/handler.go`): the Relayer serves `:8443`; the
  client certificate **CN must be `watchdog.vynx.internal`** or the request is `403`.
- **WAF v2** on the Box 1 ALB: per-IP rate limit (100 req/5min),
  `AWSManagedRulesCommonRuleSet`, and a WebSocket reconnection-storm limit
  (10 handshakes/5min per IP).
- **CloudTrail** org trail aggregates both accounts' audit logs into the management
  account S3 with a Confused-Deputy mitigation (`aws:SourceArn` condition).
- Box 3 has **no network path** to Box 1 or Box 2; the Keeper reaches RPC over the
  public internet.

---

## 5. Data stores

| Store | Box | Notes |
|---|---|---|
| RDS PostgreSQL 16 (Multi-AZ) | 1 | Relayer + Signer audit/state. `statement_timeout=5000ms`, `lock_timeout=2000ms` as session RuntimeParams. |
| ElastiCache Redis 7.2 | 2 | Watchdog state + chain clock. AOF persistence (`appendonly yes`, `appendfsync everysec`). |
| DynamoDB | 3 | `vynx-keeper-lock` (epoch fencing) + `vynx-keeper-epochs` (PITR). |

---

## 6. Keeper scheduling (Box 3)

`infra/box3/eventbridge.tf` schedules the Keeper Fargate task weekly
(`cron(0 0 ? * SUN *)`). The DynamoDB epoch lock guards against double-fire; the task
exits 0 if a prior epoch still holds the lock (see [`keeper.md`](keeper.md)).

---

## 7. Known gaps

- **`TVL_CAP_USDC` is mandatory at Relayer boot** (`mustU64Env`) in every
  environment. The `make e2e-local` harness now injects it via `Env()`
  (`e2e/harness/harness.go`), so the former "must be ambient" e2e gap is closed; a
  standalone relayer outside the harness still needs it set explicitly.
- **RelayerMasterKey** is referenced by `alias/vynx-signer` in Box 1 IAM but is not
  declared as an `aws_kms_key` resource in `infra/box1` (no `box1/kms.tf`) — the key
  is provisioned out-of-band. Confirm before mainnet (see [`mainnet_checklist.md`](mainnet_checklist.md)).

See also: [`architecture.md`](architecture.md), [`secrets_rotation.md`](secrets_rotation.md),
[`watchdog.md`](watchdog.md), [`keeper.md`](keeper.md).
