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
    const fs = require('fs');
    const seedSrc = fs.readFileSync(path.join(root, 'src', 'seed.js'), 'utf8');
    ['openwaTimeoutMs', 'frequencyCap', 'globalDailyLimit'].forEach((k) => {
      assert.ok(
        seedSrc.includes(k + ':'),
        'seed harus punya key ' + k
      );
    });
  });
  await t('scope settings admin memuat key baru', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(root, 'src', 'routes', 'admin.routes.js'), 'utf8');
    assert.ok(src.includes("'openwaTimeoutMs'"), 'openwaTimeoutMs belum di scope');
    assert.ok(src.includes("'frequencyCap'"), 'frequencyCap belum di scope');
    assert.ok(src.includes("'globalDailyLimit'"), 'globalDailyLimit belum di scope');
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

  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
