'use strict';

/**
 * qr.js — Pembuatan gambar QR untuk sesi WhatsApp Web.
 *
 * Modul 'qrcode' dimuat LAZY di dalam fungsi (bukan di top-level), sehingga:
 *  - Aplikasi tetap jalan normal walau 'qrcode' belum terpasang.
 *  - Tidak ada socket/koneksi yang dibuat — murni fungsi murni, sehingga
 *    TIDAK ada memory leak maupun resource yang perlu dibersihkan.
 *
 * Fallback: bila paket tidak tersedia, fungsi mengembalikan null dan
 * panel admin menampilkan string QR mentah + instruksi instalasi.
 */

let cached = null;

/** true bila paket 'qrcode' tersedia. */
function isAvailable() {
  if (cached !== null) return cached;
  try {
    require.resolve('qrcode');
    cached = true;
  } catch (err) {
    cached = false;
  }
  return cached;
}

function installHint() {
  return 'Paket "qrcode" belum terpasang. Jalankan: npm install qrcode';
}

/**
 * Buat data-URL PNG dari string QR.
 * @param {string} text isi QR
 * @param {number} scale ukuran modul (default 6)
 * @returns {Promise<string|null>} data URL, atau null bila paket tidak ada.
 */
async function toDataUrl(text, scale) {
  if (!text) return null;
  if (!isAvailable()) return null;
  try {
    // eslint-disable-next-line global-require
    const QRCode = require('qrcode');
    const size = Math.max(2, Math.min(12, Number(scale) || 6));
    return await QRCode.toDataURL(String(text), {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: size,
      color: { dark: '#061f25', light: '#ffffff' }
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[wa-qr] gagal membuat QR:', err.message);
    }
    return null;
  }
}

/**
 * Buat buffer PNG dari string QR (untuk endpoint gambar).
 * @returns {Promise<Buffer|null>}
 */
async function toBuffer(text, scale) {
  if (!text) return null;
  if (!isAvailable()) return null;
  try {
    // eslint-disable-next-line global-require
    const QRCode = require('qrcode');
    const size = Math.max(2, Math.min(12, Number(scale) || 6));
    return await QRCode.toBuffer(String(text), {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: size,
      type: 'png'
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[wa-qr] gagal membuat PNG:', err.message);
    }
    return null;
  }
}

module.exports = { isAvailable, installHint, toDataUrl, toBuffer };
