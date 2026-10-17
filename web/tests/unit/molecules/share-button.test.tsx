import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  assetShareUrl,
  assetShareCardUrl,
  assetTweetHref,
  ShareButton,
} from "@/components/molecules/share-button";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("share-button helpers", () => {
  it("builds a canonical permalink, URL-encoding the symbol", () => {
    expect(assetShareUrl("hyUSD")).toBe("https://www.pegana.xyz/asset/hyUSD");
    expect(assetShareUrl("hyloSOL+")).toBe(
      "https://www.pegana.xyz/asset/hyloSOL%2B",
    );
  });

  it("builds a share-card PNG route URL", () => {
    expect(assetShareCardUrl("hyUSD")).toBe(
      "https://www.pegana.xyz/asset/hyUSD/share-card",
    );
    expect(assetShareCardUrl("hyloSOL+")).toBe(
      "https://www.pegana.xyz/asset/hyloSOL%2B/share-card",
    );
  });

  it("builds an X intent href: state in the text, permalink as the url param", () => {
    const u = new URL(assetTweetHref("hyUSD", "DRIFT"));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/tweet");
    expect(u.searchParams.get("text")).toBe(
      "hyUSD is drift; live peg-risk read",
    );
    expect(u.searchParams.get("url")).toBe(
      "https://www.pegana.xyz/asset/hyUSD",
    );
    expect(u.searchParams.get("via")).toBe("PeganaHQ");
  });

  it("omits state from the text when null/unknown", () => {
    expect(new URL(assetTweetHref("USDC", null)).searchParams.get("text")).toBe(
      "USDC; live peg-risk read",
    );
  });

  it("normalizes BLACK_SWAN underscore in the tweet text", () => {
    expect(
      new URL(assetTweetHref("xUSD", "BLACK_SWAN")).searchParams.get("text"),
    ).toBe("xUSD is black swan; live peg-risk read");
  });

  it("shows the eHYUSD display alias in the tweet text, never the raw DB symbol", () => {
    expect(
      new URL(assetTweetHref("sHYUSD", "DRIFT")).searchParams.get("text"),
    ).toBe("eHYUSD is drift; live peg-risk read");
  });

  it("keeps the permalink URL on the literal DB symbol (KEY, not display)", () => {
    expect(assetShareUrl("sHYUSD")).toBe("https://www.pegana.xyz/asset/sHYUSD");
  });

  it("shares the generated PNG as a file when native file sharing is available", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["png"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });

    render(<ShareButton symbol="hyUSD" state="DRIFT" />);
    await user.click(screen.getByRole("button", { name: "Share on X" }));

    expect(fetch).toHaveBeenCalledWith(assetShareCardUrl("hyUSD"));
    expect(share).toHaveBeenCalledOnce();
    const payload = share.mock.calls[0]![0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("pegana-hyUSD.png");
    expect(payload.url).toBe(assetShareUrl("hyUSD"));
  });
});
