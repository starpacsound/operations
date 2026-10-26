// =====================================================================
// Service worker (v5.3): lets phones install the app and opens it quickly.
// Network first for the app's own files: every load asks the server (so an upload reaches people at once)
// and only falls back to the saved copy when there's no connection. Firebase, Google and other sites are
// never touched: live data always comes straight from Firestore.
// Bump VERSION with each release so old saved copies are cleared.
// =====================================================================
const VERSION = "showbase-v5.3.0";

self.addEventListener("install", e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png"])).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener("activate", e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== self.location.origin) return;   // Firestore, Auth, fonts, Apps Script: straight to the network
    e.respondWith((async () => {
        try {
            // "no-cache" = always check with the server (cheap when nothing changed), so nobody runs an old version.
            const res = await fetch(req, { cache: "no-cache" });
            if (res.ok && res.type === "basic") {
                const copy = res.clone();
                caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
            }
            return res;
        } catch (err) {
            const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
            if (hit) return hit;
            if (req.mode === "navigate") { const home = await caches.match("./index.html"); if (home) return home; }
            throw err;
        }
    })());
});
