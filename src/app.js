'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');

const { context } = require('./middleware/context');
const { verifyCsrf } = require('./middleware/security');
const publicRoutes = require('./routes/public.routes');
const adminRoutes = require('./routes/admin.routes');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('layout', 'layouts/public');
  app.disable('x-powered-by');

  app.use(expressLayouts);

  // Webhook OpenWA harus SEBELUM `express.json()`.
  //
  // Tanda tangan HMAC-SHA256 dihitung atas byte mentah yang dikirim gateway.
  // Kalau `express.json()` jalan lebih dulu, body ter-parse lalu di-stringify
  // ulang — urutan kunci bisa berubah dan signature tidak cocok, sehingga
  // SEMUA delivery ditolak 401. Router ini memakai `express.raw()`.
  app.use('/api/webhooks/openwa', require('./routes/openwa-webhook.routes').createOpenwaWebhookRouter());

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(methodOverride('_method'));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'jje-dev-secret-ganti-dengan-string-acak',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
    })
  );

  app.use(context);
  app.use(verifyCsrf);
  app.use(require('./middleware/customerAuth').attachCustomer);

  app.use('/', publicRoutes);
  app.use('/', require('./routes/payment.routes'));
  app.use('/', require('./routes/account.routes'));
  // API berbagi posisi (presence). Token CSRF dikirim lewat header
  // `x-csrf-token` (lihat public/js/presence.js) — endpoint ini dipanggil
  // lewat fetch(), bukan form HTML.
  app.use('/api/presence', require('./routes/presence.routes'));
  app.use('/admin', adminRoutes);

  app.use((req, res) => {
    res.status(404).render('pages/404', {
      title: 'Halaman Tidak Ditemukan',
      layout: 'layouts/public'
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Token CSRF tidak valid pada form multipart.
    if (err && err.code === 'INVALID_CSRF') {
      return res.status(403).render('pages/error', {
        title: 'Permintaan Ditolak',
        status: 403,
        message: err.message,
        layout: 'layouts/public'
      });
    }
    // Gambar polos / transparan ditolak saat unggah (placeholder merah/kosong).
    if (err && err.code === 'BLANK_IMAGE') {
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message: err.message });
      }
      return res.redirect('back');
    }
    // Pesan galat unggah: format tidak didukung / ukuran terlalu besar.
    //
    // Batas ukuran sekarang PER-SLOT (lihat SLOT_SPECS di services/image.js),
    // jadi pesan tidak bisa lagi berupa konstanta tunggal. Yang dipakai di
    // sini hanya pola "Format ... tidak diizinkan untuk ..." yang mencakup
    // semua slot.
    const isUploadError =
      err &&
      (
        err.code === 'INVALID_IMAGE' ||
        err.code === 'LIMIT_FILE_SIZE' ||
        /tidak diizinkan untuk/.test(err.message || '') ||
        /maksimal .+\.$/.test(err.message || '')
      );
    if (isUploadError) {
      const message = err.message || 'Berkas gambar tidak dapat diproses.';
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message });
      }
      return res.redirect('back');
    }
    console.error(err);
    if (res.headersSent) return;
    res.status(500).render('pages/error', {
      title: 'Terjadi Kesalahan',
      status: 500,
      message: 'Server mengalami gangguan. Silakan coba lagi beberapa saat lagi.',
      layout: 'layouts/public'
    });
  });

  return app;
}

module.exports = { createApp };