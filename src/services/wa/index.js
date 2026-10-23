'use strict';

/**
 * index.js — Facade layanan WhatsApp.
 *
 * Dua provider didukung:
 *   • 'cloud' — WhatsApp Cloud API resmi (Meta). Butuh token + phone id.
 *   • 'web'   — WhatsApp Web multi-device (Baileys). Butuh pemindaian QR.
 *
 * Provider dipilih lewat `settings.waProvider` (default: 'cloud' sehingga
 * perilaku lama TIDAK berubah). Semua modul lain cukup memanggil API di
 * bawah — tidak perlu tahu provider mana yang aktif.
 *
 * API publik (kompatibel dengan versi sebelumnya):
 *   config, isActive, isQuietHour, normalizePhone, marketableContacts,
 *   sendText, startBroadcast, MAX_PER_RUN, MIN_DELAY_MS
 *
 * API baru:
 *   providerOf(settings), providerInfo(settings), status(settings),
 *   connectWeb, disconnectWeb, logoutWeb, refreshQr, checkConnection
 */

const db = require('../../db');
const cloud = require('./cloud');
const web = require('./web');

const MAX_PER_RUN = cloud.MAX_PER_RUN;
const MIN_DELAY_MS = cloud.MIN_DELAY_MS;

const PROVIDERS = {
  cloud: {
    key: 'cloud',
    label: 'WhatsApp Cloud API (Meta)',
    description: 'Kirim pesan memakai token resmi Meta. Tidak perlu scan QR.'
  },
  web: {
    key: 'web',
    label: 'WhatsApp Web (scan QR)',
    description: 'Sesi WhatsApp Web lokal. Pindai QR dari ponsel untuk menyambung.'
  }
};

function providerOf(settings) {
  const p = String((settings && settings.waProvider) || 'cloud').toLowerCase();
  return PROVIDERS[p] ? p : 'cloud';
}

function config(settings) {
  return cloud.config(settings);
}

function isQuietHour() {
  return cloud.isQuietHour();
}

function normalizePhone(raw) {
  return cloud.normalizePhone(raw);
}

/** Apakah layanan yang dipilih siap dipakai? */
function isActive(settings) {
  if (providerOf(settings) === 'web') return web.snapshot().status === 'connected';
  return cloud.isActive(settings);
}

/** Daftar kontak yang boleh menerima pesan blast (opt-in + bukan opt-out). */
function marketableContacts() {
  const data = db.read();
  return (data.contacts || []).filter(
    (c) => c.optIn && !c.optOut && normalizePhone(c.phone).length >= 9
  );
}

/** Kirim pesan lewat provider yang aktif. Throw bila gagal. */
async function sendText(settings, phoneRaw, text) {
  if (providerOf(settings) === 'web') {
    return web.sendText(phoneRaw, text);
  }
  return cloud.sendText(settings, phoneRaw, text);
}

/** Ringkasan status provider aktif (untuk panel admin). */
async function status(settings) {
  const provider = providerOf(settings);
  if (provider === 'web') {
    const snap = web.snapshot();
    return {
      provider,
      label: PROVIDERS.web.label,
      description: PROVIDERS.web.description,
      state: snap.status,
      stateLabel: web.statusLabel(),
      active: snap.status === 'connected',
      qr: snap.qr,
      me: snap.me,
      connectedAt: snap.connectedAt,
      lastError: snap.lastError,
      attempts: snap.attempts,
      updatedAt: snap.updatedAt,
      log: snap.log,
      available: snap.available,
      installHint: snap.available ? '' : web.unavailableMessage(),
      message:
        snap.status === 'connected'
          ? 'Sesi WhatsApp Web aktif dan siap mengirim pesan.'
          : snap.status === 'scanning'
            ? 'Menunggu QR dipindai dari ponsel.'
            : snap.lastError || 'Sesi WhatsApp Web belum terhubung.'
    };
  }

  // Cloud API: status dihitung dari konfigurasi lokal (tanpa panggilan
  // jaringan) supaya halaman admin tetap cepat. Pemeriksaan ke Meta hanya
  // dilakukan saat pengguna menekan tombol "Periksa Koneksi".
  const configured = cloud.isActive(settings);
  return {
    provider,
    label: PROVIDERS.cloud.label,
    description: PROVIDERS.cloud.description,
    state: configured ? 'connected' : 'disconnected',
    stateLabel: configured ? 'Terhubung' : 'Belum Dikonfigurasi',
    active: configured,
    qr: null,
    me: null,
    connectedAt: null,
    lastError: configured ? null : 'Token atau Phone Number ID belum diisi di Pengaturan → WhatsApp.',
    attempts: 0,
    updatedAt: new Date().toISOString(),
    log: [],
    available: true,
    installHint: '',
    message: configured
      ? 'Token & Phone Number ID tersimpan. Tekan "Periksa Koneksi" untuk memvalidasi ke Meta.'
      : 'Belum dikonfigurasi. Isi token & Phone Number ID di Pengaturan → WhatsApp.'
  };
}

/**
 * Blast satu template ke semua kontak marketable.
 * Mengembalikan job id; progres disimpan di db (data.broadcasts).
 * Sifatnya berhati-hati: berhenti setelah 5 gagal beruntun, hormati
 * quiet hour (kecuali force), dan selalu tulis log per nomor.
 */
async function startBroadcast({ templateBody, segment, dryRun }) {
  const data = db.read();
  const settings = data.settings || {};
  const provider = providerOf(settings);

  if (!isActive(settings) && !dryRun) {
    throw new Error(
      provider === 'web'
        ? 'Sesi WhatsApp Web belum terhubung. Pindai QR di panel WhatsApp terlebih dahulu.'
        : 'WhatsApp Cloud API belum dikonfigurasi. Atur token di Pengaturan atau gunakan mode uji.'
    );
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
    provider,
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
        job.results.push({
          phone: contact.phone,
          name: contact.name,
          status: 'failed',
          error: String(err.message || err).slice(0, 200)
        });
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

/* ------------------------------------------------------------------ */
/* Kontrol sesi WhatsApp Web                                           */
/* ------------------------------------------------------------------ */

function connectWeb() {
  return web.connect();
}

function disconnectWeb() {
  return web.disconnect();
}

function logoutWeb() {
  return web.logout();
}

function refreshQr() {
  return web.refreshQr();
}

function webStatus() {
  return web.snapshot();
}

function checkConnection(settings) {
  return cloud.checkConnection(settings);
}

module.exports = {
  // API lama (kompatibel penuh)
  config,
  isActive,
  isQuietHour,
  normalizePhone,
  marketableContacts,
  sendText,
  startBroadcast,
  MAX_PER_RUN,
  MIN_DELAY_MS,
  // API baru
  PROVIDERS,
  providerOf,
  providerInfo: (settings) => PROVIDERS[providerOf(settings)],
  status,
  connectWeb,
  disconnectWeb,
  logoutWeb,
  refreshQr,
  webStatus,
  checkConnection,
  web
};
