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
  app.use(express.urlencoded({ extended: true }));
  app.use(
    express.json({
      verify(req, res, buf) {
        req.rawBody = buf.toString('utf8'); // untuk verifikasi signature Tripay
      }
    })
  );
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
  app.use('/admin', adminRoutes);

  app.use((req, res) => {
    res.status(404).render('pages/404', {
      title: 'Halaman Tidak Ditemukan',
      layout: 'layouts/public'
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.message === 'Format file harus JPG, PNG, WEBP, atau GIF.') {
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message: err.message });
      }
      return res.redirect('back');
    }
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message: 'Ukuran gambar maksimal 5 MB.' });
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