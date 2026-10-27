'use strict';

const crypto = require('crypto');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Ambil token CSRF dari body (form), query string, atau header. */
function csrfTokenFrom(req) {
  return (
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    req.headers['x-csrf-token']
  );
}

/** True bila token yang dikirim cocok dengan token pada sesi ini. */
function isCsrfValid(req) {
  if (!req.session || !req.session.csrf) return false;
  return safeEqual(csrfTokenFrom(req), req.session.csrf);
}

/** Halaman 403 untuk token CSRF yang tidak valid. */
function rejectCsrf(res) {
  return res.status(403).render('pages/error', {
    title: 'Permintaan Ditolak',
    status: 403,
    message: 'Token keamanan tidak valid atau kedaluwarsa. Silakan muat ulang halaman dan coba lagi.',
    layout: 'layouts/public'
  });
}

/** Verifikasi token CSRF sederhana berbasis session untuk semua request non-GET. */
function verifyCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  // Webhook payment gateway bersifat server-to-server tanpa sesi —
  // keamanannya dijamin verifikasi signature masing-masing gateway.
  if (req.path.startsWith('/payment/webhook/')) return next();
  // multipart/form-data: req.body BELUM ter-parse saat middleware global ini
  // berjalan (body baru terurai setelah multer). Verifikasi ditunda ke
  // wrapper upload di src/multer.js — kalau tidak, setiap upload 403.
  if (req.is('multipart/form-data')) {
    req.csrfDeferred = true;
    return next();
  }
  if (!isCsrfValid(req)) {
    return rejectCsrf(res);
  }
  req.csrfVerified = true;
  next();
}

/** Proteksi brute-force sederhana untuk form login. */
function loginLimiter(maxAttempts = 5, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    if (entry.count >= maxAttempts) {
      const waitMin = Math.ceil((entry.resetAt - now) / 60000);
      return res.status(429).render('admin/login', {
        title: 'Masuk Admin',
        layout: false,
        error: `Terlalu banyak percobaan. Coba lagi dalam ± ${waitMin} menit.`
      });
    }
    entry.count += 1;
    // Bersihkan map agar tidak tumbuh tanpa batas.
    if (hits.size > 500) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    next();
  };
}

/**
 * Rate limit serbaguna per IP (anti spam / abuse).
 * Membalas dengan flash + redirect ke halaman sebelumnya.
 */
function rateLimit(options = {}) {
  const max = options.max || 10;
  const windowMs = options.windowMs || 10 * 60 * 1000;
  const message = options.message || 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.';
  const hits = new Map();
  return function limiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message });
      }
      return res.redirect(req.get('Referrer') || '/');
    }
    if (hits.size > 500) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    next();
  };
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/admin/login');
  }
  next();
}

module.exports = {
  verifyCsrf,
  rejectCsrf,
  loginLimiter,
  rateLimit,
  requireLogin,
  safeEqual,
  csrfTokenFrom,
  isCsrfValid
};
