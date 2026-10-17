import { describe, expect, it } from "vitest";
import config from "./vercel.json";

const DOCS_ORIGIN = "https://docs.pegana.xyz";

describe("Vercel docs-domain redirects", () => {
  it("does not proxy Mintlify under /docs", () => {
    expect("rewrites" in config).toBe(false);
  });

  it("permanently redirects exact and nested /docs paths", () => {
    expect(config.redirects.slice(0, 2)).toEqual([
      {
        source: "/docs",
        destination: DOCS_ORIGIN,
        permanent: true,
      },
      {
        source: "/docs/:match*",
        destination: `${DOCS_ORIGIN}/:match*`,
        permanent: true,
      },
    ]);
  });

  it("evaluates docs redirects before the apex-to-www catch-all", () => {
    expect(config.redirects[2]).toMatchObject({
      source: "/:path*",
      destination: "https://www.pegana.xyz/:path*",
      permanent: true,
    });
  });
});
