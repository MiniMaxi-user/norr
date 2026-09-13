// Service worker for the Norr Monteur PWA app-shell (issue #169, route
// renamed /workitems -> /today by issue #170). Minimal, hand-rolled caching
// (no Workbox) — just enough for the logged-in /today route (and /login) to
// still open when the device has no network, after at least one earlier
// successful online visit.
//
// Two caches:
// - SHELL_CACHE — navigation HTML for /login and /today. Populated
//   best-effort at `install` time and kept fresh on every successful
//   network navigation afterwards (network-first below, see the `fetch`
//   handler) — so whatever's served offline is always whatever last loaded
//   successfully online, never a stale install-time-only snapshot. This is
//   deliberately network-first (not cache-first) specifically to avoid
//   ever serving a stale /login or /today HTML that could reflect an
//   old session's data indefinitely.
// - STATIC_CACHE — /_next/static/... assets. These are content-hashed (a
//   new deploy ships new filenames), so cache-first is safe: once cached,
//   an asset never needs re-fetching, and bumping CACHE_VERSION on a
//   future change to this file naturally drops anything stale on
//   `activate` (old cache names get deleted there).
//
// Deliberately does NOT touch /api/* — that's the Dexie cache's job
// (lib/offline/db.ts), not the service worker's. Caching an API response
// here would risk serving stale JSON indefinitely; this worker's only job
// is "can the page shell load at all without network," never the data
// itself.
//
// Bug report, 2026-09-13: `/work-orders/[id]` shell entries used to be
// keyed by the FULL request (path + query), so each `?section=` tab was its
// own separate cache entry — only whichever exact section URL happened to
// have been the last one visited online stayed openable offline; the other
// three fell through to the generic `/today`/`/login` fallback below
// instead of this work order's own shell (looked like "Hours/Articles/
// Photos/Sign won't open offline", while the no-`?section=` URL Today links
// to kept working). `shellCacheKey()` now keys `/work-orders/[id]` entries
// by PATHNAME ONLY — the work order id stays part of the key (so a
// different work order never serves another one's stale shell), but the
// `?section=` query is dropped, since which section is showing is derived
// entirely client-side (`useSearchParams()` in `work-order-detail.tsx`) and
// never baked into the server-rendered HTML the way `workOrderId` (from
// `params.id`) is.
const CACHE_VERSION = "v4";
const SHELL_CACHE = `norr-pwa-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `norr-pwa-static-${CACHE_VERSION}`;
const SHELL_URLS = ["/login", "/today"];

/** The shell-cache key for a navigation to `url` — see this file's own top
 * comment. Every `/work-orders/[id]` URL (any `?section=`) collapses to its
 * bare pathname; everything else (just `/login`/`/today` in practice, since
 * those are the only other navigable routes) keys by the full path+query,
 * unchanged from before. */
function shellCacheKey(url) {
  if (url.pathname.startsWith("/work-orders/")) return url.pathname;
  return url.pathname + url.search;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort — an install-time fetch of these can fail (no network
      // yet, or /today redirecting an unauthenticated request to
      // /login) and must never fail the install itself.
      await Promise.all(
        SHELL_URLS.map((url) =>
          fetch(url, { credentials: "same-origin" })
            .then((response) => (response && response.ok ? cache.put(url, response) : undefined))
            .catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from a previous version (including the old v1
      // no-op worker's install — it never created a cache, but any prior
      // SHELL_CACHE/STATIC_CACHE name change lands here too) so this
      // upgrade actually takes effect for anyone who already has the old
      // worker installed.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept API calls — see the top-of-file comment.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, falling back to the most recently cached
  // response for that same shell key when the network fails; refreshes the
  // cache on every successful fetch. See this file's own top comment on why
  // `/work-orders/[id]` is keyed by pathname only (drops `?section=`).
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cacheKey = shellCacheKey(url);
        try {
          const response = await fetch(request);
          cache.put(cacheKey, response.clone());
          return response;
        } catch {
          const cached = await cache.match(cacheKey);
          if (cached) return cached;
          // Last resort: whichever shell page IS cached, so the app at
          // least opens to something instead of the browser's own
          // offline error page.
          return (await cache.match("/today")) ?? (await cache.match("/login")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Next's content-hashed static assets: cache-first — safe to cache
  // aggressively since a new deploy ships new hashed filenames, never a
  // mutated response reused under the same URL.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
