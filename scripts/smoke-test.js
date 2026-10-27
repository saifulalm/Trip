'use strict';

/**
 * smoke-test.js — uji render seluruh halaman.
 *
 * check-syntax.js hanya memeriksa sintaks & konsistensi brand; file ini
 * menjalankan aplikasi sungguhan lalu/request SETIAP halaman untuk memastikan
 * tidak ada template yang gagal dirender.
 *
 * Ini menangkap kelas bug seperti:
 *   ReferenceError: currentCustomer is not defined
 * yang muncul hanya saat sebuah view dirender, bukan saat sintaksnya dicek.
 *
 * Tidak butuh dependensi tambahan (pakai http bawaan Node).
 *
 * Pemakaian: npm run smoke
 */

const http = require('http');
const path = require('path');
const { createApp } = require(path.join(__dirname, '..', 'src', 'app.js'));

const app = createApp();
const server = app.listen(0);
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

/* Cookie jar sederhana per "sesi" uji. */
function makeJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(res) {
      const raw = res.headers['set-cookie'];
      if (!raw) return;
      for (const c of raw) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
  };
}

function request(pathname, { method = 'GET', jar, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'text/html' };
    if (jar) {
      const cookie = jar.header();
      if (cookie) headers.Cookie = cookie;
    }
    let payload = null;
    if (body) {
      payload = new URLSearchParams(body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(`${BASE}${pathname}`, { method, headers }, (res) => {
      if (jar) jar.absorb(res);
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* Ambil token CSRF dari halaman yang memuat form. */
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
}

const failures = [];
let checked = 0;

/** Halaman harus merespons (bukan 5xx) dan tidak boleh memuat error render. */
async function expectOk(name, pathname, opts = {}) {
  checked += 1;
  const res = await request(pathname, opts);
  const problems = [];
  if (res.status >= 500) problems.push(`status ${res.status}`);
  if (/ReferenceError|TypeError: .* is not a function|Cannot read properties of undefined/i.test(res.body)) {
    const m = res.body.match(/(ReferenceError|TypeError)[^<]{0,120}/);
    problems.push(`error render: ${m ? m[0].trim() : 'tidak diketahui'}`);
  }
  if (problems.length) {
    failures.push({ name, pathname, problems });
    console.log(`  ✗ ${name} (${pathname}) — ${problems.join('; ')}`);
  } else {
    console.log(`  ✓ ${name} → ${res.status}`);
  }
  return res;
}

(async () => {
  console.log('\n[1] Halaman publik');
  const pub = [
    ['Beranda', '/'],
    ['Destinasi', '/destinasi'],
    ['Paket', '/paket'],
    ['Artikel', '/artikel'],
    ['Tentang', '/tentang'],
    ['Kontak', '/kontak'],
    ['Masuk', '/masuk'],
    ['Daftar', '/daftar'],
    ['Cari', '/cari?q=pulau'],
    ['robots.txt', '/robots.txt'],
    ['sitemap.xml', '/sitemap.xml']
  ];
  for (const [name, p] of pub) await expectOk(name, p);

  console.log('\n[2] Halaman detail (dari data nyata)');
  const db = require(path.join(__dirname, '..', 'data', 'db.json'));
  const dest = (db.destinations || [])[0];
  const pkg = (db.packages || [])[0];
  const art = (db.articles || [])[0];
  const bkg = (db.bookings || [])[0];
  if (dest) await expectOk('Detail.destinasi', `/destinasi/${dest.slug}`);
  if (pkg) await expectOk('Detail paket', `/paket/${pkg.slug}`);
  if (art) await expectOk('Detail artikel', `/artikel/${art.slug}`);
  if (bkg) await expectOk('Detail pembayaran', `/pembayaran/${bkg.code}`);

  console.log('\n[3] Form publik (POST dengan token CSRF asli)');
  {
    const jar = makeJar();
    // Form kontak ada di /kontak (Beranda tidak memuat form).
    const formPage = await request('/kontak', { jar });
    const token = csrfFrom(formPage.body);
    if (!token) {
      failures.push({ name: 'Token CSRF', pathname: '/kontak', problems: ['token tidak ditemukan di /kontak'] });
      console.log('  ✗ token CSRF tidak ditemukan di /kontak');
    } else {
      await expectOk('Kontak (POST)', '/kontak', {
        method: 'POST', jar, body: { _csrf: token, name: 'Uji Smoke', email: 'smoke@example.com', message: 'Pesan uji otomatis' }
      });
      if (pkg) {
        const bookingRes = await expectOk('Booking (POST)', `/paket/${pkg.slug}/booking`, {
          method: 'POST', jar, body: {
            _csrf: token, name: 'Uji Smoke', email: 'smoke@example.com', phone: '081234567890',
            departureDate: '2030-01-01', participants: '2', notes: 'uji'
          }
        });
        // Konfirmasi transfer manual: endpoint ini publik, jadi harus menolak
        // request yang tidak menyertakan email pemesan yang cocok.
        const code = bookingRes.headers && bookingRes.headers.location
          ? String(bookingRes.headers.location).split('/').pop()
          : null;
        if (code && code.startsWith('SYLT-')) {
          await expectOk('Pembayaran manual tanpa email (harus ditolak)', `/pembayaran/${code}/manual`, {
            method: 'POST', jar, body: { _csrf: token, note: 'tanpa email' }
          });
          await expectOk('Pembayaran manual dengan email benar', `/pembayaran/${code}/manual`, {
            method: 'POST', jar, body: { _csrf: token, email: 'smoke@example.com', note: 'uji otomatis' }
          });
        }
      }
      await expectOk('CSRF ditolak (harus 403, bukan 500)', '/kontak', {
        method: 'POST', jar, body: { name: 'Tanpa Token', email: 'x@example.com', message: 'tanpa token' }
      });
    }
  }

  console.log('\n[4] Halaman admin (tanpa login → harus redirect, bukan 500)');
  const adminPages = [
    ['Dashboard', '/admin'],
    ['Destinasi', '/admin/destinasi'],
    ['Paket', '/admin/paket'],
    ['Artikel', '/admin/artikel'],
    ['Booking', '/admin/booking'],
    ['Pelanggan', '/admin/pelanggan'],
    ['Pesan', '/admin/pesan'],
    ['Testimoni', '/admin/testimoni'],
    ['Marketing kontak', '/admin/marketing/kontak'],
    ['Blast', '/admin/marketing/blast'],
    ['WhatsApp', '/admin/whatsapp'],
    ['SEO', '/admin/seo'],
    ['Pengaturan', '/admin/pengaturan'],
    ['Akun', '/admin/akun']
  ];
  for (const [name, p] of adminPages) await expectOk(name, p);

  console.log('\n[5] Halaman admin (setelah login)');
  {
    const jar = makeJar();
    const login = await request('/admin/login', { jar });
    const token = csrfFrom(login.body);
    if (!token) {
      console.log('  ✗ token CSRF tidak ditemukan di halaman login admin');
      failures.push({ name: 'CSRF login admin', pathname: '/admin/login', problems: ['token tidak ditemukan'] });
    } else {
      const res = await request('/admin/login', {
        method: 'POST', jar, body: { _csrf: token, username: 'admin', password: 'admin123' }
      });
      if (res.status !== 302) {
        console.log(`  ✗ login admin gagal (status ${res.status})`);
        failures.push({ name: 'Login admin', pathname: '/admin/login', problems: [`status ${res.status}`] });
      } else {
        console.log('  ✓ Login admin → 302');
        checked += 1;
        for (const [name, p] of adminPages) await expectOk(name, p, { jar });
        // Partial (dipakai live-search admin)
        for (const [name, p] of [
          ['Partial.', '/admin/destinasi'], ['Partial paket', '/admin/paket'],
          ['Partial artikel', '/admin/artikel'], ['Partial booking', '/admin/booking'],
          ['Partial pelanggan', '/admin/pelanggan'], ['Partial pesan', '/admin/pesan'],
          ['Partial testimoni', '/admin/testimoni'], ['Partial kontak', '/admin/marketing/kontak']
        ]) {
          await expectOk(name, `${p}?partial=1`, { jar });
        }
      }
    }
  }

  server.close();

  /* Bersihkan data yang dibuat oleh test ini (kontak, pelanggan, booking),
     supaya menjalankan smoke test tidak mengotori database. */
  try {
    const db = require(path.join(__dirname, '..', 'src', 'db.js'));
    const data = db.read() || {};
    const SMOKE = 'smoke@example.com';
    const before = (data.bookings || []).length;
    data.bookings = (data.bookings || []).filter((b) => b.email !== SMOKE);
    data.contacts = (data.contacts || []).filter((c) => c.email !== SMOKE);
    data.customers = (data.customers || []).filter((c) => c.email !== SMOKE);
    data.messages = (data.messages || []).filter((m) => m.email !== SMOKE);
    db.write();
    const after = (data.bookings || []).length;
    console.log(`\n🧹 Data uji dibersihkan (booking ${before} → ${after}).`);
  } catch (err) {
    console.warn('⚠️  Gagal membersihkan data uji:', err.message);
  }

  console.log('');
  if (failures.length) {
    console.error(`✗ ${failures.length} dari ${checked} pemeriksaan gagal:`);
    for (const f of failures) console.error(`   • ${f.name} (${f.pathname}): ${f.problems.join('; ')}`);
    process.exit(1);
  }
  console.log(`✓ Semua ${checked} halaman ter-render tanpa error.`);
  process.exit(0);
})().catch((err) => {
  console.error('Gagal menjalankan smoke test:', err);
  try { server.close(); } catch (e) { /* ignore */ }
  process.exit(1);
});
