import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * History: guarded the /status delivery row against BOTH of its failure modes.
 * The row itself is gone now (webhooks were removed); the UNKNOWN ladder
 * guard still applies to every remaining row.
 *
 * 1. False GREEN — the original bug: `deliveryState` was PEGGED whenever
 *    `failed_24h === 0`, regardless of `sent_24h`. With 3 alerts fired and 0
 *    delivered, the page reported "Operational".
 *
 * 2. False RED — the bug the FIX introduced: once 0/0 correctly yielded
 *    UNKNOWN, `SourceRowV2`'s label/colour ladders had no UNKNOWN branch, so it
 *    fell through to "Major outage" + the critical colour. Live production then
 *    painted a red permanent outage beside "no deliveries to report (24h)".
 *    Strictly worse than the false green, because 0/0 is the steady state and
 *    it never self-heals.
 *
 * Both directions are asserted because fixing one caused the other.
 */

const SRC = readFileSync(
  join(process.cwd(), "app", "(marketing)", "status", "page.tsx"),
  "utf8",
);

describe("status source rows", () => {
  it("no longer lists an Alert delivery row (webhook delivery was removed)", () => {
    // delivery_health counts a channel with no subscribers: it can only ever
    // read 0 sent / 0 failed, so the row reported nothing real.
    expect(SRC).not.toContain('name="Alert delivery"');
    expect(SRC).not.toContain("webhook dispatch");
  });

  it("has an explicit UNKNOWN branch in BOTH the label and colour ladders", () => {
    const block = SRC.slice(
      SRC.indexOf("const label ="),
      SRC.indexOf("return ("),
    );
    // Without these, UNKNOWN falls through to the terminal else — which is
    // "Major outage" / --v2-crit.
    expect(block).toMatch(/state === "UNKNOWN"[\s\S]*?"No data"/);
    expect(block).toMatch(/state === "UNKNOWN"[\s\S]*?var\(--v2-unk\)/);
  });
});
