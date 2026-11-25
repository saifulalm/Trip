'use strict';

/**
 * Pipeline pemrosesan gambar.
 *
 * Alur:
 *  1. Validasi tipe file berdasarkan magic byte (bukan sekadar ekstensi/header).
 *  2. Normalisasi orientasi (EXIF rotate), resize ke ukuran slot yang/themesuai rasio.
 *  3. Konversi ke WebP supaya ukuran kecil dan tampilan konsisten.
 *
 * Semua slot mendefinisikan rasio sendiri supaya gambar yang diunggah admin
 * selalu tampil rapi di situs publik (kartuKCARD, hero, OG image, dsb.).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sharp = null;
try {
  // sharp bersifat opsional: bila tidak terpasang, berkas asli tetap disimpan.
  // eslint-disable-next-line global-require
  sharp = require('sharp');
} catch (err) {
  sharp = null;
}

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** Batas ukuran berkas yang diterima (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Definisi slot gambar.
 * width/height adalah batas dimensi terpanjang; rasio dijaga lewat fit: 'cover'.
 */
const SLOTS = {
  // Kartu destinasi & paket: rasio 16/10.
  card: { width: 1280, height: 800, fit: 'cover', label: 'gambar kartu' },
  // Sampul artikel: rasio 16/9.
  article: { width: 1280, height: 720, fit: 'cover', label: 'gambar sampul artikel' },
  // Hero beranda: rasio 16/9, resolusi lebih besar.
  hero: { width: 1920, height: 1080, fit: 'cover', label: 'gambar hero' },
  // Logo: kotak dengan latar transparan, tanpa memotong.
  logo: { width: 512, height: 512, fit: 'contain', label: 'logo' },
  // Open Graph: rasio 1.91/1 sesuai spesifikasi sosmed.
  og: { width: 1200, height: 630, fit: 'cover', label: 'gambar OG' },
  // Bukti transfer: tidak dipotong, hanya dikompresi.
  proof: { width: 1600, height: 1200, fit: 'inside', label: 'bukti transfer' },
  // Media media sosial: rasio 1:1 (feed IG/FB) — tidak dipotong, hanya dikompresi.
  media: { width: 1200, height: 1200, fit: 'inside', label: 'media media sosial' },
  // Foto galeri: slot terpisah, rasio 16/10 seperti kartu.
  gallery: { width: 1280, height: 800, fit: 'cover', label: 'foto galeri' }
};

/**
 * Spesifikasi lengkap tiap slot upload.
 *
 * Ini adalah SATU-SATUNYA sumber kebenaran untuk:
 *  - rasio dan dimensi target,
 *  - batas ukuran berkas maksimum (maxBytes),
 *  - format yang diizinkan (mime),
 *  - dimensi minimum sisi terpendek (minShortSide),
 *  - teks bantuan untuk UI.
 *
 * `SLOTS` (di atas) tetap dipakai `processImage` untuk resize. Kedua
 * tabel harus sinkron — test `scripts/upload-spec.test.js` menjaga itu.
 *
 * GIF sengaja TIDAK diizinkan di slot mana pun: tidak ada satu pun
 * tempat di situs ini yang memutar animasi, dan `processImage` hanya
 * mengambil frame pertama GIF — jadi GIF hanya menambah ukuran berkas
 * tanpa manfaat.
 */
const SLOT_SPECS = {
  card: {
    width: 1280, height: 800, fit: 'cover',
    ratio: [16, 10], maxBytes: 2 * 1024 * 1024, minShortSide: 800,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'gambar kartu',
    hint: 'Rasio 16:10 (1280x800) - JPG, PNG, atau WEBP - maksimal 2 MB'
  },
  article: {
    width: 1280, height: 720, fit: 'cover',
    ratio: [16, 9], maxBytes: 2 * 1024 * 1024, minShortSide: 800,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'gambar sampul artikel',
    hint: 'Rasio 16:9 (1280x720) - JPG, PNG, atau WEBP - maksimal 2 MB'
  },
  hero: {
    width: 1920, height: 1080, fit: 'cover',
    ratio: [16, 9], maxBytes: 4 * 1024 * 1024, minShortSide: 800,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'gambar hero',
    hint: 'Rasio 16:9 (1920x1080) - JPG, PNG, atau WEBP - maksimal 4 MB'
  },
  logo: {
    width: 512, height: 512, fit: 'contain',
    ratio: [1, 1], maxBytes: 500 * 1024, minShortSide: 128,
    mime: ['image/png', 'image/webp'],
    label: 'logo',
    hint: 'Rasio 1:1 (512x512) - PNG atau WEBP - maksimal 500 KB'
  },
  og: {
    width: 1200, height: 630, fit: 'cover',
    ratio: [1200, 630], maxBytes: 1 * 1024 * 1024, minShortSide: 630,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'gambar OG',
    hint: 'Rasio 1200:630 - JPG, PNG, atau WEBP - maksimal 1 MB'
  },
  media: {
    width: 1200, height: 1200, fit: 'inside',
    ratio: [1, 1], maxBytes: 3 * 1024 * 1024, minShortSide: 600,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'media media sosial',
    hint: 'Rasio 1:1 (1200x1200) - JPG, PNG, atau WEBP - maksimal 3 MB'
  },
  proof: {
    width: 1600, height: 1200, fit: 'inside',
    ratio: [4, 3], maxBytes: 8 * 1024 * 1024, minShortSide: 800,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'bukti transfer',
    hint: 'Rasio 4:3 (1600x1200) - JPG, PNG, atau WEBP - maksimal 8 MB'
  },
  gallery: {
    width: 1280, height: 800, fit: 'cover',
    ratio: [16, 10], maxBytes: 2 * 1024 * 1024, minShortSide: 800,
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    label: 'foto galeri',
    hint: 'Rasio 16:10 (1280x800) - JPG, PNG, atau WEBP - maksimal 2 MB'
  }
};

/**
 * Ambil spesifikasi slot, dengan fallback ke `card`.
 * @param {string} slotName kunci slot
 * @returns {object} spesifikasi slot
 */
function getSlotSpec(slotName) {
  return SLOT_SPECS[slotName] || SLOT_SPECS.card;
}

/** Magic byte -> format gambar yang diizinkan. */
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  }
];

/**
 * Deteksi format nyata dari isi berkas.
 * @param {Buffer} buffer isi berkas
 * @returns {{ext: string, mime: string}|null}
 */
function detectFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const found = SIGNATURES.find((s) => s.test(buffer));
  return found ? { ext: found.ext, mime: found.mime } : null;
}

/** Nama berkas acak dengan ekstensi yang benar. */
function buildFilename(ext) {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
}

/**
 * Proses berkas gambar menjadi versi WebP sesuai slot.
 *
 * @param {Buffer} buffer isi berkas
 * @param {string} slotName kunci slot (lihat SLOTS)
 * @returns {Promise<{filename: string, url: string, width: number, height: number, bytes: number}>}
 */
async function processImage(buffer, slotName = 'card') {
  const slot = SLOTS[slotName] || SLOTS.card;
  const format = detectFormat(buffer);
  if (!format) {
    throw new Error('Format file harus JPG, PNG, WEBP, atau GIF.');
  }

  if (!sharp) {
    // Fallback: simpan berkas apa adanya bila sharp tidak tersedia.
    const filename = buildFilename(format.ext);
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    return { filename, url: `/uploads/${filename}`, width: null, height: null, bytes: buffer.length };
  }

  const filename = buildFilename('webp');
  const outPath = path.join(UPLOAD_DIR, filename);

  let pipeline = sharp(buffer, { animated: false }).rotate(); // hormati EXIF orientation
  const isGif = format.ext === 'gif';
  if (isGif) {
    // GIF bisa berupa animasi — ambil frame pertama agar tampilan konsisten.
    pipeline = sharp(buffer, { animated: false });
  }

  const fit = slot.fit || 'cover';
  if (fit === 'inside') {
    pipeline = pipeline.resize({ width: slot.width, height: slot.height, fit: 'inside', withoutEnlargement: true });
  } else if (fit === 'contain') {
    pipeline = pipeline.resize({
      width: slot.width,
      height: slot.height,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true
    });
  } else {
    pipeline = pipeline.resize({ width: slot.width, height: slot.height, fit: 'cover', position: 'attention' });
  }

  // sharp hanya menghasilkan buffer di memori. Bila sharp menulis langsung
  // ke disk (toFile), handle file-nya tertahan di Windows sehingga berkas
  // lama tidak bisa dihapus saat data diganti.
  const output = await pipeline.webp({ quality: 82, effort: 4 }).toBuffer();

  fs.writeFileSync(outPath, output);

  const meta = await sharp(output).metadata();
  return {
    filename,
    url: `/uploads/${filename}`,
    width: meta.width || null,
    height: meta.height || null,
    bytes: output.length
  };
}

/**
 * Deteksi gambar yang secara visual "polos" (solid color / nyaris tanpa detail).
 *
 * Admin sering mengunggah placeholder (kotak merah/kuning pekat) secara
 * tidak sengaja — hasilnya beranda tampil seperti blok warna, bukan foto,
 * dan logo jadi tidak terlihat sama sekali.
 *
 * Ambang: deviasi standar tiap kanal < 3 (skala 0–255) ATAU sebaran antar
 * kanal < 6 → dianggap polos.
 *
 * @param {Buffer} buffer isi berkas gambar
 * @returns {Promise<{blank: boolean, stdev: number[], spread: number}>} hasil deteksi
 */
async function looksBlank(buffer) {
  if (!sharp) return { blank: false, stdev: [], spread: 0 };
  try {
    // Sampel kecil 64×64 cukup untuk mengukur variasi warna dan jauh lebih
    // murah daripada memproses berkas asli yang bisa berukuran besar.
    const result = await sharp(buffer, { animated: false })
      .rotate()
      .resize(64, 64, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = result.data;
    const channels = result.info.channels;
    const pixels = result.info.width * result.info.height;
    const stdev = [];

    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let i = c; i < data.length; i += channels) {
        const v = data[i];
        sum += v;
        sumSq += v * v;
        n += 1;
      }
      const mean = sum / n;
      stdev.push(Math.sqrt(Math.max(0, sumSq / n - mean * mean)));
    }

    const mins = stdev.length ? Math.min.apply(null, stdev) : 255;
    const maxs = stdev.length ? Math.max.apply(null, stdev) : 0;
    const spread = maxs - mins;
    return { blank: mins < 3 || spread < 6, stdev, spread, pixels };
  } catch (err) {
    // Gambar tidak bisa dianalisis → anggap tidak polos (biarkan admin lewat).
    return { blank: false, stdev: [], spread: 0 };
  }
}

/**
 * Deteksi berkas yang seluruhnya transparan (logo tak terlihat).
 *
 * Berbeda dari `looksBlank`, logo yang benar-benar polos satu warna masih
 * sah (mis. logo garis putih). Yang benar-benar rusak adalah logo yang
 * tidak punya satu pun piksel opaque — tampilannya tak terlihat sama sekali.
 *
 * @param {Buffer} buffer isi berkas gambar
 * @returns {Promise<{transparent: boolean, alphaMean: number}>} hasil deteksi
 */
async function looksTransparent(buffer) {
  if (!sharp) return { transparent: false, alphaMean: 1 };
  try {
    const result = await sharp(buffer, { animated: false })
      .rotate()
      .resize(64, 64, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = result.data;
    const channels = result.info.channels;
    let sum = 0;
    let n = 0;
    for (let i = channels - 1; i < data.length; i += channels) {
      sum += data[i];
      n += 1;
    }
    const alphaMean = n ? sum / n / 255 : 1;
    return { transparent: alphaMean < 0.02, alphaMean };
  } catch (err) {
    return { transparent: false, alphaMean: 1 };
  }
}

/**
 * Hapus berkas unggahan dengan protections path traversal.
 * @param {string} filename nama berkas di dalam folder uploads
 */
function removeUpload(filename) {
  if (!filename) return;
  const safe = path.basename(String(filename));
  const full = path.join(UPLOAD_DIR, safe);
  if (full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch (err) {
      console.error('Gagal menghapus berkas unggahan:', err.message);
    }
  }
}

/** Hapus berkas berdasarkan URL publik /uploads/xxx. */
function removeUploadByUrl(url) {
  if (!url || !String(url).startsWith('/uploads/')) return;
  removeUpload(String(url).replace('/uploads/', ''));
}

module.exports = {
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  SLOTS,
  SLOT_SPECS,
  getSlotSpec,
  detectFormat,
  processImage,
  looksBlank,
  looksTransparent,
  removeUpload,
  removeUploadByUrl
};
