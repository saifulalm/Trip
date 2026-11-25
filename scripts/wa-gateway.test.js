/**
 * Uji lapisan transport gateway WhatsApp OpenWA.
 *
 * Suite ini menggantikan uji lockfile Chromium yang dulu ada — sejak
 * backend tidak lagi menjalankan browser (whatsapp-web.js), tidak ada lagi
 * profil Chromium yang perlu dibersihkan.
 *
 * Yang diuji:
 *  1. Konfigurasi ( precedence env vs settings ).
 *  2. Normalisasi nomor → JID obrolan.
 *  3. Validasi nama session (OpenWA menolak underscore).
 *  4. Verifikasi tanda tangan HMAC-SHA256 atas body webhook.
 *  5. Idempotensi event webhook (event kembar tidak diproses dua kali).
 *
 * Jalankan: node scripts/wa-gateway.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const gateway = require(path.join(root, 'src', 'services', 'wa-gateway'));
const hook = require(path.join(root, 'src', 'services', 'wa-gateway-webhook'));
const db = require(path.join(root, 'src', 'db'));
const wa = require(path.join(root, 'src', 'services', 'wa'));
const reminder = require(path.join(root, 'src', 'services', 'wa-reminder'));
const { mockGateway, setReady } = require(path.join(__dirname, 'wa-mock-gateway'));

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

// Basis data uji sudah terpisah (lihat `test-db`) — tidak ada backup yang
// perlu disimpan karena `data/db.json` produksi tidak pernah disentuh.

(async () => {
  console.log('\n== Konfigurasi gateway ==');
  await t('base URL dari settings dipakai bila ada', () => {
    const cfg = gateway.config({ openwaBaseUrl: 'http://gw.test:2785/' });
    assert.strictEqual(cfg.baseUrl, 'http://gw.test:2785');
  });
  await t('base URL bawaan dipakai bila settings kosong', () => {
    const cfg = gateway.config({});
    assert.strictEqual(cfg.baseUrl, gateway.DEFAULT_BASE_URL);
  });
  await t('nama session bawaan valid untuk OpenWA', () => {
    assert.ok(gateway.SAFE_SESSION_NAME.test(gateway.DEFAULT_SESSION_NAME));
  });
  await t('isConfigured false bila API key kosong', () => {
    assert.strictEqual(gateway.isConfigured({ openwaBaseUrl: 'http://x' }), false);
  });
  await t('isConfigured true bila base URL + API key ada', () => {
    assert.strictEqual(
      gateway.isConfigured({ openwaBaseUrl: 'http://x', openwaApiKey: 'owa_k1_abc' }),
      true
    );
  });

  // ── Konfigurasi yang bisa diatur dari panel admin ────────────────
  // `gateway.config()` membaca settings; nilai ini harus bisa diubah admin
  // lewat /admin/pengaturan, bukan terkunci di konstanta modul.
  console.log('\n== Konfigurasi yang diatur dari panel admin ==');
  await t('timeout gateway bisa diatur lewat settings', () => {
    const cfg = gateway.config({ openwaTimeoutMs: 4500 });
    assert.strictEqual(cfg.timeoutMs, 4500);
  });
  await t('timeout default 20000 ms bila tidak diatur', () => {
    const cfg = gateway.config({});
    assert.strictEqual(cfg.timeoutMs, gateway.DEFAULT_TIMEOUT_MS);
  });
  await t('seed punya openwaTimeoutMs, frequencyCap, globalDailyLimit', () => {
    // Uji PERILAKU: nilai diambil dari seed yang benar-benar dibangun,
    // bukan dari grep teks sumber. Menghapus key dari seed (atau mengganti
    // nama key-nya) WAJIB membuat test ini gagal.
    const seed = require(path.join(root, 'src', 'seed'));
    const settings = seed.buildSeed().settings;
    assert.strictEqual(settings.openwaTimeoutMs, 20000, 'openwaTimeoutMs di seed');
    assert.strictEqual(settings.frequencyCap, 3, 'frequencyCap di seed');
    assert.strictEqual(settings.globalDailyLimit, 100, 'globalDailyLimit di seed');
  });
  await t('scope settings admin memuat key baru', () => {
    // Uji PERILAKU: scope dibaca dari `SETTINGS_GROUPS` yang sebenarnya,
    // bukan dari grep teks. Menghapus key dari scope WAJIB menggagalkan test.
    const adminRoutes = require(path.join(root, 'src', 'routes', 'admin.routes'));
    assert.strictEqual(typeof adminRoutes.settingsScope, 'function',
      'settingsScope harus diekspor dari admin.routes');
    const openwaScope = adminRoutes.settingsScope({ form: 'openwa' });
    assert.ok(openwaScope.has('openwaTimeoutMs'),
      'openwaTimeoutMs belum di scope form openwa');
    const waScope = adminRoutes.settingsScope({ form: 'wa' });
    assert.ok(waScope.has('frequencyCap'),
      'frequencyCap belum di scope form wa');
    assert.ok(waScope.has('globalDailyLimit'),
      'globalDailyLimit belum di scope form wa');
  });

  // ── Timeout gateway: dijepit ke rentang yang sama untuk env & panel ──
  console.log('\n== Timeout gateway (batas bersama env & panel) ==');
  await t('timeout dari settings di dalam rentang dipakai apa adanya', () => {
    const cfg = gateway.config({ openwaTimeoutMs: 4500 });
    assert.strictEqual(cfg.timeoutMs, 4500);
  });
  await t('timeout dari settings di bawah minimum dijepit ke 3000', () => {
    const cfg = gateway.config({ openwaTimeoutMs: 10 });
    assert.strictEqual(cfg.timeoutMs, gateway.MIN_TIMEOUT_MS);
    assert.strictEqual(gateway.MIN_TIMEOUT_MS, 3000);
  });
  await t('timeout dari settings di atas maksimum dijepit ke 120000', () => {
    const cfg = gateway.config({ openwaTimeoutMs: 999999 });
    assert.strictEqual(cfg.timeoutMs, gateway.MAX_TIMEOUT_MS);
    assert.strictEqual(gateway.MAX_TIMEOUT_MS, 120000);
  });
  await t('timeout dari env OPENWA_TIMEOUT_MS dipakai bila settings kosong', () => {
    const real = process.env.OPENWA_TIMEOUT_MS;
    process.env.OPENWA_TIMEOUT_MS = '7777';
    try {
      assert.strictEqual(gateway.config({}).timeoutMs, 7777);
    } finally {
      if (real === undefined) delete process.env.OPENWA_TIMEOUT_MS;
      else process.env.OPENWA_TIMEOUT_MS = real;
    }
  });
  await t('timeout dari env di luar rentang ikut dijepit', () => {
    const real = process.env.OPENWA_TIMEOUT_MS;
    try {
      process.env.OPENWA_TIMEOUT_MS = '1';
      assert.strictEqual(gateway.config({}).timeoutMs, gateway.MIN_TIMEOUT_MS);
      process.env.OPENWA_TIMEOUT_MS = '999999';
      assert.strictEqual(gateway.config({}).timeoutMs, gateway.MAX_TIMEOUT_MS);
    } finally {
      if (real === undefined) delete process.env.OPENWA_TIMEOUT_MS;
      else process.env.OPENWA_TIMEOUT_MS = real;
    }
  });
  await t('settings menang atas env untuk timeout', () => {
    const real = process.env.OPENWA_TIMEOUT_MS;
    process.env.OPENWA_TIMEOUT_MS = '7777';
    try {
      assert.strictEqual(gateway.config({ openwaTimeoutMs: 4500 }).timeoutMs, 4500);
    } finally {
      if (real === undefined) delete process.env.OPENWA_TIMEOUT_MS;
      else process.env.OPENWA_TIMEOUT_MS = real;
    }
  });

  console.log('\n== Normalisasi nomor & JID ==');
  await t('nomor polos menjadi JID c.us', () => {
    assert.strictEqual(gateway.toChatId('628123456789'), '628123456789@c.us');
  });
  await t('JID yang sudah jadi diteruskan apa adanya', () => {
    assert.strictEqual(gateway.toChatId('628@c.us'), '628@c.us');
  });
  await t('nomor terlalu pendek ditolak', () => {
    assert.throws(() => gateway.toChatId('123'), /tidak valid/i);
  });
  await t('nomor kosong ditolak', () => {
    assert.throws(() => gateway.toChatId(''), /kosong/i);
  });
  await t('normalizePhone mengubah awalan 0 menjadi 62', () => {
    assert.strictEqual(gateway.normalizePhone('081234567890'), '6281234567890');
  });
  await t('normalizePhone mengubah awalan 8 menjadi 62', () => {
    assert.strictEqual(gateway.normalizePhone('81234567890'), '6281234567890');
  });

  console.log('\n== Nama session ==');
  await t('nama session valid diterima', () => {
    assert.strictEqual(gateway.assertSafeSessionName('seayoulatertrip'), 'seayoulatertrip');
  });
  await t('nama session dengan underscore ditolak', () => {
    assert.throws(() => gateway.assertSafeSessionName('sabesi_trip'), /tidak valid/i);
  });
  await t('nama session terlalu panjang ditolak', () => {
    assert.throws(() => gateway.assertSafeSessionName('a'.repeat(51)), /tidak valid/i);
  });

  console.log('\n== Verifikasi tanda tangan webhook ==');
  const secret = 'secret-uji-minimal-16-karakter';
  const body = Buffer.from(JSON.stringify({ event: 'message.received', sessionId: 's1' }));
  const signature =
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  await t('signature yang benar diterima', () => {
    assert.strictEqual(hook.verifySignature(body, signature, secret), true);
  });
  await t('signature salah ditolak', () => {
    assert.strictEqual(hook.verifySignature(body, 'sha256=deadbeef', secret), false);
  });
  await t('signature kosong ditolak', () => {
    assert.strictEqual(hook.verifySignature(body, '', secret), false);
  });
  await t('secret kosong menolak semua signature', () => {
    assert.strictEqual(hook.verifySignature(body, signature, ''), false);
  });
  await t('signature dengan panjang berbeda ditolak tanpa error', () => {
    assert.strictEqual(hook.verifySignature(body, 'sha256=abc', secret), false);
  });
  await t('body yang diubah setelah di-hash ditolak', () => {
    const other = Buffer.from(JSON.stringify({ event: 'message.received', sessionId: 's2' }));
    assert.strictEqual(hook.verifySignature(other, signature, secret), false);
  });

  console.log('\n== Deteksi opt-out dari pesan masuk ==');
  await t('kata "berhenti" terdeteksi', () => {
    assert.strictEqual(hook.detectStop('berhenti'), true);
  });
  await t('kata "STOP" (kapital) terdeteksi', () => {
    assert.strictEqual(hook.detectStop('STOP'), true);
  });
  await t('kalimat biasa tidak dianggap opt-out', () => {
    assert.strictEqual(hook.detectStop('halo kak, info trip dong'), false);
  });
  await t('jidToPhone mengubah JID menjadi nomor polos', () => {
    assert.strictEqual(hook.jidToPhone('628123456789@c.us'), '628123456789');
  });
  await t('jidToPhone menolak JID tanpa nomor', () => {
    assert.strictEqual(hook.jidToPhone('abc@c.us'), '');
  });

  console.log('\n== Idempotensi event webhook ==');
  // Data uji minimal supaya db bisa ditulis tanpa merusak data asli.
  db.reset({
    users: [], destinations: [], packages: [], articles: [], bookings: [],
    messages: [], contacts: [], customers: [], reviews: [], broadcasts: [],
    waReminders: [], waInbound: [], waWebhookEvents: [],
    settings: {}, version: 1
  });

  const event = {
    event: 'message.received',
    sessionId: 's1',
    data: { from: '628123456789@c.us', body: 'halo', fromMe: false }
  };
  const raw = Buffer.from(JSON.stringify(event));

  await t('event pertama diproses', () => {
    const res = hook.handleEvent(event, raw);
    assert.strictEqual(res.status, 'HANDLED');
  });
  await t('event kembar dikenali sebagai duplikat', () => {
    const res = hook.handleEvent(event, raw);
    assert.strictEqual(res.status, 'DUPLICATE');
  });
  await t('jejak event tersimpan', () => {
    const events = db.read().waWebhookEvents || [];
    assert.strictEqual(events.length, 1);
    assert.ok(events[0].idempotencyKey);
  });
  await t('pesan masuk tercatat di inbox', () => {
    const inbound = db.read().waInbound || [];
    assert.strictEqual(inbound.length, 1);
    assert.strictEqual(inbound[0].phone, '628123456789');
  });

  console.log('\n== Opt-out otomatis dari pesan masuk ==');
  db.reset({
    users: [], destinations: [], packages: [], articles: [], bookings: [],
    messages: [], customers: [], reviews: [], broadcasts: [], waReminders: [],
    waInbound: [], waWebhookEvents: [],
    contacts: [{ id: 'c1', name: 'Budi', phone: '628123456789', optIn: true, optOut: false }],
    settings: {}, version: 1
  });
  await t('pesan "berhenti" menandai kontak opt-out', () => {
    const stop = {
      event: 'message.received',
      sessionId: 's1',
      data: { from: '628123456789@c.us', body: 'berhenti', fromMe: false }
    };
    hook.handleEvent(stop, Buffer.from(JSON.stringify(stop)));
    const contact = (db.read().contacts || []).find((c) => c.id === 'c1');
    assert.strictEqual(contact.optOut, true);
  });
  await t('pesan grup diabaikan', () => {
    const before = (db.read().waInbound || []).length;
    const group = {
      event: 'message.received',
      sessionId: 's1',
      data: { from: '628999999999-123@g.us', body: 'halo grup', fromMe: false }
    };
    hook.handleEvent(group, Buffer.from(JSON.stringify(group)));
    assert.strictEqual((db.read().waInbound || []).length, before);
  });

  // ── Regression: sendText tidak boleh rekursif (bug B1) ──────────
  // Dua deklarasi `sendText` di scope modul yang sama menyebabkan
  // wrapper baris 666 memanggil dirinya sendiri → stack overflow.
  // Tes ini memanggil gateway.sendText NYATA (tanpa mock) dengan
  // fetch dipalsukan, lalu membuktikan request benar-benar terkirim.

  console.log('\n== Pengiriman pesan (regression B1) ==');
  await t('sendText tidak rekursif: request sampai ke endpoint send-text', async () => {
    const calls = [];
    const realFetch = global.fetch;
    const realKey = process.env.OPENWA_API_KEY;
    // API key wajib ada supaya lapisan transport boleh memanggil gateway.
    process.env.OPENWA_API_KEY = 'owa_k1_uji';
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body });
      return {
        ok: true,
        status: 200,
        headers: {},
        text: async () => JSON.stringify({ messageId: 'msg-1' })
      };
    };
    try {
      // id session berformat UUID (persis seperti yang OpenWA hasilkan).
      gateway.applySession({
        id: 'a1b2c3d4-1234-5678-9abc-def012345678',
        name: 'seayoulatertrip',
        status: 'ready',
        phone: '628123456789',
        pushName: 'Tim'
      });
      const res = await gateway.sendText('628123456789', 'halo dunia');
      assert.ok(res && res.via === 'openwa', 'hasil harus punya via=openwa');
      assert.ok(res.jid === '628123456789@c.us', 'jid harus 628123456789@c.us, dapat ' + res.jid);
      assert.strictEqual(calls.length, 1, 'harus tepat 1 request HTTP, dapat ' + calls.length);
      assert.ok(
        calls[0].url.endsWith('/messages/send-text'),
        'URL harus /messages/send-text, dapat ' + calls[0].url
      );
      const body = JSON.parse(calls[0].body);
      assert.strictEqual(body.chatId, '628123456789@c.us');
      assert.strictEqual(body.text, 'halo dunia');
    } finally {
      global.fetch = realFetch;
      if (realKey === undefined) delete process.env.OPENWA_API_KEY;
      else process.env.OPENWA_API_KEY = realKey;
    }
  });

  await t('sendTextViaSession ada dan tidak sama dengan sendText', () => {
    assert.strictEqual(typeof gateway.sendTextViaSession, 'function');
    assert.notStrictEqual(gateway.sendTextViaSession, gateway.sendText);
  });

  // ── Batas pengiriman: reminder otomatis pun wajib ikutinya ────────
  // `wa.sendVia()` TIDAK memanggil checkFrequencyCap/checkDailyLimit —
  // hanya `wa.sendText()` dan `wa.deliverTo()` yang melakukannya. Tanpa
  // cek eksplisit di `wa-reminder.js`, pengingat booking menembus kedua
  // batas itu.
  console.log('\n== Batas pengiriman berlaku untuk pengingat otomatis ==');
  const sentNow = mockGateway();
  setReady(true);

  const nowMs = Date.now();
  const dayMs = 86400000;
  // Waktu acuan untuk pengecekan jam tenang: jam 10, di luar jendela jam
  // tenang (0-0 = nonaktif). Tanggal booking dihitung dari waktu SEKARANG
  // supaya aturan pengingat (booking_created, payment_due, departure_soon,
  // booking_confirmed) semuanya jatuh tempo dan bisa diulang.
  const JAM_10 = new Date(2026, 0, 1, 10, 30, 0);

  /**
   * Siapkan basis data uji: satu kontak + dua booking, sehingga ada dua
   * pengingat yang jatuh tempo ke NOMOR YANG SAMA.
   *
   * @param {object} settingsExtra nilai settings tambahan (mis. frequencyCap)
   */
  function seedTwoRemindersToSameNumber(settingsExtra) {
    const d = db.read();
    d.settings.waQuietStart = 0;
    d.settings.waQuietEnd = 0;
    Object.assign(d.settings, settingsExtra || {});
    d.waReminders = [];
    d.whatsappSendLogs = [];
    d.bookings = [
      {
        id: 'r1', code: 'JJE-101', name: 'Budi', phone: '628111111111',
        packageSlug: 'p1', packageName: 'Paket Sabesi',
        departureDate: new Date(nowMs + 3 * dayMs).toISOString().slice(0, 10),
        status: 'confirmed', paymentStatus: 'paid',
        createdAt: new Date(nowMs - 2 * dayMs).toISOString()
      },
      {
        id: 'r2', code: 'JJE-102', name: 'Budi', phone: '628111111111',
        packageSlug: 'p1', packageName: 'Paket Sabesi',
        departureDate: new Date(nowMs + 3 * dayMs).toISOString().slice(0, 10),
        status: 'confirmed', paymentStatus: 'paid',
        createdAt: new Date(nowMs - 2 * dayMs).toISOString()
      }
    ];
    d.contacts = [
      { id: 'c1', name: 'Budi', phone: '628111111111', optIn: true, optOut: false, waNotify: true }
    ];
    db.write();
  }

  /**
   * Jumlah pengingat yang jatuh tempo — TANPA argumen `now`, sama seperti
   * cara `runReminders()` menghitungnya.
   * @returns {number} jumlah pengingat due
   */
  function dueCount() {
    return reminder.collectDueReminders(db.read()).length;
  }

  sentNow.length = 0;
  seedTwoRemindersToSameNumber({ frequencyCap: 1, globalDailyLimit: 100 });
  const due = dueCount();
  const resCap = await reminder.runReminders(JAM_10);
  await t('pengingat kedua ke nomor sama DITOLAK saat frequencyCap=1', () => {
    assert.ok(due >= 2, 'harus ada >= 2 pengingat due, dapat ' + due);
    assert.strictEqual(sentNow.length, 1,
      'harus tepat 1 pesan terkirim, dapat ' + sentNow.length);
    assert.strictEqual(resCap.sent, 1, 'summary.sent harus 1');
  });
  await t('pengingat yang ditolak tercatat di ringkasan sebagai skipped + alasan', () => {
    const skipped = (resCap.details || []).filter((x) => x.status === 'skipped');
    assert.strictEqual(skipped.length, due - 1,
      'harus ada ' + (due - 1) + ' detail skipped, dapat ' + skipped.length);
    skipped.forEach((x) => {
      assert.ok(/batas/i.test(x.reason || ''),
        'alasan harus menjelaskan batas, dapat: ' + x.reason);
    });
  });
  await t('pengingat yang ditolak TIDAK dicatat sebagai terkirim (dedupe utuh)', () => {
    const rems = db.read().waReminders || [];
    assert.strictEqual(rems.length, 1,
      'dedupe hanya boleh mencatat 1, dapat ' + rems.length);
  });
  await t('pengiriman pengingat tercatat di log kirim', () => {
    const logs = db.read().whatsappSendLogs || [];
    assert.strictEqual(logs.length, 1,
      'harus ada 1 entri log, dapat ' + logs.length);
  });

  sentNow.length = 0;
  seedTwoRemindersToSameNumber({ frequencyCap: 50, globalDailyLimit: 1 });
  const due2 = dueCount();
  const resDaily = await reminder.runReminders(JAM_10);
  await t('pengingat kedua DITOLAK saat globalDailyLimit=1', () => {
    assert.strictEqual(sentNow.length, 1,
      'harus tepat 1 pesan terkirim, dapat ' + sentNow.length);
    assert.strictEqual(resDaily.sent, 1);
  });
  await t('pengingat yang ditolak oleh batas harian menyebut batas harian', () => {
    const skipped = (resDaily.details || []).filter((x) => x.status === 'skipped');
    assert.strictEqual(skipped.length, due2 - 1);
    skipped.forEach((x) => {
      assert.ok(/batas harian/i.test(x.reason || ''),
        'alasan harus menyebut batas harian, dapat: ' + x.reason);
    });
  });

  // ── Batas harian efektif = retensi log harian ─────────────────────
  // Kalau `globalDailyLimit` boleh lebih besar daripada jumlah entri log
  // yang disimpan, batasnya tidak akan pernah terpicu (efektif ~500).
  console.log('\n== Batas harian efektif_vs retensi log ==');
  await t('batas maksimum globalDailyLimit tidak melebihi retensi log', () => {
    assert.ok(
      wa.MAX_GLOBAL_DAILY_LIMIT <= wa.LOG_RETENTION_PER_DAY,
      'MAX_GLOBAL_DAILY_LIMIT (' + wa.MAX_GLOBAL_DAILY_LIMIT +
        ') harus <= LOG_RETENTION_PER_DAY (' + wa.LOG_RETENTION_PER_DAY + ')'
    );
    assert.strictEqual(wa.MAX_GLOBAL_DAILY_LIMIT, 500);
    assert.strictEqual(wa.LOG_RETENTION_PER_DAY, 500);
  });
  await t('effectiveDailyLimit menjepit cap di atas retensi log', () => {
    assert.strictEqual(wa.effectiveDailyLimit({ globalDailyLimit: 5000 }), 500);
    assert.strictEqual(wa.effectiveDailyLimit({ globalDailyLimit: 250 }), 250);
    assert.strictEqual(wa.effectiveDailyLimit({}), wa.MAX_SENDS_PER_DAY);
  });
  await t('batas atas di route admin = retensi log (satu sumber kebenaran)', () => {
    // Kalau route admin mengizinkan nilai di atas retensi log, batas tak
    // akan pernah terpicu — jadi batas route WAJIB sama dengan
    // MAX_GLOBAL_DAILY_LIMIT.
    const adminRoutes = require(path.join(root, 'src', 'routes', 'admin.routes'));
    assert.strictEqual(typeof adminRoutes.SETTINGS_LIMITS, 'object',
      'SETTINGS_LIMITS harus diekspor dari admin.routes');
    const lim = adminRoutes.SETTINGS_LIMITS.globalDailyLimit;
    assert.strictEqual(lim.max, wa.MAX_GLOBAL_DAILY_LIMIT,
      'batas atas route (' + lim.max + ') harus sama dengan retensi log (' +
        wa.MAX_GLOBAL_DAILY_LIMIT + ')');
    assert.ok(lim.max <= wa.LOG_RETENTION_PER_DAY,
      'batas atas route tidak boleh melebihi retensi log harian');
    // Batas timeout juga harus sama dengan rentang di wa-gateway.
    const tl = adminRoutes.SETTINGS_LIMITS.openwaTimeoutMs;
    assert.strictEqual(tl.min, gateway.MIN_TIMEOUT_MS);
    assert.strictEqual(tl.max, gateway.MAX_TIMEOUT_MS);
  });
  await t('jumlah entri log harian tidak pernah melebihi batas maksimum', () => {
    const d = db.read();
    const today = new Date().toISOString().slice(0, 10);
    // Isi log sampai Melebihi batas maksimum, lalu panggil logSend.
    d.whatsappSendLogs = [];
    for (let i = 0; i < wa.MAX_GLOBAL_DAILY_LIMIT + 120; i += 1) {
      d.whatsappSendLogs.push({
        id: 'log_' + i, phone: '628' + i, name: '', status: 'sent',
        error: null, template: '', loggedAt: new Date().toISOString()
      });
    }
    db.write();
    wa.logSend({ phone: '628999999999', name: 'Uji', status: 'sent' });
    const logs = (db.read().whatsappSendLogs || [])
      .filter((l) => l.loggedAt && l.loggedAt.slice(0, 10) === today);
    assert.ok(logs.length <= wa.MAX_GLOBAL_DAILY_LIMIT,
      'jumlah log harian ' + logs.length + ' melebihi batas ' + wa.MAX_GLOBAL_DAILY_LIMIT);
  });
  await t('batas harian dengan cap = batas maksimum benar-benar terpicu', () => {
    const d = db.read();
    const today = new Date().toISOString().slice(0, 10);
    const logs = (d.whatsappSendLogs || [])
      .filter((l) => l.loggedAt && l.loggedAt.slice(0, 10) === today);
    assert.ok(logs.length >= 500,
      'harus ada 500 entri log, dapat ' + logs.length);
    const res = wa.checkDailyLimit({ globalDailyLimit: wa.MAX_GLOBAL_DAILY_LIMIT });
    assert.strictEqual(res.allowed, false,
      'batas harian harus terpicu, dapat ' + JSON.stringify(res));
    assert.ok(res.reason && /batas harian/i.test(res.reason),
      'alasan harus jelas, dapat: ' + res.reason);
  });

  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
