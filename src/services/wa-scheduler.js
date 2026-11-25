'use strict';

/**
 * Penjadwalan otomatis pengingat WhatsApp.
 *
 * Mengatur interval pemeriksaan berkala (default 30 menit) dan menjalankan
 * reminder yang jatuh tempo. Aman dijalankan di server yang sama dengan
 * worker blast karena keduanya memakai antrean/db yang sama.
 *
 * Semua aturan dijalankan hanya bila:
 *  - perangkat WhatsApp terhubung,
 *  - bukan jam tenang,
 *  - tidak ada blast yang sedang berjalan (menghindari spam beruntun).
 */

const db = require('../db');
const reminder = require('./wa-reminder');
const worker = require('./wa-worker');
const wa = require('./wa');

const MIN_INTERVAL_MS = 5 * 60 * 1000; // interval minimum 5 menit
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // default 30 menit

let timer = null;
let running = false;
let lastRun = null;
let lastResult = null;

function intervalMs() {
  const data = db.read();
  const min = Number((data.settings || {}).waReminderIntervalMin) || 30;
  return Math.max(MIN_INTERVAL_MS, min * 60 * 1000);
}

/** Apakah sedang ada blast yang berjalan? */
function blastInProgress() {
  const data = db.read();
  return (data.broadcasts || []).some(
    (j) => j.type === 'blast' && (j.status === 'queued' || j.status === 'running')
  );
}

/** Jalankan satu siklus pemeriksaan pengingat. */
async function tick() {
  if (running) return null;
  const data = db.read();
  const settings = data.settings || {};

  // Lewati bila kanal WhatsApp belum siap atau sedang jam tenang.
  if (!wa.canSend()) return null;
  if (reminder.preview().quiet) return null;
  // Jangan tumpang tindih dengan blast.
  if (blastInProgress()) return null;

  running = true;
  try {
    const result = await reminder.runReminders();
    lastRun = new Date().toISOString();
    lastResult = result;
    if (result.sent || result.failed) {
      console.log(
        `[wa-reminder] terkirim ${result.sent}, dilewati ${result.skipped}, gagal ${result.failed}.`
      );
    }
    return result;
  } catch (err) {
    console.error('[wa-reminder] error:', err.message);
    return null;
  } finally {
    running = false;
  }
}

/** Mulai penjadwalan berkala. */
function start() {
  stop();
  const ms = intervalMs();
  timer = setInterval(() => {
    tick().catch(() => {});
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[wa-reminder] penjadwalan otomatis aktif (tiap ${Math.round(ms / 60000)} menit).`);
}

/** Hentikan penjadwalan. */
function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function status() {
  return { running, lastRun, lastResult, intervalMs: intervalMs() };
}

module.exports = { start, stop, tick, status };
