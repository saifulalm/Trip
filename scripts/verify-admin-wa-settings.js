'use strict';
/**
 * Uji Task 9: konfigurasi OpenWA & batas pengiriman bisa diatur dari panel admin.
 *
 * Menguji lewat HTTP sungguhan ke server uji:
 *  1. Halaman /admin/pengaturan merender 3 field baru (openwaTimeoutMs,
 *     frequencyCap, globalDailyLimit) di form yang benar (scope openwa/wa).
 *  2. Menyimpan form `openwa` menulis openwaTimeoutMs.
 *  3. Menyimpan form `wa` menulis frequencyCap & globalDailyLimit.
 *  4. Nilai di luar rentang dijepit ke batas (min/max).
 *
 * Jalankan: PORT=43xx node scripts/verify-admin-wa-settings.js
 */
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:' + (process.env.PORT || 4110);

// WAJIB: skrip ini mengubah settings lewat route HTTP sungguhan. Kalau
// diarahkan ke server produksi, nilainya akan tertinggal di data/db.json.
// Karena itu folder data uji WAJIB diisi lewat SABESI_DATA_DIR.
if (!process.env.SABESI_DATA_DIR) {
  console.error(
    'FATAL: env SABESI_DATA_DIR wajib diisi. Skrip ini mengubah settings ' +
    'sungguhan — jalankan lewat server uji (scripts/run-e2e.js) atau folder ' +
    'data sementara, BUKAN server produksi.'
  );
  process.exit(1);
}
const DB = path.join(process.env.SABESI_DATA_DIR, 'db.json');

let cookie = '';

function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const p = c.split(';')[0];
    const [n] = p.split('=');
    cookie = cookie.split('; ').filter((x) => x && !x.startsWith(n + '=')).concat([p]).join('; ');
  }
}

async function req(u, o = {}) {
  const r = await fetch(BASE + u, { redirect: 'manual', ...o, headers: { cookie, ...(o.headers || {}) } });
  saveCookie(r);
  return r;
}

function csrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/** Ambil nilai settings terbaru dari disk (server menyimpan cache di memori). */
function settings() {
  return JSON.parse(fs.readFileSync(DB, 'utf8')).settings || {};
}

async function save(form, fields) {
  const page = await req('/admin/pengaturan');
  const token = csrf(await page.text());
  const fd = new FormData();
  fd.set('_csrf', token);
  fd.set('form', form);
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
  const res = await req('/admin/pengaturan', { method: 'POST', body: fd });
  return res.status;
}

let pass = 0;
let fail = 0;
function t(name, ok, info) {
  if (ok) {
    pass += 1;
    console.log('OK   ' + name);
  } else {
    fail += 1;
    console.log('GAGAL ' + name + (info ? ' — ' + info : ''));
  }
}

(async () => {
  // ── Login admin ──────────────────────────────────────────────────
  const lp = await req('/admin/login');
  const lt = csrf(await lp.text());
  const li = await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'admin123', _csrf: lt }).toString()
  });
  t('login admin', li.status === 302, 'status ' + li.status);

  // Snapshot nilai awal — dipulihkan di akhir skrip (blok try/finally
  // di bawah). Kalau skrip gagal di tengah jalan, nilai awal tetap
  // dikembalikan supaya folder data uji tidak tertinggal dalam keadaan
  // setengah jadi.
  const original = Object.assign({}, settings());

  // ── Halaman merender field baru ──────────────────────────────────
  // Seluruh pemeriksaan & penyimpanan dibungkus try/finally: blok
  // `finally` selalu memulihkan nilai awal, sehingga folder data uji
  // tidak pernah tertinggal dalam keadaan setengah jadi.
  try {
    const html = await (await req('/admin/pengaturan')).text();
    t('form openwa merender field timeout', html.includes('name="openwaTimeoutMs"'));
    t('form wa merender field batas per kontak', html.includes('name="frequencyCap"'));
    t('form wa merender field batas harian', html.includes('name="globalDailyLimit"'));
    // Field batas pengiriman harus berada di form scope `wa` (bukan form lain).
    const waForm = html.slice(html.indexOf('name="form" value="wa"'));
    const waFormEnd = waForm.indexOf('</form>');
    const waSection = waForm.slice(0, waFormEnd);
    t('field batas pengiriman ada di form scope wa', waSection.includes('name="frequencyCap"') && waSection.includes('name="globalDailyLimit"'));
    const openwaForm = html.slice(html.indexOf('name="form" value="openwa"'));
    const openwaSection = openwaForm.slice(0, openwaForm.indexOf('</form>'));
    t('field timeout ada di form scope openwa', openwaSection.includes('name="openwaTimeoutMs"'));

    // ── Penyimpanan ──────────────────────────────────────────────────
    const st1 = await save('openwa', { openwaTimeoutMs: '4500' });
    t('simpan form openwa -> 302', st1 === 302, 'status ' + st1);
    t('openwaTimeoutMs tersimpan (4500)', settings().openwaTimeoutMs === 4500, 'nilai ' + settings().openwaTimeoutMs);

    const st2 = await save('wa', { frequencyCap: '7', globalDailyLimit: '250' });
    t('simpan form wa -> 302', st2 === 302, 'status ' + st2);
    t('frequencyCap tersimpan (7)', settings().frequencyCap === 7, 'nilai ' + settings().frequencyCap);
    t('globalDailyLimit tersimpan (250)', settings().globalDailyLimit === 250, 'nilai ' + settings().globalDailyLimit);

    // ── Nilai di luar rentang dijepit ────────────────────────────────
    await save('openwa', { openwaTimeoutMs: '10' });
    t('timeout di bawah minimum dijepit ke 3000', settings().openwaTimeoutMs === 3000, 'nilai ' + settings().openwaTimeoutMs);
    await save('openwa', { openwaTimeoutMs: '999999' });
    t('timeout di atas maksimum dijepit ke 120000', settings().openwaTimeoutMs === 120000, 'nilai ' + settings().openwaTimeoutMs);
    await save('wa', { frequencyCap: '999', globalDailyLimit: '5' });
    t('frequencyCap dijepit ke 50', settings().frequencyCap === 50, 'nilai ' + settings().frequencyCap);
    t('globalDailyLimit dijepit ke 10', settings().globalDailyLimit === 10, 'nilai ' + settings().globalDailyLimit);

    // ── Batas atas globalDailyLimit = 500 (ikut retensi log harian) ──
    await save('wa', { globalDailyLimit: '5000' });
    t('globalDailyLimit dijepit ke 500 (batas atas = retensi log harian)',
      settings().globalDailyLimit === 500, 'nilai ' + settings().globalDailyLimit);

    // ── Isolasi antar-form: form lain tidak boleh mengubah key baru ──
    await save('theme', { themeMode: 'light', themeAccent: '#166b7a' });
    t('form theme tidak mengubah batas pengiriman',
      settings().frequencyCap === 50 && settings().globalDailyLimit === 500,
      'cap=' + settings().frequencyCap + ' limit=' + settings().globalDailyLimit);
  } finally {
    // ── Pulihkan nilai awal (jangan tinggalkan setelan uji) ─────────
    try {
      await save('openwa', { openwaTimeoutMs: String(original.openwaTimeoutMs) });
      await save('wa', {
        frequencyCap: String(original.frequencyCap),
        globalDailyLimit: String(original.globalDailyLimit)
      });
      t('settings awal dipulihkan',
        settings().openwaTimeoutMs === original.openwaTimeoutMs &&
        settings().frequencyCap === original.frequencyCap &&
        settings().globalDailyLimit === original.globalDailyLimit,
        'timeout=' + settings().openwaTimeoutMs +
        ' cap=' + settings().frequencyCap +
        ' limit=' + settings().globalDailyLimit);
    } catch (err) {
      // Pemulihan gagal — tetap laporkan, jangan menelan error-nya.
      console.log('GAGAL settings awal dipulihkan — ' + String((err && err.message) || err));
      fail += 1;
    }
  }

  console.log('\nlulus: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
