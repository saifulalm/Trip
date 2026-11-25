'use strict';

/**
 * Audit halaman detail booking ADMIN: pastikan peta memuat titik
 * destinasi (regresi bug "peta kosong") dan info jarak tampil.
 *
 * Jalankan: ADMINDETAIL_PORT=4301 node scripts/audit-admin-booking-detail.js
 */

const http = require('http');

const PORT = Number(process.env.ADMINDETAIL_PORT) || 4301;
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
  let cookie = '';
  const get = async (p) => {
    const r = await request(p, { headers: cookie ? { Cookie: cookie } : {} });
    cookie = merge(cookie, cookieOf(r));
    return r;
  };
  const post = async (p, f) => {
    const page = await get(p);
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

  await get('/admin/login');
  const login = await post('/admin/login', { username: 'admin', password: 'admin123' });
  check('Login admin', login.status === 302, 'status ' + login.status);

  const db = require('../src/db');
  const data = db.reload();
  const bookings = data.bookings || [];
  check('Ada booking untuk diuji', bookings.length > 0, String(bookings.length));

  let withDest = 0;
  for (const b of bookings) {
    const res = await get('/admin/booking/' + b.id);
    if (res.status !== 200) {
      check('Booking ' + b.code + ' merespons 200', false, 'status ' + res.status);
      continue;
    }
    const mapM = res.body.match(/<script id="map-data" type="application\/json">([\s\S]*?)<\/script>/);
    let md = null;
    try { md = JSON.parse(mapM ? mapM[1] : 'null'); } catch (e) { md = null; }
    if (md && md.dest && typeof md.dest.lat === 'number') withDest += 1;
  }

  check('Semua halaman detail booking punya titik destinasi di peta',
    withDest === bookings.length, withDest + ' dari ' + bookings.length);

  // Cek salah satu yang punya check-in: label jarak harus tampil.
  const withCheckIn = bookings.find((b) => b.checkIn);
  if (withCheckIn) {
    const res = await get('/admin/booking/' + withCheckIn.id);
    check('Halaman admin menampilkan "Jarak ke Titik Kumpul"',
      res.body.includes('Jarak ke Titik Kumpul'), '');
    check('Halaman admin menampilkan info Destinasi',
      res.body.includes('<dt>Destinasi</dt>'), '');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? `OK — ${results.length} pemeriksaan lulus`
    : `${failed.length} dari ${results.length} pemeriksaan GAGAL`));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
