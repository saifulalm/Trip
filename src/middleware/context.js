'use strict';

const crypto = require('crypto');
const db = require('../db');
const helpers = require('../utils/helpers');
const seo = require('../seo');
const themeService = require('../services/theme');
const brandService = require('../services/brand');
const onepageService = require('../services/onepage');

/** Menyediakan data global (settings, flash, csrf) untuk semua template. */
function context(req, res, next) {
  const data = db.read() || {};
  res.locals.settings = data.settings || {};

  // Brand: nama aktif + wordmark (tanpa suffix domain).
  res.locals.brandName = brandService.brandName(res.locals.settings);
  res.locals.brandWordmark = brandService.brandWordmark(res.locals.settings);
  const bp = brandService.brandParts(res.locals.settings);
  res.locals.brandHead = bp.head;
  res.locals.brandTail = bp.tail;
  res.locals.brandAccentFrom = bp.accentFrom;

  // Tema: mode terang/gelap + warna aksen yang bisa diatur admin.
  const theme = themeService.resolveTheme(res.locals.settings);
  res.locals.theme = theme;
  res.locals.themeMode = theme.mode;
  res.locals.themeStyle = themeService.themeStyle(theme);

  const uid = req.session && req.session.userId;
  res.locals.currentUser = uid ? (data.users || []).find((u) => u.id === uid) || null : null;

  // Pelanggan default-nya null supaya template publik aman dirender
  // meskipun middleware customer belum sempat berjalan (mis. halaman error).
  if (typeof res.locals.currentCustomer === 'undefined') res.locals.currentCustomer = null;

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
  res.locals.publicationStatusLabel = helpers.publicationStatusLabel;
  res.locals.publicationStatusTone = helpers.publicationStatusTone;
  // URL absolut: pakai siteUrl dari Pengaturan, atau fallback ke host request (dev).
  const baseSettings = { ...res.locals.settings, siteUrl: res.locals.settings.siteUrl || `http://${req.get('host')}` };
  res.locals.absoluteUrl = (p) => seo.absoluteUrl(baseSettings, p);
  res.locals.canonicalBase = baseSettings;

  res.locals.currentPath = req.path;
  // Onepage (halaman beranda): daftar section untuk nav anchor & rail.
  res.locals.onepageNavSections = onepageService.navSections();
  res.locals.onepageRailSections = onepageService.railSections();
  // Mode onepage aktif hanya di beranda — halaman lain tetap nav route biasa.
  res.locals.isOnepage = req.path === '/';
  // Tautan profil media sosial untuk footer situs publik.
  // Disumberkan dari registry platform (src/services/social.js) agar
  // daftar tautan di footer dan structured data SEO selalu konsisten.
  res.locals.socialProfileLinks = require('../services/social').profileLinks(res.locals.settings);
  // Path relatif terhadap /admin untuk template admin (menandai menu aktif).
  // req.path di level app sudah memuat prefix /admin.
  res.locals.adminPath = req.path.startsWith('/admin')
    ? (req.path.slice('/admin'.length) || '/')
    : req.path;
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