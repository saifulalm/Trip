'use strict';

const express = require('express');
const db = require('../db');
const { flash } = require('../middleware/context');
const ipaymu = require('../payment/ipaymu');

const router = express.Router();

function findBooking(code) {
  const data = db.read();
  const booking = (data.bookings || []).find((b) => b.code === String(code || '').trim());
  return { data, booking };
}

const PAY_LABEL = {
  unpaid: 'Belum dibayar',
  pending: 'Menunggu pembayaran',
  paid: 'Lunas',
  failed: 'Pembayaran gagal',
  expired: 'Kedaluwarsa'
};

function payLabel(s) {
  return PAY_LABEL[s] || PAY_LABEL.unpaid;
}

/* Halaman status & pilihan pembayaran publik (tanpa login). */
router.get('/pembayaran/:code', (req, res, next) => {
  const { data, booking } = findBooking(req.params.code);
  if (!booking) return next();
  res.render('pages/payment', {
    title: `Pembayaran ${booking.code}`,
    booking,
    payLabel,
    payStatus: booking.paymentStatus || 'unpaid',
    ipaymuOn: ipaymu.isIpaymuConfigured(data.settings)
  });
});

/* Mulai pembayaran lewat iPaymu (Redirect Payment). */
router.post('/pembayaran/:code/bayar', async (req, res, next) => {
  const { data, booking } = findBooking(req.params.code);
  if (!booking) return next();
  if ((booking.paymentStatus || 'unpaid') === 'paid') {
    flash('info', 'Booking ini sudah lunas.', req);
    return res.redirect(`/pembayaran/${booking.code}`);
  }
  if (!ipaymu.isIpaymuConfigured(data.settings)) {
    flash('error', 'Pembayaran online belum dikonfigurasi. Silakan hubungi kami untuk bantuan.', req);
    return res.redirect(`/pembayaran/${booking.code}`);
  }

  try {
    const result = await ipaymu.ipaymuCreate({ settings: data.settings, booking, req });
    booking.paymentMethod = result.gateway;
    booking.paymentRef = result.ref;
    booking.paymentUrl = result.url;
    booking.paymentStatus = 'pending';
    db.write();
    res.redirect(result.url);
  } catch (err) {
    flash('error', `Gagal membuat transaksi: ${err.message}`, req);
    res.redirect(`/pembayaran/${booking.code}`);
  }
});

/* Webhook iPaymu (server-to-server). Signature diverifikasi dengan VA. */
router.post('/payment/webhook/ipaymu', (req, res) => {
  const data = db.read();
  const signature = req.headers['x-signature'];
  const verdict = ipaymu.ipaymuVerify(req.body, signature, data.settings);

  // Selalu balas 200 agar iPaymu tidak mengulang notifikasi — kecuali bila
  // signature memang salah (permintaan dari pihak lain, bukan iPaymu).
  if (!verdict.ok) {
    return res.status(403).json({ ok: false, reason: verdict.reason });
  }

  const orderId = verdict.orderId;
  const booking = (data.bookings || []).find((b) => b.code === orderId);
  if (!booking) {
    return res.status(404).json({ ok: false, reason: 'Order tidak ditemukan.' });
  }

  // Idempoten: jangan proses ulang transaksi yang sudah lunas.
  if (booking.paymentStatus === 'paid') {
    return res.json({ ok: true, already: true });
  }

  if (verdict.paid) {
    booking.paymentStatus = 'paid';
    booking.paidAt = new Date().toISOString();
    booking.paymentMethod = 'ipaymu';
    if (booking.status === 'pending') booking.status = 'confirmed';
  } else {
    booking.paymentStatus = 'failed';
  }

  booking.paymentGatewayRaw = {
    gateway: 'ipaymu',
    status: verdict.raw && verdict.raw.status,
    trxId: verdict.raw && verdict.raw.trx_id,
    via: verdict.raw && verdict.raw.via,
    channel: verdict.raw && verdict.raw.channel
  };
  db.write();

  res.json({ ok: true });
});

module.exports = router;
module.exports.payLabel = payLabel;
