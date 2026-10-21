import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: undefined }),
}));

import { AssetNotFound } from "@/components/molecules/asset-not-found";

describe("AssetNotFound", () => {
  it("words a 429 as a calm pause, never as an outage or a rate limit", () => {
    const { container } = render(
      <AssetNotFound symbol="USDT" rateLimited retryAfterSec={45} />,
    );
    expect(screen.getByText("paused")).toBeTruthy();
    expect(screen.getByText("Live updates paused.")).toBeTruthy();
    expect(screen.queryByText(/unreachable/i)).toBeNull();
    expect(screen.queryByText(/isn't responding/i)).toBeNull();
    expect(screen.getByText(/in about 45s/)).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(
      /rate limit|requests a minute|429|per IP|too many/i,
    );
  });
  it("keeps the outage copy for a real network failure", () => {
    render(<AssetNotFound symbol="USDT" apiUnreachable />);
    expect(screen.getByText("Live feed unreachable.")).toBeTruthy();
  });
});
