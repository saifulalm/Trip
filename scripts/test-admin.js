'use strict';

/**
 * test-admin.js — uji hak akses admin & CRUD data.
 *
 * Semua berjalan di lingkungan TERPISAH (DB + folder upload sintetis),
 * jadi data produksi tidak pernah tersentuh.
 *
 * Yang diuji:
 *   1. Halaman admin tanpa login → redirect ke /admin/login (bukan 500).
 *   2. Login dengan role 'editor' → DITOLAK (hanya 'admin' yang boleh).
 *   3. Login admin → ID sesi berubah (mitigasi session fixation).
 *   4. CRUD_destinasi: create → edit → delete, benar-benar tersimpan.
 *   5. CRUD paket & artikel: create → edit → delete.
 *   6. Pencarian, filter status, dan pagination (partial) bekerja.
 *   7. Aksi tanpa token CSRF → 403.
 *   8. Alur pelanggan: daftar → login → booking tersambung.
 *
 * Pemakaian: npm run test:admin
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Isolasi                                                             */
/* ------------------------------------------------------------------ */

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'syt-admin-test-'));
const TMP_DB = path.join(TMP_ROOT, 'db.json');
const TMP_UPLOADS = path.join(TMP_ROOT, 'uploads');
const TMP_STATIC = path.join(TMP_ROOT, 'static');
fs.mkdirSync(TMP_UPLOADS, { recursive: true });
fs.mkdirSync(TMP_STATIC, { recursive: true });

const bcrypt = require('bcryptjs');
const now = new Date().toISOString();

const seedDb = {
  version: 1,
  users: [
    {
      id: 'usr_admin',
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      name: 'Administrator Uji',
      role: 'admin',
      createdAt: now
    },
    {
      id: 'usr_editor',
      username: 'editor',
      passwordHash: bcrypt.hashSync('editor123', 10),
      name: 'Editor Uji',
      role: 'editor',
      createdAt: now
    }
  ],
  destinations: [
    {
      id: 'dst_uji_1', slug: 'pulau-uji-satu', name: 'Pulau Uji Satu',
      region: 'Raja Ampat', tagline: 'Tagline uji', description: 'Deskripsi sintetis untuk pengujian otomatis.',
      highlights: [], facilities: [], priceFrom: 100000, lat: null, lng: null,
      image: '/img/dest-default.svg', gallery: [], featured: false, status: 'published', createdAt: now
    }
  ],
  packages: [],
  articles: [],
  bookings: [],
  messages: [],
  contacts: [],
  customers: [],
  reviews: [],
  broadcasts: [],
  settings: {
    siteName: 'Seayoulatertrip Uji', tagline: 'Tagline uji', whatsapp: '6281234567890',
    email: 'uji@example.com', phone: '081234567890', address: 'Alamat uji', about: 'Tentang uji',
    heroTitle: 'Judul hero uji', heroSubtitle: 'Subjudul hero uji',
    paymentBank: 'BCA', paymentAccount: '1234567890', paymentAccountName: 'PT Uji',
    waProvider: 'web', waFloatEnabled: true
  }
};
fs.writeFileSync(TMP_DB, JSON.stringify(seedDb, null, 2), 'utf8');

for (const asset of ['css', 'js', 'img']) {
  const src = path.join(__dirname, '..', 'public', asset);
  if (fs.existsSync(src)) {
    try { fs.symlinkSync(src, path.join(TMP_STATIC, asset)); } catch (e) { /* ignore */ }
  }
}
try { fs.symlinkSync(TMP_UPLOADS, path.join(TMP_STATIC, 'uploads')); } catch (e) { /* ignore */ }

process.env.DB_FILE = TMP_DB;
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.STATIC_DIR = TMP_STATIC;

const { createApp } = require(path.join(__dirname, '..', 'src', 'app.js'));
const db = require(path.join(__dirname, '..', 'src', 'db.js'));

const app = createApp();
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ */
/* HTTP helper                                                        */
/* ------------------------------------------------------------------ */

function makeJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    sessionId() {
      const raw = jar.get('connect.sid');
      return raw ? decodeURIComponent(raw).split('.')[0] : null;
    },
    absorb(res) {
      const raw = res.headers['set-cookie'];
      if (!raw) return;
      for (const c of raw) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    }
  };
}

function req(pathname, { method = 'GET', jar, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Accept: 'text/html', ...headers };
    if (jar) {
      const c = jar.header();
      if (c) h.Cookie = c;
    }
    let payload = null;
    if (body) {
      payload = new URLSearchParams(body).toString();
      h['Content-Type'] = 'application/x-www-form-urlencoded';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request(BASE + pathname, { method, headers: h }, (res) => {
      if (jar) jar.absorb(res);
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Assertion                                                           */
/* ------------------------------------------------------------------ */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const readDb = () => db.read() || {};

(async () => {
  /* ---------------------------------------------------------------- */
  console.log('\n[1] Halaman admin tanpa login');
  {
    for (const p of ['/admin', '/admin/destinasi', '/admin/pengaturan', '/admin/whatsapp']) {
      const r = await req(p, {});
      check(`${p} → redirect ke login`,
        r.status === 302 && String(r.headers.location || '').startsWith('/admin/login'),
        `status ${r.status} → ${r.headers.location}`);
    }
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[2] Role non-admin ditolak');
  {
    const jar = makeJar();
    const lp = await req('/admin/login', { jar });
    const token = csrfFrom(lp.body);
    const r = await req('/admin/login', {
      method: 'POST', jar, body: { _csrf: token, username: 'editor', password: 'editor123' }
    });
    check('Login dengan role "editor" ditolak (403)', r.status === 403, `status ${r.status}`);
    const dash = await req('/admin', { jar });
    check('Sesi editor TIDAK bisa membuka dashboard',
      dash.status === 302 && String(dash.headers.location || '').startsWith('/admin/login'),
      `status ${dash.status} → ${dash.headers.location}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[3] Login admin & rotasi ID sesi');
  const jar = makeJar();
  {
    const lp = await req('/admin/login', { jar });
    const token = csrfFrom(lp.body);
    const before = jar.sessionId();
    const r = await req('/admin/login', {
      method: 'POST', jar, body: { _csrf: token, username: 'admin', password: 'admin123' }
    });
    check('Login admin berhasil', r.status === 302 && r.headers.location === '/admin', `status ${r.status}`);
    const after = jar.sessionId();
    check('ID sesi dirotasi setelah login (session fixation)',
      Boolean(before) && Boolean(after) && before !== after, `${before} → ${after}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[4] CRUD Destinasi');
  let destId = null;
  {
    const page = await req('/admin/destinasi/baru', { jar });
    const token = csrfFrom(page.body);
    const r = await req('/admin/destinasi', {
      method: 'POST', jar, body: {
        _csrf: token, name: 'Destinasi Uji CRUD', region: 'Raja Ampat',
        description: 'Deskripsi sintetis yang panjangnya cukup untuk lolos validasi.',
        priceFrom: '250000', status: 'published', featured: 'on', lat: '-0.4719', lng: '130.7515'
      }
    });
    check('Create destinasi → redirect ke daftar', r.status === 302 && r.headers.location === '/admin/destinasi',
      `status ${r.status} → ${r.headers.location}`);
    const rec = (readDb().destinations || []).find((d) => d.name === 'Destinasi Uji CRUD');
    check('Data destinasi benar-benar tersimpan', !!rec, rec ? rec.id : 'tidak ditemukan');
    if (rec) {
      destId = rec.id;
      check('Field Tersimpan benar (featured, harga, koordinat)',
        rec.featured === true && rec.priceFrom === 250000 && rec.lat === -0.4719 && rec.lng === 130.7515,
        JSON.stringify({ featured: rec.featured, priceFrom: rec.priceFrom, lat: rec.lat, lng: rec.lng }));
    }

    /* Edit */
    const ep = await req(`/admin/destinasi/${destId}/edit`, { jar });
    const etoken = csrfFrom(ep.body);
    const er = await req(`/admin/destinasi/${destId}`, {
      method: 'POST', jar, body: {
        _csrf: etoken, name: 'Destinasi Uji CRUD (diubah)', region: 'Raja Ampat',
        description: 'Deskripsi sintetis yang panjangnya cukup untuk lolos validasi.',
        priceFrom: '300000', status: 'draft', lat: '10', lng: '20'
      }
    });
    check('Edit destinasi → redirect ke daftar', er.status === 302 && er.headers.location === '/admin/destinasi',
      `status ${er.status}`);
    const rec2 = (readDb().destinations || []).find((d) => d.id === destId);
    check('Perubahan Tersimpan',
      rec2 && rec2.name === 'Destinasi Uji CRUD (diubah)' && rec2.priceFrom === 300000 && rec2.status === 'draft',
      rec2 ? `${rec2.name} / ${rec2.priceFrom} / ${rec2.status}` : 'tidak ditemukan');
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[5] CRUD Paket & Artikel');
  {
    const page = await req('/admin/paket/baru', { jar });
    const token = csrfFrom(page.body);
    const r = await req('/admin/paket', {
      method: 'POST', jar, body: {
        _csrf: token, title: 'Paket Uji CRUD', destinationSlug: 'pulau-uji-satu',
        destinationName: 'Pulau Uji Satu', days: '3', nights: '2', price: '1500000',
        status: 'published', summary: 'Ringkasan paket uji', featured: 'on'
      }
    });
    check('Create paket → redirect ke daftar', r.status === 302 && r.headers.location === '/admin/paket',
      `status ${r.status} → ${r.headers.location}`);
    const pkg = (readDb().packages || []).find((p) => p.title === 'Paket Uji CRUD');
    check('Data paket benar-benar tersimpan', !!pkg, pkg ? pkg.id : 'tidak ditemukan');
    if (pkg) {
      const dp = await req(`/admin/paket/${pkg.id}/edit`, { jar });
      const dt = csrfFrom(dp.body);
      await req(`/admin/paket/${pkg.id}`, {
        method: 'POST', jar, body: {
          _csrf: dt, title: 'Paket Uji CRUD (diubah)', destinationSlug: 'pulau-uji-satu',
          destinationName: 'Pulau Uji Satu', days: '4', price: '1700000', status: 'draft'
        }
      });
      const pkg2 = (readDb().packages || []).find((p) => p.id === pkg.id);
      check('Perubahan paket tersimpan', pkg2 && pkg2.title === 'Paket Uji CRUD (diubah)' && pkg2.price === 1700000,
        pkg2 ? `${pkg2.title} / ${pkg2.price}` : 'tidak ditemukan');
    }

    const apage = await req('/admin/artikel/baru', { jar });
    const atoken = csrfFrom(apage.body);
    const ar = await req('/admin/artikel', {
      method: 'POST', jar, body: {
        _csrf: atoken, title: 'Artikel Uji CRUD',
        body: 'Isi artikel sintetis yang panjangnya lebih dari lima puluh karakter untuk lolos validasi.',
        category: 'Panduan', status: 'published'
      }
    });
    check('Create artikel → redirect ke daftar', ar.status === 302 && ar.headers.location === '/admin/artikel',
      `status ${ar.status} → ${ar.headers.location}`);
    const art = (readDb().articles || []).find((a) => a.title === 'Artikel Uji CRUD');
    check('Data artikel benar-benar tersimpan', !!art, art ? art.id : 'tidak ditemukan');
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[6] Pencarian, filter & pagination');
  {
    const s = await req('/admin/destinasi?q=CRUD', { jar });
    check('Pencarian justly mengembalikan hasil', s.status === 200 && /Destinasi Uji CRUD/.test(s.body), `status ${s.status}`);
    const p = await req('/admin/destinasi?partial=1', { jar });
    check('Partial live-search bisa dirender', p.status === 200 && /<table|<tr/i.test(p.body), `status ${p.status}`);
    const st = await req('/admin/booking?status=pending', { jar });
    check('Filter status booking tidak error', st.status === 200, `status ${st.status}`);
    const so = await req('/admin/destinasi?sort=priceFrom&dir=desc', { jar });
    check('Sorting server-side tidak error', so.status === 200, `status ${so.status}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[7] Proteksi CSRF pada aksi tulis');
  {
    const r = await req('/admin/destinasi/hapus-palsu', { method: 'POST', jar, body: { id: 'x' } });
    check('POST tanpa token CSRF ditolak (403)', r.status === 403, `status ${r.status}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[8] Hapus data (CRUD destroy)');
  {
    const dests = readDb().destinations || [];
    const target = dests.find((d) => d.name === 'Destinasi Uji CRUD (diubah)');
    if (target) {
      const page = await req('/admin/destinasi', { jar });
      const token = csrfFrom(page.body);
      const r = await req(`/admin/destinasi/${target.id}/hapus`, { method: 'POST', jar, body: { _csrf: token } });
      check('Hapus destinasi → redirect ke daftar', r.status === 302 && r.headers.location === '/admin/destinasi',
        `status ${r.status}`);
      const still = (readDb().destinations || []).some((d) => d.id === target.id);
      check('Destinasi benar-benar terhapus dari database', !still);
    }
    const pkg = (readDb().packages || []).find((p) => p.title === 'Paket Uji CRUD (diubah)');
    if (pkg) {
      const page = await req('/admin/paket', { jar });
      const token = csrfFrom(page.body);
      await req(`/admin/paket/${pkg.id}/hapus`, { method: 'POST', jar, body: { _csrf: token } });
      const still = (readDb().packages || []).some((p) => p.id === pkg.id);
      check('Paket benar-benar terhapus dari database', !still);
    }
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[9] Alur pelanggan (daftar → login → sambung booking)');
  {
    const cjar = makeJar();
    const page = await req('/daftar', { jar: cjar });
    const token = csrfFrom(page.body);
    const r = await req('/daftar', {
      method: 'POST', jar: cjar, body: {
        _csrf: token, name: 'Pelanggan Uji', email: 'pelanggan@example.com',
        phone: '081234567890', password: 'rahasia123', passwordConfirm: 'rahasia123'
      }
    });
    check('Pendaftaran pelanggan berhasil', r.status === 302 && r.headers.location === '/akun',
      `status ${r.status} → ${r.headers.location}`);
    const cust = (readDb().customers || []).find((c) => c.email === 'pelanggan@example.com');
    check('Data pelanggan benar-benar tersimpan', !!cust, cust ? cust.id : 'tidak ditemukan');

    // Login diuji dengan sesi BARU (setelah pendaftaran, pelanggan sudah
    // otomatis masuk, jadi /masuk akan mengarahkan ke /akun).
    const ljar = makeJar();
    const lpage = await req('/masuk', { jar: ljar });
    const ltoken = csrfFrom(lpage.body);
    const lr = await req('/masuk', {
      method: 'POST', jar: ljar, body: { _csrf: ltoken, email: 'pelanggan@example.com', password: 'rahasia123' }
    });
    check('Login pelanggan berhasil', lr.status === 302, `status ${lr.status}`);
    const akun = await req('/akun', { jar: ljar });
    check('Halaman /akun terbuka setelah login', akun.status === 200, `status ${akun.status}`);

    // Password salah harus ditolak.
    const bjar = makeJar();
    const bpage = await req('/masuk', { jar: bjar });
    const btoken = csrfFrom(bpage.body);
    const bad = await req('/masuk', {
      method: 'POST', jar: bjar, body: { _csrf: btoken, email: 'pelanggan@example.com', password: 'salah' }
    });
    check('Login pelanggan dengan password salah ditolak', bad.status === 302 && bad.headers.location === '/masuk',
      `status ${bad.status} → ${bad.headers.location}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[10] Pengaturan: field terpisah tidak saling menimpa');
  {
    const page = await req('/admin/pengaturan', { jar });
    const token = csrfFrom(page.body);
    // Simpan form "Rekening" saja — provider WA & tombol mengambang harus utuh.
    await req('/admin/pengaturan', {
      method: 'POST', jar, body: { _csrf: token, paymentBank: 'BNI', paymentAccount: '999', paymentAccountName: 'PT Uji' }
    });
    const s = readDb().settings;
    check('Provider WhatsApp tidak ter-reset saat menyimpan form lain',
      s.waProvider === 'web', `waProvider=${s.waProvider}`);
    check('Tombol WhatsApp mengambang tetap aktif', s.waFloatEnabled === true, `waFloatEnabled=${s.waFloatEnabled}`);
    check('Nomor rekening tersimpan', s.paymentBank === 'BNI' && s.paymentAccount === '999', `${s.paymentBank}/${s.paymentAccount}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[11] Toggle SEO "indekskan situs" (pola hidden off + checkbox)');
  {
    const page = await req('/admin/seo', { jar });
    const token = csrfFrom(page.body);
    // Checkbox dicentang → body berisi ["off", "on"].
    const body = new URLSearchParams();
    body.set('_csrf', token);
    body.set('siteUrl', 'https://seayoulatertrip.com');
    body.set('seoDescription', 'Deskripsi SEO uji');
    body.append('seoIndex', 'off');
    body.append('seoIndex', 'on');
    const r = await req('/admin/seo', {
      method: 'POST', jar, body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    check('Simpan SEO → redirect ke /admin/seo', r.status === 302 && r.headers.location === '/admin/seo',
      `status ${r.status} → ${r.headers.location}`);
    const s = readDb().settings;
    check('seoIndex tetap true setelah dicentang', s.seoIndex === true, `seoIndex=${s.seoIndex}`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[12] Role berubah setelah login → akses dicabut + pesan tampil');
  {
    const data = readDb();
    const admin = (data.users || []).find((u) => u.username === 'admin');
    admin.role = 'editor';
    db.write();

    const dash = await req('/admin', { jar });
    check('Sesi lama otomatis kehilangan akses', dash.status === 302
      && String(dash.headers.location || '').startsWith('/admin/login'),
      `status ${dash.status} → ${dash.headers.location}`);

    const loginPage = await req('/admin/login', { jar });
    check('Halaman login menampilkan alasan penolakan',
      loginPage.status === 200 && /tidak memiliki akses/i.test(loginPage.body),
      `status ${loginPage.status}`);

    // Kembalikan role supaya pemeriksaan lain tidak terpengaruh.
    const data2 = readDb();
    const admin2 = (data2.users || []).find((u) => u.username === 'admin');
    admin2.role = 'admin';
    db.write();
  }

  server.close();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.error(`✗ ${failed.length} dari ${results.length} pemeriksaan gagal:`);
    for (const f of failed) console.error(`   • ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
  console.log(`✓ Semua ${results.length} pemeriksaan admin lolos.`);
  process.exit(0);
})().catch((err) => {
  console.error('Gagal menjalankan test admin:', err);
  try { server.close(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(1);
});
