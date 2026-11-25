'use strict';

/**
 * Uji end-to-end route webhook WhatsApp OpenWA.
 *
 * Yang diuji:
 *  1. Signature HMAC-SHA256 yang benar → 200 + event diproses.
 *  2. Signature salah → 401 (delivery ditolak, OpenWA boleh retry).
 *  3. Secret belum dikonfigurasi → 401.
 *  4. Event kembar (idempotency key sama) → 200 + status DUPLICATE.
 *  5. Body JSON rusak → 400.
 *  6. Pesan "berhenti" → kontak ditandai opt-out.
 *
 * Skrip ini menyalakan server Express in-process di port acak. Gateway OpenWA
 * sungguhan TIDAK pernah dihubungi — jadi tidak ada pesan asli yang terkirim.
 *
 * Jalankan: node scripts/verify-openwa-webhook.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));
const { createApp } = require(path.join(root, 'src', 'app'));
const { ensureSeed } = require(path.join(root, 'src', 'seed'));

ensureSeed();

const SECRET = 'secret-uji-openwa-1234567890';
// Basis data uji sudah terpisah (lihat `test-db`) — `data/db.json`
// produksi tidak pernah disentuh, jadi tidak ada backup yang perlu disimpan.

/**
 * Data uji minimal — seluruh tabel yang dipakai webhook diisi kosong kecuali
 * satu kontak untuk menguji deteksi opt-out.
 */
db.reset({
  users: [],
  destinations: [],
  packages: [],
  articles: [],
  bookings: [],
  messages: [],
  customers: [],
  reviews: [],
  broadcasts: [],
  waReminders: [],
  waInbound: [],
  waWebhookEvents: [],
  contacts: [
    { id: 'c1', name: 'Budi', phone: '628123456789', optIn: true, optOut: false }
  ],
  settings: { openwaWebhookSecret: SECRET },
  version: 1
});

const app = createApp();
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let pass = 0;
let fail = 0;

/**
 * Catat hasil satu pemeriksaan.
 * @param {string} name nama pemeriksaan
 * @param {function} fn pemeriksaan (harus melempar error bila gagal)
 */
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

/**
 * Kirim POST ke route webhook.
 *
 * @param {object} payload payload event
 * @param {object} [opts] { secret, signature, raw, idempotencyKey }
 * @returns {Promise<{status:number, body:string, json:object|null}>}
 */
function post(payload, opts) {
  const o = opts || {};
  const raw = o.raw !== undefined
    ? Buffer.from(o.raw)
    : Buffer.from(JSON.stringify(payload));

  const secret = o.secret === undefined ? SECRET : o.secret;
  const signature = o.signature !== undefined
    ? o.signature
    : 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-OpenWA-Signature': signature,
    'X-OpenWA-Event': (payload && payload.event) || 'message.received'
  };
  if (o.idempotencyKey) headers['X-OpenWA-Idempotency-Key'] = o.idempotencyKey;

  return new Promise((resolve, reject) => {
    const r = http.request(
      new URL('/api/webhooks/openwa', base),
      { method: 'POST', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch (_) {
            /* biarkan null */
          }
          resolve({ status: res.statusCode, body, json });
        });
      }
    );
    r.on('error', reject);
    r.write(raw);
    r.end();
  });
}

/**
 * Pesan masuk dari pelanggan.
 * @param {string} text isi pesan
 * @param {string} [from] JID pengirim
 * @returns {object} payload event
 */
function inboundEvent(text, from) {
  return {
    event: 'message.received',
    sessionId: 'sess-uji',
    data: {
      from: from || '628123456789@c.us',
      chatId: from || '628123456789@c.us',
      body: text,
      type: 'text',
      fromMe: false,
      isGroup: false,
      contact: { pushName: 'Budi' }
    }
  };
}

(async () => {
  console.log('\n== Signature & autentikasi ==');

  let res = await post(inboundEvent('halo kak'), { idempotencyKey: 'key-uji-1' });
  check('signature benar diterima (200)', () => {
    assert.strictEqual(res.status, 200, 'status ' + res.status);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.data.status, 'HANDLED');
  });

  res = await post(inboundEvent('halo lagi'), {
    idempotencyKey: 'key-uji-2',
    signature: 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  });
  check('signature salah ditolak (401)', () => {
    assert.strictEqual(res.status, 401, 'status ' + res.status);
  });

  res = await post(inboundEvent('halo'), { idempotencyKey: 'key-uji-3', secret: '' });
  check('secret kosong ditolak (401)', () => {
    assert.strictEqual(res.status, 401, 'status ' + res.status);
  });

  res = await post(null, { raw: '{bukan json', idempotencyKey: 'key-uji-4' });
  check('body JSON rusak ditolak (400)', () => {
    assert.strictEqual(res.status, 400, 'status ' + res.status);
  });

  res = await post({ event: 'message.received' }, { idempotencyKey: 'key-uji-5' });
  check('payload tidak lengkap ditolak (400)', () => {
    assert.strictEqual(res.status, 400, 'status ' + res.status);
  });

  console.log('\n== Idempotensi ==');

  res = await post(inboundEvent('duplikat'), { idempotencyKey: 'key-kembar' });
  check('event pertama diproses', () => {
    assert.strictEqual(res.json.data.status, 'HANDLED');
  });
  const firstCount = (db.read().waInbound || []).length;

  res = await post(inboundEvent('duplikat'), { idempotencyKey: 'key-kembar' });
  check('event kembar dikenali sebagai DUPLICATE (tidak diproses 2x)', () => {
    assert.strictEqual(res.status, 200, 'status ' + res.status);
    assert.strictEqual(res.json.data.status, 'DUPLICATE');
    assert.strictEqual(
      (db.read().waInbound || []).length,
      firstCount,
      'event kembar menambah pesan masuk lagi'
    );
  });

  console.log('\n== Pesan masuk & opt-out ==');

  check('pesan masuk tercatat di inbox admin', () => {
    const inbound = db.read().waInbound || [];
    assert.ok(inbound.length >= 1, 'pesan masuk tidak tercatat');
    // Inbox memakai `unshift` — pesan terbaru ada di indeks 0.
    assert.strictEqual(inbound[0].phone, '628123456789');
    assert.ok(
      inbound.some((m) => m.text === 'halo kak'),
      'pesan "halo kak" tidak ada di inbox'
    );
  });

  await post(inboundEvent('berhenti'), { idempotencyKey: 'key-stop' });
  check('pesan "berhenti" menandai kontak opt-out', () => {
    const contact = (db.read().contacts || []).find((c) => c.id === 'c1');
    assert.strictEqual(contact.optOut, true, 'kontak belum ditandai opt-out');
  });

  const before = (db.read().waInbound || []).length;
  await post(inboundEvent('halo grup', '628999999999-123@g.us'), {
    idempotencyKey: 'key-grup'
  });
  check('pesan grup diabaikan', () => {
    assert.strictEqual(
      (db.read().waInbound || []).length,
      before,
      'pesan grup ikut masuk inbox'
    );
  });

  console.log('\n== Jejak event ==');
  check('jejak event tersimpan dengan idempotency key', () => {
    const events = db.read().waWebhookEvents || [];
    assert.ok(events.length >= 4, 'jejak event kurang: ' + events.length);
    assert.ok(events.every((e) => e.idempotencyKey), 'ada jejak tanpa idempotencyKey');
  });

  server.close();
  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  try {
    server.close();
  } catch (_) {
    /* abaikan */
  }
  process.exit(1);
});
