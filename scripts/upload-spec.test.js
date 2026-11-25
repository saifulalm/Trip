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

runBackendSuite().then(() => {
  console.log('\n' + (fail === 0
    ? 'OK - ' + pass + ' pemeriksaan lulus'
    : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
  process.exit(fail === 0 ? 0 : 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
