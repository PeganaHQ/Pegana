import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DirectoryFetchResult } from "@/lib/lst/fetch-directory";

const fetchLstDirectoryMock = vi.fn<() => Promise<DirectoryFetchResult>>();

vi.mock("@/lib/lst/fetch-directory", () => ({
  fetchLstDirectory: () => fetchLstDirectoryMock(),
}));

const { GET } = await import("./route");

function req(mint?: string): Request {
  const url = mint
    ? `http://localhost/api/lst-liveness?mint=${encodeURIComponent(mint)}`
    : "http://localhost/api/lst-liveness";
  return new Request(url);
}

function directoryRow(
  overrides: Partial<{
    mint: string;
    rate: number | null;
    flags: { deprecated: boolean; dead: boolean; stale: boolean };
  }> = {},
) {
  return {
    mint: "MintA",
    symbol: "aSOL",
    name: "A Staked SOL",
    logoUri: null,
    poolProgram: null,
    tvlUsd: null,
    apy: null,
    rate: 1.2,
    flags: { deprecated: false, dead: false, stale: false },
    ...overrides,
  };
}

describe("GET /api/lst-liveness", () => {
  beforeEach(() => {
    fetchLstDirectoryMock.mockReset();
  });

  it("404s when mint is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("404s when the directory is unreachable", async () => {
    fetchLstDirectoryMock.mockResolvedValue({ status: "unreachable" });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when no row matches the mint", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({ mint: "OtherMint" })],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("returns the flags + rate for a matched mint", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [
        directoryRow({
          rate: 1.20497,
          flags: { deprecated: false, dead: false, stale: true },
        }),
      ],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      mint: "MintA",
      flags: { stale: true, deprecated: false, dead: false },
      rate: 1.20497,
    });
  });

  it("returns healthy (all-false) flags for a covered-but-healthy LST", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({})],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flags).toEqual({
      stale: false,
      deprecated: false,
      dead: false,
    });
  });
});
