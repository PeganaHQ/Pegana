import type { NextRequest } from "next/server";
import { apiBase } from "@/lib/api/base";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { reconcileBps } from "@/lib/api/format";
import { isStale } from "@/lib/asset/freshness";

const API_BASE = apiBase();
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pegana.xyz";

interface AssetCardData {
  symbol: string;
  name: string | null;
  state:
    "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "BLACK_SWAN" | "UNKNOWN" | null;
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
  /** Snapshot freshness timestamp (ISO 8601). Gated against the app's 2-minute
   *  STALE_AFTER_MS bound below so a frozen feed can't paint a stale "PEGGED". */
  updated_at: string | null;
}

interface HistoryPoint {
  discount: string;
  ts: string;
}

function xmlEscape(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );
}

function formatGap(bps: number | null): string {
  if (bps == null) return "-";
  if (bps === 0) return "0.00%";
  const sign = bps > 0 ? "+" : "−";
  const abs = Math.abs(bps);
  const pct = abs / 100;
  if (abs < 1000) return `${sign}${pct.toFixed(2)}%`;
  if (abs < 10000) return `${sign}${pct.toFixed(1)}%`;
  return `${sign}${Math.round(pct)}%`;
}

function toSparkPath(points: number[], w: number, h: number): string {
  if (points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  return points
    .map((v, i) => {
      const x = (i * step).toFixed(2);
      const y = (h - ((v - min) / range) * h).toFixed(2);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

const STATE_COLOR: Record<string, string> = {
  PEGGED: "#5fd3a0",
  DRIFT: "#e2a651",
  DEPEG: "#e87089",
  CRITICAL: "#e0574e",
  BLACK_SWAN: "#e0574e",
  UNKNOWN: "#8f8aa3",
};

const STATE_LABEL: Record<string, string> = {
  PEGGED: "Pegged",
  DRIFT: "Drift",
  DEPEG: "Depeg",
  CRITICAL: "Critical",
  BLACK_SWAN: "Black swan",
  UNKNOWN: "Unknown",
};

function html({
  symbol,
  name,
  state,
  bps,
  sparkPath,
  theme,
  showSpark,
  color,
}: {
  symbol: string;
  name: string;
  state: string;
  bps: number | null;
  sparkPath: string;
  theme: "dark" | "light";
  showSpark: boolean;
  color: string;
}): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0a0a0b" : "#fff";
  const text = isDark ? "#f5f5f6" : "#0a0a0a";
  // The spread NUMBER is sign-driven (premium green, discount red) like every
  // other surface; `color` stays the STATE color for the pip/label. `bps` is
  // RAW (rendered below as formatGap(-bps)), so a POSITIVE raw is a discount.
  const spreadColor =
    bps == null || bps === 0 ? text : bps > 0 ? "#e87089" : "#5fd3a0";
  const muted = isDark ? "#8f8aa3" : "rgba(0,0,0,0.55)";
  const border = isDark ? "#1f1f22" : "rgba(0,0,0,0.12)";
  const stateLabel = STATE_LABEL[state] ?? STATE_LABEL.UNKNOWN;
  // `target` is a URL — built from the raw, DB-keyed `symbol`, never the
  // display alias. Every rendered text node below uses `shownSymbol`.
  const target = `${SITE_URL}/audit?asset=${encodeURIComponent(symbol)}&utm_source=embed`;
  const shownSymbol = displaySymbol(symbol);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${xmlEscape(shownSymbol)} · Pegana</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font: 14px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif;
    color: ${text};
  }
  a.badge {
    display: block;
    width: 320px;
    box-sizing: border-box;
    background: ${bg};
    border: 1px solid ${border};
    text-decoration: none;
    color: inherit;
    transition: border-color 0.2s ease;
  }
  a.badge:hover { border-color: ${color}; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
  .pip { width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0; }
  .meta { flex: 1; min-width: 0; }
  .top { display: flex; align-items: baseline; gap: 8px; }
  .symbol { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: ${muted}; }
  .bot { margin-top: 2px; display: flex; align-items: baseline; gap: 6px; }
  .bps { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 500; color: ${spreadColor}; font-variant-numeric: tabular-nums; }
  .state { font-family: ui-monospace, monospace; font-size: 10px; color: ${muted}; }
  .brand { font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: ${muted}; }
  .verify { font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.06em; color: ${muted}; text-decoration: none; border-bottom: 1px solid transparent; }
  .verify:hover { color: ${text}; border-bottom-color: ${muted}; }
  .spark { padding: 6px 12px 8px; border-top: 1px solid ${border}; }
  .spark svg { display: block; width: 100%; height: 28px; }
</style>
</head>
<body>
<a class="badge" href="${xmlEscape(target)}" target="_top">
  <div class="row">
    <span class="pip" aria-hidden="true"></span>
    <div class="meta">
      <div class="top">
        <span class="symbol">${xmlEscape(shownSymbol)}</span>
        <span class="name">${xmlEscape(name)}</span>
      </div>
      <div class="bot">
        <span class="bps">${xmlEscape(bps == null ? "-" : formatGap(-bps))}</span>
        <span class="state">· ${xmlEscape(stateLabel)}</span>
      </div>
    </div>
    <span class="brand">Pegana</span>
  </div>
  ${showSpark && sparkPath ? `<div class="spark"><svg viewBox="0 0 240 28" preserveAspectRatio="none" aria-hidden="true"><path d="${sparkPath}" stroke="${color}" stroke-width="1.5" fill="none" /></svg></div>` : ""}
</a>
<div style="padding:4px 12px 6px;border-top:1px solid ${border};">
  <a class="verify" href="${xmlEscape(target)}" target="_top" title="View verifiable audit receipts for ${xmlEscape(shownSymbol)} on Pegana">verifiable on Pegana &#x2197;</a>
</div>
</body>
</html>`;
}

// ── Static SVG badge ────────────────────────────────────────────────────────
// Shields.io-style flat SVG for use as <img> in GitHub READMEs and markdown
// surfaces that do not support iframes. The SVG carries no external resources —
// just text, a pip rect, and inline fonts fallback — so it renders identically
// across renderers and does not trigger CSP img-src restrictions.
function svgBadge({
  symbol,
  state,
  bps,
  color,
}: {
  symbol: string;
  state: string;
  bps: number | null;
  color: string;
}): string {
  const stateLabel = STATE_LABEL[state] ?? STATE_LABEL.UNKNOWN;
  // Holder convention: raw `bps` is premium-negative; flip so `+`=premium.
  const gap =
    bps != null
      ? ` ${bps > 0 ? "−" : bps < 0 ? "+" : ""}${Math.abs(bps / 100).toFixed(2)}%`
      : "";
  const leftText = xmlEscape(symbol);
  const rightText = xmlEscape(`${stateLabel}${gap}`);

  // Approximate text widths (7px/char for monospace 11px).
  const leftW = Math.max(leftText.length * 7 + 16, 40);
  const rightW = Math.max(rightText.length * 7 + 16, 52);
  const totalW = leftW + rightW;
  const h = 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="${h}" role="img" aria-label="${xmlEscape(symbol)}: ${xmlEscape(stateLabel)}">
<title>${xmlEscape(symbol)}: ${xmlEscape(stateLabel)}</title>
<linearGradient id="s" x2="0" y2="100%">
  <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
  <stop offset="1" stop-opacity=".1"/>
</linearGradient>
<clipPath id="r">
  <rect width="${totalW}" height="${h}" rx="3" fill="#fff"/>
</clipPath>
<g clip-path="url(#r)">
  <rect width="${leftW}" height="${h}" fill="#555"/>
  <rect x="${leftW}" width="${rightW}" height="${h}" fill="${color}"/>
  <rect width="${totalW}" height="${h}" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="11" letter-spacing=".5">
  <text x="${leftW / 2}" y="15" fill="#010101" fill-opacity=".3">${leftText}</text>
  <text x="${leftW / 2}" y="14">${leftText}</text>
  <text x="${leftW + rightW / 2}" y="15" fill="#010101" fill-opacity=".3">${rightText}</text>
  <text x="${leftW + rightW / 2}" y="14">${rightText}</text>
</g>
</svg>`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol: raw } = await context.params;
  const symbol = resolveAliasSymbol(decodeURIComponent(raw));
  const url = new URL(request.url);
  const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
  const showSpark = url.searchParams.get("sparkline") !== "off";
  const format = url.searchParams.get("format");

  // Kick off the asset + 24h-history fetches CONCURRENTLY — they are independent,
  // and serializing them doubled the embed's cold-render latency (two upstream
  // round-trips back-to-back). Each still fails soft on its own.
  const assetPromise: Promise<AssetCardData | null> = (async () => {
    try {
      const r = await fetch(
        `${API_BASE}/v1/assets/${encodeURIComponent(symbol)}`,
        { headers: { Accept: "application/json" }, next: { revalidate: 60 } },
      );
      return r.ok ? ((await r.json()) as AssetCardData) : null;
    } catch {
      // Render an UNKNOWN badge so the embed never breaks the host page layout.
      return null;
    }
  })();

  const sparkPromise: Promise<number[]> = showSpark
    ? (async () => {
        try {
          const from = new Date(Date.now() - 24 * 3600_000).toISOString();
          const r = await fetch(
            `${API_BASE}/v1/assets/${encodeURIComponent(symbol)}/history?bucket=1m&from=${encodeURIComponent(from)}&limit=200`,
            {
              headers: { Accept: "application/json" },
              next: { revalidate: 60 },
            },
          );
          if (!r.ok) return [];
          const body = (await r.json()) as { data: HistoryPoint[] };
          const history = body.data;
          // Filter outliers before plotting — keeps a single corrupted upstream
          // sample from collapsing the embed Y-axis.
          return history
            .filter((h) => {
              const n = parseFloat(h.discount);
              return Number.isFinite(n) && Math.abs(n) <= 1;
            })
            .map((h) => parseFloat(h.discount) * 10000);
        } catch {
          return []; // Sparkline is optional — proceed without one.
        }
      })()
    : Promise.resolve([]);

  const [asset, sparkPoints] = await Promise.all([assetPromise, sparkPromise]);

  // App-level 2-minute freshness gate (STALE_AFTER_MS via isStale). The API's
  // own collapse is a looser 15-minute bound, so a badge on a partner's deposit
  // page could show a frozen "PEGGED" for up to 15 min — the worst embed failure
  // mode. Collapse to UNKNOWN once the snapshot is older than 120s, matching the
  // app dashboard's gate. A missing/unparseable timestamp is NOT stale (handled
  // by the null-state fallback), same rule as the app.
  const stale = asset ? isStale(asset.updated_at, Date.now()) : false;
  const state = stale ? "UNKNOWN" : (asset?.state ?? "UNKNOWN");
  // Reconcile the declared discount against the raw on-chain prices so a
  // contaminated EWMA value can't paint an embed with a fake depeg. Uses the
  // SHARED `reconcileBps` (200 bps suspect-drift threshold + impossible-value
  // clamp) so the badge agrees byte-for-byte with the app + /assets. The former
  // inline copy here used a 5× tighter 50 bps cutoff AND skipped the
  // physically-impossible clamp on the no-raw-prices fallback, so the same asset
  // could read differently in the badge vs the app (finding #3, 1:1 sweep).
  // Stale snapshots drop the spread too — never show a frozen number as live.
  const bps = asset && !stale ? reconcileBps(asset).bps : null;
  const color = STATE_COLOR[state] ?? STATE_COLOR.UNKNOWN;
  const sparkPath = toSparkPath(sparkPoints, 240, 28);

  // SVG format: flat badge for GitHub README <img> use.
  if (format === "svg") {
    const svgBody = svgBadge({
      symbol: displaySymbol(symbol),
      state,
      bps,
      color,
    });
    const sMaxAgeSvg = state === "PEGGED" ? 60 : 15;
    return new Response(svgBody, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": `public, s-maxage=${sMaxAgeSvg}, stale-while-revalidate=120`,
        // SVG badges are fetched as <img> — not framed — so frame-ancestors
        // is not the relevant directive here. We still set it for defence-in-
        // depth (prevents SVG being misused in a frame context).
        "Content-Security-Policy": "frame-ancestors *;",
      },
    });
  }

  const body = html({
    symbol,
    name: asset?.name ?? "-",
    state,
    bps,
    sparkPath,
    theme,
    showSpark,
    color,
  });

  // State-conditional cache TTL: a stale "PEGGED" on a partner's deposit page
  // is the worst failure mode. Non-PEGGED states use a shorter window (15s) so
  // an active depeg propagates fast. PEGGED → 60s is safe (partner pages look
  // fine with a short stale). X-Frame-Options: ALLOWALL dropped — the
  // frame-ancestors CSP directive is the authoritative cross-origin mechanism.
  const sMaxAge = state === "PEGGED" ? 60 : 15;
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=120`,
      "Content-Security-Policy": "frame-ancestors *;",
    },
  });
}
