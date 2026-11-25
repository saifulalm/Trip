/**
 * Menjalankan seluruh suite uji WhatsApp.
 * Dipakai lewat: npm test
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dir = __dirname;
const suites = [
  'wa-check.js',
  'wa-gateway.test.js',
  'wa-unit.test.js',
  'wa-worker.test.js',
  'wa-loop.test.js',
  'wa-reminder.test.js',
  'wa-http.test.js',
  'verify-openwa-webhook.js',
  'ipaymu.test.js',
  'ipaymu-http.test.js',
  'social-unit.test.js',
  'geo-trip.test.js',
  'upload-spec.test.js',
  'gallery-upload.test.js',
  'presence.test.js',
  'hero-mode.test.js',
  'admin-sprite.test.js'
];

let failed = 0;
for (const s of suites) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`);
  const r = spawnSync(process.execPath, [path.join(dir, s)], {
    stdio: 'inherit',
    cwd: path.join(dir, '..')
  });
  if (r.status !== 0) failed += 1;
}

console.log(`\n${'='.repeat(60)}`);
console.log(failed ? `${failed} suite gagal.` : 'Semua suite lulus.');
process.exit(failed ? 1 : 0);
