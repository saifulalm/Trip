'use strict';

/**
 * Basis data terisolasi untuk skrip uji.
 *
 * WAJIB di-require sebelum `src/db` — modul `src/db` membaca
 * `SABESI_DATA_DIR` saat pertama kali dimuat, jadi env harus disetel lebih
 * dulu.
 *
 * Kenapa perlu:
 *   Skrip uji lama memakai `db.reset()` lalu restore `data/db.json` manual.
 *   Kalau ada server dev yang sedang berjalan, restore manual itu ditimpa
 *   balik oleh cache server — dan data produksi bisa ikut rusak (akun
 *   pelanggan sempat hilang). Dengan folder data terpisah, file produksi
 *   tidak pernah disentuh sama sekali.
 *
 * Contoh:
 *   const testDb = require('./test-db');
 *   const db = require(path.join(root, 'src', 'db')); // sudah terisolasi
 *
 * @param {string} [label] nama folder uji (default: 'test')
 * @returns {string} path absolut folder data uji
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Env harus di-set SEBELUM `src/db` dimuat.
const label = process.env.SABESI_TEST_LABEL || 'test';
const dir = process.env.SABESI_TEST_DIR
  ? path.resolve(process.env.SABESI_TEST_DIR)
  : path.join(os.tmpdir(), `sabesi-test-${label}`);

try {
  fs.mkdirSync(dir, { recursive: true });
} catch (_) {
  /* abaikan */
}

process.env.SABESI_DATA_DIR = dir;

// Pastikan ada basis data dasar di folder uji.
//
// SEBAB: beberapa suite (mis. hero-mode.test.js) hanya membaca `settings`
// dari basis data tanpa melakukan `db.reset()` sendiri. Sebelum folder uji
// ada, `db.read()` membaca `data/db.json` produksi — jadi setelah isolasi
// diterapkan, folder uji harus berisi basis data awal yang bisa dibaca.
//
// Suite yang butuh data khusus tetap boleh memanggil `db.reset()` sendiri
// (nilai awal ini hanya "bawaan").
try {
  const dbFile = path.join(dir, 'db.json');
  if (!fs.existsSync(dbFile)) {
    // `src/seed` membaca SABESI_DATA_DIR saat dimuat — env di atas sudah
    // disetel, jadi basis data seed ikut ditulis ke folder uji (bukan
    // ke folder produksi).
    const seed = require(path.join(__dirname, '..', 'src', 'seed'));
    fs.writeFileSync(dbFile, JSON.stringify(seed.buildSeed(), null, 2), 'utf8');
  }
} catch (_) {
  /* abaikan — suite yang butuh data akan melakukan reset sendiri */
}

module.exports = { DATA_DIR: dir };
