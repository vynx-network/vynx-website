"use client";

import { useState } from "react";

export interface FaqItem {
  q: string;
  a: string;
}

interface FaqAccordionProps {
  items: FaqItem[];
}

export default function FaqAccordion({ items }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="border-b border-[var(--color-border)]">
          <button
            id={`faq-btn-${i}`}
            aria-expanded={openIndex === i}
            aria-controls={`faq-panel-${i}`}
            className="flex justify-between items-center py-4 w-full text-left cursor-pointer"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            <span className="font-body font-medium text-[15px] text-white">
              {item.q}
            </span>
            <span className="font-mono text-[16px] text-vynx-gold ml-4 shrink-0">
              {openIndex === i ? "−" : "+"}
            </span>
          </button>
          {openIndex === i && (
            <div
              id={`faq-panel-${i}`}
              role="region"
              aria-labelledby={`faq-btn-${i}`}
            >
              <p className="font-body font-light text-[14px] text-vynx-muted pb-4 leading-relaxed">
                {item.a}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
