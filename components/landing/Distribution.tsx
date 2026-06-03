import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";

const chains = [
  { name: "Base", id: "8453", isBase: true },
  { name: "Ethereum", id: "1", isBase: false },
  { name: "Arbitrum", id: "42161", isBase: false },
  { name: "Optimism", id: "10", isBase: false },
  { name: "Polygon", id: "137", isBase: false },
];

function NpmBlock() {
  return (
    <Card>
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint mb-3">
        DISTRIBUTION VECTOR
      </div>
      <div className="font-mono text-[15px]">
        <span className="text-vynx-muted">npm install </span>
        <span className="text-white">@vynx/sdk</span>
      </div>
    </Card>
  );
}

function ChainBadges() {
  return (
    <div className="flex flex-wrap gap-3">
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
  );
}

export default function Distribution() {
  return (
    <section className="py-24">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 flex flex-col gap-12">
        <SectionLabel>DISTRIBUTION WITHOUT HUMANS</SectionLabel>

        <h2 className="font-display text-section-headline leading-none text-white -mt-2 text-balance">
          THE SDK IS THE TROJAN HORSE
        </h2>

        <NpmBlock />

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-140 -mt-4">
          The developer installs. Agents route automatically. No wallet popups.
          No brand preferences. No onboarding fatigue. An agent operates
          indefinitely on 50 USDC plus Base gas for two transactions per swap.
        </p>

        <ChainBadges />

        <div className="max-w-140">
          <p className="font-body font-medium text-[15px] text-white leading-relaxed">
            &ldquo;There is no second-mover on settlement infrastructure. The
            M2M standard is being defined now.&rdquo;
          </p>
        </div>
      </div>
    </section>
  );
}
