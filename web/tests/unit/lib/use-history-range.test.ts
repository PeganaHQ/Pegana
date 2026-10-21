import { describe, it, expect, vi, beforeEach } from "vitest";

const useSWR = vi.fn(() => ({ data: undefined }));
vi.mock("swr", () => ({ default: (...args: unknown[]) => useSWR(...(args as [])) }));

import { useHistoryRange } from "@/lib/hooks/use-history-range";

describe("useHistoryRange", () => {
  beforeEach(() => useSWR.mockClear());

  it("does not revalidate on window focus", () => {
    useHistoryRange("USDC", "24h" as never);
    const call = useSWR.mock.calls[0] as unknown as unknown[];
    expect(call[2]).toMatchObject({ revalidateOnFocus: false });
  });

  it("keys on symbol and range only and skips fetching without a symbol", () => {
    useHistoryRange("USDC", "24h" as never);
    useHistoryRange(null, "24h" as never);
    const calls = useSWR.mock.calls as unknown as unknown[][];
    expect(calls[0][0]).toEqual(["history-range", "USDC", "24h", "plan"]);
    expect(calls[1][0]).toBeNull();
  });
});
