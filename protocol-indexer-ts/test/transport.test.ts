import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceLastSuccess } from "../src/core/poll";

const checkDb = vi.fn<() => Promise<boolean>>();
vi.mock("../src/db", () => ({ checkDb }));

const { buildApp } = await import("../src/transport");

const requiredSources = ["kamino", "jupiter_lend"];
const NOW = new Date("2026-08-03T12:00:00.000Z");
type ReadyBody = {
  status: "ready" | "not_ready";
  db: boolean;
  sources: Record<string, number | null>;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sourceLastSuccess.clear();
  checkDb.mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("GET /readyz", () => {
  it("returns 200 when every required source is fresh", async () => {
    sourceLastSuccess.set("kamino", Date.now() - 1_000);
    sourceLastSuccess.set("jupiter_lend", Date.now() - 2_000);

    const response = await buildApp(requiredSources).request("/readyz");
    const body = await response.json() as ReadyBody;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.sources).toEqual({ kamino: 1, jupiter_lend: 2 });
  });

  it("returns 503 at the exact 10-minute staleness boundary", async () => {
    sourceLastSuccess.set("kamino", Date.now() - 1_000);
    sourceLastSuccess.set("jupiter_lend", Date.now() - 10 * 60 * 1_000);

    const response = await buildApp(requiredSources).request("/readyz");
    const body = await response.json() as ReadyBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.sources.jupiter_lend).toBe(600);
  });

  it("returns 503 and null when one required source never published", async () => {
    sourceLastSuccess.set("kamino", Date.now() - 1_000);

    const response = await buildApp(requiredSources).request("/readyz");
    const body = await response.json() as ReadyBody;

    expect(response.status).toBe(503);
    expect(body.sources).toEqual({ kamino: 1, jupiter_lend: null });
  });

  it("returns 503 when the database is down", async () => {
    checkDb.mockResolvedValue(false);
    sourceLastSuccess.set("kamino", Date.now() - 1_000);
    sourceLastSuccess.set("jupiter_lend", Date.now() - 1_000);

    const response = await buildApp(requiredSources).request("/readyz");
    const body = await response.json() as ReadyBody;

    expect(response.status).toBe(503);
    expect(body.db).toBe(false);
  });
});
