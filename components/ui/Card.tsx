import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  goldBorder?: boolean;
}

export default function Card({
  children,
  className = "",
  goldBorder = false,
}: CardProps) {
  const borderClass = goldBorder
    ? "border-[var(--color-border-gold)]"
    : "border-[var(--color-border)] hover:border-[var(--color-border-gold)]";

  return (
    <div
      className={`bg-vynx-bg-card border rounded-[2px] p-6 transition-colors duration-200 ${borderClass} ${className}`}
    >
      {children}
    </div>
  );
}
