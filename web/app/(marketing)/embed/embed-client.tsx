"use client";

import { useState, useEffect } from "react";
import { EmbedSpecimenStrip } from "@/components/molecules/embed-specimen-strip";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import { CodeBlockV2 } from "@/components/organisms/v2/inner/code-block-v2";
import {
  ListRowsV2,
  ListRowHead,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";
import { PillGhost } from "@/components/organisms/v2/shared";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { apiBase } from "@/lib/api/base";

// Re-platformed onto V5 (Wave 2B, 2026-07-16): PageHeroV2 header, pill-tab
// pickers (`.v2-in-ptabs`/`.v2-in-ptab`, same pattern as /agents'
// AgentTabs) replacing the plain <select> + bordered toggle buttons,
// CodeBlockV2 snippet panels, and a ListRowsV2 parameter table. Same state/
// fetch/generation logic as before — only the chrome changed.

// Fallback list used before the live /v1/assets fetch resolves, and as a
// last resort if the API is unreachable. Sorted by recognition to make the
// default picker useful without waiting for the async load.
const FALLBACK_ASSETS = [
  "bSOL",
  "jitoSOL",
  "mSOL",
  "INF",
  "JupSOL",
  "USDC",
  "USDT",
  "PYUSD",
  "hyUSD",
  "USDe",
];

const API_BASE = apiBase();

const THEME_OPTIONS = ["dark", "light"] as const;
const SPARKLINE_OPTIONS: ReadonlyArray<{ value: boolean; label: string }> = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

export function EmbedClient() {
  const [symbol, setSymbol] = useState("bSOL");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sparkline, setSparkline] = useState(true);
  const [assets, setAssets] = useState<string[]>(FALLBACK_ASSETS);

  // Populate the picker from the live universe (/v1/assets) so the generator
  // always reflects 63+ assets instead of the hardcoded 10-symbol fallback.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/v1/assets`, {
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data: Array<{ symbol: string }> } | null) => {
        if (cancelled || !body) return;
        const symbols = body.data
          .map((a) => a.symbol)
          .filter((s) => typeof s === "string" && s.length > 0)
          .sort();
        if (symbols.length > 0) setAssets(symbols);
      })
      .catch(() => {
        // API unreachable — stay on FALLBACK_ASSETS, no error surface needed.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const src = `https://www.pegana.xyz/embed/badge/${encodeURIComponent(symbol)}?theme=${theme}${sparkline ? "" : "&sparkline=off"}`;
  const iframeSnippet = `<iframe src="${src}" width="320" height="${sparkline ? 86 : 56}" frameborder="0" loading="lazy" title="Pegana ${displaySymbol(symbol)} peg status"></iframe>`;
  const previewSrc = `/embed/badge/${encodeURIComponent(symbol)}?theme=${theme}${sparkline ? "" : "&sparkline=off"}`;
  const markdownSnippet = `[![${displaySymbol(symbol)} peg status](${src}&format=svg)](https://www.pegana.xyz/audit?asset=${encodeURIComponent(symbol)})`;
  const reactSnippet = `<iframe
  src="${src}"
  width={320}
  height={${sparkline ? 86 : 56}}
  loading="lazy"
  title="Pegana ${displaySymbol(symbol)} peg status"
/>`;

  return (
    <main>
      <PageHeroV2
        eyebrow="Embed"
        h1="Put a peg status on your site."
        maxWidthCh={22}
        lede={
          <>
            One iframe, zero config. The badge updates server-side every 60
            seconds against the same live API the dashboard runs on.{" "}
            <b className="font-medium text-[var(--v2-text)]">
              Drop it on protocol pages, docs, status dashboards, anywhere a
              user benefits from knowing whether the asset is trading on peg.
            </b>
          </>
        }
        meta={[
          "updates every 60s",
          "csp allows any frame-ancestor",
          "no tracking",
        ]}
      />

      <div className="mx-auto max-w-[1200px] px-5 pb-16 sm:px-8 sm:pb-24 lg:px-12">
        <EmbedSpecimenStrip />

        <SeenOnStrip />

        <section className="grid gap-10 border-t border-[var(--v2-line)] pt-10 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-16">
          <aside className="space-y-7">
            <FieldV2 label="Asset">
              {/* Asset picker is a many-item, wrapping, scrollable grid — NOT the
                  2-3-option pill the shared `.v2-in-ptabs` was built for. Override
                  its 999px pill radius with a normal card radius so the wrapped
                  chips don't clip into an oval (the /embed "broken + ugly" bug). */}
              <div
                className="v2-in-ptabs w-full max-h-[200px] overflow-y-auto content-start"
                style={{ borderRadius: 18 }}
                role="tablist"
                aria-label="Asset"
              >
                {assets.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="tab"
                    aria-selected={symbol === a}
                    onClick={() => setSymbol(a)}
                    className={cn("v2-in-ptab", symbol === a && "v2-in-on")}
                  >
                    {displaySymbol(a)}
                  </button>
                ))}
              </div>
            </FieldV2>

            <FieldV2 label="Theme">
              <div
                className="v2-in-ptabs w-full"
                role="tablist"
                aria-label="Theme"
              >
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={theme === t}
                    onClick={() => setTheme(t)}
                    className={cn(
                      "v2-in-ptab flex-1",
                      theme === t && "v2-in-on",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </FieldV2>

            <FieldV2 label="Sparkline">
              <div
                className="v2-in-ptabs w-full"
                role="tablist"
                aria-label="Sparkline"
              >
                {SPARKLINE_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="tab"
                    aria-selected={sparkline === opt.value}
                    onClick={() => setSparkline(opt.value)}
                    className={cn(
                      "v2-in-ptab flex-1",
                      sparkline === opt.value && "v2-in-on",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </FieldV2>

            <div className="border-t border-[var(--v2-line)] pt-6">
              <PillGhost href="/embed/demo" className="w-full justify-center">
                See live examples
              </PillGhost>
            </div>
          </aside>

          <div className="min-w-0 space-y-8">
            <SubsectionV2 label="Preview">
              <div
                className={cn(
                  "flex justify-start rounded-[16px] border border-[var(--v2-line)] p-8",
                  theme === "light" ? "bg-white" : "bg-[var(--v2-panel)]",
                )}
              >
                <iframe
                  src={previewSrc}
                  // Block script execution in the framed badge while still letting
                  // the same-origin static SVG/HTML render (react-doctor:
                  // iframe-missing-sandbox).
                  sandbox="allow-same-origin"
                  width={320}
                  height={sparkline ? 86 : 56}
                  loading="lazy"
                  title={`Pegana ${displaySymbol(symbol)} preview`}
                  className="border-0"
                />
              </div>
            </SubsectionV2>

            <SubsectionV2 label="HTML snippet">
              <CodeBlockV2 label="badge.html" code={iframeSnippet} />
            </SubsectionV2>

            <SubsectionV2 label="Markdown (for README / GitHub Pages)">
              <CodeBlockV2 label="README.md" code={markdownSnippet} />
              <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--v2-muted)]">
                SVG badge - works as a static &lt;img&gt; in GitHub READMEs and
                any markdown renderer. The Theme + Sparkline controls above
                don&apos;t apply here: the SVG always renders a compact flat
                badge (they do apply to the iframe / React snippets). The link
                lands on the per-asset audit feed.
              </p>
            </SubsectionV2>

            <SubsectionV2 label="React / Next.js">
              <CodeBlockV2 label="PegBadge.tsx" code={reactSnippet} />
            </SubsectionV2>
          </div>
        </section>

        <section className="mt-16 grid gap-10 border-t border-[var(--v2-line)] pt-10 sm:mt-20 sm:grid-cols-2 sm:gap-12">
          <div>
            <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
              Why embed it?
            </h2>
            <ul className="mt-4 space-y-3 text-[14px] leading-relaxed text-[var(--v2-muted)]">
              <li>
                · Your users see peg health on the same page where they're about
                to deposit.
              </li>
              <li>
                · No JS bundle, no third-party tracker. One iframe, ~3 KB of
                HTML.
              </li>
              <li>
                · Works in static sites, docs, wallet dashboards, partner pages.
              </li>
              <li>
                · Pegana traffic flows back to you via the link target, UTM
                tagged.
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
              Parameters
            </h2>
            <ListRowsV2 label="Embed parameter reference">
              <ListRowHead columns="120px 1fr">
                <span>Param</span>
                <span>Value</span>
              </ListRowHead>
              <ListRow columns="120px 1fr">
                <span className="font-mono text-[13px] text-[var(--v2-text)]">
                  theme
                </span>
                <span className="text-[13.5px] text-[var(--v2-muted)]">
                  <span className="font-mono text-[var(--v2-text)]">
                    dark | light
                  </span>                  {" "}
                  - Defaults to dark.
                </span>
              </ListRow>
              <ListRow columns="120px 1fr">
                <span className="font-mono text-[13px] text-[var(--v2-text)]">
                  sparkline
                </span>
                <span className="text-[13.5px] text-[var(--v2-muted)]">
                  <span className="font-mono text-[var(--v2-text)]">off</span> -
                  Drop the 24h chart to render a 60-tall version.
                </span>
              </ListRow>
            </ListRowsV2>
          </div>
        </section>
      </div>
    </main>
  );
}

function FieldV2({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--v2-muted)]">
        {label}
      </label>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function SubsectionV2({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--v2-muted)]">
        {label}
      </h3>
      {children}
    </div>
  );
}

// "Where it could live" strip. The names below are protocols Pegana already
// covers in its asset universe — surfaced as EXAMPLE integration targets, not
// confirmed adopters. Rendered as dashed, muted placeholder chips (never solid
// logo-style pills) with an explicit "example integrations" inline label, so
// the strip reads as aspirational by construction rather than leaning on a
// small-print disclaimer to walk back an implied-adoption claim (finding #14).
const SEEN_ON_TARGETS: ReadonlyArray<{ name: string; mono: string }> = [
  { name: "Sanctum", mono: "SA" },
  { name: "Marinade", mono: "MA" },
  { name: "Jito", mono: "JI" },
  { name: "Drift", mono: "DR" },
  { name: "Hubble", mono: "HU" },
];

function SeenOnStrip() {
  return (
    <section
      aria-label="Example embed targets"
      className="mt-10 border-y border-[var(--v2-line)] py-6 sm:mt-12 sm:py-7"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--v2-muted)]">
          Drop on any peg-sensitive surface
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Inline, always-visible framing — carries the "these are examples,
              not adopters" meaning in the label itself, not a footnote. */}
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--v2-muted)]">
            e.g.
          </span>
          {SEEN_ON_TARGETS.map((t) => (
            <span
              key={t.name}
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-[var(--v2-line2)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--v2-muted)]"
            >
              <span
                aria-hidden
                className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-[var(--v2-line2)] text-[9px] font-medium tracking-[0.04em] text-[var(--v2-muted)]"
              >
                {t.mono}
              </span>
              {t.name}
            </span>
          ))}
          <PillGhost href="mailto:rafael@pegana.xyz" className="ml-1">
            + your protocol
          </PillGhost>
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--v2-muted)]">
        Example integrations - not adopters. Ping us when you ship and
        we&apos;ll wire a backlink to your dashboard.
      </p>
    </section>
  );
}
