'use strict';

/**
 * Uji integrasi HTTP presence: alur admin ↔ pelanggan.
 *
 * Menguji:
 *  - GET /api/presence/state menolak tanpa login (401).
 *  - Pelanggan login → ping → state berisi posisinya.
 *  - Admin login → state melihat pelanggan yang ping.
 *  - Pelanggan TIDAK melihat pelanggan lain tanpa booking bersama.
 *  - POST /ping tanpa token CSRF ditolak (403).
 *  - Koordinat invalid ditolak (400).
 *  - POST /stop menghapus entri.
 *
 * Jalankan: PRESENCE_PORT=4302 node scripts/presence-http.test.js
 * Server uji harus hidup di port yang sama.
 */

const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));
const bcrypt = require(path.join(root, 'node_modules', 'bcryptjs'));

const PORT = Number(process.env.PRESENCE_PORT) || 4302;
const BASE = { host: 'localhost', port: PORT };

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log('  PASS  ' + name + (detail ? '  →  ' + detail : ''));
  } else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : ''));
  }
}

function request(p, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...BASE, path: p, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout ' + p)); });
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

function makeClient() {
  const state = { cookie: '' };
  async function get(p) {
    const res = await request(p, { headers: state.cookie ? { Cookie: state.cookie } : {} });
    state.cookie = merge(state.cookie, cookieOf(res));
    return res;
  }
  async function post(p, fields, csrfPath, isJson) {
    const page = await get(csrfPath || p);
    const csrf = (page.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
    let body;
    const headers = { Cookie: state.cookie };
    if (isJson) {
      body = JSON.stringify(Object.assign({ _csrf: csrf }, fields));
      headers['Content-Type'] = 'application/json';
    } else {
      body = new URLSearchParams(Object.assign({ _csrf: csrf || '' }, fields)).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    headers['Content-Length'] = Buffer.byteLength(body);
    const res = await request(p, { method: 'POST', headers, body });
    state.cookie = merge(state.cookie, cookieOf(res));
    return res;
  }
  return { get, post, state };
}

(async () => {
  console.log('\n=== presence HTTP ===');

  // --- 1. Tanpa login ditolak -----------------------------------------
  const anon = await request('/api/presence/state');
  check('GET /state tanpa login ditolak (401)', anon.status === 401, 'status ' + anon.status);

  // --- 2. Login admin ---------------------------------------------------
  const admin = makeClient();
  const loginPage = await admin.get('/admin/login');
  const adminCsrf = (loginPage.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  const adminLogin = await request('/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(
        `username=admin&password=admin123&_csrf=${encodeURIComponent(adminCsrf || '')}`
      ),
      Cookie: admin.state.cookie
    },
    body: `username=admin&password=admin123&_csrf=${encodeURIComponent(adminCsrf || '')}`
  });
  check('Login admin berhasil', adminLogin.status === 302, 'status ' + adminLogin.status);
  admin.state.cookie = merge(admin.state.cookie, cookieOf(adminLogin));

  // --- 3. Admin ping posisi --------------------------------------------
  const adminPing = await admin.post(
    '/api/presence/ping',
    { lat: -0.4719, lng: 130.7515, accuracy: 10 },
    '/admin/lokasi',
    true
  );
  check('Admin ping posisi diterima', adminPing.status === 200, 'status ' + adminPing.status + ' ' + adminPing.body.slice(0, 120));

  // --- 4. Admin state melihat dirinya sendiri ---------------------------
  const adminState = await admin.get('/api/presence/state');
  let adminStateJson = null;
  try { adminStateJson = JSON.parse(adminState.body); } catch (e) { /* abaikan */ }
  check('Admin state mengembalikan JSON', !!adminStateJson, 'status ' + adminState.status);
  check('Admin state berisi posisi sendiri',
    !!(adminStateJson && adminStateJson.me && adminStateJson.me.lat === -0.4719),
    adminStateJson && adminStateJson.me ? JSON.stringify(adminStateJson.me) : '-');

  // --- 5. Halaman admin /admin/lokasi merespons 200 ---------------------
  const lokasiPage = await admin.get('/admin/lokasi');
  check('Halaman /admin/lokasi merespons 200', lokasiPage.status === 200, 'status ' + lokasiPage.status);
  check('Halaman lokasi memuat peta', lokasiPage.body.includes('syl-map'), '');
  check('Halaman lokasi memuat modul presence', lokasiPage.body.includes('/js/presence.js'), '');

  // --- 6. Pelanggan login & ping ---------------------------------------
  const data = db.reload();
  const cust = data.customers && data.customers[0];
  check('Ada pelanggan demo untuk diuji', !!cust, cust ? cust.email : 'tidak ada');

  const cli = makeClient();
  await cli.get('/masuk');
  const login = await cli.post('/masuk', { email: cust.email, password: 'customer123' }, '/masuk');
  check('Login pelanggan berhasil', login.status === 302, 'status ' + login.status);

  const custPing = await cli.post(
    '/api/presence/ping',
    { lat: -0.4718, lng: 130.7516, accuracy: 8 },
    '/akun/lokasi',
    true
  );
  check('Pelanggan ping posisi diterima', custPing.status === 200, 'status ' + custPing.status + ' ' + custPing.body.slice(0, 120));

  const custState = await cli.get('/api/presence/state');
  let custStateJson = null;
  try { custStateJson = JSON.parse(custState.body); } catch (e) { /* abaikan */ }
  check('Pelanggan state berisi posisinya sendiri',
    !!(custStateJson && custStateJson.me && Math.abs(custStateJson.me.lat - -0.4718) < 1e-6),
    custStateJson && custStateJson.me ? JSON.stringify(custStateJson.me) : '-');
  check('Pelanggan melihat admin sebagai peer',
    !!(custStateJson && custStateJson.peers && custStateJson.peers.some((p) => p.role === 'admin')),
    custStateJson && custStateJson.peers ? JSON.stringify(custStateJson.peers.map((p) => p.role)) : '-');

  // --- 7. Admin melihat pelanggan ---------------------------------------
  const adminState2 = await admin.get('/api/presence/state');
  let a2 = null;
  try { a2 = JSON.parse(adminState2.body); } catch (e) { /* abaikan */ }
  check('Admin melihat pelanggan sebagai peer',
    !!(a2 && a2.peers && a2.peers.some((p) => p.role === 'customer')),
    a2 && a2.peers ? JSON.stringify(a2.peers.map((p) => p.role)) : '-');

  // --- 8. Pelanggan tidak melihat pelanggan lain tanpa booking bersama --
  const other = (data.customers || []).find((c) => c.id !== cust.id);
  if (other) {
    const cli2 = makeClient();
    await cli2.get('/masuk');
    const l2 = await cli2.post('/masuk', { email: other.email, password: 'customer123' }, '/masuk');
    if (l2.status === 302) {
      await cli2.post('/api/presence/ping', { lat: -1.2, lng: 130.1, accuracy: 9 }, '/akun/lokasi', true);
      const s2 = await cli2.get('/api/presence/state');
      let j2 = null;
      try { j2 = JSON.parse(s2.body); } catch (e) { /* abaikan */ }
      const seesOther = !!(j2 && j2.peers && j2.peers.some((p) => p.role === 'customer'));
      check('Pelanggan tidak melihat pelanggan lain tanpa booking bersama', !seesOther,
        j2 && j2.peers ? JSON.stringify(j2.peers.map((p) => p.role)) : '-');
    } else {
      check('Login pelanggan kedua (opsional) dilewati', true, 'status ' + l2.status);
    }
  }

  // --- 9. Ping tanpa CSRF ditolak --------------------------------------
  const noCsrf = await request('/api/presence/ping', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify({ lat: 1, lng: 2 })),
      Cookie: cli.state.cookie
    },
    body: JSON.stringify({ lat: 1, lng: 2 })
  });
  check('Ping tanpa token CSRF ditolak (403)', noCsrf.status === 403, 'status ' + noCsrf.status);

  // --- 10. Koordinat invalid ditolak -----------------------------------
  const badCoord = await cli.post('/api/presence/ping', { lat: 0, lng: 0 }, '/akun/lokasi', true);
  check('Koordinat invalid ditolak (400)', badCoord.status === 400, 'status ' + badCoord.status);

  // --- 11. Stop menghapus entri -----------------------------------------
  const stop = await cli.post('/api/presence/stop', {}, '/akun/lokasi', true);
  check('Stop diterima', stop.status === 200, 'status ' + stop.status);
  const afterStop = await cli.get('/api/presence/state');
  let aj = null;
  try { aj = JSON.parse(afterStop.body); } catch (e) { /* abaikan */ }
  check('Setelah stop posisi pelanggan hilang',
    !!(aj && aj.me && aj.me.lat === null),
    aj && aj.me ? JSON.stringify(aj.me) : '-');

  console.log('\n' + (failed === 0
    ? `OK — ${passed} pemeriksaan lulus`
    : `${failed} dari ${passed + failed} pemeriksaan GAGAL`));
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
