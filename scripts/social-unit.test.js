'use strict';
/**
 * Uji unit untuk service media sosial (src/services/social.js) dan
 * client Postiz (src/services/postiz.js).
 *
 * Suite ini tidak butuh server yang hidup — murni unit test.
 */
const assert = require('assert');
const social = require('../src/services/social');
const postiz = require('../src/services/postiz');

let pass = 0;
let fail = 0;

function test(label, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + label);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + label + ' — ' + err.message);
  }
}

/* ---------------- social.js ---------------- */

test('registry memuat platform utama (IG, FB, Threads, TikTok, YT)', () => {
  const keys = social.listPlatforms().map((p) => p.key);
  ['instagram', 'facebook', 'threads', 'tiktok', 'youtube'].forEach((k) => {
    assert.ok(keys.includes(k), 'platform ' + k + ' hilang');
  });
});

test('setiap platform punya key, slug, label, color, glyph, identifier', () => {
  social.listPlatforms().forEach((p) => {
    assert.ok(p.key, 'key kosong');
    assert.ok(p.slug, 'slug kosong pada ' + p.key);
    assert.ok(p.label, 'label kosong pada ' + p.key);
    assert.ok(/^#[0-9a-f]{6}$/i.test(p.color), 'color tidak valid pada ' + p.key + ': ' + p.color);
    assert.ok(p.glyph, 'glyph kosong pada ' + p.key);
    assert.ok(p.identifier, 'identifier kosong pada ' + p.key);
  });
});

test('getPlatform mencari tanpa regards case dan menolak key asing', () => {
  assert.strictEqual(social.getPlatform('Instagram').key, 'instagram');
  assert.strictEqual(social.getPlatform('  THREADS ').key, 'threads');
  assert.strictEqual(social.getPlatform('tiktok-g Douyin'), null);
});

test('normalizeUrl menambahkan https dan membuang spasi', () => {
  assert.strictEqual(social.normalizeUrl('instagram.com/jje'), 'https://instagram.com/jje');
  assert.strictEqual(social.normalizeUrl('  https://x.com/a  '), 'https://x.com/a');
  assert.strictEqual(social.normalizeUrl(''), '');
});

test('normalizeUrl menebak Instagram dari handle berawalan @', () => {
  assert.strictEqual(social.normalizeUrl('@jalanjalanenak'), 'https://instagram.com/jalanjalanenak');
});

test('profileLinks hanya mengembalikan tautan yang terisi', () => {
  const links = social.profileLinks({
    instagram: 'https://instagram.com/a',
    facebook: '',
    threads: 'https://threads.net/@b'
  });
  assert.strictEqual(links.length, 2);
  assert.deepStrictEqual(links.map((l) => l.key).sort(), ['instagram', 'threads']);
});

test('sameAsUrls mengembalikan URL untuk structured data SEO', () => {
  const urls = social.sameAsUrls({ instagram: 'https://instagram.com/a' });
  assert.deepStrictEqual(urls, ['https://instagram.com/a']);
});

test('handleFromUrl mengambil segment terakhir', () => {
  assert.strictEqual(social.handleFromUrl('https://instagram.com/jalanjalanenak'), 'jalanjalanenak');
  assert.strictEqual(social.handleFromUrl('https://threads.net/@jje'), 'jje');
  assert.strictEqual(social.handleFromUrl(''), '');
});

test('settingsFields mencakup seluruh slug + konfigurasi Postiz', () => {
  const fields = social.settingsFields();
  assert.ok(fields.includes('instagram'));
  assert.ok(fields.includes('threads'));
  assert.ok(fields.includes('postizBaseUrl'));
  assert.ok(fields.includes('postizApiKey'));
  // Tidak boleh ada duplikat.
  assert.strictEqual(new Set(fields).size, fields.length);
});

test('normalizeSettings hanya mengubah field yang dikirim', () => {
  const out = social.normalizeSettings({ instagram: 'instagram.com/a' }, { facebook: 'https://fb.com/b' });
  assert.strictEqual(out.instagram, 'https://instagram.com/a');
  assert.strictEqual(out.facebook, undefined, 'field yang tidak dikirim ikut berubah');
});

test('normalizeSettings membersihkan trailing slash pada base URL Postiz', () => {
  const out = social.normalizeSettings({ postizBaseUrl: 'https://postiz.example.com///' }, {});
  assert.strictEqual(out.postizBaseUrl, 'https://postiz.example.com');
});

/* ---------------- postiz.js ---------------- */

test('normalizeBaseUrl menambahkan suffix /api/public/v1', () => {
  const url = postiz.normalizeBaseUrl('https://postiz.example.com');
  assert.ok(url.endsWith('/api/public/v1'), 'suffix hilang: ' + url);
});

test('normalizeBaseUrl tidak menggandakan suffix yang sudah ada', () => {
  const url = postiz.normalizeBaseUrl('https://postiz.example.com/api/public/v1');
  assert.strictEqual(url.match(/\/api\/public\/v1/g).length, 1);
});

test('normalizeBaseUrl menambahkan skema bila admin hanya menulis domain', () => {
  assert.ok(postiz.normalizeBaseUrl('postiz.example.com').startsWith('https://'));
});

test('config tidak aktif bila API key kosong', () => {
  const cfg = postiz.config({ postizBaseUrl: 'https://postiz.example.com', postizApiKey: '' });
  assert.strictEqual(cfg.enabled, false);
});

test('config aktif bila base URL dan API key terisi', () => {
  const cfg = postiz.config({ postizBaseUrl: 'https://postiz.example.com', postizApiKey: 'kuncisaya' });
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.apiKey, 'kuncisaya');
});

test('request tidak melakukan panggilan jaringan bila belum dikonfigurasi', async () => {
  const res = await postiz.request('/integrations', { settings: {} });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 0);
  assert.ok(res.error && res.error.length > 0);
});

test('buildSettings mengisi __type dan field wajib per platform', () => {
  // Instagram wajib post_type.
  const ig = postiz.buildSettings({ __type: 'instagram', content: 'halo' });
  assert.strictEqual(ig.__type, 'instagram');
  assert.strictEqual(ig.post_type, 'post');

  // Story harus.post_type = story.
  const igStory = postiz.buildSettings({ __type: 'instagram', postType: 'story' });
  assert.strictEqual(igStory.post_type, 'story');

  // TikTok punya banyak field wajib.
  const tt = postiz.buildSettings({ __type: 'tiktok' });
  assert.strictEqual(tt.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.ok('content_posting_method' in tt);

  // YouTube wajib title + type.
  const yt = postiz.buildSettings({ __type: 'youtube', content: 'Videocordial' });
  assert.strictEqual(yt.type, 'public');
  assert.ok(yt.title && yt.title.length >= 2);

  // Threads cukup __type.
  assert.deepStrictEqual(postiz.buildSettings({ __type: 'threads' }), { __type: 'threads' });
});

test('buildSettings membiarkan override manual menang', () => {
  const s = postiz.buildSettings({ __type: 'instagram', settings: { post_type: 'reel' } });
  assert.strictEqual(s.post_type, 'reel');
});

test('analytics menolak tanpa id integrasi (path lama /analytics/platform tidak ada)', async () => {
  const res = await postiz.analytics({}, '');
  assert.strictEqual(res.ok, false);
  assert.ok(/ID integrasi/i.test(res.error), res.error);
});

test('createPost menolak tanpa kanal tujuan', async () => {
  const res = await postiz.createPost({ channels: [], type: 'now' }, {});
  assert.strictEqual(res.ok, false);
  assert.ok(res.error && res.error.length > 0);
});

/* ---------------- Ringkasan ---------------- */

console.log(`\n${pass} lulus, ${fail} gagal.`);
process.exit(fail === 0 ? 0 : 1);
