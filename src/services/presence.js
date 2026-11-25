'use strict';

/**
 * Service presence — berbagi posisi langsung antar anggota tim (admin)
 * dan pelanggan, agar tidak ada yang tersesat saat keberangkatan.
 *
 * DESAIN
 * ------
 * 1. Penyimpanan TERPISAH dari `data/db.json` (lihat `data/presence.json`).
 *    Alasannya: ping lokasi datang tiap ~20 detik. Bila ditulis ke db.json,
 *    seluruh berkas (puluhan KB) ditulis ulang tiap ping → boros I/O dan
 *    berisiko menimpa perubahan lain. Presence bersifat sementara (TTL),
 *    jadi tidak pantas masuk ke dokumen utama.
 *
 * 2. TTL (time-to-live). Setiap entri punya `at` (waktu terakhir dibaca).
 *    Entri yang lebih tua dari TTL dianggap "offline" dan dibuang.
 *    Ini membuat kondisi offline aman: perangkat yang mati mendadak tidak
 *    meninggalkan titik palsu selamanya.
 *
 * 3. Bus event sederhana (EventEmitter) untuk push real-time ke klien
 *    lewat Server-Sent Events (SSE). Tanpa dependensi tambahan — Express
 *    sudah cukup untuk SSE.
 *
 * 4. Offline di sisi klien ditangani di `public/js/presence.js`
 *    (antrean localStorage + cache snapshot). Sisi server hanya perlu
 *    menerima ping dan menyiarkan perubahan.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const geo = require('./geo');

// Folder data. `SABESI_DATA_DIR` dipakai skrip uji & runner E2E supaya
// berkas presence uji tidak bercampur dengan yang sedang berjalan.
//
// PENTING: tanpa ini, `data/presence.json` produksi dipakai bersama oleh
// server dev DAN server uji → entri partisipan lama bocor ke hasil uji
// (mis. uji "pelanggan tidak melihat pelanggan lain" gagal karena
// pelanggan dari run sebelumnya masih ada di berkas).
const DATA_DIR = process.env.SABESI_DATA_DIR
  ? path.resolve(process.env.SABESI_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

// Env `PRESENCE_FILE` dipakai skrip uji agar data uji tidak menyentuh
// berkas presence milik aplikasi yang sedang berjalan.
const FILE = process.env.PRESENCE_FILE || path.join(DATA_DIR, 'presence.json');
const TMP_FILE = path.join(path.dirname(FILE), '.' + path.basename(FILE) + '.tmp');

/** TTL bawaan (ms). Entri basi → dianggap offline. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Batas TTL yang boleh diatur admin (menit). */
const MIN_TTL_MIN = 1;
const MAX_TTL_MIN = 120;

/** Batas jarak pencarian "orang terdekat" yang ditampilkan ke klien (meter). */
const NEARBY_RADIUS_M = 50000;

/**
 * Versi skema berkas presence.
 *
 * v1: hanya `entries` (posisi live dengan TTL).
 * v2: `entries` + `lastSeen` (posisi terakhir yang diketahui, persisten).
 */
const SCHEMA_VERSION = 2;

const bus = new EventEmitter();
// Hindari warning EventEmitter MaxListeners (banyak tab admin terbuka).
bus.setMaxListeners(200);

let entries = Object.create(null);
let lastSeenMap = Object.create(null);
let loaded = false;

/* ------------------------------------------------------------------ */
/* Penyimpanan disk                                                    */
/* ------------------------------------------------------------------ */

/** Pastikan folder data ada. */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Baca berkas presence dari disk (hanya sekali per proses).
 * Failur apa pun tidak boleh menggagalkan boot server — fallback ke data kosong.
 *
 * Dua bagian data yang dibaca:
 *  - `entries`  → posisi live (dihapus oleh TTL).
 *  - `lastSeen` → posisi terakhir yang diketahui (persisten, tanpa TTL).
 *
 * Berkas versi lama (v1, hanya `entries`) tetap bisa dibaca — `lastSeen`
 * dianggap kosong.
 */
function load() {
  if (loaded) return entries;
  loaded = true;
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      entries = (raw && raw.entries && typeof raw.entries === 'object') ? raw.entries : Object.create(null);
      lastSeenMap = (raw && raw.lastSeen && typeof raw.lastSeen === 'object') ? raw.lastSeen : Object.create(null);
    }
  } catch (err) {
    entries = Object.create(null);
    lastSeenMap = Object.create(null);
  }
  return entries;
}

/**
 * Tulis berkas presence secara atomik (tulis sementara lalu rename).
 * Sengaja TIDAK memakai fs.writeFileSync langsung ke FILE, supaya tidak
 * ada berkas rusak bila proses mati di tengah penulisan.
 */
function persist() {
  ensureDir();
  try {
    fs.writeFileSync(
      TMP_FILE,
      JSON.stringify({ version: SCHEMA_VERSION, entries, lastSeen: lastSeenMap }, null, 2),
      'utf8'
    );
    fs.renameSync(TMP_FILE, FILE);
  } catch (err) {
    // Presence bukan data kritis — kegagalan menulis tidak boleh mematikan
    // aplikasi.
  }
}

/* ------------------------------------------------------------------ */
/* Utilitas                                                            */
/* ------------------------------------------------------------------ */

/**
 * Kunci unik untuk sebuah partisipan.
 * Admin memakai id user, pelanggan memakai id customer.
 */
function keyOf(role, refId) {
  return `${role}:${refId}`;
}

/**
 * Ambil TTL efektif (ms) dari settings, dengan batas aman.
 * @param {object} settings data.settings
 * @returns {number} TTL dalam ms
 */
function ttlMs(settings) {
  const raw = Number(settings && settings.presenceTtlMin);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_MS;
  const min = Math.min(MAX_TTL_MIN, Math.max(MIN_TTL_MIN, Math.round(raw)));
  return min * 60 * 1000;
}

/** Apakah fitur presence dimatikan admin lewat Pengaturan? */
function isEnabled(settings) {
  return !(settings && settings.presenceEnabled === false);
}

/**
 * Buang entri yang sudah basi (lebih tua dari TTL).
 * @param {number} ttl masa berlaku ms
 * @returns {number} jumlah entri yang dibuang
 */
function sweep(ttl) {
  const now = Date.now();
  let removed = 0;
  Object.keys(entries).forEach((k) => {
    const e = entries[k];
    if (!e || !e.at || now - new Date(e.at).getTime() > ttl) {
      delete entries[k];
      removed += 1;
    }
  });
  return removed;
}

/* ------------------------------------------------------------------ */
/* API service                                                         */
/* ------------------------------------------------------------------ */

/**
 * Simpan / perbarui posisi seorang partisipan.
 *
 * @param {object} p
 * @param {string} p.role 'admin' | 'customer'
 * @param {string} p.refId id user / customer
 * @param {string} p.name nama tampilan
 * @param {number} p.lat latitude
 * @param {number} p.lng longitude
 * @param {number} [p.accuracy] akurasi meter
 * @param {string} [p.label] keterangan peran, mis. "Pemandu"
 * @param {string[]} [p.bookingCodes] kode booking yang relevan
 * @param {object} [settings] data.settings (untuk TTL)
 * @returns {object|null} entri tersimpan, atau null bila koordinat invalid
 */
function upsert(p, settings) {
  if (!p || !p.role || !p.refId) return null;
  if (!geo.isValidLatLng(p.lat, p.lng)) return null;

  load();
  const key = keyOf(p.role, p.refId);
  const now = new Date().toISOString();
  const entry = {
    key,
    role: p.role,
    refId: p.refId,
    name: String(p.name || '').slice(0, 80),
    label: String(p.label || '').slice(0, 60),
    lat: Number(p.lat),
    lng: Number(p.lng),
    accuracy: Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null,
    bookingCodes: Array.isArray(p.bookingCodes) ? p.bookingCodes.slice(0, 10).map(String) : [],
    at: now
  };
  entries[key] = entry;

  // Simpan juga sebagai "titik terakhir yang diketahui".
  //
  // Alasan penyimpanan terpisah: entri live dihapus oleh TTL, tapi lastSeen
  // tidak — supaya posisi terakhir tetap bisa dilihat. Untuk kasus darurat
  // (pengguna hilang berjam-jam), admin masih bisa melihat di mana posisinya
  // terakhir kali tercatat.
  const prevSeen = lastSeenMap[key] || {};
  lastSeenMap[key] = {
    role: p.role,
    refId: p.refId,
    name: entry.name || prevSeen.name || '',
    label: entry.label || prevSeen.label || '',
    lat: entry.lat,
    lng: entry.lng,
    accuracy: entry.accuracy,
    at: now,
    source: 'live'
  };

  sweep(ttlMs(settings));
  persist();
  bus.emit('change', { type: 'upsert', entry });
  return entry;
}

/**
 * Ambil entri milik satu partisipan (tanpa memfilter TTL).
 * @param {string} role
 * @param {string} refId
 * @returns {object|null}
 */
function get(role, refId) {
  load();
  return entries[keyOf(role, refId)] || null;
}

/**
 * Ambil titik terakhir yang diketahui untuk satu peserta.
 *
 * Tidak dipengaruhi TTL — justru tujuannya: menjawab "di mana dia terakhir
 * terlihat" walaupun sudah offline berjam-jam.
 *
 * @param {string} role 'admin' atau 'customer'
 * @param {string} refId id peserta
 * @returns {object|null} entri last-seen dengan `ageMin`, atau null
 */
function lastSeen(role, refId) {
  load();
  const e = lastSeenMap[keyOf(role, refId)];
  if (!e || !geo.isValidLatLng(e.lat, e.lng)) return null;
  const at = e.at ? new Date(e.at).getTime() : 0;
  const ageMin = at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;
  return { ...e, ageMin };
}

/**
 * Semua titik terakhir yang diketahui (untuk admin).
 * @returns {object[]} daftar entri last-seen, terbaru dulu
 */
function lastSeenAll() {
  load();
  const out = [];
  Object.keys(lastSeenMap).forEach((k) => {
    const e = lastSeenMap[k];
    if (!e || !geo.isValidLatLng(e.lat, e.lng)) return;
    const at = e.at ? new Date(e.at).getTime() : 0;
    out.push({
      ...e,
      ageMin: at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null
    });
  });
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

/** Kosongkan seluruh data presence (dipakai pengujian). */
function reset() {
  try {
    fs.writeFileSync(
      FILE,
      JSON.stringify({ version: SCHEMA_VERSION, entries: {}, lastSeen: {} }, null, 2),
      'utf8'
    );
    entries = Object.create(null);
    lastSeenMap = Object.create(null);
    loaded = true;
  } catch (err) {
    // abaikan — presence bukan data kritis
  }
}

/**
 * Hapus entri (partisipan berhenti membagikan lokasi).
 * @returns {boolean} true bila ada yang dihapus
 */
function remove(role, refId) {
  load();
  const key = keyOf(role, refId);
  if (!entries[key]) return false;
  delete entries[key];
  persist();
  bus.emit('change', { type: 'remove', key });
  return true;
}

/**
 * Semua entri yang masih aktif (belum basi).
 * @param {object} [settings] data.settings
 * @returns {object[]}
 */
function list(settings) {
  load();
  const ttl = ttlMs(settings);
  sweep(ttl);
  return Object.keys(entries).map((k) => entries[k]).filter(Boolean);
}

/**
 * Daftar *"orang terdekat"* yang boleh dilihat oleh partisipan tertentu.
 *
 * Aturan privasi:
 *  - Admin melihat semua partisipan.
 *  - Pelanggan melihat admin/tim (agar mudah dihubungi).
 *  - Pelanggan hanya melihat pelanggan lain bila KOMPONEN booking-nya sama
 *    (grup dwelt bersama) — supaya antar pelanggan tidak saling.
 *
 * @param {object} me identitas partisipan peminta {role, refId}
 * @param {object} data data aplikasi (untuk data.bookings)
 * @param {object} [settings] data.settings
 * @returns {object[]} entri + jarak meter (distance)
 */
function peersOf(me, data, settings) {
  if (!me) return [];
  const all = list(settings);
  const mine = me.role === 'admin' ? null : customerBookingCodes(data, me.refId);
  // Bila peminta belum punya posisi (belum membagikan lokasi), jaraknya
  // tidak bisa dihitung — peer tetap ditampilkan tanpa info jarak.
  const hasSelf = geo.isValidLatLng(me.lat, me.lng);

  return all
    .filter((e) => e.key !== keyOf(me.role, me.refId))
    .filter((e) => {
      if (me.role === 'admin') return true;
      if (e.role === 'admin') return true;
      if (!mine || !mine.length) return false;
      const theirs = e.bookingCodes || [];
      return theirs.some((c) => mine.includes(c));
    })
    .map((e) => ({
      ...e,
      distance: hasSelf
        ? geo.haversineMeters(me.lat, me.lng, e.lat, e.lng)
        : null
    }))
    .filter((e) => e.distance === null || Number.isFinite(e.distance))
    .sort((a, b) => {
      // Tanpa jarak, urutkan admin lebih dulu lalu berdasarkan nama.
      if (a.distance === null && b.distance === null) {
        return String(a.name).localeCompare(String(b.name));
      }
      if (a.distance === null) return -1;
      if (b.distance === null) return 1;
      return a.distance - b.distance;
    });
}

/**
 * Kode-kode booking milik seorang pelanggan.
 * @param {object} data data aplikasi
 * @param {string} customerId
 * @returns {string[]}
 */
function customerBookingCodes(data, customerId) {
  const bookings = (data && data.bookings) || [];
  return bookings
    .filter((b) => b.customerId === customerId && b.code)
    .map((b) => String(b.code));
}

/**
 * Ambil kode booking milik pelanggan (untuk dikirim bersama ping).
 * @param {object} data data aplikasi
 * @param {string} customerId
 * @returns {string[]}
 */
function bookingCodesFor(data, role, refId) {
  if (role === 'customer') return customerBookingCodes(data, refId);
  // Admin melihat semua — kosongkan daftar agar tidak membatasi.
  return [];
}

/**
 * Berlangganan perubahan presence.
 * @param {function} fn callback receives {type, entry?, key?}
 * @returns {function} fungsi unsubscribe
 */
function subscribe(fn) {
  bus.on('change', fn);
  return function unsubscribe() {
    bus.removeListener('change', fn);
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  MIN_TTL_MIN,
  MAX_TTL_MIN,
  NEARBY_RADIUS_M,
  SCHEMA_VERSION,
  FILE,
  keyOf,
  ttlMs,
  isEnabled,
  upsert,
  get,
  lastSeen,
  lastSeenAll,
  reset,
  remove,
  list,
  peersOf,
  bookingCodesFor,
  customerBookingCodes,
  subscribe
};
