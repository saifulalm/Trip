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

module.exports = {
  EARTH_RADIUS,
  isValidLatLng,
  haversineMeters,
  formatDistance,
  formatDistanceShort
};
