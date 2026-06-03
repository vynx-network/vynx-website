# Secrets Rotation Runbook

> **Audience:** a senior operator rotating a key, possibly mid-incident. Precision
> over brevity. Key names and aliases are verified against `infra/box1/iam.tf`,
> `infra/box2/kms.tf`, `infra/box3/kms.tf`, and `.env.example`; the mTLS CN against
> `internal/relayer/api/mtls/handler.go`.

---

## 1. What can be rotated

| Secret | Box | Alias / path | Signs |
|---|---|---|---|
| RelayerMasterKey | 1 | `alias/vynx-signer` | EIP-712 vouchers (Signer) |
| SlashingKey | 2 | `alias/vynx-watchdog-slashing` | `executeSlash` (L1, KEEPER_ROLE) |
| RelayerAdminKey | 2 | `alias/vynx-watchdog-admin` | `pauseAll` / `setRelayerKey` (L2) |
| BridgeKey_L2 | 3 | `alias/vynx-keeper-l2` | `batchCompensate` / `distributeRealYield` (L2) |
| mTLS certs | 1/2 | `MTLS_*_PATH` | Watchdog↔Relayer (CN `watchdog.vynx.internal`) |

All four KMS keys are `ECC_SECG_P256K1` / `SIGN_VERIFY` with
`enable_key_rotation = false`. **AWS automatic rotation does not apply** — these are
asymmetric keys whose *derived Ethereum address* is an on-chain authority, so rotation
is a deliberate, multi-step procedure that also updates on-chain authorization.

---

## 2. The boot-time identity guard (why rotation is safe)

Every signing binary asserts, at startup, that the KMS-derived Ethereum address equals
the configured expected address, and **fails fast** on mismatch:

- Signer: `kmsClient.Address() == RELAYER_SIGNER` (else *"wrong key configured for
  RELAYER_SIGNER"*).
- Watchdog / Keeper: the analogous check against `WATCHDOG_ADDRESS` / `KEEPER_ADDRESS`.

So a half-finished rotation (new key, stale config, or vice-versa) cannot silently
sign with the wrong identity — the process refuses to start.

---

## 3. KMS key rotation — general procedure

A KMS key's address is an on-chain authority; you must rotate **both** the key and its
on-chain grant. Do it in this order to avoid a window where neither key is authorized.

1. **Create the new key** (`ECC_SECG_P256K1`, `SIGN_VERIFY`) in the same box account.
   Do **not** repoint the alias yet.
2. **Derive** the new key's Ethereum address (the binary's `get_address` path, or an
   offline derivation from the KMS public key).
3. **Grant on-chain authority** to the new address (§4 per key) — both old and new are
   now authorized.
4. **Repoint the alias** to the new key and update the expected-address config
   (`RELAYER_SIGNER` / `WATCHDOG_ADDRESS` / `KEEPER_ADDRESS`).
5. **Redeploy** the affected service; confirm the boot identity guard passes.
6. **Revoke** the old address's on-chain authority and schedule the old key for
   deletion (30-day window).

Rollback at any step before (6): repoint the alias back and redeploy — the old key is
still authorized until step (6).

---

## 4. Per-key on-chain authority

| Key | Grant new authority | Revoke old |
|---|---|---|
| **RelayerMasterKey** | `VynxAdmin.setRelayerKey(newAddr)` (emits `RelayerKeyRotated`; settlement now accepts vouchers from the new signer). | superseded by the new `relayerKey()`. |
| **SlashingKey** | `VynxRegistry.grantRole(KEEPER_ROLE, newAddr)`. | `VynxRegistry.revokeRole(KEEPER_ROLE, oldAddr)`. |
| **RelayerAdminKey** | Wire the new address as the VynxAdmin admin/watchdog authority. | revoke the old. |
| **BridgeKey_L2** | Grant the keeper role on `VynxTreasury` (`OnlyKeeperAllowed`) to the new address. | revoke the old. |

Governance-gated calls (`setRelayerKey`, role changes on the Admin proxy) go through
the protocol multisig (`MULTISIG_ADDRESS`).

---

## 5. mTLS certificate rotation

The Relayer's internal server (`:8443`) requires a client cert with CN
**`watchdog.vynx.internal`** (`403` otherwise). The demo ships **self-signed** certs;
production must replace them with certs from the production CA.

1. Issue a new CA-signed pair for the Watchdog client (CN unchanged:
   `watchdog.vynx.internal`) and, if rotating the CA, a new server pair for the Relayer.
2. Stage the new files at the `MTLS_SERVER_CERT_PATH` / `MTLS_SERVER_KEY_PATH` /
   `MTLS_CA_CERT_PATH` (Relayer) and `MTLS_CLIENT_CERT_PATH` / `MTLS_CLIENT_KEY_PATH`
   (Watchdog) locations.
3. Roll the Relayer first (it must trust the new CA before the Watchdog presents the
   new client cert), then the Watchdog.
4. Verify a Watchdog→Relayer fraud probe succeeds (the fraud path is **fail-closed** —
   a broken mTLS handshake triggers `EmergencyPause`, so validate before declaring done).

---

## 6. Post-rotation verification

- Boot identity guard passes for the rotated binary (no *"address mismatch"* fatal).
- A signing operation succeeds end-to-end (a voucher signs / a test slash or pause on
  testnet / a keeper dry-run on DynamoDB Local).
- The old key shows no `kms:Sign` invocations in CloudTrail after cutover.
- On-chain: the new address holds the expected role; the old address does not.

See also: [`infrastructure.md`](infrastructure.md), [`signer.md`](signer.md),
[`watchdog.md`](watchdog.md), [`mainnet_checklist.md`](mainnet_checklist.md).
