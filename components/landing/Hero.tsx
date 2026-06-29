import Button from "@/components/ui/Button";

export default function Hero() {
  return (
    <section className="flex flex-col min-h-140">
      <div className="flex-1 flex items-center">
        <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 w-full">
          {/* Eyebrow */}
          <div className="font-mono text-[11px] tracking-[0.15em]">
            <span className="text-vynx-faint">·</span>{" "}
            <span className="text-vynx-muted">BASE NATIVE</span>{" "}
            <span className="text-vynx-faint">·</span>{" "}
            <span className="text-vynx-muted">OMNICHAIN SETTLEMENT</span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-hero-headline leading-none text-vynx-text mt-4 text-balance">
            DEFI WAS BUILT FOR HUMANS. AGENTS DON&rsquo;T WAIT.
          </h1>

          {/* Subline */}
          <div className="mt-6 max-w-140">
            <p className="font-body font-light text-[17px] leading-relaxed text-vynx-muted">
              The clearing layer for the machine-to-machine economy.
            </p>
          </div>

          {/* CTAs */}
          <div className="mt-10 flex flex-row max-[400px]:flex-col gap-4">
            <Button variant="primary" href="mailto:cristian@vynx.network">
              REQUEST ACCESS
            </Button>
            <Button variant="secondary" href="/thesis">
              NETWORK THESIS
            </Button>
          </div>
        </div>
      </div>

      {/* Qualifier */}
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 w-full pb-8">
        <p className="font-mono text-[10px] tracking-widest text-vynx-faint">
          NO RETAIL ACCESS · QUALIFIED COUNTERPARTIES · UNDER NDA REVIEW
        </p>
      </div>
    </section>
  );
}
