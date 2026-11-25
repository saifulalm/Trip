'use strict';

/**
 * Rute API presence — berbagi posisi langsung antar admin & pelanggan.
 *
 * Dipasang di `/api/presence` (lihat src/app.js). Satu endpoint untuk
 * kedua pihak; peran ditentukan dari sesi aktif:
 *   - `req.session.customerId` → pelanggan
 *   - `req.session.userId`     → admin/tim
 *
 * Endpoint:
 *   GET  /api/presence/state    → daftar partisipan aktif + posisi saya
 *   POST /api/presence/ping     → kirim koordinat saya (debounce di klien)
 *   POST /api/presence/stop     → berhenti membagikan lokasi
 *   GET  /api/presence/stream   → SSE push perubahan (real-time)
 *
 * Privasi:
 *   - Pelanggan hanya melihat admin + pelanggan dengan booking yang sama.
 *   - Admin melihat semua partisipan.
 *   - Nama pelanggan ditampilkan sebagai "Nama (Initials)" untuk tim.
 */

const express = require('express');

const db = require('../db');
const geo = require('../services/geo');
const presence = require('../services/presence');

const router = express.Router();

/**
 * Identitas partisipan dari sesi.
 * @param {object} req
 * @returns {object|null} {role, refId, name, label}
 */
function identity(req) {
  const data = db.read();

  if (req.session && req.session.userId) {
    const user = (data.users || []).find((u) => u.id === req.session.userId);
    if (user) {
      return {
        role: 'admin',
        refId: user.id,
        name: user.name || 'Admin',
        label: 'Tim'
      };
    }
  }

  if (req.session && req.session.customerId) {
    const customer = (data.customers || []).find((c) => c.id === req.session.customerId);
    if (customer) {
      return {
        role: 'customer',
        refId: customer.id,
        name: customer.name || 'Pelanggan',
        label: 'Pelanggan'
      };
    }
  }

  return null;
}

/**
 * Sanitasi entri presence untuk dikirim ke klien.
 * Koordinat dibulatkan 5 desimal (~1 meter) — cukup untuk navigasi.
 */
function publicEntry(e, distance) {
  return {
    key: e.key,
    role: e.role,
    name: e.name,
    label: e.label,
    lat: Number(Number(e.lat).toFixed(5)),
    lng: Number(Number(e.lng).toFixed(5)),
    accuracy: e.accuracy,
    at: e.at,
    bookingCodes: e.bookingCodes || [],
    distance: Number.isFinite(distance) ? Math.round(distance) : null
  };
}

/* ------------------------------------------------------------------ */
/* GET /state — posisi saya + daftar orang terdekat                   */
/* ------------------------------------------------------------------ */
router.get('/state', (req, res) => {
  const me = identity(req);
  if (!me) {
    return res.status(401).json({ ok: false, error: 'Belum masuk.' });
  }

  const data = db.read();
  const settings = data.settings || {};

  if (!presence.isEnabled(settings)) {
    return res.json({
      ok: true,
      enabled: false,
      me: { role: me.role, refId: me.refId, name: me.name },
      peers: []
    });
  }

  const mine = presence.get(me.role, me.refId);
  const peers = presence.peersOf(
    mine
      ? { role: me.role, refId: me.refId, lat: mine.lat, lng: mine.lng }
      : { role: me.role, refId: me.refId, lat: null, lng: null },
    data,
    settings
  );

  res.json({
    ok: true,
    enabled: true,
    ttlSec: Math.round(presence.ttlMs(settings) / 1000),
    me: {
      role: me.role,
      refId: me.refId,
      name: me.name,
      lat: mine ? Number(Number(mine.lat).toFixed(5)) : null,
      lng: mine ? Number(Number(mine.lng).toFixed(5)) : null,
      accuracy: mine ? mine.accuracy : null,
      at: mine ? mine.at : null
    },
    peers: peers.map((p) => {
      // Admin adalah "pencari" — ia harus melihat SEMUA partisipan,
      // bukan hanya yang dalam radius tertentu. Pelanggan lain hanya
      // melihat fellow traveler dalam radius Nearby (batas pencarian).
      if (me.role === 'admin') return publicEntry(p, p.distance);
      if (p.role === 'admin') return publicEntry(p, p.distance);
      if (p.distance !== null && p.distance <= presence.NEARBY_RADIUS_M) {
        return publicEntry(p, p.distance);
      }
      return null;
    }).filter(Boolean)
  });
});

/* ------------------------------------------------------------------ */
/* POST /ping — kirim posisi saya                                     */
/* ------------------------------------------------------------------ */
router.post('/ping', (req, res) => {
  const me = identity(req);
  if (!me) {
    return res.status(401).json({ ok: false, error: 'Belum masuk.' });
  }

  const data = db.read();
  const settings = data.settings || {};
  if (!presence.isEnabled(settings)) {
    return res.status(403).json({ ok: false, error: 'Fitur berbagi lokasi dimatikan admin.' });
  }

  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const accuracy = parseFloat(req.body.accuracy);
  if (!geo.isValidLatLng(lat, lng)) {
    return res.status(400).json({ ok: false, error: 'Koordinat tidak valid.' });
  }

  const codes = presence.bookingCodesFor(data, me.role, me.refId);
  const entry = presence.upsert(
    {
      role: me.role,
      refId: me.refId,
      name: me.name,
      label: me.label,
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      bookingCodes: codes
    },
    settings
  );

  if (!entry) {
    return res.status(400).json({ ok: false, error: 'Koordinat tidak valid.' });
  }

  res.json({ ok: true, at: entry.at });
});

/* ------------------------------------------------------------------ */
/* POST /stop — berhenti membagikan lokasi                            */
/* ------------------------------------------------------------------ */
router.post('/stop', (req, res) => {
  const me = identity(req);
  if (!me) {
    return res.status(401).json({ ok: false, error: 'Belum masuk.' });
  }
  presence.remove(me.role, me.refId);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* GET /stream — SSE push perubahan                                  */
/* ------------------------------------------------------------------ */
router.get('/stream', (req, res) => {
  const me = identity(req);
  if (!me) {
    return res.status(401).json({ ok: false, error: 'Belum masuk.' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders && res.flushHeaders();

  // Kirim state awal supaya klien langsung punya data.
  const send = (event, payload) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      /* koneksi sudah tertutup — di-handle oleh event 'close' */
    }
  };

  send('hello', { ok: true, at: new Date().toISOString() });

  const unsubscribe = presence.subscribe((change) => {
    // Kirim event ringan (tanpa koordinat lengkap) — klien ambil state
    // penuh lewat GET /state bila perlu.
    send('change', { type: change.type, key: change.key || (change.entry && change.entry.key) });
  });

  // Jaga koneksi tetap hidup (proxy sering menutup koneksi idle).
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      /* abaikan */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
    try {
      res.end();
    } catch (err) {
      /* abaikan */
    }
  });
});

module.exports = router;
