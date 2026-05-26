interface ThesisSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

export default function ThesisSection({
  id,
  title,
  children,
}: ThesisSectionProps) {
  return (
    <div id={id} className="mb-24">
      <h2 className="font-display text-section-heading text-white leading-tight mt-1">
        {title}
      </h2>
      <div className="border-b border-[var(--color-border)] mt-4 mb-10" />
      {children}
    </div>
  );
}
