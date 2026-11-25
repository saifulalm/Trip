'use strict';
/**
 * Uji end-to-end alur tautan profil media sosial.
 *
 * 1. Login admin.
 * 2. Simpan tautan profil lewat form /admin/social/profil.
 * 3. Pastikan tautan muncul di footer situs publik.
 * 4. Pastikan tautan masuk ke structured data sameAs (SEO).
 * 5. Kembalikan settings ke kondisi semula.
 */
const http = require('http');
const path = require('path');

const BASE = { host: 'localhost', port: Number(process.env.VERIFY_PORT) || Number(process.env.PORT) || 4100 };
// Basis data yang dibaca skrip ini. Kalau `SABESI_DATA_DIR` diisi (mis. saat
// dijalankan lewat `scripts/run-e2e.js`), yang dibaca adalah folder data uji.
// Tanpa ini, skrip membaca folder produksi padahal server uji menulis ke
// folder uji → hasil audit palsu.
const DB_FILE = process.env.SABESI_DATA_DIR
  ? path.join(process.env.SABESI_DATA_DIR, 'db.json')
  : path.join(__dirname, '..', 'data', 'db.json');

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...BASE, path, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout ' + path)); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

let pass = 0;
let fail = 0;

/** Catat hasil satu assertion. */
function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    fail += 1;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

(async () => {
  const social = require('../src/services/social');

  // Token CSRF & cookie di-deklarasikan di luar try agar bisa dipakai
  // pada blok finally untuk merestorasi data.
  let csrf = null;
  let cookie = null;
  // Nilai asli tautan profil harus dideklarasikan di luar try agar bisa
  // dipakai pada blok finally untuk merestorasi data. Bila hanya
  // dideklarasikan di dalam try, blok finally akan ReferenceError.
  const originalLinks = {};

  try {
    // 1. Login admin.
    const loginPage = await request('/admin/login');
    csrf = (loginPage.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
    if (!csrf) {
      console.log('GAGAL: token CSRF tidak ditemukan');
      process.exit(1);
    }
    const preCookie = (loginPage.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const payload = `username=admin&password=admin123&_csrf=${encodeURIComponent(csrf)}`;
    const login = await request('/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        Cookie: preCookie
      },
      body: payload
    });
    cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    check('login admin', Boolean(cookie), 'status ' + login.status);

    // Nilai asli tautan profil diambil dari HALAMAN ADMIN (server adalah
    // sumber kebenaran). db.json bisa berbeda karena cache in-process server.
    const beforePage = await request('/admin/pengaturan', { headers: { Cookie: cookie } });
    social.PROFILE_PLATFORMS.forEach((p) => {
      const m = beforePage.body.match(new RegExp('name="' + p.slug + '"\\s+value="([^"]*)"'));
      originalLinks[p.slug] = m ? m[1] : '';
    });

    // 2. Simpan tautan profil (hanya 3 field; sisanya harus tetap utuh).
    const body = [
      '_csrf=' + encodeURIComponent(csrf),
      'instagram=https://instagram.com/jalanjalanenak',
      'facebook=https://facebook.com/jalanjalanenak',
      'threads=https://threads.net/@jalanjalanenak'
    ].join('&');
    const saved = await request('/admin/social/profil', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Cookie: cookie
      },
      body
    });
    check('simpan tautan profil (redirect 302)', saved.status === 302, 'status ' + saved.status);

    // 3. Tautan muncul di footer situs publik.
    const home = await request('/');
    check('tautan Instagram di footer publik', home.body.includes('https://instagram.com/jalanjalanenak'));
    check('tautan Threads di footer publik', home.body.includes('https://threads.net/@jalanjalanenak'));
    check('label "Ikuti Kami" di footer', home.body.includes('Ikuti Kami'));

    // 4. Tautan masuk ke structured data sameAs.
    check('sameAs SEO memuat tautan sosial',
      home.body.includes('"sameAs"') && home.body.includes('https://facebook.com/jalanjalanenak'));

    // 5. Halaman admin Connect Social Media menampilkan tautan tersimpan.
    const hub = await request('/admin/social', { headers: { Cookie: cookie } });
    check('halaman Connect Social Media menampilkan tautan',
      hub.body.includes('https://instagram.com/jalanjalanenak'));

    // 6. Platform yang tidak dikirim harus mempertahankan nilai lamanya.
    const afterPage = await request('/admin/pengaturan', { headers: { Cookie: cookie } });
    const untouched = social.PROFILE_PLATFORMS
      .filter((p) => p.slug !== 'instagram' && p.slug !== 'facebook' && p.slug !== 'threads')
      .filter((p) => {
        if (!originalLinks[p.slug]) return false;
        const m = afterPage.body.match(new RegExp('name="' + p.slug + '"\\s+value="([^"]*)"'));
        return (m ? m[1] : '') !== originalLinks[p.slug];
      });
    check('tautan platform lain tetap utuh', untouched.length === 0,
      untouched.map((p) => p.slug).join(', '));
  } finally {
    // 7. Pulihkan tautan profil lewat HTTP (bukan tulis db.json langsung).
    // Tulis langsung ke disk akan ditimpa balik oleh cache in-process server
    // yang sedang berjalan — settings jadi tidak sinkron.
    if (csrf && cookie) {
      const restoreForm = ['_csrf=' + encodeURIComponent(csrf)]
        .concat(Object.keys(originalLinks).map((k) => k + '=' + encodeURIComponent(originalLinks[k])))
        .join('&');
      await request('/admin/social/profil', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(restoreForm),
          Cookie: cookie
        },
        body: restoreForm
      });
      console.log('\nTautan profil dikembalikan ke kondisi semula (lewat HTTP).');
    }
  }

  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail === 0 ? 0 : 1);
})();
