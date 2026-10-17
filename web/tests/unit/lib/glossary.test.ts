import { describe, it, expect } from "vitest";
import { GLOSSARY } from "@/lib/glossary";

describe("glossary — examples track the live catalog", () => {
  it("FX-pegged example references a real live asset (EURC), not the stale BRZ", () => {
    expect(GLOSSARY.stable_fx.body).toContain("EURC");
    expect(GLOSSARY.stable_fx.body).not.toMatch(/BRZ/i);
  });

  it("Pyth definition does not cite the stale BRL/USD cross", () => {
    expect(GLOSSARY.pyth.body).not.toMatch(/BRL/i);
  });
});

describe("glossary — no internal infra vocabulary leaks to users", () => {
  // These are implementation details (rate limits, internal API names, stream
  // transports) that mean nothing to a user and read like a debug log.
  const INFRA_JARGON = [
    "lite-api",
    "rps",
    "extra-api",
    "hermes sse",
    "round-robin",
    "decode the exchange account",
  ];

  it("every glossary body is free of infra jargon", () => {
    for (const [term, { body }] of Object.entries(GLOSSARY)) {
      const lower = body.toLowerCase();
      for (const jargon of INFRA_JARGON) {
        expect(lower, `glossary["${term}"] leaks "${jargon}"`).not.toContain(
          jargon,
        );
      }
    }
  });
});

describe("glossary — Premium reads professionally", () => {
  it("avoids the informal 'richer than fair value' phrasing", () => {
    expect(GLOSSARY.premium.body).not.toMatch(/richer than fair value/i);
  });

  it("still explains the core idea: market above intrinsic / negative spread", () => {
    expect(GLOSSARY.premium.body).toMatch(/above/i);
    expect(GLOSSARY.premium.body).toMatch(/negative spread/i);
  });
});
