import { describe, expect, it } from "vitest";
import {
  classifyIntrinsicDegraded,
  type LstLivenessFlags,
} from "@/lib/asset/intrinsic-degraded";

const flags = (o: Partial<LstLivenessFlags>): LstLivenessFlags => ({
  stale: false,
  deprecated: false,
  dead: false,
  ...o,
});

describe("classifyIntrinsicDegraded", () => {
  it("returns null for a healthy backing (all flags false)", () => {
    expect(classifyIntrinsicDegraded(flags({}))).toBeNull();
  });

  it("returns null for null/undefined flags", () => {
    expect(classifyIntrinsicDegraded(null)).toBeNull();
    expect(classifyIntrinsicDegraded(undefined)).toBeNull();
  });

  it("fires backing_stale on a stale rate", () => {
    expect(classifyIntrinsicDegraded(flags({ stale: true }))).toEqual({
      reason: "backing_stale",
    });
  });

  it("fires backing_deprecated on a deprecated LST", () => {
    expect(classifyIntrinsicDegraded(flags({ deprecated: true }))).toEqual({
      reason: "backing_deprecated",
    });
  });

  it("fires backing_dead on a dead pool", () => {
    expect(classifyIntrinsicDegraded(flags({ dead: true }))).toEqual({
      reason: "backing_dead",
    });
  });

  it("ranks worst-first: dead > deprecated > stale", () => {
    // All three set → dead wins.
    expect(
      classifyIntrinsicDegraded(
        flags({ dead: true, deprecated: true, stale: true }),
      ),
    ).toEqual({ reason: "backing_dead" });
    // deprecated + stale → deprecated wins.
    expect(
      classifyIntrinsicDegraded(flags({ deprecated: true, stale: true })),
    ).toEqual({ reason: "backing_deprecated" });
  });
});
