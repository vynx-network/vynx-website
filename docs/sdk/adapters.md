# Adapter Integration Guide — @vynx-network/sdk

`@vynx-network/sdk` ships two optional framework adapters. Both wrap the same `VynxCore`
instance — the settlement logic is identical regardless of adapter, and both are
created from a `VynxSdkConfig`. The flow is **gasless** through either adapter:
the agent wallet signs one off-chain EIP-3009 authorization per swap and sends
no transactions (no ETH needed). Install only the adapter you use (the framework
packages are optional peer dependencies).

## Coinbase AgentKit

### Prerequisites

AgentKit's `@CreateAction` decorator requires TypeScript decorator metadata, which
standard `tsc` + `esbuild` do not emit by default. You need `reflect-metadata` and
an SWC-based bundler step.

**Step 1 — Install**

```bash
npm install @vynx-network/sdk @coinbase/agentkit reflect-metadata
npm install --save-dev unplugin-swc @swc/core
```

**Step 2 — Configure tsup (SWC plugin)**

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';
import swc from 'unplugin-swc';

export default defineConfig({
  entry:  ['src/agent.ts'],
  format: ['esm'],
  esbuildPlugins: [
    swc.esbuild({
      jsc: {
        parser:    { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
```

**Step 3 — Configure `tsconfig.json`**

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata":  true
  }
}
```

**Step 4 — Import `reflect-metadata` first**

```typescript
// agent.ts — must be the very first import
import 'reflect-metadata';
import { createVynxActionProvider } from '@vynx-network/sdk';
```

**Step 5 — Register**

```typescript
const agentKit = await AgentKit.from({
  cdpApiKeyId:     process.env.CDP_API_KEY_ID!,
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET!,
  cdpWalletSecret: process.env.CDP_WALLET_SECRET!,
  actionProviders: [
    createVynxActionProvider({ walletClient, publicClient }),
  ],
});
```

The VynX `walletClient` is **independent** of AgentKit's internal CDP wallet —
VynX uses the wallet you pass in only to sign the single off-chain EIP-3009
transfer authorization (typed data, zero gas); it sends no transactions on the
swap path.

**Available action**

| Action | Parameters | Returns |
|---|---|---|
| `vynx_execute_swap` | `targetToken`, `amountUSD` (≥ 50), `targetChainId` (`1 \| 10 \| 137 \| 8453 \| 42161`), `recipient?` | JSON string with `status`, `destTxHash`, `outputAmount`, `executionTimeMs` |

The action schema does not expose `slippageBps`; configure slippage via the
`defaultSlippageBps` config field when creating the provider. `recipient` is
reserved in v0.1.0 (output is delivered to the agent wallet).

---

## elizaOS

### Prerequisites

```bash
npm install @vynx-network/sdk @elizaos/core
```

No additional bundler configuration required.

### Registration

```typescript
import { createVynxPlugin } from '@vynx-network/sdk';

export const character = {
  name: 'MyAgent',
  plugins: [ createVynxPlugin({ walletClient, publicClient }) ],
};
```

### Action

| Action | Similes | Returns |
|---|---|---|
| `VYNX_EXECUTE_SWAP` | swap, bridge, buy token, cross-chain swap | success: `{ success: true, text, data: { destTxHash, outputAmount, executionTimeMs } }` · failure: `{ success: false, text, data: { errorCode, recoverable, message }, error }` |

On failure, `data.errorCode` is a `VynxErrorCode` string — match on it for
programmatic recovery. Never match on `text` / `message`.

---

## Direct Use (no adapter)

Any TypeScript agent can use `VynxCore` directly — this is the lowest-overhead
path and exposes the full `ExecuteSwapParams` (including `slippageBps`):

```typescript
import { VynxCore } from '@vynx-network/sdk';

const vynx = new VynxCore({ walletClient, publicClient });
const receipt = await vynx.executeSwap({
  targetToken: 'DEGEN', amountUSD: 100, targetChainId: 8453,
});
```

---

## Adding a New Adapter

A new adapter:

1. Imports `VynxCore` and `VynxSdkConfig` from `@vynx-network/sdk`.
2. Instantiates `VynxCore` internally with the config.
3. Wraps `core.executeSwap()` in the framework's plugin/action interface.
4. Returns success/failure in the framework's expected shape, surfacing
   `VynxError.code` for programmatic error handling.

See `src/adapters/agentkit.ts` and `src/adapters/eliza.ts` (~50–60 lines each) for
reference implementations.
