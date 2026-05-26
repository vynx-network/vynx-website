import SectionLabel from "@/components/ui/SectionLabel";
import LatencyTable from "./LatencyTable";
import StatStrip from "./StatStrip";

export default function TheProblem() {
  return (
    <section className="py-24">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 flex flex-col gap-12">
        <SectionLabel>THE STRUCTURAL COLLAPSE</SectionLabel>

        <h2 className="font-display text-section-headline leading-none text-white -mt-2 text-balance">
          DEFI WAS DESIGNED FOR HUMANS
        </h2>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-140 -mt-4">
          2–3 tx/day is the pulse of the median retail user on Base. 100–1,000×
          that ratio is the pulse of the active agentic decile. Human
          infrastructure is architecturally incompatible with sub-second
          determinism.
        </p>

        <LatencyTable />

        <StatStrip />
      </div>
    </section>
  );
}
