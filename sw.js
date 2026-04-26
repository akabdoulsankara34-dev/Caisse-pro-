// ══════════════════════════════════════════════════════════════════
//  CAISSE SAAS PRO – Service Worker v2
//  Compatible Firebase Firestore (long-polling)
//  ⚠️  Ce fichier doit être placé dans le MÊME dossier que index.html
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = "caisse-pro-v2";

// Domaines Firebase à NE JAMAIS intercepter
// (le long-polling Firestore explose si le SW le capture)
const FIREBASE_BYPASS = [
  "firestore.googleapis.com",
  "firebase.googleapis.com",
  "firebaseio.com",
  "firebasestorage.app",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "www.googleapis.com",
  "cloudflare.com",          // CDN des libs React/Firebase/Babel
  "fonts.googleapis.com",    // Google Fonts
  "fonts.gstatic.com",
];

// Ressources à pré-cacher au démarrage (app shell)
const PRECACHE_URLS = [
  "./",
  "./index.html",
];

// ── INSTALL ───────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  console.log("[SW] Install v2");
  self.skipWaiting(); // active immédiatement le nouveau SW
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn("[SW] Précache échoué :", err))
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  console.log("[SW] Activate v2");
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME) // supprime les anciens caches
            .map((k) => {
              console.log("[SW] Suppression ancien cache :", k);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim()) // prend le contrôle immédiatement
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // ① Ne jamais intercepter Firebase / CDN externes
  if (FIREBASE_BYPASS.some((domain) => url.hostname.includes(domain))) {
    // On ne fait RIEN → le navigateur envoie la requête normalement
    return;
  }

  // ② Requêtes non-GET → réseau uniquement (POST, etc.)
  if (e.request.method !== "GET") {
    return;
  }

  // ③ Tout le reste : réseau d'abord, cache en fallback
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Mise en cache des réponses OK
        if (response && response.ok && response.type !== "opaque") {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(e.request, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => {
        // Hors-ligne → fallback sur le cache
        return caches.match(e.request).then(
          (cached) =>
            cached ||
            new Response("Hors ligne – vérifiez votre connexion", {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
        );
      })
  );
});
