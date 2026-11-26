'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const helpers = require('../utils/helpers');
const { singleImage, multiImage, imageFields, galleryImages, cleanupUploads } = require('../middleware/upload');
const { removeUploadByUrl } = require('../services/image');
const themeService = require('../services/theme');
const brandService = require('../services/brand');
const { flash } = require('../middleware/context');
const { requireLogin, loginLimiter } = require('../middleware/security');
const trip = require('../services/trip');
const geo = require('../services/geo');
const osm = require('../services/osm');
const gateway = require('../services/wa-gateway');
const waService = require('../services/wa');

const router = express.Router();

/**
 * Ambil URL gambar hasil proses dari middleware upload.
 *
 * `req.processedImages[field]` bisa berupa object (satu berkas) atau array
 * (beberapa berkas, mis. galeri). Untuk kasus array, yang dikembalikan
 * adalah berkas pertama.
 *
 * Fallback ke req.file bila middleware tidak memproses (mis. tidak ada berkas).
 */
function imageUrl(req, field) {
  const processed = req.processedImages && req.processedImages[field];
  if (Array.isArray(processed)) {
    if (processed[0] && processed[0].url) return processed[0].url;
    return null;
  }
  if (processed && processed.url) return processed.url;
  if (req.file && req.file.filename) return `/uploads/${req.file.filename}`;
  // Fallback untuk upload.fields(): req.files[field][0].
  const list = req.files && req.files[field];
  if (list && list[0] && list[0].path) return list[0].path;
  return null;
}

function load(req, res, next) {
  req.data = db.read();
  next();
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Masuk Admin', layout: false, error: null });
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
  req.session.userId = user.id;
  res.redirect('/admin');
});

router.post('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireLogin, load);

// Semua halaman setelah login memakai layout admin
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  next();
});

// Modul marketing (kontak + blast WhatsApp) di bawah /admin/marketing
router.use('/marketing', require('./marketing.routes').createMarketingRouter());

// Modul integrasi media sosial (Connect Social Media + Postiz) di bawah /admin/social
router.use('/social', require('./social.routes').createSocialRouter());

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
/* Lokasi Langsung (presence)                                          */
/* ------------------------------------------------------------------ */
/**
 * Halaman admin untuk melihat posisi langsung semua partisipan yang
 * sedang membagikan lokasi (tim + pelanggan), dengan jarak dari admin.
 *
 * Data diambil dari `src/services/presence.js` (penyimpanan terpisah di
 * data/presence.json) — tidak menyentuh alur booking yang sudah ada.
 */
router.get('/lokasi', (req, res) => {
  const data = req.data;
  const settings = data.settings || {};
  const presence = require('../services/presence');

  const enabled = presence.isEnabled(settings);
  const me = presence.get('admin', req.session.userId);

  // Gunakan peersOf() agar konsisten dengan /api/presence/state:
  // posisi admin sendiri TIDAK ikut ditampilkan sebagai "peer".
  const entries = enabled
    ? presence.peersOf(
      me
        ? { role: 'admin', refId: req.session.userId, lat: me.lat, lng: me.lng }
        : { role: 'admin', refId: req.session.userId, lat: null, lng: null },
      data,
      settings
    )
    : [];

  const peers = entries
    .map((e) => {
      const distance = e.distance;
      const customer = e.role === 'customer'
        ? (data.customers || []).find((c) => c.id === e.refId)
        : null;
      const user = e.role === 'admin'
        ? (data.users || []).find((u) => u.id === e.refId)
        : null;
      return {
        ...e,
        distance,
        distanceLabel: Number.isFinite(distance) ? geo.formatDistance(distance) : null,
        phone: customer ? customer.phone : null,
        email: customer ? customer.email : null,
        displayName: customer ? customer.name : (user ? user.name : e.name)
      };
    })
    .sort((a, b) => {
      const da = Number.isFinite(a.distance) ? a.distance : Infinity;
      const dbb = Number.isFinite(b.distance) ? b.distance : Infinity;
      return da - dbb;
    });

  res.render('admin/lokasi', {
    title: 'Lokasi Langsung',
    enabled,
    peers,
    myPosition: me,
    ttlLabel: Math.round(presence.ttlMs(settings) / 60000) + ' menit',
    mapData: JSON.stringify({
      dest: null,
      checkIn: null,
      track: [],
      // Posisi admin sendiri ditampilkan sebagai marker "live".
      live: me
        ? { lat: me.lat, lng: me.lng, accuracy: me.accuracy }
        : null,
      peers: peers.map((p) => ({
        role: p.role,
        name: p.displayName,
        label: p.label,
        lat: p.lat,
        lng: p.lng,
        distance: p.distance
      }))
    })
  });
});

/* ------------------------------------------------------------------ */
/* Destinasi                                                           */
/* ------------------------------------------------------------------ */
router.get('/destinasi', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = [...req.data.destinations];
  if (q) list = list.filter((x) => x.name.toLowerCase().includes(q) || x.region.toLowerCase().includes(q));
  const pg = helpers.paginate(list, req.query.page, 8);
  res.render('admin/destinations', { title: 'Kelola Destinasi', pg, q: req.query.q || '' });
});

router.get('/destinasi/baru', (req, res) => {
  res.render('admin/destination-form', { title: 'Tambah Destinasi', item: null, action: '/admin/destinasi' });
});

function destFromBody(body, oldImage, oldGallery) {
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
    lat: body.lat !== '' && body.lat != null ? parseFloat(body.lat) : null,
    lng: body.lng !== '' && body.lng != null ? parseFloat(body.lng) : null,
    image: oldImage || '/img/dest-default.svg',
    gallery: Array.isArray(oldGallery) ? oldGallery.slice() : [],
    featured: helpers.isChecked(body.featured),
    status: body.status === 'published' ? 'published' : 'draft'
  };
}

/**
 * Susun daftar galeri final dari gambar utama + berkas galeri baru.
 * @param {string} mainImage URL gambar utama
 * @param {string[]} existing URL galeri lama
 * @param {string[]} added URL berkas galeri baru
 * @returns {string[]} daftar URL galeri
 */
function buildGallery(mainImage, existing, added) {
  const list = [];
  if (mainImage) list.push(mainImage);
  (existing || []).forEach((u) => {
    if (u && !list.includes(u)) list.push(u);
  });
  (added || []).forEach((u) => {
    if (u && !list.includes(u)) list.push(u);
  });
  return list;
}

router.post(
  '/destinasi',
  ...imageFields([
    { name: 'imageFile', slot: 'card', maxCount: 1 },
    { name: 'galleryFiles', slot: 'gallery', maxCount: 8 }
  ]),
  (req, res) => {
  const body = req.body;
  const errors = [];
  if (!body.name || body.name.trim().length < 3) errors.push('Nama destinasi wajib diisi.');
  if (!body.region || body.region.trim().length < 3) errors.push('Lokasi/region wajib diisi.');
  if (!body.description || body.description.trim().length < 20) errors.push('Deskripsi minimal 20 karakter.');
  if (errors.length) {
    // Berkas gambar sudah diproses middleware upload; hapus agar tidak yatim.
    cleanupUploads(req);
    flash('error', errors.join(' '), req);
    return res.redirect('/admin/destinasi/baru');
  }
  const data = req.data;
  const record = destFromBody(body, imageUrl(req, 'imageFile'), []);
  record.id = db.uid('dst');
  record.slug = db.uniqueSlug(data.destinations, db.slugify(body.name));
  const galleryAdded = (req.processedImages && req.processedImages.galleryFiles) || [];
  record.gallery = buildGallery(record.image, [], galleryAdded.map((g) => g.url));
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
    action: `/admin/destinasi/${item.id}`
  });
});

router.post(
  '/destinasi/:id',
  ...imageFields([
    { name: 'imageFile', slot: 'card', maxCount: 1 },
    { name: 'galleryFiles', slot: 'gallery', maxCount: 8 }
  ]),
  (req, res, next) => {
  const data = req.data;
  const item = data.destinations.find((x) => x.id === req.params.id);
  if (!item) {
    cleanupUploads(req);
    return next();
  }
  const oldImage = item.image;
  const oldGallery = Array.isArray(item.gallery) ? item.gallery.slice() : [];

  // Galeri lama yang masih dipertahankan (admin bisa mencentang untuk dihapus).
  // CATATAN: field "removeGallery" muncul sebagai string bila hanya satu
  // checkbox yang dicentang, dan sebagai array bila lebih dari satu.
  const removedRaw = req.body.removeGallery;
  const removedGallery = Array.isArray(removedRaw)
    ? removedRaw
    : (removedRaw ? [removedRaw] : []);
  const keptGallery = oldGallery.filter((u) => !removedGallery.includes(u));

  const updated = destFromBody(req.body, oldImage, keptGallery);
  // Deteksi gambar utama baru dari hasil proses upload (bukan req.file,
  // karena upload.fields() mengisi req.files, bukan req.file).
  const newMainImage = imageUrl(req, 'imageFile');
  if (newMainImage && newMainImage !== oldImage) {
    updated.image = newMainImage;
  }
  const galleryAdded = (req.processedImages && req.processedImages.galleryFiles) || [];
  // Galeri lama yang memuat gambar utama yang kini diganti harus ikut
  // dibuang. Kalau tidak, galeri akan tetap menunjuk berkas lama yang
  // sudah dihapus dari disk → gambar rusak di strip galeri beranda.
  const carriedGallery = keptGallery.filter((u) => u !== oldImage);
  updated.gallery = buildGallery(updated.image, carriedGallery, galleryAdded.map((g) => g.url));

  // Hapus berkas gambar yang tidak lagi dipakai.
  const stillUsed = new Set(updated.gallery);
  oldGallery.forEach((u) => {
    if (u && !stillUsed.has(u)) removeUploadByUrl(u);
  });
  if (oldImage && !stillUsed.has(oldImage)) removeUploadByUrl(oldImage);

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
  removeUploadByUrl(removed.image);
  // Hapus semua berkas foto pada galeri.
  (removed.gallery || []).forEach((u) => {
    if (u && u !== removed.image) removeUploadByUrl(u);
  });
  db.write();
  flash('success', `Destinasi "${removed.name}" dihapus.`, req);
  res.redirect('/admin/destinasi');
});

/* ------------------------------------------------------------------ */
/* Galeri Destinasi (Admin Management Suite)                          */
/* ------------------------------------------------------------------ */
router.get('/galeri', (req, res) => {
  const d = req.data;
  const featuredCount = d.destinations.filter((x) => x.featured).length;
  const photoCount = d.destinations.reduce(
    (sum, x) => sum + (Array.isArray(x.gallery) ? x.gallery.length : 0),
    0
  );
  res.render('admin/galeri', {
    title: 'Kelola Galeri Destinasi',
    stats: { total: d.destinations.length, featured: featuredCount, photos: photoCount },
    destinations: d.destinations,
    settings: d.settings || {}
  });
});

/**
 * Simpan urutan portofolio.
 * Urutan array `destinations` adalah urutan tampil di situs publik, jadi
 * menyimpan = menyusun ulang array lalu menulis DB. Body JSON:
 * { order: ["id1", "id2", ...] } — harus permutasi lengkap.
 */
router.post('/galeri/urutan', (req, res) => {
  const d = req.data;
  const order = Array.isArray(req.body && req.body.order) ? req.body.order.map(String) : [];
  if (order.length !== d.destinations.length) {
    return res.status(400).json({ ok: false, error: 'Urutan harus memuat semua destinasi.' });
  }
  const byId = new Map(d.destinations.map((x) => [String(x.id), x]));
  const seen = new Set();
  const next = [];
  for (const id of order) {
    if (!byId.has(id) || seen.has(id)) {
      return res.status(400).json({ ok: false, error: 'Urutan berisi ID tidak dikenal atau ganda.' });
    }
    seen.add(id);
    next.push(byId.get(id));
  }
  d.destinations = next;
  db.write();
  res.json({ ok: true, order: next.map((x) => x.id) });
});

/** Tandai/lepas destinasi sebagai unggulan (dipakai kartu portofolio). */
router.post('/galeri/unggulan', (req, res) => {
  const d = req.data;
  const id = String((req.body && req.body.id) || '');
  const dest = d.destinations.find((x) => String(x.id) === id);
  if (!dest) return res.status(404).json({ ok: false, error: 'Destinasi tidak ditemukan.' });
  dest.featured = req.body.featured === true || req.body.featured === 'true';
  db.write();
  res.json({ ok: true, id: dest.id, featured: dest.featured });
});

/* ------------------------------------------------------------------ */
/* Angkutan umum sekitar (OpenStreetMap / Overpass)                    */
/* ------------------------------------------------------------------ */
router.get('/angkutan', async (req, res) => {
  const d = req.data;
  const categories = osm.CATEGORIES;
  const keys = Object.keys(categories);
  const rawCategory = String(req.query.kategori || 'transport');
  const category = keys.includes(rawCategory) ? rawCategory : 'transport';
  const radius = Math.min(5000, Math.max(300, Number(req.query.radius) || 1200));

  const destinations = d.destinations.map((x) => ({
    id: x.id,
    name: x.name,
    region: x.region || '',
    lat: Number(x.lat),
    lng: Number(x.lng)
  }));
  const withCoords = destinations.filter(
    (x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)
  );

  const hasQuery =
    req.query.cari === '1' || req.query.lat !== undefined || req.query.lng !== undefined;
  const origin = { label: '', lat: null, lng: null, destId: '' };
  const baseView = {
    title: 'Cari Angkutan Umum',
    categories,
    category,
    radius,
    destinations: withCoords,
    origin
  };

  if (!hasQuery) {
    return res.render('admin/angkutan', {
      ...baseView,
      query: { dest: '', lat: '', lng: '' },
      result: null,
      searchError: null
    });
  }

  const destId = String(req.query.dest || '');
  const picked = destId ? withCoords.find((x) => String(x.id) === destId) : null;
  let lat = Number(req.query.lat);
  let lng = Number(req.query.lng);

  if (picked) {
    lat = picked.lat;
    lng = picked.lng;
    origin.destId = String(picked.id);
    origin.label = picked.name + (picked.region ? ` · ${picked.region}` : '');
  } else if (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  ) {
    origin.label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } else {
    lat = null;
    lng = null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).render('admin/angkutan', {
      ...baseView,
      query: { dest: origin.destId, lat: req.query.lat || '', lng: req.query.lng || '' },
      result: null,
      searchError: 'Pilih destinasi atau isi koordinat yang valid lebih dulu.'
    });
  }

  origin.lat = lat;
  origin.lng = lng;

  try {
    const result = await osm.nearby({ lat, lng, category, radius, limit: 30 });
    return res.render('admin/angkutan', {
      ...baseView,
      query: { dest: origin.destId, lat, lng },
      result,
      searchError: null
    });
  } catch (err) {
    return res.status(502).render('admin/angkutan', {
      ...baseView,
      query: { dest: origin.destId, lat, lng },
      result: null,
      searchError: err && err.code === 'invalid_query'
        ? err.message
        : 'Layanan peta OpenStreetMap sedang tidak merespons. Coba lagi sebentar lagi.'
    });
  }
});

/**
 * Bersihkan berkas gambar yang sudah ditulis ke disk tapi tidak terpakai.
 *
 * MASALAH: middleware `galleryImages` memproses berkas satu per satu. Bila
 * berkas ke-2 gagal validasi, berkas ke-1 sudah tertulis di `public/uploads`
 * — tapi `req.processedImages` belum pernah diisi (error dilempar sebelum
 * assignment), sehingga `cleanupUploads()` tidak menemukannya dan berkas
 * itu menjadi yatim.
 *
 * Solusi: fungsi ini memeriksa DUA sumber:
 *  1. `req.processedImages` — berkas yang selesai diproses normal,
 *  2. `req.files[field]` — berkas yang field `filename`/`path`-nya sudah
 *     diisi oleh `processImage` (artinya sudah ditulis ke disk).
 *
 * @param {object} req request Express
 * @param {string} [field] nama field berkas (default: semua field)
 */
function cleanupUploadFiles(req, field) {
  const processed = (req && req.processedImages) || {};
  const fields = field ? [field] : Object.keys(processed);

  // Sumber 1: hasil proses yang tercatat di req.processedImages.
  fields.forEach((f) => {
    const result = processed[f];
    const list = Array.isArray(result) ? result : [result];
    list.forEach((item) => {
      if (item && item.filename) removeUploadByUrl('/uploads/' + item.filename);
    });
  });

  // Sumber 2: berkas multer yang field filename-nya sudah diisi
  // `processImage` (berarti sudah ada di disk).
  const files = (req && req.files) || {};
  Object.keys(files).forEach((f) => {
    if (field && f !== field) return;
    (files[f] || []).forEach((file) => {
      // `file.path` diisi processImage dengan URL publik (/uploads/...).
      // `file.originalname` (nama asli) TIDAK boleh dihapus.
      if (file && file.path && String(file.path).startsWith('/uploads/')) {
        removeUploadByUrl(file.path);
      }
    });
  });
}

/**
 * Petakan error unggah menjadi status HTTP + pesan per-slot.
 *
 * Endpoint JSON (mis. /admin/galeri/unggah) memakai peta ini supaya
 * galat ALWAYS dibalas sebagai JSON `{ok:false, error}` — bukan redirect
 * HTML seperti route form biasa. Tanpa ini, pesan batas ukuran per-slot
 * hilang dan klien hanya melihat "Respons server tidak valid".
 *
 * @param {Error} err error dari middleware upload / multer
 * @returns {{status: number, message: string}}
 */
function uploadErrorResponse(err) {
  const code = err && err.code;

  // MIME / format tidak didukung untuk slot ini.
  if (code === 'INVALID_IMAGE') {
    const message = err.message || 'Format berkas tidak didukung.';
    // Pesan "tidak diizinkan untuk <label slot>" = MIME tak didukung.
    const status = /tidak diizinkan untuk/.test(message) ? 415 : 400;
    return { status: status, message: message };
  }

  // Ukuran melebihi batas per-slot (pesan sudah menyebut batas slot).
  if (code === 'LIMIT_FILE_SIZE') {
    return { status: 400, message: err.message || 'Berkas terlalu besar.' };
  }

  // Jumlah berkas melebihi batas atau field tak dikenal.
  if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      status: 400,
      message: 'Jumlah berkas melebihi batas. Maksimal 8 file per unggahan.'
    };
  }

  // Token CSRF tidak valid.
  if (code === 'INVALID_CSRF') {
    return {
      status: 403,
      message: err.message || 'Token keamanan tidak valid atau kedaluwarsa.'
    };
  }

  // Gambar polos / transparan.
  if (code === 'BLANK_IMAGE') {
    return { status: 400, message: err.message || 'Gambar tidak dapat dipakai.' };
  }

  return { status: 400, message: (err && err.message) || 'Upload gagal.' };
}

/**
 * Unggah batch foto galeri (Gallery Management Suite).
 *
 * Route ini dipakai widget batch upload di /admin/galeri. Widget tersebut
 * sebelumnya hanya mensimulasikan konversi WebP tanpa pernah mengirim
 * berkas ke server — sekarang jadi nyata.
 *
 * Body: multipart/form-data
 *  - galleryFiles  : file[]  (maks 8)
 *  - destinationId : text   (opsional — ID destinasi tujuan)
 *  - kind          : text   ('gallery' default | 'main')
 *
 * Respons: JSON { ok, files[], error? }
 *
 * Semua galat dibalas sebagai JSON dengan status yang jelas:
 *  - 400 format/ukuran/jumlah berkas tidak valid
 *  - 403 token CSRF tidak valid
 *  - 404 destinationId tidak dikenal
 *  - 415 MIME tidak diizinkan untuk slot
 */
router.post(
  '/galeri/unggah',
  ...galleryImages('galleryFiles', 'gallery', 8),
  async (req, res, next) => {
    try {
      const processed = (req.processedImages && req.processedImages.galleryFiles) || [];
      if (!processed.length) {
        return res.status(400).json({
          ok: false,
          error: 'Tidak ada berkas gambar yang diunggah.'
        });
      }

      const data = req.data;
      const destId = String(req.body.destinationId || '').trim();
      const kind = String(req.body.kind || 'gallery').trim();

      // "Ganti gambar utama" hanya menerima SATU berkas. Kalau lebih dari
      // satu, sisanya akan jadi berkas yatim di disk (tidak terpakai dan
      // tidak pernah dihapus) — lebih baik ditolak dengan jelas.
      if (kind === 'main' && processed.length > 1) {
        cleanupUploadFiles(req, 'galleryFiles');
        return res.status(400).json({
          ok: false,
          error: 'Ganti gambar utama hanya menerima 1 file per unggahan.'
        });
      }

      // Kalau destinationId diberikan, langsung pasang berkasnya ke destinasi.
      let dest = null;
      if (destId) {
        dest = (data.destinations || []).find((d) => d.id === destId);
        if (!dest) {
          cleanupUploadFiles(req, 'galleryFiles');
          return res.status(404).json({ ok: false, error: 'Destinasi tidak ditemukan.' });
        }
      }

      const files = processed.map((p) => ({
        filename: p.filename,
        url: p.url,
        width: p.width || null,
        height: p.height || null,
        bytes: p.bytes || null
      }));

      if (dest) {
        if (kind === 'main') {
          const oldImage = dest.image;
          dest.image = files[0].url;
          if (oldImage && oldImage !== dest.image) removeUploadByUrl(oldImage);
        } else {
          dest.gallery = Array.isArray(dest.gallery) ? dest.gallery : [];
          files.forEach((f) => {
            if (!dest.gallery.includes(f.url)) dest.gallery.push(f.url);
          });
        }
        db.write();
      }

      return res.json({ ok: true, files });
    } catch (err) {
      // Galat tak terduga di dalam handler: bersihkan berkas yang sudah
      // ditulis supaya tidak ada berkas yatim di folder uploads.
      cleanupUploadFiles(req, 'galleryFiles');
      return next(err);
    }
  },
  // Penangkap error dari middleware upload (validasi & multer).
  // Tanpa ini error dilempar ke global error handler yang me-redirect
  // (HTML) — pesan per-slot tidak pernah sampai ke klien.
  (err, req, res, next) => {
    cleanupUploadFiles(req, 'galleryFiles');
    const mapped = uploadErrorResponse(err);
    if (res.headersSent) return next(err);
    return res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
);

/* ------------------------------------------------------------------ */
/* Paket                                                               */
/* ------------------------------------------------------------------ */
router.get('/paket', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = [...req.data.packages];
  if (q) list = list.filter((x) => x.title.toLowerCase().includes(q) || x.destinationName.toLowerCase().includes(q));
  const pg = helpers.paginate(list, req.query.page, 8);
  res.render('admin/packages', { title: 'Kelola Paket Wisata', pg, q: req.query.q || '' });
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

router.post('/paket', ...singleImage('imageFile', 'card'), (req, res) => {
  const errors = [];
  if (!req.body.title || req.body.title.trim().length < 3) errors.push('Judul paket wajib diisi.');
  if (!req.body.destinationSlug) errors.push('Destinasi wajib dipilih.');
  if (!(parseInt(req.body.price, 10) > 0)) errors.push('Harga harus lebih dari 0.');
  if (errors.length) {
    cleanupUploads(req);
    flash('error', errors.join(' '), req);
    return res.redirect('/admin/paket/baru');
  }
  const data = req.data;
  const record = pkgFromBody(req.body, imageUrl(req, 'imageFile'));
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

router.post('/paket/:id', ...singleImage('imageFile', 'card'), (req, res, next) => {
  const data = req.data;
  const item = data.packages.find((x) => x.id === req.params.id);
  if (!item) {
    cleanupUploads(req);
    return next();
  }
  const oldImage = item.image;
  const updated = pkgFromBody(req.body, oldImage);
  if (req.file) {
    removeUploadByUrl(oldImage);
    updated.image = imageUrl(req, 'imageFile');
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
  removeUploadByUrl(removed.image);
  db.write();
  flash('success', `Paket "${removed.title}" dihapus.`, req);
  res.redirect('/admin/paket');
});

/* ------------------------------------------------------------------ */
/* Artikel                                                             */
/* ------------------------------------------------------------------ */
router.get('/artikel', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = [...req.data.articles];
  if (q) list = list.filter((x) => x.title.toLowerCase().includes(q) || x.category.toLowerCase().includes(q));
  const pg = helpers.paginate(list, req.query.page, 8);
  res.render('admin/articles', { title: 'Kelola Artikel', pg, q: req.query.q || '' });
});

router.get('/artikel/baru', (req, res) => {
  res.render('admin/article-form', { title: 'Tambah Artikel', item: null, action: '/admin/artikel' });
});

/**
 * Susun data artikel dari body form.
 *
 * Catatan: parameter `settings` WAJIB diteruskan eksplisit. Versi lama
 * menulis `req.data.settings` di dalam fungsi ini, padahal `req` tidak
 * ada di scope fungsi → ReferenceError "req is not defined" setiap kali
 * admin membuat artikel.
 *
 * @param {object} body body request
 * @param {string} oldImage URL gambar lama (kalau ada)
 * @param {object} settings object settings situs (untuk nama penulis bawaan)
 * @returns {object} data artikel
 */
function artFromBody(body, oldImage, settings) {
  const fallbackAuthor = brandService.authorName(settings || {});
  return {
    title: String(body.title || '').trim(),
    excerpt: String(body.excerpt || '').trim(),
    body: String(body.body || '').trim(),
    category: String(body.category || 'Umum').trim() || 'Umum',
    author: String(body.author || fallbackAuthor).trim() || fallbackAuthor,
    coverImage: oldImage || '/img/dest-default.svg',
    status: body.status === 'published' ? 'published' : 'draft',
    publishedAt: body.status === 'published' ? new Date().toISOString() : null
  };
}

router.post('/artikel', ...singleImage('imageFile', 'article'), (req, res) => {
  const errors = [];
  if (!req.body.title || req.body.title.trim().length < 5) errors.push('Judul artikel wajib minimal 5 karakter.');
  if (!req.body.body || req.body.body.trim().length < 50) errors.push('Isi artikel minimal 50 karakter.');
  if (errors.length) {
    cleanupUploads(req);
    flash('error', errors.join(' '), req);
    return res.redirect('/admin/artikel/baru');
  }
  const data = req.data;
  const record = artFromBody(req.body, imageUrl(req, 'imageFile'), data.settings);
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

router.post('/artikel/:id', ...singleImage('imageFile', 'article'), (req, res, next) => {
  const data = req.data;
  const item = data.articles.find((x) => x.id === req.params.id);
  if (!item) {
    cleanupUploads(req);
    return next();
  }
  const oldImage = item.coverImage;
  const updated = artFromBody(req.body, oldImage, data.settings);
  if (req.file) {
    removeUploadByUrl(oldImage);
    updated.coverImage = imageUrl(req, 'imageFile');
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
  removeUploadByUrl(removed.coverImage);
  db.write();
  flash('success', `Artikel "${removed.title}" dihapus.`, req);
  res.redirect('/admin/artikel');
});

/* ------------------------------------------------------------------ */
/* Booking                                                             */
/* ------------------------------------------------------------------ */
router.get('/booking', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();
  let list = [...req.data.bookings];
  if (q) {
    list = list.filter(
      (b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q) || b.packageName.toLowerCase().includes(q)
    );
  }
  if (status) list = list.filter((b) => b.status === status);
  const pg = helpers.paginate(list, req.query.page, 10);
  res.render('admin/bookings', { title: 'Booking Masuk', pg, q: req.query.q || '', status });
});

/* Detail booking: info, pembayaran, peta check-in & waypoint perjalanan. */
router.get('/booking/:id', (req, res, next) => {
  const data = req.data;
  const booking = data.bookings.find((x) => x.id === req.params.id);
  if (!booking) return next();
  // Resolusi destinasi via paket (booking.packageSlug = slug paket).
  // Kode lama salah membandingkan packageSlug dengan d.slug.
  const destination = trip.resolveDestination(data, booking);
  const customer = (data.customers || []).find((c) => c.id === booking.customerId) || null;
  const distance = trip.distanceToDestination(booking, destination);
  res.render('admin/booking-detail', {
    title: `Booking ${booking.code}`,
    booking,
    destination,
    customer,
    distance,
    distanceLabel: distance === null ? null : geo.formatDistance(distance),
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

/* Verifikasi pembayaran manual (mis. transfer dimuat dari luar iPaymu). */
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
  db.write();
  flash('error', `Pembayaran booking ${item.code} ditolak. Tamu diminta membayar ulang.`, req);
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
router.get('/pesan', (req, res) => {
  const pg = helpers.paginate([...req.data.messages], req.query.page, 10);
  res.render('admin/messages', { title: 'Kotak Pesan', pg });
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
router.get('/pelanggan', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const data = req.data;
  const presence = require('../services/presence');
  const settings = data.settings || {};
  const presenceOn = presence.isEnabled(settings);

  let list = (data.customers || []).map((c) => {
    const bookings = (data.bookings || []).filter((b) => b.customerId === c.id);
    // Posisi terakhir yang dibagikan (jika fitur aktif & pelanggan sedang offline).
    const live = presenceOn ? presence.get('customer', c.id) : null;
    return {
      ...c,
      bookingCount: bookings.length,
      lastBooking: bookings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null,
      livePosition: live,
      isOnline: !!live
    };
  });
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.email.includes(q) || (c.phone || '').includes(q));
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const pg = helpers.paginate(list, req.query.page, 10);
  res.render('admin/customers', { title: 'Pelanggan', pg, q: req.query.q || '', presenceOn });
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
router.get('/testimoni', (req, res) => {
  const status = String(req.query.status || '').trim();
  let list = [...(req.data.reviews || [])];
  if (status) list = list.filter((r) => r.status === status);
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const pg = helpers.paginate(list, req.query.page, 10);
  res.render('admin/testimoni', { title: 'Testimoni & Ulasan', pg, status });
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
/**
 * Kelompok field pada halaman Pengaturan.
 *
 * Halaman ini memuat 5 form terpisah yang semuanya POST ke /admin/pengaturan.
 * Kalau route memperlakukan semua field sekaligus, setiap form menimpa field
 * milik form lain dengan nilai kosong (mis. "Simpan Tema" mematikan tombol
 * WhatsApp mengambang). Karena itu tiap form menyertakan field tersembunyi
 * `form` dan route hanya menerapkan field milik kelompok tersebut.
 */
const SETTINGS_GROUPS = {
  site: [
    'siteName', 'tagline', 'heroTitle', 'heroSubtitle', 'whatsapp', 'email',
    'phone', 'address', 'instagram', 'facebook', 'about', 'waFloatEnabled',
    'waFloatMessage', 'logoFile', 'logoImageReset', 'heroFile', 'heroImageReset',
    'heroMode'
  ],
  theme: ['themeMode', 'themeAccent'],
  gateway: ['ipaymuVa', 'ipaymuApiKey', 'ipaymuProduction'],
  // Profil publik media sosial + konfigurasi Postiz (self-hosted).
  social: require('../services/social').settingsFields(),
  wa: [
    'waDefaultTemplate',
    'waQuietStart', 'waQuietEnd', 'waReminderIntervalMin',
    // Batas pengiriman: per kontak per hari & total harian.
    'frequencyCap', 'globalDailyLimit'
  ],
  // Gateway WhatsApp OpenWA (self-hosted REST API).
  // Kredensial API key & webhook secret boleh diisi di sini; kalau dikosongkan
  // saat disimpan, nilai lama dipertahankan (input password tidak selalu
  // terkirim ulang oleh browser).
  openwa: [
    'openwaBaseUrl', 'openwaApiKey', 'openwaSessionName',
    'openwaWebhookUrl', 'openwaWebhookSecret',
    // Timeout request ke gateway (ms).
    'openwaTimeoutMs'
  ],
  // Lokasi langsung (presence): toggle fitur + masa berlaku posisi.
  presence: ['presenceEnabled', 'presenceTtlMin']
};

/**
 * Batas nilai yang boleh disetel admin untuk tiap key numerik.
 *
 * WAJIB satu sumber kebenaran: `globalDailyLimit` tidak boleh lebih besar
 * daripada retensi log harian (`wa.MAX_GLOBAL_DAILY_LIMIT`), karena
 * `checkDailyLimit` menghitung entri log — batas yang lebih besar tidak
 * akan pernah terpicu (efektif jadi 500 saja).
 */
const SETTINGS_LIMITS = {
  openwaTimeoutMs: { min: gateway.MIN_TIMEOUT_MS, max: gateway.MAX_TIMEOUT_MS, def: gateway.DEFAULT_TIMEOUT_MS },
  frequencyCap: { min: 1, max: 50, def: 3 },
  globalDailyLimit: { min: 10, max: waService.MAX_GLOBAL_DAILY_LIMIT, def: 100 }
};

/**
 * Ambil daftar field yang boleh diproses oleh form yang sedang dikirim.
 *
 * Bila field `form` tidak dikenal (permintaan lama / pihak ketiga), semua
 * field diperlakukan sebagai kelompok "site" — perilaku lama.
 *
 * @param {object} body body request
 * @returns {Set<string>} nama field yang boleh diubah
 */
function settingsScope(body) {
  const group = SETTINGS_GROUPS[body.form];
  if (group) return new Set(group);
  return new Set(SETTINGS_GROUPS.site);
}

/**
 * Baca nilai teks dari body, tapi hanya bila field-nya termasuk dalam scope.
 * @param {object} b body request
 * @param {Set<string>} scope field yang boleh diubah
 * @param {string} key nama field
 * @param {string} fallback nilai lama bila field tidak dikirim
 * @returns {string} nilai baru
 */
function scopedText(b, scope, key, fallback) {
  if (!scope.has(key)) return fallback;
  return String(b[key] === undefined ? fallback : b[key]).trim();
}

/**
 * Baca nilai jam (0–23) dari body, hanya bila field-nya termasuk scope.
 *
 * Nilai di luar rentang ditolak dan fallback dipakai supaya jam tenang
 * tidak pernah berisi angka nonsense (mis. 99) yang membuat logika
 * pengingat diam-diam tidak berjalan.
 *
 * @param {object} b body request
 * @param {Set<string>} scope field yang boleh diubah
 * @param {string} key nama field
 * @param {number} fallback nilai lama / bawaan
 * @returns {number} jam valid 0–23
 */
function scopedHour(b, scope, key, fallback, defaultHour) {
  if (!scope.has(key)) return fallback === undefined ? defaultHour : fallback;
  const raw = b[key];
  if (raw === undefined || String(raw).trim() === '') {
    return fallback === undefined ? defaultHour : fallback;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 0 || n > 23) {
    return fallback === undefined ? defaultHour : fallback;
  }
  return n;
}

/**
 * Baca nilai bulat dari body dengan batas minimum & maksimum.
 *
 * @param {object} b body request
 * @param {Set<string>} scope field yang boleh diubah
 * @param {string} key nama field
 * @param {number} fallback nilai lama
 * @param {number} def nilai bawaan bila belum pernah diisi
 * @param {number} min batas bawah
 * @param {number} max batas atas
 * @returns {number} nilai valid
 */
function scopedInt(b, scope, key, fallback, def, min, max) {
  if (!scope.has(key)) return fallback === undefined ? def : fallback;
  const raw = b[key];
  if (raw === undefined || String(raw).trim() === '') {
    return fallback === undefined ? def : fallback;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n)) return fallback === undefined ? def : fallback;
  return Math.min(max, Math.max(min, n));
}

router.get('/pengaturan', (req, res) => {
  res.render('admin/settings', {
    title: 'Pengaturan Situs',
    item: req.data.settings,
    // Rentang nilai numerik yang dipakai form. Satu sumber kebenaran:
    // `SETTINGS_LIMITS` yang sama dipakai route penyimpanan — supaya
    // atribut min/max di form tak pernah melenceng dari batas sebenarnya.
    limits: SETTINGS_LIMITS,
    // Daftar platform media sosial untuk form tautan profil.
    socialPlatforms: require('../services/social').PROFILE_PLATFORMS
  });
});

router.post(
  '/pengaturan',
  ...multiImage([
    { name: 'logoFile', slot: 'logo' },
    { name: 'heroFile', slot: 'hero' }
  ]),
  (req, res) => {
  const data = req.data;
  const b = req.body;
  const s = data.settings;
  const scope = settingsScope(b);

  if (scope.has('siteName')) s.siteName = scopedText(b, scope, 'siteName', s.siteName);
  if (scope.has('tagline')) s.tagline = scopedText(b, scope, 'tagline', s.tagline);
  if (scope.has('heroTitle')) s.heroTitle = scopedText(b, scope, 'heroTitle', s.heroTitle);
  if (scope.has('heroSubtitle')) s.heroSubtitle = scopedText(b, scope, 'heroSubtitle', s.heroSubtitle);
  if (scope.has('whatsapp')) s.whatsapp = scopedText(b, scope, 'whatsapp', s.whatsapp).replace(/[^0-9]/g, '');
  if (scope.has('email')) s.email = scopedText(b, scope, 'email', s.email);
  if (scope.has('phone')) s.phone = scopedText(b, scope, 'phone', s.phone);
  if (scope.has('address')) s.address = scopedText(b, scope, 'address', s.address);
  if (scope.has('instagram')) s.instagram = scopedText(b, scope, 'instagram', s.instagram);
  if (scope.has('facebook')) s.facebook = scopedText(b, scope, 'facebook', s.facebook);
  if (scope.has('about')) s.about = scopedText(b, scope, 'about', s.about);
  // Menu WhatsApp mengambang.
  // Hanya diubah bila field-nya benar-benar terkirim — kalau tidak, form
  // lain (mis. "Simpan Tema") akan mematikan tombol ini sebagai efek samping.
  if (scope.has('waFloatEnabled') && 'waFloatEnabled' in b) {
    s.waFloatEnabled = helpers.isChecked(b.waFloatEnabled);
  }
  if (scope.has('waFloatMessage')) s.waFloatMessage = scopedText(b, scope, 'waFloatMessage', s.waFloatMessage);
  // Payment gateway iPaymu — nilai kosong berarti admin sengaja
  // menonaktifkan gateway, jadi TIDAK memakai `|| nilai lama`.
  if (scope.has('ipaymuVa')) s.ipaymuVa = scopedText(b, scope, 'ipaymuVa', '');
  if (scope.has('ipaymuApiKey')) s.ipaymuApiKey = scopedText(b, scope, 'ipaymuApiKey', '');
  if (scope.has('ipaymuProduction')) s.ipaymuProduction = helpers.isChecked(b.ipaymuProduction);
  // Media sosial: tautan profil publik + konfigurasi Postiz.
  // Hanya field milik kelompok "social" yang boleh berubah agar form lain
  // (mis. "Simpan Tema") tidak menimpa tautan profil.
  const socialScope = require('../services/social');
  const socialUpdates = socialScope.normalizeSettings(b, s);
  Object.keys(socialUpdates).forEach((key) => {
    if (!scope.has(key)) return;
    s[key] = socialUpdates[key];
  });
  // WhatsApp marketing (template blast + aturan etika pengiriman)
  if (scope.has('waDefaultTemplate')) s.waDefaultTemplate = scopedText(b, scope, 'waDefaultTemplate', '');
  // Jam tenang: nilai 0–23. Start == end berarti jam tenang dimatikan.
  if (scope.has('waQuietStart')) s.waQuietStart = scopedHour(b, scope, 'waQuietStart', s.waQuietStart, 21);
  if (scope.has('waQuietEnd')) s.waQuietEnd = scopedHour(b, scope, 'waQuietEnd', s.waQuietEnd, 8);
  // Interval pemeriksaan pengingat (menit), minimal 5 menit.
  if (scope.has('waReminderIntervalMin')) {
    s.waReminderIntervalMin = scopedInt(b, scope, 'waReminderIntervalMin', s.waReminderIntervalMin, 30, 5, 1440);
  }
  // Gateway WhatsApp OpenWA (self-hosted).
  // Field kosong berarti "pertahankan yang lama" — kecuali `openwaClear`,
  // yang dipakai admin untuk melepas konfigurasi gateway lama.
  if (scope.has('openwaBaseUrl')) {
    if (b.openwaClear === '1' || b.openwaClear === 'on') {
      s.openwaBaseUrl = '';
      s.openwaApiKey = '';
      s.openwaSessionName = '';
      s.openwaWebhookUrl = '';
      s.openwaWebhookSecret = '';
    } else {
      const baseUrl = scopedText(b, scope, 'openwaBaseUrl', '');
      if (baseUrl) s.openwaBaseUrl = baseUrl.replace(/\/+$/, '');
      const apiKey = scopedText(b, scope, 'openwaApiKey', '');
      if (apiKey) s.openwaApiKey = apiKey;
      const sessionName = scopedText(b, scope, 'openwaSessionName', '');
      if (sessionName) s.openwaSessionName = sessionName;
      const webhookUrl = scopedText(b, scope, 'openwaWebhookUrl', '');
      if (webhookUrl) s.openwaWebhookUrl = webhookUrl;
      const webhookSecret = scopedText(b, scope, 'openwaWebhookSecret', '');
      if (webhookSecret) s.openwaWebhookSecret = webhookSecret;
    }
  }
  // Timeout gateway OpenWA (ms). Terpisah dari blok kredensial di atas
  // supaya "Hapus konfigurasi gateway" tidak ikut menghapus timeout.
  // Batas min/max diambil dari `wa-gateway` supaya panel & env berbagi
  // satu rentang yang sama.
  if (scope.has('openwaTimeoutMs')) {
    const lim = SETTINGS_LIMITS.openwaTimeoutMs;
    s.openwaTimeoutMs = scopedInt(
      b, scope, 'openwaTimeoutMs', s.openwaTimeoutMs, lim.def, lim.min, lim.max
    );
  }
  // Batas pengiriman: pesan per kontak per hari & total harian.
  // Batas atas `globalDailyLimit` = 500 (MAX_GLOBAL_DAILY_LIMIT) karena
  // log kirim harian hanya menyimpan 500 entri terakhir — batas yang lebih
  // besar dari itu tidak akan pernah terpicu (efektif jadi 500 saja).
  if (scope.has('frequencyCap')) {
    const lim = SETTINGS_LIMITS.frequencyCap;
    s.frequencyCap = scopedInt(b, scope, 'frequencyCap', s.frequencyCap, lim.def, lim.min, lim.max);
  }
  if (scope.has('globalDailyLimit')) {
    const lim = SETTINGS_LIMITS.globalDailyLimit;
    s.globalDailyLimit = scopedInt(
      b, scope, 'globalDailyLimit', s.globalDailyLimit, lim.def, lim.min, lim.max
    );
  }
  // Lokasi langsung (presence): toggle fitur & masa berlaku posisi (menit).
  // Checkbox yang tidak dicentang berarti admin sengaja mematikan fitur.
  if (scope.has('presenceEnabled')) {
    s.presenceEnabled = helpers.isChecked(b.presenceEnabled);
  }
  if (scope.has('presenceTtlMin')) {
    s.presenceTtlMin = scopedInt(b, scope, 'presenceTtlMin', s.presenceTtlMin, 5, 1, 120);
  }

  // Logo: berkas lama dihapus ketika diganti agar tidak ada berkas yatim.
  const logoUrl = imageUrl(req, 'logoFile');
  if (logoUrl && logoUrl !== s.logo) {
    removeUploadByUrl(s.logo);
    s.logo = logoUrl;
  }
  // Kembalikan logo ke berkas bawaan (/img/logo.svg). Berkas unggahan
  // sebelumnya ikut dihapus supaya tidak ada berkas yatim.
  if (b.logoImageReset === '1' && s.logo && s.logo.startsWith('/uploads/')) {
    removeUploadByUrl(s.logo);
    s.logo = '/img/logo.svg';
  }
  // Gambar hero: sama — berkas lama dihapus saat diganti atau dikembalikan
  // ke gambar default.
  const heroUrl = imageUrl(req, 'heroFile');
  if (heroUrl && heroUrl !== s.heroImageUrl) {
    removeUploadByUrl(s.heroImageUrl);
    s.heroImageUrl = heroUrl;
  }
  if (b.heroImageReset === '1' && s.heroImageUrl) {
    removeUploadByUrl(s.heroImageUrl);
    s.heroImageUrl = '';
  }
  // Mode hero: auto | video | image. Nilai tak dikenal diabaikan (tetap auto).
  if (scope.has('heroMode') && ['auto', 'video', 'image'].includes(String(b.heroMode || ''))) {
    s.heroMode = String(b.heroMode);
  }
  // Tema tampilan: mode terang/gelap + warna aksen
  if (scope.has('themeMode') && themeService.THEME_MODES.includes(String(b.themeMode || ''))) {
    s.themeMode = b.themeMode;
  }
  if (scope.has('themeAccent') && b.themeAccent) s.themeAccent = themeService.normalizeAccent(b.themeAccent);
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

router.post('/seo', ...multiImage([{ name: 'ogFile', slot: 'og' }]), (req, res) => {
  const s = req.data.settings;
  const b = req.body;
  s.siteUrl = String(b.siteUrl || '').trim().replace(/\/+$/, '');
  s.seoDescription = String(b.seoDescription || '').trim().slice(0, 300);
  s.seoIndex = helpers.isChecked(b.seoIndex);
  const ogUrl = imageUrl(req, 'ogFile');
  if (ogUrl) s.ogImageUrl = ogUrl;
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

// Ekspor tambahan: `settingsScope` dipakai skrip uji untuk membuktikan
// bahwa field baru benar-benar masuk scope form yang benar (bukan hanya
// ada di template). Ekspor tambahan ini tidak merusak pemanggil lama
// (module.exports tetap objek router Express).
module.exports = router;
module.exports.settingsScope = settingsScope;
module.exports.SETTINGS_GROUPS = SETTINGS_GROUPS;
module.exports.SETTINGS_LIMITS = SETTINGS_LIMITS;