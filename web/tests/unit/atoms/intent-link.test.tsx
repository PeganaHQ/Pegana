import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Record the `prefetch` value next/link receives on every render.
const seen: unknown[] = [];
vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    { children?: React.ReactNode; href?: string; prefetch?: unknown }
  >(function MockLink({ children, prefetch, ...props }, ref) {
    seen.push(prefetch);
    return (
      <a ref={ref} data-prefetch={String(prefetch)} {...props}>
        {children}
      </a>
    );
  }),
}));

import Link from "@/components/atoms/intent-link";

describe("IntentLink", () => {
  it("does not prefetch on render, only after pointer intent", () => {
    render(<Link href="/dashboard">Dashboard</Link>);
    const a = screen.getByRole("link", { name: "Dashboard" });
    expect(a.getAttribute("data-prefetch")).toBe("false");
    fireEvent.mouseEnter(a);
    expect(a.getAttribute("data-prefetch")).toBe("null");
  });

  it("treats keyboard focus and touch as intent", () => {
    render(
      <>
        <Link href="/a">A</Link>
        <Link href="/b">B</Link>
      </>,
    );
    const a = screen.getByRole("link", { name: "A" });
    const b = screen.getByRole("link", { name: "B" });
    fireEvent.focus(a);
    fireEvent.touchStart(b);
    expect(a.getAttribute("data-prefetch")).toBe("null");
    expect(b.getAttribute("data-prefetch")).toBe("null");
  });

  it("keeps an explicit prefetch prop and still calls the caller's handlers", () => {
    const onMouseEnter = vi.fn();
    render(
      <Link href="/x" prefetch={true} onMouseEnter={onMouseEnter}>
        X
      </Link>,
    );
    const a = screen.getByRole("link", { name: "X" });
    expect(a.getAttribute("data-prefetch")).toBe("true");
    fireEvent.mouseEnter(a);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(a.getAttribute("data-prefetch")).toBe("true");
  });
});
