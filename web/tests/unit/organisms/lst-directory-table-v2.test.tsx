import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LstDirectoryTableV2 } from "@/components/organisms/lst/lst-directory-table-v2";
import type { LstDirectoryRow } from "@/lib/lst/types";

// Paging is client-side state only (usePagination never calls the router); the
// mock just keeps other app-router consumers from throwing in a bare render.
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => "/lst",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    { children?: React.ReactNode; href: string }
  >(function MockLink({ children, href, ...props }, ref) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  }),
}));

const rows: LstDirectoryRow[] = [
  {
    mint: "MintA",
    symbol: "aSOL",
    name: "A Staked SOL",
    logoUri: null,
    tvlUsd: 5_000_000,
    apy: 0.05,
    rate: 1.1,
    deprecated: false,
    dead: false,
    covered: true,
    peganaSymbol: "aSOL",
    state: "DRIFT",
    // A premium (+0.41%) — the ADR-0021 benign case for an LST.
    spreadBps: 41,
    updatedAt: "2026-07-15T00:00:00Z",
  },
  {
    mint: "MintB",
    symbol: "bSOL",
    name: "B Staked SOL",
    logoUri: null,
    tvlUsd: 1_000_000,
    apy: 0.04,
    rate: null,
    deprecated: false,
    dead: false,
    covered: false,
    peganaSymbol: null,
    state: null,
    spreadBps: null,
    updatedAt: null,
  },
  {
    mint: "MintD",
    symbol: "dSOL",
    name: "D Staked SOL",
    logoUri: null,
    tvlUsd: 800_000,
    apy: 0.045,
    rate: 1.05,
    deprecated: false,
    dead: false,
    covered: true,
    peganaSymbol: "dSOL",
    // DEPEG (not DRIFT, to keep this row's pill text distinct from aSOL's
    // for `getByText` assertions elsewhere in this file).
    state: "DEPEG",
    // A genuine discount (−0.70%) — 50% of the way to the LST class-default
    // 140bps depeg line, the proximity mini-bar's proportional-fill case.
    spreadBps: -70,
    updatedAt: "2026-07-15T00:00:00Z",
  },
  {
    mint: "MintC",
    symbol: "stSOL",
    name: "Lido Staked SOL",
    logoUri: null,
    tvlUsd: 200_000,
    apy: 0.03,
    rate: null,
    deprecated: true,
    dead: false,
    covered: false,
    peganaSymbol: null,
    state: null,
    spreadBps: null,
    updatedAt: null,
  },
];

describe("LstDirectoryTableV2", () => {
  it("links a covered row to its asset page and shows its live verdict", () => {
    render(<LstDirectoryTableV2 rows={rows} source="directory" />);

    const coveredLink = screen.getByRole("link", { name: /aSOL/i });
    expect(coveredLink).toHaveAttribute("href", "/asset/aSOL");
    expect(screen.getByText("Drift")).toBeInTheDocument();
    // Premium/discount to NAV lives in its own "vs NAV" column, holder-signed.
    expect(screen.getByText("vs NAV")).toBeInTheDocument();
    expect(screen.getByText("+0.41%")).toBeInTheDocument();
  });

  it("renders an uncovered row as 'not yet covered' with no link, and tags a deprecated LST", () => {
    render(<LstDirectoryTableV2 rows={rows} source="directory" />);

    expect(screen.getAllByText("not yet covered")).toHaveLength(2);
    expect(screen.getAllByRole("status", { name: /Not yet covered/i })).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: /bSOL/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("deprecated")).toBeInTheDocument();
  });

  it("proxies the covered row's icon through the vendored /tokens path and the uncovered rows through the same-origin logo proxy", () => {
    const { container } = render(
      <LstDirectoryTableV2 rows={rows} source="directory" />,
    );

    const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("src"),
    );
    const coveredSrc = srcs.find((src) => src?.includes("/tokens/"));
    const uncoveredSrcs = srcs.filter((src) =>
      src?.includes("/api/token-logo?mint="),
    );

    // Covered row (aSOL, MintA) — vendored icon from the API box (lib/static-assets.ts), never the proxy.
    expect(coveredSrc).toBe("https://api.pegana.xyz/static/tokens/MintA.webp");

    // Uncovered rows (bSOL/MintB, stSOL/MintC) — same-origin proxy, never a
    // raw external CDN URL (CSP img-src does not allow those hosts).
    expect(uncoveredSrcs.slice().sort()).toEqual(
      ["/api/token-logo?mint=MintB", "/api/token-logo?mint=MintC"].sort(),
    );
  });

  it("filters to covered-only, hiding uncovered rows", () => {
    render(<LstDirectoryTableV2 rows={rows} source="directory" />);
    fireEvent.click(screen.getByRole("button", { name: "Covered" }));

    expect(screen.getByText("aSOL")).toBeInTheDocument();
    expect(screen.queryByText("bSOL")).not.toBeInTheDocument();
    expect(screen.queryByText("stSOL")).not.toBeInTheDocument();
  });

  it("filters to drifting+, keeping only a covered row in a non-pegged state", () => {
    render(<LstDirectoryTableV2 rows={rows} source="directory" />);
    fireEvent.click(screen.getByRole("button", { name: "Drifting+" }));

    expect(screen.getByText("aSOL")).toBeInTheDocument();
    expect(screen.queryByText("bSOL")).not.toBeInTheDocument();
  });

  it("shows the fallback banner only when source is 'fallback'", () => {
    const { rerender } = render(
      <LstDirectoryTableV2 rows={rows} source="directory" />,
    );
    expect(screen.queryByText(/unreachable right now/)).not.toBeInTheDocument();

    rerender(<LstDirectoryTableV2 rows={rows} source="fallback" />);
    expect(screen.getByText(/unreachable right now/)).toBeInTheDocument();
  });

  describe("sortable headers", () => {
    function symbolOrder(): string[] {
      return screen
        .getAllByText(/^(aSOL|bSOL|dSOL|stSOL)$/)
        .map((el) => el.textContent as string);
    }

    it("defaults to TVL descending, with aria-sort on the active header only", () => {
      render(<LstDirectoryTableV2 rows={rows} source="directory" />);

      const tvlButton = screen.getByRole("button", {
        name: /^Sort by TVL, currently descending$/,
      });
      expect(tvlButton.closest("th")).toHaveAttribute(
        "aria-sort",
        "descending",
      );

      const apyButton = screen.getByRole("button", { name: /^Sort by APY$/ });
      expect(apyButton.closest("th")).not.toHaveAttribute("aria-sort");

      // TVL: aSOL 5M > bSOL 1M > dSOL 800K > stSOL 200K.
      expect(symbolOrder()).toEqual(["aSOL", "bSOL", "dSOL", "stSOL"]);
    });

    it("re-sorts by vs NAV: first click descending, second click toggles ascending, with uncovered rows always sinking to the bottom", () => {
      render(<LstDirectoryTableV2 rows={rows} source="directory" />);

      const vsNavButton = screen.getByRole("button", {
        name: /^Sort by vs NAV$/,
      });
      const vsNavTh = vsNavButton.closest("th");

      fireEvent.click(vsNavButton);
      expect(vsNavTh).toHaveAttribute("aria-sort", "descending");
      // Desc by holder-signed vs NAV: aSOL (+0.41%) > dSOL (−0.70%); the two
      // uncovered rows (null) sink to the bottom regardless of direction —
      // tied on the null value, so their own tie-break (symbol) still flips
      // with direction, same as every other column's tie-break.
      expect(symbolOrder()).toEqual(["aSOL", "dSOL", "stSOL", "bSOL"]);

      fireEvent.click(vsNavButton);
      expect(vsNavTh).toHaveAttribute("aria-sort", "ascending");
      // Ascending flips the two covered rows; the uncovered rows still sink.
      expect(symbolOrder()).toEqual(["dSOL", "aSOL", "bSOL", "stSOL"]);
    });

    it("keeps the active sort applied within the Covered filter", () => {
      render(<LstDirectoryTableV2 rows={rows} source="directory" />);
      fireEvent.click(screen.getByRole("button", { name: "Covered" }));

      expect(
        screen.getAllByText(/^(aSOL|dSOL)$/).map((el) => el.textContent),
      ).toEqual(["aSOL", "dSOL"]);
    });
  });

  describe("vs-NAV proximity mini-bar", () => {
    it("reads a benign premium as calm — never near-depeg — for a direction-sensitive LST", () => {
      render(<LstDirectoryTableV2 rows={rows} source="directory" />);

      // aSOL: +0.41% premium — ADR-0021 carve-out, benign for an LST.
      expect(
        screen.getByLabelText(
          "Premium, benign for an LST, doesn't count toward its depeg band",
        ),
      ).toBeInTheDocument();
    });

    it("fills proportionally toward the LST's own depeg line for a genuine discount", () => {
      render(<LstDirectoryTableV2 rows={rows} source="directory" />);

      // dSOL: −0.70% discount on the LST class-default 140bps depeg line
      // (no per-symbol override for a synthetic "dSOL") → 50% of the way.
      expect(
        screen.getByLabelText("50% of the way to this LST's depeg line"),
      ).toBeInTheDocument();
    });

    it("renders no bar at all for uncovered rows — only the 'not yet covered' pill", () => {
      render(<LstDirectoryTableV2 rows={rows} source="directory" />);

      // Exactly the two covered rows with a spread (aSOL, dSOL) get a bar;
      // the two uncovered rows (bSOL, stSOL) get none.
      expect(screen.getAllByRole("img")).toHaveLength(2);
    });
  });
});

describe("an unreachable Pegana API is not a coverage claim", () => {
  // Returning an empty verdict overlay used to make every LST on the page read
  // "not yet covered" — a permanent statement about what this product tracks —
  // when the truth was that our own API had not answered. A visitor evaluating
  // Pegana during a sixty-second blip would conclude it covers nothing.
  it("says the verdict is unavailable, not that the asset is uncovered", () => {
    render(
      <LstDirectoryTableV2
        rows={rows}
        source="directory"
        verdictsUnavailable
      />,
    );
    expect(screen.queryByText("not yet covered")).toBeNull();
    expect(screen.getAllByText("verdict unavailable").length).toBeGreaterThan(0);
  });

  it("still says 'not yet covered' when the API answered normally", () => {
    render(<LstDirectoryTableV2 rows={rows} source="directory" />);
    expect(screen.getAllByText("not yet covered").length).toBeGreaterThan(0);
    expect(screen.queryByText("verdict unavailable")).toBeNull();
  });
});
