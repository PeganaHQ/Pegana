/**
 * Tests for GET /embed.js — script-based embed loader.
 *
 * Covers:
 * - Content-Type: application/javascript
 * - Does NOT set Content-Security-Policy: frame-ancestors (it's a script, not a frame)
 * - Sets Access-Control-Allow-Origin: * (CORS for partner sites)
 * - Script body is non-empty and contains the Pegana embed logic
 */
import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /embed.js, Content-Type + headers", () => {
  it("returns 200 with Content-Type: application/javascript", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
  });

  it("sets Access-Control-Allow-Origin: * for CORS", async () => {
    const res = await GET();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("body contains the pegana embed bootstrap logic", async () => {
    const res = await GET();
    const body = await res.text();
    // Must contain the IIFE bootstrap and key identifiers
    expect(body).toContain("pegana");
    expect(body).toContain("data-asset");
    expect(body).toContain("/v1/assets/");
  });

  it("body does not contain frame-ancestors (not a framed resource)", async () => {
    const res = await GET();
    // embed.js is loaded as a <script>, not in a frame — no frame-ancestors header needed
    // The script itself must not embed a broken CSP directive
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });
});
