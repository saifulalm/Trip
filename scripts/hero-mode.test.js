'use strict';

/**
 * Uji mode hero beranda.
 *
 * Menjamin:
 *  1. `heroMode` bawaan = 'auto' → beranda merender <video>.
 *  2. Gambar polos (stdev < 3) ditolak saat analisis → ditandai polos.
 *  3. Gambar berdetail (poster asli) TIDAK ditandai polos.
 *  4. `heroMode` tersedia di seed dengan nilai 'auto'.
 *  5. `home.ejs` membaca `heroMode` dan tidak bergantung pada ada/tidaknya
 *     gambar unggahan untuk menentukan video.
 *  6. `home.ejs` mengirim `heroVideoEnabled` ke partial hero.
 *  7. Class yatim CSS hero punya definisi.
 *  8. `hero-animated.js` memasang flag `is-playing` saat init DAN saat event.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));
const image = require(path.join(root, 'src', 'services', 'image'));

let pass = 0;
let fail = 0;

async function t(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

(async () => {
  await t('heroMode bawaan = auto', () => {
    const s = db.read().settings || {};
    assert.strictEqual(s.heroMode === undefined ? 'auto' : s.heroMode, 'auto');
  });

  await t('gambar polos terdeteksi (stdev < 3)', async () => {
    // PNG 4x4 merah solid (dibuat langsung supaya base64 selalu valid).
    const sharp = require('sharp');
    const solid = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } }
    })
      .png()
      .toBuffer();
    const r = await image.looksBlank(solid);
    assert.strictEqual(r.blank, true, 'harus terdeteksi polos');
  });

  await t('gambar berdetail TIDAK terdeteksi polos', async () => {
    const real = fs.readFileSync(path.join(root, 'public', 'img', 'hero-island-poster.jpg'));
    const r = await image.looksBlank(real);
    assert.strictEqual(r.blank, false, 'poster asli bukan gambar polos');
  });

  await t('heroMode ada di seed = auto', () => {
    const seed = fs.readFileSync(path.join(root, 'src', 'seed.js'), 'utf8');
    assert.ok(/heroMode:\s*'auto'/.test(seed), 'seed harus punya heroMode: auto');
  });

  await t('home.ejs memilih mode hero dari heroMode', () => {
    const home = fs.readFileSync(path.join(root, 'views', 'pages', 'home.ejs'), 'utf8');
    assert.ok(/heroMode/.test(home), 'home.ejs harus membaca heroMode');
    assert.ok(
      !/const heroUsesVideo = !heroCustomImage;/.test(home),
      'heroUsesVideo tidak boleh hanya bergantung pada ada/tidaknya gambar'
    );
  });

  await t('home.ejs mengirim heroVideoEnabled ke partial hero', () => {
    const home = fs.readFileSync(path.join(root, 'views', 'pages', 'home.ejs'), 'utf8');
    assert.ok(
      /heroVideoEnabled:\s*heroUsesVideo/.test(home),
      'home.ejs harus mengirim heroVideoEnabled'
    );
  });

  await t('class yatim hero-search__field--dest/--date punya definisi CSS', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'hero-animated.css'), 'utf8');
    assert.ok(/\.hero-search__field--dest\b/.test(css), 'hero-search__field--dest belum ada di CSS');
    assert.ok(/\.hero-search__field--date\b/.test(css), 'hero-search__field--date belum ada di CSS');
  });

  await t('hero-animated.css punya mode gambar (tanpa video)', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'hero-animated.css'), 'utf8');
    assert.ok(/\.hero-video\.is-static\b/.test(css), 'perlu kelas is-static untuk mode gambar');
  });

  await t('hero-animated.js memasang flag is-playing saat init DAN saat event', () => {
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'hero-animated.js'), 'utf8');
    const hasInitCheck = /readyState\s*>=\s*2[\s\S]{0,200}is-playing/.test(js);
    const hasEvent = /addEventListener\(\s*'loadeddata'/.test(js);
    assert.ok(hasInitCheck, 'cek readyState saat init wajib ada');
    assert.ok(hasEvent, 'listener loadeddata wajib ada');
  });

  await t('hero-animated.js punya jaring pengaman timeout 6 detik', () => {
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'hero-animated.js'), 'utf8');
    assert.ok(/6000/.test(js), 'harus ada fallback 6 detik');
  });

  await t('hero-animated.js memaksa play() saat tab kembali aktif', () => {
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'hero-animated.js'), 'utf8');
    assert.ok(/visibilitychange/.test(js), 'perlu penanganan visibilitychange');
  });

  await t('admin CSS punya kelas untuk panel realtime', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin-v3.css'), 'utf8');
    assert.ok(/\.a-live\b/.test(css), 'perlu indikator koneksi realtime .a-live');
  });

  console.log(fail === 0 ? '\nSemua suite lulus.' : `\n${fail} gagal.`);
  process.exit(fail === 0 ? 0 : 1);
})();
