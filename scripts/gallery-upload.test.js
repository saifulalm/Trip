'use strict';

/**
 * Uji end-to-end endpoint unggah galeri (`POST /admin/galeri/unggah`).
 *
 * TUJUAN
 * ------
 * Membuktikan bahwa alur unggah batch di "Gallery Management Suite"
 * benar-benar MENGIRIM BERKAS ke server — bukan simulasi (bug B2 dari
 * audit: tombol "Upload All (WebP)" hanya memutar animasi dots).
 *
 * Yang dibuktikan:
 *  1. `POST /admin/galeri/unggah` menerima multipart `galleryFiles`
 *     dan mengembalikan JSON `{ok, files[]}`.
 *  2. Setiap berkas hasil unggah benar-benar ADA DI DISK sebagai WebP
 *     dan punya dimensi — bukan sekadar URL palsu.
 *  3. `destinationId`(results) memasang URL galeri ke destinasi tujuan;
 *     `kind: 'main'` mengganti gambar utama.
 *  4. Permintaan tanpa berkas → 400; destinationId tak dikenal → 404.
 *  5. Modul sisi klien `public/js/upload-batch.js` benar-benar memanggil
 *     `fetch` dengan POST + FormData berisi berkas (bukan simulasi).
 *
 * Server uji bersifat TERISOLASI: basis data uji memakai folder
 * sementara (SABESI_DATA_DIR) sehingga data/db.json produksi tidak
 * tersentuh. Berkas gambar hasil uji dihapus di akhir skrip.
 *
 * Jalankan: node scripts/gallery-upload.test.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// PENTING: basis data uji harus dipisah dari data produksi.
// `scripts/test-db.js` menyetel `SABESI_DATA_DIR` SEBELUM `src/db`
// dimuat (modul src/db membaca env saat require). JANGAN `db.reset()`
// tanpa isolasi ini — file produksi `data/db.json` akan tertimpa.
const root = path.join(__dirname, '..');
const testDb = require(path.join(__dirname, 'test-db'));
const express = require(path.join(root, 'node_modules', 'express'));
const session = require(path.join(root, 'node_modules', 'express-session'));

const db = require(path.join(root, 'src', 'db'));
const seed = require(path.join(root, 'src', 'seed'));
const imageService = require(path.join(root, 'src', 'services', 'image'));
const adminRoutes = require(path.join(root, 'src', 'routes', 'admin.routes'));

let pass = 0;
let fail = 0;

/**
 * Jalankan satu pemeriksaan asinkron.
 * @param {string} name nama pemeriksaan
 * @param {Function} fn fungsi pemeriksaan
 */
async function t(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + '  ->  ' + err.message);
  }
}

/**
 * PNG valid (1280x800 RGB) untuk uji unggah.
 *
 * Gambar dibuat dengan sharp supaya dijamin benar-benar bisa dibaca
 * sharp — base64 yang ditulis manual kadang rusak ("libpng read error").
 * `toBuffer()` bersifat async, jadi hasilnya di-cache setelah di-await.
 */
let cachedPng = null;
async function tinyPng() {
  if (cachedPng) return cachedPng;
  const sharpLib = require(path.join(root, 'node_modules', 'sharp'));
  cachedPng = await sharpLib({
    create: {
      width: 1280,
      height: 800,
      channels: 3,
      background: { r: 30, g: 120, b: 180 }
    }
  })
    .png()
    .toBuffer();
  return cachedPng;
}

/** Bangun aplikasi uji terisolasi yang me-mount router admin. */
function buildTestApp(userId) {
  const app = express();
  app.use(session({
    secret: 'uji-galeri-terisolasi',
    resave: false,
    saveUninitialized: true
  }));
  // Sesi admin palsu supaya `requireLogin` meloloskan.
  app.use((req, res, next) => {
    req.session.userId = userId;
    req.session.csrf = 'token-uji-galeri';
    next();
  });
  app.use('/admin', adminRoutes);
  return app;
}

/** Mulai server uji pada port bebas dan kembalikan {base, close}. */
function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        base: 'http://127.0.0.1:' + port,
        close: () => new Promise((r) => server.close(r))
      });
    });
    server.on('error', reject);
  });
}

/**
 * Kirim POST multipart ke server uji.
 * @param {string} base URL dasar server
 * @param {string} url jalur endpoint
 * @param {object} fields field teks tambahan
 * @param {Array<{name: string, bytes: Buffer}>} files daftar berkas
 */
async function postMultipart(base, url, fields, files) {
  const fd = new FormData();
  fd.set('_csrf', 'token-uji-galeri');
  Object.keys(fields || {}).forEach((k) => fd.set(k, fields[k]));
  (files || []).forEach((f) => {
    fd.append('galleryFiles', new Blob([f.bytes], { type: 'image/png' }), f.name);
  });
  const res = await fetch(base + url, { method: 'POST', body: fd });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = null;
  }
  return { status: res.status, json: json, text: text };
}

(async () => {
  console.log('\n== Endpoint unggah galeri (server uji terisolasi) ==');

  // Basis data uji berisi satu admin dan satu destinasi.
  const data = seed.buildSeed();
  db.reset(data);
  const adminUser = data.users[0];
  const dest = data.destinations[0];
  const destId = dest.id;

  // PENJAGA ISOLASI: pastikan file basis data yang kita tulis BUKAN file
  // produksi. Kalau `test-db` gagal menyetel env, `db.reset()` akan
  // menimpa `data/db.json` produksi — test ini harus gagal cepat, bukan
  // merusak data asli.
  const prodDb = path.join(root, 'data', 'db.json');
  assert.ok(
    db.DB_FILE !== prodDb,
    'ISOLASI GAGAL: db.DB_FILE menunjuk data/db.json produksi (' + db.DB_FILE + ')'
  );
  assert.ok(
    path.resolve(testDb.DATA_DIR).indexOf(path.resolve(root, 'data')) !== 0,
    'ISOLASI GAGAL: folder data uji berada di dalam folder data produksi'
  );

  const app = buildTestApp(adminUser.id);
  const srv = await startServer(app);

  // Berkas hasil unggah yang harus dibersihkan di akhir skrip.
  const createdFiles = [];

  try {
    await t('POST /admin/galeri/unggah mengembalikan JSON ok + daftar berkas', async () => {
      const png = await tinyPng();
      const r = await postMultipart(srv.base, '/admin/galeri/unggah', { kind: 'gallery' }, [
        { name: 'satu.png', bytes: png },
        { name: 'dua.png', bytes: png }
      ]);
      assert.strictEqual(r.status, 200, 'status harus 200, dapat ' + r.status + ' body=' + r.text);
      assert.ok(r.json, 'respons harus JSON, dapat: ' + r.text);
      assert.strictEqual(r.json.ok, true, 'ok harus true');
      assert.ok(Array.isArray(r.json.files), 'files harus array');
      assert.strictEqual(r.json.files.length, 2, 'harus ada 2 berkas, dapat ' + r.json.files.length);
      r.json.files.forEach((f) => {
        assert.ok(f.filename, 'filename wajib ada');
        assert.ok(/^\/uploads\//.test(f.url), 'url harus menunjuk /uploads/, dapat ' + f.url);
        assert.ok(f.width > 0, 'width harus terisi');
        assert.ok(f.height > 0, 'height harus terisi');
        assert.ok(f.bytes > 0, 'bytes harus terisi');
      });
      createdFiles.push(...r.json.files.map((f) => f.filename));
    });

    await t('berkas hasil unggah benar-benar ada di disk sebagai WebP', async () => {
      assert.ok(createdFiles.length, 'tidak ada berkas hasil unggah');
      const file = createdFiles[0];
      const buf = fs.readFileSync(path.join(root, 'public', 'uploads', file));
      const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF'
        && buf.slice(8, 12).toString('ascii') === 'WEBP';
      assert.ok(isWebp, 'berkas hasil unggah harus WebP');
    });

    await t('unggahan tanpa berkas ditolak dengan 400 + JSON', async () => {
      const r = await postMultipart(srv.base, '/admin/galeri/unggah', {}, []);
      assert.strictEqual(r.status, 400, 'status harus 400, dapat ' + r.status);
      assert.ok(r.json, 'respons harus JSON');
      assert.strictEqual(r.json.ok, false);
      assert.ok(r.json.error, 'harus ada pesan error');
    });

    await t('destinationId tak dikenal ditolak dengan 404', async () => {
      const png = await tinyPng();
      const r = await postMultipart(
        srv.base,
        '/admin/galeri/unggah',
        { destinationId: 'dst_tidak_ada' },
        [{ name: 'x.png', bytes: png }]
      );
      assert.strictEqual(r.status, 404, 'status harus 404, dapat ' + r.status);
      assert.ok(r.json, 'respons harus JSON');
      assert.strictEqual(r.json.ok, false);
    });

    await t('destinationId memasang berkas ke galeri destinasi', async () => {
      const png = await tinyPng();
      const r = await postMultipart(
        srv.base,
        '/admin/galeri/unggah',
        { destinationId: destId, kind: 'gallery' },
        [{ name: 'galeri.png', bytes: png }]
      );
      assert.strictEqual(r.status, 200, 'status harus 200, dapat ' + r.status + ' body=' + r.text);
      createdFiles.push(...(r.json.files || []).map((f) => f.filename));
      const fresh = db.reload();
      const target = fresh.destinations.find((d) => d.id === destId);
      assert.ok(target, 'destinasi harus ada');
      const url = r.json.files[0].url;
      assert.ok(
        (target.gallery || []).includes(url),
        'URL galeri belum terpasang: ' + JSON.stringify(target.gallery)
      );
    });

    await t('kind=main mengganti gambar utama destinasi', async () => {
      const png = await tinyPng();
      const before = db.reload().destinations.find((d) => d.id === destId);
      const oldImage = before.image;
      const r = await postMultipart(
        srv.base,
        '/admin/galeri/unggah',
        { destinationId: destId, kind: 'main' },
        [{ name: 'utama.png', bytes: png }]
      );
      assert.strictEqual(r.status, 200, 'status harus 200, dapat ' + r.status + ' body=' + r.text);
      createdFiles.push(...(r.json.files || []).map((f) => f.filename));
      const after = db.reload().destinations.find((d) => d.id === destId);
      assert.notStrictEqual(after.image, oldImage, 'gambar utama harus berubah');
      assert.strictEqual(after.image, r.json.files[0].url);
    });

    await t('CSRF token salah ditolak dengan 403', async () => {
      const png = await tinyPng();
      const fd = new FormData();
      fd.set('_csrf', 'token-salah');
      fd.append('galleryFiles', new Blob([png], { type: 'image/png' }), 'x.png');
      const res = await fetch(srv.base + '/admin/galeri/unggah', { method: 'POST', body: fd });
      assert.strictEqual(res.status, 403, 'status harus 403, dapat ' + res.status);
    });

    await t('slot galeri dipakai: berkas GIF ditolak (hanya JPG/PNG/WEBP)', async () => {
      const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 0x00)]);
      const fd = new FormData();
      fd.set('_csrf', 'token-uji-galeri');
      fd.append('galleryFiles', new Blob([gif], { type: 'image/gif' }), 'animasi.gif');
      const res = await fetch(srv.base + '/admin/galeri/unggah', { method: 'POST', body: fd });
      assert.ok(res.status >= 400, 'status harus error, dapat ' + res.status);
    });

    // -- Temuan review: error harus JSON, bukan redirect HTML ---------
    await t('MIME tak diizinkan -> 415 + JSON {ok:false,error} (bukan redirect HTML)', async () => {
      const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 0x00)]);
      const fd = new FormData();
      fd.set('_csrf', 'token-uji-galeri');
      fd.append('galleryFiles', new Blob([gif], { type: 'image/gif' }), 'animasi.gif');
      const res = await fetch(srv.base + '/admin/galeri/unggah', { method: 'POST', body: fd });
      const text = await res.text();
      assert.strictEqual(res.status, 415, 'status harus 415, dapat ' + res.status + ' body=' + text.slice(0, 120));
      const json = JSON.parse(text);
      assert.strictEqual(json.ok, false);
      assert.ok(json.error, 'harus ada pesan error');
      assert.ok(
        /tidak diizinkan untuk foto galeri/.test(json.error),
        'pesan per-slot harus utuh, dapat: ' + json.error
      );
    });

    await t('ukuran melebihi batas slot -> 400 + JSON dengan pesan batas per-slot', async () => {
      // Slot gallery = 2 MB. Berkas 3 MB harus ditolak.
      const besar = Buffer.alloc(3 * 1024 * 1024, 0x41);
      const fd = new FormData();
      fd.set('_csrf', 'token-uji-galeri');
      fd.append('galleryFiles', new Blob([besar], { type: 'image/png' }), 'besar.png');
      const res = await fetch(srv.base + '/admin/galeri/unggah', { method: 'POST', body: fd });
      const text = await res.text();
      assert.strictEqual(res.status, 400, 'status harus 400, dapat ' + res.status + ' body=' + text.slice(0, 120));
      const json = JSON.parse(text);
      assert.strictEqual(json.ok, false);
      assert.ok(
        /maksimal 2 MB/.test(json.error),
        'pesan batas per-slot harus sampai ke klien, dapat: ' + json.error
      );
    });

    await t('lebih dari 8 berkas -> 400 + JSON (bukan 500 LIMIT_UNEXPECTED_FILE)', async () => {
      const png = await tinyPng();
      const fd = new FormData();
      fd.set('_csrf', 'token-uji-galeri');
      for (let i = 0; i < 9; i++) {
        fd.append('galleryFiles', new Blob([png], { type: 'image/png' }), 'file' + i + '.png');
      }
      const res = await fetch(srv.base + '/admin/galeri/unggah', { method: 'POST', body: fd });
      const text = await res.text();
      assert.strictEqual(res.status, 400, 'status harus 400, dapat ' + res.status + ' body=' + text.slice(0, 120));
      const json = JSON.parse(text);
      assert.strictEqual(json.ok, false);
      assert.ok(json.error, 'harus ada pesan error');
    });

    // -- Temuan review: kebocoran berkas saat batch gagal ------------
    await t('batch gagal di tengah TIDAK menyisakan berkas yatim di uploads', async () => {
      const png = await tinyPng();
      const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 0x00)]);
      const uploadsDir = path.join(root, 'public', 'uploads');
      const before = fs.readdirSync(uploadsDir);

      const fd = new FormData();
      fd.set('_csrf', 'token-uji-galeri');
      fd.append('galleryFiles', new Blob([png], { type: 'image/png' }), 'valid.png');
      fd.append('galleryFiles', new Blob([gif], { type: 'image/gif' }), 'animasi.gif');
      const res = await fetch(srv.base + '/admin/galeri/unggah', { method: 'POST', body: fd });
      assert.ok(res.status >= 400, 'permintaan harus gagal, dapat ' + res.status);

      const after = fs.readdirSync(uploadsDir);
      const orphan = after.filter((f) => !before.includes(f));
      assert.strictEqual(
        orphan.length,
        0,
        'berkas yatim tertinggal di uploads: ' + JSON.stringify(orphan)
      );
    });

    // -- Temuan review: kind=main dengan >1 berkas -------------------
    await t('kind=main dengan lebih dari 1 berkas ditolak (400 JSON), tanpa berkas yatim', async () => {
      const png = await tinyPng();
      const uploadsDir = path.join(root, 'public', 'uploads');
      const before = fs.readdirSync(uploadsDir);

      const r = await postMultipart(
        srv.base,
        '/admin/galeri/unggah',
        { destinationId: destId, kind: 'main' },
        [
          { name: 'm1.png', bytes: png },
          { name: 'm2.png', bytes: png }
        ]
      );
      assert.strictEqual(r.status, 400, 'status harus 400, dapat ' + r.status + ' body=' + r.text.slice(0, 120));
      assert.strictEqual(r.json.ok, false);
      assert.ok(r.json.error, 'harus ada pesan error');

      const after = fs.readdirSync(uploadsDir);
      const orphan = after.filter((f) => !before.includes(f));
      assert.strictEqual(
        orphan.length,
        0,
        'berkas yatim tertinggal di uploads: ' + JSON.stringify(orphan)
      );
    });
  } finally {
    await srv.close();
  }

  // -- Sisi klien: helper unggah batch benar-benar POST berkas -------
  console.log('\n== Helper unggah batch sisi klien ==');

  /**
   * Muat `public/js/upload-batch.js` di sandbox dengan stub fetch +
   * FormData, lalu buktikan modul benar-benar mengirim berkas.
   */
  function loadBatchModule(stubs) {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(root, 'public', 'js', 'upload-batch.js'), 'utf8');
    const ctx = vm.createContext(Object.assign({ console: console }, stubs));
    vm.runInContext('var window = this;', ctx);
    vm.runInContext(src, ctx);
    return ctx.SylUploadBatch;
  }

  await t('upload-batch.js terekspos di window sebagai SylUploadBatch.upload', async () => {
    const mod = loadBatchModule({
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
      FormData: function () { this.append = function () {}; }
    });
    assert.ok(mod, 'SylUploadBatch harus ada');
    assert.strictEqual(typeof mod.upload, 'function');
  });

  await t('upload() benar-benar POST berkas lewat fetch (bukan simulasi)', async () => {
    const calls = [];
    const mod = loadBatchModule({
      FormData: function () {
        this.items = [];
        this.append = function (name, value) { this.items.push([name, value]); };
      },
      fetch: function (url, opts) {
        calls.push({ url: url, opts: opts });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({
              ok: true,
              files: [{ filename: 'a.webp', url: '/uploads/a.webp', width: 1280, height: 800, bytes: 1234 }]
            });
          }
        });
      }
    });

    const berkas = [
      { name: 'satu.png', type: 'image/png' },
      { name: 'dua.png', type: 'image/png' }
    ];
    const hasil = await mod.upload(berkas, {
      url: '/admin/galeri/unggah',
      field: 'galleryFiles',
      csrfToken: 'token-uji',
      extra: { kind: 'gallery' }
    });

    assert.strictEqual(calls.length, 1, 'fetch harus dipanggil tepat sekali');
    assert.strictEqual(calls[0].url, '/admin/galeri/unggah');
    assert.strictEqual(calls[0].opts.method, 'POST', 'metode harus POST');
    assert.ok(calls[0].opts.body, 'body harus berisi FormData');
    const body = calls[0].opts.body;
    const names = body.items.map((i) => i[0]);
    assert.ok(names.includes('galleryFiles'), 'field galleryFiles harus dikirim');
    assert.strictEqual(
      names.filter((n) => n === 'galleryFiles').length,
      2,
      'kedua berkas harus dikirim'
    );
    assert.ok(names.includes('_csrf'), 'token CSRF harus dikirim');
    assert.ok(names.includes('kind'), 'field tambahan harus dikirim');
    assert.strictEqual(hasil.ok, true, 'hasil ok harus true');
    assert.strictEqual(hasil.files.length, 1, 'hasil harus memuat daftar berkas server');
  });

  await t('upload() menolak berkas kosong tanpa memanggil server', async () => {
    let dipanggil = false;
    const mod = loadBatchModule({
      FormData: function () { this.append = function () {}; },
      fetch: function () { dipanggil = true; return Promise.resolve({}); }
    });
    const hasil = await mod.upload([], {});
    assert.strictEqual(hasil.ok, false);
    assert.ok(hasil.error, 'harus ada pesan error');
    assert.strictEqual(dipanggil, false, 'server tidak boleh dipanggil tanpa berkas');
  });

  await t('upload() melaporkan pesan error dari server', async () => {
    const mod = loadBatchModule({
      FormData: function () { this.append = function () {}; },
      fetch: function () {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: function () { return Promise.resolve({ ok: false, error: 'Format file harus JPG, PNG, WEBP, atau GIF.' }); }
        });
      }
    });
    const hasil = await mod.upload([{ name: 'x.png', type: 'image/png' }], {});
    assert.strictEqual(hasil.ok, false);
    assert.ok(/Format file/.test(hasil.error), 'pesan server harus diteruskan: ' + hasil.error);
  });

  // -- Kebersihan: hapus berkas gambar hasil uji ----------------------
  //
  // CATATAN: folder data uji BERSAMA (testDb.DATA_DIR) TIDAK dihapus di
  // sini. Folder itu dipakai banyak suite (wa-*, hero-mode, dst.) sebagai
  // baseline; menghapusnya di akhir suite ini membuat suite berikutnya
  // membaca basis data kosong. Yang dihapus hanya berkas gambar uji.
  createdFiles.forEach((f) => {
    try {
      fs.unlinkSync(path.join(root, 'public', 'uploads', f));
    } catch (err) {
      // berkas sudah tidak ada — abaikan
    }
  });

  console.log('\n' + (fail === 0
    ? 'OK - ' + pass + ' pemeriksaan lulus'
    : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
