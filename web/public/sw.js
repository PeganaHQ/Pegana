/*
 * Pegana service worker.
 *
 * THE ONE RULE: this worker never caches peg data.
 *
 * Pegana exists to tell you that an asset has moved off its peg. Serving a
 * cached state, spread or price would be the exact failure the product is built
 * to prevent, and it would fail silently and confidently, which is worse than
 * failing loudly. So `/v1/*`, `/api/*` and every cross-origin request go
 * straight to the network with no cache entry, ever. Offline shows the offline
 * page, not yesterday's numbers.
 *
 * What it does cache:
 *   - `/_next/static/*` and `/tokens/*`, which are content-hashed or immutable,
 *     so cache-first is always correct;
 *   - the fonts;
 *   - one offline fallback document.
 *
 * Navigations are NETWORK-FIRST, deliberately. Cache-first HTML is how service
 * workers earn their reputation: one bad deploy pins a stale document that
 * users cannot clear. Here the network always wins when it is reachable, and
 * the cache only answers when it is not.
 */

const VERSION = "v1";
const STATIC_CACHE = `pegana-static-${VERSION}`;
const OFFLINE_URL = "/offline";

// Never cached, under any circumstance. Ordered by how bad a stale answer is.
const NEVER_CACHE = [
  "/v1/", // peg state, spreads, alerts. The whole product.
  "/api/", // same-origin proxies, which front live upstreams
  "/monitoring", // Sentry tunnel
  "/auth/", // magic links are single-use
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      // A failed precache must not block activation and leave the user with a
      // half-installed worker.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("pegana-") && k !== STATIC_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/*
 * There is deliberately NO postMessage kill handler here.
 *
 * There was one. It unregistered the worker, cleared the caches, and navigated
 * open clients so the change took effect. Verified in a real browser, the net
 * effect was zero: the navigate reloaded the page, the registrar ran on the
 * fresh load, and the worker was back within two seconds. A kill switch the
 * next page load silently undoes is worse than none, because it reads as
 * working.
 *
 * The kill lives in components/atoms/service-worker.tsx instead, where it can
 * write a localStorage flag that the registrar checks before re-registering.
 * A service worker cannot write localStorage, so it could never have been the
 * right place for it.
 */

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/tokens/") ||
    url.pathname.startsWith("/logos/") ||
    /\.(?:woff2?|png|svg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Cross-origin requests are never touched. That includes the token and
  // partner logos, which load from https://api.pegana.xyz/static/ (see
  // lib/static-assets.ts): the browser's HTTP cache (1 day fresh + 7 days
  // stale-while-revalidate, set by Caddy) is their only cache, and the
  // /tokens/ and /logos/ cases in isImmutableAsset only apply if
  // NEXT_PUBLIC_STATIC_BASE is "/".
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  // Documents: network first, offline page as the last resort.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then(
            (cached) =>
              cached ??
              new Response("Offline", {
                status: 503,
                headers: { "content-type": "text/plain" },
              }),
          ),
      ),
    );
    return;
  }

  // Content-hashed assets: cache first, since the URL changes when the bytes do.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => undefined);
            }
            return response;
          }),
      ),
    );
  }

  // Everything else falls through to the network untouched.
});
