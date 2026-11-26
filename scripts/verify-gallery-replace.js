'use strict';
/**
 * Uji konsistensi galeri saat gambar utama Destinasi diganti.
 *
 * Saat admin mengunggah gambar utama baru, gambar utama LAMA tidak boleh
 * tetap tertinggal di galeri (dan berkasnya tidak boleh yatim di disk).
 *
 * Jalankan: PORT=41xx node scripts/verify-gallery-replace.js
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:' + (process.env.PORT || 4110);
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const DB = path.join(__dirname, '..', 'data', 'db.json');

let cookie = '';

/** Simpan cookie session dari respons. */
function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const p = c.split(';')[0];
    const [n] = p.split('=');
    cookie = cookie.split('; ').filter((x) => x && !x.startsWith(n + '=')).concat([p]).join('; ');
  }
}

/** Permintaan HTTP dengan cookie session. */
async function req(u, o = {}) {
  const r = await fetch(BASE + u, { redirect: 'manual', ...o, headers: { cookie, ...(o.headers || {}) } });
  saveCookie(r);
  return r;
}

/** Ambil token CSRF dari HTML. */
function csrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/** PNG 1x1 yang valid. */
function png() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

/** Baca database. */
const readDb = () => JSON.parse(fs.readFileSync(DB, 'utf8'));

/** Daftar berkas di folder uploads. */
function listUploads() {
  return fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.gitkeep')) : [];
}

(async () => {
  const lp = await req('/admin/login');
  const lt = csrf(await lp.text());
  await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: lt, username: 'admin', password: 'admin123' }).toString()
  });

  // --- Buat destinasi: 1 gambar utama + 2 foto galeri --------------------
  const fp = await req('/admin/destinasi/baru');
  const t = csrf(await fp.text());
  const fd = new FormData();
  fd.set('_csrf', t);
  fd.set('name', 'Uji Ganti Utama Galeri');
  fd.set('region', 'Uji Region');
  fd.set('description', 'Deskripsi uji konsistensi galeri saat gambar utama diganti.');
  fd.set('imageFile', new Blob([png()], { type: 'image/png' }), 'main.png');
  fd.append('galleryFiles', new Blob([png()], { type: 'image/png' }), 'g1.png');
  fd.append('galleryFiles', new Blob([png()], { type: 'image/png' }), 'g2.png');
  await req('/admin/destinasi', { method: 'POST', body: fd });

  const lp2 = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Ganti Utama Galeri'));
  const html = await lp2.text();
  const idm = html.match(/\/admin\/destinasi\/([\w-]+)\/edit/);
  const id = idm && idm[1];
  if (!id) throw new Error('entri uji tidak dibuat');

  const before = readDb().destinations.find((d) => d.id === id);
  const oldMain = before.image;
  console.log('gambar utama lama :', oldMain);
  console.log('galeri lama        :', before.gallery.length, 'foto');
  console.log('galeri memuat utama:', before.gallery.includes(oldMain));

  // --- Ganti gambar utama (tanpa menyentuh checkbox galeri) --------------
  const ep = await req('/admin/destinasi/' + id + '/edit');
  const et = csrf(await ep.text());
  const fd2 = new FormData();
  fd2.set('_csrf', et);
  fd2.set('name', 'Uji Ganti Utama Galeri');
  fd2.set('region', 'Uji Region');
  fd2.set('description', 'Deskripsi uji konsistensi galeri saat gambar utama diganti.');
  fd2.set('imageFile', new Blob([png()], { type: 'image/png' }), 'main2.png');
  await req('/admin/destinasi/' + id, { method: 'POST', body: fd2 });

  const after = readDb().destinations.find((d) => d.id === id);
  const oldFile = oldMain.split('/').pop();
  const oldFileStillThere = fs.existsSync(path.join(UPLOAD_DIR, oldFile));

  console.log('\ngambar utama baru :', after.image);
  console.log('galeri baru        :', after.gallery.length, 'foto');
  console.log('galeri memuat utama:', after.gallery.includes(after.image));
  console.log('galeri masih punya gambar utama LAMA:', after.gallery.includes(oldMain));
  console.log('berkas lama masih ada di disk:', oldFileStillThere);

  const staleInGallery = after.gallery.includes(oldMain);
  const orphanOnDisk = oldFileStillThere && !after.gallery.includes(oldMain);
  const ok = !staleInGallery && !orphanOnDisk;
  console.log(`\n${ok ? 'OK  ' : 'BUG '} galeri konsisten setelah gambar utama diganti`);
  if (staleInGallery) console.log('  → gambar utama lama masih terdaftar di galeri');
  if (orphanOnDisk) console.log('  → berkas gambar lama yatim di disk');

  // --- Bersihkan ---------------------------------------------------------
  const dp = await req('/admin/destinasi/' + id + '/edit');
  const dt = csrf(await dp.text());
  await req('/admin/destinasi/' + id + '/hapus', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: dt }).toString()
  });
  console.log('\ncleanup: dihapus');
  console.log('sisa uploads:', listUploads().length, 'berkas');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
