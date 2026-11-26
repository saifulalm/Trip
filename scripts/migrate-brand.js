'use strict';

/**
 * Migrasi brand: jalanjalanenak -> seayoulatertrip.
 *
 * Script ini mengubah data yang SUDAH ADA di data/db.json tanpa mereset
 * seluruh isi (booking, pelanggan, ulasan, dsb. tetap utuh).
 *
 * Dipakai sekali setelah penggantian brand. Aman diulang: nilai yang sudah
 * benar akan dilewati.
 *
 * Jalankan: node scripts/migrate-brand.js
 */

const db = require('../src/db');

/** Nama brand baru. */
const BRAND = 'seayoulatertrip';
/** Prefix kode booking baru. */
const CODE_PREFIX = 'SYL';

/** Pasangan string lama -> baru (urutan penting: yang lebih panjang dulu). */
const REPLACEMENTS = [
  ['JalanJalanEnak', BRAND],
  ['jalanjalanenak', BRAND],
  ['JJE', CODE_PREFIX]
];

let changed = 0;

/**
 * Ganti seluruh kemunculan string brand lama pada sebuah nilai.
 * @param {string} value nilai teks apa pun
 * @returns {string} nilai baru
 */
function replaceIn(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [from, to] of REPLACEMENTS) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
      changed += 1;
    }
  }
  return out;
}

/**
 * Telusuri objek/array dan ganti string di dalamnya (mendalam).
 * @param {*} node node data
 */
function walk(node) {
  if (typeof node === 'string') return replaceIn(node);
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((key) => {
      node[key] = walk(node[key]);
    });
    return node;
  }
  return node;
}

const data = db.read();
if (!data) {
  console.error('Database kosong atau tidak terbaca:', db.DB_FILE);
  process.exit(1);
}

// 1. Ganti string brand di seluruh koleksi.
['users', 'destinations', 'packages', 'articles', 'bookings', 'messages', 'contacts', 'customers', 'reviews', 'broadcasts'].forEach(
  (key) => {
    if (Array.isArray(data[key])) data[key] = walk(data[key]);
  }
);

// 2. Pengaturan situs — perbarui field brand & kontak.
const s = data.settings || (data.settings = {});
s.brandName = BRAND;
s.siteName = BRAND;
if (typeof s.email === 'string' && s.email.includes('jalanjalanenak')) {
  s.email = s.email.split('jalanjalanenak').join(BRAND);
}
if (typeof s.instagram === 'string') s.instagram = s.instagram.split('jalanjalanenak').join(BRAND);
if (typeof s.facebook === 'string') s.facebook = s.facebook.split('jalanjalanenak').join(BRAND);
if (typeof s.about === 'string') s.about = s.about.split('JalanJalanEnak').join(BRAND).split('jalanjalanenak').join(BRAND);
if (typeof s.paymentAccountName === 'string') {
  s.paymentAccountName = s.paymentAccountName.split('JalanJalanEnak').join(BRAND).split('jalanjalanenak').join(BRAND);
}
if (typeof s.seoDescription === 'string') {
  s.seoDescription = s.seoDescription.split('JalanJalanEnak').join(BRAND).split('jalanjalanenak').join(BRAND);
}
if (typeof s.waFloatMessage === 'string') {
  s.waFloatMessage = s.waFloatMessage.split('jalanjalanenak').join(BRAND).split('JalanJalanEnak').join(BRAND);
}

db.write();

console.log('Migrasi brand selesai.');
console.log('  brandName :', s.brandName);
console.log('  siteName  :', s.siteName);
console.log('  email     :', s.email);
console.log('  instagram :', s.instagram);
console.log('  facebook  :', s.facebook);
console.log('  perubahan string:', changed);
console.log('  database  :', db.DB_FILE);
