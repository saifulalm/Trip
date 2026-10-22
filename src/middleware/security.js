'use strict';

const crypto = require('crypto');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Verifikasi token CSRF sederhana berbasis session untuk semua request non-GET. */
function verifyCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  // Webhook payment gateway bersifat server-to-server tanpa sesi —
  // keamanannya dijamin verifikasi signature masing-masing gateway.
  if (req.path.startsWith('/payment/webhook/')) return next();
  const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (!req.session || !safeEqual(token, req.session.csrf)) {
    return res.status(403).render('pages/error', {
      title: 'Permintaan Ditolak',
      status: 403,
      message: 'Token keamanan tidak valid atau kedaluwarsa. Silakan muat ulang halaman dan coba lagi.',
      layout: 'layouts/public'
    });
  }
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

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/admin/login');
  }
  next();
}

module.exports = { verifyCsrf, loginLimiter, requireLogin, safeEqual };