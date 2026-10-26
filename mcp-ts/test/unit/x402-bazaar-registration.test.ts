// The Bazaar discovery extension is registered on the resource server.
//
// Pegana is fully free, so no tool emits a 402 challenge today and the
// extension has nothing to enrich. The registration is kept (and asserted
// here) so a future paid tier re-enables discovery by attaching the
// declarations in @/discovery — without rebuilding this wiring.
//
// Uses buildResourceServer's injected-facilitator seam so no network
// handshake happens.

import { describe, expect, it, vi } from "vitest";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

process.env.SOLANA_NETWORK = DEVNET;

/** Minimal facilitator stub: initialize() only needs getSupported(). */
const facilitatorStub = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, network: DEVNET, scheme: "exact" }],
  }),
} as never;

describe("x402 resource server wiring", () => {
  it("keeps the free server available when facilitator initialization fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unavailable = { getSupported: async () => { throw new Error("offline"); } } as never;
    try {
      const { buildResourceServer } = await import("@/x402");
      await expect(buildResourceServer(unavailable)).resolves.toBeDefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it("registers the bazaar extension", async () => {
    const { buildResourceServer } = await import("@/x402");
    const { server } = await buildResourceServer(facilitatorStub);

    // `registeredExtensions` is a private Map; reading it is the only way to
    // observe registration without a live facilitator round-trip.
    const registered = (
      server as unknown as { registeredExtensions: Map<string, unknown> }
    ).registeredExtensions;

    expect(registered).toBeInstanceOf(Map);
    expect(registered.has("bazaar")).toBe(true);
  });

  it("rejects a non-CAIP-2 network", async () => {
    const prev = process.env.SOLANA_NETWORK;
    process.env.SOLANA_NETWORK = "mainnet";
    try {
      const { buildResourceServer } = await import("@/x402");
      await expect(buildResourceServer(facilitatorStub)).rejects.toThrow(
        /CAIP-2/,
      );
    } finally {
      process.env.SOLANA_NETWORK = prev;
    }
  });

  it("has no payment credentials to misconfigure (no boot guard remains)", async () => {
    // The ADR-0018 guard existed because a CDP misconfig could take money and
    // never settle. With every tool free there is nothing to take, so mainnet
    // boots with no CDP env at all.
    const prev = process.env.SOLANA_NETWORK;
    process.env.SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    try {
      const { buildResourceServer } = await import("@/x402");
      await expect(buildResourceServer(facilitatorStub)).resolves.toBeDefined();
    } finally {
      process.env.SOLANA_NETWORK = prev;
    }
  });
});

describe("facilitatorTimeoutMs", () => {
  it("accepts a positive safe integer and truncates fractions above 1", async () => {
    const { facilitatorTimeoutMs } = await import("@/x402");
    expect(facilitatorTimeoutMs("8000")).toBe(8000);
    expect(facilitatorTimeoutMs("2500.9")).toBe(2500);
  });
  it.each(["0.5", "0", "-5", "Infinity", "1e10", "abc", "", undefined, "2147483648"])(
    "falls back to 5000 for %s instead of crashing the constructor",
    async (raw) => {
      const { facilitatorTimeoutMs } = await import("@/x402");
      expect(facilitatorTimeoutMs(raw as string | undefined)).toBe(5000);
    },
  );
  it("the largest allowed value is 2^31-1", async () => {
    const { facilitatorTimeoutMs } = await import("@/x402");
    expect(facilitatorTimeoutMs("2147483647")).toBe(2147483647);
  });
});
