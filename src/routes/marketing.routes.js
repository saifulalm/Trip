'use strict';

const express = require('express');
const db = require('../db');
const helpers = require('../utils/helpers');
const { flash } = require('../middleware/context');
const wa = require('../services/wa');

/** Router ini dipasang di bawah /admin dan sudah melewati requireLogin. */
function createMarketingRouter() {
  const router = express.Router();

  /* Kontak marketing */
  const SORT_CONTACTS = {
    name: (c) => c.name,
    phone: (c) => c.phone,
    email: (c) => c.email,
    source: (c) => c.source,
    createdAt: (c) => c.createdAt
  };
  const SEARCH_CONTACTS = [
    (c) => c.name,
    (c) => c.phone,
    (c) => c.email,
    (c) => c.source,
    (c) => (c.optIn ? 'opt-in' : 'belum izin'),
    (c) => (c.optOut ? 'opt-out' : '')
  ];

  router.get('/kontak', (req, res) => {
    const data = db.read();
    const q = String(req.query.q || '').trim();
    const { sort, dir } = helpers.readSort(req.query, Object.keys(SORT_CONTACTS), 'name');
    res.locals.sort = { sort, dir };

    let list = helpers.sortRows([...(data.contacts || [])], sort, dir, SORT_CONTACTS);
    list = list.filter((c) => helpers.matchesAny(c, q, SEARCH_CONTACTS));

    const pg = helpers.paginate(list, req.query.page, 12);
    const status = '';
    if (req.query.partial === '1') {
      return res.render('admin/partials/list-contacts', { rows: pg.rows, pg, q, status, sort, dir, layout: false });
    }
    res.render('admin/contacts', {
      title: 'Kontak Marketing',
      contacts: list,
      pg,
      q,
      status,
      sort,
      dir,
      waActive: wa.isActive(data.settings),
      quietHour: wa.isQuietHour(),
      maxPerRun: wa.MAX_PER_RUN,
      marketable: wa.marketableContacts().length
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
      optIn: helpers.isChecked(req.body.optIn),
      optOut: false,
      createdAt: new Date().toISOString()
    });
    db.write();
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
    res.redirect('/admin/marketing/kontak');
  });

  router.post('/kontak/:id/hapus', (req, res, next) => {
    const data = db.read();
    const idx = (data.contacts || []).findIndex((x) => x.id === req.params.id);
    if (idx < 0) return next();
    data.contacts.splice(idx, 1);
    db.write();
    flash('success', 'Kontak dihapus.', req);
    res.redirect('/admin/marketing/kontak');
  });

  /* Blast WhatsApp */
  router.get('/blast', (req, res) => {
    const data = db.read();
    res.render('admin/blast', {
      title: 'Blast WhatsApp',
      waActive: wa.isActive(data.settings),
      quietHour: wa.isQuietHour(),
      maxPerRun: wa.MAX_PER_RUN,
      minDelay: wa.MIN_DELAY_MS,
      marketable: wa.marketableContacts().length,
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
    job.status = 'aborted';
    db.write();
    flash('success', 'Blast dihentikan.', req);
    res.redirect('/admin/marketing/blast');
  });

  return router;
}

module.exports = { createMarketingRouter };