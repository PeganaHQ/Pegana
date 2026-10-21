import { NextResponse } from "next/server";
import { isAllowedPair } from "./allowlist";

// Server-only route — the Jupiter API key must never reach the client bundle.
export const runtime = "nodejs";

// Jupiter quote proxy. The keyless lite-api host is being deprecated/throttled by
// Jupiter (intermittent /swap/v1/quote hangs, 2026-06); the durable path is the
// keyed api.jup.ag (SAME paths — only host + x-api-key change). When a key is
// set we use the keyed host; otherwise we fall back to keyless lite-api so the
// route never hard-breaks if the key is absent.
//
// Accept either env name: JUP_API_KEY (this proxy's own var) or JUPITER_API_KEY
// (the name the Rust indexer + .env.example already use). Without the fallback an
// operator who provisions only JUPITER_API_KEY per .env.example would silently
// leave the proxy on the throttled keyless host — reintroducing the hang this
// migration fixed, with no signal that it's running keyless.
const JUP_API_KEY = process.env.JUP_API_KEY ?? process.env.JUPITER_API_KEY;
const JUPITER_QUOTE_URL = JUP_API_KEY
  ? "https://api.jup.ag/swap/v1/quote"
  : "https://lite-api.jup.ag/swap/v1/quote";

// A Solana mint is base58, 32–44 chars. Validating up front rejects malformed
// input before it reaches the (rate-limited, billed) Jupiter upstream — this is
// an open GET proxy, so unvalidated passthrough wastes the shared key's budget
// and widens the abuse surface.
const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Jupiter's `amount` is a u64, at most 20 digits. The ladder's largest ask,
// $1M of a 9-decimal token, stays within that down to a $0.0001 price (1e19).
const POSITIVE_INT = /^[1-9][0-9]{0,19}$/;

// The only parameters the exit-liquidity widget sends
// (components/organisms/exit-liquidity.tsx). Anything else, or a repeated
// parameter, is a 400 before the upstream call. The CDN keys its cache on the
// full query string, so `&x=<random>` makes every request an edge miss. A
// rejected request still runs this function (an invocation on the Hobby
// quota); what the check saves is the Jupiter call against the shared key.
// Reordering the four accepted parameters still produces distinct CDN keys;
// the widget always sends them in one order.
const ALLOWED_PARAMS = new Set(["inputMint", "outputMint", "amount", "slippageBps"]);

// Jupiter's rate-limit headers, passed through on a failure so the client (and
// anyone debugging) sees the real budget. Seen on api.jup.ag and lite-api.jup.ag:
// x-ratelimit-remaining, x-ratelimit-current, x-ratelimit-reset (epoch secs).
function rateLimitHeaders(upstream: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  upstream.forEach((value, key) => {
    if (key.toLowerCase().startsWith("x-ratelimit-")) out[key.toLowerCase()] = value;
  });
  return out;
}

// Retry-After for an upstream 429: Jupiter's own when it sends one, else the
// seconds until its x-ratelimit-reset epoch. Neither present: no header, and
// the client falls back to its own backoff schedule.
function retryAfterHeader(
  upstream: Headers,
  nowMs: number = Date.now(),
): Record<string, string> {
  const own = upstream.get("retry-after");
  if (own) return { "retry-after": own };
  const reset = Number(upstream.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const secs = Math.ceil(reset - nowMs / 1000);
    if (secs > 0 && secs <= 3600) return { "retry-after": String(secs) };
  }
  return {};
}

function badRequest(message: string) {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seen = new Set<string>();
  for (const key of searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key) || seen.has(key)) {
      return badRequest(
        "only inputMint, outputMint, amount and slippageBps are accepted, once each",
      );
    }
    seen.add(key);
  }
  const inputMint = searchParams.get("inputMint") ?? "";
  const outputMint = searchParams.get("outputMint") ?? "";
  const amount = searchParams.get("amount") ?? "";
  const slippageBps = searchParams.get("slippageBps") ?? "50";

  if (!BASE58_MINT.test(inputMint) || !BASE58_MINT.test(outputMint)) {
    return badRequest("inputMint and outputMint must be base58 mint addresses");
  }
  // Allowlist gate (audit F-03): only permit the exact mint pairs the
  // exit-liquidity widget requests. Rejects enumeration / key-drain abuse
  // without gating logged-out users (the widget is public).
  if (!isAllowedPair(inputMint, outputMint)) {
    return badRequest("unsupported_pair");
  }
  if (!POSITIVE_INT.test(amount)) {
    return badRequest("amount must be a positive integer of at most 20 digits (base units)");
  }
  if (!/^[0-9]{1,5}$/.test(slippageBps)) {
    return badRequest("slippageBps must be an integer in 0–99999");
  }

  try {
    const upstream = new URL(JUPITER_QUOTE_URL);
    upstream.searchParams.set("inputMint", inputMint);
    upstream.searchParams.set("outputMint", outputMint);
    upstream.searchParams.set("amount", amount);
    upstream.searchParams.set("slippageBps", slippageBps);

    const res = await fetch(upstream, {
      headers: {
        Accept: "application/json",
        ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
      },
      // no-store: the CDN header below is the only cache. A Data Cache entry
      // (`next: { revalidate }`) is served even after it expires while it
      // refreshes in the background, so after an idle period the first
      // visitor would get a quote of any age, and the CDN would then keep it
      // for another minute.
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const body = await res.text();
    const rateHeaders = rateLimitHeaders(res.headers);
    if (!res.ok) {
      // Failures are NOT cached (no-store). A cached failure would be pinned
      // at the edge and every client retry would read it back; a Jupiter 429
      // (the usual failure) clears within seconds. A 429 is passed on as 503
      // with Jupiter's own rate-limit headers so the client backs off for the
      // real window, not an invented one.
      return NextResponse.json(
        { error: "Quote unavailable", upstreamStatus: res.status },
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
            ...rateHeaders,
            ...(res.status === 429 ? retryAfterHeader(res.headers) : {}),
          },
        },
      );
    }

    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        // No x-ratelimit-* here: this response is cached at the edge for up
        // to 3 minutes, so the budget it reported would be stale for every
        // later viewer. They are passed through on (uncached) failures only.
        // A good quote is cached at the edge for 60s and served stale for up
        // to 120s more while one request refreshes it, so a quote shown is at
        // most 3 minutes old. Exit depth at $1k to $1M sizes does not move on
        // a sub-minute scale, and the ladder is an indicative depth read, not
        // peg data. The window matters for budget: the free Jupiter org gives
        // about 1 request per second, shared with the box indexer, and every
        // edge miss is also a function invocation on the Hobby quota.
        // Equal ladders share keys because the widget rounds each amount to
        // three significant figures (quoteAmountBaseUnits).
        "cache-control": "s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
