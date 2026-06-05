# Error Handling — @vynx/sdk

Every error thrown by `executeSwap()` is an instance of `VynxError` with a stable
`code` field. Never match on the `message` string — it may change between
versions. (`getSwapStatus()` never throws; transient errors surface as the
`pending` state.)

```typescript
import { VynxError, VynxErrorCode } from '@vynx/sdk';

try {
  const receipt = await vynx.executeSwap(params);
} catch (err) {
  if (err instanceof VynxError) {
    switch (err.code) {
      case VynxErrorCode.ERR_SWAP_TIMEOUT:
        // Capital recovered — see err.context.refundTxHash
        break;
      case VynxErrorCode.ERR_REFUND_UNRECOVERABLE:
        // Emergency — see procedure below
        break;
    }
  }
}
```

## Error Reference

### 1xxx — Pre-execution (no side-effects)

These errors fire before anything is signed or submitted. Capital is never at
risk. Fix the input and retry immediately.

**`VYNX_1001_INSUFFICIENT_FUNDS`**
Agent USDC balance is lower than `amountUSD`.

**`VYNX_1002_BELOW_MINIMUM`**
`amountUSD` is below the protocol minimum of $50 (`50_000_000` atomic units).

**`VYNX_1003_UNKNOWN_TOKEN`**
`targetToken` is neither a recognized `TOKEN_REGISTRY` symbol nor a valid EVM
address for the `targetChainId`.

**`VYNX_1004_UNSUPPORTED_CHAIN`**
`targetChainId` is not in `1, 10, 137, 8453, 42161` (or the origin chain is not
`8453` / `84532`).

**`VYNX_1005_QUOTE_UNAVAILABLE`**
Both the primary (1inch) and fallback (Odos) quoters failed to return a price.
Options: use a different `targetToken`, or inject a custom `quoter` in
`VynxSdkConfig`.

---

### 2xxx — Execution failed, no capital at risk

These errors occur before any capital movement. Capital is never at risk.

**`VYNX_2001_NO_LIQUIDITY`**
No solver was matched within the polling window, or the intent failed pre-lock.
Transient — retry after 5–30 seconds. `err.context.internalCode` carries the
relayer reason: `no_bids`, `sla_timeout`, `deadline_expired`, or `relayer_halt`.
(`getSwapStatus()` reports `failed` with `retryable: true` for `no_bids` and
`sla_timeout`.)

**`VYNX_2002_SYSTEM_UNAVAILABLE`**
The relayer was unreachable, rejected the submission (e.g. an authorization that
fails its off-chain verification — `err.context.status` carries the HTTP
status), or the optional `maxExecutionTimeMs` bound elapsed. When the bound
elapses the SDK **aborts the in-flight settlement poller** (it stops polling and
fires no background refund). Retry with exponential backoff. Do **not** blindly
re-submit a call that timed out mid-flight — the solver may already have locked
the intent on-chain; check it with `getSwapStatus()` first. Capital is not
stranded: `refundIntent` stays permissionless once the on-chain deadline passes.

---

### 3xxx — Execution failed, capital recovered automatically

**`VYNX_3001_SWAP_TIMEOUT`**
The winning solver locked the escrow on-chain but did not settle within the
~15-minute deadline. The SDK automatically called `refundIntent()` and confirmed
the refund on-chain — your USDC has been returned.

```typescript
case VynxErrorCode.ERR_SWAP_TIMEOUT:
  console.log('Capital refunded at:', err.context.refundTxHash);
  console.log('Tracking ref:', err.context.trackingRef);
  break;
```

No further action needed.

> **Gas note (the one exception to gasless):** the automatic `refundIntent()` is
> the only transaction the SDK can ever send, and it is sent from the agent
> wallet — so this recovery path is the one operation that needs ETH. If the
> agent wallet holds none, the automatic refund fails into
> `ERR_REFUND_UNRECOVERABLE` below — but capital is still recoverable:
> `refundIntent` is **permissionless** after the deadline, so any funded wallet
> can execute it and the USDC always returns to the agent.

---

### 9xxx — Human intervention required

**`VYNX_9001_REFUND_UNRECOVERABLE`**
The SDK attempted `refundIntent()` the maximum number of times
(`PROTOCOL_CONSTANTS.REFUND_MAX_ATTEMPTS`) and every attempt failed. Capital may
still be locked in the settlement contract.

**Emergency procedure:**

1. Record `err.context.trackingRef` immediately.

2. Read the on-chain escrow state. The settlement `intents` mapping is a public
   getter returning `(agent, token, amount, solver, deadline, state)`:

   ```bash
   cast call <VYNX_SETTLEMENT_ADDRESS> \
     "intents(bytes32)(address,address,uint256,address,uint64,uint8)" \
     <trackingRef> \
     --rpc-url <BASE_RPC_URL>
   ```

   The final value is the `IntentState`:
   `1` = LOCKED (at risk) · `2` = REDEEMED (solver already won) · `3` = REFUNDED
   (already recovered) · `0` = UNKNOWN (never locked).

3. If state is `1` (LOCKED) and the `deadline` (5th value, a unix timestamp) has
   passed, call `refundIntent` manually — it is **permissionless** after deadline
   expiry, so anyone may pay the gas; funds always return to the agent wallet:

   ```bash
   cast send <VYNX_SETTLEMENT_ADDRESS> \
     "refundIntent(bytes32)" \
     <trackingRef> \
     --private-key <AGENT_PK> \
     --rpc-url <BASE_RPC_URL>
   ```

4. If the call reverts `DeadlineNotExpired`, the deadline has not yet passed — wait
   and retry. If it reverts `InvalidState`, the intent already left LOCKED (the
   solver redeemed, or it was already refunded) — your capital is not stuck.

5. Contact support at security@vynx.network with the `trackingRef` and the failed
   transaction hashes from `err.context`.

**`VYNX_9999_INTERNAL`**
Unexpected SDK error — e.g. a malformed relayer response, a misconfigured wallet
account (`walletClient` without an account), or a failure while signing the
EIP-3009 transfer authorization (the signer rejected the typed-data request;
`err.context.reason` carries the cause — a signing failure happens before
anything is submitted). Capital is not at risk. Open an issue with the full
error and `err.context`.

---

## VynxError Fields

```typescript
err.code        // VynxErrorCode — stable across versions
err.message     // human-readable — do NOT match on this
err.recoverable // boolean — true if a retry may succeed
err.context     // Record<string, unknown> — error-specific metadata
```

| Code | Context fields |
|---|---|
| `ERR_SWAP_TIMEOUT` | `trackingRef`, `refundTxHash` |
| `ERR_REFUND_UNRECOVERABLE` | `trackingRef` |
| `ERR_SWAP_NO_LIQUIDITY` | `internalCode` (`no_bids` \| `sla_timeout` \| `deadline_expired` \| `relayer_halt`) |
| `ERR_SWAP_SYSTEM_UNAVAILABLE` | `internalCode`, `reason` / `status` |
| `ERR_INSUFFICIENT_FUNDS` | `balance`, `required` |
| `ERR_BELOW_MINIMUM` | `amountUSD`, `minWei` |
| `ERR_UNKNOWN_TOKEN` | `tokenOrSymbol`, `chainId` |
| `ERR_UNSUPPORTED_CHAIN` | `chainId` / `targetChainId` |
