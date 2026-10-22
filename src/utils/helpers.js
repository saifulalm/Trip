'use strict';

/** Kumpulan helper kecil yang dipakai di route dan template. */

function formatRupiah(value) {
  const n = Number(value || 0);
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function formatDateLong(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

function excerpt(text, len = 150) {
  const clean = String(text || '')
    .replace(/^##\s.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= len) return clean;
  return `${clean.slice(0, len).trimEnd()}…`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render teks artikel sederhana menjadi HTML yang aman.
 * Format: paragraf dipisah baris kosong, "## Judul" menjadi heading,
 * **tebal** menjadi <strong>.
 */
function renderRichText(text) {
  const blocks = String(text || '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      if (block.startsWith('## ')) {
        return `<h3>${escapeHtml(block.slice(3)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</h3>`;
      }
      const html = escapeHtml(block).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `<p>${html.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

const BOOKING_STATUS = {
  pending: { label: 'Menunggu', tone: 'pending' },
  confirmed: { label: 'Dikonfirmasi', tone: 'confirmed' },
  completed: { label: 'Selesai', tone: 'completed' },
  cancelled: { label: 'Dibatalkan', tone: 'cancelled' }
};

function bookingStatusLabel(status) {
  return (BOOKING_STATUS[status] || BOOKING_STATUS.pending).label;
}

function bookingStatusTone(status) {
  return (BOOKING_STATUS[status] || BOOKING_STATUS.pending).tone;
}

const PUBLICATION_STATUS = {
  published: { label: 'Terbit', tone: 'confirmed' },
  draft: { label: 'Draf', tone: 'pending' }
};

function publicationStatusLabel(status) {
  return (PUBLICATION_STATUS[status] || PUBLICATION_STATUS.draft).label;
}

function publicationStatusTone(status) {
  return (PUBLICATION_STATUS[status] || PUBLICATION_STATUS.draft).tone;
}

/** Paginasi sederhana untuk daftar admin/publik. */
function paginate(items, pageRaw, perPage = 10) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  let page = parseInt(pageRaw, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (page > pages) page = pages;
  const start = (page - 1) * perPage;
  return {
    rows: items.slice(start, start + perPage),
    page,
    pages,
    total,
    perPage,
    hasPrev: page > 1,
    hasNext: page < pages,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + perPage, total)
  };
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isPhone(value) {
  const digits = String(value || '').replace(/[\s\-().]/g, '');
  return /^(\+?62|0)\d{7,13}$/.test(digits);
}

const PAYMENT_STATUS = {
  unpaid: { label: 'Belum Bayar', tone: 'pending' },
  waiting_confirmation: { label: 'Menunggu Verifikasi', tone: 'pending' },
  paid: { label: 'Lunas', tone: 'confirmed' },
  rejected: { label: 'Ditolak', tone: 'cancelled' },
  expired: { label: 'Kedaluwarsa', tone: 'cancelled' }
};

function paymentStatusLabel(status) {
  return (PAYMENT_STATUS[status] || PAYMENT_STATUS.unpaid).label;
}

function paymentStatusTone(status) {
  return (PAYMENT_STATUS[status] || PAYMENT_STATUS.unpaid).tone;
}

function starRating(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  formatRupiah,
  formatDateLong,
  formatDateShort,
  initials,
  excerpt,
  escapeHtml,
  renderRichText,
  BOOKING_STATUS,
  bookingStatusLabel,
  bookingStatusTone,
  publicationStatusLabel,
  publicationStatusTone,
  paginate,
  isEmail,
  isPhone,
  PAYMENT_STATUS,
  paymentStatusLabel,
  paymentStatusTone,
  starRating,
  tomorrowISO
};