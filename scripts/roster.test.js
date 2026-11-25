'use strict';

/**
 * Uji model data rombongan (trip groups) & roster peserta.
 *
 * Jalankan: node scripts/roster.test.js
 */

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const roster = require(path.join(root, 'src', 'services', 'roster'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + '  ->  ' + err.message);
  }
}

const DATA = {
  tripGroups: [
    {
      id: 'grp_a',
      name: 'Rombongan A',
      bookingCodes: ['SYL-1', 'SYL-2'],
      meetingPoint: { label: 'Dermaga Waisai', lat: -0.4644, lng: 130.8924 },
      radiusM: 5000
    },
    {
      id: 'grp_b',
      name: 'Rombongan B',
      bookingCodes: ['SYL-3'],
      meetingPoint: null,
      radiusM: 5000
    }
  ],
  bookings: [
    { id: 'b1', code: 'SYL-1', name: 'Budi', email: 'budi@x.com', phone: '0811', customerId: 'c1', packageName: 'Paket A', departureDate: '2026-11-12', participants: 2 },
    { id: 'b2', code: 'SYL-2', name: 'Sari', email: 'sari@x.com', phone: '0822', customerId: 'c2', packageName: 'Paket A', departureDate: '2026-11-12', participants: 2 },
    { id: 'b3', code: 'SYL-3', name: 'Andi', email: 'andi@x.com', phone: '0833', customerId: 'c3', packageName: 'Paket B', departureDate: '2026-11-20', participants: 1 }
  ],
  customers: [
    { id: 'c1', name: 'Budi', email: 'budi@x.com', phone: '0811' },
    { id: 'c2', name: 'Sari', email: 'sari@x.com', phone: '0822' },
    { id: 'c3', name: 'Andi', email: 'andi@x.com', phone: '0833' }
  ]
};

console.log('\n== Model rombongan ==');

t('groupOf mengembalikan group berdasarkan id', () => {
  const g = roster.groupOf(DATA, 'grp_a');
  assert.ok(g);
  assert.strictEqual(g.name, 'Rombongan A');
  assert.strictEqual(roster.groupOf(DATA, 'tidak-ada'), null);
});

t('groupIdForBooking menemukan group dari kode booking', () => {
  assert.strictEqual(roster.groupIdForBooking(DATA, DATA.bookings[0]), 'grp_a');
  assert.strictEqual(roster.groupIdForBooking(DATA, DATA.bookings[2]), 'grp_b');
  assert.strictEqual(roster.groupIdForBooking(DATA, { code: 'SYL-X' }), null);
});

t('groupsForBooking mengembalikan semua group yang memuat booking', () => {
  const gs = roster.groupsForBooking(DATA, DATA.bookings[0]);
  assert.strictEqual(gs.length, 1);
  assert.strictEqual(gs[0].id, 'grp_a');
});

t('rosterOf mengembalikan peserta dari seluruh booking dalam group', () => {
  const g = roster.groupOf(DATA, 'grp_a');
  const r = roster.rosterOf(DATA, g);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map((x) => x.name).sort(), ['Budi', 'Sari']);
});

t('peserta roster membawa data kontak untuk emergencies', () => {
  const g = roster.groupOf(DATA, 'grp_a');
  const r = roster.rosterOf(DATA, g);
  const budi = r.find((x) => x.name === 'Budi');
  assert.strictEqual(budi.phone, '0811');
  assert.strictEqual(budi.bookingCode, 'SYL-1');
  assert.ok('email' in budi);
});

t('groupsForCustomer menemukan group yang diikuti pelanggan', () => {
  const gs = roster.groupsForCustomer(DATA, 'c1');
  assert.strictEqual(gs.length, 1);
  assert.strictEqual(gs[0].id, 'grp_a');
});

t('group tanpa titik kumpul tetap punya radius default', () => {
  const g = roster.groupOf(DATA, 'grp_b');
  assert.strictEqual(g.meetingPoint, null);
  assert.ok(roster.radiusM(g) >= 5000);
});

t('roster tanpa group menghasilkan array kosong, bukan error', () => {
  assert.deepStrictEqual(roster.rosterOf(DATA, null), []);
});

console.log('\n' + (fail === 0
  ? 'OK - ' + pass + ' pemeriksaan lulus'
  : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
process.exit(fail === 0 ? 0 : 1);
