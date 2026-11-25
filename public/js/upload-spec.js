'use strict';

/**
 * Spesifikasi slot upload untuk sisi klien.
 *
 * TUJUAN
 * ------
 * Admin harus tahu SYARAT gambar SEBELUM mengunggah, bukan setelah
 * berkas ditolak server. Modul ini menyediakan:
 *  - batas ukuran, format, rasio, dan dimensi minimum per slot,
 *  - fungsi validasi berkas sebelum diunggah,
 *  - teks helper yang bisa disisipkan ke UI.
 *
 * PENTING — SINKRONISASI
 * ----------------------
 * Isi `SLOT_SPECS` di bawah adalah SALINAN dari `SLOT_SPECS` di
 * `src/services/image.js`. Repo ini tidak punya build step, jadi
 * kedua sisi harus disalin manual. Test
 * `scripts/upload-spec.test.js` memaksa keduanya tetap sama —
 * kalau test itu gagal, salin ulang nilai dari server.
 *
 * CATATAN GAYA
 * ------------
 * Nama slot ditulis dengan tanda kutip ganda dan blok `SLOT_SPECS`
 * sengaja dibuat valid JSON (tanpa komentar di dalamnya), supaya
 * test sinkronisasi bisa membacanya sebagai JSON tanpa menjalankan
 * kode browser. Jangan menambahkan komentar di dalam blok itu —
 * test akan gagal parses.
 */
(function (global) {
  const SLOT_SPECS = {
    "card": {
      "width": 1280, "height": 800, "fit": "cover",
      "ratio": [16, 10], "maxBytes": 2 * 1024 * 1024, "minShortSide": 800,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "gambar kartu",
      "hint": "Rasio 16:10 (1280x800) - JPG, PNG, atau WEBP - maksimal 2 MB"
    },
    "article": {
      "width": 1280, "height": 720, "fit": "cover",
      "ratio": [16, 9], "maxBytes": 2 * 1024 * 1024, "minShortSide": 800,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "gambar sampul artikel",
      "hint": "Rasio 16:9 (1280x720) - JPG, PNG, atau WEBP - maksimal 2 MB"
    },
    "hero": {
      "width": 1920, "height": 1080, "fit": "cover",
      "ratio": [16, 9], "maxBytes": 4 * 1024 * 1024, "minShortSide": 800,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "gambar hero",
      "hint": "Rasio 16:9 (1920x1080) - JPG, PNG, atau WEBP - maksimal 4 MB"
    },
    "logo": {
      "width": 512, "height": 512, "fit": "contain",
      "ratio": [1, 1], "maxBytes": 500 * 1024, "minShortSide": 128,
      "mime": ["image/png", "image/webp"],
      "label": "logo",
      "hint": "Rasio 1:1 (512x512) - PNG atau WEBP - maksimal 500 KB"
    },
    "og": {
      "width": 1200, "height": 630, "fit": "cover",
      "ratio": [1200, 630], "maxBytes": 1 * 1024 * 1024, "minShortSide": 630,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "gambar OG",
      "hint": "Rasio 1200:630 - JPG, PNG, atau WEBP - maksimal 1 MB"
    },
    "media": {
      "width": 1200, "height": 1200, "fit": "inside",
      "ratio": [1, 1], "maxBytes": 3 * 1024 * 1024, "minShortSide": 600,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "media media sosial",
      "hint": "Rasio 1:1 (1200x1200) - JPG, PNG, atau WEBP - maksimal 3 MB"
    },
    "proof": {
      "width": 1600, "height": 1200, "fit": "inside",
      "ratio": [4, 3], "maxBytes": 8 * 1024 * 1024, "minShortSide": 800,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "bukti transfer",
      "hint": "Rasio 4:3 (1600x1200) - JPG, PNG, atau WEBP - maksimal 8 MB"
    },
    "gallery": {
      "width": 1280, "height": 800, "fit": "cover",
      "ratio": [16, 10], "maxBytes": 2 * 1024 * 1024, "minShortSide": 800,
      "mime": ["image/jpeg", "image/png", "image/webp"],
      "label": "foto galeri",
      "hint": "Rasio 16:10 (1280x800) - JPG, PNG, atau WEBP - maksimal 2 MB"
    }
  };

  /**
   * Ambil spesifikasi slot, fallback ke `card`.
   *
   * Nama slot bisa berasal dari input pengguna, jadi pengecekan memakai
   * `hasOwnProperty` — bukan `||` biasa. Tanpa itu, kunci prototype seperti
   * `constructor` atau `toString` akan mengembalikan objek non-spec (fungsi)
   * dan merusak validasi di pemanggil. Ini meniru `getSlotSpec()` di server.
   *
   * @param {string} slotName kunci slot
   * @returns {object} spesifikasi slot
   */
  function get(slotName) {
    return Object.prototype.hasOwnProperty.call(SLOT_SPECS, slotName)
      ? SLOT_SPECS[slotName]
      : SLOT_SPECS.card;
  }

  /**
   * Format ukuran berkas agar enak dibaca.
   *
   * @param {number} bytes ukuran dalam byte
   * @returns {string} teks ukuran, mis. "500 KB"
   */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    const mb = bytes / (1024 * 1024);
    return (Math.round(mb * 10) / 10) + ' MB';
  }

  /**
   * Rasio yang diizinkan (tanpa toleransi) sebagai pembagi.
   *
   * @param {object} spec spesifikasi slot
   * @returns {number} rasio lebar/tinggi ideal
   */
  function targetRatio(spec) {
    return spec.ratio[0] / spec.ratio[1];
  }

  /**
   * Cek seberapa jauh rasio berkas menyimpang dari rasio target.
   *
   * @param {object} file berkas (punya properti width/height)
   * @param {object} spec spesifikasi slot
   * @returns {number} selisih relatif (0 = persis sama)
   */
  function ratioDeviation(file, spec) {
    if (!file || !file.width || !file.height) return 0;
    const actual = file.width / file.height;
    const target = targetRatio(spec);
    return Math.abs(actual - target) / target;
  }

  /**
   * Validasi berkas sebelum diunggah.
   *
   * Aturan harus sama dengan server (`src/middleware/upload.js`):
   *  1. MIME harus di dalam daftar yang diizinkan → tolak.
   *  2. Ukuran tidak boleh melebihi `maxBytes` → tolak.
   *  3. Sisi terpendek tidak boleh kurang dari `minShortSide` → tolak.
   *  4. Rasio menyimpang lebih dari 10% → PERINGATAN saja (bukan tolak),
   *     karena foto HP sering tidak persis dan `fit: 'cover'` memotong otomatis.
   *
   * @param {File} file berkas dari input file
   * @param {string} slotName slot tujuan
   * @returns {{ok: boolean, error: string|null, warning: string|null}}
   */
  function validate(file, slotName) {
    const spec = get(slotName);

    if (!file) return { ok: false, error: 'Berkas tidak valid.', warning: null };

    if (spec.mime.indexOf(file.type) === -1) {
      const allowed = spec.mime.map(function (m) {
        return m.replace('image/', '').toUpperCase();
      }).join(', ');
      return {
        ok: false,
        error: 'Format harus ' + allowed + '.',
        warning: null
      };
    }

    if (file.size > spec.maxBytes) {
      return {
        ok: false,
        error: 'Ukuran maksimal ' + formatBytes(spec.maxBytes) +
          ' (berkasan ' + formatBytes(file.size) + ').',
        warning: null
      };
    }

    // Dimensi minimum — gambar kecil akan pecah saat di-crop.
    if (file.width && file.height) {
      const short = Math.min(file.width, file.height);
      if (short < spec.minShortSide) {
        return {
          ok: false,
          error: 'Resolusi terlalu kecil (' + file.width + '×' + file.height +
            '). Minimal sisi terpendek ' + spec.minShortSide + ' px.',
          warning: null
        };
      }

      // Rasio menyimpang jauh → peringatan, bukan penolakan.
      const dev = ratioDeviation(file, spec);
      if (dev > 0.1) {
        return {
          ok: true,
          error: null,
          warning: 'Rasio gambar ' + file.width + '×' + file.height +
            ' berbeda dari rasio ideal ' + spec.ratio[0] + ':' + spec.ratio[1] +
            '. Gambar akan dipotong otomatis saat disimpan.'
        };
      }
    }

    return { ok: true, error: null, warning: null };
  }

  /**
   * Baca dimensi (lebar × tinggi) sebuah berkas gambar.
   *
   * MENGAPA PERLU ADA
   * -----------------
   * Validasi `minShortSide` hanya bisa ditegakkan kalau dimensi diketahui.
   * Objek `File` di browser TIDAK punya properti `width`/`height`, jadi
   * pemanggil harus membacanya lewat fungsi ini dulu, lalu mengisi
   * `file.width`/`file.height` sebelum memanggil `validate()`.
   *
   * CONTOH PENGGUNAAN
   * -----------------
   *   const dims = await SylUploadSpec.readDimensions(file);
   *   file.width = dims.width;
   *   file.height = dims.height;
   *   const hasil = SylUploadSpec.validate(file, 'card');
   *
   * PERILAKU
   * ---------
   *  - Bila `createImageBitmap` tersedia, dipakai lebih dulu (lebih cepat dan
   *    tidak butuh object URL).
   *  - Bila tidak, jatuh ke `new Image()` + object URL. Object URL WAJIB
   *    dicabut (`revokeObjectURL`) supaya tidak membocorkan memori — baik saat
   *    berhasil maupun saat gagal.
   *  - Kegagalan apa pun (berkas bukan gambar, rusak, browser tanpa API
   *    gambar) menghasilkan promise yang **ditolak** dengan `Error` yang
   *    jelas. Fungsi ini TIDAK pernah mengembalikan dimensi palsu, karena
   *    dimensi palsu akan membuat `validate()` lolos untuk gambar buruk.
   *
   * @param {File|Blob} file berkas gambar
   * @returns {Promise<{width: number, height: number}>} dimensi gambar
   */
  function readDimensions(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('Berkas gambar tidak valid untuk dibaca dimensinya.'));
        return;
      }

      // Jalur Preferred: createImageBitmap (tanpa object URL).
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file).then(function (bitmap) {
          if (!bitmap || !bitmap.width || !bitmap.height) {
            reject(new Error('Dimensi gambar tidak bisa dibaca (bitmap kosong).'));
            return;
          }
          resolve({ width: bitmap.width, height: bitmap.height });
        }, function (err) {
          reject(new Error(
            'Gagal membaca dimensi gambar: ' + (err && err.message ? err.message : err)
          ));
        });
        return;
      }

      // Jalur cadangan: Image + object URL.
      if (typeof Image !== 'function' || typeof URL === 'undefined' ||
          typeof URL.createObjectURL !== 'function') {
        reject(new Error(
          'Browser tidak mendukung pembacaan dimensi gambar (createImageBitmap/Image tidak tersedia).'
        ));
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      // lepaskan object URL pada kedua jalur keluar (sukses maupun gagal)
      function cleanup() {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (e) {
          // revokeObjectURL tidak boleh menggagalkan proses di browser tua
        }
      }

      img.onload = function () {
        cleanup();
        if (!img.naturalWidth || !img.naturalHeight) {
          reject(new Error('Dimensi gambar tidak bisa dibaca (gambar kosong).'));
          return;
        }
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };

      img.onerror = function () {
        cleanup();
        reject(new Error('Gagal memuat gambar untuk membaca dimensinya.'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * String atribut `accept` untuk input file.
   *
   * @param {string} slotName kunci slot
   * @returns {string} mis. "image/jpeg,image/png,image/webp"
   */
  function acceptAttr(slotName) {
    return get(slotName).mime.join(',');
  }

  global.SylUploadSpec = {
    // `SLOTS` adalah nama yang dipakai brief/antarmuka publik;
    // `SLOT_SPECS` dipakai agar sama persis dengan nama server.
    // Keduanya menunjuk objek yang sama, jadi tidak mungkin melenceng.
    SLOTS: SLOT_SPECS,
    SLOT_SPECS: SLOT_SPECS,
    get: get,
    formatBytes: formatBytes,
    validate: validate,
    acceptAttr: acceptAttr,
    ratioDeviation: ratioDeviation,
    readDimensions: readDimensions
  };
})(window);