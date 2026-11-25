'use strict';

/**
 * Bus event realtime untuk panel admin.
 *
 * TUJUAN
 * ------
 * Panel admin perlu menampilkan perubahan status tanpa perlu memuat ulang
 * halaman:
 *   - progres blast WhatsApp (terkirim / gagal / dilewati),
 *   - kontak baru / opt-in / opt-out,
 *   - status perangkat WhatsApp (terhubung / terputus),
 *   - pesan masuk dari pelanggan,
 *   - kanal media sosial terhubung / post terbit.
 *
 * DESAIN
 * ------
 * 1. Bus berbasis `EventEmitter` — tanpa dependensi baru (mengikuti pola
 *    `src/services/presence.js` yang sudah terbukti di repo ini).
 *
 * 2. Satu proses = satu bus. Semua publisher (worker blast, route admin,
 *    webhook OpenWA) memanggil `publish()`; semua konsumen (endpoint SSE)
 *    cukup `subscribe()`.
 *
 * 3. Endpoint SSE mengirim MUATAN LENGKAP, bukan sekadar "ada perubahan".
 *    Alasannya: browser harus bisa merender state baru tanpa fetch
 *    tambahan, dan ini menghindari race antara event & fetch.
 *
 * 4. Event tanpa muatan tetap dikirim bersama sinyal `refresh` supaya
 *    klien bisa memuat ulang daftar sendiri.
 */

const { EventEmitter } = require('events');

/**
 * Nama event yang dipakai aplikasi ini.
 *
 * Dipakai sebagai konstanta supaya tidak ada salah ketik string event
 * di antara publisher & consumer.
 */
const EVENTS = {
  /** Pesan masuk dari pelanggan (webhook OpenWA). */
  INBOUND: 'inbound',
  /** Status perangkat WhatsApp berubah. */
  GATEWAY: 'gateway',
  /** Progres / status job blast berubah. */
  BLAST: 'blast',
  /** Daftar kontak berubah (tambah / ubah / hapus). */
  CONTACT: 'contact',
  /** Kanal media sosial terhubung / diputus. */
  SOCIAL: 'social',
  /** Post media sosial terbit / dijadwalkan. */
  POST: 'post',
  /** Notifikasi umum (flash tanpa muatan). */
  NOTICE: 'notice'
};

const bus = new EventEmitter();
// Banyak tab admin bisa terbuka bersamaan → naikkan batas listener.
bus.setMaxListeners(200);

/**
 * Publikasikan sebuah event ke semua konsumen.
 *
 * @param {string} type salah satu nilai {@link EVENTS}
 * @param {object} [payload] muatan event (dikirim apa adanya ke klien)
 * @returns {boolean} true bila event berhasil disiarkan
 */
function publish(type, payload) {
  if (!type) return false;
  try {
    bus.emit('event', { type, payload: payload || {}, at: new Date().toISOString() });
    // Emit juga per-type supaya konsumen bisa berlangganan satu topik saja.
    bus.emit(type, payload || {});
    return true;
  } catch (err) {
    // Kegagalan satu konsumen tidak boleh menjatuhkan publisher.
    console.error('[realtime] gagal menyiarkan event:', err.message);
    return false;
  }
}

/**
 * Berlangganan semua event.
 *
 * @param {function} fn callback menerima {type, payload, at}
 * @returns {function} fungsi unsubscribe
 */
function subscribe(fn) {
  bus.on('event', fn);
  return function unsubscribe() {
    bus.removeListener('event', fn);
  };
}

/**
 * Berlangganan satu jenis event saja.
 *
 * @param {string} type nama event
 * @param {function} fn callback menerima payload
 * @returns {function} fungsi unsubscribe
 */
function subscribeType(type, fn) {
  bus.on(type, fn);
  return function unsubscribe() {
    bus.removeListener(type, fn);
  };
}

module.exports = { EVENTS, publish, subscribe, subscribeType };
