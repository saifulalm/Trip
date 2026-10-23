'use strict';

/** Kumpulan helper kecil yang dipakai di route dan template. */

const crypto = require('crypto');

function formatRupiah(value) {
  const n = Number(value || 0);
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function formatDateLong(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

function excerpt(text, len = 150) {
  const clean = String(text || '')
    .replace(/^##\s.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= len) return clean;
  return `${clean.slice(0, len).trimEnd()}…`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render teks artikel sederhana menjadi HTML yang aman.
 * Format: paragraf dipisah baris kosong, "## Judul" menjadi heading,
 * **tebal** menjadi <strong>.
 */
function renderRichText(text) {
  const blocks = String(text || '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      if (block.startsWith('## ')) {
        return `<h3>${escapeHtml(block.slice(3)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</h3>`;
      }
      const html = escapeHtml(block).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `<p>${html.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

const BOOKING_STATUS = {
  pending: { label: 'Menunggu', tone: 'pending' },
  confirmed: { label: 'Dikonfirmasi', tone: 'confirmed' },
  completed: { label: 'Selesai', tone: 'completed' },
  cancelled: { label: 'Dibatalkan', tone: 'cancelled' }
};

function bookingStatusLabel(status) {
  return (BOOKING_STATUS[status] || BOOKING_STATUS.pending).label;
}

function bookingStatusTone(status) {
  return (BOOKING_STATUS[status] || BOOKING_STATUS.pending).tone;
}

const PUBLICATION_STATUS = {
  published: { label: 'Terbit', tone: 'confirmed' },
  draft: { label: 'Draf', tone: 'pending' }
};

function publicationStatusLabel(status) {
  return (PUBLICATION_STATUS[status] || PUBLICATION_STATUS.draft).label;
}

function publicationStatusTone(status) {
  return (PUBLICATION_STATUS[status] || PUBLICATION_STATUS.draft).tone;
}

/** Paginasi sederhana untuk daftar admin/publik. */
function paginate(items, pageRaw, perPage = 10) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  let page = parseInt(pageRaw, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (page > pages) page = pages;
  const start = (page - 1) * perPage;
  return {
    rows: items.slice(start, start + perPage),
    page,
    pages,
    total,
    perPage,
    hasPrev: page > 1,
    hasNext: page < pages,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + perPage, total)
  };
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isPhone(value) {
  const digits = String(value || '').replace(/[\s\-().]/g, '');
  return /^(\+?62|0)\d{7,13}$/.test(digits);
}

const PAYMENT_STATUS = {
  unpaid: { label: 'Belum Bayar', tone: 'pending' },
  waiting_confirmation: { label: 'Menunggu Verifikasi', tone: 'pending' },
  paid: { label: 'Lunas', tone: 'confirmed' },
  rejected: { label: 'Ditolak', tone: 'cancelled' },
  expired: { label: 'Kedaluwarsa', tone: 'cancelled' }
};

function paymentStatusLabel(status) {
  return (PAYMENT_STATUS[status] || PAYMENT_STATUS.unpaid).label;
}

function paymentStatusTone(status) {
  return (PAYMENT_STATUS[status] || PAYMENT_STATUS.unpaid).tone;
}

function starRating(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Alfabet untuk kode booking. Huruf I/O dan angka 0/1 sengaja dibuang agar
 * kode mudah dibaca dan tidak salah ketik saat dictate lewat telepon.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Kode booking yang dijamin unik DAN tidak bisa ditebak.
 *
 * Kode booking adalah kunci pencarian di mana-mana: halaman /pembayaran/:code,
 * callback payment gateway (order_id), panel admin, dan portal pelanggan.
 * Dua hal wajib dijamin:
 *  1. UNIK — dua booking dibuat pada detik yang sama tidak boleh mendapat
 *     kode yang sama, kalau tidak pembayaran bisa masuk ke booking orang lain.
 *  2. TIDAK TERTEBAK — kode lama berbasis stempel waktu bisa dienumerasi.
 *     Format sekarang: PREFIX-YYMMDD-XXXXXX (6 karakter acak, ~30^6 kombinasi).
 *
 * @param {string[]} existingCodes Kode yang sudah dipakai.
 * @param {string} prefix Prefix brand, mis. "SYLT".
 */
function uniqueBookingCode(existingCodes, prefix) {
  const taken = new Set(existingCodes || []);
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  let code = '';
  do {
    let rand = '';
    for (let i = 0; i < 6; i += 1) {
      rand += CODE_ALPHABET[crypto.randomBytes(1)[0] % CODE_ALPHABET.length];
    }
    code = `${prefix}-${stamp}-${rand}`;
  } while (taken.has(code));
  return code;
}

/* ------------------------------------------------------------------ */
/* Koordinat geolokasi (Latitude / Longitude)                           */
/* ------------------------------------------------------------------ */

/** Digit desimal yang disimpan ke database. 7 desimal ≈ 1,1 cm. */
const COORD_PRECISION = 7;

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

/**
 * Ubah input mentah (string) menjadi koordinat angka.
 * - String kosong  → null (koordinat tidak diisi).
 * - Format tidak valid → NaN (deteksi oleh pemanggil).
 * - Koma desimal ala Indonesia ("-0,4719") diterima.
 * - Nilai dibulatkan ke COORD_PRECISION digit agar presisi stabil di DB.
 */
function parseCoordinate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\s+/g, '');
  if (s === '') return null;
  const normalized = s.replace(',', '.');
  if (!/^[+-]?\d*\.?\d+$/.test(normalized)) return NaN;
  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return NaN;
  return Number(n.toFixed(COORD_PRECISION));
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= LAT_MIN && value <= LAT_MAX;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= LNG_MIN && value <= LNG_MAX;
}

/**
 * Validasi pasangan Latitude/Longitude sekaligus.
 * Mengembalikan { lat, lng, errors[] }.
 * Koordinat boleh kosong (opsional) TAPI tidak boleh setengah terisi.
 */
function validateCoordinates(latRaw, lngRaw) {
  const errors = [];
  const lat = parseCoordinate(latRaw);
  const lng = parseCoordinate(lngRaw);

  const latEmpty = lat === null;
  const lngEmpty = lng === null;

  if (latEmpty && !lngEmpty) {
    errors.push('Latitude wajib diisi bila Longitude diisi.');
  }
  if (lngEmpty && !latEmpty) {
    errors.push('Longitude wajib diisi bila Latitude diisi.');
  }
  if (!latEmpty && Number.isNaN(lat)) {
    errors.push('Latitude harus berupa angka desimal (contoh: -0.4719).');
  }
  if (!lngEmpty && Number.isNaN(lng)) {
    errors.push('Longitude harus berupa angka desimal (contoh: 130.7515).');
  }
  if (!latEmpty && !Number.isNaN(lat) && !isValidLatitude(lat)) {
    errors.push(`Latitude harus antara ${LAT_MIN} sampai ${LAT_MAX} (nilai saat ini: ${lat}).`);
  }
  if (!lngEmpty && !Number.isNaN(lng) && !isValidLongitude(lng)) {
    errors.push(`Longitude harus antara ${LNG_MIN} sampai ${LNG_MAX} (nilai saat ini: ${lng}).`);
  }

  return {
    lat: latEmpty || Number.isNaN(lat) ? null : lat,
    lng: lngEmpty || Number.isNaN(lng) ? null : lng,
    errors
  };
}

/** Format koordinat untuk ditampilkan di tabel admin. */
function formatCoord(value, decimals = 5) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(decimals);
}

/* ------------------------------------------------------------------ */
/* Pencarian, filter & sorting untuk tabel admin                       */
/* ------------------------------------------------------------------ */

/**
 * Uji apakah satu baris cocok dengan query pencarian.
 * `fields` = array fungsi aksesor (mis. r => r.name) — mendukung
 * multi-field search (ID, nama, email, status, dsb.).
 */
function matchesAny(row, query, fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (!Array.isArray(fields) || !fields.length) return true;
  return fields.some((get) => {
    let value;
    try {
      value = get(row);
    } catch (err) {
      return false;
    }
    if (value === null || value === undefined) return false;
    if (typeof value === 'object') {
      try {
        value = JSON.stringify(value);
      } catch (err) {
        value = String(value);
      }
    }
    return String(value).toLowerCase().includes(q);
  });
}

/**
 * Urutkan baris berdasarkan satu kolom.
 * `accessors` = object { namaKolom: fnAksesor }.
 * Nilai null selalu berada di akhir. Huruf & angka dibandingkan dengan
 * locale id-ID agar "Sabesi" mendahului "sabesi".
 */
function sortRows(rows, sort, dir, accessors) {
  if (!sort || !accessors || !Object.prototype.hasOwnProperty.call(accessors, sort)) return rows;
  const get = accessors[sort];
  const sign = String(dir).toLowerCase() === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    let va;
    let vb;
    try {
      va = get(a);
      vb = get(b);
    } catch (err) {
      return 0;
    }
    if (va === null || va === undefined || va === '') {
      return vb === null || vb === undefined || vb === '' ? 0 : 1;
    }
    if (vb === null || vb === undefined || vb === '') return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb), 'id-ID', { numeric: true, sensitivity: 'base' }) * sign;
  });
}

/** Normalisasi parameter sorting dari query string. */
function readSort(query, allowed, fallbackSort) {
  const sort = String((query && query.sort) || fallbackSort || '');
  const dir = String((query && query.dir) || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
  if (!allowed.includes(sort)) {
    return { sort: fallbackSort || '', dir: allowed.includes(sort) ? dir : 'asc' };
  }
  return { sort, dir };
}

module.exports = {
  formatRupiah,
  formatDateLong,
  formatDateShort,
  initials,
  excerpt,
  escapeHtml,
  renderRichText,
  BOOKING_STATUS,
  bookingStatusLabel,
  bookingStatusTone,
  publicationStatusLabel,
  publicationStatusTone,
  paginate,
  isEmail,
  isPhone,
  PAYMENT_STATUS,
  paymentStatusLabel,
  paymentStatusTone,
  starRating,
  tomorrowISO,
  uniqueBookingCode,
  COORD_PRECISION,
  LAT_MIN,
  LAT_MAX,
  LNG_MIN,
  LNG_MAX,
  parseCoordinate,
  isValidLatitude,
  isValidLongitude,
  validateCoordinates,
  formatCoord,
  matchesAny,
  sortRows,
  readSort
};
