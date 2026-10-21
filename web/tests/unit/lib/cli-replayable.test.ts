import { describe, it, expect } from "vitest";
import { isCliReplayable } from "@/lib/audit/cli-replayable";

describe("isCliReplayable", () => {
  it("is false for receipts older than methodology 0.4.0", () => {
    expect(isCliReplayable("0.1.0")).toBe(false);
    expect(isCliReplayable("0.2.0")).toBe(false);
    expect(isCliReplayable("0.3.9")).toBe(false);
  });
  it("is true from 0.4.0 onward, comparing numerically", () => {
    expect(isCliReplayable("0.4.0")).toBe(true);
    expect(isCliReplayable("0.6.1")).toBe(true);
    expect(isCliReplayable("0.10.0")).toBe(true);
    expect(isCliReplayable("1.0.0")).toBe(true);
    expect(isCliReplayable("v0.7.0")).toBe(true);
  });
  it("never promises a replay for a missing or unparseable version", () => {
    expect(isCliReplayable(undefined)).toBe(false);
    expect(isCliReplayable("")).toBe(false);
    expect(isCliReplayable("latest")).toBe(false);
  });
});
