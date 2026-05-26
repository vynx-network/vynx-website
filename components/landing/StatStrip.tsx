const stats = [
  { value: "$20.2M", label: "ADVERSE SLIPPAGE", sublabel: "60d agentic flow" },
  { value: "17,000", label: "AGENTS ON BASE", sublabel: "~1M JOBS" },
  { value: "56%", label: "BASE GAS BURNED", sublabel: "IN SPAM" },
];

export default function StatStrip() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={[
            "py-6",
            i === 0 ? "md:pr-8" : i === 2 ? "md:pl-8" : "md:px-8",
            i < 2 ? "border-b border-[var(--color-border)] md:border-b-0 md:border-r md:border-[var(--color-border)]" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
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
  );
}
