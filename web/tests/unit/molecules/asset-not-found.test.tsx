import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: undefined }),
}));

import { AssetNotFound } from "@/components/molecules/asset-not-found";

describe("AssetNotFound", () => {
  it("words a 429 as a rate limit, never as an outage", () => {
    render(<AssetNotFound symbol="USDT" rateLimited retryAfterSec={45} />);
    expect(screen.getByText("429 · paused")).toBeTruthy();
    expect(screen.queryByText(/unreachable/i)).toBeNull();
    expect(screen.queryByText(/isn't responding/i)).toBeNull();
    expect(screen.getByText(/60 requests a minute per IP/)).toBeTruthy();
    expect(screen.getByText(/in about 45s/)).toBeTruthy();
  });
  it("keeps the outage copy for a real network failure", () => {
    render(<AssetNotFound symbol="USDT" apiUnreachable />);
    expect(screen.getByText("Live feed unreachable.")).toBeTruthy();
  });
});
