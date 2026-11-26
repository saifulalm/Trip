'use strict';

/**
 * API pembaruan lokasi pelanggan.
 *
 * Kasus nyata di lapangan: pelanggan berada di pulau/daerah tanpa sinyal.
 * Aplikasi tetap merekam titik GPS di perangkat (IndexedDB), lalu saat sinyal
 * kembali — baik halaman masih terbuka maupun lewat Background Sync di
 * service worker — antrean titik itu dikirim ke sini. Hasilnya admin melihat
 * lokasi terbaru, bukan lokasi lama saat terakhir online.
 *
 * Endpoint JSON (bukan form) supaya bisa dipanggil ulang otomatis tanpa
 * memuat halaman. CSRF tetap wajib lewat header X-CSRF-Token.
 */

const express = require('express');

const db = require('../db');

const router = express.Router();

const MAX_UPDATES_PER_BOOKING = 200;
const MAX_TRACK_ENTRIES = 300;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

/* Rate limit per pelanggan: 120 update / jam cukup untuk pelacakan perjalanan. */
const hits = new Map();
function limitUpdates(req, res, next) {
  const key = req.customer ? req.customer.id : req.ip;
  const now = Date.now();
  let entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60 * 60 * 1000 };
    hits.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > 120) {
    return res.status(429).json({ error: 'Terlalu banyak pembaruan lokasi. Coba lagi nanti.' });
  }
  if (hits.size > 500) {
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }
  next();
}

function requireCustomerApi(req, res, next) {
  if (!req.session || !req.session.customerId) {
    return res.status(401).json({ error: 'Sesi berakhir. Silakan masuk kembali.' });
  }
  next();
}

function findBooking(req) {
  const data = db.read();
  const booking = (data.bookings || []).find(
    (b) => b.id === req.params.id && b.customerId === req.customer.id
  );
  return { data, booking };
}

function coordsValid(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

function normalizeTime(value) {
  const now = Date.now();
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return { at: new Date(now).toISOString(), skewed: false };
  // Jam perangkat bisa salah; masa depan > 5 menit dianggap jam perangkat meleset.
  if (parsed > now + MAX_FUTURE_MS) return { at: new Date(now).toISOString(), skewed: true };
  if (parsed < now - MAX_AGE_MS) return { at: new Date(parsed).toISOString(), skewed: true };
  return { at: new Date(parsed).toISOString(), skewed: false };
}

function publicLocation(loc) {
  if (!loc) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    accuracy: loc.accuracy || null,
    at: loc.at,
    receivedAt: loc.receivedAt || null,
    source: loc.source || 'manual'
  };
}

/** Kirim satu (atau beberapa) titik lokasi. Aman diulang (idempoten per clientId). */
router.post('/api/akun/booking/:id/lokasi', requireCustomerApi, limitUpdates, (req, res) => {
  const { booking } = findBooking(req);
  if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
  if (booking.status === 'cancelled') {
    return res.status(409).json({ error: 'Booking sudah dibatalkan.' });
  }
  if (booking.status !== 'pending' && booking.status !== 'confirmed') {
    return res.status(409).json({ error: 'Pembaruan lokasi hanya untuk booking aktif.' });
  }

  const body = req.body || {};
  const lat = parseFloat(body.lat);
  const lng = parseFloat(body.lng);
  if (!coordsValid(lat, lng)) {
    return res.status(400).json({ error: 'Koordinat tidak valid.' });
  }
  const accuracy = Number.isFinite(parseFloat(body.accuracy)) ? Math.round(parseFloat(body.accuracy)) : null;
  const { at, skewed } = normalizeTime(body.at);
  const clientId = String(body.id || body.clientId || '').slice(0, 64);
  const source = body.offline === true || body.source === 'sync' ? 'sync' : 'manual';

  booking.locationUpdates = Array.isArray(booking.locationUpdates) ? booking.locationUpdates : [];
  booking.track = Array.isArray(booking.track) ? booking.track : [];

  if (clientId && booking.locationUpdates.some((u) => u.id === clientId)) {
    return res.json({
      ok: true,
      duplicate: true,
      lastLocation: publicLocation(booking.lastLocation),
      totalUpdates: booking.locationUpdates.length
    });
  }

  const now = new Date().toISOString();
  const update = {
    id: clientId || `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    lat,
    lng,
    accuracy,
    at,
    receivedAt: now,
    source,
    offline: source === 'sync'
  };

  booking.locationUpdates.push(update);
  if (booking.locationUpdates.length > MAX_UPDATES_PER_BOOKING) {
    booking.locationUpdates.splice(0, booking.locationUpdates.length - MAX_UPDATES_PER_BOOKING);
  }
  booking.locationUpdateTotal = (booking.locationUpdateTotal || 0) + 1;
  // Titik lama (mis. tersimpan offline berhari-hari) tidak boleh menimpa
  // lokasi yang lebih baru: lastLocation hanya maju mengikuti waktu titik.
  const prevAt = booking.lastLocation && Date.parse(booking.lastLocation.at);
  const nextAt = Date.parse(at);
  if (!booking.lastLocation || !Number.isFinite(prevAt) || nextAt >= prevAt) {
    booking.lastLocation = {
      lat,
      lng,
      accuracy,
      at,
      receivedAt: now,
      source
    };
  }
  booking.track.push({
    label: source === 'sync' ? 'Lokasi tersinkron (offline)' : 'Pembaruan lokasi',
    lat,
    lng,
    at,
    source: 'location'
  });
  if (booking.track.length > MAX_TRACK_ENTRIES) {
    booking.track.splice(0, booking.track.length - MAX_TRACK_ENTRIES);
  }

  db.write();

  return res.json({
    ok: true,
    stored: true,
    skewed,
    lastLocation: publicLocation(booking.lastLocation),
    totalUpdates: booking.locationUpdateTotal || booking.locationUpdates.length
  });
});

/** Lokasi terakhir + beberapa titik terbaru (dipakai UI untuk status). */
router.get('/api/akun/booking/:id/lokasi', requireCustomerApi, (req, res) => {
  const { booking } = findBooking(req);
  if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
  const updates = (booking.locationUpdates || [])
    .slice(-10)
    .map((u) => ({
      lat: u.lat,
      lng: u.lng,
      accuracy: u.accuracy || null,
      at: u.at,
      receivedAt: u.receivedAt,
      source: u.source
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    lastLocation: publicLocation(booking.lastLocation),
    totalUpdates: booking.locationUpdateTotal || (booking.locationUpdates || []).length,
    updates
  });
});

module.exports = router;
module.exports.MAX_UPDATES_PER_BOOKING = MAX_UPDATES_PER_BOOKING;
