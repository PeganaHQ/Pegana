/**
 * Rewrite the current URL's query string (and optionally drop params) through
 * the native History API, with no server round-trip.
 *
 * The state argument MUST be `null`. Next's patched `history.replaceState`
 * (next/dist/client/components/app-router.js) skips the `useSearchParams`
 * sync when the state object carries `__NA` or `_N`, which is exactly what
 * `window.history.state` holds. Passing it through would update the address
 * bar but leave every `useSearchParams` reader stale.
 */
export function replaceQuery(sp: URLSearchParams): void {
  if (typeof window === "undefined") return;
  const qs = sp.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
  );
}
