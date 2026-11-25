'use strict';

/**
 * Audit numerik halaman portal pelanggan (tanpa browser).
 *
 * Mengambil HTML halaman yang sudah login, lalu memeriksa struktur DOM
 * memakai parser ringan berbasis regex untuk memastikan:
 *   - jumlah & urutan elemen kunci
 *   - tidak ada tag yang tidak tertutup / duplikat
 *   - tidak ada string EJS yang bocor ke output (mis. "<%")
 *   - setiap <form> punya token CSRF
 *
 * Jalankan: AUDIT_PORT=4301 node scripts/audit-portal-markup.js
 */

const http = require('http');

const PORT = Number(process.env.AUDIT_PORT) || 4301;
const BASE = { host: 'localhost', port: PORT };

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
    req.setTimeout(15000, () => { req.destroy(new Error('timeout ' + path)); });
    if (options.body) req.write(options.body);
    req.end();
  });
}
function cookieOf(res) {
  return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}
function merge(a, b) {
  const map = new Map();
  (a ? a.split('; ') : []).concat(b ? b.split('; ') : []).forEach((c) => {
    if (c) map.set(c.split('=')[0], c);
  });
  return Array.from(map.values()).join('; ');
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '  OK  ' : ' FAIL ') + name + (detail ? '  →  ' + detail : ''));
}

(async () => {
  // Login pelanggan demo.
  let cookie = '';
  const get = async (p) => {
    const r = await request(p, { headers: cookie ? { Cookie: cookie } : {} });
    cookie = merge(cookie, cookieOf(r));
    return r;
  };
  const post = async (p, f, csrfPath) => {
    const page = await get(csrfPath || p);
    const csrf = (page.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
    const payload = new URLSearchParams(Object.assign({ _csrf: csrf || '' }, f)).toString();
    const r = await request(p, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        Cookie: cookie
      },
      body: payload
    });
    cookie = merge(cookie, cookieOf(r));
    return r;
  };

  await get('/masuk');
  const login = await post('/masuk', {
    email: 'ayu.lestari@example.com',
    password: 'customer123'
  });
  check('Login pelanggan demo', login.status === 302, 'status ' + login.status);

  const pages = [
    { path: '/akun', name: 'Dashboard' },
    { path: '/akun/lokasi', name: 'Halaman Lokasi' },
    { path: '/akun/profil', name: 'Profil' }
  ];

  // Ambil ID booking pertama milik pelanggan demo untuk halaman detail.
  const db = require('../src/db');
  const data = db.reload();
  const cust = data.customers[0];
  const bkg = (data.bookings || []).find((b) => b.customerId === cust.id);
  if (bkg) pages.push({ path: '/akun/booking/' + bkg.id, name: 'Detail Booking' });

  for (const p of pages) {
    const res = await get(p.path);
    const body = res.body;
    console.log('\n--- ' + p.name + ' (' + p.path + ') status ' + res.status + ' ---');

    check(p.name + ' status 200', res.status === 200, 'status ' + res.status);

    // 1. Tidak ada EJS yang bocor.
    check(p.name + ' tidak ada markup EJS bocor', !body.includes('<%'), '');

    // 2. Tag <form> balanced.
    const openForms = (body.match(/<form\b/g) || []).length;
    const closeForms = (body.match(/<\/form>/g) || []).length;
    check(p.name + ' jumlah <form> seimbang', openForms === closeForms, openForms + ' vs ' + closeForms);

    // 3. Setiap form punya _csrf.
    const formBlocks = body.match(/<form[\s\S]*?<\/form>/g) || [];
    const formsWithoutCsrf = formBlocks.filter((f) => !f.includes('name="_csrf"')).length;
    check(p.name + ' setiap form punya token CSRF',
      formsWithoutCsrf === 0, formsWithoutCsrf + ' form tanpa CSRF');

    // 4. Tag <section> balanced.
    const openSec = (body.match(/<section\b/g) || []).length;
    const closeSec = (body.match(/<\/section>/g) || []).length;
    check(p.name + ' jumlah <section> seimbang', openSec === closeSec, openSec + ' vs ' + closeSec);

    // 5. Tag <div> balanced.
    const openDiv = (body.match(/<div\b/g) || []).length;
    const closeDiv = (body.match(/<\/div>/g) || []).length;
    check(p.name + ' jumlah <div> seimbang', openDiv === closeDiv, openDiv + ' vs ' + closeDiv);

    // 6. Hanya satu <h1>.
    const h1 = (body.match(/<h1\b/g) || []).length;
    check(p.name + ' tepat satu <h1>', h1 === 1, String(h1));

    // 7. Gambar punya alt.
    const imgs = body.match(/<img\b[^>]*>/g) || [];
    const imgsNoAlt = imgs.filter((i) => !/\balt=/.test(i)).length;
    check(p.name + ' semua <img> punya alt', imgsNoAlt === 0, imgsNoAlt + ' tanpa alt');

    // 8. Tidak ada href="#" kosong mencurigakan.
    const emptyHref = (body.match(/href="(#|javascript:)"/g) || []).length;
    check(p.name + ' tidak ada tautan placeholder', emptyHref === 0, String(emptyHref));

    // 9. Struktur khusus per halaman.
    if (p.path === '/akun') {
      check('Dashboard punya 4 kartu KPI',
        (body.match(/class="kpi[ "]/g) || []).length >= 4,
        String((body.match(/class="kpi[ "]/g) || []).length));
      check('Dashboard punya stepper progres', body.includes('trip-steps'), '');
      check('Dashboard punya panel Lokasi', body.includes('Perjalanan Berikutnya'), '');
    }
    if (p.path === '/akun/lokasi') {
      check('Halaman Lokasi punya panel izin', body.includes('loc-bar'), '');
      check('Halaman Lokasi punya tombol izin lokasi', body.includes('locRequestBtn'), '');
      check('Halaman Lokasi punya form simpan posisi', body.includes('locSaveForm'), '');
      check('Halaman Lokasi punya peta atau empty-state',
        body.includes('syl-map') || body.includes('portal-map__empty'), '');
    }
    if (p.path.startsWith('/akun/booking/')) {
      check('Detail booking punya stepper progres', body.includes('trip-steps'), '');
      check('Detail booking punya modul izin lokasi',
        body.includes('location-permission.js'), '');
      const mapM = body.match(/<script id="map-data" type="application\/json">([\s\S]*?)<\/script>/);
      let md = null;
      try { md = JSON.parse(mapM ? mapM[1] : 'null'); } catch (e) { md = null; }
      check('map-data valid JSON dengan titik destinasi',
        !!(md && md.dest && typeof md.dest.lat === 'number'),
        md && md.dest ? md.dest.name : 'dest null');
    }
  }

  // 10. Halaman publik tidak rusak oleh portal.css (cek .badge ada).
  const home = await request('/');
  check('Beranda publik tetap 200', home.status === 200, 'status ' + home.status);
  check('Beranda memuat portal.css', home.body.includes('/css/portal.css'), '');

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? `OK — ${results.length} pemeriksaan lulus`
    : `${failed.length} dari ${results.length} pemeriksaan GAGAL`));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
