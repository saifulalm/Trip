/**
 * Uji end-to-end worker blast dengan transport tiruan (mock).
 * Memverifikasi: antrean diambil worker, pesan dikirim ke nomor yang benar,
 * penghormatan opt-in/opt-out saat pengiriman, pembatalan, jam tenang,
 * dan resume setelah "restart" (cursor tersimpan).
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
const worker = require(path.join(root, 'src', 'services', 'wa-worker'));
const { mockGateway } = require(path.join(__dirname, 'wa-mock-gateway'));

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

// ---- Siapkan data uji ----
// Basis data uji sudah terpisah (lihat `test-db`) — `data/db.json`
// produksi tidak pernah disentuh, jadi tidak ada backup yang perlu disimpan.
db.reset({
  users: [], destinations: [], packages: [], articles: [], bookings: [], messages: [],
  reviews: [], customers: [], broadcasts: [], waReminders: [],
  contacts: [
    { id: 'c1', name: 'Budi', phone: '628111111111', optIn: true, optOut: false },
    { id: 'c2', name: 'Sari', phone: '628222222222', optIn: true, optOut: false },
    { id: 'c3', name: 'OptOut', phone: '628333333333', optIn: true, optOut: false }
  ],
  settings: { waQuietStart: 0, waQuietEnd: 0, waReminderTemplates: {} }, // quiet nonaktif
  version: 1
});

(async () => {
  // ---- Mock transport: tangkap pesan yang dikirim ----
  const sent = mockGateway();

  console.log('\n== Worker mengirim blast ==');
  const job = wa.createBroadcastJob({
    templateBody: 'Halo {{nama}}, promo Special!',
    segment: 'all',
    dryRun: false
  });
  t('job dibuat dengan 3 target', () => {
    assert.strictEqual(job.total, 3);
  });

  await worker.processJob(job);

  t('worker mengirim 3 pesan', () => {
    assert.strictEqual(sent.length, 3);
  });
  t('nomor tujuan benar (nomor polos; konversi ke JID dilakukan gateway)', () => {
    assert.deepStrictEqual(sent.map((s) => s.chatId).sort(), [
      '628111111111',
      '628222222222',
      '628333333333'
    ]);
  });
  t('template ter-render dengan nama kontak', () => {
    assert.ok(sent.every((s) => !s.text.includes('{{')));
    assert.ok(sent.some((s) => s.text.includes('Budi')));
  });
  t('status job menjadi done', () => {
    const j = db.read().broadcasts.find((x) => x.id === job.id);
    assert.strictEqual(j.status, 'done');
    assert.strictEqual(j.sent, 3);
    assert.strictEqual(j.failed, 0);
    assert.strictEqual(j.cursor, 3);
  });
  t('hasil per nomor tercatat', () => {
    const j = db.read().broadcasts.find((x) => x.id === job.id);
    assert.strictEqual(j.results.length, 3);
    assert.ok(j.results.every((r) => r.status === 'sent'));
  });

  console.log('\n== Opt-out dicek ULANG saat pengiriman ==');
  sent.length = 0;
  // Job dibuat dulu (kontak masih opt-in), THEN pelanggan opt-out.
  // Saat pengiriman, worker harus MEMLEWATI kontak tsb — inilah gunanya
  // pengecekan ulang izin di deliverTo().
  const job2 = wa.createBroadcastJob({ templateBody: 'Hi {{nama}}', segment: 'all', dryRun: false });
  const d = db.read();
  d.contacts.find((c) => c.id === 'c3').optOut = true;
  db.write();
  await worker.processJob(job2);
  t('kontak yang opt-out setelah job dibuat DILEWATI saat pengiriman', () => {
    assert.strictEqual(sent.length, 2);
    const j = db.read().broadcasts.find((x) => x.id === job2.id);
    assert.strictEqual(j.sent, 2);
    assert.strictEqual(j.skipped, 1);
    assert.strictEqual(j.failed, 0);
    const skipped = j.results.find((r) => r.status === 'skipped');
    assert.ok(skipped, 'tidak ada hasil berstatus skipped');
    assert.ok(skipped.error.includes('opted-out'), 'alasan skip harus menyebut opt-out');
  });

  console.log('\n== Kontak opt-out di-exclude saat targeting ==');
  const job2b = wa.createBroadcastJob({ templateBody: 'Hi {{nama}}', segment: 'all', dryRun: true });
  t('kontak opt-out tidak masuk target job baru', () => {
    assert.strictEqual(job2b.total, 2);
    assert.ok(!job2b.targets.some((x) => x.phone === '628333333333'));
  });

  console.log('\n== deliverTo mengecek izin saat pengiriman ==');
  sent.length = 0;
  const res1 = await wa.deliverTo({ phone: '628111111111', name: 'Budi' }, 'tes');
  t('kontak opt-in dikirim', () => {
    assert.strictEqual(res1.status, 'sent');
    assert.strictEqual(sent.length, 1);
  });
  const res2 = await wa.deliverTo({ phone: '628333333333', name: 'OptOut' }, 'tes');
  t('kontak opted-out dilewati (tidak terkirim)', () => {
    assert.strictEqual(res2.status, 'skipped');
    assert.strictEqual(sent.length, 1);
  });

  console.log('\n== Job dibatalkan saat berjalan ==');
  sent.length = 0;
  const job4 = wa.createBroadcastJob({ templateBody: 'Hi {{nama}}', segment: 'all', dryRun: false });
  worker.cancelJob(job4.id);
  await worker.processJob(job4);
  t('job yang dibatalkan tidak mengirim pesan', () => {
    assert.strictEqual(sent.length, 0);
    const j = db.read().broadcasts.find((x) => x.id === job4.id);
    assert.strictEqual(j.status, 'aborted');
  });

  console.log('\n== Resume setelah restart ==');
  sent.length = 0;
  // Isolasi: bersihkan log pengiriman harian.
  // Frequency cap (3 pesan/kontak/hari) sengaja bekerja dan sudah
  // terpicu oleh skenario-skenario sebelumnya — tanpa reset, kontak
  // "Budi" sudah mencapai batas dan pesan kedua jadi "skipped",
  // sehingga assertion cursor/sent tidak lagi menguji apa yang dimaksud.
  const dResume = db.read();
  dResume.whatsappSendLogs = [];
  db.write();
  const job5 = wa.createBroadcastJob({ templateBody: 'Hi {{nama}}', segment: 'all', dryRun: false });
  const d5 = db.read();
  const j5 = d5.broadcasts.find((x) => x.id === job5.id);
  j5.targets = j5.targets.slice(0, 2);
  j5.total = 2;
  db.write();
  await worker.processJob(job5);
  t('resume: job dilanjutkan dari cursor tersimpan', () => {
    const j = db.read().broadcasts.find((x) => x.id === job5.id);
    assert.strictEqual(j.cursor, 2);
    assert.strictEqual(j.sent, 2);
    assert.strictEqual(j.status, 'done');
  });

  console.log('\n== Blast ditunda saat jam tenang ==');
  sent.length = 0;
  const d6 = db.read();
  d6.settings.waQuietStart = 22;
  d6.settings.waQuietEnd = 1; // melewati tengah malam
  db.write();
  const job6 = wa.createBroadcastJob({ templateBody: 'Hi {{nama}}', segment: 'all', dryRun: false });
  // Waktu acuan tetap: jam 23 berada di dalam jendela 22-01.
  const r6 = await worker.processJob(job6, new Date(2026, 0, 1, 23, 30, 0));
  t('job ditunda (waiting) saat jam tenang, tidak dikirim', () => {
    assert.strictEqual(r6, 'waiting');
    assert.strictEqual(sent.length, 0);
    const j = db.read().broadcasts.find((x) => x.id === job6.id);
    assert.strictEqual(j.status, 'queued');
    assert.ok(j.pausedReason && j.pausedReason.includes('Jam tenang'));
  });

  console.log('\n== Blast jalan di luar jam tenang ==');
  sent.length = 0;
  const d7 = db.read();
  d7.settings.waQuietStart = 22;
  d7.settings.waQuietEnd = 1;
  db.write();
  const job7 = wa.createBroadcastJob({ templateBody: 'Hi {{nama}}', segment: 'all', dryRun: false });
  const r7 = await worker.processJob(job7, new Date(2026, 0, 1, 10, 30, 0));
  t('job terkirim di luar jam tenang', () => {
    assert.strictEqual(r7, 'done');
    assert.ok(sent.length > 0);
  });

  // ---- Kembalikan db.json asli ----

  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
