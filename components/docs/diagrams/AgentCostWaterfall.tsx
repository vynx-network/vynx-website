interface Line {
  label: string;
  value: string;
  kind: "input" | "line" | "result";
}

const lines: Line[] = [
  {
    label: "You authorize · escrowed only on a solver's win",
    value: "100.00",
    kind: "input",
  },
  {
    label: "Best competing output delivered to you · destination",
    value: "99.50",
    kind: "line",
  },
  { label: "Gas you pay", value: "0.00", kind: "line" },
  {
    label: "Your all-in cost · the competitive spread",
    value: "0.50",
    kind: "result",
  },
];

function rowClasses(kind: Line["kind"]): { label: string; value: string; wrap: string } {
  switch (kind) {
    case "input":
      return { label: "text-vynx-text", value: "text-vynx-text", wrap: "" };
    case "line":
      return { label: "text-vynx-muted", value: "text-vynx-muted", wrap: "" };
    case "result":
      return {
        label: "text-vynx-gold",
        value: "text-vynx-gold",
        wrap: "border-t border-[var(--color-border-gold)]",
      };
  }
}

export default function AgentCostWaterfall() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="flex items-baseline justify-between mb-6">
        <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase">
          COST WATERFALL · AGENT SIDE
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
        Solvers compete to deliver you the most; your cost is the spread,
        compressed by competition — not a rent. The 10 bps protocol take rate is
        a component, borne via the solver&rsquo;s claim. Figures are
        illustrative, not a quote.
      </p>
    </div>
  );
}
