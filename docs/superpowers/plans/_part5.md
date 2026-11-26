
# FASE 2 — Migrasi Penuh WhatsApp: Bersihkan Legacy & OpenWA sebagai Ganti Penuh

> **Konteks:** Fase 0 (Task 1) sudah memperbaiki bug `sendText` rekursif. Fase 2 ini
> membersihkan sisa-sisa warisan legacy, membuat konfigurasi OpenWA bisa diatur
> dari panel admin, dan menambah ketahanan (circuit breaker + backoff) supaya
> kegagalan gateway tidak memblokir proses utama.

## Task 8: Buang sisa dead code modul WhatsApp lama

**Files:**
- Modify: `src/services/wa.js:12` (komentar basi), `:392` (komentar basi)
- Modify: `src/services/wa.js:62-64` (`config()` stub mati), `:74-76` (`isActive()` alias mati)
- Modify: `scripts/migrate-data-ipaymu.js:19-20`, `:92-120` (blok hapus sesi Baileys)
- Modify: `scripts/migrate-seed-payment.js:36` (komentar basi)
- Test: `scripts/wa-check.js` (perluas penjaga)

**Interfaces:**
- Consumes: tidak ada.
- Produces: `wa.config()` dan `wa.isActive()` **dihapus** dari exports (tidak ada pemanggil — sudah diverifikasi lewat `grep`).

**Dasar keputusan "dihapus" (bukan "dipertahankan"):**

`src/services/wa.js:62-64`:
```js
function config() {
  return { token: '', phoneId: '' };
}
```

Stub ini tersisa dari arsitektur lama (Meta WhatsApp Cloud API / Twilio). Tidak ada
pemanggil — `grep -rn "wa\.config\|wa\.isActive" src/ scripts/ views/` → kosong.
`isActive()` di `:74-76` cuma alias `isReady()`, juga tanpa pemanggil.

Menyisakannya berarti boolean jadi dua sumber kebenaran untuk hal yang sama —
Meninggalkannya berarti status "aktif" jadi dua sumber kebenaran untuk hal yang
sama — pemanggil di masa depan bingung mana yang benar.

**Kenapa `wa.sendText()` (baris 331-340) TIDAK dihapus:**
`src/routes/marketing.routes.js:385` memakainya untuk "kirim pesan uji". Dua wrapper
dengan nama sama (`wa.sendText` vs `wa.sendVia`) memang membingungkan, tapi
menghapus `wa.sendText` berarti mengubah route yang ada. **Rencana:** di Task 11,
ubah route tersebut agar memakai `wa.sendVia()` (yang sudah punya log + validasi
izin), lalu `wa.sendText` ikut dihapus. Jadi penghapusan terjadi di Task 11,
bukan di sini.

- [ ] **Step 1: Perluas penjaga di `scripts/wa-check.js`**

  Tambah blok berikut sebelum `console.log('\nPenjaga: tidak ada sisa whatsapp-web.js / qrcode.');`:

  ```js
  /* ------------------------------------------------------------------ */
  /* Penjaga: sisa modul WhatsApp legacy tidak boleh kembali            */
  /* ------------------------------------------------------------------ */

  /*
   * Modul WhatsApp lama sudah dibuang. Stub `wa.config()` dan
   * `wa.isActive()` pernah tersisa sebagai alias mati — kalau muncul
   * lagi berarti masih ada jalur kode yang mengharapkan API lama
   * (token/phoneId) yang sudah tidak berlaku.
   */
  const legacyWaExports = ['config', 'isActive'];
  const waService = require(path.join(root, 'src', 'services', 'wa'));

  let legacyFailed = 0;
  legacyWaExports.forEach((name) => {
    if (typeof waService[name] === 'function') {
      legacyFailed += 1;
      console.log(`FAIL wa.${name}() masih ada — stub lama tidak boleh kembali`);
    }
  });

  // Komentar basi yang menyebut whatsapp-web.js juga dilarang: kalau
  // ada, berarti ada yang menyalin ulang dokumentasi arsitektur lama.
  const staleCommentFiles = ['src/services/wa.js', 'scripts/migrate-seed-payment.js'];
  staleCommentFiles.forEach((rel) => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return;
    const text = fs.readFileSync(p, 'utf8');
    if (/whatsapp-web\.js/.test(text)) {
      legacyFailed += 1;
      console.log(`FAIL ${rel} masih menyebut whatsapp-web.js di komentar`);
    }
  });

  if (legacyFailed) {
    console.log(`\n${legacyFailed} masalah.`);
    process.exit(1);
  }
  console.log('Penjaga: tidak ada sisa modul WhatsApp legacy.');
  ```

  > **Catatan:** pastikan kalimat "kalau ada, berarti masih ada jalur kode yang
  > mengharapkan API lama (token/phoneId) yang sudah tidak berlaku" tertulis
  > utuh dalam komentar di atas, tanpa karakter asing yang tertinggal.

- [ ] **Step 2: Jalankan penjaga, pastikan GAGAL**

  Run: `node scripts/wa-check.js`
  Expected: FAIL — `wa.config()` masih ada.

- [ ] **Step 3: Hapus stub `config()` dan `isActive()` dari `src/services/wa.js`**

  Hapus blok:

  ```js
  function config() {
    return { token: '', phoneId: '' };
  }
  ```

  dan blok:

  ```js
  function isActive() {
    return isReady();
  }
  ```

  Lalu **hapus keduanya dari `module.exports`** di `src/services/wa.js`.

  > Perhatikan: `isReady()` sendiri **TIDAK** dihapus — ia dipakai
  > `wa.isReady()` di banyak tempat (lihat `src/services/wa.js` exports).
  > Hanya alias `isActive()` yang dibuang.

- [ ] **Step 4: Hapus komentar basi whatsapp-web.js dari `src/services/wa.js`**

  Di baris ~12, ganti komentar yang menyebut whatsapp-web.js. Contoh:

  ```js
  /**
   * ... "pakai yang open-source". Generasi berikutnya memakai whatsapp-web.js
   */
  ```

  menjadi:

  ```js
  /**
   * ... "pakai yang open-source". Generasi berikutnya memakai gateway
   * OpenWA (self-hosted, REST API) — backend tidak menjalankan browser.
   */
  ```

  Di baris ~392, ganti komentar yang menyebut "perangkat WhatsApp Web
  (whatsapp-web.js) di dalam proses Node" menjadi:

  ```js
  /**
   * ... perangkat WhatsApp Web di sisi gateway OpenWA, bukan di dalam
   * proses Node.
   */
  ```

  > Setelah dua penggantian ini, `grep whatsapp-web.js src/services/wa.js` harus kosong.

- [ ] **Step 5: Hapus blok hapus sesi Baileys dari `scripts/migrate-data-ipaymu.js`**

  Skrip ini adalah skrip **sekali pakai** untuk migrasi lama. Blok yang menghapus
  sesi Baileys (sekitar baris 92-120) sudah tidak relevan — sesi Baileys tidak
  pernah ada di instalasi baru, dan logikanya justru bisa menghapus berkas yang
  tidak boleh dihapus bila dijalankan ulang.

  Hapus:
  - Baris ~19-20 (komentar "// 3. Sesi WhatsApp: hapus folder session Baileys lama karena formatnya tidak kompatibel dengan whatsapp-web.js (profil Chromium).")
  - Baris ~92-120 (seluruh blok `// --- 3. Sesi WhatsApp lama (Baileys) ---`)
  - Pemanggilan blok tersebut di bagian utama skrip.

  Setelah penghapusan, pastikan `grep -n "Baileys\|baileys\|whatsapp-web" scripts/migrate-data-ipaymu.js` → kosong.

  > **PENTING — baca dulu isi skrip sebelum menghapus.** Skrip ini mungkin punya
  > langkah migrasi lain yang masih dibutuhkan (periode iPaymu). Yang dihapus
  > HANYA blok Baileys.

- [ ] **Step 6: Perbaiki komentar basi di `scripts/migrate-seed-payment.js`**

  Di baris ~36, ganti:

  ```js
  '    // WhatsApp — perangkat WhatsApp Web open-source (whatsapp-web.js)',
  ```

  menjadi:

  ```js
  '    // WhatsApp — gateway open-source OpenWA (self-hosted, REST API)',
  ```

- [ ] **Step 7: Jalankan penjaga, pastikan LULUS**

  Run: `node scripts/wa-check.js`
  Expected: "Semua modul & template OK." + "Penjaga: tidak ada sisa modul WhatsApp legacy."

- [ ] **Step 8: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

  > Kalau suite gagal karena `wa.config` masih dipanggil di suatu tempat,
  > cari pemanggilnya dan ganti ke `wa.gateway` / `wa.isReady`.

- [ ] **Step 9: Commit**

  ```bash
  git add src/services/wa.js scripts/wa-check.js scripts/migrate-data-ipaymu.js \
          scripts/migrate-seed-payment.js
  git commit -m "refactor(wa): buang stub dan komentar warisan modul WhatsApp lama"
  ```

---

## Task 9: Konfigurasi OpenWA yang bisa diatur dari panel admin

**Files:**
- Modify: `src/seed.js:826-866` (tambah `openwaTimeoutMs`, `frequencyCap`, `globalDailyLimit`)
- Modify: `src/routes/admin.routes.js:846-860` (scope `SETTINGS_GROUPS`)
- Modify: `src/routes/admin.routes.js` — blok penyimpanan settings (around baris 1024-1030)
- Modify: `views/admin/settings.ejs:197-218` (panel OpenWA), `:219-252` (panel Presence)
- Test: `scripts/wa-gateway.test.js` (tambah suite konfigurasi)

**Interfaces:**
- Consumes: `scopedInt(b, scope, key, fallback, def, min, max)` (sudah ada di `admin.routes.js`).
- Produces (settings baru):

| Key | Tipe | Default | Arti | Dipakai di |
|---|---|---|---|---|
| `openwaTimeoutMs` | number | 20000 | Timeout request ke gateway (ms) | `src/services/wa-gateway.js:117` (sudah dibaca) |
| `frequencyCap` | number | 3 | Maks pesan per kontak per hari | `src/services/wa.js:412` (sudah dibaca) |
| `globalDailyLimit` | number | 100 | Maks pesan total per hari | `src/services/wa.js:430` (sudah dibaca) |

> Ketiganya **sudah dibaca** oleh kode yang ada — masalahnya cuma tidak punya
> default di seed dan tidak masuk scope settings, jadi selalu terkunci di konstanta.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/wa-gateway.test.js`, di dalam blok `async () => { ... }`:

  ```js
  await t('timeout gateway bisa diatur lewat settings', () => {
    const cfg = gateway.config({ openwaTimeoutMs: 4500 });
    assert.strictEqual(cfg.timeoutMs, 4500);
  });

  await t('timeout default 20000 ms bila tidak diatur', () => {
    const cfg = gateway.config({});
    assert.strictEqual(cfg.timeoutMs, gateway.DEFAULT_TIMEOUT_MS);
  });

  await t('seed punya openwaTimeoutMs, frequencyCap, globalDailyLimit', () => {
    const fs = require('fs');
    const seedSrc = fs.readFileSync(path.join(root, 'src', 'seed.js'), 'utf8');
    ['openwaTimeoutMs', 'frequencyCap', 'globalDailyLimit'].forEach((k) => {
      assert.ok(
        seedSrc.includes(k + ':'),
        'seed harus punya key ' + k
      );
    });
  });

  await t('scope settings admin memuat key baru', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(root, 'src', 'routes', 'admin.routes.js'), 'utf8');
    assert.ok(src.includes("'openwaTimeoutMs'"), 'openwaTimeoutMs belum di scope');
    assert.ok(src.includes("'frequencyCap'"), 'frequencyCap belum di scope');
    assert.ok(src.includes("'globalDailyLimit'"), 'globalDailyLimit belum di scope');
  });
  ```

  > `gateway.config()` saat ini **belum** mengembalikan `timeoutMs`. Task ini
  > juga harus menambahkannya (lihat Step 3).

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/wa-gateway.test.js`
  Expected: FAIL — `cfg.timeoutMs` undefined.

- [ ] **Step 3: Tambahkan `timeoutMs` ke `gateway.config()`**

  Di `src/services/wa-gateway.js`, pada fungsi `config(settings)`, tambahkan baris
  di objek yang dikembalikan:

  ```js
  timeoutMs: timeoutMs,
  ```

  (variabel `timeoutMs` sudah ada di fungsi itu — baris ~117.)

- [ ] **Step 4: Tambah default baru di `src/seed.js`**

  Di `src/seed.js`, pada blok `const settings = { ... }` (sekitar baris 826-866),
  tambahkan setelah baris `openwaWebhookSecret: '',`:

  ```js
    // Timeout request ke gateway OpenWA (ms). Batas bawah 3000, atas 120000.
    openwaTimeoutMs: 20000,
    // Batas pesan per kontak per hari (mencegah spam ke satu nomor).
    frequencyCap: 3,
    // Batas total pesan per hari untuk seluruh kanal.
    globalDailyLimit: 100,
  ```

  > **PENTING — WAJIB ada di seed.** Ada catatan eksplisit di `src/seed.js:848-852`
  > bahwa key yang tidak ada di seed akan dianggap berubah oleh
  > `scripts/verify-admin-audit.js` (audit "settings asli dipulihkan" gagal
  > palsu). Jadi jangan lupa.

- [ ] **Step 5: Tambahkan key baru ke scope settings**

  Di `src/routes/admin.routes.js`, pada `SETTINGS_GROUPS`:

  ```js
  openwa: [
    'openwaBaseUrl', 'openwaApiKey', 'openwaSessionName',
    'openwaWebhookUrl', 'openwaWebhookSecret',
    'openwaTimeoutMs'
  ],
  ```

  dan pada grup `wa`:

  ```js
  wa: [
    'waDefaultTemplate',
    'waQuietStart', 'waQuietEnd', 'waReminderIntervalMin',
    'frequencyCap', 'globalDailyLimit'
  ],
  ```

- [ ] **Step 6: Simpan nilai baru di route pengaturan**

  Di `src/routes/admin.routes.js`, di dalam handler `POST /pengaturan`, tambahkan
  (letakkan di dekat blok penyimpanan `presence`):

  ```js
  // Timeout gateway OpenWA (ms).
  if (scope.has('openwaTimeoutMs')) {
    s.openwaTimeoutMs = scopedInt(b, scope, 'openwaTimeoutMs', s.openwaTimeoutMs, 20000, 3000, 120000);
  }

  // Batas pesan per kontak per hari & batas total harian.
  if (scope.has('frequencyCap')) {
    s.frequencyCap = scopedInt(b, scope, 'frequencyCap', s.frequencyCap, 3, 1, 50);
  }
  if (scope.has('globalDailyLimit')) {
    s.globalDailyLimit = scopedInt(b, scope, 'globalDailyLimit', s.globalDailyLimit, 100, 10, 5000);
  }
  ```

  > `scopedInt` sudah ada dengan signature
  > `(b, scope, key, fallback, def, min, max)` — cek tanda tangannya di
  > `src/routes/admin.routes.js` sekitar baris 916.

- [ ] **Step 7: Tambahkan field form di `views/admin/settings.ejs`**

  Di panel OpenWA (sekitar baris 197-218), tambahkan field baru **sebelum**
  checkbox `openwaClear`:

  ```ejs
          <div class="a-field">
            <label>Timeout gateway (milidetik)</label>
            <input type="number" name="openwaTimeoutMs" min="3000" max="120000" step="500" value="<%= item.openwaTimeoutMs || 20000 %>">
            <span class="help">Batas waktu menunggu jawaban gateway sebelum dianggap gagal. Default 20000 ms (20 detik).</span>
          </div>
  ```

  Dan di panel Presence / WhatsApp, tambahkan dua field limit. Letakkan di panel
  WhatsApp (yang sudah ada di halaman — kalau tidak ada, buat panel baru
  "Batas Pengiriman"):

  ```ejs
          <div class="a-field">
            <label>Maks pesan per kontak per hari</label>
            <input type="number" name="frequencyCap" min="1" max="50" value="<%= item.frequencyCap || 3 %>">
            <span class="help">Setelah batas ini tercapai, pesan untuk kontak yang sama ditunda sampai hari berikutnya. Default 3.</span>
          </div>
          <div class="a-field">
            <label>Maks pesan total per hari</label>
            <input type="number" name="globalDailyLimit" min="10" max="5000" step="10" value="<%= item.globalDailyLimit || 100 %>">
            <span class="help">Batas keseluruhan pesan yang boleh dikirim dalam satu hari. Default 100.</span>
          </div>
  ```

  > Form-field ini harus berada di dalam form yang punya
  > `<input type="hidden" name="form" value="wa">` supaya masuk scope `wa`.

- [ ] **Step 8: Jalankan test, pastikan LULUS**

  Run: `node scripts/wa-gateway.test.js`
  Expected: semua suite lulus.

- [ ] **Step 9: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 10: Verifikasi pengaturan admin**

  Run: `node scripts/verify-admin-pages.js`
  Expected: semua halaman admin sehat (200).

  Run: `node scripts/verify-admin-audit.js`
  Expected: audit settings asli dipulihkan — **kegagalan di sini berarti salah
  satu key baru tidak ada di seed**. Perbaiki seed, jangan audit-nya.

- [ ] **Step 11: Commit**

  ```bash
  git add src/seed.js src/routes/admin.routes.js views/admin/settings.ejs scripts/wa-gateway.test.js
  git commit -m "feat(wa): settings timeout gateway dan batas pengiriman bisa diatur dari panel admin"
  ```

---

## Task 10: Circuit breaker + backoff agar gateway mati tidak memblokir blast

**Files:**
- Modify: `src/services/wa-gateway.js` — tambah state circuit
- Modify: `src/services/wa-worker.js:20-25`, `:125-226` — pakai circuit + backoff
- Test: `scripts/wa-worker.test.js` (tambah suite), `scripts/wa-loop.test.js`

**Interfaces:**
- Consumes: `gateway.sendText()` (sudah diperbaiki di Task 1), `gateway.isReady()`.
- Produces (baru di `src/services/wa-gateway.js`):
  - `isCircuitOpen(): boolean` — true bila circuit terputus (gateway dicurigai mati).
  - `recordFailure(err): void` — mencatat kegagalan; membuka circuit setelah N kegagalan berturut-turut.
  - `recordSuccess(): void` — menutup circuit.
  - `CIRCUIT_THRESHOLD` = 5 (konstanta).
  - `CIRCUIT_COOLDOWN_MS` = 120000 (2 menit).

**Kenapa ini penting (terkait R3):**

Sekarang, kalau gateway mati:
- `wa.sendText()` → `gateway.sendText()` → `isReady()` false → worker menandai job
  "Menunggu WhatsApp terhubung" lalu mencoba **setiap 5 detik** untuk setiap target.
- Kalau gateway hidup tapi timeout, setiap pesan menunggu 20 detik.

Dengan circuit breaker: setelah 5 kegagalan berturut-turut, worker berhenti mencoba
selama 2 menit, menandai job dengan alasan jelas, lalu melanjutkan otomatis saat
gateway pulih.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/wa-worker.test.js`:

  ```js
  // ── Circuit breaker ────────────────────────────────────────────
  console.log('\n== Circuit breaker ==');

  test('gateway membuka circuit setelah beberapa kegagalan berturut-turut', () => {
    const G = loadWith(TMP_FILE);
    G.resetCircuit();
    assert.strictEqual(G.isCircuitOpen(), false, 'circuit harus tertutup di awal');
    for (let i = 0; i < G.CIRCUIT_THRESHOLD; i++) {
      G.recordFailure(new Error('timeout'));
    }
    assert.strictEqual(G.isCircuitOpen(), true, 'circuit harus terbuka');
  });

  test('recordSuccess menutup circuit', () => {
    const G = loadWith(TMP_FILE);
    G.resetCircuit();
    for (let i = 0; i < G.CIRCUIT_THRESHOLD; i++) {
      G.recordFailure(new Error('timeout'));
    }
    assert.strictEqual(G.isCircuitOpen(), true);
    G.recordSuccess();
    assert.strictEqual(G.isCircuitOpen(), false, 'circuit harus tertutup lagi');
  });

  test('circuit menutup otomatis setelah masa pending', () => {
    const G = loadWith(TMP_FILE);
    G.resetCircuit();
    for (let i = 0; i < G.CIRCUIT_THRESHOLD; i++) {
      G.recordFailure(new Error('timeout'));
    }
    assert.strictEqual(G.isCircuitOpen(), true);
    // Majukan waktu cooldown supaya circuit dianggap sudah dingin.
    G.setCircuitOpenedAt(Date.now() - G.CIRCUIT_COOLDOWN_MS - 1000);
    assert.strictEqual(G.isCircuitOpen(), false, 'circuit harus dingin setelah cooldown');
  });
  ```

  > `loadWith` / `TMP_FILE` sudah ada di `scripts/wa-worker.test.js` kalau
  > strukturnya mirip `presence.test.js`. **Baca file dulu** dan sesuaikan
  > nama helper-nya.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/wa-worker.test.js`
  Expected: FAIL — `G.isCircuitOpen` bukan fungsi.

- [ ] **Step 3: Implementasikan circuit breaker di `src/services/wa-gateway.js`**

  Tambahkan di dekat state modul (setelah deklarasi `let state = ...`):

  ```js
  /**
   * Circuit breaker — melindungi proses utama dari gateway yang mati.
   *
   * Background: gateway OpenWA adalah layanan terpisah (self-hosted). Kalau
   * ia mati atau timeout berulang, worker blast akan mencoba mengirim ke
   * setiap target — satu per satu, masing-masing menunggu timeout. Itu
   * membakar waktu dan membanjiri log.
   *
   * Setelah CIRCUIT_THRESHOLD kegagalan berturut-turut, circuit dibuka:
   * pemanggil melihat isCircuitOpen() === true dan berhenti mencoba sampai
   * CIRCUIT_COOLDOWN_MS lewat. Setelah itu circuit otomatis ditutup lagi
   * dan pengiriman dilanjutkan.
   */
  const CIRCUIT_THRESHOLD = 5;
  const CIRCUIT_COOLDOWN_MS = 120000;

  let consecutiveFailures = 0;
  let circuitOpenedAt = 0;

  /**
   * Apakah circuit sedang terputus (gateway dicurigai mati)?
   * @returns {boolean} true bila circuit terbuka
   */
  function isCircuitOpen() {
    if (!circuitOpenedAt) return false;
    if (Date.now() - circuitOpenedAt >= CIRCUIT_COOLDOWN_MS) {
      // Sudah dingin — tutup circuit dan izinkan percobaan lagi.
      circuitOpenedAt = 0;
      consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  /**
   * Catat satu kegagalan pengiriman.
   * @param {Error} err error yang terjadi
   */
  function recordFailure(err) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD && !circuitOpenedAt) {
      circuitOpenedAt = Date.now();
      console.warn(
        '[openwa] Circuit dibuka setelah ' + CIRCUIT_THRESHOLD +
        ' kegagalan berturut-turut: ' + ((err && err.message) || err)
      );
    }
  }

  /** Catat keberhasilan — circuit ditutup dan penghitung direset. */
  function recordSuccess() {
    consecutiveFailures = 0;
    circuitOpenedAt = 0;
  }

  /** Tutup circuit paksa dan reset penghitung. */
  function resetCircuit() {
    consecutiveFailures = 0;
    circuitOpenedAt = 0;
  }

  /**
   * Set waktu circuit dibuka (dipakai pengujian).
   * @param {number} ms timestamp dalam milidetik
   */
  function setCircuitOpenedAt(ms) {
    circuitOpenedAt = ms;
  }
  ```

  Tambahkan ke `module.exports`: `isCircuitOpen,` `recordFailure,` `recordSuccess,`
  `resetCircuit,` `setCircuitOpenedAt,` `CIRCUIT_THRESHOLD,` `CIRCUIT_COOLDOWN_MS,`

- [ ] **Step 4: Pakai circuit di `src/services/wa-worker.js`**

  Di `runJob(job, now)` (sekitar baris 125), **sebelum** cek `wa.canSend()`:

  ```js
  // Circuit breaker: kalau gateway dicurigai mati, jangan coba setiap
  // target satu per satu (tiap percobaan menunggu timeout).
  if (gateway.isCircuitOpen()) {
    job.status = 'queued';
    job.pausedReason = 'Gateway WhatsApp tidak merespons — menunggu gateway pulih';
    db.write();
    publishProgress(job, 'waiting-circuit');
    return 'waiting';
  }
  ```

  (`gateway` sudah di-require di `wa-worker.js`? Kalau belum, tambahkan
  `const gateway = require('./wa-gateway');` di bagian atas.)

  Lalu di dalam loop pengiriman (sekitar baris 174-198), tambahkan pencatatan
  kegagalan/sukses:

  ```js
      try {
        const res = await wa.deliverTo({ phone: target.phone, name: target.name }, text);
        if (res.status === 'sent') {
          gateway.recordSuccess();
          job.sent += 1;
          ...
        } else {
          gateway.recordFailure(new Error(res.reason || 'dilewati'));
          ...
        }
      } catch (err) {
        gateway.recordFailure(err);
        ...
      }
  ```

  Dan di bagian jeda antar pesan, terapkan **backoff eksponensial** alih-alih
  jeda tetap:

  ```js
      // Jeda antar pesan (rate-limit) dengan backoff eksponensial.
      // Gateway yang lambat akan memperlambat pengiriman, bukan sebaliknya.
      const backoff = consecutiveFail > 0 ? Math.min(30000, 3000 * Math.pow(2, consecutiveFail - 1)) : 0;
      await sleep(wa.MIN_DELAY_MS + backoff);
  ```

  > Perhatikan: `consecutiveFail` di kode worker yang ada bertambah **di dalam**
  > blok `catch`, bukan di blok `else` (skipped). Pastikan pencatatan
  > `gateway.recordFailure` konsisten dengan itu.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

  Run: `node scripts/wa-worker.test.js`
  Expected: semua suite lulus.

- [ ] **Step 6: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 7: Commit**

  ```bash
  git add src/services/wa-gateway.js src/services/wa-worker.js scripts/wa-worker.test.js
  git commit -m "feat(wa): circuit breaker dan backoff agar gateway mati tidak memblokir blast"
  ```

---

## Task 11: Satukan jalur pengiriman pesan + perbaiki kegagalan logging

**Files:**
- Modify: `src/routes/marketing.routes.js:385` (pakai `wa.sendVia`)
- Modify: `src/services/wa.js:331-340` (hapus `sendText` wrapper)
- Modify: `src/services/wa.js` — pastikan `sendVia` mencatat log dengan benar
- Test: `scripts/wa-unit.test.js`

**Interfaces:**
- Consumes: `wa.sendVia(settings, phone, text)`, `wa.deliverTo(target, text)`.
- Produces: **satu** jalur pengiriman pesan untuk seluruh pemicu.

**Temuan audit (B9 + failure isolation):**

| Pemicu | Alur SEKARANG | Alur SESUDAH |
|---|---|---|
| Blast | `wa.deliverTo()` → `wa.sendVia()` → gateway + `logSend()` | tetap |
| Pengingat | `wa.sendVia()` → gateway + `logSend()` | tetap |
| Uji pesan manual | `wa.sendText()` → gateway (**tanpa** `logSend()`) | `wa.sendVia()` → gateway + `logSend()` |

`wa.sendText()` tidak pernah mencatat ke `data.whatsappSendLogs`, jadi pesan uji
manual tidak muncul di riwayat pengiriman. Itu menyulitkan debugging saat
gateway bermasalah.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/wa-unit.test.js`:

  ```js
  // ── Jalur pengiriman tunggal ──────────────────────────────────
  console.log('\n== Jalur pengiriman ==');

  test('wa tidak lagi mengekspos sendText (pakai sendVia saja)', () => {
    assert.strictEqual(
      typeof wa.sendText,
      'undefined',
      'wa.sendText harus dihapus — pakai wa.sendVia'
    );
    assert.strictEqual(typeof wa.sendVia, 'function', 'wa.sendVia harus ada');
  });

  test('sendVia mencatat hasil ke log pengiriman', () => {
    const D = db.read();
    const before = (D.whatsappSendLogs || []).length;
    return wa.sendVia(D.settings, '628111222333', 'halo log')
      .then(() => {
        const after = db.read().whatsappSendLogs || [];
        assert.ok(after.length > before, 'harus ada entri log baru');
      });
  });
  ```

  > **Catatan:** test `sendVia` memanggil gateway sungguhan. `wa-unit.test.js`
  > **tidak** memakai `wa-mock-gateway`. Karena itu test ini harus memasang
  > mock dulu:
  >
  > ```js
  > const { gateway } = require(path.join(__dirname, 'wa-mock-gateway'));
  > gateway.sendText = async () => ({ id: 'mock-1', jid: '628111222333@c.us', via: 'openwa' });
  > gateway.isReady = () => true;
  > ```
  >
  > **Tambahkan ini di bagian atas `wa-unit.test.js`**, sebelum test.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/wa-unit.test.js`
  Expected: FAIL — `wa.sendText` masih ada.

- [ ] **Step 3: Ubah route pesan uji**

  Di `src/routes/marketing.routes.js`, di route "kirim pesan uji" (sekitar baris 385):

  ```js
  await wa.sendText(data.settings, phone, message);
  ```

  menjadi:

  ```js
  // Pakai sendVia (bukan sendText) supaya hasil pengiriman ikut
  // tercatat di log — penting untuk debugging saat gateway bermasalah.
  await wa.sendVia(data.settings, phone, message);
  ```

  > Perhatikan perbedaan signature: `sendText(settings, phone, text)` vs
  > `sendVia(settings, phone, text)`. Keduanya punya urutan argumen yang sama,
  > jadi yang berubah hanya nama fungsi.

- [ ] **Step 4: Hapus `wa.sendText()`**

  Di `src/services/wa.js`, hapus seluruh fungsi `sendText` (sekitar baris 331-340)
  beserta JSDoc-nya, dan hapus `sendText,` dari `module.exports`.

  > **Pastikan `sendVia` benar-benar mencatat log.** Baca implementasi
  > `sendVia` di `src/services/wa.js` — kalau belum memanggil `logSend()`,
  > tambahkan pemanggilannya di jalur sukses.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

  Run: `node scripts/wa-unit.test.js`
  Expected: semua suite lulus.

- [ ] **Step 6: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 7: Commit**

  ```bash
  git add src/routes/marketing.routes.js src/services/wa.js scripts/wa-unit.test.js
  git commit -m "refactor(wa): satukan jalur pengiriman pesan dan perbaiki pencatatan log"
  ```

---
