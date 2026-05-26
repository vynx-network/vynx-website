"use client";

import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  label?: string;
}

export default function CodeBlock({ code, language, label }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const headerLabel = label ?? language;

  return (
    <div className="bg-vynx-bg-card border border-[var(--color-border)] rounded-[2px]">
      {headerLabel && (
        <div className="flex justify-between items-center px-4 py-2 border-b border-[var(--color-border)]">
          <span className="font-mono text-[10px] tracking-widest text-vynx-faint uppercase">
            {headerLabel}
          </span>
          <button
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy code"}
            className="font-mono text-[10px] text-vynx-faint hover:text-white transition-colors duration-200"
          >
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>
      )}
      <pre className="px-4 py-4 overflow-x-auto font-mono text-[13px] text-white leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  );
}
