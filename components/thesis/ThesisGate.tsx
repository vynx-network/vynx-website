import SectionLabel from "@/components/ui/SectionLabel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

export default function ThesisGate() {
  return (
    <div className="mt-24">
      <SectionLabel>END OF PUBLIC DOCUMENT</SectionLabel>
      <Card goldBorder className="text-center py-10 px-8">
        <p className="font-mono text-[10px] tracking-widest text-vynx-faint mb-4">
          QUALIFIED INVESTORS
        </p>
        <p className="font-body text-[15px] text-vynx-muted leading-relaxed max-w-120 mx-auto">
          The complete thesis — including team, protocol architecture, and round
          terms — is available under NDA review.
        </p>
        <div className="mt-6">
          <Button variant="primary" href="mailto:cristian@vynx.network">
            REQUEST FULL DOCUMENT
          </Button>
        </div>
      </Card>
    </div>
  );
}
