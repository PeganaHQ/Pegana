import { describe, it, expect } from "vitest";
import { getAssetsTool } from "@/tools/get-assets";

describe("get_assets", () => {
  it("returns structuredContent with assets array + count", async () => {
    const res = await getAssetsTool.handler();
    expect(res.content).toBeInstanceOf(Array);
    expect(res.content[0]?.type).toBe("text");
    expect(res.structuredContent).toBeDefined();
    expect(Array.isArray(res.structuredContent.assets)).toBe(true);
    expect(res.structuredContent.count).toBe(res.structuredContent.assets.length);
  });

  it("content[0].text mirrors structuredContent as JSON", async () => {
    const res = await getAssetsTool.handler();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(Array.isArray(parsed.assets)).toBe(true);
    expect(typeof parsed.count).toBe("number");
  });
});
