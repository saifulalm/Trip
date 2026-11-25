'use strict';

/**
 * Router integrasi media sosial (menu "Connect Social Media").
 *
 * Dipasang di bawah /admin/social dan sudah melewati requireLogin.
 *
 * Dua kelompok fungsi:
 *  1. Profil publik — tautan Instagram/Facebook/Threads/... yang dipakai di
 *     footer situs publik dan structured data SEO (schema.org sameAs).
 *  2. Kanal publish — menghubungkan akun & mempublikasikan konten melalui
 *     Postiz Public REST API (open-source, AGPL-3.0, self-hosted).
 *
 * Jalur koneksi kanal (WAJIB mengikuti urutan ini):
 *  1. Admin menyimpan URL API + API Key Postiz  → POST /postiz
 *  2. Admin menekan "Hubungkan" pada sebuah platform → GET /hubungkan/:key
 *     Route ini mencoba POST /integrations/connect (connect link Postiz,
 *     lebih andal & tidak butuh OAuth terpasang di Postiz), dan kalau itu
 *     ditolak → fallback GET /social/{identifier} (OAuth langsung).
 *  3. Admin diarahkan ke URL provider, menyetujui, lalu Postiz mencatat
 *     integrasi baru. Kanal akan muncul di daftar setelah "Segarkan".
 */

const express = require('express');
const db = require('../db');
const { flash } = require('../middleware/context');
const social = require('../services/social');
const postiz = require('../services/postiz');
const helpers = require('../utils/helpers');
const { singleImage, cleanupUploads } = require('../middleware/upload');
const { UPLOAD_DIR } = require('../services/image');
const realtime = require('../services/realtime');
const fs = require('fs');
const path = require('path');

/** Router ini dipasang di bawah /admin/social dan sudah melewati requireLogin. */
function createSocialRouter() {
  const router = express.Router();

  /**
   * Susun status koneksi setiap platform.
   *
   * Sumber data:
   *  - integrasi Postiz (kalau server Postiz aktif & API key benar)
   *  - tautan profil yang tersimpan di settings (profil publik selalu ada
   *    meskipun kanal publish belum terhubung)
   *
   * @param {object} settings data settings
   * @param {object[]} integrations integrasi dari Postiz
   * @returns {object[]} status per platform
   */
  function buildStatus(settings, integrations) {
    return social.listPlatforms().map((p) => {
      const profile = social.normalizeUrl(settings[p.slug]);
      const linked = integrations.filter((it) => it.identifier === p.identifier);
      return {
        ...p,
        profileUrl: profile,
        handle: social.handleFromUrl(profile),
        connected: linked.length > 0,
        channels: linked.map((it) => ({
          id: it.id,
          name: it.name,
          profile: it.profile || '',
          picture: it.picture || '',
          disabled: Boolean(it.disabled)
        }))
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Halaman hub integrasi                                              */
  /* ------------------------------------------------------------------ */
  router.get('/', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const cfg = postiz.config(settings);

    // Coba ambil daftar integrasi dari Postiz. Kegagalan TIDAK boleh
    // menggagalkan halaman — admin mungkin belum menjalankan Postiz.
    let integrations = [];
    let postizError = null;
    let postizOk = false;
    let organization = null;

    if (cfg.enabled) {
      const res2 = await postiz.listIntegrations(settings);
      postizOk = res2.ok;
      integrations = res2.integrations;
      if (!res2.ok) postizError = res2.error;

      // Ambil nama workspace supaya admin tahu API key-nya milik tim mana.
      if (res2.ok) {
        const me = await postiz.whoAmI(settings);
        if (me.ok) organization = me.organization;
      }
    }

    // Notifikasi hasil percobaan menghubungkan kanal sebelumnya.
    // req.session.socialReturnTo dulu hanya ditulis tapi tidak pernah dibaca —
    // sekarang jadi sumber umpan balik "berhasil / gagal".
    const socialNotice = req.session.socialNotice || null;
    delete req.session.socialNotice;

    // Platform yang dituju saat kembali dari OAuth (query ?connected=key).
    // Dipakai untuk memberi umpan balik nyata: apakah kanal benar-benar
    // sudah tercatat di Postiz atau masih perlu "Segarkan".
    const connectedKey = String(req.query.connected || '').trim();
    const returnPlatform = connectedKey ? social.getPlatform(connectedKey) : null;
    let connectResult = null;
    if (returnPlatform) {
      const linked = integrations.filter((it) => it.identifier === returnPlatform.identifier);
      if (linked.length > 0) {
        connectResult = {
          type: 'success',
          message: `${returnPlatform.label} berhasil terhubung (${linked.length} kanal aktif). `
            + 'Kanal ini siap dipakai di menu "Tulis & Publikasikan".'
        };
      } else {
        connectResult = {
          type: 'info',
          message: `Kanal ${returnPlatform.label} belum terdeteksi di Postiz. `
            + 'Klik "Segarkan Status" bila Anda baru saja menyetujui permintaan OAuth.'
        };
      }
    }

    res.render('admin/social', {
      title: 'Connect Social Media',
      platforms: buildStatus(settings, integrations),
      profileLinks: social.profileLinks(settings),
      connectedCount: integrations.length,
      postiz: {
        enabled: cfg.enabled,
        baseUrl: cfg.baseUrl,
        hasKey: Boolean(cfg.apiKey),
        reachable: postizOk,
        error: postizError,
        organization
      },
      socialNotice: socialNotice || connectResult,
      socialReturnTo: returnPlatform ? `/admin/social?connected=${returnPlatform.key}` : null,
      highlightKey: returnPlatform ? returnPlatform.key : null
    });
  });

  /**
   * Endpoint JSON untuk status koneksi (dipakai tombol "Segarkan").
   */
  router.get('/status', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const cfg = postiz.config(settings);
    if (!cfg.enabled) {
      return res.json({
        ok: false,
        configured: false,
        platforms: [],
        error: 'Postiz belum dikonfigurasi. Isi URL API & API Key dulu.'
      });
    }
    const out = await postiz.listIntegrations(settings);
    if (!out.ok) {
      return res.json({ ok: false, configured: true, platforms: [], error: out.error });
    }
    return res.json({
      ok: true,
      configured: true,
      count: out.integrations.length,
      platforms: buildStatus(settings, out.integrations).map((p) => ({
        key: p.key,
        label: p.label,
        color: p.color,
        connected: p.connected,
        channels: p.channels
      }))
    });
  });

  /**
   * Diagnosa koneksi Postiz yang lebih rinci.
   *
   * Endpoint ini memecah kegagalan menjadi penyebab yang bisa ditindaklanjuti:
   * API key ditolak (401) vs server Postiz mati (timeout/DNS) vs API key kosong.
   */
  router.get('/diagnostik', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const cfg = postiz.config(settings);

    if (!cfg.enabled) {
      return res.json({
        ok: false,
        step: 'konfigurasi',
        configured: false,
        message: 'URL API atau API Key Postiz belum diisi.'
      });
    }

    const conn = await postiz.isConnected(settings);
    if (!conn.ok) {
      const authIssue = /401|unauthor|api key|no api key/i.test(conn.error || '');
      return res.json({
        ok: false,
        step: 'autentikasi',
        configured: true,
        baseUrl: cfg.baseUrl,
        message: authIssue
          ? 'API Key ditolak oleh Postiz. Salin ulang API Key dari Postiz → Settings.'
          : `Tidak dapat menghubungi Postiz di ${cfg.baseUrl}: ${conn.error}`,
        hint: authIssue
          ? 'Header Authorization Postiz memakai API key mentah (tanpa "Bearer").'
          : 'Pastikan instance Postiz berjalan dan URL API benar.'
      });
    }

    const list = await postiz.listIntegrations(settings);
    if (!list.ok) {
      return res.json({
        ok: false,
        step: 'integrations',
        configured: true,
        baseUrl: cfg.baseUrl,
        message: `API key valid, tetapi daftar kanal gagal dimuat: ${list.error}`
      });
    }

    return res.json({
      ok: true,
      step: 'siap',
      configured: true,
      connected: conn.connected,
      baseUrl: cfg.baseUrl,
      channelCount: list.integrations.length,
      channels: list.integrations.map((it) => ({
        id: it.id,
        name: it.name,
        identifier: it.identifier,
        disabled: Boolean(it.disabled)
      }))
    });
  });

  /* ------------------------------------------------------------------ */
  /* Statistik kanal (analytics)                                        */
  /* ------------------------------------------------------------------ */
  /*
   * Endpoint ini memakai service `postiz.analytics(settings, integrationId, days)`.
   *
   * PENTING: `integrationId` WAJIB berisi UUID integrasi dari
   * GET /integrations — BUKAN `__type` platform (mis. "instagram").
   * Path lama `/analytics/platform` tidak ada di API Postiz dan selalu
   * membalas 400 "Invalid integration".
   *
   * Karena itu route ini menerjemahkan `__type` yang diminta admin
   * menjadi UUID integrasi yang sebenarnya sebelum memanggil API.
   */
  router.get('/analytics', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const cfg = postiz.config(settings);

    if (!cfg.enabled) {
      return res.status(400).json({
        ok: false,
        configured: false,
        error: 'Postiz belum dikonfigurasi. Isi URL API & API Key dulu.'
      });
    }

    const wantedType = String(req.query.type || '').trim();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);

    const list = await postiz.listIntegrations(settings);
    if (!list.ok) {
      return res.status(502).json({ ok: false, configured: true, error: list.error });
    }

    // Tanpa `type` → ringkasan seluruh kanal.
    if (!wantedType) {
      const summary = list.integrations.map((it) => ({
        id: it.id,
        name: it.name,
        identifier: it.identifier,
        disabled: Boolean(it.disabled)
      }));
      return res.json({ ok: true, configured: true, channels: summary, days });
    }

    const integration = list.integrations.find((it) => it.identifier === wantedType);
    if (!integration) {
      return res.status(404).json({
        ok: false,
        configured: true,
        error: `Tidak ada kanal ${wantedType} yang terhubung di Postiz.`
      });
    }

    const out = await postiz.analytics(settings, integration.id, days);
    if (!out.ok) {
      return res.status(502).json({ ok: false, configured: true, error: out.error });
    }
    return res.json({
      ok: true,
      configured: true,
      channel: { id: integration.id, name: integration.name, identifier: integration.identifier },
      days,
      stats: out.stats
    });
  });

  /* ------------------------------------------------------------------ */
  /* Simpan tautan profil publik                                         */
  /* ------------------------------------------------------------------ */
  router.post('/profil', (req, res) => {
    const data = db.read();
    const settings = data.settings || (data.settings = {});
    const updates = social.normalizeSettings(req.body, settings);
    Object.assign(settings, updates);
    db.write();
    flash('success', 'Tautan profil media sosial berhasil disimpan.', req);
    res.redirect('/admin/social');
  });

  /* ------------------------------------------------------------------ */
  /* Konfigurasi Postiz (self-hosted)                                   */
  /* ------------------------------------------------------------------ */
  router.post('/postiz', (req, res) => {
    const data = db.read();
    const settings = data.settings || (data.settings = {});
    const baseUrl = String(req.body.postizBaseUrl || '').trim();
    const apiKey = String(req.body.postizApiKey || '').trim();

    // Centang "hapus konfigurasi" untuk mengosongkan URL API + API Key.
    // Tanpa ini, admin tidak pernah bisa melepas instance Postiz lama
    // karena form tidak pernah mengirim nilai kosong (input password
    // dianggap "pertahankan yang lama").
    if (req.body.postizClear === '1' || req.body.postizClear === 'on') {
      settings.postizBaseUrl = '';
      settings.postizApiKey = '';
      db.write();
      flash('success', 'Konfigurasi Postiz dihapus. Isi lagi untuk memakai integrasi.', req);
      return res.redirect('/admin/social');
    }

    // API key yang tidak dikirim berarti "pertahankan yang lama" (input
    // bertipe password tidak selalu terkirim ulang oleh browser).
    if (baseUrl) settings.postizBaseUrl = baseUrl.replace(/\/+$/, '');
    if (apiKey) settings.postizApiKey = apiKey;
    db.write();

    flash('success', 'Konfigurasi Postiz disimpan.', req);
    res.redirect('/admin/social');
  });

  /* ------------------------------------------------------------------ */
  /* Hubungkan kanal lewat OAuth Postiz                                  */
  /* ------------------------------------------------------------------ */
  router.get('/hubungkan/:key', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const platform = social.getPlatform(req.params.key);
    if (!platform) {
      flash('error', 'Platform tidak dikenal.', req);
      return res.redirect('/admin/social');
    }
    // Platform tanpa OAuth (mis. Mastodon) hanya bisa dihubungkan lewat
    // antarmuka Postiz — UI juga tidak menampilkan tombolnya. Route wajib
    // menolak agar tidak ada jalan pintas yang pasti gagal.
    if (!platform.oauth) {
      flash(
        'error',
        `${platform.label} tidak bisa dihubungkan lewat tautan OAuth. Hubungkan lewat antarmuka Postiz.`,
        req
      );
      return res.redirect('/admin/social');
    }
    const cfg = postiz.config(settings);
    if (!cfg.enabled) {
      flash('error', 'Isi URL API & API Key Postiz terlebih dahulu.', req);
      return res.redirect('/admin/social');
    }

    // Tujuan setelah kanal terhubung: kembali ke hub dengan penanda platform.
    // Penanda dipakai route GET / untuk memberi umpan balik "berhasil/gagal".
    const returnTo = `/admin/social?connected=${encodeURIComponent(platform.key)}`;
    // req.session.socialReturnTo dulu ditulis tapi tidak pernah dibaca
    // (dead state di session). Sekarang returnTo dipakai langsung sebagai
    // tujuan redirect, jadi tidak perlu disimpan di session.
    delete req.session.socialReturnTo;

    // Jalur utama: connect link milik Postiz (POST /integrations/connect).
    // Link ini berlaku 1 jam dan orang yang membukanya tidak perlu akun
    // Postiz — jauh lebih andal untuk instance self-hosted.
    const redirectUrl = absoluteUrl(req, returnTo);
    realtime.publish(realtime.EVENTS.SOCIAL, {
      action: 'connecting',
      platform: platform.key,
      label: platform.label,
      at: new Date().toISOString()
    });

    const link = await postiz.connectLink(platform.identifier, settings, redirectUrl);

    if (link.ok && link.url) {
      req.session.socialNotice = {
        type: 'info',
        message: `Sedang menghubungkan ${platform.label}. Setujui permintaan di halaman yang terbuka, lalu kembali ke sini dan klik "Segarkan".`
      };
      return res.redirect(link.url);
    }

    // Fallback: OAuth langsung ke provider (GET /social/{identifier}).
    const out = await postiz.oauthUrl(platform.identifier, settings);
    if (out.ok && out.url) {
      req.session.socialNotice = {
        type: 'info',
        message: `Sedang menghubungkan ${platform.label}. Setujui permintaan OAuth, lalu kembali ke sini dan klik "Segarkan".`
      };
      return res.redirect(out.url);
    }

    // Dua jalur gagal → beri pesan yang bisa ditindaklanjuti.
    req.session.socialNotice = {
      type: 'error',
      message: `Gagal menghubungkan ${platform.label}: ${link.error || out.error || 'tidak diketahui'}. `
        + 'Bila platform ini butuh URL eksternal (mis. Mastodon), hubungkan lewat antarmuka Postiz.'
    };
    return res.redirect(returnTo);
  });

  /* ------------------------------------------------------------------ */
  /* Putuskan kanal yang terhubung                                       */
  /* ------------------------------------------------------------------ */
  router.post('/kanal/:id/hapus', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const out = await postiz.deleteIntegration(settings, req.params.id);
    if (out.ok) {
      realtime.publish(realtime.EVENTS.SOCIAL, {
        action: 'disconnected',
        integrationId: req.params.id,
        at: new Date().toISOString()
      });
      flash('success', 'Kanal diputuskan dari Postiz.', req);
    } else {
      flash('error', `Gagal memutus kanal: ${out.error}`, req);
    }
    res.redirect('/admin/social');
  });

  /* ------------------------------------------------------------------ */
  /* Tester koneksi Postiz                                               */
  /* ------------------------------------------------------------------ */
  router.post('/test', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};

    // Susun konfigurasi sementara: nilai dari form menang atas yang tersimpan,
    // sehingga admin bisa menguji URL/API Key baru sebelum menyimpannya.
    const tmp = { ...settings };
    const baseUrl = String(req.body.postizBaseUrl || '').trim();
    const apiKey = String(req.body.postizApiKey || '').trim();
    if (baseUrl) tmp.postizBaseUrl = baseUrl.replace(/\/+$/, '');
    if (apiKey) tmp.postizApiKey = apiKey;

    const cfg = postiz.config(tmp);
    if (!cfg.enabled) {
      flash('error', 'Isi URL API dan API Key Postiz terlebih dahulu.', req);
      return res.redirect('/admin/social');
    }

    const conn = await postiz.isConnected(tmp);
    if (!conn.ok) {
      flash('error', `Tidak dapat menghubungi Postiz: ${conn.error}`, req);
      return res.redirect('/admin/social');
    }
    if (!conn.connected) {
      flash('error', 'Postiz reachable, tetapi API key tidak terhubung ke workspace mana pun.', req);
      return res.redirect('/admin/social');
    }

    const out = await postiz.listIntegrations(tmp);
    if (!out.ok) {
      flash('error', `API key valid, tetapi daftar kanal gagal dimuat: ${out.error}`, req);
    } else {
      flash('success', `Berhasil menghubungi Postiz. ${out.integrations.length} kanal terhubung.`, req);
    }
    res.redirect('/admin/social');
  });

  /* ------------------------------------------------------------------ */
  /* Composer: publikasikan / jadwalkan konten                          */
  /* ------------------------------------------------------------------ */
  router.get('/tulis', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const cfg = postiz.config(settings);

    let integrations = [];
    let error = null;
    if (cfg.enabled) {
      const out = await postiz.listIntegrations(settings);
      integrations = out.integrations;
      if (!out.ok) error = out.error;
    }

    // Kanal dikelompokkan per platform supaya UI bisa menampilkan metadata
    // (warna merek, batas panjang, field wajib) tanpa lookup ulang di view.
    const channels = integrations.map((it) => {
      const platform = social.getPlatformByIdentifier(it.identifier);
      return {
        id: it.id,
        name: it.name || (platform ? platform.label : it.identifier),
        identifier: it.identifier,
        platformKey: platform ? platform.key : '',
        platformLabel: platform ? platform.label : it.identifier,
        color: platform ? platform.color : '#64748b',
        glyph: platform ? platform.glyph : String(it.name || '?').slice(0, 2).toUpperCase(),
        profile: it.profile || '',
        picture: it.picture || '',
        disabled: Boolean(it.disabled),
        maxLength: platform ? platform.maxLength : null,
        requires: platform ? platform.requires : null,
        note: platform ? platform.note : ''
      };
    });

    res.render('admin/social-compose', {
      title: 'Tulis & Publikasikan',
      integrations: channels,
      channels: social.listPlatforms(),
      error,
      configured: cfg.enabled,
      // Service social diteruskan agar view bisa memetakan status post
      // & warna merek tanpa menduplikasi registry.
      social,
      // Media yang sudah diunggah ke Postiz (disimpan di session).
      media: Array.isArray(req.session.socialMedia) ? req.session.socialMedia : [],
      // Indeks media yang dicentang admin (dipakai juga saat submit).
      selectedMedia: Array.isArray(req.session.socialMediaSelected)
        ? req.session.socialMediaSelected
        : [],
      defaults: {
        content: settings.socialDefaultTemplate || ''
      }
    });
  });

  router.post('/tulis', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const b = req.body;

    const content = String(b.content || '').trim();
    if (!content) {
      flash('error', 'Isi konten tidak boleh kosong.', req);
      return res.redirect('/admin/social/tulis');
    }

    // Kanal tujuan dikirim sebagai array `channels` (nilai = id integrasi).
    const chosen = Array.isArray(b.channels) ? b.channels.filter(Boolean) : [b.channels].filter(Boolean);
    if (!chosen.length) {
      flash('error', 'Pilih minimal satu kanal tujuan.', req);
      return res.redirect('/admin/social/tulis');
    }

    // Petakan id integrasi -> platform (untuk __type wajib per platform).
    const out = await postiz.listIntegrations(settings);
    if (!out.ok) {
      flash('error', `Tidak dapat mengambil daftar kanal: ${out.error}`, req);
      return res.redirect('/admin/social/tulis');
    }
    const byId = new Map(out.integrations.map((it) => [it.id, it]));

    const type = b.mode === 'schedule' ? 'schedule' : b.mode === 'draft' ? 'draft' : 'now';
    const date = b.publishAt ? new Date(b.publishAt).toISOString() : new Date().toISOString();
    const link = String(b.link || '').trim();

    // Media: admin mencentang beberapa media yang sudah diunggah ke Postiz.
    // Indeks dikirim sebagai array `media` (angka). Media yang TIDAK diunggah
    // ke Postiz tidak bisa dipakai (Postiz butuh id + path hasil /upload).
    const mediaPool = Array.isArray(req.session.socialMedia) ? req.session.socialMedia : [];
    const pickedIdx = (Array.isArray(b.media) ? b.media : [b.media])
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < mediaPool.length);
    const images = pickedIdx.map((i) => mediaPool[i]).filter(Boolean);

    const channels = [];
    const missingRequired = [];
    for (const id of chosen) {
      const integ = byId.get(id);
      if (!integ) continue;
      const platform = social.getPlatformByIdentifier(integ.identifier);
      const needs = social.requiredField(integ.identifier);

      // Field wajib per platform (Pinterest `board`, Reddit `subreddit`).
      // Kalau kosong → tolak sebelum memanggil API, supaya pesan errornya
      // jelas dan tidak membuang kuota 90 request/jam Postiz.
      const chSettings = {};
      if (needs) {
        const raw = String((b['req_' + needs.key] || '')).trim();
        if (!raw) {
          missingRequired.push(`${platform ? platform.label : integ.identifier}: ${needs.label}`);
          continue;
        }
        if (needs.key === 'subreddit') {
          chSettings.subreddit = [{ value: { subreddit: raw, title: content.slice(0, 90), type: 'self', is_flair_required: false } }];
        } else {
          chSettings.board = raw;
        }
      }

      channels.push({
        integrationId: integ.id,
        __type: integ.identifier,
        content,
        // Media terpilih dikirim ke semua kanal (Postiz memfilter sendiri
        // media yang tidak didukung platform, mis. video untuk Instagram).
        images,
        link,
        postType: b.postType === 'story' ? 'story' : 'post',
        settings: chSettings
      });
    }

    if (missingRequired.length) {
      flash(
        'error',
        `Field wajib belum diisi: ${missingRequired.join('; ')}. Isi dulu lalu kirim ulang.`,
        req
      );
      return res.redirect('/admin/social/tulis');
    }

    if (!channels.length) {
      flash('error', 'Kanal yang dipilih tidak valid.', req);
      return res.redirect('/admin/social/tulis');
    }

    // Batas panjang konten per platform (nilai bawaan registry; ditimpa
    // oleh nilai resmi Postiz bila tersedia).
    const tooLong = channels
      .map((ch) => {
        const p = social.getPlatformByIdentifier(ch.__type);
        return p && p.maxLength && content.length > p.maxLength ? p.label : null;
      })
      .filter(Boolean);
    if (tooLong.length) {
      flash('error', `Konten terlalu panjang untuk: ${tooLong.join(', ')}.`, req);
      return res.redirect('/admin/social/tulis');
    }

    const result = await postiz.createPost({ channels, type, date }, settings);
    if (!result.ok) {
      flash('error', `Gagal mempublikasikan: ${result.error}`, req);
    } else {
      const verb = type === 'now' ? 'diterbitkan' : type === 'schedule' ? 'dijadwalkan' : 'disimpan sebagai draf';
      realtime.publish(realtime.EVENTS.POST, {
        action: type,
        channels: channels.length,
        content: content.slice(0, 120),
        at: new Date().toISOString()
      });
      flash('success', `Konten berhasil ${verb} ke ${channels.length} kanal.`, req);
    }
    res.redirect('/admin/social/tulis');
  });

  /* ------------------------------------------------------------------ */
  /* Unggah media ke Postiz                                              */
  /* ------------------------------------------------------------------ */
  router.post('/unggah', singleImage('mediaFile', 'media'), async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const processed = req.processedImages && req.processedImages.mediaFile;

    if (!processed || !processed.filename) {
      flash('error', 'Tidak ada berkas gambar yang diunggah.', req);
      return res.redirect('/admin/social/tulis');
    }

    // Postiz butuh berkas sebagai multipart, bukan URL lokal. Kita kirim
    // isi WebP hasil proses ke Postiz dan terima { id, path }.
    const full = path.join(UPLOAD_DIR, processed.filename);

    try {
      const buffer = fs.readFileSync(full);
      const up = await postiz.uploadMedia(settings, buffer, processed.filename, 'image/webp');
      if (!up.ok) {
        flash('error', `Gagal mengunggah media ke Postiz: ${up.error}`, req);
        return res.redirect('/admin/social/tulis');
      }
      // Simpan descriptor media di session supaya composer bisa menyisipkannya
      // ke payload post tanpa mengunggah ulang. Batasi 8 entri terbaru agar
      // session tidak membengkak.
      req.session.socialMedia = req.session.socialMedia || [];
      req.session.socialMedia.push(up.media);
      if (req.session.socialMedia.length > 8) {
        req.session.socialMedia = req.session.socialMedia.slice(-8);
      }
      flash('success', `Media berhasil diunggah ke Postiz (${up.media.id}).`, req);
    } catch (err) {
      flash('error', `Gagal memproses media: ${err.message}`, req);
    } finally {
      // Berkas lokal tidak dipakai lagi → hapus supaya tidak jadi yatim.
      cleanupUploads(req);
    }
    res.redirect('/admin/social/tulis');
  });

  /* ------------------------------------------------------------------ */
  /* Riwayat post terjadwal                                              */
  /* ------------------------------------------------------------------ */
  router.get('/riwayat', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const cfg = postiz.config(settings);

    let posts = [];
    let error = null;
    if (cfg.enabled) {
      const out = await postiz.listPosts(settings);
      posts = out.posts;
      if (!out.ok) error = out.error;
    }

    res.render('admin/social-history', {
      title: 'Riwayat Publikasi',
      posts,
      error,
      // Service social dipakai view untuk memetakan state -> label/warna.
      social,
      formatDateShort: helpers.formatDateShort
    });
  });

  /* ------------------------------------------------------------------ */
  /* Aksi pada post (hapus / ubah status)                               */
  /* ------------------------------------------------------------------ */
  router.post('/riwayat/:id/hapus', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const out = await postiz.deletePost(settings, req.params.id);
    if (out.ok) {
      flash('success', 'Post dihapus dari Postiz.', req);
    } else {
      flash('error', `Gagal menghapus post: ${out.error}`, req);
    }
    res.redirect('/admin/social/riwayat');
  });

  router.post('/riwayat/:id/status', async (req, res) => {
    const data = db.read();
    const settings = data.settings || {};
    const mode = req.body.mode === 'schedule' ? 'schedule' : 'draft';
    const out = await postiz.setPostStatus(settings, req.params.id, mode);
    if (out.ok) {
      flash('success', mode === 'schedule' ? 'Post dijadwalkan ulang.' : 'Post diubah menjadi draf.', req);
    } else {
      flash('error', `Gagal mengubah status post: ${out.error}`, req);
    }
    res.redirect('/admin/social/riwayat');
  });

  return router;
}

/**
 * Bangun URL absolut dari path relatif, memakai host request.
 *
 * Dipakai untuk `redirectUrl` pada connect link Postiz — Postiz.validate
 * mewajibkan URL http/https tanpa fragment.
 *
 * @param {object} req request Express
 * @param {string} path path relatif
 * @returns {string} URL absolut
 */
function absoluteUrl(req, path) {
  const host = req.get('host') || 'localhost';
  const proto = req.protocol || 'http';
  return `${proto}://${host}${path}`;
}

module.exports = { createSocialRouter };
