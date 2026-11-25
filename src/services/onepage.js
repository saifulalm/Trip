'use strict';

/**
 * Service onepage — daftar section halaman beranda.
 *
 * Satu sumber kebenaran untuk:
 *  (1) tautan anchor di header publik (mode beranda / onepage),
 *  (2) rail navigasi section di sisi kanan halaman beranda,
 *  (3) target scrollspy di public/js/onepage.js.
 *
 * PENTING: `id` di sini WAJIB sama dengan atribut `id` pada elemen
 * `<section>` di views/pages/home.ejs. Bila berubah, perbarui keduanya
 * (daftar section di home.ejs dan konstanta HOME_SECTIONS di bawah).
 */

/**
 * Daftar section beranda beserta label singkat untuk rail.
 *
 * `id`   — nilai atribut id pada <section> di home.ejs
 * `label` — teks pendek yang tampil di rail navigasi
 * `nav`  — true bila section ini punya pintu masuk di nav header
 */
const HOME_SECTIONS = [
  { id: 'hero', label: 'Beranda', nav: false },
  { id: 'sorotan-pulau', label: 'Sorotan Pulau', nav: false },
  { id: 'kenapa-kami', label: 'Kenapa Kami', nav: false },
  { id: 'destinasi-unggulan', label: 'Destinasi', nav: true },
  { id: 'paket-pilihan', label: 'Paket', nav: true },
  { id: 'galeri', label: 'Galeri', nav: false },
  { id: 'testimoni', label: 'Testimoni', nav: false },
  { id: 'artikel-terbaru', label: 'Artikel', nav: true },
  { id: 'cta', label: 'Kontak', nav: false }
];

/**
 * Section yang punya pintu masuk di nav header (mode onepage).
 * @returns {Array<{id: string, label: string}>} daftar untuk nav
 */
function navSections() {
  return HOME_SECTIONS.filter((s) => s.nav).map((s) => ({ id: s.id, label: s.label }));
}

/**
 * Seluruh daftar section untuk rail navigasi.
 * @returns {Array<{id: string, label: string}>} daftar rail
 */
function railSections() {
  return HOME_SECTIONS.map((s) => ({ id: s.id, label: s.label }));
}

module.exports = {
  HOME_SECTIONS,
  navSections,
  railSections
};
