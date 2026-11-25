/**
 * Uji loop background worker blast.
 *
 * Bedanya dengan wa-worker.test.js: di sini worker dijalankan lewat
 * worker.start() (loop polling), bukan processJob() langsung. Ini jalur yang
 * dipakai server sungguhan — job dibuat admin, lalu diambil worker.
 *
 * Memverifikasi:
 *  1. Loop mengambil job "queued" dan mengirimnya.
 *  2. Job yang sama tidak terkirim dua kali meski start() dipanggil lagi.
 *  3. Job "running" yang tertinggal (crash) dilanjutkan dari cursor.
 *  4. Loop berhenti saat worker.stop() dipanggil.
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

// Basis data uji sudah terpisah (lihat `test-db`) — `data/db.json`
// produksi tidak pernah disentuh, jadi tidak ada backup yang perlu disimpan.

db.reset({
  users: [], destinations: [], packages: [], articles: [], bookings: [], messages: [],
  reviews: [], customers: [], broadcasts: [], waReminders: [],
  contacts: [
    { id: 'c1', name: 'Budi', phone: '628111111111', optIn: true, optOut: false },
    { id: 'c2', name: 'Sari', phone: '628222222222', optIn: true, optOut: false }
  ],
  settings: { waQuietStart: 0, waQuietEnd: 0, waReminderTemplates: {} },
  version: 1
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  const sent = mockGateway();

  console.log('\n== Loop background mengambil job queued ==');
  const job = wa.createBroadcastJob({
    templateBody: 'Halo {{nama}}!',
    segment: 'all',
    dryRun: false
  });
  t('job dibuat dengan status queued', () => {
    assert.strictEqual(job.status, 'queued');
  });

  worker.start();
  t('worker.start() idempotent (tidak error)', () => {
    worker.start();
    worker.start();
  });

  // Tunggu sampai worker selesai mengirim.
  const deadline = Date.now() + 15000;
  let live = null;
  while (Date.now() < deadline) {
    live = db.read().broadcasts.find((j) => j.id === job.id);
    if (live && live.status === 'done') break;
    await sleep(300);
  }

  t('worker loop menyelesaikan job (status done)', () => {
    assert.strictEqual(live.status, 'done');
  });
  t('2 pesan terkirim via loop', () => {
    assert.strictEqual(sent.length, 2);
  });
  t('cursor job progressed ke 2', () => {
    assert.strictEqual(live.cursor, 2);
    assert.strictEqual(live.sent, 2);
  });

  console.log('\n== Job tidak terkirim dua kali ==');
  // Worker masih berjalan; job selesai tidak boleh diambil ulang.
  sent.length = 0;
  await sleep(7000); // satu siklus polling worker (POLL_INTERVAL_MS = 5000)
  t('job selesai tidak dikirim ulang', () => {
    assert.strictEqual(sent.length, 0);
  });

  console.log('\n== Job "running" tertinggal dilanjutkan dari cursor ==');
  sent.length = 0;
  const d = db.read();
  d.broadcasts = [
    {
      id: db.uid('bc'),
      type: 'blast',
      template: 'Halo {{nama}}!',
      segment: 'all',
      dryRun: false,
      status: 'running', // sisa dari proses yang crash
      total: 2,
      sent: 1,
      failed: 0,
      skipped: 0,
      cursor: 1, // nomor pertama sudah terkirim
      results: [{ phone: '628111111111', name: 'Budi', status: 'sent' }],
      targets: [
        { phone: '628111111111', name: 'Budi' },
        { phone: '628222222222', name: 'Sari' }
      ],
      createdAt: new Date().toISOString()
    }
  ];
  db.write();

  const dl2 = Date.now() + 15000;
  let resumed = null;
  while (Date.now() < dl2) {
    resumed = db.read().broadcasts.find((j) => j.status === 'done' || j.status === 'aborted');
    if (resumed) break;
    await sleep(300);
  }
  t('job running yang tertinggal diselesaikan', () => {
    assert.ok(resumed, 'job tidak pernah selesai');
    assert.strictEqual(resumed.status, 'done');
  });
  t('hanya nomor yang belum dikirim yang dikirim ulang', () => {
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].chatId, '628222222222');
  });

  console.log('\n== worker.stop() menghentikan loop ==');
  worker.stop();
  const status = worker.getStatus();
  t('status worker melaporkan tidak berjalan', () => {
    assert.strictEqual(status.running, false);
  });


  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  worker.stop();
  process.exit(1);
});
