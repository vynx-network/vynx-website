# VynX Network

The public-facing website of the VynX protocol — a 200ms sealed-bid Order Flow Auction settlement layer for the AI agent economy on Base.

## Overview

`vynx.network` is the institutional front door to the VynX protocol. The protocol itself is a 200ms sealed-bid Order Flow Auction (OFA) settlement layer for cross-chain transfer intents issued by AI agents, settling on Base. This repository is the marketing and documentation site that communicates that protocol — its thesis, its solver program, and its agent integration surface.

The site speaks to a single audience: institutional readers. Crypto-native VCs, market makers, and prospective solvers — qualified counterparties, not retail. The register is deliberate: cold, declarative, technically precise. Every number on the site is real and traceable to the protocol documentation in [`docs/`](docs/).

What this repository is **not**:

- **Not a dapp.** There is no wallet connection, no transaction signing, no on-chain interaction.
- **Not a retail interface.** No onboarding flows, no consumer UX, no "connect to get started."
- **Not the protocol.** The settlement contracts, relayer, and SDK live elsewhere. This is the site that describes them.

## Live Routes

| Route       | Purpose                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `/`         | Landing page — institutional entry point (7 sections)                     |
| `/thesis`   | Network Thesis — public version (§1–§4); no cap table, no raise terms     |
| `/solvers`  | Solver Program documentation — economics, risk framework, integration     |
| `/agents`   | Agent Integration documentation — SDK reference, EIP-712 payload, lifecycle |

Two additional generated routes exist: `/sitemap.xml` and `/robots.txt` (from `app/sitemap.ts` and `app/robots.ts`).

## Tech Stack

| Technology        | Version     | Notes                                                       |
| ----------------- | ----------- | ----------------------------------------------------------- |
| Next.js           | `16.2.6`    | App Router, no `src/` dir, `@/*` import alias               |
| React             | `19.2.4`    | `react` + `react-dom`                                       |
| TypeScript        | `^5`        | Strict                                                      |
| Tailwind CSS      | `^4`        | `@theme inline` in `globals.css` — **no `tailwind.config.ts`** |
| `@tailwindcss/postcss` | `^4`   | PostCSS pipeline (`postcss.config.mjs`)                     |
| `next/font`       | (bundled)   | Self-hosted Google fonts, zero layout shift                 |
| Playwright        | `^1.60.0`   | Drives the Playwright MCP UX-audit loop                     |
| ESLint            | `^9`        | `eslint-config-next@16.2.6`                                 |

**Fonts** (via `next/font/google`, see `app/layout.tsx`):

- **Bebas Neue** (400) — display headlines, metrics, section titles
- **DM Sans** (300/400/500) — body prose
- **JetBrains Mono** (400) — labels, addresses, code, legal text

**Tailwind v4 note:** there is no `tailwind.config.ts`. All theme configuration lives in `app/globals.css` via `@import "tailwindcss"`, a `:root` block of CSS custom properties, and an `@theme inline` block that maps them to Tailwind utilities (`bg-vynx-bg`, `text-vynx-gold`, `font-display`, etc.).

## Getting Started

### Prerequisites

- **Node.js `>= 20.9.0`** (the minimum required by Next.js 16; the project is developed on Node 22.x)
- **npm** (the repo ships a `package-lock.json`)

### Installation

```bash
git clone <repository-url>
cd vynx-website
npm install
npm run dev
```

The dev server runs at `http://localhost:3000`. **No environment variables are required for local development** — the site is fully static and has no runtime secrets.

### Build

```bash
npm run build
```

All routes prerender as static content. There is no server runtime; the output is a static site suitable for any static host.

## Project Structure

```
app/                       Next.js App Router pages and layouts
  layout.tsx               Root layout: fonts, Navbar, Footer, global metadata
  page.tsx                 Landing page (7 sections)
  globals.css              Tailwind import + design tokens (:root, @theme inline)
  sitemap.ts               Generates /sitemap.xml
  robots.ts                Generates /robots.txt
  thesis/                  Network Thesis public document
  solvers/                 Solver Program documentation
  agents/                  Agent Integration documentation
components/
  landing/                 Landing page section components (Hero, DominanceMatrix,
                           TheProblem, ProtocolMechanics, SolverProgram, Distribution,
                           OnChainVerifiability, and their sub-components)
  thesis/                  ThesisHeader, ThesisSection wrapper, ThesisGate card
  docs/                    FaqAccordion + diagrams/ (visual protocol diagrams)
    diagrams/              SettlementFlow, JailLadder, IntentStateMachine,
                           AuctionTimeline, CollateralBands
  ui/                      Shared primitives: Card, Button, SectionLabel, CodeBlock
  layout/                  Navbar, Footer, DocsLayout, DocsSidebar
public/                    Static assets served at the web root. Currently holds no
                           committed assets — the navbar wordmark is inline text, not a
                           logo file, and the favicon is app/icon.svg (App Router
                           convention). og.png is not committed; it is build-generated by
                           scripts/generate-og.mjs at pre-deploy and gitignored.
docs/                      Protocol documentation (source of truth)
  settlement/              Smart contract architecture, contracts, flows, security, tests
  relayer/                 Relayer architecture, hot/cold path, keeper, watchdog, infra
  sdk/                     SDK integration guides (getting started, adapters, errors)
.claude/
  agents/                  Claude Code agents for automated auditing
    ux-auditor.md          Visual UX audit agent (Playwright loop)
    copy-auditor.md        Copy audit and rewrite agent
scripts/                   Build utilities — generate-og.mjs (OG image) + screenshot helpers
```

## Design System

### Philosophy

VynX is a Mercedes-AMG GT. Not a hypercar that screams; not a sedan that whispers. Controlled aggression. Precision without ornament. Every pixel justified. The visual language communicates one thing: this is a protocol, not a product — a Bloomberg Terminal crossed with a Flashbots research post. Institutional. Technical. Uncompromising.

### Palette

All tokens are defined in `app/globals.css` (`:root`) and exposed to Tailwind via `@theme inline`.

| Variable                | Hex / Value                | Usage                                          |
| ----------------------- | -------------------------- | ---------------------------------------------- |
| `--color-bg`            | `#000000`                  | Pure black. Every page. No exceptions.         |
| `--color-bg-card`       | `#0D0D0D`                  | Cards, code blocks, elevated surfaces.         |
| `--color-bg-subtle`     | `#111111`                  | Hover states, secondary surfaces.              |
| `--color-text-primary`  | `#FFFFFF`                  | Main content, headlines, values.               |
| `--color-text-muted`    | `#888888`                  | Body prose, descriptions, secondary text.      |
| `--color-text-faint`    | `#7F7F7F`                  | Labels, metadata, legal (WCAG AA on `#000`).   |
| `--color-gold`          | `#C9A84C`                  | The only warm color. Precision accent.         |
| `--color-gold-dim`      | `#8A7234`                  | Gold in inactive/secondary contexts.           |
| `--color-border`        | `rgba(255,255,255,0.08)`   | Default card/table border.                     |
| `--color-border-gold`   | `rgba(201,168,76,0.4)`     | Active/highlighted border.                     |

### Typography

| Font            | Role                                              | Scale rule                                              |
| --------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Bebas Neue      | Display — headlines, metrics, section titles, step numbers | Hero `clamp(56px,8vw,96px)`; section/metric 40–64px; always uppercase, tight tracking |
| DM Sans         | Body — prose, descriptions, FAQ answers           | Prose 13–15px, `font-light` (300), relaxed leading      |
| JetBrains Mono  | Mono — labels, badges, addresses, code, legal     | Labels 10–11px uppercase, tracked; code 13px; addresses 12px |

Rule of thumb: headlines are **only** Bebas Neue; body prose is **only** DM Sans; labels/addresses/code are **only** JetBrains Mono.

### Gold Rule

Gold (`#C9A84C`) is the single most disciplined element of the system. It is a precision accent, not decoration — overuse dilutes its meaning. Gold appears **only** on the following elements; every other use is a violation:

- The **"X"** in the VYNX wordmark
- `SectionLabel` text and its horizontal rule
- Primary CTA button: border + text (hover inverts to `bg-gold text-black`)
- Active nav link indicator in the docs sidebar (`border-l-2`)
- Metric card state dots — gold for `BOUND` (green `#4ADE80` for `LIVE`)
- Checkmark `✓` icons in OnChainVerifiability
- Highlighted table rows (VynX OFA row, SLASHED lifecycle row, N5 jail row)
- Section-header numbers in the thesis (§1.1, §2.4, …)
- The `↗` external-link indicators next to Basescan / npm links
- `NashBlock` and `ThesisGate` gold borders
- The Base chain badge (highlighted vs. other chains)
- FAQ toggle `+`/`−` symbols
- CRITICAL-category error labels only (e.g., `DEADLINE BREACH`)

Anything else — stat-strip labels, step titles, requirement values, SDK method names, npm package text — must be `text-white` or `text-vynx-muted`, never gold.

### Key Constraints

- **`rounded-[2px]` only** on cards, badges, table rows, and code blocks — never `rounded-sm` or higher. State dots (≤6px) may be `rounded-full`. Nothing else gets a radius.
- **Tailwind v4:** `@theme inline` in `globals.css`, never a `tailwind.config.ts`.
- **No gradients, no shadows, no glow** anywhere. The design is flat and solid-color.
- **Section rhythm:** `py-24` between major landing sections.

### Responsive Breakpoints

Layout is driven entirely by Tailwind responsive prefixes (no CSS media queries, no JS layout):

- **Docs sidebar** (`DocsSidebar`) is hidden below `lg:` (≥1024px); on smaller screens the docs pages are single-column.
- **Docs content** is left-anchored and widens at `xl:` (≥1280px) to fill the reclaimed width without dead space.
- **Mobile (≤768px):** fixed-column tables and code blocks scroll horizontally via `overflow-x-auto`; marker grids use `minmax(0,1fr)` so inner scroll containers engage instead of overflowing the page.
- **Active nav** uses an `IntersectionObserver` scroll-spy with a gold `border-l-2` indicator; smooth scroll is offset for the sticky navbar.

## Claude Code Agents

Two Claude Code agents live in `.claude/agents/` for automated auditing:

- **`ux-auditor`** — a Senior Staff UX Engineer that uses the Playwright MCP to render each route, take screenshots at **1440px** (desktop) and **375px** (mobile), audit the output against the full design system, classify violations (CRITICAL / MINOR / POLISH), implement the CRITICAL and MINOR fixes, and verify the result visually — iterating until all routes pass. It touches styles and layout only, never copy or structure. Run it with `/agent ux-auditor` after configuring the Playwright MCP.
- **`copy-auditor`** — a Senior Staff Copywriter that reads [`docs/`](docs/) as ground truth, audits all site copy for factual mismatches against the protocol, and rewrites to the institutional register (eliminating startup vocabulary, hedging, and passive construction). Copy-only — no browser tools.

### Playwright MCP setup

The MCP server is configured in `.mcp.json` (it runs `npx @playwright/mcp@latest --headless`). This file is **gitignored** — it is local tooling configuration and is not committed to the public repo; recreate it locally to use the audit loop. To enable the `ux-auditor` loop, install the Chromium browser once:

```bash
npx playwright install chromium
```

Then start the dev server (`npm run dev`) and run `/agent ux-auditor`.

## Protocol Context

For developers arriving without context, VynX is:

- A **200ms sealed-bid Order Flow Auction (OFA)** settlement layer for cross-chain transfer intents issued by AI agents.
- Settling on **Base** (Base L2) — chosen for L1-grade security via fault proofs, sub-second blocks, and Coinbase-issued USDC as the canonical collateral and settlement token.
- Deployed on **Base Sepolia**: `VynxSettlement` at `0xA0d462b84C2431463bDACDC2C5bc3172FC927B0B`.
- Integrated via **`@vynx/sdk`** on npm (`import { VynxCore } from '@vynx/sdk'`).

Full protocol documentation — settlement contracts, relayer architecture, and SDK guides — lives in [`docs/`](docs/) and is the source of truth for every claim on the site.

## Deployment

- **Target:** Vercel.
- All routes prerender as static content (no server runtime).
- **Lighthouse:** Performance 96–97, Accessibility 100, Best Practices 100, SEO 100 across all four routes.
- **Status:** Not yet deployed — pending GitHub push.

## License

Licensed under the **Business Source License 1.1**. See [LICENSE](LICENSE).
