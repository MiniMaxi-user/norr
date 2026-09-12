// Minimal service worker — just enough to make the app installable as a
// PWA. Real offline caching (precaching app-shell assets, runtime caching
// strategies for API calls) is an explicit LATER story, not this one.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch handler — required for the app to be considered
// "installable" by browsers, but does no caching of its own yet.
self.addEventListener("fetch", () => {});
