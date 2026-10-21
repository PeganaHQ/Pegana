import { describe, it, expect } from "vitest";
import { siteOrigin } from "@/lib/seo/site-origin";

describe("siteOrigin", () => {
  it("defaults to the canonical www origin", () => {
    expect(siteOrigin(undefined)).toBe("https://www.pegana.xyz");
    expect(siteOrigin("")).toBe("https://www.pegana.xyz");
  });
  it("normalises the apex (which 308s to www)", () => {
    expect(siteOrigin("https://pegana.xyz")).toBe("https://www.pegana.xyz");
    expect(siteOrigin("https://pegana.xyz/")).toBe("https://www.pegana.xyz");
  });
  it("keeps an explicit preview/local origin", () => {
    expect(siteOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
