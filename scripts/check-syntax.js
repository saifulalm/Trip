'use strict';

/**
 * check-syntax.js — Pemeriksaan sintaks & konsistensi proyek.
 *
 * Menggantikan "npm run lint" pada proyek yang tidak memakai ESLint.
 * Yang diperiksa:
 *  1. Sintaks setiap file .js di server.js, src/, scripts/, public/js/.
 *  2. Modul aplikasi dapat dimuat tanpa error.
 *  3. Helper yang dipakai template tersedia di res.locals.
 *  4. Tidak ada sisa nama brand lama — di kode maupun di data/db.json.
 *
 * Catatan: pemeriksaan RENDER seluruh halaman (EJS + include + variabel)
 * ada di file terpisah: scripts/smoke-test.js (npm run smoke). Checksyntax
 * hanya membaca sumber, jadi tidak bisa menangkap error yang muncul saat
 * view benar-benar dirender.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'scripts', 'public/js'];
let errors = 0;
let checked = 0;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/* ---------- 1. Sintaks JavaScript ---------- */
const files = [path.join(ROOT, 'server.js')];
for (const d of DIRS) walk(path.join(ROOT, d), files);

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked += 1;
  } catch (err) {
    errors += 1;
    console.error(`✗ Sintaks salah: ${path.relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message).split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`✓ Sintaks JavaScript: ${checked}/${files.length} file OK`);

/* ---------- 2. Modul aplikasi ---------- */
try {
  require(path.join(ROOT, 'src', 'app.js'));
  console.log('✓ Modul aplikasi (src/app.js) termuat tanpa error');
} catch (err) {
  errors += 1;
  console.error('✗ Gagal memuat src/app.js:', err.message);
}

/* ---------- 3. Helper wajib untuk template ---------- */
const requiredLocals = [
  'settings', 'brand', 'csrfToken', 'flash', 'formatRupiah', 'formatDateLong',
  'formatDateShort', 'initials', 'excerpt', 'renderRichText', 'bookingStatusLabel',
  'bookingStatusTone', 'paymentStatusLabel', 'paymentStatusTone', 'starRating',
  'publicationStatusLabel', 'publicationStatusTone', 'formatCoord',
  'sortUrl', 'currentPath', 'year', 'seo', 'absoluteUrl', 'canonicalBase'
];

const contextSrc = fs.readFileSync(path.join(ROOT, 'src', 'middleware', 'context.js'), 'utf8');
const missing = requiredLocals.filter(
  (name) => !contextSrc.includes(`res.locals.${name}`) && !contextSrc.includes(`${name}:`)
);
if (missing.length) {
  errors += 1;
  console.error('✗ res.locals belum menyediakan:', missing.join(', '));
} else {
  console.log(`✓ res.locals lengkap (${requiredLocals.length} helper)`);
}

/* ---------- 4. Nama brand lama tidak boleh tersisa ---------- */
/* Catatan: pakai \bJJE\b (bukan \bJJE-) supaya "Thanks JJE!" — nama lama
   yang telanjang di data — ikut tertangkap. */
const OLD_BRAND = /jalanjalanenak|JalanJalanEnak|\bJJE\b/i;
const scanDirs = ['src', 'views', 'public', 'scripts'];
// Script migrasi & pemeriksa memang SENGAJA memuat nama brand lama.
const BRAND_ALLOWLIST = new Set([
  path.join(ROOT, 'scripts', 'migrate-brand.js'),
  path.join(ROOT, 'scripts', 'check-syntax.js')
]);
let brandHits = 0;
for (const d of scanDirs) {
  const base = path.join(ROOT, d);
  const walkDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walkDir(target);
      } else if (/\.(js|ejs|css|json)$/i.test(entry.name)) {
        if (BRAND_ALLOWLIST.has(target)) continue;
        const text = fs.readFileSync(target, 'utf8');
        if (OLD_BRAND.test(text)) {
          brandHits += 1;
          console.error(`✗ Nama brand lama masih ada di ${path.relative(ROOT, target)}`);
        }
      }
    }
  };
  walkDir(base);
}

/* Data live juga ikut diperiksa — nama brand lama bisa masih tersimpan di
   data/db.json (konten, ulasan, pengaturan) even though kodenya bersih.
   Backup di data/db.backup-*.json sengaja TIDAK diperiksa: isinya memang
   data lama dan itu justru tujuan backup. */
const liveDb = path.join(ROOT, 'data', 'db.json');
if (fs.existsSync(liveDb)) {
  const text = fs.readFileSync(liveDb, 'utf8');
  if (OLD_BRAND.test(text)) {
    brandHits += 1;
    console.error('✗ Nama brand lama masih ada di data/db.json');
    console.error('  Jalankan: npm run migrate:brand');
  }
}

if (brandHits) {
  errors += 1;
} else {
  console.log('✓ Tidak ada sisa nama brand lama di kode maupun data');
}

console.log('');
if (errors) {
  console.error(`✗ ${errors} masalah ditemukan.`);
  process.exit(1);
}
console.log('✓ Semua pemeriksaan lolos.');
