'use strict';

const express = require('express');
const db = require('../db');
const helpers = require('../utils/helpers');
const { upload } = require('../multer');
const { flash } = require('../middleware/context');
const gateways = require('../payment/gateways');

const router = express.Router();

function findBooking(code) {
  const data = db.read();
  const booking = (data.bookings || []).find((b) => b.code === String(code || '').trim());
  return { data, booking };
}

const PAY_LABEL = {
  unpaid: 'Belum dibayar',
  awaiting_review: 'Menunggu verifikasi admin',
  paid: 'Lunas',
  failed: 'Pembayaran gagal'
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
    midtransOn: gateways.isMidtransConfigured(data.settings),
    tripayOn: gateways.isTripayConfigured(data.settings)
  });
});

/* Mulai pembayaran via gateway (Midtrans / Tripay). */
router.post('/pembayaran/:code/bayar', async (req, res, next) => {
  const { data, booking } = findBooking(req.params.code);
  if (!booking) return next();
  if ((booking.paymentStatus || 'unpaid') === 'paid') {
    flash('info', 'Booking ini sudah lunas.', req);
    return res.redirect(`/pembayaran/${booking.code}`);
  }
  const method = String(req.body.method || '');
  try {
    let result;
    if (method === 'midtrans' && gateways.isMidtransConfigured(data.settings)) {
      result = await gateways.midtransCreate({ settings: data.settings, booking, req });
    } else if (method === 'tripay' && gateways.isTripayConfigured(data.settings)) {
      result = await gateways.tripayCreate({ settings: data.settings, booking, req });
    } else {
      flash('error', 'Metode pembayaran tidak dikenal atau belum dikonfigurasi.', req);
      return res.redirect(`/pembayaran/${booking.code}`);
    }
    booking.paymentMethod = result.gateway;
    booking.paymentRef = result.ref;
    booking.paymentUrl = result.url;
    booking.paymentStatus = 'unpaid';
    db.write();
    res.redirect(result.url);
  } catch (err) {
    flash('error', `Gagal membuat transaksi: ${err.message}`, req);
    res.redirect(`/pembayaran/${booking.code}`);
  }
});

/* Konfirmasi manual transfer: tandai "menunggu verifikasi" + opsional bukti. */
router.post('/pembayaran/:code/manual', upload.single('proof'), (req, res, next) => {
  const { data, booking } = findBooking(req.params.code);
  if (!booking) return next();
  booking.paymentMethod = 'manual';
  booking.paymentStatus = 'awaiting_review';
  booking.paymentNote = String(req.body.note || '').trim().slice(0, 300);
  if (req.file) booking.proofImage = `/uploads/${req.file.filename}`;
  db.write();
  flash('success', `Terima kasih! Bukti transfer booking ${booking.code} diterima. Admin akan memverifikasi maksimal 1×24 jam.`, req);
  res.redirect(`/pembayaran/${booking.code}`);
});

/* Webhook Midtrans (server-to-server). */
router.post('/payment/webhook/midtrans', express.json(), (req, res) => {
  const data = db.read();
  const verdict = gateways.midtransVerify(req.body, data.settings);
  if (!verdict.ok) return res.status(403).json({ ok: false, reason: verdict.reason });
  const booking = (data.bookings || []).find((b) => b.code === verdict.orderId);
  if (!booking) return res.status(404).json({ ok: false, reason: 'Order tidak ditemukan.' });
  if (verdict.paid) {
    booking.paymentStatus = 'paid';
    booking.paidAt = new Date().toISOString();
    if (booking.status === 'pending') booking.status = 'confirmed';
  } else {
    booking.paymentStatus = 'failed';
  }
  booking.paymentGatewayRaw = { gateway: 'midtrans', status: verdict.raw && verdict.raw.transaction_status };
  db.write();
  res.json({ ok: true });
});

/* Webhook Tripay (server-to-server, butuh raw body untuk signature). */
router.post('/payment/webhook/tripay', (req, res) => {
  const rawBody = req.rawBody || '';
  const data = db.read();
  const verdict = gateways.tripayVerify(rawBody, data.settings);
  if (!verdict.ok) return res.status(403).json({ ok: false, reason: verdict.reason });
  const booking = (data.bookings || []).find((b) => b.code === verdict.orderId);
  if (!booking) return res.status(404).json({ ok: false, reason: 'Order tidak ditemukan.' });
  if (verdict.paid) {
    booking.paymentStatus = 'paid';
    booking.paidAt = new Date().toISOString();
    if (booking.status === 'pending') booking.status = 'confirmed';
  } else {
    booking.paymentStatus = 'failed';
  }
  booking.paymentGatewayRaw = { gateway: 'tripay', status: verdict.raw && verdict.raw.status };
  db.write();
  res.json({ ok: true });
});

module.exports = router;
module.exports.payLabel = payLabel;