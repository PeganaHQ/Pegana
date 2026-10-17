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
const POSITIVE_INT = /^[1-9][0-9]*$/;

function badRequest(message: string) {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
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
    return NextResponse.json({ error: "unsupported_pair" }, { status: 400 });
  }
  if (!POSITIVE_INT.test(amount)) {
    return badRequest("amount must be a positive integer (base units)");
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
      next: { revalidate: 10 },
      signal: AbortSignal.timeout(10_000),
    });

    const body = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Quote unavailable", upstreamStatus: res.status },
        {
          headers: {
            "cache-control": "s-maxage=10, stale-while-revalidate=30",
          },
        },
      );
    }

    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "s-maxage=10, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote unavailable" },
      {
        headers: {
          "cache-control": "s-maxage=10, stale-while-revalidate=30",
        },
      },
    );
  }
}
