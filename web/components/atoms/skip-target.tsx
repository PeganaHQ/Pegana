/**
 * Landing point for the root layout's "Skip to content" link.
 *
 * MUST be rendered AFTER the nav/banner chrome, by whichever layout owns that
 * chrome. Putting it around `{children}` in the root layout does not work —
 * `{children}` is the group layout, which renders the banner and nav as its
 * first elements, so focus lands BEFORE the nav and the next Tab goes right
 * back into it. That is a skip link that skips nothing.
 *
 * `tabIndex={-1}` is load-bearing: without it the browser scrolls to the anchor
 * but leaves focus where it was, so the very next Tab returns to the nav.
 * Programmatic focusability is what actually MOVES focus past the chrome.
 *
 * Rendered as a zero-height marker rather than a wrapper so it cannot disturb
 * any page's layout or introduce a stacking context.
 */
export function SkipTarget() {
  return <div id="main-content" tabIndex={-1} />;
}
