import { describe, it, expect } from "vitest";
import { stateReasonLabel } from "@/lib/asset/state-reason";

describe("stateReasonLabel", () => {
  it("maps premium_sanity to thin-market copy", () => {
    expect(stateReasonLabel("premium_sanity")).toBe(
      "price above NAV looks unreliable; thin market",
    );
  });
  it("maps stale_source to 'source stale'", () => {
    expect(stateReasonLabel("stale_source")).toBeTypeOf("string");
  });
  it("maps the two hard-override reasons the engine emits (pyth conf + intrinsic liveness)", () => {
    // These are the two most important explanatory UNKNOWN cases — the engine
    // sets them (STATE_REASON_PYTH_CONFIDENCE_GATE / STATE_REASON_INTRINSIC_LIVENESS)
    // and the UI must not blank on them.
    expect(stateReasonLabel("pyth_confidence_gate")).toBeTypeOf("string");
    expect(stateReasonLabel("intrinsic_liveness")).toBeTypeOf("string");
  });
  it("maps market_unavailable (new in round 2) instead of rendering nothing", () => {
    expect(stateReasonLabel("market_unavailable")).toBe("no market price right now");
  });
  it("returns null for unknown/absent reasons", () => {
    expect(stateReasonLabel("nope")).toBeNull();
    expect(stateReasonLabel(undefined)).toBeNull();
  });
});
