'use strict';

const crypto = require('crypto');
const db = require('../db');
const helpers = require('../utils/helpers');
const seo = require('../seo');
const BRAND = require('../brand');

/** Menyediakan data global (settings, flash, csrf) untuk semua template. */
function context(req, res, next) {
  const data = db.read() || {};
  res.locals.settings = data.settings || {};
  res.locals.brand = BRAND;
  // Pemecahan nama brand untuk logo dua warna (lead + aksen).
  res.locals.brandParts = BRAND.parts();
  const uid = req.session && req.session.userId;
  res.locals.currentUser = uid ? (data.users || []).find((u) => u.id === uid) || null : null;
  // Default agar layout publik selalu bisa dirender, termasuk halaman error
  // yang digambar sebelum attachCustomer sempat berjalan.
  res.locals.currentCustomer = null;

  res.locals.formatRupiah = helpers.formatRupiah;
  res.locals.formatDateLong = helpers.formatDateLong;
  res.locals.formatDateShort = helpers.formatDateShort;
  res.locals.initials = helpers.initials;
  res.locals.excerpt = helpers.excerpt;
  res.locals.renderRichText = helpers.renderRichText;
  res.locals.bookingStatusLabel = helpers.bookingStatusLabel;
  res.locals.bookingStatusTone = helpers.bookingStatusTone;
  res.locals.paymentStatusLabel = helpers.paymentStatusLabel;
  res.locals.paymentStatusTone = helpers.paymentStatusTone;
  res.locals.starRating = helpers.starRating;
  res.locals.formatCoord = helpers.formatCoord;
  res.locals.publicationStatusLabel = helpers.publicationStatusLabel;
  res.locals.publicationStatusTone = helpers.publicationStatusTone;
  // URL absolut: pakai siteUrl dari Pengaturan, atau fallback ke host request (dev).
  const baseSettings = { ...res.locals.settings, siteUrl: res.locals.settings.siteUrl || `http://${req.get('host')}` };
  res.locals.absoluteUrl = (p) => seo.absoluteUrl(baseSettings, p);
  res.locals.canonicalBase = baseSettings;

  res.locals.currentPath = req.path;
  // Path absolut (tidak diubah oleh router) untuk membangun URL sorting.
  res.locals.currentFullPath = String(req.originalUrl || req.url || '/').split('?')[0];
  // Helper URL sorting: mempertahankan q & status, hanya membalik sort/dir.
  res.locals.sortUrl = (field) => {
    const s = res.locals.sort || {};
    const dir = s.sort === field && s.dir === 'asc' ? 'desc' : 'asc';
    const params = new URLSearchParams();
    const q = req.query || {};
    if (q.q) params.set('q', q.q);
    if (q.status) params.set('status', q.status);
    params.set('sort', field);
    params.set('dir', dir);
    return res.locals.currentFullPath + '?' + params.toString();
  };
  res.locals.query = req.query || {};
  res.locals.year = new Date().getFullYear();

  // Meta SEO per halaman (route dapat menimpa melalui res.locals.seo = {...}).
  const s = res.locals.settings;
  res.locals.seo = {
    title: null, // null => pakai `title` biasa
    description: s.seoDescription || s.tagline || '',
    image: s.ogImageUrl || s.heroImageUrl || '',
    type: 'website',
    jsonLd: []
  };

  if (req.session) {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
    res.locals.csrfToken = req.session.csrf;
    res.locals.flash = req.session.flash || [];
    delete req.session.flash;
  } else {
    res.locals.csrfToken = '';
    res.locals.flash = [];
  }
  next();
}

/** Menyimpan pesan flash untuk ditampilkan pada request berikutnya. */
function flash(type, message, req) {
  if (!req.session) return;
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, message });
}

module.exports = { context, flash };