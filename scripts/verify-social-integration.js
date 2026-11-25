'use strict';
/**
 * Verifikasi integrasi media sosial end-to-end terhadap mock Postiz.
 *
 * Alur yang diuji:
 *  1. Login admin.
 *  2. Simpan konfigurasi Postiz (URL API + API Key) lewat POST /admin/social/postiz.
 *  3. Halaman hub memuat status "Terhubung", nama workspace, dan kartu kanal.
 *  4. Halaman composer memuat kanal terhubung + field wajib.
 *  5. Halaman riwayat memuat 4 post dengan badge state yang BENAR
 *     (QUEUE=Terjadwal, PUBLISHED=Terbit, DRAFT=Draf, ERROR=Gagal).
 *  6. POST /admin/social/tulis mengirim payload ke Postiz (dicek dari log mock).
 *  7. Endpoint diagnostik mengembalikan step 'siap' + jumlah kanal.
 *  8. Tombol HTML untuk aksi (putar/link) benar-benar ter-render.
 *
 * Environment:
 *   VERIFY_PORT     port server aplikasi (default 4310)
 *   MOCK_PORT       port mock Postiz (default 4250)
 *   MOCK_POSTIZ_KEY API key mock (default kunci-uji-123)
 */
const http = require('http');

const APP = { host: 'localhost', port: Number(process.env.VERIFY_PORT) || 4310 };
const MOCK = { host: '127.0.0.1', port: Number(process.env.MOCK_PORT) || 4250 };
const KEY = process.env.MOCK_POSTIZ_KEY || 'kunci-uji-123';

let pass = 0;
let fail = 0;

function ok(label) { pass += 1; console.log('  PASS  ' + label); }
function bad(label, extra) {
  fail += 1;
  console.log('  FAIL  ' + label + (extra ? ' — ' + extra : ''));
}
function check(label, cond, extra) { if (cond) ok(label); else bad(label, extra); }

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

/** Ambil token CSRF dari HTML halaman. */
function csrfOf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

/** Hitung kemunculan substring (case-insensitive). */
function count(haystack, needle) {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let c = 0;
  let i = h.indexOf(n);
  while (i !== -1) { c += 1; i = h.indexOf(n, i + n.length); }
  return c;
}

(async () => {
  /* ---------- 1. Login ---------- */
  const loginPage = await request('/admin/login');
  const csrf = csrfOf(loginPage.body);
  if (!csrf) {
    console.log('GAGAL: token CSRF tidak ditemukan di /admin/login');
    process.exit(1);
  }
  const login = await request('/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({ username: 'admin', password: 'admin123', _csrf: csrf })),
      Cookie: cookieOf(loginPage)
    },
    body: formEncode({ username: 'admin', password: 'admin123', _csrf: csrf })
  });
  const cookie = cookieOf(login);
  check('login admin berhasil', login.status === 302 && cookie.length > 0, 'status ' + login.status);
  if (!cookie) process.exit(1);

  const authed = (extra = {}) => Object.assign({ Cookie: cookie }, extra);

  /*
   * WAJIB: snapshot konfigurasi Postiz ASLI sebelum diubah.
   * Tanpa pemulihan, konfigurasi mock lokal tertinggal permanen di
   * data/db.json produksi setiap kali skrip ini dijalankan.
   */
  const dbMod = require('../src/db');
  dbMod.reload();
  const originalConfig = {
    postizBaseUrl: (dbMod.read().settings || {}).postizBaseUrl || '',
    postizApiKey: (dbMod.read().settings || {}).postizApiKey || ''
  };

  /* ---------- 2. Simpan konfigurasi Postiz ---------- */
  const hub0 = await request('/admin/social', { headers: authed() });
  const csrfHub = csrfOf(hub0.body);
  const baseUrl = 'http://127.0.0.1:' + MOCK.port;

  const saveRes = await request('/admin/social/postiz', {
    method: 'POST',
    headers: authed({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({ postizBaseUrl: baseUrl, postizApiKey: KEY, _csrf: csrfHub }))
    }),
    body: formEncode({ postizBaseUrl: baseUrl, postizApiKey: KEY, _csrf: csrfHub })
  });
  check('simpan konfigurasi Postiz (302)', saveRes.status === 302, 'status ' + saveRes.status);

  /* ---------- 3. Halaman hub ---------- */
  const hub = await request('/admin/social', { headers: authed() });
  check('hub merespons 200', hub.status === 200, 'status ' + hub.status);
  check('status "Terhubung" tampil', hub.body.includes('Terhubung'));
  check('workspace Postiz tampil', hub.body.includes('Sear You Later Trip'));
  // Kartu ditulis PER PLATFORM, jadi Instagram & Facebook masing-masing
  // menampilkan "1 kanal" (bukan 2) walau total integrasi = 2.
  check('kartu kanal menampilkan jumlah kanal', hub.body.includes('Terhubung &middot; 1 kanal'));
  check('kedua platform tampil sebagai terhubung', count(hub.body, 'Terhubung &middot; 1 kanal') === 2,
    'ditemukan ' + count(hub.body, 'Terhubung &middot; 1 kanal'));
  check('tombol putus kanal ada', hub.body.includes('/admin/social/kanal/11111111-1111-1111-1111-111111111111/hapus'));
  check('tombol diagnostik ada', hub.body.includes('socialDiagnose'));
  check('CSS baru ter-link', hub.body.includes('/css/admin-social.css'));
  check('kelas baru dipakai (a-so-hero)', hub.body.includes('a-so-hero'));
  check('kelas lama a-social-grid hilang', !hub.body.includes('a-social-grid'));
  check('konten lama "Hubungan Postiz" hilang', !hub.body.includes('Hubungan Postiz'));

  /* ---------- 4. Composer ---------- */
  const compose = await request('/admin/social/tulis', { headers: authed() });
  check('composer merespons 200', compose.status === 200, 'status ' + compose.status);
  check('composer memuat 2 kanal', count(compose.body, 'a-so-pick__item') >= 2);
  check('composer punya penghitung karakter', compose.body.includes('soCounterFill'));
  check('composer punya form unggah media terpisah', compose.body.includes('id="soMediaUpload"'));
  check('tidak ada nested form', (compose.body.match(/<form/g) || []).length === (compose.body.match(/<\/form>/g) || []).length);
  check('input media punya atribut form', compose.body.includes('form="soMediaUpload"'));

  /* ---------- 5. Riwayat ---------- */
  const hist = await request('/admin/social/riwayat', { headers: authed() });
  check('riwayat merespons 200', hist.status === 200, 'status ' + hist.status);
  check('state QUEUE -> badge "Terjadwal"', hist.body.includes('Terjadwal'));
  check('state PUBLISHED -> badge "Terbit"', hist.body.includes('Terbit'));
  check('state DRAFT -> badge "Draf"', hist.body.includes('Draf'));
  check('state ERROR -> badge "Gagal"', hist.body.includes('Gagal'));
  check('error Postiz ditampilkan', hist.body.includes('Instagram API rate limit exceeded'));
  check('tombol jadwal ulang ada', hist.body.includes('/status'));
  check('tombol hapus ada', hist.body.includes('/hapus'));
  check('badge state lama (PUBLISHED mentah) tidak tampil', !hist.body.includes('>PUBLISHED<') && !hist.body.includes('>QUEUE<'));

  /* ---------- 6. Diagnostik ---------- */
  const diag = await request('/admin/social/diagnostik', {
    headers: authed({ Accept: 'application/json' })
  });
  let diagJson = null;
  try { diagJson = JSON.parse(diag.body); } catch (err) { /* biarkan null */ }
  check('diagnostik 200', diag.status === 200, 'status ' + diag.status);
  check('diagnostik step = siap', diagJson && diagJson.step === 'siap', diagJson && diagJson.step);
  check('diagnostik channelCount = 2', diagJson && diagJson.channelCount === 2, String(diagJson && diagJson.channelCount));

  /* ---------- 7. Status JSON ---------- */
  const st = await request('/admin/social/status', { headers: authed({ Accept: 'application/json' }) });
  let stJson = null;
  try { stJson = JSON.parse(st.body); } catch (err) { /* biarkan null */ }
  check('status JSON ok', stJson && stJson.ok === true);
  check('status JSON count = 2', stJson && stJson.count === 2, String(stJson && stJson.count));

  /* ---------- 8. Publish composer ---------- */
  const compose2 = await request('/admin/social/tulis', { headers: authed() });
  const csrfCompose = csrfOf(compose2.body);
  const integId = '11111111-1111-1111-1111-111111111111';

  const publish = await request('/admin/social/tulis', {
    method: 'POST',
    headers: authed({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({
        content: 'Uji publikasi integrasi media sosial',
        channels: integId,
        mode: 'now',
        link: 'https://jalanjalanenak.com/paket',
        postType: 'post',
        _csrf: csrfCompose
      }))
    }),
    body: formEncode({
      content: 'Uji publikasi integrasi media sosial',
      channels: integId,
      mode: 'now',
      link: 'https://jalanjalanenak.com/paket',
      postType: 'post',
      _csrf: csrfCompose
    })
  });
  check('publish redirect 302', publish.status === 302, 'status ' + publish.status);

  /* ---------- 9. Kanal payout (validasi field wajib) ---------- */
  const reqRes = await request('/admin/social/tulis', {
    method: 'POST',
    headers: authed({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formEncode({
        content: 'uji',
        channels: integId,
        mode: 'draft',
        _csrf: csrfCompose
      }))
    }),
    body: formEncode({
      content: 'uji',
      channels: integId,
      mode: 'draft',
      _csrf: csrfCompose
    })
  });
  check('publish tanpa field wajib tetap 302 (validasi di server)', reqRes.status === 302, 'status ' + reqRes.status);

  /* ---------- 10. Profil publik ---------- */
  const profPage = await request('/admin/social', { headers: authed() });
  check('form tautan profil ada', profPage.body.includes('name="instagram"'));
  check('form konfigurasi ada', profPage.body.includes('name="postizApiKey"'));

  /* ---------- 11. Cek request yang diterima mock Postiz ---------- */
  await new Promise((r) => setTimeout(r, 400));
  const mockReqs = await new Promise((resolve) => {
    const r = http.request(
      { host: MOCK.host, port: MOCK.port, path: '/__requests', method: 'GET' },
      (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(b).requests || []); } catch (err) { resolve([]); }
        });
      }
    );
    r.on('error', () => resolve([]));
    r.end();
  });

  const mockPaths = mockReqs.map((x) => x.method + ' ' + x.path);
  const hasPath = (needle) => mockPaths.some((p) => p.indexOf(needle) !== -1);

  check('mock menerima GET /integrations', hasPath('GET /api/public/v1/integrations'));
  check('mock menerima GET /is-connected', hasPath('GET /api/public/v1/is-connected'));
  check('mock menerima GET /me', hasPath('GET /api/public/v1/me'));
  check('mock menerima POST /posts', hasPath('POST /api/public/v1/posts'));
  check('semua request ke Postiz membawa header Authorization',
    mockReqs.filter((x) => x.path.indexOf('/api/public/v1') === 0).every((x) => x.auth === true));

  const payloadEntry = mockReqs.find((x) => x.path === '/posts#payload');
  check('payload createPost diterima mock', Boolean(payloadEntry));
  if (payloadEntry) {
    const s = payloadEntry.summary;
    check('payload type = now', s.type === 'now', String(s.type));
    check('payload berisi 1 post', s.postCount === 1, String(s.postCount));
    check('payload settings.__type = instagram',
      s.settings && s.settings[0] && s.settings[0].__type === 'instagram',
      JSON.stringify(s.settings));
    check('payload punya post_type (field wajib Instagram)',
      s.settings && s.settings[0] && s.settings[0].post_type === 'post',
      JSON.stringify(s.settings && s.settings[0]));
  }

  /* ---------- Pulihkan konfigurasi Postiz ASLI ---------- */
  /*
   * WAJIB: pulihkan ke nilai snapshot, bukan ke konfigurasi mock.
   * Kalau tidak, data/db.json produksi menyimpan http://127.0.0.1:4250
   * secara permanen setiap kali skrip ini dijalankan.
   */
  const hubRestore = await request('/admin/social', { headers: authed() });
  const csrfRestore = csrfOf(hubRestore.body);
  if (originalConfig.postizBaseUrl) {
    await request('/admin/social/postiz', {
      method: 'POST',
      headers: authed({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formEncode({
          postizBaseUrl: originalConfig.postizBaseUrl,
          postizApiKey: originalConfig.postizApiKey,
          _csrf: csrfRestore
        }))
      }),
      body: formEncode({
        postizBaseUrl: originalConfig.postizBaseUrl,
        postizApiKey: originalConfig.postizApiKey,
        _csrf: csrfRestore
      })
    });
  } else {
    await request('/admin/social/postiz', {
      method: 'POST',
      headers: authed({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formEncode({ postizClear: '1', _csrf: csrfRestore }))
      }),
      body: formEncode({ postizClear: '1', _csrf: csrfRestore })
    });
  }
  dbMod.reload();
  const restored = dbMod.read().settings || {};
  check('konfigurasi Postiz asli dipulihkan',
    (restored.postizBaseUrl || '') === originalConfig.postizBaseUrl
    && (restored.postizApiKey || '') === originalConfig.postizApiKey,
    JSON.stringify({ now: restored.postizBaseUrl, was: originalConfig.postizBaseUrl }));

  console.log('\n' + pass + ' lulus, ' + fail + ' gagal.');
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR: ' + err.stack);
  process.exit(1);
});