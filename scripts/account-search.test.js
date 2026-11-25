'use strict';

/**
 * Uji privasi pencarian peserta & roster rombongan.
 *
 * Fokus: pelanggan hanya boleh melihat fellow traveler yang memang boleh
 * dia lihat (booking sama atau group sama). Pelanggan lain harus tersembunyi.
 *
 * Jalankan: node scripts/account-search.test.js
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
    { id: 'grp_a', name: 'Rombongan A', bookingCodes: ['SYL-1', 'SYL-2'], meetingPoint: null, radiusM: 5000 }
  ],
  bookings: [
    { id: 'b1', code: 'SYL-1', name: 'Budi', customerId: 'c1', phone: '0811', packageName: 'P', departureDate: '2026-11-12' },
    { id: 'b2', code: 'SYL-2', name: 'Sari', customerId: 'c2', phone: '0822', packageName: 'P', departureDate: '2026-11-12' },
    { id: 'b3', code: 'SYL-9', name: 'Rahasia', customerId: 'c9', phone: '0899', packageName: 'Q', departureDate: '2026-11-12' }
  ],
  customers: [
    { id: 'c1', name: 'Budi', email: 'budi@x.com', phone: '0811' },
    { id: 'c2', name: 'Sari', email: 'sari@x.com', phone: '0822' },
    { id: 'c9', name: 'Rahasia', email: 'r@x.com', phone: '0899' }
  ]
};

console.log('\n== Privasi roster ==');

t('roster group hanya berisi anggota group', () => {
  const g = roster.groupOf(DATA, 'grp_a');
  const r = roster.rosterOf(DATA, g);
  const names = r.map((x) => x.name);
  assert.ok(names.includes('Budi'));
  assert.ok(names.includes('Sari'));
  assert.ok(!names.includes('Rahasia'), 'bukan anggota group tidak boleh masuk');
});

t('groupsForCustomer tidak membocorkan group orang lain', () => {
  const gs = roster.groupsForCustomer(DATA, 'c9');
  assert.strictEqual(gs.length, 0, 'c9 bukan anggota group mana pun');
});

t('distanceToMeetingPoint null bila group tanpa titik kumpul', () => {
  const g = roster.groupOf(DATA, 'grp_a');
  const r = roster.rosterOf(DATA, g);
  const d = roster.distanceToMeetingPoint(g, r[0]);
  assert.strictEqual(d, null);
});

t('distanceToMeetingPoint null bila peserta tanpa koordinat', () => {
  const g = { id: 'g', meetingPoint: { lat: 1, lng: 2 }, bookingCodes: [] };
  assert.strictEqual(roster.distanceToMeetingPoint(g, { lat: null, lng: null }), null);
});

/* ------------------------------------------------------------------ */
/* Halaman & route baru (Task 15)                                     */
/* ------------------------------------------------------------------ */

console.log('\n== Route pencarian peserta & rombongan ==');

const db = require(path.join(root, 'src', 'db'));
const presence = require(path.join(root, 'src', 'services', 'presence'));
const accountRouter = require(path.join(root, 'src', 'routes', 'account.routes'));

/**
 * Cari handler terakhir sebuah route pada router Express.
 * @param {object} router router Express
 * @param {string} routePath path route (mis. '/akun/cari')
 * @returns {function|null} handler atau null bila route tidak ada
 */
function handlerOf(router, routePath) {
  const layers = router.stack || [];
  for (const layer of layers) {
    if (!layer.route) continue;
    if (layer.route.path !== routePath) continue;
    const stack = layer.route.stack || [];
    if (!stack.length) return null;
    return stack[stack.length - 1].handle;
  }
  return null;
}

/** Pasangan req/res tiruan untuk memanggil handler route tanpa HTTP. */
function fakeReq(query, params, customer) {
  return {
    query: query || {},
    params: params || {},
    customer: customer,
    session: { customerId: customer ? customer.id : null },
    originalUrl: '/akun'
  };
}

/** Objek res tiruan yang menangkap hasil render. */
function fakeRes() {
  const out = { rendered: null, locals: {} };
  out.render = function (view, locals) {
    out.rendered = { view: view, locals: locals };
    return out;
  };
  out.redirect = function (url) {
    out.redirected = url;
    return out;
  };
  return out;
}

t('route GET /akun/cari terdaftar', () => {
  assert.ok(handlerOf(accountRouter, '/akun/cari'), 'route /akun/cari tidak ditemukan');
});

t('route GET /akun/rombongan/:id terdaftar', () => {
  assert.ok(
    handlerOf(accountRouter, '/akun/rombongan/:id'),
    'route /akun/rombongan/:id tidak ditemukan'
  );
});

t('pencarian peserta tidak membocorkan pelanggan lain', () => {
  const handler = handlerOf(accountRouter, '/akun/cari');
  assert.ok(handler, 'route /akun/cari tidak ditemukan');

  // Ganti sumber data dengan data uji (TIDAK menyentuh data produksi).
  const asliRead = db.read;
  const asliSeen = presence.lastSeenAll;
  db.read = () => JSON.parse(JSON.stringify(DATA));
  presence.lastSeenAll = () => [];
  try {
    const res = fakeRes();
    handler(fakeReq({}, {}, DATA.customers[0]), res, () => {});
    assert.ok(res.rendered, 'handler tidak merender halaman');
    const hasil = res.rendered.locals.results || [];
    const nama = hasil.map((r) => r.name);
    assert.ok(nama.includes('Budi'), 'pemesan sendiri harus terlihat');
    assert.ok(nama.includes('Sari'), 'fellow traveler satu group harus terlihat');
    assert.ok(!nama.includes('Rahasia'), 'pelanggan lain tidak boleh bocor');
  } finally {
    db.read = asliRead;
    presence.lastSeenAll = asliSeen;
  }
});

t('pencarian peserta menyaring bila kode booking di luar hak', () => {
  const handler = handlerOf(accountRouter, '/akun/cari');
  assert.ok(handler, 'route /akun/cari tidak ditemukan');

  const asliRead = db.read;
  const asliSeen = presence.lastSeenAll;
  db.read = () => JSON.parse(JSON.stringify(DATA));
  presence.lastSeenAll = () => [];
  try {
    const res = fakeRes();
    handler(fakeReq({ booking: 'SYL-9' }, {}, DATA.customers[0]), res, () => {});
    assert.ok(res.rendered, 'handler tidak merender halaman');
    const hasil = res.rendered.locals.results || [];
    assert.strictEqual(hasil.length, 0, 'kode booking orang lain harus disembunyikan');
  } finally {
    db.read = asliRead;
    presence.lastSeenAll = asliSeen;
  }
});

t('halaman rombongan menolak pelanggan di luar group', () => {
  const handler = handlerOf(accountRouter, '/akun/rombongan/:id');
  assert.ok(handler, 'route /akun/rombongan/:id tidak ditemukan');

  const asliRead = db.read;
  const asliSeen = presence.lastSeenAll;
  db.read = () => JSON.parse(JSON.stringify(DATA));
  presence.lastSeenAll = () => [];
  try {
    // c9 bukan anggota group mana pun → harus(next), bukan render.
    const res = fakeRes();
    let nextDipanggil = false;
    handler(fakeReq({}, { id: 'grp_a' }, DATA.customers[2]), res, () => {
      nextDipanggil = true;
    });
    assert.ok(nextDipanggil, 'pelanggan luar group harus ditolak');
    assert.ok(!res.rendered, 'halaman rombongan tidak boleh dirender untuk pelanggan luar');

    // c1 anggota group → boleh melihat roster.
    const res2 = fakeRes();
    handler(fakeReq({}, { id: 'grp_a' }, DATA.customers[0]), res2, () => {});
    assert.ok(res2.rendered, 'anggota group harus dapat membuka halaman');
    const members = res2.rendered.locals.members || [];
    const nama = members.map((m) => m.name);
    assert.ok(nama.includes('Sari'), 'roster harus memuat fellow traveler');
    assert.ok(!nama.includes('Rahasia'), 'roster tidak boleh memuat pelanggan luar');
  } finally {
    db.read = asliRead;
    presence.lastSeenAll = asliSeen;
  }
});

console.log('\n== Helper peta di template ==');

t('middleware context mengekspos helper geo', () => {
  const context = require(path.join(root, 'src', 'middleware', 'context')).context;
  const req = { session: {}, path: '/', query: {}, get: () => 'localhost' };
  const res = { locals: {} };
  context(req, res, () => {});
  assert.strictEqual(typeof res.locals.mapsUrl, 'function', 'res.locals.mapsUrl belum ada');
  assert.strictEqual(typeof res.locals.mapsDirUrl, 'function', 'res.locals.mapsDirUrl belum ada');
  assert.strictEqual(typeof res.locals.formatAge, 'function', 'res.locals.formatAge belum ada');
});

console.log('\n' + (fail === 0
  ? 'OK - ' + pass + ' pemeriksaan lulus'
  : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
process.exit(fail === 0 ? 0 : 1);
