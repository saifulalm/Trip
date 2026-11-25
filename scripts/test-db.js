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

module.exports = { DATA_DIR: dir };
