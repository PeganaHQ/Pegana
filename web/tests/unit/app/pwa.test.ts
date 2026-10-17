import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import nextConfig from "../../../next.config";

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SW = readFileSync(join(WEB_ROOT, "public", "sw.js"), "utf8");

describe("web app manifest", () => {
  const m = manifest();

  it("its colours match the CSS canvas token", () => {
    // The manifest is parsed by the OS before any stylesheet exists, so it
    // cannot read `var(--color-canvas)` and has to carry a literal. This is the
    // check that keeps the PWA splash screen and the mobile browser chrome from
    // quietly drifting away from the app background the first time the canvas
    // is repainted.
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    const token = /--color-canvas:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(token).toBeTruthy();
    expect(m.background_color?.toLowerCase()).toBe(token!.toLowerCase());
    expect(m.theme_color?.toLowerCase()).toBe(token!.toLowerCase());
  });

  it("opens the console, not the marketing landing", () => {
    // An installed app whose icon lands you on a page selling the product you
    // already installed is the single most common PWA mistake.
    expect(m.start_url).toMatch(/^\/dashboard/);
    expect(m.scope).toBe("/");
  });

  it("carries a stable id so a scope change does not orphan the install", () => {
    expect(m.id).toBeTruthy();
  });

  it("degrades through display_override rather than failing to install", () => {
    expect(m.display).toBe("standalone");
    expect(m.display_override?.[0]).toBe("standalone");
    expect(m.display_override).toContain("browser");
  });

  it("ships a maskable icon, or Android crops the logo into a circle", () => {
    const maskable = m.icons?.filter((i) => i.purpose === "maskable") ?? [];
    expect(maskable.length).toBeGreaterThan(0);
    expect(maskable[0].sizes).toBe("512x512");
  });

  it("every shortcut points somewhere inside scope", () => {
    expect(m.shortcuts?.length).toBeGreaterThan(0);
    for (const s of m.shortcuts ?? []) {
      expect(s.url.startsWith("/")).toBe(true);
      expect(s.name).toBeTruthy();
    }
  });
});

describe("the old manifest path still resolves", () => {
  it("redirects /site.webmanifest to the metadata route", async () => {
    // Existing installs have the old URL baked in and would otherwise 404 on
    // the next manifest refresh.
    const redirects = await nextConfig.redirects!();
    const hit = redirects.find((r) => r.source === "/site.webmanifest");
    expect(hit?.destination).toBe("/manifest.webmanifest");
    expect(hit?.permanent).toBe(false);
  });
});

describe("service worker", () => {
  /**
   * This is the test that matters. Pegana's entire purpose is telling you an
   * asset has moved off its peg. A cached peg state served offline is
   * indistinguishable from a live one, so it would fail silently and
   * confidently, which is worse than not answering at all.
   */
  it("never caches peg data", () => {
    for (const prefix of ['"/v1/"', '"/api/"', '"/monitoring"', '"/auth/"']) {
      expect(SW).toContain(prefix);
    }
    // The bail happens before any respondWith, so those paths reach the
    // network untouched rather than being conditionally cached.
    expect(SW).toContain(
      "if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;",
    );
  });

  it("serves documents network-first, never cache-first", () => {
    // Cache-first HTML is how one bad deploy pins a stale document users
    // cannot clear.
    const nav = SW.slice(SW.indexOf('request.mode === "navigate"'));
    const firstFetch = nav.indexOf("fetch(request)");
    const firstCacheMatch = nav.indexOf("caches\n          .match");
    expect(firstFetch).toBeGreaterThan(-1);
    expect(firstFetch).toBeLessThan(firstCacheMatch);
  });

  it("does NOT try to kill itself from inside the worker", () => {
    // It used to. Verified in a real browser, the net effect was zero: the
    // handler unregistered, cleared caches and navigated open clients, then
    // the registrar ran on the fresh load and the worker was back within two
    // seconds. A kill switch the next page load silently undoes is worse than
    // none, because it reads as working. A service worker cannot write
    // localStorage, so it can never own a decision that has to outlive a
    // reload.
    expect(SW).not.toContain("PEGANA_SW_KILL");
    expect(SW).not.toContain("registration.unregister");
  });

  it("does not register unless explicitly enabled", () => {
    // Flipped to opt-in after production was reported broken while every
    // measurement said otherwise. A service worker is the only stateful piece
    // of that deploy and the only one whose behaviour can differ per browser in
    // a way that cannot be observed remotely; it buys an offline page and a
    // warm static cache on a product whose value is live data. With
    // registration off, the teardown path runs for anyone who already has it.
    const registrar = readFileSync(
      join(WEB_ROOT, "components", "atoms", "service-worker.tsx"),
      "utf8",
    );
    expect(registrar).toContain('process.env.NEXT_PUBLIC_ENABLE_SW === "1"');
    expect(registrar).toMatch(/if \(!enabled \|\|/);
    // And the disabled branch must tear down, not merely skip.
    expect(registrar).toMatch(/if \(!enabled[\s\S]{0,120}teardown\(\)/);
  });

  it("the kill switch lives on the page, where it can persist", () => {
    const registrar = readFileSync(
      join(WEB_ROOT, "components", "atoms", "service-worker.tsx"),
      "utf8",
    );
    // Sets a flag, tears down, and — the part that was missing — is CHECKED
    // before re-registering on every subsequent load.
    expect(registrar).toContain("killServiceWorker");
    expect(registrar).toContain("pegana:sw_killed");
    expect(registrar).toMatch(
      /NEXT_PUBLIC_DISABLE_SW === "1" \|\| killed\(\)/,
    );
    expect(registrar).toContain("reviveServiceWorker");
  });

  it("cleans up caches from previous versions on activate", () => {
    expect(SW).toContain("caches.delete");
    expect(SW).toContain("self.clients.claim()");
  });

  it("only caches same-origin GETs", () => {
    expect(SW).toContain('if (request.method !== "GET") return;');
    expect(SW).toContain("if (url.origin !== self.location.origin) return;");
  });
});
