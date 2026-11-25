'use strict';

/**
 * Service brand — satu sumber kebenaran untuk nama brand.
 *
 * Semua string brand lama (jalanjalanenak / JalanJalanEnak / JJE) dikumpulkan
 * di sini agar penggantian brand hanya dilakukan di satu tempat. Nilai brand
 * disimpan di `settings.brandName`; bila kosong, memakai BRAND_DEFAULT.
 *
 * Wordmark ditampilkan sebagai satu string polos (tanpa pemenggalan "enak")
 * supaya aman untuk nama brand apa pun yang diketik admin.
 */

/** Nama brand bawaan (bisa ditimpa lewat settings.brandName). */
const BRAND_DEFAULT = 'seayoulatertrip';

/**
 * Label brand ringkas untuk teks pendek (mis. prefix kode booking).
 * Uppercase 3 huruf agar tetap terbaca sebagai kode.
 */
const BRAND_CODE = 'SYL';

/**
 * Normalisasi nama brand: potong spasi berlebih, maksimal 40 karakter.
 * @param {string} value nama brand mentah
 * @returns {string} nama brand bersih
 */
function normalizeBrandName(value) {
  const clean = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return clean;
}

/**
 * Ambil nama brand aktif dari settings.
 * @param {object} settings object settings situs
 * @returns {string} nama brand
 */
function brandName(settings) {
  return normalizeBrandName(settings && settings.brandName) || BRAND_DEFAULT;
}

/**
 * Nama brand tanpa suffix domain (mis. "seayoulatertrip.com" -> "seayoulatertrip").
 * @param {object} settings object settings situs
 * @returns {string} nama brand bersih
 */
function brandWordmark(settings) {
  return brandName(settings).replace(/\.(com|net|org|id|co\.id)$/i, '');
}

/**
 * Pecah wordmark menjadi dua bagian untuk pewarnaan dua nada.
 *
 * Aturan:
 *  - Nama dengan spasi (mis. "Se You Later Trip") → batas di spasi pertama.
 *  - Nama camelCase (mis. "SeYouLaterTrip") → batas di huruf besar setelah
 *    huruf kecil.
 *  - Nama rapat tanpa spasi (mis. "seayoulatertrip") → dibagi mengikuti
 *    dictionary kata yang lazim dipakai pada brand ("sea" | "you" | "later" |
 *    "trip"), lalu kata kedua dari belakang diwarnai aksen.
 *
 * Hasil: { head, tail, accentFrom } — accentFrom adalah indeks karakter
 * awal bagian berekspresi (digunakan splash & wordmark dua nada).
 *
 * @param {object} settings object settings situs
 * @returns {{head: string, tail: string, accentFrom: number}} bagian wordmark
 */
function brandParts(settings) {
  const word = brandWordmark(settings);
  if (!word) return { head: '', tail: '', accentFrom: -1 };

  // 1. Nama ber-spasi: ambil dua kata terakhir.
  if (/\s/.test(word)) {
    const parts = word.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const tail = parts.slice(1).join(' ');
      return {
        head: parts[0],
        tail,
        accentFrom: parts[0].length + 1
      };
    }
    return { head: word, tail: '', accentFrom: -1 };
  }

  // 2. Nama camelCase: kandidat batas di setiap huruf besar.
  const camelCuts = [];
  for (let i = 1; i < word.length; i += 1) {
    if (/[A-Z]/.test(word[i]) && /[a-z0-9]/.test(word[i - 1])) camelCuts.push(i);
  }
  if (camelCuts.length) {
    // Pilih batas yang menghasilkan bagian awal terpanjang & tetap valid.
    let bestCamel = -1;
    camelCuts.forEach((cut) => {
      const head = word.slice(0, cut);
      const tail = word.slice(cut);
      if (head.length < 2 || tail.length < 2) return;
      if (countWords(head.toLowerCase()) === 0 || countWords(tail.toLowerCase()) === 0) return;
      if (cut > bestCamel) bestCamel = cut;
    });
    if (bestCamel > 0) {
      return {
        head: word.slice(0, bestCamel),
        tail: word.slice(bestCamel),
        accentFrom: bestCamel
      };
    }
    // Tidak ada segmentasi valid — pakai batas camelCase pertama.
    const cut = camelCuts[0];
    return { head: word.slice(0, cut), tail: word.slice(cut), accentFrom: cut };
  }

  // 3. Nama rapat: cari batas kata terbaik dengan segmentation dinamis.
  const lower = word.toLowerCase();
  const cut = bestSplit(lower);
  if (cut > 0) {
    return {
      head: word.slice(0, cut),
      tail: word.slice(cut),
      accentFrom: cut
    };
  }

  // 4. Tidak ada pola — bagi di tengah.
  if (word.length < 4) return { head: word, tail: '', accentFrom: -1 };
  const mid = Math.ceil(word.length / 2);
  return { head: word.slice(0, mid), tail: word.slice(mid), accentFrom: mid };
}

/**
 * Kosakata brand yang lazim — dipakai untuk menebak batas kata pada nama rapat.
 */
const BRAND_WORDS = ['sea', 'se', 'you', 'later', 'trip', 'lat', 'er', 'travel', 'go', 'wandering', 'tour'];

/**
 * Cari batas kata terbaik pada nama rapat (tanpa spasi).
 *
 * Pendekatan: seluruh posisi di mana kata yang dikenal berakhir menjadi
 * kandidat batas. Sebuah kandidat diterima bila bagian awal DAN bagian akhir
 * sama-sama dapat dipecah menjadi kata yang dikenal. Dari kandidat itu,
 * dipilih yang bagian pertamanya paling panjang — sehingga bagian berekspresi
 * (berwarna aksen) adalah kata terakhir, mis. "seayoulater" + "trip".
 *
 * @param {string} lower nama brand lowercase tanpa spasi
 * @returns {number} indeks batas (0 = tidak ditemukan)
 */
function bestSplit(lower) {
  const n = lower.length;
  if (n < 6) return -1;

  // Kandidat batas: posisi setelah sebuah kata yang dikenal berakhir.
  const candidates = new Set();
  BRAND_WORDS.forEach((w) => {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(w, from);
      if (at < 0) break;
      const end = at + w.length;
      if (end < n) candidates.add(end);
      from = at + 1;
    }
  });
  if (!candidates.size) return -1;

  let best = -1;
  candidates.forEach((cut) => {
    const head = lower.slice(0, cut);
    const tail = lower.slice(cut);
    // Kedua bagian harus minimal 3 karakter agar terbaca sebagai kata.
    if (head.length < 3 || tail.length < 3) return;
    // Kedua bagian harus sepenuhnya tersusun dari kata yang dikenal.
    if (countWords(head) === 0 || countWords(tail) === 0) return;

    if (cut > best) best = cut;
  });

  return best;
}

/**
 * Hitung berapa kata yang dapat dibentuk dari potongan teks memakai kosakata.
 * @param {string} text teks lowercase
 * @returns {number} jumlah kata
 */
function countWords(text) {
  let rest = text;
  let count = 0;
  let guard = 0;
  while (rest.length && guard < 20) {
    guard += 1;
    const hit = BRAND_WORDS.find((w) => rest.startsWith(w));
    if (!hit) return count; // sisa tidak bisa dipecah
    rest = rest.slice(hit.length);
    count += 1;
  }
  return rest.length === 0 ? count : 0;
}

/**
 * Kode booking dengan prefix brand.
 * @returns {string} kode booking, contoh: SYL-240501
 */
function bookingCode() {
  return `${BRAND_CODE}-${String(Date.now()).slice(-6)}`;
}

/**
 * Nama penulis default artikel.
 * @param {object} settings object settings situs
 * @returns {string} nama tim
 */
function authorName(settings) {
  return `Tim ${brandWordmark(settings)}`;
}

module.exports = {
  BRAND_DEFAULT,
  BRAND_CODE,
  normalizeBrandName,
  brandName,
  brandWordmark,
  brandParts,
  bookingCode,
  authorName
};
