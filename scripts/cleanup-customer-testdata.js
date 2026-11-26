'use strict';

/**
 * Pembersihan sisa data uji portal pelanggan.
 *
 * Data uji dibuat oleh verify-customer-portal.js memakai email berawalan
 * "verify.portal." — skrip ini menghapus seluruh sisa tersebut.
 *
 * PENTING: penghapusan dilakukan lewat route ADMIN (bukan menulis
 * data/db.json langsung) karena server menyimpan cache modul db.js;
 * penulisan langsung dari proses terpisah akan tertimpa server.
 *
 * Jalankan: CLEANUP_PORT=4301 node scripts/cleanup-customer-testdata.js
 */

const http = require('http');

const PORT = Number(process.env.CLEANUP_PORT) || 4301;
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

const state = { cookie: '' };
async function get(path) {
  const res = await request(path, { headers: state.cookie ? { Cookie: state.cookie } : {} });
  state.cookie = merge(state.cookie, cookieOf(res));
  return res;
}
async function post(path, fields, csrfPath) {
  const page = await get(csrfPath || path);
  const csrf = (page.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  const payload = new URLSearchParams(Object.assign({ _csrf: csrf || '' }, fields)).toString();
  const res = await request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      Cookie: state.cookie
    },
    body: payload
  });
  state.cookie = merge(state.cookie, cookieOf(res));
  return res;
}

// Pola email data uji: verify.portal.* (dari skrip verifikasi) dan
// dbg* (dari skrip debug manual).
const PATTERNS = [/^verify\.portal\./, /^verify\.portal@/, /^dbg\d*\./, /^dbg\d*@/];

(async () => {
  const db = require('../src/db');
  const data = db.reload();
  const isJunk = (email) => {
    const e = String(email || '').toLowerCase();
    return PATTERNS.some((re) => re.test(e));
  };
  const junkBookings = (data.bookings || []).filter((b) => isJunk(b.email));
  const junkCustomers = (data.customers || []).filter((c) => isJunk(c.email));

  console.log('Sisa data uji: ' + junkBookings.length + ' booking, ' + junkCustomers.length + ' pelanggan');
  if (!junkBookings.length && !junkCustomers.length) {
    console.log('Tidak ada yang perlu dibersihkan.');
    process.exit(0);
  }

  await get('/admin/login');
  const login = await post('/admin/login', {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'admin123'
  }, '/admin/login');

  if (login.status !== 302) {
    console.log('GAGAL: login admin tidak berhasil (status ' + login.status + ').');
    process.exit(1);
  }
  console.log('Login admin: OK');

  for (const b of junkBookings) {
    await post('/admin/booking/' + b.id + '/hapus', {}, '/admin/booking');
  }
  for (const c of junkCustomers) {
    await post('/admin/pelanggan/' + c.id + '/hapus', {}, '/admin/pelanggan');
  }

  const after = db.reload();
  const leftB = (after.bookings || []).filter((b) => isJunk(b.email)).length;
  const leftC = (after.customers || []).filter((c) => isJunk(c.email)).length;
  console.log('Sisa setelah pembersihan: ' + leftB + ' booking, ' + leftC + ' pelanggan');
  process.exit(leftB === 0 && leftC === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
