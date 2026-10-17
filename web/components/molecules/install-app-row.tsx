"use client";

import { useEffect, useRef, useState } from "react";
import { Share, SquarePlus } from "lucide-react";

const DISMISS_KEY = "pegana:install_hint_dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Add to home screen", inside the mobile sheet.
 *
 * Two rules govern this component, and both are about restraint:
 *
 * 1. It is never a modal, a banner, or an interstitial. Install prompts that
 *    interrupt are the most-hated pattern on the mobile web, and Pegana asks
 *    nothing of a first-time visitor. This lives where a user goes when they
 *    are already looking for what else the app can do.
 * 2. It appears once. Dismissing it is remembered, and it never returns.
 *
 * `tabIndex` is threaded from the sheet rather than defaulted, because
 * `.mobile-menu-dialog` keeps `display: block` through a 500ms `allow-discrete`
 * exit transition after close(). Every other row in that sheet gates on
 * `open ? 0 : -1` for that reason; a row that does not stays tabbable while the
 * menu is visibly closing.
 *
 * Two platforms, two mechanics. Chromium fires `beforeinstallprompt`, which can
 * be captured and replayed on a real user gesture. Safari has no such event and
 * never will, so iOS gets the instruction instead: Share, then Add to Home
 * Screen. Showing a button that does nothing on iOS would be worse than showing
 * nothing.
 */
export function InstallAppRow({ tabIndex = 0 }: { tabIndex?: number } = {}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  // `BeforeInstallPromptEvent.prompt()` is single-use: a second call rejects.
  // `dismiss()` only runs after `userChoice` settles, which waits on the user
  // answering the native dialog, so between the tap and that dialog appearing
  // there is a wide double-tap window where the handler can re-enter with the
  // same event.
  const prompting = useRef(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }

    // Already installed: standalone display mode, or iOS's own legacy flag.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setDismissed(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari only. Chrome and Firefox on iOS also report as WebKit but
    // cannot install, so they are excluded by the CriOS/FxiOS check.
    const ua = navigator.userAgent;
    const isIosSafari =
      /iP(hone|ad|od)/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    setIosHint(isIosSafari);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // A browser that refuses storage simply gets the row again next visit,
      // which is a better failure than crashing the sheet.
    }
  };

  if (dismissed) return null;
  if (!deferred && !iosHint) return null;

  if (deferred) {
    return (
      <button
        type="button"
        onClick={async () => {
          if (prompting.current) return;
          prompting.current = true;
          try {
            await deferred.prompt();
            await deferred.userChoice;
            dismiss();
          } catch {
            // An install prompt that will not open is not worth an error
            // report, and swallowing it here is what keeps a double tap from
            // surfacing as an unhandled rejection.
          } finally {
            prompting.current = false;
          }
        }}
        tabIndex={tabIndex}
        className="group mt-4 flex min-h-12 w-full items-center gap-3 rounded-full border border-hairline px-4 text-left text-[14px] text-text-muted transition-colors duration-300 ease-default hover:border-outline hover:text-text"
      >
        <SquarePlus className="h-4 w-4 shrink-0" aria-hidden strokeWidth={1.7} />
        Install Pegana
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-[16px] border border-hairline px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] text-text-muted">
        <Share className="h-4 w-4 shrink-0" aria-hidden strokeWidth={1.7} />
        <span>
          Add to Home Screen from the share menu for a full-screen Pegana.
        </span>
      </p>
      <button
        type="button"
        onClick={dismiss}
        tabIndex={tabIndex}
        // 115.6x15px measured — the one control in the sheet with no touch
        // target floor (rows are min-h-14, search and the Install CTA min-h-12).
        // The negative inline margin keeps the 10px type optically flush with
        // the copy above while the box itself clears 44px.
        className="-mx-1 mt-1 inline-flex min-h-11 items-center px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption transition-colors duration-200 hover:text-text"
      >
        Do not show again
      </button>
    </div>
  );
}
