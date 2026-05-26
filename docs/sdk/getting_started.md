# Getting Started — @vynx/sdk

## Environment Setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `ONEINCH_API_KEY` | Yes | 1inch API key for price quotes. [portal.1inch.dev](https://portal.1inch.dev) |
| `RELAYER_BASE_URL` | No | Defaults to `https://api.vynx.network` |
| `BASE_RPC_URL` | Yes | Base mainnet or Sepolia RPC endpoint |

## Instantiating VynxCore

`VynxCore` requires a viem `WalletClient` and `PublicClient` configured for
Base (chain 8453) or Base Sepolia (chain 84532).

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { VynxCore } from '@vynx/sdk';

// Use baseSepolia for testnet
const chain = base;

const account = privateKeyToAccount(process.env.AGENT_PK as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(process.env.BASE_RPC_URL),
});

const publicClient = createPublicClient({
  chain,
  transport: http(process.env.BASE_RPC_URL),
});

const vynx = new VynxCore({ walletClient, publicClient });
```

Use separate `publicClient` and `walletClient` instances to avoid
rate-limit cross-contamination between reads and writes.

## Your First Intent

```typescript
import { VynxError, VynxErrorCode } from '@vynx/sdk';

try {
  const receipt = await vynx.executeSwap({
    targetToken:   '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', // DEGEN on Base
    amountUSD:     100,
    targetChainId: 8453,
  });

  console.log('Settlement complete');
  console.log('Destination tx:', receipt.destTxHash);
  console.log('Output amount:', receipt.outputAmount.toString());
  console.log('Execution time:', receipt.executionTimeMs, 'ms');

} catch (err) {
  if (err instanceof VynxError) {
    console.error('VynX error:', err.code, err.message);
  }
}
```

## Checking Intent Status

`getSwapStatus` is non-blocking and safe to call from polling loops:

```typescript
const status = await vynx.getSwapStatus(trackingRef);

switch (status.state) {
  case 'pending':  break;
  case 'complete':  console.log('Settled at', status.destTxHash); break;
  case 'refunded':  console.log('Refunded at', status.refundTxHash); break;
  case 'failed':    console.log('Failed. Retryable:', status.retryable); break;
}
```

## Token Resolution

`targetToken` accepts either a symbol or a raw EVM address:

```typescript
// Symbol — resolved via built-in TOKEN_REGISTRY
{ targetToken: 'DEGEN', targetChainId: 8453 }

// Address — used directly, no registry lookup
{ targetToken: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', targetChainId: 8453 }
```

Unknown symbols with no valid address throw `ERR_UNKNOWN_TOKEN` before any
on-chain action.

## Supported Destination Chains

| Chain | Chain ID | Notes |
|---|---|---|
| Base | 8453 | Lowest fees — recommended default |
| Optimism | 10 | |
| Arbitrum One | 42161 | |
| Polygon | 137 | Use `slippageBps: 200` |
| Ethereum | 1 | High gas — trades < $500 unlikely to attract solver bids |

## Cleanup

Call `destroy()` when your agent shuts down:

```typescript
process.on('SIGTERM', async () => {
  await vynx.destroy();
  process.exit(0);
});
```

## Common Patterns

### Retry on no liquidity

```typescript
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    return await vynx.executeSwap(params);
  } catch (err) {
    if (
      err instanceof VynxError &&
      err.code === VynxErrorCode.ERR_SWAP_NO_LIQUIDITY &&
      attempt < MAX_RETRIES - 1
    ) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    throw err;
  }
}
```

### Custom slippage for volatile tokens

```typescript
const receipt = await vynx.executeSwap({
  targetToken:   'PEPE',
  amountUSD:     200,
  targetChainId: 1,
  slippageBps:   400, // 4% for long-tail token on Ethereum mainnet
});
```
