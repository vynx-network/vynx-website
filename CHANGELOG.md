# VynX Network — Changelog

All significant architectural decisions, security hardening milestones, and
protocol changes are documented here. This file is written for engineers and
AI models reviewing the codebase — not as a sprint log, but as a record of
_why_ the system is the way it is.

Format: `[vX.Y.Z] YYYY-MM-DD — Title`

---

## [Unreleased]

### Added

- Responsive design audit across 10 viewports × 4 routes.
- XL layout: docs content widens left-anchored at 1280px+.
- Tablet sidebar hidden below 1024px (`lg:`).
- Scroll-based active nav with gold left border (`IntersectionObserver`).
- Smooth scroll with navbar offset (`scroll-behavior` + `scroll-padding-top`).
- Active navbar link state (white, route-based).
- Playwright MCP integration for automated visual auditing.
- README, LICENSE (BUSL-1.1), CHANGELOG.

### Fixed

- Gold discipline: ~28 violations corrected sitewide.
- Protocol fact mismatches surfaced by the `docs/` audit.
- Section-headline periods removed.
- Body-text `max-w` constraints relaxed on full-width sections.
- Mobile overflow on fixed-column tables (`overflow-x-auto`).
- `suppressHydrationWarning` on `<body>` (browser-extension interference).
- `--color-text-faint` corrected from `#444444` to `#7F7F7F` (WCAG AA).
- Bebas Neue `font-display` changed to `optional` (LCP fix).

---
