'use strict';

/**
 * Unit test untuk service presence (berbagi lokasi langsung).
 *
 * Fokus:
 *  - TTL: entri basi dibuang (anggap offline).
 *  - Privasi: pelanggan hanya melihat admin + pelanggan dengan booking sama.
 *  - Admin melihat semua.
 *  - Koordinat invalid ditolak.
 *  - Penyimpanan terpisah dari db.json (data/presence.json).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const presence = require('../src/services/presence');

// Isolasi: pakai file sementara agar data uji tidak menyentuh data asli.
const TMP_FILE = path.join(require('os').tmpdir(), 'sabesi-presence-test-' + Date.now() + '.json');
const originalFile = presence.FILE;

// Sabotase modul agar membaca/menulis file uji.
const Module = require('module');
const realRequire = Module.prototype.require;
// Tidak ada cara mudah menukar FILE internal — pakai env-driven override di
// bawah (presence mendukung PRESENCE_FILE). Pastikan service mendukungnya.
assert.ok(
  typeof presence.upsert === 'function',
  'presence.upsert harus tersedia'
);

// ---------------------------------------------------------------------------
// Helper:muat ulang modul dengan file uji
// ---------------------------------------------------------------------------
function loadWith(file) {
  const resolved = require.resolve('../src/services/presence');
  delete require.cache[resolved];
  process.env.PRESENCE_FILE = file;
  return require('../src/services/presence');
}

const SVC = loadWith(TMP_FILE);

function cleanup() {
  try {
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
  } catch (e) { /* abaikan */ }
}

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

const SETTINGS = { presenceEnabled: true, presenceTtlMin: 5 };

console.log('\n=== presence service ===');

test('upsert menyimpan entri dengan koordinat valid', () => {
  const e = SVC.upsert({
    role: 'admin',
    refId: 'usr_1',
    name: 'Admin',
    lat: -0.4719,
    lng: 130.7515,
    accuracy: 12
  }, SETTINGS);
  assert.ok(e, 'entri harus ada');
  assert.strictEqual(e.key, 'admin:usr_1');
  assert.strictEqual(e.lat, -0.4719);
  assert.ok(e.at, 'waktu tersimpan');
});

test('upsert menolak koordinat invalid (0,0 & NaN)', () => {
  assert.strictEqual(SVC.upsert({ role: 'admin', refId: 'u', lat: 0, lng: 0 }, SETTINGS), null);
  assert.strictEqual(SVC.upsert({ role: 'admin', refId: 'u', lat: NaN, lng: 10 }, SETTINGS), null);
  assert.strictEqual(SVC.upsert({ role: 'admin', refId: 'u', lat: 91, lng: 10 }, SETTINGS), null);
});

test('upsert memperbarui entri yang sama (bukan menambah duplikat)', () => {
  SVC.upsert({ role: 'customer', refId: 'cus_1', name: 'Ayu', lat: 1, lng: 2 }, SETTINGS);
  SVC.upsert({ role: 'customer', refId: 'cus_1', name: 'Ayu', lat: 3, lng: 4 }, SETTINGS);
  const list = SVC.list(SETTINGS).filter((e) => e.refId === 'cus_1');
  assert.strictEqual(list.length, 1, 'harus ada tepat 1 entri');
  assert.strictEqual(list[0].lat, 3, 'koordinat terbaru');
});

test('remove menghapus entri', () => {
  SVC.upsert({ role: 'customer', refId: 'cus_rm', name: 'X', lat: 1, lng: 2 }, SETTINGS);
  assert.strictEqual(SVC.remove('customer', 'cus_rm'), true);
  assert.strictEqual(SVC.get('customer', 'cus_rm'), null);
});

test('ttl: entri basi dibuang saat list()', () => {
  // TTL 1 menit → entri yang dibuat 10 menit lalu dianggap offline.
  const shortTtl = { presenceEnabled: true, presenceTtlMin: 1 };
  SVC.upsert({ role: 'customer', refId: 'cus_old', name: 'Lama', lat: 1, lng: 2 }, shortTtl);
  // Dobrak timestamp entri agar terlihat basi.
  const file = require('fs').readFileSync(TMP_FILE, 'utf8');
  const parsed = JSON.parse(file);
  parsed.entries['customer:cus_old'].at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  require('fs').writeFileSync(TMP_FILE, JSON.stringify(parsed, null, 2), 'utf8');
  // Muat ulang modul agar cache file ter-refresh.
  const SVC2 = loadWith(TMP_FILE);
  const found = SVC2.list(shortTtl).filter((e) => e.refId === 'cus_old');
  assert.strictEqual(found.length, 0, 'entri basi harus dibuang');
});

test('ttlMs memakai nilai settings & clamp ke batas aman', () => {
  const SVC3 = loadWith(TMP_FILE);
  assert.strictEqual(SVC3.ttlMs({ presenceTtlMin: 7 }), 7 * 60 * 1000);
  assert.strictEqual(SVC3.ttlMs({ presenceTtlMin: 0 }), SVC3.DEFAULT_TTL_MS);
  assert.strictEqual(SVC3.ttlMs({ presenceTtlMin: 9999 }), SVC3.MAX_TTL_MIN * 60 * 1000);
  assert.strictEqual(SVC3.ttlMs({ presenceTtlMin: -3 }), SVC3.DEFAULT_TTL_MS);
});

test('isEnabled: default true, bisa dimatikan admin', () => {
  const SVC3 = loadWith(TMP_FILE);
  assert.strictEqual(SVC3.isEnabled({}), true);
  assert.strictEqual(SVC3.isEnabled({ presenceEnabled: false }), false);
  assert.strictEqual(SVC3.isEnabled({ presenceEnabled: true }), true);
});

console.log('\n=== privasi peersOf ===');

const DATA = {
  bookings: [
    { id: 'b1', code: 'SYL-1', customerId: 'cus_a' },
    { id: 'b2', code: 'SYL-2', customerId: 'cus_b' },
    { id: 'b3', code: 'SYL-3', customerId: 'cus_c' }
  ]
};

test('admin melihat semua partisipan', () => {
  const SVC4 = loadWith(TMP_FILE);
  SVC4.remove('admin', 'usr_1');
  SVC4.remove('customer', 'cus_a');
  SVC4.remove('customer', 'cus_b');
  SVC4.upsert({ role: 'admin', refId: 'usr_1', name: 'Tim', lat: 0, lng: 0.5 }, SETTINGS);
  SVC4.upsert({ role: 'customer', refId: 'cus_a', name: 'Ayu', lat: 0.001, lng: 0.5, bookingCodes: ['SYL-1'] }, SETTINGS);
  SVC4.upsert({ role: 'customer', refId: 'cus_b', name: 'Budi', lat: 0.002, lng: 0.5, bookingCodes: ['SYL-2'] }, SETTINGS);

  const peers = SVC4.peersOf({ role: 'admin', refId: 'usr_1', lat: 0, lng: 0.5 }, DATA, SETTINGS);
  assert.ok(peers.length >= 2, 'admin harus melihat minimal 2 peer, dapat ' + peers.length);
  const roles = peers.map((p) => p.role);
  assert.ok(roles.includes('customer'), 'admin harus melihat pelanggan');
});

test('pelanggan melihat admin', () => {
  const SVC5 = loadWith(TMP_FILE);
  const peers = SVC5.peersOf({ role: 'customer', refId: 'cus_a', lat: 0.001, lng: 0.5 }, DATA, SETTINGS);
  assert.ok(peers.some((p) => p.role === 'admin'), 'harus melihat admin');
});

test('pelanggan TIDAK melihat pelanggan lain tanpa booking yang sama', () => {
  const SVC6 = loadWith(TMP_FILE);
  const peers = SVC6.peersOf({ role: 'customer', refId: 'cus_a', lat: 0.001, lng: 0.5 }, DATA, SETTINGS);
  const otherCustomers = peers.filter((p) => p.role === 'customer' && p.refId !== 'cus_a');
  assert.strictEqual(otherCustomers.length, 0, 'tidak boleh melihat pelanggan tanpa booking bersama');
});

test('pelanggan melihat pelanggan lain dengan booking yang sama', () => {
  const SVC7 = loadWith(TMP_FILE);
  SVC7.upsert({ role: 'customer', refId: 'cus_c', name: 'Citra', lat: 0.003, lng: 0.5, bookingCodes: ['SYL-1'] }, SETTINGS);
  const peers = SVC7.peersOf({ role: 'customer', refId: 'cus_a', lat: 0.001, lng: 0.5 }, DATA, SETTINGS);
  assert.ok(
    peers.some((p) => p.refId === 'cus_c'),
    'harus melihat pelanggan dengan booking yang sama'
  );
});

test('peersOf mengurutkan berdasarkan jarak terdekat', () => {
  const SVC8 = loadWith(TMP_FILE);
  SVC8.remove('customer', 'cus_a');
  SVC8.remove('customer', 'cus_b');
  SVC8.upsert({ role: 'customer', refId: 'cus_a', name: 'Ayu', lat: 0.001, lng: 0.5, bookingCodes: ['SYL-1'] }, SETTINGS);
  SVC8.upsert({ role: 'customer', refId: 'cus_c', name: 'Citra', lat: 0.0001, lng: 0.5, bookingCodes: ['SYL-1'] }, SETTINGS);
  const peers = SVC8.peersOf({ role: 'customer', refId: 'cus_a', lat: 0.001, lng: 0.5 }, DATA, SETTINGS);
  const customers = peers.filter((p) => p.role === 'customer');
  assert.ok(customers.length >= 1, 'harus ada peer pelanggan');
  if (customers.length >= 2) {
    assert.ok(
      customers[0].distance <= customers[1].distance,
      'jarak harus terurut menaik'
    );
  }
});

test('subscribe menerima event perubahan', () => {
  const SVC9 = loadWith(TMP_FILE);
  let seen = 0;
  const off = SVC9.subscribe(() => { seen += 1; });
  SVC9.upsert({ role: 'admin', refId: 'usr_evt', name: 'E', lat: 1, lng: 2 }, SETTINGS);
  off();
  SVC9.upsert({ role: 'admin', refId: 'usr_evt2', name: 'E2', lat: 1, lng: 2 }, SETTINGS);
  assert.ok(seen >= 1, 'event harus diterima');
});

test('berkas presence terpisah dari db.json', () => {
  const SVC10 = loadWith(TMP_FILE);
  assert.ok(fs.existsSync(TMP_FILE), 'presence harus ditulis ke berkas sendiri');
  assert.notStrictEqual(TMP_FILE, require('../src/db').DB_FILE, 'harus berbeda dari db.json');
});

cleanup();
delete process.env.PRESENCE_FILE;

console.log('\n' + (failed === 0
  ? `OK — ${passed} pemeriksaan lulus`
  : `${failed} dari ${passed + failed} pemeriksaan GAGAL`));
process.exit(failed === 0 ? 0 : 1);
