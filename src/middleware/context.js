'use strict';

const crypto = require('crypto');
const db = require('../db');
const helpers = require('../utils/helpers');
const seo = require('../seo');

/** Menyediakan data global (settings, flash, csrf) untuk semua template. */
function context(req, res, next) {
  const data = db.read() || {};
  res.locals.settings = data.settings || {};
  const uid = req.session && req.session.userId;
  res.locals.currentUser = uid ? (data.users || []).find((u) => u.id === uid) || null : null;

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