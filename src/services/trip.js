'use strict';

/**
 * Pembantu penyusunan data "trip" untuk portal pelanggan & admin.
 *
 * MASALAH HISTORIS (perbaiki 2026-11):
 * booking menyimpan `packageSlug` (slug PAKET), sedangkan koordinat
 * ada di tabel `destinations` yang dirujuk paket lewat
 * `destinationSlug`. Kode lama membandingkan `booking.packageSlug`
 * langsung dengan `d.slug` → hasilnya SELALU null → peta selalu kosong
 * dan check-in tidak punya titik acuan.
 *
 * Modul ini menyediakan resolusi yang benar:
 *   booking.packageSlug → packages[].destinationSlug → destinations[]
 */

const geo = require('./geo');

/**
 * Cari paket berdasarkan slug.
 */
function findPackage(data, slug) {
  return (data.packages || []).find((p) => p.slug === slug) || null;
}

/**
 * Resolusi relasi paket → destinasi. Menangani data lama yang
 * mungkin menyimpan `destinationSlug` langsung di dalam booking.
 */
function resolveDestination(data, booking) {
  if (!booking) return null;
  const dests = data.destinations || [];

  // 1) Booking lama: field destinationSlug tersimpan langsung.
  if (booking.destinationSlug) {
    const direct = dests.find((d) => d.slug === booking.destinationSlug);
    if (direct) return direct;
  }

  // 2) Paket yang cocok → destinationSlug.
  const pkg = findPackage(data, booking.packageSlug);
  if (pkg) {
    const viaPkg = dests.find((d) => d.slug === pkg.destinationSlug);
    if (viaPkg) return viaPkg;
  }

  // 3) Fallback terakhir: nama destinasi yang tersimpan di booking.
  if (booking.destinationName) {
    const byName = dests.find((d) => d.name === booking.destinationName);
    if (byName) return byName;
  }
  return null;
}

/**
 * Jarak (meter) dari titik check-in pelanggan ke titik destinasi.
 * Mengembalikan null bila salah satu titik tidak ada / tidak valid.
 */
function distanceToDestination(booking, destination) {
  if (!booking || !booking.checkIn || !destination) return null;
  const d = geo.haversineMeters(
    booking.checkIn.lat,
    booking.checkIn.lng,
    destination.lat,
    destination.lng
  );
  return Number.isFinite(d) ? d : null;
}

/**
 * Tahap-tahap progress booking untuk stepper timeline.
 * Mengembalikan daftar { key, label, done, active, hint }.
 */
function progressSteps(booking) {
  const status = booking && booking.status ? booking.status : 'pending';
  const paid = booking && booking.paymentStatus === 'paid';
  const checkedIn = !!(booking && booking.checkIn);
  const steps = [
    {
      key: 'created',
      label: 'Booking Dibuat',
      hint: booking && booking.createdAt ? booking.createdAt : '',
      done: true
    },
    {
      key: 'paid',
      label: 'Pembayaran',
      hint: paid ? 'Lunas' : 'Menunggu pembayaran',
      done: paid,
      active: !paid
    },
    {
      key: 'confirmed',
      label: 'Konfirmasi Admin',
      hint: status === 'pending' ? 'Menunggu konfirmasi' : 'Dikonfirmasi',
      done: status !== 'pending' && status !== 'cancelled',
      active: status === 'pending'
    },
    {
      key: 'checkin',
      label: 'Check-in GPS',
      hint: checkedIn ? 'Tercatat di titik kumpul' : 'Pada hari keberangkatan',
      done: checkedIn,
      active: !checkedIn && (status === 'confirmed' || status === 'pending')
    },
    {
      key: 'completed',
      label: 'Trip Selesai',
      hint: status === 'completed' ? 'Selesai' : 'Setelah trip berakhir',
      done: status === 'completed',
      active: status === 'confirmed'
    },
    {
      key: 'review',
      label: 'Ulasan',
      hint: status === 'completed' ? 'Bagikan pengalaman' : 'Tersedia setelah trip selesai',
      done: false,
      active: status === 'completed'
    }
  ];

  if (status === 'cancelled') {
    return steps.map((s) => ({ ...s, done: false, active: false, cancelled: true }));
  }
  return steps;
}

/**
 * Ringkasan KPI untuk dasbor pelanggan.
 */
function dashboardSummary(bookings, reviews) {
  const list = bookings || [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  let upcoming = 0;
  let completed = 0;
  let unpaid = 0;
  let totalPaid = 0;
  let nextDeparture = null;

  list.forEach((b) => {
    if (b.status === 'completed') completed += 1;
    if (b.paymentStatus === 'paid') totalPaid += Number(b.totalAmount || 0);
    else if (b.status !== 'cancelled') unpaid += 1;
    if (
      b.departureDate &&
      b.departureDate >= today &&
      b.status !== 'cancelled' &&
      (!nextDeparture || b.departureDate < nextDeparture.departureDate)
    ) {
      nextDeparture = b;
    }
  });

  const upcomingCount = list.filter(
    (b) => b.departureDate && b.departureDate >= today && b.status !== 'cancelled'
  ).length;

  return {
    total: list.length,
    upcoming: upcomingCount,
    completed,
    unpaid,
    totalPaid,
    nextDeparture,
    reviewCount: (reviews || []).length
  };
}

module.exports = {
  findPackage,
  resolveDestination,
  distanceToDestination,
  progressSteps,
  dashboardSummary
};
