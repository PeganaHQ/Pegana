import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  assetShareUrl,
  assetShareCardUrl,
  assetTweetHref,
  assetTweetText,
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

  it("puts the state and the holder-signed spread in the tweet text", () => {
    // raw bps = intrinsic - market, so +40 is a 0.40% DISCOUNT for a holder.
    expect(assetTweetText("jitoSOL", "PEGGED", 40)).toBe(
      "jitoSOL is pegged. Spread −0.40%.",
    );
    expect(assetTweetText("hyUSD", "DRIFT", -152)).toBe(
      "hyUSD is drift. Spread +1.52%.",
    );
  });

  it("degrades honestly when the spread or state is missing", () => {
    expect(assetTweetText("hyUSD", "DRIFT", null)).toBe("hyUSD is drift.");
    expect(assetTweetText("USDC", null, 12)).toBe("USDC. Spread −0.12%.");
    expect(assetTweetText("USDC", null, null)).toBe(
      "USDC; live peg-risk read",
    );
  });

  it("normalizes BLACK_SWAN underscore in the tweet text", () => {
    expect(assetTweetText("xUSD", "BLACK_SWAN", null)).toBe(
      "xUSD is black swan.",
    );
  });

  it("shows the eHYUSD display alias in the tweet text, never the raw DB symbol", () => {
    expect(assetTweetText("sHYUSD", "DRIFT", null)).toBe("eHYUSD is drift.");
  });

  it("builds an X intent href: numbers in the text, permalink as the url param", () => {
    const u = new URL(assetTweetHref("jitoSOL", "PEGGED", 40));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/tweet");
    expect(u.searchParams.get("text")).toBe(
      "jitoSOL is pegged. Spread −0.40%.",
    );
    expect(u.searchParams.get("url")).toBe(
      "https://www.pegana.xyz/asset/jitoSOL",
    );
    expect(u.searchParams.get("via")).toBe("PeganaHQ");
  });

  it("keeps the permalink URL on the literal DB symbol (KEY, not display)", () => {
    expect(assetShareUrl("sHYUSD")).toBe("https://www.pegana.xyz/asset/sHYUSD");
  });
});

describe("ShareButton", () => {
  it("opens the X intent directly with the live numbers and no side effects", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const share = vi.fn();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    // A download can only happen through the old fetch -> blob -> anchor.click
    // path, so pin both halves of it shut.
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<ShareButton symbol="jitoSOL" state="PEGGED" bps={40} />);
    const x = screen.getByRole("link", { name: "Share on X" });

    expect(x.getAttribute("href")).toBe(
      assetTweetHref("jitoSOL", "PEGGED", 40),
    );
    expect(x.getAttribute("target")).toBe("_blank");
    expect(x.getAttribute("rel")).toBe("noopener noreferrer");

    await user.click(x);

    // The whole point of the split: no PNG fetch, no native share sheet, no
    // download anchor. The click is the navigation and nothing else.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("keeps the Card entry as an honest PNG download", () => {
    render(<ShareButton symbol="hyUSD" state="DRIFT" bps={40} />);
    const card = screen.getByRole("link", { name: "Download share card" });
    expect(card.getAttribute("href")).toBe(assetShareCardUrl("hyUSD"));
    expect(card.hasAttribute("download")).toBe(true);
  });
});
