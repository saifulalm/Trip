'use strict';

/**
 * Layanan webhook WhatsApp OpenWA.
 *
 * OpenWA mengirim event ke backend lewat HTTP POST. Dua hal wajib dijaga di
 * sisi penerima:
 *
 * 1. **Verifikasi tanda tangan.** Setiap delivery membawa header
 *    `X-OpenWA-Signature` berisi HMAC-SHA256 atas *body yang persis sama
 *    dengan yang dikirim gateway* (header `sha256=<hex>`). Body yang sudah
 *    di-parse lalu di-stringify ulang bisa berubah urutan kuncinya sehingga
 *    HMAC tidak cocok — jadi signature HARUS dihitung atas buffer asli
 *    sebelum di-parse.
 *
 * 2. **Idempotensi.** OpenWA mengirim ulang event yang sama saat delivery
 *    gagal (retry) atau saat proses gateway di-restart (replay outbox).
 *    Kunci idempotensi dikirim di header `X-OpenWA-Idempotency-Key` dan
 *    stabil antar percobaan. Kunci ini disimpan di `data.waWebhookEvents`
 *    sehingga event kembar tidak pernah diproses dua kali.
 *
 * Modul ini juga menangani event yang benar-benar mengubah state aplikasi:
 *  - `message.received` → pesan masuk dicatat + deteksi opt-out "berhenti".
 */

const crypto = require('crypto');
const db = require('../db');
const realtime = require('./realtime');

/**
 * Header yang dipakai OpenWA.
 *
 * `X-OpenWA-Idempotency-Key` stabil antar retry, sedangkan
 * `X-OpenWA-Delivery-Id` selalu baru tiap percobaan — jadi yang dipakai
 * untuk dedup adalah yang pertama.
 */
const OPENWA_HEADERS = {
  event: 'x-openwa-event',
  signature: 'x-openwa-signature',
  idempotencyKey: 'x-openwa-idempotency-key',
  deliveryId: 'x-openwa-delivery-id',
  retryCount: 'x-openwa-retry-count'
};

/** Batas jumlah jejak event yang disimpan (jaga db.json tetap ringan). */
const MAX_EVENTS = 1000;

/**
 * Kata kunci yang menandakan pelanggan minta berhenti menerima pesan.
 *
 * Daftar ini sama dengan yang dipakai modul WhatsApp Web sebelumnya, jadi
 * perilaku opt-out tidak berubah bagi pelanggan.
 */
const STOP_KEYWORDS = [
  'stop',
  'berhenti',
  'stop dulu',
  'batal',
  'unsubscribe',
  'cancel',
  'jangan kirim',
  'jangan kirim lagi'
];

/**
 * Verifikasi tanda tangan HMAC-SHA256 dari OpenWA.
 *
 * Perbandingan dilakukan dengan `timingSafeEqual` supaya waktu eksekusi
 * tidak membocorkan informasi byte demi byte. Panjang yang berbeda langsung
 * ditolak — `timingSafeEqual` melempar error kalau panjangnya beda.
 *
 * @param {Buffer} rawBody body mentah yang diterima
 * @param {string} [signature] nilai header `X-OpenWA-Signature`
 * @param {string} secret secret webhook
 * @returns {boolean} true bila signature cocok
 */
function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;

  const received = Buffer.from(String(signature));
  const computed = Buffer.from(expected);

  if (received.length !== computed.length) return false;

  return crypto.timingSafeEqual(received, computed);
}

/**
 * Deteksi pesan "berhenti" dari pelanggan → tandai opt-out.
 *
 * @param {string} text isi pesan
 * @returns {boolean} true bila pesan berarti opt-out
 */
function detectStop(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return STOP_KEYWORDS.some(
    (k) => t === k || t.startsWith(`${k} `) || t.startsWith(`${k},`)
  );
}

/**
 * Ambil nomor polos dari JID WhatsApp.
 *
 * OpenWA memakai JID (`628123456789@c.us`), sedangkan aplikasi menyimpan
 * nomor polos pada daftar kontak.
 *
 * @param {string} [jid] JID WhatsApp
 * @returns {string} nomor polos (string kosong bila tidak bisa dibaca)
 */
function jidToPhone(jid) {
  if (!jid) return '';
  const digits = String(jid).replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

/**
 * Normalisasi nomor ke format internasional (62xxx) — sama aturan dengan
 * `wa.normalizePhone` supaya cocok dengan data kontak.
 *
 * @param {string} raw nomor mentah
 * @returns {string} nomor ternormalisasi
 */
function normalizePhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  else if (p.startsWith('8')) p = `62${p}`;
  return p;
}

/**
 * Ambil tabel jejak event webhook.
 * @param {object} data data situs
 * @returns {object[]} daftar event
 */
function eventStore(data) {
  if (!Array.isArray(data.waWebhookEvents)) data.waWebhookEvents = [];
  return data.waWebhookEvents;
}

/**
 * Proses pesan masuk: simpan ke kotak pesan admin + deteksi opt-out.
 *
 * Ini adalah pengganti langsung `handleInbound()` dari modul WhatsApp Web
 * yang lama — sumber datanya berubah dari event library jadi event webhook.
 *
 * @param {object[]} messages daftar payload pesan
 * @returns {{changed:boolean, optOut:boolean}} ringkasan
 */
function handleInbound(messages) {
  const data = db.read();
  if (!data) return { changed: false, optOut: false };

  const list = Array.isArray(data.waInbound) ? data.waInbound : (data.waInbound = []);
  const contacts = data.contacts || (data.contacts = []);
  let changed = false;
  let optOut = false;

  for (const msg of messages || []) {
    if (!msg || msg.fromMe) continue;

    // Abaikan pesan grup & status (bukan percakapan pribadi).
    const remote = String(msg.from || msg.chatId || '');
    if (!remote || remote.includes('@g.us') || remote.includes('@broadcast')) continue;
    if (msg.isGroup) continue;

    const text = String(msg.body || '').trim();
    const phone = jidToPhone(remote);
    if (!phone) continue;

    // Nama pengirim: OpenWA menaruhnya di `contact.pushName`.
    const contactInfo = msg.contact || {};
    const pushname = String(
      contactInfo.pushName || contactInfo.name || msg.pushName || ''
    ).trim();

    list.unshift({
      id: db.uid('wam'),
      phone,
      name: pushname || phone,
      text: text.slice(0, 1000),
      fromMe: false,
      createdAt: new Date().toISOString()
    });
    changed = true;

    // Kata "berhenti" otomatis menonaktifkan promo untuk nomor tersebut.
    if (detectStop(text)) {
      const c = contacts.find((x) => normalizePhone(x.phone) === phone);
      if (c && !c.optOut) {
        c.optOut = true;
        c.optOutAt = new Date().toISOString();
        changed = true;
        optOut = true;
      }
    }
  }

  // Jaga inbox tetap ringan: simpan 500 pesan terakhir.
  if (list.length > 500) list.length = 500;
  if (changed) db.write();

  // Siarkan ke panel admin (realtime) supaya pesan masuk langsung terlihat.
  if (changed) {
    realtime.publish(realtime.EVENTS.INBOUND, {
      count: (messages || []).length,
      optOut,
      latest: list[0] || null,
      at: new Date().toISOString()
    });
    if (optOut) {
      realtime.publish(realtime.EVENTS.CONTACT, {
        action: 'opt-out',
        optOut: true,
        at: new Date().toISOString()
      });
    }
  }

  return { changed, optOut };
}

/**
 * Proses satu event webhook.
 *
 * Alur:
 *  1. Simpan event dengan kunci idempotensi. Kalau kuncinya sudah ada,
 *     event diabaikan (dan dianggap berhasil — supaya OpenWA berhenti retry).
 *  2. Tangani `message.received` → catat pesan masuk + deteksi opt-out.
 *
 * @param {object} event payload webhook
 * @param {Buffer} rawBody body mentah (untuk fallback hash idempotensi)
 * @returns {{status:'HANDLED'|'DUPLICATE'|'IGNORED', message:string}} hasil
 */
function handleEvent(event, rawBody) {
  const data = db.read();
  if (!data) return { status: 'IGNORED', message: 'Data situs belum siap.' };

  const store = eventStore(data);

  // Kunci idempotensi: header lebih dulu, fallback ke hash isi payload.
  // Tanpa header, event kembar tetap bisa dikenali karena isinya identik.
  const idempotencyKey = String(event.idempotencyKey || '').trim()
    || crypto.createHmac('sha256', 'sabesi-openwa-webhook')
      .update(rawBody)
      .digest('hex');

  // Kunci yang sama → event sudah pernah masuk. Balas 200 supaya OpenWA
  // berhenti mencoba mengirim ulang.
  if (store.some((e) => e.idempotencyKey === idempotencyKey)) {
    return { status: 'DUPLICATE', message: 'Event sudah pernah diproses.' };
  }

  store.unshift({
    idempotencyKey,
    event: event.event || '',
    sessionId: event.sessionId || '',
    deliveryId: event.deliveryId || '',
    receivedAt: new Date().toISOString()
  });
  if (store.length > MAX_EVENTS) store.length = MAX_EVENTS;

  const payload = event.data || {};

  if (event.event === 'message.received') {
    handleInbound([payload]);
  }

  db.write();

  // Status perangkat / session ikut disiarkan supaya panel WhatsApp
  // menunjukkan perubahan tanpa perlu memuat ulang halaman.
  if (event.event === 'session.status' || event.event === 'session.updated') {
    realtime.publish(realtime.EVENTS.GATEWAY, {
      status: (payload && (payload.status || payload.state)) || 'unknown',
      sessionId: event.sessionId || '',
      at: new Date().toISOString()
    });
  }

  return { status: 'HANDLED', message: 'Event diproses.' };
}

/**
 * Daftar event inbound terakhir — dipakai panel admin.
 * @param {number} [limit] jumlah maksimum
 * @returns {object[]} daftar event
 */
function listEvents(limit) {
  const data = db.read() || {};
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return (data.waWebhookEvents || []).slice(0, n);
}

module.exports = {
  OPENWA_HEADERS,
  STOP_KEYWORDS,
  MAX_EVENTS,
  verifySignature,
  detectStop,
  jidToPhone,
  normalizePhone,
  handleInbound,
  handleEvent,
  listEvents
};
