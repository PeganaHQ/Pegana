"use client";

import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { DistanceFieldCanvas } from "@/components/organisms/v2/distance-field-canvas";
import { DecorWaveSvg } from "@/components/organisms/v2/decor-wave";
import {
  ListRowsV2,
  ListRow,
  ListRowHead,
} from "@/components/organisms/v2/inner/list-rows-v2";
import {
  EyebrowPillV2,
  PillGhost,
  PillPrimary,
} from "@/components/organisms/v2/shared";

// /whats-new — the relaunch, built in Pegana's OWN V5 language (DESIGN.md):
// the landing's centered hero (huge Switzer + iridescent clause + distance-
// field ambient), the real on-chain receipt floated under the iridescent arc
// exactly like the hero's Live peg board, editorial change-tables (the same
// real-<table> ListRowsV2 the methodology/audit pages use), the canonical
// stat strip, and the close section's iridescent wave glow. No bespoke card
// grid, no invented palette — every surface is the shipped design system.
// Every claim reflects validated, shipped reality.

// ── content (validated, shipped) ─────────────────────────────────────────────

type Entry = { tag: string; head: string; body: string };
type Group = {
  n: string;
  eyebrow: string;
  h: string;
  intro: string;
  entries: Entry[];
};

const GROUPS: ReadonlyArray<Group> = [
  {
    n: "01",
    eyebrow: "V1 · live on mainnet",
    h: "V1 is live.",
    intro:
      "Everything below this section shipped to production on 2026-07-23 and has been running since. 68 assets on the public peg surface. 72 in the canon, 69 active on mainnet, 56 fully calibrated.",
    entries: [
      {
        tag: "systemic",
        head: "What a depeg would actually liquidate",
        body: "The new systemic view maps over $800M of leveraged collateral riding on these assets across Kamino and Jupiter Lend, and answers the question a risk desk actually asks: at a 500 bps shock, how much gets liquidated? Anonymous by construction. Distributions only, never a wallet.",
      },
      {
        tag: "calibration",
        head: "56 assets now fully calibrated",
        body: "A batch recalibration promoted 36 assets from provisional to calibrated, with bands derived from their own observed 8-day distributions instead of hand-set defaults.",
      },
      {
        tag: "category",
        head: "We stopped publishing a peg for something with no peg",
        body: "A leveraged token trades far from its own NAV by design, so “market vs intrinsic” measures leverage, not peg risk. Publishing a peg verdict for it was a category error, so we removed it from the peg surface rather than explain it away.",
      },
      {
        tag: "real-time",
        head: "The live feed, actually live",
        body: "A compression layer had been corrupting the WebSocket upgrade handshake for browsers since May. Non-browser clients never saw it, which is why it hid so long. Fixed and verified in production; the feed streams every recompute.",
      },
    ],
  },
  {
    n: "02",
    eyebrow: "For developers",
    h: "Built to be consumed, and to be doubted.",
    intro:
      "The whole surface is public and keyless: 39 REST endpoints under one self-describing contract, a live WebSocket feed, and an MCP server so an agent can ask directly.",
    entries: [
      {
        tag: "verify",
        head: "Check any alert yourself, in 60 seconds",
        body: "cargo install pegana-replay --locked, then point it at any alert id. It recomputes the receipt hash from frozen inputs and checks the on-chain anchor against a pinned signer. Not our word. Your machine's.",
      },
      {
        tag: "sdks",
        head: "TypeScript and Python clients",
        body: "Generated from the OpenAPI 3.1 spec, covering every endpoint, plus a hand-written helper for the live WebSocket feed in both languages.",
      },
      {
        tag: "contract",
        head: "One response shape, everywhere",
        body: "Every list endpoint returns the same envelope, every timestamp the same format, every decimal exact. Boring on purpose. An integrator should never have to special-case a field.",
      },
      {
        tag: "agents",
        head: "An MCP server for agents",
        body: "Ten tools, including receipt verification and the depeg-cascade simulator. Free, no API keys.",
      },
    ],
  },
  {
    n: "03",
    eyebrow: "Trust & methodology · v0.7.0",
    h: "We rebuilt the minute that matters most.",
    intro:
      "A peg oracle earns its keep in the worst minute of an asset's life. This release rebuilt exactly that path. So a real catastrophe gets called, not buried under “data looks unreliable.”",
    entries: [
      {
        tag: "black swan",
        head: "A real collapse now reads BLACK_SWAN",
        body: "A NAV-sanity guard was masking genuine >30% depegs as UNKNOWN, indefinitely. Now a sustained, hysteresis-confirmed collapse surfaces as exactly what it is.",
      },
      {
        tag: "oracles",
        head: "Confirmed verdicts survive noisy oracles",
        body: "Pyth confidence widens during the very volatility a crash produces. A confirmed verdict is no longer erased by the market stress that proves it real.",
      },
      {
        tag: "one path",
        head: "One verdict, re-derivable three ways",
        body: "The live engine, the offline replay CLI and the backtest re-derive the same verdict. Byte-for-byte, with the CLI release that matches the receipt's methodology version (0.4.0 onward). Every severe alert ships a receipt anyone can reproduce and check against the chain.",
      },
      {
        tag: "staleness",
        head: "Honest-dark when a feed goes stale",
        body: "A new Pyth-confidence gate and a numéraire-staleness check mean a frozen or noisy feed reads UNKNOWN. Never a confident, wrong PEGGED.",
      },
    ],
  },
  {
    n: "04",
    eyebrow: "Security",
    h: "The perimeter, tightened.",

    intro:
      "An adversarial audit closed the last outbound-request gap and hardened every delivery path an integrator depends on.",
    entries: [
      {
        tag: "ssrf",
        head: "Webhook DNS-rebinding, closed",
        body: "Outbound webhook connects are pinned to the exact IP we validated, so a rebinding DNS can't swing a delivery to an internal host between check and connect.",
      },
      {
        tag: "delivery",
        head: "Signed, redirect-locked delivery",
        body: "Every webhook is Ed25519-signed and never follows a redirect. The two ways a delivery could be spoofed or bounced to an internal target stay shut.",
      },
      {
        tag: "recovery",
        head: "Alerts are never silently lost",
        body: "The dispatcher shuts down gracefully and recovers any in-flight alert stranded by a crash. No message read but never delivered.",
      },
      {
        tag: "secrets",
        head: "Secrets stay secret",
        body: "A credential guard blocks accidental key or secret dumps at the tool layer; the on-chain signing key is loaded, never logged.",
      },
    ],
  },
  {
    n: "05",
    eyebrow: "The app, rebuilt",
    h: "It won't show you a number it can't stand behind.",
    intro:
      "Front to back, the console and the public surfaces were reworked so freshness, honesty and reach match the rigor underneath.",
    entries: [
      {
        tag: "freshness",
        head: "A frozen feed can't fake a peg",
        body: "Freshness gates across the dashboard, command palette and embed badges collapse a stale reading to UNKNOWN. The same bound, everywhere.",
      },
      {
        tag: "bands",
        head: "Bands that track the live calibration",
        body: "Every gauge, screener and alert preset reads the authoritative per-asset thresholds the API serves. Recalibrate once, and the whole UI follows.",
      },
      {
        tag: "mobile",
        head: "Onboarding that meets you on mobile",
        body: "The how-it-works walkthrough now opens on phones. The device most people arrive on. With a persistent way back to it.",
      },
      {
        tag: "the desk",
        head: "Built for a desk, not just a glance",
        body: "Portfolio CSV export, a real 52-week event heatmap, a device-local watchlist, and honest “heuristic, not a live verdict” labels where they belong.",
      },
    ],
  },
];

const METRICS: ReadonlyArray<{ v: string; l: string }> = [
  { v: "100%", l: "open methodology" },
  { v: "byte-exact", l: "receipt re-derivation" },
  { v: "on-chain", l: "severe-alert anchoring" },
  { v: "30s", l: "break-confirm window" },
];

// A real anchored Depeg receipt on the CURRENT methodology (mainnet,
// 2026-07-29, USX Drift -> Depeg). Re-verified end-to-end on 2026-07-30 with
// the published crates.io binary: recomputed hash == stored hash, on-chain memo
// and pinned signer both confirmed, exit 0. Slot read from mainnet RPC.
// Anyone can reproduce it:
//   cargo install pegana-replay --locked
//   pegana-replay --alert-id d35a581a-2407-472f-b298-f00096bc1ba1
const RECEIPT_ROWS: ReadonlyArray<{
  k: string;
  v: string;
  accent?: boolean;
}> = [
  { k: "methodology", v: "pegana-v1 · v0.7.0" },
  { k: "alert id", v: "d35a581a…" },
  { k: "slot", v: "436,013,044" },
  { k: "network", v: "Solana mainnet" },
  { k: "status", v: "SUCCESS", accent: true },
  { k: "transaction", v: "3i2pGbDL…" },
  { k: "receipt sha-256", v: "f27f26867b94…88a5f4" },
];

// ── the on-chain proof — the real receipt object (audit/[id] idiom) ──────────

function ProofReceipt() {
  return (
    <div className="v2-in-receipt v2-shadow-receipt">
      <div className="v2-in-rhead">
        <span className="v2-in-rwho">
          <span
            aria-hidden
            className="grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[11px] text-[var(--color-canvas)]"
            style={{ background: "var(--v2-peg)" }}
          >
            ◆
          </span>
          Depeg receipt
          <span className="font-mono text-[11px] text-[var(--v2-muted)]">
            anchored 2026-07-29
          </span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--v2-peg)_40%,transparent)] bg-[rgba(95,211,160,0.1)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--v2-peg)]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--v2-peg)] opacity-70 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--v2-peg)]" />
          </span>
          mainnet · confirmed
        </span>
      </div>
      <div className="v2-in-rbody">
        {RECEIPT_ROWS.map((r) => (
          <div key={r.k} className="v2-in-rrow">
            <span className="v2-in-rk">{r.k}</span>
            <span
              className="v2-in-rv"
              style={r.accent ? { color: "var(--v2-peg)" } : undefined}
            >
              {r.v}
            </span>
          </div>
        ))}
      </div>
      <div className="v2-in-rfoot">
        MEMO <b>pegana-v1|0.7.0|d35a581a…|f27f26867b94…88a5f4</b>
      </div>
    </div>
  );
}

// ── hero — landing-grade, centred, with the on-chain receipt under the arc ───

function Hero() {
  const reduced = useAppReducedMotion();
  const eyebrow = useRevealV2<HTMLDivElement>({ mode: "load", index: 0 });
  const h1 = useRevealV2<HTMLHeadingElement>({ mode: "load", index: 1 });
  const sub = useRevealV2<HTMLParagraphElement>({ mode: "load", index: 2 });
  const cta = useRevealV2<HTMLDivElement>({ mode: "load", index: 3 });
  const trust = useRevealV2<HTMLParagraphElement>({ mode: "load", index: 4 });
  const stage = useRevealV2<HTMLDivElement>({ mode: "load", index: 5 });

  return (
    <header className="relative overflow-hidden pb-8 pt-[132px] text-center sm:pt-[168px]">
      {/* top brand wash — same recipe as the landing hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[460px]"
        style={{
          background:
            "radial-gradient(120% 60% at 50% 0%, rgba(255,138,91,0.10), rgba(251,111,174,0.05) 34%, rgba(223,145,247,0.03) 55%, transparent 72%)",
        }}
      />
      <DistanceFieldCanvas />

      <div className="relative z-[2] mx-auto max-w-[1180px] px-6 sm:px-10">
        <div ref={eyebrow.ref} style={eyebrow.style}>
          <EyebrowPillV2 className="mb-7">V1 · live on mainnet</EyebrowPillV2>
        </div>

        <h1
          ref={h1.ref}
          style={h1.style}
          className="mx-auto max-w-[17ch] text-balance text-[clamp(40px,6.4vw,78px)] font-medium leading-[1.02] tracking-[-0.025em] text-[var(--v2-text)]"
        >
          The peg-risk oracle,{" "}
          <span className="v2-iri-text">now proven on-chain.</span>
        </h1>

        <p
          ref={sub.ref}
          style={sub.style}
          className="mx-auto mt-[26px] max-w-[62ch] text-[clamp(16px,1.9vw,18px)] leading-[1.62] text-[var(--v2-muted)]"
        >
          Pegana watches{" "}
          <b className="font-medium text-[var(--v2-text)]">68 Solana</b>{" "}
          stablecoins, LSTs and yield-bearing tokens for the moment they drift
          off their peg. Every receipt{" "}
          <b className="font-medium text-[var(--v2-text)]">
            hash-checks in your browser, and receipts from methodology 0.4.0
            onward re-derive byte-for-byte with the matching CLI release
          </b>{" "}
          . And severe transitions can be anchored on Solana mainnet, proven
          with a real receipt.
        </p>

        <div
          ref={cta.ref}
          style={cta.style}
          className="mt-[34px] flex flex-wrap justify-center gap-3 max-[759px]:mx-auto max-[759px]:max-w-[340px] max-[759px]:flex-col max-[759px]:items-stretch max-[759px]:gap-2.5"
        >
          <PillPrimary href="/methodology">read the methodology</PillPrimary>
          <PillGhost href="/audit">browse the audit</PillGhost>
        </div>

        <p
          ref={trust.ref}
          style={trust.style}
          className="mt-[22px] font-mono text-xs tracking-[0.03em] text-[var(--v2-muted)]"
        >
          It isn&apos;t a claim. It&apos;s a transaction.
        </p>

        {/* the artifact — the real receipt floated under the iridescent arc */}
        <div
          ref={stage.ref}
          style={stage.style}
          className="relative mx-auto mt-16 max-w-[1180px] pb-[64px]"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-64px] z-0 w-[min(1400px,140vw)] -translate-x-1/2"
          >
            <div
              className={cn(
                "absolute left-1/2 top-[18px] h-[300px] w-[86%] -translate-x-1/2 blur-[34px]",
                !reduced &&
                  "v2-anim-arc animate-[v2-arcbreathe_9s_var(--v2-ease)_infinite]",
              )}
              style={{
                background:
                  "radial-gradient(52% 100% at 50% 100%, rgba(251,111,174,.4), rgba(255,138,91,.18) 42%, rgba(223,145,247,.13) 60%, transparent 74%)",
              }}
            />
            <svg
              viewBox="0 0 1400 260"
              preserveAspectRatio="none"
              style={{ width: "100%", height: 260, overflow: "visible" }}
            >
              <defs>
                {/* Brand spectrum from the iridescent design tokens, not
                    literals (DESIGN.md: every surface reads CSS tokens). */}
                <linearGradient id="wn-hero-arc" x1="0" x2="1" y1="0" y2="0">
                  <stop
                    offset="0"
                    stopColor="var(--color-iridescent-start)"
                    stopOpacity="0"
                  />
                  <stop
                    offset="0.25"
                    stopColor="var(--color-iridescent-start)"
                  />
                  <stop offset="0.5" stopColor="var(--color-iridescent-mid)" />
                  <stop
                    offset="0.75"
                    stopColor="var(--color-iridescent-end)"
                  />
                  <stop
                    offset="1"
                    stopColor="var(--color-iridescent-end)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path
                d="M0,250 Q700,-30 1400,250"
                fill="none"
                stroke="url(#wn-hero-arc)"
                strokeWidth="1.6"
                opacity="0.8"
              />
            </svg>
          </div>

          <div
            className={cn(
              "relative z-[2] mx-auto max-w-[620px] text-left",
              !reduced &&
                "v2-anim-board animate-[v2-boardfloat_9s_var(--v2-ease)_infinite]",
            )}
          >
            <ProofReceipt />
          </div>

          <p className="relative z-[2] mt-[18px] text-center font-mono text-[11px] tracking-[0.02em] text-[var(--v2-muted)]">
            a real Depeg receipt · re-derivable byte-for-byte with{" "}
            <span className="text-[var(--v2-muted)]">pegana-replay</span>
          </p>
        </div>
      </div>
    </header>
  );
}

// ── a change group — mono eyebrow + Switzer h2 + intro + a real change table ─

function ChangeGroup({ group }: { group: Group }) {
  const head = useRevealV2<HTMLDivElement>();
  const table = useRevealV2<HTMLDivElement>({ index: 1 });

  return (
    <section className="pt-[104px] first:pt-[120px]">
      <div ref={head.ref} style={head.style}>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--v2-muted)]">
          <span className="text-[var(--v2-muted)]">{group.n}</span> ·{" "}
          {group.eyebrow}
        </p>
        <h2 className="max-w-[20ch] text-balance text-[clamp(26px,3.8vw,40px)] font-medium leading-[1.08] tracking-[-0.022em] text-[var(--v2-text)]">
          {group.h}
        </h2>
        <p className="mt-4 max-w-[64ch] text-[16px] leading-[1.65] text-[var(--v2-muted)]">
          {group.intro}
        </p>
      </div>

      <div ref={table.ref} style={table.style}>
        <ListRowsV2 label="Changes in this release" className="mt-9">
          <ListRowHead columns="110px minmax(0,1fr)">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--v2-muted)]">
              signal
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--v2-muted)]">
              what changed
            </span>
          </ListRowHead>
          {group.entries.map((e) => (
            <ListRow key={e.head} columns="110px minmax(0,1fr)">
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--v2-muted)]">
                {e.tag}
              </span>
              <span className="text-[14.5px] leading-[1.6] text-[var(--v2-body)]">
                <b className="font-medium text-[var(--v2-text)]">{e.head}.</b>{" "}
                {e.body}
              </span>
            </ListRow>
          ))}
        </ListRowsV2>
      </div>
    </section>
  );
}

// ── verifiable metrics — the canonical stat strip ────────────────────────────

function Metrics() {
  const head = useRevealV2<HTMLDivElement>();
  const strip = useRevealV2<HTMLDivElement>({ index: 1 });

  return (
    <section className="pt-[104px]">
      <div ref={head.ref} style={head.style}>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--v2-muted)]">
          <span className="text-[var(--v2-muted)]">06</span> · Verifiable by
          anyone
        </p>
        <h2 className="max-w-[20ch] text-balance text-[clamp(26px,3.8vw,40px)] font-medium leading-[1.08] tracking-[-0.022em] text-[var(--v2-text)]">
          The whole point of an oracle.
        </h2>
        <p className="mt-4 max-w-[64ch] text-[16px] leading-[1.65] text-[var(--v2-muted)]">
          Every number above is checkable. The methodology is open, every receipt
          hash-checks in your browser, and receipts from methodology 0.4.0
          onward re-derive to the same bytes with the matching CLI release, and severe transitions can be anchored on
          a chain nobody controls.
        </p>
      </div>
      {/* The canonical stat-strip look (rounded panel, hairline-divided mono
          cells) rebuilt with utilities so word-values ("byte-exact",
          "on-chain") size down instead of wrapping — the shared .v2-in-stats
          hard-codes a 26px value that wraps those at mid widths. */}
      <div
        ref={strip.ref}
        style={strip.style}
        className="mt-10 grid grid-cols-2 divide-x divide-y divide-[var(--v2-line)] overflow-hidden rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] sm:grid-cols-4 sm:divide-y-0"
      >
        {METRICS.map((m) => (
          <div key={m.l} className="px-6 py-[22px]">
            <div className="whitespace-nowrap font-mono text-[clamp(19px,2.3vw,25px)] font-medium tabular-nums tracking-[-0.01em] text-[var(--v2-text)]">
              {m.v}
            </div>
            <div className="mt-1.5 font-mono text-[10px] uppercase leading-[1.4] tracking-[0.14em] text-[var(--v2-muted)]">
              {m.l}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── close — the landing's iridescent wave glow behind a verify statement ─────

function Close() {
  const h2 = useRevealV2<HTMLHeadingElement>();
  const body = useRevealV2<HTMLDivElement>({ index: 1 });
  const cta = useRevealV2<HTMLDivElement>({ index: 2 });

  return (
    <section className="relative overflow-hidden pb-[132px] pt-[128px] text-center">
      <DecorWaveSvg
        gradientId="wn-close-wave-1"
        className="pointer-events-none absolute bottom-[-320px] left-1/2 z-0 w-[1500px] -translate-x-1/2 opacity-[0.16] blur-[46px]"
      />
      <DecorWaveSvg
        gradientId="wn-close-wave-2"
        className="pointer-events-none absolute bottom-[-180px] left-1/2 z-0 w-[1100px] -translate-x-1/2 opacity-[0.11] blur-[64px]"
      />
      <div aria-hidden className="v2-close-mchroma" />

      <div className="relative z-[2] mx-auto max-w-[1180px] px-6 sm:px-10">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--v2-muted)]">
          Verify, don&apos;t trust
        </p>
        <h2
          ref={h2.ref}
          style={h2.style}
          className="mx-auto max-w-[22ch] text-balance text-[clamp(32px,4.8vw,54px)] font-medium leading-[1.06] tracking-[-0.022em] text-[var(--v2-text)]"
        >
          Don&apos;t take our word for it. Take the{" "}
          <span className="v2-iri-text">chain&apos;s.</span>
        </h2>
        <div
          ref={body.ref}
          style={body.style}
          className="mx-auto mt-[22px] max-w-[64ch] text-balance text-[15.5px] leading-[1.6] text-[var(--v2-muted)] sm:text-[16px]"
        >
          Re-derive any Pegana receipt, hash-for-hash, from your own machine.
          and check its on-chain anchor when the receipt carries one. One
          command, no account:
        </div>
        <div className="mt-6 flex justify-center">
          <code className="inline-block rounded-[10px] border border-[var(--v2-line)] bg-[var(--v2-panel)] px-4 py-2.5 font-mono text-[13.5px] text-[var(--v2-peg)]">
            cargo install pegana-replay
          </code>
        </div>
        <div
          ref={cta.ref}
          style={cta.style}
          className="mt-[30px] flex flex-wrap justify-center gap-3 max-[759px]:mx-auto max-[759px]:max-w-[340px] max-[759px]:flex-col max-[759px]:items-stretch max-[759px]:gap-2.5"
        >
          <PillPrimary href="/methodology">read the methodology</PillPrimary>
          <PillGhost href="/audit">browse the audit</PillGhost>
        </div>
      </div>
    </section>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export function WhatsNewClient() {
  return (
    <main
      className={cn(
        switzerV2.variable,
        geistMonoV2.variable,
        "pegana-v2 overflow-x-clip",
      )}
    >
      <Hero />
      <div className="mx-auto max-w-[880px] px-5 pb-[40px] sm:px-8">
        {GROUPS.map((g) => (
          <ChangeGroup key={g.n} group={g} />
        ))}
        <Metrics />
      </div>
      <Close />
    </main>
  );
}
