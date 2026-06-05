# Signer — `cmd/signer`

> Box 1 (us-east-1), co-located in the **same Fargate task** as the Relayer.
> A Unix-Domain-Socket (UDS) sidecar that holds the **RelayerMasterKey** in AWS
> KMS and is the *only* process with `kms:Sign` for voucher issuance. The Relayer
> talks to it over a local socket and never sees the key.

The Signer exists to satisfy **Invariant 3**: the Relayer's Fargate task role has
zero `kms:Sign` permission. KMS credentials are injected as container secrets into
the Signer container only. The Relayer obtains EIP-712 voucher signatures by
sending a request over the UDS; the private key never crosses a process boundary.

---

## 1. Governing invariants

| # | Invariant | Where |
|---|---|---|
| **2** | The Voucher EIP-712 hash signs only `(intentId, solver, amount)`. `destTxHash` and `issuedAt` are off-chain metadata, attached *after* signing, and never hashed. | `internal/signer/eip712.go:101` (`ComputeVoucherHash`) |
| **3** | The Relayer has zero `kms:Sign`; only this sidecar signs. | task-role / container-secret split (see `infrastructure.md`) |
| **9** | `os.Chmod(socketPath, 0660)` is the *immediate next call* after `net.Listen` — nothing between them. | `cmd/signer/main.go:57-68` |
| **10** | Native AWS SDK v2 KMS adapter; no `welthee` or any third-party signer. | `internal/shared/kms/` |

---

## 2. Boot sequence (`cmd/signer/main.go`)

1. Load AWS config; construct the KMS client for `VYNX_SIGNER_KMS_KEY_ID`
   (`vkms.NewClient`).
2. **Key-identity check (fail-fast):** derive the Ethereum address from the KMS
   public key and assert it equals `RELAYER_SIGNER`. A mismatch is fatal —
   *"wrong key configured for RELAYER_SIGNER"*. This prevents signing vouchers
   the settlement contract would reject.
3. Open the PostgreSQL validator on `VYNX_SIGNER_DB_DSN` (the scoped
   `vynx_signer` role — see §6).
4. Pre-compute the EIP-712 `DomainSeparator` from `VYNX_CHAIN_ID` and
   `VYNX_SETTLEMENT_ADDRESS` (immutable per deployment; cached for process life).
5. `net.Listen("unix", types.SocketPath)`.
6. **`os.Chmod(types.SocketPath, 0660)` — immediately (Invariant 9).** `0660`
   lets the Relayer (same Fargate task, same gid) connect while denying world
   access. `gosec G302` is suppressed here precisely because the invariant
   supersedes the default heuristic.
7. `server.Serve(ctx, ln)` — accept loop, one goroutine per connection.

---

## 3. UDS wire protocol

JSON `types.SignRequest` → `types.SignResponse` over the socket. Amounts are
transported as **decimal strings** to avoid JSON float precision loss.

| Request `Kind` | Behavior |
|---|---|
| `get_address` | Returns the KMS-derived Ethereum address. The Relayer calls this at startup to verify it is wired to the correct signer. No DB or KMS-sign call. |
| *(sign)* | The voucher-signing flow (§4). |

`SignResponse` carries exactly one of `Address`, `Signature`, or `Error`.

---

## 4. The sign flow (`internal/signer/server.go`)

Order matters; each guard precedes the next:

1. **Rate limit** — `golang.org/x/time/rate` at **50 rps, burst 10**, applied
   *before* any DB or KMS call. This shields the upstream KMS quota from a
   compromised or runaway Relayer.
2. **Idempotency short-circuit** — `GetCachedSignature`: if
   `issued_voucher_signature` is already set for this intent, return it without
   touching KMS. KMS is therefore invoked **at most once per intent**.
3. **`FOR SHARE` transaction** — `BeginValidation` opens a tx with
   `lock_timeout=2s` and runs `SELECT solver_address, status FROM intents
   WHERE id=$1 FOR SHARE`. It asserts `status == LOCKED` and the request solver
   matches the DB. The row lock is **held across the KMS call**, closing the
   TOCTOU window (no concurrent UPDATE can change state between validation and
   signing).
4. **Hash** — `ComputeVoucherHash(domainSep, intentID, solver, amount)`. Only the
   three on-chain fields participate (Invariant 2).
5. **Sign** — `kms.SignHash(digest)` while the `FOR SHARE` lock is held.
6. **Cache + commit** — `CacheSignature` writes the signature (idempotent: UPDATE
   only when the column is NULL), then `tx.Commit`. A cache-write failure is
   non-fatal — the signature is still valid.

---

## 5. Cryptographic hashing (`internal/signer/`)

The `internal/signer` package is the single source of truth for the protocol's
off-chain cryptography. **GASLESS REDESIGN: the relayer signs vouchers only —
it no longer signs intents.** The retired `INTENT_TYPEHASH` path
(`ComputeIntentHash`, `types.IntentTypeString`, the
`cmd/relayer/intent_signer_*.go` build files) is gone; agent intents are now
*verified*, not signed.

**Voucher signing (`eip712.go` — unchanged):**

- **`DomainSeparator(chainID, contract)`** — `EIP712Domain(string name,string
  version,uint256 chainId,address verifyingContract)` over `EIP712DomainName` /
  `EIP712DomainVersion`.
- **`ComputeVoucherHash(domainSep, intentID, solver, amount)`** — the 3-field
  voucher hash (Invariant 2). Adding a field would require changing this
  function's signature, which is the structural gate enforcing the invariant.
  `TestComputeVoucherHash_FieldCount` asserts the type string has exactly three
  fields.

**Agent-authorization verification (`intent_nonce.go` + `eip3009.go` — used by
intake F1, not by the UDS server):**

- **`ComputeIntentNonce(intent)`** — the EIP-3009 authorization nonce:
  `keccak256(abi.encode(INTENT_NONCE_DOMAIN_TAG, intentId, agent, token,
  inputAmount, outputToken, minOutputAmount, destinationChainId, deadline))`,
  byte-identical to the contract's `IntentNonceLib.computeNonce` and the SDK's
  `computeIntentNonce`. Schema source of truth: the design doc §D2.2
  (`vynx-settlement/docs/design/GASLESS-REDESIGN-CRYPTO-DESIGN.md`); the shared
  §D2.5 vector (`testdata/intent-nonce-vector.json`, vendored verbatim) pins
  all three implementations in CI.
- **`USDCDomainSeparator(chainID)`** — the **pinned** per-chain live USDC
  EIP-712 domain separator (read once from the deployed Circle contracts'
  `DOMAIN_SEPARATOR()`). Pinned because USDC's domain *name* differs per chain
  ("USD Coin" on Base mainnet 8453, "USDC" on Base Sepolia 84532) — a single
  hardcoded name would reject every signature on the other chain.
  `TestUSDCDomainSeparator_PerChainDerivation` re-derives each pinned value
  from its domain fields hermetically; the env-gated
  `TestUSDCDomainSeparator_MatchesLive` re-checks against the live contracts.
- **`ComputeReceiveAuthDigest(usdcSep, from, to, value, validBefore, nonce)`**
  — Circle's `ReceiveWithAuthorization` digest with `validAfter = 0` (protocol
  constant, §D4.3).
- **`RecoverAuthorizer(digest, sig)`** — 65-byte `r ‖ s ‖ v` recovery with
  Circle's strictness: `v ∈ {27, 28}` and low-`s` enforced (malleated
  signatures rejected at intake, not first at lock time).

All hashes use the EIP-191 `0x19 0x01` prefix over `domainSeparator ‖ structHash`.

---

## 6. Validator & database security (`internal/signer/validator.go`)

The Signer connects as the **`vynx_signer`** PostgreSQL role: `SELECT` plus a
narrowly-scoped `UPDATE` on `issued_voucher_signature` only.

- Pool defaults (`db.DefaultSignerPoolConfig`): `statement_timeout=5000ms`,
  `lock_timeout=2000ms`, max 5 connections.
- `issued_voucher_signature` is the **idempotency column**: 65 bytes, immutable
  once written. `CacheSignature` does `UPDATE … WHERE issued_voucher_signature
  IS NULL`, so concurrent writers converge to the first.
- Validation errors are explicit: `ErrIntentNotFound`, `ErrIntentNotLocked`,
  `ErrSolverMismatch`, `ErrCachedSignatureSize`.

---

## 7. The native KMS adapter (`internal/shared/kms`, Invariant 10)

`SignHash` returns a 65-byte `[R ‖ S ‖ V]` Ethereum signature. The adapter is
implemented natively on AWS SDK v2:

- Calls KMS `Sign` (ECDSA secp256k1), parses the **DER** output to `(r, s)`.
- Normalizes `s` to the lower half of the curve order (EIP-2 malleability).
- Brute-forces the recovery bit `V ∈ {0,1}` by recovering the public key and
  matching the known signer address.
- `Address()` derives the Ethereum address from the KMS public key — used for the
  boot-time identity check (§2) and the `get_address` handshake.

No third-party KMS library is imported anywhere (Invariant 10).

---

## 8. Process isolation

- **UID/GID segregation** (Fargate): the Signer runs UID `2000:2000` and owns the
  socket; the Relayer runs UID `1000:2000` — same gid for `0660` group-write, but
  it cannot unlink the socket. See `infrastructure.md`.
- `readonlyRootFilesystem: true`; distroless image (no shell).
- AWS credentials are scoped to the Signer container, never the task level or the
  Relayer container.

---

## 9. Configuration

| Env | Required | Meaning |
|---|---|---|
| `VYNX_SIGNER_KMS_KEY_ID` | yes | KMS key ID/alias for RelayerMasterKey. |
| `RELAYER_SIGNER` | yes | Expected signer address; boot asserts the KMS key derives to it. |
| `VYNX_SIGNER_DB_DSN` | yes | `vynx_signer`-role DSN. |
| `VYNX_CHAIN_ID` | yes | EIP-712 domain chain ID (8453 Base mainnet; 84532 Base Sepolia). |
| `VYNX_SETTLEMENT_ADDRESS` | yes | EIP-712 `verifyingContract`. |

The socket path is the compile-time constant `types.SocketPath`.

See also: [`relayer.md`](relayer.md), [`onchain_contracts.md`](onchain_contracts.md),
[`infrastructure.md`](infrastructure.md), [`secrets_rotation.md`](secrets_rotation.md).
