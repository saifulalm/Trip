'use strict';
/**
 * Setelan satu-klik untuk pengaturan situs via HTTP form admin.
 *
 * Dipakai untuk memulihkan nilai settings setelah pengujian (mis. siteUrl
 * yang ikut terkosong). Semua perubahan lewat HTTP form supaya tidak
 * bentrok dengan cache memori server.
 *
 * Jalankan: PORT=41xx node scripts/set-site-settings.js
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:' + (process.env.PORT || 4110);
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

/** Kirim form Pengaturan/SEO. */
async function post(pathname, fields) {
  const gp = await req(pathname);
  const gt = csrf(await gp.text());
  const fd = new FormData();
  fd.set('_csrf', gt);
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
  await req(pathname, { method: 'POST', body: fd });
}

(async () => {
  const lp = await req('/admin/login');
  const lt = csrf(await lp.text());
  await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: lt, username: 'admin', password: 'admin123' }).toString()
  });

  // URL situs untuk sitemap & tautan absolut.
  await post('/admin/seo', {
    siteUrl: 'https://seayoulatertrip.com',
    seoDescription:
      'seayoulatertrip — paket wisata bahari terpercaya ke Raja Ampat, Sabesi, Ora, dan pulau-pulau terbaik Indonesia. Itinerary matang, pemandu lokal, harga transparan.',
    seoIndex: 'on'
  });

  const s = JSON.parse(fs.readFileSync(DB, 'utf8')).settings;
  console.log('siteUrl     :', s.siteUrl);
  console.log('seoIndex    :', s.seoIndex);
  console.log('brandName   :', s.brandName);
  console.log('waFloat     :', s.waFloatEnabled);
  console.log('themeMode   :', s.themeMode, s.themeAccent);
  console.log('logo        :', s.logo);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
