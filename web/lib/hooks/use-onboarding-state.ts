"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pegana:onboarding_v1";
const REOPEN_EVENT = "pegana:onboarding:reopen";

/**
 * Fire-and-forget reopener. Lets a "How it works" affordance anywhere on the
 * page (e.g. the app topbar) reopen the walkthrough without sharing state with
 * the hook instance that owns the modal. Clears the dismissed flag so the
 * auto-open gate fires if the modal isn't mounted on the current route yet
 * (the affordance navigates to /dashboard where OnboardingModal lives), and
 * dispatches the event so it opens immediately when the modal IS mounted.
 */
export function reopenOnboarding() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — localStorage may be disabled (private mode)
  }
  window.dispatchEvent(new Event(REOPEN_EVENT));
}

interface OnboardingState {
  /** Modal is currently open (first visit + not yet dismissed, or reopened manually). */
  open: boolean;
  /** True after the localStorage check has run on the client. Render gates use this. */
  hydrated: boolean;
  /** Permanently dismiss for this user (writes localStorage). */
  dismiss: () => void;
  /** Reopen the modal regardless of dismissed state — for a "Show guide" footer link. */
  reopen: () => void;
  /** Close without dismissing (rare; used during programmatic transitions). */
  close: () => void;
}

export function useOnboardingState(): OnboardingState {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    // Guarded like every other localStorage touch in this hook (#R4-11): the
    // `window.localStorage` getter itself throws SecurityError when site
    // storage is fully blocked (Chrome "block all cookies", enterprise DOM-
    // storage policy). Unwrapped, this effect would throw before setOpen /
    // addEventListener run and bubble to the ROOT error boundary — blanking the
    // whole dashboard (OnboardingModal is unwrapped under app/(app), which has
    // no error.tsx). Treat a throw as "not dismissed" (show the guide), same as
    // whats-new-popup.tsx.
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(STORAGE_KEY) === "dismissed";
    } catch {
      // localStorage blocked (private mode / cookies off) — treat as not dismissed
    }
    // First-ever visit auto-opens on EVERY viewport, including mobile (the
    // dominant device). The modal is fully responsive — below `md` it renders
    // as a near-fullscreen scrolling sheet — so the old `narrowScreen` gate
    // that skipped it under 1024px was silently hiding the walkthrough from
    // most visitors.
    if (!dismissed) setOpen(true);

    const handler = () => setOpen(true);
    window.addEventListener(REOPEN_EVENT, handler);
    return () => window.removeEventListener(REOPEN_EVENT, handler);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {
      // localStorage may be disabled (private mode); modal still closes for the session
    }
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const reopen = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setOpen(true);
  }, []);

  return { open, hydrated, dismiss, reopen, close };
}
