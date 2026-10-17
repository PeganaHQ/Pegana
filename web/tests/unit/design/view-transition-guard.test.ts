import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "worktrees", "test-results"]);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const dir of SCAN_DIRS) walk(join(WEB_ROOT, dir));
  return out;
}

const FILES = sourceFiles().map((path) => ({
  path,
  rel: path.slice(WEB_ROOT.length + 1),
  src: readFileSync(path, "utf8"),
}));

describe("view-transition contracts", () => {
  /**
   * A `view-transition-name` must be unique among RENDERED elements. jitoSOL
   * legitimately appears four times on /dashboard (board row, spread tape,
   * market feed, peer comparison). If two of those ever carry the same name at
   * the same viewport, the browser abandons the ENTIRE transition, not just
   * that pair, and every route animation in the app silently stops working
   * with no error anywhere. Nothing else in the suite would catch it.
   *
   * The board and screener rows are on this list twice over: each renders the
   * icon in both a `sm:hidden` card and a `hidden sm:table-cell` cell, which is
   * only safe because `display: none` elements are never captured.
   */
  const MORPH_ALLOWLIST = new Set([
    "components/atoms/token-icon.tsx", // defines it
    "components/organisms/dashboard-board-row.tsx",
    "components/organisms/assets-screener-row.tsx",
    "components/organisms/asset-hero-v2.tsx",
  ]);

  it("only the sanctioned surfaces claim an asset morph name", () => {
    const offenders = FILES.filter(
      (f) => f.src.includes("assetMorphName") && !MORPH_ALLOWLIST.has(f.rel),
    ).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  /**
   * The chrome anchors are a pair spread across two files: the inline
   * `viewTransitionName` in the component, and the
   * `::view-transition-group(...) { animation: none }` rule in globals.css.
   * Set the name without the rule and the header slides with the page, which
   * is exactly the disorientation the anchor exists to prevent.
   */
  it("every chrome anchor name is pinned in globals.css", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    const declared = new Set<string>();

    for (const f of FILES) {
      for (const m of f.src.matchAll(/viewTransitionName:\s*"([a-z0-9-]+)"/g)) {
        declared.add(m[1]);
      }
    }

    expect(declared.size).toBeGreaterThan(0);
    for (const name of declared) {
      expect(
        css.includes(`::view-transition-group(${name})`),
        `${name} carries a viewTransitionName but globals.css never pins it`,
      ).toBe(true);
    }
  });

  /**
   * The three type names are written in three places: the transitionTypes
   * props, the DIRECTIONAL_* maps, and the `::view-transition-old(.nav-*)`
   * selectors. A typo in any one produces no animation and no error.
   */
  it("every data-vt value has matching CSS", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    const used = new Set<string>();

    for (const f of FILES) {
      for (const m of f.src.matchAll(/data-vt="([a-z-]+)"/g)) used.add(m[1]);
    }

    expect([...used].sort()).toEqual(["nav-back", "nav-forward", "nav-lateral"]);
    for (const type of used) {
      expect(
        css.includes(`:root[data-vt="${type}"]::view-transition-old(root)`) &&
          css.includes(`:root[data-vt="${type}"]::view-transition-new(root)`),
        `a link uses data-vt="${type}" but globals.css defines no such pair`,
      ).toBe(true);
    }
  });

  /**
   * The trap that cost this branch a broken production preview.
   *
   * Next 16.2.11 accepts `experimental.viewTransition` and its own bundled docs
   * describe React's `<ViewTransition>`. But the flag does NOT switch to the
   * React build that implements it (needs-experimental-react.js keys off
   * taint / transitionIndicator / gestureTransition), and BOTH bundled React
   * builds export the symbol, so `typeof React.ViewTransition === "function"`
   * is true either way and feature detection cannot save you. Rendering it on
   * the shipped reconciler throws React #306 and the error boundary blanks the
   * page, after typecheck, lint and 1700 unit tests all pass.
   */
  it("nobody renders React's ViewTransition component", () => {
    const offenders = FILES.filter((f) => {
      // The orchestrator's own header comment quotes the component name while
      // explaining why it is not used.
      if (f.rel === "lib/motion/view-transitions.tsx") return false;
      // `<ViewTransition ` or `<ViewTransition>` but NOT `<ViewTransitions />`,
      // which is this repo's own orchestrator.
      return /<ViewTransition(?!s)[\s/>]/.test(f.src);
    }).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it("the experimental viewTransition flag stays off", () => {
    const config = readFileSync(join(WEB_ROOT, "next.config.ts"), "utf8");
    const uncommented = config
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(uncommented).not.toMatch(/viewTransition:\s*true/);
  });

  /**
   * Belt and braces alongside the component check above: the symbol should not
   * even be imported.
   */
  it("nobody imports ViewTransition from react", () => {
    const offenders = FILES.filter((f) =>
      /import\s*\{[^}]*\bViewTransition\b[^}]*\}\s*from\s*["']react["']/.test(
        f.src,
      ),
    ).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  /**
   * `display: none` on an old chrome snapshot is only safe when a NEW snapshot
   * of the same name is guaranteed on the other side. It never was: the app
   * topbar's More dropdown and the mobile sheet link to five (marketing)
   * destinations (/lst, /audit, /methodology, /status, /faq), all tagged
   * data-vt, and marketing renders `marketing-nav` rather than `app-topbar`.
   * Crossing that boundary made the header vanish in one frame.
   */
  it("never drops an old chrome snapshot", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    expect(css).not.toMatch(/::view-transition-old\((?:app-topbar|app-tabbar|marketing-nav)\)[^{]*\{[^}]*display:\s*none/);
  });

  /**
   * Selection suppression is a touch fix. Ungated it made the text inside every
   * link unselectable with a mouse, including the on-chain tx signature on an
   * audit receipt, whose entire purpose is that a reader can copy and check it.
   */
  it("suppresses text selection only on coarse pointers", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    const idx = css.indexOf("user-select: none");
    expect(idx).toBeGreaterThan(-1);
    // The nearest enclosing at-rule above it must be the coarse-pointer query.
    const before = css.slice(0, idx);
    expect(before.lastIndexOf("@media (pointer: coarse)")).toBeGreaterThan(
      before.lastIndexOf("@layer base"),
    );
  });

  /**
   * The global `html, *, *::before, *::after` reduced-motion rule cannot reach
   * view-transition pseudo-elements: they are generated on the top layer off
   * :root. Turning transitions on without this block regresses WCAG 2.3.3
   * across every route change.
   */
  it("reduced motion disables view transitions explicitly", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    const block = css.slice(css.indexOf("::view-transition-group(*)"));

    expect(css).toContain("::view-transition-group(*)");
    expect(block).toContain("animation-duration: 0s !important");
    expect(block).toContain("animation-delay: 0s !important");
  });
});
