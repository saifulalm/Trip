'use strict';

/**
 * Konstanta brand tunggal untuk seluruh aplikasi.
 * Semua kemunculan nama brand (UI, meta tag, email, footer, navbar, kode
 * booking, structured data) WAJIB merujuk ke file ini supaya tidak ada
 * lagi nama lama yang tertinggal di satu sudut codebase.
 */

const BRAND = {
  /** Nama yang ditampilkan di UI (navbar, footer, judul halaman, admin). */
  display: 'Seayoulatertrip',
  /** Nama domain & email — selalu lowercase. */
  domain: 'seayoulatertrip.com',
  /** Prefix kode booking baru, mis. SYLT-240501. */
  codePrefix: 'SYLT',
  company: 'PT Seayoulatertrip Wisata',
  /** Desktripsi singkat di bawah nama brand (navbar, splash, footer). */
  descriptor: 'Wisata Bahari Nusantara',
  tagline: 'Liburan pulau yang enak, terencana, tanpa ribet',
  about:
    'Seayoulatertrip adalah operator wisata bahari yang berfokus pada kepulauan Indonesia. Sejak 2019 kami membantu ribuan wisatawan menikmati pulau-pulau terbaik Nusantara dengan pemandu lokal, homestay milik warga, dan itinerary yang matang.',
  seoDescription:
    'Seayoulatertrip — paket wisata bahari terpercaya ke Raja Ampat, Sabesi, Ora, dan pulau-pulau terbaik Indonesia. Itinerary matang, pemandu lokal, harga transparan.',
  social: {
    instagram: 'https://instagram.com/seayoulatertrip',
    facebook: 'https://facebook.com/seayoulatertrip'
  },
  contact: {
    email: 'halo@seayoulatertrip.com',
    phone: '0812-3456-7890',
    whatsapp: '6281234567890',
    address: 'Jl. Samudra Raya No. 21, Banda Aceh, Indonesia'
  }
};

/** Nama brand lowercase — dipakai untuk domain, email, dan slug. */
BRAND.displayLower = BRAND.display.toLowerCase();

/**
 * Batas dua-warna pada logo: karakter mulai dari index ini memakai aksen
 * (oran). Evita menulis "Sea<span>youlatertrip</span>" manual di template —
 * kalau nama brand berubah, cukup ubah `display` + `accentFrom` di sini.
 */
BRAND.accentFrom = 3;

/** Pemecahan nama brand menjadi bagian polos + bagian aksen. */
BRAND.parts = function parts() {
  const name = String(BRAND.display || '');
  const i = Math.max(0, Math.min(name.length, BRAND.accentFrom));
  return { lead: name.slice(0, i), accent: name.slice(i) };
};

module.exports = BRAND;
