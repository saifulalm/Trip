'use strict';

/**
 * Registry media sosial.
 *
 * Satu sumber kebenaran untuk:
 *  - daftar platform yang didukung (ikon, warna merek, identifier Postiz),
 *  - tautan profil publik per platform (ditampilkan di footer situs + SEO),
 *  - pemetaan identifier Postiz -> platform untuk status koneksi.
 *
 * Semua platform yang didukung berasal dari Postiz (AGPL-3.0, self-hosted)
 * yangoffers 34 platform: Instagram, Facebook, Threads, X, LinkedIn, TikTok,
 * YouTube, Pinterest, Telegram, Reddit, Bluesky, Mastodon, dst.
 */

/**
 * Definisi platform.
 *
 * `identifier` = nilai `identifier` integrasi di Postiz.
 * `oauth`      = true bila platform bisa dihubungkan lewat OAuth Postiz
 *                (endpoint GET /public/v1/social/{identifier}).
 * `slug`       = kunci field pada settings untuk tautan profil publik.
 */
const PLATFORMS = [
  {
    key: 'instagram',
    slug: 'instagram',
    label: 'Instagram',
    identifier: 'instagram',
    color: '#E1306C',
    glyph: 'IG',
    oauth: true,
    urlPattern: 'https://instagram.com/{handle}',
    desc: 'Feed foto & reels untuk konten promosi.',
    maxLength: 2200,
    media: true,
    note: 'Story hanya boleh satu gambar.'
  },
  {
    key: 'facebook',
    slug: 'facebook',
    label: 'Facebook',
    identifier: 'facebook',
    color: '#1877F2',
    glyph: 'f',
    oauth: true,
    urlPattern: 'https://facebook.com/{handle}',
    desc: 'Facebook Page untuk promosi paket & pengumuman.',
    maxLength: 63206,
    media: true
  },
  {
    key: 'threads',
    slug: 'threads',
    label: 'Threads',
    identifier: 'threads',
    color: '#111111',
    glyph: '@',
    oauth: true,
    urlPattern: 'https://threads.net/@{handle}',
    desc: 'Diskusi singkat & pembaruan cepat harian.',
    maxLength: 500,
    media: true
  },
  {
    key: 'twitter',
    slug: 'twitter',
    label: 'X (Twitter)',
    identifier: 'x',
    color: '#000000',
    glyph: 'X',
    oauth: true,
    urlPattern: 'https://x.com/{handle}',
    desc: 'Kabar terbaru & cuitan promosi singkat.',
    maxLength: 280,
    media: true
  },
  {
    key: 'linkedin',
    slug: 'linkedin',
    label: 'LinkedIn',
    identifier: 'linkedin',
    color: '#0A66C2',
    glyph: 'in',
    oauth: true,
    urlPattern: 'https://linkedin.com/company/{handle}',
    desc: 'Profil bisnis untuk acomodasi & kemitraan.',
    maxLength: 3000,
    media: true
  },
  {
    key: 'tiktok',
    slug: 'tiktok',
    label: 'TikTok',
    identifier: 'tiktok',
    color: '#010101',
    glyph: '♪',
    oauth: true,
    urlPattern: 'https://tiktok.com/@{handle}',
    desc: 'Video pendek untuk reels & stories.',
    maxLength: 2200,
    media: true,
    note: 'Butuh media (video/foto) agar algoritma menjangkau audiens.'
  },
  {
    key: 'youtube',
    slug: 'youtube',
    label: 'YouTube',
    identifier: 'youtube',
    color: '#FF0000',
    glyph: '▶',
    oauth: true,
    urlPattern: 'https://youtube.com/@{handle}',
    desc: 'Vlog perjalanan & dokumentasi lengkap.',
    maxLength: 5000,
    media: true
  },
  {
    key: 'pinterest',
    slug: 'pinterest',
    label: 'Pinterest',
    identifier: 'pinterest',
    color: '#E60023',
    glyph: 'P',
    oauth: true,
    urlPattern: 'https://pinterest.com/{handle}',
    desc: 'Moodboard ide & koleksi foto.',
    maxLength: 500,
    media: true,
    requires: 'board',
    note: 'Wajib memilih board tujuan saat menulis konten.'
  },
  {
    key: 'telegram',
    slug: 'telegram',
    label: 'Telegram',
    identifier: 'telegram',
    color: '#26A5E4',
    glyph: '✈',
    oauth: true,
    urlPattern: 'https://t.me/{handle}',
    desc: 'Kanal announcements & pengingat cepat.',
    maxLength: 4096,
    media: true
  },
  {
    key: 'reddit',
    slug: 'reddit',
    label: 'Reddit',
    identifier: 'reddit',
    color: '#FF4500',
    glyph: 'r/',
    oauth: true,
    urlPattern: 'https://reddit.com/u/{handle}',
    desc: 'Komunitas travelers untuk testimonial & tips.',
    maxLength: 40000,
    media: true,
    requires: 'subreddit',
    note: 'Wajib memilih subreddit tujuan saat menulis konten.'
  },
  {
    key: 'bluesky',
    slug: 'bluesky',
    label: 'Bluesky',
    identifier: 'bluesky',
    color: '#0085FF',
    glyph: 'b',
    oauth: true,
    urlPattern: 'https://bsky.app/profile/{handle}',
    desc: 'Jaringan baru tanpa algoritma.',
    maxLength: 300,
    media: true
  },
  {
    key: 'mastodon',
    slug: 'mastodon',
    label: 'Mastodon',
    identifier: 'mastodon',
    color: '#6364FF',
    glyph: 'm',
    oauth: false,
    urlPattern: 'https://{handle}',
    desc: 'Terbuka & ter-desentralisasi (hubungkan lewat Postiz UI).',
    maxLength: 500,
    media: true
  }
];

/** Platform yang tautan profilnya ditampilkan di situs publik. */
const PROFILE_PLATFORMS = PLATFORMS.filter((p) => p.slug);

/**
 * Ambil definisi platform berdasarkan key.
 * @param {string} key kunci platform
 * @returns {object|null} definisi platform
 */
function getPlatform(key) {
  const k = String(key || '').trim().toLowerCase();
  return PLATFORMS.find((p) => p.key === k) || null;
}

/**
 * Cari platform berdasarkan identifier Postiz.
 *
 * `identifier` integrasi Postiz tidak selalu sama dengan `key` registry
 * (mis. registry key "twitter" memakai identifier "x"). Route composer
 * memakai fungsi ini untuk memetakan id integrasi ke metadata platform.
 *
 * @param {string} identifier identifier Postiz
 * @returns {object|null} definisi platform
 */
function getPlatformByIdentifier(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return null;
  return PLATFORMS.find((p) => p.identifier === id) || null;
}

/**
 * Semua platform (urutan tampilan).
 * @returns {object[]}
 */
function listPlatforms() {
  return PLATFORMS.slice();
}

/**
 * Normalisasi URL profil: buang spasi, tambahkan https:// bila perlu.
 * @param {string} value nilai mentah dari form
 * @returns {string} URL ternormalisasi (string kosong bila tidak diisi)
 */
function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('@')) return `https://instagram.com/${raw.replace(/^@/, '')}`;
  if (raw.startsWith('www.')) return `https://${raw}`;
  return `https://${raw}`;
}

/**
 * Ambil tautan profil yang sudah terisi dari settings.
 * @param {object} settings data settings
 * @returns {object[]} daftar {key,label,url,color,glyph,slug}
 */
function profileLinks(settings = {}) {
  return PROFILE_PLATFORMS.map((p) => ({
    key: p.key,
    slug: p.slug,
    label: p.label,
    color: p.color,
    glyph: p.glyph,
    url: normalizeUrl(settings[p.slug])
  })).filter((x) => x.url);
}

/**
 * Ambil handle/username dari URL profil.
 * Dipakai untuk pratinjau label "@handle" di panel admin.
 * @param {string} url URL profil
 * @returns {string} handle tanpa '@' (string kosong bila tidak bisa ditebak)
 */
function handleFromUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  const parts = clean.replace(/\/+$/, '').split('/');
  const last = parts[parts.length - 1] || '';
  if (!last || last === 'instagram.com' || last === 'facebook.com') return '';
  return last.replace(/^@/, '');
}

/**
 * Ambil daftar field settings milik kelompok media sosial.
 * Dipakai route Pengaturan agar form "Social" tidak menimpa field lain.
 * @returns {string[]}
 */
function settingsFields() {
  return PROFILE_PLATFORMS.map((p) => p.slug).concat(['postizBaseUrl', 'postizApiKey']);
}

/**
 * Normalisasi nilai settings media sosial (URL profil + konfigurasi Postiz).
 * @param {object} body body request
 * @param {object} settings settings lama
 * @returns {object} objek baru untuk di-merge ke settings
 */
function normalizeSettings(body = {}, settings = {}) {
  const out = {};
  PROFILE_PLATFORMS.forEach((p) => {
    if (body[p.slug] === undefined) return;
    out[p.slug] = normalizeUrl(body[p.slug]);
  });
  if (body.postizBaseUrl !== undefined) {
    out.postizBaseUrl = String(body.postizBaseUrl || '').trim().replace(/\/+$/, '');
  }
  if (body.postizApiKey !== undefined) {
    out.postizApiKey = String(body.postizApiKey || '').trim();
  }
  return out;
}

/**
 * Daftar tautan profil untuk structured data SEO (sameAs).
 * @param {object} settings data settings
 * @returns {string[]} URL profil
 */
function sameAsUrls(settings = {}) {
  return profileLinks(settings).map((x) => x.url);
}

/**
 * Metadata status post untuk tampilan riwayat.
 *
 * Nilai `state` resmi Postiz adalah: QUEUE | PUBLISHED | ERROR | DRAFT.
 * Versi lama memakai 'draft'/'failed' (huruf kecil) sehingga DRAFT & QUEUE
 * selalu salah badge. Fungsi ini menjadi sumber kebenaran tunggal.
 *
 * @param {string} state state dari Postiz
 * @returns {{label:string, tone:string, key:string}}
 */
function postStateMeta(state) {
  const raw = String(state || '').trim().toUpperCase();
  switch (raw) {
    case 'PUBLISHED':
      return { key: 'published', label: 'Terbit', tone: 'confirmed' };
    case 'QUEUE':
      return { key: 'queued', label: 'Terjadwal', tone: 'completed' };
    case 'ERROR':
      return { key: 'error', label: 'Gagal', tone: 'cancelled' };
    case 'DRAFT':
      return { key: 'draft', label: 'Draf', tone: 'pending' };
    default:
      // State tak dikenal (API lama / platform lain) → tetap tampil apa adanya
      // supaya admin tidak salah mengira post itu "berhasil".
      return { key: raw ? 'unknown' : 'unknown', label: raw || 'Tidak diketahui', tone: 'pending' };
  }
}

/**
 * Keterangan field tambahan yang wajib diisi per platform.
 *
 * Postiz mewajibkan `board` (Pinterest) dan `subreddit[]` (Reddit). Tanpa
 * itu, POST /posts selalu dijawab 400 — jadi UI wajib memperingatkan lebih
 * dulu sebelum admin menekan tombol kirim.
 *
 * @param {string} identifier identifier platform Postiz
 * @returns {{key:string, label:string, type:string}|null}
 */
function requiredField(identifier) {
  const p = getPlatformByIdentifier(identifier);
  if (!p || !p.requires) return null;
  if (p.requires === 'board') {
    return { key: 'board', label: 'Board Pinterest', type: 'text', hint: 'ID board, mis. "123456789"' };
  }
  if (p.requires === 'subreddit') {
    return { key: 'subreddit', label: 'Subreddit', type: 'text', hint: 'Nama subreddit tanpa r/, mis. "IndonesiaTravel"' };
  }
  return null;
}

module.exports = {
  PLATFORMS,
  PROFILE_PLATFORMS,
  getPlatform,
  getPlatformByIdentifier,
  listPlatforms,
  normalizeUrl,
  profileLinks,
  handleFromUrl,
  settingsFields,
  normalizeSettings,
  sameAsUrls,
  postStateMeta,
  requiredField
};
