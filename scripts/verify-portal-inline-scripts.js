'use strict';

/**
 * Validasi sintaks JavaScript inline pada halaman portal pelanggan.
 *
 * Halaman portal butuh sesi login, jadi skrip verify-inline-scripts.js
 * (yang memakai GET anonim) tidak bisa menjangkau /akun. Skrip ini
 * mengambil HTML lewat sesi login, mengekstrak setiap <script> inline
 * (tanpa src), lalu mem-parse-nya dengan vm.Script.
 *
 * Jalankan: INLINE_PORT=4301 node scripts/verify-portal-inline-scripts.js
 */

const http = require('http');
const vm = require('vm');

const PORT = Number(process.env.INLINE_PORT) || 4301;
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
async function post(path, fields) {
  const page = await get(path);
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

/** Ekstrak script inline dari HTML (abaikan yang punya src dan JSON-LD). */
function extractInlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["']application\/ld\+json["']/.test(attrs)) continue;
    // Blok data JSON (map-data) bukan JavaScript — jangan diparse.
    if (/type\s*=\s*["']application\/json["']/.test(attrs)) continue;
    if (!body.trim()) continue;
    out.push(body);
  }
  return out;
}

(async () => {
  await get('/masuk');
  const login = await post('/masuk', {
    email: 'ayu.lestari@example.com',
    password: 'customer123'
  });
  if (login.status !== 302) {
    console.log('GAGAL: login pelanggan demo gagal (status ' + login.status + ')');
    process.exit(1);
  }

  const db = require('../src/db');
  const data = db.reload();
  const cust = data.customers[0];
  const bkg = (data.bookings || []).find((b) => b.customerId === cust.id);

  const pages = ['/akun', '/akun/lokasi', '/akun/profil'];
  if (bkg) pages.push('/akun/booking/' + bkg.id);

  let total = 0;
  let failed = 0;

  for (const p of pages) {
    const res = await get(p);
    const scripts = extractInlineScripts(res.body);
    console.log('\n' + p + ' (status ' + res.status + ', ' + scripts.length + ' inline script)');
    scripts.forEach((code, i) => {
      total += 1;
      try {
        new vm.Script(code, { filename: p + '#' + (i + 1) });
        console.log('  OK   script #' + (i + 1) + ' (' + code.length + ' chars)');
      } catch (err) {
        failed += 1;
        console.log(' FAIL  script #' + (i + 1) + ' → ' + err.message);
        const snippet = code.split('\n').slice(0, 4).join('\n');
        console.log('       ' + snippet.replace(/\n/g, '\n       '));
      }
    });
  }

  console.log('\n' + (failed === 0
    ? `OK — ${total} inline script valid`
    : `${failed} dari ${total} inline script GAGAL`));
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
