'use strict';

/**
 * Widget unggah gambar untuk panel admin.
 *
 * Fitur:
 *  - Klik area / seret-lepas untuk memilih berkas
 *  - Validasi sisi klien memakai spesifikasi slot (window.SylUploadSpec):
 *    format, ukuran, dimensi minimum, dan peringatan rasio
 *  - Pratinjau langsung sebelum diunggah
 *
 * Script ini dimuat sekali di layout admin; ia mencari elemen .img-upload
 * yang ada di halaman dan mengaktifkannya.
 */
(function () {
  /**
   * Fallback bila `upload-spec.js` belum termuat (mis. script gagal dimuat
   * atau dihapus dari layout).
   *
   * Fallback ini SENGAJA memakai batas paling ketat di antara seluruh slot
   * yang relevan (batas terkecil = logo 500 KB, format paling sempit =
   * PNG/WEBP, sisi terpendek minimum terbesar = 800 px) sehingga widget
   * tidak pernah menerima berkas yang lebih longgar daripada server.
   *
   *更进一步: bila `SylUploadSpec` benar-benar tidak termuat, widget lebih
   * aman MENOLAK berkas dengan pesan jelas daripada menebak aturannya.
   */
  const FALLBACK_SPEC = {
    maxBytes: 500 * 1024,
    mime: ['image/png', 'image/webp'],
    ratio: [16, 10],
    minShortSide: 800,
    hint: 'PNG atau WEBP · maksimal 500 KB'
  };

  // True bila spesifikasi slot benar-benar termuat di halaman.
  const SPEC_AVAILABLE = !!window.SylUploadSpec;

  // Batas ukuran, format, rasio, dan dimensi minimum diambil dari
  // spesifikasi slot (window.SylUploadSpec) supaya selalu sinkron dengan
  // validasi server. Fallback hanya jaring pengaman.
  const SPEC = window.SylUploadSpec || {
    get: function () {
      return Object.assign({}, FALLBACK_SPEC);
    },
    formatBytes: function (b) {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
      return (Math.round((b / (1024 * 1024)) * 10) / 10) + ' MB';
    },
    acceptAttr: function () {
      return FALLBACK_SPEC.mime.join(',');
    },
    validate: function () {
      // Tanpa spesifikasi slot, aturannya tidak bisa dipastikan.
      return {
        ok: false,
        error: 'Spesifikasi unggahan tidak termuat. Muat ulang halaman lalu coba lagi.',
        warning: null
      };
    },
    readDimensions: function () {
      return Promise.reject(new Error('Spesifikasi unggahan tidak termuat.'));
    }
  };

  /** Format ukuran berkas agar mudah dibaca (KB/MB). */
  function formatSize(bytes) {
    return SPEC.formatBytes(bytes);
  }

  /**
   * Bersihkan hint tambahan dari pemanggil partial.
   *
   * Hint lama di form masih menyebut format & batas ukuran sendiri
   * (mis. "maksimal 5 MB"), yang bisa BERTAHTAKAN dengan spesifikasi
   * slot (mis. 2 MB). Segmen yang bicara soal format/ukuran dibuang;
   * sisanya (mis. "PNG dengan latar transparan") tetap dipakai.
   *
   * @param {string} extra hint tambahan dari partial
   * @returns {string} hint tambahan yang sudah dibersihkan
   */
  function sanitizeExtraHint(extra) {
    if (!extra) return '';
    return String(extra)
      .split('·')
      .map(function (part) { return part.trim(); })
      .filter(function (part) {
        if (!part) return false;
        // Buang klaim batas ukuran & rasio — spec slot yang mengaturnya.
        if (/maksimal|rasio|contoh/i.test(part)) return false;
        // Buang daftar format (bukan format tunggal), mis. "JPG, PNG, WEBP".
        var formatNames = part.match(/jpg|png|webp|gif/gi) || [];
        if (formatNames.length > 1) return false;
        return true;
      })
      .join(' · ');
  }

  /** Inisialisasi satu widget unggah. */
  function initWidget(root) {
    const input = root.querySelector('input[type="file"]');
    const drop = root.querySelector('[data-drop]');
    if (!input || !drop) return;

    const filenameEl = root.querySelector('[data-filename]');
    const metaEl = root.querySelector('[data-meta]');
    const clearBtn = root.querySelector('[data-clear]');
    const warnEl = root.querySelector('[data-warning]');
    const hintEl = root.querySelector('[data-hint]');

    // Slot dibaca dari `data-slot` (bukan menebak dari `data-ratio`).
    const slotName = root.dataset.slot || root.dataset.ratio || 'card';
    const spec = SPEC.get(slotName);

    // Atur atribut accept sesuai MIME yang diizinkan slot ini.
    if (typeof SPEC.acceptAttr === 'function') {
      input.setAttribute('accept', SPEC.acceptAttr(slotName));
    }

    // Tampilkan hint dari spesifikasi slot, disambung hint tambahan dari
    // pemanggil partial (bila ada).
    if (hintEl) {
      const extra = sanitizeExtraHint(hintEl.dataset.extraHint);
      hintEl.textContent = [spec.hint, extra].filter(Boolean).join(' · ');
    }

    // --- Tampilan pratinjau ---
    function renderPreview(file) {
      let box = root.querySelector('[data-preview-box]');
      let img = root.querySelector('[data-preview]');

      if (!file) {
        if (img) img.remove();
        if (!box) {
          box = document.createElement('div');
          box.className = 'img-upload__preview img-upload__preview--empty';
          box.setAttribute('data-preview-box', '');
          box.innerHTML = '<span>🖼</span><span>Belum ada gambar</span>';
          root.querySelector('.img-upload__row').prepend(box);
        }
        return;
      }

      if (!img) {
        if (box) box.remove();
        img = document.createElement('img');
        img.className = 'img-upload__preview';
        img.setAttribute('data-preview', '');
        img.alt = '';
        root.querySelector('.img-upload__row').prepend(img);
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
        // Tampilkan ukuran dimensi di baris metadata (setelah pratinjau
        // dimuat, supaya metadata final tidak tertimpa).
        if (metaEl && file.width && file.height) {
          metaEl.textContent = metaEl.textContent + ' · ' + file.width + '×' + file.height + ' px';
        }
      };
      reader.readAsDataURL(file);
    }

    // --- Validasi berkas (sinkron, memakai spesifikasi slot) ---
    /**
     * @param {File} file berkas terpilih
     * @returns {{ok: boolean, error: string|null, warning: string|null}}
     */
    function validate(file) {
      return SPEC.validate(file, slotName);
    }

    /** Tampilkan pesan error di area drop dan buang pilihan. */
    function showError(message) {
      drop.classList.remove('is-ready');
      drop.classList.add('is-error');
      if (filenameEl) filenameEl.textContent = message;
      if (metaEl) metaEl.textContent = '';
      input.value = '';
      renderPreview(null);
      if (clearBtn) clearBtn.hidden = true;
    }

    // --- Terapkan berkas yang dipilih ---
    // Alur: baca dimensi dulu -> isi file.width/file.height -> baru validasi.
    // Validasi tetap sinkron (SylUploadSpec.validate).
    async function applyFile(file) {
      drop.classList.remove('is-error', 'is-ready');
      if (warnEl) {
        warnEl.hidden = true;
        warnEl.textContent = '';
      }

      if (!file) {
        showError('Berkas tidak valid.');
        return;
      }

      // Tanpa spesifikasi slot, aturan upload tidak bisa dipastikan —
      // lebih aman menolak daripada menerima berkas yang server tolak.
      if (!SPEC_AVAILABLE) {
        showError(
          'Spesifikasi unggahan tidak termuat. Muat ulang halaman lalu coba lagi.'
        );
        return;
      }

      // Baca dimensi gambar. Bila gagal, jangan lanjut validasi tanpa
      // dimensi — sisi terpendek minimum tidak bisa ditegakkan. Tampilkan
      // pesan error yang jelas ke admin.
      try {
        const dims = await SPEC.readDimensions(file);
        file.width = dims.width;
        file.height = dims.height;
      } catch (err) {
        showError(
          'Gagal membaca dimensi gambar: ' +
          (err && err.message ? err.message : err) +
          '. Pilih file gambar lain yang bisa dibuka.'
        );
        return;
      }

      const result = validate(file);
      if (!result.ok) {
        showError(result.error);
        return;
      }

      drop.classList.add('is-ready');
      if (filenameEl) filenameEl.textContent = file.name;
      if (metaEl) {
        metaEl.textContent = formatSize(file.size) + ' · ' + file.type.replace('image/', '').toUpperCase();
      }
      // Peringatan rasio (bukan penolakan) ditampilkan terpisah.
      if (result.warning && warnEl) {
        warnEl.hidden = false;
        warnEl.textContent = result.warning;
      }
      renderPreview(file);
      if (clearBtn) clearBtn.hidden = false;
    }

    // --- Event Choosing file ---
    input.addEventListener('change', () => {
      applyFile(input.files && input.files[0]);
    });

    // ----area click triggers file chooser ---
    drop.addEventListener('click', (e) => {
      if (e.target === clearBtn) return;
      input.click();
    });
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    // --- Drag & drop ---
    ['dragenter', 'dragover'].forEach((evt) => {
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        root.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (evt === 'dragleave' && drop.contains(e.relatedTarget)) return;
        root.classList.remove('is-dragover');
      });
    });
    drop.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      // Set berkas terpilih via DataTransfer agar input form tetap terisi.
      try {
        const dt = new DataTransfer();
        dt.items.add(files[0]);
        input.files = dt.files;
      } catch (err) {
        // Browser lama tidak mendukung DataTransfer — fall back ke filename.
        input.value = '';
      }
      applyFile(files[0]);
    });

    // --- Hapus pilihan ---
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        applyFile(null);
        drop.classList.remove('is-ready', 'is-error');
        if (filenameEl) filenameEl.textContent = '';
        if (metaEl) metaEl.textContent = '';
        if (warnEl) {
          warnEl.hidden = true;
          warnEl.textContent = '';
        }
        clearBtn.hidden = true;
      });
    }
  }

  function initAll() {
    document.querySelectorAll('.img-upload').forEach(initWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
