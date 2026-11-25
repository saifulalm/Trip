'use strict';

const express = require('express');
const db = require('../db');
const { flash } = require('../middleware/context');
const wa = require('../services/wa');
const gateway = require('../services/wa-gateway');
const reminder = require('../services/wa-reminder');
const worker = require('../services/wa-worker');
const realtime = require('../services/realtime');

/** Router ini dipasang di bawah /admin dan sudah melewati requireLogin. */
function createMarketingRouter() {
  const router = express.Router();

  /* Kontak marketing */
  router.get('/kontak', async (req, res) => {
    const data = db.read();
    // Status gateway di-refresh bila cache-nya sudah basi. Tanpa ini
    // `waActive` selalu false (tombol kirim nonaktif) karena cache status
    // hanya terisi oleh polling berkala. Kegagalan refresh tidak boleh
    // memblokir render halaman.
    await gateway.ensureStateFresh(data.settings);
    res.render('admin/contacts', {
      title: 'Kontak Marketing',
      contacts: data.contacts || [],
      waActive: wa.isReady(),
      quietHour: wa.isQuietHour(data.settings),
      // Label jam tenang diambil dari service (sumber kebenaran tunggal),
      // bukan hardcoded di template.
      quietLabel: wa.quietLabel(data.settings),
      maxPerRun: wa.MAX_PER_RUN,
      marketable: wa.marketableContacts(data).length
    });
  });

  router.post('/kontak', (req, res) => {
    const data = db.read();
    const name = String(req.body.name || '').trim();
    const phone = wa.normalizePhone(req.body.phone);
    if (!name || phone.length < 9) {
      flash('error', 'Nama dan nomor WhatsApp valid wajib diisi.', req);
      return res.redirect('/admin/marketing/kontak');
    }
    data.contacts = data.contacts || [];
    if (data.contacts.some((c) => wa.normalizePhone(c.phone) === phone)) {
      flash('error', 'Nomor tersebut sudah ada di daftar kontak.', req);
      return res.redirect('/admin/marketing/kontak');
    }
    data.contacts.unshift({
      id: db.uid('ctc'),
      name,
      phone: String(req.body.phone || '').trim(),
      email: String(req.body.email || '').trim(),
      source: 'manual',
      optIn: req.body.optIn === 'on',
      optOut: false,
      createdAt: new Date().toISOString()
    });
    db.write();
    realtime.publish(realtime.EVENTS.CONTACT, {
      action: 'added',
      contact: data.contacts[0],
      count: data.contacts.length,
      marketable: wa.marketableContacts(data).length,
      at: new Date().toISOString()
    });
    flash('success', 'Kontak ditambahkan.', req);
    res.redirect('/admin/marketing/kontak');
  });

  /* Toggle opt-in & opt-out (hormati keputusan kontak) */
  router.post('/kontak/:id/toggle', (req, res, next) => {
    const data = db.read();
    const c = (data.contacts || []).find((x) => x.id === req.params.id);
    if (!c) return next();
    const field = req.body.field === 'optOut' ? 'optOut' : 'optIn';
    c[field] = !c[field];
    if (field === 'optIn' && c.optIn) c.optOut = false;
    db.write();
    realtime.publish(realtime.EVENTS.CONTACT, {
      action: 'toggle',
      field,
      contact: c,
      count: (data.contacts || []).length,
      marketable: wa.marketableContacts(data).length,
      at: new Date().toISOString()
    });
    res.redirect('/admin/marketing/kontak');
  });

  router.post('/kontak/:id/hapus', (req, res, next) => {
    const data = db.read();
    const idx = (data.contacts || []).findIndex((x) => x.id === req.params.id);
    if (idx < 0) return next();
    data.contacts.splice(idx, 1);
    db.write();
    realtime.publish(realtime.EVENTS.CONTACT, {
      action: 'removed',
      count: data.contacts.length,
      marketable: wa.marketableContacts(data).length,
      at: new Date().toISOString()
    });
    flash('success', 'Kontak dihapus.', req);
    res.redirect('/admin/marketing/kontak');
  });

  /* Blast WhatsApp */
  router.get('/blast', async (req, res) => {
    const data = db.read();
    // Sama seperti halaman Kontak: status gateway di-refresh bila cache
    // basi, supaya `waActive` mencerminkan kondisi sebenarnya (tombol
    // "Kirim Blast" aktif hanya kalau kanal siap). Kegagalan refresh
    // tidak boleh memblokir render halaman.
    await gateway.ensureStateFresh(data.settings);
    res.render('admin/blast', {
      title: 'Blast WhatsApp',
      waActive: wa.isReady(),
      quietHour: wa.isQuietHour(data.settings),
      quietLabel: wa.quietLabel(data.settings),
      deviceReady: wa.isReady(),
      maxPerRun: wa.MAX_PER_RUN,
      minDelay: wa.MIN_DELAY_MS,
      marketable: wa.marketableContacts(data).length,
      defaultTemplate:
        data.settings.waDefaultTemplate ||
        'Halo {{nama}}! 👋\nAda trip baru ke Pulau Sabesi — Raja Ampat yang lagi promo. Mau lihat itinerary-nya? Balas pesan ini ya, kak! 🏝️',
      broadcasts: (data.broadcasts || []).slice(0, 10),
      results: []
    });
  });

  router.post('/blast', async (req, res) => {
    try {
      const job = await wa.startBroadcast({
        templateBody: req.body.template,
        segment: String(req.body.segment || 'all'),
        dryRun: req.body.action === 'test'
      });
      realtime.publish(realtime.EVENTS.BLAST, {
        id: job.id,
        status: job.status,
        sent: job.sent || 0,
        skipped: job.skipped || 0,
        failed: job.failed || 0,
        total: job.total || 0,
        segment: job.segment || '',
        dryRun: Boolean(job.dryRun),
        reason: job.dryRun ? 'dry-run' : 'created',
        at: new Date().toISOString()
      });
      flash('success', job.dryRun
        ? `Mode uji: ${job.total} kontak cocok dengan template. Tidak ada pesan terkirim.`
        : `Blast dimulai ke ${job.total} kontak. Pantau progres di bawah.`, req);
    } catch (err) {
      flash('error', err.message, req);
    }
    res.redirect('/admin/marketing/blast');
  });

  router.post('/blast/:id/batal', (req, res, next) => {
    const data = db.read();
    const job = (data.broadcasts || []).find((x) => x.id === req.params.id);
    if (!job) return next();
    // Gunakan worker.cancelJob supaya status & waktu berhenti dicatat rapi.
    worker.cancelJob(job.id);
    flash('success', 'Blast dihentikan.', req);
    res.redirect('/admin/marketing/blast');
  });

  /* ------------------------------------------------------------------ */
  /* Realtime (SSE) — push perubahan ke panel admin                      */
  /* ------------------------------------------------------------------ */
  /*
   * Alur realtime:
   *   1. Browser membuka `GET /admin/marketing/stream` (EventSource).
   *   2. Server mengirim event `state` berisi snapshot terkini.
   *   3. Setiap perubahan (blast, kontak, gateway, pesan masuk) disiarkan
   *      lewat bus `src/services/realtime.js` → dikirim sebagai event SSE.
   *   4. Koneksi terputus → browser otomatis menyambung ulang; server
   *      mengirim snapshot baru pada sambungan berikutnya.
   */

  /**
   * Susun snapshot state marketing untuk ditampilkan panel admin.
   * @returns {object} snapshot
   */
  function buildSnapshot() {
    const data = db.read();
    const settings = data.settings || {};
    const broadcasts = data.broadcasts || [];
    const active = broadcasts.find(
      (j) => j.status === 'queued' || j.status === 'running'
    );
    return {
      contacts: (data.contacts || []).length,
      marketable: wa.marketableContacts(data).length,
      quietHour: wa.isQuietHour(settings),
      quietLabel: wa.quietLabel(settings),
      deviceReady: wa.isReady(),
      worker: worker.getStatus(),
      inbound: (data.waInbound || []).length,
      blast: active
        ? {
            id: active.id,
            status: active.status,
            sent: active.sent || 0,
            skipped: active.skipped || 0,
            failed: active.failed || 0,
            total: active.total || 0,
            cursor: active.cursor || 0,
            segment: active.segment || '',
            dryRun: Boolean(active.dryRun),
            pausedReason: active.pausedReason || null
          }
        : null,
      at: new Date().toISOString()
    };
  }

  /** Endpoint SSE. */
  router.get('/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders && res.flushHeaders();

    const send = (event, payload) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        /* koneksi sudah tertutup — ditangani event 'close' */
      }
    };

    send('hello', { ok: true, at: new Date().toISOString() });
    // Kirim snapshot awal supaya panel langsung punya data tanpa fetch tambahan.
    send('state', buildSnapshot());

    const unsubscribe = realtime.subscribe((change) => {
      send(change.type, change.payload || {});
      // Setiap perubahan juga disertai snapshot baru — ini yang membuat
      // UI tetap sinkron walau klien tidak bisa menafsirkan muatan event.
      send('state', buildSnapshot());
    });

    // Jaga koneksi tetap hidup (proxy sering menutup koneksi idle).
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        /* abaikan */
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      try {
        res.end();
      } catch (err) {
        /* abaikan */
      }
    });
  });

  /** Snapshot JSON (dipakai fallback bila SSE tidak tersedia). */
  router.get('/state', (req, res) => {
    res.json({ ok: true, state: buildSnapshot() });
  });

  /* ------------------------------------------------------------------ */
  /* WhatsApp — hubungkan perangkat lewat gateway OpenWA                */
  /* ------------------------------------------------------------------ */
  /*
   * Kanal WhatsApp sekarang sepenuhnya ditangani gateway OpenWA
   * (self-hosted, REST API). Tidak ada lagi browser/Chromium di dalam
   * proses Node — admin cukup memindai QR yang disajikan gateway.
   */
  router.get('/whatsapp', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};

    // Status gateway di-refresh sekilas supaya panel selalu menampilkan
    // kondisi terkini (bukan cache lama).
    await gateway.refreshState(settings);

    const waState = gateway.getState();
    const workerStatus = worker.getStatus();
    const health = await gateway.healthCheck(settings);

    res.render('admin/whatsapp', {
      title: 'WhatsApp',
      waState,
      gatewayConfig: {
        baseUrl: gateway.config(settings).baseUrl,
        sessionName: gateway.config(settings).sessionName,
        webhookUrl: gateway.config(settings).webhookUrl,
        webhookReady: Boolean(gateway.config(settings).webhookSecret)
      },
      gatewayHealth: health,
      quietLabel: wa.quietLabel(settings),
      inbound: (data.waInbound || []).slice(0, 20),
      workerStatus: {
        running: workerStatus.running,
        pending: workerStatus.pending,
        queued: workerStatus.queued
      }
    });
  });

  /**
   * Endpoint QR untuk polling dari browser.
   *
   * Mengembalikan JSON berisi QR (data-URL PNG) atau status perangkat.
   * Route ini dipanggil berulang kali oleh script inline di whatsapp.ejs.
   */
  router.get('/whatsapp/qr', async (req, res) => {
    try {
      const settings = (db.read() || {}).settings || {};
      let state = gateway.getState();
      if (state.status === 'ready') {
        return res.json({ ok: true, state });
      }

      // Pastikan session ada & engine berjalan supaya QR tersedia.
      const session = await gateway.ensureStartedSession(settings);
      state = gateway.getState();

      if (!session || session.status !== 'ready') {
        const qr = session && session.id ? await gateway.getQrCode(session.id, settings) : null;
        return res.json({ ok: Boolean(qr), qr, state });
      }

      return res.json({ ok: true, state });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  router.post('/whatsapp/pairing', async (req, res) => {
    try {
      const settings = (db.read() || {}).settings || {};
      const phone = gateway.normalizePhone(req.body.phone);
      if (!phone) {
        flash('error', 'Nomor HP tidak valid.', req);
        return res.redirect('/admin/marketing/whatsapp');
      }
      const session = await gateway.ensureStartedSession(settings);
      const code = await gateway.requestPairingCode(session.id, phone, settings);
      flash(
        'success',
        `Kode pairing: ${code}. Masukkan di WhatsApp → Perangkat Tertaut → Tautkan dengan nomor.`,
        req
      );
    } catch (err) {
      flash('error', `Gagal meminta kode pairing: ${err.message}`, req);
    }
    res.redirect('/admin/marketing/whatsapp');
  });

  router.post('/whatsapp/logout', async (req, res) => {
    try {
      const settings = (db.read() || {}).settings || {};
      const session = await gateway.ensureSession(settings);
      await gateway.logoutSession(session.id, settings);
      await gateway.refreshState(settings);
      flash('success', 'WhatsApp diputuskan dan sesi di gateway dihapus.', req);
    } catch (err) {
      flash('error', `Gagal memutus WhatsApp: ${err.message}`, req);
    }
    res.redirect('/admin/marketing/whatsapp');
  });

  router.post('/whatsapp/test', async (req, res) => {
    const data = db.read();
    const phone = wa.normalizePhone(req.body.phone);
    const message = String(req.body.message || '').trim();
    if (!wa.isValidPhone(phone)) {
      flash('error', 'Nomor tujuan tidak valid.', req);
      return res.redirect('/admin/marketing/whatsapp');
    }
    if (!message) {
      flash('error', 'Isi pesan tidak boleh kosong.', req);
      return res.redirect('/admin/marketing/whatsapp');
    }
    if (wa.isQuietHour(data.settings)) {
      flash('error', `Sedang jam tenang (${wa.quietLabel(data.settings)}). Pengiriman uji ditunda sampai jam sibuk.`, req);
      return res.redirect('/admin/marketing/whatsapp');
    }
    try {
      // Pakai sendVia (bukan sendText) supaya hasil pengiriman ikut tercatat
      // di log — penting untuk debugging saat gateway bermasalah.
      await wa.sendVia(data.settings, phone, message);
      flash('success', `Pesan uji terkirim ke ${phone}.`, req);
    } catch (err) {
      flash('error', `Gagal mengirim: ${err.message}`, req);
    }
    res.redirect('/admin/marketing/whatsapp');
  });

  /* ------------------------------------------------------------------ */
  /* Pengingat otomatis                                                  */
  /* ------------------------------------------------------------------ */
  router.get('/pengingat', (req, res) => {
    const data = db.read();
    const view = reminder.preview();
    res.render('admin/reminder', {
      title: 'Pengingat WhatsApp',
      due: view.due,
      quiet: view.quiet,
      quietLabel: view.quietLabel,
      ready: view.ready,
      templates: reminder.templates(data.settings || {}),
      history: view.history
    });
  });

  router.post('/pengingat/jalankan', async (req, res) => {
    try {
      const summary = await reminder.runReminders();
      if (summary.error) {
        flash('error', summary.error, req);
      } else {
        flash(
          'success',
          `Pengingat diproses: ${summary.sent} terkirim, ${summary.skipped} dilewati, ${summary.failed} gagal.`,
          req
        );
      }
    } catch (err) {
      flash('error', `Gagal menjalankan pengingat: ${err.message}`, req);
    }
    res.redirect('/admin/marketing/pengingat');
  });

  return router;
}

module.exports = { createMarketingRouter };