import { describe, expect, it } from "vitest";
import { filterSources } from "../src/core/source-filter";

const mk = (name: string) => ({ name, intervalMs: 1, poll: async () => 0 });
const all = [mk("kamino"), mk("jupiter_lend"), mk("kamino_hf"), mk("jupiter_lend_hf")];

describe("filterSources", () => {
  it("keeps everything when unset/empty", () => {
    expect(filterSources(all, undefined)).toHaveLength(4);
    expect(filterSources(all, " , ")).toHaveLength(4);
  });
  it("restricts to the allowlist", () => {
    expect(filterSources(all, "kamino_hf, jupiter_lend_hf").map((s) => s.name)).toEqual([
      "kamino_hf",
      "jupiter_lend_hf",
    ]);
  });
});
