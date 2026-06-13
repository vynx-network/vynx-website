import React from "react";
import DocsLayout from "@/components/layout/DocsLayout";
import DocsSidebar from "@/components/layout/DocsSidebar";
import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FaqAccordion, { FaqItem } from "@/components/docs/FaqAccordion";
import AgentTimeline from "@/components/docs/diagrams/AgentTimeline";
import FundsSafetyBoundary from "@/components/docs/diagrams/FundsSafetyBoundary";
import AgentCostWaterfall from "@/components/docs/diagrams/AgentCostWaterfall";
import IntentStateMachine from "@/components/docs/diagrams/IntentStateMachine";

export const metadata = {
  title: { absolute: "VynX · Agents" },
  description:
    "The demand side of the auction: an AI agent signs one EIP-3009 authorization off-chain — zero gas, zero transactions — and receives best execution or a full refund. The flow, the safety model, and the cost.",
};

const agentNav = [
  {
    items: [
      { label: "Overview", href: "#overview" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "Best Execution", href: "#execution" },
      { label: "What You Sign", href: "#what-you-sign" },
      { label: "Safety", href: "#safety" },
      { label: "Integration", href: "#integration" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

const flowSteps = ["SIGN", "SUBMIT", "COMPETE", "RECEIVE"];

const frameStats = [
  { value: "17,000", label: "AGENTS ON BASE", sub: "Deployed" },
  { value: "~1M", label: "JOBS COMPLETED", sub: "Cumulative" },
  { value: "$466M", label: "AGENTIC GDP", sub: "On-chain" },
  { value: "$80.25M", label: "VIRTUALS TVL", sub: "Agent platform" },
];

const cycle = [
  {
    label: "ONE SIGNATURE",
    body: (
      <>
        You sign a single EIP-3009 authorization over eight terms, off-chain.
        Zero gas, zero transactions, no ETH. The authorization nonce is the
        keccak256 hash of all eight terms.
      </>
    ),
  },
  {
    label: "SUBMIT",
    body: (
      <>
        The Relayer verifies your signature and opens a 200ms sealed-bid
        auction. You have sent nothing on-chain.
      </>
    ),
  },
  {
    label: "BEST EXECUTION",
    body: (
      <>
        Solvers compete; the highest OutputAmount wins. The auction works for
        you — you are quoted the most a competitive field will deliver, never
        below your minimum.
      </>
    ),
  },
  {
    label: "YOUR FUNDS STAY PUT UNTIL A SOLVER COMMITS",
    body: (
      <>
        The winning solver pulls your USDC into escrow using your authorization,
        only on winning. If no solver wins, the authorization goes unused and
        your funds never move.
      </>
    ),
  },
  {
    label: "ATOMIC SETTLEMENT",
    body: (
      <>
        You receive at least your signed minimum on the destination chain, or
        you are refunded in full. There are no partial fills.
      </>
    ),
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
    desc: "Must be USDC on Base. Immutable token lock.",
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
    desc: "Your minimum acceptable output. Agent-signed; witness-validated.",
    goldField: false,
  },
  {
    field: "destinationChainId",
    type: "uint256",
    desc: "8453 Base · 1 / 10 / 137 / 42161 · 84532 Base Sepolia.",
    goldField: false,
  },
  {
    field: "deadline",
    type: "uint256",
    desc: "Unix timestamp. Default: now + 15 min. Enforced by USDC.",
    goldField: false,
  },
];

const agentFaqItems: FaqItem[] = [
  {
    q: "What exactly am I signing?",
    a: "One EIP-3009 ReceiveWithAuthorization over eight terms — the input USDC and amount, the output token and your minimum, the destination chain, and a deadline. The authorization's nonce is the keccak256 hash of all eight, so a changed term breaks the signature and the lock is rejected. It is a single off-chain signature: no transaction, no gas, no token allowance, usable once.",
  },
  {
    q: "Can my funds be stolen, or get stuck?",
    a: "Funds are trust-minimized. Your signed terms cannot be altered, the Relayer can never redirect or seize your USDC, and settlement is atomic — you receive the output token or a full on-chain refund, with no partial fills. The honest edge: the single Relayer is a liveness dependency, so an outage can delay settlement, but your principal is recoverable through the permissionless refund. The one exception sits outside the protocol — Circle's USDC can blacklist or pause an address, which can leave funds temporarily immobile until Circle resolves it.",
  },
  {
    q: "What happens if no solver fills my intent?",
    a: "Nothing happens to your funds. Your USDC moves only when a winning solver locks it using your authorization; if no solver wins, the authorization goes unused and expires. You never had capital at risk.",
  },
  {
    q: "What if a solver delivers less than I asked for?",
    a: "It cannot. Your minimum output is one of the eight signed terms, and the witness validates the destination payment against it before any settlement. A payment below your minimum is rejected and the intent refunds in full at its deadline. There are no partial fills.",
  },
  {
    q: "Do I need ETH, or to pay gas?",
    a: "No. The swap path is fully gasless for the agent — the winning solver pays all gas. The only transaction the protocol can require is the recovery refund, and it is permissionless, so any party can pay that gas; your funds return regardless.",
  },
  {
    q: "Which chains and tokens are supported?",
    a: "Input is USDC on Base. Output can be delivered on Base, Ethereum, Arbitrum, Optimism, or Polygon. USDC is the only input token — it is what keeps settlement oracle-free.",
  },
  {
    q: "Is it live? Is it audited? How do I integrate?",
    a: "The protocol runs on Base Sepolia testnet today; the contracts are hardened against a formal internal threat model but not yet externally audited. The SDK is functional, with native adapters for Coinbase AgentKit and elizaOS, and publishes to npm with pinned mainnet addresses at launch. Until then, integration is by early-access request.",
  },
];

export default function AgentsPage() {
  return (
    <DocsLayout
      sidebar={<DocsSidebar title="AGENTS" sections={agentNav} />}
    >
      {/* ── Overview · The Frame ── */}
      <section id="overview" className="mb-20">
        <SectionLabel>OVERVIEW</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          SETTLEMENT AT MACHINE SPEED
        </h2>
        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
          <p>
            An agent signs one EIP-3009 authorization off-chain — zero gas, zero
            transactions, no ETH — and receives best execution on a destination
            chain, or a full refund. The winning solver bears all the gas and all
            the settlement work. You sign; the protocol does the rest.
          </p>
          <p>
            The agentic economy runs on a 200-millisecond decision cycle.
            Human-era rails — thirty-second-to-multi-minute settlement, wallet
            popups, gas management, a human in the loop — break for an autonomous
            agent. VynX is the settlement rail built for machine cadence.
          </p>
        </div>

        <div className="flex items-center gap-3 mt-8">
          {flowSteps.map((step, i) => (
            <React.Fragment key={step}>
              <span className="font-mono text-[10px] tracking-widest text-vynx-muted">
                {step}
              </span>
              {i < flowSteps.length - 1 && (
                <span className="font-mono text-[12px] text-vynx-faint">→</span>
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 mt-8 border-t border-[var(--color-border)] pt-8">
          {frameStats.map((stat) => (
            <div key={stat.label}>
              <div className="font-display text-[40px] leading-none text-vynx-text">
                {stat.value}
              </div>
              <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-muted mt-2">
                {stat.label}
              </div>
              <div className="font-mono text-[10px] text-vynx-faint mt-1">
                {stat.sub}
              </div>
            </div>
          ))}
        </div>

        <Card goldBorder className="py-8 px-8 mt-8">
          <p className="font-body italic text-[15px] text-vynx-muted leading-relaxed">
            Humans tolerate thirty seconds and a wallet popup. An autonomous
            agent on a 200-millisecond decision cycle cannot. The rail it runs on
            was built for the first and breaks for the second. VynX is built for
            the second.
          </p>
          <div className="font-mono text-[10px] tracking-widest uppercase text-vynx-faint mt-4">
            THE FRAME · MACHINE CADENCE
          </div>
        </Card>
      </section>

      {/* ── How It Works · The Narrative ── */}
      <section id="how-it-works" className="mb-20">
        <SectionLabel>HOW IT WORKS</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          THE INTENT, FROM YOUR SIDE
        </h2>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          One intent, from the agent&rsquo;s side, in five steps. The order of
          operations is the safety argument: your capital never moves until a
          solver is contractually on the hook to deliver it.
        </p>

        <div className="mb-10">
          {cycle.map((step, i) => (
            <div
              key={step.label}
              className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 mb-6 items-start"
            >
              <span className="font-display text-[22px] text-vynx-faint leading-none pt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div className="font-mono text-[11px] tracking-[0.12em] text-vynx-gold uppercase mb-2">
                  {step.label}
                </div>
                <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed max-w-150">
                  {step.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-8">
          <AgentTimeline />
        </div>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-6 max-w-150">
          What can happen to your funds and what can never happen are two
          different lists. The second list is the one that matters before you
          sign.
        </p>

        <FundsSafetyBoundary />
      </section>

      {/* ── Best Execution · The Prize ── */}
      <section id="execution" className="mb-20">
        <SectionLabel>BEST EXECUTION</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          COMPETITION WORKS FOR YOU
        </h2>

        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            Zero gas, zero transactions. The winning solver bears all the gas;
            you never need ETH. The only transaction the protocol can ever
            require — the recovery refund — is permissionless, so any party can
            pay that gas if you cannot.
          </p>
          <p>
            Best execution is structural. Solvers compete to deliver you the
            most, so you receive the highest OutputAmount the field will quote,
            never below your minimum. The sealed-bid auction compresses the
            spread in your favor.
          </p>
          <p>
            Your all-in cost is the competitive spread, not a protocol rent. The
            10 bps take rate — capped immutably at 20 bps in the bytecode — is
            borne in the solver&rsquo;s economics, not billed to you separately.
          </p>
        </div>

        <AgentCostWaterfall />
      </section>

      {/* ── What You Sign · The Math ── */}
      <section id="what-you-sign" className="mb-20">
        <SectionLabel>WHAT YOU SIGN</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          ONE SIGNATURE, EIGHT TERMS
        </h2>
        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          Every intent is eight terms you sign as one EIP-3009 authorization; the
          authorization nonce is the keccak256 hash of all eight. A changed term
          breaks the recomputed nonce — the Relayer cannot alter what you signed.
          The on-chain lock re-derives the nonce and Circle&rsquo;s USDC verifies
          your signature. USDC is the only input; your minimum is your floor; the
          deadline is your clock; the authorization is single-use.
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
                      : "font-mono text-[12px] text-vynx-text"
                  }
                >
                  {row.field}
                </div>
                <div role="cell" className="font-mono text-[12px] text-vynx-muted">
                  {row.type}
                </div>
                <div role="cell" className="font-body text-[13px] text-vynx-muted">
                  {row.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Safety · The Honest Downside ── */}
      <section id="safety" className="mb-20">
        <SectionLabel>SAFETY</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          THE WORST CASE IS DELAY, NOT LOSS
        </h2>

        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            Settlement is atomic. You receive the output token, or you receive a
            full on-chain refund. There are no partial fills — there is no state
            in which you are left holding less than you signed for.
          </p>
          <p>
            The refund is permissionless. After the deadline plus a short grace
            period, any party can trigger it and return your funds to you. You
            never need ETH; it is the only transaction the protocol can require,
            and it always pays out to you.
          </p>
        </div>

        <div className="mb-8">
          <IntentStateMachine />
        </div>

        <div className="font-mono text-[10px] tracking-widest text-vynx-gold mb-3">
          HONEST EDGE · LIVENESS
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          The single Relayer is a liveness dependency. A down or withholding
          Relayer can delay settlement; it can never take your funds — your
          principal is recoverable through the permissionless refund. It is a
          liveness risk, not a custody one.
        </p>

        <div className="font-mono text-[10px] tracking-widest text-vynx-gold mb-3">
          HONEST EDGE · USDC COMPLIANCE LAYER
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          Outside the protocol, Circle&rsquo;s USDC can blacklist or pause an
          address. A blacklisted or paused address can leave funds temporarily
          immobile until Circle resolves it. The escrow state and balance stay
          intact — there is no silent loss.
        </p>

        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          Stage: VynX runs today on Base Sepolia testnet. The contracts are
          hardened against a formal internal threat model — the BLINDAJE program
          — but are not yet externally audited.
        </p>

        <Card>
          <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed">
            Read the model back: your funds do not move until a solver is on the
            hook, you receive your minimum or a full refund, and the only
            transaction the protocol can require from you is none. The worst case
            is delay, never loss of principal.
          </p>
        </Card>
      </section>

      {/* ── Integration · At Launch ── */}
      <section id="integration" className="mb-20">
        <SectionLabel>INTEGRATION</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          INTEGRATION IS ONE CALL
        </h2>

        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            Integration is light. At launch, one SDK call drives the whole
            lifecycle — sign, submit, settle, auto-refund. The SDK signs your
            authorization client-side and sends no swap-path transaction.
          </p>
          <p>
            Native, transaction-free adapters exist for Coinbase AgentKit and
            elizaOS, or you can drive any TypeScript agent directly. Each adapter
            exposes a single swap action over the same gasless flow.
          </p>
          <p>
            Base Sepolia testnet today; the SDK publishes to npm with pinned
            mainnet addresses at launch.
          </p>
        </div>

        <div className="border-t border-[var(--color-border)] pt-8 mb-8">
          <p className="font-mono text-[10px] tracking-widest text-vynx-faint mb-3">
            SDK · AT LAUNCH
          </p>
          <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] px-4 py-3">
            <span className="font-mono text-[13px] text-vynx-muted">
              npm install @vynx-network/sdk
            </span>
          </div>
          <p className="font-mono text-[10px] text-vynx-faint mt-3">
            Not installable today — published with pinned mainnet addresses at
            launch.
          </p>
        </div>

        <div className="border-t border-[var(--color-border)] pt-8">
          <p className="font-mono text-[10px] tracking-widest text-vynx-faint mb-6">
            EARLY ACCESS · BASE SEPOLIA TESTNET
          </p>
          <Button variant="primary" href="mailto:cristian@vynx.network">
            REQUEST EARLY ACCESS
          </Button>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mb-20">
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          FREQUENTLY ASKED QUESTIONS
        </h2>
        <FaqAccordion items={agentFaqItems} />
      </section>
    </DocsLayout>
  );
}
