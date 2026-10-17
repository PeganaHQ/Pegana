"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import { reconcileBps, formatGap, isLowLiquidity, spreadSignClass } from "@/lib/api/format";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, PegState } from "@/lib/api/types";

interface AssetPickerProps {
  assets: AssetCardData[];
  selected: string[];
  onChange: (next: string[]) => void;
  max: number;
}

// A single picker that replaces the 8 columns of class-grouped chips with a
// search-driven dropdown. Each option shows current state pip + spread so the
// user picks with eyes-open, not blind by symbol.
export function AssetPicker({
  assets,
  selected,
  onChange,
  max,
}: AssetPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Space between the panel's top and the top of the mobile tab bar.
  //
  // z-index alone cannot fix this: the picker lives inside the app shell's
  // `relative z-10` wrapper, which is its own stacking context, so the panel's
  // z-[60] only competes with its siblings INSIDE that wrapper. The tab bar is
  // outside it and therefore paints above the panel whatever number we write.
  // Measured on production before this: the panel ran to y=762 in a 664px
  // viewport, and an option at the bottom resolved to a tab-bar link under
  // elementFromPoint — a tap aimed at an asset navigated the user away.
  //
  // So constrain the panel instead of fighting the stack. It already scrolls
  // internally, so clamping its height keeps every option above the bar and
  // tappable, at any viewport height, with no portal and no change to the
  // focus or click-outside behaviour.
  const [maxPanelPx, setMaxPanelPx] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Horizontal correction. The panel is `absolute right-0`, so it hangs off the
  // trigger's right edge — and the trigger reflows LEFT as soon as a selected
  // pill lands beside it. Measured at 390px: with 0 selected the panel sits at
  // left=50; with any pill it sits at left=-18, so 18px of every option row
  // (the check/plus column) is off the screen, and
  // `documentElement.scrollWidth === clientWidth`, so nothing can scroll it
  // into view. Same reflow that moved the trigger vertically, in the other axis.
  const [shiftX, setShiftX] = useState(0);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus search input when opened.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Clamp the panel to the space above the tab bar (or the viewport bottom on
  // desktop, where no bar exists). Recomputed on open, resize and scroll.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const bar = document
        .querySelector(".app-tabbar-pill")
        ?.getBoundingClientRect();
      const floor = bar ? bar.top : window.innerHeight;

      // Natural (unshifted) left edge, derived from the anchor rather than from
      // the panel's own rect — reading the shifted rect here would feed its own
      // correction back in on every pass.
      const panelWidth = panelRef.current?.getBoundingClientRect().width ?? 0;
      if (panelWidth > 0) {
        const naturalLeft = trigger.right - panelWidth;
        setShiftX(naturalLeft < 8 ? 8 - naturalLeft : 0);
      }
      // 8px is the panel's own mt-2 offset; 12px is breathing room.
      // NO minimum. A floor here defeats the whole constraint: with the
      // trigger pushed down by wrapped pills the honest clamp is ~145px, and
      // `Math.max(180, …)` overrode it, putting the panel back under the bar —
      // measured 23.4px of overlap at 2 selected and 59.9px at 4, with an
      // option again resolving to a tab-bar link. I wrote that floor in the
      // original fix and it quietly outranked the thing the fix was for.
      //
      // The panel scrolls internally, so less room means fewer visible options,
      // never an untappable one.
      setMaxPanelPx(Math.max(0, floor - trigger.bottom - 8 - 12));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    // A ResizeObserver on the anchor, not just window events. Picking an asset
    // fires neither resize nor scroll: it adds a pill above the trigger, the
    // row wraps to a new line, and the trigger — with the panel CSS-anchored to
    // it — drops ~42px. The panel followed; its clamp did not, so it overshot
    // the tab bar again. Measured on production after the first fix: 2 selected
    // -> 30.5px of overlap, 4 selected -> 59.9px, with options once more
    // resolving to tab-bar links under elementFromPoint. That is the exact
    // scenario the fix was written for, reopened by an under-specified effect.
    //
    // Observing the element covers any cause of movement rather than the list
    // of triggers I happened to think of.
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (!q) return true;
      return `${a.symbol} ${displaySymbol(a.symbol)} ${a.name ?? ""} ${a.class}`
        .toLowerCase()
        .includes(q);
    });
  }, [assets, query]);

  // Constant-time membership check for the options list below, instead of
  // `selected.includes()` (a re-scan of `selected`) on every row.
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(symbol: string) {
    if (selected.includes(symbol)) {
      onChange(selected.filter((s) => s !== symbol));
    } else if (selected.length < max) {
      onChange([...selected, symbol]);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-300",
          open
            ? "border-text text-text"
            : "text-text-muted hover:border-outline hover:text-text",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>＋ Add asset</span>
        <span className="text-text-muted/70">
          {selected.length}/{max}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          // z-[60], above the mobile tab bar's z-50. At z-30 the panel opened
          // UNDER the bar on a phone, and elementFromPoint at an option's own
          // centre resolved to a tab-bar link: a tap aimed at an asset
          // navigated away and discarded the comparison being built. Same
          // class of failure as any CTA that shipped covered by this bar.
          // Stays below the menu sheet (z-[100]).
          // Right-aligned (not left-0) — the trigger sits at the end of an
          // `ml-auto` control bar near the viewport's right edge, so a
          // left-anchored panel would run past the right edge on mobile.
          // Width is also capped to the viewport so it never clips options.
          ref={panelRef}
          style={{
            ...(maxPanelPx != null ? { maxHeight: `${maxPanelPx}px` } : {}),
            ...(shiftX ? { transform: `translateX(${shiftX}px)` } : {}),
          }}
          className="absolute right-0 top-full z-[60] mt-2 flex w-[min(320px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[16px] border border-hairline bg-canvas/95 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.6)] sm:w-[min(360px,calc(100vw-1.5rem))]"
        >
          <div className="border-b border-hairline p-2">
            <label className="flex items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-1.5 font-mono text-[11px] text-text-muted focus-within:border-outline">
              <span aria-hidden className="opacity-70">
                ⌕
              </span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by symbol, name, class…"
                className="w-full bg-transparent text-text outline-none placeholder:text-text-muted"
                aria-label="Search assets"
              />
            </label>
          </div>

          <ul className="max-h-[320px] min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">
                No asset matches.
              </li>
            )}
            {filtered.map((a) => {
              const active = selectedSet.has(a.symbol);
              const disabled = !active && selected.length >= max;
              const bps = reconcileBps(a).bps;
              const state = (a.state ?? "UNKNOWN") as PegState;
              const lowLiq = isLowLiquidity(a.symbol);
              return (
                <li key={a.symbol}>
                  <button
                    type="button"
                    onClick={() => toggle(a.symbol)}
                    disabled={disabled}
                    className={cn(
                      "grid w-full grid-cols-[16px_1fr_auto_auto] items-center gap-2.5 border-b border-hairline px-3 py-2 text-left transition-colors duration-300",
                      active ? "bg-surface-1/60" : "hover:bg-surface-1/40",
                      disabled && "cursor-not-allowed opacity-40",
                    )}
                    role="option"
                    aria-selected={active}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "text-[12px]",
                        active ? "text-text" : "text-text-muted/40",
                      )}
                    >
                      {active ? "✓" : "+"}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <TokenIcon
                        mint={a.mint}
                        symbol={displaySymbol(a.symbol)}
                        klass={a.class}
                        size={20}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-text">
                          {displaySymbol(a.symbol)}
                        </span>
                        {a.name && (
                          <span className="block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
                            {a.name}
                          </span>
                        )}
                      </span>
                    </span>
                    {lowLiq && (
                      <span className="border border-hairline px-1 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-text-muted">
                        thin
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px]">
                      <StatePip
                        state={state}
                        pulse={state !== "PEGGED"}
                        size={4}
                      />
                      {/* Holder convention: `bps` follows reconcileBps
                          (positive = discount, negative = premium) — negate
                          for display so `+` = premium, `−` = discount
                          (matching the board). */}
                      <span className={spreadSignClass(bps)}>
                        {bps != null ? formatGap(-bps) : "-"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
