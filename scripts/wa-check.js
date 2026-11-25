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

console.log(failed ? `\n${failed} masalah.` : '\nSemua modul & template OK.');

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

if (guardFailed) {
  console.log(`\n${guardFailed} masalah.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Penjaga: sisa modul WhatsApp legacy tidak boleh kembali            */
/* ------------------------------------------------------------------ */

/*
 * Modul WhatsApp lama sudah dibuang. Stub `wa.config()` dan
 * `wa.isActive()` pernah tersisa sebagai alias mati — kalau muncul
 * lagi berarti masih ada jalur kode yang mengharapkan API lama
 * (token/phoneId) yang sudah tidak berlaku.
 */
const legacyWaExports = ['config', 'isActive'];
const waService = require(path.join(root, 'src', 'services', 'wa'));

let legacyFailed = 0;
legacyWaExports.forEach((name) => {
  if (typeof waService[name] === 'function') {
    legacyFailed += 1;
    console.log(`FAIL wa.${name}() masih ada — stub lama tidak boleh kembali`);
  }
});

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

if (legacyFailed) {
  console.log(`\n${legacyFailed} masalah.`);
  process.exit(1);
}
console.log('Penjaga: tidak ada sisa modul WhatsApp legacy.');

console.log('\nPenjaga: tidak ada sisa whatsapp-web.js / qrcode.');
process.exit(0);
