'use strict';

/**
 * Rute fitur "Sekitar Saya" + API geo.
 *
 * Halaman /sekitar dipakai pelanggan (dan admin) untuk mencari angkutan umum,
 * hotel, restoran, ATM, fasilitas kesehatan, dan lainnya di sekitar titik
 * mereka. Endpoint /api/geo/* dipanggil oleh halaman itu dan oleh panel
 * detail destinasi.
 *
 * Semua data dari OpenStreetMap lewat server ini (bukan langsung dari browser)
 * supaya: (1) User-Agent sesuai kebijakan layanan, (2) hasil ter-cache,
 * (3) rate limit per IP, (4) tidak ada masalah CORS.
 */

const express = require('express');

const db = require('../db');
const geo = require('../services/geo');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Rate limit khusus API (balasan JSON, bukan redirect)                */
/* ------------------------------------------------------------------ */

function apiLimiter({ max = 60, windowMs = 60 * 1000 } = {}) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({
        error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.',
        retryAfter: retry
      });
    }
    if (hits.size > 1000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    next();
  };
}

function readCoords(query) {
  const lat = parseFloat(query.lat);
  const lng = parseFloat(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function fail(res, status, message, extra) {
  return res.status(status).json({ error: message, ...(extra || {}) });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Daftar kategori + label untuk chip di UI. */
router.get('/api/geo/categories', apiLimiter({ max: 120 }), (req, res) => {
  res.json({
    categories: geo.CATEGORY_KEYS.map((key) => ({
      key,
      label: geo.CATEGORIES[key].label,
      icon: geo.CATEGORIES[key].icon,
      hint: geo.CATEGORIES[key].hint
    })),
    attribution: geo.ATTRIBUTION
  });
});

/** Fasilitas terdekat di sekitar satu titik. */
router.get('/api/geo/nearby', apiLimiter({ max: 40, windowMs: 60 * 1000 }), async (req, res) => {
  const coords = readCoords(req.query);
  if (!coords) {
    return fail(res, 400, 'Parameter lat & lng wajib berupa angka yang valid (contoh: -0.8917, 119.8734).');
  }
  const category = String(req.query.category || 'transport');
  if (!geo.CATEGORIES[category]) {
    return fail(res, 400, `Kategori tidak dikenal. Pilihan: ${geo.CATEGORY_KEYS.join(', ')}.`);
  }
  const radius = Math.min(5000, Math.max(300, Number(req.query.radius) || 1200));
  const limit = Math.min(60, Math.max(5, Number(req.query.limit) || 25));
  try {
    const result = await geo.nearby({ ...coords, category, radius, limit });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ...result,
      attribution: geo.ATTRIBUTION,
      categoryMeta: {
        key: category,
        label: geo.CATEGORIES[category].label,
        icon: geo.CATEGORIES[category].icon
      }
    });
  } catch (err) {
    if (err.code === 'invalid_query') return fail(res, 400, err.message);
    if (err.code === 'upstream_unavailable') {
      res.setHeader('Retry-After', String(err.retryAfterSec || 30));
      return fail(res, 503, 'Layanan peta OpenStreetMap sedang tidak dapat dihubungi. Coba lagi sebentar lagi.', {
        retryAfter: err.retryAfterSec || 30
      });
    }
    console.error('[geo] nearby gagal:', err);
    return fail(res, 500, 'Gagal mengambil data fasilitas sekitar.');
  }
});

/** Nama tempat dari koordinat (reverse geocoding). */
router.get('/api/geo/reverse', apiLimiter({ max: 40 }), async (req, res) => {
  const coords = readCoords(req.query);
  if (!coords) return fail(res, 400, 'Parameter lat & lng tidak valid.');
  try {
    const place = await geo.reverse(coords.lat, coords.lng);
    if (!place) return fail(res, 404, 'Nama tempat tidak ditemukan untuk koordinat ini.');
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.json({ ...place, attribution: geo.GEOCODING_ATTRIBUTION });
  } catch (err) {
    if (err.code === 'upstream_unavailable') {
      return fail(res, 503, 'Layanan pencarian nama tempat sedang sibuk.');
    }
    console.error('[geo] reverse gagal:', err);
    return fail(res, 500, 'Gagal mencari nama tempat.');
  }
});

/** Cari koordinat dari nama tempat ("Labuan Bajo", "Waisai"). */
router.get('/api/geo/places', apiLimiter({ max: 30 }), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return fail(res, 400, 'Kata kunci minimal 3 karakter.');
  try {
    const places = await geo.searchPlaces(q, { limit: 6 });
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.json({ query: q, places, attribution: geo.GEOCODING_ATTRIBUTION });
  } catch (err) {
    if (err.code === 'upstream_unavailable') {
      return fail(res, 503, 'Layanan pencarian tempat sedang sibuk.');
    }
    console.error('[geo] search gagal:', err);
    return fail(res, 500, 'Gagal mencari tempat.');
  }
});

/* ------------------------------------------------------------------ */
/* Halaman /sekitar                                                    */
/* ------------------------------------------------------------------ */

function presetFrom(query) {
  const lat = parseFloat(query.lat);
  const lng = parseFloat(query.lng);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    lat: ok ? lat : null,
    lng: ok ? lng : null,
    name: String(query.name || '').slice(0, 120),
    category: geo.CATEGORIES[query.category] ? String(query.category) : 'transport'
  };
}

router.get('/sekitar', (req, res) => {
  const data = db.read();
  const preset = presetFrom(req.query);
  const destinations = (data.destinations || [])
    .filter((d) => d.status === 'published' && Number.isFinite(d.lat) && Number.isFinite(d.lng))
    .map((d) => ({ slug: d.slug, name: d.name, region: d.region, lat: d.lat, lng: d.lng }));

  res.render('pages/nearby', {
    title: 'Sekitar Saya',
    geoPage: true,
    seo: {
      title: 'Cari Angkutan Umum, Hotel & Restoran Terdekat',
      description:
        'Temukan halte, dermaga feri, hotel, restoran, ATM, dan fasilitas kesehatan terdekat dari lokasi Anda. Data peta OpenStreetMap, gratis dan tanpa aplikasi tambahan.',
      image: '',
      type: 'website'
    },
    preset,
    destinations,
    categories: geo.CATEGORY_KEYS.map((key) => ({
      key,
      label: geo.CATEGORIES[key].label,
      icon: geo.CATEGORIES[key].icon,
      hint: geo.CATEGORIES[key].hint
    })),
    attribution: geo.ATTRIBUTION
  });
});

module.exports = router;
