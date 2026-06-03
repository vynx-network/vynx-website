function Node({
  label,
  sub,
  gold,
}: {
  label: string;
  sub: string;
  gold?: boolean;
}) {
  return (
    <div className="flex flex-col items-center w-23 shrink-0">
      <div className="h-12 flex items-end justify-center pb-1">
        <span
          className={`font-mono text-[11px] tracking-[0.1em] uppercase text-center leading-tight ${
            gold ? "text-vynx-gold" : "text-white"
          }`}
        >
          {label}
        </span>
      </div>
      <div className="h-6 flex items-center">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle
            cx="7"
            cy="7"
            r="4"
            fill="#000000"
            stroke={gold ? "#C9A84C" : "#888888"}
            strokeWidth="1.5"
          />
        </svg>
      </div>
      <div className="h-12 pt-1">
        <span className="font-mono text-[10px] tracking-[0.05em] text-vynx-faint text-center block leading-tight">
          {sub}
        </span>
      </div>
    </div>
  );
}

function Segment({ duration, note, gold }: { duration: string; note: string; gold?: boolean }) {
  return (
    <div className="flex flex-col flex-1 min-w-16">
      <div className="h-12 flex items-end justify-center pb-1">
        <span
          className={`font-mono text-[11px] tracking-[0.05em] ${
            gold ? "text-vynx-gold" : "text-vynx-muted"
          }`}
        >
          {duration}
        </span>
      </div>
      <div className="h-6 flex items-center">
        <div
          className="h-px w-full"
          style={{
            backgroundColor: gold
              ? "var(--color-border-gold)"
              : "var(--color-border)",
          }}
        />
      </div>
      <div className="h-12 pt-1 text-center">
        <span className="font-mono text-[10px] tracking-[0.05em] text-vynx-faint leading-tight block">
          {note}
        </span>
      </div>
    </div>
  );
}

export default function AuctionTimeline() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-4">
        SETTLEMENT TIMELINE · SOLVER OBLIGATIONS
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-stretch min-w-145">
          <Node label="Auction opens" sub="intent_announced" />
          <Segment duration="200 ms" note="sealed-bid window" />
          <Node label="Winner" sub="max OutputAmount" gold />
          <Segment duration="10 s" note="SLA · lockIntent()" gold />
          <Node label="Locked" sub="escrow on Base" />
          <Segment duration="15 min" note="deadline · settle" gold />
          <Node label="Settled" sub="claimFunds()" gold />
        </div>
      </div>
      <p className="font-body font-light text-[12px] text-vynx-faint leading-relaxed mt-4">
        Not to scale. Miss the 200 ms window and your bid is simply discarded —
        no penalty. If the origin lock does not land within the 10 s SLA, Jail
        Time applies; miss the 15 min deadline and the position is slashed 10%.
      </p>
    </div>
  );
}
