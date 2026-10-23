'use strict';

/**
 * cloud.js — Layanan WhatsApp resmi via WhatsApp Cloud API (Meta).
 *
 * HATI-HATI: hanya kirim ke nomor yang sudah memberi izin (opt-in),
 * hormati daftar opt-out, patuhi rate-limit, dan sediakan test-send.
 * Jika token belum diatur, layanan berstatus "belum aktif" dan blast
 * diblokir agar tidak ada pengiriman tidak sengaja.
 *
 * Modul ini TIDAK melakukan koneksi socket — jadi tidak ada memory leak
 * maupun socket disconnect yang perlu ditangani di sini.
 */

const API_VERSION = 'v20.0';
const MIN_DELAY_MS = 1000; // jeda minimum antar pesan
const MAX_PER_RUN = 50; // batas pesan per satu kali blast
const QUIET_START = 21; // jangan kirim antara 21.00–08.00 (waktu server)
const QUIET_END = 8;

function config(settings) {
  return {
    token: (settings && settings.waToken) || process.env.WA_TOKEN || '',
    phoneId: (settings && settings.waPhoneId) || process.env.WA_PHONE_NUMBER_ID || ''
  };
}

function isActive(settings) {
  const c = config(settings);
  return Boolean(c.token && c.phoneId);
}

function isQuietHour() {
  const h = new Date().getHours();
  return h >= QUIET_START || h < QUIET_END;
}

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  return p;
}

/** Kirim satu pesan teks via Cloud API. Throw bila gagal. */
async function sendText(settings, phoneRaw, text) {
  const c = config(settings);
  if (!isActive(settings)) throw new Error('WhatsApp Cloud API belum aktif (token/phone id kosong).');
  const to = normalizePhone(phoneRaw);
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

/**
 * Periksa apakah kredensial Cloud API valid dengan memanggil endpoint
 * info nomor. Dipakai tombol "Periksa Koneksi" di panel admin.
 * Tidak melempar error — selalu mengembalikan objek status.
 */
async function checkConnection(settings) {
  const c = config(settings);
  if (!isActive(settings)) {
    return {
      ok: false,
      active: false,
      message: 'Token atau Phone Number ID belum diisi di Pengaturan → WhatsApp.'
    };
  }
  try {
    const url =
      `https://graph.facebook.com/${API_VERSION}/${c.phoneId}` +
      `?fields=display_name,verified_name,quality_rating&access_token=${encodeURIComponent(c.token)}`;
    const res = await fetch(url, { method: 'GET' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
      return { ok: false, active: true, message: 'Kredensial ditolak Meta: ' + msg };
    }
    const name = body.display_name || body.verified_name || c.phoneId;
    return {
      ok: true,
      active: true,
      displayName: name,
      qualityRating: body.quality_rating || '',
      message: 'Token valid. Nomor terdaftar: ' + name + '.'
    };
  } catch (err) {
    return { ok: false, active: true, message: 'Gagal menghubungi Meta: ' + (err.message || err) };
  }
}

module.exports = {
  API_VERSION,
  MIN_DELAY_MS,
  MAX_PER_RUN,
  QUIET_START,
  QUIET_END,
  config,
  isActive,
  isQuietHour,
  normalizePhone,
  sendText,
  checkConnection
};
