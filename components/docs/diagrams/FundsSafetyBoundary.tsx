interface Row {
  title: string;
  detail: string;
}

const canRows: Row[] = [
  {
    title: "Be delivered to you on the destination chain",
    detail: "At or above your signed minimum output.",
  },
  {
    title: "Be refunded to you in full",
    detail:
      "Permissionlessly, after the deadline, if no solver settles — you never need ETH.",
  },
];

const cannotRows: Row[] = [
  {
    title: "Move before a winning solver commits to deliver",
    detail:
      "Your USDC is escrowed only when a winning solver locks it; no win, no movement.",
  },
  {
    title: "Arrive below your signed minimum",
    detail: "A sub-minimum payment is rejected by the witness and the intent refunds.",
  },
  {
    title: "Have their terms altered",
    detail: "Any change to the eight signed terms breaks the EIP-3009 nonce.",
  },
  {
    title: "Be redirected or seized by the Relayer",
    detail: "It adjudicates and witnesses; it never custodies.",
  },
];

function Column({
  heading,
  marker,
  gold,
  rows,
}: {
  heading: string;
  marker: string;
  gold?: boolean;
  rows: Row[];
}) {
  return (
    <div className="flex flex-col">
      <div
        className={`font-mono text-[10px] tracking-[0.15em] uppercase mb-5 ${
          gold ? "text-vynx-gold" : "text-vynx-faint"
        }`}
      >
        {heading}
      </div>
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.title}
            className="grid grid-cols-[16px_minmax(0,1fr)] gap-3 items-start py-4 border-b border-[var(--color-border)] last:border-b-0"
          >
            <span
              className={`font-mono text-[13px] leading-none mt-0.5 ${
                gold ? "text-vynx-gold" : "text-vynx-muted"
              }`}
            >
              {marker}
            </span>
            <div>
              <div className="font-mono text-[12px] tracking-[0.04em] uppercase text-vynx-text leading-snug">
                {row.title}
              </div>
              <div className="font-body font-light text-[12.5px] text-vynx-muted leading-relaxed mt-1.5">
                {row.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FundsSafetyBoundary() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-6">
        FUNDS SAFETY BOUNDARY · WHAT CAN AND CANNOT HAPPEN TO YOUR FUNDS
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-2">
        <Column heading="Can happen to your funds" marker="+" rows={canRows} />
        <Column heading="Can never happen" marker="✕" gold rows={cannotRows} />
      </div>

      <p className="font-body font-light text-[12px] text-vynx-faint leading-relaxed mt-6 pt-6 border-t border-[var(--color-border)]">
        Your funds are trust-minimized — the single Relayer is a liveness
        dependency, not a custodian.
      </p>
    </div>
  );
}
