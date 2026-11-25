/**
 * Uji pengiriman pengingat (reminder) dengan transport tiruan.
 * Memverifikasi: pesan terkirim ke nomor yang tepat, opt-out dilewati,
 * dedupe mencegah pengiriman ulang, dan jam tenang menghambat.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));
const wa = require(path.join(root, 'src', 'services', 'wa'));
const reminder = require(path.join(root, 'src', 'services', 'wa-reminder'));
const { mockGateway, setReady } = require(path.join(__dirname, 'wa-mock-gateway'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

// Basis data uji sudah terpisah (lihat `test-db`) — `data/db.json`
// produksi tidak pernah disentuh, jadi tidak ada backup yang perlu disimpan.
const now = Date.now();
const day = 86400000;

db.reset({
  users: [], destinations: [], articles: [], reviews: [], customers: [], messages: [],
  packages: [{ slug: 'p1', title: 'Paket Sabesi', summary: 'Raja Ampat 3 hari,|Price 1.8jt' }],
  broadcasts: [], waReminders: [],
  bookings: [
    {
      id: 'b1', code: 'JJE-001', name: 'Budi', phone: '628111111111',
      packageSlug: 'p1', packageName: 'Paket Sabesi',
      departureDate: new Date(now + 3 * day).toISOString().slice(0, 10),
      status: 'confirmed', paymentStatus: 'paid', createdAt: new Date(now - 2 * day).toISOString()
    },
    {
      id: 'b2', code: 'JJE-002', name: 'Sari', phone: '628222222222',
      packageSlug: 'p1', packageName: 'Paket Sabesi',
      departureDate: new Date(now + 10 * day).toISOString().slice(0, 10),
      status: 'pending', paymentStatus: 'unpaid', createdAt: new Date(now - 2 * day).toISOString()
    },
    {
      id: 'b3', code: 'JJE-003', name: 'OptOut', phone: '628333333333',
      packageSlug: 'p1', packageName: 'Paket Sabesi',
      departureDate: new Date(now + 10 * day).toISOString().slice(0, 10),
      status: 'pending', paymentStatus: 'unpaid', createdAt: new Date(now - 2 * day).toISOString()
    }
  ],
  contacts: [
    { id: 'c1', name: 'Budi', phone: '628111111111', optIn: true, optOut: false, waNotify: true },
    { id: 'c2', name: 'Sari', phone: '628222222222', optIn: true, optOut: false, waNotify: true },
    { id: 'c3', name: 'OptOut', phone: '628333333333', optIn: true, optOut: true, waNotify: true }
  ],
  settings: {
    waQuietStart: 0, waQuietEnd: 0, waReminderTemplates: {},
    paymentAccount: '1234567890', paymentAccountName: 'PT JJE'
  },
  version: 1
});

(async () => {
  const sent = mockGateway();

  console.log('\n== Menjalankan pengingat ==');
  // Waktu acuan tetap: jam 10 berada di luar jendela jam tenang (0-0 = nonaktif).
  const JAM_10 = new Date(2026, 0, 1, 10, 30, 0);
  const JAM_23 = new Date(2026, 0, 1, 23, 30, 0);
  const res = await reminder.runReminders(JAM_10);
  t('tidak ada error fatal', () => {
    assert.ok(!res.error, res.error);
  });
  t('pengingat terkirim kepelanggan yang berhak', () => {
    assert.ok(res.sent > 0, 'tidak ada yang terkirim');
    assert.ok(sent.length > 0);
  });
  t('kontak opted-out tidak dikirimi pesan', () => {
    assert.ok(!sent.some((s) => s.chatId === '628333333333'));
  });
  t('isi pesan berisi data booking yang benar', () => {
    const combined = sent.map((s) => s.text).join('\n');
    assert.ok(combined.includes('JJE-001') || combined.includes('JJE-002'));
    assert.ok(combined.includes('Paket Sabesi'));
    const bad = sent.find((s) => s.text.includes('{{'));
    if (bad) console.log('    DEBUG teks:', JSON.stringify(bad.text));
    assert.ok(!bad, 'placeholder belum ter-render');
  });
  t('riwayat dedupe tercatat', () => {
    const d = db.read();
    assert.ok((d.waReminders || []).length > 0);
    assert.ok(d.waReminders.every((r) => r.key && r.sentAt));
  });

  console.log('\n== Tidak ada duplikat pada putaran kedua ==');
  const sentBefore = sent.length;
  const res2 = await reminder.runReminders(JAM_10);
  t('pengingat yang sama tidak terkirim ulang', () => {
    assert.strictEqual(sent.length, sentBefore, 'ada pesan yang terkirim ulang');
    assert.strictEqual(res2.sent, 0);
  });
  t('pengingat pembayaran harian tetap ada (kunci per hari)', () => {
    // Siapkan pengingat pembayaran untuk besok agar tidak terkirim hari ini.
    const due = reminder.collectDueReminders(db.read());
    const pay = due.find((x) => x.rule === 'payment_due');
    assert.ok(pay, 'tidak ada pengingat pembayaran tersisa');
  });

  console.log('\n== Jam tenang menghambat pengiriman ==');
  sent.length = 0;
  const d2 = db.read();
  d2.settings.waQuietStart = 22;
  d2.settings.waQuietEnd = 1; // melewati tengah malam
  d2.waReminders = [];
  db.write();
  const res3 = await reminder.runReminders(JAM_23);
  t('tidak ada pesan terkirim saat jam tenang', () => {
    assert.strictEqual(sent.length, 0);
    assert.ok(res3.error && res3.error.includes('Jam tenang'));
  });

  console.log('\n== Perangkat belum terhubung ==');
  sent.length = 0;
  const d3 = db.read();
  d3.settings.waQuietStart = 0;
  d3.settings.waQuietEnd = 0;
  db.write();
  setReady(false);
  const res4 = await reminder.runReminders(JAM_10);
  t('pengingat ditolak bila WhatsApp belum terhubung', () => {
    assert.ok(res4.error && res4.error.includes('belum terhubung'));
    assert.strictEqual(sent.length, 0);
  });


  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
