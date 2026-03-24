// ════════════════════════════════════════════════════════════════════
//  Caisse SaaS Pro – Service Worker
//  DIGITALE SOLUTION · Ouagadougou, Burkina Faso
//  Stratégies :
//    · App shell (HTML)         → Cache-first + revalidation bg
//    · CDN (React/Firebase/…)   → Cache-first (URLs versionnées)
//    · Google Fonts             → Cache-first (longue durée)
//    · Firebase REST / API      → Network-only (Firebase gère son offline)
//    · Tout le reste            → Network-first avec fallback cache
// ════════════════════════════════════════════════════════════════════

const CACHE_VERSION  = "caisse-pro-v1";
const SHELL_CACHE    = `${CACHE_VERSION}-shell`;
const CDN_CACHE      = `${CACHE_VERSION}-cdn`;
const FONTS_CACHE    = `${CACHE_VERSION}-fonts`;
const RUNTIME_CACHE  = `${CACHE_VERSION}-runtime`;

// ── Ressources à pré-cacher à l'installation ──────────────────────
const SHELL_ASSETS = [
  "./caisse_pro_5.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
];

// ── Helpers ───────────────────────────────────────────────────────
function isFirebaseRequest(url) {
  return (
    url.includes("firestore.googleapis.com") ||
    url.includes("firebase.googleapis.com") ||
    url.includes("identitytoolkit.googleapis.com") ||
    url.includes("securetoken.googleapis.com")
  );
}

function isCdnRequest(url) {
  return (
    url.includes("cdnjs.cloudflare.com") ||
    url.includes("unpkg.com") ||
    url.includes("cdn.jsdelivr.net")
  );
}

function isFontRequest(url) {
  return (
    url.includes("fonts.googleapis.com") ||
    url.includes("fonts.gstatic.com")
  );
}

// ── INSTALL ───────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[SW] Install – mise en cache du shell et des CDN");
  event.waitUntil(
    Promise.all([
      // Shell : HTML + icônes + manifest
      caches.open(SHELL_CACHE).then((cache) =>
        cache.addAll(SHELL_ASSETS).catch((err) => {
          console.warn("[SW] Shell cache partiel :", err);
        })
      ),
      // CDN : scripts versionnés (tolère les erreurs réseau au premier install)
      caches.open(CDN_CACHE).then((cache) =>
        Promise.allSettled(
          CDN_ASSETS.map((url) =>
            cache.add(url).catch((e) =>
              console.warn("[SW] CDN non mis en cache :", url, e)
            )
          )
        )
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[SW] Activate – nettoyage des anciens caches");
  const validCaches = [SHELL_CACHE, CDN_CACHE, FONTS_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !validCaches.includes(key))
            .map((key) => {
              console.log("[SW] Suppression du cache obsolète :", key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url;

  // Ignorer les requêtes non GET
  if (request.method !== "GET") return;

  // ── 1. Firebase / Firestore → Network-only ──────────────────────
  //    Firebase SDK gère lui-même la persistance offline (enablePersistence)
  if (isFirebaseRequest(url)) return;

  // ── 2. CDN versionnés → Cache-first ─────────────────────────────
  if (isCdnRequest(url)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // ── 3. Google Fonts → Cache-first ───────────────────────────────
  if (isFontRequest(url)) {
    event.respondWith(cacheFirst(request, FONTS_CACHE));
    return;
  }

  // ── 4. App shell (HTML/manifest/icônes) → Stale-while-revalidate
  const isShellAsset = SHELL_ASSETS.some((asset) =>
    url.endsWith(asset.replace("./", "/"))
  );
  if (isShellAsset || url.endsWith(".html")) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // ── 5. Tout le reste → Network-first + fallback cache ───────────
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ════════════════════════════════════════════════════════════════════
//  Stratégies
// ════════════════════════════════════════════════════════════════════

/** Cache-first : renvoie le cache, sinon réseau (puis met en cache) */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    console.warn("[SW] CacheFirst – hors ligne et pas de cache pour :", request.url);
    return new Response("Hors ligne – ressource non disponible", { status: 503 });
  }
}

/** Stale-while-revalidate : répond immédiatement depuis le cache, rafraîchit en arrière-plan */
async function staleWhileRevalidate(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);

  // Lance le fetch en arrière-plan quelle que soit la situation
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

/** Network-first : essaie le réseau, repli sur le cache */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("Hors ligne – ressource non disponible", { status: 503 });
  }
}

// ── MESSAGE : forcer la mise à jour ──────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
