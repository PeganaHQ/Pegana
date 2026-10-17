"use client";

import { useEffect } from "react";

/**
 * Local flag that survives a reload and outranks everything else.
 *
 * The kill switch USED to live inside sw.js: a postMessage handler that
 * unregistered itself, cleared its caches and navigated open clients. Verified
 * in a real browser, it did nothing. The navigate reloaded the page, this
 * registrar ran on the fresh load, and the worker was back within two seconds.
 * A kill switch that the next page load silently undoes is worse than none,
 * because it reads as working.
 *
 * A service worker cannot write localStorage, so the flag has to be set from
 * the page, and the page is where the whole operation belongs.
 */
const KILL_KEY = "pegana:sw_killed";

function killed(): boolean {
  try {
    return window.localStorage.getItem(KILL_KEY) === "1";
  } catch {
    return false;
  }
}

/** Unregister the worker, drop its caches, and stay dead across reloads. */
export async function killServiceWorker(): Promise<void> {
  try {
    window.localStorage.setItem(KILL_KEY, "1");
  } catch {
    // Even without the flag the unregister below still takes effect for this
    // session; it just will not survive a reload.
  }
  await teardown();
}

/** Undo a kill. Exported so recovery does not require clearing site data. */
export async function reviveServiceWorker(): Promise<void> {
  try {
    window.localStorage.removeItem(KILL_KEY);
  } catch {
    return;
  }
}

async function teardown(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith("pegana-")).map((n) => caches.delete(n)),
    );
  } catch {
    return;
  }
}

/**
 * Registers `public/sw.js`.
 *
 * Deliberately not registered on first paint. The worker's only jobs are the
 * offline document and a warm static cache, neither of which helps the visit
 * that installs it, and competing with the initial page for bandwidth would
 * make that visit measurably worse to no one's benefit. `load` plus an idle
 * callback puts it after everything the user is actually waiting for.
 *
 * ⚠️ REGISTRATION IS OPT-IN: nothing happens unless `NEXT_PUBLIC_ENABLE_SW=1`.
 * See the comment at the check for why. `NEXT_PUBLIC_DISABLE_SW=1` and
 * `killServiceWorker()` remain as belt-and-braces kill paths.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // OPT-IN, not opt-out. Registration only happens when someone deliberately
    // turns it on.
    //
    // Why it was flipped: the founder reported production "totally broken"
    // while every measurement I could take said otherwise — the landing page
    // rendered correctly in Chromium and WebKit, desktop and phone, cold and
    // with this worker controlling, CSS loaded, navigation worked, no page
    // errors. A service worker is the only STATEFUL thing in that deploy and
    // the only component whose behaviour can differ per browser in a way I
    // cannot observe or debug remotely. It also buys the least: an offline
    // document and a warm static cache, on a product whose value is live data.
    //
    // A component that can make one user's experience diverge from every
    // measurement available to me, in exchange for that, is a bad trade. It
    // stays in the tree, tested and ready, and does not run until
    // NEXT_PUBLIC_ENABLE_SW=1 is set deliberately.
    //
    // This is self-healing: with registration off, the teardown below runs on
    // the next page load for anyone who already has the worker, unregistering
    // it and dropping its caches.
    const enabled = process.env.NEXT_PUBLIC_ENABLE_SW === "1";
    if (!enabled || process.env.NEXT_PUBLIC_DISABLE_SW === "1" || killed()) {
      void teardown();
      return;
    }

    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        // A failed registration is not worth surfacing: everything still works,
        // it just works online-only.
        .catch(() => undefined);
    };

    const schedule = () => {
      const idle = (
        window as Window & {
          requestIdleCallback?: (cb: () => void, opts?: object) => number;
        }
      ).requestIdleCallback;
      if (typeof idle === "function") idle(register, { timeout: 4_000 });
      else window.setTimeout(register, 2_000);
    };

    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", schedule);
    };
  }, []);

  return null;
}
