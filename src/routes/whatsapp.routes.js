'use strict';

/**
 * whatsapp.routes.js — Panel kendali WhatsApp di Admin Panel.
 *
 * Menangani dua provider:
 *   • WhatsApp Cloud API (Meta) — cek token & Connectivity.
 *   • WhatsApp Web (Baileys) — QR scan, reconnect, status, kirim uji.
 *
 * Router ini dipasang di bawah /admin (sudah melewati requireLogin).
 */

const express = require('express');
const db = require('../db');
const wa = require('../services/wa');
const qr = require('../services/wa/qr');
const { flash } = require('../middleware/context');
const BRAND = require('../brand');

function createWhatsappRouter() {
  const router = express.Router();

  /** Halaman utama panel WhatsApp. */
  router.get('/', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    let status;
    try {
      status = await wa.status(settings);
    } catch (err) {
      status = {
        provider: wa.providerOf(settings),
        label: 'WhatsApp',
        state: 'error',
        stateLabel: 'Gagal',
        active: false,
        qr: null,
        me: null,
        connectedAt: null,
        lastError: err.message,
        attempts: 0,
        updatedAt: new Date().toISOString(),
        log: [],
        available: false,
        installHint: '',
        message: err.message
      };
    }
    res.render('admin/whatsapp', {
      title: 'WhatsApp',
      status,
      providers: wa.PROVIDERS,
      currentProvider: wa.providerOf(settings),
      isQuietHour: wa.isQuietHour(),
      marketable: wa.marketableContacts().length
    });
  });

  /** Status real-time (JSON) untuk polling panel. */
  router.get('/status', async (req, res) => {
    const data = db.read();
    try {
      const status = await wa.status(data.settings || {});
      res.json(status);
    } catch (err) {
      res.status(500).json({
        provider: 'cloud',
        state: 'error',
        stateLabel: 'Gagal',
        active: false,
        qr: null,
        me: null,
        log: [],
        lastError: err.message,
        message: err.message
      });
    }
  });

  /** Endpoint QR — mengembalikan string QR mentah + status saat ini. */
  router.get('/qr', (req, res) => {
    const snap = wa.webStatus();
    res.json({
      status: snap.status,
      statusLabel: wa.web.statusLabel(),
      qr: snap.qr,
      available: snap.available,
      qrImageAvailable: qr.isAvailable(),
      installHint: snap.available ? '' : wa.web.unavailableMessage(),
      me: snap.me,
      lastError: snap.lastError
    });
  });

  /**
   * Endpoint gambar QR (PNG). Dibuat server-side — tidak ada pustaka
   * pihak ketiga di sisi browser dan tidak ada koneksi yang dibuat.
   * 503 + JSON bila paket 'qrcode' belum terpasang.
   */
  router.get('/qr.png', async (req, res) => {
    const snap = wa.webStatus();
    if (!snap.qr) {
      return res.status(404).json({
        error: 'Belum ada QR yang aktif.',
        status: snap.status,
        installHint: qr.isAvailable() ? '' : qr.installHint()
      });
    }
    if (!qr.isAvailable()) {
      return res.status(503).json({
        error: qr.installHint(),
        status: snap.status,
        qr: snap.qr
      });
    }
    try {
      const buf = await qr.toBuffer(snap.qr, 6);
      if (!buf) {
        return res.status(503).json({ error: 'Gagal membuat gambar QR.', status: snap.status });
      }
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store, max-age=0');
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: 'Gagal membuat gambar QR: ' + err.message });
    }
  });

  /** Mulai / perbarui sesi WhatsApp Web (meminta QR baru bila perlu). */
  router.post('/connect', async (req, res) => {
    try {
      const snap = await wa.connectWeb();
      if (snap.status === 'unavailable') {
        flash('error', wa.web.unavailableMessage(), req);
      } else {
        flash('success', 'Sesi WhatsApp Web dimulai. Pindai QR yang tampil.', req);
      }
    } catch (err) {
      flash('error', 'Gagal memulai sesi: ' + err.message, req);
    }
    res.redirect('/admin/whatsapp');
  });

  /** Putuskan sesi (kredensial tetap tersimpan). */
  router.post('/disconnect', async (req, res) => {
    try {
      await wa.disconnectWeb();
      flash('success', 'Sesi WhatsApp Web diputus.', req);
    } catch (err) {
      flash('error', 'Gagal memutus sesi: ' + err.message, req);
    }
    res.redirect('/admin/whatsapp');
  });

  /** Hapus sesi + kredensial (status dan QR berikutnya menjadi baru). */
  router.post('/logout', async (req, res) => {
    try {
      await wa.logoutWeb();
      flash('success', 'Sesi WhatsApp Web dihapus. Pindai QR baru saat menyambung kembali.', req);
    } catch (err) {
      flash('error', 'Gagal menghapus sesi: ' + err.message, req);
    }
    res.redirect('/admin/whatsapp');
  });

  /** Refresh QR tanpa menghapus kredensial. */
  router.post('/refresh-qr', async (req, res) => {
    try {
      const snap = await wa.refreshQr();
      if (snap.status === 'unavailable') flash('error', wa.web.unavailableMessage(), req);
      else flash('success', 'QR diperbarui. Pindai ulang dari ponsel.', req);
    } catch (err) {
      flash('error', 'Gagal memperbarui QR: ' + err.message, req);
    }
    res.redirect('/admin/whatsapp');
  });

  /** Ganti provider aktif (cloud / web) — disimpan di settings. */
  router.post('/provider', (req, res) => {
    const data = db.read();
    const wanted = String(req.body.provider || '').toLowerCase();
    if (!wa.PROVIDERS[wanted]) {
      flash('error', 'Provider WhatsApp tidak dikenal.', req);
      return res.redirect('/admin/whatsapp');
    }
    data.settings.waProvider = wanted;
    db.write();
    flash('success', `Provider WhatsApp diganti ke ${wa.PROVIDERS[wanted].label}.`, req);
    res.redirect('/admin/whatsapp');
  });

  /** Kirim pesan uji ke satu nomor. */
  router.post('/test', async (req, res) => {
    const data = db.read();
    const phone = wa.normalizePhone(req.body.phone);
    const message = String(req.body.message || '').trim() || `Tes pesan otomatis dari ${BRAND.display}. 🙏`;
    if (phone.length < 9) {
      flash('error', 'Nomor WhatsApp tujuan tidak valid.', req);
      return res.redirect('/admin/whatsapp');
    }
    try {
      await wa.sendText(data.settings || {}, phone, message);
      flash('success', `Pesan uji berhasil dikirim ke ${phone}.`, req);
    } catch (err) {
      flash('error', 'Gagal mengirim pesan uji: ' + err.message, req);
    }
    res.redirect('/admin/whatsapp');
  });

  /** Periksa koneksi provider Cloud API secara on-demand. */
  router.post('/check', async (req, res) => {
    const data = db.read();
    try {
      const result = await wa.checkConnection(data.settings || {});
      if (result.ok) flash('success', result.message, req);
      else flash('error', result.message, req);
    } catch (err) {
      flash('error', 'Pemeriksaan koneksi gagal: ' + err.message, req);
    }
    res.redirect('/admin/whatsapp');
  });

  return router;
}

module.exports = { createWhatsappRouter };
