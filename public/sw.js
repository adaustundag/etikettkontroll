/* EtikettKontroll service worker — hand-rolled (worklog Task 29).
 *
 * Caching policy (the whole contract, do not widen without reading this):
 *   /api/*               network only — NEVER cached, not even on failure.
 *   /_next/static, /icons, /favicon.svg, /logo.svg, manifest
 *                        cache-first (immutable, content-hashed or static).
 *   /uploads/*           stale-while-revalidate.
 *   navigations          network-first; successful /product/* pages are kept
 *                        for offline replay (bounded); failure falls back to
 *                        the cached copy of that URL, then /offline.html.
 *   everything else      untouched (browser default).
 *
 * Update rules: bump VERSION together with package.json on every deploy that
 * touches the shell. On activate we keep the current + previous generation of
 * each cache family so tabs opened before a deploy keep working (their
 * hashed chunks no longer exist on the server). Everything older is deleted.
 */

const VERSION = 'v0.2.2';

const STATIC_CACHE = `ek-static-${VERSION}`;
const UPLOADS_CACHE = `ek-uploads-${VERSION}`;

const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep the current generation + the most recent previous one per family.
      // Deleting every old cache immediately bricks still-open tabs from the
      // last deploy: their chunks are 404 on the server by then.
      const keep = new Set([STATIC_CACHE, UPLOADS_CACHE]);
      const families = { static: [], uploads: [] };
      const names = await caches.keys();
      for (const name of names) {
        const m = name.match(/^ek-(static|pages|uploads)-v(.+)$/);
        if (m && m[2] !== VERSION) {
          // 'pages' family is retired entirely (offline product replay removed).
          if (m[1] === 'pages') continue;
          families[m[1]].push({ name, v: m[2] });
        }
      }
      for (const list of Object.values(families)) {
        list.sort((a, b) => compareVersions(b.v, a.v)); // newest first
        list.slice(0, 1).forEach((f) => keep.add(f.name)); // previous generation stays
      }
      await Promise.all(
        names.filter((n) => n.startsWith('ek-') && !keep.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/etc. always hit the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cached — non-negotiable

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(staleWhileRevalidate(req, UPLOADS_CACHE));
  }
  // Anything else: do not intercept — default browser behaviour.
});

function isImmutableAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/favicon.svg' ||
    pathname === '/logo.svg' ||
    pathname === '/manifest.webmanifest'
  );
}

/**
 * Navigations are NETWORK-ONLY. Cached product facts could present revoked
 * verification or superseded data as current after going offline — an
 * unacceptable trade for a verification-branded database (launch-readiness
 * review §9). Offline navigations get the explicit offline page instead.
 */
async function handleNavigate(req) {
  try {
    return await fetch(req);
  } catch {
    const offline = await caches.match('/offline.html');
    return (
      offline ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cached = await caches.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(cacheName).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => undefined);
  return cached || (await refresh) || new Response('', { status: 504, statusText: 'Offline' });
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
