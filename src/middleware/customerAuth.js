'use strict';

const db = require('../db');

function attachCustomer(req, res, next) {
  res.locals.currentCustomer = null;
  const cid = req.session && req.session.customerId;
  if (cid) {
    const data = db.read();
    const customer = (data.customers || []).find((c) => c.id === cid);
    if (customer) {
      req.customer = customer;
      res.locals.currentCustomer = customer;
    } else {
      delete req.session.customerId;
    }
  }
  next();
}

function requireCustomer(req, res, next) {
  if (!req.session || !req.session.customerId) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/akun');
    return res.redirect(`/masuk?next=${nextUrl}`);
  }
  next();
}

// Rate-limit sederhana untuk login pelanggan (anti brute-force).
const loginAttempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function customerLoginLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    loginAttempts.set(ip, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    req.session.flash = {
      type: 'error',
      message: 'Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.'
    };
    return res.redirect('/masuk');
  }
  next();
}

function clearCustomerLoginAttempts(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  loginAttempts.delete(ip);
}

module.exports = { attachCustomer, requireCustomer, customerLoginLimiter, clearCustomerLoginAttempts };