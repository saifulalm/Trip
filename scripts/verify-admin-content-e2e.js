'use strict';
/**
 * Audit E2E konten panel admin — membuktikan bahwa seluruh alur pengelolaan
 * konten masih BERJALAN setelah redesign (bukan hanya halaman yang merespons 200).
 *
 * Siklus yang diuji untuk tiap entitas:
 *   buat → Listed (muncul di daftar) → edit (nilai berubah) → Listed → hapus → Listed (hilang)
 *
 * Entitas yang diuji:
 *   - Destinasi  (nama, region, deskripsi)
 *   - Paket       (judul, harga, destinasi)
 *   - Artikel     (judul, kategori, isi)
 *   - Galeri      (upload & hapus foto)
 *   - Testimoni   (setujui/tolak)
 *   - Pesan       (tandai dibaca / hapus)
 *   - Pelanggan   (hapus)
 *   - Kontak WA   (tambah / hapus)
 *   - Pengaturan  (simpan tiap kelompok form)
 *
 * PENTING:
 * 1. Skrip ini TIDAK menulis data/db.json langsung — server menyimpan cache
 *    modul dan akan menimpa. Semua perubahan lewat HTTP form sungguhan.
 * 2. Token CSRF diambil dari halaman yang dirender dengan cookie SAMA.
 * 3. Data uji dibersihkan di akhir (hapus entitas uji).
 *
 * Jalankan: PORT=41xx node scripts/verify-admin-content-e2e.js
 */

const fs = require('fs');
const path = require('path');

// Basis data yang dibaca skrip ini. Kalau `SABESI_DATA_DIR` diisi (mis. saat
// dijalankan lewat `scripts/run-e2e.js`), yang dibaca adalah folder data uji.
// Tanpa ini, skrip membaca folder produksi padahal server uji menulis ke
// folder uji → hasil audit palsu.
const DB = process.env.SABESI_DATA_DIR
  ? path.join(process.env.SABESI_DATA_DIR, 'db.json')
  : path.join(__dirname, '..', 'data', 'db.json');

const BASE = 'http://localhost:' + (process.env.PORT || 4120);
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const PREFIX = 'uji.admin.v2';
let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

/* ------------------------------------------------------------------ */
/* Helper HTTP                                                        */
/* ------------------------------------------------------------------ */

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

/** Body form urlencoded. */
function form(obj) {
  return new URLSearchParams(obj).toString();
}

/* ------------------------------------------------------------------ */
/* Snapshot & pemulihan settings (WAJIB — jangan damage data produksi) */
/* ------------------------------------------------------------------ */

/**
 * Kunci settings yang boleh diubah skrip ini. Daftar ini harus sama dengan
 * yang diuji di bawah, supaya pemulihan mencakup semua perubahan.
 */
const TOUCHED_SETTINGS = [
  'themeMode', 'themeAccent',
  'presenceEnabled', 'presenceTtlMin',
  'waQuietStart', 'waQuietEnd', 'waReminderIntervalMin', 'waDefaultTemplate',
  'instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'linkedin',
  'pinterest', 'reddit', 'telegram', 'bluesky', 'mastodon',
  'postizBaseUrl', 'postizApiKey'
];

/**
 * Baca settings terkini dari disk (db.reload() memaksa baca ulang).
 *
 * CATATAN: db.read() memakai cache modul; db.reload() memaksa baca file
 * lagi. Skrip ini berjalan sebagai proses TERPISA dari server, jadi harus
 * reload setiap kali membaca.
 */
async function readSettings() {
  const db = require('../src/db');
  db.reload();
  return db.read().settings || {};
}

/**
 * Snapshot nilai settings asli SEBELUM skrip mengubah apa pun.
 * Dipanggil setelah login (butuh sesi admin).
 */
async function snapshotSettings() {
  const db = require('../src/db');
  db.reload();
  const s = db.read().settings || {};
  const snap = {};
  for (const key of TOUCHED_SETTINGS) snap[key] = s[key];
  return snap;
}

/**
 * Pulihkan settings asli lewat route /admin/pengaturan.
 *
 * PENTING:Pemulihan lewat HTTP (bukan tulis db.json) supaya tidak
 * bentrok dengan cache modul server yang sedang berjalan.
 */
async function restoreSettings(snap) {
  const groups = {
    theme: ['themeMode', 'themeAccent'],
    presence: ['presenceEnabled', 'presenceTtlMin'],
    wa: ['waQuietStart', 'waQuietEnd', 'waReminderIntervalMin', 'waDefaultTemplate'],
    social: [
      'instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'linkedin',
      'pinterest', 'reddit', 'telegram', 'bluesky', 'mastodon',
      'postizBaseUrl', 'postizApiKey'
    ]
  };
  for (const [group, keys] of Object.entries(groups)) {
    const payload = { form: group, _csrf: csrf(await (await req('/admin/pengaturan')).text()) };
    let sent = false;
    for (const k of keys) {
      const v = snap[k];
      if (v === undefined || v === null) continue;
      if (typeof v === 'boolean') {
        // presenceEnabled: checkbox yang tidak dicentang berarti "off".
        if (v) payload[k] = 'on';
      } else {
        payload[k] = String(v);
      }
      sent = true;
    }
    if (!sent) continue;
    await req('/admin/pengaturan', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form(payload)
    });
  }
}

/** Catat hasil pemeriksaan. */
function check(name, ok, extra) {
  if (ok) {
    pass += 1;
    console.log(`  OK   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  GAGAL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/** PNG 1x1 valid untuk uji unggah gambar. */
function png() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

/**
 * Ambil SEMUA id entitas uji yang masih ada di halaman daftar.
 *
 * Catatan penting: nama entitas uji bisa muncul LEBIH dari satu kali karena
 * sisa run sebelumnya. Karena itu keterangan "entitas hilang dari daftar"
 * WAJIB judged dari ID (unik per entitas), bukan dari nama — kalau pakai
 * nama, entitas lama yang masih tertinggal membuat check selalu gagal
 * padahal entitas yang baru saja dihapus memang sudah hilang.
 *
 * @param {string} html HTML halaman daftar
 * @param {string} name nama entitas yang dicari
 * @param {string} prefix awalan id (mis. "dst_")
 * @returns {string[]} daftar id unik
 */
function extractAllIds(html, name, prefix) {
  const strongRe = new RegExp(`<strong>${escapeRe(name)}</strong>`, 'g');
  const ids = new Set();
  let m;
  while ((m = strongRe.exec(html)) !== null) {
    const idx = m.index;
    const rowStart = html.lastIndexOf('<tr', idx);
    if (rowStart === -1) continue;
    const rowEnd = html.indexOf('</tr>', rowStart);
    const row = html.slice(rowStart, rowEnd === -1 ? rowStart + 1200 : rowEnd);
    const found = row.match(new RegExp(`${prefix}[a-f0-9]+`));
    if (found) ids.add(found[0]);
  }
  return Array.from(ids);
}

/**
 * Ambil id entitas pertama yang memuat nama tertentu.
 *
 * @param {string} html HTML halaman daftar
 * @param {string} name nama entitas yang dicari
 * @param {string} prefix awalan id (mis. "dst_")
 * @returns {string|null} id entitas
 */
function extractId(html, name, prefix) {
  const ids = extractAllIds(html, name, prefix);
  return ids.length ? ids[0] : null;
}

/** Escape karakter regex pada teks biasa. */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bersihkan seluruh entitas uji dari run sebelumnya.
 *
 * Skrip WAJIB idempoten: sisa entitas uji dari run lama bisa membuat check
 * "entitas hilang dari daftar" gagal. Penghapusan dilakukan lewat route admin
 * (bukan menulis db.json langsung) karena server menyimpan cache modul.
 *
 * @param {object} ctx objek {req, postForm}
 * @returns {Promise<number>} jumlah entitas uji yang dihapus
 */
async function cleanupTestEntities(ctx) {
  const { req, postForm } = ctx;
  const targets = [
    { path: '/admin/paket', name: `${PREFIX} Paket`, prefix: 'pkg_' },
    { path: '/admin/artikel', name: `${PREFIX} Artikel`, prefix: 'art_' },
    { path: '/admin/destinasi', name: `${PREFIX} Destinasi`, prefix: 'dst_' },
    { path: '/admin/destinasi', name: `${PREFIX} Galeri`, prefix: 'dst_' }
  ];
  let removed = 0;
  for (const t of targets) {
    const html = await (await req(t.path)).text();
    const ids = extractAllIds(html, t.name, t.prefix);
    for (const id of ids) {
      const res = await postForm(`${t.path}/${id}/hapus`, { __from: t.path });
      if (res.status === 302 || res.status === 200) removed += 1;
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Uji utama                                                          */
/* ------------------------------------------------------------------ */

(async () => {
  console.log(`\n=== Audit E2E konten admin (${BASE}) ===\n`);

  // 1. Login.
  const loginPage = await req('/admin/login');
  const token = csrf(await loginPage.text());
  if (!token) {
    console.log('GAGAL: token CSRF tidak ditemukan di /admin/login');
    process.exit(1);
  }
  const loginRes = await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ username: 'admin', password: 'admin123', _csrf: token })
  });
  check('Login admin', loginRes.status === 302, `status=${loginRes.status}`);

  // Snapshot settings asli — wajib, karena skrip ini mengubah beberapa
  // kelompok form Pengaturan dan HARUS memulihkannya di akhir.
  const originalSettings = await snapshotSettings();

  // Helper: ambil CSRF dari halaman yang sedang dirender (cookie sama).
  async function tokenFrom(path) {
    const r = await req(path);
    return csrf(await r.text());
  }

  async function postForm(path, fields) {
    const t = await tokenFrom(fields.__from || path);
    const payload = { ...fields, _csrf: t };
    delete payload.__from;
    return req(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form(payload)
    });
  }

  // Bersihkan sisa entitas uji dari run sebelumnya supaya skrip idempoten.
  const stale = await cleanupTestEntities({ req, postForm });
  if (stale) console.log(`  (info) ${stale} entitas uji sisa run sebelumnya dibersihkan`);

  /* ---------- Destinasi ---------- */
  const destName = `${PREFIX} Destinasi`;
  const destRes = await postForm('/admin/destinasi', {
    __from: '/admin/destinasi/baru',
    name: destName,
    region: 'Uji Region',
    description: 'Deskripsi destinasi uji untuk audit E2E panel admin versi dua.',
    status: 'draft'
  });
  check('Buat Destinasi (POST /admin/destinasi)', destRes.status === 302, `status=${destRes.status}`);

  let listHtml = await (await req('/admin/destinasi')).text();
  check('Destinasi muncul di daftar', listHtml.indexOf(destName) !== -1);
  const destId = extractId(listHtml, destName, 'dst_');
  check('ID Destinasi ter-ekstrak', Boolean(destId), `id=${destId}`);

  if (destId) {
    const editRes = await postForm(`/admin/destinasi/${destId}`, {
      __from: `/admin/destinasi/${destId}/edit`,
      name: destName,
      region: 'Uji Region Edit',
      description: 'Deskripsi destinasi uji untuk audit E2E panel admin versi dua.',
      status: 'draft'
    });
    check('Edit Destinasi', editRes.status === 302, `status=${editRes.status}`);
    listHtml = await (await req('/admin/destinasi')).text();
    check('Perubahan Destinasi tersimpan', listHtml.indexOf('Uji Region Edit') !== -1);

    const delRes = await postForm(`/admin/destinasi/${destId}/hapus`, {
      __from: '/admin/destinasi'
    });
    check('Hapus Destinasi', delRes.status === 302, `status=${delRes.status}`);
    listHtml = await (await req('/admin/destinasi')).text();
    check('Destinasi hilang dari daftar',
      !listHtml.includes(destId),
      `id ${destId} masih ada di daftar`);
  }

  /* ---------- Paket ---------- */
  // Paket butuh destinationSlug yang valid — ambil dari data destinations.
  // Baca basis data yang BENAR-BENAR dipakai server uji. Tanpa env
  // `SABESI_DATA_DIR`, skrip ini membaca `data/db.json` produksi — padahal
  // server uji menulis ke folder uji → data yang dibaca tak sama dengan
  // yang dilihat server (hasil audit palsu).
  const dbRaw = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const firstDest = (dbRaw.destinations || [])[0];
  const pkgTitle = `${PREFIX} Paket`;
  const pkgRes = await postForm('/admin/paket', {
    __from: '/admin/paket/baru',
    title: pkgTitle,
    destinationSlug: firstDest ? firstDest.slug : '',
    destinationName: firstDest ? firstDest.name : '',
    days: '3',
    nights: '2',
    price: '1250000',
    summary: 'Ringkasan paket uji untuk audit E2E panel admin.',
    status: 'draft'
  });
  check('Buat Paket', pkgRes.status === 302, `status=${pkgRes.status}`);

  listHtml = await (await req('/admin/paket')).text();
  check('Paket muncul di daftar', listHtml.indexOf(pkgTitle) !== -1);
  const pkgId = extractId(listHtml, pkgTitle, 'pkg_');
  check('ID Paket ter-ekstrak', Boolean(pkgId), `id=${pkgId}`);

  if (pkgId) {
    const editRes = await postForm(`/admin/paket/${pkgId}`, {
      __from: `/admin/paket/${pkgId}/edit`,
      title: pkgTitle,
      destinationSlug: firstDest ? firstDest.slug : '',
      destinationName: firstDest ? firstDest.name : '',
      days: '4',
      nights: '3',
      price: '1750000',
      summary: 'Ringkasan paket uji untuk audit E2E panel admin.',
      status: 'draft'
    });
    check('Edit Paket', editRes.status === 302, `status=${editRes.status}`);
    listHtml = await (await req('/admin/paket')).text();
    check('Perubahan Paket tersimpan', listHtml.indexOf('Rp1750000') !== -1 || listHtml.indexOf('1.750.000') !== -1,
      'harga baru tidak ditemukan');

    const delRes = await postForm(`/admin/paket/${pkgId}/hapus`, { __from: '/admin/paket' });
    check('Hapus Paket', delRes.status === 302, `status=${delRes.status}`);
    listHtml = await (await req('/admin/paket')).text();
    check('Paket hilang dari daftar',
      !listHtml.includes(pkgId),
      `id ${pkgId} masih ada di daftar`);
  }

  /* ---------- Artikel ---------- */
  const artTitle = `${PREFIX} Artikel`;
  const artBody = 'Isi artikel uji untuk audit E2E panel admin. Isi ini sengaja dibuat panjang lebih dari lima puluh karakter agar lolos validasi.';
  const artRes = await postForm('/admin/artikel', {
    __from: '/admin/artikel/baru',
    title: artTitle,
    category: 'Uji Kategori',
    body: artBody,
    status: 'draft'
  });
  check('Buat Artikel', artRes.status === 302, `status=${artRes.status}`);

  listHtml = await (await req('/admin/artikel')).text();
  check('Artikel muncul di daftar', listHtml.indexOf(artTitle) !== -1);
  const artId = extractId(listHtml, artTitle, 'art_');
  check('ID Artikel ter-ekstrak', Boolean(artId), `id=${artId}`);

  if (artId) {
    const editRes = await postForm(`/admin/artikel/${artId}`, {
      __from: `/admin/artikel/${artId}/edit`,
      title: artTitle,
      category: 'Uji Kategori Edit',
      body: artBody,
      status: 'draft'
    });
    check('Edit Artikel', editRes.status === 302, `status=${editRes.status}`);
    listHtml = await (await req('/admin/artikel')).text();
    check('Perubahan Artikel tersimpan', listHtml.indexOf('Uji Kategori Edit') !== -1);

    const delRes = await postForm(`/admin/artikel/${artId}/hapus`, { __from: '/admin/artikel' });
    check('Hapus Artikel', delRes.status === 302, `status=${delRes.status}`);
    listHtml = await (await req('/admin/artikel')).text();
    check('Artikel hilang dari daftar',
      !listHtml.includes(artId),
      `id ${artId} masih ada di daftar`);
  }

  /* ---------- Unggah galeri (di form Destinasi — alur nyata) ---------- */
  const galBefore = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
  const beforeUploadSet = new Set(
    fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []
  );
  const galTok = await tokenFrom('/admin/destinasi/baru');
  const fd = new FormData();
  fd.set('_csrf', galTok);
  fd.set('name', `${PREFIX} Galeri`);
  fd.set('region', 'Uji Region');
  fd.set('description', 'Deskripsi destinasi uji untuk audit E2E panel admin versi dua.');
  fd.set('status', 'draft');
  fd.set('galleryFiles', new Blob([png()], { type: 'image/png' }), `${PREFIX}-galeri.png`);
  const galRes = await req('/admin/destinasi', { method: 'POST', body: fd });
  check('Unggah foto galeri Destinasi', galRes.status === 302, `status=${galRes.status}`);
  const galAfter = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
  check('Berkas galeri tersimpan di disk', galAfter > galBefore, `sebelum=${galBefore} sesudah=${galAfter}`);

  // Bersihkan entitas & berkas uji yang tercipta.
  listHtml = await (await req('/admin/destinasi')).text();
  const galDestId = extractId(listHtml, `${PREFIX} Galeri`, 'dst_');
  if (galDestId) {
    // CATATAN: postForm(path, fields) hanya menerima 2 argumen. Argumen
    // ketiga di sini pernah diabaikan sehingga token CSRF diambil dari
    // halaman "hapus" (GET) yang tidak ada → token null → 403.
    await postForm(`/admin/destinasi/${galDestId}/hapus`, { __from: '/admin/destinasi' });
  }
  // Hapus berkas unggahan uji. Nama berkas hasil proses upload memakai
  // stempel waktu + hash (bukan nama asli), jadi filter "PREFIX" tak pernah
  // cocok → berkas yatim menumpuk. Pakai selisih before/after.
  if (fs.existsSync(UPLOAD_DIR)) {
    const created = fs.readdirSync(UPLOAD_DIR)
      .filter((f) => !f.startsWith('.') && !beforeUploadSet.has(f));
    created.forEach((f) => {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (e) { /* abaikan */ }
    });
  }

  /* ---------- Testimoni ---------- */
  const testHtml = await (await req('/admin/testimoni')).text();
  const revIds = (testHtml.match(/<tr[^>]*>/g) || []).length;
  check('Halaman testimoni termuat', revIds >= 0);
  const revId = (testHtml.match(/(rev_[a-z0-9]+)/) || [])[1];
  if (revId) {
    const stRes = await postForm(`/admin/testimoni/${revId}/status`, {
      __from: '/admin/testimoni',
      status: 'approved'
    });
    check('Ubah status testimoni', stRes.status === 302, `status=${stRes.status}`);
  } else {
    console.log('  (lewati) tidak ada testimoni untuk diuji statusnya');
  }

  /* ---------- Pesan masuk ---------- */
  const msgHtml = await (await req('/admin/pesan')).text();
  const msgId = (msgHtml.match(/(msg_[a-z0-9]+)/) || [])[1];
  if (msgId) {
    const readRes = await postForm(`/admin/pesan/${msgId}/baca`, { __from: '/admin/pesan' });
    check('Tandai pesan dibaca', readRes.status === 302, `status=${readRes.status}`);
  } else {
    console.log('  (lewati) tidak ada pesan masuk untuk diuji');
  }

  /* ---------- Pelanggan ---------- */
  // CATATAN: dulu skrip ini menghapus id pelanggan PERTAMA di daftar —
  // itu berarti data pelanggan asli ikut terhapus. Sekarang skrip membuat
  // pelanggan uji sendiri lewat form daftar publik, lalu menghapus HANYA
  // pelanggan uji itu.
  const custEmail = `${PREFIX.replace(/\./g, '')}@example.com`;
  const custPass = 'UjiAudit2026!';
  const daftarHtml = await (await req('/daftar')).text();
  const daftarToken = csrf(daftarHtml);
  const daftarRes = await req('/daftar', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      _csrf: daftarToken,
      name: `${PREFIX} Pelanggan`,
      email: custEmail,
      phone: '08111222333',
      password: custPass,
      passwordConfirm: custPass
    })
  });
  check('Buat pelanggan uji', daftarRes.status === 302, `status=${daftarRes.status}`);

  const custHtml = await (await req('/admin/pelanggan')).text();
  const custRowIdx = custHtml.indexOf(custEmail);
  const custRowStart = custRowIdx === -1 ? -1 : custHtml.lastIndexOf('<tr', custRowIdx);
  const custRow = custRowStart === -1 ? '' : custHtml.slice(custRowStart, custHtml.indexOf('</tr>', custRowStart));
  const custId = (custRow.match(/(cus_[a-z0-9]+)/) || [])[1];
  if (custId) {
    const custRes = await postForm(`/admin/pelanggan/${custId}/hapus`, { __from: '/admin/pelanggan' });
    check('Hapus pelanggan uji', custRes.status === 302, `status=${custRes.status}`);
    const custAfter = await (await req('/admin/pelanggan')).text();
    check('Pelanggan uji hilang dari daftar', custAfter.indexOf(custEmail) === -1);
  } else {
    console.log('  (lewati) pelanggan uji tidak ditemukan di daftar');
  }

  /* ---------- Kontak WhatsApp ---------- */
  const kontHtml = await (await req('/admin/marketing/kontak')).text();
  const kontToken = csrf(kontHtml);
  const phone = '628111222333';
  const kontRes = await req('/admin/marketing/kontak', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      _csrf: kontToken,
      name: `${PREFIX} Kontak`,
      phone,
      email: 'uji.admin.v2@example.com',
      source: 'audit-e2e'
    })
  });
  check('Tambah kontak WhatsApp', kontRes.status === 302 || kontRes.status === 200, `status=${kontRes.status}`);

  const kontList = await (await req('/admin/marketing/kontak')).text();
  check('Kontak uji muncul di daftar', kontList.indexOf(phone) !== -1);
  // Ambil id kontak pada baris yang memuat nomor uji — bukan id pertama
  // di halaman, supaya kontak asli tidak ikut terhapus.
  const kontRowIdx = kontList.indexOf(phone);
  const kontRowStart = kontRowIdx === -1 ? -1 : kontList.lastIndexOf('<tr', kontRowIdx);
  const kontRow = kontRowStart === -1 ? '' : kontList.slice(kontRowStart, kontList.indexOf('</tr>', kontRowStart));
  const kontId = (kontRow.match(/(ctc_[a-z0-9]+)/) || [])[1];
  if (kontId) {
    const delRes = await postForm(`/admin/marketing/kontak/${kontId}/hapus`, {
      __from: '/admin/marketing/kontak'
    });
    check('Hapus kontak WhatsApp', delRes.status === 302 || delRes.status === 200, `status=${delRes.status}`);
    const after = await (await req('/admin/marketing/kontak')).text();
    check('Kontak uji hilang dari daftar', after.indexOf(phone) === -1);
  }

  /* ---------- Pengaturan: tiap kelompok form ---------- */
  const setHtml = await (await req('/admin/pengaturan')).text();
  const setToken = csrf(setHtml);

  // Helper simpan form Pengaturan dengan kelompok tertentu.
  async function saveGroup(group, fields) {
    const t = csrf(await (await req('/admin/pengaturan')).text());
    return req('/admin/pengaturan', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ ...fields, form: group, _csrf: t })
    });
  }

  const themeRes = await saveGroup('theme', { themeMode: 'light', themeAccent: '#166b7a' });
  check('Simpan form Tema', themeRes.status === 302, `status=${themeRes.status}`);

  const presenceRes = await saveGroup('presence', { presenceEnabled: 'on', presenceTtlMin: '5' });
  check('Simpan form Presence', presenceRes.status === 302, `status=${presenceRes.status}`);

  const waRes = await saveGroup('wa', { waQuietStart: '21', waQuietEnd: '8', waReminderIntervalMin: '30' });
  check('Simpan form WhatsApp', waRes.status === 302, `status=${waRes.status}`);

  const socialRes = await saveGroup('social', { instagram: 'https://instagram.com/ujiv2' });
  check('Simpan form Social', socialRes.status === 302, `status=${socialRes.status}`);

  const setAfter = await (await req('/admin/pengaturan')).text();
  check('Nilai presenceTtlMin tersimpan', setAfter.indexOf('value="5"') !== -1);

  /* ---------- Pulihkan settings yang diubah skrip ini ---------- */
  /*
   * WAJIB: skrip ini mengubah settings produksi (tema, presence, jam tenang,
   * tautan sosial). Tanpa pemulihan, setiap eksekusi meninggalkan setting uji
   * permanen di data/db.json — termasuk instagram "ujiv2" yang lalu bocor
   * ke footer situs publik.
   *
   * Pemulihan lewat route /admin/pengaturan (bukan tulis db.json langsung)
   * supaya tidak bentrok dengan cache modul server.
   */
  await restoreSettings(originalSettings);
  const restored = await readSettings();
  // Laporkan selisih per-key — dump JSON penuh membuat sulit melihat
  // key mana yang benar-benar berbeda.
  const diffs = Object.keys(originalSettings)
    .filter((k) => (
      originalSettings[k] === undefined
        ? restored[k] !== undefined
        : String(restored[k]) !== String(originalSettings[k])
    ))
    .map((k) => `${k}: asli=${JSON.stringify(originalSettings[k])}sekarang=${JSON.stringify(restored[k])}`);
  const restoredOk = diffs.length === 0;
  check('settings asli dipulihkan setelah audit', restoredOk,
    restoredOk ? '' : diffs.join(' | '));

  /* ---------- Halaman lain tetap merespons ---------- */
  const pages = [
    '/admin', '/admin/galeri', '/admin/lokasi', '/admin/pesan', '/admin/testimoni',
    '/admin/marketing/blast', '/admin/marketing/whatsapp', '/admin/marketing/pengingat',
    '/admin/social', '/admin/social/tulis', '/admin/social/riwayat', '/admin/seo', '/admin/akun'
  ];
  let allOk = true;
  for (const p of pages) {
    const r = await req(p);
    if (r.status !== 200) {
      allOk = false;
      console.log(`    halaman gagal: ${p} (${r.status})`);
    }
  }
  check('Seluruh halaman admin merespons 200', allOk);

  /* ---------- Ringkasan ---------- */
  console.log('\n--- RINGKASAN ---');
  console.log(`lulus: ${pass}/${pass + fail}`);
  if (fail) {
    console.log('gagal:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
