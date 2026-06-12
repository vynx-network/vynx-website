import { ReactNode } from "react";

interface Step {
  number: string;
  title: string;
  body: ReactNode;
}

const mono = "font-mono text-[13px] text-vynx-text";

const steps: Step[] = [
  {
    number: "01",
    title: "AGENT SIGNS",
    body: "One EIP-3009 authorization, signed off-chain. Relayer validates — InputToken = USDC, SHF ≥ 1.20, Exposure < 80% — and verifies the signature. It does not sign the intent. Private mempool.",
  },
  {
    number: "02",
    title: "SEALED BID",
    body: "WebSocket broadcast to Solvers. 200ms window. No Dutch curve. Winner: max(OutputAmount).",
  },
  {
    number: "03",
    title: "ORIGIN LOCK",
    body: (
      <>
        Winning Solver executes <span className={mono}>lockIntent()</span> on{" "}
        <span className={mono}>VynxSettlement.sol</span> — solver-paid gas.
        Capital locked on Base before destination pay.
      </>
    ),
  },
  {
    number: "04",
    title: "SETTLEMENT",
    body: (
      <>
        <span className={mono}>claimFunds()</span> cross-references intentId.
        Math irrefutable → funds move. 10 bps deducted atomically.
      </>
    ),
  },
];

const stepClasses = [
  "py-8 md:py-0 border-b border-[var(--color-border)] md:border-b-0 md:border-r md:pr-8",
  "py-8 md:py-0 border-b border-[var(--color-border)] md:border-b-0 md:border-r md:px-8",
  "py-8 md:py-0 border-b border-[var(--color-border)] md:border-b-0 md:border-r md:px-8",
  "py-8 md:py-0 md:pl-8",
];

export default function ProtocolSteps() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4">
        {steps.map((step, i) => (
          <div key={step.number} className={stepClasses[i]}>
            <div className="font-display text-[48px] leading-none text-vynx-faint">
              {step.number}
            </div>
            <div className="font-mono text-[11px] tracking-[0.15em] uppercase text-vynx-muted mt-1">
              {step.title}
            </div>
            <p className="font-body font-light text-[14px] text-vynx-muted leading-relaxed mt-3">
              {step.body}
            </p>
          </div>
        ))}
      </div>

      {/* Tagline */}
      <div className="mt-12 bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] py-5 px-6">
        <p className="font-body font-medium text-[16px] text-vynx-text border-l-2 border-vynx-gold pl-6">
          Money does not move until the math is irrefutable.
        </p>
      </div>
    </>
  );
}
