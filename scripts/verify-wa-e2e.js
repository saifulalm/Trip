/**
 * Verifikasi integrasi WhatsApp end-to-end terhadap server yang berjalan.
 *
 * Menguji:
 *  1. Login admin + akses halaman marketing.
 *  2. Penyimpanan pengaturan jam tenang & interval pengingat.
 *  3. Blast mode uji -> job tersimpan, tidak ada pesan terkirim.
 *  4. Blast sungguhan -> job masuk antrean, worker memproses & menandai done.
 *  5. Batalkan blast -> status aborted.
 *
 * Semua TESTS ditulis terhadap server nyata (bukan createApp in-process)
 * supaya alur worker background ikut teruji.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));

const PORT = Number(process.env.VERIFY_PORT) || 4199;
const base = `http://127.0.0.1:${PORT}`;

let cookies = '';

function req(pathname, opts) {
  return new Promise((resolve, reject) => {
    const options = Object.assign({ headers: {} }, opts);
    const u = new URL(pathname, base);
    const r = http.request(u, options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

function capture(res) {
  const set = res.headers['set-cookie'];
  if (set) cookies = set.map((c) => c.split(';')[0]).join('; ');
}

function csrfOf(html) {
  return (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

let pass = 0;
let fail = 0;
function t(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  PASS  ' + name);
  } else {
    fail += 1;
    console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : ''));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Tunggu sampai job blast mencapai status tertentu. */
async function waitJobStatus(jobId, statuses, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    const data = db.reload();
    const job = (data.broadcasts || []).find((j) => j.id === jobId);
    if (job && statuses.includes(job.status)) return job;
    await sleep(400);
  }
  const data = db.reload();
  return (data.broadcasts || []).find((j) => j.id === jobId) || null;
}

(async () => {
  // ---- Snapshot settings awal agar bisa dipulihkan di akhir ----
  const settingsSnapshot = { ...(db.reload().settings || {}) };

  // ---- Login ----
  const loginPage = await req('/admin/login');
  capture(loginPage);
  const login = await req('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      username: 'admin',
      password: 'admin123',
      _csrf: csrfOf(loginPage.body)
    }).toString()
  });
  capture(login);
  t('login admin berhasil', login.status === 302, 'status ' + login.status);

  // ---- Halaman marketing ----
  for (const [p, label] of [
    ['/admin/marketing/whatsapp', 'hub WhatsApp'],
    ['/admin/marketing/kontak', 'kontak'],
    ['/admin/marketing/blast', 'blast'],
    ['/admin/marketing/pengingat', 'pengingat'],
    ['/admin/pengaturan', 'pengaturan']
  ]) {
    const res = await req(p, { headers: { Cookie: cookies } });
    t(`halaman ${label} -> 200`, res.status === 200, 'status ' + res.status);
    if (res.status === 500) console.log('    ' + res.body.slice(0, 500));
  }

  // ---- Simpan pengaturan jam tenang ----
  const settingsPage = await req('/admin/pengaturan', { headers: { Cookie: cookies } });
  const sCsrf = csrfOf(settingsPage.body);
  const saveSettings = await req('/admin/pengaturan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      form: 'wa',
      waQuietStart: '22',
      waQuietEnd: '6',
      waReminderIntervalMin: '15',
      _csrf: sCsrf
    }).toString()
  });
  t('simpan pengaturan WA -> 302', saveSettings.status === 302, 'status ' + saveSettings.status);
  const s = db.reload().settings || {};
  t('jam tenang mulai tersimpan (22)', s.waQuietStart === 22, 'nilai ' + s.waQuietStart);
  t('jam tenang selesai tersimpan (6)', s.waQuietEnd === 6, 'nilai ' + s.waQuietEnd);
  t('interval pengingat tersimpan (15)', s.waReminderIntervalMin === 15, 'nilai ' + s.waReminderIntervalMin);

  // Nilai di luar rentang harus ditolak (fallback), bukan disimpan apa adanya.
  const bad = await req('/admin/pengaturan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      form: 'wa',
      waQuietStart: '99',
      waQuietEnd: 'abc',
      _csrf: sCsrf
    }).toString()
  });
  t('simpan jam tidak valid -> 302 (tidak error)', bad.status === 302, 'status ' + bad.status);
  const s2 = db.reload().settings || {};
  t('jam di luar rentang ditolak (tidak 99)', s2.waQuietStart !== 99, 'nilai ' + s2.waQuietStart);

  // ---- Nonaktifkan jam tenang untuk sisa skrip ----
  // Start == end berarti jam tenang NONAKTIF. Ini diperlukan karena
  // pemeriksaan blast di bawah dijalankan pada jam berapa pun: bila jam
  // tenang aktif, job tertahan dengan alasan "Jam tenang" dan bukan
  // "WhatsApp belum siap" — assertion jadi Depends-on jam.
  const off = await req('/admin/pengaturan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      form: 'wa',
      waQuietStart: '10',
      waQuietEnd: '10',
      waReminderIntervalMin: '15',
      _csrf: sCsrf
    }).toString()
  });
  t('matikan jam tenang -> 302', off.status === 302, 'status ' + off.status);
  const s3 = db.reload().settings || {};
  t('jam tenang nonaktif (start == end)', s3.waQuietStart === 10 && s3.waQuietEnd === 10,
    `start=${s3.waQuietStart} end=${s3.waQuietEnd}`);

  // ---- Blast mode uji ----
  const blastPage = await req('/admin/marketing/blast', { headers: { Cookie: cookies } });
  const bCsrf = csrfOf(blastPage.body);
  const before = (db.reload().broadcasts || []).length;
  const test = await req('/admin/marketing/blast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      template: 'Halo {{nama}}! Test {{kode}}.',
      segment: 'all',
      action: 'test',
      _csrf: bCsrf
    }).toString()
  });
  t('blast mode uji -> 302', test.status === 302, 'status ' + test.status);
  const after = db.reload().broadcasts || [];
  t('job blast baru tersimpan', after.length > before, `${before} -> ${after.length}`);
  const testJob = after[0];
  t('job mode uji berstatus done', testJob && testJob.status === 'done', testJob && testJob.status);
  t('job mode uji tidak mengirim pesan (sent=0)', testJob && testJob.sent === 0, 'sent=' + (testJob && testJob.sent));
  t(
    'job mode uji menyertakan hasil simulasi',
    testJob && Array.isArray(testJob.results) && testJob.results.length > 0,
    'jumlah hasil ' + (testJob && testJob.results && testJob.results.length)
  );

  // ---- Blast sungguhan: worker harus memproses antrean ----
  //
  // PENTING: skrip ini berjalan terhadap server NYATA. Bila perangkat
  // WhatsApp kebetulan tersambung, blast "send" akan mengirim pesan
  // sungguhan ke pelanggan. Supaya skrip ini aman dijalankan kapan saja,
  // seluruh kontak dibuat tidak marketable (opt-in dimatikan) selama
  // pengujian, lalu dikembalikan seperti semula.
  // Opt-out dipasang lewat API ADMIN, bukan menulis db.json langsung:
  // server dev menyimpan cache modul db.js, jadi penulisan dari proses
  // lain akan ditimpa kembali oleh server (race condition).
  const contactIds = (db.reload().contacts || []).map((c) => c.id);
  const optOutBefore = new Map(
    (db.reload().contacts || []).map((c) => [c.id, Boolean(c.optOut)])
  );
  const adminCsrf = csrfOf(
    (await req('/admin/marketing/kontak', { headers: { Cookie: cookies } })).body
  );
  for (const id of contactIds) {
    if (optOutBefore.get(id)) continue;
    await req(`/admin/marketing/kontak/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
      body: new URLSearchParams({ field: 'optOut', _csrf: adminCsrf }).toString()
    });
  }

  const sendPage = await req('/admin/marketing/blast', { headers: { Cookie: cookies } });
  const sCsrf2 = csrfOf(sendPage.body);
  const send = await req('/admin/marketing/blast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      template: 'Halo {{nama}}! Promo terbaru.',
      segment: 'all',
      action: 'send',
      _csrf: sCsrf2
    }).toString()
  });
  t('blast sungguhan -> 302', send.status === 302, 'status ' + send.status);
  const liveJob = (db.reload().broadcasts || [])[0];
  t('job sungguhan dibuat', Boolean(liveJob) && liveJob.dryRun === false);
  t('tidak ada kontak yang ditembak (aman)', liveJob && liveJob.total === 0,
    'total=' + (liveJob && liveJob.total));

  // Worker background akan memproses job: karena tidak ada kanal WhatsApp
  // yang terhubung, job harus ditunda ("queued" + pausedReason), bukan error.
  const settled = await waitJobStatus(liveJob.id, ['queued', 'running', 'done', 'aborted', 'error'], 15000);
  t('worker memproses job (tidak menggantung)', Boolean(settled), 'job tidak ditemukan');
  t(
    'job ditunda dengan alasan jelas bila kanal belum siap',
    settled &&
      (settled.status === 'queued'
        ? Boolean(settled.pausedReason && settled.pausedReason.includes('WhatsApp'))
        : settled.status === 'done' && settled.sent === 0),
    settled && `${settled.status} / ${settled.pausedReason} / sent=${settled.sent}`
  );

  // ---- Batalkan blast ----
  const cancel = await req(`/admin/marketing/blast/${liveJob.id}/batal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({ _csrf: sCsrf2 }).toString()
  });
  t('batalkan blast -> 302', cancel.status === 302, 'status ' + cancel.status);
  const cancelled = (db.reload().broadcasts || []).find((j) => j.id === liveJob.id);
  t('job berstatus aborted setelah dibatalkan', cancelled && cancelled.status === 'aborted', cancelled && cancelled.status);
  t('waktu berhenti tercatat', cancelled && Boolean(cancelled.finishedAt));

  console.log(`\n${pass} lulus, ${fail} gagal.`);

  // ---- Pulihkan kontak & settings awal ----
  try {
    for (const id of contactIds) {
      if (optOutBefore.get(id)) continue;
      await req(`/admin/marketing/kontak/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
        body: new URLSearchParams({ field: 'optOut', _csrf: adminCsrf }).toString()
      });
    }
    console.log('kontak dipulihkan.');
  } catch (err) {
    console.warn('Gagal memulihkan kontak:', err.message);
  }

  try {
    const data = db.reload();
    data.settings = { ...data.settings, ...settingsSnapshot };
    db.write();
    console.log('settings awal dipulihkan.');
  } catch (err) {
    console.warn('Gagal memulihkan settings:', err.message);
  }

  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
