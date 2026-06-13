import SectionLabel from "@/components/ui/SectionLabel";
import ProtocolSteps from "./ProtocolSteps";

export default function ProtocolMechanics() {
  return (
    <section className="py-10">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20">
        <SectionLabel>HOW IT WORKS</SectionLabel>
        <h2 className="font-display text-section-headline leading-none text-vynx-text mb-16 text-balance">
          ZERO DISCRETION. FOUR STEPS.
        </h2>
        <ProtocolSteps />
      </div>
    </section>
  );
}
