import React from "react";
import DocsLayout from "@/components/layout/DocsLayout";
import DocsSidebar from "@/components/layout/DocsSidebar";
import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FaqAccordion, { FaqItem } from "@/components/docs/FaqAccordion";
import AuctionTimeline from "@/components/docs/diagrams/AuctionTimeline";
import CollateralBands from "@/components/docs/diagrams/CollateralBands";
import JailLadder from "@/components/docs/diagrams/JailLadder";
import TrustBoundary from "@/components/docs/diagrams/TrustBoundary";
import MarginWaterfall from "@/components/docs/diagrams/MarginWaterfall";

export const metadata = {
  title: { absolute: "VynX · Solvers" },
  description:
    "The solver role in VynX: a 200ms sealed-bid order-flow auction, origin-locked settlement, the economics, and the risk model. Founding-cohort access.",
};

const solverNav = [
  {
    items: [
      { label: "Overview", href: "#overview" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "Economics", href: "#economics" },
      { label: "Collateral", href: "#collateral" },
      { label: "Risk", href: "#risk" },
      { label: "Founding Cohort", href: "#cohort" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

const flowSteps = ["BROADCAST", "BID", "LOCK", "CLAIM"];

const frameStats = [
  { value: "~90%", label: "UNISWAPX", sub: "Top 3 fillers" },
  { value: "50–60%", label: "COW PROTOCOL", sub: "Top 3 solvers" },
  { value: "80%", label: "1INCH FUSION", sub: "Top 3 MMs" },
];

const frameStatClasses = [
  "py-6 md:pr-8 border-b border-[var(--color-border)] md:border-b-0 md:border-r",
  "py-6 md:px-8 border-b border-[var(--color-border)] md:border-b-0 md:border-r",
  "py-6 md:pl-8",
];

const cycle = [
  {
    label: "THE AUCTION",
    body: (
      <>
        Each intent opens a 200ms sealed-bid window. You bid an OutputAmount;
        the highest bid wins. Ties break to the higher Solver Health Factor,
        then to the earlier timestamp.
      </>
    ),
  },
  {
    label: "WINNING & ACKNOWLEDGEMENT",
    body: (
      <>
        Your 10-second lock clock starts only when you acknowledge the win — not
        when the auction closes. A win you never acknowledge is re-auctioned to
        the next bid; you are never penalized for a fill you did not commit to.
        This is the most solver-favorable rule in the protocol.
      </>
    ),
  },
  {
    label: "THE ORIGIN LOCK",
    body: (
      <>
        You lock the agent&rsquo;s capital on Base before you commit a unit of
        your own liquidity on the destination. The agent&rsquo;s USDC is
        escrowed on-chain before you pay anything. A rug-pull on the solver is
        mathematically impossible.
      </>
    ),
  },
  {
    label: "FULFILMENT & WITNESS",
    body: (
      <>
        You pay the agent on the destination chain. An independent witness then
        validates token, recipient, and amount against the agent-signed terms,
        after chain finality. Your claim never depends on trust in the
        counterparty.
      </>
    ),
  },
  {
    label: "THE CLAIM",
    body: (
      <>
        Once witnessed, you redeem the EIP-712 voucher and receive the
        agent&rsquo;s locked input minus the take rate. The voucher binds your
        address and the exact amount; it cannot be redirected.
      </>
    ),
  },
];

const faqItems: FaqItem[] = [
  {
    q: "What must a Solver trust the Relayer for — and what can it never do?",
    a: "The Relayer adjudicates the auction, witnesses the destination payment, and relays the EIP-712 voucher that releases your claim. It can never alter the agent's eight signed terms — any change breaks the EIP-3009 nonce and USDC rejects the lock — redirect funds, since the voucher binds intentId, solver, and amount and the agent's refund is permissionless, or slash you unilaterally, since a slash requires both the keeper role and an independent, immutable attester. It cannot sign vouchers itself: signing is isolated in a separate Signer holding its own key. VynX is trust-minimized for terms and funds — it does not ask you to trust the Relayer with either; the single Relayer is a liveness dependency, not a custodian.",
  },
  {
    q: "If the Relayer is unresponsive after I have paid on the destination chain, what happens to my capital?",
    a: "Voucher issuance depends on Relayer liveness — this is the honest hard edge. The Relayer cannot misdirect your voucher; it binds your address and the exact amount, and on recovery the deterministic witness re-issues it. The worst case is a prolonged outage past the 15-minute deadline after you have fulfilled: the agent is refunded on-chain and your destination capital is exposed until the Relayer resumes. Per-intent exposure is bounded by the $50–$500 ticket, and Relayer high-availability is part of the operational posture discussed with founding partners.",
  },
  {
    q: "Are the contracts audited?",
    a: "The contracts are hardened against a formal internal threat model — the BLINDAJE program — but are not yet externally audited. An external audit is a gate before mainnet. Founding-cohort integration runs on Base Sepolia testnet.",
  },
  {
    q: "Can I be slashed unfairly, or griefed by the penalty system?",
    a: "No discretionary slashing exists. A slash is deterministic — InputAmount × 10%, split 5% to the affected agent and 5% to the treasury — fires at most once per intent, and only after you have locked an intent and missed its 15-minute settlement deadline. It requires two independent signatures, the keeper and an immutable attester, so no single party can slash, inflate, or redirect it. Your 10-second lock SLA arms only when you acknowledge the win, so you are never penalized for a fill you do not control.",
  },
  {
    q: "Why can't an incumbent simply clone the 200ms auction?",
    a: "The auction is the visible primitive, not the moat. The defensible parts are the gasless, origin-locked settlement design and the go-to-market: VynX captures the same institutional solvers who already concentrate the existing rails rather than recruiting a new supply side. Reproducing a sealed-bid window does not reproduce the settlement system or the flow.",
  },
  {
    q: "Which chains must I support, and how heavy is integration?",
    a: "Five destinations — Base, Ethereum, Arbitrum, Optimism, and Polygon. Integration is at the WebSocket and contract level; solvers do not use the agent SDK. A reference solver implementation is provided to cohort partners.",
  },
  {
    q: "What is the path to mainnet and real volume?",
    a: "Testnet today; an external audit, pinned mainnet addresses, and a published SDK at launch; then the founding cohort goes live.",
  },
];

export default function SolversPage() {
  return (
    <DocsLayout
      sidebar={<DocsSidebar title="SOLVERS PROGRAM" sections={solverNav} />}
    >
      {/* ── Overview · The Frame ── */}
      <section id="overview" className="mb-20">
        <SectionLabel>OVERVIEW</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          THE SUPPLY SIDE OF THE AUCTION
        </h2>
        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
          <p>
            A Solver is an institutional market maker that competes in a 200ms
            sealed-bid order-flow auction to fill agent intents. The highest
            OutputAmount wins. The winner locks the origin on Base from its own
            address, bears the gas, fulfils on the destination chain, and
            redeems a voucher for the agent&rsquo;s locked USDC minus the take
            rate.
          </p>
          <p>
            The supply side is already concentrated. Three to five names clear
            the majority of every existing intent rail. VynX does not recruit a
            new supply side; it captures the one that exists.
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

        <div className="grid grid-cols-1 md:grid-cols-3 mt-8">
          {frameStats.map((stat, i) => (
            <div key={stat.label} className={frameStatClasses[i]}>
              <div className="font-display text-[48px] leading-none text-vynx-text">
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
            If Wintermute does not lock, GSR captures the share. If GSR does not
            lock, the next name does. The equilibrium is competitive
            overcollateralization, and a founding-cohort seat is the position on
            offer — not a signup.
          </p>
          <div className="font-mono text-[10px] tracking-widest uppercase text-vynx-faint mt-4">
            NASH EQUILIBRIUM · THE SUPPLY SIDE
          </div>
        </Card>
      </section>

      {/* ── How Settlement Works · The Narrative ── */}
      <section id="how-it-works" className="mb-20">
        <SectionLabel>HOW IT WORKS</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          THE SETTLEMENT CYCLE
        </h2>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          One intent, from the solver&rsquo;s side, in five steps. The order of
          operations is the whole safety argument: the agent&rsquo;s capital is
          locked on-chain before you part with any of your own.
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
          <AuctionTimeline />
        </div>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-6 max-w-150">
          What the Relayer orchestrates and what it can never touch are two
          different lists. The second list is the one that matters to a solver.
        </p>

        <TrustBoundary />
      </section>

      {/* ── Economics · The Prize ── */}
      <section id="economics" className="mb-20">
        <SectionLabel>ECONOMICS</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          THE SPREAD IS THE PRIZE
        </h2>

        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            VynX takes 10 bps on a successful intent, deducted atomically at
            settlement. The bytecode caps the take rate at 20 bps — an immutable
            ceiling no governance can raise. The 10 bps in force today is the
            configurable value beneath that cap, not the cap itself.
          </p>
          <p>
            Your fee is not the protocol&rsquo;s fee. A solver&rsquo;s gross is
            the spread between what it claims — the agent&rsquo;s input minus the
            10 bps take rate — and what it delivers as its winning bid, less
            destination gas and the cost of capital in flight. The sealed-bid
            auction compresses that spread toward marginal cost: every basis
            point you keep is one a rival can bid away.
          </p>
          <p>
            Tickets run $50 to $500 USDC per intent. The book is small-ticket
            and high-frequency — an inventory and latency problem, not a
            balance-sheet one.
          </p>
        </div>

        <MarginWaterfall />
      </section>

      {/* ── Collateral & Eligibility · The Math ── */}
      <section id="collateral" className="mb-20">
        <SectionLabel>COLLATERAL</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          ELIGIBILITY IS ARITHMETIC
        </h2>

        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            Collateral is USDC, held in direct custody on Ethereum L1 through the
            DirectVaultAdapter. No external protocol sits beneath it; the capital
            stays slashable on the spot.
          </p>
          <p>
            To bid, your free collateral must cover the intent at a Solver Health
            Factor of 1.20× or higher. The check is a USDC integer comparison —
            no oracle, no price feed, no conversion. It either holds or it does
            not.
          </p>
          <p>
            In-flight exposure may never reach 80% of locked collateral. The 20%
            reserve is the buffer that keeps an open position able to be made
            whole.
          </p>
        </div>

        <CollateralBands />
      </section>

      {/* ── Risk & Penalties · The Honest Downside ── */}
      <section id="risk" className="mb-20">
        <SectionLabel>RISK</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          EVERY PENALTY IS EARNED
        </h2>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          VynX penalizes two things, and only two. Both are actions a solver
          chooses, never an outcome it cannot control.
        </p>

        <div className="font-mono text-[10px] tracking-widest text-vynx-gold mb-3">
          JAIL TIME · MISSED LOCK
        </div>
        <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mb-8 max-w-150">
          Jail Time penalizes a missed lock. Your 10-second lock clock arms when
          you acknowledge the win; if the lock does not land inside that window,
          the reputation ladder escalates — 60s, 10min, 1h, 24h, then permanent.
          A win you never acknowledge is re-auctioned, never jailed.
        </p>

        <div className="mb-8">
          <JailLadder />
        </div>

        <div className="font-mono text-[10px] tracking-widest text-vynx-gold mb-3">
          SLASH · MISSED DEADLINE
        </div>
        <div className="space-y-4 font-body font-light text-[14px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            SlashAmount penalizes a missed deadline. A locked intent left
            unsettled past the agent&rsquo;s 15-minute deadline is refunded to
            the agent permissionlessly, the solver is slashed 10% of the
            InputAmount, and the same breach jails the solver at level 3 or
            higher. The slash and the jail are not alternatives; a missed
            deadline carries both.
          </p>
          <p>
            The slash is deterministic: InputAmount × 10%, split 5% to the
            affected agent and 5% to the treasury, at most once per intent. It
            requires two independent signatures — the keeper role and an
            immutable attester — so no single party can trigger, inflate, or
            redirect it. It executes on Ethereum L1 through{" "}
            <span className="font-mono text-[13px] text-vynx-text">
              VynxRegistry.sol
            </span>
            . No oracle, no discretion.
          </p>
          <p>
            Exit is a 7-day, two-phase deregister, not an instant withdrawal.
            The delay is deliberate: it keeps capital slashable through every
            open position and closes the deregister-and-dodge path. It is the
            agent&rsquo;s guarantee, not the solver&rsquo;s tax.
          </p>
        </div>

        <Card>
          <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed">
            Read the model back: the auction costs nothing to lose, the lock SLA
            arms on your own acknowledgement, and the slash fires only on a
            deadline you accepted. Every penalty targets an action you could
            take.
          </p>
        </Card>
      </section>

      {/* ── Founding Cohort · The Hook ── */}
      <section id="cohort" className="mb-20">
        <SectionLabel>FOUNDING COHORT</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          THE FOUNDING COHORT
        </h2>

        <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 mb-8">
          <p>
            VynX runs today on Base Sepolia testnet. The contracts are hardened
            against a formal internal threat model — the BLINDAJE program — but
            are not yet externally audited. An external audit, pinned mainnet
            addresses, and a published SDK arrive at launch.
          </p>
          <p>
            The cohort is selective. VynX qualifies the partner, not the reverse
            — the supply side it wants is already named. A reference solver
            implementation exists; it is delivered privately to committed
            partners, alongside the protocol specification and testnet
            credentials, not published.
          </p>
          <p>
            Integration is at the WebSocket and contract level; solvers do not
            use the agent SDK. The five destinations are Base, Ethereum,
            Arbitrum, Optimism, and Polygon.
          </p>
        </div>

        <div className="border-t border-[var(--color-border)] pt-8">
          <p className="font-mono text-[10px] tracking-widest text-vynx-faint mb-6">
            INTEGRATION PACKET · DELIVERED PRIVATELY TO COMMITTED PARTNERS
          </p>
          <Button variant="primary" href="mailto:cristian@vynx.network">
            JOIN THE FOUNDING-SOLVER COHORT
          </Button>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mb-20">
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="font-display text-[36px] leading-none text-vynx-text mb-8">
          FREQUENTLY ASKED QUESTIONS
        </h2>
        <FaqAccordion items={faqItems} />
      </section>
    </DocsLayout>
  );
}
