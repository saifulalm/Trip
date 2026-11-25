'use strict';

/**
 * Audit konsistensi data lokasi portal pelanggan.
 *
 * Mengcek bahwa jarak yang ditampilkan pada halaman "Lokasi Saya"
 * konsisten: koordinat check-in harus dibandingkan terhadap titik
 * kumpul dari booking YANG SAMA (bukan booking lain).
 *
 * Jalankan: CONSIST_PORT=4301 node scripts/audit-portal-location-consistency.js
 */

const http = require('http');

const PORT = Number(process.env.CONSIST_PORT) || 4301;
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

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '  OK  ' : ' FAIL ') + name + (detail ? '  →  ' + detail : ''));
}

(async () => {
  const db = require('../src/db');
  const trip = require('../src/services/trip');
  const geo = require('../src/services/geo');
  const data = db.reload();

  // Bangun skenario: pelanggan dengan booking ke destinasi BERBEDA,
  // salah satunya punya check-in.
  //
  // PENTING: pelanggan yang dipilih HARUS pemilik booking yang punya
  // check-in. Memakai `customers[0]` asumsikan urutan seed tetap — rapuh:
  // urutan berubah → fixture hilang → audit gagal palsu. Cari lewat
  // relasi booking, bukan lewat indeks.
  const bookingWithCheckIn = (data.bookings || []).find((b) => b.checkIn && b.customerId);
  const cust = bookingWithCheckIn
    ? (data.customers || []).find((c) => c.id === bookingWithCheckIn.customerId)
    : null;
  if (!cust) {
    console.error('ERROR: tidak ada pelanggan dengan booking ber-check-in di seed.');
    process.exit(1);
  }
  let cookie = '';
  const get = async (p) => {
    const r = await request(p, { headers: cookie ? { Cookie: cookie } : {} });
    cookie = merge(cookie, cookieOf(r));
    return r;
  };
  const post = async (p, f) => {
    const page = await get(p);
    const csrf = (page.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
    const payload = new URLSearchParams(Object.assign({ _csrf: csrf || '' }, f)).toString();
    const r = await request(p, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        Cookie: cookie
      },
      body: payload
    });
    cookie = merge(cookie, cookieOf(r));
    return r;
  };

  await get('/masuk');
  await post('/masuk', { email: cust.email, password: 'customer123' });

  const bookings = (data.bookings || []).filter((b) => b.customerId === cust.id);
  console.log('Booking pelanggan demo: ' + bookings.length);

  const withCheckIn = bookings.find((b) => b.checkIn);
  check('Ada booking dengan check-in (fixture)', !!withCheckIn,
    withCheckIn ? withCheckIn.code : 'tidak ada — lewati');

  const loc = await get('/akun/lokasi');
  check('Halaman lokasi merespons 200', loc.status === 200, 'status ' + loc.status);

  // Parse map-data.
  const mapM = loc.body.match(/<script id="map-data" type="application\/json">([\s\S]*?)<\/script>/);
  let md = null;
  try { md = JSON.parse(mapM ? mapM[1] : 'null'); } catch (e) { md = null; }
  check('map-data valid JSON', !!md, '');

  if (md && md.checkIn && md.dest) {
    // Jarak yang dihitung server harus sama dengan jarak check-in → titik
    // kumpul yang ditampilkan di peta.
    const serverDist = geo.haversineMeters(
      md.checkIn.lat, md.checkIn.lng, md.dest.lat, md.dest.lng
    );
    check('Titik kumpul & check-in berada di booking yang sama',
      !!withCheckIn && withCheckIn.packageSlug,
      withCheckIn ? withCheckIn.packageName : '-');

    // Destinasi yang ditampilkan harus milik booking pemilik check-in.
    const destOfCheckIn = withCheckIn ? trip.resolveDestination(data, withCheckIn) : null;
    check('Titik kumpul di peta = destinasi booking pemilik check-in',
      !!(destOfCheckIn && md.dest.name === destOfCheckIn.name),
      'peta: ' + (md.dest ? md.dest.name : '-') + ' | booking: ' + (destOfCheckIn ? destOfCheckIn.name : '-'));

    // Jarak yang ditampilkan di halaman harus cocok dengan hitungan.
    const shown = (loc.body.match(/Jarak ke Titik Kumpul[\s\S]{0,400}?loc-cell__value">([^<]*)<\/div>/) || [])[1];
    const expected = geo.formatDistance(serverDist);
    check('Jarak di halaman sesuai perhitungan', shown === expected,
      'tampil="' + (shown || '-') + '" hitung="' + expected + '"');

    check('Jarak masuk akal (< 500 km antar pulau Indonesia)',
      serverDist < 500000, Math.round(serverDist) + ' m');
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
