/**
 * AGM Fit - Production Progressive Web App Service Worker
 * Version: 2.6.2
 * 
 * Provides offline caching for static app shell assets (HTML, CSS, JS, icons)
 * while strictly bypassing the cache for all Firebase Firestore, Auth, and live API traffic
 * to ensure 100% database integrity and real-time synchronization.
 */

const CACHE_NAME = 'agm-fit-cache-v2.6.2';

// Core static app shell files to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/icons/icon-192.png',
  '/src/icons/icon-512.png',
  '/src/styles/main.css',
  '/src/js/app.js',
  '/src/js/config.js',
  '/src/js/state.js',
  '/src/js/storage.js',
  '/src/js/meals.js',
  '/src/js/workout.js',
  '/src/js/tanita.js',
  '/src/js/chart.js',
  '/src/js/firebase.js'
];

// Domains and endpoints that MUST strictly bypass cache (Network-Only)
const NETWORK_ONLY_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebasestorage.googleapis.com',
  'firebaseio.com',
  'accounts.google.com',
  'apis.google.com'
];

/**
 * Checks if a request should bypass the cache and go directly to the network
 */
function shouldBypassCache(request) {
  // Only GET requests are cacheable
  if (request.method !== 'GET') {
    return true;
  }

  const url = new URL(request.url);

  // Bypass non-HTTP/HTTPS schemes (e.g., chrome-extension://)
  if (!url.protocol.startsWith('http')) {
    return true;
  }

  // Bypass all Firebase, Google Auth, and Cloud infrastructure endpoints
  if (NETWORK_ONLY_HOSTS.some(host => url.hostname.includes(host))) {
    return true;
  }

  // Bypass any custom backend API routes or Firebase reserved hosting paths
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) {
    return true;
  }

  return false;
}

// 1. Install Event: Pre-cache static shell files safely
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use individual fetches with Promise.allSettled so a single missing asset won't abort install
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((response) => {
              if (response.ok) {
                return cache.put(url, response);
              }
              console.warn(`[SW] Pre-cache skipped for ${url} (status: ${response.status})`);
            })
            .catch((err) => {
              console.warn(`[SW] Pre-cache fetch failed for ${url}:`, err);
            })
        )
      );
    }).then(() => {
      // Activate immediately without waiting for existing clients to close
      return self.skipWaiting();
    })
  );
});

// 2. Activate Event: Clean up old cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log(`[SW] Purging outdated cache: ${name}`);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      // Take control of all open pages immediately
      return self.clients.claim();
    })
  );
});

// 3. Fetch Event: Stale-While-Revalidate for app assets, Network-Only for dynamic data
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Rule A: Network-Only for Firebase Firestore, Auth, APIs, and non-GET requests
  if (shouldBypassCache(request)) {
    event.respondWith(fetch(request));
    return;
  }

  // Rule B: Navigation requests (HTML document) - Network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          // If offline or network fails, serve cached index.html
          const cached = await caches.match(request);
          if (cached) return cached;
          return (await caches.match('/index.html')) || (await caches.match('/'));
        })
    );
    return;
  }

  // Rule C: Static assets (JS, CSS, fonts, images) - Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Background fetch to update the cache
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch((err) => {
          // If network failed and we have no cached asset, let caller handle error
          if (cachedResponse) return cachedResponse;
          throw err;
        });

      // Return cached asset instantly if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
