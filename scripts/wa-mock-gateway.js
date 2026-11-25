/**
 * Transport tiruan untuk gateway WhatsApp OpenWA.
 *
 * Semua suite uji WhatsApp memakai helper ini supaya tidak pernah
 * menghubungi gateway sungguhan (atau lebih buruk: mengirim pesan asli).
 *
 * Modul yang dimock adalah `src/services/wa-gateway.js` — satu-satunya
 * lapisan transport yang dipakai `wa.js` untuk mengirim pesan.
 */

const path = require('path');
const root = path.join(__dirname, '..');
const gateway = require(path.join(root, 'src', 'services', 'wa-gateway'));

/**
 * Pasang transport tiruan pada gateway OpenWA.
 *
 * @param {object} [options] { ready?: boolean }
 * @returns {{sent: Array<{chatId: string, text: string}>}} penangkap pesan
 */
function mockGateway(options) {
  const opts = options || {};
  const sent = [];

  gateway.sendText = async (phone, text) => {
    sent.push({ chatId: String(phone), text: String(text) });
    return { id: 'mock-' + sent.length, jid: String(phone), via: 'openwa' };
  };
  gateway.isReady = () => opts.ready !== false;

  return sent;
}

/**
 * Set status gateway (siap / belum siap).
 * @param {boolean} ready true bila perangkat dianggap tersambung
 */
function setReady(ready) {
  gateway.isReady = () => Boolean(ready);
}

module.exports = { gateway, mockGateway, setReady };
