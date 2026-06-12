interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  stroke: string;
  text: string;
}

const W = 120;
const H = 44;
const MUTED = "var(--color-text-muted)";
const GOLD = "var(--color-gold)";
const WHITE = "var(--color-text-primary)";
const FAINT = "var(--color-text-faint)";

const nodes: Node[] = [
  { id: "pending", label: "PENDING", x: 10, y: 30, stroke: MUTED, text: WHITE },
  { id: "auction", label: "IN_AUCTION", x: 190, y: 30, stroke: MUTED, text: WHITE },
  { id: "locked", label: "LOCKED", x: 370, y: 30, stroke: MUTED, text: WHITE },
  { id: "settled", label: "SETTLED", x: 550, y: 30, stroke: GOLD, text: WHITE },
  { id: "expired", label: "EXPIRED", x: 300, y: 150, stroke: MUTED, text: MUTED },
  { id: "slashed", label: "SLASHED", x: 490, y: 150, stroke: GOLD, text: GOLD },
];

interface Edge {
  d: string;
  label: string;
  lx: number;
  ly: number;
}

const edges: Edge[] = [
  { d: "M130,52 L186,52", label: "submit", lx: 158, ly: 44 },
  { d: "M310,52 L366,52", label: "lock", lx: 338, ly: 44 },
  { d: "M490,52 L546,52", label: "claim", lx: 518, ly: 44 },
  { d: "M420,74 L375,146", label: "deadline", lx: 350, ly: 116 },
  { d: "M450,74 L540,146", label: "breach", lx: 520, ly: 116 },
];

export default function IntentStateMachine() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-6">
        INTENT STATE MACHINE
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 680 210"
          className="font-mono w-full min-w-150"
          role="img"
          aria-label="Intent state machine: PENDING to IN_AUCTION to LOCKED to SETTLED, with LOCKED branching to EXPIRED on deadline and SLASHED on breach."
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={MUTED} />
            </marker>
          </defs>

          {edges.map((e) => (
            <g key={e.label}>
              <path
                d={e.d}
                fill="none"
                stroke={MUTED}
                strokeWidth="1"
                markerEnd="url(#arrow)"
              />
              <text
                x={e.lx}
                y={e.ly}
                fill={FAINT}
                fontSize="9"
                textAnchor="middle"
              >
                {e.label}
              </text>
            </g>
          ))}

          {nodes.map((n) => (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={W}
                height={H}
                rx="2"
                fill="var(--color-bg)"
                stroke={n.stroke}
                strokeWidth="1"
              />
              <text
                x={n.x + W / 2}
                y={n.y + H / 2 + 4}
                fill={n.text}
                fontSize="12"
                letterSpacing="0.5"
                textAnchor="middle"
              >
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="font-body font-light text-[12px] text-vynx-faint leading-relaxed mt-4">
        SETTLED, EXPIRED, and SLASHED are terminal. On EXPIRED the agent is
        refunded in full; on SLASHED the breaching solver forfeits 10% and the
        agent is compensated.
      </p>
    </div>
  );
}
