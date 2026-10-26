import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPct, renderPeg } from "./consumer.mjs";

test("discount sign follows intrinsic minus market", () => {
  assert.equal(formatPct("0.000153"), "-0.02%");
  assert.equal(formatPct("-0.006895"), "+0.69%");
  assert.equal(formatPct("0"), "0.00%");
  assert.equal(renderPeg({ state: "PEGGED", discount: "0.000153", anchor: "USD" }).label,
    "Pegged · -0.02% from $1");
});
