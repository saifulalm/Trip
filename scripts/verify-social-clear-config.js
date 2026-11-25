'use strict';
/**
 * Uji alur "hapus konfigurasi Postiz".
 *
 * Skenario:
 *  1. Simpan konfigurasi Postiz (URL + API Key).
 *  2. Pastikan halaman hub mencentang opsi "Hapus konfigurasi".
 *  3. POST dengan postizClear=1 -> settings harus dikosongkan.
 *  4. Pastikan halaman hub kembali ke status "Belum dikonfigurasi" dan
 *     tombol hapus konfigurasi hilang.
 *  5. Pulihkan konfigurasi semula.
 */
const http = require('http');

const APP = { host: 'localhost', port: Number(process.env.VERIFY_PORT) || 4310 };
const KEY = 'kunci-uji-123';

let pass = 0;
let fail = 0;
function ok(l) { pass += 1; console.log('  PASS  ' + l); }
function bad(l, e) { fail += 1; console.log('  FAIL  ' + l + (e ? ' — ' + e : '')); }
function check(l, c, e) { if (c) ok(l); else bad(l, e); }

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...APP, path, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout ' + path)); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function formEncode(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] === undefined ? '' : obj[k]))
    .join('&');
}
function cookieOf(res) {
  return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}
function csrfOf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

(async () => {
  const loginPage = await request('/admin/login');
  const login = await request('/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({ username: 'admin', password: 'admin123', _csrf: csrfOf(loginPage.body) })),
      Cookie: cookieOf(loginPage)
    },
    body: formEncode({ username: 'admin', password: 'admin123', _csrf: csrfOf(loginPage.body) })
  });
  const cookie = cookieOf(login);
  check('login admin', login.status === 302 && cookie.length > 0, 'status ' + login.status);
  if (!cookie) process.exit(1);

  const authed = (extra = {}) => Object.assign({ Cookie: cookie }, extra);
  const baseUrl = 'http://127.0.0.1:' + (Number(process.env.MOCK_PORT) || 4250);

  /*
   * WAJIB: snapshot konfigurasi Postiz SEBELUM diubah.
   *
   * Tanpa ini, skrip menyimpan konfigurasi mock lokal
   * (http://127.0.0.1:4250 + kunci-uji-123) ke data/db.json produksi dan
   * "memulihkannya" di akhir — jadi setiap eksekusi meninggalkan konfigurasi
   * uji permanen di situs asli.
   */
  const dbMod = require('../src/db');
  dbMod.reload();
  const originalConfig = {
    postizBaseUrl: (dbMod.read().settings || {}).postizBaseUrl || '',
    postizApiKey: (dbMod.read().settings || {}).postizApiKey || ''
  };

  /* 1. Simpan konfigurasi */
  const hub0 = await request('/admin/social', { headers: authed() });
  const csrf = csrfOf(hub0.body);
  await request('/admin/social/postiz', {
    method: 'POST',
    headers: authed({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({ postizBaseUrl: baseUrl, postizApiKey: KEY, _csrf: csrf }))
    }),
    body: formEncode({ postizBaseUrl: baseUrl, postizApiKey: KEY, _csrf: csrf })
  });

  const hub1 = await request('/admin/social', { headers: authed() });
  check('konfigurasi tersimpan -> status Terhubung', hub1.body.includes('Terhubung'));
  check('opsi "Hapus konfigurasi" muncul', hub1.body.includes('name="postizClear"'));

  /* 2. Hapus konfigurasi */
  const csrf2 = csrfOf(hub1.body);
  const del = await request('/admin/social/postiz', {
    method: 'POST',
    headers: authed({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({ postizClear: '1', _csrf: csrf2 }))
    }),
    body: formEncode({ postizClear: '1', _csrf: csrf2 })
  });
  check('hapus konfigurasi redirect 302', del.status === 302, 'status ' + del.status);

  const hub2 = await request('/admin/social', { headers: authed() });
  check('status kembali "Belum dikonfigurasi"', hub2.body.includes('Belum dikonfigurasi'));
  check('opsi hapus konfigurasi hilang', !hub2.body.includes('name="postizClear"'));
  check('pesan sukses tampil', hub2.body.includes('Konfigurasi Postiz dihapus'));

  /* 3. Pastikan settings benar-benar kosong */
  dbMod.reload();
  const s = dbMod.read().settings;
  check('settings.postizBaseUrl kosong', !s.postizBaseUrl, JSON.stringify(s.postizBaseUrl));
  check('settings.postizApiKey kosong', !s.postizApiKey, JSON.stringify(s.postizApiKey));

  /* 4. Pulihkan konfigurasi ASLI (bukan konfigurasi mock) */
  /*
   * PENTING: yang dipulihkan adalah nilai snapshot sebelum skrip berjalan,
   * BUKAN konfigurasi mock. Kalau dipulihkan ke mock, setiap eksekusi
   * meninggalkan http://127.0.0.1:4250 di data/db.json produksi.
   */
  const hub3 = await request('/admin/social', { headers: authed() });
  const csrf3 = csrfOf(hub3.body);
  if (originalConfig.postizBaseUrl) {
    await request('/admin/social/postiz', {
      method: 'POST',
      headers: authed({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formEncode({
          postizBaseUrl: originalConfig.postizBaseUrl,
          postizApiKey: originalConfig.postizApiKey,
          _csrf: csrf3
        }))
      }),
      body: formEncode({
        postizBaseUrl: originalConfig.postizBaseUrl,
        postizApiKey: originalConfig.postizApiKey,
        _csrf: csrf3
      })
    });
  } else {
    // Tidak ada konfigurasi asli → biarkan kosong (sesuai kondisi awal).
    await request('/admin/social/postiz', {
      method: 'POST',
      headers: authed({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formEncode({ postizClear: '1', _csrf: csrf3 }))
      }),
      body: formEncode({ postizClear: '1', _csrf: csrf3 })
    });
  }
  dbMod.reload();
  const s2 = dbMod.read().settings;
  check('konfigurasi asli dipulihkan',
    (s2.postizBaseUrl || '') === originalConfig.postizBaseUrl
    && (s2.postizApiKey || '') === originalConfig.postizApiKey,
    JSON.stringify({ now: s2.postizBaseUrl, was: originalConfig.postizBaseUrl }));

  console.log('\n' + pass + ' lulus, ' + fail + ' gagal.');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + e.stack); process.exit(1); });
