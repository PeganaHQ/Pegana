import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditRowsToAlerts,
  coverageFloorDay,
  type AuditIndexRow,
} from "@/lib/api/audit-alerts";
import { api } from "@/lib/api/client";

const row = (over: Partial<AuditIndexRow>): AuditIndexRow => ({
  id: "a1",
  asset: "mSOL",
  from_state: "PEGGED",
  to_state: "DRIFT",
  detected_at: "2026-10-01T00:00:00.000Z",
  methodology_version: "v1",
  receipt_sha256: "00",
  onchain_tx_sig: null,
  monitoring_only: false,
  calibration: "calibrated",
  ...over,
});

describe("auditRowsToAlerts", () => {
  const classes = { mSOL: "lst", USDC: "stable_fiat" } as const;

  it("maps audit rows to AlertRow with class joined from assets", () => {
    const [a] = auditRowsToAlerts([row({})], classes);
    expect(a).toMatchObject({
      id: "a1",
      asset: "mSOL",
      class: "lst",
      dispatched_at: null,
      monitoring_only: false,
      calibration: "calibrated",
    });
    expect(a.discount).toBeUndefined();
  });

  it("returns [] for an empty ledger", () => {
    expect(auditRowsToAlerts([], classes)).toEqual([]);
  });

  it("keeps receipts of deactivated assets with class unknown", () => {
    const out = auditRowsToAlerts([row({ asset: "GONE" })], classes);
    expect(out).toHaveLength(1);
    expect(out[0].class).toBe("unknown");
  });
});

describe("coverageFloorDay", () => {
  const rows = auditRowsToAlerts(
    [row({ detected_at: "2026-10-05T00:00:00.000Z" }), row({ id: "z", detected_at: "2026-08-03T10:00:00.000Z" })],
    {},
  );
  it("is null when the window was exhausted", () => {
    expect(coverageFloorDay(rows, true)).toBeNull();
  });
  it("is the oldest returned day when the cap was hit", () => {
    expect(coverageFloorDay(rows, false)).toBe("2026-08-03");
  });
  it("is null for no rows", () => {
    expect(coverageFloorDay([], false)).toBeNull();
  });
});

function stubApi(auditPages: AuditIndexRow[][], assetsOk = true) {
  const urls: string[] = [];
  let page = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("/v1/audit")) {
        return new Response(JSON.stringify(auditPages[page++] ?? []), {
          status: 200,
        });
      }
      return assetsOk
        ? new Response(
            JSON.stringify({ data: [{ symbol: "mSOL", class: "lst" }] }),
            { status: 200 },
          )
        : new Response("boom", { status: 500 });
    }),
  );
  return urls;
}

describe("api.alerts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls /v1/audit server-side with asset/since/until, never /v1/alerts", async () => {
    const urls = stubApi([[row({})]]);
    const out = await api.alerts({
      asset: "mSOL",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-02-01T00:00:00.000Z",
      limit: 15,
    });
    expect(out).toHaveLength(1);
    const audit = urls.find((u) => u.includes("/v1/audit?"))!;
    expect(audit).toContain("asset=mSOL");
    expect(audit).toContain("since=2026-01-01");
    expect(audit).toContain("until=2026-02-01");
    expect(audit).toContain("limit=15");
    expect(urls.some((u) => u.includes("/v1/alerts"))).toBe(false);
  });

  it("returns an empty list when the ledger is empty", async () => {
    stubApi([[]]);
    expect(await api.alerts()).toEqual([]);
  });

  it("degrades to class unknown when /v1/assets fails", async () => {
    stubApi([[row({})]], false);
    const out = await api.alerts();
    expect(out).toHaveLength(1);
    expect(out[0].class).toBe("unknown");
  });
});

describe("api.alertsWindow", () => {
  afterEach(() => vi.unstubAllGlobals());

  const full = (n: number, startMin: number) =>
    Array.from({ length: n }, (_, i) =>
      row({
        id: `id-${startMin + i}`,
        detected_at: new Date(Date.UTC(2026, 9, 1) - (startMin + i) * 60_000).toISOString(),
      }),
    );

  it("pages with the before cursor until a short page (complete)", async () => {
    const p1 = full(100, 0);
    const urls = stubApi([p1, full(30, 100)]);
    const w = await api.alertsWindow({ since: "2026-01-01T00:00:00.000Z" });
    expect(w.rows).toHaveLength(130);
    expect(w.complete).toBe(true);
    expect(w.coverageFloorDay).toBeNull();
    const audits = urls.filter((u) => u.includes("/v1/audit?"));
    expect(audits).toHaveLength(2);
    expect(audits[0]).not.toContain("before=");
    expect(audits[1]).toContain(`before=${encodeURIComponent(p1[99].detected_at)}`);
    expect(audits[1]).toContain("before_id=id-99");
  });

  it("stops at maxPages and reports the coverage floor", async () => {
    const urls = stubApi([full(100, 0), full(100, 100), full(100, 200)]);
    const w = await api.alertsWindow({
      since: "2026-01-01T00:00:00.000Z",
      maxPages: 2,
    });
    expect(urls.filter((u) => u.includes("/v1/audit?"))).toHaveLength(2);
    expect(w.rows).toHaveLength(200);
    expect(w.complete).toBe(false);
    expect(w.coverageFloorDay).toBe(w.rows[199].detected_at.slice(0, 10));
  });

  it("an empty ledger is complete with no rows", async () => {
    stubApi([[]]);
    const w = await api.alertsWindow({ since: "2026-01-01T00:00:00.000Z" });
    expect(w).toMatchObject({ rows: [], complete: true, coverageFloorDay: null });
  });
});
