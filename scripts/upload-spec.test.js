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
