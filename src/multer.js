'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { rejectCsrf, isCsrfValid } = require('./middleware/security');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return cb(new Error('Format file harus JPG, PNG, WEBP, atau GIF.'));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Hapus file yang sudah ter-simpan di disk (dipakai saat request ditolak
 * setelah body ter-parse, supaya file liar tidak tertinggal).
 */
function removeUploadedFiles(req) {
  const names = [];
  if (req.file && req.file.filename) names.push(req.file.filename);
  if (req.files) {
    for (const list of Object.values(req.files)) {
      for (const f of list || []) if (f && f.filename) names.push(f.filename);
    }
  }
  names.forEach(removeUpload);
}

/**
 * Bungkus middleware multer agar verifikasi CSRF berjalan SETELAH body
 * ter-parse.
 *
 * Kenapa perlu: middleware CSRF global berjalan sebelum router, sedangkan
 * req.body untuk multipart/form-data baru terisi setelah multer selesai.
 * Akibatnya setiap upload (logo, gambar cover, bukti transfer) kena 403
 * walaupun form-nya sudah membawa token yang benar.
 *
 * Semua middleware upload di src/routes/*.js memakai instance `upload`
 * di bawah, jadi satu titik ini menutup semua route upload.
 */
function wrapCsrf(middleware) {
  return function uploadWithCsrf(req, res, next) {
    middleware(req, res, (err) => {
      if (err) return next(err);
      if (!isCsrfValid(req)) {
        // Token tidak valid → buang file yang terlanjur tersimpan, lalu
        // balas 403 dengan halaman error yang rapi.
        removeUploadedFiles(req);
        return rejectCsrf(res);
      }
      req.csrfVerified = true;
      next();
    });
  };
}

/**
 * Instance upload yang selalu memverifikasi CSRF setelah body ter-parse.
 * Pemakaian di route tetap sama: upload.single('imageFile'), dll.
 */
const secureUpload = {
  single: (field) => wrapCsrf(upload.single(field)),
  array: (field, maxCount) => wrapCsrf(upload.array(field, maxCount)),
  fields: (fields) => wrapCsrf(upload.fields(fields)),
  any: () => wrapCsrf(upload.any()),
  none: () => wrapCsrf(upload.none())
};

function removeUpload(filename) {
  if (!filename) return;
  const safe = path.basename(filename);
  const full = path.join(UPLOAD_DIR, safe);
  if (full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
}

module.exports = { upload: secureUpload, removeUpload, UPLOAD_DIR };