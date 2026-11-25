'use strict';

/**
 * Client Postiz Public REST API.
 *
 * Postiz (https://github.com/gitroomhq/postiz-app, lisensi AGPL-3.0) adalah
 * scheduler media sosial open-source yang bisa di-host sendiri. Versi
 * open-sourcenya menyediakan 34 platform (Instagram, Facebook, Threads, X,
 * LinkedIn, TikTok, YouTube, Pinterest, Reddit, Bluesky, Mastodon, ...).
 *
 * Dokumentasi API: https://docs.postiz.com/public-api
 *
 * Semua request memakai header `Authorization: <api-key>` TANPA prefiks
 * "Bearer" — API key Postiz dikirim mentah (dokumentasi resmi + kode
 * middleware PublicAuthMiddleware di repo postiz-app).
 *
 * Bentuk base URL resmi ada dua:
 * - Postiz Cloud : https://api.postiz.com/public/v1
 * - Self-hosted  : https://{domain}/api/public/v1
 * Karena itu `normalizeBaseUrl` hanya menambahkan `/api/public/v1` bila URL
 * belum berakhiran `/public/v1`.
 *
 * Endpoint create-post dibatasi 90 request/jam (100 untuk Postiz Cloud).
 *
 * Modul ini TIDAK melakukan request apa pun bila konfigurasi belum diisi,
 * sehingga admin bisa menyimpan pengaturan tanpa server Postiz aktif.
 */

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'http://localhost:4200/api/public/v1';
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * Normalisasi URL dasar Postiz: buang garis miring di akhir & lengkapi
 * suffix base API bila admin hanya menulis domain.
 *
 * Postiz punya dua bentuk base URL resmi (lihat `servers` di OpenAPI):
 * - Self-hosted : https://{domain}/api/public/v1
 * - Postiz Cloud: https://api.postiz.com/public/v1  (TANPA segmen "api")
 *
 * Jadi suffix yang ditambahkan bergantung pada host:
 * - host api.postiz.com  -> ditambahkan `/public/v1`
 * - host lain           -> ditambahkan `/api/public/v1`
 *
 * URL yang sudah memuat `/public/v1` dibiarkan apa adanya.
 *
 * @param {string} value URL dasar dari settings
 * @returns {string} URL dasar yang siap pakai
 */
function normalizeBaseUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  raw = raw.replace(/\/+$/, '');
  // Sudah menyebut base API Postiz -> jangan diubah lagi.
  if (/\/public\/v1$/i.test(raw)) return raw;
  // Postiz Cloud memakai path `/public/v1`, self-hosted memakai `/api/public/v1`.
  const isCloud = /^https?:\/\/api\.postiz\.com$/i.test(raw);
  return isCloud ? `${raw}/public/v1` : `${raw}/api/public/v1`;
}

/**
 * Ambil konfigurasi Postiz dari settings.
 * @param {object} settings data settings
 * @returns {{baseUrl:string, apiKey:string, enabled:boolean}}
 */
function config(settings = {}) {
  const baseUrl = normalizeBaseUrl(settings.postizBaseUrl || process.env.POSTIZ_BASE_URL || DEFAULT_BASE_URL);
  const apiKey = String(settings.postizApiKey || process.env.POSTIZ_API_KEY || '').trim();
  return { baseUrl, apiKey, enabled: Boolean(baseUrl && apiKey) };
}

/**
 * Request JSON ke Postiz.
 *
 * @param {string} path path relatif, mis. '/integrations'
 * @param {object} options {method, body, baseUrl, apiKey, timeout}
 * @returns {Promise<{ok:boolean, status:number, data:any, error:string|null}>}
 */
async function request(path, options = {}) {
  const cfg = options.baseUrl && options.apiKey
    ? { baseUrl: options.baseUrl, apiKey: options.apiKey }
    : config(options.settings || {});
  if (!cfg.baseUrl || !cfg.apiKey) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'Postiz belum dikonfigurasi. Isi URL API & API Key di menu Integrasi Media Sosial.'
    };
  }
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Header Content-Type hanya boleh diisi untuk body JSON. Request multipart
  // (upload media) harus membiarkan Node yang mengatur batas multipart sendiri,
  // karena header manual akan membuat body tidak terbaca.
  const headers = {
    Authorization: cfg.apiKey,
    Accept: 'application/json'
  };
  if (options.body) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (err) {
        data = text;
      }
    }
    if (!res.ok) {
      // Postiz (NestJS) mengirim beberapa bentuk error:
      // - { statusCode, message: 'teks', error: 'Bad Request' }
      // - { statusCode, message: { msg: 'teks' } }  (HttpException dengan objek)
      // - { msg: 'No API Key found' }               (middleware autentikasi)
      // Jadi pesan dirangkai dari `message` (string/array), `msg`, lalu `error`.
      const raw = data && typeof data === 'object' ? data : null;
      let message = '';
      if (raw) {
        if (typeof raw.message === 'string') message = raw.message;
        else if (Array.isArray(raw.message)) message = raw.message.filter(Boolean).join(', ');
        else if (raw.message && typeof raw.message === 'object' && typeof raw.message.msg === 'string') {
          message = raw.message.msg;
        }
        if (!message && typeof raw.msg === 'string') message = raw.msg;
        if (!message && typeof raw.error === 'string') message = raw.error;
      }
      return { ok: false, status: res.status, data, error: message || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? 'Waktu tunggu habis saat menghubungi Postiz.'
      : String((err && err.message) || err);
    return { ok: false, status: 0, data: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Daftar kanal (integration) yang sudah terhubung.
 *
 * Endpoint resmi: GET /integrations (opsional query `group` = id customer).
 * Response berupa ARRAY objek { id, name, identifier, picture, disabled,
 * profile, customer }. `identifier` adalah id platform (mis. "x",
 * "instagram") yang dipakai sebagai `settings.__type` saat membuat post.
 *
 * @param {object} settings data settings
 * @returns {Promise<{ok:boolean, status:number, integrations:object[], error:string|null}>}
 */
async function listIntegrations(settings = {}) {
  const res = await request('/integrations', { settings });
  if (!res.ok) return { ok: false, status: res.status, integrations: [], error: res.error };
  const list = Array.isArray(res.data) ? res.data : (res.data && res.data.integrations) || [];
  return { ok: true, status: res.status, integrations: list, error: null };
}

/**
 * Ambil URL OAuth untuk menghubungkan kanal baru.
 *
 * Endpoint resmi: GET /social/{integration}
 * - {integration} adalah id platform (mis. 'x', 'linkedin', 'facebook'),
 *   BUKAN id integrasi. Query opsional `refresh` = id integrasi yang ada,
 *   untuk memperbarui token OAuth alih-alih membuat koneksi baru.
 * - Response: { "url": "https://.../oauth2/authorize?..." }
 * - Hanya berlaku untuk integrasi berbasis OAuth. Integrasi yang butuh
 *   URL eksternal (mis. Mastodon) ditolak dengan 400.
 *
 * @param {string} identifier identifier platform Postiz, mis. 'instagram'
 * @param {object} settings data settings
 * @returns {Promise<{ok:boolean, url:string|null, error:string|null}>}
 */
async function oauthUrl(identifier, settings = {}) {
  const res = await request(`/social/${encodeURIComponent(identifier)}`, { settings });
  if (!res.ok) return { ok: false, url: null, error: res.error };
  // Field resmi bernama `url`; `redirectUrl` hanya dipakai sebagai fallback
  // untuk instance lama.
  const url = (res.data && (res.data.url || res.data.redirectUrl)) || null;
  return { ok: true, url, error: url ? null : 'Postiz tidak mengembalikan URL OAuth.' };
}

/**
 * Bangun objek `settings` untuk satu kanal.
 *
 * Setiap platform punya skema settings sendiri dan `settings.__type` WAJIB
 * diisi sesuai provider. Sebagian platform mensyaratkan field tambahan
 * (lihat dokumentasi "Provider Settings" / DTO class-validator di repo
 * postiz-app):
 *
 * - x             : who_can_reply_post (wajib)
 * - instagram     : post_type (wajib)
 * - tiktok        : privacy_level, duet, stitch, comment, autoAddMusic,
 *                   brand_content_toggle, brand_organic_toggle,
 *                   content_posting_method (semua wajib)
 * - youtube       : title, type (wajib)
 * - pinterest     : board (wajib), reddit/lemmy: subreddit[] (wajib)
 * - facebook      : url (opsional), post_type (opsional)
 * - threads, mastodon, bluesky, telegram, nostr, vk: cukup __type
 *
 * Nilai bawaan di bawah memakai default yang direkomendasikan dokumen.
 * Field yang tidak bisa ditebak (mis. `board` Pinterest atau `subreddit`
 * Reddit) TIDAK dikarang — biarkan Postiz mengembalikan 400 yang jelas.
 * Field khusus per kanal tetap bisa dioverride lewat `ch.settings`.
 *
 * @param {object} ch kanal tujuan
 * @returns {object} objek settings
 */
function buildSettings(ch = {}) {
  const type = ch.__type || 'facebook';
  const settingsObj = { __type: type };

  if (type === 'x') {
    // Wajib untuk post biasa (diabaikan bila post_type = 'article').
    settingsObj.who_can_reply_post = 'everyone';
  }
  if (type === 'instagram' || type === 'instagram-standalone') {
    // post_type wajib untuk Instagram.
    settingsObj.post_type = ch.postType === 'story' ? 'story' : 'post';
    settingsObj.is_trial_reel = false;
    settingsObj.collaborators = [];
  }
  if (type === 'facebook') {
    settingsObj.post_type = ch.postType === 'story' ? 'story' : 'post';
    if (ch.link) settingsObj.url = ch.link;
  }
  if (type === 'linkedin' || type === 'linkedin-page') {
    settingsObj.post_as_images_carousel = false;
  }
  if (type === 'tiktok' || type === 'tiktok-business') {
    // Semua field ini wajib ada oleh DTO TikTok (meski sebagian diabaikan
    // TikTok saat content_posting_method = 'UPLOAD').
    settingsObj.privacy_level = 'PUBLIC_TO_EVERYONE';
    settingsObj.duet = false;
    settingsObj.stitch = false;
    settingsObj.comment = true;
    settingsObj.autoAddMusic = 'no';
    settingsObj.brand_content_toggle = false;
    settingsObj.brand_organic_toggle = false;
    settingsObj.content_posting_method = 'DIRECT_POST';
  }
  if (type === 'reddit' || type === 'lemmy') {
    // Reddit mewajibkan array `subreddit` minimal 1. Nilai tidak bisa ditebak,
    // jadi admin WAJIB mengisinya lewat form (ch.settings.subreddit).
    const subs = Array.isArray(ch.settings && ch.settings.subreddit)
      ? ch.settings.subreddit
      : [];
    if (subs.length) {
      settingsObj.subreddit = subs;
    }
  }
  if (type === 'pinterest') {
    // Pinterest mewajibkan `board` (ID board). Kalau tidak diisi, Postiz
    // menjawab 400 — biarkan supaya pesan errornya jelas.
    const board = String((ch.settings && ch.settings.board) || ch.board || '').trim();
    if (board) settingsObj.board = board;
    if (ch.link) settingsObj.link = ch.link;
  }
  if (type === 'youtube') {
    // title (2-100 karakter) & type wajib. Judul diambil dari konten bila
    // kanal tidak menyediakannya sendiri.
    const title = String(ch.title || ch.content || '').trim().slice(0, 100);
    settingsObj.title = title.length >= 2 ? title : 'Untitled';
    settingsObj.type = 'public';
    settingsObj.selfDeclaredMadeForKids = 'no';
  }

  // Override manual per kanal selalu menang atas nilai bawaan.
  if (ch.settings && typeof ch.settings === 'object') {
    Object.assign(settingsObj, ch.settings);
  }
  return settingsObj;
}

/**
 * Buat post (terbit sekarang / jadwal / draf).
 *
 * Bentuk payload mengikuti dokumentasi resmi Postiz:
 * {
 *   type: 'now' | 'schedule' | 'draft',
 *   date: ISO string,
 *   shortLink: boolean,
 *   tags: [],
 *   posts: [{ integration: {id}, value: [{content, image:[{id,path}]}], settings: {__type} }]
 * }
 *
 * Field `type`, `date`, `shortLink`, dan `tags` bersifat wajib; `posts` wajib
 * kecuali type = 'draft'. `image` berupa array objek {id, path} (hasil
 * upload via POST /upload), bukan base64 inline.
 *
 * @param {object} params {channels:[{integrationId, __type, content, images:[], link}], type, date}
 * @param {object} settings data settings
 * @returns {Promise<{ok:boolean, postIds:string[], error:string|null}>}
 */
async function createPost(params = {}, settings = {}) {
  const channels = Array.isArray(params.channels) ? params.channels.filter(Boolean) : [];
  if (!channels.length) {
    return { ok: false, postIds: [], error: 'Pilih minimal satu kanal tujuan.' };
  }
  const type = ['now', 'schedule', 'draft'].includes(params.type) ? params.type : 'now';
  const date = params.date ? new Date(params.date).toISOString() : new Date().toISOString();

  const posts = channels.map((ch) => {
    const settingsObj = buildSettings(ch);
    const images = (ch.images || []).map((img, i) => ({
      id: img.id || `img-${i + 1}`,
      path: img.path || img
    }));
    return {
      integration: { id: ch.integrationId },
      value: [{ content: String(ch.content || ''), image: images }],
      settings: settingsObj
    };
  });

  const body = { type, date, shortLink: false, tags: [], posts };
  const res = await request('/posts', { method: 'POST', body, settings });
  if (!res.ok) return { ok: false, postIds: [], error: res.error };
  const list = Array.isArray(res.data) ? res.data : [];
  const postIds = list.map((x) => x.postId).filter(Boolean);
  return { ok: true, postIds, error: null };
}

/**
 * Ambil daftar post terjadwal (untuk kalender sederhana).
 *
 * Endpoint resmi: GET /posts?startDate=...&endDate=...
 * - `startDate` & `endDate` WAJIB diisi dengan format ISO UTC.
 * - Query opsional `customer` = id customer untuk memfilter.
 * - Response: { "posts": [ { id, content, settings, publishDate,
 *   releaseURL, state, error, integration: {...} } ] }
 *
 * @param {object} settings data settings
 * @param {string} startDate ISO date mulai
 * @param {string} endDate ISO date selesai
 * @returns {Promise<{ok:boolean, posts:object[], error:string|null}>}
 */
async function listPosts(settings = {}, startDate, endDate) {
  const from = startDate || new Date(Date.now() - 7 * 86400000).toISOString();
  const to = endDate || new Date(Date.now() + 30 * 86400000).toISOString();
  const res = await request(`/posts?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`, { settings });
  if (!res.ok) return { ok: false, posts: [], error: res.error };
  const list = Array.isArray(res.data) ? res.data : (res.data && res.data.posts) || [];
  return { ok: true, posts: list, error: null };
}

/**
 * Ambil daftar grup (customer) dari Postiz.
 *
 * Endpoint resmi: GET /groups → array { id, name }. Berguna bila Postiz
 * dipakai multi-tenant (satu instance, beberapa organisasi).
 *
 * @param {object} settings data settings
 * @returns {Promise<{ok:boolean, groups:object[], error:string|null}>}
 */
async function listGroups(settings = {}) {
  const res = await request('/groups', { settings });
  if (!res.ok) return { ok: false, groups: [], error: res.error };
  const list = Array.isArray(res.data) ? res.data : (res.data && res.data.groups) || [];
  return { ok: true, groups: list, error: null };
}

/**
 * Cek apakah API key valid dan terhubung ke workspace Postiz.
 *
 * Endpoint resmi: GET /is-connected → { connected: boolean }.
 * Dipakai untuk membedakan "API key salah" dari "Postiz mati".
 *
 * @param {object} settings data settings
 * @returns {Promise<{ok:boolean, connected:boolean, error:string|null}>}
 */
async function isConnected(settings = {}) {
  const res = await request('/is-connected', { settings });
  if (!res.ok) return { ok: false, connected: false, error: res.error };
  const connected = Boolean(res.data && res.data.connected);
  return { ok: true, connected, error: null };
}

/**
 * Ambil detail workspace yang dipakai API key.
 *
 * Endpoint resmi: GET /me → { organization: { id, name }, user }.
 *
 * @param {object} settings data settings
 * @returns {Promise<{ok:boolean, organization:object|null, user:object|null, error:string|null}>}
 */
async function whoAmI(settings = {}) {
  const res = await request('/me', { settings });
  if (!res.ok) return { ok: false, organization: null, user: null, error: res.error };
  const organization = (res.data && res.data.organization) || null;
  const user = (res.data && res.data.user) || null;
  return { ok: true, organization, user, error: null };
}

/**
 * Buat "connect link" Postiz untuk menghubungkan kanal baru.
 *
 * Endpoint resmi: POST /integrations/connect dengan body
 * { integration: 'instagram', redirectUrl?: 'https://...' } → { url }.
 *
 * Bedanya dengan GET /social/{identifier}:
 *  - GET  : langsung ke halaman OAuth provider, butuh konfigurasi OAuth di Postiz.
 *  - POST : ke halaman "connect" milik Postiz (link berlaku 1 jam), orang
 *           yang membuka link tidak perlu akun Postiz. Ini jalur yang lebih
 *           andal untuk self-hosted dan jadi fallback utama.
 *
 * @param {string} identifier identifier platform Postiz
 * @param {object} settings data settings
 * @param {string} redirectUrl tujuan setelah kanal terhubung
 * @returns {Promise<{ok:boolean, url:string|null, error:string|null}>}
 */
async function connectLink(identifier, settings = {}, redirectUrl = '') {
  const id = String(identifier || '').trim();
  if (!id) return { ok: false, url: null, error: 'Platform tidak dikenal.' };
  const body = { integration: id };
  if (redirectUrl) body.redirectUrl = redirectUrl;
  const res = await request('/integrations/connect', { method: 'POST', body, settings });
  if (!res.ok) return { ok: false, url: null, error: res.error };
  const url = (res.data && res.data.url) || null;
  return { ok: true, url, error: url ? null : 'Postiz tidak mengembalikan URL connect.' };
}

/**
 * Putuskan kanal (integration) yang terhubung.
 *
 * Endpoint resmi: DELETE /integrations/{id}. Post yang terjadwal untuk kanal
 * tersebut ikut terhapus (dokumentasi Postiz).
 *
 * @param {object} settings data settings
 * @param {string} integrationId id integrasi
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
async function deleteIntegration(settings = {}, integrationId) {
  const id = String(integrationId || '').trim();
  if (!id) return { ok: false, error: 'ID kanal tidak valid.' };
  const res = await request(`/integrations/${encodeURIComponent(id)}`, { method: 'DELETE', settings });
  // 404 = sudah tidak ada → perlakukan sebagai berhasil (idempoten).
  if (res.status === 404) return { ok: true, error: null };
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, error: null };
}

/**
 * Hapus satu post (draf/terjadwal) dari Postiz.
 *
 * Endpoint resmi: DELETE /posts/{id}.
 *
 * @param {object} settings data settings
 * @param {string} postId id post
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
async function deletePost(settings = {}, postId) {
  const id = String(postId || '').trim();
  if (!id) return { ok: false, error: 'ID post tidak valid.' };
  const res = await request(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE', settings });
  if (res.status === 404) return { ok: true, error: null };
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, error: null };
}

/**
 * Ubah status post antara draf dan terjadwal.
 *
 * Endpoint resmi: PUT /posts/{id}/status dengan body { status: 'draft' | 'schedule' }.
 * - 'schedule' → state QUEUE, workflow publish dijalankan ulang.
 * - 'draft'    → state DRAFT, workflow publish dihentikan.
 *
 * @param {object} settings data settings
 * @param {string} postId id post
 * @param {string} status 'draft' | 'schedule'
 * @returns {Promise<{ok:boolean, state:string|null, error:string|null}>}
 */
async function setPostStatus(settings = {}, postId, status) {
  const id = String(postId || '').trim();
  const mode = status === 'schedule' ? 'schedule' : 'draft';
  if (!id) return { ok: false, state: null, error: 'ID post tidak valid.' };
  const res = await request(`/posts/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: { status: mode },
    settings
  });
  if (!res.ok) return { ok: false, state: null, error: res.error };
  return { ok: true, state: (res.data && res.data.state) || null, error: null };
}

/**
 * Ambil aturan publikasi & batas panjang konten untuk satu kanal.
 *
 * Endpoint resmi: GET /integration-settings/{id} → { output: { rules, maxLength,
 * settings, tools } }. Dipakai untuk memberi tahu admin batas karakter
 * platform (mis. X 280, Instagram 2200) sebelum mengirim.
 *
 * @param {object} settings data settings
 * @param {string} integrationId id integrasi
 * @returns {Promise<{ok:boolean, rules:string, maxLength:number|null, error:string|null}>}
 */
async function integrationSettings(settings = {}, integrationId) {
  const id = String(integrationId || '').trim();
  if (!id) return { ok: false, rules: '', maxLength: null, error: 'ID kanal tidak valid.' };
  const res = await request(`/integration-settings/${encodeURIComponent(id)}`, { settings });
  if (!res.ok) return { ok: false, rules: '', maxLength: null, error: res.error };
  const out = (res.data && res.data.output) || {};
  return {
    ok: true,
    rules: String(out.rules || ''),
    maxLength: Number.isFinite(out.maxLength) ? out.maxLength : null,
    error: null
  };
}

/**
 * Unggah berkas media ke Postiz.
 *
 * Endpoint resmi: POST /upload (multipart/form-data, field `file`).
 * Response: { id, name, path, status } — `id` + `path` inilah yang dipakai
 * pada payload post (`value[].image[]`).
 *
 * Catatan: body dikirim apa adanya (Buffer), bukan di-stringify JSON.
 *
 * @param {object} settings data settings
 * @param {Buffer} buffer isi berkas
 * @param {string} filename nama berkas (untuk header Content-Type)
 * @param {string} mimeType tipe MIME berkas
 * @returns {Promise<{ok:boolean, media:object|null, error:string|null}>}
 */
async function uploadMedia(settings = {}, buffer, filename = 'media.bin', mimeType = 'application/octet-stream') {
  if (!buffer || !buffer.length) return { ok: false, media: null, error: 'Berkas kosong.' };

  const cfg = config(settings);
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { ok: false, media: null, error: 'Postiz belum dikonfigurasi.' };
  }

  // Bentuk multipart secara manual supaya tidak perlu dependensi tambahan.
  const boundary = '----sabesi' + crypto.randomBytes(12).toString('hex');
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), buffer, Buffer.from(tail, 'utf8')]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${cfg.baseUrl}/upload`, {
      method: 'POST',
      headers: {
        Authorization: cfg.apiKey,
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body,
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
    if (!res.ok) {
      const message = (data && (data.message || data.error || data.msg)) || `HTTP ${res.status}`;
      return { ok: false, media: null, error: String(message) };
    }
    if (!data || !data.id || !data.path) {
      return { ok: false, media: null, error: 'Postiz tidak mengembalikan id/path media.' };
    }
    return {
      ok: true,
      media: { id: data.id, name: data.name || filename, path: data.path, status: data.status || 'ready' },
      error: null
    };
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? 'Waktu tunggu habis saat mengunggah media ke Postiz.'
      : String((err && err.message) || err);
    return { ok: false, media: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ambil statistik publik untuk satu kanal (integration).
 *
 * Endpoint resmi: GET /analytics/{integration}?date={jumlah hari}
 * - {integration} WAJIB berisi `id` integrasi (UUID) dari GET /integrations,
 *   BUKAN `__type` platform (mis. "x") dan bukan nama tampilan kanal.
 *   Mengirim `__type` menghasilkan 400 "Invalid integration".
 * - Parameter query `date` (jumlah hari ke belakang, mis. 7/30/90) wajib.
 *
 * Catatan: path lama `/analytics/platform` TIDAK ada di API Postiz
 * (backend memakai route `@Get('/analytics/:integration')`), sehingga
 * request tersebut selalu gagal dengan 400.
 *
 * @param {object} settings data settings
 * @param {string} integrationId id integrasi (dari GET /integrations)
 * @param {number|string} days jumlah hari ke belakang
 * @returns {Promise<{ok:boolean, stats:object[], error:string|null}>}
 */
async function analytics(settings = {}, integrationId, days = 7) {
  const id = String(integrationId || '').trim();
  if (!id) {
    return { ok: false, stats: [], error: 'ID integrasi diperlukan untuk mengambil analytics.' };
  }
  const range = String(days || 7).trim();
  const res = await request(`/analytics/${encodeURIComponent(id)}?date=${encodeURIComponent(range)}`, { settings });
  if (!res.ok) return { ok: false, stats: [], error: res.error };
  const list = Array.isArray(res.data) ? res.data : (res.data && res.data.analytics) || [];
  return { ok: true, stats: list, error: null };
}

module.exports = {
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  config,
  request,
  listIntegrations,
  listGroups,
  isConnected,
  whoAmI,
  oauthUrl,
  connectLink,
  deleteIntegration,
  deletePost,
  setPostStatus,
  integrationSettings,
  uploadMedia,
  buildSettings,
  createPost,
  listPosts,
  analytics
};
