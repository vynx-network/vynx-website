# Adapter Integration Guide — @vynx/sdk

`@vynx/sdk` ships two first-class framework adapters. Both wrap the same
`VynxCore` instance — the settlement logic is identical regardless of adapter.

## Coinbase AgentKit

### Prerequisites

AgentKit's `@CreateAction` decorator requires TypeScript decorator metadata
support, which standard `tsc` + `esbuild` do not emit by default.

**Step 1 — Install**

```bash
npm install @vynx/sdk @coinbase/agentkit reflect-metadata
npm install --save-dev unplugin-swc @swc/core
```

**Step 2 — Configure tsup**

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry:  ['src/agent.ts'],
  format: ['esm'],
  esbuildPlugins: [
    require('unplugin-swc').esbuild({
      tsconfigFile: './tsconfig.json',
      jsc: {
        transform: {
          decoratorMetadata: true,
          legacyDecorator:   true,
        },
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

**Step 4 — Import reflect-metadata first**

```typescript
// agent.ts — must be the very first import
import 'reflect-metadata';
import { createVynxActionProvider } from '@vynx/sdk';
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

The VynX `walletClient` is **independent** of AgentKit's internal CDP wallet.

**Available action**

| Action | Parameters | Returns |
|---|---|---|
| `vynx_execute_swap` | `targetToken`, `amountUSD`, `targetChainId`, `recipient?`, `slippageBps?` | JSON with `destTxHash`, `outputAmount`, `executionTimeMs` |

---

## elizaOS

### Prerequisites

```bash
npm install @vynx/sdk @elizaos/core
```

No additional bundler configuration required.

### Registration

```typescript
import { createVynxPlugin } from '@vynx/sdk';

export const character = {
  name: 'MyAgent',
  plugins: [ createVynxPlugin({ walletClient, publicClient }) ],
};
```

### Action

| Action | Similes | Returns |
|---|---|---|
| `VYNX_EXECUTE_SWAP` | swap, bridge, buy token, cross-chain swap | `{ success, destTxHash, outputAmount, executionTimeMs }` on success · `{ success: false, errorCode, recoverable, message }` on failure |

Match on `errorCode` (a `VynxErrorCode` string) for programmatic recovery.
Never match on `message`.

---

## Direct Use (no adapter)

Any TypeScript agent can use `VynxCore` directly:

```typescript
import { VynxCore } from '@vynx/sdk';

const vynx = new VynxCore({ walletClient, publicClient });
const receipt = await vynx.executeSwap({ targetToken: 'DEGEN', amountUSD: 100, targetChainId: 8453 });
```

---

## Adding a New Adapter

A new adapter:
1. Imports `VynxCore` and `VynxSdkConfig` from `@vynx/sdk`
2. Instantiates `VynxCore` internally with the config
3. Wraps `core.executeSwap()` in the framework's plugin/action interface
4. Returns success/failure in the framework's expected shape

See `src/adapters/agentkit.ts` and `src/adapters/eliza.ts` (~50 lines each).
