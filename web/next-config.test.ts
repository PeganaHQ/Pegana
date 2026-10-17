import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

const DOCS_ORIGIN = "https://docs.pegana.xyz";

describe("legacy documentation redirects", () => {
  it("sends every legacy docs route directly to the docs subdomain", async () => {
    const redirects = await nextConfig.redirects!();
    const legacySources = [
      "/concepts",
      "/concepts/:slug",
      "/learn",
      "/learn/:slug",
      "/developers",
      "/developers/examples",
      "/developers/:path*",
      "/changelog",
      "/feed/changelog.xml",
    ];

    const legacy = redirects.filter((redirect) =>
      legacySources.includes(redirect.source),
    );

    expect(legacy).toHaveLength(legacySources.length);
    for (const redirect of legacy) {
      expect(redirect.permanent).toBe(true);
      expect(redirect.destination.startsWith(DOCS_ORIGIN)).toBe(true);
      expect(redirect.destination.startsWith("/docs")).toBe(false);
    }
  });
});
