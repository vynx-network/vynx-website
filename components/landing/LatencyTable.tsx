const colClass = "grid grid-cols-[2fr_1fr_2fr_1fr]";

const normalRows = [
  { protocol: "CoW Swap", median: "30s", tail: "45–90s", vs: "150–450×" },
  { protocol: "UniswapX", median: "≤12s", tail: "up to 60s", vs: "60–300×" },
];

export default function LatencyTable() {
  return (
    <div className="overflow-x-auto">
    <div role="table" className="w-full min-w-120">
      {/* Header */}
      <div
        role="row"
        className={`${colClass} border-b border-[var(--color-border)] pb-3`}
      >
        {["PROTOCOL", "MEDIAN (P50)", "TAIL (P99)", "VS VYNX"].map((h) => (
          <div
            key={h}
            role="columnheader"
            className="font-mono text-[10px] tracking-[0.15em] uppercase text-vynx-faint"
          >
            {h}
          </div>
        ))}
      </div>

      {/* Normal rows */}
      {normalRows.map((row) => (
        <div
          key={row.protocol}
          role="row"
          className={`${colClass} border-b border-[var(--color-border)] py-4 items-center`}
        >
          <div role="cell" className="font-body text-[14px] text-vynx-muted">
            {row.protocol}
          </div>
          <div role="cell" className="font-body text-[14px] text-vynx-muted">
            {row.median}
          </div>
          <div role="cell" className="font-body text-[14px] text-vynx-muted">
            {row.tail}
          </div>
          <div role="cell" className="font-mono text-[13px] text-vynx-muted">
            {row.vs}
          </div>
        </div>
      ))}

      {/* VynX row — gold highlight */}
      <div
        role="row"
        className={`${colClass} border border-[var(--color-border-gold)] rounded-[2px] py-4 px-3 mt-2 items-center`}
      >
        <div role="cell" className="font-body text-[14px] text-vynx-text font-medium">
          VynX OFA
        </div>
        <div
          role="cell"
          className="font-body text-[14px] font-medium text-vynx-gold"
        >
          200ms
        </div>
        <div role="cell" className="font-body text-[14px] text-vynx-text">
          200ms (deterministic)
        </div>
        <div role="cell" className="font-mono text-[13px] text-vynx-faint">
          —
        </div>
      </div>
    </div>
    </div>
  );
}
