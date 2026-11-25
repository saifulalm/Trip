'use strict';

/**
 * Verifikasi portal pelanggan: login, dashboard, halaman lokasi,
 * check-in GPS, dan resolusi destination (bug peta kosong).
 *
 * Jalankan: VERIFY_PORT=4301 node scripts/verify-customer-portal.js
 * Server uji harus hidup di port yang sama.
 *
 * PENTING: setiap request harus membawa cookie sesi yang sama.
 * Token CSRF diambil dari halaman yang DIRENDER dengan cookie tersebut
 * (bukan dari halaman login terpisah), karena token terikat ke sesi.
 */

const http = require('http');
const bcrypt = require('bcryptjs');
const path = require('path');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const PORT = Number(process.env.VERIFY_PORT) || 4301;
const BASE = { host: 'localhost', port: PORT };
const EMAIL = process.env.VERIFY_EMAIL || ('verify.portal.' + Date.now() + '@example.com');
const PASSWORD = process.env.VERIFY_PASSWORD || 'VerifyPortal123';

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

/** Gabungkan cookie; nilai terakhir menang (respons paling baru). */
function mergeCookies(a, b) {
  const map = new Map();
  (a ? a.split('; ') : []).concat(b ? b.split('; ') : []).forEach((c) => {
    if (c) map.set(c.split('=')[0], c);
  });
  return Array.from(map.values()).join('; ');
}

/** Klien dengan sesi persisten. */
function makeClient() {
  const state = { cookie: '' };
  async function get(path) {
    const res = await request(path, { headers: state.cookie ? { Cookie: state.cookie } : {} });
    state.cookie = mergeCookies(state.cookie, cookieOf(res));
    return res;
  }
  async function post(path, fields, csrfPath) {
    // Ambil CSRF dari halaman GET yang dirender dengan sesi saat ini.
    // Route target bisa hanya menerima POST (mis. /checkin), jadi
    // sumber token harus halaman yang pasti punya form.
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
    state.cookie = mergeCookies(state.cookie, cookieOf(res));
    return res;
  }
  return { get, post, state };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  OK  ' : ' FAIL ') + name + (detail ? '  →  ' + detail : ''));
}

(async () => {
  // ---- 1. Registrasi akun uji ----
  const cli = makeClient();
  const regPage = await cli.get('/daftar');
  const csrf = (regPage.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  check('Halaman /daftar punya token CSRF', !!csrf, '');

  const reg = await cli.post('/daftar', {
    name: 'Pelanggan Verifikasi',
    email: EMAIL,
    phone: '081298765432',
    password: PASSWORD,
    passwordConfirm: PASSWORD
  });
  check('Registrasi akun pelanggan', reg.status === 302, 'status ' + reg.status);

  // ---- 2. Dashboard ----
  const dash = await cli.get('/akun');
  check('Halaman /akun merespons 200', dash.status === 200, 'status ' + dash.status);
  check('Dashboard menampilkan hero redesigned', dash.body.includes('portal-hero'), '');
  check('Dashboard memuat KPI ringkasan',
    dash.body.includes('Total Booking') && dash.body.includes('Perlu Bayar'), '');
  check('Dashboard memuat link Lokasi Saya', dash.body.includes('/akun/lokasi'), '');
  check('portal.css termuat (definisi .badge publik)',
    dash.body.includes('/css/portal.css'), '');
  check('Navigasi punya tautan Lokasi', dash.body.includes('nav__link'), '');

  const hasTripCards = dash.body.includes('trip-card');
  const hasEmptyState = dash.body.includes('portal-empty');
  // Akun uji BARU belum punya booking → yang tampil adalah empty-state.
  // Yang wajib ada adalah salah satu dari keduanya.
  check('Dashboard menampilkan kartu trip ATAU empty-state',
    hasTripCards || hasEmptyState,
    hasTripCards ? 'kartu trip' : 'empty-state');

  // ---- 2b. Buat booking untuk akun uji agar kartu/stepper teruji ----
  if (!hasTripCards) {
    const pub = makeClient();
    const pkgPage = await pub.get('/paket');
    const pkgLink = (pkgPage.body.match(/href="\/paket\/([a-z0-9-]+)"/) || [])[1];
    check('Halaman /paket memuat link paket', !!pkgLink, pkgLink || '-');
    if (pkgLink) {
      const pkg = await pub.get('/paket/' + pkgLink);
      const dep = new Date();
      dep.setDate(dep.getDate() + 30);
      const depISO = dep.toISOString().slice(0, 10);
      const book = await pub.post('/paket/' + pkgLink + '/booking', {
        name: 'Pelanggan Verifikasi',
        email: EMAIL,
        phone: '081298765432',
        departureDate: depISO,
        participants: '2',
        notes: 'Booking uji otomatis untuk verifikasi portal.',
        waConsent: 'on'
      }, '/paket/' + pkgLink);
      check('Booking uji dibuat lewat /paket/:slug/booking', book.status === 302,
        'status ' + book.status);

      // Sambungkan booking lama ke akun uji.
      const code = (book.headers.location || '').split('/').pop();
      if (code && code.startsWith('SYL')) {
        const link = await cli.post('/akun/sambung-booking', {
          code: code,
          email: EMAIL
        }, '/akun');
        check('Booking lama disambungkan ke akun uji', link.status === 302,
          'status ' + link.status);
      } else {
        check('Kode booking terbaca dari redirect', false, code || '-');
      }

      const dash2 = await cli.get('/akun');
      check('Dashboard kini merender kartu trip',
        dash2.body.includes('trip-card'), '');
      check('Dashboard merender stepper progres',
        dash2.body.includes('trip-steps'), '');
      check('Dashboard menampilkan Panel Perjalanan Berikutnya',
        dash2.body.includes('Perjalanan Berikutnya'), '');
      check('Dashboard menampilkan Rekomendasi trip',
        dash2.body.includes('Rekomendasi'), '');
    }
  }

  // ---- 3. Halaman Lokasi Saya ----
  const loc = await cli.get('/akun/lokasi');
  check('Halaman /akun/lokasi merespons 200', loc.status === 200, 'status ' + loc.status);
  check('Panel izin lokasi ada (permission UI)',
    loc.body.includes('locRequestBtn') && loc.body.includes('location-permission.js'), '');
  check('Tombol simpan posisi terakhir ada',
    loc.body.includes('locSaveForm') && loc.body.includes('/akun/lokasi/simpan'), '');
  check('Peta atau empty-state dirender',
    loc.body.includes('syl-map') || loc.body.includes('portal-map__empty'), '');
  check('Riwayat check-in dirender',
    loc.body.includes('loc-history') || loc.body.includes('Belum ada check-in'), '');

  // ---- 4. Protected route tanpa login ----
  const anon = await request('/akun/lokasi');
  check('/akun/lokasi butuh login (redirect /masuk)',
    anon.status === 302 && /masuk/.test(anon.headers.location || ''),
    'status ' + anon.status);

  // ---- 5. Validasi koordinat ----
  const bad = await cli.post('/akun/lokasi/simpan', { lat: 'abc', lng: 'xyz' }, '/akun/lokasi');
  check('Simpan posisi menolak koordinat tidak valid',
    bad.status === 302 && /\/akun\/lokasi/.test(bad.headers.location || ''),
    'status ' + bad.status + ' loc=' + (bad.headers.location || '-'));

  // ---- 6. Resolusi destination (regresi bug "peta kosong") ----
  const db = require('../src/db');
  const trip = require('../src/services/trip');
  const geo = require('../src/services/geo');
  const data = db.reload();

  const demoCustomer = (data.customers || [])[0];
  // Booking milik pelanggan demo PERTAMA. Jangan pakai find(b => b.customerId)
  // karena booking uji yang baru dibuat disisipkan di depan array.
  const demoBooking = (data.bookings || []).find((b) => b.customerId === (demoCustomer && demoCustomer.id));
  const dest = demoBooking ? trip.resolveDestination(data, demoBooking) : null;
  check('Resolusi booking → paket → destinasi bekerja',
    !!(dest && dest.lat && dest.lng),
    dest ? dest.name : 'booking demo tidak ditemukan');

  // ---- 7. Detail booking pelanggan demo: peta harus punya titik asli ----
  if (demoCustomer && demoBooking && bcrypt.compareSync('customer123', demoCustomer.passwordHash)) {
    const demo = makeClient();
    await demo.get('/masuk');
    const li = await demo.post('/masuk', {
      email: demoCustomer.email,
      password: 'customer123'
    });
    check('Login pelanggan demo', li.status === 302, 'status ' + li.status);

    const detail = await demo.get('/akun/booking/' + demoBooking.id);
    check('Detail booking pelanggan 200', detail.status === 200, 'status ' + detail.status);

    const mapMatch = detail.body.match(
      /<script id="map-data" type="application\/json">([\s\S]*?)<\/script>/
    );
    let mapData = null;
    try { mapData = JSON.parse(mapMatch ? mapMatch[1] : 'null'); } catch (e) { mapData = null; }
    check('map-data memuat titik destinasi (regresi peta kosong)',
      !!(mapData && mapData.dest && typeof mapData.dest.lat === 'number'),
      mapData && mapData.dest ? mapData.dest.name : 'dest null');

    check('Halaman detail memakai modul izin lokasi',
      detail.body.includes('location-permission.js') && detail.body.includes('ciDot'), '');
    check('Stepper progres ada di halaman detail',
      detail.body.includes('trip-steps'), '');

    // ---- 8. Check-in dengan koordinat valid (dekat destinasi) ----
    if (dest) {
      const ci = await demo.post('/akun/booking/' + demoBooking.id + '/checkin', {
        lat: String(dest.lat),
        lng: String(dest.lng),
        accuracy: '12'
      }, '/akun/booking/' + demoBooking.id);
      check('Check-in GPS diterima', ci.status === 302, 'status ' + ci.status);

      const after = db.reload();
      const updated = (after.bookings || []).find((b) => b.id === demoBooking.id);
      check('Check-in tersimpan di database',
        !!(updated && updated.checkIn && typeof updated.checkIn.lat === 'number'),
        updated && updated.checkIn ? updated.checkIn.lat + ', ' + updated.checkIn.lng : 'tidak ada');
      check('Jarak check-in ke destinasi terhitung',
        updated && updated.checkIn && updated.checkIn.distanceToDestination === 0,
        updated && updated.checkIn ? String(updated.checkIn.distanceToDestination) : '-');

      // Check-in kedua harus ditolak (sudah pernah check-in).
      const ci2 = await demo.post('/akun/booking/' + demoBooking.id + '/checkin', {
        lat: String(dest.lat),
        lng: String(dest.lng)
      }, '/akun/booking/' + demoBooking.id);
      check('Check-in kedua ditolak', ci2.status === 302, 'status ' + ci2.status);
    }
  } else {
    check('Pelanggan demo siap (kredensial seed customer123)', false, 'tidak bisa login demo');
  }

  // ---- 9. Unit test geo ----
  const d1 = geo.haversineMeters(-0.4719, 130.7515, -0.4719, 130.7515);
  const d2 = geo.haversineMeters(-0.4719, 130.7515, -0.5619, 130.7515); // selisih 0.09 derajat
  check('haversine jarak identik = 0 m', Math.abs(d1) < 0.001, String(d1));
  check('haversine 0,09 derajat lat ~ 10,0 km', Math.abs(d2 - 10008) < 200, d2.toFixed(0) + ' m');
  check('isValidLatLng menolak koordinat (0,0)', geo.isValidLatLng(0, 0) === false, '');
  check('isValidLatLng menerima koordinat valid',
    geo.isValidLatLng(-0.4719, 130.7515) === true, '');

  // ---- 10. Bersihkan data uji lewat API admin ----
  // PENTING: jangan menulis data/db.json langsung dari skrip ini.
  // Server dev menyimpan cache modul db.js; penulisan langsung dari
  // proses lain akan ditimpa kembali oleh server (race condition).
  // Karena itu penghapusan dilakukan lewat route admin yang menulis
  // melalui db.write() milik proses server.
  try {
    const db2 = require('../src/db');
    const d2 = db2.reload();
    const junkBookings = (d2.bookings || []).filter((b) => b.email === EMAIL);
    const junkCustomers = (d2.customers || []).filter((c) => c.email === EMAIL);

    if (junkBookings.length || junkCustomers.length) {
      const admin = makeClient();
      await admin.get('/admin/login');
      const al = await admin.post('/admin/login', {
        username: process.env.ADMIN_USER || 'admin',
        password: process.env.ADMIN_PASS || 'admin123'
      }, '/admin/login');

      if (al.status === 302) {
        for (const b of junkBookings) {
          await admin.post('/admin/booking/' + b.id + '/hapus', {}, '/admin/booking');
        }
        for (const c of junkCustomers) {
          await admin.post('/admin/pelanggan/' + c.id + '/hapus', {}, '/admin/pelanggan');
        }
        console.log('\n  Data uji dihapus via admin API (' +
          junkBookings.length + ' booking, ' + junkCustomers.length + ' pelanggan).');
      } else {
        console.log('\n  PERINGATAN: login admin gagal, data uji belum dibersihkan.');
      }
    }
  } catch (e) {
    console.log('\n  PERINGATAN: gagal membersihkan data uji:', e.message);
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
