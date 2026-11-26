'use strict';

/**
 * Ukur overflow horizontal halaman /admin/galeri setelah unggah.
 *
 *Viewport: 1280 (desktop) dan 390 (mobile).
 * Target: scrollWidth <= clientWidth (tidak ada overflow horizontal).
 *
 * Jalankan: node scripts/_layout-check.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const puppeteer = require('puppeteer');

const root = path.join(__dirname, '..');

const MARKUP = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="/css/admin.css">',
  '<link rel="stylesheet" href="/css/admin-gallery.css">',
  '<style>',
  'body{font-family:sans-serif;margin:0;background:#f5f6f8}',
  '.a-card{padding:16px;background:#fff;max-width:900px}',
  '</style></head><body>',
  '<div class="a-card">',
  '<section class="gallery-upload-bundle" id="galleryUploadZone" data-slot="gallery">',
  '  <div class="gallery-upload-bundle__drop" data-drop>',
  '    <p data-gallery-hint></p>',
  '    <label class="gallery-upload-bundle__dest" for="galleryDestinationId">',
  '      <span>Tempelkan ke ID destinasi (opsional)</span>',
  '      <input type="text" id="galleryDestinationId" data-destination-id value="" placeholder="mis. dst_abc123">',
  '    </label>',
  '    <button data-upload disabled>Upload All (WebP)</button>',
  '  </div>',
  '  <input type="file" id="galleryUploadInput" accept="image/jpeg,image/png,image/webp" multiple>',
  '  <div class="gallery-upload-bundle__meta"><span data-filename></span><span data-meta></span></div>',
  '  <div class="gallery-upload-bundle__results" data-upload-results hidden></div>',
  '</section>',
  '</div>',
  '<div id="galleryToastContainer"></div>',
  '</body></html>'
].join('\n');

(async () => {
  // Gambar PNG sungguhan 1280px lebar supaya `<img>` punya naturalWidth
  // 1280 — kondisi yang memicu overflow.
  const sharp = require('sharp');
  const realPng = await sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 30, g: 120, b: 180 } }
  }).png().toBuffer();

  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          files: [{
            filename: 'a.webp',
            url: '/uploads/uji-lebar.webp',
            width: 1280,
            height: 800,
            bytes: 100
          }]
        }));
      });
      return;
    }
    if (req.url.startsWith('/uploads/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(realPng);
      return;
    }
    if (req.url.startsWith('/css/')) {
      const p = path.join(root, 'public', req.url);
      if (fs.existsSync(p)) {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(fs.readFileSync(p));
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MARKUP);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  for (const vp of [{ w: 1280, h: 900, nama: 'desktop' }, { w: 390, h: 844, nama: 'mobile' }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.w, height: vp.h });
    await page.goto(base + '/admin/galeri', { waitUntil: 'load' });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'upload-spec.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'upload-batch.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'admin-gallery-suite.js') });

    const sebelum = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));

    await page.evaluate(() => {
      const input = document.querySelector('#galleryUploadInput');
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(1024)], 'uji.png', { type: 'image/png' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('[data-upload]');
    await new Promise((r) => setTimeout(r, 1200));

    const sesudah = await page.evaluate(() => {
      const img = document.querySelector('.upload-result img');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        imgWidth: img ? img.getBoundingClientRect().width : null,
        imgNatural: img ? img.naturalWidth : null,
        adaImg: !!img
      };
    });

    const ok = sesudah.scrollWidth <= sesudah.clientWidth;
    console.log(
      vp.nama + ' (' + vp.w + 'px):',
      'sebelum scrollWidth=' + sebelum.scrollWidth,
      '| sesudah scrollWidth=' + sesudah.scrollWidth + ' clientWidth=' + sesudah.clientWidth,
      '| img rect=' + sesudah.imgWidth + ' natural=' + sesudah.imgNatural,
      '=> ' + (ok ? 'OK (tidak overflow)' : 'OVERFLOW!')
    );
    await page.close();
  }

  await browser.close();
  server.close();
})();
