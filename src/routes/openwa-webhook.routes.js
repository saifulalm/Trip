'use strict';

/**
 * Route webhook WhatsApp OpenWA.
 *
 * Route ini TIDAK memakai sesi admin — pemanggilnya adalah gateway OpenWA,
 * bukan admin. Autentikasinya adalah HMAC-SHA256 atas body mentah (header
 * `X-OpenWA-Signature`), persis seperti yang diwajibkan OpenWA.
 *
 * PENTING — router ini harus dipasang SEBELUM `express.json()` di `app.js`.
 * HMAC harus dihitung atas byte mentah yang diterima; kalau body sudah
 * di-parse lalu di-stringify ulang, urutan kunci bisa berubah dan tanda
 * tangannya tidak akan cocok. Karena itu router memakai `express.raw()`.
 *
 * Kontrak balasan:
 * - `200` → event diterima (atau duplikat yang sengaja diabaikan).
 * - `401` → signature tidak valid / secret belum dikonfigurasi.
 * - `400` → body bukan JSON yang valid.
 * - `500` → gagal memproses; OpenWA akan mencoba ulang sesuai retryCount.
 */

const express = require('express');
const db = require('../db');
const gateway = require('../services/wa-gateway');
const webhook = require('../services/wa-gateway-webhook');

/**
 * Parser body khusus webhook.
 *
 * `express.raw` dipakai agar `req.body` berisi byte mentah, bukan object
 * yang sudah di-parse. Type `application/json` dipakai supaya content-type
 * lain (mis. teks) tetap diteruskan sebagai string biasa.
 */
const rawJsonBody = express.raw({
  type: ['application/json', 'application/*+json'],
  limit: '2mb'
});

/**
 * Buat router webhook OpenWA.
 * @returns {object} router Express
 */
function createOpenwaWebhookRouter() {
  const router = express.Router();

  /**
   * Menerima event dari OpenWA.
   *
   * POST /api/webhooks/openwa
   */
  router.post('/', rawJsonBody, (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : '');

    const signature = req.header(webhook.OPENWA_HEADERS.signature);

    // Secret diambil dari env lebih dulu, lalu dari settings.
    const secret = gateway.config((db.read() || {}).settings).webhookSecret;

    // Tanpa secret yang benar, signature tidak bisa diverifikasi. Menolak
    // seluruh delivery lebih aman daripada menerima request palsu.
    if (!secret) {
      console.error('[openwa] Secret webhook belum dikonfigurasi — delivery ditolak.');
      return res.status(401).json({
        success: false,
        message: 'Webhook OpenWA belum dikonfigurasi di server.'
      });
    }

    if (!webhook.verifySignature(rawBody, signature, secret)) {
      console.warn('[openwa] Signature webhook tidak valid — delivery ditolak.');
      return res.status(401).json({
        success: false,
        message: 'Signature webhook tidak valid.'
      });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Body webhook bukan JSON yang valid.'
      });
    }

    if (!event || typeof event.event !== 'string' || !event.sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Payload webhook tidak lengkap (event / sessionId wajib).'
      });
    }

    // Idempotensi diambil dari header, bukan dari body — header yang
    // dijamin OpenWA selalu sama antar retry.
    event.idempotencyKey = req.header(webhook.OPENWA_HEADERS.idempotencyKey)
      || event.idempotencyKey;
    event.deliveryId = req.header(webhook.OPENWA_HEADERS.deliveryId)
      || event.deliveryId;

    try {
      const result = webhook.handleEvent(event, rawBody);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[openwa] Gagal menangani webhook:', (err && err.message) || err);
      return res.status(500).json({
        success: false,
        message: 'Gagal memproses event webhook.'
      });
    }
  });

  return router;
}

module.exports = { createOpenwaWebhookRouter };
