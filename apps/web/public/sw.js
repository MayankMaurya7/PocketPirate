/*
 * PocketPirate service worker.
 *
 * Deliberately small. Every page in this app shows live, user-specific data
 * (balances, expenses), so page HTML is never cached — a stale balance is
 * worse than no page. What the worker does:
 *
 *   1. Precaches /offline (and the stylesheet/scripts it references) at
 *      install, and serves it when a navigation fails because the device is
 *      offline. Everything else about navigations is network-only.
 *   2. Caches /_next/static/* cache-first. Those URLs are content-hashed and
 *      immutable, so a hit is always correct. Capped to STATIC_LIMIT entries,
 *      oldest first.
 *
 * Nothing else is touched: cross-origin requests (Supabase), RSC payload
 * fetches, route handlers and non-GET requests all go straight to the
 * network as if there were no worker.
 *
 * Registered by components/service-worker.tsx in production builds only.
 * Bump VERSION to drop every existing cache on the next activation.
 */
const VERSION = "v1";
const OFFLINE_CACHE = `pocketpirate-offline-${VERSION}`;
const STATIC_CACHE = `pocketpirate-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const STATIC_LIMIT = 200;

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([OFFLINE_CACHE, STATIC_CACHE]);
      for (const key of await caches.keys()) {
        if (
          (key.startsWith("pocketpirate-") || key.startsWith("spendwise-")) &&
          !keep.has(key)
        ) {
          await caches.delete(key);
        }
      }
      // Let the browser start the navigation request in parallel with
      // waking this worker up, so the worker never adds latency online.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflineFallback(event));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Fetch /offline fresh and store it, plus every /_next/static asset its HTML
 * references — the page is unstyled and inert without them. Failing to
 * fetch the page fails the install (the worker is pointless without it);
 * a missing asset does not.
 */
async function precacheOfflinePage() {
  const response = await fetch(OFFLINE_URL, { cache: "reload" });
  if (!response.ok) {
    throw new Error(`Precaching ${OFFLINE_URL} failed: ${response.status}`);
  }
  const offlineCache = await caches.open(OFFLINE_CACHE);
  await offlineCache.put(OFFLINE_URL, response.clone());

  const html = await response.text();
  const assets = new Set();
  for (const match of html.matchAll(
    /(?:href|src)="(\/_next\/static\/[^"]+)"/g,
  )) {
    assets.add(match[1].replace(/&amp;/g, "&"));
  }
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(
    [...assets].map((asset) => staticCache.add(asset).catch(() => undefined)),
  );
}

async function networkWithOfflineFallback(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cached = await caches.match(OFFLINE_URL, {
      cacheName: OFFLINE_CACHE,
    });
    return (
      cached ??
      new Response("You're offline. Reconnect and try again.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

/** Cache keys come back in insertion order, so dropping the head is LRU-ish. */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= STATIC_LIMIT) return;
  await Promise.all(
    keys.slice(0, keys.length - STATIC_LIMIT).map((key) => cache.delete(key)),
  );
}
