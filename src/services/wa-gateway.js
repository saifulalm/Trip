'use strict';

/**
 * Klien REST untuk gateway WhatsApp OpenWA.
 *
 * OpenWA adalah layanan self-hosted yang berdiri sendiri (bukan socket
 * Baileys / whatsapp-web.js di dalam proses Node). Aplikasi kita
 * berbicara dengannya lewat REST API sederhana:
 *
 *   POST   /api/sessions                          -> buat session
 *   POST   /api/sessions/:id/start                -> jalankan engine + keluarkan QR
 *   GET    /api/sessions/:id/qr                   -> QR sebagai data URL PNG
 *   GET    /api/sessions/:id                      -> status session
 *   POST   /api/sessions/:id/pairing-code         -> kode pairing 8 karakter
 *   POST   /api/sessions/:id/messages/send-text   -> kirim pesan teks
 *   POST   /api/sessions/:id/stop                 -> hentikan engine
 *   POST   /api/sessions/:id/logout               -> lepas tautan perangkat
 *   DELETE /api/sessions/:id                      -> hapus session
 *   GET    /api/sessions/:id/webhooks             -> daftar webhook
 *   POST   /api/sessions/:id/webhooks             -> daftar webhook
 *
 * Semua endpoint dilindungi header `X-API-Key` (tanpa awalan "Bearer").
 *
 * Modul ini TIDAK tahu apa pun soal database, blast, atau panel admin —
 * dia murni lapisan transport. Pemetaan status OpenWA ke status internal
 * aplikasi dilakukan di `wa.js`.
 *
 * Catatan penting soal QR:
 *   OpenWA sudah mengembalikan QR sebagai PNG data URL (`qrCode`). Tidak ada
 *   lagi kebutuhan merender string QR sendiri — dan membungkusnya jadi
 *   `data:image/png;base64,...` yang kedua kali akan membuat gambarnya pecah.
 */

const db = require('../db');

/** Bawaan alamat gateway OpenWA (dev lokal). */
const DEFAULT_BASE_URL = 'http://localhost:2785';

/** Bawaan nama session — harus cocok dengan pola OpenWA (tanpa underscore). */
const DEFAULT_SESSION_NAME = 'seayoulatertrip';

/** Batas waktu menunggu jawaban gateway (milidetik). */
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Rentang valid timeout gateway (milidetik).
 *
 * Dipakai oleh DUA sumber timeout — settings panel (`openwaTimeoutMs`)
 * dan env (`OPENWA_TIMEOUT_MS`) — supaya keduanya berbagi satu batas.
 * Nilai di luar rentang dijepit, bukan ditolak, supaya timeout yang tak
 * masuk akal tidak bisa membuat gateway menggantung tanpa akhir.
 */
const MIN_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 120000;

/**
 * Jepit nilai timeout ke rentang yang valid.
 *
 * Nilai bukan angka (NaN) memakai DEFAULT_TIMEOUT_MS.
 *
 * @param {*} value nilai mentah dari settings atau env
 * @returns {number} timeout valid (3000–120000)
 */
function clampTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)));
}

/**
 * Pola nama session OpenWA.
 *
 * OpenWA hanya menerima nama alphanumeric + tanda hubung, maksimal 50
 * karakter. Underscore DITOLAK gateway — jadi nama bawaan pun tidak boleh
 * memakai underscore.
 */
const SAFE_SESSION_NAME = /^[A-Za-z0-9-]{1,50}$/;

/**
 * Error dari gateway OpenWA.
 *
 * Pesan asli dari OpenWA disimpan penuh supaya admin bisa tahu penyebabnya
 * (mis. "Session is not waiting to be linked") alih-alih melihat pesan
 * generik yang tidak berguna.
 */
class OpenwaError extends Error {
  /**
   * @param {string} message pesan error
   * @param {number} statusCode kode HTTP dari gateway (0 = gagal jaringan)
   * @param {string|null} [code] kode error dari gateway bila ada
   */
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'OpenwaError';
    this.statusCode = statusCode;
    this.code = code || null;
  }
}

/* ------------------------------------------------------------------ */
/* Konfigurasi                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ambil konfigurasi OpenWA.
 *
 * Urutan sumber:
 *  1. Field non-secret (base URL, nama session, URL webhook) dari `settings`
 *     lebih dulu — supaya admin bisa mengubahnya dari panel Pengaturan.
 *  2. Secret (API key, webhook secret) dari `process.env` lebih dulu —
 *     kredensial sebaiknya tinggal di env, bukan di `data/db.json`.
 *  3. Sisa nilai jatuh ke env, lalu ke bawaan.
 *
 * @param {object} [settings] settings situs (default: baca dari db)
 * @returns {{baseUrl:string, sessionName:string, apiKey:string, webhookSecret:string, webhookUrl:string, timeoutMs:number}}
 */
function config(settings) {
  const s = settings && typeof settings === 'object'
    ? settings
    : ((db.read() || {}).settings || {});

  const baseUrl = String(
    s.openwaBaseUrl || process.env.OPENWA_BASE_URL || DEFAULT_BASE_URL
  ).trim().replace(/\/+$/, '');

  const sessionName = String(
    s.openwaSessionName || process.env.OPENWA_SESSION_NAME || DEFAULT_SESSION_NAME
  ).trim();

  const apiKey = String(
    process.env.OPENWA_API_KEY || s.openwaApiKey || ''
  ).trim();

  const webhookSecret = String(
    process.env.OPENWA_WEBHOOK_SECRET || s.openwaWebhookSecret || ''
  ).trim();

  const webhookUrl = String(
    s.openwaWebhookUrl || process.env.OPENWA_WEBHOOK_URL || ''
  ).trim();

  // Timeout: settings panel menang atas env. Keduanya dijepit ke rentang
  // yang sama (3000–120000) supaya tak ada sumber timeout yang bisa
  // membuat gateway menggantung tanpa akhir.
  const timeoutMs = clampTimeoutMs(
    s.openwaTimeoutMs !== undefined && s.openwaTimeoutMs !== null && s.openwaTimeoutMs !== ''
      ? s.openwaTimeoutMs
      : process.env.OPENWA_TIMEOUT_MS
  );

  return { baseUrl, sessionName, apiKey, webhookSecret, webhookUrl, timeoutMs };
}

/**
 * Apakah OpenWA sudah terkonfigurasi cukup untuk dipakai.
 * @returns {boolean} true bila base URL + API key tersedia
 */
function isConfigured(settings) {
  const cfg = config(settings);
  return Boolean(cfg.baseUrl && cfg.apiKey);
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * Rangkai pesan error dari body OpenWA.
 *
 * OpenWA (NestJS) mengirim beberapa bentuk error:
 *  - `{ statusCode, message: 'teks', error: 'Bad Request' }`
 *  - `{ statusCode, message: ['teks1', 'teks2'] }` (validasi per-field)
 *  - `{ message: { msg: 'teks' } }` (HttpException dengan objek)
 *
 * @param {any} body body respons
 * @param {string} fallback pesan bawaan
 * @returns {string} pesan yang enak dibaca
 */
function formatError(body, fallback) {
  if (!body || typeof body !== 'object') return fallback;
  let message = '';
  if (typeof body.message === 'string') message = body.message.trim();
  else if (Array.isArray(body.message)) {
    message = body.message.filter(Boolean).join(' ');
  } else if (body.message && typeof body.message === 'object'
    && typeof body.message.msg === 'string') {
    message = body.message.msg;
  }
  if (!message && typeof body.msg === 'string') message = body.msg;
  if (!message && typeof body.error === 'string') message = body.error;
  return message || fallback;
}

/**
 * Lakukan satu permintaan ke OpenWA.
 *
 * Timeout dipakai `AbortController` supaya proses backend tidak menggantung
 * kalau OpenWA mati — error dilempar sebagai `OpenwaError` 503.
 *
 * @param {string} method metode HTTP
 * @param {string} path path relatif TANPA `/api` (mis. '/sessions/abc')
 * @param {object} [body] body JSON (opsional)
 * @param {object} [settings] settings situs
 * @returns {Promise<any>} body respons
 */
async function request(method, path, body, settings) {
  const cfg = config(settings);
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new OpenwaError(
      'OpenWA belum dikonfigurasi. Isi API Key di menu Pengaturan → WhatsApp atau set OPENWA_API_KEY.',
      401
    );
  }

  const url = `${cfg.baseUrl}/api${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const headers = {
      'X-API-Key': cfg.apiKey,
      Accept: 'application/json'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    // 204 tidak punya body — parsing JSON harus dilewati.
    if (res.status === 204) return null;

    const text = await res.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (err) {
        payload = text;
      }
    }

    if (!res.ok) {
      const message = formatError(payload, `OpenWA menjawab HTTP ${res.status}.`);
      throw new OpenwaError(
        message,
        res.status,
        payload && typeof payload === 'object' && typeof payload.code === 'string'
          ? payload.code
          : null
      );
    }

    return payload;
  } catch (err) {
    if (err instanceof OpenwaError) throw err;

    if (err && err.name === 'AbortError') {
      throw new OpenwaError(
        `OpenWA tidak merespons dalam ${cfg.timeoutMs} ms. Periksa alamat gateway (${cfg.baseUrl}) dan status service OpenWA.`,
        503
      );
    }

    // Kegagalan jaringan (DNS, koneksi ditolak, TLS gagal).
    throw new OpenwaError(
      `Tidak dapat menghubungi OpenWA di ${cfg.baseUrl}: ${(err && err.message) || err}`,
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pastikan nama session aman untuk OpenWA.
 * @param {string} name nama session
 * @returns {string} nama session yang sudah divalidasi
 */
function assertSafeSessionName(name) {
  const value = String(name || '').trim();
  if (!SAFE_SESSION_NAME.test(value)) {
    throw new OpenwaError(
      `Nama session WhatsApp tidak valid: "${value}". Hanya huruf, angka, dan tanda hubung yang diizinkan (maks 50 karakter).`,
      400
    );
  }
  return value;
}

/**
 * Ubah nomor menjadi id obrolan yang dipakai OpenWA.
 *
 * Format OpenWA: `<nomor>@c.us` untuk orang, `<id>@g.us` untuk grup.
 * Nilai yang sudah berupa JID diteruskan apa adanya.
 *
 * @param {string} raw nomor mentah atau JID
 * @returns {string} id obrolan
 */
function toChatId(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new OpenwaError('Nomor penerima WhatsApp kosong.', 400);
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) {
    throw new OpenwaError(
      'Nomor WhatsApp tidak valid. Gunakan format internasional tanpa tanda plus, contoh 628123456789.',
      400
    );
  }
  return `${digits}@c.us`;
}

/**
 * Normalisasi nomor polos (untuk mencari kontak di db).
 * @param {string} raw nomor mentah
 * @returns {string} nomor polos
 */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

/**
 * Cari session OpenWA berdasarkan nama.
 *
 * `name` di query bersifat case-sensitive dan mengembalikan array (bisa
 * kosong). Ini yang membuat restart backend tidak menggandakan session untuk
 * perangkat yang sama.
 *
 * @param {string} name nama session
 * @param {object} [settings] settings situs
 * @returns {Promise<object[]>} daftar session
 */
async function findSessionByName(name, settings) {
  const res = await request(
    'GET',
    `/sessions?name=${encodeURIComponent(String(name || ''))}`,
    undefined,
    settings
  );
  return Array.isArray(res) ? res : [];
}

/**
 * Ambil satu session berdasarkan id OpenWA.
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} detail session
 */
async function getSession(sessionId, settings) {
  return request('GET', `/sessions/${encodeURIComponent(sessionId)}`, undefined, settings);
}

/**
 * Buat session OpenWA baru.
 * @param {string} name nama session
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} session yang dibuat
 */
async function createSession(name, settings) {
  return request('POST', '/sessions', { name }, settings);
}

/**
 * Jalankan engine session.
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} session
 */
async function startSession(sessionId, settings) {
  return request('POST', `/sessions/${encodeURIComponent(sessionId)}/start`, undefined, settings);
}

/**
 * Hentikan engine session (tanpa melepas tautan perangkat).
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} session
 */
async function stopSession(sessionId, settings) {
  return request('POST', `/sessions/${encodeURIComponent(sessionId)}/stop`, undefined, settings);
}

/**
 * Lepas tautan perangkat di WhatsApp lalu hentikan session.
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} session
 */
async function logoutSession(sessionId, settings) {
  return request('POST', `/sessions/${encodeURIComponent(sessionId)}/logout`, undefined, settings);
}

/**
 * Hapus session beserta webhook-nya.
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<void>}
 */
async function deleteSession(sessionId, settings) {
  await request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`, undefined, settings);
}

/**
 * Ambil QR session sebagai PNG data URL.
 *
 * OpenWA membalas 400 bila QR belum siap (engine masih starting) atau
 * session sudah tertaut — keduanya kondisi normal, bukan error fatal.
 *
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<string|null>} data URL PNG atau null
 */
async function getQrCode(sessionId, settings) {
  try {
    const res = await request(
      'GET',
      `/sessions/${encodeURIComponent(sessionId)}/qr`,
      undefined,
      settings
    );
    return (res && res.qrCode) || null;
  } catch (err) {
    if (err instanceof OpenwaError && err.statusCode === 400) return null;
    throw err;
  }
}

/**
 * Minta kode pairing 8 karakter untuk nomor tertentu.
 * @param {string} sessionId id session
 * @param {string} phone nomor internasional (digit saja)
 * @param {object} [settings] settings situs
 * @returns {Promise<string>} kode pairing
 */
async function requestPairingCode(sessionId, phone, settings) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 6) {
    throw new OpenwaError('Nomor WhatsApp tidak valid. Gunakan format 62812xxxxxxx.', 400);
  }
  const res = await request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/pairing-code`,
    { phoneNumber: digits },
    settings
  );
  return (res && res.pairingCode) || '';
}

/**
 * Kirim pesan teks lewat perangkat yang tertaut.
 *
 * @param {string} sessionId id session OpenWA
 * @param {string} chatId id obrolan (`628…@c.us`)
 * @param {string} text isi pesan
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} hasil pengiriman
 */
async function sendTextViaSession(sessionId, chatId, text, settings) {
  return request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/messages/send-text`,
    { chatId, text },
    settings
  );
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

/**
 * Daftar webhook yang terdaftar pada sebuah session.
 * @param {string} sessionId id session
 * @param {object} [settings] settings situs
 * @returns {Promise<object[]>} daftar webhook
 */
async function listWebhooks(sessionId, settings) {
  const res = await request(
    'GET',
    `/sessions/${encodeURIComponent(sessionId)}/webhooks`,
    undefined,
    settings
  );
  return Array.isArray(res) ? res : [];
}

/**
 * Daftarkan webhook untuk sebuah session.
 *
 * `secret` dipakai OpenWA untuk menghitung HMAC-SHA256 atas body mentah
 * setiap delivery. Panjang minimum 16 karakter (OpenWA menolak lebih
 * pendek).
 *
 * @param {string} sessionId id session
 * @param {object} input { url, events, secret?, retryCount? }
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} webhook yang dibuat
 */
async function createWebhook(sessionId, input, settings) {
  const body = {
    url: input.url,
    events: input.events
  };
  if (input.secret) body.secret = input.secret;
  if (typeof input.retryCount === 'number') body.retryCount = input.retryCount;
  return request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/webhooks`,
    body,
    settings
  );
}

/**
 * Hapus webhook yang terdaftar pada sebuah session.
 * @param {string} sessionId id session
 * @param {string} webhookId id webhook
 * @param {object} [settings] settings situs
 * @returns {Promise<void>}
 */
async function deleteWebhook(sessionId, webhookId, settings) {
  await request(
    'DELETE',
    `/sessions/${encodeURIComponent(sessionId)}/webhooks/${encodeURIComponent(webhookId)}`,
    undefined,
    settings
  );
}

/* ------------------------------------------------------------------ */
/* Caching & status                                                    */
/* ------------------------------------------------------------------ */

/**
 * Cache status session terakhir.
 *
 * `wa-worker` dan `wa-reminder` memanggil `canSend()` untuk setiap pesan.
 * Tanpa cache, tiap panggilan berarti satu request HTTP ke gateway — itu
 * lambat dan membebani gateway. Cache diperbarui lewat polling berkala
 * (lihat `startPolling`) dan di-refresh saat admin membuka panel.
 */
const state = {
  /** Id session OpenWA terakhir yang diketahui (UUID). */
  sessionId: null,
  /** Nama session yang dipetakan ke id di atas. */
  sessionName: null,
  /** Status terakhir dari gateway (lowercase, sesuai wire OpenWA). */
  status: 'disconnected',
  /** Nomor perangkat yang tertaut (bila ada). */
  phone: null,
  /** Nama tampilan akun (bila ada). */
  pushName: null,
  /** Pesan error terakhir dari gateway. */
  lastError: null,
  /** Kapan cache terakhir diperbarui (ISO string). */
  updatedAt: null
};

/**
 * Salinan state untuk ditampilkan di panel admin.
 * @returns {object} state saat ini
 */
function getState() {
  return { ...state };
}

/**
 * Terapkan status session dari gateway ke cache lokal.
 * @param {object} session session OpenWA
 */
function applySession(session) {
  if (!session) return;
  state.sessionId = session.id || state.sessionId;
  state.sessionName = session.name || state.sessionName;
  state.status = session.status || state.status;
  state.phone = session.phone || null;
  state.pushName = session.pushName || null;
  state.lastError = session.lastError || null;
  state.updatedAt = new Date().toISOString();
}

/**
 * Temukan (atau buat) session OpenWA untuk nama session yang dikonfigurasi.
 *
 * Session yang sudah ada dipakai apa adanya sehingga restart server tidak
 * membuat session ganda untuk perangkat yang sama.
 *
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} session OpenWA
 */
async function ensureSession(settings) {
  const cfg = config(settings);
  const name = assertSafeSessionName(cfg.sessionName);

  // Cache id: satu panggilan saja.
  if (state.sessionId && state.sessionName === name) {
    try {
      const cached = await getSession(state.sessionId, settings);
      applySession(cached);
      return cached;
    } catch (err) {
      // Session hilang di sisi OpenWA (mis. dihapus manual) — cache dibuang
      // supaya alur berikut mencari ulang lewat nama.
      state.sessionId = null;
      if (!(err instanceof OpenwaError) || err.statusCode !== 404) throw err;
    }
  }

  const found = await findSessionByName(name, settings);
  if (found.length > 0) {
    applySession(found[0]);
    return found[0];
  }

  const created = await createSession(name, settings);
  applySession(created);
  return created;
}

/**
 * Pastikan session ada DAN engine-nya berjalan.
 *
 * Session yang sudah `ready` TIDAK boleh di-start ulang — OpenWA membalas
 * 400, dan start ulang bisa memutus pengiriman yang sedang berjalan.
 *
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} session
 */
async function ensureStartedSession(settings) {
  const session = await ensureSession(settings);
  if (session.status !== 'ready') {
    try {
      await startSession(session.id, settings);
    } catch (err) {
      // 400 = session sudah berjalan / QR sudah tersedia. Kondisi wajar —
      // pemanggilan kedua tidak boleh menggagalkan alur admin.
      if (!(err instanceof OpenwaError) || err.statusCode !== 400) throw err;
    }
  }
  const fresh = await getSession(session.id, settings);
  applySession(fresh);
  return fresh;
}

/**
 * Apakah perangkat siap menerima pesan.
 *
 * Membaca cache, BUKAN memanggil jaringan — dipanggil dari worker untuk
 * setiap pesan.
 *
 * @returns {boolean} true bila status gateway `ready`
 */
function isReady() {
  return state.status === 'ready';
}

/**
 * Refresh cache status dari gateway.
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} state terbaru
 */
async function refreshState(settings) {
  try {
    const session = await ensureSession(settings);
    applySession(session);
  } catch (err) {
    state.status = 'disconnected';
    state.lastError = String((err && err.message) || err).slice(0, 200);
    state.updatedAt = new Date().toISOString();
  }
  return getState();
}

/**
 * Kirim pesan teks ke satu nomor.
 *
 * Ini titik masuk yang dipakai `wa.js`. Format nomor sudah dinormalisasi
 * oleh pemanggil; di sini cukup diubah menjadi JID OpenWA.
 *
 * @param {string} phone nomor tujuan (boleh JID)
 * @param {string} text isi pesan
 * @param {object} [settings] settings situs
 * @returns {Promise<{id:string|null, jid:string}>} hasil pengiriman
 */
async function sendText(phone, text, settings) {
  const body = String(text || '').trim();
  if (!body) throw new OpenwaError('Isi pesan kosong.', 400);

  const chatId = toChatId(phone);

  // Session harus siap. Bila cache belum tahu, refresh sekali.
  if (!isReady()) {
    const session = await ensureStartedSession(settings);
    if (!session || session.status !== 'ready') {
      throw new OpenwaError(
        `WhatsApp belum tersambung (status gateway: ${(session && session.status) || 'tidak diketahui'}). Hubungkan dulu lewat menu WhatsApp.`,
        409
      );
    }
  }

  const sessionId = state.sessionId;
  if (!sessionId) {
    throw new OpenwaError('Session WhatsApp belum dibuat di gateway OpenWA.', 409);
  }

  const res = await sendTextViaSession(sessionId, chatId, body, settings);
  return {
    id: (res && res.messageId) || null,
    jid: chatId,
    via: 'openwa'
  };
}

/**
 * Daftarkan webhook inbound untuk session yang aktif.
 *
 * Dipanggil saat boot server dan saat admin menyalakan sesi. Kegagalan
 * pendaftaran tidak boleh menggagalkan pembuatan sesi — pengiriman pesan
 * tetap bisa dipakai, hanya event masuk yang tidak diterima.
 *
 * @param {object} [settings] settings situs
 * @returns {Promise<boolean>} true bila webhook terdaftar
 */
async function ensureWebhookRegistered(settings) {
  const cfg = config(settings);
  if (!cfg.webhookUrl) {
    console.warn('[openwa] OPENWA_WEBHOOK_URL belum diisi — webhook inbound tidak didaftarkan.');
    return false;
  }
  if (cfg.webhookSecret && cfg.webhookSecret.length < 16) {
    console.warn('[openwa] OPENWA_WEBHOOK_SECRET terlalu pendek (minimal 16 karakter) — webhook didaftarkan tanpa tanda tangan.');
  }

  try {
    const session = await ensureSession(settings);
    const existing = await listWebhooks(session.id, settings);
    if (existing.some((w) => w.url === cfg.webhookUrl)) {
      console.log(`[openwa] webhook untuk session ${cfg.sessionName} sudah terdaftar.`);
      return true;
    }

    await createWebhook(
      session.id,
      {
        url: cfg.webhookUrl,
        events: ['message.received', 'session.status'],
        secret: cfg.webhookSecret || undefined,
        retryCount: 3
      },
      settings
    );

    console.log(`[openwa] webhook session ${cfg.sessionName} terdaftar di ${cfg.webhookUrl}.`);
    return true;
  } catch (err) {
    console.error('[openwa] Gagal mendaftarkan webhook:', (err && err.message) || err);
    return false;
  }
}

/**
 * Health check gateway.
 * @param {object} [settings] settings situs
 * @returns {Promise<{ok:boolean, status:string|null, error:string|null}>} status gateway
 */
async function healthCheck(settings) {
  try {
    const cfg = config(settings);
    const res = await request('GET', '/health', undefined, settings);
    return {
      ok: true,
      status: (res && res.status) || 'ok',
      baseUrl: cfg.baseUrl,
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      baseUrl: config(settings).baseUrl,
      error: String((err && err.message) || err)
    };
  }
}

/* ------------------------------------------------------------------ */
/* Polling berkala                                                     */
/* ------------------------------------------------------------------ */

let pollTimer = null;

/**
 * Mulai polling status session secara berkala.
 *
 * Polling ini yang membuat `canSend()` di worker/reminder tetap akurat
 * tanpa perlu memanggil jaringan untuk tiap pesan.
 *
 * @param {number} [intervalMs] jeda antar polling (default 15 detik)
 * @param {object} [settings] settings situs
 */
function startPolling(intervalMs, settings) {
  const ms = Number(intervalMs) || 15000;
  stopPolling();
  const tick = () => {
    refreshState(settings).catch(() => {});
  };
  tick();
  pollTimer = setInterval(tick, ms);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
}

/**
 * Hentikan polling status session.
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_SESSION_NAME,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  clampTimeoutMs,
  SAFE_SESSION_NAME,
  OpenwaError,
  config,
  isConfigured,
  request,
  formatError,
  assertSafeSessionName,
  toChatId,
  normalizePhone,
  findSessionByName,
  getSession,
  createSession,
  startSession,
  stopSession,
  logoutSession,
  deleteSession,
  getQrCode,
  requestPairingCode,
  sendTextViaSession,
  sendText,
  listWebhooks,
  createWebhook,
  deleteWebhook,
  ensureSession,
  ensureStartedSession,
  ensureWebhookRegistered,
  getState,
  applySession,
  refreshState,
  isReady,
  healthCheck,
  startPolling,
  stopPolling
};
