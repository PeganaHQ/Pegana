// x402 resource server setup.
//
// Pegana is fully open and free: no tool is wrapped in a payment requirement,
// so nothing here is on the hot path of a call. The resource server is kept
// because it carries the Bazaar discovery extension registration — the
// facilitator reads discovery metadata from the challenge envelope — so a
// future paid tier can re-enable settlement without rebuilding this wiring.
//
// Facilitator: a bare URL, defaulting to the public devnet facilitator. There
// are no credentials to configure (the Coinbase CDP path was removed with the
// payment tier), and therefore no boot guard: nothing can silently take money.
//
// CAIP-2 networks (per @x402/svm/constants):
//   devnet:  solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
//   mainnet: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp

import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/mcp";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";

// CAIP-2 network identifier — x402 types this as a template literal.
// We mirror the shape locally so callers can pass network around safely
// without importing private subpaths.
export type CaipNetwork = `${string}:${string}`;

export interface ResourceServerHandle {
  server: x402ResourceServer;
  network: CaipNetwork;
}

/**
 * Facilitator request timeout from the environment. The @x402/core constructor
 * THROWS for anything but a positive safe integer <= 2^31-1, and this runs at
 * boot outside any try/catch, so a bad value ("0.5", "Infinity", "1e10", "abc")
 * must fall back to the default instead of crashing the process.
 */
export function facilitatorTimeoutMs(raw: string | undefined): number {
  const n = Math.trunc(Number(raw));
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : 5_000;
}

function buildFacilitator(): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    // The library default is 90 s per request, which let a slow facilitator
    // stall boot (server.initialize() calls getSupported) for a minute and a
    // half. Bounded here; X402_FACILITATOR_TIMEOUT_MS overrides.
    timeoutMs: facilitatorTimeoutMs(process.env.X402_FACILITATOR_TIMEOUT_MS),
  });
}

export async function buildResourceServer(
  // Test seam: production passes nothing and buildFacilitator() picks the
  // configured URL. A stub can be injected to assert wiring (scheme
  // registration, Bazaar extension) without a network handshake.
  facilitator: HTTPFacilitatorClient = buildFacilitator(),
): Promise<ResourceServerHandle> {
  const server = new x402ResourceServer(facilitator);
  const raw = process.env.SOLANA_NETWORK ?? "";
  if (!raw.startsWith("solana:")) {
    throw new Error(
      `SOLANA_NETWORK must be a CAIP-2 'solana:...' string, got '${raw}'`,
    );
  }
  const network = raw as CaipNetwork;
  server.register(network, new ExactSvmScheme());
  // Bazaar discovery: registering the extension lets it enrich a challenge
  // with the per-tool metadata declared in @/discovery. Kept for a future
  // paid tier; with every tool free there is no 402 challenge to enrich today.
  server.registerExtension(bazaarResourceServerExtension);
  try {
    await server.initialize();
  } catch (error) {
    // Discovery is optional while every tool is free.
    console.warn("[mcp] x402 discovery initialization unavailable:", error);
  }
  return { server, network };
}
