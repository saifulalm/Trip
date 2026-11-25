'use strict';
/**
 * Skrip audit admin: login, lalu cek halaman-halaman admin
 * merespons 200 dan memuat sidebar. Dipakai sebagai regression check
 * setelah perubahan pada layout/CSS.
 */
const http = require('http');

const BASE = { host: 'localhost', port: Number(process.env.PORT) || 4100 };

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

const PAGES = [
  '/admin',
  '/admin/destinasi',
  '/admin/paket',
  '/admin/artikel',
  '/admin/pengaturan',
  '/admin/marketing/kontak',
  '/admin/marketing/blast',
  '/admin/marketing/whatsapp',
  '/admin/marketing/pengingat',
  '/admin/social',
  '/admin/social/tulis',
  '/admin/social/riwayat',
  '/admin/booking',
  '/admin/pelanggan',
];

(async () => {
  // 1. Ambil halaman login untuk memperoleh token CSRF.
  const loginPage = await request('/admin/login');
  const csrfMatch = loginPage.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    console.log('GAGAL: token CSRF tidak ditemukan di /admin/login');
    process.exit(1);
  }
  const csrf = csrfMatch[1];

  // Token CSRF terikat pada session, jadi cookie session dari GET
  // /admin/login harus ikut dikirim saat POST.
  const preCookie = (loginPage.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

  // 2. Login sebagai admin.
  const payload = `username=admin&password=admin123&_csrf=${encodeURIComponent(csrf)}`;
  const login = await request('/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      Cookie: preCookie,
    },
    body: payload,
  });
  const setCookie = login.headers['set-cookie'] || [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) {
    console.log('GAGAL: login tidak menghasilkan cookie (status ' + login.status + ')');
    process.exit(1);
  }
  console.log('Login admin: OK (status ' + login.status + ')');

  // 3. Cek setiap halaman admin.
  let failed = 0;
  for (const p of PAGES) {
    const r = await request(p, { headers: { Cookie: cookie } });
    const hasSidebar = r.body.includes('admin-sidebar');
    const ok = r.status === 200 && hasSidebar;
    if (!ok) failed += 1;
    console.log(
      (ok ? '  OK  ' : ' FAIL ') + r.status + '  ' + p + (hasSidebar ? '  [sidebar ok]' : '  [sidebar hilang]')
    );
  }
  console.log(failed === 0
    ? `\nOK — ${PAGES.length} halaman admin sehat`
    : `\n${failed} halaman admin bermasalah`);
  process.exit(failed === 0 ? 0 : 1);
})();
