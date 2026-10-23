'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const helpers = require('../utils/helpers');
const BRAND = require('../brand');
const { flash } = require('../middleware/context');
const seo = require('../seo');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* SEO: sitemap.xml & robots.txt (open-source, otomatis dari data)     */
/* ------------------------------------------------------------------ */
router.get('/sitemap.xml', (req, res) => {
  const data = db.read();
  const s = { ...(data.settings || {}), siteUrl: (data.settings || {}).siteUrl || `http://${req.get('host')}` };
  res.type('application/xml').send(seo.buildSitemap(s, data));
});

router.get('/robots.txt', (req, res) => {
  const data = db.read();
  const s = { ...(data.settings || {}), siteUrl: (data.settings || {}).siteUrl || `http://${req.get('host')}` };
  res.type('text/plain').send(seo.buildRobots(s));
});

function published(list) {
  return (list || []).filter((x) => x.status === 'published');
}

function findBySlug(list, slug) {
  return (list || []).find((x) => x.slug === slug);
}

/* ------------------------------------------------------------------ */
/* Beranda                                                             */
/* ------------------------------------------------------------------ */
router.get('/', (req, res) => {
  const data = db.read();
  const s = data.settings || {};
  const destinations = published(data.destinations);
  const packages = published(data.packages);
  const articles = published(data.articles).slice(0, 3);
  const testimonials = (data.reviews || [])
    .filter((r) => r.status === 'approved')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 6);
  // Galeri strip: gabungkan gambar galeri destinasi unggulan.
  const galleryStrip = [];
  destinations
    .filter((d) => d.featured)
    .forEach((d) => {
      (d.gallery || []).forEach((img) => {
        if (img && !galleryStrip.includes(img) && galleryStrip.length < 6) galleryStrip.push(img);
      });
    });

  res.render('pages/home', {
    title: 'Beranda',
    seo: {
      title: null,
      description: s.seoDescription || s.tagline,
      image: s.ogImageUrl || s.heroImageUrl || '',
      type: 'website',
      jsonLd: [seo.travelAgency(s), seo.webSite(s)]
    },
    featuredDestinations: destinations.filter((d) => d.featured).slice(0, 4),
    allDestinations: destinations.slice(0, 6),
    featuredPackages: packages.filter((p) => p.featured).slice(0, 3),
    articles,
    testimonials,
    galleryStrip
  });
});

/* ------------------------------------------------------------------ */
/* Destinasi                                                           */
/* ------------------------------------------------------------------ */
router.get('/destinasi', (req, res) => {
  const data = db.read();
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = published(data.destinations);
  if (q) {
    list = list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.region.toLowerCase().includes(q) ||
        d.tagline.toLowerCase().includes(q)
    );
  }
  res.render('pages/destinations', {
    title: 'Destinasi Pulau',
    destinations: list,
    q: req.query.q || ''
  });
});

router.get('/destinasi/:slug', (req, res, next) => {
  const data = db.read();
  const dest = findBySlug(published(data.destinations), req.params.slug);
  if (!dest) return next();
  const related = published(data.packages).filter((p) => p.destinationSlug === dest.slug);
  const s = data.settings || {};
  res.render('pages/destination-detail', {
    title: dest.name,
    seo: {
      title: dest.name,
      description: dest.tagline,
      image: dest.coverImage || '',
      type: 'article',
      jsonLd: [seo.touristAttraction(dest, s)]
    },
    dest,
    relatedPackages: related
  });
});

/* ------------------------------------------------------------------ */
/* Paket wisata                                                        */
/* ------------------------------------------------------------------ */
router.get('/paket', (req, res) => {
  const data = db.read();
  res.render('pages/packages', {
    title: 'Paket Wisata',
    packages: published(data.packages)
  });
});

router.get('/paket/:slug', (req, res, next) => {
  const data = db.read();
  const pkg = findBySlug(published(data.packages), req.params.slug);
  if (!pkg) return next();
  const dest = findBySlug(published(data.destinations), pkg.destinationSlug);
  const s = data.settings || {};
  res.render('pages/package-detail', {
    title: pkg.title,
    seo: {
      title: pkg.title,
      description: pkg.summary,
      image: pkg.image || (dest && dest.coverImage) || '',
      type: 'product',
      jsonLd: [seo.tourPackage(pkg, s)]
    },
    pkg,
    dest,
    minDate: helpers.tomorrowISO()
  });
});

/* Form booking pribadi (bukan klien) */
router.post('/paket/:slug/booking', (req, res, next) => {
  const data = db.read();
  const pkg = findBySlug(published(data.packages), req.params.slug);
  if (!pkg) return next();

  const { name, email, phone, departureDate, participants, notes } = req.body;
  const errors = [];
  if (!name || name.trim().length < 3) errors.push('Nama minimal 3 karakter.');
  if (!helpers.isEmail(email)) errors.push('Format email tidak valid.');
  if (!helpers.isPhone(phone)) errors.push('Nomor HP tidak valid.');
  if (!departureDate) errors.push('Tanggal keberangkatan wajib diisi.');
  const pax = parseInt(participants, 10);
  if (!Number.isInteger(pax) || pax < 1 || pax > 20) errors.push('Jumlah peserta 1–20 orang.');

  if (errors.length) {
    flash('error', errors.join(' '), req);
    return res.redirect(`/paket/${pkg.slug}#booking`);
  }

  const code = helpers.uniqueBookingCode(
    (data.bookings || []).map((b) => b.code),
    BRAND.codePrefix
  );
  const booking = {
    id: db.uid('bkg'),
    code,
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    packageSlug: pkg.slug,
    packageName: pkg.title,
    departureDate,
    participants: pax,
    notes: String(notes || '').trim(),
    status: 'pending',
    packagePrice: Number(pkg.price || 0),
    totalAmount: Number(pkg.price || 0) * pax,
    paymentStatus: 'unpaid',
    paymentMethod: null,
    paymentRef: null,
    paidAt: null,
    createdAt: new Date().toISOString()
  };
  data.bookings.unshift(booking);

  // Sinkronkan tamu ke daftar kontak marketing (opt-in hanya bila dicentang).
  const waConsent = req.body.waConsent === 'on';
  data.contacts = data.contacts || [];
  const phoneKey = String(booking.phone).replace(/[^\d]/g, '');
  const existing = data.contacts.find((c) => String(c.phone).replace(/[^\d]/g, '') === phoneKey);
  if (existing) {
    existing.name = booking.name;
    existing.email = booking.email;
    if (waConsent) existing.optIn = true;
    existing.updatedAt = new Date().toISOString();
  } else {
    data.contacts.unshift({
      id: db.uid('ctc'),
      name: booking.name,
      phone: booking.phone,
      email: booking.email,
      source: 'booking',
      optIn: waConsent,
      optOut: false,
      createdAt: new Date().toISOString()
    });
  }
  db.write();

  flash('success', `Terima kasih! Booking ${code} berhasil dibuat. Langsung selesaikan pembayaran untuk mengunci keberangkatan.`, req);
  res.redirect(`/pembayaran/${code}`);
});

/* ------------------------------------------------------------------ */
/* Artikel                                                             */
/* ------------------------------------------------------------------ */
router.get('/artikel', (req, res) => {
  const data = db.read();
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = published(data.articles);
  if (q) {
    list = list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.excerpt.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }
  res.render('pages/articles', {
    title: 'Artikel & Panduan',
    articles: list,
    q: req.query.q || ''
  });
});

router.get('/artikel/:slug', (req, res, next) => {
  const data = db.read();
  const article = findBySlug(published(data.articles), req.params.slug);
  if (!article) return next();
  const others = published(data.articles)
    .filter((a) => a.id !== article.id)
    .slice(0, 3);
  const s = data.settings || {};
  res.render('pages/article-detail', {
    title: article.title,
    seo: {
      title: article.title,
      description: article.excerpt,
      image: article.coverImage || '',
      type: 'article',
      jsonLd: [seo.article(article, s)]
    },
    article,
    others
  });
});

/* ------------------------------------------------------------------ */
/* Tentang & Kontak                                                    */
/* ------------------------------------------------------------------ */
router.get('/tentang', (req, res) => {
  const data = db.read();
  res.render('pages/about', {
    title: 'Tentang Kami',
    destinationsCount: published(data.destinations).length,
    packagesCount: published(data.packages).length
  });
});

router.get('/kontak', (req, res) => {
  res.render('pages/contact', { title: 'Hubungi Kami' });
});

router.post('/kontak', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  const errors = [];
  if (!name || name.trim().length < 3) errors.push('Nama minimal 3 karakter.');
  if (!helpers.isEmail(email)) errors.push('Format email tidak valid.');
  if (!message || message.trim().length < 10) errors.push('Pesan minimal 10 karakter.');

  if (errors.length) {
    flash('error', errors.join(' '), req);
    return res.redirect('/kontak');
  }

  const data = db.read();
  data.messages.unshift({
    id: db.uid('msg'),
    name: name.trim(),
    email: email.trim(),
    phone: String(phone || '').trim(),
    subject: String(subject || 'Pesan dari website').trim(),
    message: message.trim(),
    read: false,
    createdAt: new Date().toISOString()
  });
  // Pengirim pesan menjadi kontak lead (belum opt-in promo).
  data.contacts = data.contacts || [];
  const msgPhone = String(phone || '').replace(/[^\d]/g, '');
  if (msgPhone && !data.contacts.some((c) => String(c.phone).replace(/[^\d]/g, '') === msgPhone)) {
    data.contacts.unshift({
      id: db.uid('ctc'),
      name: name.trim(),
      phone: String(phone || '').trim(),
      email: email.trim(),
      source: 'kontak',
      optIn: false,
      optOut: false,
      createdAt: new Date().toISOString()
    });
  }
  db.write();
  flash('success', 'Pesan Anda sudah kami terima. Kami akan membalas secepatnya.', req);
  res.redirect('/kontak');
});

/* ------------------------------------------------------------------ */
/* Cari global                                                         */
/* ------------------------------------------------------------------ */
router.get('/cari', (req, res) => {
  const data = db.read();
  const q = String(req.query.q || '').trim();
  const ql = q.toLowerCase();
  const match = (fields) => !ql || fields.some((f) => String(f || '').toLowerCase().includes(ql));
  res.render('pages/search', {
    title: `Cari: ${q || '-'}`,
    q,
    destinations: published(data.destinations).filter((d) => match([d.name, d.region, d.tagline])),
    packages: published(data.packages).filter((p) => match([p.title, p.destinationName, p.summary])),
    articles: published(data.articles).filter((a) => match([a.title, a.excerpt, a.category]))
  });
});

/* ------------------------------------------------------------------ */
/* Login admin (ditangani juga di /admin/login agar konsisten)         */
/* ------------------------------------------------------------------ */
router.get('/admin/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Masuk Admin', layout: false, error: null });
});

router.post('/admin/login', (req, res) => {
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

module.exports = router;