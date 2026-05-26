import { ReactNode } from "react";

export default function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-10">
      <span className="block w-8 border-t border-vynx-gold" />
      <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-vynx-gold">
        {children}
      </span>
    </div>
  );
}
