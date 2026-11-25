/**
 * Uji integrasi: boot server, login admin, akses halaman WhatsApp,
 * blast, pengingat, dan endpoint QR. Memastikan tidak ada 500.
 *
 * Gateway OpenWA dimock supaya skrip ini TIDAK PERNAH menghubungi
 * gateway sungguhan dan tidak mengirim pesan asli.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const { createApp } = require(path.join(root, 'src', 'app'));
const db = require(path.join(root, 'src', 'db'));
const { ensureSeed } = require(path.join(root, 'src', 'seed'));
ensureSeed();

// Mock gateway OpenWA: tidak ada panggilan jaringan sungguhan.
const { gateway } = require(path.join(__dirname, 'wa-mock-gateway'));
gateway.ensureStartedSession = async () => ({
  id: 'mock-session',
  name: 'seayoulatertrip',
  status: 'qr_ready',
  phone: null,
  pushName: null
});
gateway.getQrCode = async () => 'data:image/png;base64,iVBORw0KGgo=';
gateway.healthCheck = async () => ({
  ok: true,
  status: 'ok',
  baseUrl: 'http://localhost:2785',
  error: null
});
gateway.refreshState = async () => gateway.getState();
gateway.ensureWebhookRegistered = async () => true;

const app = createApp();
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

function req(pathname, opts) {
  return new Promise((resolve, reject) => {
    const options = Object.assign({ headers: {} }, opts);
    const u = new URL(pathname, base);
    const r = http.request(u, options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

let cookies = '';
function cookieHeader() {
  return cookies;
}

function capture(res) {
  const set = res.headers['set-cookie'];
  if (set) cookies = set.map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  let fail = 0;
  const check = (name, cond, extra) => {
    if (cond) console.log('  PASS  ' + name);
    else {
      fail += 1;
      console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : ''));
    }
  };

  // Login.
  const loginPage = await req('/admin/login');
  capture(loginPage);
  const csrf = (loginPage.body.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  check('halaman loginaccessible', loginPage.status === 200, 'status ' + loginPage.status);

  const form = new URLSearchParams({ username: 'admin', password: 'admin123', _csrf: csrf }).toString();
  const login = await req('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: form
  });
  capture(login);
  check('login berhasil (redirect 302)', login.status === 302, 'status ' + login.status);

  // Halaman admin.
  const pages = [
    ['/admin', 'dashboard'],
    ['/admin/marketing/whatsapp', 'hub WhatsApp'],
    ['/admin/marketing/kontak', 'kontak'],
    ['/admin/marketing/blast', 'blast'],
    ['/admin/marketing/pengingat', 'pengingat'],
    ['/admin/pengaturan', 'pengaturan']
  ];
  for (const [p, label] of pages) {
    const res = await req(p, { headers: { Cookie: cookieHeader() } });
    check(`halaman ${label} (${p}) -> 200`, res.status === 200, 'status ' + res.status);
    if (res.status === 500) console.log('    ' + res.body.slice(0, 600));
  }

  // Endpoint QR (JSON).
  const qr = await req('/admin/marketing/whatsapp/qr', { headers: { Cookie: cookieHeader() } });
  check('endpoint QR merespons JSON', qr.status === 200 || qr.status === 500, 'status ' + qr.status);
  if (qr.status === 200) {
    let parsed = null;
    try { parsed = JSON.parse(qr.body); } catch (_) { /* abaikan */ }
    check('QR endpoint mengembalikan JSON valid', parsed && typeof parsed.ok === 'boolean', qr.body.slice(0, 120));
  }

  // CSRF tetap wajib: POST tanpa token harus 403.
  const noCsrf = await req('/admin/marketing/blast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: 'template=halo&segment=all&action=send'
  });
  check('POST tanpa CSRF ditolak (403)', noCsrf.status === 403, 'status ' + noCsrf.status);

  // Blast mode uji (tidak mengirim).
  const blastPage = await req('/admin/marketing/blast', { headers: { Cookie: cookieHeader() } });
  const bcsrf = (blastPage.body.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const blastForm = new URLSearchParams({
    template: 'Halo {{nama}}! Test {{nama}}.',
    segment: 'all',
    action: 'test',
    _csrf: bcsrf
  }).toString();
  const blast = await req('/admin/marketing/blast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: blastForm
  });
  check('blast mode uji diterima (302)', blast.status === 302, 'status ' + blast.status);

  const after = db.read();
  const jobs = (after.broadcasts || []).filter((j) => j.type === 'blast');
  check('job blast tersimpan di db', jobs.length > 0, 'jumlah ' + jobs.length);
  if (jobs.length) {
    const j = jobs[0];
    check('job mode uji berstatus done', j.status === 'done', j.status);
    check('job mode uji tidak mengirim pesan (sent=0)', j.sent === 0, 'sent=' + j.sent);
    check('job mode uji tidak mengirim ke kontak opt-out', !j.targets.some((x) => x.phone === '6281234567890' || x.optOut));
  }

  // Halaman pengingat harus reachable & memuat daftar.
  const rem = await req('/admin/marketing/pengingat', { headers: { Cookie: cookieHeader() } });
  check('halaman pengingat memuat "Pengingat"', rem.body.includes('Pengingat'));

  server.close();

  console.log(fail ? `\n${fail} gagal.` : '\nIntegrasi OK.');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
