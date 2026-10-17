# Pegana Web

Public frontend + signed-in console for [Pegana](../) — a Solana peg-risk oracle /
Trust Layer. Next.js 16 App Router, deployed to Vercel.

Two route groups under `app/`:

- **`(marketing)`** — the public site: landing (`/`), `/methodology`, `/lst`,
  `/audit`, `/changelog`, `/status`, `/live`, `/agents`,
  `/embed` (badge + widget), `/about`, `/privacy`, `/terms`.
- **`(app)`** — the public console (everything is free and unauthenticated):
  `/dashboard` (live board of the monitored universe + filters + WebSocket
  updates), `/assets` (sortable screener), `/asset/[symbol]` (spread history,
  band gauge, alerts, comparable events, on-chain verify), `/compare`
  (peer overlay), `/events`.

Plus `backtest/*` (replay viewers) and `releases` (CLI release notes).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 (CSS
variables for tokens, custom V2 design system — NOT a shadcn reskin) · Framer
Motion · Recharts · SWR · native WebSocket → React context. A few Base-UI
primitives live in `components/ui/` (tooltip, dropdown, slider), but every data
surface is a hand-built, real semantic `<table>` (see `AGENTS.md`).

## Local dev

Prerequisite: the Rust API + indexer + engine must be running so this surface has
real data to render. See the [root README](../README.md#quick-start-dev-local)
for the backend + `sqlx migrate run --source migrations` flow.

```bash
cd web
cp .env.local.example .env.local
bun install
bun run dev                 # :3000
```

Open <http://localhost:3000>.

If the API is offline the marketing surfaces fall back to a mocked asset list and
the console shows an "API unreachable" panel rather than fabricating data.

## Env

```bash
# web/.env.local
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/v1/ws
```

For Vercel production these point at the public API host (`https://api.pegana.xyz`,
`wss://api.pegana.xyz/v1/ws`).

## Scripts

| Command              | What                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `bun run dev`        | Next dev server on :3000                                                       |
| `bun run build`      | Production build                                                               |
| `bun run start`      | Run the built app on :3000                                                     |
| `bun run typecheck`  | `tsc --noEmit`                                                                 |
| `bun run lint`       | ESLint                                                                         |
| `bun run test`       | Vitest unit tests (~97 files, ~788 tests across atoms/molecules/organisms/lib) |
| `bun run test:watch` | Vitest in watch mode                                                           |
| `bun run test:e2e`   | Playwright (backend-independent specs + a seeded-API suite)                    |

## File structure

Atomic design under `components/`, thin route files under `app/`.

```
web/
├── app/
│   ├── (marketing)/         # public site route group
│   ├── (app)/               # signed-in console route group
│   ├── auth/ · backtest/ · releases/
│   └── globals.css          # @theme design tokens
├── components/
│   ├── atoms/               # BrandMark, Pill, Sparkline, StatePip, icons, …
│   ├── molecules/           # BandGauge, AssetActionStrip, ThresholdPicker, …
│   ├── organisms/           # DashboardBoardRow, AssetsScreenerRow, AlertPolicy,
│   │                        # ComparableEvents, AssetHero, AssetRail, LST tables, …
│   └── ui/                  # Base-UI primitives (tooltip, dropdown, slider)
├── lib/
│   ├── api/                 # types.ts, base.ts, format.ts (reconcileBps, discountToBps)
│   ├── alerts/              # policy.ts (thresholdsFor — the authoritative band source)
│   ├── asset/ · hooks/ · store/ · webhooks/ · auth/ · utils/
└── tests/ · scripts/
```

## Design & conventions

- **Next.js 16 is not the Next.js in your training data.** Read the relevant guide
  in `node_modules/next/dist/docs/` before writing Next.js code — see `AGENTS.md`.
- **Every data surface is a real semantic `<table>`** — never a stack of `<div>`s.
  Two approved idioms (`ListRowsV2` or hand-rolled `<table table-fixed>` +
  `<colgroup>`); horizontal overflow scrolls inside the table container, never the
  page body. Full standard in `AGENTS.md`.
- **Tailwind v4 layer gotcha:** any base reset written OUTSIDE an `@layer` in
  `globals.css` silently overrides every utility. Always wrap base styles in
  `@layer base { … }`.
- **Custom V2 design system, not shadcn:** the brand tokens in `@theme {}` are the
  source of truth. Don't run `shadcn init` (it re-adds its own oklch palette + font
  bindings).
