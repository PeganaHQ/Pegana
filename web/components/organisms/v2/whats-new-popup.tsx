"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

// Dismissible glass toast inviting landing visitors to /whats-new.
// Self-contained + self-cleaning:
//   - auto-retires after EXPIRES_AT
//   - dismiss remembered in localStorage (STORAGE_KEY carries campaign id)
//   - bottom corner, non-modal, never blocks the page

const EXPIRES_AT = Date.parse("2026-09-15T00:00:00Z");
const STORAGE_KEY = "pegana:whats-new-popup:v1-launch";
const SHOW_DELAY_MS = 2000;

export function WhatsNewPopup() {
  const reduced = useAppReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Date.now() >= EXPIRES_AT) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage blocked (private mode) — treat as not dismissed
    }
    if (dismissed) return;

    setMounted(true);
    const showT = window.setTimeout(
      () => setVisible(true),
      reduced ? 0 : SHOW_DELAY_MS,
    );
    return () => window.clearTimeout(showT);
  }, [reduced]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // persistence is best-effort
    }
    window.setTimeout(() => setMounted(false), reduced ? 0 : 320);
  }

  if (!mounted) return null;

  return (
    <div
      role="region"
      aria-label="What's new at Pegana"
      className={cn(
        "fixed inset-x-4 bottom-4 z-[65] mx-auto max-w-[340px] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:mx-0",
        "transition-[transform,opacity] duration-[320ms] ease-[var(--v2-ease)] motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      <div className="relative overflow-hidden rounded-[14px] border border-[var(--v2-line2)] bg-[var(--v2-panel)] px-4 pb-4 pt-3.5 shadow-[0_8px_32px_rgba(0,0,0,.45)] backdrop-blur-[20px]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "var(--v2-iri)", opacity: 0.7 }}
        />

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-[var(--v2-dim)] transition-colors duration-200 hover:bg-white/[0.06] hover:text-[var(--v2-text)]"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--v2-iri)", boxShadow: "0 0 8px 1px rgba(251,111,174,0.5)" }}
          />
          <span className="v2-iri-text font-mono text-[10px] uppercase tracking-[0.14em]">V1 is live</span>
        </div>

        <p className="mt-2.5 text-[13.5px] leading-[1.45] text-[var(--v2-text)]">
          68 assets watched live. Every verdict on-chain and replayable.
        </p>

        <Link
          href="/whats-new"
          onClick={dismiss}
          className="group mt-3 inline-flex items-center gap-1 font-mono text-[11.5px] font-medium uppercase tracking-[0.06em] text-[var(--v2-muted)] transition-colors duration-200 hover:text-[var(--v2-peg)]"
        >
          See what's new
          <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </div>
  );
}
