'use strict';

/**
 * Helper unggah batch gambar ke server.
 *
 * Dipakai oleh "Gallery Management Suite" di /admin/galeri, yang
 * sebelumnya hanya mensimulasikan konversi WebP tanpa pernah mengirim
 * berkas ke server.
 *
 * Modul ini sengaja dibuat terpisah dari `admin-gallery-suite.js` supaya
 * alur unggah (POST + error + progres) bisa dipakai ulang tanpa menarik
 * seluruh suite galeri.
 *
 * API: `window.SylUploadBatch.upload(files, options)` → Promise<{ok, files, error}>
 */
(function (global) {
  /**
   * Unggah beberapa berkas ke endpoint yang diberikan.
   *
   * @param {File[]} files berkas yang dipilih
   * @param {object} options { url, field, extra, csrfToken }
   *   - url       : endpoint target (default '/admin/galeri/unggah')
   *   - field     : nama field berkas (default 'galleryFiles')
   *   - extra     : field teks tambahan (mis. { kind, destinationId })
   *   - csrfToken : token CSRF sesi
   * @returns {Promise<{ok: boolean, files: Array, error: string|null}>}
   */
  function upload(files, options) {
    const opts = options || {};
    const url = opts.url || '/admin/galeri/unggah';
    const field = opts.field || 'galleryFiles';
    const list = Array.isArray(files) ? files : [];

    if (!list.length) {
      return Promise.resolve({
        ok: false,
        files: [],
        error: 'Tidak ada berkas yang dipilih.'
      });
    }

    const fd = new FormData();
    if (opts.csrfToken) fd.append('_csrf', opts.csrfToken);
    if (opts.extra) {
      Object.keys(opts.extra).forEach(function (k) {
        // Nilai kosong tidak perlu dikirim — server membacanya sebagai
        // "tidak diisi" dan tidak melakukan apa pun.
        const v = opts.extra[k];
        if (v === undefined || v === null || v === '') return;
        fd.append(k, v);
      });
    }
    list.forEach(function (f) {
      fd.append(field, f, f.name);
    });

    return fetch(url, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {
              ok: false,
              error: 'Respons server tidak valid (HTTP ' + res.status + ').'
            };
          })
          .then(function (data) {
            if (!res.ok) {
              return {
                ok: false,
                files: [],
                error: (data && data.error) ||
                  'Upload gagal (HTTP ' + res.status + ').'
              };
            }
            return { ok: true, files: (data && data.files) || [], error: null };
          });
      })
      .catch(function (err) {
        return {
          ok: false,
          files: [],
          error: 'Tidak bisa menghubungi server: ' +
            ((err && err.message) || err)
        };
      });
  }

  global.SylUploadBatch = { upload: upload };
})(window);
