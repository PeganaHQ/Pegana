// Canonical page inventory for the site-wide /llms.txt + /llms-full.txt.
//
// Single source of truth so the two route handlers (app/llms.txt/route.ts,
// app/llms-full.txt/route.ts) can never drift, and a test can assert every
// canonical surface is listed. Per-asset detail pages (/asset/{symbol}) are
// dynamic and enumerated by the sitemap + the REST API, so they're pointed to
// rather than listed one-by-one. Machine endpoints (/api/*) are excluded.
//
// This list used to be "deliberately MORE complete than app/sitemap.ts (which
// omits /systemic, /backtest, /live, /releases and the feeds)". That is no
// longer true: the sitemap now carries /systemic, /backtest,
// /backtest/2025-10-10-usde-depeg, /releases, /embed/demo and every recent
// receipt permalink. The two lists now differ only in intent — the sitemap
// enumerates crawlable URLs, this enumerates surfaces worth describing to a
// model — so a URL in exactly one of them should be a deliberate choice, not
// drift.
//
// /live is NOT listed: it is a 308 redirect stub to /events, not a page.

import { FAQ } from "@/lib/content/faq";

export const SITE_URL = "https://www.pegana.xyz";
export const API_URL = "https://api.pegana.xyz";
export const DOCS_URL = "https://docs.pegana.xyz";

export interface LlmsPage {
  /** Absolute URL, or a site-relative path beginning with "/". */
  href: string;
  title: string;
  /** One-line description of what the page is / what an agent finds there. */
  desc: string;
}
export interface LlmsSection {
  heading: string;
  pages: LlmsPage[];
}

// Short blockquote for /llms.txt; the long preamble is only in /llms-full.txt.
export const SUMMARY =
  "The peg-risk oracle for Solana. Pegana tracks the divergence between each " +
  "asset's intrinsic value (what its peg mechanism says it is worth) and its " +
  "market value (what a swap actually returns) for 68 live LSTs, stablecoins " +
  "and yield-bearing tokens on Solana mainnet, publishing state " +
  "transitions and reproducible audit receipts over REST, WebSocket and MCP.";

// Extended context, only emitted in /llms-full.txt.
export const FULL_CONTEXT = `Core mental model: intrinsic − market = discount → EWMA smoothing → threshold classification with hysteresis → state machine → transition → alert + receipt.

Intrinsic value is derived per peg mechanism: fiat stablecoins anchor to $1; LSTs use the Sanctum SOL-value or the SPL stake-pool NAV; yield-bearing tokens use issuer-attested NAV; hyUSD uses its on-chain collateral ratio. When the intrinsic-vs-market gap crosses per-asset thresholds, Pegana publishes a state transition and emits a public audit receipt (methodology version + frozen inputs) that is reproducible byte-for-byte offline via the pegana-replay CLI, optionally committed on-chain via SPL Memo.

Loop Intelligence (the /systemic page) is an advisory, anonymous cross-protocol depeg-cascade model: it reads k-anonymised health-factor distributions from Kamino and Jupiter Lend (never any wallet or position owner) to estimate how much leveraged collateral would liquidate if an asset depegs. It is a model estimate, never a verifiable receipt.`;

export const LLMS_SECTIONS: LlmsSection[] = [
  {
    heading: "Core",
    pages: [
      {
        href: "/",
        title: "Pegana: home",
        desc: "The live peg-risk oracle: headline board and how the intrinsic−market discount pipeline works.",
      },
      {
        href: "/about",
        title: "About",
        desc: "The problem Pegana solves, who it is for, and the peg-risk thesis.",
      },
      {
        href: "/faq",
        title: "FAQ",
        desc: "Direct answers to what a peg-risk oracle is, what each peg state means, how to verify an alert, and what Pegana cannot detect.",
      },
      {
        href: "/methodology",
        title: "Methodology",
        desc: "Per-mechanism intrinsic derivation, EWMA smoothing, threshold classification with hysteresis, the state machine, and receipt hashing.",
      },
      {
        href: "/agents",
        title: "For AI agents",
        desc: "Machine-readable access: a free MCP server, and how agents consume the peg feed.",
      },
      {
        href: "/lst",
        title: "LST peg board",
        desc: "Liquid-staking-token board: SOL-value intrinsic vs market for every tracked LST.",
      },
    ],
  },
  {
    heading: "Console",
    pages: [
      {
        href: "/dashboard",
        title: "Dashboard",
        desc: "The live peg board: current state, discount, and freshness for every tracked asset.",
      },
      {
        href: "/assets",
        title: "Assets screener",
        desc: "Sortable screener of all tracked assets with class, state, discount and market cap.",
      },
      {
        href: "/events",
        title: "Events",
        desc: "Chronological feed of peg state transitions (alerts), each linked to its audit receipt.",
      },
      {
        href: "/compare",
        title: "Compare",
        desc: "Side-by-side peer comparison of peg behaviour across assets.",
      },
      {
        href: "/systemic",
        title: "Loop Intelligence",
        desc: "Advisory cross-protocol depeg-cascade simulator: pick a token and depeg depth to see how much leveraged collateral liquidates across Solana lending markets (anonymous, k-anonymised).",
      },
      {
        href: "/status",
        title: "Status",
        desc: "Calibration and coverage status: which assets are calibrated vs monitoring-only / beta.",
      },
      {
        href: "/status/calibration",
        title: "Calibration detail",
        desc: "Per-asset calibration bands and thresholds.",
      },
    ],
  },
  {
    heading: "Trust & data",
    pages: [
      {
        href: "/audit",
        title: "Audit receipts",
        desc: "Public receipts for every state transition: methodology version, frozen inputs, and optional on-chain SPL-Memo commitment, reproducible byte-for-byte via pegana-replay.",
      },
      {
        href: "/backtest",
        title: "Backtests",
        desc: "Replayable historical depeg episodes run against the exact methodology.",
      },
      {
        href: "/backtest/2025-10-10-usde-depeg",
        title: "USDe depeg backtest",
        desc: "The 2025-10-10 USDe-cascade episode, reproduced byte-exact.",
      },
      {
        href: "/whats-new",
        title: "What's new",
        desc: "Product changelog and recently shipped features.",
      },
      {
        href: "/releases",
        title: "Releases",
        desc: "The pegana-replay CLI installer and release binaries for offline receipt verification.",
      },
    ],
  },
  {
    heading: "Feeds",
    pages: [
      {
        href: "/feed/events.xml",
        title: "Events feed (RSS)",
        desc: "RSS feed of peg state transitions.",
      },
      {
        href: "/audit.xml",
        title: "Audit feed",
        desc: "Feed of newly published audit receipts.",
      },
      {
        href: "/calibration.xml",
        title: "Calibration feed",
        desc: "Feed of calibration changes.",
      },
    ],
  },
  {
    heading: "API & docs",
    pages: [
      {
        href: DOCS_URL,
        title: "Developer docs",
        desc: "REST, WebSocket and MCP integration guides: data model, rate limits, pagination, versioning and recipes.",
      },
      {
        href: `${DOCS_URL}/llms.txt`,
        title: "Docs machine index",
        desc: "The developer-docs llms.txt (auto-generated by Mintlify).",
      },
      {
        href: API_URL,
        title: "REST + WebSocket API",
        desc: "The public API base. GET /v1/assets for the full tracked-asset list, /v1/peg/feed for the live board, /v1/audit/{id} for a receipt.",
      },
    ],
  },
  {
    heading: "Legal",
    pages: [
      { href: "/privacy", title: "Privacy", desc: "Privacy policy." },
      { href: "/terms", title: "Terms", desc: "Terms of service." },
    ],
  },
];

/** Absolute URL for a page href (site-relative paths are prefixed with SITE_URL). */
export function absUrl(href: string): string {
  return href.startsWith("http") ? href : `${SITE_URL}${href}`;
}

/** Every canonical href, flattened — used by the completeness test. */
export function allHrefs(): string[] {
  return LLMS_SECTIONS.flatMap((s) => s.pages.map((p) => p.href));
}

function renderSections(): string {
  return LLMS_SECTIONS.map(
    (s) =>
      `## ${s.heading}\n` +
      s.pages
        .map((p) => `- [${p.title}](${absUrl(p.href)}): ${p.desc}`)
        .join("\n"),
  ).join("\n\n");
}

/** /llms.txt — the concise site index (llmstxt.org shape). */
export function buildLlmsIndex(): string {
  return `# Pegana\n\n> ${SUMMARY}\n\n${renderSections()}\n`;
}

/** /llms-full.txt — the same complete inventory with extended context up top. */
/** The five peg states, inlined so a model needs no follow-up fetch. */
const STATE_VOCAB = `## Peg states

- PEGGED: the spread is inside the asset's own calibrated drift band.
- DRIFT: outside the drift band but short of the depeg threshold. Worth watching; not yet an event.
- DEPEG: past the depeg threshold, with hysteresis confirming it held.
- CRITICAL: a deep, sustained break.
- BLACK_SWAN: an extreme dislocation; auto-exits via normal hysteresis, it is not a terminal state.
- UNKNOWN: an input is missing or failed a sanity check. Pegana reports that it does not know rather than guessing.`;

/** The limits, inlined. Stating these is the point of publishing at all. */
const LIMITS = `## What Pegana does NOT detect

- Slippage at size. A peg that holds for $10k may not hold for $10m; the market leg is a best-executable quote, not a depth curve.
- Mechanism depegs. If the peg DESIGN itself changes, the intrinsic value Pegana computes is silently wrong while the spread reads near zero.
- Solvency and bad debt.
- A backing source that has frozen while still reporting fresh timestamps: the staleness gate is a timestamp gate, and the liveness detector for this currently ships disabled.
- Duration is published on /v1/assets but is NOT part of the hashed receipt.`;

export function buildLlmsFull(): string {
  // `llms-full.txt` is supposed to INLINE the content, not repeat the link index
  // with a longer preamble — that was the old behaviour and it meant a model had
  // to make N follow-up fetches to answer anything specific. The FAQ is shared
  // from lib/content/faq.ts (the same data /faq renders), so the two can never
  // drift; drifted answers about what a product cannot do are worse than none.
  const faq = FAQ.map((e) => `### ${e.q}\n\n${e.a}`).join("\n\n");
  return (
    `# Pegana: full context\n\n> ${SUMMARY}\n\n${FULL_CONTEXT}\n\n` +
    `${STATE_VOCAB}\n\n${LIMITS}\n\n## Frequently asked\n\n${faq}\n\n` +
    `Per-asset pages (/asset/{symbol}) and per-receipt pages (/audit/{id}) are ` +
    `dynamic; the full live list is at ${SITE_URL}/sitemap.xml and via ` +
    `${API_URL}/v1/assets. Example asset pages: ${SITE_URL}/asset/jitoSOL, ` +
    `${SITE_URL}/asset/USDe.\n\n${renderSections()}\n`
  );
}
