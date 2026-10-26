import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_DEFINITIONS } from "@/server";

// R1 audit idx 84: descriptions still alluded to paid tools / pricing
// ("10x cheaper than paid tools", "that path is cheaper", "the free
// get_asset_state"). Every tool is free; the copy must not suggest a paid
// tier. Also no em-dashes in user-facing copy (repo rule).

function allText(tool: (typeof TOOL_DEFINITIONS)[number]): string {
  const parts = [tool.description, tool.annotations.title];
  for (const shape of [tool.inputSchema, tool.outputSchema]) {
    for (const v of Object.values(shape)) {
      const d = (v as z.ZodTypeAny).description;
      if (d) parts.push(d);
    }
  }
  return parts.join("\n");
}

describe("tool descriptions", () => {
  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s has no pricing / paid-tier wording and no em-dash",
    (_name, tool) => {
      // `paid pong` is ping_paid's documented compatibility reply.
      const text = allText(tool).replace(/paid pong|ping_paid/g, "");
      expect(text).not.toMatch(/pricing|cheaper|\bpaid\b|x402|\$0\.|the free `/i);
      expect(text).not.toContain("—");
    },
  );
});

// R2 audit idx 20: liquidatable_usd is the TOTAL collateral of the bands that
// cross liquidation (api-rs liquidatable_at_shock sums band collateral_usd),
// not leveraged collateral, so it routinely exceeds loop_exposure_usd.
describe("simulate_depeg_impact description", () => {
  it("describes liquidatable_usd as total band collateral, not leveraged collateral", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "simulate_depeg_impact")!;
    expect(tool.description).not.toMatch(/liquidatable_usd` = leveraged collateral/);
    expect(tool.description).toMatch(/TOTAL collateral/);
    expect(tool.description).toMatch(/can exceed/);
  });
});

// R3 audit R3-MCP-05: verify_alert only fetches the receipt as served; it
// recomputes no hash. The copy must say so and point to pegana-replay.
describe("verify_alert description", () => {
  it("does not present a fetch as cryptographic verification", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "verify_alert")!;
    expect(tool.description).toMatch(/does NOT verify the receipt/);
    expect(tool.description).toMatch(/recomputes no hash/);
    expect(tool.description).toContain("pegana-replay");
    expect(tool.description).not.toMatch(/cryptographic/i);
    expect(tool.description).not.toMatch(/to verify a specific alert/);
  });
});
