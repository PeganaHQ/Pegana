// Wave 11M.3 — /embed/<asset> iframe-friendly minimal page.
//
// Returns a self-contained HTML document for cross-origin <iframe> embedding.
// Sandboxed: no global layout, no analytics, no external assets beyond the
// Pegana API. CSP allows any frame-ancestor so partner sites can drop the
// iframe in without coordinating with us.
//
//   <iframe src="https://pegana.xyz/embed/USDe" width="280" height="44"
//           loading="lazy" title="USDe peg status"></iframe>
//
// For a richer iframe (with sparkline, themes), see /embed/badge/[symbol]
// (Wave 11A). This route is the minimalist counterpart paired with the
// /embed.js script-loader — same visual language across both surfaces.

import type { NextRequest } from "next/server";
import { apiBase } from "@/lib/api/base";
import { reconcileBps } from "@/lib/api/format";
import { isStale } from "@/lib/asset/freshness";

const API_BASE = apiBase();
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pegana.xyz";

interface AssetState {
  state?: string;
  peg_state?: string;
  discount?: string | null;
  intrinsic_usd?: string | null;
  market_usd?: string | null;
  /** Snapshot freshness timestamp (ISO 8601). Gated against the app's 2-minute
   *  STALE_AFTER_MS bound so a frozen feed can't paint a stale state. */
  updated_at?: string | null;
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

function formatBps(bps: number | null): string {
  if (bps == null || bps === 0) return "";
  // Holder convention: raw `bps` (reconcileBps) is premium-negative; flip so
  // `+`=premium, `−`=discount — matches the app/pages (QA audit 2026-07-23).
  const sign = bps > 0 ? "−" : "+";
  return ` ${sign}${Math.abs(bps / 100).toFixed(2)}%`;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ asset: string }> },
) {
  const { asset: raw } = await context.params;
  const asset = decodeURIComponent(raw);

  let state = "UNKNOWN";
  let bps: number | null = null;
  try {
    const r = await fetch(
      `${API_BASE}/v1/assets/${encodeURIComponent(asset)}/state`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      },
    );
    if (r.ok) {
      const data = (await r.json()) as AssetState;
      // App-level 2-minute freshness gate (STALE_AFTER_MS). /state returns the
      // last value even when its own looser 15-min bound trips, so gate here
      // to match the app dashboard and never show a frozen state as live.
      const stale = isStale(data.updated_at, Date.now());
      state = stale ? "UNKNOWN" : (data.state ?? data.peg_state ?? "UNKNOWN");
      // Shared reconcileBps (same 200 bps suspect-drift + impossible clamp as
      // the badge route + dashboard) so every embed surface agrees byte-for-
      // byte, instead of a private bpsFromDiscount that skipped reconciliation.
      bps = stale
        ? null
        : reconcileBps({
            discount: data.discount ?? null,
            intrinsic_usd: data.intrinsic_usd ?? null,
            market_usd: data.market_usd ?? null,
          }).bps;
    }
  } catch {
    // Render UNKNOWN — never break the host page's layout.
  }

  const color = STATE_COLOR[state] ?? STATE_COLOR.UNKNOWN;
  const label = STATE_LABEL[state] ?? STATE_LABEL.UNKNOWN;
  // The spread NUMBER is sign-driven (premium green, discount red) like every
  // other surface; `color` above stays the STATE colour for the pip. This
  // widget used to fold the number into the muted `.lbl` string ("Pegged
  // −0.09%" in one grey span), so the number carried no sign colour at all —
  // and a DOM sweep could not see it, because the element's text was the label
  // AND the number. Its sibling route (embed/badge) already split them; this
  // matches it. `bps` is RAW, so a POSITIVE raw bps is a holder discount.
  const spreadColor =
    bps == null || bps === 0 ? "#8f8aa3" : bps > 0 ? "#e87089" : "#5fd3a0";
  const href = `${SITE_URL}/audit?asset=${encodeURIComponent(asset)}&utm_source=embed_iframe&utm_medium=iframe&utm_campaign=peg_badge`;

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${xmlEscape(asset)} · Pegana</title>
<style>
  html,body{margin:0;padding:0;background:transparent}
  body{font:500 12px/1 system-ui,-apple-system,sans-serif;color:#f5f5f6}
  a.b{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #1f1f22;background:#0a0a0b;color:inherit;text-decoration:none;width:100%;box-sizing:border-box;border-radius:2px}
  .pip{width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0}
  .sym{font-weight:600}
  .lbl{color:#8f8aa3;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .bps{color:${spreadColor};font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
  .brand{color:#8f8aa3;margin-left:auto;padding-left:8px;border-left:1px solid #1f1f22}
</style>
</head>
<body>
<a class="b" href="${xmlEscape(href)}" target="_top">
  <span class="pip" aria-hidden="true"></span>
  <span class="sym">${xmlEscape(asset)}</span>
  <span class="lbl">${xmlEscape(label)}</span><span class="bps">${xmlEscape(formatBps(bps))}</span>
  <span class="brand">Pegana ↗</span>
</a>
</body>
</html>`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      // Cross-origin embeddable: drop X-Frame-Options, set permissive CSP.
      "Content-Security-Policy": "frame-ancestors *;",
    },
  });
}
