'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const { flash } = require('../middleware/context');
const { requireCustomer, customerLoginLimiter, clearCustomerLoginAttempts } = require('../middleware/customerAuth');
const { isEmail, isPhone } = require('../utils/helpers');

const router = express.Router();

/* ============ Register ============ */
router.get('/daftar', (req, res) => {
  if (req.session.customerId) return res.redirect('/akun');
  res.render('pages/auth-register', {
    title: 'Daftar Akun',
    layout: 'layouts/public'
  });
});

router.post('/daftar', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.passwordConfirm || '');

  if (name.length < 3) {
    flash('error', 'Nama minimal 3 karakter.', req);
    return res.redirect('/daftar');
  }
  if (!isEmail(email)) {
    flash('error', 'Format email tidak valid.', req);
    return res.redirect('/daftar');
  }
  if (!isPhone(phone)) {
    flash('error', 'Nomor HP tidak valid. Gunakan format 08xx atau 62xx.', req);
    return res.redirect('/daftar');
  }
  if (password.length < 8) {
    flash('error', 'Kata sandi minimal 8 karakter.', req);
    return res.redirect('/daftar');
  }
  if (password !== passwordConfirm) {
    flash('error', 'Konfirmasi kata sandi tidak cocok.', req);
    return res.redirect('/daftar');
  }

  const data = db.read();
  // PENTING: pastikan array-nya benar-benar menempel ke `data`. Kalau
  // `data.customers` belum ada, `data.customers || []` membuat array BARU
  // yang tidak tersimpan — akun baru akan hilang diam-diam.
  data.customers = data.customers || [];
  if (data.customers.some((c) => c.email === email)) {
    flash('error', 'Email sudah terdaftar. Silakan masuk.', req);
    return res.redirect('/masuk');
  }

  const customer = {
    id: db.uid('cus'),
    name,
    email,
    phone,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString()
  };
  data.customers.push(customer);
  db.write();
  // Regenerasi ID sesi (mitigasi session fixation).
  req.session.regenerate((err) => {
    if (err) {
      flash('error', 'Akun berhasil dibuat, tetapi sesi gagal dibuat. Silakan masuk.', req);
      return res.redirect('/masuk');
    }
    req.session.customerId = customer.id;
    flash('success', 'Akun berhasil dibuat. Selamat datang!', req);
    res.redirect('/akun');
  });
});

/* ============ Login ============ */
router.get('/masuk', (req, res) => {
  if (req.session.customerId) return res.redirect('/akun');
  res.render('pages/auth-login', {
    title: 'Masuk Akun',
    layout: 'layouts/public',
    nextUrl: req.query.next || '/akun'
  });
});

router.post('/masuk', customerLoginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const nextUrl = String(req.body.next || '/akun');

  const data = db.read();
  const customer = (data.customers || []).find((c) => c.email === email);
  if (!customer || !bcrypt.compareSync(password, customer.passwordHash)) {
    flash('error', 'Email atau kata sandi salah.', req);
    return res.redirect('/masuk');
  }

  clearCustomerLoginAttempts(req);
  // Regenerasi ID sesi saat login (mitigasi session fixation).
  req.session.regenerate((err) => {
    if (err) {
      flash('error', 'Gagal membuat sesi. Silakan coba lagi.', req);
      return res.redirect('/masuk');
    }
    req.session.customerId = customer.id;
    flash('success', `Halo, ${customer.name.split(' ')[0]}!`, req);

    // Hanya izinkan redirect internal.
    const safeNext = nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/akun';
    res.redirect(safeNext);
  });
});

router.post('/keluar', (req, res) => {
  delete req.session.customerId;
  flash('success', 'Anda telah keluar.', req);
  res.redirect('/');
});

/* ============ Dashboard ============ */
router.get('/akun', requireCustomer, (req, res) => {
  const data = db.read();
  const bookings = (data.bookings || [])
    .filter((b) => b.customerId === req.customer.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  res.render('pages/account', {
    title: 'Akun Saya',
    layout: 'layouts/public',
    bookings
  });
});

/* ============ Profil ============ */
router.get('/akun/profil', requireCustomer, (req, res) => {
  res.render('pages/account-profile', {
    title: 'Profil Saya',
    layout: 'layouts/public'
  });
});

router.post('/akun/profil', requireCustomer, (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();

  if (name.length < 3) {
    flash('error', 'Nama minimal 3 karakter.', req);
    return res.redirect('/akun/profil');
  }
  if (!isPhone(phone)) {
    flash('error', 'Nomor HP tidak valid.', req);
    return res.redirect('/akun/profil');
  }

  const data = db.read();
  const customer = (data.customers || []).find((c) => c.id === req.customer.id);
  if (customer) {
    customer.name = name;
    customer.phone = phone;
    db.write();
  }
  flash('success', 'Profil berhasil diperbarui.', req);
  res.redirect('/akun/profil');
});

router.post('/akun/sandi', requireCustomer, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  const confirm = String(req.body.confirmPassword || '');

  const data = db.read();
  const customer = (data.customers || []).find((c) => c.id === req.customer.id);
  if (!customer || !bcrypt.compareSync(current, customer.passwordHash)) {
    flash('error', 'Kata sandi saat ini salah.', req);
    return res.redirect('/akun/profil');
  }
  if (next.length < 8) {
    flash('error', 'Kata sandi baru minimal 8 karakter.', req);
    return res.redirect('/akun/profil');
  }
  if (next !== confirm) {
    flash('error', 'Konfirmasi kata sandi baru tidak cocok.', req);
    return res.redirect('/akun/profil');
  }

  customer.passwordHash = bcrypt.hashSync(next, 10);
  db.write();
  flash('success', 'Kata sandi berhasil diganti.', req);
  res.redirect('/akun/profil');
});

/* ============ Sambungkan booking lama ============ */
router.post('/akun/sambung-booking', requireCustomer, (req, res) => {
  const code = String(req.body.code || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();

  const data = db.read();
  const booking = (data.bookings || []).find((b) => b.code === code && b.email === email);
  if (!booking) {
    flash('error', 'Kode booking atau email tidak cocok.', req);
    return res.redirect('/akun');
  }
  if (booking.customerId && booking.customerId !== req.customer.id) {
    flash('error', 'Booking ini sudah terhubung ke akun lain.', req);
    return res.redirect('/akun');
  }
  booking.customerId = req.customer.id;
  db.write();
  flash('success', `Booking ${code} berhasil disambungkan ke akun Anda.`, req);
  res.redirect(`/akun/booking/${booking.id}`);
});

/* ============ Detail booking + GPS check-in ============ */
router.get('/akun/booking/:id', requireCustomer, (req, res) => {
  const data = db.read();
  const booking = (data.bookings || []).find(
    (b) => b.id === req.params.id && b.customerId === req.customer.id
  );
  if (!booking) {
    flash('error', 'Booking tidak ditemukan.', req);
    return res.redirect('/akun');
  }

  const destination = (data.destinations || []).find((d) => d.slug === booking.packageSlug);
  const canCheckIn =
    (booking.status === 'confirmed' || booking.status === 'pending') && !booking.checkIn;
  const canReview =
    booking.status === 'completed' &&
    !(data.reviews || []).some((r) => r.bookingCode === booking.code);

  res.render('pages/account-booking', {
    title: `Booking ${booking.code}`,
    layout: 'layouts/public',
    booking,
    destination,
    canCheckIn,
    canReview,
    mapData: JSON.stringify({
      dest: destination && destination.lat ? { lat: destination.lat, lng: destination.lng, name: destination.name } : null,
      checkIn: booking.checkIn || null,
      track: booking.track || []
    })
  });
});

router.post('/akun/booking/:id/checkin', requireCustomer, (req, res) => {
  const data = db.read();
  const booking = (data.bookings || []).find(
    (b) => b.id === req.params.id && b.customerId === req.customer.id
  );
  if (!booking) {
    flash('error', 'Booking tidak ditemukan.', req);
    return res.redirect('/akun');
  }
  if (booking.checkIn) {
    flash('error', 'Check-in sudah pernah dilakukan untuk booking ini.', req);
    return res.redirect(`/akun/booking/${booking.id}`);
  }
  if (booking.status !== 'confirmed' && booking.status !== 'pending') {
    flash('error', 'Check-in hanya tersedia untuk booking aktif.', req);
    return res.redirect(`/akun/booking/${booking.id}`);
  }

  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const accuracy = parseFloat(req.body.accuracy) || null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    flash('error', 'Koordinat GPS tidak valid.', req);
    return res.redirect(`/akun/booking/${booking.id}`);
  }

  booking.checkIn = { lat, lng, accuracy, at: new Date().toISOString() };
  booking.track = booking.track || [];
  booking.track.push({ label: `Check-in ${booking.name}`, lat, lng, at: booking.checkIn.at });
  db.write();

  flash('success', 'Check-in berhasil! Koordinat keberangkatan Anda tercatat.', req);
  res.redirect(`/akun/booking/${booking.id}`);
});

/* ============ Ulasan (setelah trip selesai) ============ */
router.post('/akun/booking/:id/ulasan', requireCustomer, (req, res) => {
  const data = db.read();
  const booking = (data.bookings || []).find(
    (b) => b.id === req.params.id && b.customerId === req.customer.id
  );
  if (!booking || booking.status !== 'completed') {
    flash('error', 'Ulasan hanya bisa diberikan setelah trip selesai.', req);
    return res.redirect('/akun');
  }
  if ((data.reviews || []).some((r) => r.bookingCode === booking.code)) {
    flash('error', 'Anda sudah memberi ulasan untuk booking ini.', req);
    return res.redirect(`/akun/booking/${booking.id}`);
  }

  const rating = Math.max(1, Math.min(5, parseInt(req.body.rating, 10) || 0));
  const comment = String(req.body.comment || '').trim();
  if (!comment || comment.length < 10) {
    flash('error', 'Tuliskan ulasan minimal 10 karakter.', req);
    return res.redirect(`/akun/booking/${booking.id}`);
  }

  const reviews = data.reviews || [];
  reviews.push({
    id: db.uid('rev'),
    bookingCode: booking.code,
    customerName: booking.name,
    packageName: booking.packageName,
    rating,
    comment,
    status: 'pending', // menunggu persetujuan admin
    createdAt: new Date().toISOString()
  });
  data.reviews = reviews;
  db.write();

  flash('success', 'Terima kasih! Ulasan Anda menunggu persetujuan admin.', req);
  res.redirect(`/akun/booking/${booking.id}`);
});

module.exports = router;