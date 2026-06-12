"use client";

import { useTheme } from "next-themes";

const toggleClass =
  "flex items-center text-vynx-muted hover:text-vynx-text transition-colors duration-200";

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // resolvedTheme is undefined on the server and first client render
  // (next-themes resolves it post-hydration) — default to the dark
  // assumption so SSR + first paint agree. The icon shows the theme you'll
  // switch TO: sun in dark, moon in light. suppressHydrationWarning covers a
  // light-persisted hydrate.
  const isDark = resolvedTheme !== "light";
  const target = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(target)}
      aria-label={`Switch to ${target} theme`}
      className={toggleClass}
      suppressHydrationWarning
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
