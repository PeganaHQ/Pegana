import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnboardingModal } from "@/components/organisms/onboarding-modal";
import { useOnboardingState } from "@/lib/hooks/use-onboarding-state";

// 2026-07-16 "ruthless simplification" rework. Rafael rejected the prior
// version (and two before it) for looking "busy / diagram-y / ugly" — every
// step crammed 2-3 small data-viz widgets (band gauge + threshold ladder +
// mini-table + 4-frame flow) alongside a two-column body/visual split. This
// pass keeps the structure he explicitly likes (sidebar Concept/Model/Signal/
// Surface/Action, iPad-horizontal card, punchy lede/support copy, the
// persistence gate) and replaces every step's content with exactly ONE real,
// art-directed focal element, deleting every "supporting" mini-widget and any
// mechanism-explaining paragraph.
//
// The other deliberate contract change: the sidebar is now a fading trail,
// not a menu — the current step is a full-weight clickable button, a
// *completed* step shrinks to a check + dimmed label (still clickable, going
// back is always fine), and a *future* step renders as an inert, non-button
// element (just a number + dimmed label) — you advance via Next or the
// footer's segmented progress tabs, never by skipping ahead in the rail.
// Tests that need to jump forward from a fresh render use the footer's
// progress tabs (`progressTabs()`), which are unaffected by this and still
// allow an arbitrary jump in either direction.

vi.mock("framer-motion", () => {
  function strip<T extends Record<string, unknown>>(props: T) {
    const {
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    } = props;
    return rest;
  }
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: {
      div: (props: React.ComponentProps<"div"> & Record<string, unknown>) => (
        <div {...strip(props)} />
      ),
      span: (props: React.ComponentProps<"span"> & Record<string, unknown>) => (
        <span {...strip(props)} />
      ),
      li: (props: React.ComponentProps<"li"> & Record<string, unknown>) => (
        <li {...strip(props)} />
      ),
    },
  };
});

// `true` so useCountUp's animated stats (the live universe count, the Model
// step's dual readout + spread) resolve to their final target synchronously
// on mount instead of mid-rAF-tween — deterministic assertions, and it
// exercises the actual reduced-motion code path (useCountUp's
// `if (reduced) setValue(target)`, and Signal's cycling pill freezing on a
// single state instead of cycling) at the same time.
vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));

vi.mock("@/lib/hooks/use-stats", () => ({
  useStats: () => ({
    data: { assets_tracked: 23, by_state: { PEGGED: 19 } },
  }),
}));

vi.mock("@/lib/hooks/use-onboarding-state", () => ({
  useOnboardingState: vi.fn(),
}));

const mockedUseOnboardingState = vi.mocked(useOnboardingState);

function setOnboardingState(
  overrides: Partial<ReturnType<typeof useOnboardingState>> = {},
) {
  mockedUseOnboardingState.mockReturnValue({
    open: true,
    hydrated: true,
    dismiss: vi.fn(),
    reopen: vi.fn(),
    close: vi.fn(),
    ...overrides,
  });
}

/** Footer's segmented progress bar — the one unambiguous 5-tab tablist
 *  (the mobile top bar renders its own "Onboarding steps" tablist too, and
 *  jsdom doesn't hide either behind the `md:` breakpoint, so scope to this
 *  one instead of `getAllByRole("tab")` at the document root). Also the tool
 *  this suite uses to jump to an arbitrary step from a fresh render — unlike
 *  the sidebar, it's not gated by the fading-trail contract. */
function progressTabs() {
  return within(
    screen.getByRole("tablist", { name: "Onboarding progress" }),
  ).getAllByRole("tab");
}

/** The desktop sidebar `<nav>` — a real `<nav aria-label="Onboarding steps">`
 *  (role="navigation"), distinct from the mobile top bar which uses the same
 *  aria-label but `role="tablist"` instead. Scoping here lets tests inspect
 *  the fading-trail sidebar (current/completed buttons vs. inert future
 *  rows) without colliding with the mobile bar's always-clickable tabs. */
function sidebarNav() {
  return screen.getByRole("navigation", { name: "Onboarding steps" });
}

/** A CURRENT or COMPLETED sidebar item — a plain `<button>` (not `role="tab"`)
 *  so `getByRole` with the badge text as the accessible name is unambiguous
 *  even though the mobile tab bar renders the same labels under `role="tab"`.
 *  Future items are intentionally NOT buttons (see the fading-trail contract
 *  above) — trying to resolve one here will fail, by design. */
function sidebarStep(name: RegExp | string) {
  return within(sidebarNav()).getByRole("button", { name });
}

/** The small mono "Step n of 5" pill above the H1 — the eyebrow. */
function eyebrow() {
  return screen.getByText(/^step \d of 5$/i);
}

beforeEach(() => {
  mockedUseOnboardingState.mockReset();
});

describe("OnboardingModal — first-visit persistence gate", () => {
  it("renders nothing before the localStorage check has hydrated, and never re-implements the gate itself", () => {
    setOnboardingState({ hydrated: false, open: false });
    const { container } = render(<OnboardingModal />);
    expect(container).toBeEmptyDOMElement();
    expect(mockedUseOnboardingState).toHaveBeenCalled();
  });
});

describe("OnboardingModal — iPad-horizontal, generous sizing", () => {
  it("the dialog card targets a ~1216×816 landscape footprint at md+, fluid below it", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const card = document.querySelector('[data-slot="dialog-content"]');
    expect(card).toBeTruthy();
    const className = card?.className ?? "";
    expect(className).toContain("md:max-w-[1216px]");
    expect(className).toContain("816px");
    // Fluid below md: width resolves off the viewport (w-full), never a
    // fixed px floor that could overflow a narrow window.
    expect(className).toContain("w-full");
  });

  it("the card is fully opaque (bg-canvas) and never reaches for backdrop-filter itself — any glow lives in the box-shadow, which paints outside the card, not through it", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const card = document.querySelector('[data-slot="dialog-content"]');
    const className = card?.className ?? "";
    expect(className).toContain("bg-canvas");
    expect(className).not.toContain("backdrop-filter");
    expect(className).not.toContain("backdrop-blur");
  });
});

describe("OnboardingModal — sidebar is a fading trail, not a menu", () => {
  it("opens on Concept: all five step labels are present, but only the current step is an interactive button", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const nav = sidebarNav();
    for (const label of ["Concept", "Model", "Signal", "Surface", "Action"]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    // Concept is current — a real, clickable button.
    expect(sidebarStep("Concept")).toBeInTheDocument();
    // Model/Signal/Surface/Action are future — present as text, but inert
    // (no button role), so you can't skip ahead from the rail.
    for (const label of ["Model", "Signal", "Surface", "Action"]) {
      expect(
        within(nav).queryByRole("button", { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it("a completed step remains clickable from the sidebar and jumps back", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const user = userEvent.setup();
    await user.click(progressTabs()[2]); // jump ahead to Signal (step 3)
    expect(eyebrow()).toHaveTextContent("Step 3 of 5");
    // Concept (step 1) is now completed — small check + dimmed label, still
    // a real button, and clicking it navigates back.
    await user.click(sidebarStep("Concept"));
    expect(eyebrow()).toHaveTextContent("Step 1 of 5");
  });
});

describe("OnboardingModal — redundancy removed", () => {
  it("the Concept step does not re-list the sidebar's other steps (Model/Signal/Surface/Action descriptions)", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    // These were the exact duplicated bullet descriptions in a prior
    // version — the sidebar already says "Model", "Signal", "Surface",
    // "Action"; the step-1 body must not say them again.
    expect(
      screen.queryByText(/how intrinsic value is computed, source by source/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/how spread becomes a peg state/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/what each section of the dashboard means/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/how to subscribe to a telegram alert/i),
    ).not.toBeInTheDocument();
  });

  it("the eyebrow is a real wayfinding cue (Step n of 5), not a repeat of the H1", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    expect(eyebrow()).toHaveTextContent("Step 1 of 5");
    // "Welcome to Pegana" now appears exactly once — the heading — not also
    // as an eyebrow pill sitting directly above it.
    expect(screen.getAllByText("Welcome to Pegana")).toHaveLength(1);
  });

  it("the eyebrow advances with the step instead of staying static", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    await userEvent.setup().click(progressTabs()[2]); // step 3: signal
    expect(eyebrow()).toHaveTextContent("Step 3 of 5");
  });
});

describe("OnboardingModal — step copy is punchy, never a paragraph", () => {
  // Each step's lede is a single short sentence (checked by word count, not
  // just "is present") — this is the direct fix for the wall-of-text /
  // mechanism-explaining paragraphs prior versions opened every step with.
  const LEDES: string[] = [
    "A real-time watchdog for 23 monitored pegged assets on Solana.",
    "Every pegged asset has two values that should match.",
    "The spread isn't just a number; it's one of five states.",
    "One verdict, two answer cards, then the board; worst-first.",
    "Every asset has a calibrated threshold; the transition is published with its receipt.",
  ];

  it("every step's lede is a single short line, never a paragraph", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const user = userEvent.setup();
    for (let i = 0; i < LEDES.length; i++) {
      if (i > 0) await user.click(progressTabs()[i]);
      const lede = LEDES[i];
      expect(screen.getByText(lede)).toBeInTheDocument();
      expect(lede.trim().split(/\s+/).length).toBeLessThanOrEqual(14);
    }
  });
});

describe("OnboardingModal — step structure (Concept/Model/Signal/Surface/Action)", () => {
  it("opens on Concept with all five sidebar steps present", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    expect(
      screen.getByRole("heading", { name: "Welcome to Pegana" }),
    ).toBeInTheDocument();
    expect(progressTabs()).toHaveLength(5);
  });

  it("Concept: the one focal element is a single live figure (assets tracked), not a stat grid", () => {
    setOnboardingState();
    render(<OnboardingModal />);
    expect(screen.getByText(/23 Solana pegged assets/i)).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it("Model step: two large tabular-nums values plus the holder-signed % spread (never bps)", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    await userEvent.setup().click(progressTabs()[1]);
    expect(
      screen.getByRole("heading", { name: "Two values per asset" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Intrinsic")).toBeInTheDocument();
    expect(screen.getByText("Market")).toBeInTheDocument();
    expect(screen.getByText("1.0421")).toBeInTheDocument();
    expect(screen.getByText("1.0392")).toBeInTheDocument();
    expect(screen.getByText("−0.29%")).toBeInTheDocument();
  });

  it("Signal step: the real verdict pill, frozen (reduced motion) on a single state", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    await userEvent.setup().click(progressTabs()[2]);
    expect(
      screen.getByRole("heading", { name: "Spread becomes state" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Drift")).toBeInTheDocument();
  });

  it("Surface step: a single real dashboard row (asset · spread · gauge · sparkline), not a multi-box grid", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    await userEvent.setup().click(progressTabs()[3]);
    expect(
      screen.getByRole("heading", { name: "Your dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("jitoSOL")).toBeInTheDocument();
    expect(screen.getByText("−0.29%")).toBeInTheDocument();
  });

  it("Action step: the one alert card — friendly fix, signed threshold, and the verified receipt", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    await userEvent.setup().click(progressTabs()[4]);
    expect(
      screen.getByRole("heading", {
        name: "Follow the flip before the orderbook",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("−0.38%")).toBeInTheDocument();
    expect(screen.getByText("−0.50%")).toBeInTheDocument();
    expect(screen.getByText(/signed receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
  });

  it("Next/Back walk sequentially and disable at the boundaries", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeDisabled();
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: /^next$/i }));
    }
    expect(
      screen.getByRole("heading", {
        name: "Follow the flip before the orderbook",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^next$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open dashboard/i }),
    ).toBeInTheDocument();
  });

  it("the last step's 'Open dashboard' CTA dismisses", async () => {
    const dismiss = vi.fn();
    setOnboardingState({ dismiss });
    render(<OnboardingModal />);
    const user = userEvent.setup();
    const tabs = progressTabs();
    await user.click(tabs[4]); // step 5: action
    await user.click(screen.getByRole("button", { name: /open dashboard/i }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking a footer progress tab jumps directly to that step", async () => {
    setOnboardingState();
    render(<OnboardingModal />);
    const tabs = progressTabs();
    await userEvent.setup().click(tabs[2]); // step 3: signal
    expect(
      screen.getByRole("heading", { name: "Spread becomes state" }),
    ).toBeInTheDocument();
  });
});

describe("OnboardingModal — dismissal", () => {
  it("Skip onboarding dismisses immediately from the first step", async () => {
    const dismiss = vi.fn();
    setOnboardingState({ dismiss });
    render(<OnboardingModal />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /skip onboarding/i }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("the close (X) button dismisses", async () => {
    const dismiss = vi.fn();
    setOnboardingState({ dismiss });
    render(<OnboardingModal />);
    const closeButtons = screen.getAllByRole("button", {
      name: /close onboarding/i,
    });
    await userEvent.setup().click(closeButtons[0]);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingModal — no jargon: % everywhere, bps nowhere", () => {
  it("never prints 'bps' anywhere across any step", async () => {
    setOnboardingState();
    const { container } = render(<OnboardingModal />);
    const user = userEvent.setup();
    for (let i = 0; i < 5; i++) {
      const tabs = progressTabs();
      await user.click(tabs[i]);
      expect(container.textContent?.toLowerCase()).not.toMatch(/\bbps\b/);
    }
  });
});
