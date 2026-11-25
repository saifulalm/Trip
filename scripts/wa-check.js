const path = require('path');
const root = path.join(__dirname, '..');

/*
 * Modul WhatsApp yang diuji adalah gateway OpenWA (REST API) — bukan lagi
 * whatsapp-web.js yang menjalankan Chromium di dalam proses Node.
 */
const modules = [
  'src/services/wa-gateway.js',
  'src/services/wa-gateway-webhook.js',
  'src/services/wa.js',
  'src/services/wa-worker.js',
  'src/services/wa-reminder.js',
  'src/services/wa-scheduler.js',
  'src/routes/marketing.routes.js',
  'src/routes/openwa-webhook.routes.js',
  'src/routes/admin.routes.js',
  'src/routes/public.routes.js',
  'src/routes/payment.routes.js',
  'src/payment/ipaymu.js',
  'src/seed.js',
  'src/app.js'
];

let failed = 0;
for (const m of modules) {
  try {
    require(path.join(root, m));
    console.log('OK  ', m);
  } catch (err) {
    failed += 1;
    console.log('FAIL', m, '->', err.message);
  }
}

// Cek template EJS bisa dikompilasi.
const ejs = require(path.join(root, 'node_modules', 'ejs'));
const fs = require('fs');
const views = [
  'admin/whatsapp.ejs',
  'admin/reminder.ejs',
  'admin/blast.ejs',
  'admin/contacts.ejs',
  'admin/settings.ejs',
  'admin/bookings.ejs',
  'admin/booking-detail.ejs',
  'pages/payment.ejs',
  'layouts/admin.ejs'
];
for (const v of views) {
  const file = path.join(root, 'views', v);
  try {
    ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
    console.log('EJS OK  ', v);
  } catch (err) {
    failed += 1;
    console.log('EJS FAIL', v, '->', err.message);
  }
}

// Jumlah kegagalan muat modul / EJS. Nilai ini WAJIB memengaruhi exit code
// akhir skrip — kalau tidak, skrip selalu keluar 0 padahal ada modul rusak.
const loadFailed = failed;

console.log(loadFailed ? `\n${loadFailed} masalah.` : '\nSemua modul & template OK.');

/* ------------------------------------------------------------------ */
/* Penjaga: modul whatsapp-web.js tidak boleh kembali dipakai          */
/* ------------------------------------------------------------------ */

/*
 * Backend tidak lagi menjalankan Chromium. Kalau ada yang me-require
 * `whatsapp-web.js` atau `qrcode` lagi, berarti ada jalur kode yang masih
 * masih memaksa browser jalan di dalam proses Node — harus kembali ke
 * gateway OpenWA.
 *
 * Berkas yang sudah dihapus juga dicek: file-nya tidak boleh muncul lagi
 * (bisa jadi ter-restore dari commit lama atau di-copy manual).
 */
const bannedModules = ['whatsapp-web.js', 'qrcode'];
const bannedFiles = [
  'src/services/wa-client.js',
  'src/services/wa_new.js',
  'src/services/wa_new_deliverTo.js',
  'scripts/wa-lock.test.js',
  'scripts/wa-webjs-smoke.js'
];

let guardFailed = 0;

for (const f of bannedFiles) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) {
    guardFailed += 1;
    console.log('FAIL berkas usang masih ada ->', f);
  }
}

const scanDirs = ['src', 'scripts', 'views'];
for (const dir of scanDirs) {
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(js|ejs)$/.test(entry.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const mod of bannedModules) {
        // Abaikan komentar — hanya `require(...)` yang dihitung.
        if (new RegExp(`require\\(['"]${mod.replace('.', '\\.')}['"]\\)`).test(text)) {
          guardFailed += 1;
          console.log(`FAIL ${mod} masih di-require ->`, path.relative(root, p));
        }
      }
    }
  };
  walk(path.join(root, dir));
}

/* ------------------------------------------------------------------ */
/* Penjaga: sisa modul WhatsApp legacy tidak boleh kembali            */
/* ------------------------------------------------------------------ */

/*
 * Modul WhatsApp lama sudah dibuang. Stub `config()` dan `isActive()`
 * pernah tersisa sebagai alias mati — kalau muncul lagi berarti masih ada
 * jalur kode yang mengharapkan API lama (token/phoneId) yang sudah tidak
 * berlaku.
 */
const legacyWaExports = ['config', 'isActive'];

let legacyFailed = 0;
let waService = null;
try {
  waService = require(path.join(root, 'src', 'services', 'wa'));
} catch (err) {
  legacyFailed += 1;
  console.log('FAIL modul src/services/wa.js gagal dimuat ->', err.message);
}

if (waService) {
  legacyWaExports.forEach((name) => {
    if (typeof waService[name] === 'function') {
      legacyFailed += 1;
      console.log(`FAIL wa.${name}() masih ada — stub lama tidak boleh kembali`);
    }
  });
}

// Komentar basi yang menyebut whatsapp-web.js juga dilarang: kalau
// ada, berarti ada yang menyalin ulang dokumentasi arsitektur lama.
const staleCommentFiles = ['src/services/wa.js', 'scripts/migrate-seed-payment.js'];
staleCommentFiles.forEach((rel) => {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  if (/whatsapp-web\.js/.test(text)) {
    legacyFailed += 1;
    console.log(`FAIL ${rel} masih menyebut whatsapp-web.js di komentar`);
  }
});

/* ------------------------------------------------------------------ */
/* Penjaga: pemanggil API WhatsApp yang sudah DIHAPUS                 */
/* ------------------------------------------------------------------ */

/*
 * Fungsi `config()` dan `isActive()` pada modul WhatsApp (`src/services/wa.js`)
 * sudah dihapus (stub Meta Cloud API / alias mati). Kalau masih ada
 * pemanggilnya, aplikasi crash saat runtime dengan
 * `TypeError: wa.<nama> is not a function`.
 *
 * Penjaga ini memindai SELURUH `src/`, `scripts/`, dan `views/` — bukan
 * hanya dua berkas tertentu — supaya pemanggil yang terlewat di mana pun
 * langsung gagal saat pemeriksaan, sebelum ikut ter-commit.
 *
 * Isi komentar dan string literal TIDAK dihitung sebagai pemanggil; hanya
 * kode yang benar-benar memanggil fungsi yang dihapus.
 */

// Prefix modul dirakit dari potongan supaya berkas penjaga ini sendiri
// tidak memuat pola persis yang sedang dicari.
const WA_MODULE_PREFIX = 'wa' + '.';
const removedWaApiNames = ['config', 'isActive'];

/**
 * Buang komentar, string literal, dan regex literal dari teks sumber supaya
 * pemeriksaan hanya melihat kode yang benar-benar dieksekusi.
 *
 * @param {string} text teks sumber berkas
 * @returns {string} teks tanpa komentar, string, dan regex literal
 */
function stripCommentsAndStrings(text) {
  const out = [];
  let i = 0;
  let state = 'code'; // code | line | block | sq | dq | tpl | regex
  let inClass = false;
  const n = text.length;

  // Helper: karakter terakhir yang bukan spasi di hasil sementara.
  const lastMeaningful = () => {
    for (let k = out.length - 1; k >= 0; k -= 1) {
      const ch = out[k];
      if (ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r') return ch;
    }
    return '';
  };

  while (i < n) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);

    if (state === 'code') {
      if (c2 === '//') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c2 === '/*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl';
        out.push(' ');
        i += 1;
        continue;
      }
      if (c === '/') {
        // Heuristik: `/` memulai regex literal bila karakter sebelumnya
        // mengizinkan (awal baris, operator, koma, kurung, dsb).
        const prev = lastMeaningful();
        const regexStart = prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);
        if (regexStart) {
          state = 'regex';
          inClass = false;
          out.push(' ');
          i += 1;
          continue;
        }
      }
      out.push(c);
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out.push('\n');
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (c2 === '*/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (c === '\n') out.push('\n');
      i += 1;
      continue;
    }

    if (state === 'regex') {
      if (c === '\\') {
        out.push(' ');
        if (i + 1 < n && text[i + 1] === '\n') out.push('\n');
        i += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        state = 'code';
        out.push(' ');
        i += 1;
        continue;
      }
      if (c === '\n') out.push('\n');
      else out.push(' ');
      i += 1;
      continue;
    }

    // Di dalam string literal: isinya dibuang (kecuali baris baru).
    if (c === '\\') {
      out.push(' ');
      if (i + 1 < n && text[i + 1] === '\n') out.push('\n');
      i += 2;
      continue;
    }
    if (c === '\n') {
      out.push('\n');
      i += 1;
      continue;
    }
    out.push(' ');
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    i += 1;
  }
  return out.join('');
}

let callerFailed = 0;

for (const dir of scanDirs) {
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(js|ejs)$/.test(entry.name)) continue;
      const code = stripCommentsAndStrings(fs.readFileSync(p, 'utf8'));
      const lines = code.split('\n');
      for (const apiName of removedWaApiNames) {
        // Prefix modul harus berdiri sendiri: karakter sebelum "wa" tidak
        // boleh huruf/angka/underscore/titik, agar `gateway.config(` atau
        // `obj.wa.isActive(` tidak ikut terhitung.
        const regex = new RegExp(
          '(^|[^\\w$.])' + WA_MODULE_PREFIX.replace('.', '\\.') +
          apiName + '\\s*\\('
        );
        for (let idx = 0; idx < lines.length; idx += 1) {
          if (!regex.test(lines[idx])) continue;
          callerFailed += 1;
          console.log(
            `FAIL wa.${apiName}() dipanggil, padahal fungsi itu sudah dihapus ->`,
            path.relative(root, p) + ':' + (idx + 1)
          );
        }
      }
    }
  };
  walk(path.join(root, dir));
}

if (callerFailed) {
  console.log(
    `\n${callerFailed} pemanggil API WhatsApp yang sudah dihapus ditemukan. ` +
    'Ganti dengan API yang tersedia (mis. wa.isReady() / wa.canSend()).'
  );
}

/* ------------------------------------------------------------------ */
/* Exit code akhir: SEMUA penjaga ikut menentukan                      */
/* ------------------------------------------------------------------ */

if (guardFailed) {
  console.log(`\n${guardFailed} masalah.`);
}

if (legacyFailed) {
  console.log(`\n${legacyFailed} masalah.`);
}

// Exit code non-zero bila salah satu saja gagal: modul/EJS gagal dimuat,
// berkas usang kembali, stub legacy muncul, atau ada pemanggil API yang
// sudah dihapus.
if (guardFailed || legacyFailed || callerFailed || loadFailed) {
  process.exit(1);
}

console.log('Penjaga: tidak ada sisa modul WhatsApp legacy.');
console.log('\nPenjaga: tidak ada sisa whatsapp-web.js / qrcode.');
console.log('Penjaga: tidak ada pemanggil API WhatsApp yang sudah dihapus.');
process.exit(0);
