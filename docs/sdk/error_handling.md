# Error Handling — @vynx/sdk

All errors thrown by `executeSwap()` and `getSwapStatus()` are instances of
`VynxError` with a stable `code` field. Never match on the `message` string —
it may change between versions.

```typescript
import { VynxError, VynxErrorCode } from '@vynx/sdk';

try {
  const receipt = await vynx.executeSwap(params);
} catch (err) {
  if (err instanceof VynxError) {
    switch (err.code) {
      case VynxErrorCode.ERR_SWAP_TIMEOUT:
        // Capital recovered — see refundTxHash
        break;
      case VynxErrorCode.ERR_REFUND_UNRECOVERABLE:
        // Emergency — see procedures below
        break;
    }
  }
}
```

## Error Reference

### 1xxx — Pre-execution (no on-chain side-effects)

These errors fire before any transaction is sent. Capital is never at risk.
Fix the input and retry immediately.

**`VYNX_1001_INSUFFICIENT_FUNDS`**
Agent USDC balance is lower than `amountUSD`.

**`VYNX_1002_BELOW_MINIMUM`**
`amountUSD` is below the protocol minimum of $50.

**`VYNX_1003_UNKNOWN_TOKEN`**
`targetToken` is neither a recognized symbol nor a valid EVM address.

**`VYNX_1004_UNSUPPORTED_CHAIN`**
`targetChainId` is not in: 1, 10, 137, 8453, 42161.

**`VYNX_1005_QUOTE_UNAVAILABLE`**
Both 1inch and Odos failed to return a price quote. Options:
- Use a different `targetToken`
- Provide a custom `quoter` in `VynxSdkConfig`

---

### 2xxx — Execution failed, no capital at risk

These errors occur before `lockIntent`. Capital is never at risk.

**`VYNX_2001_NO_LIQUIDITY`**
No solver bid, or the winning solver missed the 10-second SLA. Transient —
retry after 5–30 seconds. `err.context.internalCode` contains: `no_bids` or
`sla_timeout`.

**`VYNX_2002_SYSTEM_UNAVAILABLE`**
Relayer unreachable or approve transaction failed. Retry with exponential
backoff. Do NOT retry a call that timed out without a `202 Accepted` response
— the intent may already be in the Relayer's mempool.

---

### 3xxx — Execution failed, capital recovered automatically

**`VYNX_3001_SWAP_TIMEOUT`**
The intent was locked on-chain but the solver did not settle within 15
minutes. The SDK automatically called `refundIntent()` and confirmed the
refund on-chain.

```typescript
case VynxErrorCode.ERR_SWAP_TIMEOUT:
  const refundTxHash = err.context.refundTxHash as string;
  console.log('Capital refunded at:', refundTxHash);
  break;
```

The agent's USDC has been returned. No further action needed.

---

### 9xxx — Human intervention required

**`VYNX_9001_REFUND_UNRECOVERABLE`**
The SDK attempted to call `refundIntent()` three times and all attempts
failed. Capital is locked in the settlement contract.

**Emergency procedure:**

1. Record `err.context.trackingRef` immediately.
2. Check intent state on-chain:
   ```bash
   cast call <VYNX_SETTLEMENT_ADDRESS> \
     "getIntentState(bytes32)(uint8)" \
     <trackingRef> \
     --rpc-url <BASE_RPC_URL>
   ```
   `2` = LOCKED (at risk) · `3` = REDEEMED (solver won) · `4` = REFUNDED (already recovered)

3. If LOCKED and deadline has passed, call `refundIntent` manually:
   ```bash
   cast send <VYNX_SETTLEMENT_ADDRESS> \
     "refundIntent(bytes32)" \
     <trackingRef> \
     --private-key <AGENT_PK> \
     --rpc-url <BASE_RPC_URL>
   ```
   `refundIntent` is callable by anyone after deadline expiry.

4. Contact support at security@vynx.network with `trackingRef` and the
   failed transaction hashes from `err.context`.

**`VYNX_9999_INTERNAL`**
Unexpected SDK error. Capital not at risk. Open an issue with the full error
and `err.context`.

---

## VynxError Fields

```typescript
err.code        // VynxErrorCode — stable across versions
err.message     // Human-readable — do not match on this
err.recoverable // boolean — true if retry may succeed
err.context     // Record<string, unknown> — error-specific metadata
```

| Code | Context fields |
|---|---|
| `ERR_SWAP_TIMEOUT` | `trackingRef`, `refundTxHash` |
| `ERR_REFUND_UNRECOVERABLE` | `trackingRef` |
| `ERR_SWAP_NO_LIQUIDITY` | `internalCode` (`no_bids` \| `sla_timeout`) |
| `ERR_SWAP_SYSTEM_UNAVAILABLE` | `internalCode` |
