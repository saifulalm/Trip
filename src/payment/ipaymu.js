'use strict';

/**
 * Payment gateway iPaymu (API v2).
 *
 * Menggantikan Midtrans + Tripay + transfer manual. iPaymu dipilih karena
 * mendukung QRIS, Virtual Account semua bank, e-wallet, dan gerai retail
 * dalam satu integrasi REST.
 *
 * DOKUMENTASI
 *  - Redirect Payment : POST {base}/api/v2/payment
 *  - Callback         : POST {notifyUrl}  (header X-Signature)
 *  - Base URL         : sandbox https://sandbox.ipaymu.com/api/v2
 *                       produksi https://my.ipaymu.com/api/v2
 *
 * KEAMANAN
 *  - Setiap request API ditandatangani HMAC-SHA256 dengan API Key.
 *  - Setiap callback diverifikasi lewat header X-Signature memakai VA
 *    sebagai secret key (sesuai dokumentasi resmi iPaymu).
 *  - Callback bersifat idempoten: transaksi yang sudah `paid` tidak
 *    diproses dua kali meski iPaymu mengirim ulang notifikasi.
 *
 * Tidak ada dependensi native — cukup modul `crypto` bawaan Node.
 */

const crypto = require('crypto');

/** Base URL API per environment. */
const SANDBOX_BASE = 'https://sandbox.ipaymu.com/api/v2';
const PRODUCTION_BASE = 'https://my.ipaymu.com/api/v2';

/** Kunci integer yang wajib di-cast agar hash signature cocok. */
const INT_FIELDS = ['trx_id', 'status_code', 'transaction_status_code', 'paid_off'];

/**
 * Ambil kredensial iPaymu dari settings (dengan fallback env).
 *
 * @param {object} [settings] settings situs
 * @returns {{va: string, apiKey: string, production: boolean}} kredensial
 */
function ipaymuKeys(settings) {
  const s = settings || {};
  return {
    va: String(s.ipaymuVa || process.env.IPAYMU_VA || '').trim(),
    apiKey: String(s.ipaymuApiKey || process.env.IPAYMU_API_KEY || '').trim(),
    production: s.ipaymuProduction === true
  };
}

/**
 * Apakah iPaymu sudah dikonfigurasi (VA + API Key terisi).
 *
 * @param {object} [settings] settings situs
 * @returns {boolean} true bila terkonfigurasi
 */
function isIpaymuConfigured(settings) {
  const k = ipaymuKeys(settings);
  return Boolean(k.va && k.apiKey);
}

/**
 * Base URL API sesuai environment.
 *
 * @param {object} [settings] settings situs
 * @returns {string} base URL tanpa garis miring di akhir
 */
function baseUrl(settings) {
  return ipaymuKeys(settings).production ? PRODUCTION_BASE : SANDBOX_BASE;
}

/**
 * Hitung signature request iPaymu.
 *
 * String to sign = METHOD + ":" + VA + ":" + SHA256(bodyJson) + ":" + APIKey
 * Signature      = HMAC-SHA256(stringToSign, APIKey)
 *
 * @param {string} method HTTP method (POST/GET)
 * @param {string} va nomor Virtual Account merchant
 * @param {string} bodyJson body request dalam bentuk JSON string
 * @param {string} apiKey API Key merchant
 * @returns {string} signature hex lowercase
 */
function signRequest(method, va, bodyJson, apiKey) {
  const bodyHash = crypto.createHash('sha256').update(bodyJson).digest('hex').toLowerCase();
  const stringToSign = `${String(method).toUpperCase()}:${va}:${bodyHash}:${apiKey}`;
  return crypto.createHmac('sha256', apiKey).update(stringToSign).digest('hex');
}

/**
 * Timestamp header iPaymu: YYYYMMDDHHmmss (waktu lokal server).
 *
 * @returns {string} timestamp 14 digit
 */
function timestamp() {
  const d = new Date();
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Bangun URL absolut untuk callback iPaymu.
 *
 * @param {object} req request express
 * @param {string} path path callback (mis. /payment/webhook/ipaymu)
 * @returns {string} URL absolut
 */
function callbackUrl(req, path) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${String(base).replace(/\/$/, '')}${path}`;
}

/**
 * Buat transaksi pembayaran (Redirect Payment).
 *
 * Mengembalikan { gateway, ref, url } di mana `url` adalah halaman checkout
 * iPaymu yang harus dibuka pembeli.
 *
 * @param {{settings: object, booking: object, req: object}} ctx konteks
 * @returns {Promise<{gateway: string, ref: string, url: string}>} hasil
 */
async function ipaymuCreate({ settings, booking, req }) {
  const keys = ipaymuKeys(settings);
  if (!keys.va || !keys.apiKey) {
    throw new Error('iPaymu belum dikonfigurasi (VA / API Key kosong).');
  }

  const gross =
    Number(booking.totalAmount) ||
    Number(booking.packagePrice || 0) * Number(booking.participants || 1);
  if (!(gross > 0)) throw new Error('Total tagihan booking tidak valid.');

  const payload = {
    product: [String(booking.packageName || 'Paket Wisata').slice(0, 50)],
    qty: [String(booking.participants || 1)],
    price: [String(gross)],
    description: [`Booking ${booking.code} - ${booking.packageName || 'Paket Wisata'}`.slice(0, 100)],
    returnUrl: callbackUrl(req, `/pembayaran/${booking.code}`),
    notifyUrl: callbackUrl(req, '/payment/webhook/ipaymu'),
    cancelUrl: callbackUrl(req, `/pembayaran/${booking.code}`),
    referenceId: String(booking.code),
    buyerName: String(booking.name || '').slice(0, 100),
    buyerEmail: String(booking.email || '').slice(0, 100),
    buyerPhone: String(booking.phone || '').slice(0, 30),
    expired: 24 // masa berlaku checkout (jam)
  };

  // Urutan key harus persis sama dengan body yang dikirim (signature dihitung
  // dari string body, bukan dari objek yang di-parse ulang).
  const bodyJson = JSON.stringify(payload);

  const res = await fetch(`${baseUrl(settings)}/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      va: keys.va,
      signature: signRequest('POST', keys.va, bodyJson, keys.apiKey),
      timestamp: timestamp()
    },
    body: bodyJson
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body || body.Status !== 200 || !body.Data || !body.Data.Url) {
    const msg =
      (body && (body.Message || (Array.isArray(body.data) && body.data[0] && body.data[0].message))) ||
      `HTTP ${res.status}`;
    throw new Error(`iPaymu menolak transaksi: ${msg}`);
  }

  return {
    gateway: 'ipaymu',
    ref: body.Data.SessionID || '',
    url: body.Data.Url
  };
}

/**
 * Normalisasi payload callback iPaymu.
 *
 * iPaymu mengirim beberapa field bertipe string yang secara semantik
 * integer/boolean. Hash signature dihitung atas tipe yang sudah dinormalisasi,
 * jadi bentuk harus sama persis dengan yang=iPaymu hitung.
 *
 * @param {object} raw body callback
 * @returns {object} payload ternormalisasi
 */
function normalizeCallback(raw) {
  const result = {};
  for (const key of Object.keys(raw || {})) {
    const val = raw[key];
    if (key === 'is_escrow' || key === 'is_refund') {
      result[key] = val === true || val === 1 || val === '1' || val === 'true';
    } else if (INT_FIELDS.includes(key)) {
      const n = parseInt(val, 10);
      result[key] = Number.isNaN(n) ? 0 : n;
    } else if (key === 'additional_info') {
      if (val === '[]' || val === '' || val === undefined || val === null) result[key] = [];
      else if (Array.isArray(val)) result[key] = val;
      else result[key] = String(val);
    } else {
      result[key] = String(val);
    }
  }
  // additional_info wajib ada walau tidak dikirim (umumnya pada form-urlencoded).
  if (!Object.prototype.hasOwnProperty.call(result, 'additional_info')) {
    result.additional_info = [];
  }
  return result;
}

/**
 * Hitung signature callback iPaymu.
 *
 * Object diurutkan A-Z (case-sensitive), di-JSON-kan, garis miring di-escape
 * (mengikuti json_encode PHP), lalu HMAC-SHA256 dengan VA sebagai secret.
 *
 * @param {object} payload payload ternormalisasi
 * @param {string} secret VA merchant
 * @returns {string} signature hex lowercase
 */
function signCallback(payload, secret) {
  const sorted = {};
  for (const key of Object.keys(payload).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    sorted[key] = payload[key];
  }
  const json = JSON.stringify(sorted).replace(/\//g, '\\/');
  return crypto.createHmac('sha256', secret).update(json).digest('hex');
}

/**
 * Verifikasi signature callback iPaymu.
 *
 * @param {object} rawBody body callback (sudah ter-parse)
 * @param {string} signature header X-Signature
 * @param {object} [settings] settings situs
 * @returns {{ok: boolean, reason?: string, paid?: boolean, orderId?: string, raw?: object}} hasil
 */
function ipaymuVerify(rawBody, signature, settings) {
  const keys = ipaymuKeys(settings);
  if (!keys.va) return { ok: false, reason: 'VA iPaymu belum diatur.' };
  if (!signature) return { ok: false, reason: 'Header X-Signature tidak ada.' };
  if (!rawBody || typeof rawBody !== 'object') return { ok: false, reason: 'Body callback kosong.' };

  const normalized = normalizeCallback(rawBody);
  // Field `signature` di dalam body (bila ada) bukan bagian dari payload hash.
  if (Object.prototype.hasOwnProperty.call(normalized, 'signature')) {
    delete normalized.signature;
  }

  const expected = signCallback(normalized, keys.va);
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature callback tidak cocok.' };
  }

  const statusCode = Number(normalized.status_code);
  const trxStatus = Number(normalized.transaction_status_code);
  // status_code 1 = sukses. transaction_status_code 1 = settlement langsung,
  // 6 = dana diterima tetapi settlement diproses terpisah.
  const paid = statusCode === 1 || trxStatus === 1 || trxStatus === 6;

  return {
    ok: true,
    paid,
    orderId: String(normalized.reference_id || normalized.referenceId || ''),
    raw: normalized
  };
}

/**
 * Ambil daftar kanal pembayaran yang tersedia (untuk info/debug).
 *
 * @param {object} [settings] settings situs
 * @returns {Promise<object>} daftar kanal
 */
async function ipaymuChannels(settings) {
  const keys = ipaymuKeys(settings);
  if (!keys.va || !keys.apiKey) throw new Error('iPaymu belum dikonfigurasi.');
  const bodyJson = '{}';
  const res = await fetch(`${baseUrl(settings)}/payment-channels`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      va: keys.va,
      signature: signRequest('GET', keys.va, bodyJson, keys.apiKey),
      timestamp: timestamp()
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gagal ambil kanal iPaymu: HTTP ${res.status}`);
  return body;
}

module.exports = {
  isIpaymuConfigured,
  ipaymuKeys,
  ipaymuCreate,
  ipaymuVerify,
  ipaymuChannels,
  signRequest,
  signCallback,
  normalizeCallback,
  baseUrl,
  SANDBOX_BASE,
  PRODUCTION_BASE
};
