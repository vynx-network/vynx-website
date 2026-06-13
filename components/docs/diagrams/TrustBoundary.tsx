interface Row {
  title: string;
  detail: string;
}

const canRows: Row[] = [
  {
    title: "Adjudicate the 200 ms auction",
    detail: "Runs the sealed-bid window from memory and selects max OutputAmount.",
  },
  {
    title: "Witness the destination payment",
    detail:
      "Validates token, recipient, and amount against the signed terms after chain finality.",
  },
  {
    title: "Relay the EIP-712 voucher",
    detail: "Forwards the signed voucher that releases your claim.",
  },
  {
    title: "Set jail and SLA reputation state",
    detail: "Records timeouts and deadline breaches on the reputation ledger.",
  },
];

const cannotRows: Row[] = [
  {
    title: "Alter the agent's eight signed terms",
    detail:
      "Any change breaks the EIP-3009 nonce and USDC rejects the lock.",
  },
  {
    title: "Redirect or seize funds",
    detail:
      "The voucher binds intentId, solver, and amount; the agent's refund is permissionless.",
  },
  {
    title: "Slash you unilaterally",
    detail:
      "A slash requires the keeper role and an independent, immutable attester signature.",
  },
  {
    title: "Sign vouchers itself",
    detail:
      "Signing is isolated in a separate Signer that holds its own key; the Relayer cannot sign.",
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

export default function TrustBoundary() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-6">
        TRUST BOUNDARY · WHAT THE RELAYER CAN AND CANNOT DO
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-2">
        <Column heading="Can" marker="+" rows={canRows} />
        <Column heading="Cannot" marker="✕" gold rows={cannotRows} />
      </div>

      <p className="font-body font-light text-[12px] text-vynx-faint leading-relaxed mt-6 pt-6 border-t border-[var(--color-border)]">
        VynX is trust-minimized for terms and funds — the single Relayer is a
        liveness dependency, not a custodian.
      </p>
    </div>
  );
}
