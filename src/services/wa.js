'use strict';

/**
 * Layanan WhatsApp.
 *
 * Kanal sending: SATU SAJA — gateway WhatsApp open-source **OpenWA**
 * (self-hosted, REST API + webhook). Scan QR / kode pairing sekali di
 * gateway, lalu blast & pengingat berjalan otomatis.
 *
 * CATATAN: WhatsApp Cloud API resmi (Meta) SUDAH DIHAPUS. Kanal itu berbayar
 * (butuh token berbayar & approval Meta) dan bertentangan dengan permintaan
 * "pakai yang open-source". Generasi berikutnya memakai gateway
 * OpenWA (self-hosted, REST API) — backend tidak menjalankan browser.
 *
 * Aturan etika yang TIDAK boleh dilanggar:
 *  - hanya kirim ke kontak yang opt-in,
 *  - opt-out selalu menang atas opt-in,
 *  - jam tenang (bawaan 21.00–08.00) menunda, bukan membatalkan,
 *  - izin dicek ULANG saat pengiriman (bukan hanya saat job dibuat),
 *  - setiap nomor punya hasil tercatat di log job.
 */

const db = require('../db');
const gateway = require('./wa-gateway');

const MIN_DELAY_MS = 5000; // jeda minimum antar pesan (5 detik — lebih aman untuk hindari rate-limit)
const MAX_PER_RUN = 30; // batas pesan per satu kali blast (lebih konservatif — 50 terlalu cepat)
const MAX_SENDS_PER_DAY = 100; // batas global harian (semua blast, total)
const FREQUENCY_CAP_PER_CONTACT_PER_DAY = 3; // max 3 pesan per kontak per hari
const QUIET_START = 21; // jangan kirim antara 21.00–08.00 (waktu server)
const QUIET_END = 8;

/** Nama pengganti yang dipakai saat nama kontak tidak tersedia. */
const DEFAULT_NAME = 'Kak';

/**
 * Ambil settings aktif.
 *
 * Bila `settings` tidak diberikan (undefined), settings diambil dari db.
 * Objek kosong `{}` dipakai apa adanya — pemanggil yang sudah memegang
 * settings tidak boleh diam-diam ditimpa data db.
 *
 * @param {object} [settings] settings situs
 * @returns {object} settings yang dipakai
 */
function resolveSettings(settings) {
  if (settings && typeof settings === 'object') return settings;
  const data = db.read();
  return (data && data.settings) || {};
}

/**
 * Rentang jam tenang dari settings, dengan fallback ke bawaan.
 *
 * Nilai start == end berarti jam tenang NONAKTIF (tidak ada jam yang diblokir).
 *
 * @param {object} [settings] settings situs
 * @returns {{start: number, end: number}} rentang jam tenang
 */
function quietWindow(settings) {
  const s = resolveSettings(settings);
  const start = normalizeHour(s.waQuietStart, QUIET_START);
  const end = normalizeHour(s.waQuietEnd, QUIET_END);
  return { start, end };
}

/**
 * Normalkan nilai jam ke rentang 0–23.
 *
 * Nilai di luar rentang (mis. 24 atau -1) TIDAK di-clamp melainkan memakai
 * nilai bawaan. Alasannya: clamping membuat jam quiet "hampir 24 jam"
 * (mis. 99 -> 23) sehingga pesan tersendat tanpa disengaja, dan
 * administrator bisa melihat pengaturan di form dengan nilai berbeda dari
 * yang benar-benar dipakai. Abaikan nilai aneh, pakai bawaan.
 *
 * @param {*} value nilai mentah
 * @param {number} fallback nilai bawaan bila bukan jam valid
 * @returns {number} jam valid 0–23
 */
function normalizeHour(value, fallback) {
  // Tolak null/''/false/[] sebelum ke Number(): Number(null) dan Number('')
  // sama-sama 0, sehingga nilai kosong akan dianggap jam 0 yang sah —
  // bukan "pengaturan tidak ada" yang harus memakai bawaan.
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (n < 0 || n > 23) return fallback;
  return n;
}

/**
 * Jam saat ini (0–23).
 *
 * Fungsi ini dipisah agar waktu bisa dikendalikan dari uji: `isQuietHour`
 * menerima jam eksplisit sehingga hasilnya tidak bergantung jam mesin.
 *
 * @param {Date} [now] waktu acuan
 * @returns {number} jam 0–23
 */
function currentHour(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getHours();
}

/**
 * Apakah sekarang berada di dalam jam tenang.
 *
 * @param {object} [settings] settings situs
 * @param {Date} [now] waktu acuan (default: waktu saat ini)
 * @returns {boolean} true bila jam tenang aktif dan sekarang di dalam rentangnya
 */
function isQuietHour(settings, now) {
  const { start, end } = quietWindow(settings);
  if (start === end) return false; // jam tenang dimatikan
  const h = currentHour(now);
  // Jendela yang melewati tengah malam (mis. 21 → 08).
  if (start > end) return h >= start || h < end;
  return h >= start && h < end;
}

/**
 * Label rentang jam tenang, mis. "21.00–08.00".
 * @param {object} [settings] settings situs
 * @returns {string} label jam tenang
 */
function quietLabel(settings) {
  const { start, end } = quietWindow(settings);
  const fmt = (h) => `${String(h).padStart(2, '0')}.00`;
  return `${fmt(start)}–${fmt(end)}`;
}

/**
 * Apakah perangkat WhatsApp (gateway OpenWA) siap menerima pesan.
 *
 * Membaca cache status yang diperbarui polling berkala — tidak memanggil
 * jaringan, karena fungsi ini dipanggil worker untuk setiap pesan.
 *
 * @returns {boolean} true bila perangkat siap
 */
function isReady() {
  return gateway.isReady();
}

/**
 * Apakah ada kanal WhatsApp yang siap menerima pesan.
 *
 * Kanal tunggal: perangkat WhatsApp Web.
 *
 * @returns {boolean} true bila perangkat siap
 */
function canSend() {
  return isReady();
}

/**
 * Normalisasi nomor ke format internasional tanpa tanda + / spasi.
 *
 * Aturan:
 *  - "+62..." → "62..."
 *  - "08..."  → "62..." (prefix 0 lokal diganti 62)
 *  - "8..."   → "628..." (nomor tanpa 0 tapi awalan 8 → 628)
 *
 * @param {string} raw nomor mentah
 * @returns {string} nomor ternormalisasi
 */
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  else if (p.startsWith('8')) p = `62${p}`;
  return p;
}

/**
 * Validasi nomor WhatsApp.
 *
 * Nomor Indonesia: 62 + 8..13 digit. Nomor internasional lain: 7..15 digit.
 *
 * @param {string} raw nomor mentah
 * @returns {boolean} true bila format plausible
 */
function isValidPhone(raw) {
  const p = normalizePhone(raw);
  if (!/^\d+$/.test(p)) return false;
  if (p.length < 9 || p.length > 16) return false;
  return true;
}

/**
 * Alias placeholder → nama nilai yang mungkin dipakai di data.
 *
 * Template memakai bahasa awam ({{nama}}, {{kode}}, {{tanggal}}) sedangkan
 * data internal memakai nama field ({{name}}, {{code}}, {{departureDate}}).
 * Alias ini menjembatani keduanya supaya admin tidak perlu menghafal nama
 * kolom database saat menulis pesan.
 */
const PLACEHOLDER_ALIASES = {
  nama: ['nama', 'name', 'customerName'],
  kode: ['kode', 'code', 'bookingCode'],
  namaPaket: ['namaPaket', 'packageName', 'paket'],
  tanggal: ['tanggal', 'departureDate', 'tanggalKeberangkatan'],
  link: ['link', 'paymentUrl', 'url'],
  detail: ['detail', 'summary', 'deskripsi']
};

/**
 * Render template pesan dengan placeholder {{nama}}.
 *
 * Placeholder yang didukung (lihat reminder.ejs):
 *   {{nama}}, {{kode}}, {{namaPaket}}, {{tanggal}}, {{link}}, {{detail}}
 *
 * Placeholder {{nama}} yang nilainya kosong diganti "Kak" supaya pesan tetap
 * natural. Placeholder lain yang tidak punya nilai dibiarkan apa adanya
 * agar admin sempat melihat template dan tahu data mana yang kurang.
 *
 * @param {string} template teks template
 * @param {object} [vars] nilai per-contact (mis. { name: 'Budi' })
 * @param {object} [ctx] nilai bersama (mis. { code: 'JJE-1' })
 * @returns {string} teks hasil render
 */
function renderTemplate(template, vars = {}, ctx = {}) {
  const all = Object.assign({}, ctx, vars);
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const aliases = PLACEHOLDER_ALIASES[key] || [key];
    let val;
    for (const alias of aliases) {
      val = all[alias];
      if (val !== undefined && val !== null && val !== '') break;
    }
    if (val === undefined || val === null || val === '') {
      if (key === 'nama') return DEFAULT_NAME;
      return match;
    }
    return String(val);
  });
}

/**
 * Daftar kontak yang boleh menerima pesan blast (opt-in + bukan opt-out).
 *
 * @param {object} [data] data situs (default: baca dari db)
 * @returns {object[]} kontak yang boleh diberi pesan
 */
function marketableContacts(data) {
  const d = data || db.read() || {};
  return (d.contacts || []).filter(
    (c) => c.optIn && !c.optOut && isValidPhone(c.phone)
  );
}

/**
 * Saring kontak menurut segmen blast.
 *
 * Segmen:
 *  - all       : semua kontak marketable
 *  - booking   : kontak yang pernah melakukan booking
 *  - leads     : kontak yang berasal dari pesan kontak (lead)
 *  - customers : kontak yang juga terdaftar sebagai pelanggan akun
 *
 * @param {object} [data] data situs (default: baca dari db)
 * @param {string} [segment] nama segmen
 * @returns {object[]} kontak sesuai segmen
 */
function segmentTargets(data, segment) {
  const d = data || db.read() || {};
  const base = marketableContacts(d);
  const phones = (list) => new Set((list || []).map((x) => normalizePhone(x.phone)));

  if (segment === 'booking') {
    const withBooking = phones(d.bookings);
    return base.filter((c) => withBooking.has(normalizePhone(c.phone)));
  }
  if (segment === 'leads') {
    const leads = phones(d.messages);
    return base.filter((c) => leads.has(normalizePhone(c.phone)));
  }
  if (segment === 'customers') {
    const customers = phones(d.customers);
    return base.filter((c) => customers.has(normalizePhone(c.phone)));
  }
  return base;
}

/**
 * Cari kontak berdasarkan nomor (untuk pengecekan izin saat pengiriman).
 * @param {object} data data situs
 * @param {string} phone nomor
 * @returns {object|null} kontak atau null
 */
function contactFor(data, phone) {
  const p = normalizePhone(phone);
  const d = data || db.read() || {};
  return (d.contacts || []).find((c) => normalizePhone(c.phone) === p) || null;
}

/**
 * Kirim pesan teks lewat gateway OpenWA.
 *
 * @param {object} [settings] settings situs
 * @param {string} phoneRaw nomor tujuan
 * @param {string} text isi pesan
 * @returns {Promise<object>} hasil pengiriman
 */
async function sendText(settings, phoneRaw, text) {
  // Cek batas harian global & frekuensi per kontak (anti-spam)
  const capped = checkFrequencyCap(phoneRaw, settings);
  const limited = checkDailyLimit(settings);
  if (!capped.allowed || !limited.allowed) {
    const reason = !capped.allowed ? capped.reason : limited.reason;
    throw new Error(`Kirim diblokir: ${reason}`);
  }
  return gateway.sendText(phoneRaw, text, settings);
}


  async function deliverTo(target, text) {
  const data = db.read() || {};
  const phone = normalizePhone(target.phone);
  const contact = contactFor(data, phone);

  if (!contact) {
    return { status: 'skipped', reason: 'nomor tidak terdaftar' };
  }
  if (contact.optOut) {
    return { status: 'skipped', reason: 'opted-out' };
  }
  if (!contact.optIn) {
    return { status: 'skipped', reason: 'tidak mengizinkan pesan' };
  }

  // Cek frekuensi harian & batas harian global
  const capped = checkFrequencyCap(phone, data.settings);
  const limited = checkDailyLimit(data.settings);
  if (!capped.allowed || !limited.allowed) {
    const reason = !capped.allowed ? capped.reason : limited.reason;
    return { status: 'skipped', reason: `diblokir: ${reason}` };
  }

  // Kirim lewat perangkat WhatsApp Web (kanal tunggal).
  const settings = data.settings || {};
  let res;
  try {
    res = await sendVia(settings, phone, text);
  } catch (err) {
    // Log kirim gagal
    logSend({ phone, name: target.name, status: 'failed', error: String(err.message || err) });
    return { status: 'failed', reason: String(err.message || err).slice(0, 200) };
  }

  // Simpan log kirim berhasil
  logSend({ phone, name: target.name, status: 'sent', template: text });

  return { status: 'sent', via: res.via };
}

/**
 * Cek frekuensi kirim per kontak harian (max 3/hari).
 * Mengembalikan: { allowed: boolean, reason?: string }
 */

/**
 * Kirim pesan melalui kanal yang tersedia (gateway OpenWA).
 *
 * Kanal tunggal: gateway WhatsApp open-source OpenWA. Tidak ada lagi
 * perangkat WhatsApp Web di sisi gateway OpenWA, bukan di dalam
 * proses Node.
 *
 * @param {object} settings pengaturan aplikasi
 * @param {string} phone nomor tujuan (sudah dinormalisasi)
 * @param {string} text isi pesan
 * @returns {Promise<object>} hasil pengiriman
 */
async function sendVia(settings, phone, text) {
  // Kanal tunggal: gateway OpenWA. Cache status dibaca lebih dulu supaya
  // tidak ada request jaringan tambahan untuk setiap pesan.
  if (!gateway.isReady()) {
    throw new Error('WhatsApp belum terhubung. Hubungkan dulu lewat menu WhatsApp.');
  }
  return gateway.sendText(phone, text, settings);
}

function checkFrequencyCap(phone, settings) {
  const d = db.read() || {};
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cap = Number(settings.frequencyCap) || FREQUENCY_CAP_PER_CONTACT_PER_DAY;
  const logs = (d.whatsappSendLogs || [])
    .filter((l) => l.phone === normalizePhone(phone))
    .filter((l) => l.loggedAt && l.loggedAt.slice(0, 10) === today);
  if (logs.length >= cap) {
    return { allowed: false, reason: `hari ini mencapai batas ${cap} pengiriman` };
  }
  return { allowed: true };
}

/**
 * Cek batas global harian (total 100/hari).
 * Mengembalikan: { allowed: boolean, reason?: string }
 */
function checkDailyLimit(settings) {
  const d = db.read() || {};
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cap = Number(settings.globalDailyLimit) || MAX_SENDS_PER_DAY;
  const logs = (d.whatsappSendLogs || [])
    .filter((l) => l.loggedAt && l.loggedAt.slice(0, 10) === today);
  if (logs.length >= cap) {
    return { allowed: false, reason: `batas harian ${cap} pengiriman tercapai` };
  }
  return { allowed: true };
}

/**
 * Simpan catatan kirim ke db (untuk audit & debugging).
 * @param {object} opts { phone, name, status, error?, template? }
 */
function logSend({ phone, name, status, error, template }) {
  const d = db.read() || {};
  const log = {
    id: db.uid('log'),
    phone,
    name: name || '',
    status,
    error: error || null,
    template: template || '',
    loggedAt: new Date().toISOString()
  };
  if (!d.whatsappSendLogs) d.whatsappSendLogs = [];
  d.whatsappSendLogs.unshift(log);
  // Batasi log harian ke 500 entri (jaga db ringan)
  const today = new Date().toISOString().slice(0, 10);
  d.whatsappSendLogs = d.whatsappSendLogs.filter((l) => l.loggedAt && l.loggedAt.slice(0, 10) === today).slice(0, 500);
  db.write();
}


/**
 * Buat job broadcast baru dan simpan ke db.
 *
 * Job inilah yang nanti diproses worker. Mode uji (dryRun) tidak mengirim
 * apa pun — hanya mengisi hasil simulasi supaya admin bisa melihat pesan
 * apa yang akan terkirim.
 *
 * @param {{templateBody: string, segment: string, dryRun: boolean}} opts opsi job
 * @returns {object} job yang dibuat
 */
function createBroadcastJob({ templateBody, segment, dryRun }) {
  // Cek batas harian global (semua blast, total)
  const d = db.read() || {};
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cap = Number(d.settings ? d.settings.globalDailyLimit : 0) || MAX_SENDS_PER_DAY;
  const dailyLogs = (d.whatsappSendLogs || []).filter(
    (l) => l.loggedAt && l.loggedAt.slice(0, 10) === today
  );
  if (dailyLogs.length >= cap) {
    const err = new Error(`Batas harian ${cap} pengiriman tercapai. Coba lagi besok.`);
    err.code = 'DAILY_LIMIT_EXCEEDED';
    throw err;
  }

  const data = db.read() || {};
  const targets = segmentTargets(data, segment).slice(0, MAX_PER_RUN);
  const template = String(templateBody || '').slice(0, 1500);

  const job = {
    id: db.uid('bc'),
    type: 'blast',
    template,
    segment: segment || 'all',
    dryRun: Boolean(dryRun),
    status: dryRun ? 'done' : 'queued',
    total: targets.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    cursor: 0,
    results: [],
    targets: targets.map((c) => ({ phone: c.phone, name: c.name })),
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: dryRun ? new Date().toISOString() : null
  };

  // Mode uji: isi hasil simulasi supaya admin bisa menilai isi pesan.
  if (dryRun) {
    job.results = targets.map((c) => ({
      phone: c.phone,
      name: c.name,
      status: 'simulated',
      preview: renderTemplate(template, { name: c.name })
    }));
  }

  // Simpan job ke database supaya bisa dilanjutkan worker & riwayat blast.
  // Nama field WAJIB `broadcasts` — sama dengan yang dibaca worker
  // (wa-worker.js: findPendingJob / cancelJob) dan test.
  data.broadcasts = data.broadcasts || [];
  data.broadcasts.unshift(job);
  db.write();

  return job;
}

/**
 * Blast satu template ke semua kontak marketable.
 * Job dibuat lalu langsung diproses worker di latar belakang. Bila WhatsApp
 * belum terhubung atau sedang jam tenang, worker menunda job (bukan
 * membatalkan) sehingga tetap terkirim saat syarat terpenuhi.
 *
 * @param {{templateBody: string, segment: string, dryRun: boolean}} opts opsi job
 * @returns {Promise<object>} job yang dibuat
 */
async function startBroadcast({ templateBody, segment, dryRun }) {
  const data = db.read() || {};

  // Cek batas harian global (total 100/hari)
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cap = Number(data.settings ? data.settings.globalDailyLimit : 0) || MAX_SENDS_PER_DAY;
  const dailyLogs = (data.whatsappSendLogs || []).filter(
    (l) => l.loggedAt && l.loggedAt.slice(0, 10) === today
  );
  if (dailyLogs.length >= cap) {
    const err = new Error(`Batas harian ${cap} pengiriman tercapai. Coba lagi besok.`);
    err.code = 'DAILY_LIMIT_EXCEEDED';
    throw err;
  }

  const job = createBroadcastJob({ templateBody, segment, dryRun });
  if (dryRun) return job;

  // Jalankan async, tidak memblokir request.
  const worker = require('./wa-worker');
  worker.processJob(job).catch((err) => {
    console.error('[wa] blast gagal:', err.message);
  });
  return job;
}

module.exports = {
  isQuietHour,
  quietWindow,
  quietLabel,
  normalizeHour,
  isReady,
  canSend,
  isValidPhone,
  renderTemplate,
  normalizePhone,
  marketableContacts,
  segmentTargets,
  contactFor,
  sendText,
  sendVia,
  deliverTo,
  createBroadcastJob,
  startBroadcast,
  checkFrequencyCap,
  checkDailyLimit,
  logSend,
  MAX_PER_RUN,
  MIN_DELAY_MS
};