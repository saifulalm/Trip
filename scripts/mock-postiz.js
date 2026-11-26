'use strict';
/**
 * Mock server Postiz Public REST API untuk verifikasi integrasi media sosial.
 *
 * Menyediakan endpoint yang dipakai kode produksi:
 *   GET  /api/public/v1/is-connected
 *   GET  /api/public/v1/me
 *   GET  /api/public/v1/integrations
 *   POST /api/public/v1/integrations/connect
 *   GET  /api/public/v1/social/:identifier
 *   GET  /api/public/v1/posts
 *   POST /api/public/v1/posts
 *   POST /api/public/v1/upload
 *   DELETE /api/public/v1/integrations/:id
 *   DELETE /api/public/v1/posts/:id
 *   PUT  /api/public/v1/posts/:id/status
 *
 * Header Authorization harus berisi API key mentah (tanpa "Bearer") —
 * kalau tidak, mock menjawab 401 supaya alur diagnostik teruji.
 */
const http = require('http');

const API_KEY = process.env.MOCK_POSTIZ_KEY || 'kunci-uji-123';
const BASE = '/api/public/v1';

const integrations = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Sear You Later Trip',
    identifier: 'instagram',
    picture: '',
    profile: '@ujiv2',
    disabled: false
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Sear You Later Trip',
    identifier: 'facebook',
    picture: '',
    profile: 'seayoulatertrip',
    disabled: false
  }
];

const posts = [
  {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    content: 'Paket 3 hari 2 malam ke Pulau Rinca',
    settings: { __type: 'instagram' },
    publishDate: new Date(Date.now() + 86400000).toISOString(),
    releaseURL: 'https://instagram.com/p/uji',
    state: 'QUEUE',
    error: null,
    integration: { id: integrations[0].id, name: 'Sear You Later Trip', identifier: 'instagram' }
  },
  {
    id: 'bbbbbbbb-2222-2222-2222-222222222222',
    content: 'Fotoakisi dari trip sebelumnya',
    settings: { __type: 'facebook' },
    publishDate: new Date(Date.now() - 86400000).toISOString(),
    releaseURL: '',
    state: 'PUBLISHED',
    error: null,
    integration: { id: integrations[1].id, name: 'Sear You Later Trip', identifier: 'facebook' }
  },
  {
    id: 'cccccccc-3333-3333-3333-333333333333',
    content: 'Draf pengumuman_wraca',
    settings: { __type: 'facebook' },
    publishDate: new Date().toISOString(),
    releaseURL: '',
    state: 'DRAFT',
    error: null,
    integration: { id: integrations[1].id, name: 'Sear You Later Trip', identifier: 'facebook' }
  },
  {
    id: 'dddddddd-4444-4444-4444-444444444444',
    content: 'Post yang gagal terbit',
    settings: { __type: 'instagram' },
    publishDate: new Date().toISOString(),
    releaseURL: '',
    state: 'ERROR',
    error: 'Instagram API rate limit exceeded',
    integration: { id: integrations[0].id, name: 'Sear You Later Trip', identifier: 'instagram' }
  }
];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/** Catatan request — dipakai skrip verifikasi untuk memeriksa payload. */
const requestLog = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const auth = req.headers.authorization || '';

  // Endpoint khusus log (di luar base API, tanpa syarat auth).
  if (path === '/__requests') {
    return send(res, 200, { requests: requestLog });
  }

  console.log('[mock-postiz] ' + req.method + ' ' + path + ' auth=' + (auth ? 'ada' : 'TIDAK ADA'));
  requestLog.push({ method: req.method, path, auth: Boolean(auth) });

  if (!path.startsWith(BASE)) return send(res, 404, { message: 'not found' });

  // Semua endpoint mensyaratkan API key mentah.
  if (auth !== API_KEY) {
    return send(res, 401, { statusCode: 401, message: 'No API Key found' });
  }

  const rest = path.slice(BASE.length);

  if (rest === '/is-connected') return send(res, 200, { connected: true });
  if (rest === '/me') {
    return send(res, 200, {
      organization: { id: 'org-1', name: 'Sear You Later Trip' },
      user: { id: 'user-1', name: 'Admin' }
    });
  }
  if (rest === '/groups') return send(res, 200, [{ id: 'default', name: 'Default' }]);
  if (rest === '/integrations' && req.method === 'GET') return send(res, 200, integrations);

  if (rest === '/integrations/connect' && req.method === 'POST') {
    return send(res, 201, { url: 'https://provider.example.com/oauth/authorize?state=uji' });
  }

  if (rest.startsWith('/social/') && req.method === 'GET') {
    const id = decodeURIComponent(rest.slice('/social/'.length));
    if (id === 'mastodon') {
      return send(res, 400, { statusCode: 400, message: 'Mastodon requires an instance URL' });
    }
    return send(res, 200, { url: 'https://provider.example.com/oauth/' + id });
  }

  if (rest.startsWith('/integrations/') && req.method === 'DELETE') {
    return send(res, 200, { success: true });
  }

  if (rest === '/posts' && req.method === 'GET') {
    return send(res, 200, { posts });
  }

  if (rest === '/posts' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let payload = null;
      try { payload = JSON.parse(raw || '{}'); } catch (err) { payload = null; }
      const imgs = (((payload && payload.posts) || []).map((p) => (p.value && p.value[0] && p.value[0].image) || []))
        .reduce((a, b) => a + b.length, 0);
      const summary = {
        type: payload && payload.type,
        date: payload && payload.date,
        postCount: ((payload && payload.posts) || []).length,
        imageCount: imgs,
        settings: ((payload && payload.posts) || []).map((p) => p.settings)
      };
      requestLog.push({ method: 'POST', path: '/posts#payload', auth: true, summary });
      console.log('[mock-postiz] createPost ' + JSON.stringify(summary));
      return send(res, 201, [{ postId: 'post-uji-1' }]);
    });
    return;
  }

  if (rest.endsWith('/status') && req.method === 'PUT') {
    return send(res, 200, { state: 'DRAFT' });
  }

  if (rest.startsWith('/posts/') && req.method === 'DELETE') {
    return send(res, 200, { success: true });
  }

  if (rest === '/upload' && req.method === 'POST') {
    // Buang body; Postiz balikin descriptor media.
    req.on('data', () => {});
    req.on('end', () => {
      return send(res, 201, {
        id: 'media-uji-1',
        name: 'media-uji.webp',
        path: '/uploads/media-uji.webp',
        status: 'ready'
      });
    });
    return;
  }

  if (rest.startsWith('/integration-settings/') && req.method === 'GET') {
    return send(res, 200, { output: { rules: '', maxLength: 2200, settings: {}, tools: [] } });
  }

  return send(res, 404, { statusCode: 404, message: 'Unknown endpoint ' + rest });
});

const port = Number(process.env.MOCK_POSTIZ_PORT) || 4250;
server.listen(port, '127.0.0.1', () => {
  console.log('[mock-postiz] berjalan di http://127.0.0.1:' + port + BASE);
});
