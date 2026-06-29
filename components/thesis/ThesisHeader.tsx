import DominanceMatrix from "@/components/landing/DominanceMatrix";
import SectionLabel from "@/components/ui/SectionLabel";

export default function ThesisHeader() {
  return (
    <div className="mb-16">
      <p className="font-mono text-[10px] tracking-[0.15em] text-vynx-faint mb-6">
        MAY 2026
      </p>

      <h1 className="font-display text-section-headline leading-none text-vynx-text mb-6">
        THE CLEARING LAYER FOR THE MACHINE-TO-MACHINE ECONOMY.
      </h1>

      <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-140 mb-12">
        DeFi was built for humans. Agents do not wait 30 seconds. VynX is the
        physical and mathematical response to the collapse of legacy DeFi
        infrastructure under AI flow.
      </p>

      <DominanceMatrix compact />

      <div className="mt-12">
        <SectionLabel>PUBLIC DOCUMENT</SectionLabel>
      </div>
    </div>
  );
}
