'use strict';

/**
 * Layanan WhatsApp resmi via WhatsApp Cloud API (Meta).
 * HATI-HATI: hanya kirim ke nomor yang sudah memberi izin (opt-in),
 * hormati daftar opt-out, patuhi rate-limit, dan sediakan test-send.
 * Jika token belum diatur, layanan berstatus "belum aktif" dan blast
 * diblokir agar tidak ada pengiriman tidak sengaja.
 */

const db = require('../db');

const API_VERSION = 'v20.0';
const MIN_DELAY_MS = 1000; // jeda minimum antar pesan
const MAX_PER_RUN = 50; // batas pesan per satu kali blast
const QUIET_START = 21; // jangan kirim antara 21.00–08.00 (waktu server)
const QUIET_END = 8;

function config(settings) {
  return {
    token: settings.waToken || process.env.WA_TOKEN || '',
    phoneId: settings.waPhoneId || process.env.WA_PHONE_NUMBER_ID || ''
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

/** Daftar kontak yang boleh menerima pesan blast (opt-in + bukan opt-out). */
function marketableContacts() {
  const data = db.read();
  return (data.contacts || []).filter((c) => c.optIn && !c.optOut && normalizePhone(c.phone).length >= 9);
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
 * Blast satu template ke semua kontak marketable.
 * Mengembalikan job id; progres disimpan di db (data.broadcasts).
 * Sifatnya berhati-hati: berhenti setelah 5 gagal beruntun, hormati
 * quiet hour (kecuali force), dan selalu tulis log per nomor.
 */
async function startBroadcast({ templateBody, segment, dryRun }) {
  const data = db.read();
  const settings = data.settings;
  if (!isActive(settings) && !dryRun) {
    throw new Error('WhatsApp Cloud API belum dikonfigurasi. Atur token di Pengaturan atau gunakan mode uji.');
  }
  let targets = marketableContacts();
  if (segment === 'booking') {
    const withBooking = new Set((data.bookings || []).map((b) => normalizePhone(b.phone)));
    targets = targets.filter((c) => withBooking.has(normalizePhone(c.phone)));
  } else if (segment === 'leads') {
    const leads = new Set((data.messages || []).map((m) => normalizePhone(m.phone)));
    targets = targets.filter((c) => leads.has(normalizePhone(c.phone)));
  }
  targets = targets.slice(0, MAX_PER_RUN);

  const job = {
    id: db.uid('bc'),
    template: String(templateBody || '').slice(0, 1500),
    segment,
    dryRun: Boolean(dryRun),
    status: dryRun ? 'done' : 'queued',
    total: targets.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    results: [],
    createdAt: new Date().toISOString(),
    finishedAt: dryRun ? new Date().toISOString() : null
  };
  data.broadcasts = data.broadcasts || [];
  data.broadcasts.unshift(job);
  db.write();

  if (dryRun) return job;
  if (isQuietHour()) {
    job.status = 'blocked';
    db.write();
    throw new Error('Sedang jam tenang (21.00–08.00). Blast dibatalkan demi etika pengiriman.');
  }

  // Jalankan async, tidak memblokir request.
  (async () => {
    let consecutiveFail = 0;
    for (const contact of targets) {
      if (consecutiveFail >= 5) {
        job.status = 'aborted';
        break;
      }
      const text = String(job.template)
        .replace(/\{\{nama\}\}/g, contact.name || 'Kak')
        .replace(/\{\{kota\}\}/g, contact.city || 'Indonesia');
      try {
        if (!job.dryRun) await sendText(settings, contact.phone, text);
        job.sent += 1;
        consecutiveFail = 0;
        job.results.push({ phone: contact.phone, name: contact.name, status: 'sent' });
      } catch (err) {
        job.failed += 1;
        consecutiveFail += 1;
        job.results.push({ phone: contact.phone, name: contact.name, status: 'failed', error: String(err.message || err).slice(0, 200) });
      }
      db.write();
      await new Promise((r) => setTimeout(r, MIN_DELAY_MS));
    }
    if (job.status === 'queued') job.status = 'done';
    job.finishedAt = new Date().toISOString();
    db.write();
  })().catch((err) => {
    job.status = 'error';
    job.error = String(err.message || err);
    job.finishedAt = new Date().toISOString();
    db.write();
  });

  return job;
}

module.exports = {
  config,
  isActive,
  isQuietHour,
  normalizePhone,
  marketableContacts,
  sendText,
  startBroadcast,
  MAX_PER_RUN,
  MIN_DELAY_MS
};