'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const helpers = require('../utils/helpers');
const { upload, removeUpload, discardUpload } = require('../multer');
const { flash } = require('../middleware/context');
const { requireLogin, loginLimiter } = require('../middleware/security');
const BRAND = require('../brand');

const router = express.Router();

function load(req, res, next) {
  req.data = db.read();
  next();
}

/**
 * Penjaga admin: memverifikasi SESI **dan** role di backend.
 *
 * Sebelumnya hanya `req.session.userId` yang dicek, sehingga field
 * `role` di database tidak pernah dipakai — siapa pun yang punya sesi
 * login dianggap admin penuh. Sekarang role wajib 'admin'.
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/admin/login');
  }
  const data = db.read();
  const user = (data.users || []).find((u) => u.id === req.session.userId);
  if (!user) {
    // Akun sudah dihapus / sesi usang → paksa login ulang.
    return req.session.destroy(() => res.redirect('/admin/login'));
  }
  if (String(user.role || '').toLowerCase() !== 'admin') {
    // Sesi tetap hidup (hanya hak akses yang dicabut) supaya pesan flash
    // bisa tampil di halaman login. Pesan diambil dari res.locals.flash,
    // karena middleware context sudah memindahkannya dari session.
    delete req.session.userId;
    flash('error', 'Akun ini tidak memiliki akses ke panel admin.', req);
    return res.redirect('/admin/login');
  }
  req.currentUser = user;
  next();
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  // Pesan tertunda (mis. "role tidak diizinkan" atau rate limit) dibawa
  // lewat flash; middleware context sudah memindahkannya ke res.locals.
  const pending = (res.locals.flash || [])
    .filter((f) => f.type === 'error')
    .map((f) => f.message)
    .join(' ');
  res.render('admin/login', { title: 'Masuk Admin', layout: false, error: pending || null });
});

router.post('/login', loginLimiter(), (req, res) => {
  const { username, password } = req.body;
  const data = db.read();
  const user = (data.users || []).find((u) => u.username === String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.passwordHash)) {
    return res.status(401).render('admin/login', {
      title: 'Masuk Admin',
      layout: false,
      error: 'Username atau password salah.'
    });
  }
  if (String(user.role || '').toLowerCase() !== 'admin') {
    return res.status(403).render('admin/login', {
      title: 'Masuk Admin',
      layout: false,
      error: 'Akun ini tidak memiliki akses ke panel admin.'
    });
  }
  // Regenerasi ID sesi saat login (mitigasi session fixation).
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('admin/login', {
        title: 'Masuk Admin',
        layout: false,
        error: 'Gagal membuat sesi. Silakan coba lagi.'
      });
    }
    req.session.userId = user.id;
    res.redirect('/admin');
  });
});

router.post('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireAdmin, load);

// Semua halaman setelah login memakai layout admin
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  next();
});

// Modul marketing (kontak + blast WhatsApp) di bawah /admin/marketing
router.use('/marketing', require('./marketing.routes').createMarketingRouter());

// Panel kendali WhatsApp (status koneksi, QR scan, reconnect, pesan uji)
router.use('/whatsapp', require('./whatsapp.routes').createWhatsappRouter());

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
router.get('/', (req, res) => {
  const d = req.data;
  const pendingBookings = d.bookings.filter((b) => b.status === 'pending').length;
  const unread = d.messages.filter((m) => !m.read).length;
  res.render('admin/dashboard', {
    title: 'Dashboard',
    stats: {
      destinations: d.destinations.length,
      packages: d.packages.length,
      articles: d.articles.length,
      pendingBookings,
      unread,
      bookings: d.bookings.length
    },
    recentBookings: d.bookings.slice(0, 5),
    recentMessages: d.messages.slice(0, 5)
  });
});

/* ------------------------------------------------------------------ */
/* Destinasi                                                           */
/* ------------------------------------------------------------------ */

/** Kolom yang bisa diurutkan + accessor-nya (dipakai juga untuk header tabel). */
const SORT_DESTINATIONS = {
  name: (d) => d.name,
  region: (d) => d.region,
  priceFrom: (d) => Number(d.priceFrom) || 0,
  status: (d) => d.status,
  coords: (d) => (d.lat != null && d.lng != null ? d.lat : null),
  createdAt: (d) => d.createdAt
};

/** Pencarian multi-field: nama, region, slug, tagline, status, harga, koordinat. */
const SEARCH_DESTINATIONS = [
  (d) => d.name,
  (d) => d.region,
  (d) => d.slug,
  (d) => d.tagline,
  (d) => d.status,
  (d) => d.description,
  (d) => d.priceFrom,
  (d) => d.lat,
  (d) => d.lng,
  (d) => (d.featured ? 'unggulan' : '')
];

router.get('/destinasi', (req, res) => {
  const q = String(req.query.q || '').trim();
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_DESTINATIONS), 'name');
  res.locals.sort = { sort, dir };

  let list = helpers.sortRows([...req.data.destinations], sort, dir, SORT_DESTINATIONS);
  list = list.filter((d) => helpers.matchesAny(d, q, SEARCH_DESTINATIONS));

  const pg = helpers.paginate(list, req.query.page, 8);
  const status = '';
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-destinations', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/destinations', { title: 'Kelola Destinasi', pg, q, status, sort, dir });
});

router.get('/destinasi/baru', (req, res) => {
  res.render('admin/destination-form', {
    title: 'Tambah Destinasi',
    item: null,
    action: '/admin/destinasi',
    useLeaflet: true,
    form: takeForm(req, 'dstForm')
  });
});

function destFromBody(body, oldImage, coords) {
  const c = coords || { lat: null, lng: null };
  return {
    name: String(body.name || '').trim(),
    region: String(body.region || '').trim(),
    tagline: String(body.tagline || '').trim(),
    description: String(body.description || '').trim(),
    highlights: String(body.highlights || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    bestSeason: String(body.bestSeason || '').trim(),
    duration: String(body.duration || '').trim(),
    gettingThere: String(body.gettingThere || '').trim(),
    facilities: String(body.facilities || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    priceFrom: parseInt(body.priceFrom, 10) || 0,
    // Koordinat sudah tervalidasi & dibulatkan (7 desimal) oleh helpers.
    lat: c.lat,
    lng: c.lng,
    image: oldImage || '/img/dest-default.svg',
    gallery: [],
    // `featured` datang sebagai array bila form memakai hidden "off" +
    // checkbox "on" → harus dinormalkan, bukan dibandingkan langsung.
    featured: helpers.isChecked(body.featured),
    status: body.status === 'published' ? 'published' : 'draft'
  };
}

/** Simpan input form ke session supaya isian user tidak hilang saat error. */
function stashForm(req, key, body) {
  if (!req.session) return;
  const copy = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (typeof v === 'string') copy[k] = v;
  }
  req.session[key] = copy;
}

/** Ambil & hapus input form yang tersimpan di session. */
function takeForm(req, key) {
  if (!req.session || !req.session[key]) return null;
  const val = req.session[key];
  delete req.session[key];
  return val;
}

router.post('/destinasi', upload.single('imageFile'), (req, res) => {
  const body = req.body;
  const errors = [];
  if (!body.name || body.name.trim().length < 3) errors.push('Nama destinasi wajib diisi.');
  if (!body.region || body.region.trim().length < 3) errors.push('Lokasi/region wajib diisi.');
  if (!body.description || body.description.trim().length < 20) errors.push('Deskripsi minimal 20 karakter.');
  // Validasi Latitude (-90..90) & Longitude (-180..180).
  const coords = helpers.validateCoordinates(body.lat, body.lng);
  errors.push(...coords.errors);
  if (errors.length) {
    // Berkas sempat tersimpan sebelum validasi form gagal → buang agar
    // tidak tertinggal sebagai file orphan di folder upload.
    discardUpload(req);
    flash('error', errors.join(' '), req);
    stashForm(req, 'dstForm', body);
    return res.redirect('/admin/destinasi/baru');
  }
  const data = req.data;
  const record = destFromBody(body, req.file ? `/uploads/${req.file.filename}` : null, coords);
  record.id = db.uid('dst');
  record.slug = db.uniqueSlug(data.destinations, db.slugify(body.name));
  record.gallery = record.image ? [record.image] : [];
  record.createdAt = new Date().toISOString();
  data.destinations.unshift(record);
  db.write();
  flash('success', `Destinasi "${record.name}" berhasil ditambahkan.`, req);
  res.redirect('/admin/destinasi');
});

router.get('/destinasi/:id/edit', (req, res, next) => {
  const item = req.data.destinations.find((x) => x.id === req.params.id);
  if (!item) return next();
  res.render('admin/destination-form', {
    title: `Edit: ${item.name}`,
    item,
    action: `/admin/destinasi/${item.id}`,
    useLeaflet: true,
    form: takeForm(req, 'dstForm')
  });
});

router.post('/destinasi/:id', upload.single('imageFile'), (req, res, next) => {
  const data = req.data;
  const item = data.destinations.find((x) => x.id === req.params.id);
  if (!item) return next();
  // Validasi koordinat sebelum menimpa data yang ada.
  const coords = helpers.validateCoordinates(req.body.lat, req.body.lng);
  if (coords.errors.length) {
    discardUpload(req);
    flash('error', coords.errors.join(' '), req);
    stashForm(req, 'dstForm', req.body);
    return res.redirect(`/admin/destinasi/${item.id}/edit`);
  }
  const oldImage = item.image;
  const updated = destFromBody(req.body, oldImage, coords);
  if (req.file) {
    if (oldImage && oldImage.startsWith('/uploads/')) removeUpload(oldImage.replace('/uploads/', ''));
    updated.image = `/uploads/${req.file.filename}`;
    updated.gallery = [updated.image];
  }
  Object.assign(item, updated);
  item.slug = db.uniqueSlug(data.destinations, db.slugify(req.body.name || item.name), item.id);
  db.write();
  flash('success', 'Destinasi berhasil diperbarui.', req);
  res.redirect('/admin/destinasi');
});

router.post('/destinasi/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = data.destinations.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  const [removed] = data.destinations.splice(idx, 1);
  if (removed.image && removed.image.startsWith('/uploads/')) removeUpload(removed.image.replace('/uploads/', ''));
  db.write();
  flash('success', `Destinasi "${removed.name}" dihapus.`, req);
  res.redirect('/admin/destinasi');
});

/* ------------------------------------------------------------------ */
/* Paket                                                               */
/* ------------------------------------------------------------------ */
const SORT_PACKAGES = {
  title: (p) => p.title,
  destinationName: (p) => p.destinationName,
  days: (p) => Number(p.days) || 0,
  price: (p) => Number(p.price) || 0,
  status: (p) => p.status,
  createdAt: (p) => p.createdAt
};

const SEARCH_PACKAGES = [
  (p) => p.title,
  (p) => p.destinationName,
  (p) => p.slug,
  (p) => p.summary,
  (p) => p.status,
  (p) => p.days,
  (p) => p.nights,
  (p) => p.price,
  (p) => p.groupSize,
  (p) => (p.featured ? 'unggulan' : '')
];

router.get('/paket', (req, res) => {
  const q = String(req.query.q || '').trim();
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_PACKAGES), 'title');
  res.locals.sort = { sort, dir };

  let list = helpers.sortRows([...req.data.packages], sort, dir, SORT_PACKAGES);
  list = list.filter((p) => helpers.matchesAny(p, q, SEARCH_PACKAGES));

  const pg = helpers.paginate(list, req.query.page, 8);
  const status = '';
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-packages', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/packages', { title: 'Kelola Paket Wisata', pg, q, status, sort, dir });
});

router.get('/paket/baru', (req, res) => {
  res.render('admin/package-form', {
    title: 'Tambah Paket',
    item: null,
    action: '/admin/paket',
    destinations: req.data.destinations
  });
});

function pkgFromBody(body, oldImage) {
  const parseItinerary = (raw) =>
    String(raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [first, ...rest] = line.split('|');
        return { day: i + 1, title: first.trim(), detail: rest.join('|').trim() };
      });
  const parseList = (raw) =>
    String(raw || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    title: String(body.title || '').trim(),
    destinationSlug: body.destinationSlug,
    destinationName: String(body.destinationName || '').trim(),
    days: parseInt(body.days, 10) || 1,
    nights: parseInt(body.nights, 10) || 0,
    price: parseInt(body.price, 10) || 0,
    groupSize: String(body.groupSize || '').trim(),
    summary: String(body.summary || '').trim(),
    itinerary: parseItinerary(body.itinerary),
    includes: parseList(body.includes),
    excludes: parseList(body.excludes),
    image: oldImage || '/img/dest-default.svg',
    featured: helpers.isChecked(body.featured),
    status: body.status === 'published' ? 'published' : 'draft'
  };
}

router.post('/paket', upload.single('imageFile'), (req, res) => {
  const errors = [];
  if (!req.body.title || req.body.title.trim().length < 3) errors.push('Judul paket wajib diisi.');
  if (!req.body.destinationSlug) errors.push('Destinasi wajib dipilih.');
  if (!(parseInt(req.body.price, 10) > 0)) errors.push('Harga harus lebih dari 0.');
  if (errors.length) {
    discardUpload(req);
    flash('error', errors.join(' '), req);
    return res.redirect('/admin/paket/baru');
  }
  const data = req.data;
  const record = pkgFromBody(req.body, req.file ? `/uploads/${req.file.filename}` : null);
  record.id = db.uid('pkg');
  record.slug = db.uniqueSlug(data.packages, db.slugify(req.body.title));
  record.createdAt = new Date().toISOString();
  data.packages.unshift(record);
  db.write();
  flash('success', `Paket "${record.title}" berhasil ditambahkan.`, req);
  res.redirect('/admin/paket');
});

router.get('/paket/:id/edit', (req, res, next) => {
  const item = req.data.packages.find((x) => x.id === req.params.id);
  if (!item) return next();
  res.render('admin/package-form', {
    title: `Edit: ${item.title}`,
    item,
    action: `/admin/paket/${item.id}`,
    destinations: req.data.destinations
  });
});

router.post('/paket/:id', upload.single('imageFile'), (req, res, next) => {
  const data = req.data;
  const item = data.packages.find((x) => x.id === req.params.id);
  if (!item) return next();
  const oldImage = item.image;
  const updated = pkgFromBody(req.body, oldImage);
  if (req.file) {
    if (oldImage && oldImage.startsWith('/uploads/')) removeUpload(oldImage.replace('/uploads/', ''));
    updated.image = `/uploads/${req.file.filename}`;
  }
  Object.assign(item, updated);
  item.slug = db.uniqueSlug(data.packages, db.slugify(req.body.title || item.title), item.id);
  db.write();
  flash('success', 'Paket wisata berhasil diperbarui.', req);
  res.redirect('/admin/paket');
});

router.post('/paket/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = data.packages.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  const [removed] = data.packages.splice(idx, 1);
  if (removed.image && removed.image.startsWith('/uploads/')) removeUpload(removed.image.replace('/uploads/', ''));
  db.write();
  flash('success', `Paket "${removed.title}" dihapus.`, req);
  res.redirect('/admin/paket');
});

/* ------------------------------------------------------------------ */
/* Artikel                                                             */
/* ------------------------------------------------------------------ */
const SORT_ARTICLES = {
  title: (a) => a.title,
  category: (a) => a.category,
  author: (a) => a.author,
  publishedAt: (a) => a.publishedAt,
  status: (a) => a.status,
  createdAt: (a) => a.createdAt
};

const SEARCH_ARTICLES = [
  (a) => a.title,
  (a) => a.category,
  (a) => a.author,
  (a) => a.slug,
  (a) => a.status,
  (a) => a.excerpt,
  (a) => a.body
];

router.get('/artikel', (req, res) => {
  const q = String(req.query.q || '').trim();
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_ARTICLES), 'publishedAt');
  res.locals.sort = { sort, dir };

  let list = helpers.sortRows([...req.data.articles], sort, dir, SORT_ARTICLES);
  list = list.filter((a) => helpers.matchesAny(a, q, SEARCH_ARTICLES));

  const pg = helpers.paginate(list, req.query.page, 8);
  const status = '';
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-articles', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/articles', { title: 'Kelola Artikel', pg, q, status, sort, dir });
});

router.get('/artikel/baru', (req, res) => {
  res.render('admin/article-form', { title: 'Tambah Artikel', item: null, action: '/admin/artikel' });
});

function artFromBody(body, oldImage) {
  return {
    title: String(body.title || '').trim(),
    excerpt: String(body.excerpt || '').trim(),
    body: String(body.body || '').trim(),
    category: String(body.category || 'Umum').trim() || 'Umum',
    author: String(body.author || `Tim ${BRAND.display}`).trim() || `Tim ${BRAND.display}`,
    coverImage: oldImage || '/img/dest-default.svg',
    status: body.status === 'published' ? 'published' : 'draft',
    publishedAt: body.status === 'published' ? new Date().toISOString() : null
  };
}

router.post('/artikel', upload.single('imageFile'), (req, res) => {
  const errors = [];
  if (!req.body.title || req.body.title.trim().length < 5) errors.push('Judul artikel wajib minimal 5 karakter.');
  if (!req.body.body || req.body.body.trim().length < 50) errors.push('Isi artikel minimal 50 karakter.');
  if (errors.length) {
    discardUpload(req);
    flash('error', errors.join(' '), req);
    return res.redirect('/admin/artikel/baru');
  }
  const data = req.data;
  const record = artFromBody(req.body, req.file ? `/uploads/${req.file.filename}` : null);
  record.id = db.uid('art');
  record.slug = db.uniqueSlug(data.articles, db.slugify(req.body.title));
  record.createdAt = new Date().toISOString();
  data.articles.unshift(record);
  db.write();
  flash('success', `Artikel "${record.title}" berhasil ditambahkan.`, req);
  res.redirect('/admin/artikel');
});

router.get('/artikel/:id/edit', (req, res, next) => {
  const item = req.data.articles.find((x) => x.id === req.params.id);
  if (!item) return next();
  res.render('admin/article-form', {
    title: `Edit: ${item.title}`,
    item,
    action: `/admin/artikel/${item.id}`
  });
});

router.post('/artikel/:id', upload.single('imageFile'), (req, res, next) => {
  const data = req.data;
  const item = data.articles.find((x) => x.id === req.params.id);
  if (!item) return next();
  const oldImage = item.coverImage;
  const updated = artFromBody(req.body, oldImage);
  if (req.file) {
    if (oldImage && oldImage.startsWith('/uploads/')) removeUpload(oldImage.replace('/uploads/', ''));
    updated.coverImage = `/uploads/${req.file.filename}`;
  }
  if (item.status === 'published' && updated.status === 'published') updated.publishedAt = item.publishedAt;
  Object.assign(item, updated);
  item.slug = db.uniqueSlug(data.articles, db.slugify(req.body.title || item.title), item.id);
  db.write();
  flash('success', 'Artikel berhasil diperbarui.', req);
  res.redirect('/admin/artikel');
});

router.post('/artikel/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = data.articles.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  const [removed] = data.articles.splice(idx, 1);
  if (removed.coverImage && removed.coverImage.startsWith('/uploads/')) removeUpload(removed.coverImage.replace('/uploads/', ''));
  db.write();
  flash('success', `Artikel "${removed.title}" dihapus.`, req);
  res.redirect('/admin/artikel');
});

/* ------------------------------------------------------------------ */
/* Booking                                                             */
/* ------------------------------------------------------------------ */
const SORT_BOOKINGS = {
  code: (b) => b.code,
  name: (b) => b.name,
  packageName: (b) => b.packageName,
  departureDate: (b) => b.departureDate,
  totalAmount: (b) => Number(b.totalAmount) || 0,
  status: (b) => b.status,
  createdAt: (b) => b.createdAt
};

const SEARCH_BOOKINGS = [
  (b) => b.code,
  (b) => b.name,
  (b) => b.email,
  (b) => b.phone,
  (b) => b.packageName,
  (b) => b.packageSlug,
  (b) => b.status,
  (b) => b.paymentStatus,
  (b) => b.paymentMethod,
  (b) => b.notes,
  (b) => b.totalAmount,
  (b) => b.participants
];

router.get('/booking', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_BOOKINGS), 'createdAt');
  res.locals.sort = { sort, dir };

  let list = helpers.sortRows([...req.data.bookings], sort, dir, SORT_BOOKINGS);
  list = list.filter((b) => helpers.matchesAny(b, q, SEARCH_BOOKINGS));
  if (status) list = list.filter((b) => b.status === status);

  const pg = helpers.paginate(list, req.query.page, 10);
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-bookings', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/bookings', { title: 'Booking Masuk', pg, q, status, sort, dir });
});

/* Detail booking: info, pembayaran, peta check-in & waypoint perjalanan. */
router.get('/booking/:id', (req, res, next) => {
  const data = req.data;
  const booking = data.bookings.find((x) => x.id === req.params.id);
  if (!booking) return next();
  const destination = (data.destinations || []).find((d) => d.slug === booking.packageSlug);
  const customer = (data.customers || []).find((c) => c.id === booking.customerId) || null;
  res.render('admin/booking-detail', {
    title: `Booking ${booking.code}`,
    booking,
    destination,
    customer,
    mapData: JSON.stringify({
      dest: destination && destination.lat ? { lat: destination.lat, lng: destination.lng, name: destination.name } : null,
      checkIn: booking.checkIn || null,
      track: booking.track || []
    })
  });
});

router.post('/booking/:id/waypoint', (req, res, next) => {
  const data = req.data;
  const booking = data.bookings.find((x) => x.id === req.params.id);
  if (!booking) return next();
  const label = String(req.body.label || '').trim();
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    flash('error', 'Waypoint tidak valid: label wajib dan koordinat harus benar.', req);
    return res.redirect(`/admin/booking/${booking.id}`);
  }
  booking.track = booking.track || [];
  booking.track.push({ label, lat, lng, at: new Date().toISOString() });
  db.write();
  flash('success', `Waypoint "${label}" ditambahkan ke rute booking ${booking.code}.`, req);
  res.redirect(`/admin/booking/${booking.id}`);
});

router.post('/booking/:id/waypoint/hapus', (req, res, next) => {
  const data = req.data;
  const booking = data.bookings.find((x) => x.id === req.params.id);
  if (!booking) return next();
  const idx = parseInt(req.body.index, 10);
  if (Number.isInteger(idx) && idx >= 0 && idx < (booking.track || []).length) {
    booking.track.splice(idx, 1);
    db.write();
    flash('success', 'Waypoint dihapus.', req);
  }
  res.redirect(`/admin/booking/${booking.id}`);
});

router.post('/booking/:id/status', (req, res, next) => {
  const data = req.data;
  const item = data.bookings.find((x) => x.id === req.params.id);
  if (!item) return next();
  const allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!allowed.includes(req.body.status)) {
    flash('error', 'Status tidak dikenal.', req);
    return res.redirect(`/admin/booking/${item.id}`);
  }
  item.status = req.body.status;
  db.write();
  flash('success', `Status booking ${item.code} diperbarui menjadi "${helpers.bookingStatusLabel(item.status)}".`, req);
  res.redirect(`/admin/booking/${item.id}`);
});

/* Verifikasi pembayaran manual (bukti transfer dari tamu). */
router.post('/booking/:id/bayar', (req, res, next) => {
  const data = req.data;
  const item = data.bookings.find((x) => x.id === req.params.id);
  if (!item) return next();
  item.paymentStatus = 'paid';
  item.paidAt = new Date().toISOString();
  item.paymentMethod = item.paymentMethod || 'manual';
  if (item.status === 'pending') item.status = 'confirmed';
  db.write();
  flash('success', `Pembayaran booking ${item.code} ditandai LUNAS. Status booking dikonfirmasi.`, req);
  res.redirect(`/admin/booking/${item.id}`);
});

router.post('/booking/:id/tolak-bayar', (req, res, next) => {
  const data = req.data;
  const item = data.bookings.find((x) => x.id === req.params.id);
  if (!item) return next();
  item.paymentStatus = 'unpaid';
  // Buang berkas bukti lama supaya tidak tertinggal di folder upload.
  if (item.proofImage && item.proofImage.startsWith('/uploads/')) {
    removeUpload(item.proofImage.replace('/uploads/', ''));
  }
  item.proofImage = null;
  db.write();
  flash('error', `Bukti pembayaran booking ${item.code} ditolak. Tamu diminta mengunggah ulang.`, req);
  res.redirect(`/admin/booking/${item.id}`);
});

router.post('/booking/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = data.bookings.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  const [removed] = data.bookings.splice(idx, 1);
  db.write();
  flash('success', `Booking ${removed.code} dihapus.`, req);
  res.redirect('/admin/booking');
});

/* ------------------------------------------------------------------ */
/* Pesan / Kontak                                                      */
/* ------------------------------------------------------------------ */
const SORT_MESSAGES = {
  name: (m) => m.name,
  subject: (m) => m.subject,
  createdAt: (m) => m.createdAt,
  read: (m) => (m.read ? 1 : 0)
};

const SEARCH_MESSAGES = [
  (m) => m.name,
  (m) => m.email,
  (m) => m.phone,
  (m) => m.subject,
  (m) => m.message
];

router.get('/pesan', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_MESSAGES), 'createdAt');
  res.locals.sort = { sort, dir };

  let list = helpers.sortRows([...req.data.messages], sort, dir, SORT_MESSAGES);
  list = list.filter((m) => helpers.matchesAny(m, q, SEARCH_MESSAGES));
  if (status === 'unread') list = list.filter((m) => !m.read);
  if (status === 'read') list = list.filter((m) => m.read);

  const pg = helpers.paginate(list, req.query.page, 10);
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-messages', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/messages', { title: 'Kotak Pesan', pg, q, status, sort, dir });
});

router.post('/pesan/:id/baca', (req, res, next) => {
  const data = req.data;
  const item = data.messages.find((x) => x.id === req.params.id);
  if (!item) return next();
  item.read = !item.read;
  db.write();
  res.redirect('/admin/pesan');
});

router.post('/pesan/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = data.messages.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  data.messages.splice(idx, 1);
  db.write();
  flash('success', 'Pesan dihapus.', req);
  res.redirect('/admin/pesan');
});

/* ------------------------------------------------------------------ */
/* Pelanggan (portal akun)                                              */
/* ------------------------------------------------------------------ */
const SORT_CUSTOMERS = {
  name: (c) => c.name,
  email: (c) => c.email,
  phone: (c) => c.phone,
  bookingCount: (c) => c.bookingCount,
  createdAt: (c) => c.createdAt
};

const SEARCH_CUSTOMERS = [
  (c) => c.name,
  (c) => c.email,
  (c) => c.phone,
  (c) => c.id,
  (c) => c.lastBooking ? c.lastBooking.code : '',
  (c) => c.lastBooking ? c.lastBooking.packageName : ''
];

router.get('/pelanggan', (req, res) => {
  const q = String(req.query.q || '').trim();
  const data = req.data;
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_CUSTOMERS), 'createdAt');
  res.locals.sort = { sort, dir };

  let list = (data.customers || []).map((c) => {
    const bookings = (data.bookings || []).filter((b) => b.customerId === c.id);
    return {
      ...c,
      bookingCount: bookings.length,
      lastBooking: bookings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null
    };
  });
  list = list.filter((c) => helpers.matchesAny(c, q, SEARCH_CUSTOMERS));
  list = helpers.sortRows(list, sort, dir, SORT_CUSTOMERS);

  const pg = helpers.paginate(list, req.query.page, 10);
  const status = '';
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-customers', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/customers', { title: 'Pelanggan', pg, q, status, sort, dir });
});

router.post('/pelanggan/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = (data.customers || []).findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  const [removed] = data.customers.splice(idx, 1);
  (data.bookings || []).forEach((b) => {
    if (b.customerId === removed.id) b.customerId = null;
  });
  db.write();
  flash('success', `Akun pelanggan "${removed.name}" dihapus. Booking-nya tetap tersimpan.`, req);
  res.redirect('/admin/pelanggan');
});

/* ------------------------------------------------------------------ */
/* Testimoni / ulasan                                                  */
/* ------------------------------------------------------------------ */
const SORT_REVIEWS = {
  customerName: (r) => r.customerName,
  packageName: (r) => r.packageName,
  rating: (r) => Number(r.rating) || 0,
  status: (r) => r.status,
  createdAt: (r) => r.createdAt
};

const SEARCH_REVIEWS = [
  (r) => r.customerName,
  (r) => r.packageName,
  (r) => r.bookingCode,
  (r) => r.comment,
  (r) => r.status,
  (r) => r.rating
];

router.get('/testimoni', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_REVIEWS), 'createdAt');
  res.locals.sort = { sort, dir };

  let list = helpers.sortRows([...(req.data.reviews || [])], sort, dir, SORT_REVIEWS);
  list = list.filter((r) => helpers.matchesAny(r, q, SEARCH_REVIEWS));
  if (status) list = list.filter((r) => r.status === status);

  const pg = helpers.paginate(list, req.query.page, 10);
  if (req.query.partial === '1') {
    return res.render('admin/partials/list-reviews', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
  }
  res.render('admin/testimoni', { title: 'Testimoni & Ulasan', pg, q, status, sort, dir });
});

router.post('/testimoni/:id/status', (req, res, next) => {
  const data = req.data;
  const item = (data.reviews || []).find((x) => x.id === req.params.id);
  if (!item) return next();
  const allowed = ['pending', 'approved', 'rejected'];
  if (!allowed.includes(req.body.status)) {
    flash('error', 'Status testimoni tidak dikenal.', req);
    return res.redirect('/admin/testimoni');
  }
  item.status = req.body.status;
  db.write();
  const word = { pending: 'ditunda', approved: 'DISETUJUI & tampil di beranda', rejected: 'ditolak' }[item.status];
  flash('success', `Ulasan dari "${item.customerName}" ${word}.`, req);
  res.redirect(req.get('Referrer') || '/admin/testimoni');
});

router.post('/testimoni/:id/hapus', (req, res, next) => {
  const data = req.data;
  const idx = (data.reviews || []).findIndex((x) => x.id === req.params.id);
  if (idx < 0) return next();
  data.reviews.splice(idx, 1);
  db.write();
  flash('success', 'Testimoni dihapus.', req);
  res.redirect('/admin/testimoni');
});

/* ------------------------------------------------------------------ */
/* Pengaturan & akun                                                   */
/* ------------------------------------------------------------------ */
router.get('/pengaturan', (req, res) => {
  res.render('admin/settings', { title: 'Pengaturan Situs', item: req.data.settings });
});

router.post('/pengaturan', upload.fields([{ name: 'logoFile', maxCount: 1 }, { name: 'heroFile', maxCount: 1 }]), (req, res) => {
  const data = req.data;
  const b = req.body;
  const s = data.settings;
  s.siteName = String(b.siteName || s.siteName).trim();
  s.tagline = String(b.tagline || s.tagline).trim();
  s.whatsapp = String(b.whatsapp || s.whatsapp).replace(/[^0-9]/g, '');
  s.email = String(b.email || s.email).trim();
  s.phone = String(b.phone || s.phone).trim();
  s.address = String(b.address || s.address).trim();
  s.instagram = String(b.instagram || s.instagram).trim();
  s.facebook = String(b.facebook || s.facebook).trim();
  s.about = String(b.about || s.about).trim();
  s.heroTitle = String(b.heroTitle || s.heroTitle).trim();
  s.heroSubtitle = String(b.heroSubtitle || s.heroSubtitle).trim();
  // Pembayaran
  s.paymentBank = String(b.paymentBank || s.paymentBank || 'BCA').trim();
  s.paymentAccount = String(b.paymentAccount || s.paymentAccount || '').trim();
  s.paymentAccountName = String(b.paymentAccountName || s.paymentAccountName || '').trim();
  s.midtransServerKey = String(b.midtransServerKey || s.midtransServerKey || '').trim();
  s.midtransClientKey = String(b.midtransClientKey || s.midtransClientKey || '').trim();
  if ('midtransProduction' in b) s.midtransProduction = helpers.isChecked(b.midtransProduction);
  s.tripayMerchantCode = String(b.tripayMerchantCode || s.tripayMerchantCode || '').trim();
  s.tripayPrivateKey = String(b.tripayPrivateKey || s.tripayPrivateKey || '').trim();
  s.tripayApiKey = String(b.tripayApiKey || s.tripayApiKey || '').trim();
  if ('tripayProduction' in b) s.tripayProduction = helpers.isChecked(b.tripayProduction);
  // WhatsApp marketing (hanya token & phone id resmi Cloud API).
  // Penjaga `in` dipakai agar form pengaturan lain (mis. "Simpan Rekening")
  // tidak diam-diam mengembalikan provider ke 'cloud'.
  if ('waProvider' in b) s.waProvider = b.waProvider === 'web' ? 'web' : 'cloud';
  s.waToken = String(b.waToken || s.waToken || '').trim();
  s.waPhoneId = String(b.waPhoneId || s.waPhoneId || '').trim();
  s.waDefaultTemplate = String(b.waDefaultTemplate || s.waDefaultTemplate || '').trim();
  if (req.files && req.files.logoFile && req.files.logoFile[0]) {
    if (s.logo && s.logo.startsWith('/uploads/')) removeUpload(s.logo.replace('/uploads/', ''));
    s.logo = `/uploads/${req.files.logoFile[0].filename}`;
  }
  if (req.files && req.files.heroFile && req.files.heroFile[0]) {
    if (s.heroImageUrl && s.heroImageUrl.startsWith('/uploads/')) {
      removeUpload(s.heroImageUrl.replace('/uploads/', ''));
    }
    s.heroImageUrl = `/uploads/${req.files.heroFile[0].filename}`;
  }
  if (b.heroImageReset === '1') {
    s.heroImageUrl = '';
    // Bila pengguna juga mengunggah hero baru, berkas baru itu tidak lagi
    // dipakai → hapus agar tidak tertinggal di folder upload.
    if (req.files && req.files.heroFile && req.files.heroFile[0]) {
      removeUpload(req.files.heroFile[0].filename);
    }
  }
  // Menu WhatsApp mengambang.
  // PENTING: pakai penjaga `in` — halaman Pengaturan punya 4 form terpisah
  // yang semuanya POST ke /admin/pengaturan. Tanpa penjaga ini, form lain
  // (mis. "Simpan Gateway") akan diam-diam mematikan tombol WhatsApp
  // mengambang karena field-nya tidak ikut terkirim.
  if ('waFloatEnabled' in b) s.waFloatEnabled = helpers.isChecked(b.waFloatEnabled);
  s.waFloatMessage = String(b.waFloatMessage || s.waFloatMessage || '').trim();
  db.write();
  flash('success', 'Pengaturan situs berhasil disimpan.', req);
  res.redirect('/admin/pengaturan');
});

/* ------------------------------------------------------------------ */
/* SEO & Peta Situs                                                    */
/* ------------------------------------------------------------------ */
router.get('/seo', (req, res) => {
  const seo = require('../seo');
  const data = req.data;
  const sitemap = seo.buildSitemap(data.settings || {}, data);
  res.render('admin/seo', {
    title: 'SEO & Peta Situs',
    item: data.settings,
    sitemapPreview: sitemap,
    robotsPreview: seo.buildRobots(data.settings || {}),
    urlCount: (sitemap.match(/<loc>/g) || []).length
  });
});

router.post('/seo', upload.fields([{ name: 'ogFile', maxCount: 1 }]), (req, res) => {
  const s = req.data.settings;
  const b = req.body;
  s.siteUrl = String(b.siteUrl || '').trim().replace(/\/+$/, '');
  s.seoDescription = String(b.seoDescription || '').trim().slice(0, 300);
  s.seoIndex = helpers.isChecked(b.seoIndex);
  if (req.files && req.files.ogFile && req.files.ogFile[0]) {
    if (s.ogImageUrl && s.ogImageUrl.startsWith('/uploads/')) {
      removeUpload(s.ogImageUrl.replace('/uploads/', ''));
    }
    s.ogImageUrl = `/uploads/${req.files.ogFile[0].filename}`;
  }
  if (b.ogImageReset === '1') s.ogImageUrl = '';
  db.write();
  flash('success', 'Pengaturan SEO berhasil disimpan.', req);
  res.redirect('/admin/seo');
});

router.get('/akun', (req, res) => {
  const user = req.data.users.find((u) => u.id === req.session.userId);
  res.render('admin/account', { title: 'Akun Saya', user });
});

router.post('/akun/password', (req, res) => {
  const user = req.data.users.find((u) => u.id === req.session.userId);
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!bcrypt.compareSync(String(currentPassword || ''), user.passwordHash)) {
    flash('error', 'Password saat ini salah.', req);
    return res.redirect('/admin/akun');
  }
  if (!newPassword || String(newPassword).length < 8) {
    flash('error', 'Password baru minimal 8 karakter.', req);
    return res.redirect('/admin/akun');
  }
  if (newPassword !== confirmPassword) {
    flash('error', 'Konfirmasi password tidak cocok.', req);
    return res.redirect('/admin/akun');
  }
  user.passwordHash = bcrypt.hashSync(String(newPassword), 10);
  db.write();
  flash('success', 'Password berhasil diperbarui.', req);
  res.redirect('/admin/akun');
});

module.exports = router;