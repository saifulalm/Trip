'use strict';
/**
 * Pulihkan state setting & folder uploads ke kondisi bersih.
 *
 * Latar: file uji unggahan sebelumnya (PNG 1x1) tertinggal di public/uploads
 * dan settings.logo menunjuk salah satunya, sehingga logo situs tidak lagi
 * memakai berkas logo.svg bawaan.
 *
 * Skrip ini bekerja lewat HTTP form (bukan menulis db.json langsung) supaya
 * tidak bentrok dengan cache memori server.
 *
 * Jalankan: PORT=41xx node scripts/restore-upload-state.js
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

/** Baca data dari database (hanya baca). */
const readDb = () => JSON.parse(fs.readFileSync(DB, 'utf8'));

(async () => {
  // 1. Login
  const lp = await req('/admin/login');
  const lt = csrf(await lp.text());
  await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: lt, username: 'admin', password: 'admin123' }).toString()
  });

  // 2. Kembalikan logo ke berkas bawaan (route menghapus berkas unggahan lama).
  const gp = await req('/admin/pengaturan');
  const gt = csrf(await gp.text());
  await req('/admin/pengaturan', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: gt, form: 'site', logoImageReset: '1' }).toString()
  });

  // 3. Kembalikan gambar hero ke kosong → beranda memakai video + poster bawaan.
  const gp2 = await req('/admin/pengaturan');
  const gt2 = csrf(await gp2.text());
  await req('/admin/pengaturan', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: gt2, form: 'site', heroImageReset: '1' }).toString()
  });

  const s = readDb().settings;
  console.log('logo         :', s.logo);
  console.log('heroImageUrl :', JSON.stringify(s.heroImageUrl));

  // 4. Hapus berkas di public/uploads yang tidak lagi dirujuk data.
  const used = new Set();
  const add = (u) => {
    if (u && String(u).startsWith('/uploads/')) used.add(String(u).split('/').pop());
  };
  (readDb().destinations || []).forEach((x) => { add(x.image); (x.gallery || []).forEach(add); });
  (readDb().packages || []).forEach((x) => add(x.image));
  (readDb().articles || []).forEach((x) => add(x.coverImage));
  (readDb().bookings || []).forEach((x) => add(x.proofImage));
  add(s.logo);
  add(s.heroImageUrl);
  add(s.ogImageUrl);

  const files = fs.existsSync(UPLOAD_DIR)
    ? fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.gitkeep'))
    : [];
  const orphans = files.filter((f) => !used.has(f));
  orphans.forEach((f) => {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, f));
    } catch (err) {
      console.error('gagal hapus', f, err.message);
    }
  });
  console.log('berkas yatim dihapus:', orphans.length, orphans.join(', ') || '(tidak ada)');
  console.log('sisa uploads      :', fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.gitkeep')).join(', ') || '(kosong)');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
