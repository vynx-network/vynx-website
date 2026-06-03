# Pre-Mainnet Checklist

**Protocol:** VynX Network v1.0.0
**Network:** Base Mainnet + Ethereum Mainnet
**Date:** ___________  **Signed by:** ___________

Every box must be checked, with evidence, before any mainnet deployment. The
authoritative gates are in `CLAUDE.md` §6; this checklist adds the deployment-specific
items and the **known follow-ups** that are not yet resolved.

---

## 1. Code gates (must be green)

- [ ] `go build ./...` and `go build -tags e2e ./...` — exit 0.
- [ ] `go vet ./...` and `go vet -tags e2e ./...` — exit 0.
- [ ] `golangci-lint run ./...` — zero findings.
- [ ] `go test -race ./...` — zero races, all pass.
- [ ] `check-invariants` skill — all **12** invariants clean, exit 0.
- [ ] `make e2e-local` — `happy_path`, `keeper_path`, `refund_clock_path` PASS.
      `slash_path` fails **only** on the documented HTTP-anvil `eth_subscribe` gap
      (confirm identical, not worse); slash is covered by the sibling `vynx-e2e`
      suite (`slash-path` + `slash-distribution`).

---

## 2. Infrastructure (`terraform-plan` then apply)

- [ ] `terraform plan` reviewed for `infra/box1`, `infra/box2`, `infra/box3`,
      `infra/shared`, `infra/org`.
- [ ] **`infra/box2` declares exactly two `aws_kms_key` resources** (SlashingKey +
      RelayerAdminKey) — the `terraform-plan` pre-flight asserts this.
- [ ] `vynx-relayer-task-role` has **zero** `kms:Sign` (Invariant 3); `kms:Sign` is
      scoped to `alias/vynx-signer` on the signer role only.
- [ ] `terraform apply` on all boxes against **production** variable files.
- [ ] VPC peering Box 1 ↔ Box 2 up; WAF v2 attached to the Box 1 ALB; CloudTrail org
      trail receiving from all accounts.

---

## 3. KMS & secrets

- [ ] All four keys exist (`alias/vynx-signer`, `alias/vynx-watchdog-slashing`,
      `alias/vynx-watchdog-admin`, `alias/vynx-keeper-l2`), `ECC_SECG_P256K1`.
- [ ] **RelayerMasterKey** is provisioned — it is referenced by `alias/vynx-signer` in
      Box 1 IAM but **not declared** as an `aws_kms_key` resource in `infra/box1`;
      confirm it exists out-of-band.
- [ ] Each binary's boot identity guard passes (KMS-derived address ==
      `RELAYER_SIGNER` / `WATCHDOG_ADDRESS` / `KEEPER_ADDRESS`).
- [ ] On-chain authority granted to each key's address (KEEPER_ROLE on VynxRegistry,
      relayerKey on VynxAdmin, keeper role on VynxTreasury).
- [ ] **Production mTLS certificates** — replace the self-signed demo certs with
      CA-issued certs (client CN `watchdog.vynx.internal`); run the rotation procedure
      in [`secrets_rotation.md`](secrets_rotation.md) for each secret.

---

## 4. Contracts & bindings

- [ ] Mainnet contract addresses filled into config (currently `0x0…0` placeholders
      in `.env.example`).
- [ ] **Binding drift resolved** — `bindings/abi/VynxRegistry.json` and
      `bindings/registry/vynx_registry.go` still carry the removed
      `InvalidSlashSignature` error. Re-extract via `make gen-bindings` against the
      deployed contracts and commit.
- [ ] Verify `executeSlash` takes one `SlashPayload` arg and `VOUCHER_TYPEHASH` is the
      3-field hash against the deployed ABIs (Invariants 1, 2).

---

## 5. Runtime config

- [ ] **`TVL_CAP_USDC`** set in every relayer environment (mandatory at boot).
- [ ] `WATCHED_CHAINS` set (or intentionally left as all-five default) for the
      Watchdog.
- [ ] `KEEPER_AGENT_COMPENSATION` confirmed **false** (the agent is paid 5% on-chain;
      `true` would double-pay).

---

## 6. Known follow-ups (track to closure)

- [ ] **W8 monotonic-clock hardening** — add a sanity clamp in `AdvanceOnce` so a
      single far-future RPC `block.timestamp` cannot pin the chain clock and trigger a
      refund flood. Mitigated today by finality depth + reliable RPC; not yet coded.
- [ ] **Sibling `vynx-e2e` reconciliation** — wiring W8 woke the deadline sweeper that
      the sibling suite deliberately kept dormant (low seed at `e2e.sh:653`); its
      multichain tests must be reconciled in the **e2e repo** (remove the low seed or
      adjust those deadlines). Not a relayer-repo change.
- [ ] `TODO(post-yellow-paper)` — swap the keeper's `ConstBpsReader` for an on-chain
      `agentCompensationBps()` getter once `VynxRegistry` exposes it.

See also: [`infrastructure.md`](infrastructure.md), [`secrets_rotation.md`](secrets_rotation.md),
[`watchdog.md`](watchdog.md), [`architecture.md`](architecture.md).
