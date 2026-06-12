import React from "react";
import DocsLayout from "@/components/layout/DocsLayout";
import DocsSidebar from "@/components/layout/DocsSidebar";
import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import CodeBlock from "@/components/ui/CodeBlock";
import FaqAccordion, { FaqItem } from "@/components/docs/FaqAccordion";
import AuctionTimeline from "@/components/docs/diagrams/AuctionTimeline";
import CollateralBands from "@/components/docs/diagrams/CollateralBands";
import JailLadder from "@/components/docs/diagrams/JailLadder";

export const metadata = {
  title: { absolute: "VynX · Solvers Program" },
  description:
    "Institutional Solver documentation. Economics, risk framework, and integration guide for VynX founding cohort.",
};

const solverNav = [
  {
    items: [
      { label: "Overview", href: "#overview" },
      { label: "Prerequisites", href: "#prerequisites" },
      { label: "Economics", href: "#economics" },
      { label: "Risk Framework", href: "#risk-framework" },
      { label: "Integration", href: "#integration" },
      { label: "SDK Reference", href: "#sdk-reference" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

const econColClass = "grid grid-cols-[160px_120px_1fr]";

const econRows = [
  {
    param: "Take Rate",
    value: "10 bps",
    desc: "Per successful intent. Atomically deducted.",
  },
  {
    param: "Bytecode Cap",
    value: "20 bps",
    desc: "Hard cap in bytecode. Immutable. Governance-proof.",
  },
  {
    param: "SlashAmount",
    value: "10%",
    desc: "InputAmount × 10%. 5% to agent, 5% to treasury.",
  },
  {
    param: "Unbonding Period",
    value: "7 days",
    desc: "Capital quarantined post-slash.",
  },
  {
    param: "MAX_EXPOSURE",
    value: "80%",
    desc: "Maximum in-flight exposure vs. locked collateral.",
  },
  {
    param: "AMNESTY_EPOCH",
    value: "90 days",
    desc: "N1–N4 Jail Time counters reset. N5 is permanent.",
  },
];

const jailColClass = "grid grid-cols-[80px_120px_1fr]";

const jailRows = [
  { n: "N1", time: "60s", trigger: "First SLA breach" },
  { n: "N2", time: "10 min", trigger: "Second breach (no amnesty reset)" },
  { n: "N3", time: "1 hour", trigger: "Third breach" },
  { n: "N4", time: "24 hours", trigger: "Fourth breach" },
];

const integrationSteps = [
  {
    num: "01",
    title: "DEPOSIT COLLATERAL",
    body: (
      <>
        Deposit USDC into the VynX DirectVaultAdapter on Ethereum L1 — direct
        custody, no yield protocol. Minimum: SHF ≥ 1.20× your expected in-flight
        exposure.
      </>
    ),
  },
  {
    num: "02",
    title: "REGISTER IN VYNXREGISTRY",
    body: (
      <>
        Call{" "}
        <span className="font-mono text-[13px] text-vynx-text">
          registerSolver()
        </span>{" "}
        on{" "}
        <span className="font-mono text-[13px] text-vynx-text">
          VynxRegistry.sol
        </span>{" "}
        on Ethereum L1. Your address is mapped to your Vault Adapter and
        collateral position.
      </>
    ),
  },
  {
    num: "03",
    title: "CONNECT TO RELAYER WEBSOCKET",
    body: (
      <>
        Establish a persistent WebSocket connection to the VynX Relayer. You
        will receive sealed intents via broadcast at auction open.
      </>
    ),
  },
  {
    num: "04",
    title: "IMPLEMENT BID LOGIC",
    body: (
      <>
        Respond with max(OutputAmount) within 200ms of broadcast. Tie-break:
        max(SHF). Last resort: FIFO timestamp.
      </>
    ),
  },
  {
    num: "05",
    title: "LOCK, THEN PAY",
    body: (
      <>
        On winning:{" "}
        <span className="font-mono text-[13px] text-vynx-text">auction_won</span>{" "}
        delivers the signed intent and the agent&rsquo;s authorization. Execute
        lockIntent() on Base from your own address — your transaction, your gas
        — within the 10 s SLA, then deliver the output to the agent on the
        destination chain. The witness validates token, recipient, and amount
        against the agent-signed terms after finality.
      </>
    ),
  },
  {
    num: "06",
    title: "CLAIM FUNDS",
    body: (
      <>
        Once the witness confirms your payment: redeem the relayer-signed
        voucher via{" "}
        <span className="font-mono text-[13px] text-vynx-text">claimFunds()</span>{" "}
        on{" "}
        <span className="font-mono text-[13px] text-vynx-text">
          VynxSettlement.sol
        </span>
        . The contract cross-references intentId. Math irrefutable → funds move.
      </>
    ),
  },
];

const faqItems: FaqItem[] = [
  {
    q: "What collateral is accepted?",
    a: "Only USDC. The Asymmetric Asset Policy eliminates oracle dependency — SHF is a big.Int integer comparison in microseconds.",
  },
  {
    q: "Can I exit my collateral position at any time?",
    a: "After the 7-day unbonding period. There is no instant exit. This is a feature — it guarantees agent compensation on Deadline breach.",
  },
  {
    q: "What happens if I miss the 200ms window?",
    a: "Your bid is discarded. No penalty. Jail Time only triggers on SLA breach — your lock not landing within 10 seconds of adjudication.",
  },
  {
    q: "Is there a minimum collateral amount?",
    a: "No hard minimum in the protocol. Practical minimum: enough to maintain SHF ≥ 1.20× on your expected in-flight exposure, with MAX_EXPOSURE ≤ 80%.",
  },
];

const flowSteps = ["BROADCAST", "BID", "LOCK", "CLAIM"];

const prereqs = [
  {
    title: "USDC COLLATERAL",
    sub: "Deposited in the VynX DirectVaultAdapter (USDC, Ethereum L1)",
  },
  { title: "SHF ≥ 1.20×", sub: "Maintained at all times" },
  {
    title: "MAX_SOLVER_EXPOSURE ≤ 80%",
    sub: "Maximum in-flight exposure at all times",
  },
  {
    title: "200MS WEBSOCKET INFRASTRUCTURE",
    sub: "Capable of responding within the auction window",
  },
];

export default function SolversPage() {
  return (
    <DocsLayout
      sidebar={<DocsSidebar title="SOLVERS PROGRAM" sections={solverNav} />}
    >
      {/* ── Overview ── */}
      <section id="overview" className="mb-20">
        <SectionLabel>OVERVIEW</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          WHAT IS A SOLVER
        </h2>
        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
          <p>
            Solvers are the institutional supply side of the VynX OFA. A Solver
            is a market maker that competes in sealed-bid auctions to fill agent
            intents. The Solver with the highest OutputAmount wins each auction
            and earns the spread between their bid and the agent&rsquo;s
            minimum. The winning Solver executes the origin lock from its own
            address and bears all gas; the agent&rsquo;s eight terms are bound
            by one signature and cannot be altered.
          </p>
          <p>
            Participation requires locking USDC collateral above the SHF
            threshold (≥ 1.20×), maintaining exposure limits, and operating
            WebSocket infrastructure capable of responding within the 200ms
            auction window.
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

        <div className="mt-8">
          <AuctionTimeline />
        </div>
      </section>

      {/* ── Prerequisites ── */}
      <section id="prerequisites" className="mb-20">
        <SectionLabel>PREREQUISITES</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          ENTRY REQUIREMENTS
        </h2>
        <div>
          {prereqs.map((item) => (
            <div
              key={item.title}
              className="grid grid-cols-[20px_minmax(0,1fr)] gap-4 items-start py-4 border-b border-[var(--color-border)]"
            >
              <span className="font-mono text-[14px] text-vynx-gold">✓</span>
              <div>
                <div className="font-mono text-[12px] tracking-wide text-vynx-text uppercase">
                  {item.title}
                </div>
                <div className="font-body text-[13px] text-vynx-muted mt-1">
                  {item.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Economics ── */}
      <section id="economics" className="mb-20">
        <SectionLabel>ECONOMICS</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          SOLVER ECONOMICS
        </h2>

        <div className="overflow-x-auto">
          <div role="table" className="w-full min-w-120">
            <div
              role="row"
              className={`${econColClass} border-b border-[var(--color-border)] pb-3`}
            >
              {["PARAMETER", "VALUE", "DESCRIPTION"].map((h) => (
                <div
                  key={h}
                  role="columnheader"
                  className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
                >
                  {h}
                </div>
              ))}
            </div>
            {econRows.map((row) => (
              <div
                key={row.param}
                role="row"
                className={`${econColClass} border-b border-[var(--color-border)] py-4 items-center`}
              >
                <div role="cell" className="font-mono text-[12px] text-vynx-text">
                  {row.param}
                </div>
                <div
                  role="cell"
                  className="font-display text-[18px] text-vynx-text leading-none"
                >
                  {row.value}
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

        <Card className="mt-6">
          <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed">
            The agent prioritizes sub-second settlement over marginal cost. The
            Solver has already internalized the take rate in the bid spread. The
            bytecode hard cap cryptographically guarantees governance cannot be
            predatory.
          </p>
        </Card>

        <div className="font-mono text-[10px] tracking-widest text-vynx-faint mt-12 mb-6">
          ELIGIBILITY MATH · SOLVER HEALTH FACTOR
        </div>
        <CollateralBands />
      </section>

      {/* ── Risk Framework ── */}
      <section id="risk-framework" className="mb-20">
        <SectionLabel>RISK FRAMEWORK</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          PENALTY MECHANICS
        </h2>

        <div className="font-mono text-[10px] tracking-widest text-vynx-faint mb-3">
          JAIL TIME · SLA BREACH · T = 10s
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-6">
          If the origin lock —{" "}
          <span className="font-mono text-[13px] text-vynx-text">lockIntent()</span>{" "}
          — does not land within 10 seconds of adjudication, the winning Solver
          receives a Jail Time penalty. The counter escalates with each breach
          and resets after 90 days (N1–N4 only).
        </p>

        <div className="mb-6">
          <JailLadder />
        </div>

        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-6 max-w-140">
          Timeouts within 30 seconds of a prior timeout for the same Solver
          count as a single incident — one network blip does not climb the
          ladder five times. A missed Deadline is never grouped: it is always a
          clean, standalone fault.
        </p>

        <div className="overflow-x-auto">
          <div role="table" className="w-full min-w-90 mb-4">
            <div
              role="row"
              className={`${jailColClass} border-b border-[var(--color-border)] pb-3`}
            >
              {["N", "JAIL TIME", "TRIGGER"].map((h) => (
                <div
                  key={h}
                  role="columnheader"
                  className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
                >
                  {h}
                </div>
              ))}
            </div>
            {jailRows.map((row) => (
              <div
                key={row.n}
                role="row"
                className={`${jailColClass} border-b border-[var(--color-border)] py-4 items-center`}
              >
                <div role="cell" className="font-mono text-[12px] text-vynx-text">
                  {row.n}
                </div>
                <div
                  role="cell"
                  className="font-mono text-[12px] text-vynx-muted"
                >
                  {row.time}
                </div>
                <div
                  role="cell"
                  className="font-body text-[13px] text-vynx-muted"
                >
                  {row.trigger}
                </div>
              </div>
            ))}
            {/* N5 row — gold highlight */}
            <div
              role="row"
              className={`${jailColClass} border border-[var(--color-border-gold)] rounded-[2px] py-4 px-3 mt-2 items-center`}
            >
              <div role="cell" className="font-mono text-[12px] text-vynx-text">
                N5
              </div>
              <div role="cell" className="font-mono text-[12px] text-vynx-gold">
                Permanent
              </div>
              <div
                role="cell"
                className="font-body text-[13px] text-vynx-muted"
              >
                Fifth breach — amnesty-immune
              </div>
            </div>
          </div>
        </div>

        <div className="font-mono text-[10px] tracking-widest text-vynx-faint mb-3 mt-8">
          SLASH · DEADLINE BREACH · T = 15 MIN
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-6">
          If settlement is not completed within the agent&rsquo;s 15-minute
          deadline, a deterministic slash is applied. No oracle. No human
          discretion. The arithmetic is enforced by{" "}
          <span className="font-mono text-[13px] text-vynx-text">
            VynxRegistry.sol
          </span>{" "}
          on Ethereum L1.
        </p>

        <CodeBlock
          code={
            "SlashAmount = InputAmount × 10%\n→ 5% to Agent (compensation)\n→ 5% to VynX Treasury"
          }
        />

        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mt-6">
          Slashing executes through the DirectVaultAdapter on Ethereum L1 —
          direct USDC custody, no yield protocol. The 7-day unbonding period
          quarantines capital during resolution.
        </p>
      </section>

      {/* ── Integration ── */}
      <section id="integration" className="mb-20">
        <SectionLabel>INTEGRATION</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          INTEGRATION GUIDE
        </h2>

        {integrationSteps.map((step) => (
          <div
            key={step.num}
            className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 mb-8 items-start"
          >
            <span className="font-display text-[28px] text-vynx-faint leading-none">
              {step.num}
            </span>
            <div>
              <div className="font-mono text-[11px] tracking-wide text-vynx-muted uppercase mb-2">
                {step.title}
              </div>
              <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed">
                {step.body}
              </p>
            </div>
          </div>
        ))}

        <div className="font-mono text-[10px] tracking-widest text-vynx-faint mt-12 mb-6">
          WEBSOCKET PUSH PROTOCOL
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-6 max-w-140">
          Polling cannot meet the 200ms window — by the time a poll returns, the
          auction has closed. Connect to{" "}
          <span className="font-mono text-[13px] text-vynx-text">/v1/ws</span> and
          identify with{" "}
          <span className="font-mono text-[13px] text-vynx-text">?solver=0x…</span>.
          The Relayer broadcasts{" "}
          <span className="font-mono text-[13px] text-vynx-text">
            intent_announced
          </span>{" "}
          to every connected Solver the moment an intent is accepted — before
          the window opens — and unicasts{" "}
          <span className="font-mono text-[13px] text-vynx-text">auction_won</span>{" "}
          to the winner once the auction concludes.
        </p>

        <CodeBlock
          language="json"
          label="PUSH FRAMES"
          code={`// broadcast to all solvers, before the 200ms window
{
  "type":              "intent_announced",
  "intentId":          "0x…",
  "inputAmount":       "100000000",
  "inputToken":        "0x…",
  "originChainId":     8453,
  "targetToken":       "0x…",
  "targetChainId":     1,
  "auctionDeadlineMs": 1700000000000
}

// unicast to the winning solver, after adjudication
{
  "type":          "auction_won",
  "intentId":      "0x…",
  "winningAmount": "102000000",
  "slaExpiry":     1700000500
}`}
        />
      </section>

      {/* ── SDK Reference ── */}
      <section id="sdk-reference" className="mb-20">
        <SectionLabel>SDK REFERENCE</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          @VYNX/SDK
        </h2>

        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-[13px] text-vynx-text">
            @vynx-network/sdk
          </span>
          <a
            href="mailto:cristian@vynx.network"
            className="font-mono text-[12px] text-vynx-gold hover:text-vynx-text transition-colors duration-200"
          >
            REQUEST SDK ACCESS
          </a>
        </div>

        <CodeBlock
          language="bash"
          label="INSTALL · AT LAUNCH"
          code="npm install @vynx-network/sdk"
        />

        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mt-6">
          The SDK signs the agent&rsquo;s EIP-3009 authorization client-side;
          there is no relayer-signed intent. The eight terms are agent-signed
          and verified by USDC inside lockIntent(). Solvers do not need the SDK
          — it is the agent-side integration layer. Solver integration is at the
          WebSocket and contract level only.
        </p>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mb-20">
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          FREQUENTLY ASKED QUESTIONS
        </h2>
        <FaqAccordion items={faqItems} />
      </section>

      {/* ── CTA ── */}
      <div className="mt-24 pt-12 border-t border-[var(--color-border)]">
        <p className="font-mono text-[10px] tracking-widest text-vynx-faint mb-6">
          FOUNDING COHORT · LIMITED POSITIONS
        </p>
        <Button variant="primary" href="mailto:cristian@vynx.network">
          APPLY AS FOUNDING SOLVER
        </Button>
      </div>
    </DocsLayout>
  );
}
