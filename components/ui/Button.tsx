import Link from "next/link";
import { ReactNode } from "react";

interface ButtonProps {
  variant: "primary" | "secondary";
  children: ReactNode;
  href?: string;
  target?: string;
}

const base =
  "font-mono text-[11px] tracking-widest uppercase px-7 py-3 transition-all duration-200 inline-block";

const styles = {
  primary: `${base} border border-vynx-gold text-vynx-gold bg-transparent hover:bg-vynx-gold hover:text-black`,
  secondary: `${base} border border-[var(--color-border)] text-vynx-muted bg-transparent hover:border-white hover:text-white`,
};

export default function Button({ variant, children, href, target }: ButtonProps) {
  const className = styles[variant];

  if (!href) {
    return <button className={className}>{children}</button>;
  }

  const isExternal = href.startsWith("mailto:") || href.startsWith("http") || target === "_blank";
  if (isExternal) {
    return (
      <a
        href={href}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
