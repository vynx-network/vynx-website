import SectionLabel from "@/components/ui/SectionLabel";

interface ChecklistItemProps {
  title: string;
  subtitle: string;
  address?: string;
  link?: { href: string; label: string };
}

function ChecklistItem({ title, subtitle, address, link }: ChecklistItemProps) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-4 items-start py-5 border-b border-[var(--color-border)]">
      <span className="font-mono text-[14px] text-vynx-gold">✓</span>
      <div>
        <div className="font-mono text-[12px] tracking-wide text-white uppercase">
          {title}
        </div>
        <div className="font-body text-[13px] text-vynx-muted mt-1">
          {subtitle}
        </div>
        {address && (
          <div className="font-mono text-[12px] text-vynx-muted mt-1">
            {address}
          </div>
        )}
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] text-vynx-gold hover:text-white transition-colors duration-200 mt-1 inline-block"
          >
            {link.label}
          </a>
        )}
      </div>
    </div>
  );
}

const items: ChecklistItemProps[] = [
  {
    title: "VynxSettlement.sol",
    subtitle: "Verified on Base Sepolia",
    address: "0xA8cA9d84e35ac8F5af6F1D91fe4bE1C0BAf44296",
    link: {
      href: "https://sepolia.basescan.org/address/0xA8cA9d84e35ac8F5af6F1D91fe4bE1C0BAf44296",
      label: "↗ Basescan",
    },
  },
  {
    title: "Go Relayer Engine",
    subtitle: "200ms sealed-bid OFA — live Base Sepolia infrastructure",
  },
  {
    title: "@vynx/sdk",
    subtitle: "TypeScript SDK — EIP-3009 fidelity",
    link: {
      href: "https://www.npmjs.com/package/@vynx/sdk",
      label: "↗ npm",
    },
  },
  {
    title: "End-to-end demo",
    subtitle: "make reviewer-demo — full loop against live infrastructure",
    link: { href: "#", label: "→ GitHub ↗" },
  },
];

export default function OnChainVerifiability() {
  return (
    <section className="py-24">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20">
        <SectionLabel>DEPLOYED · VERIFIABLE · LIVE</SectionLabel>
        <h2 className="font-display text-section-headline leading-none text-white mb-0 text-balance">
          NOT A DECK. A PROTOCOL
        </h2>
        <div className="mt-12">
          {items.map((item) => (
            <ChecklistItem key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
