# Implementation Plan — Audit Empat Fokus (Upload Media, OpenWA, Pelacakan Lokasi, Fitur Tambahan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup 9 temuan audit — termasuk bug Critical `sendText` rekursif yang membuat **seluruh** pengiriman WhatsApp gagal — serta membangun standarisasi upload per-slot, pelacakan posisi_LAST_SEEN_ persisten untuk kasus darurat, dan 4 fitur keselamatan tambahan.

**Architecture:** Repo `D:\laragon\www\sabesi` = Node.js 18+/Express 4 + EJS (server-side rendered) + file JSON store (`data/db.json`, `data/presence.json`). Tanpa PostgreSQL, tanpa build step frontend. Semua perubahan pada 4 fase berurutan: **Fase 0** memperbaiki bug pemblokir, **Fase 1** upload, **Fase 2** OpenWA, **Fase 3** pelacakan, **Fase 4** fitur tambahan. Tiap fase menghasilkan perangkat lunak yang bisa diuji sendiri.

**Tech Stack:** Node.js 18+, Express 4.21, EJS 3.1, multer 2.0, sharp 0.35, bcryptjs, SSE (tanpa socket.io), Leaflet 1.9.4 (CDN), Vanilla JS sisi klien (IIFE, tanpa bundler). Harness uji: `scripts/*.test.js` (assert-based) + `scripts/run-e2e.js` (HTTP/Puppeteer).

**Spec:** `docs/audit-2026-11-25-empat-fokus.md` (audit lengkap, semua temuan B1–B9)

---

## Global Constraints

- **Tanpa langkah lint.** Dilarang keras memasukkan `eslint`, `prettier`, `npm run lint`, `tsc --noEmit`, atau langkah perbaikan format ke dalam plan maupun eksekusi. Verifikasi akhir dijalankan manual oleh pengguna.
- **Semua komentar kode dan penjelasan logika ditulis dalam Bahasa Indonesia.**
- **Server-side rendered.** Tidak boleh menambah dependensi frontend/bundler. Perubahan UI = edit `.ejs` + edit/buat file JS statis di `public/js/`.
- **Tidak menambah dependensi npm.** Semualibrary yang dibutuhkan sudah ada (`sharp`, `multer`, `bcryptjs`). Exception: boleh menambah dependency **devDependency** yang sudah ada di `package.json`.
- **Isolasi data uji WAJIB.** Setiap skrip uji baru harus `require(path.join(__dirname, 'test-db'))` **sebelum** `require` modul `src/db` — kalau tidak, `data/db.json` produksi tertimpa. Lihat `scripts/test-db.js`.
- **Skrip uji baru harus didaftarkan** di `scripts/wa-run-tests.js` (array `suites`) atau `scripts/run-e2e.js` (objek `TARGETS`), kalau tidak tidak akan pernah dijalankan oleh `npm test` / `npm run test:e2e`.
- **Aturan etika WhatsApp tidak boleh dilanggar** (`src/services/wa.js:16-22`): hanya kirim ke kontak opt-in, opt-out menang atas opt-in, jam tenang menunda bukan membatalkan, izin dicek ULANG saat pengiriman, setiap nomor punya hasil tercatat.
- **Privasi lokasi:** pelanggan hanya melihat admin + fellow traveler dengan booking/grup yang sama. Admin melihat semua.
- **CSRF:** form multipart diverifikasi setelah body terurai (`verifyCsrfAfterParse` di `src/middleware/upload.js:64`); request JSON/fetch wajib kirim header `x-csrf-token`.
- **Webhook OpenWA** harus tetap mounted **sebelum** `express.json()` di `src/app.js:30` (HMAC dihitung atas byte mentah).
- **Tidak boleh** mengubah nama field form yang dipakai `scripts/verify-admin-audit.js` (`imageFile`, `logoFile`, `heroFile`, `ogFile`, `galleryFiles`) — audit existing bergantung padanya.

---

## Review Focus

Lima kelas input/kondisi yang paling mungkin menggigit orang nyata. Tiap baris punya tes-nya di task yang relevan.

| # | Input / kondisi | Perilaku yang diharapkan | Task |
|---|---|---|---|
| R1 | Berkas gambar **diunggah ulang** dengan ekstensi berbohong (`evil.jpg` tapi isinya PNG, atau `.php` berisi HTML) | Ditolak backend lewat magic byte, bukan ACCEPT karena `Content-Type` dari browser | Task 3 |
| R2 | Admin mengunggah **potret untuk slot landscape** (mis. foto HP 9:16 untuk `card` 16:10) | Diterima (potong otomatis) **tapi** diberi peringatan rasio di UI — bukan ditolak diam-diam | Task 4, Task 5 |
| R3 | Gateway OpenWA mati / timeout saat blast berjalan | Blast **tidak** crash; worker berhenti mencoba, menandai job "gateway offline", dan melanjutkan otomatis saat gateway pulih | Task 10 |
| R4 | Pelanggan butuh tahu posisi fellow traveler yang **sudah 2 jam tidak aktif** (TTL habis) | Admin & fellow traveler tetap bisa melihat **titik terakhir** beserta label "terakhir terlihat 2 jam lalu" | Task 12, Task 14 |
| R5 | Pelanggan menekan SOS saat sinyal jelek / koordinat tidak terbaca | Tidak ada error bodoh; antrean lokal, dan status SOS terlihat jelas di kedua sisi | Task 13, Task 18 |

---

## Peta File (Struktur yang Dikunci)

### Fase 0 — Pemblokir

| File | Tanggung jawab |
|---|---|
| `src/services/wa-gateway.js` | Klien REST OpenWA (transport murni). **Dua fungsi `sendText` bertabrakan** → dipecah jadi `sendTextViaSession` + `sendText`. |
| `scripts/wa-gateway.test.js` | Suite uji adapter OpenWA (sudah ada) — tempat regression test B1. |

### Fase 1 — Upload

| File | Tanggung jawab |
|---|---|
| `src/services/image.js` | **BARU:** `SLOT_SPECS` (satu sumber kebenaran rasio + batas ukuran + MIME + min dimensi per slot). Pipeline `processImage` tetap di sini. |
| `src/middleware/upload.js` | Validasi per-slot (ukuran/MIME/dimensi). Hapus `FIELD_SLOTS` yang mati. |
| `public/js/upload-spec.js` | **BARU:** spesifikasi slot untuk sisi klien (rasio, maks byte, MIME, min dimensi) + fungsi validasi. Dimuat sekali di layout admin & public. |
| `views/admin/partials/image-upload.ejs` | Partial widget upload tunggal — sumber `data-*` untuk spec slot. |
| `views/admin/partials/gallery-upload.ejs` | Partial widget upload galeri. |
| `public/js/admin-upload.js` | Widget upload tunggal — pakai `SylUploadSpec`. |
| `public/js/admin-gallery-widget.js` | Widget galeri — pakai `SylUploadSpec`. |
| `public/js/admin-gallery-suite.js` | Suite galeri admin — **upload sungguhan** (perbaiki simulasi). |
| `public/js/upload-batch.js` | **BARU:** helper POST batch (FormData) ke endpoint upload. |
| `src/routes/admin.routes.js` | **BARU:** `POST /admin/galeri/unggah` (endpoint nyata untuk suite galeri). |
| `views/layouts/public.ejs` | Hapus blok JS upload bukti yang mati. |
| `views/layouts/admin.ejs` | Muat `/js/upload-spec.js` + `/js/upload-batch.js`. |

### Fase 2 — OpenWA

| File | Tanggung jawab |
|---|---|
| `src/services/wa.js` | Lapisan layanan (blast, opt-in, template, limit). Hapus stub mati. |
| `src/services/wa-worker.js` | Worker blast + circuit breaker + backoff. |
| `src/services/wa-gateway.js` | Tambah `circuitOpen` state + `isCircuitOpen()` / `resetCircuit()`. |
| `src/seed.js` | Field settings baru: `openwaTimeoutMs`, `frequencyCap`, `globalDailyLimit`. |
| `src/routes/admin.routes.js` | Scope `SETTINGS_GROUPS.openwa` += field baru; `SETTINGS_GROUPS.wa` += limit. |
| `views/admin/settings.ejs` | Panel form untuk field baru. |
| `scripts/migrate-data-ipaymu.js` | Skrip sekali pakai — hapus blok Baileys. |
| `scripts/migrate-seed-payment.js` | Komentar basi whatsapp-web.js. |

### Fase 3 — Pelacakan lokasi

| File | Tanggung jawab |
|---|---|
| `src/services/presence.js` | **BARU:** `lastSeen` persisten + antrean SOS. Schema `presence.json` v2. |
| `src/services/roster.js` | **BARU:** grup/rombongan per booking + roster peserta. |
| `src/services/geo.js` | Tambah `mapsUrl(lat,lng)` (deep link Google Maps) + `formatAge(iso)`. |
| `src/routes/presence.routes.js` | Endpoint baru: `GET /api/presence/roster`, `POST /api/presence/sos`, `GET /api/presence/sos`. |
| `src/routes/account.routes.js` | **BARU:** `GET /akun/cari` (pencarian peserta), `GET /akun/rombongan`. |
| `views/pages/account-search.ejs` | **BARU:** halaman pencarian peserta di customer login. |
| `views/pages/account-group.ejs` | **BARU:** halaman roster satu rombongan + peta bersama. |
| `views/pages/account-location.ejs` | Tambah badge last-seen + tombol SOS + link peta. |
| `views/admin/lokasi.ejs` | Tambah last-seen, roster, tombol SOS/resolve. |
| `src/routes/admin.routes.js` | **BARU:** `GET /admin/peserta` (pencarian & roster global). |
| `views/admin/peserta.ejs` | **BARU:** halaman admin peserta. |
| `public/js/presence.js` | Tambah dukungan antrean SOS offline. |
| `public/js/map.js` | Tambah `api.setRoster(entries)` untuk markerrombongan. |

### Fase 4 — Fitur tambahan

| File | Tanggung jawab |
|---|---|
| `src/services/alert.js` | **BARU:** dispatcher alert (SOS + geofence) → OpenWA + realtime. |
| `src/services/wa-alert.js` | **BARU:** template pesan alert & pengiriman non-blocking ke koordinator. |
| `src/services/wa-scheduler.js` | Jalankan pemeriksaan geofence berkala. |
| `views/admin/alert.ejs` | **BARU:** pusat alert admin. |
| `src/routes/alert.routes.js` | **BARU:** router alert (mount di `src/app.js`). |
| `src/services/realtime.js` | Tambah `EVENTS.ALERT`. |

---

# FASE 0 — Perbaikan Bug Critical (P0, blocker untuk semua pekerjaan WhatsApp)

## Task 1: Perbaiki `sendText` rekursif di adapter OpenWA

**Files:**
- Modify: `src/services/wa-gateway.js:439` (rename transport), `src/services/wa-gateway.js:666-690` (panggil nama baru), `src/services/wa-gateway.js:804-840` (exports)
- Test: `scripts/wa-gateway.test.js` (tambah suite baru di akhir file)

**Interfaces:**
- Consumes: `gateway.request(method, path, body, settings)` (sudah ada), `gateway.applySession(session)`, `gateway.config(settings)`.
- Produces:
  - `sendTextViaSession(sessionId: string, chatId: string, text: string, settings?: object): Promise<object>` — transport murni, POST ke `/api/sessions/:id/messages/send-text`. **Nama ini wajib dipakai oleh wrapper.**
  - `sendText(phone: string, text: string, settings?: object): Promise<{id: string|null, jid: string, via: string}>` — wrapper publik, **signature TIDAK BERUBAH** (dipakai `src/services/wa.js:339`).

**Konteks bug (terverifikasi eksekusi):** `src/services/wa-gateway.js` mendeklarasikan `sendText` dua kali di scope modul yang sama. Baris 439 = transport `(sessionId, chatId, text, settings)`. Baris 666 = wrapper `(phone, text, settings)`. Karena keduanya `function`, deklarasi kedua menang dan `module.exports.sendText` menunjuk ke wrapper. Baris 688 memanggil `sendText(sessionId, chatId, body, settings)` — binding yang sama = **rekursi tak berujung**.

Hasil eksekusi yang mereproduksi:
```
Panggil gateway.sendText("628123456789", "halo dunia")
  → argumen asli: phone=628123456789 (12 digit, VALID)
ERROR: RangeError | Maximum call stack size exceeded
fetch dipanggil 0 kali
```

- [ ] **Step 1: Tulis regression test yang gagal**

  Tambah di `scripts/wa-gateway.test.js`, **sebelum** blok `process.exit` terakhir. Suite ini wajib memanggil `gateway.sendText` **tanpa** mock — itulah inti regression-nya.

  ```js
  // ── Regression: sendText tidak boleh rekursif (bug B1) ──────────
  // Dua deklarasi `sendText` di scope modul yang sama menyebabkan
  // wrapper baris 666 memanggil dirinya sendiri → stack overflow.
  // Tes ini memanggil gateway.sendText NYATA (tanpa mock) dengan
  // fetch dipalsukan, lalu membuktikan request benar-benar terkirim.

  console.log('\n== Pengiriman pesan (regression B1) ==');
  await t('sendText tidak rekursif: request sampai ke endpoint send-text', async () => {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body });
      return {
        ok: true,
        status: 200,
        headers: {},
        text: async () => JSON.stringify({ messageId: 'msg-1' })
      };
    };
    try {
      // id session berformat UUID (persis seperti yang OpenWA hasilkan).
      gateway.applySession({
        id: 'a1b2c3d4-1234-5678-9abc-def012345678',
        name: 'seayoulatertrip',
        status: 'ready',
        phone: '628123456789',
        pushName: 'Tim'
      });
      const res = await gateway.sendText('628123456789', 'halo dunia');
      assert.ok(res && res.via === 'openwa', 'hasil harus punya via=openwa');
      assert.ok(res.jid === '628123456789@c.us', 'jid harus 628123456789@c.us, dapat ' + res.jid);
      assert.strictEqual(calls.length, 1, 'harus tepat 1 request HTTP, dapat ' + calls.length);
      assert.ok(
        calls[0].url.endsWith('/messages/send-text'),
        'URL harus /messages/send-text, dapat ' + calls[0].url
      );
      const body = JSON.parse(calls[0].body);
      assert.strictEqual(body.chatId, '628123456789@c.us');
      assert.strictEqual(body.text, 'halo dunia');
    } finally {
      global.fetch = realFetch;
    }
  });

  await t('sendTextViaSession ada dan tidak sama dengan sendText', () => {
    assert.strictEqual(typeof gateway.sendTextViaSession, 'function');
    assert.notStrictEqual(gateway.sendTextViaSession, gateway.sendText);
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/wa-gateway.test.js`
  Expected: suite "sendText tidak rekursif" GAGAL dengan pesan error `Maximum call stack size exceeded` (atau assertion `calls.length` bukan 1). Suite lain tetap lulus.

- [ ] **Step 3: Rename transport baris 439**

  Di `src/services/wa-gateway.js`, ubah baris 439 dari:

  ```js
  async function sendText(sessionId, chatId, text, settings) {
  ```

  menjadi:

  ```js
  async function sendTextViaSession(sessionId, chatId, text, settings) {
  ```

  dan perbarui JSDoc-nya: tambahkan baris `@param {string} sessionId id session OpenWA` — dan hapus ketiadaan `@param {string} chatId` yang tertukar.

- [ ] **Step 4: Ubah pemanggilan di baris 688**

  Di `src/services/wa-gateway.js`, di dalam wrapper `sendText(phone, text, settings)`, ubah:

  ```js
  const res = await sendText(sessionId, chatId, body, settings);
  ```

  menjadi:

  ```js
  const res = await sendTextViaSession(sessionId, chatId, body, settings);
  ```

- [ ] **Step 5: Tambahkan `sendTextViaSession` ke exports**

  Di `src/services/wa-gateway.js`, pada blok `module.exports`, tambahkan `sendTextViaSession,` tepat sebelum baris `sendText,`.

- [ ] **Step 6: Pastikan tidak ada deklarasi `sendText` ganda yang tersisa**

  Run: `grep -n "^async function sendText" src/services/wa-gateway.js`
  Expected: **tepat 2 baris** — satu `sendTextViaSession` (baris ~439) dan satu `sendText` (baris ~666). Kalau masih 3, ada deklarasi lain yang harus dibersihkan.

  Run juga: `grep -n "sendText" src/services/wa-gateway.js`
  Expected: baris 688 memanggil `sendTextViaSession`, bukan `sendText`.

- [ ] **Step 7: Jalankan test, pastikan LULUS**

  Run: `node scripts/wa-gateway.test.js`
  Expected: "Semua suite lulus" / tidak ada FAIL.

- [ ] **Step 8: Jalankan seluruh suite WA**

  Run: `npm test`
  Expected: "Semua suite lulus." (16 suite, termasuk `wa-gateway.test.js`).

- [ ] **Step 9: Verifikasi tidak ada suite baru yang gagal akibat rename**

  Run: `node scripts/wa-check.js`
  Expected: "Semua modul & template OK." dan "Penjaga: tidak ada sisa whatsapp-web.js / qrcode."

- [ ] **Step 10: Commit**

  ```bash
  git add src/services/wa-gateway.js scripts/wa-gateway.test.js
  git commit -m "fix(wa): perbaiki sendText rekursif yang membuat seluruh pengiriman gagal"
  ```

---
