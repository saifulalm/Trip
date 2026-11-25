'use strict';

/**
 * Middleware unggah gambar berbasis slot.
 *
 * Memakai memoryStorage supaya isi berkas bisa diperiksa magic byte-nya,
 * lalu diproses oleh service image (resize + WebP) sebelum disimpan.
 * Nama field pada tiap form menentukan slot tujuan:
 *   imageFile -> card, logoFile -> logo, heroFile -> hero, ogFile -> og,
 *   mediaFile -> media, proof -> proof, galleryFiles -> gallery
 *
 * Batas ukuran, format yang diizinkan, dan dimensi minimum per slot
 * diambil dari `SLOT_SPECS` di `src/services/image.js` (sumber kebenaran
 * tunggal). Batas mutlak di level multer hanya `ABSOLUTE_MAX_FILE_SIZE`.
 */

const multer = require('multer');
const crypto = require('crypto');
const {
  detectFormat,
  processImage,
  looksBlank,
  looksTransparent,
  getSlotSpec,
  removeUpload: removeUploadByFilename
} = require('../services/image');

/**
 * Pemetaan nama field form ke slot gambar.
 *
 * Slot menentukan rasio, batas ukuran, format, dan dimensi minimum.
 * Perhatikan: `imageFile` dipakai untuk beberapa jenis konten, dan
 * pemanggil middleware boleh menimpanya dengan slot eksplisit
 * (lihat `singleImage(field, slot)`).
 */
const SLOT_BY_FIELD = {
  imageFile: 'card',
  logoFile: 'logo',
  heroFile: 'hero',
  ogFile: 'og',
  mediaFile: 'media',
  proof: 'proof',
  galleryFiles: 'gallery'
};

/**
 * Batas jumlah berkas per satu request multipart.
 *
 * Form Destinasi mengirim 1 gambar utama + galeri. Widget galeri
 * mengizinkan 8 foto, jadi totalnya 9 berkas. Nilai ini harus lebih
 * longgar dari total maksimum form, kalau tidak multer melempar
 * LIMIT_FILE_COUNT dan seluruh unggahan ditolak dengan galat 500.
 */
const MAX_FILES = 12;

/**
 * Batas ukuran mutlak (top-level) untuk satu berkas.
 *
 * Batas per-slot (lebih kecil) diterapkan di `validateBuffer`.
 * Nilai ini hanya menangkap kondisi "bom" sebelum diproses.
 * Harus >= maxBytes slot terbesar (`proof` = 8 MB), kalau tidak berkas
 * bukti transfer yang sah ditolak oleh multer sebelum sempat divalidasi.
 */
const ABSOLUTE_MAX_FILE_SIZE = 8 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ABSOLUTE_MAX_FILE_SIZE, files: MAX_FILES }
});

/** Pesan error standar agar seragam di seluruh aplikasi. */
const ERR_FORMAT = 'Format file harus JPG, PNG, WEBP, atau GIF.';

/** Perbandingan string resistant timing attack. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verifikasi token CSRF SETELAH body multipart selesai diurai.
 * Middleware verifyCsrf global melompati request multipart karena body-nya
 * belum terurai pada saat itu; pengecekan dilakukan di sini.
 */
function verifyCsrfAfterParse(req, res, next) {
  const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (!req.session || !safeEqual(token, req.session.csrf)) {
    const err = new Error('Token keamanan tidak valid atau kedaluwarsa. Silakan muat ulang halaman dan coba lagi.');
    err.code = 'INVALID_CSRF';
    err.status = 403;
    return next(err);
  }
  return next();
}

/**
 * Format ukuran berkas agar enak dibaca (500 KB / 2 MB).
 * @param {number} bytes ukuran dalam byte
 * @returns {string} teks ukuran
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  const mb = bytes / (1024 * 1024);
  return (Math.round(mb * 10) / 10) + ' MB';
}

/**
 * Pesan error batas ukuran yang bergantung slot.
 * @param {string} [slotName] nama slot
 * @returns {string} pesan error
 */
function errSize(slotName) {
  const spec = getSlotSpec(slotName);
  return 'Ukuran ' + spec.label + ' maksimal ' + formatBytes(spec.maxBytes) + '.';
}

/**
 * Validasi berkas yang sudah diterima multer.
 *
 * URUTAN PEMERIKSAAN (penting):
 *  1. batas ukuran — menolak file besar lebih murah daripada memprosesnya;
 *  2. deteksi format (magic byte);
 *  3. format diizinkan untuk slot ini;
 *  4. guard visual hero polos;
 *  5. guard visual logo transparan.
 *
 * Dimensi minimum (`spec.minShortSide`) dicek di sisi klien (Task 4),
 * karena di server berkas sudah diterima utuh oleh multer dan membacanya
 * hanya menambah biaya tanpa mencegah masalah yang sama.
 *
 * @param {object} file berkas dari multer (butuh `buffer` dan `originalname`)
 * @param {string} [field] nama field form — dipakai untuk aturan spesifik
 * @param {string} [slotName] slot tujuan; bila kosong, diturunkan dari nama field
 * @returns {Promise<{ext: string, mime: string}>} format berkas
 */
async function validateBuffer(file, field, slotName) {
  const slot = slotName || SLOT_BY_FIELD[field] || 'card';
  const spec = getSlotSpec(slot);

  // 1. Batas ukuran per-slot (lebih ketat daripada batas mutlak).
  if (file.buffer.length > spec.maxBytes) {
    const err = new Error(errSize(slot));
    err.code = 'LIMIT_FILE_SIZE';
    throw err;
  }

  // 2. Format nyata dari magic byte (bukan dari ekstensi/header browser).
  const format = detectFormat(file.buffer);
  if (!format) {
    const err = new Error(ERR_FORMAT);
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  // 3. Format harus diizinkan untuk slot ini (mis. logo: PNG/WEBP saja).
  if (!spec.mime.includes(format.mime)) {
    const allowed = spec.mime.map((m) => m.replace('image/', '').toUpperCase()).join(', ');
    const err = new Error(
      'Format ' + format.mime.replace('image/', '').toUpperCase() +
      ' tidak diizinkan untuk ' + spec.label + '. Gunakan ' + allowed + '.'
    );
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  // 4. Gambar polos (solid color tanpa detail) ditolak khusus untuk hero.
  // Alasannya: admin yang mengunggah kotak merah/pekat biasanya salah pilih,
  // dan hasilnya beranda tampil seperti blok warna, bukan foto.
  if (field === 'heroFile' || slot === 'hero') {
    const blank = await looksBlank(file.buffer);
    if (blank.blank) {
      const err = new Error(
        'Gambar hero terlalu polos (tanpa detail). Unggah foto yang jelas, atau biarkan kosong untuk memakai video bawaan.'
      );
      err.code = 'BLANK_IMAGE';
      throw err;
    }
  }

  // 5. Logo yang seluruhnya transparan = tak terlihat sama sekali di header,
  // footer, splash, dan favicon. Logo polos satu warna masih sah.
  if (field === 'logoFile' || slot === 'logo') {
    const tr = await looksTransparent(file.buffer);
    if (tr.transparent) {
      const err = new Error(
        'Logo yang diunggah tidak terlihat (sepenuhnya transparan). Unggah logo yang jelas, atau biarkan kosong untuk memakai logo bawaan.'
      );
      err.code = 'BLANK_IMAGE';
      throw err;
    }
  }

  return format;
}

/**
 * Buat middleware yang memproses satu field berkas menjadi slot tertentu.
 * Hasil akhir tersedia di req.processedImages.<field>.
 *
 * @param {string} field nama field form
 * @param {string} slot slot tujuan (lihat image.SLOTS)
 */
function singleImage(field, slot) {
  return [
    upload.single(field),
    verifyCsrfAfterParse,
    async (req, res, next) => {
      try {
        req.processedImages = req.processedImages || {};
        if (!req.file) return next();
        await validateBuffer(req.file, field, slot);
        const result = await processImage(req.file.buffer, slot);
        req.processedImages[field] = result;
        // Simpan juga di req.file agar route lama tetap kompatibel.
        req.file.filename = result.filename;
        req.file.path = result.url;
        return next();
      } catch (err) {
        return next(err);
      }
    }
  ];
}

/**
 * Buat middleware untuk beberapa field berkas sekaligus.
 * @param {Array<{name: string, slot: string}>} fields daftar field + slot
 */
function multiImage(fields) {
  const multerFields = fields.map((f) => ({ name: f.name, maxCount: 1 }));
  return [
    upload.fields(multerFields),
    verifyCsrfAfterParse,
    async (req, res, next) => {
      try {
        req.processedImages = req.processedImages || {};
        for (const f of fields) {
          const list = req.files && req.files[f.name];
          if (!list || !list[0]) continue;
          await validateBuffer(list[0], f.name, f.slot);
          const result = await processImage(list[0].buffer, f.slot);
          req.processedImages[f.name] = result;
          list[0].filename = result.filename;
          list[0].path = result.url;
        }
        return next();
      } catch (err) {
        return next(err);
      }
    }
  ];
}

/**
 * Buat middleware untuk mengunggah BANYAK berkas pada satu field
 * (mis. galeri destinations: "galleryFiles").
 *
 * Hasil akhir tersedia di req.processedImages[field] sebagai array of
 * { filename, url, width, height, bytes }. Bila tidak ada berkas yang
 * diunggah, req.processedImages[field] menjadi array kosong.
 *
 * CATATAN: middleware ini TIDAK boleh digabung dengan singleImage/multiImage
 * pada route yang sama — dua instance multer akan saling berebut stream
 * multipart yang sama dan melempar "Unexpected file field". Gunakan
 * imageFields() bila satu form punya beberapa field berkas.
 *
 * @param {string} field nama field form
 * @param {string} slot slot tujuan (lihat image.SLOTS)
 * @param {number} maxCount jumlah maksimal berkas
 */
function galleryImages(field, slot, maxCount = 8) {
  return [
    upload.fields([{ name: field, maxCount }]),
    verifyCsrfAfterParse,
    async (req, res, next) => {
      try {
        req.processedImages = req.processedImages || {};
        const list = (req.files && req.files[field]) || [];
        const results = [];
        for (const file of list) {
          await validateBuffer(file, field, slot);
          const result = await processImage(file.buffer, slot);
          results.push(result);
          file.filename = result.filename;
          file.path = result.url;
        }
        req.processedImages[field] = results;
        return next();
      } catch (err) {
        return next(err);
      }
    }
  ];
}

/**
 * Buat middleware yang memproses beberapa field berkas DALAM SATU lintasan
 * multipart (satu instance multer).
 *
 * Ini varian dari multiImage() yang mendukung jumlah berkas berbeda per
 * field — dipakai untuk form yang punya gambar utama sekaligus galeri.
 *
 * @param {Array<{name: string, slot: string, maxCount?: number}>} fields daftar field
 */
function imageFields(fields) {
  const multerFields = fields.map((f) => ({ name: f.name, maxCount: f.maxCount || 1 }));
  return [
    upload.fields(multerFields),
    verifyCsrfAfterParse,
    async (req, res, next) => {
      try {
        req.processedImages = req.processedImages || {};
        for (const f of fields) {
          const list = (req.files && req.files[f.name]) || [];
          const results = [];
          for (const file of list) {
            await validateBuffer(file, f.name, f.slot);
            const result = await processImage(file.buffer, f.slot);
            results.push(result);
            file.filename = result.filename;
            file.path = result.url;
          }
          // Field tunggal → objek; field galeri → array. Ini dibedakan oleh
          // maxCount pada spesifikasi field.
          req.processedImages[f.name] = (f.maxCount || 1) > 1 ? results : results[0] || null;
        }
        return next();
      } catch (err) {
        return next(err);
      }
    }
  ];
}

/**
 * Hapus berkas gambar yang baru diproses tetapi akhirnya tidak dipakai.
 *
 * Middleware upload memproses gambar sebelum handler route memvalidasi
 * isi form. Bila validasi gagal, berkas hasil proses menjadi yatim di
 * folder uploads. Fungsi ini dipakai route untuk membersihkan berkas
 * tersebut saat form ditolak.
 *
 * @param {object} req request Express
 */
function cleanupUploads(req) {
  const processed = (req && req.processedImages) || {};
  for (const field of Object.keys(processed)) {
    const result = processed[field];
    // Galeri menghasilkan array of result; field biasa menghasilkan object.
    const list = Array.isArray(result) ? result : [result];
    for (const item of list) {
      if (item && item.filename) removeUploadByFilename(item.filename);
    }
  }
}

module.exports = {
  upload,
  singleImage,
  multiImage,
  galleryImages,
  imageFields,
  verifyCsrfAfterParse,
  cleanupUploads,
  SLOT_BY_FIELD,
  ABSOLUTE_MAX_FILE_SIZE,
  ERR_FORMAT,
  validateBuffer,
  formatBytes,
  errSize
};
