'use strict';
/**
 * Sisipkan ikon SVG ke tombol aksi pada template admin.
 *
 * Tombol yang diberi ikon:
 *   - "Lihat"  → #i-eye
 *   - "Edit"   → #i-edit
 *   - "Hapus"  → #i-trash
 *   - "Tambah"/"Tulis"/"Buat" → #i-plus
 *
 * Sifatnya idempoten: kalau tombolnya sudah punya <span class="ico">,
 * skrip ini melompatinya.
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

let changedFiles = 0;
let changedButtons = 0;

fs.readdirSync(VIEWS)
  .filter((f) => f.endsWith('.ejs'))
  .forEach((file) => {
    const full = path.join(VIEWS, file);
    const src = fs.readFileSync(full, 'utf8');
    let out = src;

    ICONS.forEach(({ label, icon }) => {
      // Cocokkan: >Label< yang berada di dalam satu tag <button>/<a> ... >Label</...>
      // Kita proses per tag agar tidak salah menyisipkan di tempat lain.
      const tagRe = new RegExp(`(<(?:button|a)\\b[^>]*>)([^<]*\\b${label}\\b[^<]*)(</(?:button|a)>)`, 'g');
      out = out.replace(tagRe, (match, open, inner, close) => {
        // Sudah punya ikon? Jangan sisipkan dua kali.
        if (inner.indexOf('class="ico"') !== -1) return match;
        const m = inner.match(/^(\s*)(\S.*?)(\s*)$/s);
        if (!m) return match;
        const [, lead, text, trail] = m;
        changedButtons += 1;
        return `${open}${lead}<span class="ico"><svg viewBox="0 0 22 22"><use href="#${icon}"/></svg></span>${text}${trail}${close}`;
      });
    });

    if (out !== src) {
      fs.writeFileSync(full, out, 'utf8');
      changedFiles += 1;
      console.log('  ubah:', file);
    }
  });

console.log(`\nSelesai — ${changedButtons} tombol pada ${changedFiles} berkas.`);
