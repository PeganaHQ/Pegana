import { fetchLstDirectory } from "@/lib/lst/fetch-directory";

// Same-origin proxy for LST logos. `/lst` lists ~244 LSTs from
// lst-directory.com; only the ~35 Pegana-tracked rows get a vendored
// `/tokens/{mint}.webp` icon (see components/atoms/token-icon.tsx). The
// long tail's `logoUri` (arweave, ipfs, github, s3, twitter, shdw-drive, …)
// can't be used as a raw <img src>: the page CSP is `img-src 'self' data:
// blob:` (lib/security/csp.ts), so third-party hosts are blocked outright,
// and several of those CDNs 404/flake anyway. This route relays the bytes
// through our own origin so the browser only ever talks to pegana.xyz.
//
// SSRF-safe BY CONSTRUCTION: the client never supplies a URL, only a
// `mint`. The URL actually fetched is always the `logoUri` that
// lst-directory.com itself published for that exact mint, resolved
// server-side from the same revalidate(900)-cached directory fetch the
// /lst page already uses (fetchLstDirectory) — never a caller-controlled
// string. Needs full `fetch`/`ArrayBuffer`, not the Edge runtime.
//
// The published `logoUri`'s host is validated (isPrivateOrInvalidHost) BEFORE
// the fetch, and redirects are NOT followed (redirect: "manual" below), so a
// public logoUri cannot 3xx-hop to an internal host that skips that check —
// the same stance the dispatcher's reqwest client takes (Policy::none). (#R4-9)
export const runtime = "nodejs";

const MAX_BYTES = 1024 * 1024; // 1 MB cap on the proxied image
const FETCH_TIMEOUT_MS = 5_000;

// Hostname-string checks only — we deliberately do NOT DNS-resolve (that
// would need an extra round trip and still races the actual fetch), so
// this blocks the obvious literal ranges: loopback, RFC1918 private,
// link-local, and their IPv6 equivalents. `URL#hostname` lower-cases the
// host and wraps IPv6 literals in brackets (e.g. "[::1]", "[fc00::1]"),
// which the patterns below account for.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  // Carrier-grade NAT, 100.64.0.0/10 (RFC 6598). Routable-looking but private,
  // and reachable from inside many hosting networks — the range most commonly
  // missing from hand-rolled SSRF blocklists. Never a legitimate logo host.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/, // loopback
  // Any `::`-leading IPv6 literal: unspecified (`::`), loopback (`::1`),
  // IPv4-compatible (`::a.b.c.d`) and — critically — IPv4-MAPPED
  // (`::ffff:a.b.c.d`, which Node's URL parser renders as `[::ffff:<hex>]`,
  // e.g. `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`). None of those hex forms
  // matched the dotted-decimal rules above, so a mapped loopback / RFC1918 /
  // link-local literal bypassed the whole blocklist. None is ever a legitimate
  // public logo host. (#R5-A SSRF)
  /^\[?::/,
  /::ffff:/, // belt-and-suspenders: IPv4-mapped IPv6 anywhere in the host
  // IPv6 transition prefixes that embed an arbitrary (incl. private) IPv4 without
  // a leading `::` or `ffff:` hextet — historically-documented SSRF-filter
  // bypasses when the egress path does NAT64/6to4 translation. A logo host is
  // never legitimately one of these. (#R6)
  /^\[?64:ff9b:/i, // NAT64 well-known prefix 64:ff9b::/96 (+ 64:ff9b:1::/48)
  /^\[?2002:/i, // 6to4 2002::/16 (deprecated, RFC 7526 — never a real logo host)
  /^\[?fc[0-9a-f]{2}:/, // fc00::/7 (unique local, fc00–fdff)
  /^\[?fd[0-9a-f]{2}:/,
  /^\[?fe80:/, // link-local
];

function isPrivateOrInvalidHost(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(h));
}

// Verify the bytes are actually an image rather than trusting the upstream's
// declared `content-type`. A CDN that serves HTML under `Content-Type:
// image/png` is a real failure mode; `nosniff` already stops the browser
// executing it, so this is defence in depth plus a UX win — garbage is rejected
// here and the client's <img onError> shows the monogram instead of a broken
// image. Signatures per the format specs.
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length &&
    sig.every((b, i) => bytes[offset + i] === b);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // RIFF....WEBP
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  // SVG is text; scan a bounded prefix for the root element. Safe to serve here
  // because it is only ever loaded via <img src>, where scripts do not execute,
  // and the response carries `nosniff`.
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 1024))
    .trimStart()
    .replace(/^\uFEFF/, ""); // escaped: a literal BOM trips no-irregular-whitespace
  if (prefix.includes("<svg")) return "image/svg+xml";

  return null;
}

function notFound(): Response {
  // Every failure mode (missing mint, no logoUri, blocked host, non-image,
  // oversized, upstream error/timeout) degrades to a plain 404 — never a
  // 500 — so the client <img onError> falls back to the monogram.
  return new Response(null, { status: 404 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mint = searchParams.get("mint");
  if (!mint) return notFound();

  const directory = await fetchLstDirectory();
  if (directory.status !== "ok") return notFound();

  const row = directory.rows.find((r) => r.mint === mint);
  if (!row?.logoUri) return notFound();

  let logoUrl: URL;
  try {
    logoUrl = new URL(row.logoUri);
  } catch {
    return notFound();
  }

  if (logoUrl.protocol !== "https:" && logoUrl.protocol !== "http:") {
    return notFound();
  }
  if (isPrivateOrInvalidHost(logoUrl.hostname)) {
    return notFound();
  }

  try {
    const upstream = await fetch(logoUrl, {
      // #R4-9: do NOT auto-follow redirects. `redirect: "follow"` would chase a
      // 3xx `Location` to ANY host WITHOUT re-running isPrivateOrInvalidHost
      // (only the first hop is validated above), so a public logoUri could 302
      // to 127.0.0.1 / 169.254.169.254 and we'd connect to it. Under
      // `redirect: "manual"` a 3xx surfaces as an opaqueredirect (status 0,
      // `!ok`) and is rejected below — we accept only a DIRECT image response.
      // A logo served solely via a redirect degrades to the monogram fallback;
      // if broader coverage is ever needed, follow hops MANUALLY with per-hop
      // host revalidation — never a blanket follow.
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Non-2xx (including a redirect's opaque status 0) → miss.
    if (!upstream.ok) return notFound();

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) return notFound();

    // Cap first via Content-Length when the upstream sends one — avoids
    // reading a huge body just to discard it.
    const declaredLength = upstream.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > MAX_BYTES) {
      return notFound();
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return notFound();

    // Trust the BYTES, not the header. An upstream claiming `image/png` while
    // serving HTML gets rejected here instead of being relayed under our own
    // origin. Serve the sniffed type, so we never forward a declared type the
    // content does not actually match.
    const sniffed = sniffImageType(new Uint8Array(buf));
    if (!sniffed) return notFound();

    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": sniffed,
        // Long-lived + immutable: a given mint's logoUri rarely changes, and
        // Vercel's CDN + browser cache absorb repeat requests after warmup.
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
        // Belt-and-suspenders — images never execute embedded script, but
        // this blocks a browser from ever sniffing the body as anything else.
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
