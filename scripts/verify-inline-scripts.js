'use strict';
/**
 * Skrip audit: memastikan seluruh inline <script> pada halaman publik
 * yang dilayani server adalah JavaScript yang valid (tidak ada error parse).
 */
const http = require('http');

const PAGES = ['/', '/destinasi', '/paket', '/artikel', '/tentang', '/kontak', '/masuk', '/daftar'];

/* Port server yang diaudit. WAJIB sama dengan port server uji yang
   sedang berjalan — kalau tidak, skrip membaca server lama (kode STALE)
   dan hasilnya menyesatkan. Default 4100 (server dev). */
const PORT = Number(process.env.VERIFY_PORT || process.env.PORT || 4100);
const BASE = `http://localhost:${PORT}`;

function check(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let html = '';
      res.on('data', (c) => { html += c; });
      res.on('end', () => {
        // Hanya script yang benar-benar dieksekusi browser:
        // lewati yang punya atribut src, dan lewati tipe non-JS
        // (mis. application/ld+json untuk JSON-LD structured data).
        const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => {
          const attrs = m[1] || '';
          if (/\ssrc=/.test(attrs)) return false;
          const type = attrs.match(/type=["']([^"']+)["']/);
          if (type && !/javascript|module/i.test(type[1])) return false;
          return true;
        });
        scripts.forEach((m, i) => {
          if (!m[2].trim()) return;
          try {
            // eslint-disable-next-line no-new-func
            new Function(m[2]);
          } catch (e) {
            console.log('ERROR', url, 'script#' + i, '->', e.message);
            resolve({ url, ok: false });
            return;
          }
        });
        resolve({ url, ok: true });
      });
    }).on('error', (e) => {
      console.log('REQUEST ERROR', url, e.message);
      resolve({ url, ok: false });
    });
  });
}

(async () => {
  let failed = 0;
  for (const p of PAGES) {
    const r = await check(BASE + p);
    if (!r.ok) failed += 1;
  }
  console.log(failed === 0
    ? `OK — ${PAGES.length} halaman, semua inline script valid`
    : `${failed} halaman bermasalah`);
})();
