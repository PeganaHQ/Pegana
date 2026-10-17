import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/app/api/token-logo/route";

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("sniffImageType", () => {
  it("recognises the raster formats by signature", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe(
      "image/png",
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    // RIFF????WEBP
    expect(
      sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe("image/webp");
  });

  it("recognises SVG, including with an XML prolog or BOM", () => {
    expect(sniffImageType(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      "image/svg+xml",
    );
    expect(
      sniffImageType(utf8('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>')),
    ).toBe("image/svg+xml");
    expect(sniffImageType(utf8('﻿  <svg />'))).toBe("image/svg+xml");
  });

  /**
   * The attack this exists to stop: an upstream CDN serving an HTML payload
   * under `Content-Type: image/png`. The old code trusted the header and
   * relayed those bytes under pegana.xyz's own origin.
   */
  it("rejects HTML masquerading as an image", () => {
    expect(sniffImageType(utf8("<!DOCTYPE html><html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(utf8("<html><body>not an image</body></html>"))).toBeNull();
  });

  it("rejects arbitrary and truncated payloads", () => {
    expect(sniffImageType(utf8("{\"error\":\"not found\"}"))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
    // A PNG signature cut short must not pass.
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    // RIFF container that is not WEBP (e.g. a WAV) must not pass.
    expect(
      sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45),
      ),
    ).toBeNull();
  });

  it("does not scan unbounded input for the SVG marker", () => {
    // `<svg` beyond the 1KB prefix must NOT be treated as an SVG, otherwise a
    // large HTML document with a nested inline SVG would be relayed as an image.
    const payload = utf8("A".repeat(2048) + "<svg />");
    expect(sniffImageType(payload)).toBeNull();
  });
});
