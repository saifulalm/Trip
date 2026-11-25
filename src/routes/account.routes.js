'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const { flash } = require('../middleware/context');
const { requireCustomer, customerLoginLimiter, clearCustomerLoginAttempts } = require('../middleware/customerAuth');
const { isEmail, isPhone } = require('../utils/helpers');
const geo = require('../services/geo');
const presence = require('../services/presence');
const roster = require('../services/roster');
const trip = require('../services/trip');

const router = express.Router();

/**
 * Radius check-in yang masih dianggap "di titik kumpul" (meter).
 * Nilai longgar karena titik kumpul berada di dermaga/pelabuhan yang
 * biasanya tidak persis sama dengan titik tengah pulau.
 */
const CHECKIN_RADIUS_M = 5000;

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
  const customers = data.customers || [];
  if (customers.some((c) => c.email === email)) {
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
  customers.push(customer);
  db.write(data);
  req.session.customerId = customer.id;
  flash('success', 'Akun berhasil dibuat. Selamat datang!', req);
  res.redirect('/akun');
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
  req.session.customerId = customer.id;
  flash('success', `Halo, ${customer.name.split(' ')[0]}!`, req);

  // Hanya izinkan redirect internal.
  const safeNext = nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/akun';
  res.redirect(safeNext);
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

  // Riwayat ulasan milik pelanggan ini (untuk KPI & status reviewed).
  const myReviews = (data.reviews || []).filter(
    (r) => bookings.some((b) => b.code === r.bookingCode)
  );

  // Ringkasan KPI dasbor.
  const summary = trip.dashboardSummary(bookings, myReviews);

  // Dekorasi tiap booking: destinasi, jarak, tahap progress, label status.
  const cards = bookings.map((b) => {
    const destination = trip.resolveDestination(data, b);
    const distance = trip.distanceToDestination(b, destination);
    return {
      booking: b,
      destination,
      distance,
      distanceLabel: distance === null ? null : geo.formatDistanceShort(distance),
      steps: trip.progressSteps(b),
      reviewed: myReviews.some((r) => r.bookingCode === b.code)
    };
  });

  // Booking terdekat yang akan datang (untuk banner "perjalanan berikutnya").
  const nextCard = cards.find(
    (c) =>
      c.booking.departureDate &&
      c.booking.departureDate >= new Date().toISOString().slice(0, 10) &&
      c.booking.status !== 'cancelled'
  ) || null;

  // Rekomendasi trip: paket published yang belum pernah dipesan.
  const bookedSlugs = new Set(bookings.map((b) => b.packageSlug));
  const recommendations = (data.packages || [])
    .filter((p) => p.status === 'published' && !bookedSlugs.has(p.slug))
    .slice(0, 3);

  res.render('pages/account', {
    title: 'Akun Saya',
    layout: 'layouts/public',
    bookings,
    cards,
    summary,
    nextCard,
    myReviews,
    recommendations
  });
});

/* ============ Lokasi Saya (live position) ============ */
/**
 * Halaman "Lokasi Saya" — menampilkan posisi pelanggan saat ini
 * (bila izin lokasi diberikan), posisi check-in terakhir, dan titik
 * kumpul (/meeting point) destinasi sebagai konteks.
 *
 * Permission location SELALU diminta di sisi klien (browser). Server
 * hanya merender kerangka + titik acuan; koordinat live TIDAK pernah
 * dikirim ke server kecuali pelanggan menekan tombol check-in atau
 * tombol "Simpan posisi" yang memang mengirim koordinat via POST.
 */
router.get('/akun/lokasi', requireCustomer, (req, res) => {
  const data = db.read();
  const bookings = (data.bookings || [])
    .filter((b) => b.customerId === req.customer.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Booking dengan check-in terakhir (paling baru). Jarak ke titik kumpul
  // HARUS dihitung terhadap destinasi booking YANG SAMA — kalau tidak,
  // koordinat Sabesi dibandingkan dengan titik kumpul Weh dan hasilnya
  // menyesatkan (ribuan km).
  const withCheckIn = bookings.find((b) => b.checkIn) || null;
  const today = new Date().toISOString().slice(0, 10);
  const activeBooking =
    bookings.find(
      (b) =>
        b.departureDate >= today && b.status !== 'cancelled'
    ) || bookings[0] || null;

  const destination = trip.resolveDestination(data, activeBooking);
  const lastCheckIn = withCheckIn ? withCheckIn.checkIn : null;
  const lastCheckInDestination = withCheckIn
    ? trip.resolveDestination(data, withCheckIn)
    : null;

  // Jarak dihitung ke destinasi booking yang MEMILIKI check-in tersebut.
  const distanceTarget = withCheckIn ? lastCheckInDestination : destination;
  const distance =
    lastCheckIn && distanceTarget && geo.isValidLatLng(distanceTarget.lat, distanceTarget.lng)
      ? geo.haversineMeters(lastCheckIn.lat, lastCheckIn.lng, distanceTarget.lat, distanceTarget.lng)
      : null;

  // Riwayat titik check-in (maksimal 20 terakhir) untuk garis jejak.
  const history = [];
  bookings.forEach((b) => {
    if (b.checkIn) {
      history.push({
        code: b.code,
        packageName: b.packageName,
        lat: b.checkIn.lat,
        lng: b.checkIn.lng,
        at: b.checkIn.at,
        accuracy: b.checkIn.accuracy
      });
    }
    (b.track || []).forEach((p) => {
      if (typeof p.lat === 'number' && typeof p.lng === 'number') {
        history.push({
          code: b.code,
          packageName: b.packageName,
          lat: p.lat,
          lng: p.lng,
          at: p.at,
          accuracy: null,
          label: p.label
        });
      }
    });
  });
  history.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

  res.render('pages/account-location', {
    title: 'Lokasi Saya',
    layout: 'layouts/public',
    bookings,
    destination,
    activeBooking,
    lastCheckIn,
    // Destinasi acuan untuk tampilan = destinasi booking yang memiliki
    // check-in (bila ada), supaya titik kumpul di peta sesuai dengan
    // koordinat check-in yang ditampilkan.
    checkInDestination: lastCheckInDestination,
    distance,
    distanceLabel: Number.isFinite(distance) ? geo.formatDistance(distance) : null,
    history: history.slice(-20),
    mapData: JSON.stringify({
      // Titik kumpul yang ditampilkan memakai booking yang sama dengan check-in
      // bila ada. Kalau tidak, pakai destinasi booking aktif.
      dest: (() => {
        const d = lastCheckInDestination || destination;
        return d && geo.isValidLatLng(d.lat, d.lng)
          ? { lat: d.lat, lng: d.lng, name: d.name }
          : null;
      })(),
      checkIn: lastCheckIn && geo.isValidLatLng(lastCheckIn.lat, lastCheckIn.lng) ? lastCheckIn : null,
      track: history.map((h) => ({ label: h.code, lat: h.lat, lng: h.lng, at: h.at }))
    })
  });
});

/* ------------------------------------------------------------------ */
/* Cari peserta (fellow traveler)                                      */
/* ------------------------------------------------------------------ */
/*
 * Pelanggan boleh mencari fellow traveler-nya sendiri. Ini bukan
 * direktori publik: hasil pencarian hanya berisi orang yang memang sudah
 * berhak dilihat (booking sama atau rombongan sama).
 *
 * Yang TIDAK boleh terjadi: satu pelanggan melihat pelanggan lain yang
 * tidak punya hubungan trip dengan dia.
 */
router.get('/akun/cari', requireCustomer, (req, res) => {
  const data = db.read();
  const customer = req.customer;
  const q = String(req.query.q || '').trim().toLowerCase();
  const bookingCode = String(req.query.booking || '').trim().toUpperCase();

  // Kumpulkan booking milik pelanggan ini.
  const myBookings = (data.bookings || []).filter((b) => b.customerId === customer.id);
  const myCodes = myBookings.map((b) => b.code);

  // Kumpulkan group yang diikuti pelanggan ini.
  const myGroups = roster.groupsForCustomer(data, customer.id);
  const myGroupIds = myGroups.map((g) => g.id);

  // Kandidat: semua pelanggan yang ada di booking saya atau group saya.
  const allowedCodes = new Set();
  myBookings.forEach((b) => allowedCodes.add(b.code));
  myGroups.forEach((g) => (g.bookingCodes || []).forEach((c) => allowedCodes.add(c)));

  const customers = data.customers || [];
  const allowedCustomerIds = new Set();
  (data.bookings || []).forEach((b) => {
    if (allowedCodes.has(b.code) && b.customerId) allowedCustomerIds.add(b.customerId);
  });

  // Kumpulkan posisi terakhir yang diketahui (live + last-seen).
  const seenMap = {};
  presence.lastSeenAll().forEach((e) => {
    seenMap[e.role + ':' + e.refId] = e;
  });

  let results = customers
    .filter((c) => allowedCustomerIds.has(c.id))
    .map((c) => {
      const entry = seenMap['customer:' + c.id] || null;
      const at = entry && entry.at ? new Date(entry.at).getTime() : 0;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        lat: entry ? entry.lat : null,
        lng: entry ? entry.lng : null,
        accuracy: entry ? entry.accuracy : null,
        at: entry ? entry.at : null,
        ageMin: at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null,
        mapsUrl: entry ? geo.mapsUrl(entry.lat, entry.lng, c.name) : '',
        shared: Boolean(c.id !== customer.id && entry)
      };
    });

  // Filter pencarian.
  if (q) {
    results = results.filter((c) =>
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.email || '').toLowerCase().includes(q) ||
      String(c.phone || '').includes(q)
    );
  }
  if (bookingCode) {
    const b = (data.bookings || []).find((x) => x.code === bookingCode);
    const allowed = b && allowedCustomerIds.has(b.customerId);
    if (!allowed) results = [];
  }

  res.render('pages/account-search', {
    title: 'Cari Peserta',
    layout: 'layouts/public',
    q: req.query.q || '',
    bookingCode: bookingCode,
    results,
    myBookings,
    myCodes,
    myGroups,
    allowedCodes: Array.from(allowedCodes),
    myGroupIds
  });
});

/* ------------------------------------------------------------------ */
/* Roster rombongan — peta bersama satu kapal                           */
/* ------------------------------------------------------------------ */
router.get('/akun/rombongan/:id', requireCustomer, (req, res, next) => {
  const data = db.read();
  const customer = req.customer;
  const group = roster.groupOf(data, req.params.id);

  // Pelanggan hanya boleh membuka group yang dia ikuti.
  const myGroupIds = roster.groupsForCustomer(data, customer.id).map((g) => g.id);
  if (!group || !myGroupIds.includes(group.id)) return next();

  const seenMap = {};
  presence.lastSeenAll().forEach((e) => {
    seenMap[e.role + ':' + e.refId] = e;
  });

  const members = roster.rosterOf(data, group, {}, seenMap).map((p) => {
    const distance = roster.distanceToMeetingPoint(group, p);
    return {
      ...p,
      distance: distance,
      distanceLabel: Number.isFinite(distance) ? geo.formatDistance(distance) : null,
      mapsUrl: geo.mapsUrl(p.lat, p.lng, p.name),
      ageLabel: geo.formatAge(p.at)
    };
  });

  res.render('pages/account-group', {
    title: group.name,
    layout: 'layouts/public',
    group,
    members,
    meetingPoint: group.meetingPoint || null,
    mapsUrl: geo.mapsUrl(
      group.meetingPoint && group.meetingPoint.lat,
      group.meetingPoint && group.meetingPoint.lng,
      group.name
    ),
    mapData: JSON.stringify({
      dest: group.meetingPoint || null,
      checkIn: null,
      track: [],
      live: null,
      peers: members
        .filter((m) => m.lat != null && m.lng != null)
        .map((m) => ({
          role: 'customer',
          name: m.name,
          label: m.ageLabel,
          lat: m.lat,
          lng: m.lng,
          distance: m.distance
        }))
    }).replace(/</g, '\\u003c')
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
    db.write(data);
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
  db.write(data);
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
  db.write(data);
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

  // Resolusi destinasi yang BENAR: booking.packageSlug → paket →
  // destinationSlug → destinations[]. Kode lama langsung membandingkan
  // packageSlug dengan d.slug sehingga peta selalu kosong.
  const destination = trip.resolveDestination(data, booking);
  const canCheckIn =
    (booking.status === 'confirmed' || booking.status === 'pending') && !booking.checkIn;
  const canReview =
    booking.status === 'completed' &&
    !(data.reviews || []).some((r) => r.bookingCode === booking.code);
  const distance = trip.distanceToDestination(booking, destination);
  const steps = trip.progressSteps(booking);

  res.render('pages/account-booking', {
    title: `Booking ${booking.code}`,
    layout: 'layouts/public',
    booking,
    destination,
    canCheckIn,
    canReview,
    distance,
    distanceLabel: distance === null ? null : geo.formatDistance(distance),
    checkinRadius: CHECKIN_RADIUS_M,
    steps,
    mapData: JSON.stringify({
      dest: destination && geo.isValidLatLng(destination.lat, destination.lng)
        ? { lat: destination.lat, lng: destination.lng, name: destination.name }
        : null,
      checkIn: booking.checkIn && geo.isValidLatLng(booking.checkIn.lat, booking.checkIn.lng)
        ? booking.checkIn
        : null,
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
  if (!geo.isValidLatLng(lat, lng)) {
    flash('error', 'Koordinat GPS tidak valid. Pastikan GPS perangkat aktif lalu coba lagi.', req);
    return res.redirect(`/akun/booking/${booking.id}`);
  }

  // Hitung jarak ke titik kumpul saat check-in. Jarak jauh TIDAK
  // memblokir check-in (perangkat bisa salah akurasi / titik kumpul
  // berada di dermaga), tetapi dicatat sebagai peringatan agar admin
  // bisa memverifikasi secara manual.
  const destination = trip.resolveDestination(data, booking);
  const distance = trip.distanceToDestination({ checkIn: { lat, lng } }, destination);

  booking.checkIn = {
    lat,
    lng,
    accuracy,
    at: new Date().toISOString(),
    distanceToDestination: distance === null ? null : Math.round(distance),
    source: 'gps'
  };
  booking.track = booking.track || [];
  booking.track.push({
    label: `Check-in ${booking.name}`,
    lat,
    lng,
    at: booking.checkIn.at
  });
  db.write(data);

  if (distance !== null && distance > CHECKIN_RADIUS_M) {
    flash(
      'info',
      `Check-in tercatat, tetapi jarak Anda dari titik kumpul ${destination.name} sekitar ${geo.formatDistance(distance)}. Tim kami akan memverifikasi secara manual.`,
      req
    );
  } else {
    flash('success', 'Check-in berhasil! Koordinat keberangkatan Anda tercatat.', req);
  }
  res.redirect(`/akun/booking/${booking.id}`);
});

/* ============ Perbarui lokasi terakhir (live position) ============ */
/**
 * Menyimpan koordinat posisi terkini pelanggan sebagai "posisi terakhir".
 * Ini murni sukarela — dipakai supaya pelanggan bisa melihat posisi
 * terakhirnya di halaman "Lokasi Saya" tanpa perlu check-in ulang.
 *
 * Catatan privasi: koordinat disimpan per booking milik pelanggan itu
 * saja, tidak pernah diekspos ke pelanggan lain.
 */
router.post('/akun/lokasi/simpan', requireCustomer, (req, res) => {
  const data = db.read();
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const accuracy = parseFloat(req.body.accuracy) || null;

  if (!geo.isValidLatLng(lat, lng)) {
    flash('error', 'Koordinat lokasi tidak valid.', req);
    return res.redirect('/akun/lokasi');
  }

  // Simpan pada booking aktif (upcoming) milik pelanggan; kalau tidak
  // ada, pakai booking terakhir. Bila sama sekali tidak ada booking,
  // buat entri "posisi terakhir" di level pelanggan.
  const bookings = (data.bookings || []).filter((b) => b.customerId === req.customer.id);
  const today = new Date().toISOString().slice(0, 10);
  const target =
    bookings.find((b) => b.departureDate >= today && b.status !== 'cancelled') ||
    bookings[0] ||
    null;

  const point = { lat, lng, accuracy, at: new Date().toISOString() };

  if (target) {
    target.lastPosition = point;
    db.write(data);
  } else {
    const customer = (data.customers || []).find((c) => c.id === req.customer.id);
    if (!customer) {
      flash('error', 'Akun tidak ditemukan.', req);
      return res.redirect('/akun/lokasi');
    }
    customer.lastPosition = point;
    db.write(data);
  }

  flash('success', 'Posisi terakhir tersimpan.', req);
  res.redirect('/akun/lokasi');
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
  db.write(data);

  flash('success', 'Terima kasih! Ulasan Anda menunggu persetujuan admin.', req);
  res.redirect(`/akun/booking/${booking.id}`);
});

module.exports = router;