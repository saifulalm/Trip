'use strict';
/**
 * Regression guard:layout admin tidak boleh punya overflow horizontal.
 *
 * Latar belakang:
 * - `.a-table-wrap` dipakai 7 halaman admin tapi pernah TIDAK didefinisikan
 *   di CSS mana pun → `overflow-x: visible` → tabel lebar (mis. teks pesan
 *   inbox berisi data URL base64) melebarkan dokumen sampai ribuan piksel.
 * - `.admin-head` / `.admin-head__actions` juga pernah tanpa definisi → judul
 *   halaman & tombol aksi jadi blok teks tanpa hierarki.
 *
 * Guard ini memanggil API Chrome DevTools Protocol lewat WebSocket untuk
 * benar-benar mengukur `scrollWidth` per halaman. Tanpa browser, overflow
 * horizontal tidak bisa dideteksi dari HTML saja.
 *
 * Jalankan: PORT=4312 node scripts/verify-admin-layout.js
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 4312;
const BASE = `http://localhost:${PORT}`;

const PAGES = [
  '/admin',
  '/admin/destinasi',
  '/admin/paket',
  '/admin/artikel',
  '/admin/booking',
  '/admin/pelanggan',
  '/admin/pesan',
  '/admin/testimoni',
  '/admin/galeri',
  '/admin/lokasi',
  '/admin/marketing/kontak',
  '/admin/marketing/blast',
  '/admin/marketing/whatsapp',
  '/admin/marketing/pengingat',
  '/admin/social',
  '/admin/social/tulis',
  '/admin/social/riwayat',
  '/admin/seo',
  '/admin/pengaturan',
  '/admin/akun'
];

/** Lebar viewport yang diuji (desktop, tablet, ponsel). */
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 900 },
  { name: '768', width: 768, height: 900 },
  { name: '390', width: 390, height: 844 }
];

/** Permintaan HTTP sederhana (login admin + ambil halaman). */
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: PORT, path, method: options.method || 'GET', headers: options.headers || {} },
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

/**
 * Ambil token CSRF dari HTML.
 * @param {string} html HTML halaman
 * @returns {string|null} token
 */
function csrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Ambil daftar class CSS yang TIDAK punya definisi di file CSS mana pun.
 *
 * Ini deteksi dini untuk kelas yang "dipakai tapi tak pernah ada gayanya"
 * — sumber utama bug layout admin di repo ini.
 *
 * @param {string} html HTML halaman
 * @param {Set<string>} definedClasses kumpulan class terdefinisi
 * @returns {string[]} nama class tanpa definisi
 */
function orphanClasses(html, definedClasses) {
  const used = new Set();
  const re = /class="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    m[1].split(/\s+/).forEach((c) => { if (c) used.add(c); });
  }
  return Array.from(used).filter((c) => !definedClasses.has(c) && !c.startsWith('is-') && !c.startsWith('has-'));
}

/**
 * Kumpulkan seluruh class yang terdefinisi di file CSS repo.
 * @param {string} rootDir root project
 * @returns {Set<string>} kumpulan class
 */
function collectDefinedClasses(rootDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(rootDir, 'public', 'css');
  const defined = new Set();
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .forEach((f) => {
      const css = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
      let m;
      while ((m = re.exec(css)) !== null) defined.add(m[1]);
    });
  return defined;
}

/**
 * Ambil JSON dari endpoint CDP.
 * @param {object} ws websocket
 * @param {string} method method CDP
 * @param {object} params parameter
 * @returns {Promise<object>} hasil
 */
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = cdp._id = (cdp._id || 0) + 1;
    const onMessage = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  console.log(`\n=== Audit layout admin (${BASE}) ===\n`);

  // 1. Login admin (cookie session dipakai untuk semua request berikutnya).
  const loginPage = await request('/admin/login');
  const token = csrf(loginPage.body);
  if (!token) {
    console.error('GAGAL: token CSRF tidak ditemukan di /admin/login');
    process.exit(1);
  }
  const loginRes = await request('/admin/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: (loginPage.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')
    },
    body: new URLSearchParams({ username: 'admin', password: 'admin123', _csrf: token }).toString()
  });
  if (loginRes.status !== 302) {
    console.error(`GAGAL: login admin status=${loginRes.status}`);
    process.exit(1);
  }
  const cookie = (loginRes.headers['set-cookie'] || [])
    .map((c) => c.split(';')[0]).join('; ');
  console.log('  OK   Login admin');

  // 2. Kumpulkan HTML tiap halaman + class yatim.
  const rootDir = require('path').join(__dirname, '..');
  const definedClasses = collectDefinedClasses(rootDir);
  const htmlByPage = {};
  const orphans = {};
  for (const p of PAGES) {
    const r = await request(p, { headers: { cookie } });
    if (r.status !== 200) {
      console.log(`  GAGAL ${p} status=${r.status}`);
      continue;
    }
    htmlByPage[p] = r.body;
    const o = orphanClasses(r.body, definedClasses);
    if (o.length) orphans[p] = o;
  }
  console.log(`  OK   ${Object.keys(htmlByPage).length} halaman admin termuat`);

  // 3. Audit overflow horizontal lewat browser sungguhan (Puppeteer).
  //
  // CATATAN: modul `ws` bawaan repo ini bukan klien WebSocket browser.
  // Pakai Puppeteer (sudah jadi dependensi) — ia membawa Chromium sendiri
  // sehingga audit bisa jalan tanpa browser harness Hermes.
  const puppeteer = tryLoadPuppeteer();
  let pass = 0;
  let fail = 0;
  const failures = [];

  if (!puppeteer) {
    console.log('  (lewati) Puppeteer tidak tersedia — audit overflow dilewati');
  } else {
    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();

      // Set cookie sesi admin hasil login HTTP di atas.
      const cookieHeader = (loginRes.headers['set-cookie'] || [])[0];
      if (cookieHeader) {
        const [pair] = cookieHeader.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx);
        const value = pair.slice(idx + 1);
        await page.setCookie({ name, value, domain: 'localhost', path: '/' });
      }

      for (const vp of VIEWPORTS) {
        await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
        for (const p of PAGES) {
          if (!htmlByPage[p]) continue;
          try {
            await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(350);
            const data = await page.evaluate(() => {
              const d = document.documentElement;
              const overflow = d.scrollWidth - d.clientWidth;
              let worst = null;
              document.querySelectorAll('body *').forEach((el) => {
                const b = el.getBoundingClientRect();
                if (b.width > 0 && b.right > d.clientWidth + 2) {
                  if (!worst || b.right > worst.right) {
                    worst = {
                      right: Math.round(b.right),
                      tag: el.tagName,
                      cls: String(el.className || '').slice(0, 45)
                    };
                  }
                }
              });
              const navUnderline = Array.from(document.querySelectorAll('.admin-nav a'))
                .filter((a) => getComputedStyle(a).textDecorationLine !== 'none').length;
              let coordsClip = 0;
              document.querySelectorAll('.transport-coords input').forEach((inp) => {
                const box = inp.closest('.transport-form');
                if (box && inp.getBoundingClientRect().right > box.getBoundingClientRect().right + 1) {
                  coordsClip += 1;
                }
              });
              return { overflow, worst, navUnderline, coordsClip };
            });
            if (data.overflow > 0) {
              fail += 1;
              const detail = data.worst ? ` (${data.worst.tag}.${data.worst.cls})` : '';
              failures.push(`${p} @${vp.name}px → overflow ${data.overflow}px${detail}`);
              console.log(`  GAGAL ${p} @${vp.name}px — overflow ${data.overflow}px${detail}`);
            } else {
              pass += 1;
            }
            // Regresi: menu sidebar tanpa garis bawah, input koordinat di dalam panelnya.
            if (data.navUnderline > 0) {
              fail += 1;
              failures.push(`${p} @${vp.name}px → ${data.navUnderline} menu sidebar bergaris bawah`);
              console.log(`  GAGAL ${p} @${vp.name}px — ${data.navUnderline} menu sidebar bergaris bawah`);
            } else {
              pass += 1;
            }
            if (data.coordsClip > 0) {
              fail += 1;
              failures.push(`${p} @${vp.name}px → ${data.coordsClip} input koordinat keluar dari panel`);
              console.log(`  GAGAL ${p} @${vp.name}px — ${data.coordsClip} input koordinat keluar dari panel`);
            } else {
              pass += 1;
            }
          } catch (err) {
            fail += 1;
            failures.push(`${p} @${vp.name}px → ${err.message}`);
            console.log(`  GAGAL ${p} @${vp.name}px — ${err.message}`);
          }
        }
      }
      console.log(`  OK   Audit overflow: ${pass} pemeriksaan lulus, ${fail} gagal`);
    } finally {
      if (browser) await browser.close();
    }
  }

  // 4. Laporkan class yatim (dipakai di template tapi tanpa definisi CSS).
  const orphanSet = new Set();
  Object.values(orphans).forEach((list) => list.forEach((c) => orphanSet.add(c)));
  if (orphanSet.size) {
    console.log('\n  Perhatian — class dipakai di template tapi tanpa definisi CSS:');
    Array.from(orphanSet).sort().forEach((c) => console.log('    - ' + c));
  }

  console.log('\n--- RINGKASAN ---');
  console.log(`lulus: ${pass}/${pass + fail}`);
  if (fail) {
    console.log('gagal:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error('\nERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});

/** Tidur singkat. */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Ambil JSON lewat HTTP.
 * @param {string} url URL
 * @returns {Promise<object|null>} JSON
 */
function requestJson(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(2500, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Muat Puppeteer bila tersedia.
 * @returns {object|null} modul puppeteer
 */
function tryLoadPuppeteer() {
  try {
    return require('puppeteer');
  } catch (e) {
    return null;
  }
}

/**
 * Muat pustaka WebSocket (bawaan Node >= 22, atau paket `ws`).
 * @returns {Promise<object>} kelas WebSocket
 */
async function loadWebSocket() {
  try {
    return require('ws');
  } catch (e) { /* lanjut ke global */ }
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  throw new Error('Modul WebSocket tidak tersedia (butuh Node >= 22 atau paket "ws")');
}
