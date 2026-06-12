import ThesisHeader from "@/components/thesis/ThesisHeader";
import ThesisSection from "@/components/thesis/ThesisSection";
import ThesisGate from "@/components/thesis/ThesisGate";
import LatencyTable from "@/components/landing/LatencyTable";
import Card from "@/components/ui/Card";
import DocsLayout from "@/components/layout/DocsLayout";
import DocsSidebar from "@/components/layout/DocsSidebar";

export const metadata = {
  title: { absolute: "VynX · Network Thesis" },
  description:
    "The M2M settlement layer for the agentic economy on Base. Public thesis: §1–§4.",
};

const spamStats = [
  { value: "56%", label: "BASE GAS CONSUMED BY SPAM BOTS" },
  { value: "14%", label: "FEES PAID BY THAT SPAM" },
  { value: "26%", label: "BASE DA BURNED ON SPAM" },
  { value: "50%", label: "BLOCK CAPACITY ON ARBITRAGE SPAM" },
  { value: "6×", label: "EXTERNALITY ON ORGANIC USER" },
  { value: "2", label: "ENTITIES CONCENTRATING SPAM (80%+)" },
];

const archColClass = "grid grid-cols-[120px_80px_1fr_100px]";

const archConstants = [
  {
    constant: "OFA_WINDOW",
    value: "200ms",
    desc: "Sealed-bid auction window. Immovable.",
    module: "RELAYER",
  },
  {
    constant: "SLA_COMMIT_TIMEOUT",
    value: "10s",
    desc: "Maximum Origin Lock latency.",
    module: "RELAYER",
  },
  {
    constant: "DEFAULT_DEADLINE",
    value: "15min",
    desc: "Agent macro shield. Unilateral refund.",
    module: "SETTLEMENT",
  },
  {
    constant: "SHF_THRESHOLD",
    value: "1.20×",
    desc: "Minimum Solver overcollateralization.",
    module: "REGISTRY (L1)",
  },
];

const oligColClasses = [
  "py-6 md:pr-8 border-b md:border-b-0 md:border-r border-[var(--color-border)]",
  "py-6 md:px-8 border-b md:border-b-0 md:border-r border-[var(--color-border)]",
  "py-6 md:pl-8",
];

const oligStats = [
  {
    value: "~90%",
    label: "UNISWAPX",
    sublabel: "Top 3 fillers. Wintermute + Rizzolver ≈ 60%.",
    source: "FLASHBOTS · DEC 2023",
  },
  {
    value: "50–60%",
    label: "COW PROTOCOL",
    sublabel: "Top 3 solvers. Barter alone = 28.2%.",
    source: "BLOCKWORKS · DL NEWS",
  },
  {
    value: "80%",
    label: "1INCH FUSION",
    sublabel: "Top 3 institutional MMs.",
    source: "MINT VENTURES · 2025",
  },
];

const revenueColClasses = [
  "py-6 md:pr-8 border-b md:border-b-0 md:border-r border-[var(--color-border)]",
  "py-6 md:px-8 border-b md:border-b-0 md:border-r border-[var(--color-border)]",
  "py-6 md:pl-8",
];

const revenueStats = [
  { value: "40%", label: "REAL YIELD", sublabel: "USDC · StakingRewards" },
  { value: "50%", label: "BUYBACK & BURN", sublabel: "manual · anti-MEV" },
  { value: "10%", label: "POL", sublabel: "operational treasury" },
];

const chains = [
  { name: "Base", id: "8453", isBase: true },
  { name: "Ethereum", id: "1", isBase: false },
  { name: "Arbitrum", id: "42161", isBase: false },
  { name: "Optimism", id: "10", isBase: false },
  { name: "Polygon", id: "137", isBase: false },
];

const ultimatumStats = [
  {
    value: "$80.25M",
    label: "VIRTUALS TVL",
    sub: "~1M JOBS COMPLETED — organic volume already on Base.",
  },
  {
    value: "$30T",
    label: "AGENTIC ECONOMY TAM",
    sub: "GARTNER 2030 — 1% capture = $300B in annual settlement.",
  },
  {
    value: "56%",
    label: "BASE GAS BURNED IN SPAM",
    sub: "Immediate headroom when replaced by settlement infrastructure.",
  },
  {
    value: "0",
    label: "M2M-NATIVE INCUMBENTS",
    sub: "CoW and UniswapX are organically incompatible with AI flow.",
  },
];

const thesisNav = [
  {
    title: "THE AXIOM AND THE STRUCTURAL COLLAPSE",
    items: [
      { label: "The Axiom", href: "#s1-1" },
      { label: "The Collapse", href: "#s1-2" },
      { label: "The Cancer", href: "#s1-3" },
    ],
  },
  {
    title: "PHYSICAL DETERMINISM",
    items: [
      { label: "Asymmetric Architecture", href: "#s2-1" },
      { label: "The Auction", href: "#s2-2" },
      { label: "The Origin Lock", href: "#s2-3" },
      { label: "Asymmetric Slashing", href: "#s2-4" },
    ],
  },
  {
    title: "THE INSTITUTIONAL LIQUIDITY TRAP",
    items: [
      { label: "The Oligopoly", href: "#s3-1" },
      { label: "The Moat · SHF", href: "#s3-2" },
      { label: "Inelastic Take Rate", href: "#s3-3" },
    ],
  },
  {
    title: "THE TROJAN HORSE ON BASE",
    items: [
      { label: "Distribution", href: "#s4-1" },
      { label: "The Ultimatum", href: "#s4-2" },
    ],
  },
];

export default function ThesisPage() {
  return (
    <main className="bg-vynx-bg">
      <DocsLayout
        sidebar={<DocsSidebar title="NETWORK THESIS" sections={thesisNav} />}
      >
        <ThesisHeader />

        {/* ── PAGE 01 ── */}
        <ThesisSection
          id="page-01"
          title="THE AXIOM AND THE STRUCTURAL COLLAPSE"
        >
          {/* §1.1 */}
          <section id="s1-1" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE AXIOM
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
              <p>
                DeFi was designed for humans. Humans tolerate 30 seconds of
                waiting, confirm in popups, negotiate slippage. Agents do not.
              </p>
              <p>
                2–3 transactions per day is the pulse of the median retail user
                on Base. 100–1,000× that ratio is the pulse of the active
                agentic decile. The infrastructure was not designed for this.
                The infrastructure is breaking.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-8">
              {[
                { value: "17,000", label: "AGENTS ON BASE" },
                { value: "~1,000,000", label: "JOBS COMPLETED" },
                { value: "$466M", label: "AGENTIC GDP" },
                { value: "$80.25M", label: "VIRTUALS TVL" },
              ].map((s) => (
                <Card key={s.label} className="p-4">
                  <div className="font-display text-[28px] text-white leading-none">
                    {s.value}
                  </div>
                  <div className="font-mono text-[10px] tracking-wide text-vynx-muted mt-1">
                    {s.label}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {/* §1.2 */}
          <section id="s1-2" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE COLLAPSE
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8">
              <p>
                Every incumbent intent rail shares a structural defect: the
                latency floor is institutional, not physical. CoW Protocol
                batches settle in 30 seconds — not because cryptography demands
                it, but because the batch auction was designed for human
                tolerance. UniswapX Dutch auctions run up to 60 seconds at tail.
                Stargate V2 recorded a mean settlement of 498.7 seconds in its
                V1 cohort.
              </p>
              <p>
                An agent with a 200-millisecond decision cycle cannot operate on
                infrastructure with a 30-second floor. The mismatch is not a
                product gap. It is an architectural incompatibility.
              </p>
            </div>
            <LatencyTable />
          </section>

          {/* §1.3 */}
          <section id="s1-3" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE CANCER
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 my-8">
              {spamStats.map((s) => (
                <Card key={s.label} className="p-4">
                  <div className="font-display text-[32px] text-white leading-none">
                    {s.value}
                  </div>
                  <div className="font-mono text-[10px] tracking-wide text-vynx-muted mt-1">
                    {s.label}
                  </div>
                </Card>
              ))}
            </div>

            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
              <p>
                The public mempool is a killing field. Private routing has
                become a parasitic tax. No incremental fix exists. The
                post-signature exposure architecture is the defect. It must be
                replaced.
              </p>
            </div>
          </section>
        </ThesisSection>

        {/* ── PAGE 02 ── */}
        <ThesisSection id="page-02" title="PHYSICAL DETERMINISM">
          {/* §2.1 */}
          <section id="s2-1" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              ASYMMETRIC ARCHITECTURE
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8">
              <p>
                VynX is not faster DeFi. It is different DeFi — designed from
                the constraint up. Four immutable constants govern every
                settlement. No governance can modify them after deployment. No
                Solver can negotiate around them. The architecture is the
                guarantee.
              </p>
            </div>

            <div className="overflow-x-auto">
              <div role="table" className="w-full min-w-125">
                <div
                  role="row"
                  className={`${archColClass} border-b border-(--color-border) pb-3`}
                >
                  {["CONSTANT", "VALUE", "DESCRIPTION", "MODULE"].map((h) => (
                    <div
                      key={h}
                      role="columnheader"
                      className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {archConstants.map((row) => (
                  <div
                    key={row.constant}
                    role="row"
                    className={`${archColClass} border-b border-(--color-border) py-4 items-center`}
                  >
                    <div
                      role="cell"
                      className="font-mono text-[12px] text-white"
                    >
                      {row.constant}
                    </div>
                    <div
                      role="cell"
                      className="font-display text-[18px] text-white leading-none"
                    >
                      {row.value}
                    </div>
                    <div
                      role="cell"
                      className="font-body text-[13px] text-vynx-muted"
                    >
                      {row.desc}
                    </div>
                    <div
                      role="cell"
                      className="font-mono text-[10px] text-vynx-faint"
                    >
                      {row.module}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* §2.2 */}
          <section id="s2-2" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE AUCTION
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
              <p>
                When an agent submits an intent, the Relayer broadcasts a
                WebSocket message to all registered Solvers simultaneously. The
                auction window is exactly 200 milliseconds. Winner is determined
                by max(OutputAmount) — the Solver who returns the most to the
                agent. No Dutch curve. No time advantage for incumbents.
              </p>
              <p>
                This is a structural departure from Dutch auctions (which reward
                patience over efficiency) and batch auctions (which aggregate
                latency across all participants). The sealed-bid format creates
                a single, repeatable, verifiable clearing event. Every intent
                settles identically.
              </p>
              <p>
                The 200ms window is not a soft guideline. It is encoded in
                contract state. A Solver who submits outside the window is
                ineligible for the reward. The physics are immutable.
              </p>
            </div>
          </section>

          {/* §2.3 */}
          <section id="s2-3" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE ORIGIN LOCK
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-6">
              <p>
                The winning Solver executes{" "}
                <span className="font-mono text-[13px] text-white">
                  lockIntent()
                </span>{" "}
                on VynxSettlement.sol from its own address, presenting the
                agent&rsquo;s signed authorization. The eight trade terms are
                bound by the agent&rsquo;s EIP-3009 signature — the Relayer
                cannot alter them; any change breaks the recomputed nonce and
                Circle&rsquo;s USDC rejects the lock. The call locks the
                agent&rsquo;s capital on Base before any destination-chain
                payment is made. The Origin Lock is the trust-minimized, atomic
                guarantee that eliminates the two primary attack vectors against
                cross-chain settlement.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              <Card>
                <div className="font-mono text-[11px] tracking-wide text-vynx-muted mb-2">
                  01 EMPTY WALLET ATTACK
                </div>
                <p className="font-body text-[13px] text-vynx-muted leading-relaxed">
                  The Solver does not pay at destination until origin is locked.
                  A rug-pull on the Solver is mathematically impossible — the
                  capital exists on-chain before the Solver commits a single
                  unit of their own liquidity.
                </p>
              </Card>
              <Card>
                <div className="font-mono text-[11px] tracking-wide text-vynx-muted mb-2">
                  02 ORACLE DEPENDENCE
                </div>
                <p className="font-body text-[13px] text-vynx-muted leading-relaxed">
                  InputToken = USDC. Collateral = USDC. The Asymmetric Asset
                  Policy reduces SHF to a{" "}
                  <span className="font-mono text-[12px] text-white">
                    big.Int
                  </span>{" "}
                  integer comparison in microseconds. No price feed. No
                  manipulation surface.
                </p>
              </Card>
            </div>

            <Card>
              <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint mb-3">
                ON-CHAIN SELF-DEFENSE
              </div>
              <div className="space-y-3 font-body text-[13px] text-vynx-muted leading-relaxed">
                <p>
                  The <span className="text-white">claimFunds()</span> function
                  cross-references the intentId against the locked state before
                  releasing any capital. Both the Solver&rsquo;s reward and the
                  agent&rsquo;s output are contingent on a deterministic
                  on-chain state transition.
                </p>
                <p className="text-white font-medium">
                  &ldquo;Money does not move until the math is
                  irrefutable.&rdquo;
                </p>
              </div>
            </Card>
          </section>

          {/* §2.4 */}
          <section id="s2-4" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              ASYMMETRIC SLASHING
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-6">
              <p>
                VynX operates a two-tier penalty system. Jail Time penalizes SLA
                breaches — a Solver who wins the auction but fails to execute{" "}
                <span className="font-mono text-[13px] text-white">
                  lockIntent()
                </span>{" "}
                within 10 seconds is suspended for an escalating jail duration
                (N1: 60s, N2: 10min, N3: 1h, N4: 24h, N5: permanent).
              </p>
              <p>
                SlashAmount penalizes Deadline breaches — a Solver who fails to
                complete settlement within the agent&rsquo;s 15-minute deadline
                loses a deterministic fraction of their collateral.
              </p>
            </div>

            <Card className="text-center py-8 my-6">
              <div className="font-mono text-[16px] text-white">
                SlashAmount = InputAmount × 10%
              </div>
              <div className="font-mono text-[10px] text-vynx-faint mt-3">
                5% TO AGENT · 5% TO TREASURY · DETERMINISTIC · NO ORACLE
              </div>
            </Card>

            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
              <p>
                Slashing is enforced through VynxRegistry.sol on Ethereum L1 via
                the DirectVaultAdapter — direct USDC custody, no yield protocol.
                The 7-day unbonding period quarantines capital under resolution.
                Amnesty resets after 90 days for infractions N1–N4. N5 is
                permanent.
              </p>
            </div>
          </section>
        </ThesisSection>

        {/* ── PAGE 03 ── */}
        <ThesisSection id="page-03" title="THE INSTITUTIONAL LIQUIDITY TRAP">
          {/* §3.1 */}
          <section id="s3-1" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE OLIGOPOLY
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8">
              <p>
                Competition among Solvers is a fiction. The same three to five
                names concentrate every intent rail. This is not accidental —
                the capital requirements, latency infrastructure, and
                proprietary flow access required to compete as a top-tier Solver
                create a natural oligopoly. VynX does not seek new Solvers. VynX
                captures the existing ones.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3">
              {oligStats.map((stat, i) => (
                <div key={stat.label} className={oligColClasses[i]}>
                  <div className="font-display text-[48px] leading-none text-white">
                    {stat.value}
                  </div>
                  <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-muted mt-2">
                    {stat.label}
                  </div>
                  <div className="font-mono text-[10px] text-vynx-faint mt-1">
                    {stat.sublabel}
                  </div>
                  <div className="font-mono text-[10px] text-vynx-faint mt-1">
                    {stat.source}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* §3.2 */}
          <section id="s3-2" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE MOAT · SHF
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-6">
              <p>
                The SHF mechanism transforms a distributed action problem into a
                Nash Equilibrium with a single dominant strategy: compete. Every
                major Solver who refuses to participate hands their market share
                to the ones who do. The moat is not a brand. It is game theory
                applied to capital efficiency.
              </p>
            </div>

            <Card goldBorder className="py-8 px-8">
              <p className="font-body italic text-[15px] text-vynx-muted leading-relaxed">
                &ldquo;If Wintermute does not lock, GSR captures their share. If
                GSR does not lock, Barter captures both. The equilibrium is
                competitive overcollateralization.&rdquo;
              </p>
              <div className="font-mono text-[10px] tracking-widest uppercase text-vynx-faint mt-4">
                NASH EQUILIBRIUM · TERMINAL GAME THEORY
              </div>
            </Card>
          </section>

          {/* §3.3 */}
          <section id="s3-3" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              INELASTIC TAKE RATE
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8">
              <p>
                The 10 bps take rate is not a pricing decision. It is a protocol
                constant. The bytecode cap of 20 bps cannot be exceeded by
                governance or upgrade — it is immutable. An agent that optimizes
                for latency over marginal cost does not comparison shop at the
                settlement layer. The demand is inelastic by architecture.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3">
              {revenueStats.map((stat, i) => (
                <div key={stat.label} className={revenueColClasses[i]}>
                  <div className="font-display text-[48px] leading-none text-white">
                    {stat.value}
                  </div>
                  <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-muted mt-2">
                    {stat.label}
                  </div>
                  <div className="font-mono text-[10px] text-vynx-faint mt-1">
                    {stat.sublabel}
                  </div>
                </div>
              ))}
            </div>

            <p className="font-mono text-[11px] text-vynx-faint mt-8 leading-relaxed">
              1B VYNX hard-capped supply. No future mint. Small Giant
              philosophy.
            </p>
          </section>
        </ThesisSection>

        {/* ── PAGE 04 ── */}
        <ThesisSection id="page-04" title="THE TROJAN HORSE ON BASE">
          {/* §4.1 */}
          <section id="s4-1" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              DISTRIBUTION WITHOUT HUMANS
            </h3>
            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-6">
              <p>
                The acquisition channel is not a sales team. It is a package
                manager. At launch: any developer integrating the AgentKit plugin
                puts their agents onto the VynX settlement rail.
                The developer installs. Agents route automatically. No wallet
                popups. No brand preferences. No onboarding fatigue.
              </p>
            </div>

            <Card className="mb-6">
              <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint mb-3">
                DISTRIBUTION VECTOR · AT LAUNCH
              </div>
              <div className="font-mono text-[15px]">
                <span className="text-vynx-muted">npm install </span>
                <span className="text-white">@vynx/sdk</span>
              </div>
            </Card>

            <div className="flex flex-wrap gap-3 mb-6">
              {chains.map((chain) => (
                <span
                  key={chain.id}
                  className={
                    chain.isBase
                      ? "px-3 py-1.5 border rounded-xs font-mono text-[11px] tracking-wide border-(--color-border-gold) text-vynx-gold"
                      : "px-3 py-1.5 border rounded-xs font-mono text-[11px] tracking-wide border-(--color-border-gold) text-vynx-muted"
                  }
                >
                  {`${chain.name} · ${chain.id}`}
                </span>
              ))}
            </div>

            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed">
              <p>
                An agent operates indefinitely on 50 USDC and a single off-chain
                signature per swap — zero transactions, zero gas. The Solver
                bears all gas; recovery after a missed deadline is
                permissionless. The capital requirement for agentic
                participation collapses to the size of a single intent. The
                network grows every time an agent framework ships a new plugin.
              </p>
            </div>
          </section>

          {/* §4.2 */}
          <section id="s4-2" className="mb-12">
            <h3 className="font-display text-[24px] text-white mb-4">
              THE ULTIMATUM
            </h3>

            <h4 className="font-display text-subsection-headline text-white mb-6">
              THE M2M STANDARD IS BEING DEFINED NOW.
            </h4>

            <div className="space-y-4 font-body font-light text-[15px] text-vynx-muted leading-relaxed mb-8">
              <p>
                Settlement infrastructure obeys network effects. The protocol
                that captures the first cohort of institutional Solvers and the
                first cohort of agentic developers sets the clearing standard.
                There is no second-mover on settlement infrastructure. The
                window is 2026.
              </p>
              <p>The evidence is not speculative. It is already on-chain.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 my-8">
              {ultimatumStats.map((s) => (
                <Card key={s.label} className="p-4">
                  <div className="font-display text-[32px] text-white leading-none">
                    {s.value}
                  </div>
                  <div className="font-mono text-[10px] tracking-wide text-vynx-muted mt-1 mb-2">
                    {s.label}
                  </div>
                  <div className="font-body text-[12px] text-vynx-faint leading-relaxed">
                    {s.sub}
                  </div>
                </Card>
              ))}
            </div>

            <Card goldBorder className="text-center py-10 mt-12">
              <p className="font-body font-medium text-[17px] text-white leading-relaxed max-w-120 mx-auto">
                &ldquo;Whoever controls agentic settlement on Base in 2026 will
                control the AI value highway for the next decade.&rdquo;
              </p>
              <p className="font-body text-[13px] text-vynx-muted mt-3 max-w-120 mx-auto">
                This is not a prediction. It is the geometry of network effects
                applied to critical infrastructure.
              </p>
            </Card>
          </section>
        </ThesisSection>

        <ThesisGate />
      </DocsLayout>
    </main>
  );
}
