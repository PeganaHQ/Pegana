import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  __resetReceiptStateForTests,
  handleSubscribePegEvents,
  subscribePegEventsTool,
} from "@/tools/subscribe-peg-events";

// Regression (R1 audit idx 0/22): `EXTRACT(EPOCH FROM ts)` is NUMERIC on
// PG14+, which node-postgres returns as a STRING. The zod outputSchema wants a
// number, so every call with at least one event failed output validation.
function poolReturning(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    pool: {
      async query<T>(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        return { rows: rows as T[] };
      },
    },
  };
}

const outputSchema = z.object(subscribePegEventsTool.outputSchema).strict();

describe("subscribe_peg_events", () => {
  it("coerces a NUMERIC-as-string ts into a number for events and next_cursor", async () => {
    const { pool } = poolReturning([
      {
        id: "612835d1-c19d-4b00-8a7f-2a23bce18e8a",
        asset: "USDC",
        from_state: "PEGGED",
        to_state: "DRIFT",
        discount: "0.002100",
        ts: "1792500662.543249",
      },
      {
        id: "712835d1-c19d-4b00-8a7f-2a23bce18e8a",
        asset: "USDC",
        from_state: "DRIFT",
        to_state: "BLACKSWAN",
        discount: "0.030000",
        ts: "1792500700.000001",
      },
    ]);
    const res = await handleSubscribePegEvents(
      { symbols: ["USDC"], since_ts: 0 },
      pool,
    );
    const sc = res.structuredContent!;
    expect(sc.count).toBe(2);
    expect(typeof sc.events[0]!.ts).toBe("number");
    expect(sc.events[0]!.ts).toBe(1792500662.543249);
    expect(sc.next_cursor).toBe(1792500700.000001);
    expect(sc.next_cursor_id).toBe("712835d1-c19d-4b00-8a7f-2a23bce18e8a");
    expect(sc.events[1]!.to_state).toBe("BLACK_SWAN");
    expect(sc.events[0]!.discount).toBe("0.0021"); // normalized like REST
    expect(sc.events[0]!.evidence_url).toMatch(
      /\/audit\/612835d1-c19d-4b00-8a7f-2a23bce18e8a$/,
    );
    // Strict parse: no stray keys beyond the declared schema.
    expect(outputSchema.safeParse(sc).success).toBe(true);
  });

  it("casts the epoch to float8 in SQL so pg parses a number", async () => {
    const { pool, calls } = poolReturning([]);
    await handleSubscribePegEvents(
      { symbols: ["USDC"], since_ts: 12.5, threshold_bps: 25 },
      pool,
    );
    expect(calls[0]!.sql).toMatch(/EXTRACT\(EPOCH FROM ts\)::float8 AS ts/);
    // No since_id: the max-uuid sentinel keeps strict-after semantics for
    // ts-only cursors (id > sentinel is never true).
    expect(calls[0]!.params).toEqual([
      ["USDC"], 12.5, 25, "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ]);
    expect(calls[0]!.sql).toMatch(/ts = to_timestamp\(\$2::float8\) AND id > \$4::uuid/);
    // Redundant lower bound so alerts_asset_recent_idx gets an Index Cond.
    expect(calls[0]!.sql).toMatch(/AND ts >= to_timestamp\(\$2::float8\)/);
    expect(calls[0]!.sql).toMatch(/ORDER BY alert_events\.ts ASC, alert_events\.id ASC/);
  });

  it("echoes since_ts as next_cursor on an empty batch", async () => {
    const { pool } = poolReturning([]);
    const res = await handleSubscribePegEvents(
      { symbols: ["USDC"], since_ts: 1792500662.5 },
      pool,
    );
    expect(res.structuredContent).toEqual({
      count: 0,
      next_cursor: 1792500662.5,
      next_cursor_id: null,
      events: [],
    });
  });

  // R2 audit idx 22: some alerts have no persisted receipt, and verify_alert
  // 404s `evidence_missing` for them; each event now says so up front.
  it("reports each event's receipt state from the receipt tables", async () => {
    __resetReceiptStateForTests();
    const base = { asset: "USDC", from_state: "PEGGED", to_state: "DRIFT", discount: "0.002" };
    const { pool, calls } = poolReturning([
      { ...base, id: "a", ts: 1, evidence_status: "missing" },
      { ...base, id: "b", ts: 2, evidence_status: "ready" },
      { ...base, id: "c", ts: 3, evidence_status: "pending" },
      { ...base, id: "d", ts: 4, evidence_status: "failed_permanent" },
    ]);
    const res = await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 0 }, pool);
    expect(res.structuredContent!.events.map((e) => e.evidence_status)).toEqual([
      "missing",
      "ready",
      "pending",
      "failed_permanent",
    ]);
    expect(calls[0]!.sql).toMatch(/FROM alert_evidence ae WHERE ae\.alert_id = alert_events\.id/);
    expect(calls[0]!.sql).toMatch(/failed_permanently_at IS NOT NULL/);
    expect(outputSchema.safeParse(res.structuredContent!).success).toBe(true);
  });

  it("serves events without evidence_status when the DB role cannot read receipts (42501)", async () => {
    __resetReceiptStateForTests();
    const calls: string[] = [];
    const row = { id: "a", asset: "USDC", from_state: "PEGGED", to_state: "DRIFT", discount: "0.002", ts: 1 };
    const pool = {
      async query<T>(sql: string) {
        calls.push(sql);
        if (sql.includes("alert_evidence")) {
          throw Object.assign(new Error("permission denied for table alert_evidence"), { code: "42501" });
        }
        return { rows: [row] as T[] };
      },
    };
    const first = await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 0 }, pool);
    expect(first.structuredContent!.events[0]).not.toHaveProperty("evidence_status");
    expect(outputSchema.safeParse(first.structuredContent!).success).toBe(true);
    // The fallback sticks: no second failing query on the next call.
    await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 0 }, pool);
    expect(calls.filter((q) => q.includes("alert_evidence"))).toHaveLength(1);
    expect(calls).toHaveLength(3);
    __resetReceiptStateForTests();
  });

  it("rethrows any other DB error (masked later by withSafeErrors)", async () => {
    __resetReceiptStateForTests();
    const pool = {
      async query<T>(): Promise<{ rows: T[] }> {
        throw Object.assign(new Error("boom"), { code: "57014" });
      },
    };
    await expect(handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 0 }, pool)).rejects.toThrow("boom");
  });

  // R2: xSOL (class synth_lev) is off every public surface; REST 404s it.
  it("rejects a non-public symbol with the same 'not tracked' answer as the other tools", async () => {
    const res = await subscribePegEventsTool.handler({ symbols: ["USDC", "xSOL"], since_ts: 0 });
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0]!.text).toBe(
      "Error: asset 'xSOL' not tracked. Use get_assets() to list tracked symbols.",
    );
  });

  // R3 audit R3-MCP-03: a typo used to succeed with zero events.
  it("rejects an unknown or mistyped symbol with the 'not tracked' wording", async () => {
    __resetReceiptStateForTests();
    const { pool } = poolReturning([]);
    const res = await handleSubscribePegEvents({ symbols: ["USDC", "jitosol"], since_ts: 0 }, pool);
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0]!.text).toBe(
      "Error: asset 'jitosol' not tracked. Use get_assets() to list tracked symbols.",
    );
  });

  it("names every unknown symbol when several are unknown", async () => {
    __resetReceiptStateForTests();
    const { pool } = poolReturning([]);
    const res = await handleSubscribePegEvents(
      { symbols: ["FOO", "USDC", "BAR", "FOO"], since_ts: 0 },
      pool,
    );
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0]!.text).toBe(
      "Error: assets 'FOO', 'BAR' not tracked. Use get_assets() to list tracked symbols.",
    );
  });

  it("still succeeds with zero events for tracked symbols", async () => {
    __resetReceiptStateForTests();
    const { pool } = poolReturning([]);
    const res = await handleSubscribePegEvents({ symbols: ["USDC", "jitoSOL"], since_ts: 0 }, pool);
    expect(res).not.toHaveProperty("isError");
    expect(res.structuredContent).toEqual({ count: 0, next_cursor: 0, next_cursor_id: null, events: [] });
  });

  it("accepts a symbol missing from this build's registry when it has rows", async () => {
    __resetReceiptStateForTests();
    const { pool } = poolReturning([
      { id: "c", asset: "newSOL", from_state: "PEGGED", to_state: "DRIFT", discount: "0.002", ts: 3 },
    ]);
    const res = await handleSubscribePegEvents({ symbols: ["newSOL"], since_ts: 0 }, pool);
    expect(res).not.toHaveProperty("isError");
    expect(res.structuredContent!.count).toBe(1);
  });

  it("filters xSOL rows out of results", async () => {
    __resetReceiptStateForTests();
    const base = { from_state: "PEGGED", to_state: "DRIFT", discount: "0.002" };
    const { pool } = poolReturning([
      { ...base, id: "a", asset: "xSOL", ts: 1 },
      { ...base, id: "b", asset: "USDC", ts: 2 },
    ]);
    const res = await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 0 }, pool);
    expect(res.structuredContent!.events.map((e) => e.asset)).toEqual(["USDC"]);
    expect(res.structuredContent!.count).toBe(1);
  });

  it("advances next_cursor past a page that is entirely filtered out", async () => {
    __resetReceiptStateForTests();
    const base = { from_state: "PEGGED", to_state: "DRIFT", discount: "0.002" };
    const { pool } = poolReturning([
      { ...base, id: "a", asset: "xSOL", ts: 5 },
      { ...base, id: "b", asset: "xSOL", ts: 9 },
    ]);
    const res = await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 1 }, pool);
    expect(res.structuredContent!.count).toBe(0);
    expect(res.structuredContent!.next_cursor).toBe(9);
    expect(res.structuredContent!.next_cursor_id).toBe("b");
  });

  it("preserves the id tie breaker across empty pages and equal timestamps", async () => {
    const { pool, calls } = poolReturning([]);
    const id = "612835d1-c19d-4b00-8a7f-2a23bce18e8a";
    const res = await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 12.5, since_id: id }, pool);
    expect(calls[0]!.params).toEqual([["USDC"], 12.5, 0, id]);
    expect(res.structuredContent).toMatchObject({ next_cursor: 12.5, next_cursor_id: id });
  });

  it("binds the real since_id when given, and treats null as absent", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const given = poolReturning([]);
    await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 1, since_id: id }, given.pool);
    expect(given.calls[0]!.params[3]).toBe(id);
    const nul = poolReturning([]);
    await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 1, since_id: null }, nul.pool);
    expect(nul.calls[0]!.params[3]).toBe("ffffffff-ffff-ffff-ffff-ffffffffffff");
  });

  it("an empty page keeps the caller's since_id so the next call stays valid", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const { pool } = poolReturning([]);
    const res = await handleSubscribePegEvents({ symbols: ["USDC"], since_ts: 5, since_id: id }, pool);
    expect(res.structuredContent!.next_cursor_id).toBe(id);
  });

  it("schema: since_id accepts a uuid, null and omission; next_cursor_id may be null", async () => {
    const { z } = await import("zod");
    const { subscribePegEventsTool: t } = await import("@/tools/subscribe-peg-events");
    const input = z.object(t.inputSchema);
    const base = { symbols: ["USDC"], since_ts: 0 };
    expect(input.safeParse(base).success).toBe(true);
    expect(input.safeParse({ ...base, since_id: null }).success).toBe(true);
    expect(input.safeParse({ ...base, since_id: "11111111-2222-3333-4444-555555555555" }).success).toBe(true);
    expect(input.safeParse({ ...base, since_id: "" }).success).toBe(false);
    const out = z.object(t.outputSchema);
    expect(out.safeParse({ count: 0, next_cursor: 0, next_cursor_id: null, events: [] }).success).toBe(true);
  });
});
