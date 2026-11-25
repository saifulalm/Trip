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

function write() {
  ensureDir();
  fs.writeFileSync(TMP_FILE, JSON.stringify(cache, null, 2), 'utf8');
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

module.exports = { DB_FILE, read, write, initIfEmpty, reset, uid, slugify, uniqueSlug, reload };