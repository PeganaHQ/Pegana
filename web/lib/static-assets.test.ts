import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STATIC_BASE,
  partnerLogoUrl,
  staticBase,
  staticOrigin,
  tokenIconUrl,
} from "./static-assets";

const MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("staticBase", () => {
  it("defaults to the API box when the env is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", undefined);
    expect(staticBase()).toBe("https://api.pegana.xyz/static");
    expect(DEFAULT_STATIC_BASE).toBe("https://api.pegana.xyz/static");
  });

  it("treats an empty or blank env as unset (Vercel can inline an empty string)", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "");
    expect(staticBase()).toBe(DEFAULT_STATIC_BASE);
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "   ");
    expect(staticBase()).toBe(DEFAULT_STATIC_BASE);
  });

  it("uses an explicit https base and strips trailing slashes", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "https://staging.example.com/static//");
    expect(staticBase()).toBe("https://staging.example.com/static");
  });

  it("accepts a plain http base for local stacks", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "http://localhost:8081/static");
    expect(staticBase()).toBe("http://localhost:8081/static");
  });

  it("returns '' for '/' so URLs stay root-relative (same-origin rollback)", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "/");
    expect(staticBase()).toBe("");
  });

  it.each(["javascript:alert(1)", "//evil.example", "api.pegana.xyz/static", "https://"])(
    "falls back to the default for a malformed value (%s)",
    (value) => {
      vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", value);
      expect(staticBase()).toBe(DEFAULT_STATIC_BASE);
    },
  );
});

describe("staticBase rejects values that would widen or break the CSP", () => {
  it.each([
    "https://*",
    "https://*.x.com",
    "https://a.com;script-src",
    "https://a.com;script-src 'unsafe-inline'",
    "https://a.com'",
    "https://a.com\"",
    "https://a.com%20https://b.com",
  ])("falls back to the default for %s", (value) => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", value);
    expect(staticBase()).toBe(DEFAULT_STATIC_BASE);
    expect(staticOrigin()).toBe("https://api.pegana.xyz");
  });
});

describe("staticOrigin", () => {
  it("is the API origin by default", () => {
    expect(staticOrigin()).toBe("https://api.pegana.xyz");
  });

  it("follows an override", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "https://cdn.example.com:8443/a/b");
    expect(staticOrigin()).toBe("https://cdn.example.com:8443");
  });

  it("is null when the files are same-origin", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "/");
    expect(staticOrigin()).toBeNull();
  });
});

describe("asset URLs", () => {
  it("builds the token icon URL the Caddy /static/ route serves", () => {
    expect(tokenIconUrl(MINT)).toBe(
      `https://api.pegana.xyz/static/tokens/${MINT}.webp`,
    );
  });

  it("builds the partner logo URL", () => {
    expect(partnerLogoUrl("jito")).toBe(
      "https://api.pegana.xyz/static/logos/jito.svg",
    );
  });

  it("stays root-relative under the same-origin override", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "/");
    expect(tokenIconUrl(MINT)).toBe(`/tokens/${MINT}.webp`);
    expect(partnerLogoUrl("jito")).toBe("/logos/jito.svg");
  });

  it("encodes the path segment so a hostile value cannot change the path", () => {
    expect(tokenIconUrl("../x?y")).toBe(
      "https://api.pegana.xyz/static/tokens/..%2Fx%3Fy.webp",
    );
  });

  it("matches the file names the Caddy route allows", () => {
    // Mirrors the path_regexp in the api vhost of the repo Caddyfile.
    const allowed =
      /^\/(tokens\/[A-Za-z0-9]{32,44}\.webp|logos\/[a-z0-9][a-z0-9-]*\.svg)$/;
    const path = (u: string) => new URL(u).pathname.replace(/^\/static/, "");
    expect(path(tokenIconUrl(MINT))).toMatch(allowed);
    expect(path(partnerLogoUrl("jito"))).toMatch(allowed);
  });
});
