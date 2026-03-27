/* ================================================================
   sw.js – Caisse SaaS Pro | DIGITALE SOLUTION
   Stratégies :
     • App Shell (HTML + icônes)  → Cache First
     • CDN tiers (Firebase, React, Fonts) → Stale-While-Revalidate
     • Firebase API / Firestore   → Network First (offline : cache)
     • Tout le reste              → Network First
   ================================================================ */

const APP_VERSION    = "v1.0.0";
const SHELL_CACHE    = `caisse-shell-${APP_VERSION}`;
const CDN_CACHE      = `caisse-cdn-${APP_VERSION}`;
const RUNTIME_CACHE  = `caisse-runtime-${APP_VERSION}`;

/* ── Ressources à précacher au moment de l'install ─────────────── */
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/icon-192.png",
  "/icon-512.png",
];

/* ── Domaines CDN à mettre en SWR ──────────────────────────────── */
const CDN_HOSTS = [
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

/* ── Domaines Firebase (Network First) ─────────────────────────── */
const FIREBASE_HOSTS = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebase.googleapis.com",
];

// ================================================================
//  INSTALL – précache du shell
// ================================================================
self.addEventListener("install", (event) => {
  console.log(`[SW] Install – ${SHELL_CACHE}`);
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // Prend le contrôle immédiatement (sans attendre le rechargement)
  self.skipWaiting();
});

// ================================================================
//  ACTIVATE – purge des anciens caches
// ================================================================
self.addEventListener("activate", (event) => {
  console.log(`[SW] Activate – ${APP_VERSION}`);
  const VALID = [SHELL_CACHE, CDN_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !VALID.includes(k))
          .map((k) => {
            console.log(`[SW] Suppression ancien cache : ${k}`);
            return caches.delete(k);
          })
      )
    )
  );
  // Contrôle toutes les pages ouvertes immédiatement
  self.clients.claim();
});

// ================================================================
//  FETCH – routage des requêtes
// ================================================================
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore les requêtes non-GET et les extensions navigateur
  if (request.method !== "GET") return;
  if (!["http:", "https:"].includes(url.protocol)) return;

  // ── 1. Shell (HTML + icônes) → Cache First ──────────────────
  if (SHELL_ASSETS.some((a) => request.url.endsWith(a.replace("./", "")))) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // ── 2. Firebase Firestore / Auth → Network First ────────────
  if (FIREBASE_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // ── 3. CDN tiers → Stale-While-Revalidate ───────────────────
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // ── 4. Reste → Network First avec fallback cache ────────────
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ================================================================
//  Message : rechargement forcé après mise à jour
// ================================================================
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ================================================================
//  STRATÉGIES
// ================================================================

/** Cache First – retourne le cache, sinon réseau puis mise en cache */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("Hors ligne – ressource non disponible", { status: 503 });
  }
}

/** Network First – réseau d'abord, fallback cache, puis offline page */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Fallback HTML pour la navigation offline
    if (request.destination === "document") {
      const shell = await caches.match("./index.html");
      if (shell) return shell;
    }
    return new Response(
      JSON.stringify({ error: "offline" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

/** Stale-While-Revalidate – retourne le cache ET met à jour en arrière-plan */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Lancement de la mise à jour en arrière-plan (sans await)
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  return cached || networkPromise;
}
