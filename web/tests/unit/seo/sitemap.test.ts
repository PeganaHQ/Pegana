import { describe, expect, it, vi, beforeEach } from "vitest";
import sitemap from "@/app/sitemap";

// The www sitemap must describe ONLY the www host. Console routes live on
// app.pegana.xyz and 308 away from www (docs/strategy/2026-10-17-www-app-split.md),
// so listing them would advertise redirects — the crawl-budget defect the
// sitemap's own comments call out. This pins that they stay out.

// The two API fetches fail closed to [] in a test env; stub fetch so no real
// network call is attempted and the static page list is deterministic.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
  );
});

async function urls(): Promise<string[]> {
  const entries = await sitemap();
  return entries.map((e) => e.url);
}

const CONSOLE_PATHS = [
  "/dashboard",
  "/assets",
  "/events",
  "/compare",
  "/systemic",
] as const;

describe("www sitemap", () => {
  it("lists the product surfaces — they are public now", async () => {
    const all = await urls();
    for (const p of CONSOLE_PATHS) {
      expect(all, `${p} should be listed`).toContain(
        `https://www.pegana.xyz${p}`,
      );
    }
  });

  it("still lists the marketing pages", async () => {
    const all = await urls();
    for (const p of [
      "/",
      "/status",
      "/status/calibration",
      "/lst",
      "/about",
      "/methodology",
      "/audit",
      "/agents",
      "/embed",
      "/whats-new",
      "/privacy",
      "/terms",
      "/backtest",
      "/releases",
      "/embed/demo",
      "/faq",
    ]) {
      expect(all, `${p} should still be listed`).toContain(
        `https://www.pegana.xyz${p}`,
      );
    }
  });

  it("keeps /live out (it is a 308 stub to /events)", async () => {
    expect(await urls()).not.toContain("https://www.pegana.xyz/live");
  });

  it("keeps the per-asset /asset detail pages on www", async () => {
    // /asset/{symbol} detail pages are public. Stub the API with real data so
    // the asset pages are actually emitted — otherwise this would pass
    // vacuously on an empty asset list (the fail-closed default).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/v1/assets")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ symbol: "USDC" }, { symbol: "JitoSOL" }] }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }),
    );

    const all = await urls();
    expect(all).toContain("https://www.pegana.xyz/asset/USDC");
    expect(all).toContain("https://www.pegana.xyz/asset/JitoSOL");
    // The screener is a first-class public page too.
    expect(all).toContain("https://www.pegana.xyz/assets");
  });

  it("every entry is on the www origin", async () => {
    for (const u of await urls()) {
      expect(new URL(u).origin).toBe("https://www.pegana.xyz");
    }
  });
});
