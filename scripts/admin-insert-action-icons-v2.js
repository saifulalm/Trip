'use strict';
/**
 * Sisipkan ikon SVG ke tombol aksi pada template admin.
 *
 * Aturan penting: ikon hanya disisipkan pada TEKS TOMBOL — isi antara `>`
 * pembuka tag dan `<` penutup tag. Regex yang menyaring seluruh tag bisa
 * kelar dan menyisipkan ikon di tengah nilai atribut (mis. di dalam href),
 * karena `[^>]*` masih cocok dengan tanda kutip.
 * Solusinya: tag pembuka diparse manual — cari `>` yang benar-benar menutup
 * tag (mengabaikan tanda kutip di dalam nilai atribut), lalu sisipkan tepat
 * setelah teks tombol.
 *
 * Idempoten: kalau teks tombol sudah punya <span class="ico">, dilewati.
 *
 * Jalankan: node scripts/admin-insert-action-icons.js
 */
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views', 'admin');

/** Pasangan label → id ikon dalam sprite. */
const ICONS = [
  { label: 'Lihat', icon: 'i-eye' },
  { label: 'Edit', icon: 'i-edit' },
  { label: 'Hapus', icon: 'i-trash' },
  { label: 'Tambah', icon: 'i-plus' },
  { label: 'Tulis', icon: 'i-plus' },
  { label: 'Buat', icon: 'i-plus' }
];

/**
 * Cari indeks karakter `>` yang benar-benar menutup tag pembuka.
 * Mengabaikan tanda kutip di dalam nilai atribut.
 * @param {string} src seluruh markup
 * @param {number} start indeks setelah "<"
 * @returns {number} indeks ">" penutup tag, atau -1
 */
function findTagEnd(src, start) {
  let quote = '';
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

let changedFiles = 0;
let changedButtons = 0;

fs.readdirSync(VIEWS)
  .filter((f) => f.endsWith('.ejs'))
  .forEach((file) => {
    const full = path.join(VIEWS, file);
    const src = fs.readFileSync(full, 'utf8');
    let out = src;

    ICONS.forEach(({ label, icon }) => {
      let cursor = 0;

      for (;;) {
        const at = out.indexOf(label, cursor);
        if (at === -1) break;
        cursor = at + label.length;

        // Mundur ke "<" sebelumnya untuk menemukan tag pembuka.
        const openIdx = out.lastIndexOf('<', at);
        if (openIdx === -1) continue;
        const tagName = out.slice(openIdx + 1).match(/^([a-zA-Z]+)/);
        if (!tagName || (tagName[1] !== 'a' && tagName[1] !== 'button')) continue;

        const tagEnd = findTagEnd(out, openIdx + 1);
        if (tagEnd === -1) continue;

        // Label harus SETELAH tag pembuka (yaitu di teks tombol, bukan atribut).
        if (at < tagEnd) continue;

        const closeIdx = out.indexOf('<', tagEnd);
        if (closeIdx === -1) continue;

        const inner = out.slice(tagEnd + 1, closeIdx);
        if (inner.indexOf('class="ico"') !== -1) continue;
        if (inner.indexOf('<') !== -1) continue;

        const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (!m || !m[2]) continue;

        const [, lead, text, trail] = m;
        const iconHtml = `<span class="ico"><svg viewBox="0 0 22 22"><use href="#${icon}"/></svg></span>`;
        out = out.slice(0, tagEnd + 1) + lead + iconHtml + text + trail + out.slice(closeIdx);
        cursor = tagEnd + 1 + lead.length + iconHtml.length + text.length + trail.length;
        changedButtons += 1;
      }
    });

    if (out !== src) {
      fs.writeFileSync(full, out, 'utf8');
      changedFiles += 1;
      console.log('  ubah:', file);
    }
  });

console.log(`\nSelesai — ${changedButtons} tombol pada ${changedFiles} berkas.`);
