'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { rejectCsrf, isCsrfValid } = require('./middleware/security');

// UPLOAD_DIR bisa dioverride lewat environment (dipakai test otomatis).
// Default tetap public/uploads.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Format gambar yang boleh diunggah                                  */
/* ------------------------------------------------------------------ */

/**
 * Peta format gambar → ekstensi & MIME yang sah.
 * Dipakai untuk dua lapis validasi:
 *   1. ekstensi + MIME yang dikirim browser,
 *   2. "magic byte" (signature) isi berkas — inilah yang mencegah
 *      berkas non-gambar (mis. skrip) disamarkan sebagai .jpg.
 */
const IMAGE_FORMATS = {
  jpeg: { exts: ['.jpg', '.jpeg'], mimes: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
  png: { exts: ['.png'], mimes: ['image/png', 'image/x-png'] },
  gif: { exts: ['.gif'], mimes: ['image/gif'] },
  webp: { exts: ['.webp'], mimes: ['image/webp'] }
};

/** Ekstensi → nama format. */
const EXT_TO_FORMAT = {};
for (const [format, def] of Object.entries(IMAGE_FORMATS)) {
  for (const ext of def.exts) EXT_TO_FORMAT[ext] = format;
}

const ALLOWED = new Set(Object.keys(EXT_TO_FORMAT));

/** Batas ukuran berkas: 5 MB. */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Penyimpanan                                                          */
/* ------------------------------------------------------------------ */

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    // Nama berkas dibuat dari timestamp + acak. Ekstensi diambil dari
    // NAMA ASLI yang sudah divalidasi — bukan dari input mentah, dan
    // bukan dari path (mencegah path traversal & nama ber macroscopic).
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED.has(ext) ? ext : '.bin';
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`;
    cb(null, name);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED.has(ext)) {
    const err = new Error('Format file harus JPG, PNG, WEBP, atau GIF.');
    err.code = 'UPLOAD_REJECTED';
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

/* ------------------------------------------------------------------ */
/* Validasi isi berkas (magic byte)                                   */
/* ------------------------------------------------------------------ */

/**
 * Deteksi format gambar dari 12 byte pertama berkas.
 * @returns {'jpeg'|'png'|'gif'|'webp'|null}
 */
function detectImageFormat(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (
    buf.slice(0, 4).toString('latin1') === 'RIFF' &&
    buf.slice(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Periksa satu berkas hasil upload.
 * @returns {string|null} pesan kesalahan, atau null bila berkas sah.
 */
function inspectUpload(file) {
  if (!file || !file.filename) return null;
  const ext = path.extname(file.filename).toLowerCase();
  const expected = EXT_TO_FORMAT[ext];
  if (!expected) return 'Format file harus JPG, PNG, WEBP, atau GIF.';

  // MIME yang diklaim browser harus cocok dengan ekstensinya. Toleransi
  // 'application/octet-stream' karena beberapa browser/klien mengirimnya.
  const mime = String(file.mimetype || '').toLowerCase();
  const mimes = IMAGE_FORMATS[expected].mimes;
  if (mime && mime !== 'application/octet-stream' && !mimes.includes(mime)) {
    return `Tipe file (${mime}) tidak cocok dengan ekstensi ${ext}.`;
  }

  // Magic byte: isi berkas HARUS benar-benar gambar.
  let head;
  try {
    const fd = fs.openSync(file.path, 'r');
    head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
  } catch (err) {
    return 'Berkas gambar tidak dapat dibaca.';
  }
  const actual = detectImageFormat(head);
  if (!actual) {
    return 'Isi berkas bukan gambar yang valid (kemungkinan bukan JPG/PNG/WEBP/GIF).';
  }
  if (actual !== expected) {
    return `Isi berkas bukan ${expected.toUpperCase()} seperti ekstensi ${ext} menyiratkan.`;
  }
  return null;
}

/** Kumpulkan seluruh berkas hasil upload pada satu request. */
function uploadedFiles(req) {
  const list = [];
  if (req.file) list.push(req.file);
  if (req.files) {
    for (const group of Object.values(req.files)) {
      for (const f of group || []) if (f) list.push(f);
    }
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Utilitas berkas                                                    */
/* ------------------------------------------------------------------ */

/**
 * Hapus file yang sudah ter-simpan di disk (dipakai saat request ditolak
 * setelah body ter-parse, supaya file liar tidak tertinggal).
 */
function removeUploadedFiles(req) {
  for (const f of uploadedFiles(req)) {
    if (f && f.filename) removeUpload(f.filename);
  }
}

/**
 * Buang berkas upload pada request ini (dipanggil route ketika validasi
 * form gagal SETELAH berkas sempat tersimpan — mencegah file orphan).
 */
function discardUpload(req) {
  removeUploadedFiles(req);
}

/**
 * Hapus satu file di dalam upload dir.
 * `path.basename` + perbandingan prefix memastikan nama seperti
 * "../../etc/passwd" tidak pernah keluar dari upload dir.
 */
function removeUpload(filename) {
  if (!filename) return;
  const safe = path.basename(String(filename));
  const full = path.join(UPLOAD_DIR, safe);
  if (full.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch (err) {
      /* abaikan — file mungkin sudah dihapus */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Wrapper upload + CSRF + validasi isi                               */
/* ------------------------------------------------------------------ */

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

      // Lapis kedua: pastikan isi berkas benar-benar gambar. Berkas yang
      // menyamar (mis. skrip bernama .jpg) langsung dihapus dari disk.
      for (const file of uploadedFiles(req)) {
        const problem = inspectUpload(file);
        if (problem) {
          removeUploadedFiles(req);
          const err = new Error(problem);
          err.code = 'UPLOAD_REJECTED';
          return next(err);
        }
      }
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

module.exports = {
  upload: secureUpload,
  removeUpload,
  discardUpload,
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ALLOWED_EXTENSIONS: [...ALLOWED],
  detectImageFormat
};