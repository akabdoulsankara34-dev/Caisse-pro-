// ════════════════════════════════════════════════════════════════════
//  Caisse SaaS Pro – Service Worker  v2
//  DIGITALE SOLUTION · Ouagadougou, Burkina Faso
// ════════════════════════════════════════════════════════════════════

const CACHE_VERSION = "caisse-pro-v2";
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const CDN_CACHE     = `${CACHE_VERSION}-cdn`;
const FONTS_CACHE   = `${CACHE_VERSION}-fonts`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  "/caisse_pro_5.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
];

// ── Domaines à NE JAMAIS intercepter (Firebase + Google) ──────────
const PASSTHROUGH_PATTERNS = [
  "firestore.googleapis.com",
  "firebase.googleapis.com",
  "firebaseio.com",
  "firebaseapp.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "googleapis.com",
  "google.com",
  "accounts.google.com",
];

function isPassthrough(url) {
  return PASSTHROUGH_PATTERNS.some((p) => url.includes(p));
}
function isCdn(url) {
  return url.includes("cdnjs.cloudflare.com") || url.includes("unpkg.com") || url.includes("cdn.jsdelivr.net");
}
function isFont(url) {
  return url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com");
}

// ── INSTALL ───────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS).catch((e) => console.warn("[SW] shell partiel :", e))),
      caches.open(CDN_CACHE).then((c) => Promise.allSettled(CDN_ASSETS.map((url) => c.add(url).catch(() => {})))),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const valid = [SHELL_CACHE, CDN_CACHE, FONTS_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !valid.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url;

  if (request.method !== "GET") return;
  if (isPassthrough(url)) return;          // Firebase / Google → laisse passer
  if (isCdn(url)) { event.respondWith(cacheFirst(request, CDN_CACHE)); return; }
  if (isFont(url)) { event.respondWith(cacheFirst(request, FONTS_CACHE)); return; }
  if (url.endsWith(".html") || url.endsWith("manifest.json") || url.endsWith("icon-192.png") || url.endsWith("icon-512.png")) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch { return new Response("Hors ligne", { status: 503 }); }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchP = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || fetchP;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch { const cached = await cache.match(req); return cached || new Response("Hors ligne", { status: 503 }); }
}

self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });
