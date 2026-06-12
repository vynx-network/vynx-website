import Card from "@/components/ui/Card";
import SectionLabel from "@/components/ui/SectionLabel";

interface MetricCardProps {
  label: string;
  value: string;
  unit: string;
  description: string;
  badge?: string;
  badgeColor?: "green" | "gold";
  footnote?: string;
  compact?: boolean;
}

function MetricCard({
  label,
  value,
  unit,
  description,
  badge,
  badgeColor,
  footnote,
  compact,
}: MetricCardProps) {
  const dotColor =
    badgeColor === "green"
      ? "var(--color-live)"
      : badgeColor === "gold"
        ? "var(--color-gold)"
        : null;

  if (compact) {
    return (
      <Card className="p-4 flex flex-col">
        <div className="flex items-center gap-2">
          {dotColor && (
            <span
              className="rounded-full flex-shrink-0"
              style={{ width: "4px", height: "4px", backgroundColor: dotColor }}
            />
          )}
          <span className="font-mono text-[10px] tracking-[0.12em] text-vynx-muted uppercase">
            {label}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-1">
          <span className="font-display text-[40px] leading-none text-vynx-text">
            {value}
          </span>
          <span className="font-display text-[14px] leading-none text-vynx-muted">
            {unit}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          {dotColor && (
            <span
              className="rounded-full flex-shrink-0"
              style={{ width: "4px", height: "4px", backgroundColor: dotColor }}
            />
          )}
          <span className="font-mono text-[10px] tracking-[0.12em] text-vynx-muted uppercase">
            {label}
          </span>
        </div>
        {badge && (
          <span
            className={`font-mono text-[10px] tracking-[0.12em] uppercase ${
              badgeColor === "gold" ? "text-vynx-gold" : "text-vynx-muted"
            }`}
          >
            {badge}
          </span>
        )}
      </div>

      {/* Metric */}
      <div className="mt-4 flex items-baseline gap-2 flex-1">
        <span className="font-display text-[64px] leading-none text-vynx-text">
          {value}
        </span>
        <span className="font-display text-[20px] leading-none text-vynx-muted">
          {unit}
        </span>
      </div>

      {/* Description */}
      <p className="mt-3 font-body font-light text-[13px] text-vynx-muted leading-relaxed">
        {description}
      </p>

      {/* Footnote */}
      {footnote && (
        <p className="mt-4 font-mono text-[10px] text-vynx-faint text-right">
          {footnote}
        </p>
      )}
    </Card>
  );
}

const cards: MetricCardProps[] = [
  {
    label: "OFA WINDOW",
    value: "200",
    unit: "ms",
    description:
      "Sealed-bid auction, single-block clearing. No batch window. No Dutch decay.",
  },
  {
    label: "TAKE RATE",
    value: "10",
    unit: "bps",
    description: "Immutable 20 bps hard cap in bytecode.",
  },
  {
    label: "DEADLINE SHIELD",
    value: "15",
    unit: "min",
    description: "Agent macro shield. Unilateral refund on expiry.",
  },
  {
    label: "SHF THRESHOLD",
    value: "1.20",
    unit: "×",
    description:
      "Structural L1 overcollateralization. Deterministic, oracle-less.",
  },
];

interface DominanceMatrixProps {
  compact?: boolean;
}

export default function DominanceMatrix({ compact }: DominanceMatrixProps) {
  if (compact) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} compact />
        ))}
      </div>
    );
  }

  return (
    <section className="py-24">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20">
        <SectionLabel>
          DOMINANCE MATRIX · PROTOCOL PHYSICAL CONSTANTS
        </SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((card) => (
            <MetricCard key={card.label} {...card} />
          ))}
        </div>
      </div>
    </section>
  );
}
