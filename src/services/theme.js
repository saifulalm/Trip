'use strict';

/**
 * Service tema.
 *
 * Menyediakan:
 *  - mode tema (light / dark / auto) yang disimpan di settings.themeMode
 *  - warna aksen (settings.themeAccent) yang menjadi sumber warna utama UI
 *  - daftar variabel CSS turunan (tint/shade) agar admin & situs publik
 *    memakai warna yang sama dari satu sumber kebenaran.
 *
 * Semua perhitungan warna dilakukan di server supaya CSS tidak perlu
 * menebak warna terang/gelap secara manual.
 */

/** Mode tema yang didukung. */
const THEME_MODES = ['light', 'dark', 'auto'];

/** Aksen bawaan bila pengaturan kosong. */
const DEFAULT_ACCENT = '#166b7a';

/** Mode bawaan bila pengaturan kosong. */
const DEFAULT_MODE = 'light';

function clampByte(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Ubah hex (#rgb / #rrggbb) menjadi tuple [r, g, b]. */
function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(clean)) return null;
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ];
}

/** rgb() string dari tuple. */
function rgb(r, g, b) {
  return `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
}

/** Campur warna dengan putih (amount 0..1 = kadar putih). */
function tint(value, amount) {
  const tuple = toTuple(value);
  if (!tuple) return value;
  const a = Math.max(0, Math.min(1, amount));
  return rgb(
    tuple[0] + (255 - tuple[0]) * a,
    tuple[1] + (255 - tuple[1]) * a,
    tuple[2] + (255 - tuple[2]) * a
  );
}

/** Campur warna dengan hitam (amount 0..1 = kadar hitam). */
function shade(value, amount) {
  const tuple = toTuple(value);
  if (!tuple) return value;
  const a = Math.max(0, Math.min(1, amount));
  return rgb(tuple[0] * (1 - a), tuple[1] * (1 - a), tuple[2] * (1 - a));
}

/** Ubah string rgb()/hex menjadi tuple [r, g, b]. */
function toTuple(value) {
  if (Array.isArray(value)) return value;
  const nums = String(value).match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}

/** Rasio luminansi relatif — dipakai untuk memilih teks kontras atas aksen. */
function luminance(value) {
  const tuple = toTuple(value);
  if (!tuple) return 0;
  const [r, g, b] = tuple.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Teks terang/gelap yang kontras terhadap warna aksen. */
function readableTextColor(value) {
  return luminance(value) > 0.55 ? '#0a2227' : '#ffffff';
}

/** Normalisasi hex aksen: selalu #rrggbb lowercase. */
function normalizeAccent(value) {
  const tuple = hexToRgb(value);
  if (!tuple) return DEFAULT_ACCENT;
  return `#${tuple.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Cari kadar shade minimum agar luminansi warna tidak melebihi batas.
 *
 * Dipakai untuk sidebar: admin bebas memilih warna aksen apa saja,
 * termasuk yang sangat terang. Sidebar harus tetap gelap supaya teks
 * krem/putih tetap terbaca (rasio kontras minimal 4.5:1).
 *
 * @param {number[]} tuple tuple RGB
 * @param {number} maxLuminance luminansi maksimum yang diizinkan
 * @returns {number} kadar shade 0..1
 */
function shadeAmountForLuminance(tuple, maxLuminance) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (luminance(shade(tuple, mid)) <= maxLuminance) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Susun payload tema untuk template.
 * @param {object} settings data settings dari database
 */
function resolveTheme(settings = {}) {
  const mode = THEME_MODES.includes(settings.themeMode) ? settings.themeMode : DEFAULT_MODE;
  const accent = normalizeAccent(settings.themeAccent || DEFAULT_ACCENT);
  const tuple = hexToRgb(accent);
  const onAccent = readableTextColor(tuple);

  // Sidebar admin memakai warna aksen sebagai gradasi. Bila aksen terlalu
  // terang, gradasi digelapkan otomatis supaya teks krem/putih di sidebar
  // tetap memenuhi rasio kontras minimal 4.5:1 (WCAG AA).
  // Batas luminansi 0.04 dipilih karena tinta sidebar memakai alpha 0.80
  // (label) dan 0.94 (tautan). Dengan kombinasi ini rasio kontras terendah
  // di semua warna aksen tetap di atas 6.8:1 (WCAG AA mensyaratkan 4.5:1).
  // Untuk warna aksen bawaan (#166b7a) hasilnya sama dengan --accent-deep
  // sehingga tampilan default tidak berubah.
  const sidebarShade = shadeAmountForLuminance(tuple, 0.04);
  const sidebarFrom = shade(tuple, sidebarShade);
  const sidebarTo = shade(tuple, Math.min(0.92, sidebarShade + 0.18));

  return {
    mode,
    accent,
    onAccent,
    sidebarFrom,
    sidebarTo,
    // Turunan warna yang dipakai admin & situs publik.
    vars: {
      '--accent': accent,
      '--accent-strong': shade(tuple, 0.22),
      '--accent-deep': shade(tuple, 0.42),
      '--accent-darkest': shade(tuple, 0.58),
      '--accent-soft': tint(tuple, 0.78),
      '--accent-softer': tint(tuple, 0.9),
      '--accent-glow': `rgba(${tuple.join(', ')}, 0.22)`,
      '--accent-line': `rgba(${tuple.join(', ')}, 0.38)`,
      '--on-accent': onAccent,
      '--a-sidebar-from': sidebarFrom,
      '--a-sidebar-to': sidebarTo
    }
  };
}

/** Inline style berisi variabel turunan aksen. */
function themeStyle(theme) {
  const body = Object.entries(theme.vars)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
  return body ? `${body};` : '';
}

module.exports = {
  THEME_MODES,
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  hexToRgb,
  normalizeAccent,
  resolveTheme,
  themeStyle,
  luminance,
  shadeAmountForLuminance
};
