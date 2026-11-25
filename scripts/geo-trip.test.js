'use strict';

/**
 * Unit test untuk service geo & trip.
 *
 * Fokus pada regresi bug "peta kosong": booking.packageSlug adalah slug
 * PAKET, sedangkan koordinat ada di destinations yang dirujuk paket
 * lewat destinationSlug. Resolusi yang salah membuat peta selalu kosong.
 */

const assert = require('assert');
const geo = require('../src/services/geo');
const trip = require('../src/services/trip');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL  ' + name + '  →  ' + err.message);
  }
}

console.log('\n=== geo ===');

test('isValidLatLng menerima koordinat valid', () => {
  assert.strictEqual(geo.isValidLatLng(-0.4719, 130.7515), true);
  assert.strictEqual(geo.isValidLatLng(5.5483, 95.3238), true);
});

test('isValidLatLng menolak (0,0) dan nilai di luar rentang', () => {
  assert.strictEqual(geo.isValidLatLng(0, 0), false);
  assert.strictEqual(geo.isValidLatLng(91, 0), false);
  assert.strictEqual(geo.isValidLatLng(0, 181), false);
  assert.strictEqual(geo.isValidLatLng(NaN, 10), false);
  assert.strictEqual(geo.isValidLatLng(undefined, undefined), false);
});

test('haversine jarak nol untuk titik identik', () => {
  const d = geo.haversineMeters(-0.4719, 130.7515, -0.4719, 130.7515);
  assert.ok(Math.abs(d) < 0.001, 'd=' + d);
});

test('haversine 0,09 derajat lintang ~ 10.008 km', () => {
  const d = geo.haversineMeters(-0.4719, 130.7515, -0.5619, 130.7515);
  assert.ok(Math.abs(d - 10008) < 200, 'd=' + d);
});

test('haversine NaN bila titik tidak valid', () => {
  assert.ok(Number.isNaN(geo.haversineMeters(0, 0, 1, 1)));
  assert.ok(Number.isNaN(geo.haversineMeters(1, 1, 0, 0)));
});

test('formatDistance memakai meter di bawah 1 km', () => {
  assert.strictEqual(geo.formatDistance(820), '820 m');
  assert.strictEqual(geo.formatDistance(0), '0 m');
});

test('formatDistance memakai km di atas 1 km', () => {
  assert.strictEqual(geo.formatDistance(12400), '12,4 km');
  assert.strictEqual(geo.formatDistance(120000), '120 km');
});

test('formatDistanceShort membulatkan km', () => {
  assert.strictEqual(geo.formatDistanceShort(820), '820 m');
  assert.strictEqual(geo.formatDistanceShort(12400), '12 km');
});

console.log('\n=== trip ===');

// Fixture: struktur data meniru data/db.json.
const DATA = {
  destinations: [
    { id: 'dst_1', slug: 'pulau-sabesi', name: 'Pulau Sabesi', lat: -0.4719, lng: 130.7515 },
    { id: 'dst_2', slug: 'pulau-weh', name: 'Pulau Weh', lat: 5.5483, lng: 95.3238 }
  ],
  packages: [
    { id: 'pkg_1', slug: 'sabesi-island-escape', title: 'Sabesi Island Escape', destinationSlug: 'pulau-sabesi' },
    { id: 'pkg_2', slug: 'weh-sunset-escape', title: 'Weh Sunset Escape', destinationSlug: 'pulau-weh' }
  ]
};

test('resolveDestination: packageSlug → paket → destinationSlug → destinations', () => {
  const booking = { packageSlug: 'sabesi-island-escape' };
  const dest = trip.resolveDestination(DATA, booking);
  assert.ok(dest, 'destinasi harus ditemukan');
  assert.strictEqual(dest.slug, 'pulau-sabesi');
  assert.strictEqual(dest.lat, -0.4719);
});

test('resolveDestination: booking tanpa packageSlug → null', () => {
  assert.strictEqual(trip.resolveDestination(DATA, { packageSlug: 'tidak-ada' }), null);
});

test('resolveDestination: booking dengan destinationSlug langsung', () => {
  const dest = trip.resolveDestination(DATA, { destinationSlug: 'pulau-weh' });
  assert.ok(dest);
  assert.strictEqual(dest.slug, 'pulau-weh');
});

test('resolveDestination: fallback ke destinationName', () => {
  const dest = trip.resolveDestination(DATA, { packageSlug: 'x', destinationName: 'Pulau Weh' });
  assert.ok(dest);
  assert.strictEqual(dest.slug, 'pulau-weh');
});

test('distanceToDestination memakai destinasi yang benar', () => {
  const booking = { checkIn: { lat: -0.4719, lng: 130.7515 } };
  const dest = trip.resolveDestination(DATA, { packageSlug: 'sabesi-island-escape' });
  const d = trip.distanceToDestination(booking, dest);
  assert.ok(Math.abs(d) < 0.001, 'd=' + d);
});

test('distanceToDestination null bila tidak ada check-in', () => {
  const dest = trip.resolveDestination(DATA, { packageSlug: 'sabesi-island-escape' });
  assert.strictEqual(trip.distanceToDestination({}, dest), null);
  assert.strictEqual(trip.distanceToDestination({ checkIn: { lat: 1, lng: 1 } }, null), null);
});

test('progressSteps menandai pembayaran selesai saat paid', () => {
  const steps = trip.progressSteps({ status: 'confirmed', paymentStatus: 'paid', checkIn: null });
  const paid = steps.find((s) => s.key === 'paid');
  assert.strictEqual(paid.done, true);
  const created = steps.find((s) => s.key === 'created');
  assert.strictEqual(created.done, true);
});

test('progressSteps menandai check-in selesai bila ada checkIn', () => {
  const steps = trip.progressSteps({
    status: 'confirmed',
    paymentStatus: 'paid',
    checkIn: { lat: 1, lng: 2 }
  });
  const ci = steps.find((s) => s.key === 'checkin');
  assert.strictEqual(ci.done, true);
});

test('progressSteps menandai booking cancelled', () => {
  const steps = trip.progressSteps({ status: 'cancelled', paymentStatus: 'unpaid' });
  assert.ok(steps.every((s) => !s.done && !s.active));
  assert.ok(steps.every((s) => s.cancelled === true));
});

test('dashboardSummary menghitung total, upcoming, completed, unpaid', () => {
  const today = new Date().toISOString().slice(0, 10);
  const next = new Date();
  next.setDate(next.getDate() + 10);
  const bookings = [
    { departureDate: next.toISOString().slice(0, 10), status: 'confirmed', paymentStatus: 'paid', totalAmount: 1000 },
    { departureDate: '2020-01-01', status: 'completed', paymentStatus: 'paid', totalAmount: 2000 },
    { departureDate: '2020-01-01', status: 'pending', paymentStatus: 'unpaid', totalAmount: 3000 }
  ];
  const s = trip.dashboardSummary(bookings, []);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.upcoming, 1);
  assert.strictEqual(s.completed, 1);
  assert.strictEqual(s.unpaid, 1);
  assert.strictEqual(s.totalPaid, 3000);
  assert.ok(s.nextDeparture, 'nextDeparture harus terisi');
  assert.strictEqual(today.length, 10);
});

console.log('\n' + passed + ' lulus, ' + failed + ' gagal.');
process.exit(failed === 0 ? 0 : 1);
