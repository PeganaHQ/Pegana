import { describe, expect, it } from "vitest";
import { advisoryNoteText, cascadeShare } from "@/lib/asset/loop-impact";

describe("cascadeShare", () => {
  it("is the liquidatable share of the collateral base", () => {
    expect(cascadeShare(60_859_160, 112_286_376)).toBeCloseTo(0.542, 3);
  });
  it("never exceeds 100%: a figure above its base has no share", () => {
    expect(cascadeShare(60_859_160, 21_806_342)).toBeNull();
  });
  it("is null without a usable base", () => {
    expect(cascadeShare(1, 0)).toBeNull();
    expect(cascadeShare(1, Number.NaN)).toBeNull();
  });
});

describe("advisoryNoteText", () => {
  it("replaces the em-dash", () => {
    expect(advisoryNoteText("a \u2014 b")).toBe("a: b");
    expect(advisoryNoteText(undefined)).toBe("");
  });
});
