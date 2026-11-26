/**
 * Menyesuaikan scripts/verify-admin-audit.js dengan kondisi baru:
 *  - Payment gateway Midtrans + Tripay  → iPaymu (VA / API Key / mode produksi)
 *  - WhatsApp Cloud API (token/phone id) → dihapus
 *  - Form "payment" (rekening manual)     → dihapus
 *
 * Dipakai via: node scripts/migrate-audit-script.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'verify-admin-audit.js');
const original = fs.readFileSync(FILE, 'utf8');
const hadCrlf = original.includes('\r\n');
// Normalisasi ke LF saat_processor agar penanda blok selalu cocok.
let src = original.replace(/\r\n/g, '\n');
const eol = hadCrlf ? '\r\n' : '\n';

/**
 * Ganti seluruh isi function/ blok yang dibatasi oleh penanda awal & akhir.
 *
 * @param {string} text sumber
 * @param {string} startMarker penanda baris awal blok
 * @param {string} endMarker penanda baris akhir blok (tidak ikut diganti)
 * @param {string[]} lines baris baru
 * @returns {string} teks hasil
 */
function replaceBlock(text, startMarker, endMarker, lines) {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`Penanda tidak ditemukan: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  if (end === -1) throw new Error(`Penanda akhir tidak ditemukan: ${endMarker}`);
  return text.slice(0, start) + lines.join(eol) + eol + text.slice(end);
}

// --- Blok 3: checkbox "mode production" bisa dimatikan -------------------
src = replaceBlock(
  src,
  "    const on = await sendSettings('gateway'",
  '  /* ---------------------------------------------------------------- */\n  /* 4. Kunci API bisa dikosongkan',
  [
    "    const on = await sendSettings('gateway', { ipaymuProduction: 'on' });",
    "    const off = await sendSettings('gateway', {",
    "      ipaymuVa: '1179000899',",
    "      ipaymuApiKey: 'kunci-api-uji'",
    '    });',
    '    report(',
    '      \'3. Checkbox "mode production" bisa dimatikan dari panel\',',
    '      on.ipaymuProduction === true && off.ipaymuProduction === false,',
    '      `nyala=${on.ipaymuProduction} mati=${off.ipaymuProduction}`',
    '    );',
    '  }',
    ''
  ]
);

// --- Blok 4: kunci API bisa dikosongkan ----------------------------------
src = replaceBlock(
  src,
  "    await sendSettings('gateway', {\n      midtransServerKey",
  '  /* ---------------------------------------------------------------- */\n  /* 5. Berkas lama dihapus',
  [
    "    await sendSettings('gateway', {",
    "      ipaymuVa: '1179000899',",
    "      ipaymuApiKey: 'kunci-api-uji'",
    '    });',
    "    await sendSettings('wa', { waDefaultTemplate: 'Halo {{nama}}' });",
    "    const s = await sendSettings('gateway', { ipaymuVa: '', ipaymuApiKey: '' });",
    "    const w = await sendSettings('wa', { waDefaultTemplate: '' });",
    '    report(',
    "      '4. Kunci API bisa dikosongkan dari panel',",
    "      !s.ipaymuVa && !s.ipaymuApiKey && !w.waDefaultTemplate,",
    '      `ipaymuVa="${s.ipaymuVa}" ipaymuApiKey="${s.ipaymuApiKey}" wa="${w.waDefaultTemplate}"`',
    '    );',
    '  }',
    ''
  ]
);

// --- Blok 6: isolasi antar-form ----------------------------------------
src = replaceBlock(
  src,
  "    await sendSettings('payment', {\n      paymentBank",
  '  /* ---------------------------------------------------------------- */\n  /* Pulihkan nilai awal settings',
  [
    "    await sendSettings('gateway', {",
    "      ipaymuVa: '1179000899',",
    "      ipaymuApiKey: 'kunci-api-uji',",
    "      ipaymuProduction: 'on'",
    '    });',
    "    await sendSettings('wa', { waDefaultTemplate: 'Halo {{nama}}' });",
    "    await sendSettings('theme', { themeMode: 'light', themeAccent: '#166b7a' });",
    '',
    "    let s = await sendSettings('theme', { themeMode: 'dark', themeAccent: '#c2410c' });",
    '    report(',
    "      '6a. Form Tema tidak mengubah field form lain',",
    "      s.themeMode === 'dark' && s.themeAccent === '#c2410c' &&",
    "        s.siteName === 'Nama Situs Uji' &&",
    "        s.ipaymuVa === '1179000899' && s.ipaymuProduction === true &&",
    "        s.waDefaultTemplate === 'Halo {{nama}}' && s.waFloatEnabled === true,",
    '      `mode=${s.themeMode} site=${s.siteName} va=${s.ipaymuVa} template=${s.waDefaultTemplate} float=${s.waFloatEnabled}`',
    '    );',
    '',
    "    s = await sendSettings('gateway', {",
    "      ipaymuVa: '1179000888',",
    "      ipaymuApiKey: 'kunci-api-uji-2'",
    '    });',
    '    report(',
    "      '6b. Form Gateway tidak mengubah field form lain',",
    "      s.ipaymuVa === '1179000888' && s.ipaymuApiKey === 'kunci-api-uji-2' &&",
    "        s.siteName === 'Nama Situs Uji' && s.waDefaultTemplate === 'Halo {{nama}}' &&",
    "        s.waFloatEnabled === true && s.themeMode === 'dark',",
    '      `va=${s.ipaymuVa} site=${s.siteName} template=${s.waDefaultTemplate} theme=${s.themeMode}`',
    '    );',
    '',
    "    s = await sendSettings('site', { siteName: 'Nama Situs Baru', tagline: 'Tagline Baru' });",
    '    report(',
    "      '6c. Form Situs tidak mengubah field form lain',",
    "      s.siteName === 'Nama Situs Baru' && s.tagline === 'Tagline Baru' &&",
    "        s.ipaymuVa === '1179000888' &&",
    "        s.waDefaultTemplate === 'Halo {{nama}}' && s.waFloatEnabled === true && s.themeMode === 'dark',",
    '      `site=${s.siteName} va=${s.ipaymuVa} template=${s.waDefaultTemplate} theme=${s.themeMode}`',
    '    );',
    '',
    "    s = await sendSettings('wa', { waDefaultTemplate: 'Halo2 {{nama}}' });",
    '    report(',
    "      '6d. Form WA tidak mengubah field form lain',",
    "      s.waDefaultTemplate === 'Halo2 {{nama}}' && s.siteName === 'Nama Situs Baru' &&",
    "        s.ipaymuVa === '1179000888' && s.themeMode === 'dark',",
    '      `template=${s.waDefaultTemplate} site=${s.siteName} va=${s.ipaymuVa} theme=${s.themeMode}`',
    '    );',
    '  }',
    ''
  ]
);

// --- Pemulihan nilai awal settings --------------------------------------
src = replaceBlock(
  src,
  "    await sendSettings('payment', {\n      paymentBank: original",
  "    await sendSettings('theme', {",
  [
    "    await sendSettings('gateway', {",
    "      ipaymuVa: original.ipaymuVa || '',",
    "      ipaymuApiKey: original.ipaymuApiKey || '',",
    '      ipaymuProduction: flag(original.ipaymuProduction)',
    '    });',
    "    await sendSettings('wa', {",
    "      waDefaultTemplate: original.waDefaultTemplate || ''",
    '    });',
    ''
  ]
);

fs.writeFileSync(FILE, src, 'utf8');
console.log('verify-admin-audit.js: blok pengujian disesuaikan ke iPaymu + WhatsApp Web.');
