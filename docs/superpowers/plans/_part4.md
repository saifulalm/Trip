
## Task 6: Selaraskan slot backend dengan spesifikasi + endpoint galeri nyata

**Files:**
- Modify: `src/routes/admin.routes.js:250`, `:291` (slot `card` → `gallery` untuk `galleryFiles`)
- Modify: `src/app.js:86-97` (daftar pesan error upload per-slot)
- Modify: `src/routes/admin.routes.js` — tambah `POST /admin/galeri/unggah`
- Create: `public/js/upload-batch.js` (BARU) — helper POST batch
- Modify: `public/js/admin-gallery-suite.js:140-200` — ganti simulasi dengan POST sungguhan
- Modify: `views/admin/galeri.ejs:101-125` — hint ukuran dari spec, tombol upload jadi nyata
- Test: `scripts/upload-spec.test.js` (tambah suite), `scripts/verify-upload.js` (E2E)

**Interfaces:**
- Consumes: `SLOT_SPECS` / `getSlotSpec` (Task 2), `imageFields` (Task 3).
- Produces:
  - Route baru: `POST /admin/galeri/unggah` — body `multipart/form-data`, field `galleryFiles` (multi), mengembalikan JSON `{ok: boolean, files: [{filename, url, width, height, bytes}], error?: string}`.
  - `public/js/upload-batch.js` → `window.SylUploadBatch.upload(files, options)` → `Promise<{ok, files, error}>`.

**Kenapa butuh endpoint baru:** `POST /admin/destinasi` menerima gambar utama + galeri
sekaligus. Tapi halaman `/admin/galeri` adalah "management suite" terpisah yang
hanya ingin mengunggah foto galeri lalu menempelkannya ke satu destinasi. Field
`destinationId` + `kind` ditambahkan agar server tahu berkas harus dipasang ke pasti.

Body `multipart/form-data`:

| Field | Tipe | Keterangan |
|---|---|---|
| `galleryFiles` | file[] | Berkas gambar (maks 8) |
| `destinationId` | text | ID destinasi tujuan (opsional — kalau kosong, hasilnya hanya dikembalikan ke klien) |
| `kind` | text | `gallery` (default) atau `main` (ganti gambar utama) |

Respons sukses:

```json
{
  "ok": true,
  "files": [
    { "filename": "gal-1712...webp", "url": "/uploads/gal-1712...webp", "width": 1280, "height": 800, "bytes": 182340 }
  ]
}
```

Respons gagal: `{ "ok": false, "error": "..." }` dengan status 400/415.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/upload-spec.test.js`, sebelum blok `process.exit`:

  ```js
  // -- Backend memakai slot yang benar ---------------------------------
  const fsMod = require('fs');

  console.log('\n== Slot backend ==');

  t('galleryFiles memakai slot gallery di admin.routes.js', () => {
    const src = fsMod.readFileSync(
      path.join(root, 'src', 'routes', 'admin.routes.js'), 'utf8');
    const m = src.match(/\{ name: 'galleryFiles', slot: '([^']+)'/g) || [];
    assert.ok(m.length >= 2, 'harus ada 2 pemakaian galleryFiles');
    m.forEach((s) => {
      assert.ok(
        s.includes("slot: 'gallery'"),
        'galleryFiles harus slot gallery, dapat ' + s
      );
    });
  });

  t('app.js tidak lagi menyimpan pesan "maksimal 5 MB" yang usang', () => {
    const src = fsMod.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
    assert.ok(
      !/Ukuran gambar maksimal 5 MB\./.test(src),
      'pesan lama masih ada — batas sudah per-slot'
    );
  });

  t('endpoint /admin/galeri/unggah ada', () => {
    const src = fsMod.readFileSync(
      path.join(root, 'src', 'routes', 'admin.routes.js'), 'utf8');
    assert.ok(
      src.includes("'/galeri/unggah'"),
      'route POST /admin/galeri/unggah belum ada'
    );
  });

  t('public/js/upload-batch.js ada', () => {
    assert.ok(
      fsMod.existsSync(path.join(root, 'public', 'js', 'upload-batch.js')),
      'upload-batch.js belum ada'
    );
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/upload-spec.test.js`
  Expected: FAIL — `galleryFiles` masih slot `card`, pesan lama masih ada, endpoint belum ada.

- [ ] **Step 3: Selaraskan slot `galleryFiles` di backend**

  Di `src/routes/admin.routes.js`, **dua** tempat (route `POST /destinasi` sekitar baris 250
  dan `POST /destinasi/:id` sekitar baris 291) memakai:

  ```js
  ...imageFields([
    { name: 'imageFile', slot: 'card', maxCount: 1 },
    { name: 'galleryFiles', slot: 'card', maxCount: 8 }
  ]),
  ```

  Ubah baris `galleryFiles` menjadi `slot: 'gallery'`:

  ```js
  ...imageFields([
    { name: 'imageFile', slot: 'card', maxCount: 1 },
    { name: 'galleryFiles', slot: 'gallery', maxCount: 8 }
  ]),
  ```

  > `imageFile` untuk **artikel** sudah memakai slot `article` lewat
  > `singleImage('imageFile', 'article')` di baris 529 & 559 — itu sudah benar.

- [ ] **Step 4: Perbarui penanganan error upload di `src/app.js`**

  Ganti blok sekitar baris 85-97:

  ```js
  // Pesan galat unggah: format tidak didukung / ukuran terlalu besar.
  const uploadErrors = [
    'Format file harus JPG, PNG, WEBP, atau GIF.',
    'Ukuran gambar maksimal 5 MB.'
  ];
  if (err && (uploadErrors.includes(err.message) || err.code === 'INVALID_IMAGE' || err.code === 'LIMIT_FILE_SIZE')) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran gambar maksimal 5 MB.' : err.message;
    if (req.session) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message });
    }
    return res.redirect('back');
  }
  ```

  menjadi:

  ```js
  // Pesan galat unggah: format tidak didukung / ukuran terlalu besar.
  //
  // Batas ukuran sekarang PER-SLOT (lihat SLOT_SPECS di services/image.js),
  // jadi pesan tidak bisa lagi berupa konstanta tunggal. Yang dipakai di
  // sini hanya pola "Format ... tidak diizinkan untuk ..." yangcovers
  // semua slot.
  const isUploadError =
    err &&
    (
      err.code === 'INVALID_IMAGE' ||
      err.code === 'LIMIT_FILE_SIZE' ||
      /tidak diizinkan untuk/.test(err.message || '') ||
      /maksimal .+\.$/.test(err.message || '')
    );
  if (isUploadError) {
    const message = err.message || 'Berkas gambar tidak dapat diproses.';
    if (req.session) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message });
    }
    return res.redirect('back');
  }
  ```

  > `ERR_FORMAT` (konstanta "Format file harus JPG, PNG, WEBP, atau GIF.") masih
  > dipakai sebagai pesan umum saat magic byte tidak dikenali. Pesan itu tetap
  > válido — semua slot memang hanya menerima JPG/PNG/WEBP.

- [ ] **Step 5: Buat `public/js/upload-batch.js`**

  ```js
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
   */
  (function (global) {
    /**
     * Unggah beberapa berkas ke endpoint yang diberikan.
     *
     * @param {File[]} files berkas yang dipilih
     * @param {object} options { url, field, extra, csrfToken, onProgress }
     * @returns {Promise<{ok: boolean, files: Array, error: string|null}>}
     */
    function upload(files, options) {
      const opts = options || {};
      const url = opts.url || '/admin/galeri/unggah';
      const field = opts.field || 'galleryFiles';
      const list = Array.isArray(files) ? files : [];

      if (!list.length) {
        return Promise.resolve({ ok: false, files: [], error: 'Tidak ada berkas yang dipilih.' });
      }

      const fd = new FormData();
      if (opts.csrfToken) fd.append('_csrf', opts.csrfToken);
      if (opts.extra) {
        Object.keys(opts.extra).forEach(function (k) {
          fd.append(k, opts.extra[k]);
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
              return { ok: false, error: 'Respons server tidak valid (HTTP ' + res.status + ').' };
            })
            .then(function (data) {
              if (!res.ok) {
                return {
                  ok: false,
                  files: [],
                  error: (data && data.error) || 'Upload gagal (HTTP ' + res.status + ').'
                };
              }
              return { ok: true, files: (data && data.files) || [], error: null };
            });
        })
        .catch(function (err) {
          return {
            ok: false,
            files: [],
            error: 'Tidak bisa menghubungi server: ' + ((err && err.message) || err)
          };
        });
    }

    global.SylUploadBatch = { upload: upload };
  })(window);
  ```

- [ ] **Step 6: Tambahkan route `POST /admin/galeri/unggah`**

  Di `src/routes/admin.routes.js`, **tepat setelah** route `router.get('/galeri', ...)`
  (sekitar baris 360-370), tambahkan:

  ```js
  /**
   * Unggah batch foto galeri (Gallery Management Suite).
   *
   * Route ini dipakai widget batch upload di /admin/galeri. Widget tersebut
   * sebelumnya hanya mensimulasikan konversi WebP tanpa pernah mengirim
   * berkas ke server — sekarang jadi nyata.
   *
   * Body: multipart/form-data
   *  - galleryFiles  : file[]  (maks 8)
   *  - destinationId : text   (opsional — ID destinasi tujuan)
   *  - kind          : text   ('gallery' default | 'main')
   *
   * Respons: JSON { ok, files[], error? }
   */
  router.post(
    '/galeri/unggah',
    ...galleryImages('galleryFiles', 'gallery', 8),
    (req, res) => {
      const processed = (req.processedImages && req.processedImages.galleryFiles) || [];
      if (!processed.length) {
        return res.status(400).json({ ok: false, error: 'Tidak ada berkas gambar yang diunggah.' });
      }

      const data = req.data;
      const destId = String(req.body.destinationId || '').trim();
      const kind = String(req.body.kind || 'gallery').trim();

      // KalaudestinationId diberikan, langsung pasang berkasnya.
      let dest = null;
      if (destId) {
        dest = (data.destinations || []).find((d) => d.id === destId);
        if (!dest) {
          cleanupUploads(req);
          return res.status(404).json({ ok: false, error: 'Destinasi tidak ditemukan.' });
        }
      }

      const files = processed.map((p) => ({
        filename: p.filename,
        url: p.url,
        width: p.width || null,
        height: p.height || null,
        bytes: p.bytes || null
      }));

      if (dest) {
        if (kind === 'main') {
          const oldImage = dest.image;
          dest.image = files[0].url;
          if (oldImage && oldImage !== dest.image) removeUploadByUrl(oldImage);
        } else {
          dest.gallery = Array.isArray(dest.gallery) ? dest.gallery : [];
          files.forEach((f) => {
            if (!dest.gallery.includes(f.url)) dest.gallery.push(f.url);
          });
        }
        db.write();
      }

      return res.json({ ok: true, files });
    }
  );
  ```

  > **Perbaikan mandatory:** pastikan komentar dan kode di atas memakai Bahasa
  > Indonesia yang benar. Variabel `destinationId` (bukan `destination`) — nama
  > field form tidak boleh diubah tanpa alasan kuat.
  >
  > ```
  > Route ini dipakai widget batch upload di /admin/galeri. Widget tersebut
  > sebelumnya hanya mensimulasikan konversi WebP tanpa pernah mengirim
  > berkas ke server — sekarang jadi nyata.
  > ```
  >
  > Dan di dalam kode:
  >
  > ```js
  > // Kalau destinationId diberikan, langsung pasang berkasnya ke destinasi.
  > ```

  > **Import yang dibutuhkan:** `galleryImages` belum di-import di
  > `src/routes/admin.routes.js`. Baris 8 saat ini:
  >
  > ```js
  > const { singleImage, multiImage, imageFields, cleanupUploads } = require('../middleware/upload');
  > ```
  >
  > Ubah menjadi:
  >
  > ```js
  > const { singleImage, multiImage, imageFields, galleryImages, cleanupUploads } = require('../middleware/upload');
  > ```
  >
  > `removeUploadByUrl` sudah di-import (baris 9).

- [ ] **Step 7: Ganti simulasi di `public/js/admin-gallery-suite.js`**

  Ganti blok upload (sekitar baris 141-200) dengan:

  ```js
    // ── Upload button ──────────────────────────────────────────
    uploadBtn.addEventListener('click', async () => {
      if (state.isBusy || !files.length) {
        if (!files.length) showToast('error', 'Pilih setidaknya satu gambar.');
        return;
      }
      state.isBusy = true;
      uploadBtn.classList.add('is-busy');
      uploadBtn.textContent = 'Mengunggah…';

      // Tampilkan progres per berkas.
      for (let i = 0; i < files.length; i++) {
        setDotStatus(i, 'processing');
      }

      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')
          ? document.querySelector('meta[name="csrf-token"]').getAttribute('content')
          : '';

        const batch = window.SylUploadBatch;
        if (!batch) throw new Error('Modul unggah batch belum termuat.');

        const result = await batch.upload(files, {
          url: '/admin/galeri/unggah',
          field: 'galleryFiles',
          csrfToken: csrfToken,
          extra: { kind: 'gallery' }
        });

        if (!result.ok) {
          for (let i = 0; i < files.length; i++) setDotStatus(i, 'error');
          throw new Error(result.error || 'Upload gagal.');
        }

        result.files.forEach((f, i) => {
          setDotStatus(i, 'done');
          state.uploadedFiles.push({ file: files[i], url: f.url, status: 'done', progress: 100 });
        });

        state.isBusy = false;
        uploadBtn.classList.remove('is-busy');
        uploadBtn.textContent = 'Upload All (WebP)';
        showToast('success', '✓ ' + result.files.length + ' gambar berhasil diunggah.');

        // Kosongkan pilihan supaya admin bisa mengunggah batch berikutnya.
        files = [];
        input.value = '';
        drop.classList.remove('is-ready');
        filenameEl.textContent = '';
        metaEl.textContent = '';
        uploadBtn.disabled = true;
        dots.forEach(d => {
          d.className = 'gallery-upload-bundle__dot';
          d.classList.remove('is-active', 'is-done', 'is-error');
        });

      } catch (err) {
        state.isBusy = false;
        uploadBtn.classList.remove('is-busy');
        uploadBtn.textContent = 'Upload All (WebP)';
        showToast('error', err.message || 'Gagal mengunggah gambar. Coba lagi.');
        console.error(err);
      }
    });
  ```

  > **Penting:** `csrfToken` diambil dari `<meta name="csrf-token">`. Tag itu
  > **belum ada** di layout admin — Task 6 tidak memerlukannya karena token
  > diambil dari input hidden CSRF yang sudah ada di form admin. Tanpa token,
  > CSRF gagal dan route membalas 403.

  > Alternatif yang lebih sederhana dan langsung jalan: ambil token dari
  > input hidden CSRF yang sudah ada di form admin:
  >
  > ```js
  > const csrfEl = document.querySelector('input[name="_csrf"]');
  > const csrfToken = csrfEl ? csrfEl.value : '';
  > ```
  >
  > Ini **tidak** memerlukan perubahan layout. **Pilih yang ini** — lebih
  > minim risiko.

- [ ] **Step 8: Perbarui `views/admin/galeri.ejs`**

  Ganti blok SECTION 3 (sekitar baris 101-125) dengan:

  ```ejs
    <!-- ===== SECTION 3: BATCH MEDIA UPLOAD ===== -->
    <section class="gallery-upload-bundle" id="galleryUploadZone" data-slot="gallery">
      <div class="gallery-upload-bundle__drop">
        <span class="ico">☁️</span>
        <h3>Upload Batch Media</h3>
        <p>
          Seret & lepas beberapa gambar secara bersamaan.
          Setiap file dikonversi ke WebP otomatis di server.
        </p>
        <div class="gallery-upload-bundle__dots" id="uploadDots">
          <span data-dot></span><span data-dot></span><span data-dot></span>
        </div>
        <p style="font-size:0.75rem;color:var(--a-soft)">
          <%= uploadSpecs.get('gallery').hint %> · maksimal 8 file per unggahan
        </p>
        <button class="btn-a btn-a--deep btn-a--sm" data-upload disabled>
          🖼 Upload All (WebP)
        </button>
      </div>
      <input type="file" id="galleryUploadInput" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="gallery-upload-bundle__meta">
        <span data-filename></span>
        <span data-meta></span>
      </div>
    </section>
  ```

  > `uploadSpecs` tersedia sebagai local thanks Task 5 Step 4.

  Lalu di bagian bawah file, tambahkan script baru:

  ```ejs
  <script src="/js/upload-spec.js" defer></script>
  <script src="/js/upload-batch.js" defer></script>
  <script src="/js/admin-gallery-suite.js" defer></script>
  ```

  (ganti `<script src="/js/admin-gallery-suite.js" defer></script>` yang lama)

- [ ] **Step 9: Jalankan test, pastikan LULUS**

  Run: `node scripts/upload-spec.test.js`
  Expected: "OK - 29 pemeriksaan lulus".

- [ ] **Step 10: Verifikasi E2E upload admin masih jalan**

  Run: `node scripts/verify-upload.js`
  Expected: JSON hasil menunjukkan `create` 302/200, `webp output: yes`, `orphan count: 0`.

  > Kalau `webp output` jadi `no`, cek apakah `processImage` masih menulis WebP.

- [ ] **Step 11: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 12: Commit**

  ```bash
  git add src/routes/admin.routes.js src/app.js public/js/upload-batch.js \
          public/js/admin-gallery-suite.js views/admin/galeri.ejs scripts/upload-spec.test.js
  git commit -m "feat(upload): endpoint galeri nyata dan selaraskan slot backend"
  ```

---

## Task 7: Bersihkan dead code upload (blok upload bukti di layout publik)

**Files:**
- Modify: `views/layouts/public.ejs:195-253` — hapus blok JS upload bukti yang mati
- Modify: `src/services/image.js` — hapus entri `proof` yang tak terpakai? **TIDAK** — pertahankan (dipakai Task 8/9)
- Test: `scripts/upload-spec.test.js` (tambah suite "dead code upload sudah dibersihkan")

**Interfaces:**
- Consumes: tidak ada.
- Produces: tidak ada API baru. Ini task pembersihan.

**Analisa dulu — kenapa blok JS di `layouts/public.ejs` harus dihapus:**

`views/layouts/public.ejs:196-253` berisi IIFE "Unggah bukti transfer (halaman pembayaran)".
IIFE itu mencari `#proof` dan `[data-proof-drop]`.

Bukti `grep 'id="proof"' views/` → **kosong**. Tidak ada form bukti pembayaran di
situs publik. `views/pages/payment.ejs` juga tidak punya form bukti (pembayaran lewat
iPaymu). Jadi seluruh IIFE itu adalah kode mati — 58 baris JS yang selalu
`return` di baris pertama.

Membiarkannya berbahaya: kalau suatu saat ada form `#proof` ditambahkan, IIFE ini
akan menabrak dengan validasi 5 MB yang bertentangan dengan slot `proof` (8 MB).

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/upload-spec.test.js`, sebelum blok `process.exit`:

  ```js
  // -- Dead code upload harus dibersihkan -------------------------------
  console.log('\n== Dead code upload ==');

  t('layouts/public.ejs tidak lagi punya blok upload bukti', () => {
    const src = fsMod.readFileSync(
      path.join(root, 'views', 'layouts', 'public.ejs'), 'utf8');
    assert.ok(
      !/data-proof-drop/.test(src),
      'blok upload bukti yang sudah mati masih ada'
    );
    assert.ok(
      !/Unggah bukti transfer/.test(src),
      'komentar upload bukti masih ada'
    );
  });

  t('layouts/public.ejs tetap memuat upload-spec.js', () => {
    const src = fsMod.readFileSync(
      path.join(root, 'views', 'layouts', 'public.ejs'), 'utf8');
    assert.ok(src.includes('/js/upload-spec.js'), 'upload-spec.js belum dimuat');
  });
  ```

  > `fsMod` sudah dideklarasikan di suite "Slot backend" (Task 6). Kalau suite itu
  > belum ada, tambahkan `const fsMod = require('fs');` di bagian atas file test.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/upload-spec.test.js`
  Expected: FAIL — `data-proof-drop` masih ada.

- [ ] **Step 3: Hapus blok JS upload bukti dari `views/layouts/public.ejs`**

  Hapus seluruh IIFE dari `<!-- ---------- Unggah bukti transfer (halaman pembayaran) ---------- -->`
  sampai penutup `})();` nya (sekitar baris 196-253).

  Ganti dengan:

  ```ejs
  ```

  (baris kosong — atau lebih baik, biarkan `</script>` langsung)

  Struktur yang tersisa harus menjadi:

  ```ejs
    <script src="/js/hero-animated.js" defer></script>
    <script src="/js/upload-spec.js" defer></script>
  </script>
  ```

  > Hapus juga `<script src="/js/upload-spec.js" defer></script>` bila sudah
  > ada dari Task 4 — jangan dobel.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

  Run: `node scripts/upload-spec.test.js`
  Expected: "OK - 31 pemeriksaan lulus".

- [ ] **Step 5: Verifikasi halaman publik masih hidup**

  Run: `npm run test:e2e:portal`
  Expected: script portal lulus (halaman publik + portal pelanggan).

- [ ] **Step 6: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 7: Commit**

  ```bash
  git add views/layouts/public.ejs scripts/upload-spec.test.js
  git commit -m "chore(upload): bersihkan blok upload bukti yang sudah mati"
  ```

---
