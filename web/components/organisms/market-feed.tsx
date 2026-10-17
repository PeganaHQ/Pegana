"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { NewsItem } from "@/lib/news/feed";
import {
  DEFAULT_FEED_SETTINGS,
  FEED_SETTINGS_STORAGE_KEY,
  applyFeedSettings,
  emptyNoun,
  feedSource,
  nextFeedSize,
  sanitizeFeedSettings,
  type FeedSettings,
} from "@/lib/news/settings";

/**
 * Floating market feed.
 *
 * The navigation model is taken from tokens.xyz's `floating-market-feed.tsx`
 * (solana-foundation/tokens, MIT), because it is the right shape for this
 * content: a pill parked in the corner that expands a panel ABOVE itself, so
 * the feed is ambient rather than interruptive. A Dialog — which is what this
 * component replaces — blanks the page you were reading to show you headlines
 * you did not ask for.
 *
 * Their behaviours worth keeping, and kept: collapsed pill carries the label and
 * a chevron-up; expanding shrinks the pill to a bare chevron-down so the panel
 * gets the visual weight; an outside pointerdown closes it; motion is skipped
 * under `prefers-reduced-motion`.
 *
 * Two deliberate departures:
 *
 * 1. NO `backdrop-blur`. Theirs leans on it heavily; in this app raw-CSS
 *    backdrop-filter resolves to `none`, so any surface relying on it renders as
 *    an unreadable transparent panel over live data. Menus and drawers here are
 *    opaque by standing rule.
 * 2. It renders on mobile too, sitting above the bottom tab bar. Theirs is
 *    `hidden sm:flex` — desktop only — and mobile is exactly where a corner pill
 *    beats a full-screen modal.
 */
export function MarketFeed() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Why the curated source was skipped, when it was. Drives an honest empty state. */
  const [degraded, setDegraded] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<FeedSettings>(DEFAULT_FEED_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  /** URLs whose thumbnail failed to load — CSP-blocked host, 404, or hotlink ban. */
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** False until the first fetch starts; distinguishes prefetch from a filter click. */
  const didFetchRef = useRef(false);

  // Persisted preferences, read once on the client. Until this lands we render
  // the defaults, so the pill never flashes a different label.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FEED_SETTINGS_STORAGE_KEY);
      if (raw) setSettings(sanitizeFeedSettings(JSON.parse(raw)));
    } catch {
      // Private mode, quota, or a corrupt blob — defaults are already correct.
    }
    setHydrated(true);
  }, []);

  const patch = useCallback((p: Partial<FeedSettings>) => {
    setSettings((prev) => {
      const next = applyFeedSettings(prev, p);
      try {
        window.localStorage.setItem(FEED_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Non-fatal: the session still gets the new setting.
      }
      return next;
    });
  }, []);

  /**
   * Fetch when the page settles — NOT on first open.
   *
   * Opening the panel and then watching a skeleton is what made this feel slow;
   * by the time a reader reaches for it, the data and (more importantly) the
   * thumbnails should already be warm. Deferred to idle so it never competes
   * with the dashboard's own first paint.
   */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    // Idle-defer is right for the FIRST load (it must not compete with the
    // dashboard's first paint) and wrong for every load after it: a filter
    // click that waits up to 2.5s for browser idle, with the previous list
    // still on screen, reads as "the filter does nothing". Measured on
    // production before this change.
    const isUserInitiated = didFetchRef.current;

    const run = async () => {
      didFetchRef.current = true;
      try {
        const url = new URL("/api/news", window.location.origin);
        url.searchParams.set("source", feedSource(settings));
        url.searchParams.set("limit", String(settings.size));
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as {
          data?: NewsItem[];
          curated_skipped?: string;
        };
        if (cancelled) return;
        const next = json.data ?? [];
        setItems(next);
        setFailed(false);
        // The RSS fallback carries no posts by construction, so a posts-only
        // filter over a dead curated source renders an EMPTY panel that reads
        // as "no news" when it means "the source is down". Measured on
        // production: toggling Articles off emptied the panel while the API was
        // returning curated_skipped=http_error 401.
        setDegraded(
          json.curated_skipped && json.curated_skipped !== "empty"
            ? json.curated_skipped
            : null,
        );
        // Warm the thumbnails so expanding the panel paints complete.
        for (const it of next.slice(0, 8)) {
          if (!it.image) continue;
          const img = new window.Image();
          img.referrerPolicy = "no-referrer";
          img.src = it.image;
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    if (isUserInitiated) {
      // Show the skeleton straight away so the panel visibly responds.
      setItems(null);
      setFailed(false);
      void run();
      return () => {
        cancelled = true;
      };
    }

    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(() => void run(), { timeout: 2_500 })
        : window.setTimeout(() => void run(), 1_200);

    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idle as number);
      } else {
        window.clearTimeout(idle as number);
      }
    };
    // Refetching when the filter changes is the point of the filter.
  }, [hydrated, settings]);

  // Outside press closes. `pointerdown` rather than `click` so a drag that
  // starts outside also dismisses, matching the reference behaviour.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (menuOpen) return;
      const t = e.target;
      if (t instanceof Node && !rootRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, menuOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape peels one layer at a time: menu first, then the panel.
      if (menuOpen) setMenuOpen(false);
      else setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, menuOpen]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div
      ref={rootRef}
      className={cn(
        "fixed right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end sm:right-6 lg:right-8",
        // Clears the mobile tab bar; `dvh`-safe because it is bottom-anchored.
        "bottom-[calc(5.25rem+env(safe-area-inset-bottom))] sm:bottom-6",
      )}
    >
      {open && (
        <aside
          aria-label="Market feed"
          /* No `overflow-hidden` on the panel: it clipped the options popover,
             which is anchored in the header and opens downward. Measured at
             390x844 — the third menu row was sliced off at the bottom edge.
             The header and the scroll area clip themselves instead. */
          className="mb-3 flex w-[min(calc(100vw-2rem),24rem)] flex-col rounded-[18px] border border-hairline bg-surface-1 shadow-[0_22px_60px_rgba(0,0,0,0.55)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:zoom-in-95 motion-safe:duration-200 motion-safe:ease-out"
        >
          <header className="flex items-center justify-between gap-2 rounded-t-[18px] border-b border-hairline px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-sans text-[14px] font-medium text-text">
                Latest updates
              </h2>
              <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
                Solana · LSTs · stablecoins
              </p>
            </div>

            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="Feed options"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex size-11 items-center justify-center rounded-full text-text-muted outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-text-muted"
              >
                <Settings2 className="size-4" aria-hidden />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Feed options"
                  className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-[14px] border border-hairline bg-surface-2 shadow-[0_18px_44px_rgba(0,0,0,0.5)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
                >
                  <Toggle
                    label="Articles"
                    checked={settings.showNews}
                    onChange={(v) => patch({ showNews: v })}
                  />
                  <Toggle
                    label="Posts"
                    checked={settings.showPosts}
                    onChange={(v) => patch({ showPosts: v })}
                  />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => patch({ size: nextFeedSize(settings.size) })}
                    className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-hairline px-3.5 text-left text-[13px] text-text outline-none transition-colors hover:bg-text/[0.04] focus-visible:bg-text/[0.04]"
                  >
                    Show
                    <span className="font-mono text-[12px] tabular-nums text-text-muted">
                      {settings.size}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="max-h-[min(20rem,50dvh)] overflow-y-auto overflow-x-hidden rounded-b-[18px] scrollbar-clean">
            {failed ? (
              <p className="px-4 py-10 text-center text-[13px] text-text-muted">
                Couldn&rsquo;t reach the feed. Try again shortly.
              </p>
            ) : items === null ? (
              <ul className="divide-y divide-hairline-soft" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex gap-3 px-4 py-3">
                    <div className="size-12 shrink-0 skeleton-sheen rounded-[10px] bg-text/[0.04]" />
                    <div className="min-w-0 flex-1">
                      <div className="h-3.5 w-4/5 skeleton-sheen rounded bg-text/[0.04]" />
                      <div className="mt-2 h-2.5 w-1/3 skeleton-sheen rounded bg-text/[0.03]" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] text-text-muted">
                  {degraded
                    ? "The curated source is unavailable right now."
                    : `No ${emptyNoun(settings)} right now.`}
                </p>
                {degraded && !settings.showNews && (
                  <button
                    type="button"
                    onClick={() => patch({ showNews: true })}
                    className="mt-3 min-h-11 rounded-full border border-hairline px-4 text-[12px] text-text outline-none transition-colors hover:border-outline focus-visible:ring-2 focus-visible:ring-text-muted"
                  >
                    Show articles instead
                  </button>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-hairline-soft">
                {items.map((item, i) => (
                  <li
                    key={item.url}
                    className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:fill-mode-backwards"
                    // Small stagger so the list assembles instead of snapping.
                    // Capped at 8: past that the delay outlasts the read.
                    style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-3 px-4 py-3 outline-none transition-colors hover:bg-text/[0.03] focus-visible:bg-text/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-muted"
                    >
                      {item.image && !brokenImages.has(item.url) ? (
                        /* Plain <img>, not next/image: these are arbitrary
                           third-party hosts and each would need allow-listing
                           in next.config before the optimiser would touch it. */
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          // A host outside the CSP allow-list (or a dead URL)
                          // must not leave a broken-image glyph in the list.
                          onError={() =>
                            setBrokenImages((prev) => new Set(prev).add(item.url))
                          }
                          className="size-12 shrink-0 rounded-[10px] border border-hairline object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="flex size-12 shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-surface-2 font-mono text-[10px] text-text-caption"
                        >
                          {item.isPost ? "𝕏" : "···"}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13.5px] leading-[1.4] text-text">
                          {item.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
                          <span className="truncate">{item.source}</span>
                          {item.publishedAt && (
                            <>
                              <span aria-hidden>·</span>
                              <time dateTime={item.publishedAt}>
                                {relativeDay(item.publishedAt)}
                              </time>
                            </>
                          )}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}

      <button
        type="button"
        aria-label={open ? "Collapse market feed" : "Expand market feed"}
        aria-expanded={open}
        onClick={() => {
          toggle();
          setMenuOpen(false);
        }}
        className={cn(
          "inline-flex h-11 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface-1 text-text shadow-[0_14px_36px_rgba(0,0,0,0.45)]",
          "outline-none transition-[width,background-color,border-color,transform] duration-200 ease-out",
          "hover:border-outline motion-safe:active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-text-muted",
          open ? "w-11 px-0" : "gap-2 px-4",
        )}
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden />
        ) : (
          <span className="flex items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-[13px] font-medium">
              Latest updates
            </span>
            {/* Quiet count, available because the fetch already happened. */}
            {items !== null && items.length > 0 && (
              <span className="font-mono text-[11px] tabular-nums text-text-caption">
                {items.length}
              </span>
            )}
            <ChevronUp className="size-4" aria-hidden />
          </span>
        )}
      </button>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 text-left text-[13px] text-text outline-none transition-colors hover:bg-text/[0.04] focus-visible:bg-text/[0.04]"
    >
      {label}
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150",
          checked
            ? "border-st-pegged/50 bg-st-pegged/25"
            : "border-hairline bg-surface-1",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-3 rounded-full transition-all duration-150 ease-out",
            checked ? "left-[19px] bg-st-pegged" : "left-[3px] bg-text-caption",
          )}
        />
      </span>
    </button>
  );
}

/**
 * Coarse relative day.
 *
 * ⚠️ This compares the item's timestamp against the CLIENT's clock, so a device
 * whose clock is a day out will mislabel every row. That is tolerated here and
 * nowhere else: peg freshness derives from a server anchor (lib/asset/freshness.ts,
 * after the 2026-07-23 clock-skew incident) because a stale-vs-live verdict is
 * load-bearing. A headline being called "yesterday" instead of "today" is not.
 *
 * An earlier version of this comment claimed the value was server-anchored. It
 * was not, and a comment asserting the safe behaviour while the code does the
 * unsafe one is worse than no comment — it stops the next reader from checking.
 */
function relativeDay(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}
