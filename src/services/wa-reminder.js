'use strict';

/**
 * Pengingat (reminder) WhatsApp otomatis.
 *
 * Berbeda dari "reminder" di dashboard admin (yang hanya tugas untuk
 * operator), modul ini mengirim pesan WhatsApp sungguhan ke pelanggan
 * pada titik waktu yang relevan:
 *
 *  1. Booking baru dibuat            → konfirmasi & ucapan terima kasih
 *  2. Booking belum dibayar (H+1)    → pengingat pembayaran
 *  3. Keberangkatan tinggal 3 hari   → info penting + nlok transfer
 *  4. Booking dikonfirmasi           → detail trip & ucapan
 *
 * Aturan penting:
 *  - hanya dikirim ke nomor yang sudah opt-in promo (izin di cek ULANG
 *    saat pengiriman, sama seperti jalur blast di `wa.js`),
 *  - opt-out selalu menang atas opt-in,
 *  - hormati jam tenang (tidak dikirim 21.00–08.00),
 *  - tidak ada duplikat: setiap aturan punya "kunci" (dedupe key) yang
 *    disimpan di db sehingga pesan tidak dikirim dua kali.
 */

const db = require('../db');
const wa = require('./wa');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Template pengingat (dapat dioverride lewat settings). */
function templates(settings) {
  const s = settings || {};
  const t = s.waReminderTemplates || {};
  return {
    bookingCreated:
      t.bookingCreated ||
      'Halo {{nama}}! 👋\n' +
        'Booking {{kode}} untuk paket {{namaPaket}} sudah kami terima. ' +
        'Tanggal keberangkatan {{tanggal}}.\n' +
        'Silakan selesaikan pembayaran lewat link yang kami kirim ya, kak. ' +
        'Ada yang mau ditanyakan? Tinggal balas pesan ini. 🌊',
    paymentReminder:
      t.paymentReminder ||
      'Halo {{nama}}! ⏰\n' +
        'Booking {{kode}} Anda belum lunas dan keberangkatan {{tanggal}} tinggal dekat.\n' +
        'Selesaikan pembayarannya lewat link iPaymu yang kami kirim ya, kak. ' +
        'Terima kasih! 🙏',
    departureReminder:
      t.departureReminder ||
      'Halo {{nama}}! 🏝️\n' +
        'Trip {{namaPaket}} Anda berangkat {{tanggal}} — tinggal 3 hari lagi!\n' +
        'Siapkan Mastercard, sunscreen, dan kamera. Sampai jumpa di {{namaPaket}}! 🌊',
    confirmed:
      t.confirmed ||
      'Halo {{nama}}! ✅\n' +
        'Booking {{kode}} Anda sudah terkonfirmasi untuk paket {{namaPaket}} ' +
        'tanggal {{tanggal}}.\n' +
        'Detail paketnya: {{detail}}\n' +
        'Sampai bertemu di Destination! 🙌'
  };
}

/** Ambil (atau buat) tabel dedupe pengingat. */
function dedupeStore(data) {
  if (!Array.isArray(data.waReminders)) data.waReminders = [];
  return data.waReminders;
}

/**
 * Apakah pengingat dengan kunci ini sudah pernah dikirim?
 * Kunci format: "<rule>:<bookingId>".
 */
function alreadySent(data, key) {
  return dedupeStore(data).some((r) => r.key === key);
}

function markSent(data, key, extra) {
  dedupeStore(data).unshift({
    key,
    sentAt: new Date().toISOString(),
    ...(extra || {})
  });
  // Jaga tabel tetap kecil.
  const store = dedupeStore(data);
  if (store.length > 500) store.length = 500;
}

/** Ambil data kontak untuk sebuah nomor (punya optIn & optOut). */
function contactFor(data, phone) {
  const p = wa.normalizePhone(phone);
  return (data.contacts || []).find((c) => wa.normalizePhone(c.phone) === p) || null;
}


/**
 * Kembalikan daftar pengingat yang SEHARUSNYA dikirim saat ini.
 * Dipakai juga oleh halaman admin untuk pratinjau ("apa yang akan terkirim").
 */
function collectDueReminders(data, now) {
  const s = data.settings || {};
  const t = templates(s);
  const nowTs = now ? new Date(now).getTime() : Date.now();
  const due = [];

  for (const b of data.bookings || []) {
    if (!b || b.status === 'cancelled') continue;

    const createdTs = new Date(b.createdAt || 0).getTime();
    if (!createdTs) continue;

    // 1. Konfirmasi pembuatan booking (kirim 15 menit setelah dibuat).
    if (nowTs - createdTs >= 15 * 60 * 1000) {
      const key = `booking_created:${b.id}`;
      if (!alreadySent(data, key)) {
        due.push({
          key,
          rule: 'booking_created',
          label: 'Konfirmasi booking',
          booking: b,
          text: wa.renderTemplate(t.bookingCreated, { name: b.name }, {
            code: b.code,
            packageName: b.packageName,
            departureDate: b.departureDate
          })
        });
      }
    }

    // 2. Pengingat pembayaran (H+1, belum lunas, dan keberangkatan belum lewat).
    //    Dikirim harian (kunci dedupe per hari) supaya tamu terus dingatkan
    //    sampai lunas — bukan hanya sekali.
    const unpaid = b.paymentStatus !== 'paid' && b.paymentStatus !== 'rejected';
    const depTs = b.departureDate ? new Date(`${b.departureDate}T00:00:00`).getTime() : null;
    const notPastDeparture = depTs === null || depTs > nowTs;
    if (unpaid && notPastDeparture && nowTs - createdTs >= DAY_MS) {
      const dayKey = new Date(nowTs).toISOString().slice(0, 10);
      const key = `payment_due:${b.id}:${dayKey}`;
      if (!alreadySent(data, key)) {
        due.push({
          key,
          rule: 'payment_due',
          label: 'Pengingat pembayaran',
          booking: b,
          text: wa.renderTemplate(t.paymentReminder, { name: b.name }, {
            code: b.code,
            packageName: b.packageName,
            departureDate: b.departureDate,
            link: b.paymentUrl || ''
          })
        });
      }
    }

    // 3. Pengingat keberangkatan (3 hari sebelum berangkat, sudah lunas).
    //    Pakai "<= 3" (bukan tepat 3) supaya tetap terkirim meski server sempat
    //    mati pada hari ke-3 — dedupe kunci memastikan hanya sekali terkirim.
    if (b.paymentStatus === 'paid' && b.departureDate) {
      const daysLeft = Math.ceil((depTs - nowTs) / DAY_MS);
      if (daysLeft <= 3 && daysLeft >= 0) {
        const key = `departure_soon:${b.id}`;
        if (!alreadySent(data, key)) {
          due.push({
            key,
            rule: 'departure_soon',
            label: 'Pengingat keberangkatan',
            booking: b,
            text: wa.renderTemplate(t.departureReminder, { name: b.name }, {
              code: b.code,
              packageName: b.packageName,
              departureDate: b.departureDate
            })
          });
        }
      }
    }

    // 4. Booking sudah dikonfirmasi admin.
    if (b.status === 'confirmed') {
      const key = `booking_confirmed:${b.id}`;
      if (!alreadySent(data, key)) {
        const pkg = (data.packages || []).find((p) => p.slug === b.packageSlug);
        due.push({
          key,
          rule: 'booking_confirmed',
          label: 'Booking terkonfirmasi',
          booking: b,
          text: wa.renderTemplate(t.confirmed, { name: b.name }, {
            code: b.code,
            packageName: b.packageName,
            departureDate: b.departureDate,
            detail: pkg ? String(pkg.summary || pkg.title).slice(0, 200) : ''
          })
        });
      }
    }
  }

  return due;
}


/**
 * Kirim semua pengingat yang jatuh tempo.
 *
 * @param {Date} [now] waktu acuan untuk pengecekan jam tenang (default: sekarang)
 * @returns {Promise<{sent:number,skipped:number,failed:number,details:Array}>} ringkasan
 */
async function runReminders(now) {
  const data = db.read();
  const settings = data.settings || {};
  const summary = { sent: 0, skipped: 0, failed: 0, details: [] };

  if (!wa.canSend()) {
    summary.error = 'WhatsApp belum terhubung.';
    return summary;
  }
  if (wa.isQuietHour(settings, now)) {
    summary.error = `Jam tenang (${wa.quietLabel(settings)}) — pengingat ditunda.`;
    return summary;
  }

  const due = collectDueReminders(data);
  if (!due.length) return summary;

  for (const item of due) {
    const booking = item.booking || {};
    const contact = contactFor(data, booking.phone);
    const phone = wa.normalizePhone(booking.phone);

    // Hanya kirim bila nomor ada di daftar kontak DAN pelanggan mengizinkan
    // pemberitahuan tentang booking-nya (izin transaksional, terpisah dari
    // izin promo). Opt-out selalu menang atas keduanya.
    //
    // `optIn` WAJIB dicek di sini — sama seperti jalur blast
    // (`wa.deliverTo`). Tanpa itu, kontak yang pernah opting-out lalu
    // diaktifkan kembali bisa menerima pengingat tanpa izin promo.
    if (!contact || contact.optOut || !contact.optIn || contact.waNotify === false) {
      summary.skipped += 1;
      summary.details.push({
        key: item.key,
        phone,
        status: 'skipped',
        reason: !contact
          ? 'nomor tidak terdaftar'
          : contact.optOut
            ? 'opted-out'
            : !contact.optIn
              ? 'tidak mengizinkan pesan'
              : 'tidak mengizinkan pemberitahuan'
      });
      continue;
    }

    // Batas pengiriman WA juga berlaku untuk pengingat otomatis.
    // Tanpa cek di sini, pengingat booking akan menembus batas per
    // kontak per hari maupun batas harian global — dua batas yang
    // sengaja dibuat untuk mencegah pesan dianggap spam.
    const capped = wa.checkFrequencyCap(phone, settings);
    const limited = wa.checkDailyLimit(settings);
    if (!capped.allowed || !limited.allowed) {
      const reason = !capped.allowed ? capped.reason : limited.reason;
      summary.skipped += 1;
      summary.details.push({
        key: item.key,
        phone,
        status: 'skipped',
        rule: item.rule,
        reason: `diblokir: ${reason}`
      });
      // Pengingat ini BELUM terkirim, jadi dedupe key TIDAK boleh
      // dicatat — kalau dicatat, pengingat akan hilang selamanya.
      continue;
    }

    try {
      // `sendVia` sudah mencatat pesan sukses ke log kirim (satu jalur
      // pengiriman untuk semua pemicu). Parameter `name` dipakai supaya log
      // menyimpan nama pelanggan, bukan nomor saja.
      //
      // Catatan: pencatatan di `sendVia` inilah yang membuat batas per kontak
      // per hari & batas harian global bisa menghitung pengingat otomatis
      // juga. Tanpa catatan ini, batas tak pernah terpicu untuk pengingat.
      await wa.sendVia(settings, phone, item.text, booking.name);
      markSent(data, item.key, { phone, rule: item.rule });
      db.write();
      summary.sent += 1;
      summary.details.push({ key: item.key, phone, status: 'sent', rule: item.rule });
    } catch (err) {
      // Pengiriman gagal tetap dicatat (sama seperti jalur blast), supaya
      // nomor yang bermasalah tidak diulang terus-menerus dalam satu hari.
      wa.logSend({
        phone,
        name: booking.name,
        status: 'failed',
        error: String((err && err.message) || err).slice(0, 200)
      });
      summary.failed += 1;
      summary.details.push({
        key: item.key,
        phone,
        status: 'failed',
        rule: item.rule,
        error: String((err && err.message) || err).slice(0, 200)
      });
    }

    // Jeda antar pesan agar tidak memicu rate-limit WhatsApp.
    await new Promise((r) => setTimeout(r, wa.MIN_DELAY_MS));
  }

  return summary;
}

/**
 * Ringkasan pengingat untuk dashboard admin (tanpa mengirim).
 */
function preview() {
  const data = db.read();
  const due = collectDueReminders(data);
  const settings = data.settings || {};
  return {
    due,
    quiet: wa.isQuietHour(settings),
    quietLabel: wa.quietLabel(settings),
    ready: wa.canSend(),
    history: dedupeStore(data).slice(0, 20)
  };
}

/** Riwayat pengingat yang sudah terkirim. */
function history() {
  const data = db.read();
  return dedupeStore(data).slice(0, 50);
}

module.exports = { runReminders, preview, collectDueReminders, history, templates };
