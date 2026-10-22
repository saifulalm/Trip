'use strict';

/**
 * Lapisan payment gateway jalanjalanenak.com.
 * Metode: manual transfer (selalu aktif), Midtrans Snap (REST resmi),
 * dan Tripay (REST + HMAC-SHA256). Tanpa dependensi native.
 */

const crypto = require('crypto');

function isMidtransConfigured(settings) {
  return Boolean(settings.midtransServerKey || process.env.MIDTRANS_SERVER_KEY);
}

function isTripayConfigured(settings) {
  return Boolean(settings.tripayApiKey || process.env.TRIPAY_API_KEY);
}

function midtransKeys(settings) {
  return {
    serverKey: settings.midtransServerKey || process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: settings.midtransClientKey || process.env.MIDTRANS_CLIENT_KEY || '',
    production: settings.midtransProduction === true
  };
}

function tripayKeys(settings) {
  return {
    merchantCode: settings.tripayMerchantCode || process.env.TRIPAY_MERCHANT_CODE || '',
    privateKey: settings.tripayPrivateKey || process.env.TRIPAY_PRIVATE_KEY || '',
    apiKey: settings.tripayApiKey || process.env.TRIPAY_API_KEY || '',
    production: settings.tripayProduction === true
  };
}

function baseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/* ---------------- Midtrans Snap ---------------- */

async function midtransCreate({ settings, booking, req }) {
  const keys = midtransKeys(settings);
  const host = keys.production ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  const base = baseUrl(req);
  const gross = Number(booking.totalAmount || 0);
  const payload = {
    transaction_details: { order_id: booking.code, gross_amount: gross },
    item_details: [
      {
        id: booking.packageSlug,
        price: Number(booking.packagePrice || 0),
        quantity: Number(booking.participants || 1),
        name: String(booking.packageName || 'Paket Wisata').slice(0, 40)
      }
    ],
    customer_details: {
      first_name: booking.name,
      email: booking.email,
      phone: booking.phone
    },
    callbacks: {
      finish: `${base}/pembayaran/${booking.code}`,
      unfinish: `${base}/pembayaran/${booking.code}`,
      error: `${base}/pembayaran/${booking.code}`
    }
  };
  const res = await fetch(`${host}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${keys.serverKey}:`).toString('base64')}`
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.redirect_url) {
    const msg = body.error_messages ? body.error_messages.join('; ') : `HTTP ${res.status}`;
    throw new Error(`Midtrans menolak transaksi: ${msg}`);
  }
  return { gateway: 'midtrans', ref: body.token, url: body.redirect_url };
}

/** signature = SHA512(order_id + status_code + gross_amount + serverKey) */
function midtransVerify(notif, settings) {
  const keys = midtransKeys(settings);
  if (!keys.serverKey) return { ok: false, reason: 'Server key Midtrans belum diatur.' };
  const { order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: signature } = notif || {};
  if (!orderId || !statusCode || grossAmount === undefined || !signature) {
    return { ok: false, reason: 'Field notifikasi tidak lengkap.' };
  }
  const expected = crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${keys.serverKey}`).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature tidak cocok.' };
  }
  const paid = [200, 201].includes(Number(statusCode)) && String(notif.fraud_status || 'accept') !== 'deny';
  return { ok: true, paid, orderId, raw: notif };
}

/* ---------------- Tripay ---------------- */

async function tripayCreate({ settings, booking, req }) {
  const keys = tripayKeys(settings);
  const base = baseUrl(req);
  const merchantRef = booking.code;
  const amount = Number(booking.totalAmount || 0);
  const signature = hmac(keys.privateKey, `${keys.merchantCode}|${merchantRef}|${amount}|0`);
  const res = await fetch('https://tripay.co.id/api/transaction/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${keys.apiKey}`
    },
    body: JSON.stringify({
      merchant_code: keys.merchantCode,
      merchant_ref: merchantRef,
      amount,
      customer_name: booking.name,
      customer_email: booking.email,
      customer_phone: booking.phone,
      order_items: [
        {
          sku: booking.packageSlug,
          name: String(booking.packageName || 'Paket Wisata').slice(0, 40),
          price: Number(booking.packagePrice || 0),
          quantity: Number(booking.participants || 1)
        }
      ],
      return_url: `${base}/pembayaran/${booking.code}`,
      callback_url: `${base}/payment/webhook/tripay`,
      expires_in: 60 * 24
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success !== true || !body.data || !body.data.checkout_url) {
    const msg = (body && body.message) || `HTTP ${res.status}`;
    throw new Error(`Tripay menolak transaksi: ${msg}`);
  }
  return { gateway: 'tripay', ref: body.data.reference, url: body.data.checkout_url };
}

/** signature = HMAC-SHA256(raw body JSON, private key merchant). */
function tripayVerify(rawBody, settings) {
  const keys = tripayKeys(settings);
  if (!keys.privateKey || !rawBody) return { ok: false, reason: 'Private key Tripay belum diatur / body kosong.' };
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return { ok: false, reason: 'Body callback bukan JSON valid.' };
  }
  const expected = hmac(keys.privateKey, rawBody);
  const a = Buffer.from(String(payload.signature || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature callback tidak cocok.' };
  }
  const status = String(payload.status || '').toUpperCase();
  return { ok: true, paid: status === 'PAID', orderId: payload.merchant_ref, raw: payload };
}

module.exports = {
  isMidtransConfigured,
  isTripayConfigured,
  midtransCreate,
  midtransVerify,
  tripayCreate,
  tripayVerify,
  baseUrl
};