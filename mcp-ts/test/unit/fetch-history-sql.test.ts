// Exercises the REAL fetchHistory SQL in src/db.ts.
//
// The existing get-asset-history.test.ts mocks `@/db` wholesale, so the
// actual SQL (continuous aggregate roll-up, the seven-day lookback bound,
// the 5k clamp, most-recent-first ordering) is never tested. Here we mock
// only the `pg` driver — the Pool's `query` — and let the real
// `fetchHistory` build and issue the statement, so we can assert:
//   * the bucket interval, asset, and clamped limit are passed as $1/$2/$3
//   * the seven-day window + DESC ordering + LIMIT are in the SQL
//   * `limit` is clamped to [1, 5_000] before hitting the DB
//
// A DB-backed variant runs only when DATABASE_URL is set (gated like the
// devnet integration test); it asserts the query returns rows of the
// documented shape against a real Postgres/Timescale.

import { afterAll, describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockModuleForRunner,
  restoreModulesForRunner,
} from "../support/module-mock";

// Capture the SQL + params the real fetchHistory issues. We mock the `pg`
// default export's Pool so `pool()` in src/db.ts builds our fake.
const calls: Array<{ sql: string; params: unknown[] }> = [];
const poolConfigs: Array<Record<string, unknown>> = [];
const REALISTIC_ROWS = [
  // What node-pg yields for the query: to_char ISO text, ROUND(AVG, 6)::text
  // and AVG(...)::text with Postgres' long trailing-zero scale.
  {
    ts: "2026-05-31T00:00:00.000Z",
    discount: "-0.004100",
    intrinsic_usd: "1.00000000000000000000",
    market_usd: "0.99590000000000000000",
  },
  {
    ts: "2026-05-30T23:59:00.000Z",
    discount: "-0.003800",
    intrinsic_usd: "104.413245656797405886395",
    market_usd: "0.99620000000000000000",
  },
];

class FakePool {
  constructor(config: Record<string, unknown>) {
    poolConfigs.push(config);
  }
  async query(sql: string, params: unknown[]) {
    calls.push({ sql, params });
    return { rows: REALISTIC_ROWS };
  }
}

await mockModuleForRunner("pg", () => ({
  default: { Pool: FakePool },
  Pool: FakePool,
}));

const { fetchHistory } = await import("@/db");

afterAll(async () => {
  await restoreModulesForRunner("pg");
});

describe("fetchHistory SQL (real query builder)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("passes bucket interval, asset, and limit as positional params", async () => {
    await fetchHistory("jitoSOL", "5m", 288);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(["5m", "jitoSOL", 288]);
  });

  it("sets server statement and connection timeouts on the pool", async () => {
    await fetchHistory("jitoSOL", "1m", 1);
    expect(poolConfigs[0]).toMatchObject({
      statement_timeout: 5_000,
      connectionTimeoutMillis: 2_000,
    });
  });

  it("reads the continuous aggregate with a bounded window, most-recent first", async () => {
    await fetchHistory("USDC", "1h", 1000);
    const sql = calls[0]!.sql;
    expect(sql).toMatch(/FROM discount_1m/);
    expect(sql).toMatch(/time_bucket\(\$1::interval, bucket\)/);
    expect(sql).toMatch(/LEAST\(\$3::int \* \$1::interval, interval '7 days'\)/);
    expect(sql).toMatch(/ORDER BY grouped.bucket DESC/);
    expect(sql).toMatch(/LIMIT \$3/);
    // LEFT JOIN: a bucket without a raw row keeps null legs instead of being dropped.
    expect(sql).toMatch(/LEFT JOIN LATERAL/);
    // The legs are the LAST observation in the bucket, not an average.
    expect(sql).toMatch(/ORDER BY ts DESC\s+LIMIT 1/);
    expect(sql).not.toMatch(/AVG\((intrinsic|market)/);
    expect(sql).toMatch(/ts >= grouped.bucket/);
  });

  it("maps a bucket with no raw observation to null legs", async () => {
    const rows = [{ ts: "2026-05-31T00:00:00.000Z", discount: "0.001000", intrinsic_usd: null, market_usd: null }];
    const { fetchHistory: fh } = await import("@/db");
    const out = await fh("USDC", "1m", 1, {
      query: (async () => ({ rows })) as never,
    });
    expect(out).toEqual([{ ts: "2026-05-31T00:00:00.000Z", discount: "0.001", intrinsic_usd: null, market_usd: null }]);
  });

  it("fails fast when too many reads already wait for a connection", async () => {
    const { fetchHistory: fh, HistoryOverloadError: Overload } = await import("@/db");
    const query = vi.fn();
    await expect(fh("USDC", "1m", 1, { query: query as never, waitingCount: 21 })).rejects.toBeInstanceOf(Overload);
    expect(query).not.toHaveBeenCalled();
  });

  it("clamps limit to the 5,000 hard cap before querying", async () => {
    await fetchHistory("mSOL", "1m", 9_999_999);
    expect(calls[0]!.params[2]).toBe(5_000);
  });

  it("clamps a non-positive limit up to 1", async () => {
    await fetchHistory("mSOL", "1m", 0);
    expect(calls[0]!.params[2]).toBe(1);
  });

  it("formats ts as ISO-8601 UTC ms and rounds the bucket discount to 6 dp in SQL", async () => {
    await fetchHistory("USDC", "1m", 10);
    const sql = calls[0]!.sql;
    expect(sql).toMatch(/to_char\(grouped.bucket AT TIME ZONE 'UTC',\s*'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\) AS ts/);
    expect(sql).toMatch(/ROUND\(AVG\(avg_discount\), 6\)::text AS discount/);
  });

  it("normalizes decimals like REST (no trailing zeros, USD legs at 18 dp)", async () => {
    const rows = await fetchHistory("jitoSOL", "5m", 10);
    expect(rows).toEqual([
      {
        ts: "2026-05-31T00:00:00.000Z",
        discount: "-0.0041",
        intrinsic_usd: "1",
        market_usd: "0.9959",
      },
      {
        ts: "2026-05-30T23:59:00.000Z",
        discount: "-0.0038",
        intrinsic_usd: "104.413245656797405886",
        market_usd: "0.9962",
      },
    ]);
  });
});

// ── DB-backed variant (gated on DATABASE_URL) ──────────────────────────
//
// Skipped unless DATABASE_URL points at a Postgres/Timescale with the
// discount_snapshots hypertable. Inline-gated per the project's
// test.skip-at-describe-scope gotcha. Uses an isolated dynamic import so
// it gets the UNMOCKED `pg` driver.
const DB_URL = process.env.DATABASE_URL ?? "";
const dbSkip = !DB_URL;

describe("fetchHistory against a real DB", () => {
  it.skipIf(dbSkip)(
    "returns rows of the documented shape (or an empty array) for an active asset",
    async () => {
      vi.resetModules();
      vi.doUnmock("pg");
      const real = await import("@/db");
      const rows = await real.fetchHistory("jitoSOL", "1h", 24);
      expect(Array.isArray(rows)).toBe(true);
      for (const r of rows) {
        expect(typeof r.ts).toBe("string");
        expect(typeof r.discount).toBe("string");
        expect(typeof r.intrinsic_usd).toBe("string");
        expect(typeof r.market_usd).toBe("string");
      }
      await real.pool().end();
    },
    20_000,
  );
});
