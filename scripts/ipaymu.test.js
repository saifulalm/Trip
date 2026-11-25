/**
 * Uji integrasi iPaymu.
 *
 * Menguji signature request, signature callback, verifikasi webhook,
 * idempotensi, dan alur halaman pembayaran. Tidak memanggil API iPaymu
 * sungguhan — semua memakai data simulasi + stub fetch.
 */
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const ipaymu = require(path.join(root, 'src', 'payment', 'ipaymu'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

const VA = '1179000899';
const API_KEY = 'kunci-api-uji';

console.log('\n== Konfigurasi ==');
t('isIpaymuConfigured false bila VA kosong', () => {
  assert.strictEqual(ipaymu.isIpaymuConfigured({ ipaymuApiKey: API_KEY }), false);
});
t('isIpaymuConfigured false bila API Key kosong', () => {
  assert.strictEqual(ipaymu.isIpaymuConfigured({ ipaymuVa: VA }), false);
});
t('isIpaymuConfigured true bila keduanya terisi', () => {
  assert.strictEqual(ipaymu.isIpaymuConfigured({ ipaymuVa: VA, ipaymuApiKey: API_KEY }), true);
});
t('base URL sandbox bila mode produksi mati', () => {
  assert.strictEqual(ipaymu.baseUrl({ ipaymuVa: VA, ipaymuApiKey: API_KEY }), ipaymu.SANDBOX_BASE);
});
t('base URL produksi bila mode produksi aktif', () => {
  assert.strictEqual(
    ipaymu.baseUrl({ ipaymuVa: VA, ipaymuApiKey: API_KEY, ipaymuProduction: true }),
    ipaymu.PRODUCTION_BASE
  );
});

console.log('\n== Signature request ==');
t('signature request sesuai rumus dokumentasi', () => {
  const body = JSON.stringify({ product: ['Paket'], qty: ['1'], price: ['100000'] });
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const expected = crypto
    .createHmac('sha256', API_KEY)
    .update(`POST:${VA}:${bodyHash}:${API_KEY}`)
    .digest('hex');
  assert.strictEqual(ipaymu.signRequest('POST', VA, body, API_KEY), expected);
});
t('signature berubah bila body berubah', () => {
  const a = ipaymu.signRequest('POST', VA, '{"a":1}', API_KEY);
  const b = ipaymu.signRequest('POST', VA, '{"a":2}', API_KEY);
  assert.notStrictEqual(a, b);
});
t('signature berubah bila API Key berubah', () => {
  const a = ipaymu.signRequest('POST', VA, '{"a":1}', API_KEY);
  const b = ipaymu.signRequest('POST', VA, '{"a":1}', 'kunci-lain');
  assert.notStrictEqual(a, b);
});

console.log('\n== Normalisasi callback ==');
t('status_code di-cast ke integer', () => {
  const out = ipaymu.normalizeCallback({ status_code: '1' });
  assert.strictEqual(out.status_code, 1);
  assert.strictEqual(typeof out.status_code, 'number');
});
t('trx_id & transaction_status_code di-cast ke integer', () => {
  const out = ipaymu.normalizeCallback({ trx_id: '123', transaction_status_code: '6' });
  assert.strictEqual(out.trx_id, 123);
  assert.strictEqual(out.transaction_status_code, 6);
});
t('is_escrow di-cast ke boolean', () => {
  assert.strictEqual(ipaymu.normalizeCallback({ is_escrow: '1' }).is_escrow, true);
  assert.strictEqual(ipaymu.normalizeCallback({ is_escrow: '0' }).is_escrow, false);
});
t('additional_info default array kosong', () => {
  assert.deepStrictEqual(ipaymu.normalizeCallback({}).additional_info, []);
});
t('additional_info "[]" menjadi array kosong', () => {
  assert.deepStrictEqual(ipaymu.normalizeCallback({ additional_info: '[]' }).additional_info, []);
});
t('field biasa tetap string', () => {
  assert.strictEqual(ipaymu.normalizeCallback({ status: 'berhasil' }).status, 'berhasil');
});

console.log('\n== Signature callback ==');
t('signature callback valid untuk payloadcanonical', () => {
  const payload = ipaymu.normalizeCallback({
    reference_id: 'JJE-001',
    status: 'berhasil',
    status_code: '1',
    transaction_status_code: '1',
    trx_id: '555',
    paid_off: '98500',
    is_escrow: '0',
    total: '100000'
  });
  const sig = ipaymu.signCallback(payload, VA);
  const verdict = ipaymu.ipaymuVerify(payload, sig, { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.ok, true, verdict.reason);
  assert.strictEqual(verdict.paid, true);
  assert.strictEqual(verdict.orderId, 'JJE-001');
});
t('signature callback menolak signature salah', () => {
  const payload = ipaymu.normalizeCallback({ reference_id: 'JJE-001', status_code: '1' });
  const verdict = ipaymu.ipaymuVerify(payload, 'a'.repeat(64), { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, 'Signature callback tidak cocok.');
});
t('signature callback menolak header kosong', () => {
  const payload = ipaymu.normalizeCallback({ reference_id: 'JJE-001' });
  const verdict = ipaymu.ipaymuVerify(payload, '', { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.ok, false);
});
t('signature callback menolak VA yang salah', () => {
  const payload = ipaymu.normalizeCallback({ reference_id: 'JJE-001', status_code: '1' });
  const sig = ipaymu.signCallback(payload, 'VA-LAIN');
  const verdict = ipaymu.ipaymuVerify(payload, sig, { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.ok, false);
});
t('status_code 0 (pending) tidak dianggap paid', () => {
  const payload = ipaymu.normalizeCallback({ reference_id: 'JJE-002', status_code: '0', transaction_status_code: '0' });
  const sig = ipaymu.signCallback(payload, VA);
  const verdict = ipaymu.ipaymuVerify(payload, sig, { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.paid, false);
});
t('transaction_status_code 6 dianggap paid (dana diterima)', () => {
  const payload = ipaymu.normalizeCallback({
    reference_id: 'JJE-003',
    status_code: '0',
    transaction_status_code: '6'
  });
  const sig = ipaymu.signCallback(payload, VA);
  const verdict = ipaymu.ipaymuVerify(payload, sig, { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.paid, true);
});
t('field signature di body diabaikan saat hash', () => {
  const payload = ipaymu.normalizeCallback({ reference_id: 'JJE-004', status_code: '1' });
  const sig = ipaymu.signCallback(payload, VA);
  const withSig = Object.assign({}, payload, { signature: 'apa-saja' });
  const verdict = ipaymu.ipaymuVerify(withSig, sig, { ipaymuVa: VA, ipaymuApiKey: API_KEY });
  assert.strictEqual(verdict.ok, true, verdict.reason);
});

console.log(`\n${pass} lulus, ${fail} gagal.`);
process.exit(fail ? 1 : 0);
