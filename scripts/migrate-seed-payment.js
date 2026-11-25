/**
 * [USANG — sudah dijalankan]
 *
 * Mengganti blok settings pembayaran di src/seed.js.
 *
 * Script ini dipakai sekali saat migrasi: mengganti Midtrans + Tripay +
 * transfer manual + WhatsApp Cloud API dengan iPaymu + perangkat WhatsApp Web.
 *
 * CATATAN: seed.js kini memakai konfigurasi gateway **OpenWA**
 * (`openwaBaseUrl`, `openwaApiKey`, `openwaSessionName`,
 * `openwaWebhookUrl`, `openwaWebhookSecret`). Skrip ini tidak lagi
 * diperlukan untuk instalasi baru.
 *
 * Dipakai via: node scripts/migrate-seed-payment.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'seed.js');
let src = fs.readFileSync(FILE, 'utf8');

const start = src.indexOf('    // Pembayaran');
const end = src.indexOf('    // Menu WhatsApp mengambang');

if (start === -1 || end === -1 || end <= start) {
  console.error('Blok settings pembayaran tidak ditemukan di seed.js.');
  process.exit(1);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';
const lines = [
  '    // Payment gateway iPaymu (VA + API Key dari dashboard iPaymu → Integration)',
  "    ipaymuVa: '',",
  "    ipaymuApiKey: '',",
  '    ipaymuProduction: false,',
  '    // WhatsApp — gateway open-source OpenWA (self-hosted, REST API)',
  '    // Kredensial device (Access Token / Phone Number ID) tidak ada lagi:',
  '    // session disimpan lokal di data/wa-session lewat scan QR.'
];

const before = src.slice(0, start);
const after = src.slice(end);
src = before + lines.join(eol) + eol + after;

fs.writeFileSync(FILE, src, 'utf8');
console.log('seed.js: blok settings pembayaran diganti dengan konfigurasi iPaymu.');
