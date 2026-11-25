'use strict';

/**
 * seayoulatertrip — Admin gallery upload widget (gal-upload)
 *
 * Widget unggah galeri untuk form destinasi (banyak berkas sekaligus).
 * Dipanggil oleh partial views/admin/partials/gallery-upload.ejs.
 *
 * Fitur:
 *  - Klik area / seret-lepas untuk memilih beberapa berkas
 *  - Validasi sisi klien memakai spesifikasi slot (window.SylUploadSpec):
 *    format, ukuran, dimensi minimum, jumlah maksimal
 *  - Peringatan rasio ditampilkan terpisah (tidak membatalkan pilihan)
 *  - Daftar pratinjau berkas yang akan diunggah
 *
 * NOTA: Untuk fitur galeri management suite (drag-to-sort, granular
 * controls, WebP compression indicators), lihat admin-gallery-suite.js
 * yang dimuat di /admin/galeri.
 */
(function () {
  /**
   * Fallback bila `upload-spec.js` belum termuat.
   *
   * Fallback SENGAJA memakai batas paling ketat di antara slot yang relevan
   * (batas terkecil = 500 KB, format paling sempit = PNG/WEBP, sisi
   * terpendek minimum terbesar = 800 px) sehingga widget tidak pernah
   * menerima berkas yang lebih longgar daripada server.
   *
   * Bila `SylUploadSpec` benar-benar tidak termuat, widget lebih aman
   * MENOLAK berkas dengan pesan jelas daripada menebak aturannya.
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

  // Batas & format diambil dari spesifikasi slot (window.SylUploadSpec)
  // supaya selalu sinkron dengan validasi server.
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

  function formatSize(bytes) {
    return SPEC.formatBytes(bytes);
  }

  /**
   * Bersihkan hint tambahan dari pemanggil partial.
   *
   * Hint lama di form masih menyebut format & batas ukuran sendiri
   * (mis. "maksimal 5 MB"), yang bisa bertentakan dengan spesifikasi
   * slot (mis. 2 MB). Segmen format/ukuran/rasio dibuang.
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
        if (/maksimal|rasio|contoh/i.test(part)) return false;
        var formatNames = part.match(/jpg|png|webp|gif/gi) || [];
        if (formatNames.length > 1) return false;
        return true;
      })
      .join(' · ');
  }

  function initWidget(root) {
    const input = root.querySelector('input[type="file"]');
    // Partial galeri memakai atribut `data-gal-*`, tapi widget ini juga
    // pernah dipakai dengan markup `data-*` — dukung keduanya.
    const drop = root.querySelector('[data-gal-drop], [data-drop]');
    if (!input || !drop) return;

    const filenameEl = root.querySelector('[data-gal-filename], [data-filename]');
    const metaEl = root.querySelector('[data-gal-meta], [data-meta]');
    const warnEl = root.querySelector('[data-gal-warning], [data-warning]');
    const hintEl = root.querySelector('[data-gal-hint], [data-hint]');
    const maxFiles = Number(root.dataset.maxFiles) || 8;

    // Slot dibaca dari `data-slot` (bukan menebak dari `data-ratio`).
    const slotName = root.dataset.slot || root.dataset.ratio || 'gallery';
    const spec = SPEC.get(slotName);

    if (typeof SPEC.acceptAttr === 'function') {
      input.setAttribute('accept', SPEC.acceptAttr(slotName));
    }

    // Tampilkan hint dari spesifikasi slot, disambung hint tambahan.
    if (hintEl) {
      const extra = sanitizeExtraHint(hintEl.dataset.extraHint);
      hintEl.textContent = [
        spec.hint + ' · bisa pilih beberapa file sekaligus',
        extra
      ].filter(Boolean).join(' · ');
    }

    /** Kosongkan elemen teks bila ada (elemennya opsional). */
    function setText(el, text) {
      if (el) el.textContent = text;
    }

    /**
     * Baca dimensi satu berkas.
     * Bila gagal, kembalikan pesan error (bukan dimensi palsu).
     * @param {File} file berkas gambar
     * @returns {Promise<{width: number, height: number}>} dimensi
     */
    async function readDims(file) {
      const dims = await SPEC.readDimensions(file);
      file.width = dims.width;
      file.height = dims.height;
      return dims;
    }

    /**
     * Terapkan daftar berkas yang dipilih.
     * Alur: baca dimensi tiap berkas dulu -> isi file.width/file.height ->
     * baru validasi (sinkron) memakai spesifikasi slot.
     */
    async function applyFiles(files) {
      const list = Array.from(files || []);
      drop.classList.remove('is-error', 'is-ready');
      setText(filenameEl, '');
      setText(metaEl, '');
      if (warnEl) {
        warnEl.hidden = true;
        warnEl.textContent = '';
      }

      if (!list.length) {
        input.value = '';
        return;
      }

      // Tanpa spesifikasi slot, aturan upload tidak bisa dipastikan —
      // lebih aman menolak daripada menerima berkas yang server tolak.
      if (!SPEC_AVAILABLE) {
        drop.classList.add('is-error');
        setText(filenameEl, 'Spesifikasi unggahan tidak termuat. Muat ulang halaman lalu coba lagi.');
        input.value = '';
        return;
      }

      const problems = [];
      const warnings = [];

      if (list.length > maxFiles) {
        problems.push('Maksimal ' + maxFiles + ' foto per unggahan (terpilih ' + list.length + ').');
      }

      for (const f of list) {
        // Baca dimensi sebelum validasi — sisi terpendek minimum hanya
        // bisa dicek kalau dimensi diketahui.
        try {
          await readDims(f);
        } catch (err) {
          problems.push(
            f.name + ': gagal membaca dimensi gambar (' +
            (err && err.message ? err.message : err) + ')'
          );
          continue;
        }

        const res = SPEC.validate(f, slotName);
        if (!res.ok) {
          problems.push(f.name + ': ' + res.error);
        } else if (res.warning) {
          // Peringatan rasio TIDAK membatalkan pilihan.
          warnings.push(f.name + ': ' + res.warning);
        }
      }

      if (problems.length) {
        drop.classList.add('is-error');
        setText(filenameEl, problems.slice(0, 2).join(' '));
        setText(metaEl, problems.length > 2 ? '+' + (problems.length - 2) + ' masalah lain' : '');
        input.value = '';
        if (warnEl) {
          warnEl.hidden = warnings.length === 0;
          warnEl.textContent = warnings.slice(0, 2).join(' ');
        }
        return;
      }

      if (warnEl) {
        warnEl.hidden = warnings.length === 0;
        warnEl.textContent = warnings.slice(0, 2).join(' ');
      }

      drop.classList.add('is-ready');
      setText(filenameEl, list.length === 1 ? list[0].name : list.length + ' foto dipilih');
      setText(
        metaEl,
        list.map((f) => f.name).join(' · ') +
        ' — ' + formatSize(list.reduce((s, f) => s + f.size, 0))
      );
    }

    input.addEventListener('change', () => applyFiles(input.files));
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

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
      try {
        const dt = new DataTransfer();
        Array.from(files).forEach((f) => dt.items.add(f));
        input.files = dt.files;
      } catch (err) {
        input.value = '';
      }
      applyFiles(files);
    });
  }

  function initAll() {
    document.querySelectorAll('[data-gal-upload]').forEach(initWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
