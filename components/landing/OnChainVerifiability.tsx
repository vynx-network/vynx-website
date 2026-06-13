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
        <div className="font-mono text-[12px] tracking-wide text-vynx-text uppercase">
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
            className="font-mono text-[12px] text-vynx-gold mt-1 inline-block"
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
    title: "PROTOCOL CONTRACTS",
    subtitle: "6 contracts across Ethereum L1 + Base L2 · BLINDAJE-hardened",
  },
  {
    title: "GO RELAYER ENGINE",
    subtitle: "runs the 200ms sealed-bid OFA, end to end on Base Sepolia",
  },
  {
    title: "TYPESCRIPT SDK",
    subtitle: "functional SDK for Agentkit and ElizaOS · publish-ready",
  },
  {
    title: "END-TO-END DEMO",
    subtitle: "full settlement loop demonstrable under NDA",
  },
];

export default function OnChainVerifiability() {
  return (
    <section className="py-10">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20">
        <SectionLabel>BUILT · HARDENED · DEMONSTRABLE</SectionLabel>
        <h2 className="font-display text-section-headline leading-none text-vynx-text mb-0 text-balance">
          NOT A DECK. A PROTOCOL
        </h2>
        <p className="font-body font-light text-[15px] text-vynx-muted mt-4 leading-relaxed">
          Every component available for audit under NDA.
        </p>
        <div className="mt-12">
          {items.map((item) => (
            <ChecklistItem key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
