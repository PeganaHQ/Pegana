"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { withViewTransition } from "@/lib/motion/view-transitions";

/**
 * The one pagination. Four surfaces had grown their own copy of the same
 * `useState` + `array.slice` (dashboard board, /assets screener, /events
 * clusters, /lst directory), and the copies had already drifted:
 *
 *   - two announced page changes through `<nav aria-live>`, two through a
 *     separate `sr-only role="status"` twin;
 *   - two clamped the page, two trusted it;
 *   - two reset on filter change, /events never did;
 *   - none put the page in the URL, so a page was unshareable and survived
 *     neither a reload nor a back button;
 *   - none moved the viewport, so paging a table you had scrolled past
 *     silently changed rows you could not see.
 *
 * All of that is fixed once, here.
 *
 * Paging is a same-place-different-content change, so it gets its OWN
 * transition kinds (`page-next` / `page-prev`), shorter and shallower than a
 * route push. This is the same place showing different rows, not a new place.
 */
export type PageDirection = "next" | "prev";

export interface UsePaginationOptions<T> {
  /** The already filtered and sorted collection. */
  items: readonly T[];
  /** Rows per page. */
  pageSize: number;
  /**
   * Serialized filter/sort state. When it changes the page resets to 1, so the
   * view never starts mid-list after a shuffle. Build it with template literals
   * from the same values the list is derived from.
   */
  resetKey?: string;
  /**
   * Mirror the page into `?page=` so it survives a reload, a share and the back
   * button. Off for surfaces that are embedded in a page owning its own query
   * string. Default true.
   */
  syncToUrl?: boolean;
  /** Query-string key. Default "page". */
  paramName?: string;
  /** Noun for the announcement, e.g. "asset". Default "item". */
  itemNoun?: string;
}

export interface Pagination<T> {
  /** Always within [1, totalPages]. */
  page: number;
  totalPages: number;
  /** The current slice. */
  pageItems: T[];
  /** Length of the unsliced collection. */
  total: number;
  /** Which way the last change went. Drives the slide direction. */
  direction: PageDirection;
  hasPrev: boolean;
  hasNext: boolean;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  /**
   * Attach to the element that should be brought back into view on a page
   * change, normally the table's own wrapper. Without it, paging a list you
   * have scrolled past changes rows that are off-screen.
   */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  /** "Page 2 of 7 · 68 assets" — one string, one phrasing, everywhere. */
  label: string;
}

export function usePagination<T>({
  items,
  pageSize,
  resetKey,
  syncToUrl = true,
  paramName = "page",
  itemNoun = "item",
}: UsePaginationOptions<T>): Pagination<T> {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlPage = (() => {
    if (!syncToUrl) return 1;
    const raw = Number(params?.get(paramName));
    return Number.isInteger(raw) && raw > 0 ? raw : 1;
  })();

  const [page, setPage] = useState(urlPage);
  const [direction, setDirection] = useState<PageDirection>("next");
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp on read rather than in an effect. An effect would render one frame of
  // an out-of-range page first, which on a filter change is a visible flash of
  // an empty table.
  const current = Math.min(Math.max(1, page), totalPages);

  // Reset to page 1 whenever the underlying list is reshuffled.
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    setDirection("prev");
    setPage(1);
  }, [resetKey]);

  // Mirror into the URL. `scroll: false` because this hook does its own,
  // more precise scrolling (to the table, not to the top of the document).
  useEffect(() => {
    if (!syncToUrl || !pathname) return;
    // Nothing to page yet. `items` is [] on the first render of every consumer
    // (useAssets has keepPreviousData but no fallbackData), so totalPages is 1,
    // `current` clamps to 1, and this effect would "correct" the URL by
    // STRIPPING a perfectly good ?page=3 the user arrived with, then put it
    // back a few hundred ms later once the fetch lands. Anyone who copies the
    // address bar in that window shares a link to page 1, which is precisely
    // the failure this URL sync exists to prevent.
    if (total === 0) return;
    const sp = new URLSearchParams(params?.toString() ?? "");
    const currentParam = sp.get(paramName);
    const want = current > 1 ? String(current) : null;
    if (currentParam === want) return;
    if (want) sp.set(paramName, want);
    else sp.delete(paramName);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [current, total, pathname, params, paramName, router, syncToUrl]);

  const goToPage = useCallback(
    (next: number) => {
      const target = Math.min(Math.max(1, next), totalPages);
      if (target === current) return;
      const dir: PageDirection = target > current ? "next" : "prev";

      // The DOM swap has to happen INSIDE the transition callback, and
      // synchronously: startViewTransition snapshots when its callback
      // returns, so a batched React update would land after the snapshot and
      // the "new" frame would be identical to the old one. withViewTransition
      // handles the flushSync and the data-vt stamp, and degrades to a plain
      // update where the API is unsupported.
      withViewTransition(dir === "next" ? "page-next" : "page-prev", () => {
        setDirection(dir);
        setPage(target);
      });

      // Bring the list back into view. Deferred to the next frame so it runs
      // after the transition has captured the outgoing snapshot; scrolling
      // during capture makes the old frame render at the wrong offset.
      requestAnimationFrame(() => {
        const el = anchorRef.current;
        if (!el) return;
        const top = el.getBoundingClientRect().top;
        // Already comfortably on screen: leave the viewport alone rather than
        // yanking it for a change the user can see.
        if (top >= 0 && top < 240) return;
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    [current, totalPages],
  );

  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize) as T[],
    [items, current, pageSize],
  );

  const noun = total === 1 ? itemNoun : `${itemNoun}s`;

  return {
    page: current,
    totalPages,
    pageItems,
    total,
    direction,
    hasPrev: current > 1,
    hasNext: current < totalPages,
    goToPage,
    nextPage: useCallback(() => goToPage(current + 1), [goToPage, current]),
    prevPage: useCallback(() => goToPage(current - 1), [goToPage, current]),
    anchorRef,
    label: `Page ${current} of ${totalPages} · ${total} ${noun}`,
  };
}
