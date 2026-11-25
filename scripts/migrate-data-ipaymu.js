/**
 * [USANG — sudah dijalankan & digantikan migrasi OpenWA]
 *
 * Migrasi data existing setelah perpindahan ke iPaymu + gateway WhatsApp.
 *
 * CATATAN: skrip ini disimpan sebagai riwayat. Backend sekarang memakai
 * gateway **OpenWA** (self-hosted, REST API).
 * Folder `data/wa-session/` berisi profil yang sudah tidak dipakai lagi;
 * bersihkan manual bila masih ada:
 *
 *   rm -rf data/wa-session
 *
 * Yang dilakukan:
 *  1. Settings: buang field gateway lama (Midtrans, Tripay, transfer manual)
 *     dan kredensial WhatsApp Cloud API. Tambahkan field iPaymu baru.
 *  2. Booking: normalisasi status pembayaran — "awaiting_review" (khas
 *     transfer manual + bukti transfer) menjadi "unpaid". Hapus
 *     proofImage yang tidak lagi relevan.
 *
 * Skrip ini idempoten — menjalankannya berulang kali aman.
 *
 * Jalankan: node scripts/migrate-data-ipaymu.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DB_FILE = path.join(root, 'data', 'db.json');

/** Field settings yang dibuang. */
const OBSOLETE_SETTINGS = [
  'paymentBank',
  'paymentAccount',
  'paymentAccountName',
  'midtransServerKey',
  'midtransClientKey',
  'midtransProduction',
  'tripayMerchantCode',
  'tripayPrivateKey',
  'tripayApiKey',
  'tripayProduction',
  'waToken',
  'waPhoneId'
];

if (!fs.existsSync(DB_FILE)) {
  console.error('data/db.json tidak ditemukan. Jalankan `npm run seed` dulu.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const changes = [];

// --- 1. Settings --------------------------------------------------------
data.settings = data.settings || {};
for (const key of OBSOLETE_SETTINGS) {
  if (key in data.settings) {
    delete data.settings[key];
    changes.push(`settings: hapus "${key}"`);
  }
}
if (!('ipaymuVa' in data.settings)) {
  data.settings.ipaymuVa = '';
  changes.push('settings: tambah "ipaymuVa"');
}
if (!('ipaymuApiKey' in data.settings)) {
  data.settings.ipaymuApiKey = '';
  changes.push('settings: tambah "ipaymuApiKey"');
}
if (!('ipaymuProduction' in data.settings)) {
  data.settings.ipaymuProduction = false;
  changes.push('settings: tambah "ipaymuProduction"');
}

// --- 2. Booking ---------------------------------------------------------
for (const b of data.bookings || []) {
  if (b.paymentStatus === 'awaiting_review') {
    b.paymentStatus = 'unpaid';
    changes.push(`booking ${b.code}: awaiting_review -> unpaid`);
  }
  if ('proofImage' in b) {
    delete b.proofImage;
    changes.push(`booking ${b.code}: hapus proofImage`);
  }
}

fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');

if (changes.length) {
  console.log('Migrasi data selesai:');
  for (const c of changes) console.log('  - ' + c);
} else {
  console.log('Migrasi data: tidak ada perubahan (sudah konsisten).');
}
