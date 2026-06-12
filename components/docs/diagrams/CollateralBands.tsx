export default function CollateralBands() {
  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px] p-6">
      <div className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint uppercase mb-6">
        COLLATERAL HEALTH · SHF ≥ 1.20× · EXPOSURE ≤ 80%
      </div>

      {/* Stacked bar — total locked collateral */}
      <div className="flex w-full h-14 rounded-[2px] overflow-hidden border border-[var(--color-border)]">
        <div className="w-[80%] bg-vynx-bg flex items-center px-4 border-r border-[var(--color-border-gold)]">
          <span className="font-mono text-[11px] tracking-[0.1em] text-vynx-muted uppercase">
            In-flight exposure ≤ 80%
          </span>
        </div>
        <div className="w-[20%] bg-vynx-bg-card flex items-center justify-center px-2">
          <span className="font-mono text-[11px] tracking-[0.1em] text-vynx-gold uppercase">
            Reserve ≥ 20%
          </span>
        </div>
      </div>

      {/* Scale markers */}
      <div className="flex w-full mt-2">
        <div className="w-[80%] flex justify-between">
          <span className="font-mono text-[10px] text-vynx-faint">0%</span>
          <span className="font-mono text-[10px] text-vynx-gold">
            80% · MAX_EXPOSURE
          </span>
        </div>
        <div className="w-[20%] flex justify-end">
          <span className="font-mono text-[10px] text-vynx-faint">100%</span>
        </div>
      </div>

      {/* Eligibility math */}
      <div className="mt-6 bg-vynx-bg border border-[var(--color-border)] rounded-[2px] px-4 py-4">
        <pre className="font-mono text-[12px] text-vynx-text leading-relaxed whitespace-pre overflow-x-auto">
{`FreeCollateral = Total − InFlight
Required       = InputAmount × 1.20      // SHF_THRESHOLD = 120
eligible IFF     Free ≥ Required  AND  InFlight / Total < 0.80`}
        </pre>
      </div>

      <p className="font-body font-light text-[13px] text-vynx-muted leading-relaxed mt-4 max-w-130">
        To bid on a 100 USDC intent a solver must hold at least 120 USDC of free
        collateral, and total in-flight exposure may never reach 80% of locked
        collateral. The check is a pure integer comparison — no oracle, no price
        conversion.
      </p>
    </div>
  );
}
