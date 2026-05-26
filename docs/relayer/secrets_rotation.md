# VynX — Secrets Rotation Runbook

**Audience:** A senior operator performing a secret rotation at 3 a.m. during an incident. Precision over brevity. Every command should be copy-pasteable; every prerequisite is spelled out; every step has an explicit rollback.

> KMS alias values, AWS regions, and account names below are verified against `infra/box1/iam.tf`, `infra/box2/kms.tf`, `infra/box3/kms.tf`, and `.env.example`. mTLS CN value is verified against `internal/relayer/api/mtls/handler.go:11`.

Eight rotation procedures. Each includes pre-rotation check, rotation steps, post-rotation check, and rollback. A final post-rotation verification checklist applies to all rotations.

---

## §1 — RelayerMasterKey (KMS, Box 1, vynx-core-prod)

**Binary:** `cmd/signer` (only consumer); `cmd/relayer` verifies the derived address at startup.
**KMS alias:** `alias/vynx-signer-voucher` (binary config, `.env.example:10`). IAM scope at `infra/box1/iam.tf:83` uses `alias/vynx-signer` — both names point at the same physical key; either alias can be the rotation target as long as both stay aligned.
**IAM role with kms:Sign:** `vynx-signer-role`.
**Env vars:** `VYNX_SIGNER_KMS_KEY_ID` (key ID), `RELAYER_SIGNER` (expected Ethereum address).
**Region:** `us-east-1`.

### Pre-rotation check
- Confirm no vouchers are in flight: search `/vynx/relayer` logs for active `"witness_sign"` operations.
- Note current alias target:
  ```bash
  aws kms describe-key --key-id alias/vynx-signer-voucher --region us-east-1
  ```
- Record current `RELAYER_SIGNER`:
  ```bash
  aws secretsmanager get-secret-value --secret-id vynx/production/relayer | jq -r '.SecretString | fromjson | .RELAYER_SIGNER'
  ```

### Rotation steps
1. Create the new key in us-east-1:
   ```bash
   aws kms create-key \
     --key-spec ECC_SECG_P256K1 \
     --key-usage SIGN_VERIFY \
     --description "VynX RelayerMasterKey rotated $(date +%Y-%m-%d)" \
     --region us-east-1
   # capture NEW_KEY_ID from the response
   ```
2. Re-point the alias:
   ```bash
   aws kms update-alias \
     --alias-name alias/vynx-signer-voucher \
     --target-key-id "$NEW_KEY_ID" \
     --region us-east-1
   ```
   (If your IAM policy uses `alias/vynx-signer`, repoint that alias as well.)
3. **Derive the new Ethereum address — probe-task pattern.** Deploy a one-shot ECS task with `RELAYER_SIGNER=0x0000000000000000000000000000000000000000`; the startup fatal in `cmd/signer/main.go` prints the derived address in the `kms_derived` field.
   ```bash
   aws ecs run-task \
     --cluster vynx-production-box1 \
     --task-definition relayer-signer \
     --overrides '{"containerOverrides":[{"name":"relayer","environment":[{"name":"RELAYER_SIGNER","value":"0x0000000000000000000000000000000000000000"}]}]}' \
     --count 1 --region us-east-1
   # wait ~30s, then:
   aws logs filter-log-events \
     --log-group /vynx/signer \
     --filter-pattern '"kms_derived"' \
     --region us-east-1
   ```
4. Update `RELAYER_SIGNER` in Secrets Manager with the derived address.
5. Force a Fargate redeploy:
   ```bash
   aws ecs update-service \
     --cluster vynx-production-box1 \
     --service vynx-relayer-signer \
     --force-new-deployment \
     --region us-east-1
   ```

### Post-rotation check
- `/vynx/signer` and `/vynx/relayer` logs show `"signer ready"` and `"relayer ready"` without `"FATAL: KMS key address mismatch"`.
- Submit a test intent (`POST /v1/intent`) and confirm HTTP 202 plus voucher issuance.

### Rollback
1. Re-point the alias to the previous key:
   ```bash
   aws kms update-alias --alias-name alias/vynx-signer-voucher --target-key-id <old-key-id> --region us-east-1
   ```
2. Revert `RELAYER_SIGNER` in Secrets Manager to the previous value.
3. `aws ecs update-service --force-new-deployment` again.
4. Do **not** schedule the old key for deletion until the rotation has been stable for 24 h.

---

## §2 — SlashingKey (KMS, Box 2, vynx-sentinel-prod)

**Binary:** `cmd/watchdog` (SlashExecutor).
**KMS alias:** `alias/vynx-watchdog-slashing` (`infra/box2/kms.tf:16`).
**IAM role:** `vynx-watchdog-role`.
**Env vars:** `KMS_KEY_ID_SLASHING`, `WATCHDOG_ADDRESS` (expected Ethereum address).
**Region:** `us-east-2`.
**Critical context:** `executeSlash` transactions are routed through Flashbots Protect; `slashExec.AssertFlashbots()` is a fatal at watchdog startup. The L1 chain ID of the SlashingKey is Ethereum (chain 1).

### Pre-rotation check
- Confirm the watchdog is not currently holding leadership or executing an active slash:
  ```bash
  redis-cli -h <vynx-redis> get lock:leader
  redis-cli -h <vynx-redis> zrange slash:pending 0 -1
  ```
- Confirm `FLASHBOTS_RPC_URL` is reachable from Box 2.
- Note current `WATCHDOG_ADDRESS`:
  ```bash
  aws secretsmanager get-secret-value --secret-id vynx/production/watchdog | jq -r '.SecretString | fromjson | .WATCHDOG_ADDRESS'
  ```

### Rotation steps
1. Create the new key in us-east-2:
   ```bash
   aws kms create-key \
     --key-spec ECC_SECG_P256K1 \
     --key-usage SIGN_VERIFY \
     --description "VynX SlashingKey rotated $(date +%Y-%m-%d)" \
     --region us-east-2
   ```
2. Re-point the alias:
   ```bash
   aws kms update-alias --alias-name alias/vynx-watchdog-slashing --target-key-id "$NEW_KEY_ID" --region us-east-2
   ```
3. Probe-task derive the new address (same pattern as §1, on the watchdog task with `WATCHDOG_ADDRESS=0x0`).
4. Update `WATCHDOG_ADDRESS` in Secrets Manager.
5. Redeploy the watchdog:
   ```bash
   aws ecs update-service --cluster vynx-production-box2 --service vynx-watchdog --force-new-deployment --region us-east-2
   ```

### Post-rotation check
- `/vynx/watchdog` shows `"watchdog ready"` with no address-mismatch fatal and no `"assertFlashbots"` failure.
- Trigger a test slash on testnet; confirm the transaction appears in Flashbots bundle history, not on Etherscan's public mempool.

### Rollback
1. Re-point `alias/vynx-watchdog-slashing` to the previous key.
2. Revert `WATCHDOG_ADDRESS` in Secrets Manager.
3. `aws ecs update-service --force-new-deployment`.

---

## §3 — RelayerAdminKey (KMS, Box 2, vynx-sentinel-prod)

**Binary:** `cmd/watchdog` (EmergencyPause executor).
**KMS alias:** `alias/vynx-watchdog-admin` (`infra/box2/kms.tf:32`).
**IAM role:** `vynx-watchdog-role` (shared with §2).
**Env var:** `KMS_KEY_ID_RELAYER_ADMIN`.
**Region:** `us-east-2`.
**Critical on-chain prerequisite:** `VynxAdmin.watchdog` on Base L2 must be updated to the new address **before** the old key is disabled. `VynxAdmin.pauseAll` and `VynxAdmin.setRelayerKey` are gated on the `watchdog` address slot. A multisig (3/4) transaction is required to update it.

### Pre-rotation check
- Confirm no active EmergencyPause is in progress (no recent `ProtocolPaused` event without a matching `ProtocolUnpaused`).
- Confirm `VynxAdmin.watchdog()` on-chain matches the current RelayerAdminKey address:
  ```bash
  cast call --rpc-url "$BASE_RPC_URL" "$VYNX_ADMIN_ADDRESS" "watchdog()(address)"
  ```
- Confirm the multisig signers can be assembled within the rotation window.

### Rotation steps
1. Create the new key in us-east-2 (same `create-key` command shape as §2).
2. Probe-task derive the new address.
3. **Submit the multisig transaction** to update `VynxAdmin.watchdog`. The Watchdog address is part of the `setContractAddresses` family (or whatever multisig wrapper is in use). Wait for confirmation on Base before continuing.
4. Re-point the alias:
   ```bash
   aws kms update-alias --alias-name alias/vynx-watchdog-admin --target-key-id "$NEW_KEY_ID" --region us-east-2
   ```
5. Update `KMS_KEY_ID_RELAYER_ADMIN` in Secrets Manager.
6. Redeploy the watchdog (`aws ecs update-service --force-new-deployment`).

### Post-rotation check
- `/vynx/watchdog` shows `"watchdog ready"` without fatal.
- On testnet: trigger a `pauseAll` and confirm `VynxAdmin` emits `ProtocolPaused`; then multisig `unpauseAll`.

### Rollback
1. Re-point `alias/vynx-watchdog-admin` to the previous key.
2. Submit a multisig transaction to revert `VynxAdmin.watchdog` to the previous address.
3. Redeploy the watchdog.

---

## §4 — BridgeKey_L2 (KMS, Box 3, vynx-treasury-prod)

> **⚠️ This key lives in Box 3 (us-west-2, vynx-treasury-prod) — NOT Box 1.** All commands below use `--region us-west-2 --profile vynx-treasury-prod`. The pre-Sprint-13 procedure used a PostgreSQL advisory lock; that no longer exists. Replace any `pg_locks` query with the DynamoDB check below.

**Binary:** `cmd/keeper` (EventBridge Scheduled Task — not a long-running service).
**KMS alias:** `alias/vynx-keeper-l2` (`infra/box3/kms.tf:18`).
**IAM role:** `vynx-keeper-role` in vynx-treasury-prod (`infra/box3/iam.tf`).
**Env vars:** `KMS_KEY_ID_BRIDGE_L2`, `KEEPER_ADDRESS`.
**Region:** `us-west-2`.
**Critical on-chain prerequisite:** `VynxTreasury.keeper` on Base L2 must be updated to the new address before the old key is disabled. `batchCompensate` and `distributeRealYield` are gated on the `keeper` address.

### Pre-rotation check
- Confirm no keeper epoch is in progress. Inspect the lock row:
  ```bash
  aws dynamodb get-item \
    --table-name vynx-keeper-lock \
    --key '{"lock_id":{"S":"KEEPER_EPOCH_LOCK"}}' \
    --region us-west-2 --profile vynx-treasury-prod
  ```
  If the item exists and `expires_at` is in the future, wait or manually delete the row.
- Note current `KEEPER_ADDRESS`:
  ```bash
  aws secretsmanager get-secret-value --secret-id vynx/production/keeper --region us-west-2 --profile vynx-treasury-prod | jq -r '.SecretString | fromjson | .KEEPER_ADDRESS'
  ```

### Rotation steps
1. Create the new key in us-west-2:
   ```bash
   aws kms create-key \
     --key-spec ECC_SECG_P256K1 \
     --key-usage SIGN_VERIFY \
     --description "VynX BridgeKey_L2 rotated $(date +%Y-%m-%d)" \
     --region us-west-2 --profile vynx-treasury-prod
   ```
2. Re-point the alias:
   ```bash
   aws kms update-alias \
     --alias-name alias/vynx-keeper-l2 \
     --target-key-id "$NEW_KEY_ID" \
     --region us-west-2 --profile vynx-treasury-prod
   ```
3. Probe-task derive the new Ethereum address by running a one-shot keeper task with `KEEPER_ADDRESS=0x0`. The startup fatal logs `kms_derived`.
4. **Submit the on-chain transaction** to update `VynxTreasury.keeper` to the new address (multisig or admin path, per protocol governance). Wait for confirmation on Base.
5. Update `KEEPER_ADDRESS` in Box 3 Secrets Manager.
6. Register the new ECS task definition (the task definition embeds the alias ARN):
   ```bash
   aws ecs register-task-definition \
     --cli-input-json file://deployments/fargate/keeper.task.json \
     --region us-west-2 --profile vynx-treasury-prod
   ```
7. Update the EventBridge target to point at the new task definition revision:
   ```bash
   aws events put-targets \
     --rule vynx-keeper-weekly \
     --targets "Id=keeper,Arn=<cluster-arn>,RoleArn=<events-role-arn>,EcsParameters={TaskDefinitionArn=<new-task-def-arn>}" \
     --region us-west-2 --profile vynx-treasury-prod
   ```

### Post-rotation check
- Trigger a test run:
  ```bash
  aws ecs run-task \
    --cluster vynx-keeper \
    --task-definition <new-task-def> \
    --region us-west-2 --profile vynx-treasury-prod
  ```
- `/vynx/keeper` shows `"keeper shutdown complete"` with no address-mismatch fatal.
- `cast call --rpc-url "$BASE_RPC_URL" "$VYNX_TREASURY_ADDRESS" "keeper()(address)"` returns the new address.

### Rollback
1. Re-point `alias/vynx-keeper-l2` to the previous key (us-west-2, vynx-treasury-prod profile).
2. Submit an on-chain transaction to revert `VynxTreasury.keeper` to the previous address.
3. Re-register the previous task definition; update the EventBridge target back.

---

## §5 — PostgreSQL Passwords

**DB users** (from `infra/box1/data/rds_init.sql`):
- `vynx_relayer` — `GRANT ALL PRIVILEGES ON SCHEMA public` — env var `VYNX_RELAYER_DB_DSN` — used by `cmd/relayer`.
- `vynx_signer` — `GRANT SELECT (id, solver_address, status) ON public.intents` — env var `VYNX_SIGNER_DB_DSN` — used by `cmd/signer`.
There is no `VYNX_KEEPER_DB_DSN` env var.

### Pre-rotation check
- Confirm RDS is `available`:
  ```bash
  aws rds describe-db-instances --query 'DBInstances[*].DBInstanceStatus' --region us-east-1
  ```
- Save current DSN values from both secrets:
  ```bash
  aws secretsmanager get-secret-value --secret-id vynx/production/relayer | jq -r '.SecretString | fromjson | .VYNX_RELAYER_DB_DSN'
  aws secretsmanager get-secret-value --secret-id vynx/production/signer  | jq -r '.SecretString | fromjson | .VYNX_SIGNER_DB_DSN'
  ```

### Rotation steps (per active user)
1. Generate a new password:
   ```bash
   NEW_PASS=$(aws secretsmanager get-random-password --password-length 32 --exclude-punctuation --query RandomPassword --output text)
   ```
2. Update the password in RDS (as `vynx_admin`):
   ```sql
   ALTER USER vynx_relayer PASSWORD '<new-pass>';
   ALTER USER vynx_signer  PASSWORD '<new-pass>';
   ```
3. Update Secrets Manager:
   ```bash
   # vynx_relayer
   aws secretsmanager update-secret \
     --secret-id vynx/production/relayer \
     --secret-string "{\"VYNX_RELAYER_DB_DSN\":\"postgres://vynx_relayer:${NEW_PASS_RELAYER}@<host>:5432/vynx?sslmode=require\", ...}"
   # vynx_signer
   aws secretsmanager update-secret \
     --secret-id vynx/production/signer \
     --secret-string "{\"VYNX_SIGNER_DB_DSN\":\"postgres://vynx_signer:${NEW_PASS_SIGNER}@<host>:5432/vynx?sslmode=require\", ...}"
   ```
4. Redeploy the relayer-signer task:
   ```bash
   aws ecs update-service --cluster vynx-production-box1 --service vynx-relayer-signer --force-new-deployment --region us-east-1
   ```

### Post-rotation check
- ECS tasks reach RUNNING with no `"db pool"` fatal lines in `/vynx/relayer` or `/vynx/signer`.
- Submit a test intent — HTTP 202 — confirm the row appears in PostgreSQL.

### Rollback
- Revert the Secrets Manager DSN to the previous string; `aws ecs update-service --force-new-deployment`.

---

## §6 — RPC API Keys (Alchemy)

**Env vars** (from `.env.example`): `BASE_RPC_URL`, `ETH_RPC_URL`, `ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`, `POLYGON_RPC_URL`.
**Affected binaries:** `cmd/relayer` and `cmd/watchdog` use all five RPC URLs. `cmd/keeper` uses `BASE_RPC_URL` and `ETH_RPC_URL` but is a one-shot task that reads fresh secrets on each EventBridge invocation.

### Pre-rotation check
- Confirm `vynx.rpc.pool_state = 0` (Healthy) in Datadog for both relayer and watchdog before rotating.

### Rotation steps
1. In the Alchemy dashboard, create a new app for each network and record the new WebSocket URLs.
2. Update Secrets Manager atomically:
   ```bash
   aws secretsmanager update-secret \
     --secret-id vynx/production/rpc \
     --secret-string '{
       "BASE_RPC_URL": "wss://base-mainnet.g.alchemy.com/v2/<new-key>",
       "ETH_RPC_URL":  "wss://eth-mainnet.g.alchemy.com/v2/<new-key>",
       "ARBITRUM_RPC_URL": "wss://arb-mainnet.g.alchemy.com/v2/<new-key>",
       "OPTIMISM_RPC_URL": "wss://opt-mainnet.g.alchemy.com/v2/<new-key>",
       "POLYGON_RPC_URL":  "wss://polygon-mainnet.g.alchemy.com/v2/<new-key>"
     }' \
     --region us-east-1
   ```
3. Rolling restart Box 1, then Box 2 (Box 3 picks up secrets on next EventBridge invocation):
   ```bash
   aws ecs update-service --cluster vynx-production-box1 --service vynx-relayer-signer --force-new-deployment --region us-east-1
   aws ecs update-service --cluster vynx-production-box2 --service vynx-watchdog        --force-new-deployment --region us-east-2
   ```

### Post-rotation check
- `vynx.rpc.pool_state = 0` in Datadog within ~2 min of restart for both services.
- Redis `GET chain:8453:latest_safe_ts` and `GET chain:1:latest_safe_ts` are advancing.

### Rollback
- Revert `vynx/production/rpc` in Secrets Manager; rolling restart both services.

---

## §7 — mTLS Certificates

**Two certificate pairs**, both signed by the same internal CA:

- **Relayer server cert** — `MTLS_SERVER_CERT_PATH`, `MTLS_SERVER_KEY_PATH`. CN = the relayer's internal hostname (e.g. `relayer.vynx.internal`).
- **Watchdog client cert** — `MTLS_CLIENT_CERT_PATH`, `MTLS_CLIENT_KEY_PATH`. **CN must be exactly `watchdog.vynx.internal`.** This CN is hardcoded in `internal/relayer/api/mtls/handler.go:11` as `const watchdogCN = "watchdog.vynx.internal"`. Any client cert with a different CN receives HTTP 403.
- **Shared CA cert** — `MTLS_CA_CERT_PATH`, mounted by both relayer and watchdog.

The watchdog connects to `RELAYER_INTERNAL_ENDPOINT` (default `https://relayer.internal:8443`).

### Pre-rotation check
- Current cert expiry:
  ```bash
  openssl x509 -enddate -noout -in <cert-path>
  ```
- Confirm a production CA is available — demo certs are self-signed and must not be used in production.

### Rotation steps
```bash
# 1. New CA-signed server cert (Relayer)
openssl genrsa -out relayer-new.key 2048
openssl req -new -key relayer-new.key -out relayer-new.csr -subj "/CN=relayer.vynx.internal"
openssl x509 -req -in relayer-new.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out relayer-new.crt -days 365 \
  -extfile <(printf "subjectAltName=DNS:relayer.vynx.internal")

# 2. New CA-signed client cert (Watchdog). CN MUST be "watchdog.vynx.internal".
openssl genrsa -out watchdog-new.key 2048
openssl req -new -key watchdog-new.key -out watchdog-new.csr -subj "/CN=watchdog.vynx.internal"
openssl x509 -req -in watchdog-new.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out watchdog-new.crt -days 365

# 3. Push to Secrets Manager (update existing secrets)
aws secretsmanager update-secret --secret-id vynx/production/mtls-server-cert --secret-string "$(cat relayer-new.crt)"
aws secretsmanager update-secret --secret-id vynx/production/mtls-server-key  --secret-string "$(cat relayer-new.key)"
aws secretsmanager update-secret --secret-id vynx/production/mtls-client-cert --secret-string "$(cat watchdog-new.crt)"
aws secretsmanager update-secret --secret-id vynx/production/mtls-client-key  --secret-string "$(cat watchdog-new.key)"

# 4. Redeploy both services
aws ecs update-service --cluster vynx-production-box1 --service vynx-relayer-signer --force-new-deployment --region us-east-1
aws ecs update-service --cluster vynx-production-box2 --service vynx-watchdog        --force-new-deployment --region us-east-2
```

### Post-rotation check
- `/vynx/relayer` shows G9-mtls-server starting with no TLS error.
- mTLS handshake from a watchdog-side bastion or container:
  ```bash
  curl --cert watchdog-new.crt --key watchdog-new.key --cacert ca.crt \
    https://relayer.internal:8443/internal/witness/verified/0x0000000000000000000000000000000000000000000000000000000000000000
  # Expected: HTTP 200, {"verified": false}. The TLS handshake succeeding is the goal.
  ```
- `/vynx/watchdog` shows fraud verifier requests succeeding (no TLS error).

### Rollback
- Revert the four Secrets Manager values to the previous PEM contents; redeploy both services.

---

## §8 — PagerDuty Integration Key

**Env var:** `PAGERDUTY_INTEGRATION_KEY`.
**Flow:** CloudWatch alarm → SNS topic (`p0`, `p1`, `p2`) → HTTPS endpoint → PagerDuty service.

### Pre-rotation check
- Confirm the existing integration is receiving alerts by inspecting recent VynX incidents in PagerDuty.

### Rotation steps
1. Create a new integration on the VynX PagerDuty service and record the new integration key.
2. Update Secrets Manager:
   ```bash
   aws secretsmanager update-secret \
     --secret-id vynx/production/pagerduty \
     --secret-string "{\"PAGERDUTY_INTEGRATION_KEY\":\"<new-key>\"}"
   ```
3. Update SNS → PagerDuty HTTPS subscriptions:
   ```bash
   # Subscribe new endpoint
   aws sns subscribe \
     --topic-arn <vynx-alerts-topic-arn> \
     --protocol https \
     --notification-endpoint "https://events.pagerduty.com/integration/<new-key>/enqueue"

   # Find and unsubscribe the old subscription
   aws sns list-subscriptions-by-topic --topic-arn <vynx-alerts-topic-arn>
   aws sns unsubscribe --subscription-arn <old-subscription-arn>
   ```

### Post-rotation check
- Trigger a test alarm:
  ```bash
  aws cloudwatch set-alarm-state --alarm-name vynx-p2-test --state-value ALARM --state-reason "rotation test"
  ```
  Confirm a PagerDuty incident lands on the new integration. Resolve it, then restore the alarm:
  ```bash
  aws cloudwatch set-alarm-state --alarm-name vynx-p2-test --state-value OK --state-reason "rotation test complete"
  ```

### Rollback
- Re-subscribe the old integration key to the SNS topic; remove the new subscription.

---

## Post-Rotation Verification Checklist

```
[ ] make build-all passes (verifies the binary still compiles with any config changes)
    CGO_ENABLED=0 make build-all

[ ] All ECS tasks in RUNNING state
    aws ecs list-tasks --cluster vynx-production-box1 --region us-east-1
    aws ecs list-tasks --cluster vynx-production-box2 --region us-east-2

[ ] Healthz endpoints return HTTP 200
    curl http://<relayer-host>:8080/healthz
    curl http://<watchdog-host>:8080/healthz

[ ] No FATAL log lines in the last 5 minutes for any affected binary
    aws logs filter-log-events --log-group /vynx/relayer  --filter-pattern FATAL --start-time <5min-ago-ms> --region us-east-1
    aws logs filter-log-events --log-group /vynx/signer   --filter-pattern FATAL --start-time <5min-ago-ms> --region us-east-1
    aws logs filter-log-events --log-group /vynx/watchdog --filter-pattern FATAL --start-time <5min-ago-ms> --region us-east-2

[ ] KMS address verification passed (no "kms_derived" mismatch in startup logs)

[ ] vynx.rpc.pool_state = 0 in Datadog for both relayer and watchdog

[ ] Submit a test intent and confirm HTTP 202
    curl -s -o /dev/null -w "%{http_code}" \
      -X POST -H "Content-Type: application/json" \
      -d '{"intentId":"0x...","agent":"0x...","token":"0x...","inputAmount":"50000000","minOutputAmount":"49500000","destinationChainId":8453,"deadline":<+900s>,"nonce":1,"signature":"0x..."}' \
      http://<relayer-host>:8080/v1/intent
    # Expected: 202

[ ] Redis chain clocks advancing
    redis-cli get chain:8453:latest_safe_ts   # Base
    redis-cli get chain:1:latest_safe_ts      # Ethereum

[ ] PagerDuty test alert received and resolved (see §8)

[ ] No unexpected P0/P1 PagerDuty alerts triggered during the rotation window
```

---

## Rollback Procedure

**General KMS principle.** Re-point the alias to the previous key ID. Do **not** schedule the old key for deletion until the rotation is stable for 24 h. Terraform sets `deletion_window_in_days = 30` for all KMS keys (`infra/box2/kms.tf`, `infra/box3/kms.tf`); when the time comes to delete the old key:

```bash
aws kms schedule-key-deletion --key-id <old-key-id> --pending-window-in-days 30 --region <key-region>
```

**KMS key rollback (applies to §1–§4):**

1. `aws kms update-alias --alias-name <alias> --target-key-id <old-key-id> --region <region>`
2. Revert the affected env var (`RELAYER_SIGNER`, `WATCHDOG_ADDRESS`, or `KEEPER_ADDRESS`) in Secrets Manager.
3. For §3 (RelayerAdminKey): submit a multisig transaction to revert `VynxAdmin.watchdog` on-chain.
4. For §4 (BridgeKey_L2): submit an on-chain transaction to revert `VynxTreasury.keeper`.
5. Redeploy the affected service(s): `aws ecs update-service --force-new-deployment`.

**PostgreSQL rollback (§5):**
- Revert the Secrets Manager DSN to the previous value; redeploy `vynx-relayer-signer`.

**RPC rollback (§6):**
- Revert `vynx/production/rpc` to the previous URLs; rolling restart Box 1 then Box 2.

**mTLS rollback (§7):**
- Revert the four Secrets Manager cert/key entries to the previous PEM values; redeploy Box 1 and Box 2.

**PagerDuty rollback (§8):**
- Re-subscribe the old integration key to the SNS topic; remove the new subscription.

---

## See also

- [`docs/infrastructure.md`](infrastructure.md) — KMS inventory, IAM roles, ECS clusters per box
- [`docs/relayer.md`](relayer.md) — KMS address verification at startup, signer UDS server, mTLS server
- [`docs/watchdog.md`](watchdog.md) — Flashbots assertion at startup, mTLS fraud verifier
- [`docs/keeper.md`](keeper.md) — DynamoDB epoch lock, Box 3 isolation, EventBridge cron
- [`docs/mainnet_checklist.md`](mainnet_checklist.md) — every pre-deployment gate
