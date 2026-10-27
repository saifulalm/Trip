'use strict';

/**
 * test-upload.js — uji alur upload gambar end-to-end.
 *
 * Menjalankan aplikasi sungguhan (dengan DB & folder upload TERPISAH, jadi
 * data asli tidak pernah tersentuh) lalu menguji:
 *   1. Rate limit login admin (harus 429 setelah N percobaan gagal).
 *   2. Upload PNG valid ke /admin/destinasi.
 *   3. URL gambar hasil upload dapat diakses publik.
 *   4. Upload berkas ber-ekstensi gambar tapi isinya bukan gambar (harus ditolak).
 *   5. Upload berkas berekstensi terlarang (mis. .svg — harus ditolak).
 *   6. Upload berkas melebihi batas ukuran (harus ditolak).
 *   7. Upload tanpa token CSRF (harus 403).
 *   8. Nama berkas berisi path traversal / path absolut (harus tetap aman).
 *   9. Checkbox "unggulan" (featured) benar-benar tersimpan.
 *
 * Pemakaian: npm run test:upload
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Isolasi: env harus diset SEBELUM module aplikasi di-require         */
/* ------------------------------------------------------------------ */

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'syt-upload-test-'));
const TMP_DB = path.join(TMP_ROOT, 'db.json');
const TMP_UPLOADS = path.join(TMP_ROOT, 'uploads');
const TMP_STATIC = path.join(TMP_ROOT, 'static');

fs.mkdirSync(TMP_UPLOADS, { recursive: true });
fs.mkdirSync(TMP_STATIC, { recursive: true });

/* Basis data SINTETIS — data produksi tidak pernah disalin atau disentuh,
   sehingga tidak ada data pelanggan yang terbawa ke folder sementara. */
const bcrypt = require('bcryptjs');
const now = new Date().toISOString();
const seedDb = {
  version: 1,
  users: [
    {
      id: 'usr_uji',
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      name: 'Administrator Uji',
      role: 'admin',
      createdAt: now
    }
  ],
  destinations: [
    {
      id: 'dst_uji',
      slug: 'pulau-uji',
      name: 'Pulau Uji',
      region: 'Raja Ampat, Papua Barat Daya',
      tagline: 'Destinasi untuk pengujian otomatis',
      description: 'Deskripsi synthesik yang dipakai oleh test upload otomatis.',
      highlights: [],
      facilities: [],
      priceFrom: 100000,
      lat: -0.4719,
      lng: 130.7515,
      image: '/img/dest-default.svg',
      gallery: [],
      featured: false,
      status: 'published',
      createdAt: now
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
    siteName: 'Seayoulatertrip Uji',
    tagline: 'Tagline uji',
    whatsapp: '6281234567890',
    email: 'uji@example.com',
    phone: '081234567890',
    address: 'Alamat uji',
    about: 'Tentang uji',
    heroTitle: 'Judul hero uji',
    heroSubtitle: 'Subjudul hero uji',
    paymentBank: 'BCA',
    paymentAccount: '1234567890',
    paymentAccountName: 'PT Uji',
    waProvider: 'cloud',
    waFloatEnabled: true
  }
};
fs.writeFileSync(TMP_DB, JSON.stringify(seedDb, null, 2), 'utf8');

/* Folder statis: symlink aset asli + folder uploads uji. */
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
      if (Buffer.isBuffer(body)) {
        payload = body;
      } else {
        payload = new URLSearchParams(body).toString();
        h['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request(BASE + pathname, { method, headers: h }, (res) => {
      if (jar) jar.absorb(res);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers
      }));
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

/** Susun body multipart/form-data secara manual (tanpa dependensi). */
function multipart(fields, files) {
  const boundary = '----syt' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const [k, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null) continue;
    // Nilai bisa berupa array untuk menguji field duplikat (hidden + checkbox).
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
  }
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.type}\r\n\r\n`
    ));
    chunks.push(f.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

/* PNG 1x1 yang valid. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/* ------------------------------------------------------------------ */
/* Assertion helpers                                                  */
/* ------------------------------------------------------------------ */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function listUploads() {
  return fs.readdirSync(TMP_UPLOADS).filter((f) => f !== '.gitkeep');
}

async function uploadDestination(jar, { name, filename, mime, data, csrf = true, extra = {} }) {
  const page = await req('/admin/destinasi/baru', { jar });
  const token = csrf ? csrfFrom(page.body) : 'token-palsu';
  const fields = {
    _csrf: token,
    name,
    region: 'Raja Ampat, Papua Barat Daya',
    description: 'Deskripsi uji upload otomatis yang panjangnya lebih dari dua puluh karakter.',
    priceFrom: '150000',
    status: 'published',
    ...extra
  };
  const mp = multipart(fields, [{ name: 'imageFile', filename, type: mime, data }]);
  return req('/admin/destinasi', {
    method: 'POST', jar, body: mp.body, headers: { 'Content-Type': mp.type }
  });
}

(async () => {
  console.log('\n[1] Upload dengan sesi admin');
  const jar = makeJar();
  {
    const lp = await req('/admin/login', { jar });
    const token = csrfFrom(lp.body);
    const r = await req('/admin/login', {
      method: 'POST', jar, body: { _csrf: token, username: 'admin', password: 'admin123' }
    });
    check('Login admin berhasil', r.status === 302 && r.headers.location === '/admin',
      `status ${r.status} → ${r.headers.location}`);
  }

  const before = new Set(listUploads());
  const added = () => listUploads().filter((f) => !before.has(f));
  // Penanda per-permintaan: hanya berkas yang dibuat OLEH request yang diuji.
  let mark = listUploads().length;
  const fresh = () => listUploads().slice(mark);

  /* 2a — PNG valid */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Upload PNG', filename: 'uji.png', mime: 'image/png', data: PNG_BYTES
    });
    check('Upload PNG valid diterima (302 ke daftar)', r.status === 302 && r.headers.location === '/admin/destinasi',
      `status ${r.status} → ${r.headers.location}`);
    check('Berkas PNG tersimpan di upload dir', fresh().length === 1, fresh().join(', '));
  }

  /* 2b — URL hasil upload dapat diakses publik */
  if (added().length) {
    const url = `/uploads/${added()[0]}`;
    const r = await req(url, {});
    check('URL gambar dapat diakses publik (200)', r.status === 200, `${url} → ${r.status}`);
    check('Content-Type gambar sesuai', /image\/(png|jpeg|webp|gif)/.test(r.headers['content-type'] || ''), r.headers['content-type']);
  }

  /* 2c — ekstensi gambar tapi isi bukan gambar */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Konten Palsu', filename: 'palsu.jpg', mime: 'image/jpeg',
      data: Buffer.from('INILAH-BUKAN-GAMBAR-1234567890')
    });
    check('Berkas pseudo-gambar ditolak', fresh().length === 0,
      `status ${r.status}, berkas baru: ${fresh().length}`);
  }

  /* 2d — ekstensi terlarang */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji SVG', filename: 'vektor.svg', mime: 'image/svg+xml',
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    });
    check('Ekstensi .svg ditolak', fresh().length === 0, `status ${r.status}, berkas baru: ${fresh().length}`);
  }

  /* 2e — berkas terlalu besar */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Besar', filename: 'besar.png', mime: 'image/png',
      data: Buffer.alloc(6 * 1024 * 1024, 7)
    });
    check('Berkas > 5 MB ditolak', fresh().length === 0, `status ${r.status}, berkas baru: ${fresh().length}`);
  }

  /* 2f — tanpa token CSRF */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Tanpa Token', filename: 'tanpatoken.png', mime: 'image/png', data: PNG_BYTES, csrf: false
    });
    check('Upload tanpa token CSRF ditolak (403)', r.status === 403, `status ${r.status}`);
    check('Berkas dari request tanpa token tidak tertinggal di disk', fresh().length === 0,
      `berkas baru: ${fresh().length}`);
  }

  /* 2g — path traversal pada nama berkas */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Traversal', filename: '../../../etc/traversal.png', mime: 'image/png', data: PNG_BYTES
    });
    const outside = fs.existsSync('/etc/traversal.png')
      || fs.existsSync(path.join(__dirname, '..', 'traversal.png'))
      || fs.existsSync(path.join(TMP_ROOT, 'traversal.png'));
    check('Path traversal tidak menulis di luar upload dir', !outside, `status ${r.status}`);
    check('Berkas traversal tetap aman di dalam upload dir', fresh().length === 1
      && fresh()[0].indexOf('/') === -1 && fresh()[0].indexOf('\\') === -1, fresh().join(', '));
  }

  /* 2h — nama berkas dengan path absolut Windows */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Absolut', filename: 'C:\\Windows\\evil.png', mime: 'image/png', data: PNG_BYTES
    });
    check('Nama berkas absolut tidak keluar dari upload dir',
      !fs.existsSync('/tmp/evil.png') && !fs.existsSync('C:\\Windows\\evil.png'), `status ${r.status}`);
    check('Berkas absolut tetap aman di dalam upload dir', fresh().length === 1
      && fresh()[0].indexOf('/') === -1 && fresh()[0].indexOf('\\') === -1, fresh().join(', '));
  }

  /* 2i — validasi form gagal → berkas upload harus dibuang (bukan orphan) */
  {
    mark = listUploads().length;
    const r = await uploadDestination(jar, {
      name: 'Uji Validasi Gagal', filename: 'orphan.png', mime: 'image/png', data: PNG_BYTES,
      extra: { description: 'pendek' } // deskripsi < 20 karakter → validasi gagal
    });
    check('Validasi gagal → flash error & kembali ke form',
      r.status === 302 && r.headers.location === '/admin/destinasi/baru',
      `status ${r.status} → ${r.headers.location}`);
    check('Berkas upload dibuang saat validasi gagal (tidak orphan)', fresh().length === 0,
      `berkas baru: ${fresh().length}`);
  }

  /* 2i — checkbox "destinasi unggulan" harus benar-benar tersimpan */
  {
    const page = await req('/admin/destinasi/baru', { jar });
    const token = csrfFrom(page.body);
    const mp = multipart({
      _csrf: token,
      name: 'Uji Destinasi Unggulan',
      region: 'Raja Ampat, Papua Barat Daya',
      description: 'Deskripsi uji upload otomatis yang panjangnya lebih dari dua puluh karakter.',
      priceFrom: '150000',
      status: 'published',
      featured: ['off', 'on']  // hidden "off" + checkbox "on" → jadi array
    }, []);
    const r = await req('/admin/destinasi', {
      method: 'POST', jar, body: mp.body, headers: { 'Content-Type': mp.type }
    });
    const db = require(path.join(__dirname, '..', 'src', 'db.js'));
    const data = db.read() || {};
    const rec = (data.destinations || []).find((d) => d.name === 'Uji Destinasi Unggulan');
    check('Checkbox "unggulan" tersimpan true', rec && rec.featured === true, `status ${r.status}, featured=${rec ? rec.featured : 'tidak ada record'}`);
  }

  /* 2j — bukti pembayaran manual (endpoint publik): butuh email yang cocok */
  {
    const db = require(path.join(__dirname, '..', 'src', 'db.js'));
    const data = db.read() || {};
    const booking = {
      id: 'bkg_uji',
      code: 'SYLT-000000-UIJU01',
      name: 'Uji Smoke',
      email: 'uji@example.com',
      phone: '081234567890',
      packageSlug: 'pulau-uji',
      packageName: 'Paket Uji',
      departureDate: '2030-01-01',
      participants: 2,
      status: 'pending',
      packagePrice: 100000,
      totalAmount: 200000,
      paymentStatus: 'unpaid',
      paymentMethod: null,
      paymentRef: null,
      paidAt: null,
      createdAt: new Date().toISOString()
    };
    data.bookings = data.bookings || [];
    data.bookings.unshift(booking);
    db.write();

    const payJar = makeJar();
    const page = await req(`/pembayaran/${booking.code}`, { jar: payJar });
    const token = csrfFrom(page.body);
    const mp = multipart({ _csrf: token, email: 'salah@example.com', note: 'email salah' },
      [{ name: 'proof', filename: 'bukti.png', type: 'image/png', data: PNG_BYTES }]);
    mark = listUploads().length;
    const bad = await req(`/pembayaran/${booking.code}/manual`, {
      method: 'POST', jar: payJar, body: mp.body, headers: { 'Content-Type': mp.type }
    });
    check('Pembayaran manual: email salah ditolak', bad.status === 302
      && bad.headers.location === `/pembayaran/${booking.code}`, `status ${bad.status}`);
    check('Pembayaran manual: berkas bukti tidak tersimpan saat email salah',
      fresh().length === 0, `berkas baru: ${fresh().length}`);

    const mp2 = multipart({ _csrf: token, email: 'uji@example.com', note: 'email benar' },
      [{ name: 'proof', filename: 'bukti.png', type: 'image/png', data: PNG_BYTES }]);
    mark = listUploads().length;
    const good = await req(`/pembayaran/${booking.code}/manual`, {
      method: 'POST', jar: payJar, body: mp2.body, headers: { 'Content-Type': mp2.type }
    });
    check('Pembayaran manual: email benar diterima', good.status === 302
      && good.headers.location === `/pembayaran/${booking.code}`, `status ${good.status}`);
    check('Pembayaran manual: berkas bukti tersimpan', fresh().length === 1, fresh().join(', '));

    const after = db.read() || {};
    const rec = (after.bookings || []).find((b) => b.code === booking.code);
    check('Pembayaran manual: status booking jadi "menunggu verifikasi"',
      rec && rec.paymentStatus === 'awaiting_review' && !!rec.proofImage,
      `status ${rec ? rec.paymentStatus : '?'}`);
  }

  console.log('\n[2] Rate limit login admin (harus dijalankan terakhir)');
  {
    const jar2 = makeJar();
    const lp = await req('/admin/login', { jar: jar2 });
    const token = csrfFrom(lp.body);
    const statuses = [];
    for (let i = 0; i < 9; i += 1) {
      const r = await req('/admin/login', {
        method: 'POST', jar: jar2, body: { _csrf: token, username: 'admin', password: `salah-${i}` }
      });
      statuses.push(r.status);
    }
    check('Brute-force diblokir (ada 429 dalam 9 percobaan)', statuses.includes(429), `status: ${statuses.join(',')}`);
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
  console.log(`✓ Semua ${results.length} pemeriksaan upload lolos.`);
  process.exit(0);
})().catch((err) => {
  console.error('Gagal menjalankan test upload:', err);
  try { server.close(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(1);
});
