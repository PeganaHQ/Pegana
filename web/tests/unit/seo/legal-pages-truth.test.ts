import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The terms and privacy pages make factual claims about the license and the
// processors. Both were wrong in production on 2026-10-21 (terms called the
// platform closed source; privacy named Hetzner and promised 30-day backups
// that do not run). These pin the corrected facts.
const read = (rel: string) =>
  readFileSync(join(__dirname, "..", "..", "..", rel), "utf8");

describe("terms", () => {
  const src = read("app/(marketing)/terms/page.tsx");
  it("states the whole platform is MIT open source", () => {
    expect(src).not.toMatch(/is not open source/);
    expect(src).not.toMatch(/not available for self-hosting/);
    expect(src).toContain("https://github.com/PeganaHQ/Pegana");
    expect(src).toContain("MIT license");
  });
  it("states the real public limits", () => {
    expect(src).toContain("60 REST requests a minute");
    expect(src).toMatch(/20\s+open WebSocket connections per IP/);
  });
});

describe("privacy", () => {
  const src = read("app/(marketing)/privacy/page.tsx");
  it("names the real backend host and no stale one", () => {
    expect(src).toContain("Hostinger");
    expect(src).not.toMatch(/Hetzner/);
  });
  it("discloses browser error telemetry and does not promise backups that do not run", () => {
    expect(src).not.toMatch(/Sentry receives backend error telemetry only/);
    expect(src).not.toMatch(/Backups are retained for 30 days/);
    expect(src).toContain("planned but not");
  });
  it("does not claim a 30-day server log retention", () => {
    expect(src).not.toMatch(/retained for 30 days/);
  });
});
