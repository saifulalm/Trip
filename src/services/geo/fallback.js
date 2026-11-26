'use strict';

/**
 * Cadangan pencarian fasilitas saat Overpass API sedang penuh (502/504).
 *
 * Memakai Nominatim (OpenStreetMap, open source, tanpa API key) dengan
 * pencarian kategori di dalam bounding box radius. Hasil tetap dari data OSM
 * yang sama, dihitung jaraknya di server, dan di-cache 1 jam.
 */

const { createCache } = require('./cache');

const cache = createCache({ ttlMs: 60 * 60 * 1000, max: 300 });

/** Istilah pencarian per kategori — dua istilah paling efektif saja. */
const TERMS = {
  transport: ['terminal', 'pelabuhan'],
  hotel: ['hotel', 'penginapan'],
  restaurant: ['restoran', 'kafe'],
  atm: ['atm', 'bank'],
  health: ['rumah sakit', 'apotek'],
  emergency: ['kantor polisi'],
  fuel: ['spbu'],
  market: ['pasar', 'supermarket']
};

const CATEGORY_LABELS = {
  transport: 'Angkutan umum',
  hotel: 'Penginapan',
  restaurant: 'Tempat makan',
  atm: 'ATM/Bank',
  health: 'Fasilitas kesehatan',
  emergency: 'Layanan darurat',
  fuel: 'SPBU',
  market: 'Toko'
};

function bboxFor(lat, lng, radius) {
  const dLat = radius / 111320;
  const cos = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const dLng = radius / (111320 * cos);
  return [lng - dLng, lat + dLat, lng + dLng, lat - dLat];
}

function addressText(address) {
  if (!address) return '';
  const parts = [];
  const street = address.road || address.pedestrian;
  if (street) parts.push(address.house_number ? `${street} No. ${address.house_number}` : street);
  const area = address.village || address.suburb || address.city || address.town || address.district;
  if (area) parts.push(area);
  return parts.join(', ');
}

/**
 * @param {object} opts
 * @param {string} opts.category
 * @param {function} opts.searchInBox dari layanan Nominatim (menghormati rate limit)
 * @param {function} opts.haversine
 */
async function search({ category, lat, lng, radius, limit, searchInBox, haversine }) {
  const terms = TERMS[category];
  if (!terms || typeof searchInBox !== 'function') {
    const err = new Error('Cadangan pencarian tidak tersedia.');
    err.code = 'upstream_unavailable';
    throw err;
  }
  const key = `fallback|${category}|${lat.toFixed(3)}|${lng.toFixed(3)}|${Math.round(radius / 500)}|${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const bbox = bboxFor(lat, lng, radius);
  const rows = [];
  for (const term of terms) {
    try {
      const found = await searchInBox(term, { bbox, limit: Math.min(30, limit * 2) });
      rows.push(...found);
    } catch (err) {
      // satu istilah gagal tidak membatalkan istilah lain
    }
  }
  if (!rows.length) {
    const err = new Error('Cadangan pencarian tidak memberi hasil.');
    err.code = 'upstream_unavailable';
    throw err;
  }

  const seen = new Set();
  const places = [];
  for (const row of rows) {
    const id = `${String(row.osmType).toLowerCase()}/${row.osmId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const distance = haversine(lat, lng, row.lat, row.lng);
    if (distance > radius + 250) continue;
    const label =
      row.type && row.type !== 'yes'
        ? row.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : CATEGORY_LABELS[category];
    places.push({
      id: `nominatim/${id}`,
      osmType: String(row.osmType).toLowerCase(),
      name: row.name || CATEGORY_LABELS[category],
      unnamed: !row.name,
      type: `${row.category}:${row.type}`,
      typeLabel: label,
      distance: Math.round(distance),
      lat: Number(row.lat.toFixed(6)),
      lng: Number(row.lng.toFixed(6)),
      address: addressText(row.address),
      openingHours: '',
      phone: '',
      website: '',
      wheelchair: '',
      cuisine: '',
      stars: '',
      rooms: '',
      operator: '',
      osmUrl: `https://www.openstreetmap.org/${String(row.osmType).toLowerCase()}/${row.osmId}`
    });
  }

  places.sort((a, b) => a.distance - b.distance);
  const result = places.slice(0, limit);
  cache.set(key, result);
  return result;
}

module.exports = { search, TERMS };
