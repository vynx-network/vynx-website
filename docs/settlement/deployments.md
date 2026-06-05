# VynX Settlement V1 — Deployments

Canonical record of every live deployment of the protocol contracts. This file is the single
place the repository records deployed addresses; other documents link here instead of
duplicating them. Broadcast artifacts (tx-level detail) live under `broadcast/`.

---

## Base Sepolia (chain ID 84532) — FASE 1 close-out deployment, 2026-06-04

Deployed by `script/DeployL2.s.sol` via `make deploy-l2-testnet` (single-signer testnet mode:
`MULTISIG_ADDRESS` overridden to the deployer for this run so `setContractAddresses` was
wired inline). All six contracts are **verified on Basescan Sepolia**
(`https://sepolia.basescan.org/address/<address>`).

| Contract | Address | Deploy tx |
| --- | --- | --- |
| `VynxToken` | `0x618b5f142e0963cb05dd90dc54353efced18fbca` | `0xc608f40979256435f6937ec33549f7af6fb7ec207cc82afef9f1eaa3994160d9` |
| `VynxAdmin` (implementation) | `0x5d9a9d2fbd1d6ca2cd34ceb9f0011d1d595133cf` | `0xe62d64dbff7f15f1df27bb2a9a8ac1180fe8ca6d88185e4215aa66017f12b4b9` |
| `VynxAdmin` (ERC1967 proxy — the live admin) | `0x41b5afda5d20663b272dd8f4dbb95826ac60a085` | `0x9ac9c2964d09dae124302b78c96de2793a25ab181b7fcc05df9c2c05340df2c3` |
| `StakingRewards` | `0x3286c0cb7bbc7dd4cc7c8752e3d65e275e1b1044` | `0x1f0add9556d86fa1285933df7944f995ab8d66b02c51dcb0a9fe41f5ae8cda8d` |
| `VynxTreasury` | `0xe898661760299f88e2b271a088987dacb8fb3de6` | `0xc51644ccaee7c3041276019e63f2737049a93064085cd24a300b2769cc178a0c` |
| `VynxSettlement` | `0xac13bc42eb18e6c71a1685fb8cfa23a4cd521ff9` | `0xfbd222a8e6450404a70b64e790706a0b46fe0646c0e40e78eb65dfe39c26ccda` |

Post-deploy wiring: `adminProxy.setContractAddresses(settlement, treasury, stakingRewards)` —
tx `0x8753f0c8cbf57c55a33b8fc4393d53124894f33cf12746d8b142245ba32762c6`.

### Configuration

| Parameter | Value |
| --- | --- |
| `usdc` (immutable, Q8-verified) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle official Base Sepolia USDC) |
| `takeRateBps` | 10 |
| Deployer / testnet multisig | `0x9e829B27Ff074E3F10757e57dA38185D6C4dD4A3` |
| `relayerKey` | `0x80A86D0A40B0A8d4CfDDfaD3190F19D1cF9634B4` |
| `watchdog` | `0x510b0ee598ba4Ccd69C4cf4711E36A65de2D30c1` |
| `keeper` | `0xD2fc03DFF277E7967e937588e8b2eCF5eD869e49` |

### Q8 gate — Base Sepolia USDC EIP-3009 capability (verified on-chain pre-deploy)

The previous SDK constants entry `0x5d69251BC22130cfF271D9Ac955F87E819E6c0d8` has **no code**
on real Base Sepolia (`cast code` → `0x`; it was a BLINDAJE local-fork deployment address).
Circle's official `0x036CbD53842c5426634e7929541eC2318f3dCF7e` was verified live:
`version()` = `"2"` (FiatTokenV2), `authorizationState(address,bytes32)` answers, and an
`eth_call` to the `receiveWithAuthorization` v,r,s overload with a dummy signature reverts
`FiatTokenV2: invalid signature` — the exact selector `lockIntent` consumes.
`vynx-sdk/src/constants.ts` was repointed accordingly.

### Smoke cycle — real EIP-3009 gasless lock → post-deadline refund (`script/SmokeTestnet.s.sol`)

The minimal independent on-chain proof of the gasless custody path against the live deployment:
the throwaway agent `0xC384808F25311031e8E31095eE9B4140f39d3087` signed ONE
`ReceiveWithAuthorization` against the live USDC domain with the §D2 nonce
(`0x14af60a88b028b1e4e10a63f6f9cb3778411a1cd69c8bd987b9dd6562428e716`, computed by
`IntentNonceLib.computeNonce`); the solver (deployer key) called `lockIntent` from its own
address (§D5 Option A) and paid all gas.

| Step | Evidence | Tx |
| --- | --- | --- |
| Agent funding (1 USDC) | `transfer(agent, 1e6)` | `0xc98658cc5b6e169e88266893bb619477f07d945ad0f0954faad8fc559376e3d1` |
| Gasless lock (200,821 gas) | intent `0xa0d55a0b1b236a1589d2f0fb5380731f33e396021b2b7e57e5b54a237771f788` → escrow `LOCKED`, `AuthorizationUsed` + `IntentLocked` emitted, `authorizationState(agent, nonce) = true` on the live USDC, settlement balance +1 USDC, agent balance 0 | `0x444a3bab83b9a176b71db607a49875b263b2afb669328d4c0b0ac503656f2049` |
| Post-deadline refund (76,333 gas) | escrow `REFUNDED` (state 3), agent balance restored to 1 USDC, settlement balance 0 | `0xb76c243d9bff399b67650b83e6f84a3b267ea17bc0f4135506ead62f8e895e7d` |

---

## Base Mainnet (chain ID 8453)

Not deployed yet. The mainnet profile of `script/DeployL2.s.sol` resolves
`USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` from `block.chainid == 8453`.

## Ethereum L1 (VynxRegistry + adapters)

Not deployed yet (`script/DeployL1.s.sol`).
