interface Line {
  label: string;
  value: string;
  kind: "input" | "deduction" | "subtotal" | "result";
}

const lines: Line[] = [
  { label: "Input locked · agent escrow on Base", value: "100.00", kind: "input" },
  { label: "− Take rate (10 bps)", value: "−0.10", kind: "deduction" },
  { label: "Claimable on settlement", value: "99.90", kind: "subtotal" },
  { label: "− Output delivered · winning bid", value: "−99.50", kind: "deduction" },
  { label: "− Destination gas + cost of capital", value: "−0.15", kind: "deduction" },
  { label: "Solver gross spread", value: "+0.25", kind: "result" },
];

function rowClasses(kind: Line["kind"]): { label: string; value: string; wrap: string } {
  switch (kind) {
    case "input":
      return { label: "text-vynx-text", value: "text-vynx-text", wrap: "" };
    case "deduction":
      return { label: "text-vynx-muted", value: "text-vynx-muted", wrap: "" };
    case "subtotal":
      return {
        label: "text-vynx-text",
        value: "text-vynx-text",
        wrap: "border-t border-[var(--color-border)]",
      };
    case "result":
      return {
        label: "text-vynx-gold",
        value: "text-vynx-gold",
        wrap: "border-t border-[var(--color-border-gold)]",
      };
  }
}

export default function MarginWaterfall() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="flex items-baseline justify-between mb-6">
        <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase">
          MARGIN WATERFALL · SOLVER SIDE
        </div>
        <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-gold uppercase">
          Illustrative · 100 USDC
        </div>
      </div>

      <div className="flex flex-col">
        {lines.map((line) => {
          const c = rowClasses(line.kind);
          return (
            <div
              key={line.label}
              className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-baseline py-2.5 ${c.wrap}`}
            >
              <span className="font-mono text-[12px] tracking-[0.02em] leading-snug">
                <span className={c.label}>{line.label}</span>
              </span>
              <span className={`font-mono text-[13px] tabular-nums ${c.value}`}>
                {line.value}
                <span className="text-vynx-faint"> USDC</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="font-body font-light text-[12px] text-vynx-faint leading-relaxed mt-6">
        The competitive auction compresses this spread toward marginal cost —
        every basis point a solver keeps is a basis point a rival can bid away.
        Figures are illustrative, not a quote.
      </p>
    </div>
  );
}
