import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FooterV2 } from "@/components/organisms/v2/footer-v2";

// The footer is deliberately narrow: 3 columns, at most 5 destinations each.
// It is navigation, not an index — the free-release cleanup removed the bot,
// the user-facing webhook surface and every duplicate/secondary entry. This
// test pins that shape so the footer cannot quietly bloat again.
//
// Link validity is checked separately (tests/unit/design/page-integrity.test.ts)
// against the real route tree.

const COLUMN_TITLES = ["product", "developers", "project"];

function columnLinks(title: string): HTMLElement[] {
  // Each column is a <div> whose first child is the <h3> heading.
  const heading = screen.getByRole("heading", { name: title });
  const column = heading.parentElement!;
  return within(column).getAllByRole("link");
}

describe("FooterV2", () => {
  it("renders exactly three columns", () => {
    render(<FooterV2 />);
    for (const title of COLUMN_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // No legacy columns.
    for (const gone of ["trust", "company", "legal"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it("keeps each column to five destinations or fewer", () => {
    render(<FooterV2 />);
    for (const title of COLUMN_TITLES) {
      expect(columnLinks(title).length, title).toBeLessThanOrEqual(5);
    }
  });

  it("drops the Telegram bot, the webhook guide and duplicates", () => {
    const { container } = render(<FooterV2 />);
    const text = container.textContent?.toLowerCase() ?? "";
    for (const gone of ["telegram", "webhook", "pricing", "account", "sign in"]) {
      expect(text, `footer still mentions ${gone}`).not.toContain(gone);
    }
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).not.toContain("/compare");
    expect(hrefs).not.toContain("/events");
    expect(hrefs).not.toContain("/systemic");
  });

  it("keeps the legal line with Privacy and Terms", () => {
    render(<FooterV2 />);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument();
  });

  it("points every internal link at a relative path", () => {
    // Cross-host redirects are gone; the footer renders on both hosts and
    // every internal destination is same-host.
    const { container } = render(<FooterV2 />);
    for (const a of Array.from(container.querySelectorAll("a"))) {
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("http") || href.startsWith("mailto:")) continue;
      expect(href.startsWith("/"), href).toBe(true);
    }
  });
});
