'use strict';
/**
 * Skrip audit halaman integrasi media sosial.
 *
 * Login admin lalu cek halaman Connect Social Media, Tulis & Publikasikan,
 * dan Riwayat Publikasi merespons 200 serta memuat elemen yang diharapkan.
 * Dipakai sebagai regression check setelah perubahan view/route media sosial.
 */
const http = require('http');

const BASE = { host: 'localhost', port: Number(process.env.VERIFY_PORT) || Number(process.env.PORT) || 4100 };

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

/**
 * Daftar halaman + penanda yang wajib ada di respons.
 *
 * Setiap entri `expect` boleh berisi DAFTAR penanda alternatif: cukup satu
 * yang muncul. Ini penting karena halaman composer & riwayat merender
 * empty-state (a-so-empty) bila belum ada kanal terhubung, dan merender
 * layout penuh (a-so-composer / a-so-history) bila kanal tersedia.
 * Tanpa alternatif, audit gagal hanya karena konfigurasi Postiz belum diisi
 * — bukan karena ada bug.
 */
const PAGES = [
  // Penanda mengikuti view baru (redesign 2026-11): hero status + panel setup.
  { path: '/admin/social', expect: ['Connect Social Media', 'a-so-hero', 'postizBaseUrl'] },
  { path: '/admin/social/tulis', expect: ['Tulis', ['a-so-composer', 'a-so-empty']] },
  { path: '/admin/social/riwayat', expect: ['Riwayat Publikasi', ['a-so-history', 'a-so-empty']] },
  { path: '/admin/social/status', expect: ['configured'] },
  { path: '/admin/social/diagnostik', expect: ['step'] }
];

(async () => {
  // 1. Halaman login untuk memperoleh token CSRF + cookie session.
  const loginPage = await request('/admin/login');
  const csrfMatch = loginPage.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    console.log('GAGAL: token CSRF tidak ditemukan di /admin/login');
    process.exit(1);
  }
  const csrf = csrfMatch[1];
  const preCookie = (loginPage.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

  // 2. Login sebagai admin (cookie session wajib ikut).
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
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) {
    console.log('GAGAL: login tidak menghasilkan cookie (status ' + login.status + ')');
    process.exit(1);
  }
  console.log('Login admin: OK (status ' + login.status + ')');

  // 3. Cek tiap halaman integrasi media sosial.
  let failed = 0;
  for (const p of PAGES) {
    const r = await request(p.path, { headers: { Cookie: cookie } });
    // Penanda boleh berupa array alternatif — cukup satu yang muncul.
    const missing = p.expect.filter((marker) => {
      const list = Array.isArray(marker) ? marker : [marker];
      return !list.some((m) => r.body.includes(m));
    });
    const ok = r.status === 200 && missing.length === 0;
    if (!ok) failed += 1;
    console.log(
      (ok ? '  OK  ' : ' FAIL ') + r.status + '  ' + p.path +
      (missing.length ? '  [hilang: ' + missing.join(', ') + ']' : '')
    );
  }

  console.log(failed === 0
    ? `\nOK — ${PAGES.length} halaman media sosial sehat`
    : `\n${failed} halaman media sosial bermasalah`);
  process.exit(failed === 0 ? 0 : 1);
})();
