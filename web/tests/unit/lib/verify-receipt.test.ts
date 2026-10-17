import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  jcsSerialize,
  recomputeReceiptSha256,
  verifyReceipt,
  type ReplayBundle,
} from "@/lib/verify-receipt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): ReplayBundle {
  const p = resolve(__dirname, "../../fixtures", name);
  return JSON.parse(readFileSync(p, "utf-8")) as ReplayBundle;
}

// ---------------------------------------------------------------------------
// JCS unit tests
// ---------------------------------------------------------------------------

describe("jcsSerialize — RFC 8785 canonical JSON", () => {
  it("serializes null", () => {
    expect(jcsSerialize(null)).toBe("null");
  });

  it("serializes booleans", () => {
    expect(jcsSerialize(true)).toBe("true");
    expect(jcsSerialize(false)).toBe("false");
  });

  it("serializes integers as bare numbers", () => {
    expect(jcsSerialize(0)).toBe("0");
    expect(jcsSerialize(42)).toBe("42");
    expect(jcsSerialize(800)).toBe("800");
    expect(jcsSerialize(-1)).toBe("-1");
  });

  it("serializes strings with proper escaping", () => {
    expect(jcsSerialize("hello")).toBe('"hello"');
    expect(jcsSerialize('say "hi"')).toBe('"say \\"hi\\""');
    expect(jcsSerialize("line1\nline2")).toBe('"line1\\nline2"');
    expect(jcsSerialize("tab\there")).toBe('"tab\\there"');
    expect(jcsSerialize("a\\b")).toBe('"a\\\\b"');
  });

  it("sorts object keys lexicographically (UTF-16 order)", () => {
    const obj = { z: 1, a: 2, m: 3 };
    expect(jcsSerialize(obj)).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts nested object keys recursively", () => {
    const obj = { b: { d: 1, c: 2 }, a: 3 };
    expect(jcsSerialize(obj)).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it("preserves array element order", () => {
    expect(jcsSerialize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes null fields in objects", () => {
    expect(jcsSerialize({ x: null, a: "v" })).toBe('{"a":"v","x":null}');
  });

  it("serializes an empty object and empty array", () => {
    expect(jcsSerialize({})).toBe("{}");
    expect(jcsSerialize([])).toBe("[]");
  });

  it("matches the expected inputs_frozen canonical form from fixture", () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    const result = jcsSerialize(bundle.inputs_frozen);
    // Spot-check key ordering: alpha < asset < candidate_since < ...
    expect(result).toContain('"alpha":"0.3"');
    expect(result.indexOf('"alpha"')).toBeLessThan(result.indexOf('"asset"'));
    expect(result.indexOf('"asset"')).toBeLessThan(
      result.indexOf('"candidate_since"'),
    );
    // thresholds sub-object: critical < depeg < drift
    expect(result.indexOf('"critical"')).toBeLessThan(
      result.indexOf('"depeg"'),
    );
    expect(result.indexOf('"depeg"')).toBeLessThan(result.indexOf('"drift"'));
  });
});

// ---------------------------------------------------------------------------
// GOLD TEST — byte-exact match against real production receipts
// ---------------------------------------------------------------------------

describe("recomputeReceiptSha256 — gold test (byte-exact vs Rust engine)", () => {
  it("matches expected_receipt_sha256 for fixture 1 (sUSD DRIFT, 0.4.0)", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    expect(bundle.expected_receipt_sha256).toBe(
      "5ae45763a225cafb930852f56145a14b21134d6692784ba65bc37b4419d24a4e",
    );
    const recomputed = await recomputeReceiptSha256(bundle);
    expect(recomputed).toBe(bundle.expected_receipt_sha256);
  });

  it("matches expected_receipt_sha256 for fixture 2 (sHYUSD UNKNOWN, 0.4.0)", async () => {
    const bundle = loadFixture("replay-bundle-sample2.json");
    expect(bundle.expected_receipt_sha256).toBe(
      "98b871d5645b672e2a059bf31f1528f57da5ded245c71d7e8982c37af3dd18af",
    );
    const recomputed = await recomputeReceiptSha256(bundle);
    expect(recomputed).toBe(bundle.expected_receipt_sha256);
  });
});

// ---------------------------------------------------------------------------
// verifyReceipt — happy path + tamper detection
// ---------------------------------------------------------------------------

describe("verifyReceipt", () => {
  it("returns ok=true when the bundle is untampered", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    const result = await verifyReceipt(bundle);
    expect(result.ok).toBe(true);
    expect(result.recomputed).toBe(bundle.expected_receipt_sha256);
    expect(result.expected).toBe(bundle.expected_receipt_sha256);
  });

  it("returns ok=false when methodology_version is tampered", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    const tampered: ReplayBundle = { ...bundle, methodology_version: "0.9.9" };
    const result = await verifyReceipt(tampered);
    expect(result.ok).toBe(false);
    expect(result.recomputed).not.toBe(result.expected);
  });

  it("returns ok=false when inputs_frozen field is mutated", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    const tampered: ReplayBundle = {
      ...bundle,
      inputs_frozen: {
        ...bundle.inputs_frozen,
        market_usd: "1.05", // mutate a numeric string field
      },
    };
    const result = await verifyReceipt(tampered);
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when expected_computed is mutated", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    const tampered: ReplayBundle = {
      ...bundle,
      expected_computed: {
        ...bundle.expected_computed,
        final_state: "CRITICAL", // change the conclusion
      },
    };
    const result = await verifyReceipt(tampered);
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when assets_toml_canonical is mutated", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    const tampered: ReplayBundle = {
      ...bundle,
      assets_toml_canonical: bundle.assets_toml_canonical + "\n# tampered",
    };
    const result = await verifyReceipt(tampered);
    expect(result.ok).toBe(false);
  });
});
