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
            gold ? "text-vynx-gold" : "text-vynx-text"
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
            fill="var(--color-bg)"
            stroke={gold ? "var(--color-gold)" : "var(--color-text-muted)"}
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

function Segment({
  duration,
  note,
  gold,
  compact,
}: {
  duration?: string;
  note: string;
  gold?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col flex-1 ${compact ? "min-w-12" : "min-w-16"}`}>
      <div className="h-12 flex items-end justify-center pb-1">
        {duration && (
          <span
            className={`font-mono text-[11px] tracking-[0.05em] ${
              gold ? "text-vynx-gold" : "text-vynx-muted"
            }`}
          >
            {duration}
          </span>
        )}
      </div>
      <div className="h-6 flex items-center">
        <div
          className={`h-px w-full ${compact ? "border-t border-dashed" : ""}`}
          style={
            compact
              ? {
                  borderColor: gold
                    ? "var(--color-border-gold)"
                    : "var(--color-border)",
                }
              : {
                  backgroundColor: gold
                    ? "var(--color-border-gold)"
                    : "var(--color-border)",
                }
          }
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

type Beat =
  | { kind: "node"; label: string; sub: string; gold?: boolean }
  | { kind: "seg"; duration?: string; note: string; gold?: boolean; compact?: boolean };

const beats: Beat[] = [
  { kind: "node", label: "Auction opens", sub: "intent broadcast" },
  { kind: "seg", duration: "200 ms", note: "sealed-bid window" },
  { kind: "node", label: "Winner", sub: "max OutputAmount", gold: true },
  { kind: "seg", note: "won_ack", gold: true, compact: true },
  { kind: "node", label: "Ack", sub: "arms your clock", gold: true },
  { kind: "seg", duration: "10 s", note: "SLA · lock origin", gold: true },
  { kind: "node", label: "Locked", sub: "escrow on Base" },
  { kind: "seg", duration: "15 min", note: "deadline · settle", gold: true },
  { kind: "node", label: "Settled", sub: "voucher claimed", gold: true },
];

export default function AuctionTimeline() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-4">
        SETTLEMENT TIMELINE · SOLVER OBLIGATIONS
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-stretch min-w-180 pl-2 w-max">
          {beats.map((beat, i) =>
            beat.kind === "node" ? (
              <Node key={i} label={beat.label} sub={beat.sub} gold={beat.gold} />
            ) : (
              <Segment
                key={i}
                duration={beat.duration}
                note={beat.note}
                gold={beat.gold}
                compact={beat.compact}
              />
            ),
          )}
        </div>
      </div>
      <p className="font-body font-light text-[12px] text-vynx-faint leading-relaxed mt-4">
        Not to scale. A bid arriving after the 200 ms window is dropped — no
        penalty. Your 10-second lock SLA arms only when you acknowledge the win;
        a win you never acknowledge is re-auctioned, never jailed. A locked
        intent left unsettled past the 15-minute deadline is refunded to the
        agent, and the solver is slashed 10% and jailed at level 3 or higher.
      </p>
    </div>
  );
}
