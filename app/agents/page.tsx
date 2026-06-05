import React from "react";
import DocsLayout from "@/components/layout/DocsLayout";
import DocsSidebar from "@/components/layout/DocsSidebar";
import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import CodeBlock from "@/components/ui/CodeBlock";
import FaqAccordion, { FaqItem } from "@/components/docs/FaqAccordion";
import SettlementFlow from "@/components/docs/diagrams/SettlementFlow";
import IntentStateMachine from "@/components/docs/diagrams/IntentStateMachine";

export const metadata = {
  title: { absolute: "VynX · Agents Integration" },
  description:
    "Integration guide for AI agents on VynX. SDK reference, EIP-3009 signed terms, intent lifecycle, and error handling.",
};

const agentNav = [
  {
    items: [
      { label: "Overview", href: "#overview" },
      { label: "Quick Start", href: "#quick-start" },
      { label: "SDK Reference", href: "#sdk-reference" },
      { label: "Signed Terms", href: "#eip-712-payload" },
      { label: "Intent Lifecycle", href: "#intent-lifecycle" },
      { label: "Error Handling", href: "#error-handling" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

const flowSteps = ["SIGN", "AUCTION", "LOCK", "PAY", "SETTLE"];

const methodColClass = "grid grid-cols-[160px_1fr]";

const sdkMethods = [
  {
    method: "executeSwap()",
    desc: "Signs, submits, and settles an intent. Resolves with the on-chain receipt.",
  },
  {
    method: "getSwapStatus()",
    desc: "Non-blocking status poll by tracking ref. Safe in polling loops.",
  },
  {
    method: "destroy()",
    desc: "Aborts in-flight executeSwap() calls and stops their settlement pollers. Resolves once they settle.",
  },
];

const payloadColClass = "grid grid-cols-[160px_120px_1fr]";

const payloadFields = [
  {
    field: "intentId",
    type: "bytes32",
    desc: "Unique identifier, derived off-chain. Hashed into the nonce.",
    goldField: false,
  },
  {
    field: "agent",
    type: "address",
    desc: "Intent originator. Your signing address — and the recipient.",
    goldField: false,
  },
  {
    field: "token",
    type: "address",
    desc: "Must be USDC on Base (0x833589...). Immutable token lock.",
    goldField: true,
  },
  {
    field: "inputAmount",
    type: "uint256",
    desc: "In USDC base units (6 decimals). Min: 50e6.",
    goldField: false,
  },
  {
    field: "outputToken",
    type: "address",
    desc: "Token delivered on the destination chain.",
    goldField: false,
  },
  {
    field: "minOutputAmount",
    type: "uint256",
    desc: "Minimum acceptable output. Agent-signed; witness-validated.",
    goldField: false,
  },
  {
    field: "destinationChainId",
    type: "uint256",
    desc: "8453 Base · 84532 Base Sepolia · 1/10/137/42161.",
    goldField: false,
  },
  {
    field: "deadline",
    type: "uint256",
    desc: "Unix timestamp. Default: now + 15 min. Enforced by USDC.",
    goldField: false,
  },
];

const lifecycleColClass = "grid grid-cols-[120px_1fr]";

const lifecycleRows = [
  {
    status: "PENDING",
    statusClass: "font-mono text-[12px] text-vynx-muted",
    desc: "Intent submitted and accepted. In private mempool.",
  },
  {
    status: "IN_AUCTION",
    statusClass: "font-mono text-[12px] text-vynx-muted",
    desc: "Broadcast to Solvers. 200ms window open.",
  },
  {
    status: "LOCKED",
    statusClass: "font-mono text-[12px] text-vynx-muted",
    desc: "Winning Solver executed lockIntent() from its own address. Funds locked on Base.",
  },
  {
    status: "SETTLED",
    statusClass: "font-mono text-[12px] text-white",
    desc: "claimFunds() confirmed. Output delivered to agent.",
  },
  {
    status: "EXPIRED",
    statusClass: "font-mono text-[12px] text-vynx-muted",
    desc: "Deadline (15 min) passed without fill. refundIntent() is permissionless — funds return to the agent.",
  },
];

const agentFaqItems: FaqItem[] = [
  {
    q: "What tokens can I use as input?",
    a: "Only USDC on Base (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913). The Asymmetric Asset Policy is a hard constraint — no oracle dependency, no governance risk on input token.",
  },
  {
    q: "What tokens can I receive as output?",
    a: "Any ERC-20 on Base. The Solver assumes price and liquidity risk. The protocol is output-token agnostic.",
  },
  {
    q: "What happens if no Solver fills my intent?",
    a: "Your intent expires after 15 minutes and you receive a full refund. No fees. No partial fills. Atomic or nothing.",
  },
  {
    q: "Do I need ETH for gas?",
    a: "No. You sign one EIP-3009 authorization off-chain and send zero transactions. The winning Solver executes the on-chain lock from its own address and bears all gas; its destination delivery is its own transaction. If no fill lands by the deadline, refundIntent() is permissionless — any funded wallet can return your capital.",
  },
];

interface ErrorRow {
  code: string;
  desc: string;
}

interface ErrorClass {
  label: string;
  capital: string;
  gold?: boolean;
  rows: ErrorRow[];
}

const errorClasses: ErrorClass[] = [
  {
    label: "1xxx · PRE-EXECUTION",
    capital: "Never at risk",
    rows: [
      {
        code: "VYNX_1001_INSUFFICIENT_FUNDS",
        desc: "Agent USDC balance is below amountUSD.",
      },
      {
        code: "VYNX_1002_BELOW_MINIMUM",
        desc: "amountUSD is below the $50 protocol minimum.",
      },
      {
        code: "VYNX_1003_UNKNOWN_TOKEN",
        desc: "targetToken is neither a known symbol nor a valid EVM address.",
      },
      {
        code: "VYNX_1004_UNSUPPORTED_CHAIN",
        desc: "targetChainId not in 1 · 10 · 137 · 8453 · 42161.",
      },
      {
        code: "VYNX_1005_QUOTE_UNAVAILABLE",
        desc: "Both 1inch and Odos failed to return a price quote.",
      },
    ],
  },
  {
    label: "2xxx · EXECUTION FAILED",
    capital: "Never at risk",
    rows: [
      {
        code: "VYNX_2001_NO_LIQUIDITY",
        desc: "No solver bid, or the winner missed the 10 s SLA. Transient — retry in 5–30 s.",
      },
      {
        code: "VYNX_2002_SYSTEM_UNAVAILABLE",
        desc: "Relayer unreachable, returned a non-OK status, or maxExecutionTimeMs elapsed — which aborts the settlement poller. Retry with backoff; check getSwapStatus() before re-submitting.",
      },
    ],
  },
  {
    label: "3xxx · CAPITAL RECOVERED",
    capital: "Auto-refunded",
    rows: [
      {
        code: "VYNX_3001_SWAP_TIMEOUT",
        desc: "Locked but the solver did not settle in 15 min. The intent was refunded on-chain and the full amount returned to the agent.",
      },
    ],
  },
  {
    label: "9xxx · HUMAN INTERVENTION",
    capital: "Action required",
    gold: true,
    rows: [
      {
        code: "VYNX_9001_REFUND_UNRECOVERABLE",
        desc: "Automatic refund attempts did not confirm. refundIntent() is permissionless after the deadline — any funded wallet can recover the capital.",
      },
      {
        code: "VYNX_9999_INTERNAL",
        desc: "Unexpected SDK error. Capital is not at risk. Open an issue with err.context.",
      },
    ],
  },
];

const errColClass = "grid grid-cols-[260px_1fr] gap-x-6";

export default function AgentsPage() {
  return (
    <DocsLayout
      sidebar={<DocsSidebar title="AGENTS INTEGRATION" sections={agentNav} />}
    >
      {/* ── Overview ── */}
      <section id="overview" className="mb-20">
        <SectionLabel>OVERVIEW</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          WHAT IS AN AGENT
        </h2>
        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
          <p>
            In VynX, an agent is any autonomous system that submits intents.
            There are no wallet popups, no brand preferences, no onboarding
            fatigue. An intent is an instruction — swap X USDC for Y token —
            whose eight terms are cryptographically the agent&rsquo;s, bound by
            one EIP-3009 signature. The Relayer validates and orchestrates the
            auction; it cannot alter what the agent signed. The protocol
            handles routing, settlement, and guarantees.
          </p>
        </div>

        <div className="flex items-center gap-3 mt-8">
          {flowSteps.map((step, i) => (
            <React.Fragment key={step}>
              <span className="font-mono text-[10px] tracking-widest text-vynx-muted">
                {step}
              </span>
              {i < flowSteps.length - 1 && (
                <span className="font-mono text-[12px] text-vynx-faint">
                  →
                </span>
              )}
            </React.Fragment>
          ))}
        </div>

        <Card className="mt-6">
          <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed">
            The agent signs one EIP-3009 authorization off-chain and sends
            zero transactions. The winning Solver executes lockIntent() from
            its own address and bears all gas, including the destination-chain
            payment. If the deadline passes with no fill, recovery is
            permissionless — anyone can call refundIntent() to return the
            agent&rsquo;s capital.
          </p>
        </Card>

        <div className="mt-8">
          <SettlementFlow />
        </div>
      </section>

      {/* ── Quick Start ── */}
      <section id="quick-start" className="mb-20">
        <SectionLabel>QUICK START</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          THREE STEPS TO PRODUCTION
        </h2>

        <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 mb-8 items-start">
          <span className="font-display text-[28px] text-vynx-faint leading-none">
            01
          </span>
          <div>
            <div className="font-mono text-[11px] tracking-wide text-vynx-muted uppercase mb-3">
              INSTALL
            </div>
            <CodeBlock
              language="bash"
              label="INSTALL"
              code="npm install @vynx/sdk viem"
            />
          </div>
        </div>

        <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 mb-8 items-start">
          <span className="font-display text-[28px] text-vynx-faint leading-none">
            02
          </span>
          <div>
            <div className="font-mono text-[11px] tracking-wide text-vynx-muted uppercase mb-3">
              INITIALIZE
            </div>
            <CodeBlock
              language="typescript"
              label="INITIALIZE"
              code={`import { createWalletClient, createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { VynxCore } from '@vynx/sdk'

const account = privateKeyToAccount(process.env.AGENT_PK)

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
})
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
})

const vynx = new VynxCore({ walletClient, publicClient })`}
            />
          </div>
        </div>

        <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 mb-8 items-start">
          <span className="font-display text-[28px] text-vynx-faint leading-none">
            03
          </span>
          <div>
            <div className="font-mono text-[11px] tracking-wide text-vynx-muted uppercase mb-3">
              SUBMIT INTENT
            </div>
            <CodeBlock
              language="typescript"
              label="SUBMIT INTENT"
              code={`const receipt = await vynx.executeSwap({
  targetToken:   'DEGEN', // symbol or 0x address
  amountUSD:     100,     // min $50
  targetChainId: 8453,    // Base
})

// receipt.destTxHash · receipt.outputAmount · receipt.executionTimeMs`}
            />
            <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mt-4">
              inputAmount minimum: 50 USDC (50_000_000). Intents below this
              threshold are rejected by the Relayer&rsquo;s Asymmetric Asset
              Policy.
            </p>
          </div>
        </div>
      </section>

      {/* ── SDK Reference ── */}
      <section id="sdk-reference" className="mb-20">
        <SectionLabel>SDK REFERENCE</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          @VYNX/SDK
        </h2>

        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-[13px] text-white">@vynx/sdk</span>
          <a
            href="https://www.npmjs.com/package/@vynx/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] text-vynx-gold hover:text-white transition-colors duration-200"
          >
            ↗ npm
          </a>
        </div>

        <div className="overflow-x-auto">
        <div role="table" className="w-full min-w-90 mb-6">
          <div
            role="row"
            className={`${methodColClass} border-b border-[var(--color-border)] pb-3`}
          >
            {["METHOD", "DESCRIPTION"].map((h) => (
              <div
                key={h}
                role="columnheader"
                className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
              >
                {h}
              </div>
            ))}
          </div>
          {sdkMethods.map((row) => (
            <div
              key={row.method}
              role="row"
              className={`${methodColClass} border-b border-[var(--color-border)] py-4 items-center`}
            >
              <div role="cell" className="font-mono text-[13px] text-white">
                {row.method}
              </div>
              <div
                role="cell"
                className="font-body text-[13px] text-vynx-muted"
              >
                {row.desc}
              </div>
            </div>
          ))}
        </div>
        </div>

        <Card className="mt-2">
          <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed">
            The SDK computes the terms hash and signs one EIP-3009 typed-data
            authorization client-side — never an allowance, never a transaction
            on the swap path. It does not hold capital and does not query
            oracles.
          </p>
        </Card>
      </section>

      {/* ── EIP-712 Payload ── */}
      <section id="eip-712-payload" className="mb-20">
        <SectionLabel>SIGNED TERMS</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          INTENT STRUCTURE
        </h2>
        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8">
          Every intent is eight terms the agent signs as one EIP-3009
          authorization; the authorization nonce is the keccak256 hash of all
          eight. A changed term breaks the recomputed nonce — the Relayer
          cannot alter what the agent signed. lockIntent() re-derives the nonce
          and Circle&rsquo;s USDC verifies the signature on-chain.
        </p>

        <div className="overflow-x-auto">
        <div role="table" className="w-full min-w-120">
          <div
            role="row"
            className={`${payloadColClass} border-b border-[var(--color-border)] pb-3`}
          >
            {["FIELD", "TYPE", "DESCRIPTION"].map((h) => (
              <div
                key={h}
                role="columnheader"
                className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
              >
                {h}
              </div>
            ))}
          </div>
          {payloadFields.map((row) => (
            <div
              key={row.field}
              role="row"
              className={`${payloadColClass} border-b border-[var(--color-border)] py-4 items-center`}
            >
              <div
                role="cell"
                className={
                  row.goldField
                    ? "font-mono text-[12px] text-vynx-gold"
                    : "font-mono text-[12px] text-white"
                }
              >
                {row.field}
              </div>
              <div
                role="cell"
                className="font-mono text-[12px] text-vynx-muted"
              >
                {row.type}
              </div>
              <div
                role="cell"
                className="font-body text-[13px] text-vynx-muted"
              >
                {row.desc}
              </div>
            </div>
          ))}
        </div>
        </div>
      </section>

      {/* ── Intent Lifecycle ── */}
      <section id="intent-lifecycle" className="mb-20">
        <SectionLabel>INTENT LIFECYCLE</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          STATE MACHINE
        </h2>

        <div className="mb-8">
          <IntentStateMachine />
        </div>

        <div className="overflow-x-auto">
        <div role="table" className="w-full min-w-90 mb-4">
          <div
            role="row"
            className={`${lifecycleColClass} border-b border-[var(--color-border)] pb-3`}
          >
            {["STATUS", "DESCRIPTION"].map((h) => (
              <div
                key={h}
                role="columnheader"
                className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
              >
                {h}
              </div>
            ))}
          </div>
          {lifecycleRows.map((row) => (
            <div
              key={row.status}
              role="row"
              className={`${lifecycleColClass} border-b border-[var(--color-border)] py-4 items-center`}
            >
              <div role="cell" className={row.statusClass}>
                {row.status}
              </div>
              <div
                role="cell"
                className="font-body text-[13px] text-vynx-muted"
              >
                {row.desc}
              </div>
            </div>
          ))}
          {/* SLASHED row — gold highlight */}
          <div
            role="row"
            className={`${lifecycleColClass} border border-[var(--color-border-gold)] rounded-[2px] py-4 px-3 mt-2 items-center`}
          >
            <div role="cell" className="font-mono text-[12px] text-vynx-gold">
              SLASHED
            </div>
            <div
              role="cell"
              className="font-body text-[13px] text-vynx-muted"
            >
              Solver breached Deadline. 10% slash. Agent compensated.
            </div>
          </div>
        </div>
        </div>

        <Card goldBorder className="mt-6">
          <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed">
            On EXPIRED: the agent receives a full{" "}
            <span className="text-white font-medium">unilateral</span> refund.
            No Solver approval required. No governance vote. The refund is
            enforced by{" "}
            <span className="font-mono text-[13px] text-white">
              DEFAULT_DEADLINE
            </span>{" "}
            in{" "}
            <span className="font-mono text-[13px] text-white">
              VynxSettlement.sol
            </span>
            .
          </p>
        </Card>
      </section>

      {/* ── Error Handling ── */}
      <section id="error-handling" className="mb-20">
        <SectionLabel>ERROR HANDLING</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          FAILURE MODES
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <Card>
            <div className="font-mono text-[10px] text-vynx-muted mb-3">
              RELAYER REJECTION
            </div>
            <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mb-4">
              Intent rejected before auction if: inputToken ≠ USDC, inputAmount
              &lt; 50 USDC, no eligible Solvers (SHF), or the agent&rsquo;s
              authorization fails verification at intake — a tampered term
              changes the recomputed nonce and is rejected.
            </p>
            <p className="font-mono text-[11px] text-vynx-faint">
              Check payload. Retry with corrected parameters.
            </p>
          </Card>

          <Card>
            <div className="font-mono text-[10px] text-vynx-muted mb-3">
              AUCTION NO-FILL
            </div>
            <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mb-4">
              No Solver bid within 200ms window. Status → PENDING (requeued) or
              EXPIRED if deadline passed.
            </p>
            <p className="font-mono text-[11px] text-vynx-faint">
              getSwapStatus() to confirm. Retry or wait for refund.
            </p>
          </Card>

          <Card goldBorder>
            <div className="font-mono text-[10px] text-vynx-gold mb-3">
              DEADLINE BREACH — AGENT PROTECTED
            </div>
            <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mb-4">
              Solver won but failed to settle within 15 min. SlashAmount =
              InputAmount × 10%. 5% returned to agent. Protocol enforced. No
              action needed.
            </p>
            <p className="font-mono text-[11px] text-vynx-faint">
              Monitor via getSwapStatus(). Compensation is automatic.
            </p>
          </Card>
        </div>

        <Card className="mt-4">
          <p className="font-mono text-[12px] text-vynx-muted leading-relaxed">
            VynxSettlement.sol reverts and emits{" "}
            <span className="text-white">SuspiciousRelayerActivity</span> if
            intentId is not found or Solver does not match on-chain record.
          </p>
        </Card>

        <div className="font-mono text-[10px] tracking-widest text-vynx-faint mt-12 mb-6">
          ERROR CODE REFERENCE
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-8 max-w-140">
          Every error thrown by{" "}
          <span className="font-mono text-[13px] text-white">executeSwap()</span>{" "}
          and{" "}
          <span className="font-mono text-[13px] text-white">
            getSwapStatus()
          </span>{" "}
          is a{" "}
          <span className="font-mono text-[13px] text-white">VynxError</span>{" "}
          with a stable{" "}
          <span className="font-mono text-[13px] text-white">code</span>. Match
          on the code, never the message. The class encodes whether capital is
          at risk.
        </p>

        <div className="overflow-x-auto">
          <div className="w-full min-w-140 space-y-8">
            {errorClasses.map((cls) => (
              <div key={cls.label}>
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                  <span
                    className={`font-mono text-[10px] tracking-[0.15em] uppercase ${
                      cls.gold ? "text-vynx-gold" : "text-vynx-faint"
                    }`}
                  >
                    {cls.label}
                  </span>
                  <span
                    className={`font-mono text-[10px] tracking-[0.1em] uppercase ${
                      cls.gold ? "text-vynx-gold" : "text-vynx-muted"
                    }`}
                  >
                    {cls.capital}
                  </span>
                </div>
                {cls.rows.map((row) => (
                  <div
                    key={row.code}
                    className={`${errColClass} border-b border-[var(--color-border)] py-4 items-start`}
                  >
                    <div
                      className={`font-mono text-[12px] ${
                        cls.gold ? "text-vynx-gold" : "text-white"
                      }`}
                    >
                      {row.code}
                    </div>
                    <div className="font-body text-[13px] text-vynx-muted leading-relaxed">
                      {row.desc}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mb-20">
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-white mb-8">
          FREQUENTLY ASKED QUESTIONS
        </h2>
        <FaqAccordion items={agentFaqItems} />
      </section>

      {/* ── CTA ── */}
      <div className="mt-24 pt-12 border-t border-[var(--color-border)]">
        <p className="font-mono text-[10px] tracking-widest text-vynx-faint mb-6">
          START BUILDING
        </p>
        <div className="flex gap-4 flex-wrap">
          <Button
            variant="primary"
            href="https://www.npmjs.com/package/@vynx/sdk"
            target="_blank"
          >
            INSTALL SDK ↗
          </Button>
          <Button variant="secondary" href="mailto:cristian@vynx.network">
            CONTACT
          </Button>
        </div>
      </div>
    </DocsLayout>
  );
}
