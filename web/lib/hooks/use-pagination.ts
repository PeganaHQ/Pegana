"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { replaceQuery } from "@/lib/url/replace-query";
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
 *   - (the page deliberately lives in React state only: mirroring it into
 *     `?page=` with router.replace cost an RSC round-trip and a re-render per
 *     click, which read as a page reload, so there is no URL state at all);
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
  itemNoun = "item",
}: UsePaginationOptions<T>): Pagination<T> {
  const [page, setPage] = useState(1);
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

  // Legacy links may still carry `?page=N`. It is no longer read; strip it with
  // the native History API (no router call, so no RSC round-trip).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("page")) return;
    sp.delete("page");
    replaceQuery(sp);
  }, []);

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
