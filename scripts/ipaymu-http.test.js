/**
 * Uji integrasi HTTP iPaymu: alur halaman pembayaran + webhook.
 *
 * Menguji:
 *  - halaman /pembayaran/:code merender tombol iPaymu saat terkonfigurasi,
 *  - POST /pembayaran/:code/bayar membuat transaksi & mengarahkan ke
 *    checkout iPaymu (fetch di-stub),
 *  - webhook menolak signature salah (403),
 *  - webhook menandai booking lunas & mengonfirmasi status booking,
 *  - webhook bersifat idempoten (notifikasi ulang tidak menimpa).
 */
const http = require('http');
const path = require('path');

// Basis data terisolasi — WAJIB di-require sebelum `src/db` supaya
// `data/db.json` produksi tidak pernah tersentuh oleh uji ini.
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));
const ipaymu = require(path.join(root, 'src', 'payment', 'ipaymu'));
const { createApp } = require(path.join(root, 'src', 'app'));

const VA = '1179000899';
const API_KEY = 'kunci-api-uji';

// Basis data uji sudah terpisah (lihat `test-db`) — `data/db.json`
// produksi tidak pernah disentuh, jadi tidak ada backup yang perlu disimpan.

db.reset({
  users: [],
  destinations: [],
  packages: [{ slug: 'p1', title: 'Paket Sabesi', price: 1500000, status: 'published' }],
  articles: [],
  bookings: [
    {
      id: 'b1',
      code: 'JJE-001',
      name: 'Budi',
      email: 'budi@contoh.com',
      phone: '081234560001',
      packageSlug: 'p1',
      packageName: 'Paket Sabesi',
      departureDate: '2026-12-01',
      participants: 2,
      packagePrice: 1500000,
      totalAmount: 3000000,
      status: 'pending',
      paymentStatus: 'unpaid',
      paymentMethod: null,
      paymentRef: null,
      paymentUrl: null,
      createdAt: new Date().toISOString()
    }
  ],
  messages: [],
  contacts: [],
  customers: [],
  reviews: [],
  broadcasts: [],
  waReminders: [],
  settings: {
    siteName: 'Uji iPaymu',
    whatsapp: '628123456789',
    ipaymuVa: VA,
    ipaymuApiKey: API_KEY,
    ipaymuProduction: false
  },
  version: 1
});

const app = createApp();
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

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

let cookies = '';
function capture(res) {
  const set = res.headers['set-cookie'];
  if (set) cookies = set.map((c) => c.split(';')[0]).join('; ');
}

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  PASS  ' + name);
  } else {
    fail += 1;
    console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : ''));
  }
}

(async () => {
  // Stub fetch global supaya tidak memanggil API iPaymu sungguhan.
  const realFetch = global.fetch;
  let capturedRequest = null;
  global.fetch = async (url, options) => {
    capturedRequest = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        Status: 200,
        Message: 'success',
        Data: {
          SessionID: 'SESSION-UUID-1234',
          Url: 'https://sandbox.ipaymu.com/payment/SESSION-UUID-1234'
        }
      })
    };
  };

  try {
    // --- Halaman pembayaran -------------------------------------------
    const page = await req('/pembayaran/JJE-001');
    capture(page);
    check('halaman pembayaran -> 200', page.status === 200, 'status ' + page.status);
    check('halaman memuat tombol iPaymu', page.body.includes('iPaymu'));
    check('halaman tidak lagi memuat transfer manual', !page.body.includes('Transfer ke'));
    check('halaman tidak lagi menampilkan rekening', !page.body.includes('No. Rekening'));

    // --- Buat transaksi ------------------------------------------------
    // Pakang CSRF dari halaman yang sama dengan cookie session di atas.
    const csrf = (page.body.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await req('/pembayaran/JJE-001/bayar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
      body: new URLSearchParams({ _csrf: csrf }).toString()
    });
    check('POST bayar -> redirect (302)', res.status === 302, 'status ' + res.status);
    check(
      'redirect ke checkout iPaymu',
      String(res.headers.location || '').includes('sandbox.ipaymu.com/payment/'),
      res.headers.location
    );
    check('request dikirim ke endpoint /api/v2/payment', capturedRequest && capturedRequest.url.endsWith('/api/v2/payment'), capturedRequest && capturedRequest.url);
    check('header va terkirim', capturedRequest && capturedRequest.options.headers.va === VA);
    check('header signature terkirim (64 hex)', capturedRequest && /^[0-9a-f]{64}$/.test(capturedRequest.options.headers.signature));
    check('header timestamp 14 digit terkirim', capturedRequest && /^\d{14}$/.test(capturedRequest.options.headers.timestamp));

    const afterCreate = db.read().bookings.find((b) => b.code === 'JJE-001');
    check('booking.paymentMethod = ipaymu', afterCreate.paymentMethod === 'ipaymu', afterCreate.paymentMethod);
    check('booking.paymentUrl tersimpan', Boolean(afterCreate.paymentUrl));
    check('booking.paymentStatus = pending', afterCreate.paymentStatus === 'pending', afterCreate.paymentStatus);

    // --- Webhook: signature salah --------------------------------------
    const bad = await req('/payment/webhook/ipaymu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Signature': 'a'.repeat(64) },
      body: new URLSearchParams({ reference_id: 'JJE-001', status_code: '1' }).toString()
    });
    check('webhook signature salah -> 403', bad.status === 403, 'status ' + bad.status);
    const stillUnpaid = db.read().bookings.find((b) => b.code === 'JJE-001');
    check('booking tetap belum lunas setelah signature salah', stillUnpaid.paymentStatus !== 'paid');

    // --- Webhook: signature benar --------------------------------------
    const payload = ipaymu.normalizeCallback({
      reference_id: 'JJE-001',
      status: 'berhasil',
      status_code: '1',
      transaction_status_code: '1',
      trx_id: '999',
      paid_off: '1485000',
      is_escrow: '0',
      total: '3000000'
    });
    const sig = ipaymu.signCallback(payload, VA);
    const ok = await req('/payment/webhook/ipaymu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Signature': sig },
      body: new URLSearchParams(payload).toString()
    });
    check('webhook signature benar -> 200', ok.status === 200, 'status ' + ok.status + ' ' + ok.body);

    const paid = db.read().bookings.find((b) => b.code === 'JJE-001');
    check('booking menjadi lunas', paid.paymentStatus === 'paid', paid.paymentStatus);
    check('booking.status menjadi confirmed', paid.status === 'confirmed', paid.status);
    check('booking.paidAt terisi', Boolean(paid.paidAt));
    check('booking.paymentGatewayRaw gateway = ipaymu', paid.paymentGatewayRaw && paid.paymentGatewayRaw.gateway === 'ipaymu');

    // --- Webhook: idempoten -------------------------------------------
    const again = await req('/payment/webhook/ipaymu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Signature': sig },
      body: new URLSearchParams(payload).toString()
    });
    check('webhook kedua -> 200 (idempoten)', again.status === 200, 'status ' + again.status);
    check('webhook kedua tidak menggandakan paidAt', db.read().bookings.find((b) => b.code === 'JJE-001').paidAt === paid.paidAt);

    // --- Webhook: order tidak dikenal ---------------------------------
    const unknownPayload = ipaymu.normalizeCallback({ reference_id: 'JJE-999', status_code: '1' });
    const unknownSig = ipaymu.signCallback(unknownPayload, VA);
    const unknown = await req('/payment/webhook/ipaymu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Signature': unknownSig },
      body: new URLSearchParams(unknownPayload).toString()
    });
    check('webhook order tidak dikenal -> 404', unknown.status === 404, 'status ' + unknown.status);

    // --- Halaman pembayaran setelah lunas -----------------------------
    const paidPage = await req('/pembayaran/JJE-001');
    check('halaman lunas menampilkan konfirmasi', paidPage.body.includes('Pembayaran lunas'));
    check('halaman lunas tidak menampilkan tombol bayar', !paidPage.body.includes('Bayar Sekarang via iPaymu'));
  } finally {
    global.fetch = realFetch;
    server.close();
  }

  console.log(`\n${pass} lulus, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  try { server.close(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
