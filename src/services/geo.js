'use strict';

/**
 * Utilitas geografi ringan untuk portal pelanggan.
 *
 * Tidak memakai dependensi eksternal — cukup formula haversine yang
 * akurat untuk jarak pendek (jarakantar pulau / dermaga).
 *
 * Semua fungsi menerima angka (atau string yang bisa di-parse) dan
 * mengembalikan NaN-safe result supaya aman dipakai di template EJS.
 */

// Jari-jari bumi rata-rata (meter).
const EARTH_RADIUS = 6371008.8;

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

/**
 * Cek validitas koordinat geografis.
 * @returns {boolean} true bila lat/lng berada dalam rentang dunia
 */
function isValidLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    Math.abs(la) <= 90 &&
    Math.abs(ln) <= 180 &&
    !(la === 0 && ln === 0)
  );
}

/**
 * Jarak dua titik koordinat (meter) memakai formula haversine.
 * Mengembalikan NaN bila salah satu titik tidak valid.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  if (!isValidLatLng(lat1, lng1) || !isValidLatLng(lat2, lng2)) return NaN;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLng = toRad(Number(lng2) - Number(lng1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

/**
 * Format jarak untuk ditampilkan (mis. "820 m" / "12,4 km" / "120 km").
 */
function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return '-';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  // Di bawah 100 km tampilkan satu desimal (lebih informatif untuk
  // jarak antar pulau); di atas itu bulatkan saja.
  if (km < 100) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/**
 * Format jarak ringkas untuk badge (mis. "< 1 km", "12 km").
 */
function formatDistanceShort(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return '-';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${Math.round(m / 1000)} km`;
}

/**
 * Ubah input menjadi angka, atau null bila tidak valid.
 *
 * Catatan: `Number(null)` menghasilkan 0, dan `Number('')` juga 0 — jadi
 * konversi biasa akan menganggap koordinat yang belum diisi sebagai
 * koordinat (0,0) yang sah. Karena itu null/undefined/kosong dicek dulu.
 *
 * @param {*} value nilai mentah
 * @returns {number|null} angka, atau null bila tidak bisa dipakai
 */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Link Google Maps untuk melihat satu titik.
 *
 * Dipakai admin & pelanggan untuk membuka lokasi terakhir peserta di aplikasi
 * peta — jauh lebih cepat daripada menyalin koordinat secara manual.
 *
 * @param {number|string} lat latitude
 * @param {number|string} lng longitude
 * @param {string} [label] nama titik (opsional)
 * @returns {string} URL Google Maps, atau string kosong bila koordinat invalid
 */
function mapsUrl(lat, lng, label) {
  const la = toFiniteNumber(lat);
  const ln = toFiniteNumber(lng);
  if (la === null || ln === null) return '';
  // (0,0) adalah titik "null" di laut — bukan lokasi nyata.
  if (la === 0 && ln === 0) return '';
  let q = la.toFixed(6) + ',' + ln.toFixed(6);
  if (label) q += '(' + String(label) + ')';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

/**
 * Link Google Maps untuk rute menuju satu titik.
 *
 * @param {number|string} lat latitude tujuan
 * @param {number|string} lng longitude tujuan
 * @returns {string} URL Directions, atau string kosong bila koordinat invalid
 */
function mapsDirUrl(lat, lng) {
  const la = toFiniteNumber(lat);
  const ln = toFiniteNumber(lng);
  if (la === null || ln === null) return '';
  if (la === 0 && ln === 0) return '';
  return 'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(la.toFixed(6) + ',' + ln.toFixed(6));
}

/**
 * Format waktu relatif yang enak dibaca ("3 menit lalu").
 *
 * Dipakai untuk menampilkan kapan posisi terakhir seseorang tercatat.
 * @param {string|number|Date} value waktu ISO
 * @returns {string} teks relatif, atau '-' bila tidak valid
 */
function formatAge(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return '-';

  const diff = Date.now() - ms;
  if (diff < 0) return 'baru saja';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'baru saja';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' menit lalu';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + ' jam lalu';
  const day = Math.floor(hour / 24);
  if (day < 30) return day + ' hari lalu';
  const month = Math.floor(day / 30);
  if (month < 12) return month + ' bulan lalu';
  return Math.floor(month / 12) + ' tahun lalu';
}

module.exports = {
  EARTH_RADIUS,
  isValidLatLng,
  haversineMeters,
  formatDistance,
  formatDistanceShort,
  mapsUrl,
  mapsDirUrl,
  formatAge
};
