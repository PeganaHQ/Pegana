/**
 * Regression: /audit?asset= filter (AC5).
 *
 * The audit page must forward the `?asset=` query param to the API so the
 * "verify" link from the badge lands on a per-asset receipt feed.
 *
 * We test the sanitisation regex independently (extracted to avoid importing
 * the full Next.js server component) and verify the URL-building logic.
 *
 * For full integration, use Playwright (/test:e2e) — these are the unit guards.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Mirrors the sanitisation check in audit/page.tsx exactly.
// Keep in sync if the regex changes there.
function sanitiseAsset(raw: string): string | null {
  if (raw.length === 0) return null;
  return /^[A-Za-z0-9_-]{1,20}$/.test(raw) ? raw : null;
}

describe("audit receipt HTTP status", () => {
  it("does not stream a loading boundary before an unknown receipt can call notFound", () => {
    expect(
      existsSync(
        resolve(process.cwd(), "app/(marketing)/audit/[id]/loading.tsx"),
      ),
    ).toBe(false);
  });
});

describe("audit ?asset= sanitisation", () => {
  it("accepts a plain symbol like USDC", () => {
    expect(sanitiseAsset("USDC")).toBe("USDC");
  });

  it("accepts symbols with mixed case", () => {
    expect(sanitiseAsset("jitoSOL")).toBe("jitoSOL");
  });

  it("accepts symbols with hyphens and underscores", () => {
    expect(sanitiseAsset("USD-SOL")).toBe("USD-SOL");
    expect(sanitiseAsset("my_token")).toBe("my_token");
  });

  it("rejects empty string", () => {
    expect(sanitiseAsset("")).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(sanitiseAsset("../etc/passwd")).toBeNull();
  });

  it("rejects XSS attempt", () => {
    expect(sanitiseAsset("<script>")).toBeNull();
  });

  it("rejects symbols longer than 20 chars", () => {
    expect(sanitiseAsset("A".repeat(21))).toBeNull();
  });

  it("rejects symbols with spaces", () => {
    expect(sanitiseAsset("USD COIN")).toBeNull();
  });

  it("rejects URL-encoded injection (literal %)", () => {
    expect(sanitiseAsset("USDC%20x")).toBeNull();
  });

  it("accepts exactly 20-char symbol (boundary)", () => {
    expect(sanitiseAsset("A".repeat(20))).toBe("A".repeat(20));
  });
});

// Verify the URLSearchParams forwarding logic (mirrors fetchIndex in audit/page.tsx).
function buildAuditUrl(
  apiBase: string,
  stateFilter: string | null,
  assetFilter: string | null,
): string {
  const params = new URLSearchParams({ limit: "50", exclude_pegged: "true" });
  if (stateFilter) params.set("state", stateFilter);
  if (assetFilter) params.set("asset", assetFilter);
  return `${apiBase}/v1/audit?${params.toString()}`;
}

describe("audit fetchIndex URL construction", () => {
  const BASE = "https://api.pegana.xyz";

  it("includes asset= when assetFilter is set", () => {
    const url = buildAuditUrl(BASE, null, "USDC");
    expect(url).toContain("asset=USDC");
  });

  it("does NOT include asset= when assetFilter is null", () => {
    const url = buildAuditUrl(BASE, null, null);
    expect(url).not.toContain("asset=");
  });

  it("can combine state= and asset= filters", () => {
    const url = buildAuditUrl(BASE, "DEPEG", "USDe");
    expect(url).toContain("state=DEPEG");
    expect(url).toContain("asset=USDe");
  });

  it("always includes limit=50 and exclude_pegged=true", () => {
    const url = buildAuditUrl(BASE, null, "USDC");
    expect(url).toContain("limit=50");
    expect(url).toContain("exclude_pegged=true");
  });
});
