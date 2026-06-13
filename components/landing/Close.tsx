import SectionLabel from "@/components/ui/SectionLabel";
import Button from "@/components/ui/Button";

export default function Close() {
  return (
    <section className="py-10">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 flex flex-col gap-12">
        <SectionLabel>ACCESS</SectionLabel>

        <h2 className="font-display text-section-headline leading-none text-vynx-text -mt-2 text-balance">
          EARLY IS A POSITION. IT CLOSES.
        </h2>

        <p className="font-body font-light text-[15px] text-vynx-muted leading-relaxed max-w-140 -mt-4">
          Live on Base Sepolia testnet, BLINDAJE-hardened, demonstrable under
          NDA.
        </p>

        <div className="flex flex-row max-[400px]:flex-col gap-4">
          <Button variant="primary" href="mailto:cristian@vynx.network">
            REQUEST ACCESS
          </Button>
          <Button variant="secondary" href="/thesis">
            NETWORK THESIS
          </Button>
        </div>

        <p className="font-mono text-[10px] tracking-widest text-vynx-faint -mt-4">
          NO RETAIL ACCESS · QUALIFIED COUNTERPARTIES · UNDER NDA REVIEW
        </p>
      </div>
    </section>
  );
}
