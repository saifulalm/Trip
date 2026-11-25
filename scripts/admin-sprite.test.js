'use strict';

/**
 * Uji kelengkapan sprite ikon admin.
 *
 * Semua <use href="#i-nama"> yang dipakai di template WAJIB punya
 * definisi <g id="i-nama"> di views/layouts/admin.ejs. Simbol yang hilang
 * membuat ikon tak terlihat (tombol kehilangan affordance).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const viewsDir = path.join(root, 'views');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ejs')) out.push(p);
  }
  return out;
}

const layout = fs.readFileSync(path.join(viewsDir, 'layouts', 'admin.ejs'), 'utf8');
const defined = new Set([...layout.matchAll(/id="(i-[a-z]+)"/g)].map((m) => m[1]));

/**
 * Buang komentar HTML sebelum memindai pemakaian ikon.
 * Layout memuat contoh dokumentasi `<use href="#i-nama">` di dalam
 * komentar — itu bukan pemakaian ikon sungguhan.
 */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<%#[\s\S]*?%>/g, '');
}

const used = new Set();
for (const file of walk(viewsDir, [])) {
  const html = stripComments(fs.readFileSync(file, 'utf8'));
  for (const m of html.matchAll(/href="#(i-[a-z]+)"/g)) used.add(m[1]);
}

const missing = [...used].filter((id) => !defined.has(id)).sort();

console.log(`  ikon dipakai: ${used.size}, terdefinisi: ${defined.size}`);
if (missing.length) {
  console.log('  MISSING: ' + missing.join(', '));
  console.log('\n1 suite gagal.');
  process.exit(1);
}
console.log('\nSemua suite lulus.');
