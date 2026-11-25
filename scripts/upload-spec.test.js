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
let skip = 0;
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

/**
 * Catat pemeriksaan yang dilewati (SKIP) — mis. karena lingkungan tidak
 * mendukung (Chromium/puppeteer tidak tersedia). SKIP tidak menggagalkan
 * suite, tapi tetap ditampilkan supaya hasilnya terlihat.
 * @param {string} name nama pemeriksaan
 * @param {string} reason alasan dilewati
 */
function ts(name, reason) {
  skip += 1;
  console.log('  SKIP  ' + name + '  ->  ' + reason);
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

t('getSlotSpec aman terhadap kunci prototype (constructor/toString)', () => {
  // Nama slot bisa berasal dari input pengguna — jangan sampai kunci prototype
  // Object membocorkan objek non-spec (fungsi) ke pemanggil.
  ['constructor', 'toString', 'hasOwnProperty', '__proto__'].forEach((k) => {
    const spec = image.getSlotSpec(k);
    assert.strictEqual(
      spec,
      image.SLOT_SPECS.card,
      'getSlotSpec("' + k + '") harus fallback ke spec card, bukan ' + typeof spec
    );
    assert.strictEqual(typeof spec, 'object');
  });
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

// -- API sisi klien (dijalankan di sandbox browser) ----------------
console.log('\n== API sisi klien ==');

/**
 * Muat `public/js/upload-spec.js` di konteks sandbox yang meniru browser:
 * ada global `window`, dan skrip.IIFE jalan seperti di halaman.
 */
function loadClientModule() {
  const fs = require('fs');
  const vm = require('vm');
  const p = path.join(root, 'public', 'js', 'upload-spec.js');
  const src = fs.readFileSync(p, 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext('var window = this;', ctx);
  vm.runInContext(src, ctx);
  return ctx.SylUploadSpec;
}

t('SylUploadSpec terekspos di window dengan API yang lengkap', () => {
  const S = loadClientModule();
  assert.ok(S, 'SylUploadSpec harus ada');
  ['SLOTS', 'get', 'formatBytes', 'validate', 'acceptAttr'].forEach((k) => {
    assert.ok(S[k] !== undefined, 'API SylUploadSpec.' + k + ' harus ada');
  });
});

/**
 * Bandingkan dua nilai secara struktural (toleran lintas realm `vm`).
 *
 * `assert.deepStrictEqual` menolak objek yang berasal dari realm berbeda
 * karena prototipe `Object`-nya berbeda — padahal nilainya sama persis.
 * Pembanding ini memeriksa kunci dan nilai tanpaabhängi prototipe.
 */
function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every(function (v, i) { return sameValue(v, b[i]); });
  }
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  if (ka.some(function (k, i) { return k !== kb[i]; })) return false;
  return ka.every(function (k) { return sameValue(a[k], b[k]); });
}

t('SylUploadSpec.SLOTS sama nilainya dengan SLOT_SPECS server', () => {
  const S = loadClientModule();
  assert.ok(
    sameValue(S.SLOTS, image.SLOT_SPECS),
    'SLOTS klien harus identik server'
  );
});

t('get() fallback ke card dan aman terhadap kunci prototype', () => {
  const S = loadClientModule();
  assert.strictEqual(S.get('tidak-ada').label, image.SLOT_SPECS.card.label);
  ['constructor', 'toString', '__proto__'].forEach((k) => {
    assert.strictEqual(S.get(k), S.SLOTS.card, 'get("' + k + '") harus fallback ke card');
  });
});

t('formatBytes di klien sama dengan server', () => {
  const S = loadClientModule();
  assert.strictEqual(S.formatBytes(512), '512 B');
  assert.strictEqual(S.formatBytes(500 * 1024), '500 KB');
  assert.strictEqual(S.formatBytes(2 * 1024 * 1024), '2 MB');
  assert.strictEqual(S.formatBytes(8 * 1024 * 1024), '8 MB');
});

t('acceptAttr mengembalikan daftar MIME untuk slot', () => {
  const S = loadClientModule();
  assert.strictEqual(S.acceptAttr('logo'), 'image/png,image/webp');
  assert.strictEqual(
    S.acceptAttr('card'),
    'image/jpeg,image/png,image/webp'
  );
});

t('validate menolak format di luar daftar slot', () => {
  const S = loadClientModule();
  const r = S.validate({ type: 'image/gif', size: 100, width: 1000, height: 1000 }, 'card');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error, 'harus ada pesan error');
  assert.strictEqual(r.warning, null);
});

t('validate menolak berkas melebihi maxBytes slot', () => {
  const S = loadClientModule();
  const r = S.validate(
    { type: 'image/png', size: 600 * 1024, width: 512, height: 512 },
    'logo'
  );
  assert.strictEqual(r.ok, false);
  assert.ok(/500 KB/.test(r.error), r.error);
});

t('validate menolak dimensi terlalu kecil', () => {
  const S = loadClientModule();
  const r = S.validate(
    { type: 'image/png', size: 100, width: 100, height: 100 },
    'card'
  );
  assert.strictEqual(r.ok, false);
  assert.ok(/800/.test(r.error), r.error);
});

t('validate hanya memberi PERINGATAN untuk rasio menyimpang', () => {
  const S = loadClientModule();
  const r = S.validate(
    { type: 'image/png', size: 100, width: 1000, height: 1000 },
    'card'
  );
  assert.strictEqual(r.ok, true, 'rasio menyimpang tidak boleh menolak berkas');
  assert.strictEqual(r.error, null);
  assert.ok(r.warning, 'harus ada peringatan');
});

t('validate menerima berkas yang memenuhi syarat', () => {
  const S = loadClientModule();
  const r = S.validate(
    { type: 'image/png', size: 100, width: 1280, height: 800 },
    'card'
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.warning, null);
});

// -- Pembacaan dimensi sisi klien (sandbox dengan stub browser) --
console.log('\n== Pembacaan dimensi sisi klien ==');

/**
 * Muat modul klien dengan tambahan global tiruan browser.
 *
 * Parameter `extraGlobals` disuntikkan ke konteks sandbox sebagai global
 * (persis seperti di browser nyata), sehingga modul tidak bergantung DOM
 * sungguhan dan bisa diuji di Node.
 */
function loadClientModuleWith(extraGlobals) {
  const fs = require('fs');
  const vm = require('vm');
  const p = path.join(root, 'public', 'js', 'upload-spec.js');
  const src = fs.readFileSync(p, 'utf8');
  const ctx = vm.createContext(Object.assign({}, extraGlobals));
  vm.runInContext('var window = this;', ctx);
  vm.runInContext(src, ctx);
  return ctx.SylUploadSpec;
}

/**
 * Stub `Image` untuk jalur fallback: saat `src` diisi, dimensi disetel lalu
 * `onload` dipanggil pada tick berikutnya.
 */
function makeImageStub(width, height, failWithError) {
  function FakeImage() {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
  }
  Object.defineProperty(FakeImage.prototype, 'src', {
    set: function (value) {
      this._src = value;
      setTimeout(() => {
        if (failWithError) {
          if (this.onerror) this.onerror(new Error('gambar rusak'));
          return;
        }
        this.naturalWidth = width;
        this.naturalHeight = height;
        if (this.onload) this.onload();
      }, 0);
    },
    get: function () { return this._src; }
  });
  return FakeImage;
}

/**
 * Stub `URL` yang mencatat object URL yang dibuat dan yang dicabut —
 * supaya test bisa membuktikan object URL benar-benar dilepas.
 */
function makeUrlStub() {
  const state = { created: [], revoked: [] };
  state.createObjectURL = function () {
    const u = 'blob:mock/' + (state.created.length + 1);
    state.created.push(u);
    return u;
  };
  state.revokeObjectURL = function (u) {
    state.revoked.push(u);
  };
  return state;
}

/**
 * Periksa apakah nilai yang ditolak benar-benar sebuah `Error`.
 *
 * `instanceof Error` TIDAK bisa dipakai di sini: error dibuat di dalam realm
 * sandbox `vm`, sedangkan `Error` di realm test — sehingga `instanceof`
 * selalu salah. `Object.prototype.toString` melihat "nama internal" kelas
 * dan tetap benar lintas realm.
 */
function isError(value) {
  return !!value &&
    Object.prototype.toString.call(value) === '[object Error]' &&
    typeof value.message === 'string';
}

async function runDimensionSuite() {
  await ta('readDimensions tersedia sebagai fungsi', async () => {
    const S = loadClientModuleWith({});
    assert.strictEqual(typeof S.readDimensions, 'function');
  });

  await ta('readDimensions mengembalikan Promise', async () => {
    const S = loadClientModuleWith({
      createImageBitmap: () => Promise.resolve({ width: 100, height: 50 })
    });
    const p = S.readDimensions({ name: 'a.png', type: 'image/png', size: 10 });
    assert.ok(p && typeof p.then === 'function', 'harus mengembalikan Promise');
    await p;
  });

  await ta('readDimensions menolak input invalid dengan Error jelas', async () => {
    const S = loadClientModuleWith({
      createImageBitmap: () => Promise.resolve({ width: 100, height: 50 })
    });
    await assert.rejects(
      () => S.readDimensions(null),
      (err) => {
        assert.ok(isError(err), 'harus menolak dengan Error: ' + err);
        assert.ok(err.message && err.message.length > 0, 'pesan error harus terisi');
        return true;
      }
    );
  });

  await ta('readDimensions memakai createImageBitmap bila tersedia', async () => {
    const seen = [];
    const S = loadClientModuleWith({
      createImageBitmap: (f) => {
        seen.push(f);
        return Promise.resolve({ width: 1280, height: 800 });
      }
    });
    const file = { name: 'a.png', type: 'image/png', size: 10 };
    const dims = await S.readDimensions(file);
    assert.strictEqual(seen.length, 1, 'createImageBitmap harus dipanggil sekali');
    assert.strictEqual(seen[0], file, 'berkas harus diteruskan apa adanya');
    assert.strictEqual(dims.width, 1280);
    assert.strictEqual(dims.height, 800);
  });

  await ta('readDimensions menolak bila createImageBitmap gagal', async () => {
    const S = loadClientModuleWith({
      createImageBitmap: () => Promise.reject(new Error('decode gagal'))
    });
    await assert.rejects(
      () => S.readDimensions({ name: 'a.png', type: 'image/png', size: 10 }),
      (err) => {
        assert.ok(isError(err), 'harus menolak dengan Error: ' + err);
        assert.ok(/gagal/i.test(err.message), 'pesan harus menjelaskan kegagalan: ' + err.message);
        return true;
      }
    );
  });

  await ta('readDimensions jatuh ke jalur Image dan melepas object URL', async () => {
    const urlState = makeUrlStub();
    const S = loadClientModuleWith({
      URL: urlState,
      Image: makeImageStub(640, 480)
    });
    const dims = await S.readDimensions({ name: 'a.png', type: 'image/png', size: 10 });
    assert.strictEqual(dims.width, 640, 'harus memakai naturalWidth');
    assert.strictEqual(dims.height, 480, 'harus memakai naturalHeight');
    assert.strictEqual(urlState.created.length, 1, 'object URL harus dibuat');
    assert.deepStrictEqual(
      urlState.revoked,
      urlState.created,
      'object URL WAJIB dicabut setelah dipakai'
    );
  });

  await ta('readDimensions menolak bila Image gagal memuat', async () => {
    const urlState = makeUrlStub();
    const S = loadClientModuleWith({
      URL: urlState,
      Image: makeImageStub(0, 0, true)
    });
    await assert.rejects(
      () => S.readDimensions({ name: 'a.png', type: 'image/png', size: 10 }),
      (err) => {
        assert.ok(isError(err), 'harus menolak dengan Error: ' + err);
        return true;
      }
    );
    assert.deepStrictEqual(
      urlState.revoked,
      urlState.created,
      'object URL WAJIB dicabut meski gagal memuat'
    );
  });

  await ta('readDimensions menolak bila browser tidak mendukung API gambar', async () => {
    const S = loadClientModuleWith({});
    await assert.rejects(
      () => S.readDimensions({ name: 'a.png', type: 'image/png', size: 10 }),
      (err) => {
        assert.ok(isError(err), 'harus menolak dengan Error: ' + err);
        return true;
      }
    );
  });
}

// -- Validasi backend per-slot -----------------------------------
const upload = require(path.join(root, 'src', 'middleware', 'upload'));
const sharpLib = require(path.join(root, 'node_modules', 'sharp'));

console.log('\n== Validasi backend ==');

/**
 * Uji asinkron: menunggu hasil sebelum menghitung PASS/FAIL.
 * Fungsi ini terpisah dari `t` (sinkron) supaya kasus yang memakai
 * `await` benar-benar dieksekusi, bukan hanya dijadwalkan.
 */
async function ta(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + '  ->  ' + err.message);
  }
}

async function runBackendSuite() {
  await ta('SLOT_BY_FIELD memetakan semua field form yang dipakai', () => {
    assert.ok(upload.SLOT_BY_FIELD, 'SLOT_BY_FIELD harus ada');
    assert.strictEqual(upload.SLOT_BY_FIELD.imageFile, 'card');
    assert.strictEqual(upload.SLOT_BY_FIELD.logoFile, 'logo');
    assert.strictEqual(upload.SLOT_BY_FIELD.heroFile, 'hero');
    assert.strictEqual(upload.SLOT_BY_FIELD.ogFile, 'og');
    assert.strictEqual(upload.SLOT_BY_FIELD.mediaFile, 'media');
    assert.strictEqual(upload.SLOT_BY_FIELD.proof, 'proof');
    assert.strictEqual(upload.SLOT_BY_FIELD.galleryFiles, 'gallery');
  });

  await ta('FIELD_SLOTS yang lama sudah dihapus (dead code)', () => {
    assert.strictEqual(upload.FIELD_SLOTS, undefined, 'FIELD_SLOTS harus dihapus');
  });

  await ta('errSize menyebut batas slot yang benar', () => {
    assert.ok(/500 KB/.test(upload.errSize('logo')), upload.errSize('logo'));
    assert.ok(/2 MB/.test(upload.errSize('card')), upload.errSize('card'));
    assert.ok(/8 MB/.test(upload.errSize('proof')), upload.errSize('proof'));
  });

  await ta('errSize menyebut nama slot (label) di pesan', () => {
    assert.ok(/logo/i.test(upload.errSize('logo')), upload.errSize('logo'));
    assert.ok(/bukti transfer/i.test(upload.errSize('proof')), upload.errSize('proof'));
  });

  await ta('formatBytes memformat ukuran dengan benar', () => {
    assert.strictEqual(upload.formatBytes(512), '512 B');
    assert.strictEqual(upload.formatBytes(500 * 1024), '500 KB');
    assert.strictEqual(upload.formatBytes(2 * 1024 * 1024), '2 MB');
    assert.strictEqual(upload.formatBytes(8 * 1024 * 1024), '8 MB');
  });

  await ta('validateBuffer menolak berkas lebih besar dari maxBytes slot', async () => {
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

  await ta('validateBuffer menolak GIF untuk slot card', async () => {
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

  await ta('validateBuffer menolak JPEG untuk slot logo (MIME per slot)', async () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(64, 0x00)
    ]);
    let err = null;
    try {
      await upload.validateBuffer({ buffer: jpeg, originalname: 'x.jpg' }, 'logoFile', 'logo');
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'harus melempar error');
    assert.strictEqual(err.code, 'INVALID_IMAGE');
    assert.ok(/logo/i.test(err.message), 'pesan harus menyebut slot: ' + err.message);
  });

  await ta('validateBuffer menerima PNG valid untuk slot card', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const out = await upload.validateBuffer({ buffer: png, originalname: 'x.png' }, 'imageFile', 'card');
    assert.strictEqual(out.mime, 'image/png');
    assert.strictEqual(out.ext, 'png');
  });

  await ta('validateBuffer 2 argumen tetap sah: slot diturunkan dari field', async () => {
    const spec = image.getSlotSpec('logo');
    const buffer = Buffer.alloc(spec.maxBytes + 1024, 0x41);
    let err = null;
    try {
      await upload.validateBuffer({ buffer, originalname: 'x.png' }, 'logoFile');
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'harus melempar error');
    assert.strictEqual(err.code, 'LIMIT_FILE_SIZE');
    assert.ok(/500 KB/.test(err.message), 'pesan harus menyebut batas slot: ' + err.message);
  });

  await ta('validateBuffer menolak gambar polos untuk hero (guard lama tetap hidup)', async () => {
    // sharp >= 0.33 memakai `create` untuk membuat gambar solid.
    const solid = await sharpLib({
      create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } }
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

  await ta('dimensi minimum per slot terdefinisi di SLOT_SPECS', () => {
    const expected = {
      card: 800, article: 800, hero: 800, logo: 128,
      og: 630, media: 600, proof: 800, gallery: 800
    };
    Object.keys(expected).forEach((k) => {
      assert.strictEqual(
        image.getSlotSpec(k).minShortSide,
        expected[k],
        'minShortSide slot ' + k
      );
    });
  });
}

// -- Perilaku widget upload di browser sungguhan -------------------
console.log('\n== Widget upload (browser) ==');

/**
 * Uji perilaku widget `.img-upload` di Chromium (puppeteer).
 *
 * Yang dibuktikan:
 *  1. `readDimensions` benar-benar dipanggil SEBELUM validasi,
 *  2. `file.width`/`file.height` terisi dari hasil baca dimensi,
 *  3. gambar di bawah `minShortSide` ditolak dengan pesan jelas,
 *  4. rasio menyimpang hanya PERINGATAN (tidak membatalkan berkas),
 *  5. kegagalan `readDimensions` menampilkan error — bukan diam-diam
 *     melanjutkan validasi tanpa dimensi.
 */
/**
 * Siapkan browser untuk suite UI.
 * Bila `puppeteer` tidak terpasang atau Chromium gagal start, suite
 * di-SKIP (tidak menggagalkan `npm test`) dengan pesan yang jelas.
 * @param {string} label nama suite untuk pesan SKIP
 * @returns {Promise<object|null>} objek browser, atau null bila tidak tersedia
 */
async function openBrowser(label) {
  let puppeteer;
  try {
    puppeteer = require(path.join(root, 'node_modules', 'puppeteer'));
  } catch (err) {
    ts(label, 'browser suite dilewati: puppeteer tidak tersedia');
    return null;
  }
  try {
    return await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (err) {
    ts(label, 'browser suite dilewati: Chromium/puppeteer tidak tersedia');
    return null;
  }
}

/**
 * Stub API gambar di dalam halaman agar dimensi bisa dikendalikan test.
 * Dipakai bersama oleh suite widget tunggal dan suite widget galeri.
 * @param {object} page halaman puppeteer
 */
async function stubBrowserApis(page) {
  await page.evaluate(() => {
    window.__calls = [];
    window.__dims = { width: 1280, height: 800 };
    window.__dimsShouldFail = false;
    window.createImageBitmap = function () {
      window.__calls.push('readDimensions');
      if (window.__dimsShouldFail) return Promise.reject(new Error('decode gagal'));
      return Promise.resolve(window.__dims);
    };
    // FileReader sederhana untuk pratinjau.
    window.FileReader = function () {
      this.onload = null;
      this.readAsDataURL = function () {
        if (this.onload) this.onload({ target: { result: 'data:,' } });
      };
    };
  });
}

/**
 * Pilih beberapa file pada input dan tunggu widget selesai memprosesnya.
 * @param {object} page halaman puppeteer
 * @param {string} selector selektor input file
 * @param {Array<object>} files daftar {name, type}
 */
async function pilihFiles(page, selector, files) {
  await page.evaluate((sel, list) => {
    const input = document.querySelector(sel);
    // File asli + DataTransfer supaya input.files jadi FileList sungguhan.
    const dt = new DataTransfer();
    list.forEach((f) => {
      dt.items.add(new File([new Uint8Array(1024)], f.name, { type: f.type }));
    });
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, selector, files);
  // Tunggu promise di dalam widget selesai.
  await new Promise((r) => setTimeout(r, 200));
}

async function runWidgetSuite() {
  const browser = await openBrowser('suite widget upload tunggal (browser)');
  if (!browser) return;

  try {
    const page = await browser.newPage();

    const MARKUP = [
      '<!doctype html><html><body>',
      '<div class="img-upload" data-slot="card">',
      '  <div class="img-upload__row">',
      '    <div class="img-upload__preview img-upload__preview--empty" data-preview-box></div>',
      '    <div class="img-upload__body">',
      '      <input type="file" id="imageFile" name="imageFile">',
      '      <div class="img-upload__drop" data-drop tabindex="0">',
      '        <div class="img-upload__hint" data-hint data-extra-hint="Rasio 16:10 (contoh 1280x800) - JPG, PNG, WEBP atau GIF - maksimal 5 MB"></div>',
      '        <div class="img-upload__filename" data-filename></div>',
      '        <div class="img-upload__meta" data-meta></div>',
      '        <div class="img-upload__warning" data-warning hidden></div>',
      '      </div>',
      '      <div class="img-upload__actions">',
      '        <button type="button" data-clear hidden>Hapus pilihan</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
      '</body></html>'
    ].join('\n');

    // Stub createImageBitmap: dimensi dikendalikan test.
    await page.setContent(MARKUP);
    await stubBrowserApis(page);

    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'upload-spec.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'admin-upload.js') });

    /** Pilih file pada input dan tunggu widget selesai memprosesnya. */
    async function pilihFile(overrides) {
      await pilihFiles(page, 'input[type="file"]', [{
        name: (overrides && overrides.name) || 'foto.png',
        type: (overrides && overrides.type) || 'image/png'
      }]);
    }

    await ta('hint widget diisi dari spesifikasi slot (batas lama dibuang)', async () => {
      const hint = await page.$eval('[data-hint]', (el) => el.textContent);
      assert.ok(/2 MB/.test(hint), 'hint tidak menyebut batas slot: ' + hint);
      assert.ok(!/5 MB/.test(hint), 'hint masih menyebut batas lama: ' + hint);
    });

    await ta('readDimensions dipanggil sebelum validasi', async () => {
      await page.evaluate(() => { window.__calls = []; });
      await pilihFile({});
      const calls = await page.evaluate(() => window.__calls);
      assert.ok(calls.indexOf('readDimensions') > -1, 'readDimensions tidak dipanggil');
    });

    await ta('file.width dan file.height terisi dari hasil baca dimensi', async () => {
      const dims = await page.evaluate(() => {
        const input = document.querySelector('input[type="file"]');
        return { w: input.files[0].width, h: input.files[0].height };
      });
      assert.strictEqual(dims.w, 1280);
      assert.strictEqual(dims.h, 800);
    });

    await ta('gambar di bawah minShortSide ditolak dengan pesan resolusi', async () => {
      await page.evaluate(() => { window.__dims = { width: 100, height: 100 }; });
      await pilihFile({});
      const txt = await page.$eval('[data-filename]', (el) => el.textContent);
      assert.ok(/800/.test(txt), 'pesan tidak menyebut batas dimensi: ' + txt);
      const isError = await page.$eval('[data-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(isError, 'drop tidak ditandai error');
    });

    await ta('rasio menyimpang hanya PERINGATAN, berkas tidak dibatalkan', async () => {
      await page.evaluate(() => { window.__dims = { width: 1000, height: 1000 }; });
      await pilihFile({});
      const warn = await page.$eval('[data-warning]', (el) => ({
        hidden: el.hidden,
        text: el.textContent
      }));
      assert.ok(!warn.hidden, 'peringatan rasio tidak tampil');
      assert.ok(/rasio/i.test(warn.text), 'teks peringatan kurang jelas: ' + warn.text);
      const isError = await page.$eval('[data-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(!isError, 'peringatan rasio tidak boleh membatalkan berkas');
      const name = await page.$eval('[data-filename]', (el) => el.textContent);
      assert.strictEqual(name, 'foto.png');
    });

    await ta('gagal baca dimensi menampilkan error jelas (tidak lanjut diam-diam)', async () => {
      await page.evaluate(() => { window.__dimsShouldFail = true; });
      await pilihFile({});
      const txt = await page.$eval('[data-filename]', (el) => el.textContent);
      assert.ok(/dimensi/i.test(txt), 'tidak ada pesan error dimensi: ' + txt);
      const isError = await page.$eval('[data-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(isError, 'drop tidak ditandai error');
    });

    await ta('tanpa spesifikasi slot, widget menolak dengan pesan jelas', async () => {
      // Halaman baru TANPA upload-spec.js -> SylUploadSpec tidak termuat.
      const page2 = await browser.newPage();
      await page2.setContent(MARKUP);
      await stubBrowserApis(page2);
      await page2.addScriptTag({ path: path.join(root, 'public', 'js', 'admin-upload.js') });
      await pilihFiles(page2, 'input[type="file"]', [{ name: 'foto.png', type: 'image/png' }]);
      const txt = await page2.$eval('[data-filename]', (el) => el.textContent);
      assert.ok(
        /spesifikasi unggahan tidak termuat/i.test(txt),
        'pesan tidak menjelaskan spesifikasi tidak termuat: ' + txt
      );
      const isError = await page2.$eval('[data-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(isError, 'drop tidak ditandai error');
      await page2.close();
    });
  } finally {
    await browser.close();
  }
}

/**
 * Uji perilaku widget galeri (`[data-gal-upload]`) di Chromium.
 *
 * Yang dibuktikan:
 *  1. `readDimensions` dipanggil PER BERKAS dan `file.width`/`file.height` terisi,
 *  2. rasio menyimpang hanya PERINGATAN (tidak membatalkan pilihan berkas),
 *  3. kegagalan pembacaan dimensi MEMBUANG berkas (files kept = 0) + error,
 *  4. `minShortSide` ditolak untuk gambar kecil.
 *
 * Memakai harness yang sama dengan suite widget tunggal (stub
 * `createImageBitmap`/`FileReader`/`DataTransfer`).
 */
async function runGalleryWidgetSuite() {
  const browser = await openBrowser('suite widget galeri (browser)');
  if (!browser) return;

  const MARKUP = [
    '<!doctype html><html><body>',
    '<div class="gal-upload" data-gal-upload data-max-files="8" data-slot="gallery">',
    '  <label class="gal-upload__label">Galeri Foto</label>',
    '  <div class="img-upload__drop gal-upload__drop" data-gal-drop tabindex="0" role="button">',
    '    <strong>Klik atau seret foto ke sini</strong>',
    '    <div class="img-upload__hint" data-gal-hint data-extra-hint=""></div>',
    '    <div class="img-upload__filename" data-gal-filename></div>',
    '    <div class="img-upload__meta" data-gal-meta></div>',
    '    <div class="img-upload__warning" data-gal-warning hidden></div>',
    '  </div>',
    '  <input type="file" id="galleryFiles" name="galleryFiles" multiple data-gal-input>',
    '</div>',
    '</body></html>'
  ].join('\n');

  try {
    const page = await browser.newPage();
    await page.setContent(MARKUP);
    await stubBrowserApis(page);
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'upload-spec.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'admin-gallery-widget.js') });

    await ta('galeri: readDimensions dipanggil per berkas dan dimensi terisi', async () => {
      await page.evaluate(() => { window.__calls = []; });
      await pilihFiles(page, 'input[type="file"]', [
        { name: 'a.png', type: 'image/png' },
        { name: 'b.png', type: 'image/png' }
      ]);
      const calls = await page.evaluate(() => window.__calls);
      const n = calls.filter((c) => c === 'readDimensions').length;
      assert.strictEqual(n, 2, 'readDimensions harus dipanggil 2x, dapat ' + n);
      const dims = await page.evaluate(() => {
        const input = document.querySelector('input[type="file"]');
        return Array.from(input.files).map((f) => ({ w: f.width, h: f.height }));
      });
      assert.strictEqual(dims.length, 2, 'harus ada 2 berkas');
      dims.forEach((d) => {
        assert.strictEqual(d.w, 1280, 'file.width tidak terisi');
        assert.strictEqual(d.h, 800, 'file.height tidak terisi');
      });
    });

    await ta('galeri: rasio menyimpang hanya PERINGATAN, berkas tidak dibatalkan', async () => {
      await page.evaluate(() => { window.__dims = { width: 1000, height: 1000 }; });
      await pilihFiles(page, 'input[type="file"]', [{ name: 'a.png', type: 'image/png' }]);
      const warn = await page.$eval('[data-gal-warning]', (el) => ({
        hidden: el.hidden,
        text: el.textContent
      }));
      assert.ok(!warn.hidden, 'peringatan rasio tidak tampil');
      assert.ok(/rasio/i.test(warn.text), 'teks peringatan kurang jelas: ' + warn.text);
      const isError = await page.$eval('[data-gal-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(!isError, 'peringatan rasio tidak boleh membatalkan berkas');
      const kept = await page.evaluate(
        () => document.querySelector('input[type="file"]').files.length
      );
      assert.strictEqual(kept, 1, 'berkas harus tetap dipilih');
    });

    await ta('galeri: minShortSide ditolak untuk gambar kecil', async () => {
      await page.evaluate(() => { window.__dims = { width: 100, height: 100 }; });
      await pilihFiles(page, 'input[type="file"]', [{ name: 'kecil.png', type: 'image/png' }]);
      const txt = await page.$eval('[data-gal-filename]', (el) => el.textContent);
      assert.ok(/800/.test(txt), 'pesan tidak menyebut batas dimensi: ' + txt);
      const isError = await page.$eval('[data-gal-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(isError, 'drop tidak ditandai error');
    });

    await ta('galeri: kegagalan baca dimensi membuang berkas dan menampilkan error', async () => {
      await page.evaluate(() => { window.__dimsShouldFail = true; });
      await pilihFiles(page, 'input[type="file"]', [
        { name: 'a.png', type: 'image/png' },
        { name: 'b.png', type: 'image/png' }
      ]);
      const txt = await page.$eval('[data-gal-filename]', (el) => el.textContent);
      assert.ok(/dimensi/i.test(txt), 'tidak ada pesan error dimensi: ' + txt);
      const isError = await page.$eval('[data-gal-drop]', (el) => el.classList.contains('is-error'));
      assert.ok(isError, 'drop tidak ditandai error');
      const kept = await page.evaluate(
        () => document.querySelector('input[type="file"]').files.length
      );
      assert.strictEqual(kept, 0, 'berkas harus dibuang, tersisa ' + kept);
    });
  } finally {
    await browser.close();
  }
}

// -- Partial admin harus menyebut slot yang benar --------------------
console.log('\n== Partial admin ==');

/**
 * Baca file partial admin sebagai teks biasa.
 * @param {string} relPath jalur relatif dari root repo
 * @returns {string} isi file
 */
function readPartial(relPath) {
  const fs = require('fs');
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

t('image-upload.ejs tidak lagi hardcode data-max-size', () => {
  const src = readPartial(path.join('views', 'admin', 'partials', 'image-upload.ejs'));
  assert.ok(!/data-max-size="5242880"/.test(src), 'data-max-size masih di-hardcode');
  assert.ok(/data-slot=/.test(src), 'harus ada data-slot');
});

t('gallery-upload.ejs memakai slot gallery', () => {
  const src = readPartial(path.join('views', 'admin', 'partials', 'gallery-upload.ejs'));
  assert.ok(/data-slot="gallery"/.test(src), 'gallery-upload harus data-slot="gallery"');
  assert.ok(!/data-max-size="5242880"/.test(src), 'data-max-size masih di-hardcode');
});

/**
 * Apakah file form admin sudah memakai partial unggah?
 *
 * Form admin (`article-form.ejs`, `seo.ejs`, dst.) adalah pekerjaan lama
 * (redesign situs) yang belum tentu ikut ter-commit. Assertion slot
 * per-form hanya bermakna bila form itu memang memanggil partial —
 * kalau belum, assertion-nya dilewati (SKIP), bukan gagal.
 *
 * @param {string} relPath jalur relatif file form
 * @returns {boolean} true bila form memakai partial unggah
 */
function formUsesUploadPartial(relPath) {
  let src;
  try {
    src = readPartial(relPath);
  } catch (err) {
    // Form tidak ada di checkout ini — anggap belum memakai partial.
    return false;
  }
  return /include\s*\(\s*['"]partials\/(image-upload|gallery-upload)['"]/.test(src)
    || (/<%-?\s*include\s*\(/.test(src) && /img-upload/.test(src));
}

/**
 * Assertion bersyarat: kalau form memakai partial unggah, slot yang
 * dipakai WAJIB benar; kalau tidak, dilewati (SKIP) dan dicatat.
 * @param {string} formRelPath jalur relatif file form
 * @param {string} slot slot yang diharapkan
 */
function assertFormSlot(formRelPath, slot) {
  const label = path.basename(formRelPath);
  if (!formUsesUploadPartial(formRelPath)) {
    ts('form ' + label + ' memakai slot ' + slot, 'form belum memakai partial unggah');
    return;
  }
  const src = readPartial(formRelPath);
  t('form ' + label + ' memakai slot ' + slot, () => {
    assert.ok(
      new RegExp("ratio:\\s*'" + slot + "'").test(src),
      label + ' harus memakai ratio ' + slot
    );
  });
}

assertFormSlot(path.join('views', 'admin', 'article-form.ejs'), 'article');
assertFormSlot(path.join('views', 'admin', 'seo.ejs'), 'og');

t('widget upload memakai SylUploadSpec, bukan konstanta hardcode', () => {
  const upload = readPartial(path.join('public', 'js', 'admin-upload.js'));
  assert.ok(/SylUploadSpec/.test(upload), 'admin-upload.js harus memakai SylUploadSpec');
  assert.ok(!/const MAX_SIZE = 5 \* 1024 \* 1024/.test(upload), 'MAX_SIZE hardcode masih ada');

  const gallery = readPartial(path.join('public', 'js', 'admin-gallery-widget.js'));
  assert.ok(/SylUploadSpec/.test(gallery), 'admin-gallery-widget.js harus memakai SylUploadSpec');
  assert.ok(
    !/const MAX_SIZE = 5 \* 1024 \* 1024/.test(gallery),
    'MAX_SIZE hardcode masih ada di widget galeri'
  );
});

t('widget upload membaca dimensi SEBELUM validasi (readDimensions lalu validate)', () => {
  const upload = readPartial(path.join('public', 'js', 'admin-upload.js'));
  const dimIdx = upload.indexOf('readDimensions');
  const valIdx = upload.indexOf('SPEC.validate');
  assert.ok(dimIdx > -1, 'admin-upload.js harus memanggil readDimensions');
  assert.ok(valIdx > -1, 'admin-upload.js harus memanggil validate');
  assert.ok(dimIdx < valIdx, 'readDimensions harus dipanggil sebelum validate');
  assert.ok(/file\.width\s*=/.test(upload), 'harus mengisi file.width dari hasil baca dimensi');
  assert.ok(/file\.height\s*=/.test(upload), 'harus mengisi file.height dari hasil baca dimensi');
});

t('widget galeri juga membaca dimensi sebelum validasi', () => {
  const gallery = readPartial(path.join('public', 'js', 'admin-gallery-widget.js'));
  const dimIdx = gallery.indexOf('readDimensions');
  const valIdx = gallery.indexOf('SPEC.validate');
  assert.ok(dimIdx > -1, 'admin-gallery-widget.js harus memanggil readDimensions');
  assert.ok(valIdx > -1, 'admin-gallery-widget.js harus memanggil SPEC.validate');
  assert.ok(dimIdx < valIdx, 'readDimensions harus dipanggil sebelum validate');
});

t('fallback widget tidak lebih longgar daripada slot mana pun', () => {
  // Batas terkecil di antara seluruh slot = logo (500 KB). Fallback tidak
  // boleh lebih longgar dari itu, kalau tidak widget menerima berkas yang
  // server akan tolak saat `upload-spec.js` gagal termuat.
  const batasTertecil = Math.min.apply(null, Object.keys(image.SLOT_SPECS)
    .map((k) => image.SLOT_SPECS[k].maxBytes));

  ['public/js/admin-upload.js', 'public/js/admin-gallery-widget.js'].forEach((rel) => {
    const src = readPartial(path.join(rel));
    const m = src.match(/const FALLBACK_SPEC\s*=\s*\{([\s\S]*?)\}/);
    assert.ok(m, rel + ' harus punya FALLBACK_SPEC');
    const maxBytes = m[1].match(/maxBytes:\s*([0-9* ]+)/);
    assert.ok(maxBytes, rel + ' FALLBACK_SPEC harus punya maxBytes');
    // Hitung nilainya (hanya perkalian sederhana).
    const nilai = maxBytes[1]
      .split('*')
      .map((s) => parseInt(s.trim(), 10))
      .reduce((a, b) => a * b, 1);
    assert.ok(
      nilai <= batasTertecil,
      rel + ' fallback maxBytes ' + nilai + ' lebih longgar dari batas terkecil ' + batasTertecil
    );
  });
});

t('widget menolak dengan pesan jelas bila spesifikasi tidak termuat', () => {
  ['public/js/admin-upload.js', 'public/js/admin-gallery-widget.js'].forEach((rel) => {
    const src = readPartial(path.join(rel));
    assert.ok(
      /Spesifikasi unggahan tidak termuat/.test(src),
      rel + ' harus menampilkan pesan spesifikasi tidak termuat'
    );
    assert.ok(
      /SPEC_AVAILABLE/.test(src),
      rel + ' harus memeriksa ketersediaan spesifikasi'
    );
  });
});

runBackendSuite()
  .then(runDimensionSuite)
  .then(runWidgetSuite)
  .then(runGalleryWidgetSuite)
  .then(() => {
    console.log('\n' + (fail === 0
      ? 'OK - ' + pass + ' pemeriksaan lulus' + (skip ? ', ' + skip + ' dilewati (SKIP)' : '')
      : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
    process.exit(fail === 0 ? 0 : 1);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
