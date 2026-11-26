'use strict';

/**
 * Geocoding lewat Nominatim (OpenStreetMap) — open source, tanpa API key.
 *
 * Kebijakan pemakaian Nominatim (https://operations.osmfoundation.org/policies/nominatim/):
 *  - maksimal 1 permintaan per detik per aplikasi → antrean berurutan di sini,
 *  - User-Agent yang menyebut aplikasi & kontak,
 *  - hasil wajib di-cache, dilarang melakukan bulk geocoding.
 */

const { createCache } = require('./cache');

const ATTRIBUTION = 'Geocoding © kontributor OpenStreetMap (Nominatim, ODbL)';
const ENDPOINT = String(process.env.GEO_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = Number(process.env.GEO_TIMEOUT_MS) >= 2000 ? Number(process.env.GEO_TIMEOUT_MS) : 10000;

const cache = createCache({ ttlMs: 24 * 60 * 60 * 1000, max: 500 });

function userAgent() {
  return (
    String(process.env.GEO_USER_AGENT || '').trim() ||
    `Seayoulatertrip/1.0 (+${String(process.env.SITE_URL || 'https://seayoulatertrip.com').trim()})`
  );
}

/* Antrean global: satu permintaan tiap ~1,1 detik, sesuai kebijakan. */
let queueTail = Promise.resolve();
let lastAt = 0;
function schedule(task) {
  const run = queueTail.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return task();
  });
  queueTail = run.catch(() => {});
  return run;
}

async function call(pathAndQuery) {
  const url = `${ENDPOINT}${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent() },
      signal: controller.signal
    });
    if (!res.ok) {
      const err = new Error(`Nominatim membalas HTTP ${res.status}`);
      err.code = 'upstream_unavailable';
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (!err.code) err.code = 'upstream_unavailable';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function composeName(result) {
  if (!result) return '';
  if (result.name) return result.name;
  const a = result.address || {};
  return a.village || a.town || a.city || a.suburb || a.county || a.state || result.display_name || '';
}

/**
 * Nama tempat dari koordinat ("Dermaga Waisai, Raja Ampat").
 * Mengembalikan { name, displayName, address, lat, lng } atau null.
 */
async function reverse(lat, lng) {
  const key = `rev|${Number(lat).toFixed(4)}|${Number(lng).toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const qs = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    zoom: '16',
    addressdetails: '1',
    'accept-language': 'id'
  });
  const json = await schedule(() => call(`/reverse?${qs.toString()}`));
  if (!json || json.error) return null;
  const value = {
    name: composeName(json),
    displayName: json.display_name || '',
    address: json.address || {},
    lat: Number(json.lat),
    lng: Number(json.lon)
  };
  cache.set(key, value);
  return value;
}

/**
 * Cari tempat berdasarkan nama ("Labuan Bajo", "Waisai").
 * Mengembalikan [{ name, displayName, lat, lng, type, importance }].
 */
async function search(query, { limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const key = `q|${q.toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const qs = new URLSearchParams({
    format: 'jsonv2',
    q,
    limit: String(Math.min(10, Math.max(1, limit))),
    addressdetails: '1',
    'accept-language': 'id'
  });
  const json = await schedule(() => call(`/search?${qs.toString()}`));
  const rows = Array.isArray(json) ? json : [];
  const value = rows
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
    .map((r) => ({
      name: composeName(r),
      displayName: r.display_name || '',
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.type || r.category || 'place',
      importance: Number(r.importance) || 0
    }));
  cache.set(key, value, 60 * 60 * 1000);
  return value;
}

/**
 * Pencarian kategori di dalam kotak (dipakai sebagai cadangan bila Overpass sibuk).
 * Memakai indeks "special phrases" Nominatim, mis. q=restaurant dalam bbox.
 */
async function searchInBox(term, { bbox, limit = 20 } = {}) {
  const q = String(term || '').trim();
  if (!q || !bbox) return [];
  const key = `box|${q.toLowerCase()}|${bbox.map((n) => Number(n).toFixed(3)).join(',')}|${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const qs = new URLSearchParams({
    format: 'jsonv2',
    q,
    viewbox: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`,
    bounded: '1',
    limit: String(Math.min(40, Math.max(1, limit))),
    addressdetails: '1',
    'accept-language': 'id'
  });
  const json = await schedule(() => call(`/search?${qs.toString()}`));
  const rows = Array.isArray(json) ? json : [];
  const value = rows
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
    .map((r) => ({
      osmType: r.osm_type || 'N',
      osmId: r.osm_id,
      name: r.name || (r.address && (r.address.amenity || r.address.shop || r.address.tourism)) || '',
      type: r.type || '',
      category: r.category || '',
      lat: Number(r.lat),
      lng: Number(r.lon),
      address: r.address || {},
      displayName: r.display_name || ''
    }));
  cache.set(key, value, 60 * 60 * 1000);
  return value;
}

module.exports = { ATTRIBUTION, reverse, search, searchInBox, _cache: cache };
