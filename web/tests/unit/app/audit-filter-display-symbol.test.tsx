import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/app/fonts/v2-fonts", () => ({
  switzerV2: { variable: "" },
  geistMonoV2: { variable: "" },
}));

afterEach(() => vi.unstubAllGlobals());

async function renderAudit(asset: string) {
  const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { default: AuditIndexPage } = await import("@/app/(marketing)/audit/page");
  const el = await AuditIndexPage({ searchParams: Promise.resolve({ asset }) });
  return { html: renderToString(el), fetchMock };
}

describe("/audit asset filter header uses the display symbol", () => {
  it.each(["sHYUSD", "eHYUSD"])(
    "?asset=%s prints eHYUSD in the header and queries sHYUSD",
    async (asset) => {
      const { html, fetchMock } = await renderAudit(asset);
      expect(html).toContain("eHYUSD");
      expect(html).not.toMatch(/Verifiable alerts for <b[^>]*>sHYUSD/);
      expect(html).not.toContain("rows for sHYUSD");
      const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
      expect(urls.some((u) => u.includes("/v1/audit?") && u.includes("asset=sHYUSD"))).toBe(true);
    },
  );
});
