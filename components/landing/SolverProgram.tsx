import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const oligStats = [
  { value: "~90%", label: "UNISWAPX", sublabel: "Top 3 fillers" },
  { value: "50–60%", label: "COW PROTOCOL", sublabel: "Top 3 solvers" },
  { value: "80%", label: "1INCH FUSION", sublabel: "Top 3 MMs" },
];

const oligClasses = [
  "py-6 md:pr-8 border-b border-[var(--color-border)] md:border-b-0 md:border-r",
  "py-6 md:px-8 border-b border-[var(--color-border)] md:border-b-0 md:border-r",
  "py-6 md:pl-8",
];

function OligopolyStats() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3">
      {oligStats.map((stat, i) => (
        <div key={stat.label} className={oligClasses[i]}>
          <div className="font-display text-[48px] leading-none text-vynx-text">
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
  );
}

function NashBlock() {
  return (
    <Card goldBorder className="py-8 px-8">
      <p className="font-body italic text-[15px] text-vynx-muted leading-relaxed">
        If Wintermute does not lock, GSR captures their share. If GSR does not
        lock, Barter captures both. The equilibrium is competitive
        overcollateralization.
      </p>
      <div className="font-mono text-[10px] tracking-widest uppercase text-vynx-faint mt-4">
        NASH EQUILIBRIUM · TERMINAL GAME THEORY
      </div>
    </Card>
  );
}

const requirements = [
  {
    param: "SHF THRESHOLD",
    value: "1.20×",
    desc: "Minimum overcollateralization",
  },
  {
    param: "COLLATERAL",
    value: "USDC",
    desc: "DirectVaultAdapter — direct USDC custody, Ethereum L1.",
  },
  { param: "UNBONDING PERIOD", value: "7 days", desc: "Capital quarantine" },
  {
    param: "MAX EXPOSURE",
    value: "80%",
    desc: "Permanent free-capital reserve",
  },
  {
    param: "TAKE RATE",
    value: "10 bps",
    desc: "Inelastic. Immutable bytecode cap: 20 bps.",
  },
  {
    param: "AMNESTY EPOCH",
    value: "90 days",
    desc: "N1–N4 reset. N5 permanent.",
  },
];

const reqColClass = "grid grid-cols-[1fr_80px_2fr]";

function RequirementsGrid() {
  return (
    <div className="overflow-x-auto">
      <div role="table" className="w-full min-w-120">
        <div
          role="row"
          className={`${reqColClass} border-b border-[var(--color-border)] pb-3`}
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
        {requirements.map((req) => (
          <div
            key={req.param}
            role="row"
            className={`${reqColClass} border-b border-[var(--color-border)] py-4 items-center`}
          >
            <div role="cell" className="font-mono text-[12px] text-vynx-text">
              {req.param}
            </div>
            <div
              role="cell"
              className="font-display text-[18px] text-vynx-text leading-none"
            >
              {req.value}
            </div>
            <div role="cell" className="font-body text-[13px] text-vynx-muted">
              {req.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SolverProgram() {
  return (
    <section className="py-24">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 flex flex-col gap-12">
        <SectionLabel>SOLVER PROGRAM · FOUNDING COHORT</SectionLabel>

        <h2 className="font-display text-section-headline leading-none text-vynx-text -mt-2 text-balance">
          THE OLIGOPOLY IS THE MOAT
        </h2>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-150 -mt-4">
          Competition among Solvers is a fiction. The same names concentrate
          every intent rail. VynX does not seek new Solvers. VynX captures the
          existing ones.
        </p>

        <OligopolyStats />
        <NashBlock />
        <RequirementsGrid />

        <div>
          <Button variant="primary" href="mailto:cristian@vynx.network">
            APPLY AS FOUNDING SOLVER
          </Button>
        </div>
      </div>
    </section>
  );
}
