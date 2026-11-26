'use strict';
/**
 * Bersihkan emoji duplikat pada tombol yang sudah memakai ikon SVG.
 *
 * Contoh: tombol "Hapus" yang sebelumnya bertulis "🗑 Hapus" sekarang punya
 * ikon SVG, sehingga emoji-nya jadi kembar. Skrip ini menghapus karakter
 * emoji yang berada tepat sebelum/ sesudah ikon SVG di dalam teks tombol.
 *
 * Idempoten.
 *
 * Jalankan: node scripts/admin-clean-emoji-duplicates.js
 */
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views', 'admin');

/** Emoji yang relevan pada tombol admin. */
const EMOJI = [
  '🗑', '📣', '✍', '🔌', '📌', '📡', '📇', '📱', '⏰', '📝', '📄', '🏝',
  '🎫', '⭐', '👥', '✉', '⚙', '🔎', '👤', '◈', '▣', '⇅', '☁️', '➕', '➖',
  '💾', '🔄', '🔗', '🗓', '📊', '⚠️', '✅', '❌', '💡', '🎯', '🚀'
];

let changedFiles = 0;
let removed = 0;

fs.readdirSync(VIEWS)
  .filter((f) => f.endsWith('.ejs'))
  .forEach((file) => {
    const full = path.join(VIEWS, file);
    const src = fs.readFileSync(full, 'utf8');
    let out = src;

    EMOJI.forEach((emo) => {
      // Case 1: emoji berada SETELAH ikon SVG → hapus.
      const afterIcon = new RegExp(
        `(<span class="ico"><svg viewBox="0 0 22 22"><use href="#[a-z-]+"/></svg></span>)\\s*${emo}\\s*`,
        'g'
      );
      const before = out;
      out = out.replace(afterIcon, '$1');
      if (out !== before) removed += (before.match(afterIcon) || []).length;

      // Case 2: emoji berada SEBELUM ikon SVG → hapus.
      const beforeIcon = new RegExp(
        `\\s*${emo}\\s*(<span class="ico"><svg viewBox="0 0 22 22"><use href="#[a-z-]+"/></svg></span>)`,
        'g'
      );
      const before2 = out;
      out = out.replace(beforeIcon, '$1');
      if (out !== before2) removed += (before2.match(beforeIcon) || []).length;
    });

    if (out !== src) {
      fs.writeFileSync(full, out, 'utf8');
      changedFiles += 1;
      console.log('  ubah:', file);
    }
  });

console.log(`\nSelesai — ${removed} emoji dibuang pada ${changedFiles} berkas.`);
