'use strict';

const fs = require('fs');
const path = require('path');

// Muat .env manual agar tanpa dependensi tambahan.
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const { ensureSeed } = require('./src/seed');
ensureSeed();

const { createApp } = require('./src/app');
const BRAND = require('./src/brand');
const app = createApp();

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  if (!process.env.SESSION_SECRET) {
    console.log('  ⚠️  SESSION_SECRET belum diset → sesi login tidak bertahan setelah server restart.');
  }
  console.log(`\n  ${BRAND.domain} berjalan di http://localhost:${PORT}`);
  console.log(`  Admin panel          : http://localhost:${PORT}/admin`);
  console.log(`  Login admin (default) : admin / admin123\n`);
});