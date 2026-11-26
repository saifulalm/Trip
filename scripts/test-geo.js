'use strict';

/**
 * test-geo.js — uji fitur lokasi tanpa bergantung pada jaringan internet.
 *
 * Yang diuji:
 *   1. Fungsi murni: jarak haversine, query Overpass, parser hasil Overpass
 *      (dedupe, urut jarak, batas radius, label tipe).
 *   2. Validasi API /api/geo/* (400/200) — tidak memanggil Overpass.
 *   3. Halaman /sekitar (tanpa & dengan preset koordinat) ter-render.
 *   4. API pembaruan lokasi booking: auth, CSRF, validasi, idempotensi
 *      clientId, penanda offline sync, riwayat di DB, dan tampilan admin.
 *
 * Pemakaian: npm run test:geo
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

/* ------------------------------------------------------------------ */
/* Lingkungan terpisah                                                 */
/* ------------------------------------------------------------------ */

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'syt-geo-test-'));
const TMP_DB = path.join(TMP_ROOT, 'db.json');
const TMP_UPLOADS = path.join(TMP_ROOT, 'uploads');
const TMP_STATIC = path.join(TMP_ROOT, 'static');
fs.mkdirSync(TMP_UPLOADS, { recursive: true });
fs.mkdirSync(TMP_STATIC, { recursive: true });
for (const asset of ['css', 'js', 'img']) {
  const src = path.join(__dirname, '..', 'public', asset);
  if (fs.existsSync(src)) {
    try { fs.symlinkSync(src, path.join(TMP_STATIC, asset)); } catch (e) { /* ignore */ }
  }
}
try { fs.symlinkSync(TMP_UPLOADS, path.join(TMP_STATIC, 'uploads')); } catch (e) { /* ignore */ }

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
    }
  ],
  destinations: [
    {
      id: 'dst_waisai', slug: 'waisai-uji', name: 'Waisai Uji', region: 'Raja Ampat',
      tagline: 'Tagline', description: 'Deskripsi destinasi uji.',
      highlights: [], facilities: [], priceFrom: 100000,
      lat: -0.4386, lng: 130.8246,
      image: '/img/dest-default.svg', gallery: [], featured: false, status: 'published', createdAt: now
    }
  ],
  packages: [
    {
      id: 'pkg_uji', slug: 'paket-uji', name: 'Paket Uji', destinationSlug: 'waisai-uji',
      summary: 'Ringkas', description: 'Deskripsi', duration: '3D2N', price: 1500000,
      includes: [], excludes: [], itinerary: [], image: '/img/dest-default.svg',
      status: 'published', featured: false, createdAt: now
    }
  ],
  articles: [],
  messages: [],
  contacts: [],
  reviews: [],
  broadcasts: [],
  customers: [
    {
      id: 'cus_uji', name: 'Pelanggan Uji', email: 'pelanggan@example.com',
      phone: '081234567890', passwordHash: bcrypt.hashSync('uji12345', 10), createdAt: now
    },
    {
      id: 'cus_lain', name: 'Pelanggan Lain', email: 'lain@example.com',
      phone: '081234567891', passwordHash: bcrypt.hashSync('lain12345', 10), createdAt: now
    }
  ],
  bookings: [
    {
      id: 'bkg_uji', code: 'SYLT-UJI-1', name: 'Pelanggan Uji', email: 'pelanggan@example.com',
      phone: '081234567890', packageSlug: 'paket-uji', packageName: 'Paket Uji',
      departureDate: '2026-12-01', participants: 2, notes: '',
      status: 'confirmed', customerId: 'cus_uji', packagePrice: 1500000, totalAmount: 3000000,
      paymentMethod: 'manual', paymentStatus: 'paid', checkIn: null, track: [], createdAt: now
    },
    {
      id: 'bkg_batal', code: 'SYLT-UJI-2', name: 'Pelanggan Uji', email: 'pelanggan@example.com',
      phone: '081234567890', packageSlug: 'paket-uji', packageName: 'Paket Uji',
      departureDate: '2026-12-01', participants: 1, notes: '',
      status: 'cancelled', customerId: 'cus_uji', packagePrice: 1500000, totalAmount: 1500000,
      paymentMethod: 'manual', paymentStatus: 'unpaid', checkIn: null, track: [], createdAt: now
    },
    {
      id: 'bkg_orang_lain', code: 'SYLT-UJI-3', name: 'Pelanggan Lain', email: 'lain@example.com',
      phone: '081234567891', packageSlug: 'paket-uji', packageName: 'Paket Uji',
      departureDate: '2026-12-01', participants: 1, notes: '',
      status: 'confirmed', customerId: 'cus_lain', packagePrice: 1500000, totalAmount: 1500000,
      paymentMethod: 'manual', paymentStatus: 'paid', checkIn: null, track: [], createdAt: now
    }
  ],
  settings: {
    siteName: 'Seayoulatertrip Uji', tagline: 'Tagline uji', whatsapp: '6281234567890',
    email: 'uji@example.com', phone: '081234567890', address: 'Alamat uji', about: 'Tentang uji',
    heroTitle: 'Judul hero uji', heroSubtitle: 'Subjudul hero uji',
    paymentBank: 'BCA', paymentAccount: '1234567890', paymentAccountName: 'PT Uji',
    waProvider: 'web', waFloatEnabled: true
  }
};
fs.writeFileSync(TMP_DB, JSON.stringify(seedDb, null, 2), 'utf8');

process.env.DB_FILE = TMP_DB;
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.STATIC_DIR = TMP_STATIC;
// Jangan pernah memanggil jaringan sungguhan dari uji ini.
process.env.GEO_OVERPASS_URL = 'http://127.0.0.1:9/overpass';
process.env.GEO_NOMINATIM_URL = 'http://127.0.0.1:9/nominatim';
process.env.GEO_PHOTON_URL = 'http://127.0.0.1:9/photon/';
const fallbackGeo = require(path.join(__dirname, '..', 'src', 'services', 'geo', 'fallback'));
process.env.GEO_TIMEOUT_MS = '2000';

const geo = require(path.join(__dirname, '..', 'src', 'services', 'geo'));
const { createApp } = require(path.join(__dirname, '..', 'src', 'app.js'));
const db = require(path.join(__dirname, '..', 'src', 'db.js'));

const app = createApp();
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ */
/* Helper HTTP                                                         */
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

function req(pathname, { method = 'GET', jar, body, json, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Accept: 'text/html', ...headers };
    if (jar) {
      const c = jar.header();
      if (c) h.Cookie = c;
    }
    let payload = null;
    if (json) {
      payload = JSON.stringify(json);
      h['Content-Type'] = 'application/json';
    } else if (body) {
      payload = new URLSearchParams(body).toString();
      h['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request(BASE + pathname, { method, headers: h }, (res) => {
      if (jar) jar.absorb(res);
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let parsed = null;
        if (/json/i.test(String(res.headers['content-type'] || ''))) {
          try { parsed = JSON.parse(d); } catch (e) { parsed = null; }
        }
        resolve({ status: res.statusCode, body: d, json: parsed, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const csrfFrom = (html) => {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
};
const csrfHeaderFrom = (html) => {
  const m = html.match(/data-csrf="([a-f0-9]+)"/);
  return m ? m[1] : null;
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ */
/* Uji                                                                 */
/* ------------------------------------------------------------------ */

(async () => {
  console.log('\n[1] Fungsi murni layanan geo');
  {
    const fbPlaces = await fallbackGeo.search({
      category: 'restaurant',
      lat: -8.4964,
      lng: 119.8877,
      radius: 1500,
      limit: 10,
      haversine: geo.haversine,
      searchInBox: async () => [
        { osmType: 'N', osmId: 1, name: 'Kafe Dekat', type: 'cafe', category: 'amenity', lat: -8.4970, lng: 119.8877, address: { road: 'Jl. Uji' } },
        { osmType: 'N', osmId: 1, name: 'Kafe Dekat', type: 'cafe', category: 'amenity', lat: -8.4970, lng: 119.8877, address: {} },
        { osmType: 'W', osmId: 2, name: 'Restoran Jauh', type: 'restaurant', category: 'amenity', lat: -8.60, lng: 119.8877, address: {} }
      ]
    });
    check('Cadangan Nominatim membuang hasil di luar radius', fbPlaces.length === 1, `${fbPlaces.length} hasil`);
    check('Cadangan Nominatim menggabungkan duplikat OSM', fbPlaces[0] && fbPlaces[0].address.includes('Jl. Uji'));

    const oneDegree = geo.haversine(0, 0, 1, 0);
    check('haversine 1° lintang ≈ 111,2 km', Math.abs(oneDegree - 111195) < 200, `${Math.round(oneDegree)} m`);

    const q = geo.buildQuery({ lat: -0.8917, lng: 119.8734, radius: 1200, category: 'transport' });
    check('Query memakai around radius (meter)', q.includes('around:1200,-0.891700,119.873400'));
    check('Query mencakup terminal & dermaga feri', q.includes('bus_station') && q.includes('ferry_terminal'));
    check('Query membatasi output (out center tags)', q.includes('out center tags'));

    const sample = {
      elements: [
        {
          type: 'node', id: 1, lat: -0.8977, lon: 119.8734,
          tags: { name: 'Dermaga Waisai', amenity: 'ferry_terminal', opening_hours: 'Mo-Su 06:00-18:00' }
        },
        {
          type: 'way', id: 2, center: { lat: -0.8920, lon: 119.8734 },
          tags: { tourism: 'hotel', name: 'Hotel Uji', 'addr:street': 'Jl. Pantai' }
        },
        {
          type: 'node', id: 3, lat: -0.8977, lon: 119.8734,
          tags: { name: 'Dermaga Waisai', amenity: 'ferry_terminal' }
        },
        {
          type: 'node', id: 4, lat: -40.0, lon: 119.8734,
          tags: { name: 'Terlalu jauh', amenity: 'bus_station' }
        },
        { type: 'node', id: 5, lat: -0.8910, lon: 119.8734, tags: { amenity: 'restaurant' } }
      ]
    };
    const parsed = geo.parseElements(sample, {
      lat: -0.8917, lng: 119.8734, category: 'transport', limit: 10, radius: 1200
    });
    check('Hasil diurutkan dari yang terdekat', parsed[0].distance <= parsed[1].distance, `${parsed[0].distance} m, ${parsed[1].distance} m`);
    check('Radius menyaring tempat yang jauh', !parsed.some((p) => p.name === 'Terlalu jauh'));
    check('Duplikat node/way digabung', parsed.filter((p) => p.name === 'Dermaga Waisai').length === 1);
    check('Tipe fasilitas diberi label manusiawi', parsed.some((p) => p.typeLabel === 'Dermaga feri'));
    const unnamed = geo.parseElements(
      {
        elements: [
          { type: 'node', id: 9, lat: -0.8910, lon: 119.8734, tags: { amenity: 'restaurant', name: 'TANPA NAMA' } }
        ]
      },
      { lat: -0.8917, lng: 119.8734, category: 'restaurant', limit: 10, radius: 1200 }
    );
    check('name="TANPA NAMA" dianggap tanpa nama', unnamed.length === 1 && unnamed[0].unnamed === true);
    check('Tempat tanpa nama memakai label tipe yang jelas', unnamed[0].name === 'Restoran', unnamed[0].name);
    check('URL OSM terbentuk', parsed.every((p) => /^https:\/\/www\.openstreetmap\.org\//.test(p.osmUrl)));
  }

  console.log('\n[2] Validasi API geo');
  {
    const noCoords = await req('/api/geo/nearby?category=hotel');
    check('Tanpa lat/lng → 400', noCoords.status === 400 && Boolean(noCoords.json && noCoords.json.error));

    const badCat = await req('/api/geo/nearby?lat=-0.8&lng=119.8&category=nuklir');
    check('Kategori tak dikenal → 400', badCat.status === 400);

    const badLat = await req('/api/geo/nearby?lat=999&lng=119.8');
    check('Latitude di luar rentang → 400', badLat.status === 400);

    const shortQ = await req('/api/geo/places?q=ab');
    check('Pencarian tempat < 3 karakter → 400', shortQ.status === 400);

    const cats = await req('/api/geo/categories');
    check('Daftar kategori tersedia', cats.status === 200 && Array.isArray(cats.json.categories) && cats.json.categories.length >= 6);
    check('Atribusi OpenStreetMap disertakan', cats.json && /OpenStreetMap/.test(String(cats.json.attribution)));

    const up = await req('/api/geo/nearby?lat=-0.8&lng=119.8&category=hotel');
    check('Server peta mati → 503 dengan pesan jelas (bukan 500)', up.status === 503 && Boolean(up.json && up.json.error), `status ${up.status}`);
  }

  console.log('\n[3] Halaman /sekitar');
  {
    const page = await req('/sekitar');
    check('/sekitar → 200', page.status === 200);
    check('Tombol geolokasi ada', page.body.includes('Gunakan lokasi saya'));
    check('Chip kategori dirender', page.body.includes('Angkutan Umum') && page.body.includes('Restoran'));
    check('Atribusi OSM tampil', page.body.includes('kontributor OpenStreetMap'));
    check('Nav "Sekitar" aktif', page.body.includes('href="/sekitar"'));

    const preset = await req('/sekitar?lat=-0.4386&lng=130.8246&name=Waisai&category=hotel');
    check('/sekitar dengan preset koordinat → 200', preset.status === 200);
    check('Preset mengisi konfigurasi peta', preset.body.includes('"lat":-0.4386') && preset.body.includes('"category":"hotel"'));

    const destDetail = await req('/destinasi/waisai-uji');
    check('Detail destinasi menautkan pencarian sekitar',
      destDetail.status === 200 && destDetail.body.includes('/sekitar?lat=-0.4386'));
  }

  console.log('\n[4] API pembaruan lokasi booking');
  const jar = makeJar();
  let bookingCsrf = null;
  {
    const unauthGet = await req('/api/akun/booking/bkg_uji/lokasi');
    check('GET tanpa login → 401 JSON', unauthGet.status === 401 && Boolean(unauthGet.json && unauthGet.json.error));

    const unauth = await req('/api/akun/booking/bkg_uji/lokasi', {
      method: 'POST', json: { lat: -0.89, lng: 119.87 }
    });
    check('POST tanpa CSRF ditolak lebih dulu (403)', unauth.status === 403, `status ${unauth.status}`);

    const lp = await req('/masuk', { jar });
    const login = await req('/masuk', {
      method: 'POST', jar, body: { _csrf: csrfFrom(lp.body), email: 'pelanggan@example.com', password: 'uji12345' }
    });
    check('Login pelanggan berhasil', login.status === 302, `status ${login.status}`);

    const detail = await req('/akun/booking/bkg_uji', { jar });
    check('Halaman booking menampilkan panel lokasi', detail.status === 200 && detail.body.includes('Pembaruan Lokasi Perjalanan'));
    check('Panel membawa data-booking-id', detail.body.includes('data-booking-id="bkg_uji"'));
    bookingCsrf = csrfHeaderFrom(detail.body);
    check('Token CSRF tersedia untuk API', Boolean(bookingCsrf));

    const noCsrf = await req('/api/akun/booking/bkg_uji/lokasi', {
      method: 'POST', jar, json: { lat: -0.89, lng: 119.87 }
    });
    check('POST tanpa CSRF → 403', noCsrf.status === 403, `status ${noCsrf.status}`);

    const ok1 = await req('/api/akun/booking/bkg_uji/lokasi', {
      method: 'POST', jar,
      headers: { 'X-CSRF-Token': bookingCsrf },
      json: { id: 'loc_test_1', lat: -0.8917, lng: 119.8734, accuracy: 12, at: new Date().toISOString(), source: 'manual' }
    });
    check('Pembaruan lokasi tersimpan', ok1.status === 200 && ok1.json && ok1.json.stored === true);
    check('lastLocation dikembalikan', ok1.json && ok1.json.lastLocation && Math.abs(ok1.json.lastLocation.lat + 0.8917) < 1e-9);

    const db1 = db.read();
    const b1 = db1.bookings.find((b) => b.id === 'bkg_uji');
    check('DB menyimpan 1 titik', Array.isArray(b1.locationUpdates) && b1.locationUpdates.length === 1);
    check('Riwayat perjalanan (track) ikut bertambah', b1.track.some((t) => t.source === 'location'));

    const dup = await req('/api/akun/booking/bkg_uji/lokasi', {
      method: 'POST', jar, headers: { 'X-CSRF-Token': bookingCsrf },
      json: { id: 'loc_test_1', lat: -0.8917, lng: 119.8734, at: new Date().toISOString() }
    });
    check('clientId sama → idempoten (duplicate)', dup.status === 200 && dup.json.duplicate === true);
    check('Tidak ada titik ganda di DB', db.read().bookings.find((b) => b.id === 'bkg_uji').locationUpdates.length === 1);

    const sync = await req('/api/akun/booking/bkg_uji/lokasi', {
      method: 'POST', jar, headers: { 'X-CSRF-Token': bookingCsrf },
      json: { id: 'loc_test_2', lat: -0.8800, lng: 119.8800, accuracy: 30, at: new Date(Date.now() - 3600000).toISOString(), source: 'sync', offline: true }
    });
    check('Titik hasil offline sync diterima', sync.status === 200);
    const b2 = db.read().bookings.find((b) => b.id === 'bkg_uji');
    check('Penanda sumber "sync" tersimpan', b2.locationUpdates.some((u) => u.source === 'sync'));
    check('Titik lama tidak menimpa lokasi terbaru', Math.abs(b2.lastLocation.lat + 0.8917) < 1e-9);
    check('Ada jejak "offline sync" di track', b2.track.some((t) => /offline/i.test(t.label)));

    const bad = await req('/api/akun/booking/bkg_uji/lokasi', {
      method: 'POST', jar, headers: { 'X-CSRF-Token': bookingCsrf }, json: { lat: 1234, lng: 0 }
    });
    check('Koordinat tidak valid → 400', bad.status === 400);

    const other = await req('/api/akun/booking/bkg_orang_lain/lokasi', {
      method: 'POST', jar, headers: { 'X-CSRF-Token': bookingCsrf }, json: { lat: -0.8, lng: 119.8 }
    });
    check('Booking milik pelanggan lain → 404 (tidak bocor)', other.status === 404);

    const cancelled = await req('/api/akun/booking/bkg_batal/lokasi', {
      method: 'POST', jar, headers: { 'X-CSRF-Token': bookingCsrf }, json: { lat: -0.8, lng: 119.8 }
    });
    check('Booking dibatalkan → 409', cancelled.status === 409);

    const list = await req('/api/akun/booking/bkg_uji/lokasi', { jar });
    check('GET lokasi mengembalikan titik terbaru', list.status === 200 && list.json.lastLocation && list.json.updates.length === 2);
    check('Update terurut dari yang paling lama', list.status === 200 &&
      list.json.updates.every((u, i, arr) => i === 0 || Date.parse(arr[i - 1].at) <= Date.parse(u.at)));
  }

  console.log('\n[5] Tampilan admin');
  {
    const jarAdmin = makeJar();
    const lp = await req('/admin/login', { jar: jarAdmin });
    await req('/admin/login', {
      method: 'POST', jar: jarAdmin, body: { _csrf: csrfFrom(lp.body), username: 'admin', password: 'admin123' }
    });
    const page = await req('/admin/booking/bkg_uji', { jar: jarAdmin });
    check('Admin melihat "Lokasi Terbaru"', page.status === 200 && page.body.includes('Lokasi Terbaru'));
    check('Admin melihat riwayat pembaruan lokasi', page.body.includes('Riwayat Pembaruan Lokasi'));
    check('Admin melihat penanda offline sync', page.body.includes('offline sync'));
  }

  /* ------------------------------------------------------------------ */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? '✗' : '✓'} ${results.length - failed.length}/${results.length} pemeriksaan lolos.`);
  server.close();
  if (failed.length) {
    failed.forEach((f) => console.log(`  gagal: ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error('Uji geo gagal dijalankan:', err);
  server.close();
  process.exitCode = 1;
});
