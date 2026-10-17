import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/organisms/mobile-tab-bar";

let pathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("MobileTabBar", () => {
  it("renders the four primary mobile destinations", () => {
    render(<MobileTabBar />);

    expect(
      screen.getByRole("navigation", { name: /mobile app navigation/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: /assets/i })).toHaveAttribute(
      "href",
      "/assets",
    );
    expect(screen.getByRole("link", { name: /events/i })).toHaveAttribute(
      "href",
      "/events",
    );
    expect(screen.getByRole("link", { name: /compare/i })).toHaveAttribute(
      "href",
      "/compare",
    );
  });

  it("omits itself on asset detail pages that own the bottom CTA", () => {
    pathname = "/asset/SOL";
    render(<MobileTabBar />);

    expect(
      screen.queryByRole("navigation", { name: /mobile app navigation/i }),
    ).not.toBeInTheDocument();
  });
});
