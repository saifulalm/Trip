'use strict';

/**
 * migrate-brand.js — migrasi branding "jalanjalanenak" → "seayoulatertrip".
 *
 * Script ini MENGUBAH DATA (bukan struktur). Sebelum menulis, file database
 * selalu dicadangkan ke data/db.backup-<timestamp>.json sehingga bisa
 * dipulihkan manual bila ada yang tidak sesuai.
 *
 * Struktur collection TIDAK pernah dihapus atau diganti nama. Field baru
 * hanya ditambahkan bila belum ada (sama seperti ensureSeed()).
 *
 * Pemakaian:
 *   node scripts/migrate-brand.js            # jalankan migrasi (dengan backup)
 *   node scripts/migrate-brand.js --dry-run  # hanya tampilkan ringkasan
 */

const fs = require('fs');
const path = require('path');

const BRAND = require('../src/brand');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const DRY_RUN = process.argv.includes('--dry-run');

const LEGACY_NAMES = [
  'jalanjalanenak.com',
  'JalanJalanEnak',
  'jalanjalanenak',
  'JalanJalanEnak Wisata',
  'Tim JJE',
  'Administrator JJE',
  'JJE-',
  'JJE ',
  'JJE'
];

/**
 * Ganti semua kemunculan nama lama di dalam string.
 *
 * Urutan PENTING: pola yang lebih panjang harus diproses lebih dulu
 * ("JJE-" dan "JJE " sebelum "JJE"), kalau tidak kode booking "JJE-240501"
 * akan menjadi "Seayoulatertrip-240501" dan kehilangan prefix SYLT.
 */
function scrub(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  out = out.split('jalanjalanenak.com').join(BRAND.domain);
  out = out.split('jalanjalanenak').join(BRAND.displayLower);
  out = out.split('JalanJalanEnak').join(BRAND.display);
  out = out.split('Tim JJE').join(`Tim ${BRAND.display}`);
  out = out.split('Administrator JJE').join(`Administrator ${BRAND.display}`);
  out = out.split('JJE-').join(`${BRAND.codePrefix}-`);
  out = out.split('JJE ').join(`${BRAND.display} `);
  // Sisanya: "JJE" telanjang, mis. "Thanks JJE!".
  out = out.split('JJE').join(BRAND.display);
  return out;
}

/** Telusuri seluruh object/array dan scrub setiap string di dalamnya. */
function scrubDeep(node, changes, pathTrail = '') {
  if (typeof node === 'string') {
    const next = scrub(node);
    if (next !== node) changes.push({ path: pathTrail, from: node, to: next });
    return next;
  }
  if (Array.isArray(node)) {
    return node.map((item, i) => scrubDeep(item, changes, `${pathTrail}[${i}]`));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = scrubDeep(value, changes, pathTrail ? `${pathTrail}.${key}` : key);
    }
    return out;
  }
  return node;
}

function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('❌ Database tidak ditemukan:', DB_FILE);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('❌ db.json tidak bisa dibaca (JSON rusak):', err.message);
    process.exit(1);
  }

  const changes = [];
  const before = JSON.stringify(data);
  const scrubbed = scrubDeep(data, changes);

  // Pengaturan yang punya nilai baku brand (dipaksa, bukan sekadar scrub).
  const s = scrubbed.settings || (scrubbed.settings = {});
  const forced = {
    siteName: BRAND.display,
    email: BRAND.contact.email,
    instagram: BRAND.social.instagram,
    facebook: BRAND.social.facebook,
    about: BRAND.about,
    seoDescription: BRAND.seoDescription,
    tagline: BRAND.tagline,
    paymentAccountName: BRAND.company,
    waFloatMessage: `Halo ${BRAND.domain}! Saya mau tanya-tanya soal trip ya. Boleh minta info itinerary & harga?`
  };
  for (const [key, value] of Object.entries(forced)) {
    if (s[key] !== value) {
      changes.push({ path: `settings.${key}`, from: s[key], to: value });
      s[key] = value;
    }
  }

  const after = JSON.stringify(scrubbed);

  // Verifikasi: tidak boleh ada nama lama yang tersisa di data hasil migrasi.
  const leftovers = [];
  (function findLeftovers(node, trail) {
    if (typeof node === 'string') {
      for (const legacy of LEGACY_NAMES) {
        if (node.includes(legacy)) {
          leftovers.push({ path: trail, legacy, sample: node.slice(0, 60) });
          break;
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => findLeftovers(item, `${trail}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        findLeftovers(value, trail ? `${trail}.${key}` : key);
      }
    }
  })(scrubbed, '');

  if (leftovers.length) {
    console.error(`\n⚠️  Masih ada ${leftovers.length} nilai berisi nama brand lama:`);
    for (const l of leftovers.slice(0, 20)) {
      console.error(`   • ${l.path} → "${l.legacy}" (${l.sample})`);
    }
    if (!DRY_RUN) {
      console.error('   Periksa rules scrub() di scripts/migrate-brand.js.');
    }
  }

  if (before === after) {
    console.log('✅ Tidak ada perubahan yang perlu dilakukan — data sudah memakai brand baru.');
    if (!leftovers.length) console.log('✅ Verifikasi: tidak ada nama brand lama di data.');
    return;
  }

  console.log(`\n🔄 Migrasi branding: ${changes.length} perubahan\n`);
  for (const c of changes.slice(0, 40)) {
    console.log(`   • ${c.path}: ${String(c.from).slice(0, 50)} → ${String(c.to).slice(0, 50)}`);
  }
  if (changes.length > 40) console.log(`   … dan ${changes.length - 40} perubahan lainnya`);

  if (DRY_RUN) {
    console.log('\n🧪 Mode dry-run — tidak ada file yang ditulis.');
    return;
  }

  // Backup sebelum menulis.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(ROOT, 'data', `db.backup-${stamp}.json`);
  fs.copyFileSync(DB_FILE, backup);
  console.log(`\n💾 Backup dibuat: ${path.relative(ROOT, backup)}`);

  // Tulis atomik (file sementara + rename) supaya tidak ada data korup.
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scrubbed, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);

  console.log(`✅ Migrasi selesai. Database ditulis: ${path.relative(ROOT, DB_FILE)}`);
}

main();
