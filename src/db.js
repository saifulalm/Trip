'use strict';

/**
 * Lapisan penyimpanan data berbasis file JSON.
 * Sederhana, tanpa dependensi native, aman untuk Windows/Laragon.
 * Struktur data disimpan di data/db.json dengan tulis atomik (via file sementara).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Lokasi basis data.
 *
 * `SABESI_DATA_DIR` memungkinkan skrip uji memakai basis data sintetis di
 * folder terpisah. Tanpa itu, skrip uji yang memanggil `db.reset()` akan
 * menimpa `data/db.json` produksi — dan kalau ada server yang sedang
 * berjalan, restore berkas manual akan ditimpa balik oleh cache server.
 *
 * Env ini hanya untuk pengujian & tooling; server produksi tidak pernah
 * menyetelnya.
 */
const DATA_DIR = process.env.SABESI_DATA_DIR
  ? path.resolve(process.env.SABESI_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, '.db.tmp');

// Folder data PRODUKSI (repo ini). Skrip uji tidak boleh menulis ke sini.
const PROD_DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Apakah folder data yang aktif adalah folder data produksi.
 *
 * @param {string} dir folder data yang aktif
 * @returns {boolean} true bila folder itu adalah folder produksi
 */
function isProductionDataDir(dir) {
  const a = path.resolve(dir);
  const b = path.resolve(PROD_DATA_DIR);
  return a === b || a.indexOf(b + path.sep) === 0;
}

/**
 * Apakah proses ini adalah SKRIP UJI (berada di folder `scripts/`).
 *
 * Penjaga produksi hanya berlaku untuk skrip uji. Server aplikasi
 * (`server.js`) dan skrip seed (`src/seed.js`) WAJIB boleh menulis ke
 * `data/db.json` produksi — itulah cara normal aplikasi berjalan.
 * @returns {boolean} true bila proses dijalankan dari folder scripts/
 */
function isTestProcess() {
  const entry = process.argv && process.argv[1];
  if (!entry) return false;
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const resolved = path.resolve(entry);
  return resolved.indexOf(path.resolve(scriptsDir) + path.sep) === 0;
}

let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  if (cache) return cache;
  ensureDir();
  try {
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    cache = null;
  }
  return cache;
}

/**
 * Tulis basis data ke disk.
 *
 * @param {object} [data] data yang akan ditulis (default: cache)
 * @param {object} [opts] { force: true } = lewati penjaga produksi
 */
function write(data, opts) {
  const options = opts || {};
  // PENJAGA PRODUKSI: SKRIP UJI tidak boleh menulis ke `data/db.json`
  // produksi. Env `SABESI_DATA_DIR` harus diarahkan ke folder terpisah
  // (lihat `scripts/test-db.js`). Tanpa penjaga ini, satu skrip uji yang
  // lupa meng-require `test-db` akan menimpa data asli secara diam-diam.
  //
  // Penjaga ini HANYA berlaku untuk proses di folder `scripts/`. Server
  // aplikasi & skrip seed tetap boleh menulis ke produksi (memang itulah
  // cara normal aplikasi bekerja).
  if (
    !options.force &&
    isTestProcess() &&
    isProductionDataDir(DATA_DIR) &&
    process.env.SABESI_ALLOW_PROD_WRITE !== '1'
  ) {
    const err = new Error(
      'Penolakan menulis basis data produksi (' + DB_FILE + '). ' +
      'Skrip uji WAJIB me-require scripts/test-db.js lebih dulu (atau ' +
      'menyetel SABESI_DATA_DIR ke folder terpisah) sebelum memanggil ' +
      'db.reset()/db.write().'
    );
    err.code = 'PROD_DB_WRITE_FORBIDDEN';
    throw err;
  }
  ensureDir();
  const payload = data === undefined ? cache : data;
  fs.writeFileSync(TMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE); // atomik di Windows & POSIX
}

function initIfEmpty(seedFn) {
  const current = read();
  if (!current || !Array.isArray(current.users) || current.users.length === 0) {
    cache = seedFn();
    write();
  }
  return cache;
}

/**
 * Ganti seluruh isi basis data.
 *
 * CATATAN: `reset()` memakai penjaga produksi yang sama dengan `write()`.
 * Kalau skrip uji tidak meng-require `scripts/test-db.js`, panggilan ini
 * melempar error DAN tidak menulis apa pun ke `data/db.json` produksi.
 *
 * @param {object} newData data baru
 */
function reset(newData) {
  cache = newData;
  write(newData);
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function uniqueSlug(collection, base, excludeId) {
  let slug = base || 'item';
  let n = 1;
  while (collection.some((x) => x.slug === slug && x.id !== excludeId)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/**
 * Baca ulang berkas db.json dari disk, buang cache.
 *
 * Cache di modul ini berguna untuk sprout (server hanya satu proses), tapi
 * skrip uji / alat CLI yang berjalan sebagai proses TERPISAH butuh melihat
 * data yang baru ditulis proses lain (mis. server).
 *
 * @returns {object} data terbaru
 */
function reload() {
  cache = null;
  return read();
}

module.exports = {
  DB_FILE,
  DATA_DIR,
  PROD_DATA_DIR,
  read,
  write,
  initIfEmpty,
  reset,
  uid,
  slugify,
  uniqueSlug,
  reload,
  isProductionDataDir,
  isTestProcess
};