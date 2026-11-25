'use strict';

/**
 * Runner uji end-to-end: menyalakan server di folder data uji terisolasi,
 * menjalankan skrip verifikasi, lalu mematikan server.
 *
 * Kenapa perlu:
 *   Skrip E2E (wa-e2e, portal) menguji lewat HTTP terhadap server yang
 *   benar-benar hidup. Kalau server itu memakai `data/db.json` produksi,
 *   pengujian menulis job blast, booking uji, dan ([[mungkin]]) menghapus
 *   akun pelanggan — persis yang merusak data produksi di sesi sebelumnya.
 *
 *   Di sini server anak memakai folder data sementara yang sama dengan
 *   skrip verifikasi, jadi data produksi tidak pernah tersentuh.
 *
 * Jalankan:
 *   node scripts/run-e2e.js wa-e2e
 *   node scripts/run-e2e.js portal
 *   node scripts/run-e2e.js all
 *
 * PENTING: env yang diteruskan ke server anak & skrip verifikasi WAJIB
 * memuat SEMUA nama variabel port yang dipakai skrip itu (mis. `PORT`
 * sekaligus `VERIFY_PORT`). Kalau satu nama lupa, skrip memakai port
 * bawaannya sendiri → membaca server LAMA (bukan server uji) → hasil
 * GAGAL palsu.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

/**
 * @typedef {object} E2EConfig
 * @property {string} script nama file skrip verifikasi
 * @property {number} port port server uji
 * @property {string[]} [portVars] nama env yang menunjuk ke port uji
 * @property {number} [timeoutMs] batas waktu total
 * @property {boolean} [needsBrowser] true bila skrip memakai Puppeteer
 */

/** @type {Record<string, E2EConfig>} */
const TARGETS = {
  'wa-e2e': {
    script: 'verify-wa-e2e.js',
    port: 4199,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  portal: {
    script: 'verify-customer-portal.js',
    port: 4301,
    portVars: ['PORT', 'VERIFY_PORT', 'AUDIT_PORT', 'INLINE_PORT', 'CONSIST_PORT', 'ADMINDETAIL_PORT'],
    timeoutMs: 180000
  },
  'admin-pages': {
    script: 'verify-admin-pages.js',
    port: 4320,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 120000
  },
  'admin-content': {
    script: 'verify-admin-content-e2e.js',
    port: 4321,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 300000
  },
  'admin-layout': {
    script: 'verify-admin-layout.js',
    port: 4322,
    portVars: ['PORT', 'VERIFY_PORT'],
    needsBrowser: true,
    timeoutMs: 300000
  },
  'admin-visual': {
    script: 'verify-admin-visual.js',
    port: 4323,
    portVars: ['PORT', 'VERIFY_PORT'],
    needsBrowser: true,
    timeoutMs: 300000
  },
  'admin-booking-detail': {
    script: 'audit-admin-booking-detail.js',
    port: 4324,
    portVars: ['PORT', 'VERIFY_PORT', 'ADMINDETAIL_PORT'],
    timeoutMs: 120000
  },
  'portal-markup': {
    script: 'audit-portal-markup.js',
    port: 4325,
    portVars: ['PORT', 'VERIFY_PORT', 'AUDIT_PORT'],
    timeoutMs: 120000
  },
  'portal-inline': {
    script: 'verify-portal-inline-scripts.js',
    port: 4326,
    portVars: ['PORT', 'VERIFY_PORT', 'INLINE_PORT'],
    timeoutMs: 120000
  },
  'portal-location': {
    script: 'audit-portal-location-consistency.js',
    port: 4327,
    portVars: ['PORT', 'VERIFY_PORT', 'CONSIST_PORT'],
    timeoutMs: 120000
  },
  presence: {
    script: 'presence-http.test.js',
    port: 4328,
    portVars: ['PORT', 'VERIFY_PORT', 'PRESENCE_PORT'],
    timeoutMs: 120000
  },
  'social-pages': {
    script: 'verify-social-pages.js',
    port: 4329,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  'social-profiles': {
    script: 'verify-social-profiles.js',
    port: 4330,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  'social-settings': {
    script: 'verify-social-settings-scope.js',
    port: 4331,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  'social-integration': {
    script: 'verify-social-integration.js',
    port: 4332,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  'social-clear': {
    script: 'verify-social-clear-config.js',
    port: 4333,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  'redesign-integration': {
    script: 'verify-redesign-integration.js',
    port: 4335,
    portVars: ['PORT', 'VERIFY_PORT'],
    needsBrowser: true,
    timeoutMs: 300000
  },
  'social-contrast': {
    script: 'audit-social-contrast.js',
    port: 4334,
    portVars: ['PORT', 'VERIFY_PORT'],
    needsBrowser: true,
    timeoutMs: 300000
  },
  // Uji konfigurasi OpenWA & batas pengiriman di panel admin (Task 9).
  // Skrip ini mengubah settings lewat HTTP sungguhan, jadi WAJIB memakai
  // folder data uji terisolasi — sudah-care runner di bawah.
  'admin-wa-settings': {
    script: 'verify-admin-wa-settings.js',
    port: 4336,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  },
  // Audit celah panel admin. Exit code skrip ini mencerminkan hasil audit
  // (non-zero bila ada BUG), jadi layak dijalankan lewat runner.
  'admin-audit': {
    script: 'verify-admin-audit.js',
    port: 4337,
    portVars: ['PORT', 'VERIFY_PORT'],
    timeoutMs: 180000
  }
};

const target = process.argv[2] || 'wa-e2e';
const isAll = target === 'all';
const cfg = TARGETS[target];

if (!cfg && !isAll) {
  console.error(`Target tidak dikenal: ${target}. Pilihan: ${Object.keys(TARGETS).join(', ')}, all`);
  process.exit(1);
}

/**
 * Buat folder data uji yang terisolasi.
 *
 * Server anak DAN skrip verifikasi memakai folder yang sama, sehingga
 * skrip melihat data yang benar-benar ditulis server — tapi file
 * `data/db.json` produksi tidak pernah disentuh.
 *
 * @param {string} label nama target
 * @returns {string} path absolut folder data uji
 */
function makeDataDir(label) {
  const dir = path.join(os.tmpdir(), `sabesi-e2e-${label}`);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* abaikan */
  }
  return dir;
}

/**
 * Susun environment untuk server anak + skrip verifikasi.
 *
 * @param {object} c konfigurasi target
 * @param {string} dataDir folder data uji
 * @returns {object} environment
 */
function buildEnv(c, dataDir) {
  const env = {
    ...process.env,
    SABESI_DATA_DIR: dataDir,
    SABESI_TEST_DIR: dataDir,
    // Latar belakang WhatsApp dimatikan: uji ini tidak boleh mengirim pesan.
    WA_DISABLE_BG: '1'
  };
  // Setiap nama variabel port yang mungkin dipakai skrip harus diarahkan
  // ke port server uji. Kalau ada yang lupa, skrip membaca server LAMA.
  const vars = c.portVars || ['PORT', 'VERIFY_PORT'];
  for (const v of vars) env[v] = String(c.port);
  env.PORT = String(c.port);
  return env;
}

/**
 * Interpreter Node yang dipakai untuk menyalakan server uji & skrip.
 *
 * PENTING: pakai `process.execPath` TIDAK selalu aman. Beberapa wrapper
 * Node (mis. yang dipakai Hermes Agent) butuh TTY — dijalankan tanpa TTY
 * (mis. dari pipeline/background shell) proses langsung gagal dengan
 * "stdin is not a tty", sehingga runner mati sebelum banner pertama
 * tercetak dan hasilnya disalahartikan sebagai kegagalan uji.
 *
 * Fallback: cari `node.exe` sistem yang biasa ada di
 * `C:\Program Files\nodejs\node.exe`. Kalau ada, pakai itu.
 *
 * @returns {string} path executable Node
 */
function resolveNodeBin() {
  const candidates = [];
  if (process.env.NODE_BINARY) candidates.push(process.env.NODE_BINARY);

  // Node sistem di lokasi standar Windows.
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  candidates.push(path.join(sysRoot, 'System32', 'node.exe'));
  candidates.push('C:\\Program Files\\nodejs\\node.exe');
  candidates.push('/c/Program Files/nodejs/node.exe');

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {
      /* abaikan */
    }
  }
  return process.execPath;
}

const NODE_BIN = resolveNodeBin();

/**
 * Pastikan interpreter Node yang dipilih benar-benar bisa dijalankan
 * tanpa TTY.
 *
 * Tanpa cek ini, kegagalan muncul sebagai "stdin is not a tty" yang
 * menyesatkan — seolah-olah uji gagal, padahal prosesnya belum pernah
 * jalan sama sekali.
 *
 * @returns {boolean} true bila interpreter bisa dipakai
 */
function nodeBinWorks() {
  try {
    const r = require('child_process').spawnSync(NODE_BIN, ['--version'], {
      encoding: 'utf8',
      timeout: 15000
    });
    return r.status === 0 && /\d+\.\d+/.test(String(r.stdout || ''));
  } catch (_) {
    return false;
  }
}

if (!nodeBinWorks()) {
  console.error(
    `FATAL: interpreter Node "${NODE_BIN}" tidak bisa dijalankan di lingkungan ini.\n` +
    'Gejalanya: "stdin is not a tty" — proses berhenti sebelum banner runner tercetak.\n' +
    'Penyebab: shell ini tidak menyediakan TTY untuk Node (mis. dijalankan dari\n' +
    'pipeline/background tanpa pty). Solusi: jalankan lewat `npm run test:e2e`\n' +
    'atau set NODE_BINARY ke node.exe sistem yang tidak butuh TTY.'
  );
  process.exit(1);
}

/**
 * Jalankan satu target: nyalakan server uji, jalankan skrip, matikan server.
 *
 * @param {string} name nama target
 * @param {object} c konfigurasi target
 * @returns {Promise<{name: string, ok: boolean, code: number}>} hasil
 */
function runTarget(name, c) {
  const dataDir = makeDataDir(name);
  const env = buildEnv(c, dataDir);

  console.log(`\n${'='.repeat(60)}\n${name} — ${c.script} (port ${c.port})\n${'='.repeat(60)}`);
  console.log(`Menyalakan server uji di port ${c.port} (data: ${dataDir})…`);

  const server = spawn(NODE_BIN, [path.join(root, 'server.js')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLog = '';
  server.stdout.on('data', (c2) => { serverLog += c2; });
  server.stderr.on('data', (c2) => { serverLog += c2; });

  /**
   * Tunggu sampai server siap menerima koneksi.
   * @param {number} timeoutMs batas waktu tunggu
   * @returns {Promise<boolean>} true bila server merespons
   */
  const waitForServer = (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const attempt = () => {
        const req = require('http').get(
          { host: '127.0.0.1', port: c.port, path: '/', timeout: 2000 },
          (res) => {
            res.resume();
            resolve(true);
          }
        );
        req.on('error', () => {
          if (Date.now() > deadline) {
            resolve(false);
            return;
          }
          setTimeout(attempt, 300);
        });
        req.on('timeout', () => {
          req.destroy();
          if (Date.now() > deadline) {
            resolve(false);
            return;
          }
          setTimeout(attempt, 300);
        });
      };
      attempt();
    });
  };

  return waitForServer(30000).then((ready) => {
    if (!ready) {
      console.error('Server uji tidak pernah siap.\n' + serverLog);
      server.kill();
      return { name, ok: false, code: 1 };
    }

    console.log(`Server siap. Menjalankan ${c.script}…\n`);

    const verifier = spawn(NODE_BIN, [path.join(__dirname, c.script)], {
      cwd: root,
      env,
      stdio: 'inherit'
    });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.error('Uji melewati batas waktu — dihentikan.');
        verifier.kill();
        server.kill();
        resolve({ name, ok: false, code: 1 });
      }, c.timeoutMs || 180000);

      verifier.on('exit', (code) => {
        clearTimeout(timer);
        server.kill();
        console.log(`Server uji dihentikan. Sisa data uji: ${dataDir}`);
        resolve({ name, ok: code === 0, code: code === null ? 1 : code });
      });
    });
  });
}

(async () => {
  const list = isAll ? Object.entries(TARGETS) : [[target, cfg]];
  const results = [];
  for (const [name, c] of list) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runTarget(name, c));
  }

  console.log(`\n${'='.repeat(60)}\nRingkasan\n${'='.repeat(60)}`);
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'LULUS' : 'GAGAL'}  ${r.name}`);
  }
  console.log(failed ? `\n${failed} target gagal.` : '\nSemua target lulus.');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
