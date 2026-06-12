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
    title: "Go Relayer Engine",
    subtitle: "runs the 200ms sealed-bid OFA in the reviewer-demo",
  },
  {
    title: "End-to-end demo",
    subtitle: "make reviewer-demo — full loop, end to end · available under NDA",
  },
];

export default function OnChainVerifiability() {
  return (
    <section className="py-24">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20">
        <SectionLabel>BUILT · HARDENED · DEMONSTRABLE</SectionLabel>
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
