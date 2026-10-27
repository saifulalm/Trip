'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');

const { context } = require('./middleware/context');
const { verifyCsrf, rejectCsrf } = require('./middleware/security');
const publicRoutes = require('./routes/public.routes');
const adminRoutes = require('./routes/admin.routes');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('layout', 'layouts/public');
  app.disable('x-powered-by');

  // Di belakang reverse proxy (nginx/Apache/Caddy), setel TRUST_PROXY=1 di
  // .env agar req.ip memakai IP klien asli, bukan IP proxy.
  //
  // Tanpa ini, SEMUA permintaan terlihat datang dari 127.0.0.1 — dan rate
  // limit login akan mengunci seluruh pengguna setelah beberapa percobaan.
  //
  // Nilai = jumlah proxy yang dipercaya (1 = satu hop). Jangan pakai `true`
  // kecuali seluruh jaringan dalam tee mempercayai header X-Forwarded-For.
  const trustProxy = String(process.env.TRUST_PROXY || '').trim();
  if (trustProxy) {
    const hops = Number(trustProxy);
    app.set('trust proxy', Number.isFinite(hops) ? hops : trustProxy);
  }

  app.use(expressLayouts);
  app.use(express.urlencoded({ extended: true }));
  app.use(
    express.json({
      verify(req, res, buf) {
        req.rawBody = buf.toString('utf8'); // untuk verifikasi signature Tripay
      }
    })
  );
  app.use(methodOverride('_method'));
  // STATIC_DIR bisa dioverride lewat environment (dipakai test otomatis
  // supaya berkas uji tidak bercampur dengan berkas asli).
  const staticDir = process.env.STATIC_DIR
    ? path.resolve(process.env.STATIC_DIR)
    : path.join(__dirname, '..', 'public');
  app.use(express.static(staticDir, { maxAge: '1h' }));

  // Header keamanan dasar.
  // X-Content-Type-Options: nosniff penting untuk folder upload — browser
  // tidak boleh menebak tipe berkas, sehingga berkas yang menyamar
  // (mis. .jpg yang sebenarnya skrip) tidak bisa dieksekusi/di-render.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  app.use(
    session({
      // Tanpa SESSION_SECRET di environment, pakai secret acak per proses:
      // lebih aman daripada secret hardcoded di source (yang bisa bocor lewat
      // repo), dengan konsekuensi sesi tidak bertahan setelah restart.
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
    })
  );

  app.use(context);
  // attachCustomer SEBELUM verifyCsrf: middleware CSRF me-render halaman error
  // dengan layout publik. Kalau currentCustomer belum di-set, render itu
  // melempar ReferenceError dan pengguna melihat stack trace, bukan pesan
  // "sesi kedaluwarsa" yang rapi.
  app.use(require('./middleware/customerAuth').attachCustomer);
  app.use(verifyCsrf);

  app.use('/', publicRoutes);
  app.use('/', require('./routes/payment.routes'));
  app.use('/', require('./routes/account.routes'));
  app.use('/admin', adminRoutes);

  // Jaring pengaman CSRF: request multipart yang verifikasi token-nya
  // ditunda (karena body baru ter-parse setelah multer) TIDAK boleh lolos
  // tanpa TOKEN yang sudah dicek.
  app.use((req, res, next) => {
    if (req.csrfDeferred && !req.csrfVerified) {
      return rejectCsrf(res);
    }
    next();
  });

  app.use((req, res) => {
    res.status(404).render('pages/404', {
      title: 'Halaman Tidak Ditemukan',
      layout: 'layouts/public'
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Redirect aman ke halaman sebelumnya. Bentuk "back" sudah deprecated
    // di Express 4.x dan melempar error 500 bila request tidak membawa
    // header Referer (mis. saat di-bookmark atau dipanggil API).
    const redirectBack = () => {
      const referer = req.get('Referrer') || '/';
      return res.redirect(referer);
    };

    // Kegagalan upload: berkas ditolak karena format/ukuran/isi.
    const isUploadError =
      err && (err.code === 'UPLOAD_REJECTED' || err.code === 'LIMIT_FILE_SIZE' ||
        err.message === 'Format file harus JPG, PNG, WEBP, atau GIF.');
    if (isUploadError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran gambar maksimal 5 MB.'
        : err.message;
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message });
      }
      return redirectBack();
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