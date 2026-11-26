
# FASE 1 — Standarisasi Upload Gambar / Media

## Task 2: Buat sumber kebenaran spesifikasi slot (`SLOT_SPECS`)

**Files:**
- Modify: `src/services/image.js` (tambah blok `SLOT_SPECS`; perbarui blok `SLOTS`)
- Test: `scripts/upload-spec.test.js` (BARU)

**Interfaces:**
- Consumes: tidak ada.
- Produces (dipakai Task 3, 4, 5, 6):
  - `SLOT_SPECS: Record<string, {width:number, height:number, fit:'cover'|'contain'|'inside', label:string, ratio:[number,number], maxBytes:number, mime:string[], minShortSide:number, hint:string}>`
  - `getSlotSpec(slotName: string): object` — fallback ke spec `card` bila slot tak dikenal.
  - `SLOTS` yang ada **tetap dipertahankan** (dipakai `processImage`) — bentuknya `{width, height, fit, label}`.
  - `MAX_FILE_SIZE` **tetap 5 MB** sebagai batas atas absolut (top-level). Batas per-slot lebih kecil kecuali `proof` (8 MB).

**Nilai persis yang harus dipakai** (sumber: audit `docs/audit-2026-11-25-empat-fokus.md` bagian A.4):

| Slot | width | height | fit | ratio | maxBytes | mime | minShortSide |
|---|---|---|---|---|---|---|---|
| `card` | 1280 | 800 | cover | 16:10 | 2097152 (2 MB) | jpeg,png,webp | 800 |
| `article` | 1280 | 720 | cover | 16:9 | 2097152 (2 MB) | jpeg,png,webp | 800 |
| `hero` | 1920 | 1080 | cover | 16:9 | 4194304 (4 MB) | jpeg,png,webp | 800 |
| `logo` | 512 | 512 | contain | 1:1 | 512000 (500 KB) | png,webp | 128 |
| `og` | 1200 | 630 | cover | 1200:630 | 1048576 (1 MB) | jpeg,png,webp | 630 |
| `media` | 1200 | 1200 | inside | 1:1 | 3145728 (3 MB) | jpeg,png,webp | 600 |
| `proof` | 1600 | 1200 | inside | 4:3 | 8388608 (8 MB) | jpeg,png,webp | 800 |
| `gallery` | 1280 | 800 | cover | 16:10 | 2097152 (2 MB) | jpeg,png,webp | 800 |

Catatan: `gallery` adalah **slot baru** (sebelumnya galeri memakai slot `card`).

GIF sengaja tidak diizinkan di slot mana pun: tidak ada satu pun tempat di situs ini
yang memutar animasi, dan `processImage` hanya mengambil frame pertama GIF — jadi GIF
hanya menambah ukuran berkas tanpa manfaat.

- [ ] **Step 1: Tulis test yang gagal**

  Create `scripts/upload-spec.test.js`:

  ```js
  'use strict';

  /**
   * Uji spesifikasi slot upload — sumber kebenaran ukuran, rasio, format,
   * dan batas ukuran per slot.
   *
   * Jalankan: node scripts/upload-spec.test.js
   */

  const assert = require('assert');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const image = require(path.join(root, 'src', 'services', 'image'));

  let pass = 0;
  let fail = 0;
  function t(name, fn) {
    try {
      fn();
      pass += 1;
      console.log('  PASS  ' + name);
    } catch (err) {
      fail += 1;
      console.log('  FAIL  ' + name + '  ->  ' + err.message);
    }
  }

  console.log('\n== Spesifikasi slot upload ==');

  t('SLOT_SPECS ada dan punya 8 slot', () => {
    assert.ok(image.SLOT_SPECS, 'SLOT_SPECS harus ada');
    const keys = Object.keys(image.SLOT_SPECS).sort();
    assert.deepStrictEqual(
      keys,
      ['article', 'card', 'gallery', 'hero', 'logo', 'media', 'og', 'proof']
    );
  });

  t('card: 16:10, 1280x800, 2 MB', () => {
    const s = image.SLOT_SPECS.card;
    assert.strictEqual(s.width, 1280);
    assert.strictEqual(s.height, 800);
    assert.strictEqual(s.maxBytes, 2097152);
    assert.deepStrictEqual(s.ratio, [16, 10]);
    assert.strictEqual(s.fit, 'cover');
  });

  t('hero: 16:9, 1920x1080, 4 MB', () => {
    const s = image.SLOT_SPECS.hero;
    assert.strictEqual(s.width, 1920);
    assert.strictEqual(s.height, 1080);
    assert.strictEqual(s.maxBytes, 4194304);
    assert.deepStrictEqual(s.ratio, [16, 9]);
  });

  t('logo: 1:1, 512x512, 500 KB, tanpa GIF', () => {
    const s = image.SLOT_SPECS.logo;
    assert.strictEqual(s.width, 512);
    assert.strictEqual(s.height, 512);
    assert.strictEqual(s.maxBytes, 512000);
    assert.deepStrictEqual(s.ratio, [1, 1]);
    assert.strictEqual(s.fit, 'contain');
    assert.ok(!s.mime.includes('image/gif'), 'GIF tidak boleh diizinkan');
  });

  t('proof: 4:3, 1600x1200, 8 MB (bukti transfer boleh besar)', () => {
    const s = image.SLOT_SPECS.proof;
    assert.strictEqual(s.width, 1600);
    assert.strictEqual(s.height, 1200);
    assert.strictEqual(s.maxBytes, 8388608);
    assert.deepStrictEqual(s.ratio, [4, 3]);
    assert.strictEqual(s.fit, 'inside');
  });

  t('og: 1200x630, 1 MB', () => {
    const s = image.SLOT_SPECS.og;
    assert.strictEqual(s.width, 1200);
    assert.strictEqual(s.height, 630);
    assert.strictEqual(s.maxBytes, 1048576);
  });

  t('gallery: slot terpisah, 16:10, 2 MB', () => {
    const s = image.SLOT_SPECS.gallery;
    assert.strictEqual(s.maxBytes, 2097152);
    assert.deepStrictEqual(s.ratio, [16, 10]);
    assert.notStrictEqual(s, image.SLOT_SPECS.card, 'gallery harus slot sendiri');
  });

  t('media: 1:1, 1200x1200, 3 MB, fit inside', () => {
    const s = image.SLOT_SPECS.media;
    assert.strictEqual(s.width, 1200);
    assert.strictEqual(s.height, 1200);
    assert.strictEqual(s.maxBytes, 3145728);
    assert.strictEqual(s.fit, 'inside');
  });

  t('article: 16:9, 1280x720, 2 MB', () => {
    const s = image.SLOT_SPECS.article;
    assert.strictEqual(s.width, 1280);
    assert.strictEqual(s.height, 720);
    assert.strictEqual(s.maxBytes, 2097152);
    assert.deepStrictEqual(s.ratio, [16, 9]);
  });

  t('tidak ada slot yang mengizinkan GIF', () => {
    Object.keys(image.SLOT_SPECS).forEach((k) => {
      const s = image.SLOT_SPECS[k];
      assert.ok(
        !s.mime.includes('image/gif'),
        'slot ' + k + ' masih mengizinkan GIF'
      );
    });
  });

  t('getSlotSpec mengembalikan spec, dan fallback ke card', () => {
    assert.strictEqual(image.getSlotSpec('hero').width, 1920);
    assert.strictEqual(image.getSlotSpec('tidak-ada').width, image.SLOT_SPECS.card.width);
  });

  t('SLOTS lama tetap sinkron dengan SLOT_SPECS (width/height/fit)', () => {
    Object.keys(image.SLOT_SPECS).forEach((k) => {
      const spec = image.SLOT_SPECS[k];
      if (!image.SLOTS[k]) return;
      assert.strictEqual(image.SLOTS[k].width, spec.width, 'width slot ' + k);
      assert.strictEqual(image.SLOTS[k].height, spec.height, 'height slot ' + k);
      assert.strictEqual(image.SLOTS[k].fit, spec.fit, 'fit slot ' + k);
    });
  });

  t('maxBytes tiap slot <= MAX_FILE_SIZE absolut, kecuali proof', () => {
    Object.keys(image.SLOT_SPECS).forEach((k) => {
      if (k === 'proof') return;
      assert.ok(
        image.SLOT_SPECS[k].maxBytes <= image.MAX_FILE_SIZE,
        'slot ' + k + ' melebihi batas absolut'
      );
    });
    assert.ok(image.SLOT_SPECS.proof.maxBytes > image.MAX_FILE_SIZE);
  });

  console.log('\n' + (fail === 0
    ? 'OK - ' + pass + ' pemeriksaan lulus'
    : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
  process.exit(fail === 0 ? 0 : 1);
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/upload-spec.test.js`
  Expected: FAIL pada test pertama — `SLOT_SPECS` undefined.

- [ ] **Step 3: Implementasikan `SLOT_SPECS` di `src/services/image.js`**

  Tambahkan blok ini **setelah** deklarasi `const SLOTS = { ... };` (sekitar baris 53)
  dan **sebelum** `const SIGNATURES`:

  ```js
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
  ```

  Lalu **perbarui** blok `SLOTS` agar punya entri `gallery` dan sinkron dengan
  `SLOT_SPECS` (nilai width/height/fit/label WAJIB sama persis):

  ```js
  const SLOTS = {
    card: { width: 1280, height: 800, fit: 'cover', label: 'gambar kartu' },
    article: { width: 1280, height: 720, fit: 'cover', label: 'gambar sampul artikel' },
    hero: { width: 1920, height: 1080, fit: 'cover', label: 'gambar hero' },
    logo: { width: 512, height: 512, fit: 'contain', label: 'logo' },
    og: { width: 1200, height: 630, fit: 'cover', label: 'gambar OG' },
    proof: { width: 1600, height: 1200, fit: 'inside', label: 'bukti transfer' },
    media: { width: 1200, height: 1200, fit: 'inside', label: 'media media sosial' },
    gallery: { width: 1280, height: 800, fit: 'cover', label: 'foto galeri' }
  };
  ```

  Catatan: `SLOTS.card` sebelumnya TIDAK punya `fit` eksplisit (default `'cover'` di
  `processImage`). Sekarang ditulis eksplisit — perilakunya sama.

- [ ] **Step 4: Exportkan `SLOT_SPECS` dan `getSlotSpec`**

  Di `src/services/image.js`, pada `module.exports`, tambahkan `SLOT_SPECS,` dan
  `getSlotSpec,` (letakkan setelah `SLOTS,`).

- [ ] **Step 5: Jalankan test, pastikan LULUS**

  Run: `node scripts/upload-spec.test.js`
  Expected: "OK - 13 pemeriksaan lulus".

- [ ] **Step 6: Daftarkan suite baru di runner**

  Di `scripts/wa-run-tests.js`, pada array `suites`, tambahkan `'upload-spec.test.js'`
  **setelah** `'geo-trip.test.js'`.

- [ ] **Step 7: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 8: Commit**

  ```bash
  git add src/services/image.js scripts/upload-spec.test.js scripts/wa-run-tests.js
  git commit -m "feat(upload): tambah SLOT_SPECS sebagai sumber kebenaran ukuran dan rasio per slot"
  ```

---

## Task 3: Validasi backend per-slot (ukuran, MIME, dimensi minimum)

**Files:**
- Modify: `src/middleware/upload.js` (import, `SLOT_BY_FIELD`, `validateBuffer`, limits, exports)
- Test: `scripts/upload-spec.test.js` (tambah suite backend)

**Interfaces:**
- Consumes: `getSlotSpec(slotName)` (Task 2), `detectFormat(buffer)` (sudah ada di `image.js`).
- Produces:
  - `SLOT_BY_FIELD: Record<string,string>` — pemetaan nama field form ke nama slot. Menggantikan `FIELD_SLOTS` yang mati.
  - `validateBuffer(file, field, slotName)` — signature **diperluas** dengan parameter ketiga. Pemanggil lama yang hanya 2 argumen tetap valid (slot diturunkan dari `field`).
  - `errSize(slotName): string` — pesan error batas ukuran **per slot**. Menggantikan konstanta `ERR_SIZE`.
  - `formatBytes(bytes): string` — helper format ukuran.
  - `ABSOLUTE_MAX_FILE_SIZE` = 8 MB — batas atas mutlak di level multer (batas per-slot lebih ketat, kecuali `proof`).

**Peta field ke slot (nama field form TIDAK boleh berubah):**

| Field form | Slot |
|---|---|
| `imageFile` | `card` |
| `logoFile` | `logo` |
| `heroFile` | `hero` |
| `ogFile` | `og` |
| `mediaFile` | `media` |
| `proof` | `proof` |
| `galleryFiles` | `gallery` |

> Penting: `imageFile` dipakai untuk **paket** dan **artikel** juga, yang idealnya
> slot `article`. Nama field tidak boleh berubah (constraint global) dan
> `scripts/verify-admin-audit.js` bergantung padanya. Solusi: `singleImage(field, slot)`
> sudah menerima slot eksplisit sebagai argumen kedua — pemanggil di
> `src/routes/admin.routes.js:529` dan `:559` sudah mengirim `'article'`.
> `multiImage` / `galleryImages` / `imageFields` juga harus menghormati slot eksplisit
> dari pemanggil, BUKAN selalu menebak dari nama field.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/upload-spec.test.js`, sebelum blok `process.exit`:

  ```js
  // -- Validasi backend per-slot -----------------------------------
  const upload = require(path.join(root, 'src', 'middleware', 'upload'));
  const sharpLib = require(path.join(root, 'node_modules', 'sharp'));

  console.log('\n== Validasi backend ==');

  t('SLOT_BY_FIELD memetakan semua field form yang dipakai', () => {
    assert.ok(upload.SLOT_BY_FIELD, 'SLOT_BY_FIELD harus ada');
    assert.strictEqual(upload.SLOT_BY_FIELD.imageFile, 'card');
    assert.strictEqual(upload.SLOT_BY_FIELD.logoFile, 'logo');
    assert.strictEqual(upload.SLOT_BY_FIELD.heroFile, 'hero');
    assert.strictEqual(upload.SLOT_BY_FIELD.ogFile, 'og');
    assert.strictEqual(upload.SLOT_BY_FIELD.mediaFile, 'media');
    assert.strictEqual(upload.SLOT_BY_FIELD.proof, 'proof');
    assert.strictEqual(upload.SLOT_BY_FIELD.galleryFiles, 'gallery');
  });

  t('FIELD_SLOTS yang lama sudah dihapus (dead code)', () => {
    assert.strictEqual(upload.FIELD_SLOTS, undefined, 'FIELD_SLOTS harus dihapus');
  });

  t('errSize menyebut batas slot yang benar', () => {
    assert.ok(/500 KB/.test(upload.errSize('logo')), upload.errSize('logo'));
    assert.ok(/2 MB/.test(upload.errSize('card')), upload.errSize('card'));
    assert.ok(/8 MB/.test(upload.errSize('proof')), upload.errSize('proof'));
  });

  t('validateBuffer menolak berkas lebih besar dari maxBytes slot', async () => {
    const spec = image.getSlotSpec('logo');
    const buffer = Buffer.alloc(spec.maxBytes + 1024, 0x41);
    let err = null;
    try {
      await upload.validateBuffer({ buffer, originalname: 'x.png' }, 'logoFile', 'logo');
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'harus melempar error');
    assert.strictEqual(err.code, 'LIMIT_FILE_SIZE');
    assert.ok(/500 KB/.test(err.message), 'pesan harus menyebut batas slot: ' + err.message);
  });

  t('validateBuffer menolak GIF untuk slot card', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 0x00)]);
    let err = null;
    try {
      await upload.validateBuffer({ buffer: gif, originalname: 'x.gif' }, 'imageFile', 'card');
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'harus melempar error');
    assert.strictEqual(err.code, 'INVALID_IMAGE');
  });

  t('validateBuffer menerima PNG valid untuk slot card', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const out = await upload.validateBuffer({ buffer: png, originalname: 'x.png' }, 'imageFile', 'card');
    assert.strictEqual(out.mime, 'image/png');
    assert.strictEqual(out.ext, 'png');
  });

  t('validateBuffer menolak gambar polos untuk hero (guard lama tetap hidup)', async () => {
    const solid = await sharpLib(64, 64, {
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }).png().toBuffer();
    let err = null;
    try {
      await upload.validateBuffer({ buffer: solid, originalname: 'x.png' }, 'heroFile', 'hero');
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'harus melempar error');
    assert.strictEqual(err.code, 'BLANK_IMAGE');
  });
  ```

  Catatan: fungsi `validateBuffer` saat ini **tidak** diekspor. Task ini wajib
  mengekspornya supaya bisa diuji langsung.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/upload-spec.test.js`
  Expected: FAIL — `upload.SLOT_BY_FIELD` undefined dan `upload.validateBuffer` undefined.

- [ ] **Step 3: Ganti import di `src/middleware/upload.js`**

  Ganti blok import:

  ```js
  const {
    MAX_FILE_SIZE,
    detectFormat,
    processImage,
    looksBlank,
    looksTransparent,
    removeUpload: removeUploadByFilename
  } = require('../services/image');
  ```

  menjadi:

  ```js
  const {
    MAX_FILE_SIZE,
    detectFormat,
    processImage,
    looksBlank,
    looksTransparent,
    getSlotSpec,
    removeUpload: removeUploadByFilename
  } = require('../services/image');
  ```

- [ ] **Step 4: Ganti `FIELD_SLOTS` dengan `SLOT_BY_FIELD`, tambah batas mutlak**

  Ganti blok `const FIELD_SLOTS = { ... };` menjadi:

  ```js
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
  ```

  Dan ganti `const MAX_FILES = 12;` menjadi:

  ```js
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
   */
  const ABSOLUTE_MAX_FILE_SIZE = 8 * 1024 * 1024;
  ```

- [ ] **Step 5: Tulis ulang `validateBuffer` menjadi per-slot**

  Ganti fungsi `validateBuffer(file, field)` menjadi:

  ```js
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
  ```

- [ ] **Step 6: Teruskan `slot` ke semua pemanggil `validateBuffer`**

  Di `singleImage(field, slot)` — sudah punya variabel `slot`; ubah:
  `await validateBuffer(req.file, field);` -> `await validateBuffer(req.file, field, slot);`

  Di `multiImage(fields)` — tiap entri punya `f.slot`; ubah:
  `await validateBuffer(list[0], f.name);` -> `await validateBuffer(list[0], f.name, f.slot);`

  Di `galleryImages(field, slot, maxCount)` — sudah punya `slot`; ubah:
  `await validateBuffer(file, field);` -> `await validateBuffer(file, field, slot);`

  Di `imageFields(fields)` — tiap entri punya `f.slot`; ubah:
  `await validateBuffer(file, f.name);` -> `await validateBuffer(file, f.name, f.slot);`

- [ ] **Step 7: Ubah limits multer**

  Ganti:

  ```js
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES }
  });
  ```

  menjadi:

  ```js
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ABSOLUTE_MAX_FILE_SIZE, files: MAX_FILES }
  });
  ```

- [ ] **Step 8: Perbarui exports**

  Di `module.exports` `src/middleware/upload.js`:
  - **Hapus** `FIELD_SLOTS,`
  - **Hapus** `ERR_SIZE,` (konstanta lama "Ukuran gambar maksimal 5 MB." — tidak lagi berlaku)
  - **Tambahkan** `SLOT_BY_FIELD,` `validateBuffer,` `formatBytes,` `errSize,`

  > **PERHATIAN — konsumen `ERR_SIZE`:** `src/app.js:86-97` punya array `uploadErrors`
  > berisi string hardcode `'Ukuran gambar maksimal 5 MB.'`. Harus diperbarui di
  > Task 4 supaya array itu tetap sinkron dengan batas per-slot.

- [ ] **Step 9: Jalankan test, pastikan LULUS**

  Run: `node scripts/upload-spec.test.js`
  Expected: "OK - 19 pemeriksaan lulus" (13 dari Task 2 + 6 baru).

- [ ] **Step 10: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

  > Jika `scripts/verify-upload-invalid.js` atau `verify-upload.js` gagal karena
  > batas ukuran berubah, perbarui **ekspektasinya** — bukan logikanya.

- [ ] **Step 11: Commit**

  ```bash
  git add src/middleware/upload.js scripts/upload-spec.test.js
  git commit -m "feat(upload): validasi backend per-slot untuk ukuran, format, dan dimensi"
  ```

---
