"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const navLinks = [
  { label: "THESIS", href: "/thesis" },
  { label: "SOLVERS", href: "/solvers" },
  { label: "AGENTS", href: "/agents" },
  {
    label: "REQUEST ACCESS",
    href: "mailto:cristian@vynx.network",
    external: true,
  },
];

const baseLinkClass =
  "font-mono text-[11px] tracking-widest transition-colors duration-200";
const activeLinkClass = `${baseLinkClass} text-vynx-text`;
const inactiveLinkClass = `${baseLinkClass} text-vynx-muted hover:text-vynx-text`;

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-vynx-bg">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="font-display text-[22px] tracking-[0.05em] text-vynx-text"
        >
          VYN<span className="text-vynx-gold">X</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={inactiveLinkClass}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                href={link.href}
                className={
                  pathname === link.href ? activeLinkClass : inactiveLinkClass
                }
              >
                {link.label}
              </Link>
            ),
          )}
          <ThemeToggle />
        </div>

        <button
          className="md:hidden text-vynx-muted hover:text-vynx-text transition-colors duration-200"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            {open ? (
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              />
            ) : (
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
              />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-[var(--color-border)] px-6 py-4 flex flex-col gap-4">
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={inactiveLinkClass}
              >
                {link.label} <span className="text-vynx-gold">↗</span>
              </a>
            ) : (
              <Link
                key={link.label}
                href={link.href}
                className={
                  pathname === link.href ? activeLinkClass : inactiveLinkClass
                }
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ),
          )}
          <ThemeToggle />
        </div>
      )}
    </nav>
  );
}
