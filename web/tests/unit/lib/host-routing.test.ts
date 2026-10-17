import { describe, expect, it } from "vitest";
import {
  CONSOLE_HOST,
  CONSOLE_PREFIXES,
  isConsolePath,
  isSplitDisabledHost,
  normalizeHost,
  routeRequest,
} from "@/lib/routing/host-routing";

const WWW = "www.pegana.xyz";
const APEX = "pegana.xyz";
const APP = CONSOLE_HOST;

describe("normalizeHost", () => {
  it("lower-cases and strips the port", () => {
    expect(normalizeHost("WWW.Pegana.xyz:443")).toBe("www.pegana.xyz");
  });

  it("handles an empty header", () => {
    expect(normalizeHost("")).toBe("");
  });
});

describe("isConsolePath", () => {
  it("matches every configured console prefix", () => {
    for (const p of CONSOLE_PREFIXES) expect(isConsolePath(p)).toBe(true);
  });

  it("matches nested console paths", () => {
    expect(isConsolePath("/assets/USDC")).toBe(true);
    expect(isConsolePath("/dashboard/x")).toBe(true);
  });

  it("does NOT match the singular /asset detail route", () => {
    expect(isConsolePath("/asset/USDC")).toBe(false);
    expect(isConsolePath("/asset")).toBe(false);
  });

  it("does not match a prefix that is only a string prefix", () => {
    expect(isConsolePath("/dashboardx")).toBe(false);
    expect(isConsolePath("/assetsx")).toBe(false);
  });
});

describe("isSplitDisabledHost", () => {
  it("is true for localhost, loopback and Vercel previews", () => {
    for (const h of [
      "localhost:3000",
      "localhost",
      "127.0.0.1:3000",
      "0.0.0.0",
      "pegana-git-main.vercel.app",
      "pegana-abc123.vercel.app",
    ]) {
      expect(isSplitDisabledHost(h), h).toBe(true);
    }
  });

  it("is false for the real hosts", () => {
    for (const h of [WWW, APEX, APP, "releases.pegana.xyz"]) {
      expect(isSplitDisabledHost(h), h).toBe(false);
    }
  });
});

describe("routeRequest", () => {
  it("serves every path on www, indexable", () => {
    for (const p of ["/", "/lst", "/dashboard", "/assets", "/events"]) {
      expect(routeRequest(WWW), p).toEqual({ kind: "serve", noindex: false });
    }
  });

  it("serves console paths on www too — they are public now", () => {
    // The old split redirected these to app.pegana.xyz. Pegana is fully open,
    // so they are ordinary public pages and must never redirect.
    for (const p of CONSOLE_PREFIXES) {
      expect(routeRequest(WWW), p).toEqual({ kind: "serve", noindex: false });
    }
  });

  it("serves everything on the app host but marks it noindex", () => {
    for (const p of ["/", "/dashboard", "/lst", "/assets"]) {
      expect(routeRequest(APP), p).toEqual({ kind: "serve", noindex: true });
    }
  });

  it("never marks a preview or localhost noindex", () => {
    for (const h of ["pegana-abc.vercel.app", "localhost:3000"]) {
      expect(routeRequest(h), h).toEqual({ kind: "serve", noindex: false });
    }
  });

  it("leaves the apex and unrelated hosts indexable", () => {
    for (const h of [APEX, "releases.pegana.xyz", "example.com", ""]) {
      expect(routeRequest(h), h).toEqual({ kind: "serve", noindex: false });
    }
  });

  it("never returns a redirect for any host", () => {
    for (const h of [WWW, APEX, APP, "localhost:3000", "example.com"]) {
      expect(routeRequest(h).kind).toBe("serve");
    }
  });
});
