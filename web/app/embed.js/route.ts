// Wave 11M.3 — /embed.js script-based embed loader.
//
// Self-contained vanilla JS, no dependencies. Consumer pattern:
//
//   <script src="https://pegana.xyz/embed.js" data-asset="USDe"></script>
//   <script src="https://pegana.xyz/embed.js?theme=light" data-asset="USDe"></script>
//   <script src="https://pegana.xyz/embed.js" data-asset="USDe" data-pegana-theme="light"></script>
//
// The script reads its own data-asset attribute, fetches the asset's current
// peg state from /v1/assets/{asset}/state, and renders a compact badge:
//
//   ● USDe — Pegged   Pegana ↗
//
// 30s polling (AC54). CORS-friendly (the API exposes /v1/assets/* read-only
// with Access-Control-Allow-Origin: *). No tracking, no global state
// pollution.
//
// Public contract:
//   - data-asset (required) — asset symbol to monitor.
//   - data-pegana-theme (optional, "dark"|"light", default "dark") —
//     namespaced to avoid colliding with Tailwind's `data-theme` and other
//     popular framework attributes (AC55).
//   - ?theme=dark|light on the script `src` URL — alternative way to set
//     the theme without touching the host page's markup (AC55).
//   - postMessage event: after every render, the script emits
//     `window.parent.postMessage({ type: "pegana:state", asset, state }, "*")`
//     so the hosting page can react (e.g. surface its own banner when the
//     monitored asset is non-pegged) (AC54).
//
// For an iframe-based variant (sandboxed, server-rendered) see
// /embed/badge/[symbol] (Wave 11A) and the new /embed/[asset] page.

import { NextResponse } from "next/server";
import { apiBase } from "@/lib/api/base";

export const dynamic = "force-static";

const API_BASE = apiBase();
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pegana.xyz";

const SCRIPT = `/*! Pegana embed widget — MIT — github.com/PeganaHQ/ReplayCLI */
(function () {
  var API = "${API_BASE}";
  var SITE = "${SITE_URL}";
  var CURRENT = document.currentScript;
  if (!CURRENT) { return; }
  var ASSET = (CURRENT.getAttribute("data-asset") || "").trim();
  if (!ASSET) {
    console.warn("[pegana] <script src=embed.js> requires data-asset=\\"<symbol>\\"");
    return;
  }
  // Theme resolution order: explicit data attribute → ?theme= on src → "dark".
  // The data attribute is namespaced (data-pegana-theme) to avoid colliding
  // with Tailwind's data-theme and other framework attributes (AC55).
  var THEME = (CURRENT.getAttribute("data-pegana-theme") || "").toLowerCase();
  if (THEME !== "dark" && THEME !== "light") {
    try {
      var srcUrl = new URL(CURRENT.src, window.location.href);
      var qsTheme = (srcUrl.searchParams.get("theme") || "").toLowerCase();
      if (qsTheme === "dark" || qsTheme === "light") { THEME = qsTheme; }
    } catch (e) { /* malformed src — fall through to default */ }
  }
  if (THEME !== "dark" && THEME !== "light") { THEME = "dark"; }

  var COLOR = {
    PEGGED:    "#5fd3a0",
    DRIFT:     "#e2a651",
    DEPEG:     "#e87089",
    CRITICAL:  "#e0574e",
    BLACK_SWAN:"#e0574e",
    UNKNOWN:   "#8f8aa3"
  };

  var LABEL = {
    PEGGED:    "Pegged",
    DRIFT:     "Drift",
    DEPEG:     "Depeg",
    CRITICAL:  "Critical",
    BLACK_SWAN:"Black swan",
    UNKNOWN:   "Unknown"
  };

  // Mount point: an empty span injected right after the script tag so the
  // host page's CSS layout never moves when we render. Idempotent — repeat
  // include just re-uses the same span.
  var mountId = "pegana-embed-" + ASSET.replace(/[^A-Za-z0-9]/g, "_");
  var mount = document.getElementById(mountId);
  if (!mount) {
    mount = document.createElement("span");
    mount.id = mountId;
    mount.setAttribute("data-pegana-embed", ASSET);
    CURRENT.parentNode.insertBefore(mount, CURRENT.nextSibling);
  }

  function render(state, bps) {
    var dark = THEME === "dark";
    var bg = dark ? "#0a0a0b" : "#fff";
    var text = dark ? "#f5f5f6" : "#0a0a0a";
    var muted = dark ? "#8f8aa3" : "rgba(0,0,0,0.55)";
    var border = dark ? "#1f1f22" : "rgba(0,0,0,0.12)";
    var color = COLOR[state] || COLOR.UNKNOWN;
    var label = LABEL[state] || LABEL.UNKNOWN;
    var bpsStr = "";
    if (typeof bps === "number" && isFinite(bps)) {
      // Holder convention: raw reconcileBps is premium-negative; flip so
      // "+"=premium (\\u2212 is the minus sign) — QA audit 2026-07-23.
      var sign = bps > 0 ? "\\u2212" : bps < 0 ? "+" : "";
      bpsStr = " " + sign + Math.abs(bps / 100).toFixed(2) + "%";
    }
    var href = SITE + "/audit?asset=" + encodeURIComponent(ASSET) +
      "&utm_source=embed_js&utm_medium=script&utm_campaign=peg_badge";
    mount.innerHTML =
      '<a href="' + href + '" target="_blank" rel="noopener" ' +
      'style="display:inline-flex;align-items:center;gap:8px;' +
      'padding:6px 10px;border:1px solid ' + border + ';background:' + bg + ';' +
      'color:' + text + ';text-decoration:none;font:500 12px/1 system-ui,' +
      '-apple-system,sans-serif;border-radius:2px;' +
      'vertical-align:middle;">' +
        '<span aria-hidden="true" style="display:inline-block;width:8px;' +
        'height:8px;border-radius:50%;background:' + color + ';"></span>' +
        '<span>' + escapeHtml(ASSET) + '</span>' +
        '<span style="color:' + muted + ';font:500 11px/1 ui-monospace,' +
        'SFMono-Regular,Menlo,Consolas,monospace;">' + escapeHtml(label) + bpsStr + '</span>' +
        '<span style="color:' + muted + ';margin-left:auto;padding-left:8px;' +
        'border-left:1px solid ' + border + ';">Pegana \\u2197</span>' +
      '</a>';

    // AC54 — notify the hosting page of the latest known state so it can
    // surface its own UI (e.g. a banner) when the asset is non-pegged. We
    // post to window.parent (works inside an iframe) and also to window
    // (works when the script is included directly on the page). Both calls
    // are no-throw guarded.
    try {
      var msg = { type: "pegana:state", asset: ASSET, state: state };
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, "*");
      }
      window.postMessage(msg, "*");
    } catch (e) { /* postMessage blocked — non-fatal */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Byte-for-byte port of lib/api/format.ts::reconcileBps — the SAME logic the
  // iframe badge routes + the app dashboard use (200 bps suspect-drift + the
  // physically-impossible ±10000 bps clamp). A self-contained embed script can't
  // import the shared helper, so every embed surface must replicate it exactly
  // or the same asset reads differently in the JS badge vs the app.
  function reconcileBps(discount, intrinsic, market) {
    var MAX_BPS = 10000;
    var declared = null;
    if (discount != null) {
      var dn = parseFloat(discount);
      if (isFinite(dn)) { declared = Math.round(dn * 10000); }
    }
    var computed = null;
    if (intrinsic != null && market != null) {
      var intr = parseFloat(intrinsic);
      var mkt = parseFloat(market);
      if (isFinite(intr) && isFinite(mkt) && intr !== 0) {
        computed = Math.round(((intr - mkt) / intr) * 10000);
      }
    }
    var declaredImpossible = declared != null && Math.abs(declared) > MAX_BPS;
    var computedImpossible = computed != null && Math.abs(computed) > MAX_BPS;
    if (computed == null || computedImpossible) {
      if (declaredImpossible) { return null; }
      return declared;
    }
    if (declared == null) { return computed; }
    if (declaredImpossible) { return computed; }
    if (Math.abs(declared - computed) > 200) { return computed; }
    return declared;
  }

  // App-level 2-minute freshness gate (STALE_AFTER_MS) — a frozen /state
  // snapshot must collapse to UNKNOWN, matching the iframe embeds + dashboard.
  // A missing/unparseable timestamp is NOT stale (null-state path handles it).
  function isStaleTs(ts) {
    if (ts == null) { return false; }
    var t = Date.parse(ts);
    if (isNaN(t)) { return false; }
    return (Date.now() - t) > 120000;
  }

  function poll() {
    var url = API + "/v1/assets/" + encodeURIComponent(ASSET) + "/state";
    fetch(url, { headers: { Accept: "application/json" }, credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) { render("UNKNOWN", null); return; }
        if (isStaleTs(data.updated_at)) { render("UNKNOWN", null); return; }
        var state = data.state || data.peg_state || "UNKNOWN";
        var bps = reconcileBps(data.discount, data.intrinsic_usd, data.market_usd);
        render(state, bps);
      })
      .catch(function () { render("UNKNOWN", null); });
  }

  // Initial render (loading state) + first poll + 30s cadence (AC54).
  render("UNKNOWN", null);
  poll();
  setInterval(poll, 30000);
})();
`;

export async function GET() {
  return new NextResponse(SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Long cache — script is stable, version it via querystring if needed.
      "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
      // Permissive cross-origin so partner sites can embed without CORS error.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
