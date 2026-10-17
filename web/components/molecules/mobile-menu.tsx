"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useGlossary } from "@/lib/store/glossary-context";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { InstallAppRow } from "@/components/molecules/install-app-row";

export interface MobileMenuLink {
  href: string;
  label: string;
  external?: boolean;
}

/**
 * A labelled group of destinations.
 *
 * The app sheet used to be a flat index of every route, whose first four
 * entries were the four tabs already sitting in the bottom bar. Repeating the
 * primary navigation inside the secondary navigation makes the sheet feel like
 * a sitemap and gives the user two ways to do the same thing and no way to see
 * what else exists. Grouping is what turns a list of links into a menu.
 */
export interface MobileMenuSection {
  /** Mono uppercase caption above the group. Omit for an unlabelled group. */
  label?: string;
  items: MobileMenuLink[];
}

interface MobileMenuProps {
  /** Flat list. Kept for the marketing header, which has no grouping to do. */
  links?: MobileMenuLink[];
  /** Grouped list. Takes precedence over `links` when both are supplied. */
  sections?: MobileMenuSection[];
  ctaHref?: string;
  ctaLabel?: string;
  panelTopClassName?: string;
  /**
   * Which viewports the sheet exists on. The app chrome switches at `lg`
   * (1024px); the marketing nav's link row stops fitting inside its glass pill
   * at 920px, so it passes `navpill:hidden`. Hardcoding `lg:hidden` here is why
   * marketing could not reuse this component and grew a weaker drawer of its
   * own instead.
   */
  breakpointClassName?: string;
  /**
   * Extra classes for the TRIGGER button only. Exists for optical alignment:
   * the button is a 44px touch target around a 16px glyph, so it carries 14px
   * of dead space on each side that nothing compensates. Measured on iPhone 13
   * against production, the app topbar put its logo 16px from the left edge and
   * this glyph 30px from the right — the two sides of the same bar, off by
   * nearly 2x, which is what "crooked" looked like.
   *
   * The right compensation depends on the CONTAINER's padding, not on this
   * component, so each call site passes its own negative margin. The 44px
   * target is preserved; only the box shifts.
   */
  triggerClassName?: string;
  /**
   * Position classes for the CLOSE (X) button. It is `fixed`, so it is
   * viewport-relative and knows nothing about which bar it sits under — it was
   * hardcoded to `right-5 top-4` and therefore landed in the wrong place on
   * BOTH surfaces, in opposite directions.
   *
   * Measured on iPhone 13 against production: the X's centre was y=38 while the
   * app topbar centres at 27.5 and the marketing pill at 49. Its glyph sat 28px
   * from the right edge while the hamburger it replaces sits at 16px. So
   * opening the menu made the mark jump down and to the left.
   *
   * The X must land exactly where the hamburger was, or the swap reads as the
   * page lurching. Each call site knows its own bar's geometry, so each passes
   * its own value.
   */
  closeClassName?: string;
  /**
   * Extra classes for the PANEL. The app surface uses it to reserve the
   * floating tab bar's band at the bottom.
   *
   * Measured on iPhone 13: the app sheet's panel ran to y=664, exactly the
   * dialog's own bottom, so (a) its last ~72px sat behind the tab bar and
   * (b) there was ZERO backdrop left — tap-outside-to-dismiss, which this
   * component builds a control for, could never fire there. Marketing was
   * fine (134px of backdrop) only because its four items do not fill the band.
   *
   * `--app-tabbar-h` is defined at :root on both surfaces, so its presence
   * cannot distinguish them; the call site knows whether a bar exists.
   */
  panelClassName?: string;
  /** Rendered under the links, e.g. the marketing header's two CTA pills. */
  footer?: ReactNode;
  /** When true, renders a "Glossary" item that opens the GlossarySheet
   *  instead of navigating. */
  showGlossary?: boolean;
  /** When provided, renders a full-width "Search assets" row as the first
   *  sheet item (the only global search affordance on mobile — Cmd-K and the
   *  topbar Search are desktop-only). Optional so the marketing header, which
   *  has no command palette mounted, simply omits it. */
  searchAction?: () => void;
}

export function MobileMenu({
  links,
  sections,
  ctaHref,
  ctaLabel,
  panelTopClassName = "top-[88px]",
  breakpointClassName = "lg:hidden",
  triggerClassName,
  closeClassName = "right-5 top-[calc(1rem+env(safe-area-inset-top))]",
  panelClassName,
  footer,
  showGlossary = false,
  searchAction,
}: MobileMenuProps) {
  const groups: MobileMenuSection[] =
    sections ?? (links ? [{ items: links }] : []);
  const [open, setOpen] = useState(false);
  const { setOpen: setGlossaryOpen } = useGlossary();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dialogId = "mobile-menu-dialog";
  // A one-shot action to run AFTER the native dialog has closed + left the top
  // layer — e.g. opening the command palette from the "Search assets" row.
  // Running it synchronously alongside close() painted the next modal
  // UNDERNEATH this still-closing native <dialog> (it stays promoted in the
  // browser top layer for the exit transition), so the search appeared dead for
  // ~500ms on mobile (QA audit 2026-07-23).
  const afterCloseRef = useRef<(() => void) | null>(null);
  // Whether the sheet is being dismissed by touch/mouse rather than the
  // keyboard. A native <dialog> restores focus to its invoker on close, and
  // WebKit treats that programmatic restore as :focus-visible even when the
  // user only ever tapped — so the trigger came back wearing a focus ring that
  // stayed on screen. Keyboard dismissal (Escape, or Enter on the X) must keep
  // the ring: that user needs to know where focus went.
  const pointerDismissRef = useRef(false);

  // Body scroll-lock while open. Native <dialog> does NOT lock body scroll on
  // its own, so this stays. NOTE: we deliberately do NOT auto-close on
  // touchmove/wheel/pointermove — the body is already locked, so a scroll
  // gesture inside the panel must scroll the panel, not slam the menu shut
  // (that made the sheet feel broken on touch).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousBodyStyles = {
      overflow: document.body.style.overflow,
      width: document.body.style.width,
    };
    const previousRootStyles = {
      overflow: root.style.overflow,
    };
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.width = "100%";
    return () => {
      root.style.overflow = previousRootStyles.overflow;
      document.body.style.overflow = previousBodyStyles.overflow;
      document.body.style.width = previousBodyStyles.width;
    };
  }, [open]);

  // Drive the native dialog from React state. showModal()/close() give us
  // focus-trap + inert background + Esc-to-close for free — no more manual
  // Tab-trap, inert-siblings, or keydown handler. Guard both calls so a
  // re-run of this effect never double-invokes them on an already-open (or
  // already-closed) dialog.
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    if (open) {
      pointerDismissRef.current = false;
      if (!dialogEl.open) dialogEl.showModal();
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  }, [open]);

  // Covers every native close path in one place — Esc, a real backdrop
  // click, or our own dialogEl.close() above all end here.
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    const onClose = () => {
      setOpen(false);
      // Runs after the platform has handed focus back to the trigger.
      if (pointerDismissRef.current) {
        const trigger = triggerRef.current;
        requestAnimationFrame(() => {
          if (document.activeElement === trigger) trigger?.blur();
        });
      }
      pointerDismissRef.current = false;
      // Run the queued after-close action now that the dialog has left the top
      // layer; rAF lets the current frame's top-layer removal settle first.
      const pending = afterCloseRef.current;
      afterCloseRef.current = null;
      if (pending) requestAnimationFrame(pending);
    };
    dialogEl.addEventListener("close", onClose);
    return () => dialogEl.removeEventListener("close", onClose);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open menu"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        className={cn(
          "relative z-50 inline-flex h-11 w-11 appearance-none items-center justify-center rounded-full text-text transition-[color,opacity] duration-300 ease-default hover:text-text/70",
          "outline-none focus-visible:ring-2 focus-visible:ring-text-muted",
          breakpointClassName,
          triggerClassName,
          open && "pointer-events-none opacity-0",
        )}
      >
        <span
          className={cn(
            "absolute h-px w-4 bg-current transition-transform duration-300 ease-out",
            open ? "translate-y-0 rotate-45" : "-translate-y-1.5",
          )}
        />
        <span
          className={cn(
            "absolute h-px w-4 bg-current transition-opacity duration-200",
            open ? "opacity-0" : "opacity-100",
          )}
        />
        <span
          className={cn(
            "absolute h-px w-4 bg-current transition-transform duration-300 ease-out",
            open ? "translate-y-0 -rotate-45" : "translate-y-1.5",
          )}
        />
      </button>

      {/* Native <dialog>: top-layer promotion means this no longer needs a
          createPortal(document.body, …) escape hatch to clear header
          stacking contexts — the dialog paints above everything regardless
          of where it sits in the tree. It's sized to the exact bottom-sheet
          bounds (below the header) rather than the full viewport, so the
          header itself stays visually undimmed, matching the previous
          portal implementation. The floating close-X lives *inside* the
          dialog (positioned back up over the header band via `fixed`) so it
          stays reachable — anything outside the dialog subtree is made
          inert while the dialog is modal. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions,
                        jsx-a11y/click-events-have-key-events,
                        jsx-a11y/no-autofocus --
          Native <dialog>: the onClick is backdrop-dismiss (it fires only when
          the target IS the dialog element itself, i.e. the ::backdrop), and the
          platform already closes it on Escape — a keyboard listener here would
          be redundant, not additive. autoFocus is the CORRECT behaviour for a
          modal: focus must enter the dialog on open or a keyboard user is left
          behind it. All three are the accessible choice, not an exemption from
          accessibility. */}
      <dialog
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        autoFocus
        onPointerDown={() => {
          pointerDismissRef.current = true;
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className={cn(
          "mobile-menu-dialog fixed inset-x-0 bottom-0 z-[100]",
          breakpointClassName,
          panelTopClassName,
        )}
      >
        {open && (
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className={cn(
              // `appearance-none` because WebKit computes appearance:button
              // here and paints native chrome. `rounded-full` + a focus-visible
              // ring because the UA default focus ring is a hard WHITE 3px
              // SQUARE on a 0-radius box — that square, sitting around the X
              // after a tap gives the button focus, is the "quadrado branco"
              // reported from a real phone. Keyboard focus stays visible; it is
              // just round and in a token colour now, and a plain tap no longer
              // paints it.
              "fixed z-[120] inline-flex h-11 w-11 appearance-none items-center justify-center rounded-full text-text transition-colors duration-300 ease-default hover:text-text/70",
              "outline-none focus-visible:ring-2 focus-visible:ring-text-muted",
              closeClassName,
              breakpointClassName,
            )}
          >
            <X className="h-5 w-5" aria-hidden strokeWidth={1.6} />
          </button>
        )}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={close}
          data-mobile-menu-backdrop
          className="absolute inset-0 z-[100] bg-canvas/35"
        />
        {/* Visual reveal (clip-path wipe + opacity) is driven off the
            dialog's native [open] attribute via CSS (see .mobile-menu-dialog
            rules in globals.css), not this `open` React state — see the
            comment above that CSS block for why. */}
        {/* `border-b`, not `border-y`. The panel starts exactly where the
            header ends, so its top border landed directly on the header's
            bottom border: two hairlines stacked into one visibly brighter
            line across the full width, which read as a rendering artifact
            rather than a divider. The header already draws that edge. */}
        <div
          className={cn(
            // `relative`, not `absolute inset-0`. Pinned to the dialog's full
            // band, a four-item marketing menu painted 165px (27.8% of the
            // panel) of dead black below its CTAs. In flow it hugs its content
            // and clamps to the band on the dashboard, which has more rows than
            // fit and scrolls exactly as before. The reveal is clip-path +
            // opacity, so it is indifferent to how the box is positioned.
            //
            // It also revives tap-outside-to-dismiss: the uncovered part of the
            // dialog is now reachable, and the dialog's own onClick closes when
            // the target IS the dialog. Previously the panel covered every
            // pixel and that affordance could never fire.
            "relative z-[110] max-h-full w-full origin-top overflow-y-auto border-b border-hairline bg-canvas shadow-[0_24px_80px_rgba(0,0,0,0.32)]",
            panelClassName,
          )}
          aria-hidden={!open}
          data-mobile-menu-panel
        >
          <nav className="mx-auto flex max-w-[1280px] flex-col px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8">
            {searchAction && (
              <button
                type="button"
                onClick={() => {
                  // Defer the palette open until the dialog's close handler —
                  // see afterCloseRef — so it doesn't open under the closing menu.
                  afterCloseRef.current = searchAction;
                  close();
                }}
                tabIndex={open ? 0 : -1}
                className="group mb-4 flex min-h-12 w-full items-center gap-3 rounded-full border border-outline px-4 text-left text-[15px] text-text-muted transition-colors duration-300 ease-default hover:border-text hover:text-text"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Search className="h-4 w-4" aria-hidden />
                  Search assets
                </span>
              </button>
            )}

            {/* Rows carry `--row-i` so the entrance stagger is computed in
                CSS from the index (see .mobile-menu-dialog rules in
                globals.css). The reveal has to stay driven off the dialog's
                own [open] ATTRIBUTE rather than React state, for the reason
                spelled out above that CSS block, and an attribute-driven
                animation cannot read a React-held index. A custom property
                can. */}
            {groups.map((group, gi) => {
              const captionId = group.label
                ? `mobile-menu-group-${gi}`
                : undefined;
              return (
                <div
                  key={group.label ?? `group-${gi}`}
                  // The caption is the whole point of the restructure: it is
                  // what turns a list of links into a menu. Rendered as a bare
                  // <p> it is decoration only a sighted user gets, and a screen
                  // reader hears one flat run of ten links with the grouping
                  // gone (WCAG 1.3.1). role="group" + aria-labelledby ties them
                  // together. axe has no rule for "caption not associated with
                  // the list beneath it", so nothing in the suite would have
                  // caught this.
                  role={group.label ? "group" : undefined}
                  aria-labelledby={captionId}
                  className={cn(
                    "border-t border-hairline",
                    // On marketing the first group opens the panel, so this
                    // hairline sat 20px below the edge dividing nothing. The
                    // app sheet keeps it: there it separates the list from the
                    // search field above.
                    gi === 0 && !group.label && !searchAction && "border-t-0",
                  )}
                >
                  {group.label && (
                    <p
                      id={captionId}
                      className="px-1 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-text-caption"
                    >
                      {group.label}
                    </p>
                  )}
                  {group.items.map((l, i) => {
                      return (
                      <Link
                        key={l.href + l.label}
                        href={l.href}
                        target={l.external ? "_blank" : undefined}
                        rel={l.external ? "noreferrer" : undefined}
                        // Everything reachable from the menu is a peer
                        // destination, so it crossfades. External links leave
                        // the document and the type is simply ignored.
                        data-vt="nav-lateral"
                        onClick={close}
                        tabIndex={open ? 0 : -1}
                        data-mobile-menu-row
                        style={
                          { "--row-i": gi * 3 + i } as React.CSSProperties
                        }
                        className="group flex min-h-14 items-center justify-between gap-3 border-b border-hairline text-[17px] font-medium tracking-[-0.01em] text-text transition-[padding] duration-300 ease-default hover:pl-2"
                      >
                        {/* No icon. The set (a flask for methodology, a
                            scroll for the audit ledger, waypoints for Loop)
                            was semantically scattered and read as decoration
                            rather than as a family. The section labels and
                            dividers are what turn this into a menu; the glyphs
                            added noise to an editorial surface, not structure. */}
                        <span className="min-w-0 truncate">{l.label}</span>
                        <IconArrowRight
                          size={14}
                          className="shrink-0 text-text-muted transition-transform duration-300 group-hover:translate-x-1"
                        />
                      </Link>
                    );
                  })}
                  {showGlossary && gi === groups.length - 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setGlossaryOpen(true);
                      }}
                      tabIndex={open ? 0 : -1}
                      data-mobile-menu-row
                      style={
                        {
                          "--row-i": gi * 3 + group.items.length,
                        } as React.CSSProperties
                      }
                      className="group flex min-h-14 w-full items-center justify-between border-b border-hairline text-left text-[17px] font-medium tracking-[-0.01em] text-text transition-[padding] duration-300 ease-default hover:pl-2"
                    >
                      Glossary
                      <IconArrowRight
                        size={14}
                        className="text-text-muted transition-transform duration-300 group-hover:translate-x-1"
                      />
                    </button>
                  )}

                </div>
              );
            })}

            <InstallAppRow tabIndex={open ? 0 : -1} />

            {footer}

            {ctaHref && ctaLabel && (
              <Link
                href={ctaHref}
                target={ctaHref.startsWith("http") ? "_blank" : undefined}
                rel={ctaHref.startsWith("http") ? "noreferrer" : undefined}
                onClick={close}
                tabIndex={open ? 0 : -1}
                className="group mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-text px-6 py-3 text-center text-[13px] font-medium text-canvas transition-colors duration-300 ease-default hover:bg-text/85"
              >
                <span>{ctaLabel.replace(/\s*→\s*$/, "")}</span>
                <IconArrowRight
                  size={12}
                  className="transition-transform duration-300 group-hover:translate-x-0.5"
                />
              </Link>
            )}
          </nav>
        </div>
      </dialog>
    </>
  );
}
