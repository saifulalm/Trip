/**
 * Uji fungsional logika WhatsApp (tanpa koneksi ke WhatsApp sungguhan).
 * Menguji: normalisasi nomor, targeting segmen, opt-in/opt-out, jam tenang,
 * render template, pembuatan job blast, dedupe pengingat.
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
const worker = require(path.join(root, 'src', 'services', 'wa-worker'));

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

// Backup db.json lalu pakai data uji.
// Basis data uji sudah terpisah (lihat `test-db`) — `data/db.json`
// produksi tidak pernah disentuh, jadi tidak ada backup yang perlu disimpan.

const now = Date.now();
const day = 86400000;
const data = {
  users: [],
  destinations: [],
  packages: [{ slug: 'p1', title: 'Paket Sabesi', summary: 'Raja Ampat 3 hari' }],
  articles: [],
  bookings: [
    {
      id: 'b1', code: 'JJE-001', name: 'Budi', phone: '081234560001', email: 'b@x.com',
      packageSlug: 'p1', packageName: 'Paket Sabesi', departureDate: '2026-12-01',
      status: 'pending', paymentStatus: 'unpaid', createdAt: new Date(now - 2 * day).toISOString()
    },
    {
      id: 'b2', code: 'JJE-002', name: 'Sari', phone: '628234560002', email: 's@x.com',
      packageSlug: 'p1', packageName: 'Paket Sabesi',
      // Berangkat 3 hari dari sekarang (dihitung relatif agar stabil).
      departureDate: new Date(now + 3 * day).toISOString().slice(0, 10),
      status: 'confirmed', paymentStatus: 'paid', createdAt: new Date(now - 5 * day).toISOString()
    }
  ],
  messages: [{ id: 'm1', name: 'Lead', phone: '628234560003', subject: 's', message: 'm' }],
  contacts: [
    { id: 'c1', name: 'Budi', phone: '081234560001', source: 'booking', optIn: true, optOut: false, waNotify: true },
    { id: 'c2', name: 'Sari', phone: '628234560002', source: 'booking', optIn: true, optOut: false, waNotify: true },
    { id: 'c3', name: 'Lead', phone: '628234560003', source: 'kontak', optIn: true, optOut: false, waNotify: true },
    { id: 'c4', name: 'OptOut', phone: '628234560004', source: 'manual', optIn: true, optOut: true, waNotify: true },
    { id: 'c5', name: 'NoOptIn', phone: '628234560005', source: 'manual', optIn: false, optOut: false, waNotify: true },
    { id: 'c6', name: 'BadPhone', phone: '123', source: 'manual', optIn: true, optOut: false }
  ],
  customers: [{ id: 'cu1', name: 'Budi', phone: '081234560001' }],
  reviews: [],
  broadcasts: [],
  waReminders: [],
  settings: {
    waQuietStart: 21, waQuietEnd: 8, waReminderTemplates: {},
    paymentAccount: '1234567890', paymentAccountName: 'PT JJE'
  },
  version: 1
};
db.reset(data);

console.log('\n== Normalisasi & validasi nomor ==');
t('normalizePhone 08xx -> 62xx', () => assert.strictEqual(wa.normalizePhone('081234567890'), '6281234567890'));
t('normalizePhone +62xx -> 62xx', () => assert.strictEqual(wa.normalizePhone('+6281234567890'), '6281234567890'));
t('normalizePhone 8xx -> 62xx', () => assert.strictEqual(wa.normalizePhone('81234567890'), '6281234567890'));
t('normalizePhone bersih dari spasi/dash', () => assert.strictEqual(wa.normalizePhone('0812-3456-7890'), '6281234567890'));
t('isValidPhone menolak nomor pendek', () => assert.strictEqual(wa.isValidPhone('123'), false));
t('isValidPhone menerima 62xx', () => assert.strictEqual(wa.isValidPhone('081234567890'), true));

console.log('\n== Targeting & opt-in/opt-out ==');
t('marketableContacts hanya opt-in & bukan opt-out & nomor valid', () => {
  const list = wa.marketableContacts(db.read());
  const phones = list.map((c) => wa.normalizePhone(c.phone)).sort();
  assert.deepStrictEqual(phones, ['6281234560001', '628234560002', '628234560003']);
});
t('segment all = semua marketable', () => {
  assert.strictEqual(wa.segmentTargets(db.read(), 'all').length, 3);
});
t('segment booking hanya yang pernah booking', () => {
  const l = wa.segmentTargets(db.read(), 'booking');
  assert.deepStrictEqual(l.map((c) => wa.normalizePhone(c.phone)).sort(), ['6281234560001', '628234560002']);
});
t('segment leads hanya lead kontak', () => {
  const l = wa.segmentTargets(db.read(), 'leads');
  assert.deepStrictEqual(l.map((c) => wa.normalizePhone(c.phone)), ['628234560003']);
});
t('segment customers hanya pelanggan akun', () => {
  const l = wa.segmentTargets(db.read(), 'customers');
  assert.deepStrictEqual(l.map((c) => wa.normalizePhone(c.phone)), ['6281234560001']);
});

console.log('\n== Jam tenang ==');
// Waktu acuan tetap supaya hasil uji tidak bergantung jam mesin.
// Catatan: jam "end" bersifat EKSKLUSIF — jendela 22-01 berarti 22.00-00.59.
const JAM_23 = new Date(2026, 0, 1, 23, 30, 0);
const JAM_00 = new Date(2026, 0, 1, 0, 30, 0);
const JAM_10 = new Date(2026, 0, 1, 10, 30, 0);
t('isQuietHour true di dalam jendela 22-01 pada jam 23', () => {
  assert.strictEqual(wa.isQuietHour({ waQuietStart: 22, waQuietEnd: 1 }, JAM_23), true);
});
t('isQuietHour true di dalam jendela 22-01 pada jam 00', () => {
  assert.strictEqual(wa.isQuietHour({ waQuietStart: 22, waQuietEnd: 1 }, JAM_00), true);
});
t('isQuietHour false di luar jendela 22-01 pada jam 10', () => {
  assert.strictEqual(wa.isQuietHour({ waQuietStart: 22, waQuietEnd: 1 }, JAM_10), false);
});
t('isQuietHour true di dalam jendela 21-08 pada jam 23', () => {
  assert.strictEqual(wa.isQuietHour({ waQuietStart: 21, waQuietEnd: 8 }, JAM_23), true);
});
t('isQuietHour false di luar jendela 21-08 pada jam 10', () => {
  assert.strictEqual(wa.isQuietHour({ waQuietStart: 21, waQuietEnd: 8 }, JAM_10), false);
});
t('isQuietHour false bila start == end (nonaktif)', () => {
  assert.strictEqual(wa.isQuietHour({ waQuietStart: 10, waQuietEnd: 10 }, JAM_10), false);
});
t('quietWindow fallback ke default 21-08', () => {
  assert.deepStrictEqual(wa.quietWindow({}), { start: 21, end: 8 });
});
t('quietWindow memakai bawaan untuk jam di luar rentang', () => {
  assert.deepStrictEqual(wa.quietWindow({ waQuietStart: -5, waQuietEnd: 99 }), { start: 21, end: 8 });
});
t('normalizeHour menerima jam valid dan menolak nilai aneh', () => {
  assert.strictEqual(wa.normalizeHour(0, 21), 0);
  assert.strictEqual(wa.normalizeHour(23, 8), 23);
  assert.strictEqual(wa.normalizeHour(99, 8), 8);
  assert.strictEqual(wa.normalizeHour('abc', 8), 8);
  assert.strictEqual(wa.normalizeHour(null, 8), 8);
});
t('quietLabel format 21.00-08.00', () => {
  assert.strictEqual(wa.quietLabel({ waQuietStart: 21, waQuietEnd: 8 }), '21.00–08.00');
});

console.log('\n== Render template ==');
t('placeholder {{nama}} terisi', () => {
  assert.strictEqual(wa.renderTemplate('Halo {{nama}}!', { name: 'Budi' }), 'Halo Budi!');
});
t('placeholder {{kode}}, {{namaPaket}}, {{tanggal}} terisi', () => {
  const out = wa.renderTemplate('{{kode}}|{{namaPaket}}|{{tanggal}}', { name: 'X' }, { code: 'JJE-1', packageName: 'Sabesi', departureDate: '2026-12-01' });
  assert.strictEqual(out, 'JJE-1|Sabesi|2026-12-01');
});
t('spasi di dalam placeholder tolerated', () => {
  assert.strictEqual(wa.renderTemplate('Halo {{ nama }}!', { name: 'Budi' }), 'Halo Budi!');
});
t('nama kosong -> Kak', () => {
  assert.strictEqual(wa.renderTemplate('Halo {{nama}}!', {}), 'Halo Kak!');
});

console.log('\n== Job blast ==');
t('createBroadcastJob membuat job queued', () => {
  const job = wa.createBroadcastJob({ templateBody: 'Halo {{nama}}', segment: 'all', dryRun: false });
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(job.total, 3);
  assert.strictEqual(job.cursor, 0);
  assert.strictEqual(job.targets.length, 3);
  assert.strictEqual(db.read().broadcasts.length, 1);
});
t('mode uji tidak mengirim & mengisi hasil simulasi', () => {
  const job = wa.createBroadcastJob({ templateBody: 'Halo {{nama}}', segment: 'all', dryRun: true });
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.sent, 0);
  assert.strictEqual(job.results.length, 3);
  assert.strictEqual(job.results[0].status, 'simulated');
  assert.ok(job.results[0].preview.includes('Halo'));
});
t('job blast tidak menyertakan kontak opt-out', () => {
  const job = wa.createBroadcastJob({ templateBody: 'x', segment: 'all', dryRun: true });
  const phones = job.targets.map((x) => x.phone);
  assert.ok(!phones.includes('628234560004'));
  assert.ok(!phones.includes('628234560005'));
});
t('cancelJob menandai job aborted', () => {
  const job = wa.createBroadcastJob({ templateBody: 'x', segment: 'all', dryRun: false });
  assert.strictEqual(worker.cancelJob(job.id), true);
  const found = db.read().broadcasts.find((j) => j.id === job.id);
  assert.strictEqual(found.status, 'aborted');
});
t('cancelJob job yang sudah selesai tidak mengubah apa pun', () => {
  const job = wa.createBroadcastJob({ templateBody: 'x', segment: 'all', dryRun: true });
  assert.strictEqual(worker.cancelJob(job.id), false);
});

console.log('\n== Pengingat (reminder) ==');
t('collectDueReminders menemukan booking dibuat 2 hari lalu', () => {
  const due = reminder.collectDueReminders(db.read());
  const rules = due.map((d) => d.rule);
  assert.ok(rules.includes('booking_created'), 'booking_created tidak ditemukan');
  assert.ok(rules.includes('payment_due'), 'payment_due tidak ditemukan');
});
t('tidak ada duplikat dedupe setelah ditandai terkirim', () => {
  const d1 = db.read();
  const due = reminder.collectDueReminders(d1);
  const item = due.find((x) => x.rule === 'payment_due');
  d1.waReminders.push({ key: item.key, sentAt: new Date().toISOString() });
  db.write();
  const due2 = reminder.collectDueReminders(db.read());
  assert.ok(!due2.find((x) => x.key === item.key), 'kunci masih ada setelah ditandai');
});
t('booking lunas H-3 mendapat pengingat keberangkatan', () => {
  const due = reminder.collectDueReminders(db.read());
  const dep = due.find((x) => x.rule === 'departure_soon');
  assert.ok(dep, 'departure_soon tidak ditemukan');
  assert.ok(dep.text.includes('Paket Sabesi'));
});
t('booking terkonfirmasi mendapat pengingat konfirmasi', () => {
  const due = reminder.collectDueReminders(db.read());
  assert.ok(due.find((x) => x.rule === 'booking_confirmed'));
});
t('booking cancelled tidak mendapat pengingat', () => {
  const d = db.read();
  d.bookings.push({
    id: 'b9', code: 'JJE-009', name: 'Batal', phone: '62890009',
    packageSlug: 'p1', packageName: 'Paket Sabesi', departureDate: '2026-12-01',
    status: 'cancelled', paymentStatus: 'unpaid', createdAt: new Date(now - 3 * day).toISOString()
  });
  db.write();
  const due = reminder.collectDueReminders(db.read());
  assert.ok(!due.find((x) => x.booking.id === 'b9'));
});
t('template pengingat memuat placeholder booking', () => {
  const due = reminder.collectDueReminders(db.read());
  const item = due.find((x) => x.rule === 'booking_created');
  assert.ok(item.text.includes('JJE-001'), 'kode booking tidak ada di teks');
  assert.ok(item.text.includes('Budi'), 'nama pelanggan tidak ada di teks');
  assert.ok(!item.text.includes('{{'), 'placeholder belum ter-render');
});

console.log('\n== Opt-out otomatis ==');
t('detectStop mengenali "berhenti" & "STOP"', () => {
  // Deteksi opt-out kini berada di lapisan webhook OpenWA (bukan di
  // event library whatsapp-web.js yang sudah dihapus).
  const hook = require(path.join(root, 'src', 'services', 'wa-gateway-webhook'));
  assert.strictEqual(hook.detectStop('berhenti'), true);
  assert.strictEqual(hook.detectStop('STOP'), true);
  assert.strictEqual(hook.detectStop('jangan kirim lagi'), true);
  assert.strictEqual(hook.detectStop('halo kak, info trip dong'), false);
});

// Kembalikan db.json asli.

console.log(`\n${pass} lulus, ${fail} gagal.`);
process.exit(fail ? 1 : 0);
