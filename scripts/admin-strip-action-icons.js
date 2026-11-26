'use strict';
/**
 * Buang sisipan ikon SVG yang salah tempat (di dalam nilai atribut, mis. href).
 *
 * Sisipan bermasalah berbentuk:
 *   <span class="ico"><svg viewBox="0 0 22 22"><use href="#i-xxx"/></svg></span>
 * yang terselip di tengah nilai atribut tag pembuka, bukan di teks tombol.
 *
 * Skrip ini menghapus SEMUA sisipan ikon dari template admin (termasuk yang
 * benar), supaya skrip sisip ulang bisa dipakai dari kondisi bersih.
 * Idempoten.
 *
 * Jalankan: node scripts/admin-strip-action-icons.js
 */
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views', 'admin');
const ICON_SPAN = /<span class="ico"><svg viewBox="0 0 22 22"><use href="#[a-z-]+"\/><\/svg><\/span>/g;

let changedFiles = 0;
let removed = 0;

fs.readdirSync(VIEWS)
  .filter((f) => f.endsWith('.ejs'))
  .forEach((file) => {
    const full = path.join(VIEWS, file);
    const src = fs.readFileSync(full, 'utf8');
    const count = (src.match(ICON_SPAN) || []).length;
    const out = src.replace(ICON_SPAN, '');
    if (out !== src) {
      fs.writeFileSync(full, out, 'utf8');
      changedFiles += 1;
      removed += count;
      console.log(`  bersihkan: ${file} (${count})`);
    }
  });

console.log(`\nSelesai — ${removed} sisipan ikon dibuang pada ${changedFiles} berkas.`);
