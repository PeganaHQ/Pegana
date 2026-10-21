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
    if (!res.ok) {
      // Failures are NOT cached. They used to carry the same s-maxage as a
      // good quote, so a Jupiter 429 (the usual failure: the widget's burst of
      // sizes) was pinned at the edge and the client's retry read the cached
      // failure back. A 429 is passed on as 503 + Retry-After so the client
      // can back off instead of reading a 200.
      return NextResponse.json(
        { error: "Quote unavailable", upstreamStatus: res.status },
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
            ...(res.status === 429
              ? { "retry-after": res.headers.get("retry-after") ?? "2" }
              : {}),
          },
        },
      );
    }

    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        // Hobby budget: every edge miss is a function invocation (1M a month
        // on Hobby, shared with every page render). The ladder asks for five
        // sizes, so with steady traffic one asset cost five invocations per
        // cache window: 43k a day at 10s, more than the whole daily share of
        // the quota. At 30s it is a third of that. The upstream fetch is
        // no-store, so a quote the CDN serves is at most 60s old (30s fresh +
        // 30s stale while one request refreshes it), up from 40s. The ladder
        // is an indicative depth read, not peg data.
        "cache-control": "s-maxage=30, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
