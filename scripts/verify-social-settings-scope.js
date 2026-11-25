'use strict';
/**
 * Uji bahwa form "Media Sosial" di /admin/pengaturan menyimpan tautan profil
 * dan TIDAK merusak field settings lain (mis. tema, WhatsApp, iPaymu).
 *
 * Ini penting karena form settings memakai scope per-kelompok: bila scope
 * salah, satu form bisa menimpa field milik form lain.
 *
 * CATATAN PENTING: restorasi tautan dilakukan LEWAT HTTP (bukan menulis
 * db.json langsung). Alasannya: db.js menyimpan cache in-process di server
 * yang sedang berjalan. Bila skrip menulis db.json langsung, server masih
 * memegang nilai lama dan akan menimpanya kembali — settings jadi kacau.
 */
const http = require('http');

const BASE = { host: 'localhost', port: Number(process.env.VERIFY_PORT) || Number(process.env.PORT) || 4100 };

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...BASE, path, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout ' + path)); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

let pass = 0;
let fail = 0;

/**
 * Baca nilai field form dari HTML halaman admin.
 *
 * Field admin punya tiga bentuk markup, jadi satu regex tidak cukup:
 *  1. <input name="x" value="v">  — input biasa
 *  2. <select name="x"><option value="v" selected>  — select
 *  3. <textarea name="x">v</textarea>  — textarea
 *
 * @param {string} html HTML halaman admin
 * @param {string} name nama field
 * @returns {string} nilai field (string kosong bila tidak ada / kosong)
 */
function fieldValue(html, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Input: ambil atribut value pada tag yang sama.
  const input = html.match(new RegExp('<input[^>]*\\bname="' + esc + '"[^>]*>', 'i'));
  if (input) {
    const v = input[0].match(/\bvalue="([^"]*)"/i);
    return v ? v[1] : '';
  }

  // 2. Select: ambil option yang ditandai selected.
  const select = html.match(new RegExp('<select[^>]*\\bname="' + esc + '"[^>]*>([\\s\\S]*?)<\\/select>', 'i'));
  if (select) {
    const opt = select[1].match(/<option[^>]*\bselected[^>]*>/i);
    if (opt) {
      const v = opt[0].match(/\bvalue="([^"]*)"/i);
      return v ? v[1] : '';
    }
    return '';
  }

  // 3. Textarea: ambil isi di antara tag.
  const ta = html.match(new RegExp('<textarea[^>]*\\bname="' + esc + '"[^>]*>([\\s\\S]*?)<\\/textarea>', 'i'));
  if (ta) return ta[1];

  return '';
}

function check(label, ok, detail) {
  if (ok) { pass += 1; console.log('  PASS  ' + label); }
  else { fail += 1; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

/** Kirim form social lewat HTTP (server yang menulis & menyimpan cache). */
async function saveSocial(cookie, csrf, values) {
  const form = ['_csrf=' + encodeURIComponent(csrf), 'form=social']
    .concat(Object.keys(values).map((k) => k + '=' + encodeURIComponent(values[k])))
    .join('&');
  return request('/admin/pengaturan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form),
      Cookie: cookie
    },
    body: form
  });
}

(async () => {
  // Login admin.
  const loginPage = await request('/admin/login');
  const csrf = (loginPage.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  const preCookie = (loginPage.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const payload = `username=admin&password=admin123&_csrf=${encodeURIComponent(csrf)}`;
  const login = await request('/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      Cookie: preCookie
    },
    body: payload
  });
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  check('login admin', Boolean(cookie));

  // Nilai "sebelum" diambil dari HALAMAN ADMIN (server adalah sumber
  // kebenaran), bukan dari db.json — karena server memakai cache in-process
  // dan bisa berbeda dengan isi disk saat ada proses lain yang menulis.
  const social = require('../src/services/social');
  const beforePage = await request('/admin/pengaturan', { headers: { Cookie: cookie } });
  const before = {};
  social.PROFILE_PLATFORMS.forEach((p) => {
    const m = beforePage.body.match(new RegExp('name="' + p.slug + '"\\s+value="([^"]*)"'));
    before[p.slug] = m ? m[1] : '';
  });

  // Nilai asli tautan profil, untuk restorasi.
  const originalLinks = {};
  social.PROFILE_PLATFORMS.forEach((p) => { originalLinks[p.slug] = before[p.slug]; });

  // Nilai field kelompok lain diambil dari disk SEBELUM ada perubahan —
  // field ini tidak pernah diubah oleh form social, jadi nilainya stabil
  // dan aman dijadikan acuan.
  const beforeSettings = JSON.parse(JSON.stringify(
    (require('../src/db').read().settings || {})
  ));

  try {
    // Simpan form social (hanya dua field tautan profil).
    const saved = await saveSocial(cookie, csrf, {
      instagram: 'https://instagram.com/uji-scope',
      tiktok: 'https://tiktok.com/@ujiscope'
    });
    check('simpan form social (redirect 302)', saved.status === 302, 'status ' + saved.status);

    // Field milik kelompok social tersimpan.
    // Verifikasi lewat HALAMAN ADMIN (server = sumber kebenaran), bukan
    // db.json, supaya tidak tert impacted cache in-process server.
    const afterPage = await request('/admin/pengaturan', { headers: { Cookie: cookie } });
    const after = {};
    social.PROFILE_PLATFORMS.forEach((p) => {
      const m = afterPage.body.match(new RegExp('name="' + p.slug + '"\\s+value="([^"]*)"'));
      after[p.slug] = m ? m[1] : '';
    });

    check('instagram tersimpan', after.instagram === 'https://instagram.com/uji-scope', String(after.instagram));
    check('tiktok tersimpan', after.tiktok === 'https://tiktok.com/@ujiscope', String(after.tiktok));

    // Field milik kelompok lain TIDAK boleh berubah.
    // Nilai dibaca dari HALAMAN ADMIN (server = sumber kebenaran), bukan
    // dari db.json, karena server memakai cache in-process.
    //
    // CATATAN: field HTML punya tiga bentuk — <input value="..">,
    // <select><option selected></select>, dan <textarea>isi</textarea>.
    // Regex sederhana name="x"[^>]*value=".." hanya berlaku untuk <input>,
    // sehingga select & textarea selalu terbaca sebagai kosong (dan dianggap
    // "berubah"). Karena itu dipakai pembaca nilai yang menangani tiga bentuk.
    const otherKeys = ['themeMode', 'themeAccent', 'siteName', 'waQuietStart', 'waQuietEnd', 'waReminderIntervalMin', 'ipaymuVa', 'waDefaultTemplate'];
    const beforeOther = {};
    otherKeys.forEach((k) => { beforeOther[k] = fieldValue(beforePage.body, k); });
    const changed = otherKeys.filter((k) => fieldValue(afterPage.body, k) !== beforeOther[k]);
    check('field settings lain tidak berubah', changed.length === 0, 'berubah: ' + changed.join(', '));

    // Platform yang tidak dikirim harus mempertahankan nilai lamanya.
    const untouched = social.PROFILE_PLATFORMS
      .filter((p) => p.slug !== 'instagram' && p.slug !== 'tiktok')
      .filter((p) => before[p.slug] && after[p.slug] !== before[p.slug]);
    check('tautan platform lain tetap utuh', untouched.length === 0,
      untouched.map((p) => p.slug).join(', '));
  } finally {
    // Restorasi lewat HTTP supaya cache server & disk tetap sinkron.
    await saveSocial(cookie, csrf, originalLinks);
    console.log('\nTautan profil dikembalikan ke kondisi semula (lewat HTTP).');
  }

  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail === 0 ? 0 : 1);
})();
