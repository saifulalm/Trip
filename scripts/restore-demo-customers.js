'use strict';

/**
 * Memulihkan akun pelanggan seed yang hilang dari `data/db.json`.
 *
 * Konteks: beberapa skrip uji lama berjalan terhadap basis data produksi
 * dan sempat menghapus akun pelanggan (akun & `customerId` di booking ikut
 * hilang). Skrip ini memulihkannya dari `data/db.json.preaudit.bak`.
 *
 * Aman & idempoten:
 *  - pelanggan yang sudah ada TIDAK ditimpa,
 *  - `customerId` di booking hanya diisi bila kosong dan email cocok,
 *  - skrip melakukan dry-run lebih dulu (tanpa `--apply`).
 *
 * Jalankan:
 *   node scripts/restore-demo-customers.js            # pratinjau
 *   node scripts/restore-demo-customers.js --apply    # terapkan
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DB_FILE = path.join(root, 'data', 'db.json');
const BACKUP_FILE = path.join(root, 'data', 'db.json.preaudit.bak');

const apply = process.argv.includes('--apply');

if (!fs.existsSync(DB_FILE)) {
  console.error('data/db.json tidak ditemukan.');
  process.exit(1);
}
if (!fs.existsSync(BACKUP_FILE)) {
  console.error('data/db.json.preaudit.bak tidak ditemukan — tidak ada sumber pemulihan.');
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));

const backupCustomers = backup.customers || [];
const currentCustomers = current.customers || [];

const existingEmails = new Set(currentCustomers.map((c) => String(c.email || '').toLowerCase()));
const toRestore = backupCustomers.filter(
  (c) => !existingEmails.has(String(c.email || '').toLowerCase())
);

console.log(`Pelanggan di backup   : ${backupCustomers.length}`);
console.log(`Pelanggan di db.json  : ${currentCustomers.length}`);
console.log(`Perlu dipulihkan      : ${toRestore.length}`);

for (const c of toRestore) {
  console.log(`  + ${c.email} (${c.name}, id ${c.id})`);
}

if (!toRestore.length) {
  console.log('\nTidak ada yang perlu dipulihkan.');
  process.exit(0);
}

// ---- Hitung berapa booking yang bisa ditautkan kembali --------------
const additions = [];
for (const c of toRestore) additions.push(c);

const relink = [];
for (const b of current.bookings || []) {
  if (b.customerId) continue;
  const owner = additions.find((c) => String(c.email) === String(b.email));
  if (owner) relink.push({ booking: b.code, email: b.email, customerId: owner.id });
}

console.log(`\nBooking yang bisa ditautkan : ${relink.length}`);
for (const r of relink) {
  console.log(`  ~ ${r.booking} (${r.email}) -> ${r.customerId}`);
}

if (!apply) {
  console.log('\nMode pratinjau. Jalankan ulang dengan --apply untuk menulis.');
  process.exit(0);
}

// ---- Terapkan --------------------------------------------------------
current.customers = [...currentCustomers, ...additions];
for (const r of relink) {
  const b = (current.bookings || []).find((x) => x.code === r.booking);
  if (b) b.customerId = r.customerId;
}

// Tulis atomik, sama seperti `src/db.js`.
const tmp = path.join(root, 'data', '.db.restore.tmp');
fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
fs.renameSync(tmp, DB_FILE);

console.log(`\nSelesai. Pelanggan dipulihkan: ${additions.length}, booking ditautkan: ${relink.length}.`);
