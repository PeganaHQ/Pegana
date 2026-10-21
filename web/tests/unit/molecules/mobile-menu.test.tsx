import React from "react";
import { renderWithProviders, screen, waitFor } from "@/tests/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MobileMenu } from "@/components/molecules/mobile-menu";

vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement>
  >(function MockLink({ children, ...props }, ref) {
    return (
      <a ref={ref} {...props}>
        {children}
      </a>
    );
  }),
}));

describe("MobileMenu", () => {
  it("opens as a modal <dialog>, hides the rest of the app behind it, and closes with Escape", async () => {
    const user = userEvent.setup();
    window.scrollTo = vi.fn();
    // MobileMenu is now a native <dialog> rendered inline (no portal), so
    // "the app root" from the old portal-sibling test no longer means
    // anything — the dialog's own subtree, including the trigger button, is
    // a descendant of the render container. Render a sibling "rest of the
    // app" node instead, which is exactly what showModal() should inert.
    renderWithProviders(
      <>
        <div data-testid="app-content">Rest of the app</div>
        <MobileMenu
          links={[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/assets", label: "Assets" },
          ]}
          searchAction={() => {}}
        />
      </>,
    );
    const appContent = screen.getByTestId("app-content");
    const trigger = screen.getByRole("button", { name: /open menu/i });

    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-controls", "mobile-menu-dialog");
    expect(appContent).not.toHaveAttribute("aria-hidden");

    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: /menu/i });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // showModal() (native, or the jsdom shim in tests/setup.ts) makes
    // everything outside the dialog's subtree inert — including the app
    // content sibling above.
    expect(appContent).toHaveAttribute("aria-hidden", "true");
    expect(appContent.inert).toBe(true);

    // Escape is a keyboard dismissal, so focus deterministically stays on the
    // trigger. (This test used to click the X instead, which is a POINTER
    // dismissal: the menu then blurs the trigger one frame later on purpose,
    // so the focus assertion raced that requestAnimationFrame and failed about
    // one run in eight.)
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
    expect(appContent).not.toHaveAttribute("aria-hidden");
    expect(appContent.inert).toBe(false);
    // Native close() restores focus to whatever was focused before
    // showModal(): the trigger, since that's what the user clicked.
    expect(trigger).toHaveFocus();
    // And nothing scheduled after the close takes it away again.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(trigger).toHaveFocus();
  });

  it("a pointer dismissal hands focus back to the trigger, then drops the ring a frame later", async () => {
    const user = userEvent.setup();
    window.scrollTo = vi.fn();
    renderWithProviders(
      <MobileMenu
        links={[{ href: "/dashboard", label: "Dashboard" }]}
        searchAction={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: /open menu/i });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: /menu/i });

    await user.click(screen.getByRole("button", { name: /close menu/i }));

    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
    // Deterministic end state: the post-close rAF blurs a pointer-restored
    // trigger so WebKit does not paint a stuck focus ring.
    await waitFor(() => expect(trigger).not.toHaveFocus());
  });
});
