# Getting Started — @vynx/sdk

This guide takes you from an empty project to a settled cross-chain swap.

## 1. Environment Setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `BASE_RPC_URL` | **Yes** | Base mainnet or Sepolia RPC endpoint. You use it to build the viem `WalletClient` / `PublicClient` the SDK consumes. |
| `RELAYER_BASE_URL` | No | Relayer API base URL. Defaults to `https://api.vynx.network`; pass it via the `relayerBaseUrl` config field to override. |
| `ONEINCH_API_KEY` | No | 1inch API key for the primary price quoter. Optional — without it the SDK falls back to the keyless Odos quoter. [portal.1inch.dev](https://portal.1inch.dev) |

The SDK never reads your private key from the environment — you construct the
viem account yourself and pass the resulting `walletClient` to `VynxCore`.

## 2. Instantiating VynxCore

`VynxCore` requires a viem `WalletClient` and `PublicClient` configured for Base
(chain 8453) or Base Sepolia (chain 84532).

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { VynxCore } from '@vynx/sdk';

const chain = base; // use baseSepolia for testnet

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

Use separate `publicClient` and `walletClient` instances to avoid rate-limit
cross-contamination between reads and writes. The origin chain is inferred from
`walletClient.chain.id`; override it with the `originChainId` config field if
needed (only `8453` and `84532` are valid origins).

## 3. Your First Intent

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
  console.log('Output amount: ', receipt.outputAmount.toString());
  console.log('Tracking ref:  ', receipt.trackingRef);
  console.log('Execution time:', receipt.executionTimeMs, 'ms');

} catch (err) {
  if (err instanceof VynxError) {
    console.error('VynX error:', err.code, err.message);
  }
}
```

`executeSwap()` is a single call, but it drives a full state machine on your
behalf — including the **autonomous on-chain lock**: once a solver is matched, the
SDK calls `lockIntent` from your wallet automatically. **You never call lock
yourself.** Your wallet signs exactly two transactions per swap: `approve()`
(exact allowance — never unlimited) and `lockIntent()`. It never signs EIP-712
typed data directly. The full lifecycle:

```
balance/allowance → build request → submit → await match → LOCK (auto) → await settlement → resolve
```

If the solver does not settle before the ~15-minute deadline, the SDK calls
`refundIntent()` on-chain automatically and rejects with `ERR_SWAP_TIMEOUT`,
exposing the `refundTxHash` in `error.context`.

## 4. Checking Intent Status

`getSwapStatus()` is non-blocking and safe to call from a polling loop. Pass the
`trackingRef` from the receipt (or capture it from your logs):

```typescript
const status = await vynx.getSwapStatus(trackingRef);

switch (status.state) {
  case 'pending':   break;                                           // in flight
  case 'complete':  console.log('Settled at', status.destTxHash);   break;
  case 'refunded':  console.log('Refunded at', status.refundTxHash); break;
  case 'failed':    console.log('Failed. Retryable:', status.retryable); break;
}
```

`getSwapStatus()` never throws — transient relayer errors surface as `pending`.

## 5. Token Resolution

`targetToken` accepts either a symbol or a raw EVM address. Symbols are resolved
through the built-in `TOKEN_REGISTRY` (a public export — the source of truth for
each chain's token addresses, including USDC):

```typescript
import { TOKEN_REGISTRY } from '@vynx/sdk';

// Symbol — resolved via TOKEN_REGISTRY for the targetChainId
{ targetToken: 'DEGEN', targetChainId: 8453 }

// Address — used directly, no registry lookup
{ targetToken: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', targetChainId: 8453 }

// Inspect the registry directly
TOKEN_REGISTRY[8453].USDC;
```

An unknown symbol with no valid address throws `ERR_UNKNOWN_TOKEN` before any
on-chain action.

## 6. Supported Destination Chains

| Chain | Chain ID | Notes |
|---|---|---|
| Base | 8453 | Lowest fees — recommended default |
| Optimism | 10 | |
| Arbitrum One | 42161 | |
| Polygon | 137 | Use `slippageBps: 200` |
| Ethereum | 1 | High gas — trades < $500 unlikely to attract a solver |

## 7. Cleanup

`destroy()` aborts any in-flight `executeSwap()` calls — stopping their
settlement pollers so no background polling (or background on-chain refund)
outlives the SDK instance — and resolves only once those executions have settled.
Call it when your agent shuts down:

```typescript
process.on('SIGTERM', async () => {
  await vynx.destroy();
  process.exit(0);
});
```

An aborted swap rejects with `ERR_SWAP_SYSTEM_UNAVAILABLE`. Capital is never
stranded: the on-chain `refundIntent` stays permissionless after the deadline.

## Common Patterns

### Retry on no liquidity

`ERR_SWAP_NO_LIQUIDITY` is raised before any lock — no capital is at risk, so it
is always safe to retry:

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
  slippageBps:   400, // 4% for a long-tail token on Ethereum mainnet
});
```

### Bounding a single call

`maxExecutionTimeMs` is optional and has **no default**. Set it to fail fast if a
single `executeSwap()` runs longer than your tolerance (otherwise the internal
15-minute settlement deadline + auto-refund governs):

```typescript
const vynx = new VynxCore({ walletClient, publicClient, maxExecutionTimeMs: 120_000 });
```

When the bound is hit, `executeSwap()` rejects with
`ERR_SWAP_SYSTEM_UNAVAILABLE` **and aborts the in-flight settlement poller** — it
stops polling immediately and fires no background refund. Your capital is not
stranded: `refundIntent` stays permissionless once the deadline passes, and you
can track or recover the intent later via `getSwapStatus()`.
