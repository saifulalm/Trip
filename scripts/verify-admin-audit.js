'use strict';
/**
 * Uji audit panel admin — celah yang ditemukan lewat peninjauan kode.
 *
 * 1. Batas jumlah berkas multipart (multer) vs batas galeri di UI (8 foto).
 * 2. Form "Simpan Tema" tidak boleh mematikan tombol WhatsApp mengambang.
 * 3. Checkbox "mode production" bisa dimatikan dari panel.
 * 4. Kunci API bisa dikosongkan dari panel.
 * 5. Berkas gambar lama dihapus saat diganti (tidak ada berkas yatim).
 * 6. Isolasi antar-form di halaman Pengaturan (tiap form hanya mengubah
 *    field miliknya sendiri).
 *
 * PENTING: skrip ini TIDAK menulis data/db.json secara langsung. Server
 * menyimpan cache di memori dan menuliskannya kembali saat menyimpan
 * perubahan — menulis file dari luar bisa balut dengan cache basi dan
 * merusak database. Semua setelan dilakukan lewat HTTP form sungguhan,
 * dan nilai awal dipulihkan di akhir skrip.
 *
 * Jalankan: PORT=41xx node scripts/verify-admin-audit.js
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:' + (process.env.PORT || 4110);
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
// Basis data yang dibaca skrip ini. Kalau `SABESI_DATA_DIR` diisi (mis. saat
// dijalankan lewat `scripts/run-e2e.js`), yang dibaca adalah folder data uji
// — bukan `data/db.json` produksi. Tanpa ini, skrip yang membaca & menulis
// settings lewat HTTP bisa membaca nilai yang salah (server uji menulis ke
// folder uji, skrip membaca folder produksi) → hasil audit palsu.
const DB = process.env.SABESI_DATA_DIR
  ? path.join(process.env.SABESI_DATA_DIR, 'db.json')
  : path.join(__dirname, '..', 'data', 'db.json');

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

/** Daftar berkas di folder uploads. */
function listUploads() {
  return fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter((f) => !f.endsWith('.gitkeep')) : [];
}

/** Baca data dari database (hanya baca). */
const readDb = () => JSON.parse(fs.readFileSync(DB, 'utf8'));

/** Baca settings saat ini (hanya baca). */
const settings = () => readDb().settings;

/** Login admin. */
async function login() {
  const lp = await req('/admin/login');
  const lt = csrf(await lp.text());
  await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: lt, username: 'admin', password: 'admin123' }).toString()
  });
}

const results = [];

/**
 * Catat hasil uji.
 * @param {string} name nama uji
 * @param {boolean} ok lulus/tidak
 * @param {string} info keterangan
 */
function report(name, ok, info) {
  results.push({ name, ok, info });
  console.log(`${ok ? 'OK  ' : 'BUG '} ${name}${info ? ' — ' + info : ''}`);
}

/**
 * Kirim form Pengaturan dengan kelompok field tertentu.
 * @param {string} form kelompok form (site|theme|payment|gateway|wa)
 * @param {object} fields field yang dikirim
 * @returns {Promise<object>} settings setelah disimpan
 */
async function sendSettings(form, fields) {
  const gp = await req('/admin/pengaturan');
  const gt = csrf(await gp.text());
  const fd = new FormData();
  fd.set('_csrf', gt);
  fd.set('form', form);
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
  await req('/admin/pengaturan', { method: 'POST', body: fd });
  return settings();
}

/** Nilai wajib checkbox: 'on' bila aktif, kosong bila tidak. */
const flag = (v) => (v ? 'on' : '');

(async () => {
  await login();

  // Simpan nilai awal supaya bisa dipulihkan di akhir.
  const original = Object.assign({}, settings());

  /* ---------------------------------------------------------------- */
  /* 1. Batas jumlah berkas multipart                                  */
  /* ---------------------------------------------------------------- */
  {
    const fp = await req('/admin/destinasi/baru');
    const t = csrf(await fp.text());
    const fd = new FormData();
    fd.set('_csrf', t);
    fd.set('name', 'Uji Batas Berkas');
    fd.set('region', 'Uji Region');
    fd.set('description', 'Deskripsi uji batas jumlah berkas multipart.');
    fd.set('imageFile', new Blob([png()], { type: 'image/png' }), 'main.png');
    // UI mengizinkan 8 foto galeri → total 9 berkas dalam satu request.
    for (let i = 0; i < 8; i += 1) {
      fd.append('galleryFiles', new Blob([png()], { type: 'image/png' }), `g${i}.png`);
    }
    const res = await req('/admin/destinasi', { method: 'POST', body: fd });
    const list = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Batas Berkas'));
    const html = await list.text();
    const idm = html.match(/\/admin\/destinasi\/([\w-]+)\/edit/);
    const id = idm && idm[1];
    const dest = id ? readDb().destinations.find((d) => d.id === id) : null;
    const ok = res.status === 302 && dest && dest.gallery.length === 9;
    report(
      '1. Unggah 1 utama + 8 galeri (batas UI = 8 foto)',
      ok,
      `status=${res.status} gallery=${dest ? dest.gallery.length : 'entri tidak dibuat'}`
    );

    if (id) {
      const dp = await req('/admin/destinasi/' + id + '/edit');
      const dt = csrf(await dp.text());
      await req('/admin/destinasi/' + id + '/hapus', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: dt }).toString()
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* 2. Form Tema tidak mematikan tombol WhatsApp mengambang            */
  /* ---------------------------------------------------------------- */
  {
    // Nyalakan dulu lewat form "site" (pemilik field waFloatEnabled).
    await sendSettings('site', { waFloatEnabled: 'on' });
    const before = settings().waFloatEnabled;
    const after = (await sendSettings('theme', { themeMode: 'light', themeAccent: '#166b7a' })).waFloatEnabled;
    report(
      '2. Simpan Tema tidak mematikan tombol WhatsApp mengambang',
      before === true && after === true,
      `sebelum=${before} sesudah=${after}`
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3. Checkbox "mode production" bisa dimatikan                         */
  /* ---------------------------------------------------------------- */
  {
    // Nyalakan dulu (checkbox dicentang → 'on'), lalu matikan (tanpa field).
    const on = await sendSettings('gateway', { ipaymuProduction: 'on' });
    const off = await sendSettings('gateway', {
      ipaymuVa: '1179000899',
      ipaymuApiKey: 'kunci-api-uji'
    });
    report(
      '3. Checkbox "mode production" bisa dimatikan dari panel',
      on.ipaymuProduction === true && off.ipaymuProduction === false,
      `nyala=${on.ipaymuProduction} mati=${off.ipaymuProduction}`
    );
  }

  /* ---------------------------------------------------------------- */
  /* 4. Kunci API bisa dikosongkan                                       */
  /* ---------------------------------------------------------------- */
  {
    await sendSettings('gateway', {
      ipaymuVa: '1179000899',
      ipaymuApiKey: 'kunci-api-uji'
    });
    await sendSettings('wa', { waDefaultTemplate: 'Halo {{nama}}' });
    const s = await sendSettings('gateway', { ipaymuVa: '', ipaymuApiKey: '' });
    const w = await sendSettings('wa', { waDefaultTemplate: '' });
    report(
      '4. Kunci API bisa dikosongkan dari panel',
      !s.ipaymuVa && !s.ipaymuApiKey && !w.waDefaultTemplate,
      `ipaymuVa="${s.ipaymuVa}" ipaymuApiKey="${s.ipaymuApiKey}" wa="${w.waDefaultTemplate}"`
    );
  }

  /* ---------------------------------------------------------------- */
  /* 5. Berkas lama dihapus saat gambar diganti                         */
  /* ---------------------------------------------------------------- */
  {
    const before = settings().logo;
    const beforeFile = before && before.startsWith('/uploads/') ? before.split('/').pop() : null;
    const filesBefore = listUploads();

    const gp = await req('/admin/pengaturan');
    const gt = csrf(await gp.text());
    const fd = new FormData();
    fd.set('_csrf', gt);
    fd.set('form', 'site');
    fd.set('logoFile', new Blob([png()], { type: 'image/png' }), 'logo.png');
    await req('/admin/pengaturan', { method: 'POST', body: fd });

    const after = settings().logo;
    const filesAfter = listUploads();
    const orphan = filesAfter.filter((f) => !filesBefore.includes(f) && f !== (after || '').split('/').pop());
    const oldStillThere = beforeFile ? fs.existsSync(path.join(UPLOAD_DIR, beforeFile)) : false;
    report(
      '5. Berkas logo lama dihapus saat diganti',
      !oldStillThere && orphan.length === 0,
      `lama masih ada=${oldStillThere} orphan=${orphan.join(',') || '(tidak ada)'}`
    );
  }

  /* ---------------------------------------------------------------- */
  /* 6. Isolasi antar-form di halaman Pengaturan                        */
  /* ---------------------------------------------------------------- */
  {
    // Siapkan nilai awal yang berbeda untuk tiap kelompok field.
    await sendSettings('site', {
      siteName: 'Nama Situs Uji',
      tagline: 'Tagline Uji',
      waFloatEnabled: 'on',
      waFloatMessage: 'Halo dari uji'
    });
    await sendSettings('gateway', {
      ipaymuVa: '1179000899',
      ipaymuApiKey: 'kunci-api-uji',
      ipaymuProduction: 'on'
    });
    await sendSettings('wa', { waDefaultTemplate: 'Halo {{nama}}' });
    await sendSettings('theme', { themeMode: 'light', themeAccent: '#166b7a' });

    let s = await sendSettings('theme', { themeMode: 'dark', themeAccent: '#c2410c' });
    report(
      '6a. Form Tema tidak mengubah field form lain',
      s.themeMode === 'dark' && s.themeAccent === '#c2410c' &&
        s.siteName === 'Nama Situs Uji' &&
        s.ipaymuVa === '1179000899' && s.ipaymuProduction === true &&
        s.waDefaultTemplate === 'Halo {{nama}}' && s.waFloatEnabled === true,
      `mode=${s.themeMode} site=${s.siteName} va=${s.ipaymuVa} template=${s.waDefaultTemplate} float=${s.waFloatEnabled}`
    );

    s = await sendSettings('gateway', {
      ipaymuVa: '1179000888',
      ipaymuApiKey: 'kunci-api-uji-2'
    });
    report(
      '6b. Form Gateway tidak mengubah field form lain',
      s.ipaymuVa === '1179000888' && s.ipaymuApiKey === 'kunci-api-uji-2' &&
        s.siteName === 'Nama Situs Uji' && s.waDefaultTemplate === 'Halo {{nama}}' &&
        s.waFloatEnabled === true && s.themeMode === 'dark',
      `va=${s.ipaymuVa} site=${s.siteName} template=${s.waDefaultTemplate} theme=${s.themeMode}`
    );

    s = await sendSettings('site', { siteName: 'Nama Situs Baru', tagline: 'Tagline Baru' });
    report(
      '6c. Form Situs tidak mengubah field form lain',
      s.siteName === 'Nama Situs Baru' && s.tagline === 'Tagline Baru' &&
        s.ipaymuVa === '1179000888' &&
        s.waDefaultTemplate === 'Halo {{nama}}' && s.waFloatEnabled === true && s.themeMode === 'dark',
      `site=${s.siteName} va=${s.ipaymuVa} template=${s.waDefaultTemplate} theme=${s.themeMode}`
    );

    s = await sendSettings('wa', { waDefaultTemplate: 'Halo2 {{nama}}' });
    report(
      '6d. Form WA tidak mengubah field form lain',
      s.waDefaultTemplate === 'Halo2 {{nama}}' && s.siteName === 'Nama Situs Baru' &&
        s.ipaymuVa === '1179000888' && s.themeMode === 'dark',
      `template=${s.waDefaultTemplate} site=${s.siteName} va=${s.ipaymuVa} theme=${s.themeMode}`
    );
  }

  /* ---------------------------------------------------------------- */
  /* Pulihkan nilai awal settings                                        */
  /* ---------------------------------------------------------------- */
  {
    await sendSettings('site', {
      siteName: original.siteName || '',
      tagline: original.tagline || '',
      heroTitle: original.heroTitle || '',
      heroSubtitle: original.heroSubtitle || '',
      whatsapp: original.whatsapp || '',
      email: original.email || '',
      phone: original.phone || '',
      address: original.address || '',
      instagram: original.instagram || '',
      facebook: original.facebook || '',
      about: original.about || '',
      waFloatEnabled: flag(original.waFloatEnabled !== false),
      waFloatMessage: original.waFloatMessage || ''
    });
    await sendSettings('gateway', {
      ipaymuVa: original.ipaymuVa || '',
      ipaymuApiKey: original.ipaymuApiKey || '',
      ipaymuProduction: flag(original.ipaymuProduction)
    });
    await sendSettings('wa', {
      waDefaultTemplate: original.waDefaultTemplate || ''
    });

    await sendSettings('theme', {
      themeMode: original.themeMode || 'light',
      themeAccent: original.themeAccent || '#166b7a'
    });
    console.log('\nsettings awal dipulihkan.');
  }

  console.log('\n--- RINGKASAN ---');
  const bad = results.filter((r) => !r.ok);
  console.log(`lulus: ${results.length - bad.length}/${results.length}`);
  if (bad.length) console.log('gagal:\n' + bad.map((r) => `  - ${r.name}: ${r.info}`).join('\n'));
  // Exit code HARUS mencerminkan hasil audit: kalau ada pemeriksaan yang
  // gagal, proses harus keluar dengan kode non-zero. Sebelumnya skrip ini
  // selalu keluar 0 walau ada BUG — sehingga kegagalan tak pernah terlihat
  // oleh runner/CI.
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
