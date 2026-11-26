'use strict';

/**
 * Service worker kecil untuk dua hal:
 *  1. Background Sync — mengirim antrean lokasi yang tersimpan saat pelanggan
 *     kembali mendapat sinyal, walau tab sudah ditutup.
 *  2. Shell offline — halaman /offline.html tampil saat jaringan mati total.
 *
 * Sengaja TIDAK meng-cache halaman admin, API, atau unggahan: data sensitif
 * tidak boleh tersimpan di Cache Storage.
 */

importScripts('/js/loc-queue.js');

const SHELL_CACHE = 'syt-shell-v1';
const SHELL_FILES = ['/offline.html', '/css/style.css', '/css/geo.css', '/img/logo.svg', '/js/loc-queue.js'];
const SYNC_TAG = 'syt-location-sync';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (path.startsWith('/admin') || path.startsWith('/api') || path.startsWith('/uploads')) return false;
  if (path === '/sw.js' || path === '/payment') return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isCacheable(url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/offline.html'))
        )
    );
    return;
  }

  if (/^\/(css|js|img)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
  }
});

/* ------------------------------------------------------------------ */
/* Background sync antrean lokasi                                     */
/* ------------------------------------------------------------------ */

async function flushQueue() {
  if (!self.SytLocQueue) return;
  const queue = self.SytLocQueue;
  const config = await queue.getMeta('config');
  if (!config || !config.endpoint) return;

  const items = (await queue.all()).filter(
    (item) => !item.bookingId || item.bookingId === config.bookingId
  );
  for (const item of items) {
    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': config.csrf || ''
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: item.id,
          lat: item.lat,
          lng: item.lng,
          accuracy: item.accuracy || null,
          at: item.at,
          source: 'sync',
          offline: true
        })
      });
      if (res.status === 401 || res.status === 403) return; // sesi habis: biarkan antrean, halaman akan kirim
      if (res.ok || res.status === 400 || res.status === 404 || res.status === 409) {
        await queue.remove(item.id);
      } else {
        return; // server sibuk: coba lagi pada sync berikutnya
      }
    } catch (err) {
      return; // masih offline
    }
  }

  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => client.postMessage({ type: 'syt-location-synced', count: items.length }));
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushQueue());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'syt-flush') event.waitUntil(flushQueue());
});
