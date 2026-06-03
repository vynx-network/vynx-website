interface Level {
  n: string;
  time: string;
  bar: string;
  gold?: boolean;
}

const levels: Level[] = [
  { n: "N1", time: "60 s", bar: "h-10" },
  { n: "N2", time: "10 min", bar: "h-16" },
  { n: "N3", time: "1 h", bar: "h-24" },
  { n: "N4", time: "24 h", bar: "h-32" },
  { n: "N5", time: "PERMANENT", bar: "h-40", gold: true },
];

export default function JailLadder() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-6">
        JAIL TIME · ESCALATION LADDER
      </div>

      <div className="overflow-x-auto">
        <div className="flex items-end gap-3 min-w-105">
          {levels.map((l) => (
            <div key={l.n} className="flex-1 flex flex-col items-center gap-2">
              <span
                className={`font-mono text-[10px] tracking-[0.05em] ${
                  l.gold ? "text-vynx-gold" : "text-vynx-faint"
                }`}
              >
                {l.time}
              </span>
              <div
                className={`w-full ${l.bar} rounded-[2px] bg-vynx-bg border ${
                  l.gold
                    ? "border-[var(--color-border-gold)]"
                    : "border-[var(--color-border)]"
                }`}
              />
              <span
                className={`font-mono text-[12px] ${
                  l.gold ? "text-vynx-gold" : "text-white"
                }`}
              >
                {l.n}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 border-l-2 border-[var(--color-border-gold)] pl-4">
        <p className="font-mono text-[10px] tracking-[0.15em] text-vynx-gold uppercase">
          90-DAY AMNESTY
        </p>
        <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mt-2 max-w-130">
          After 90 days of clean operation the N1–N4 counters reset. N5 is
          amnesty-immune and permanent. Triggered only by an SLA breach — the
          origin lock (lockIntent()) not landing within 10 s of winning.
        </p>
      </div>
    </div>
  );
}
