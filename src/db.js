'use strict';

/**
 * Lapisan penyimpanan data berbasis file JSON.
 * Sederhana, tanpa dependensi native, aman untuk Windows/Laragon.
 * Struktur data disimpan di data/db.json dengan tulis atomik (via file sementara).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, '.db.tmp');

let cache = null;
/** Sidik jari file di disk (mtime + ukuran) — dipakai untuk mendeteksi
 *  perubahan yang terjadi DI LUAR proses (mis. `npm run migrate:brand`
 *  selagi server masih jalan). */
let cacheStamp = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileStamp() {
  try {
    const st = fs.statSync(DB_FILE);
    return `${st.mtimeMs}:${st.size}`;
  } catch (err) {
    return null;
  }
}

function read() {
  ensureDir();
  const stamp = fileStamp();
  // Muat ulang kalau file berubah di luar proses.
  if (cache && stamp && stamp === cacheStamp) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    cache = parsed;
    cacheStamp = stamp;
  } catch (err) {
    if (!cache) cache = null;
  }
  return cache;
}

function write() {
  ensureDir();
  fs.writeFileSync(TMP_FILE, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE); // atomik di Windows & POSIX
  cacheStamp = fileStamp();
}

function initIfEmpty(seedFn) {
  const current = read();
  if (!current || !Array.isArray(current.users) || current.users.length === 0) {
    cache = seedFn();
    write();
  }
  return cache;
}

function reset(newData) {
  cache = newData;
  write();
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

module.exports = { DB_FILE, read, write, initIfEmpty, reset, uid, slugify, uniqueSlug };