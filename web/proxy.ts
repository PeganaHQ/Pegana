import { NextResponse, type NextRequest } from "next/server";
import { buildCspForEnv } from "@/lib/security/csp";
import { CONSOLE_HOST, routeRequest } from "@/lib/routing/host-routing";

// Vercel multi-domain routing — Next.js 16 Proxy convention.
//
// The same Next.js deployment serves both www.pegana.xyz (marketing + app)
// and releases.pegana.xyz (CLI installer + binaries). On the releases host,
// every request is rewritten to /releases/* so we can keep one Next.js
// project with a clear directory boundary.
//
// /releases/<asset> resolves first against web/public/releases/<asset> (static
// binaries + SHA256SUMS shipped with the build), then against the App Router
// at app/releases/<asset>/route.ts or app/releases/page.tsx. The installer
// shell script (pegana-replay-installer.sh) lives in public/releases so it
// can be served as a plain text/x-sh static asset without a route handler.
//
// Filename note: Next.js 16 renamed the `middleware` file convention to
// `proxy`. Same signature; the exported function is now named `proxy` so the
// runtime picks it up under the new contract.
//
// CSP — F-07 security hardening (2026-06-21; ENFORCING since 2026-06-22):
// For all non-releases requests this proxy generates a per-request nonce,
// sets it on the forwarded request as `x-nonce` (readable by Server Components
// via `(await headers()).get('x-nonce')`), and attaches an enforcing
// `Content-Security-Policy` header to the response (with `report-uri
// /api/csp-report`, so violations are blocked AND reported). The one enforce
// blocker — the Telegram Login Widget's eval() — was resolved by isolating that
// widget in a sandboxed same-origin iframe (/embed/telegram-login) with its own
// relaxed CSP. Verified clean site-wide + a real login confirmed under enforce.
// ROLLBACK: set both header names below back to the `-Report-Only` variant.

const APEX_HOST = "pegana.xyz";
const PRIMARY_HOST = "www.pegana.xyz";
const RELEASES_HOST = "releases.pegana.xyz";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();

  // ── releases.pegana.xyz branch ─────────────────────────────────────────────
  // This branch is UNCHANGED from the original implementation. CSP is not
  // added here — the releases pages serve static binaries and the landing page
  // for the CLI installer, not authenticated web-app HTML.
  if (host === RELEASES_HOST) {
    const { pathname, search } = request.nextUrl;

    // Already a /releases/* request? Let it through unchanged.
    if (pathname.startsWith("/releases/") || pathname === "/releases") {
      return NextResponse.next();
    }

    // Root request → landing page.
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/releases";
      return NextResponse.rewrite(url);
    }

    // Everything else: /<asset> → /releases/<asset>.
    const url = request.nextUrl.clone();
    url.pathname = `/releases${pathname}`;
    url.search = search;
    return NextResponse.rewrite(url);
  }

  // ── host policy ───────────────────────────────────────────────────────────
  //
  // Pegana is fully open and free: every surface is public, so the old
  // www ⇄ app redirect split is gone. Both hosts serve the same application.
  // The one remaining host-level rule is that the app host stays out of search
  // indexes (X-Robots-Tag, applied below alongside the CSP).
  const hostPolicy = routeRequest(host);

  // ── apex → www ────────────────────────────────────────────────────────────
  //
  // THIS IS WHY pegana.xyz RENDERED WITH NO CSS AT ALL.
  //
  // vercel.json already carries an apex→www redirect for `/:path*`, and it
  // works — for assets. It never fired for the DOCUMENT, because this
  // middleware intercepts document requests and returns a response before
  // vercel.json's redirect is reached, while `_next/` is excluded from the
  // matcher below and therefore falls straight through to it.
  //
  // The result was a split-origin page:
  //   GET https://pegana.xyz/                       → 200, HTML served here
  //   GET https://pegana.xyz/_next/static/…css      → 308 to www.pegana.xyz
  //   CSP on that document: style-src 'self'        → 'self' IS pegana.xyz
  //   → the stylesheet redirects to a DIFFERENT origin, CSP refuses to load it
  //
  // Every stylesheet, font and image died the same way. Measured live: 3 <link>
  // tags present, `document.styleSheets` inaccessible, body background
  // transparent, h1 at the browser's default 32px. Unstyled HTML.
  //
  // It never showed up in any check because every probe used www directly. The
  // apex is what a person types.
  //
  // Redirecting here, before any CSP is attached, keeps the whole session on
  // one origin so `'self'` means what the rest of this file assumes it means.
  // app.pegana.xyz used to be the console host. Every surface is public on
  // www now, so the app host served a full duplicate of the site (noindex, but
  // still a second copy of every page and a second CSP origin). Send it to the
  // same path on www, exactly like the apex.
  if (host === APEX_HOST || host === CONSOLE_HOST) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = PRIMARY_HOST;
    return NextResponse.redirect(url, 308);
  }

  // ── www.pegana.xyz branch — nonce + CSP (enforcing) ────────────────────────
  //
  // Generate a fresh cryptographically-random nonce for every HTML page
  // request. `crypto.randomUUID()` is available in both Node.js (≥ 14.17) and
  // the Vercel Edge runtime. We base64-encode it to make it safe as a CSP
  // token value (UUIDs contain only hex + hyphens, but base64 is the
  // conventional form).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const cspValue = buildCspForEnv(nonce);

  // Clone the incoming request headers and set BOTH x-nonce AND the CSP header.
  //
  // x-nonce: read by the RootLayout via `(await headers()).get('x-nonce')` to
  // stamp nonce= on inline <script> tags and ThemeProvider.
  //
  // Content-Security-Policy on the REQUEST: Next.js 16 reads the CSP from the
  // *incoming* request headers (app-render.js:167 checks
  // `headers['content-security-policy'] || headers['content-security-policy-report-only']`)
  // to auto-nonce its own bundle <script> tags and Server Component <script>
  // elements. Without this, Next.js never sees the nonce → its scripts are
  // un-nonced → 'strict-dynamic' rejects them → white-screen under enforcement.
  // This matches the official Next.js 16 pattern exactly:
  //   node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:67-85
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspValue);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ENFORCING CSP (2026-06-22). The Telegram-widget eval blocker was resolved by
  // moving the login widget into a sandboxed same-origin iframe
  // (/embed/telegram-login) with its own relaxed CSP, so the main app enforces
  // strictly. Verified clean across home/asset/dashboard/account, and a REAL
  // Telegram login was confirmed working under enforce. `report-uri
  // /api/csp-report` stays → violations are now BLOCKED and reported. ROLLBACK:
  // set both this and the requestHeaders key above back to
  // `Content-Security-Policy-Report-Only`, then redeploy.
  response.headers.set("Content-Security-Policy", cspValue);

  // Console host is noindex site-wide (spec §2). Applied here, at the host
  // level, so every console route is covered without each page repeating it —
  // and it also covers the pages that cannot carry a `metadata` export (client
  // components, error boundaries). The marketing host is left indexable.
  if (hostPolicy.noindex) {
    response.headers.set("X-Robots-Tag", "noindex");
  }

  return response;
}

export const config = {
  // Skip Next.js internals and static asset URLs.
  //
  // The original matcher covered all routes. We now use the object-form
  // matcher recommended by Next.js for CSP nonces: we additionally exclude
  // prefetch requests (next-router-prefetch / purpose=prefetch) because
  // prefetched responses don't render HTML — applying a fresh nonce to them
  // would be wasted work and can confuse the prefetch cache.
  //
  // `api/` is still excluded: API route handlers return JSON/binary, not HTML,
  // so they don't need the nonce. The /api/csp-report handler itself must NOT
  // be intercepted by this proxy (it would add unnecessary CSP headers to a
  // JSON endpoint and could confuse the router).
  //
  // `embed/` is excluded: /embed/* route handlers set their OWN
  // Content-Security-Policy header, so the proxy must not overwrite it. The
  // BADGE routes (/embed/[asset], /embed/badge/*) use `frame-ancestors *` to
  // stay cross-origin embeddable; the LOGIN route (/embed/telegram-login) uses
  // `frame-ancestors 'self'` ON PURPOSE (anti-clickjacking — only Pegana may
  // embed the sign-in iframe). Do NOT "normalize" telegram-login to `*`.
  // Applying the proxy's `frame-ancestors 'none'` to any of them would just
  // generate spurious violation reports on every legitimate embed — pure noise.
  //
  // `monitoring` is excluded: it is the Sentry tunnel endpoint (next.config.ts
  // `tunnelRoute`). It receives a high-frequency stream of event POSTs that
  // return no HTML, so generating a per-request nonce + CSP there is pure
  // overhead on a hot path.
  //
  // Static images, fonts and the manifest (`/tokens/*`, `/logos/*`,
  // `/brand/*`, and any path ending in an image/font/manifest extension) are
  // excluded too. They are plain files from `public/`, never HTML, and the
  // proxy ran once for each of them: about 20 middleware invocations per
  // landing-page view, measured 2026-10-21, all billed as function
  // invocations on Vercel. The releases host is unaffected: what it serves
  // (the installer script, binaries, SHA256SUMS) has none of these extensions.
  //
  // Generated images (`*/opengraph-image*`, `*/twitter-image*`,
  // `/asset/*/share-card`, `/compare/share`) are PNG route handlers, not HTML,
  // and set their own CDN Cache-Control. Running the proxy on them added an
  // invocation and a pointless CSP header to every unfurl.
  //
  // `llms.txt`/`llms-full.txt` are excluded like robots/sitemap: they are
  // static text Route Handlers (app/llms.txt/route.ts, app/llms-full.txt/route.ts)
  // that return `text/plain`, not HTML, so a per-request nonce + CSP is wasted
  // work — and their content is a machine index, never nonce-bearing script.
  matcher: [
    {
      source:
        "/((?!_next/|api/|embed/|monitoring|favicon|robots.txt|sitemap|llms.txt|llms-full.txt|tokens/|logos/|brand/|compare/share|.*/(?:opengraph-image|twitter-image|share-card)|.*\\.(?:png|svg|webp|jpg|jpeg|gif|ico|woff2?|webmanifest)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
