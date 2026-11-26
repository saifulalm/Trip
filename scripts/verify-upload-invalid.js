'use strict';

/**
 * Uji skenario form tidak valid: berkas gambar sudah terproses oleh
 * middleware upload, tetapi validasi route menolak. Berkas hasil proses
 * harus dihapus supaya tidak ada file yatim di folder uploads.
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:4100';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

let cookie = '';

function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    const rest = cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`));
    rest.push(pair);
    cookie = rest.join('; ');
  }
}

async function req(url, opts = {}) {
  const res = await fetch(`${BASE}${url}`, {
    redirect: 'manual',
    ...opts,
    headers: { cookie, ...(opts.headers || {}) }
  });
  saveCookie(res);
  return res;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

function listUploads() {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  return fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.gitkeep'));
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

(async () => {
  const out = [];
  const before = listUploads();

  const loginPage = await req('/admin/login');
  const lt = csrfFrom(await loginPage.text());
  await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: lt, username: 'admin', password: 'admin123' }).toString()
  });

  // --- Destinasi: deskripsi terlalu pendek -> validasi gagal
  const form = await req('/admin/destinasi/baru');
  const token = csrfFrom(await form.text());
  const fd = new FormData();
  fd.set('_csrf', token);
  fd.set('name', 'Uji Validasi Gagal');
  fd.set('region', 'Wilayah Uji');
  fd.set('description', 'Pendek'); // < 20 karakter -> ditolak
  fd.set('imageFile', new Blob([tinyPng()], { type: 'image/png' }), 'uji.png');
  const res = await req('/admin/destinasi', { method: 'POST', body: fd });
  out.push(['create tidak valid', res.status, res.headers.get('location') || '-']);

  const after = listUploads();
  const leaked = after.filter((f) => !before.includes(f));
  out.push(['file yatim setelah tolak', leaked.length, leaked.join(',') || '(tidak ada — benar)']);

  // --- Paket: judul kosong -> validasi gagal
  const pkgForm = await req('/admin/paket/baru');
  const ptoken = csrfFrom(await pkgForm.text());
  const fd2 = new FormData();
  fd2.set('_csrf', ptoken);
  fd2.set('title', ''); // wajib diisi
  fd2.set('destinationSlug', '');
  fd2.set('price', '0');
  fd2.set('imageFile', new Blob([tinyPng()], { type: 'image/png' }), 'uji.png');
  const res2 = await req('/admin/paket', { method: 'POST', body: fd2 });
  out.push(['paket tidak valid', res2.status, res2.headers.get('location') || '-']);

  const after2 = listUploads();
  const leaked2 = after2.filter((f) => !before.includes(f));
  out.push(['file yatim total', leaked2.length, leaked2.join(',') || '(tidak ada — benar)']);

  // --- Berkas bukan gambar -> ditolak middleware (magic byte)
  const fd3 = new FormData();
  fd3.set('_csrf', token);
  fd3.set('name', 'Uji Validasi Gagal');
  fd3.set('region', 'Wilayah Uji');
  fd3.set('description', 'Deskripsi uji verifikasi pipeline upload admin panel dengan panjang cukup.');
  fd3.set('imageFile', new Blob([Buffer.from('bukan gambar sama sekali')], { type: 'text/plain' }), 'x.txt');
  const res3 = await req('/admin/destinasi', { method: 'POST', body: fd3 });
  out.push(['file bukan gambar', res3.status, res3.headers.get('location') || '-']);

  const after3 = listUploads();
  out.push(['file yatim final', after3.filter((f) => !before.includes(f)).length, after3.join(',') || '(bersih)']);

  console.log(out.map((r) => r.join(' | ')).join('\n'));
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
