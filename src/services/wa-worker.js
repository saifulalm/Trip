'use strict';

/**
 * Worker pengirim WhatsApp.
 *
 * Mengambil job broadcast berstatus "queued" dari db lalu mengirimnya
 * satu per satu. Karena seluruh status disimpan di db (data/db.json),
 * worker aman di-restart:
 *   - job yang belum selesai akan dilanjutkan dari job.cursor,
 *   - job yang gagal total bisa diulang dari admin.
 *
 * Worker juga menjadi penjaga "jeda antar pesan" sehingga tidak ada
 * dua proses yang mengirim bersamaan.
 */

const db = require('../db');
const wa = require('./wa');
const realtime = require('./realtime');

const MAX_CONSECUTIVE_FAIL = 5; // berhenti bila 5 pesan gagal beruntun
const POLL_INTERVAL_MS = 5000; // jeda polling antrean
const RETRY_DELAY_MS = 60000; // jeda sebelum mencoba lagi bila WA belum siap

let running = false;
let timer = null;
let currentJobId = null;

/**
 * Job yang sedang diproses oleh instance worker ini.
 *
 * Satu proses bisa memicu pemrosesan job dari dua jalur:
 *  - loop background (mengambil job 'queued' dari db),
 *  - panggilan langsung dari startBroadcast() saat admin menekan tombol.
 * Tanpa penanda ini, job yang sama bisa terkirim DUA KALI ke pelanggan.
 */
const activeJobs = new Set();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Siarkan progres job blast ke panel admin (realtime SSE).
 *
 * Dipanggil setiap kali angka sent/skipped/failed berubah supaya admin
 * melihat progres tanpa perlu memuat ulang halaman.
 *
 * @param {object} job job broadcast
 * @param {string} [reason] keterangan singkat (mis. 'pause', 'done')
 */
function publishProgress(job, reason) {
  if (!job) return;
  realtime.publish(realtime.EVENTS.BLAST, {
    id: job.id,
    status: job.status,
    sent: job.sent || 0,
    skipped: job.skipped || 0,
    failed: job.failed || 0,
    total: job.total || 0,
    cursor: job.cursor || 0,
    segment: job.segment || '',
    dryRun: Boolean(job.dryRun),
    pausedReason: job.pausedReason || null,
    reason: reason || 'progress',
    at: new Date().toISOString()
  });
}

/**
 * Ambil job yang sedang antre (queued / running yang tertinggal).
 *
 * Job yang sedang aktif diproses worker ini dikecualikan agar tidak
 * diambil dua kali.
 */
function findPendingJob() {
  const data = db.read();
  const list = data.broadcasts || [];
  return (
    list.find(
      (j) =>
        j.type === 'blast' &&
        (j.status === 'queued' || j.status === 'running') &&
        !activeJobs.has(j.id)
    ) || null
  );
}

/** Tandai job dibatalkan oleh admin. */
function cancelJob(jobId) {
  const data = db.read();
  const job = (data.broadcasts || []).find((j) => j.id === jobId);
  if (!job) return false;
  if (['done', 'error', 'aborted', 'blocked'].includes(job.status)) return false;
  job.status = 'aborted';
  job.finishedAt = new Date().toISOString();
  db.write();
  publishProgress(job, 'cancelled');
  return true;
}

/**
 * Jalankan satu job sampai selesai.
 * Mengembalikan 'done' | 'aborted' | 'waiting'.
 */
async function processJob(job, now) {
  // Cegah pemrosesan ganda job yang sama (loop background + panggilan
  // langsung dari startBroadcast).
  if (activeJobs.has(job.id)) return 'aborted';
  activeJobs.add(job.id);

  try {
    return await runJob(job, now);
  } finally {
    activeJobs.delete(job.id);
  }
}

/**
 * Inti pemrosesan job blast.
 *
 * @param {object} job job broadcast
 * @param {Date} [now] waktu acuan untuk pengecekan jam tenang (default: sekarang)
 * @returns {Promise<'done'|'aborted'|'waiting'>} hasil pemrosesan
 */
async function runJob(job, now) {
  const data = db.read();
  const settings = data.settings || {};

  // Hormati jam tenang: jangan kirim, tapi jangan juga membatalkan job.
  if (wa.isQuietHour(settings, now)) {
    job.status = 'queued';
    job.pausedReason = `Jam tenang (${wa.quietLabel(settings)})`;
    db.write();
    publishProgress(job, 'quiet-hour');
    return 'waiting';
  }

  // Tunggu kanal WhatsApp siap (perangkat WhatsApp Web terhubung).
  if (!wa.canSend()) {
    job.status = 'queued';
    job.pausedReason = 'Menunggu WhatsApp terhubung';
    db.write();
    publishProgress(job, 'waiting-device');
    return 'waiting';
  }

  if (job.status === 'queued') {
    job.status = 'running';
    job.startedAt = job.startedAt || new Date().toISOString();
    job.pausedReason = null;
    db.write();
    publishProgress(job, 'started');
  }

  const targets = job.targets || [];
  let consecutiveFail = 0;

  // Lanjutkan dari cursor (resume setelah restart).
  for (let i = job.cursor || 0; i < targets.length; i += 1) {
    // Periksa apakah admin membatalkan job ini.
    const current = db.read();
    const live = (current.broadcasts || []).find((j) => j.id === job.id);
    if (!live || live.status === 'aborted') {
      job.status = 'aborted';
      job.finishedAt = new Date().toISOString();
      db.write();
      publishProgress(job, 'aborted');
      return 'aborted';
    }

    const target = targets[i];
    const text = wa.renderTemplate(job.template, { name: target.name });

    try {
      const res = await wa.deliverTo({ phone: target.phone, name: target.name }, text);
      if (res.status === 'sent') {
        job.sent += 1;
        consecutiveFail = 0;
        job.results.push({ phone: target.phone, name: target.name, status: 'sent' });
      } else {
        job.skipped += 1;
        job.results.push({
          phone: target.phone,
          name: target.name,
          status: 'skipped',
          error: res.reason || 'dilewati'
        });
      }
    } catch (err) {
      job.failed += 1;
      consecutiveFail += 1;
      job.results.push({
        phone: target.phone,
        name: target.name,
        status: 'failed',
        error: String((err && err.message) || err).slice(0, 200)
      });
    }

    job.cursor = i + 1;
    // Jaga db.json tetap ramping: simpan 200 hasil terakhir per job.
    if (job.results.length > 200) job.results.splice(0, job.results.length - 200);
    db.write();
    // Siarkan progres ke panel admin (realtime, tanpa reload).
    publishProgress(job, 'sent');

    if (consecutiveFail >= MAX_CONSECUTIVE_FAIL) {
      job.status = 'aborted';
      job.error = `Dihentikan otomatis: ${MAX_CONSECUTIVE_FAIL} pesan gagal beruntun.`;
      job.finishedAt = new Date().toISOString();
      db.write();
      publishProgress(job, 'auto-abort');
      return 'aborted';
    }

    // Jeda antar pesan (rate-limit) + jeda tambahan bila gagal.
    await sleep(wa.MIN_DELAY_MS + (consecutiveFail > 0 ? 3000 : 0));
  }

  job.status = 'done';
  job.finishedAt = new Date().toISOString();
  job.pausedReason = null;
  db.write();
  publishProgress(job, 'done');
  return 'done';
}

/** Loop utama worker. */
async function loop() {
  if (running) return;
  running = true;

  while (running) {
    try {
      const job = findPendingJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      currentJobId = job.id;
      const result = await processJob(job);

      if (result === 'waiting') {
        // Tunggu lebih lama agar tidak membanjiri log & tidak memburu WhatsApp.
        await sleep(RETRY_DELAY_MS);
      } else {
        currentJobId = null;
        await sleep(500);
      }
    } catch (err) {
      console.error('[wa-worker] error:', err.message);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

/** Jalankan worker (idempotent). */
function start() {
  if (running) return;
  loop().catch((err) => console.error('[wa-worker] fatal:', err.message));
  console.log('[wa-worker] pengirim WhatsApp aktif.');
}

/** Hentikan worker. */
function stop() {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Status worker untuk ditampilkan di admin. */
function getStatus() {
  const data = db.read();
  const pending = (data.broadcasts || []).filter(
    (j) => j.type === 'blast' && (j.status === 'queued' || j.status === 'running')
  );
  return {
    running,
    currentJobId,
    pending: pending.length,
    queued: pending.map((j) => ({ id: j.id, status: j.status, sent: j.sent, total: j.total }))
  };
}

module.exports = { start, stop, cancelJob, processJob, findPendingJob, getStatus };
