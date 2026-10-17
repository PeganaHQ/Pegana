/**
 * Tests for the site-wide /llms.txt and /llms-full.txt route handlers.
 *
 * Covers:
 * - 200 + Content-Type: text/plain for both.
 * - /llms.txt is the llmstxt.org shape (H1 + blockquote summary + sections).
 * - Completeness: EVERY canonical page in lib/llms/pages.ts appears in both
 *   files (as an absolute URL) — the whole point of the site-wide index.
 * - /llms-full.txt carries the extended context + the dynamic-pages pointer.
 */
import { describe, it, expect } from "vitest";
import { GET as getIndex } from "./route";
import { GET as getFull } from "../llms-full.txt/route";
import { absUrl, allHrefs, LLMS_SECTIONS } from "@/lib/llms/pages";

describe("GET /llms.txt, site-wide index", () => {
  it("returns 200 text/plain", async () => {
    const res = await getIndex();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("has the llmstxt.org shape (H1 + blockquote summary)", async () => {
    const body = await (await getIndex()).text();
    expect(body.startsWith("# Pegana")).toBe(true);
    expect(body).toContain("\n> The peg-risk oracle for Solana.");
  });

  it("lists every canonical page (as an absolute URL) and every section", async () => {
    const body = await (await getIndex()).text();
    for (const href of allHrefs()) {
      expect(body, `missing page: ${href}`).toContain(absUrl(href));
    }
    for (const s of LLMS_SECTIONS) {
      expect(body, `missing section: ${s.heading}`).toContain(`## ${s.heading}`);
    }
  });
});

describe("GET /llms-full.txt, expanded context", () => {
  it("returns 200 text/plain", async () => {
    const res = await getFull();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("carries the extended pipeline context + dynamic-pages pointer", async () => {
    const body = await (await getFull()).text();
    expect(body).toContain("# Pegana: full context");
    expect(body).toContain("intrinsic − market = discount");
    expect(body).toContain("/sitemap.xml");
    expect(body).toContain("/v1/assets");
  });

  it("also lists every canonical page", async () => {
    const body = await (await getFull()).text();
    for (const href of allHrefs()) {
      expect(body, `missing page: ${href}`).toContain(absUrl(href));
    }
  });
});
