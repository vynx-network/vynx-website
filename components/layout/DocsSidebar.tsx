"use client";

import { useState, useEffect, useRef } from "react";

interface NavItem {
  label: string;
  href: string;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

interface DocsSidebarProps {
  sections: NavSection[];
  title: string;
}

const activeClass =
  "text-vynx-text border-l-2 border-vynx-gold pl-3 py-1 block font-body text-[14px] transition-colors duration-150";
const inactiveClass =
  "text-vynx-muted hover:text-vynx-text border-l-2 border-transparent pl-3 py-1 block font-body text-[14px] transition-colors duration-150";

export default function DocsSidebar({ sections, title }: DocsSidebarProps) {
  const firstId = sections[0]?.items[0]?.href.replace(/^#/, "") ?? "";
  const [activeId, setActiveId] = useState(firstId);
  const visibleRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const observed = Array.from(
      document.querySelectorAll<HTMLElement>("section[id]")
    );
    if (observed.length === 0) return;

    const allIds = sections.flatMap((s) => s.items.map((i) => i.href.slice(1)));
    const lastId = allIds[allIds.length - 1] ?? "";

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = visibleRef.current;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.boundingClientRect.top);
          } else {
            visible.delete(entry.target.id);
          }
        }
        // The section highest in the viewport (smallest top) is active.
        // When nothing intersects the active band, keep the last active link.
        let topId = "";
        let topValue = Infinity;
        for (const [id, top] of visible) {
          if (top < topValue) {
            topValue = top;
            topId = id;
          }
        }
        if (topId) setActiveId(topId);
      },
      // 0.3 is the activation threshold; 0 is included so entry/exit into the
      // band still fires for sections taller than the band (whose ratio can
      // never reach 0.3) — otherwise scrolling through a long section would
      // never update the active link.
      { threshold: [0, 0.3], rootMargin: "-80px 0px -60% 0px" }
    );

    observed.forEach((el) => observer.observe(el));

    // When the user reaches the bottom of the page, the last section can't
    // scroll into the observer band — activate it directly.
    const onScroll = () => {
      if (
        lastId &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 4
      ) {
        setActiveId(lastId);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections]);

  const NAVBAR_HEIGHT = 72; // h-14 (56px) + 16px breathing room

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const id = href.slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - NAVBAR_HEIGHT;
    window.scrollTo({ top, behavior: "smooth" });
    setActiveId(id);
  };

  return (
    <aside className="hidden lg:flex flex-col w-70 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pr-8 pb-8 border-r border-[var(--color-border)]">
      <p className="font-mono text-[11px] tracking-widest text-vynx-text uppercase mb-8">
        {title}
      </p>

      {sections.map((section, si) => (
        <div key={si}>
          {section.title && (
            <p className="font-mono text-[10px] tracking-[0.2em] text-vynx-faint uppercase mt-6 mb-3">
              {section.title}
            </p>
          )}
          {section.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={(e) => handleNavClick(e, item.href)}
              aria-current={
                activeId === item.href.slice(1) ? "page" : undefined
              }
              className={
                activeId === item.href.slice(1) ? activeClass : inactiveClass
              }
            >
              {item.label}
            </a>
          ))}
        </div>
      ))}
    </aside>
  );
}
