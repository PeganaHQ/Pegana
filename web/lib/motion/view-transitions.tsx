"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";

/**
 * View transitions, on the browser's own API.
 *
 * WHY NOT REACT'S `<ViewTransition>` — this is the whole reason this file
 * exists, and reverting to the React component will break production again.
 *
 * Next 16.2.11 accepts `experimental.viewTransition: true` and its bundled
 * docs describe `<ViewTransition>` and `<Link transitionTypes>`. Both are real.
 * But the component only WORKS on React's experimental build, and
 * `next/dist/lib/needs-experimental-react.js` selects that build from
 * `taint || transitionIndicator || gestureTransition` only. `viewTransition` is
 * not on that list, so the flag turns on the config and not the reconciler.
 *
 * The failure is nasty: BOTH bundled React builds export the `ViewTransition`
 * symbol (verified in their cjs bundles), so `typeof React.ViewTransition ===
 * "function"` is true either way and feature detection is worthless. Only the
 * reconciler differs. On the stable one, rendering it throws React #306 and the
 * error boundary eats the entire page. It typechecks, it lints, it passes 1700
 * unit tests, and then /dashboard is a 500 in production. That is exactly what
 * happened on the first preview of this branch.
 *
 * Enabling the experimental React channel to get it back would mean shipping an
 * experimental reconciler to every visitor of a product whose pitch is that its
 * numbers can be trusted, in exchange for an animation, and relying on an
 * undocumented side effect of an unrelated flag to do it. Not a good trade.
 *
 * So this drives `document.startViewTransition` directly. It needs no React
 * feature, works on any Next version, gives the same shared-element morph via
 * plain `view-transition-name` CSS, and browsers without the API simply do not
 * animate.
 *
 * HOW IT WORKS
 * Clicks on `a[data-vt]` are intercepted in the capture phase. The navigation
 * runs inside the transition callback, and the callback's promise is held open
 * until the route actually commits (App Router navigation is async, so
 * resolving immediately would capture the OLD DOM as the "new" snapshot and
 * animate nothing). A timeout keeps a slow or failed navigation from freezing
 * the page under a stuck transition.
 */

export type TransitionKind = "nav-forward" | "nav-back" | "nav-lateral";

/** The attribute a link carries to opt into a directional transition. */
export const VT_ATTR = "data-vt";

/**
 * How long to hold the transition open waiting for the route to commit. Past
 * this the transition resolves anyway: a missed animation is a non-event, a
 * frozen page is not.
 */
const COMMIT_TIMEOUT_MS = 900;

export function supportsViewTransitions(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function"
  );
}

/**
 * Run a same-document DOM update inside a view transition.
 *
 * `flushSync` is required: `startViewTransition` snapshots the DOM when its
 * callback returns, and React would otherwise batch the update to after that,
 * so the "new" snapshot would be identical to the old one and nothing would
 * animate. Used by pagination, which is a pure client state change.
 */
export function withViewTransition(kind: string, update: () => void): void {
  if (!supportsViewTransitions()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  void transition.finished.finally(() => {
    delete root.dataset.vt;
  });
}

/**
 * Mount once per route group. Owns click interception and the transition
 * lifecycle for navigations.
 */
export function ViewTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  /**
   * The in-flight transition, tagged with the route it is waiting for.
   *
   * This used to be a bare `(() => void) | null`, resolved by ANY change to
   * pathname or searchParams. That is wrong twice over. A `router.replace` on
   * the page you are leaving (a sort header, the pagination URL sync) changes
   * searchParams while the new route is still in flight, and would resolve a
   * transition that had not committed: the browser then captures its "new"
   * snapshot from the OLD page, animates to the wrong content, and the real
   * destination pops in with no animation at all. And two quick clicks on
   * different links would leave the first one's resolver overwritten, so it
   * hung for the full timeout.
   *
   * Tagging fixes both: a pending transition only resolves when the route it
   * asked for is the one that actually committed.
   */
  const pendingRef = useRef<{
    pathname: string;
    search: string;
    finish: () => void;
  } | null>(null);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.pathname !== pathname) return;
    // Only compare the query when the target had one. A push to /events must
    // not wait for the query string it inherited to match.
    if (pending.search && pending.search !== (searchParams?.toString() ?? "")) {
      return;
    }
    pendingRef.current = null;
    pending.finish();
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!supportsViewTransitions()) return;

    const onClick = (event: MouseEvent) => {
      // Anything the browser would handle specially stays the browser's.
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;

      const anchor = (event.target as Element | null)?.closest?.(`a[${VT_ATTR}]`);
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // A pure hash change is the browser scrolling, not a navigation.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      )
        return;

      const kind = anchor.getAttribute(VT_ATTR);
      if (!kind) return;

      event.preventDefault();

      // A second click supersedes the first. Release the old one now rather
      // than leaving it to time out, or the browser holds a frozen snapshot of
      // a page nobody is going to for up to COMMIT_TIMEOUT_MS.
      pendingRef.current?.finish();
      pendingRef.current = null;

      const root = document.documentElement;
      root.dataset.vt = kind;

      const transition = document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              window.clearTimeout(timer);
              resolve();
            };
            const timer = window.setTimeout(finish, COMMIT_TIMEOUT_MS);
            pendingRef.current = {
              pathname: url.pathname,
              search: url.searchParams.toString(),
              finish,
            };
            startTransition(() => {
              router.push(`${url.pathname}${url.search}${url.hash}`);
            });
          }),
      );

      void transition.finished.finally(() => {
        if (root.dataset.vt === kind) delete root.dataset.vt;
      });
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      // Never unmount holding a transition open: the callback promise would
      // never resolve and the page would sit under a frozen snapshot.
      pendingRef.current?.finish();
      pendingRef.current = null;
    };
  }, [router, startTransition]);

  return null;
}
