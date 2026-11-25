'use strict';

/**
 * Model data rombongan (trip group) & roster peserta.
 *
 * MASALAH YANG DISELESAIKAN
 * -------------------------
 * Privasi lokasi presence memakai irisan KODE BOOKING: dua pelanggan saling
 * terlihat hanya bila punya kode booking yang sama. Padahal satu kapal sering
 * memuat beberapa booking (mis. 3 booking × 2 orang = 6 orang dalam satu
 * kapal). Akibatnya peserta satu rombongan tidak saling melihat, sehingga
 * kasus "terpisah dari rombongan" tidak bisa dideteksi.
 *
 * Model `tripGroups` menyatukan beberapa booking ke dalam satu rombongan:
 *  - privacy check bisa memakai group, bukan cuma kode booking,
 *  - admin bisa melihat seluruh peserta satu kapal,
 *  - titik kumpul (meeting point) bisa ditetapkan per rombongan.
 *
 * TIDAK ADA database — data disimpan sebagai array `tripGroups` di
 * data/db.json, konsisten dengan entity lain di repo ini.
 */

const geo = require('./geo');

/** Radius default titik kumpul (meter) bila group tidak menetapkan. */
const DEFAULT_RADIUS_M = 5000;

/**
 * Ambil group berdasarkan id.
 * @param {object} data isi db
 * @param {string} groupId id group
 * @returns {object|null} group atau null
 */
function groupOf(data, groupId) {
  if (!groupId) return null;
  const list = (data && data.tripGroups) || [];
  return list.find((g) => g.id === groupId) || null;
}

/**
 * Semua group yang memuat booking tertentu.
 * @param {object} data isi db
 * @param {object} booking booking
 * @returns {Array<object>} daftar group
 */
function groupsForBooking(data, booking) {
  if (!booking || !booking.code) return [];
  const list = (data && data.tripGroups) || [];
  return list.filter((g) => (g.bookingCodes || []).includes(booking.code));
}

/**
 * Id group pertama yang memuat booking (null bila tidak ada).
 * @param {object} data isi db
 * @param {object} booking booking
 * @returns {string|null} id group
 */
function groupIdForBooking(data, booking) {
  const gs = groupsForBooking(data, booking);
  return gs.length ? gs[0].id : null;
}

/**
 * Semua group yang diikuti pelanggan tertentu.
 * @param {object} data isi db
 * @param {string} customerId id pelanggan
 * @returns {Array<object>} daftar group
 */
function groupsForCustomer(data, customerId) {
  if (!customerId) return [];
  const list = (data && data.tripGroups) || [];
  const codes = ((data && data.bookings) || [])
    .filter((b) => b.customerId === customerId)
    .map((b) => b.code);
  return list.filter((g) => (g.bookingCodes || []).some((c) => codes.includes(c)));
}

/**
 * Radius titik kumpul group (meter).
 * @param {object} group group
 * @returns {number} radius dalam meter
 */
function radiusM(group) {
  if (!group) return DEFAULT_RADIUS_M;
  const n = Number(group.radiusM);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M;
}

/**
 * Daftar peserta dalam satu group.
 *
 * Setiap peserta diambil dari booking di dalam group. Kalau satu booking punya
 * beberapa peserta (booking.participants > 1), hanya pemesan utama yang
 * tercatat — peserta tambahan tidak punya identitas sendiri di model data
 * sekarang.
 *
 * @param {object} data isi db
 * @param {object} group group
 * @param {object} [live] peta posisi live { 'role:refId': entry }
 * @param {object} [seen] peta last-seen { 'role:refId': entry }
 * @returns {Array<object>} daftar peserta
 */
function rosterOf(data, group, live, seen) {
  if (!group) return [];
  const codes = group.bookingCodes || [];
  const bookings = (data && data.bookings) || [];
  const customers = (data && data.customers) || [];
  const liveMap = live || {};
  const seenMap = seen || {};
  const out = [];

  codes.forEach((code) => {
    const booking = bookings.find((b) => b.code === code);
    if (!booking) return;
    const customer = customers.find((c) => c.id === booking.customerId) || null;

    const key = customer ? 'customer:' + customer.id : 'booking:' + booking.id;
    const liveEntry = liveMap[key];
    const seenEntry = seenMap[key];

    const pos = liveEntry || seenEntry || null;
    const at = pos && pos.at ? new Date(pos.at).getTime() : 0;
    const ageMin = at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;

    out.push({
      id: customer ? customer.id : booking.id,
      bookingId: booking.id,
      bookingCode: booking.code,
      name: customer ? customer.name : booking.name,
      role: 'customer',
      phone: customer ? customer.phone : booking.phone,
      email: customer ? customer.email : booking.email,
      packageName: booking.packageName,
      departureDate: booking.departureDate,
      participants: booking.participants || 1,
      lat: pos ? Number(pos.lat) : null,
      lng: pos ? Number(pos.lng) : null,
      accuracy: pos ? (pos.accuracy == null ? null : Number(pos.accuracy)) : null,
      at: pos ? pos.at : null,
      ageMin: ageMin,
      online: Boolean(liveEntry),
      lastSeenOnly: !liveEntry && Boolean(seenEntry)
    });
  });

  return out;
}

/**
 * Id peserta dalam group.
 * @param {object} data isi db
 * @param {object} group group
 * @returns {Array<string>} daftar id peserta
 */
function groupMembersOf(data, group) {
  return rosterOf(data, group).map((p) => p.id);
}

/**
 * Jarak peserta dari titik kumpul group (meter).
 * @param {object} group group
 * @param {object} participant peserta dari rosterOf
 * @returns {number|null} jarak dalam meter, atau null bila tidak bisa dihitung
 */
function distanceToMeetingPoint(group, participant) {
  if (!group || !group.meetingPoint) return null;
  if (!participant || !geo.isValidLatLng(participant.lat, participant.lng)) return null;
  const d = geo.haversineMeters(
    participant.lat,
    participant.lng,
    group.meetingPoint.lat,
    group.meetingPoint.lng
  );
  return Number.isFinite(d) ? d : null;
}

module.exports = {
  DEFAULT_RADIUS_M,
  groupOf,
  groupsForBooking,
  groupIdForBooking,
  groupsForCustomer,
  radiusM,
  rosterOf,
  groupMembersOf,
  distanceToMeetingPoint
};
