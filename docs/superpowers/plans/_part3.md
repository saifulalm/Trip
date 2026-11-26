
## Task 4: Validasi sisi klien + helper text per-slot (`upload-spec.js`)

**Files:**
- Create: `public/js/upload-spec.js` (BARU)
- Modify: `views/layouts/admin.ejs:186` (muat script), `views/layouts/public.ejs:195` (muat script)
- Test: `scripts/upload-spec.test.js` (tambah suite "spesifikasi sisi klien harus sinkron dengan server")

**Interfaces:**
- Consumes: spesifikasi slot dari server. Karena tidak ada build step, sisi klien **mendapat salinan** dari `SLOT_SPECS` — harus dijaga sinkron oleh test.
- Produces (global browser `window.SylUploadSpec`):
  - `SylUploadSpec.SLOTS` — objek spesifikasi slot, **identik nilainya** dengan `SLOT_SPECS` server.
  - `SylUploadSpec.get(slotName)` — spec slot, fallback ke `card`.
  - `SylUploadSpec.validate(file, slotName)` → `{ok: boolean, error: string|null, warning: string|null}`.
  - `SylUploadSpec.formatBytes(bytes)` — sama dengan server.
  - `SylUploadSpec.acceptAttr(slotName)` — string untuk atribut `accept` HTML.

**Aturan validasi sisi klien (harus sama dengan server):**

1. Format MIME harus di dalam `spec.mime`.
2. Ukuran tidak boleh melebihi `spec.maxBytes` → **tolak**.
3. Dimensi terpendek tidak boleh kurang dari `spec.minShortSide` → **tolak**.
4. Rasioactual vs `spec.ratio` boleh berbeda lebih dari 10% → **peringatan saja** (bukan tolak).

Mengapa rasio hanya peringatan: foto HP sering 4:3 atau 16:9 yang tidak persis 16:10,
dan `fit: 'cover'` akan memotong otomatis. Menolak akan membuat admin frustrasi.
Tapi dimensi terlalu kecil **harus** ditolak — hasilnya akan pecah saat di-crop.

- [ ] **Step 1: Tulis test sinkronisasi server vs klien**

  Tambahkan di `scripts/upload-spec.test.js`, sebelum blok `process.exit`:

  ```js
  // -- Sisi klien harus sinkron dengan server ------------------------
  console.log('\n== Sinkronisasi spesifikasi sisi klien ==');

  function readClientSpec() {
    const fs = require('fs');
    const p = path.join(root, 'public', 'js', 'upload-spec.js');
    if (!fs.existsSync(p)) return null;
    const src = fs.readFileSync(p, 'utf8');
    // Parse blok SLOT_SPECS tanpa mengeksekusi browser.
    const m = src.match(/const SLOT_SPECS\s*=\s*(\{[\s\S]*?\n  \});/);
    if (!m) return null;
    // Ganti ekspresi maxBytes/float agar JSON-izable.
    const json = m[1]
      .replace(/(\d+)\s*\*\s*1024\s*\*\s*1024/g, (s, n) => String(n * 1024 * 1024))
      .replace(/(\d+)\s*\*\s*1024\b/g, (s, n) => String(n * 1024))
      .replace(/'/g, '"');
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  t('public/js/upload-spec.js ada', () => {
    assert.ok(readClientSpec(), 'file klien atau blok SLOT_SPECS tidak ditemukan');
  });

  t('slot sisi klien sama persis dengan server', () => {
    const client = readClientSpec();
    const server = image.SLOT_SPECS;
    assert.deepStrictEqual(
      Object.keys(client).sort(),
      Object.keys(server).sort(),
      'daftar slot berbeda'
    );
    Object.keys(server).forEach((k) => {
      assert.strictEqual(client[k].maxBytes, server[k].maxBytes, 'maxBytes slot ' + k);
      assert.strictEqual(client[k].width, server[k].width, 'width slot ' + k);
      assert.strictEqual(client[k].height, server[k].height, 'height slot ' + k);
      assert.strictEqual(client[k].fit, server[k].fit, 'fit slot ' + k);
      assert.strictEqual(client[k].minShortSide, server[k].minShortSide, 'minShortSide slot ' + k);
      assert.deepStrictEqual(client[k].ratio, server[k].ratio, 'ratio slot ' + k);
      assert.deepStrictEqual(client[k].mime, server[k].mime, 'mime slot ' + k);
    });
  });

  t('hints di sisi klien menyebut ukuran maksimum yang benar', () => {
    const client = readClientSpec();
    assert.ok(/500 KB/.test(client.logo.hint), client.logo.hint);
    assert.ok(/2 MB/.test(client.card.hint), client.card.hint);
    assert.ok(/8 MB/.test(client.proof.hint), client.proof.hint);
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/upload-spec.test.js`
  Expected: FAIL — "public/js/upload-spec.js ada" (file belum ada).

- [ ] **Step 3: Buat `public/js/upload-spec.js`**

  ```js
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
   */
  (function (global) {
    const SLOT_SPECS = {
      card: {
        width: 1280, height: 800, fit: 'cover',
        ratio: [16, 10], maxBytes: 2 * 1024 * 1024, minShortSide: 800,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'gambar kartu',
        hint: 'Rasio 16:10 (1280×800) · JPG, PNG, atau WEBP · maksimal 2 MB'
      },
      article: {
        width: 1280, height: 720, fit: 'cover',
        ratio: [16, 9], maxBytes: 2 * 1024 * 1024, minShortSide: 800,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'gambar sampul artikel',
        hint: 'Rasio 16:9 (1280×720) · JPG, PNG, atau WEBP · maksimal 2 MB'
      },
      hero: {
        width: 1920, height: 1080, fit: 'cover',
        ratio: [16, 9], maxBytes: 4 * 1024 * 1024, minShortSide: 800,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'gambar hero',
        hint: 'Rasio 16:9 (1920×1080) · JPG, PNG, atau WEBP · maksimal 4 MB'
      },
      logo: {
        width: 512, height: 512, fit: 'contain',
        ratio: [1, 1], maxBytes: 500 * 1024, minShortSide: 128,
        mime: ['image/png', 'image/webp'],
        label: 'logo',
        hint: 'Rasio 1:1 (512×512) · PNG atau WEBP · maksimal 500 KB'
      },
      og: {
        width: 1200, height: 630, fit: 'cover',
        ratio: [1200, 630], maxBytes: 1 * 1024 * 1024, minShortSide: 630,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'gambar OG',
        hint: 'Rasio 1200:630 · JPG, PNG, atau WEBP · maksimal 1 MB'
      },
      media: {
        width: 1200, height: 1200, fit: 'inside',
        ratio: [1, 1], maxBytes: 3 * 1024 * 1024, minShortSide: 600,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'media media sosial',
        hint: 'Rasio 1:1 (1200×1200) · JPG, PNG, atau WEBP · maksimal 3 MB'
      },
      proof: {
        width: 1600, height: 1200, fit: 'inside',
        ratio: [4, 3], maxBytes: 8 * 1024 * 1024, minShortSide: 800,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'bukti transfer',
        hint: 'Rasio 4:3 (1600×1200) · JPG, PNG, atau WEBP · maksimal 8 MB'
      },
      gallery: {
        width: 1280, height: 800, fit: 'cover',
        ratio: [16, 10], maxBytes: 2 * 1024 * 1024, minShortSide: 800,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        label: 'foto galeri',
        hint: 'Rasio 16:10 (1280×800) · JPG, PNG, atau WEBP · maksimal 2 MB'
      }
    };

    /**
     * Ambil spesifikasi slot, fallback ke `card`.
     */
    function get(slotName) {
      return SLOT_SPECS[slotName] || SLOT_SPECS.card;
    }

    /**
     * Format ukuran berkas agar enak dibaca.
     */
    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
      const mb = bytes / (1024 * 1024);
      return (Math.round(mb * 10) / 10) + ' MB';
    }

    /**
     * Rasio yang diizinkan (tanpa toleransi) sebagai pembagi.
     */
    function targetRatio(spec) {
      return spec.ratio[0] / spec.ratio[1];
    }

    /**
     * Cek seberapa jauh rasio berkas menyimpang dari rasio target.
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
     * @param {File} file berkas dari input file
     * @param {string} slotName slot tujuan
     * @returns {{ok: boolean, error: string|null, warning: string|null}}
     */
    function validate(file, slotName) {
      const spec = get(slotName);

      if (!file) return { ok: false, error: 'Berkas tidak valid.', warning: null };

      if (spec.mime.indexOf(file.type) === -1) {
        const allowed = spec.mime.map((m) => m.replace('image/', '').toUpperCase()).join(', ');
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
     * String atribut `accept` untuk input file.
     */
    function acceptAttr(slotName) {
      return get(slotName).mime.join(',');
    }

    global.SylUploadSpec = {
      SLOT_SPECS: SLOT_SPECS,
      get: get,
      formatBytes: formatBytes,
      validate: validate,
      acceptAttr: acceptAttr,
      ratioDeviation: ratioDeviation
    };
  })(window);
  ```

- [ ] **Step 4: Muat script di kedua layout**

  Di `views/layouts/admin.ejs`, tambahkan **sebelum** `<script src="/js/admin-upload.js" defer></script>`:

  ```html
  <script src="/js/upload-spec.js" defer></script>
  ```

  Di `views/layouts/public.ejs`, tambahkan di blok script yang sama:

  ```html
  <script src="/js/upload-spec.js" defer></script>
  ```

  > `defer` dipakai karena `admin-upload.js` butuh `window.SylUploadSpec` tersedia
  > saat inisialisasi. Karena keduanya `defer`, urutan eksekusi mengikuti urutan
  > tag — jadi `upload-spec.js` harus didahulukan.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

  Run: `node scripts/upload-spec.test.js`
  Expected: "OK - 22 pemeriksaan lulus".

- [ ] **Step 6: Commit**

  ```bash
  git add public/js/upload-spec.js views/layouts/admin.ejs views/layouts/public.ejs scripts/upload-spec.test.js
  git commit -m "feat(upload): tambah spesifikasi slot sisi klien dan validasi pra-unggah"
  ```

---

## Task 5: Widget upload admin memakai spesifikasi slot

**Files:**
- Modify: `views/admin/partials/image-upload.ejs` (hapus `data-max-size` hardcode, pakai `data-slot`)
- Modify: `views/admin/partials/gallery-upload.ejs` (idem, `data-slot="gallery"`)
- Modify: `public/js/admin-upload.js` (pakai `SylUploadSpec`)
- Modify: `public/js/admin-gallery-widget.js` (pakai `SylUploadSpec`)
- Modify: `views/admin/destination-form.ejs:65`, `views/admin/package-form.ejs:64`, `views/admin/article-form.ejs:31`, `views/admin/seo.ejs:15`, `views/admin/settings.ejs:63,77` (slot eksplisit + hint dari spec)
- Test: `scripts/upload-spec.test.js` (tambah suite "partial admin memakai data-slot")

**Interfaces:**
- Consumes: `window.SylUploadSpec` (Task 4).
- Produces: setiap widget `.img-upload` / `[data-gal-upload]` membaca `data-slot` untuk menentukan spec.

**Nilai slot per form:**

| Partial Include | Field | Slot | Lokasi |
|---|---|---|---|
| `destination-form.ejs` | `imageFile` | `card` | `:65` |
| `destination-form.ejs` | `galleryFiles` | `gallery` | `:79` (gallery-upload) |
| `package-form.ejs` | `imageFile` | `card` | `:64` |
| `article-form.ejs` | `imageFile` | `article` | `:31` |
| `seo.ejs` | `ogFile` | `og` | `:15` |
| `settings.ejs` | `logoFile` | `logo` | `:63` |
| `settings.ejs` | `heroFile` | `hero` | `:77` |

> Galeri sudah memakai `gallery-upload.ejs` dengan `data-slot="gallery"`.
> Backend saat ini memakai slot `card` untuk `galleryFiles` (`admin.routes.js:250,291`).
> **Task 6** akan menyelaraskan backend ke slot `gallery`.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/upload-spec.test.js`, sebelum blok `process.exit`:

  ```js
  // -- Partial admin harus menyebut slot yang benar --------------------
  console.log('\n== Partial admin ==');

  t('image-upload.ejs tidak lagi hardcode data-max-size', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(root, 'views', 'admin', 'partials', 'image-upload.ejs'), 'utf8');
    assert.ok(!/data-max-size="5242880"/.test(src), 'data-max-size masih di-hardcode');
    assert.ok(/data-slot=/.test(src), 'harus ada data-slot');
  });

  t('gallery-upload.ejs memakai slot gallery', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(root, 'views', 'admin', 'partials', 'gallery-upload.ejs'), 'utf8');
    assert.ok(/data-slot="gallery"/.test(src), 'gallery-upload harus data-slot="gallery"');
    assert.ok(!/data-max-size="5242880"/.test(src), 'data-max-size masih di-hardcode');
  });

  t('form artikel memakai slot article, form OG memakai slot og', () => {
    const fs = require('fs');
    const art = fs.readFileSync(
      path.join(root, 'views', 'admin', 'article-form.ejs'), 'utf8');
    assert.ok(/ratio:\s*'article'/.test(art), 'artikel harus ratio article');

    const seo = fs.readFileSync(
      path.join(root, 'views', 'admin', 'seo.ejs'), 'utf8');
    assert.ok(/ratio:\s*'og'/.test(seo), 'SEO harus ratio og');
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/upload-spec.test.js`
  Expected: FAIL — `data-max-size="5242880"` masih ada.

- [ ] **Step 3: Ubah `views/admin/partials/image-upload.ejs`**

  Ganti seluruh isi file dengan:

  ```ejs
  <%
  /**
   * Widget unggah gambar.
   *
   * Parameter:
   *  - name    : nama field pada form (wajib)
   *  - current : URL gambar lama (opsional)
   *  - ratio  : slot gambar — card | article | hero | og | logo | proof | media
   *  - label  : teks label
   *  - hint   : keterangan tambahan (opsional — default diambil dari spesifikasi slot)
   */
  const uploadName = typeof name !== 'undefined' ? name : 'imageFile';
  const uploadCurrent = typeof current !== 'undefined' ? current : '';
  const uploadRatio = typeof ratio !== 'undefined' ? ratio : 'card';
  const uploadLabel = typeof label !== 'undefined' ? label : 'Gambar';
  // Helper text diambil dari spesifikasi slot supaya tidak pernah menyimpang
  // dari batas ukuran yang dipakai server.
  const uploadHint = typeof hint !== 'undefined' && hint
    ? hint
    : (typeof uploadSpecs !== 'undefined' && uploadSpecs
      ? uploadSpecs.get(uploadRatio).hint
      : '');
  %>
  <div class="img-upload" data-ratio="<%= uploadRatio %>" data-slot="<%= uploadRatio %>">
    <div class="img-upload__row">
      <% if (uploadCurrent) { %>
        <img src="<%= uploadCurrent %>" alt="" class="img-upload__preview" data-preview>
      <% } else { %>
        <div class="img-upload__preview img-upload__preview--empty" data-preview-box>
          <span>🖼</span>
          <span>Belum ada gambar</span>
        </div>
      <% } %>
      <div class="img-upload__body">
        <label for="<%= uploadName %>"><%= uploadLabel %></label>
        <input type="file" id="<%= uploadName %>" name="<%= uploadName %>"
               accept="image/jpeg,image/png,image/webp" data-slot-input="<%= uploadRatio %>">
        <div class="img-upload__drop" data-drop tabindex="0" role="button">
          <strong>Klik atau seret gambar ke sini</strong>
          <div class="img-upload__hint"><%= uploadHint %></div>
          <div class="img-upload__filename" data-filename></div>
          <div class="img-upload__meta" data-meta></div>
          <div class="img-upload__warning" data-warning hidden></div>
        </div>
        <div class="img-upload__actions">
          <button type="button" class="btn-a btn-a--ghost btn-a--sm" data-clear hidden>Hapus pilihan</button>
        </div>
      </div>
    </div>
  </div>
  ```

  > `uploadSpecs` harus tersedia sebagai local. Tambahkan di
  > `src/middleware/context.js` (bagian `res.locals`): `res.locals.uploadSpecs = require('../services/image')`.
  > Alternatif yang lebih bersih: partial itu menerima `spec` sebagai parameter.
  > **Pilih yang bersih**: ubah pemanggil partial agar mengirim `spec`.

  Revisi: karena `uploadSpecs` sebagai local EJS tidak tersedia di dalam
  `include` kecuali di-pass, gunakan pendekatan **pass `spec` dari pemanggil**.
  Lihat Step 4.

- [ ] **Step 4: Pass `spec` dari setiap pemanggil partial**

  Di `src/middleware/context.js`, tambahkan satu baris di blok `res.locals`:

  ```js
  // Spesifikasi slot upload — dipakai partial upload untuk menampilkan
  // helper text yang sinkron dengan batas ukuran di server.
  res.locals.uploadSpecs = require('../services/image');
  ```

  Dengan ini `uploadSpecs` tersedia sebagai local di semua template (context
  middleware berjalan untuk semua route). Kode di Step 3 tetap berlaku.

- [ ] **Step 5: Ubah `views/admin/partials/gallery-upload.ejs`**

  Ganti seluruh isi file dengan:

  ```ejs
  <%#
    Widget unggah galeri (banyak berkas sekaligus).

    Parameter:
      - name    : nama field pada form (wajib)
      - current : array URL galeri lama (opsional)
      - label   : teks label
      - hint    : keterangan tambahan (opsional)
      - max     : jumlah maksimal berkas (default 8)
      - slot    : slot gambar (default 'gallery')
  %>
  <%
  const g_name = typeof name !== 'undefined' ? name : 'galleryFiles';
  const g_current = Array.isArray(current) ? current : [];
  const g_label = typeof label !== 'undefined' ? label : 'Galeri Foto';
  const g_slot = typeof slot !== 'undefined' ? slot : 'gallery';
  const g_max = typeof max !== 'undefined' ? max : 8;
  const g_spec = (typeof uploadSpecs !== 'undefined' && uploadSpecs)
    ? uploadSpecs.get(g_slot)
    : null;
  const g_hint = typeof hint !== 'undefined' && hint
    ? hint
    : (g_spec
      ? g_spec.hint + ' · bisa pilih beberapa file sekaligus'
      : '');
  %>
  <div class="gal-upload" data-gal-upload data-max-files="<%= g_max %>" data-slot="<%= g_slot %>">
    <label class="gal-upload__label"><%= g_label %></label>

    <% if (g_current.length) { %>
      <div class="gal-upload__existing">
        <span class="gal-upload__hint"><%= g_current.length %> foto tersimpan. Hapus centang untuk membuang foto.</span>
        <div class="gal-upload__grid">
          <% g_current.forEach(function (u, i) { %>
            <figure class="gal-upload__item">
              <img src="<%= u %>" alt="Galeri foto <%= i + 1 %>" loading="lazy">
              <label class="gal-upload__check">
                <input type="checkbox" name="removeGallery" value="<%= u %>">
                <span>Hapus</span>
              </label>
            </figure>
          <% }); %>
        </div>
      </div>
    <% } %>

    <div class="img-upload__drop gal-upload__drop" data-gal-drop tabindex="0" role="button">
      <strong>Klik atau seret foto ke sini</strong>
      <div class="img-upload__hint"><%= g_hint %></div>
      <div class="img-upload__filename" data-gal-filename></div>
      <div class="img-upload__meta" data-gal-meta></div>
      <div class="img-upload__warning" data-gal-warning hidden></div>
    </div>
    <input type="file" id="<%= g_name %>" name="<%= g_name %>" multiple
           accept="image/jpeg,image/png,image/webp" hidden data-gal-input>
  </div>
  ```

- [ ] **Step 6: Perbarui `public/js/admin-upload.js`**

  Ganti blok konstanta:

  ```js
  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  ```

  menjadi:

  ```js
  // Batas ukuran, format, rasio, dan dimensi minimum diambil dari
  // spesifikasi slot (window.SylUploadSpec) supaya selalu sinkron dengan
  // validasi server. Fallback dipakai hanya bila script belum termuat.
  const SPEC = window.SylUploadSpec || {
    get: function () {
      return {
        maxBytes: 5 * 1024 * 1024,
        mime: ['image/jpeg', 'image/png', 'image/webp'],
        ratio: [16, 10],
        minShortSide: 800,
        hint: 'JPG, PNG, atau WEBP · maksimal 5 MB'
      };
    },
    formatBytes: function (b) {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
      return (Math.round((b / 1048576) * 10) / 10) + ' MB';
    },
    validate: function (file) {
      if (!file) return { ok: false, error: 'Berkas tidak valid.' };
      if (file.size > this.get().maxBytes) {
        return { ok: false, error: 'Ukuran file terlalu besar.' };
      }
      return { ok: true, error: null, warning: null };
    }
  };
  ```

  Ganti fungsi `formatSize` agar memakai `SPEC.formatBytes`:

  ```js
  function formatSize(bytes) {
    return SPEC.formatBytes(bytes);
  }
  ```

  Ganti pembacaan `maxSize` di `initWidget`:

  ```js
  const maxSize = Number(root.dataset.maxSize) || MAX_SIZE;
  ```

  menjadi:

  ```js
  const slotName = root.dataset.slot || root.dataset.ratio || 'card';
  const spec = SPEC.get(slotName);
  const maxSize = spec.maxBytes;
  const warnEl = root.querySelector('[data-warning]');
  ```

  Ganti fungsi `validate` menjadi:

  ```js
  /**
   * Validasi berkas memakai spesifikasi slot.
   * @param {File} file berkas terpilih
   * @returns {{ok: boolean, error: string|null, warning: string|null}}
   */
  function validate(file) {
    return SPEC.validate(file, slotName);
  }
  ```

  Ganti fungsi `applyFile` supaya menampilkan peringatan rasio:

  ```js
  function applyFile(file) {
    const result = validate(file);
    drop.classList.remove('is-error', 'is-ready');
    if (warnEl) {
      warnEl.hidden = true;
      warnEl.textContent = '';
    }
    if (!result.ok) {
      drop.classList.add('is-error');
      filenameEl.textContent = result.error;
      metaEl.textContent = '';
      input.value = '';
      renderPreview(null);
      if (clearBtn) clearBtn.hidden = true;
      return;
    }
    drop.classList.add('is-ready');
    filenameEl.textContent = file.name;
    metaEl.textContent = formatSize(file.size) + ' · ' + file.type.replace('image/', '').toUpperCase();
    if (result.warning && warnEl) {
      warnEl.hidden = false;
      warnEl.textContent = result.warning;
    }
    renderPreview(file);
    if (clearBtn) clearBtn.hidden = false;
  }
  ```

  > Fungsi `renderPreview` tidak berubah, kecuali satu hal penting: pratinjau
  > perlu menampilkan ukuran dimensi. Tambahkan di `renderPreview`, sebelum
  > `reader.readAsDataURL(file)`:
  >
  > ```js
  > const metaEl = root.querySelector('[data-meta]');
  > if (metaEl && file.width && file.height) {
  >   metaEl.textContent = metaEl.textContent + ' · ' + file.width + '×' + file.height + ' px';
  > }
  > ```
  >
  > Ini berlaku setelah `reader.onload` terpicu — taruh di dalam callback.

- [ ] **Step 7: Perbarui `public/js/admin-gallery-widget.js`**

  Ganti blok konstanta:

  ```js
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_SIZE = 5 * 1024 * 1024;
  ```

  menjadi:

  ```js
  // Batas & format diambil dari spesifikasi slot (window.SylUploadSpec).
  const SPEC = window.SylUploadSpec || {
    get: function () {
      return { maxBytes: 5 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp'] };
    },
    formatBytes: function (b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return Math.round(b / 1024) + ' KB';
      return (Math.round((b / 1048576) * 10) / 10) + ' MB';
    },
    validate: function (file) {
      if (!file) return { ok: false, error: 'Berkas tidak valid.' };
      if (file.size > SPEC.get().maxBytes) {
        return { ok: false, error: 'Ukuran file terlalu besar.' };
      }
      return { ok: true, error: null, warning: null };
    }
  };
  ```

  Ganti `formatSize` agar memakai `SPEC.formatBytes`, dan ganti pembacaan:

  ```js
  const maxFiles = Number(root.dataset.maxFiles) || 8;
  const maxSize = Number(root.dataset.maxSize) || MAX_SIZE;
  ```

  menjadi:

  ```js
  const maxFiles = Number(root.dataset.maxFiles) || 8;
  const slotName = root.dataset.slot || 'gallery';
  const spec = SPEC.get(slotName);
  const maxSize = spec.maxBytes;
  ```

  Ganti loop validasi berkas di dalam `applyFiles`:

  ```js
  list.forEach((f) => {
    if (ALLOWED.indexOf(f.type) === -1) problems.push(`${f.name}: format harus JPG, PNG, WEBP, atau GIF.`);
    else if (f.size > maxSize) problems.push(`${f.name}: melebihi ${formatSize(maxSize)}.`);
  });
  ```

  menjadi:

  ```js
  list.forEach((f) => {
    const res = SPEC.validate(f, slotName);
    if (!res.ok) problems.push(f.name + ': ' + res.error);
    else if (res.warning) problems.push(f.name + ': ' + res.warning);
  });
  ```

  > Peringatan rasio untuk galeri ditampilkan sebagai "masalah" — tapi **tidak**
  > membatalkan pilihan. Karena `problems` sekarang memicu `is-error` +
  > `input.value = ''` (berkas dibuang), warning rasio tidak boleh masuk ke
  > `problems`. **Pisahkan**:
  >
  > ```js
  > const problems = [];
  > const warnings = [];
  > list.forEach((f) => {
  >   const res = SPEC.validate(f, slotName);
  >   if (!res.ok) problems.push(f.name + ': ' + res.error);
  >   else if (res.warning) warnings.push(f.name + ': ' + res.warning);
  > });
  > ```
  >
  > Setelah blok `if (problems.length) {...}`, tambahkan:
  >
  > ```js
  > const warnEl = root.querySelector('[data-gal-warning]');
  > if (warnEl) {
  >   warnEl.hidden = warnings.length === 0;
  >   warnEl.textContent = warnings.slice(0, 2).join(' ');
  > }
  > ```

- [ ] **Step 8: Tambahkan CSS untuk elemen peringatan**

  Di `public/css/admin.css` (atau `admin-v2.css`), tambahkan:

  ```css
  /* Peringatan validasi upload (mis. rasio gambar menyimpang). */
  .img-upload__warning {
    margin-top: 0.4rem;
    font-size: 0.78rem;
    line-height: 1.45;
    color: #b26a00;
  }

  .img-upload__warning[hidden] {
    display: none;
  }
  ```

- [ ] **Step 9: Jalankan test, pastikan LULUS**

  Run: `node scripts/upload-spec.test.js`
  Expected: "OK - 25 pemeriksaan lulus".

- [ ] **Step 10: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 11: Commit**

  ```bash
  git add views/admin/partials/image-upload.ejs views/admin/partials/gallery-upload.ejs \
          public/js/admin-upload.js public/js/admin-gallery-widget.js \
          public/css/admin.css src/middleware/context.js scripts/upload-spec.test.js
  git commit -m "feat(upload): widget admin memakai spesifikasi slot dan menampilkan peringatan rasio"
  ```

---
