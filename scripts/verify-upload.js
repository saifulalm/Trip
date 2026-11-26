'use strict';

/**
 * Verifikasi siklus unggah gambar (buat -> edit -> hapus) pada admin panel.
 * Tidak mengubah data produksi: membuat entri uji lalu menghapusnya kembali.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = 'http://localhost:4100';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

let cookie = '';

function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(';')[0];
    const [name] = pair.split('=');
    const existing = cookie
      .split('; ')
      .filter((p) => p && !p.startsWith(`${name}=`));
    existing.push(pair);
    cookie = existing.join('; ');
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

/** Buat PNG 1x1 valid (RGB) untuk uji unggah. */
function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

/** Ambil id entri uji: id pada baris tabel yang memuat nama uji. */
function findTestIds(html) {
  const ids = [];
  const re = /\/admin\/destinasi\/([\w-]+)\/edit/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const row = html.slice(html.lastIndexOf('<tr', m.index), m.index);
    if (row.includes('Uji Upload Otomatis')) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

function listUploads() {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  return fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.gitkeep'));
}

(async () => {
  const results = [];
  const before = listUploads();

  // 1. Login
  const loginPage = await req('/admin/login');
  const loginToken = csrfFrom(await loginPage.text());
  const loginBody = new URLSearchParams({
    _csrf: loginToken,
    username: 'admin',
    password: 'admin123'
  });
  const loginRes = await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: loginBody.toString()
  });
  results.push(['login', loginRes.status, loginRes.headers.get('location') || '-']);

  // 2. Halaman form
  const formPage = await req('/admin/destinasi/baru');
  const formHtml = await formPage.text();
  const token = csrfFrom(formHtml);
  results.push(['form baru', formPage.status, token ? 'csrf-ok' : 'csrf-missing']);

  // 2b. Bersihkan sisa entri uji dari percobaan sebelumnya (sebelum membuat yang baru)
  const preList = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Upload Otomatis'));
  const preHtml = await preList.text();
  for (const sid of findTestIds(preHtml)) {
    const p2 = await req(`/admin/destinasi/${sid}/edit`);
    const t2 = csrfFrom(await p2.text());
    if (!t2) continue;
    await req(`/admin/destinasi/${sid}/hapus`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: t2 }).toString()
    });
    results.push(['cleanup stale', sid, 'dihapus']);
  }

  // 3. Buat + unggah
  const fd = new FormData();
  fd.set('_csrf', token);
  fd.set('name', 'Uji Upload Otomatis');
  fd.set('region', 'Uji Region');
  fd.set('description', 'Deskripsi uji verifikasi pipeline upload admin panel dengan panjang cukup.');
  fd.set('imageFile', new Blob([tinyPng()], { type: 'image/png' }), 'uji.png');
  const createRes = await req('/admin/destinasi', {
    method: 'POST',
    body: fd
  });
  results.push(['create', createRes.status, createRes.headers.get('location') || '-']);

  // 4. Cari entri baru & pastikan berkas WebP terbentuk
  const listRes = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Upload Otomatis'));
  const listHtml = await listRes.text();
  const foundIds = findTestIds(listHtml);
  const idMatch = foundIds.length ? { 1: foundIds[0] } : null;
  const after = listUploads();
  const newFiles = after.filter((f) => !before.includes(f));
  results.push(['files created', newFiles.length, newFiles.join(',')]);
  if (newFiles.length) {
    const buf = fs.readFileSync(path.join(UPLOAD_DIR, newFiles[0]));
    const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
    results.push(['webp output', isWebp ? 'yes' : 'no', `${buf.length} bytes`]);
  }

  // 5. Edit: ganti gambar -> berkas lama harus terhapus
  let id = idMatch ? idMatch[1] : null;
  if (!id) {
    id = idMatch ? idMatch[1] : null;
  }
  if (id) {
    const editPage = await req(`/admin/destinasi/${id}/edit`);
    const editHtml = await editPage.text();
    const editToken = csrfFrom(editHtml);
    const fd2 = new FormData();
    fd2.set('_csrf', editToken);
    fd2.set('name', 'Uji Upload Otomatis');
    fd2.set('region', 'Uji Region');
    fd2.set('description', 'Deskripsi uji verifikasi pipeline upload admin panel bagian edit.');
    fd2.set('imageFile', new Blob([tinyPng()], { type: 'image/png' }), 'uji2.png');
    const editRes = await req(`/admin/destinasi/${id}`, { method: 'POST', body: fd2 });
    const afterEdit = listUploads();
    const orphan = newFiles.filter((f) => !afterEdit.includes(f));
    results.push(['edit', editRes.status, `file lama terhapus: ${orphan.length ? 'ya' : 'TIDAK'}`]);
    results.push(['orphan count', orphan.length, orphan.join(',')]);
  } else {
    results.push(['edit', 'skip', 'id tidak ditemukan']);
  }

  // 6. Hapus entri uji
  const delPage = await req(`/admin/destinasi/${id}/edit`);
  const delHtml = await delPage.text();
  const delToken = csrfFrom(delHtml);
  const delRes = await req(`/admin/destinasi/${id}/hapus`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: delToken }).toString()
  });
  results.push(['delete', delRes.status, delRes.headers.get('location') || '-']);

  // 7. Pastikan tidak ada entri uji tersisa
  const endList = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Upload Otomatis'));
  const leftovers = findTestIds(await endList.text());
  for (const sid of leftovers) {
    const p3 = await req(`/admin/destinasi/${sid}/edit`);
    const t3 = csrfFrom(await p3.text());
    if (!t3) continue;
    await req(`/admin/destinasi/${sid}/hapus`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: t3 }).toString()
    });
  }
  const endList2 = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Upload Otomatis'));
  results.push(['entri uji tersisa', findTestIds(await endList2.text()).length, '']);

  const finalFiles = listUploads();
  results.push(['uploads final', finalFiles.length, finalFiles.join(',') || '(kosong)']);

  console.log(JSON.stringify(results, null, 1));
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
