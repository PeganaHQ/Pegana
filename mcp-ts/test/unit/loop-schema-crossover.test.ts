// Sub-C MCP outputSchema contract.
//
// get_loop_exposure and simulate_depeg_impact return the raw api body as
// `structuredContent`, which the MCP SDK validates against the tool's
// `outputSchema`. The api serves the unified field names (positions,
// advisory_note, updated_at); these tests pin that the current api shape
// validates, and that the pre-reshape shape (model_note / positions_affected /
// as_of) is now correctly rejected — the required renamed keys would be missing.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getLoopExposureTool } from "@/tools/get-loop-exposure";
import { simulateDepegTool } from "@/tools/simulate-depeg";

describe("MCP Sub-C outputSchema — unified field names", () => {
  it("get_loop_exposure validates the current api shape, rejects the old one", () => {
    const schema = z.object(getLoopExposureTool.outputSchema);

    const current = {
      asset: "vSOL",
      loop_exposure_usd: "1000000.00",
      debt_usd: "500000.00",
      coverage: "partial",
      by_protocol: [
        { protocol: "kamino", coverage: "partial", positions: "5-20" },
      ],
      updated_at: "2026-07-24T00:00:00.000Z",
      advisory_note: "advisory model estimate — not a verifiable receipt",
    };
    const legacy = {
      asset: "vSOL",
      loop_exposure_usd: "1000000.00",
      debt_usd: "500000.00",
      coverage: "partial",
      by_protocol: [{ protocol: "kamino", coverage: "partial", position_bucket: "5-20" }],
      as_of: "2026-07-24T00:00:00.000Z",
      model_note: "advisory model estimate — not a verifiable receipt",
    };

    const c = schema.safeParse(current);
    expect(c.success).toBe(true);
    expect(c.data?.advisory_note).toBe(current.advisory_note);
    expect(c.data?.updated_at).toBe(current.updated_at);
    expect(c.data?.by_protocol[0]?.positions).toBe("5-20");
    // The pre-reshape body lacks the required `advisory_note` → rejected.
    expect(schema.safeParse(legacy).success).toBe(false);
  });

  it("get_loop_exposure keeps cascade_coverage and rejects unknown enum values", () => {
    const schema = z.object(getLoopExposureTool.outputSchema);
    const base = {
      asset: "vSOL",
      loop_exposure_usd: "1000000.00",
      debt_usd: "500000.00",
      coverage: "partial",
      by_protocol: [],
      advisory_note: "advisory model estimate — not a verifiable receipt",
    };
    for (const cc of ["partial", "unknown"]) {
      const r = schema.safeParse({ ...base, cascade_coverage: cc });
      expect(r.success).toBe(true);
      expect(r.data?.cascade_coverage).toBe(cc);
    }
    expect(schema.safeParse({ ...base, cascade_coverage: "full" }).success).toBe(false);
    // Older API builds do not send it.
    expect(schema.safeParse(base).success).toBe(true);
  });

  it("get_loop_exposure description no longer promises coverage: full", () => {
    expect(getLoopExposureTool.description).not.toMatch(/full\|partial\|unknown/);
    expect(getLoopExposureTool.description).toContain("cascade_coverage");
  });

  it("simulate_depeg_impact validates the current api shape, rejects the old one", () => {
    const schema = z.object(simulateDepegTool.outputSchema);

    const current = {
      asset: "hyUSD",
      shock_bps: 500,
      loop_exposure_usd: "1000000.00",
      liquidatable_usd: "250000.00",
      positions: "5-20",
      coverage: "partial",
      by_protocol: [{ protocol: "kamino", liquidatable_usd: "250000.00", positions: "5-20" }],
      advisory_note: "advisory model estimate — not a verifiable receipt",
      updated_at: "2026-07-24T00:00:00.000Z",
    };
    const legacy = {
      asset: "hyUSD",
      shock_bps: 500,
      loop_exposure_usd: "1000000.00",
      liquidatable_usd: "250000.00",
      positions_affected: "5-20",
      coverage: "partial",
      by_protocol: [{ protocol: "kamino", liquidatable_usd: "250000.00", positions_affected: "5-20" }],
      model_note: "advisory model estimate — not a verifiable receipt",
      as_of: "2026-07-24T00:00:00.000Z",
    };

    const c = schema.safeParse(current);
    expect(c.success).toBe(true);
    expect(c.data?.positions).toBe("5-20");
    expect(c.data?.advisory_note).toBe(current.advisory_note);
    expect(c.data?.by_protocol[0]?.positions).toBe("5-20");
    // The pre-reshape body lacks the required `positions`/`advisory_note` → rejected.
    expect(schema.safeParse(legacy).success).toBe(false);
  });
});
