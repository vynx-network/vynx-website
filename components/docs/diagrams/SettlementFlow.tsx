interface Step {
  phase: string;
  actor: string;
  body: string;
  state?: string;
}

const steps: Step[] = [
  {
    phase: "SUBMIT",
    actor: "AGENT",
    body: "The agent submits an intent — token (USDC), amount, destination chain, and a 15-minute deadline. The SDK sends an all-zero placeholder signature; the relayer's EIP-712 signature is the authoritative one.",
  },
  {
    phase: "AUCTION",
    actor: "RELAYER",
    body: "The relayer validates solver eligibility (SHF ≥ 1.20×), signs the intent, then opens a 200 ms sealed-bid auction. Highest OutputAmount wins; ties break on health factor.",
  },
  {
    phase: "LOCK",
    actor: "AGENT → SETTLEMENT (BASE)",
    body: "The SDK submits approve() and lockIntent() from the agent wallet — two Base transactions, agent-paid gas. lockIntent() escrows the USDC on VynxSettlement, verifying the relayer's EIP-712 signature against the live relayerKey.",
    state: "UNKNOWN → LOCKED",
  },
  {
    phase: "PAY",
    actor: "SOLVER → DESTINATION CHAIN",
    body: "The winning solver delivers the output token on the destination chain. The relayer waits for finality, then signs a voucher over (intentId, solver, amount).",
  },
  {
    phase: "CLAIM",
    actor: "SOLVER → SETTLEMENT (BASE)",
    body: "claimFunds() verifies the voucher and releases the escrow to the solver. A 10 bps fee is deducted atomically.",
    state: "LOCKED → REDEEMED",
  },
];

export default function SettlementFlow() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-8">
        SETTLEMENT LIFECYCLE · HAPPY PATH
      </div>

      {steps.map((step, i) => (
        <div key={step.phase} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4">
          {/* Marker rail */}
          <div className="flex flex-col items-center">
            <div className="w-7 h-7 shrink-0 border border-[var(--color-border)] rounded-[2px] flex items-center justify-center font-mono text-[11px] text-vynx-gold bg-vynx-bg">
              {String(i + 1).padStart(2, "0")}
            </div>
            {i < steps.length - 1 && (
              <div className="w-px flex-1 bg-[var(--color-border)] my-1" />
            )}
          </div>

          {/* Content */}
          <div className={i < steps.length - 1 ? "pb-8" : ""}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[11px] tracking-[0.15em] text-white uppercase">
                {step.phase}
              </span>
              <span className="font-mono text-[10px] tracking-[0.1em] text-vynx-faint uppercase">
                {step.actor}
              </span>
            </div>
            <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mt-2 max-w-130">
              {step.body}
            </p>
            {step.state && (
              <div className="inline-block mt-3 font-mono text-[10px] tracking-[0.1em] text-vynx-gold border border-[var(--color-border-gold)] rounded-[2px] px-2 py-1">
                {step.state}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Refund branch */}
      <div className="mt-2 border-l-2 border-[var(--color-border-gold)] pl-4 ml-[13px]">
        <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed max-w-130">
          No fill by the deadline? Anyone can call{" "}
          <span className="font-mono text-[12px] text-white">refundIntent()</span>{" "}
          to return the full amount to the agent — unilateral, no solver or
          governance approval required.
        </p>
        <div className="inline-block mt-3 font-mono text-[10px] tracking-[0.1em] text-vynx-gold border border-[var(--color-border-gold)] rounded-[2px] px-2 py-1">
          LOCKED → REFUNDED
        </div>
      </div>
    </div>
  );
}
