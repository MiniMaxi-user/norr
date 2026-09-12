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
const CACHE_VERSION = "v3";
const SHELL_CACHE = `norr-pwa-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `norr-pwa-static-${CACHE_VERSION}`;
const SHELL_URLS = ["/login", "/today"];

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
  // response for that same URL when the network fails; refreshes the
  // cache on every successful fetch.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const response = await fetch(request);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);
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
