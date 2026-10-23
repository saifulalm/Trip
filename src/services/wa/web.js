'use strict';

/**
 * web.js — WhatsApp Web (multi-device) via Baileys.
 *
 *Modul ini adalah "open source WhatsApp gateway" yang sesuai
 * permintaan: sesi lokal, QR code, status koneksi, dan reconnect.
 *
 * Prinsip:
 *  - SATU instance socket saja (singleton). Melanggil connect() dua kali
 *    tidak membuat socket kedua (mencegah kebocoran memori / socket ganda).
 *  - Reconnect otomatis memakai exponential backoff dengan batas percobaan.
 *    Setelah batas tercapai, status menjadi 'error' dan perlu tombol
 *    "Reconnect" manual — tidak ada loop tak berujung.
 *  - Semua listener dilepas saat socket di-destroy (endSession).
 *  - Log dibatasi (ring buffer) supaya tidak tumbuh tanpa batas.
 *  - Modul 'baileys' dimuat LAZY. Bila belum terpasang, modul ini
 *    AKTIF dengan status 'unavailable' dan pesan instalasi yang jelas —
 *    aplikasi TIDAK crash.
 */

const fs = require('fs');
const path = require('path');
const BRAND = require('../../brand');

const SESSION_DIR = path.join(__dirname, '..', '..', '..', 'data', 'wa-session');
const LOG_LIMIT = 60;
const MAX_RECONNECT = 5;
const BACKOFF_BASE_MS = 3000;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  /** 'unavailable' | 'disconnected' | 'connecting' | 'scanning' | 'connected' | 'error' */
  status: 'disconnected',
  /** String QR mentah (dari Baileys) — dipakai untuk dirender di admin. */
  qr: null,
  /** { id, name } */
  me: null,
  lastError: null,
  connectedAt: null,
  updatedAt: new Date().toISOString(),
  attempts: 0,
  log: []
};

let sock = null;
let connecting = false;
let reconnectTimer = null;
let qrTimer = null;
let destroyed = false;

/* ------------------------------------------------------------------ */
/* Util                                                                */
/* ------------------------------------------------------------------ */

function log(level, message) {
  const entry = { at: new Date().toISOString(), level, message: String(message).slice(0, 300) };
  state.log.unshift(entry);
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[wa-web] ${level.toUpperCase()} — ${entry.message}`);
  }
  return entry;
}

function setStatus(status, extra) {
  state.status = status;
  state.updatedAt = new Date().toISOString();
  if (extra) Object.assign(state, extra);
  return state.status;
}

/** Apakah dependency Baileys terpasang? */
function isAvailable() {
  try {
    require.resolve('baileys');
    return true;
  } catch (err) {
    return false;
  }
}

function unavailableMessage() {
  return 'Modul WhatsApp Web (baileys) belum terpasang. Jalankan: npm install baileys';
}

/* ------------------------------------------------------------------ */
/* Koneksi                                                             */
/* ------------------------------------------------------------------ */

/** Bersihkan QR lama agar tidak menampilkan kode basi. */
function clearQr() {
  state.qr = null;
  if (qrTimer) {
    clearTimeout(qrTimer);
    qrTimer = null;
  }
}

/**
 * Mulai sesi WhatsApp Web. Aman dipanggil berkali-kali.
 * Mengembalikan status terbaru.
 */
async function connect() {
  if (!isAvailable()) {
    setStatus('unavailable', { lastError: unavailableMessage() });
    log('error', unavailableMessage());
    return snapshot();
  }
  if (connecting || state.status === 'connected' || state.status === 'scanning') {
    return snapshot();
  }
  connecting = true;
  destroyed = false;
  clearQr();
  setStatus('connecting', { lastError: null, attempts: state.attempts + 1 });

  let baileys;
  try {
    baileys = require('baileys');
  } catch (err) {
    connecting = false;
    setStatus('unavailable', { lastError: unavailableMessage() });
    log('error', 'Gagal memuat baileys: ' + err.message);
    return snapshot();
  }

  const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
  const { DisconnectReason, useMultiFileAuthState } = baileys;

  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
      auth: authState,
      printQRInTerminal: true, // fallback: QR juga tampil di terminal server
      browser: [BRAND.display, 'Chrome', '120.0.0'],
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 500
    });

    sock.ev.on('creds.update', () => {
      try {
        saveCreds();
      } catch (err) {
        log('warn', 'Gagal menyimpan kredensial: ' + err.message);
      }
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update || {};

      if (qr) {
        state.qr = qr;
        setStatus('scanning');
        // QR WhatsApp berlaku singkat; setelah 60 detik Baileys mengirim ulang.
        if (qrTimer) clearTimeout(qrTimer);
        qrTimer = setTimeout(() => {
          if (state.status === 'scanning') log('info', 'QR diperbarui — pindai ulang dari panel.');
        }, 60000);
        log('info', 'QR tersedia. Pindai dengan WhatsApp → Perangkat tertaut.');
        return;
      }

      if (connection === 'open') {
        connecting = false;
        state.attempts = 0;
        clearQr();
        const user = sock && sock.user ? sock.user : {};
        state.me = { id: user.id || '', name: user.name || '' };
        state.connectedAt = new Date().toISOString();
        setStatus('connected', { lastError: null });
        log('success', 'Terhubung sebagai ' + (state.me.name || state.me.id || 'tidak diketahui') + '.');
        return;
      }

      if (connection === 'close') {
        connecting = false;
        const code = lastDisconnect && lastDisconnect.error ? lastDisconnect.error.output && lastDisconnect.error.output.statusCode : null;
        const reasonText = lastDisconnect && lastDisconnect.error ? lastDisconnect.error.message : 'koneksi ditutup';

        if (code === DisconnectReason.loggedOut) {
          setStatus('disconnected', { me: null, lastError: 'Sesi keluar dari WhatsApp. Klik "Reconnect Session" untuk memindai ulang.' });
          log('warn', 'Sesi logout. Perlu pemindaian QR ulang.');
          cleanupSocket();
          return;
        }

        // 401 = QR belum dipindai → biarkan status scanning & tunggu.
        if (code === 401 || code === DisconnectReason.badSession) {
          setStatus('scanning', { lastError: 'Menunggu QR dipindai.' });
          log('info', 'Menunggu pemindaian QR.');
          return;
        }

        setStatus('disconnected', { lastError: reasonText });
        log('warn', 'Koneksi terputus: ' + reasonText);
        scheduleReconnect(reasonText);
      }
    });
  } catch (err) {
    connecting = false;
    setStatus('error', { lastError: err.message });
    log('error', 'Gagal memulai sesi: ' + err.message);
  }
  return snapshot();
}

/** Jadwalkan reconnect dengan backoff; batasi jumlah percobaan. */
function scheduleReconnect(reason) {
  if (destroyed) return;
  if (state.attempts >= MAX_RECONNECT) {
    setStatus('error', {
      lastError:
        'Reconnect otomatis berhenti setelah ' +
        MAX_RECONNECT +
        ' percobaan. Klik "Reconnect Session" untuk mencoba lagi. (' +
        reason +
        ')'
    });
    log('error', 'Batas percobaan reconnect tercapai.');
    return;
  }
  const delay = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, state.attempts - 1));
  state.attempts += 1;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  log('info', `Reconnect dalam ${Math.round(delay / 1000)} detik (percobaan ${state.attempts}/${MAX_RECONNECT}).`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  if (reconnectTimer.unref) reconnectTimer.unref();
}

/** Putuskan socket & lepaskan semua listener (anti memory-leak). */
function cleanupSocket() {
  if (sock) {
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('creds.update');
    } catch (err) {
      /* abaikan */
    }
    try {
      sock.end(undefined);
    } catch (err) {
      /* abaikan */
    }
    sock = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connecting = false;
}

/** Tutup sesi (tanpa menghapus kredensial) — status jadi disconnected. */
async function disconnect() {
  destroyed = true;
  cleanupSocket();
  clearQr();
  state.me = null;
  state.connectedAt = null;
  state.attempts = 0;
  setStatus('disconnected', { lastError: null });
  log('info', 'Sesi ditutup.');
  return snapshot();
}

/** Hapus sesi + kredensial → perlu pindai QR baru. */
async function logout() {
  destroyed = true;
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      log('warn', 'Gagal logout pada socket: ' + err.message);
    }
  }
  cleanupSocket();
  clearQr();
  state.me = null;
  state.connectedAt = null;
  state.attempts = 0;
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    log('warn', 'Gagal menghapus folder sesi: ' + err.message);
  }
  setStatus('disconnected', { lastError: null });
  log('info', 'Sesi dihapus. Pindai QR baru untuk menyambung kembali.');
  return snapshot();
}

/** Perbarui / muat ulang QR. */
async function refreshQr() {
  if (!isAvailable()) {
    setStatus('unavailable', { lastError: unavailableMessage() });
    return snapshot();
  }
  state.attempts = 0;
  await disconnect();
  destroyed = false;
  await connect();
  return snapshot();
}

/* ------------------------------------------------------------------ */
/* Pengiriman                                                          */
/* ------------------------------------------------------------------ */

function toJid(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  return `${p}@s.whatsapp.net`;
}

/** Kirim pesan teks lewat WhatsApp Web. Throw bila gagal. */
async function sendText(phone, text) {
  if (!isAvailable()) throw new Error(unavailableMessage());
  if (state.status !== 'connected' || !sock) {
    throw new Error('Sesi WhatsApp Web belum terhubung. Pindai QR terlebih dahulu.');
  }
  const jid = toJid(phone);
  const result = await sock.sendMessage(jid, { text: String(text || '') });
  return { id: result && result.key ? result.key.id : null, jid };
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

function snapshot() {
  return {
    provider: 'web',
    available: isAvailable(),
    status: state.status,
    qr: state.qr,
    me: state.me ? { ...state.me } : null,
    connectedAt: state.connectedAt,
    lastError: state.lastError,
    attempts: state.attempts,
    updatedAt: state.updatedAt,
    log: state.log.slice(0, 20),
    sessionDir: SESSION_DIR
  };
}

/** Ringkasan status siap-tampil untuk panel admin. */
const STATUS_LABEL = {
  unavailable: 'Belum Terpasang',
  disconnected: 'Terputus',
  connecting: 'Menghubungkan…',
  scanning: 'Memindai QR',
  connected: 'Terhubung',
  error: 'Gagal'
};

function statusLabel() {
  return STATUS_LABEL[state.status] || state.status;
}

module.exports = {
  SESSION_DIR,
  MAX_RECONNECT,
  isAvailable,
  unavailableMessage,
  connect,
  disconnect,
  logout,
  refreshQr,
  sendText,
  snapshot,
  statusLabel,
  cleanupSocket
};
