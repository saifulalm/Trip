'use strict';

const fs = require('fs');
const path = require('path');

// Muat .env manual agar tanpa dependensi tambahan.
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const { ensureSeed } = require('./src/seed');
ensureSeed();

const { createApp } = require('./src/app');
const app = createApp();

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`\n  seayoulatertrip.com berjalan di http://localhost:${PORT}`);
  console.log(`  Admin panel          : http://localhost:${PORT}/admin`);
  console.log(`  Login admin (default) : admin / admin123\n`);
});

/* ------------------------------------------------------------------ */
/* Layanan latar belakang: WhatsApp worker + penjadwalan pengingat     */
/* ------------------------------------------------------------------ */
/*
 * Dua proses latar belakang dijalankan bersama server:
 *  - wa-worker   : mengambil job blast berstatus "queued" dan mengirimnya
 *                  satu per satu (aman di-restart karena cursor disimpan).
 *  - wa-scheduler: memeriksa booking yang jatuh tempo secara berkala dan
 *                  mengirim pengingat otomatis.
 *
 * Keduanya memakai antrean & status yang sama di data/db.json, jadi
 * restart server aman: pekerjaan yang belum selesai dilanjutkan dari
 * cursor/job tersimpan.
 *
 * Keduanya dapat dimatikan lewat env WA_DISABLE_BG=1 (berguna untuk
 * skrip uji yang tidak boleh mengirim pesan sungguhan).
 */
if (process.env.WA_DISABLE_BG !== '1') {
  try {
    // eslint-disable-next-line global-require
    const worker = require('./src/services/wa-worker');
    // eslint-disable-next-line global-require
    const scheduler = require('./src/services/wa-scheduler');
    // eslint-disable-next-line global-require
    const gateway = require('./src/services/wa-gateway');

    worker.start();
    scheduler.start();

    /*
     * Gateway OpenWA (self-hosted) yang memegang koneksi WhatsApp.
     * Backend tidak menjalankan browser/Chromium lagi — dia hanya
     * berbicara lewat REST API ke gateway.
     *
     * Yang dilakukan di boot:
     *  1. ensure session ada (dibuat bila belum pernah ada),
     *  2. jalankan engine di gateway supaya QR tersedia,
     *  3. daftarkan webhook inbound (agar pesan masuk & opt-out tercatat),
     *  4. mulai polling status supaya `canSend()` akurat tanpa request
     *     jaringan untuk tiap pesan.
     *
     * Kegagalan di sini tidak boleh menggagalkan boot server — blast &
     * pengingat akan otomatis berjalan begitu gateway tersedia.
     */
    gateway
      .ensureStartedSession()
      .then(async (session) => {
        console.log(
          `[wa] session OpenWA "${session && session.name}" siap (status: ${session && session.status}).`
        );
        await gateway.ensureWebhookRegistered();
        gateway.startPolling();
      })
      .catch((err) => console.warn('[wa] gateway OpenWA belum siap:', err.message));

    /* ------------------------------------------------------------------ */
    /* Penutupan rapi (graceful shutdown)                                 */
    /* ------------------------------------------------------------------ */
    /*
     * Tanpa handler ini, Ctrl+C / kill / crash meninggalkan proses
     * gateway & loop background hidup. Proses yang menggantung ikut
     * menahan antrean job sehingga restart berikutnya tidak pernah
     * melanjutkan pekerjaan yang tersisa.
     */
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n  [${signal}] menutup layanan...`);
      try {
        worker.stop();
        scheduler.stop();
      } catch (_) {
        /* abaikan */
      }
      try {
        // Polling status dihentikan supaya tidak ada request yang
        // menggantung saat proses akan keluar.
        gateway.stopPolling();
      } catch (err) {
        console.warn('[wa] polling gateway tidak bisa dihentikan:', err.message);
      }
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.warn('[wa] layanan latar belakang gagal dinyalakan:', err.message);
  }
}