// @vitest-environment node
/**
 * The web server's rate-limit bypass header must be sent from server code
 * only, and only when the server-only secret is configured.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { serverApiHeaders, SSR_TOKEN_HEADER } from "./base";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("serverApiHeaders", () => {
  it("sends the token on the server when PEGANA_WEB_SSR_TOKEN is set", () => {
    vi.stubEnv("PEGANA_WEB_SSR_TOKEN", "t".repeat(64));
    expect(serverApiHeaders()).toEqual({ [SSR_TOKEN_HEADER]: "t".repeat(64) });
  });

  it("sends nothing when the token is unset or empty", () => {
    vi.stubEnv("PEGANA_WEB_SSR_TOKEN", "");
    expect(serverApiHeaders()).toEqual({});
  });

  it("never sends the token from a browser context", () => {
    vi.stubEnv("PEGANA_WEB_SSR_TOKEN", "t".repeat(64));
    vi.stubGlobal("window", {});
    expect(serverApiHeaders()).toEqual({});
  });
});
