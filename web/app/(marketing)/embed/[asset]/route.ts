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
import { apiBase, serverApiHeaders } from "@/lib/api/base";
import { reconcileBps } from "@/lib/api/format";
import { isStale } from "@/lib/asset/freshness";
import { siteOrigin } from "@/lib/seo/site-origin";
import { lookupAsset } from "@/lib/asset/fetch-asset";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { publicSurfaceOf } from "@/lib/asset/public-surface";
import { notTrackedResponse } from "@/lib/embed/not-tracked";
import { embedCacheControl } from "@/lib/embed/cache";

const API_BASE = apiBase();
const SITE_URL = siteOrigin();

interface AssetState {
  state?: string;
  peg_state?: string;
  discount?: string | null;
  intrinsic_usd?: string | null;
  market_usd?: string | null;
  /** Snapshot freshness timestamp (ISO 8601). Gated against the app's
   *  STALE_AFTER_MS bound (15 minutes) so a frozen feed can't paint a stale
   *  state. */
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

interface Verdict {
  state: string;
  bps: number | null;
  updatedAt: string | null;
}

/** A /state or asset-detail payload as a verdict, through the app freshness
 *  gate (STALE_AFTER_MS): a frozen snapshot reads UNKNOWN with no spread. */
function verdictFrom(data: AssetState, now: number): Verdict {
  const updatedAt = data.updated_at ?? null;
  if (isStale(updatedAt, now)) return { state: "UNKNOWN", bps: null, updatedAt };
  return {
    state: data.state ?? data.peg_state ?? "UNKNOWN",
    // Shared reconcileBps (same 200 bps suspect-drift + impossible clamp as
    // the badge route + dashboard) so every embed surface agrees byte-for-
    // byte.
    bps: reconcileBps({
      discount: data.discount ?? null,
      intrinsic_usd: data.intrinsic_usd ?? null,
      market_usd: data.market_usd ?? null,
    }).bps,
    updatedAt,
  };
}

// Last good verdict per asset, held by this server instance. When the live
// /state read fails (a 429 or 5xx, a timeout) the embed shows this, marked
// stale, instead of "Unknown": a partner page flipping to Unknown while the
// API has a verdict was a real incident (sHYUSD, then jitoSOL, both Drift).
// Best effort: a cold instance has none and falls back to the asset-detail
// read. Bounded so a symbol scan cannot grow it without limit.
const LAST_GOOD = new Map<string, Verdict>();
const LAST_GOOD_MAX = 256;

function rememberGood(asset: string, v: Verdict) {
  // No timestamp, no memory: the freshness gate treats a null updated_at as
  // not stale, so a remembered verdict without one could be served as
  // "stale" forever.
  if (v.state === "UNKNOWN" || v.updatedAt == null) return;
  LAST_GOOD.delete(asset);
  LAST_GOOD.set(asset, v);
  if (LAST_GOOD.size > LAST_GOOD_MAX) {
    const oldest = LAST_GOOD.keys().next().value;
    if (oldest !== undefined) LAST_GOOD.delete(oldest);
  }
}

/** Test hook: forget every remembered verdict. */
export function __resetLastGoodForTests() {
  LAST_GOOD.clear();
}

/** Newest non-UNKNOWN verdict among the fallbacks that still pass the
 *  freshness gate; null when there is none. */
function bestFallback(
  candidates: Array<Verdict | null | undefined>,
  now: number,
): Verdict | null {
  let best: Verdict | null = null;
  for (const c of candidates) {
    // A fallback must carry its own timestamp (see rememberGood): isStale
    // reads a null updated_at as fresh, which would never expire.
    if (
      !c ||
      c.state === "UNKNOWN" ||
      c.updatedAt == null ||
      isStale(c.updatedAt, now)
    ) {
      continue;
    }
    const t = c.updatedAt ? Date.parse(c.updatedAt) : 0;
    const bt = best?.updatedAt ? Date.parse(best.updatedAt) : 0;
    if (!best || t > bt) best = c;
  }
  return best;
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
  // Canonical DB symbol for the lookup and /state fetch (eHYUSD -> sHYUSD),
  // like the badge route; `shown` is what the page prints.
  const asset = resolveAliasSymbol(decodeURIComponent(raw));
  const shown = displaySymbol(asset);

  // Started first so it overlaps the /state fetch below. Unknown symbols and
  // leveraged synths (xSOL, no peg) get a neutral "not tracked" 404 instead of
  // a peg verdict.
  const lookupPromise = lookupAsset(asset);

  const now = Date.now();
  // live: the /state read answered. Anything else (429, 5xx, timeout,
  // network) is a soft-fail, served from the last good verdict when there is
  // one and never cached at the edge for more than a few seconds.
  let live: Verdict | null = null;
  try {
    const r = await fetch(
      `${API_BASE}/v1/assets/${encodeURIComponent(asset)}/state`,
      {
        // serverApiHeaders: the SSR token puts this read on the API's server
        // budget instead of the shared per-IP one every Vercel function
        // leaves from. no-store: the edge header below is the only cache. A
        // Data Cache entry is served past its expiry while it refreshes, so
        // after an idle spell it handed back a snapshot old enough to trip
        // the freshness gate, and the edge then held that Unknown for minutes.
        headers: { Accept: "application/json", ...serverApiHeaders() },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (r.ok) {
      live = verdictFrom((await r.json()) as AssetState, now);
      rememberGood(asset, live);
    }
  } catch {
    // Soft-fail below. Never break the host page's layout.
  }

  const lookup = await lookupPromise;
  if (publicSurfaceOf(lookup) === "not_tracked") {
    return notTrackedResponse(shown, false);
  }

  const fallback = live
    ? null
    : bestFallback(
        [
          LAST_GOOD.get(asset),
          lookup.kind === "found"
            ? verdictFrom(lookup.asset as AssetState, now)
            : null,
        ],
        now,
      );
  const degraded = live == null;
  const verdict: Verdict = live ??
    fallback ?? { state: "UNKNOWN", bps: null, updatedAt: null };
  const state = verdict.state;
  const bps = verdict.bps;
  const staleMark = fallback != null;

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
<title>${xmlEscape(shown)} · Pegana</title>
<style>
  html,body{margin:0;padding:0;background:transparent}
  body{font:500 12px/1 system-ui,-apple-system,sans-serif;color:#f5f5f6}
  a.b{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #1f1f22;background:#0a0a0b;color:inherit;text-decoration:none;width:100%;box-sizing:border-box;border-radius:2px}
  .pip{width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0}
  .sym{font-weight:600}
  .lbl{color:#8f8aa3;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .bps{color:${spreadColor};font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
  .stl{color:#8f8aa3;font:500 12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.06em}
  .brand{color:#8f8aa3;margin-left:auto;padding-left:8px;border-left:1px solid #1f1f22}
</style>
</head>
<body>
<a class="b" href="${xmlEscape(href)}" target="_top">
  <span class="pip" aria-hidden="true"></span>
  <span class="sym">${xmlEscape(shown)}</span>
  <span class="lbl">${xmlEscape(label)}</span><span class="bps">${xmlEscape(formatBps(bps))}</span>${
    staleMark
      ? `<span class="stl" title="Live read unavailable; last good state">stale</span>`
      : ""
  }
  <span class="brand">Pegana ↗</span>
</a>
</body>
</html>`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A live verdict: 60s at the edge, 60s more stale while one request
      // refreshes it (was 300s, long enough for a changed state to lag the
      // API by six minutes). Unknown or degraded: see lib/embed/cache.ts.
      "Cache-Control": embedCacheControl({
        state,
        degraded,
        liveSeconds: 60,
        swrSeconds: 60,
      }),
      // Cross-origin embeddable: drop X-Frame-Options, set permissive CSP.
      "Content-Security-Policy": "frame-ancestors *;",
    },
  });
}
