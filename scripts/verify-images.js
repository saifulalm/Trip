// Verifikasi siklus ganti gambar untuk setiap entitas konten.
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:' + (process.env.PORT || '4102');
const UPLOAD_DIR = path.join('D:/laragon/www/sabesi', 'public', 'uploads');
let cookie = '';

function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(';')[0];
    const [name] = pair.split('=');
    const ex = cookie.split('; ').filter(p => p && !p.startsWith(name + '='));
    ex.push(pair);
    cookie = ex.join('; ');
  }
}
async function req(url, opts = {}) {
  const res = await fetch(BASE + url, { redirect: 'manual', ...opts, headers: { cookie, ...(opts.headers || {}) } });
  saveCookie(res);
  return res;
}
function csrfFrom(html) { const m = html.match(/name="_csrf" value="([^"]+)"/); return m ? m[1] : null; }
function png() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'); }
function listUploads() { return fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter(f => !f.endsWith('.gitkeep')) : []; }

const results = [];
function log(k, v, extra) { results.push([k, v, extra || '']); }

(async () => {
  const loginPage = await req('/admin/login');
  const lt = csrfFrom(await loginPage.text());
  const lr = await req('/admin/login', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({_csrf:lt, username:'admin', password:'admin123'}).toString() });
  log('login', lr.status, lr.headers.get('location'));

  // --- 1. Logo (settings) ---
  const setPage = await req('/admin/pengaturan');
  const setHtml = await setPage.text();
  const setToken = csrfFrom(setHtml);
  const fd = new FormData();
  fd.set('_csrf', setToken);
  fd.set('siteName', 'seayoulatertrip');
  fd.set('brandName', 'seayoulatertrip');
  fd.set('logoFile', new Blob([png()], {type:'image/png'}), 'logo.png');
  const setRes = await req('/admin/pengaturan', { method:'POST', body: fd });
  log('upload logo', setRes.status, setRes.headers.get('location'));
  const afterLogo = listUploads();
  log('files after logo', afterLogo.length, afterLogo.join(','));

  // cek apakah logo tersimpan di settings
  const db = JSON.parse(fs.readFileSync('D:/laragon/www/sabesi/data/db.json','utf8'));
  log('settings.logo', db.settings.logo || '(kosong)');
  log('settings.heroImageUrl', db.settings.heroImageUrl || '(kosong)');

  // --- 2. Hero image ---
  const fd2 = new FormData();
  fd2.set('_csrf', setToken);
  fd2.set('heroFile', new Blob([png()], {type:'image/png'}), 'hero.png');
  const heroRes = await req('/admin/pengaturan', { method:'POST', body: fd2 });
  log('upload hero', heroRes.status, heroRes.headers.get('location'));
  const db2 = JSON.parse(fs.readFileSync('D:/laragon/www/sabesi/data/db.json','utf8'));
  log('settings.heroImageUrl after', db2.settings.heroImageUrl || '(kosong)');

  // --- 3. Cek checkbox boolean (waFloatEnabled / seoIndex) ---
  const seoPage = await req('/admin/seo');
  const seoToken = csrfFrom(await seoPage.text());
  const fd3 = new FormData();
  fd3.set('_csrf', seoToken);
  fd3.set('siteUrl', 'https://seayoulatertrip.com');
  fd3.set('seoIndex', 'off');
  fd3.set('seoDescription', 'Deskripsi uji');
  const seoRes = await req('/admin/seo', { method:'POST', body: fd3 });
  log('post seo seoIndex=off', seoRes.status, seoRes.headers.get('location'));
  const db3 = JSON.parse(fs.readFileSync('D:/laragon/www/sabesi/data/db.json','utf8'));
  log('settings.seoIndex after off', db3.settings.seoIndex);

  // --- 4. Destinasi: create/edit/hapus gambar ---
  const formPage = await req('/admin/destinasi/baru');
  const formHtml = await formPage.text();
  const ft = csrfFrom(formHtml);
  const fd4 = new FormData();
  fd4.set('_csrf', ft);
  fd4.set('name','Uji Ganti Foto');
  fd4.set('region','Uji Region');
  fd4.set('description','Deskripsi uji ganti fotoummersik.');
  fd4.set('imageFile', new Blob([png()], {type:'image/png'}), 'a.png');
  const cRes = await req('/admin/destinasi', { method:'POST', body: fd4 });
  log('create dest+img', cRes.status, cRes.headers.get('location'));

  const listRes = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Ganti Foto'));
  const listHtml = await listRes.text();
  const idm = listHtml.match(/\/admin\/destinasi\/([\w-]+)\/edit/);
  const id = idm ? idm[1] : null;
  log('dest id', id || '(tidak ditemukan)');
  const filesAfterCreate = listUploads();

  if (id) {
    const ep = await req('/admin/destinasi/' + id + '/edit');
    const et = csrfFrom(await ep.text());
    const fd5 = new FormData();
    fd5.set('_csrf', et);
    fd5.set('name','Uji Ganti Foto');
    fd5.set('region','Uji Region');
    fd5.set('description','Deskripsi uji ganti foto edittested.');
    fd5.set('imageFile', new Blob([png()], {type:'image/png'}), 'b.png');
    const eRes = await req('/admin/destinasi/' + id, { method:'POST', body: fd5 });
    const filesAfterEdit = listUploads();
    const removed = filesAfterCreate.filter(f => !filesAfterEdit.includes(f));
    log('edit dest (ganti img)', eRes.status, 'file lama terhapus: ' + (removed.length ? removed.join(',') : 'TIDAK'));
  }

  // bersihkan
  if (id) {
    const dp = await req('/admin/destinasi/' + id + '/edit');
    const dt = csrfFrom(await dp.text());
    await req('/admin/destinasi/' + id + '/hapus', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({_csrf:dt}).toString() });
    log('delete dest', 'done');
  }

  console.log(JSON.stringify(results, null, 1));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
