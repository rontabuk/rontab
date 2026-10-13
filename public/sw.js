self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// Network-only: pages stay fresh and signed-in state is never served from a cache.
self.addEventListener("fetch", () => {});
