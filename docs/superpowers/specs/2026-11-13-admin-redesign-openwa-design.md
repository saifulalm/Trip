# Design Doc — Redesign Panel Admin + Dukungan Foto + Migrasi WhatsApp ke OpenWA

Repo: `D:\laragon\www\sabesi` (Express 4 + EJS + express-ejs-layouts, data di `data/db.json`)
Tanggal: 2026-11-13
Status: **menunggu persetujuan** (gate brainstorming)

---

## 1. Tujuan & Alasan

Tiga permintaan yang digabung:

| Permintaan | Masalah nyata yang ditemukan di audit |
|---|---|
| Redesign panel admin agar modern & organized | 19 halaman, 3 lapis CSS, 2 class yang dipakai tapi **tidak pernah didefinisikan** (`.a-table-wrap`, `.admin-head`), 2 item sidebar aktif bersamaan, emoji sebagai ikon, `.help` tak bergaya di 13 tempat, 11 komponen CSS mati |
| Setiap content bisa pakai photo | 7 entitas sudah punya jalur foto utuh; **3 entitas punya UI tanpa backend** (booking proof, galeri batch, social images); **6 entitas tidak punya kolom gambar sama sekali** |
| Hapus modul WA lain, ganti OpenWA | `wa-client.js` (947 baris) menjalankan Chromium/Puppeteer **di dalam proses Node**; OpenWA sudah live di `localhost:2785` dan terjangkau dari WSL |

## 2. Goals / Non-goals / Anti-goals

**Goals**
- G1 — Panel admin terasa seperti dashboard SaaS modern: sidebar gelap permanen, KPI besar, tabel padat.
- G2 — Semua entitas konten punya jalur foto yang benar-benar berfungsi (upload → simpan → tampil).
- G3 — Chromium/Puppeteer hilang dari proses Node; seluruh WA lewat OpenWA REST + webhook.
- G4 — Zero regresi pada 19 halaman admin + 12 suite test yang ada.

**Non-goals**
- Tidak mengubah situs publik (kecuali testimonials/pelanggan yang tampil di portal).
- Tidak mengubah schema `data/db.json` secara breaking (penambahan field bersifat additive).
- Tidak mengubah Provider/Postiz selain tambahan endpoint upload.

**Anti-goals**
- ❌ Menulis ulang 21 template EJS dari nol.
- ❌ Memakai `express.raw` di router yang juga menerima form biasa.
- ❌ Menghapus `wa-worker` / `wa-reminder` / `wa-scheduler`.

---

## 3. Kendala (constraints)

| # | Kendala | Dampak |
|---|---|---|
| C1 | 3 lapis CSS sudah dipakai 90% template | Redesign harus **t Addition** (token override + class baru), bukan ganti nama class |
| C2 | Dark mode saat ini achieved by override token | Sidebar gelap permanen butuh token terpisah (`--a-sidebar-from/to` sudah ada) |
| C3 | `verifyCsrf` global skip multipart; `verifyCsrfAfterParse` dipakai | Route upload baru **wajib** lewat `singleImage`/`galleryImages` |
| C4 | `sharp.toFile()` menahan handle di Windows | Selalu `.toBuffer()` + `fs.writeFileSync` |
| C5 | OpenWA butuh API key role `operator` | API key dari `.env`, disimpan settings sebagai cadangan |
| C6 | Webhook HMAC butuh body mentah | Router WA **harus** mount sebelum `express.json()` (`app.js:24`) |
| C7 | Postiz butuh upload terpisah (`POST /public/v1/upload`) | Social images butuh 2 langkah, bukan base64 inline |
| C8 | Nama session OpenWA hanya `[A-Za-z0-9-]{1,50}` | `seayoulatertrip` OK, `seayoulatertrip_dev` **tidak** |
| C9 | Admin middleware `requireLogin` | Webhook WA tidak boleh lewat `requireLogin` — mount terpisah |

---

## 4. Pendekatan yang Dipertimbangkan

### A. Redesign

| Opsi | Trade-off |
|---|---|
| **A1 — Refine token + tambah layer baru** ✅ | Pertahankan signature visual, cepat, risiko rendah. Tambah `admin-shell.css` (layer 4) berisi sidebar gelap, dense table, KPI baru. 21 template mostly tak berubah, hanya yang butuh bagian baru. |
| A2 — Tulis ulang semua template | Marshal banyak, risiko regresi tinggi, rewrite dari nol sering turun kualitas |
| A3 — Tambah framework UI (Tailwind/shadcn) | Butuh build step, bertabrakan dengan 3 lapis CSS & EJS tanpa bundler |

**Pilih A1** —性价比 terbaik: signature visual tetap (identitas merek), dua class yang hilang diperbaiki, komponen mati dibuang, sidebar & tabel dirombak penuh.

### B. Migrasi WA

| Opsi | Trade-off |
|---|---|
| **B1 — Adapter penuh: `wa-gateway.js` + webhook** ✅ | `wa.js` berubah 3 titik; worker/reminder/scheduler **nol perubahan**; message inbound pindah ke webhook |
| B2 — Tulis ulang `wa-worker`/`wa-reminder` untuk OpenWA | Ganda usaha, 3 file lagi berubah, tidak perlu |
| B3 — Hybrid: blast via OpenWA, QR scan tetap wweb.js | Dua sistem hidup bersamaan, dual maintenance, tidak ada gunanya |

**Pilih B1.**

---

## 5. Desain — Bagian 1: Shell Admin (G1)

### 5.1 Layer CSS baru

`public/css/admin-shell.css` — **layer 4**, dimuat setelah `admin-components.css`.

```
views/layouts/admin.ejs:11-14
  admin.css → admin-design.css → admin-components.css → admin-gallery.css → admin-shell.css
```

Isi layer 4 (semua override, tanpa menghapus class lama):

**Token baru**
```css
:root {
  --a-shell-sidebar-w: 264px;
  --a-shell-topbar-h: 68px;
  --a-shell-density: 0.86;          /* multiplier tinggi baris tabel */
  --a-shell-row-h: 44px;
  --a-shell-kpi-h: 116px;
}
```

**Sidebar gelap permanen** — gradasi aksen yang sudah dijamin gelap oleh `theme.js` (`shadeAmountForLuminance` cap 0.04) dipakai ulang, plus lapisan solid:
```css
.admin-sidebar {
  width: var(--a-shell-sidebar-w);
  background:
    linear-gradient(180deg, var(--a-sidebar-from), var(--a-sidebar-to));
  box-shadow: inset -1px 0 0 rgba(255,255,255,0.06);
}
```
Mode terang & gelap memakai token yang sama → tidak ada aturan duplikat.

**Density tabel**
```css
.a-table th { padding: 0.55rem 0.75rem; font-size: 0.68rem; }
.a-table td { padding: 0.6rem 0.75rem; font-size: 0.85rem; height: var(--a-shell-row-h); }
```

**KPI besar** (ganti `.stat-card` di dashboard)
```css
.a-kpi {
  display: grid; gap: 0.4rem;
  min-height: var(--a-shell-kpi-h);
  padding: 1.1rem 1.25rem;
  border-radius: var(--a-radius-lg);
  background: var(--a-surface-1);
  border: 1px solid var(--a-line);
  box-shadow: var(--a-shadow-1);
}
.a-kpi__value { font-family: var(--a-display); font-size: 2.4rem; line-height: 1; }
.a-kpi__delta { font-size: 0.75rem; color: var(--a-soft); }
```

### 5.2 Class yang dipasang (fix Q1, Q2, Q6)

| Class | Definisi | Pemakai |
|---|---|---|
| `.a-table-wrap` | `overflow-x: auto; margin: 0 -0.25rem; padding: 0 0.25rem;` | 7 halaman yang sudah memakainya |
| `.admin-head` | `display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; margin-bottom:1.4rem;` | 7 halaman |
| `.admin-head h1` | `font-family: var(--a-display); font-size: 1.6rem;` | — |
| `.admin-head p` | `color: var(--a-soft); font-size: 0.9rem; max-width: 62ch; margin-top: 0.25rem;` | — |
| `.admin-head__actions` | `display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center;` | — |
| `.help` (global) | `font-size: 0.78rem; color: var(--a-soft); line-height:1.5;` | 13 pemakaian luar `.a-field` |

### 5.3 Sidebar

- **Ikon SVG inline** menggantikan emoji. Satu file `views/admin/partials/nav-icon.ejs` berisi 19 ikon SVG 20×20 stroke-currentColor.
- **Group label** tetap, tapi diperjelas: uppercase, `letter-spacing: 0.14em`, `font-size: 0.68rem`.
- **Active state** diperbaiki: pakai **persis sama** (bukan `startsWith`) → `adminPath === '/social'` vs `startsWith('/social/tulis')`. Didesain ulang: cukup 1 item aktif.
  ```
  /admin/social        → active: "Connect Social Media"
  /admin/social/tulis  → active: "Tulis & Publikasikan"
  ```
  Implementasi: helper `navActive(adminPath, prefix, exact)` di `src/utils/helpers.js`, atau cukup `adminPath.startsWith('/social/tulis') ? ... : adminPath === '/social'`.
- **Badge jumlah** pada menu (mis. booking pending, pesan belum dibaca) → mengisi "organized" & memberi sinyal aksi.
- **Focus trap** di off-canvas: `inert` pada `.admin-main` saat terbuka, focus dikembalikan ke `#adminMenuBtn` saat ditutup, Tab cycling di dalam sidebar.

### 5.4 Topbar & breadcrumb

- Topbar: breadcrumb `Marketing › Blast WhatsApp` (dari `adminPath`), tombol "Lihat Situs", toggle tema, avatar.
- Avatar user: pakai `settings.userAvatar` bila ada (lihat bagian foto), fallback inisial.

### 5.5 Dashboard

- 5 KPI besar (`.a-kpi`): Booking Menunggu, Pesan Belum Dibaca, Destinasi, Paket Aktif, Artikel — masing-masing dengan ikon + delta.
- Grid 2 kolom: Booking Terbaru (tabel dense) | Pesan Terbaru (list).
- Panel status WhatsApp (OpenWA): badge "Gateway Online / Offline", session status, jumlah antrean blast.

---

## 6. Desain — Bagian 2: Dukungan Foto (G2)

### 6.1 Slot gambar baru (`src/services/image.js`)

Tambah 2 slot:

| Slot | Rasio | Pemakaian |
|---|---|---|
| `avatar` | 512×512 `contain` + alpha | pelanggan, testimoni, user admin, kontak |
| `media` | 1200×1200 `inside` | lampiran pesan, media social (Postiz butuh URL) |

`proof` (1600×1600 `inside`) **sudah ada** dan belum dipakai → dipakai untuk bukti transfer.

### 6.2 Peta entitas → perubahan

| Entitas | Kolom DB baru | Route | Widget | Tampil di |
|---|---|---|---|---|
| **Booking** | `proofImage` (sudah ada di seed, selalu `null`) | `POST /admin/booking/:id/proof` → `singleImage('proofFile','proof')` | partial baru `partials/image-upload` (sudah ada, tinggal pakai) | `booking-detail.ejs` panel "Bukti Transfer" + thumbnail di `bookings.ejs` |
| **Galeri batch** | `destination.gallery[]` (sudah ada) | `POST /admin/galeri/upload` → `galleryImages('galleryFiles','card',8)` + `POST /admin/galeri/simpan` (urutan & hapus) | `galeri.ejs` disambungkan ke backend | grid galeri + urutan drag tersimpan |
| **Social composer** | `channels[].images[]` | `POST /admin/social/upload` → proses local (`slot: 'media'`) lalu **upload ke Postiz** `POST /public/v1/upload` (multipart `file=@…`) → dapat `{id, path}` | composer punya dropzone multi | `social-history.ejs` thumbnail post |
| **Testimoni** | `review.photo` | `POST /admin/testimoni/:id/foto` → `singleImage('photoFile','avatar')` | tombol "Unggah foto pelanggan" di item testimoni | avatar di baris testimoni + portal pelanggan |
| **Pelanggan** | `customer.avatar` | `POST /admin/pelanggan/:id/avatar` → `singleImage('avatarFile','avatar')` | upload di halaman pelanggan | avatar di `customers.ejs` + topbar saat login sebagai pelanggan |
| **Pesan masuk** | `message.attachments[]` | `POST /admin/pesan/:id/lampiran` → `galleryImages('attachmentFiles','media',4)` | tombol lampir di baris pesan | strip lampiran di baris pesan |
| **Kontak marketing** | `contact.photo` | `POST /admin/marketing/kontak/:id/foto` → `singleImage('photoFile','avatar')` | upload di baris kontak | avatar di `contacts.ejs` |
| **User admin** | `user.avatar` | `POST /admin/akun/avatar` → `singleImage('avatarFile','avatar')` | upload di `/admin/akun` | avatar topbar + sidebar |

### 6.3 Prinsip implementasi

1. **Semua unggahan lewat `src/middleware/upload.js`** — tidak ada diskStorage, magic byte dicek, output WebP.
2. **Path traversal aman** — `removeUpload` sudah pakai `path.basename`.
3. **Berkas yatim** — setiap route memanggil `cleanupUploads(req)` saat validasi gagal (pola sudah ada di `admin.routes.js`).
4. **Hapus berkas lama saat replace** — `removeUploadByUrl(url lama)` sebelum menimpa.
5. **Kolom baru di DB bersifat additive** — entri lama tanpa field tetap valid (`undefined` → render fallback).

### 6.4 Galeri batch (gap paling memalukan)

`:galeri.ejs` saat ini punya UI drag-drop (`gallery-upload-bundle`) tapi **tidak ada `<form>` dan tidak ada route**. Rencana:
- `POST /admin/galeri/upload` (multer `galleryImages('galleryFiles','card',8)`) → simpan hasil ke `req.session.pendingGallery` (file sementara) → balikin JSON `{files:[{filename,url}]}`.
- `POST /admin/galeri/simpan` body `{destinationId, files:[url…], order:[url…]}` → gabung ke `destination.gallery`, tulis db.
- `admin-gallery-suite.js` saat ini simulasi WebP di browser (`public/js/admin-gallery-suite.js:160`) → diubah agar POST beneran ke route di atas.

---

## 7. Desain — Bagian 3: Migrasi WhatsApp ke OpenWA (G3)

### 7.1 File baru

```
src/services/wa-gateway.js          (~220 baris)  Klien REST OpenWA murni
src/services/wa-gateway-webhook.js  (~130 baris)  Verifikasi HMAC + logika inbound
src/routes/openwa-webhook.routes.js (~60 baris)   POST /api/webhooks/openwa
```

### 7.2 `wa-gateway.js` — API

```js
request(method, path, body)      // X-API-Key + AbortController timeout 20s
healthCheck()
listSessions(name?)
findSessionByName(name)
getSession(id)
createSession(name)              // nama HARUS [A-Za-z0-9-]{1,50}
startSession(id)
getQr(id)                        // → { qrCode: 'data:image/png;base64,…' }
requestPairingCode(id, phoneNumber)
sendText(id, chatId, text)
stopSession(id)
logoutSession(id)
deleteSession(id)
createWebhook(id, {url, events, secret, retryCount})
listWebhooks(id)
deleteWebhook(id, webhookId)
```

Semua error dilempar sebagai `OpenwaError { message, statusCode, code }` — pesan asli gateway dibiarkan terbaca (bukan "Internal server error").

### 7.3 `wa-gateway-webhook.js`

```js
verifySignature(rawBody, header)      // HMAC-SHA256 atas body mentah, constant-time
handleInbound(payload)                // simpan ke data.waInbound + deteksi opt-out "berhenti"
```

Logika `handleInbound` **dipindahkan** dari `wa-client.js:161-201` dengan pemetaan field:

| whatsapp-web.js | OpenWA `data` |
|---|---|
| `msg.from` | `data.from` (`628xxx@c.us`) |
| `msg.body` | `data.body` |
| `msg.fromMe` | `data.fromMe` |
| grup | `data.isGroup === true` → skip |
| `msg._data.notifyName` | `data.author` / ambil dari `data.pushName` bila ada |

Idempotensi: `X-OpenWA-Idempotency-Key` → disimpan di `data.waInboundEvents[]` (array id, dibatasi 500). Key kembar → balas `200 {status:'DUPLICATE'}`.

### 7.4 Mount route webhook (WAJIB urutan benar)

**Tepatnya, mount di `src/app.js` SEBELUM `app.use(express.json())` (baris 24), tapi SESUDAH `app.use(session(...))` (baris 28) supaya `req.session` tetap tersedia bila perlu.**

```js
// src/app.js — sisipkan DI ANTARA app.use(session(...)) dan app.use(express.json())
app.use('/api/webhooks/openwa', require('./routes/openwa-webhook.routes'));
```

**Kenapa harus sebelum `express.json()`:** HMAC OpenWA dihitung atas **byte mentah** body. Kalau JSON parser berjalan lebih dulu, body di-parse lalu di-stringify ulang → urutan kunci berubah → signature tidak pernah cocok → **semua delivery ditolak 401** (pesan masuk & opt-out otomatis mati diam-diam). Pola yang sama sudah dipakai `sanata/backend/src/app.ts:32-37`.

Router itu sendiri memakai `express.raw({ type: 'application/json', limit: '2mb' })`.

**Kenapa `express.raw` tidak menyediakan `req.body` sebagai objek:** harus `Buffer.isBuffer(req.body)` → `req.body.toString('utf8')` untuk HMAC, lalu `JSON.parse` setelah signature lolos.

**Kenapa tidak perlu menambah skip di `verifyCsrf`:** `verifyCsrf` (baris 38) berada DI BAWAH mount webhook. Karena route webhook sudah Handle response dan menghentikan chain, `verifyCsrf` **tidak pernah dipanggil** untuk request webhook — sama seperti yang terjadi pada `POST /payment/webhook/ipaymu` (yang punya skip eksplisit di `security.js:18` sebagai jaring pengaman tambahan). Untuk belt-and-suspenders, tambahkan skip `req.path.startsWith('/api/webhooks/')` di `src/middleware/security.js` — biayanya nol, dan mencegah route webhookokatakut salah mount di masa depan.

**Aturan**: `POST /api/webhooks/openwa` **wajib** punya `express.raw`, dan **dilarang** punya `express.json` di chain yang sama.

### 7.5 Perubahan pada `wa.js` (hanya 3 titik)

| Lokasi | Sebelum | Sesudah |
|---|---|---|
| `wa.js:166` (`isReady`) | `require('./wa-client').isReady()` | `require('./wa-gateway').isSessionReady()` (cache 15 detik) |
| `wa.js:335` (`sendText`) | `require('./wa-client').sendText(phone, text)` | `gateway.sendText(sessionId, `${phone}@c.us`, text)` |
| `wa.js:408` (`sendVia`) | idem | idem |

**`wa-worker.js`, `wa-reminder.js`, `wa-scheduler.js` → nol perubahan.**

### 7.6 Perubahan `server.js`

Hapus:
```js
const client = require('./src/services/wa-client');
client.connect()...
await client.disconnect();
```
Ganti:
```js
const gateway = require('./src/services/wa-gateway');
await gateway.ensureSession();      // buat session + start + daftarkan webhook (idempoten)
```
`worker.start()` + `scheduler.start()` **tetap**.

`ensureSession()`:
1. Cari session by name `seayoulatertrip` di OpenWA (`GET /api/sessions?name=…`).
2. Bila tidak ada → `POST /api/sessions` dengan nama itu.
3. Bila status bukan `ready` → `POST /api/sessions/:id/start` (toleransi 400 = sudah jalan).
4. Daftarkan webhook `POST /api/sessions/:id/webhooks` dengan `{url: OPENWA_WEBHOOK_URL, events:['message.received','session.status'], secret: OPENWA_WEBHOOK_SECRET}` — idempoten: `GET /api/sessions/:id/webhooks` dulu, jangan daftarkan dua kali.

### 7.7 Perubahan halaman admin WA

| Halaman | Perubahan |
|---|---|
| `/admin/marketing/whatsapp` (`whatsapp.ejs`) | Judul → "Perangkat WhatsApp (OpenWA)". Panel 1: status gateway (health), session, QR. Panel 2: uji kirim. Panel 3: status pengiriman (worker/antrean) — tetap. Panel 4: inbox — sumbernya sekarang webhook (`data.waInbound`). Hapus `waState.me/phone` (OpenWA punya `pushName`/`phone`). |
| `/admin/marketing/blast` | Badge kanal: "OpenWA: siap" bukan "Perangkat WhatsApp Web". |
| `/admin/marketing/pengingat` | Sama. |
| `/admin/pengaturan` scope `wa` | Ganti teks "memakai whatsapp-web.js" → "OpenWA gateway (self-hosted)". Tambah field: `openwaBaseUrl`, `openwaSessionName`, `openwaApiKey` (password), `openwaWebhookSecret` (password), `openwaWebhookUrl`. |

### 7.8 Pengaturan baru

| Key | Default | Sumber |
|---|---|---|
| `openwaBaseUrl` | `http://localhost:2785` | `.env` `OPENWA_BASE_URL` |
| `openwaApiKey` | — | `.env` `OPENWA_API_KEY` (fallback settings) |
| `openwaSessionName` | `seayoulatertrip` | settings |
| `openwaWebhookSecret` | — | `.env` `OPENWA_WEBHOOK_SECRET` (min 16 karakter) |
| `openwaWebhookUrl` | `http://172.18.112.1:4288/api/webhooks/openwa` | `.env` `OPENWA_WEBHOOK_URL` |

### 7.9 File yang dihapus

| File | Alasan |
|---|---|
| `src/services/wa-client.js` (947) | Digantikan `wa-gateway.js` |
| `src/services/wa_new.js` (53) | Sampah — `grep -rn wa_new` → 0 pemakai |
| `src/services/wa_new_deliverTo.js` (39) | Sampah — potongan `deliverTo` |
| `wa_old_deliverTo.txt` | Catatan lama |
| `scripts/wa-lock.test.js` | Menguji lockfile Chromium — tidak relevan |
| `scripts/wa-webjs-smoke.js` | Smoke test whatsapp-web.js |
| `package.json`: `whatsapp-web.js`, `qrcode`, `puppeteer` | Setelah rewrite (`qrcode` di-require di `wa-client.js:547,667` — ikut hilang) |

### 7.10 Test

| Script | Aksi |
|---|---|
| `scripts/wa-unit.test.js`, `wa-worker.test.js`, `wa-loop.test.js`, `wa-reminder.test.js` | Ganti stub `require('./wa-client')` → stub `wa-gateway` (`isSessionReady`, `sendText`) |
| `scripts/wa-http.test.js` | Stub gateway, bukan client |
| `scripts/wa-check.js` | Target cek → `wa-gateway.js` |
| `scripts/verify-wa-e2e.js` | Blast via gateway stub/mock. **Tetap wajib**: nonaktifkan opt-out kontak lewat route admin (`POST /admin/marketing/kontak/:id/toggle`), snapshot + pulihkan `waQuietStart/End` |
| **BARU** `scripts/wa-gateway.test.js` | Unit: HMAC constant-time, normalisasi `chatId` (`628…@c.us`), mapping status OpenWA→internal, timeout → 503, nama session invalid → error jelas |
| **BARU** `scripts/verify-openwa-webhook.js` | E2E webhook: signature benar→200, salah→401, kembar→DUPLICATE, body rusak→400, event tersimpan, opt-out terpicu |
| `scripts/wa-run-tests.js` | Update daftar suite |

---

## 8. Kontrak Public API (tidak berubah)

`src/services/wa.js` tetap mengekspor (dipakai 3 service + 1 route):
`config`, `isActive`, `isQuietHour`, `quietWindow`, `quietLabel`, `normalizeHour`, `isReady`, `canSend`, `isValidPhone`, `renderTemplate`, `normalizePhone`, `marketableContacts`, `segmentTargets`, `contactFor`, `sendText`, `sendVia`, `deliverTo`, `createBroadcastJob`, `startBroadcast`, `checkFrequencyCap`, `checkDailyLimit`, `logSend`, `MAX_PER_RUN`, `MIN_DELAY_MS`.

`src/services/wa-worker.js`, `wa-reminder.js`, `wa-scheduler.js` → **nol perubahan**.

---

## 9. Urutan Eksekusi (5 tahap, tiap tahap rollback-able)

### Tahap 0 — Persiapan OpenWA (verifikasi, belum ada kode)
1. Salin `OPENWA_API_KEY` + `OPENWA_WEBHOOK_SECRET` dari `sanata/backend/.env` ke `sabesi/.env`.
2. Daftarkan `SSRF_ALLOWED_HOSTS=172.18.112.1` di `.env` OpenWA (WSL) bila belum.
3. Verifikasi `curl http://172.18.112.1:4288/` dari WSL → 200 (sudah terbukti ✅).

### Tahap 1 — Fondasi shell admin
1. `public/css/admin-shell.css` (layer 4) + link di `admin.ejs`.
2. Definisi `.a-table-wrap`, `.admin-head`, `.help` global.
3. Perbaiki active-state sidebar (1 item aktif).
4. Breadcrumb + badge jumlah di sidebar.
5. **Verifikasi**: `scripts/verify-admin-pages.js` (semua halaman 200) + screenshot browser 1280/1024/768/390 + `elementFromPoint` cek overlay.

### Tahap 2 — Redesign shell & dashboard
1. Ikon SVG (`partials/nav-icon.ejs`), buang emoji.
2. Sidebar gelap permanen + focus trap + `inert`.
3. KPI dashboard `.a-kpi`.
4. Rapikan `settings.ejs:176-179` (indentasi) → semua panel masuk `.panel-grid`.
5. **Verifikasi**: `scripts/verify-admin-audit.js` + `npm test` + kontras numerik sidebar (≥4.5:1) + audit mode gelap.

### Tahap 3 — Dukungan foto (semua entitas)
1. Tambah slot `avatar` & `media` di `image.js`.
2. Booking proof → route + form + display.
3. Galeri batch → route upload + simpan + hubungkan `admin-gallery-suite.js`.
4. Social composer → upload lokal + upload ke Postiz + thumbnail riwayat.
5. Testimoni, Pelanggan, Pesan (lampiran), Kontak, User avatar.
6. **Verifikasi**: `scripts/verify-upload.js` (siklus buat→edit→hapus), `scripts/verify-upload-invalid.js`, cek `public/uploads/` bersih, plus uji tiap entitas baru.

### Tahap 4 — Migrasi WhatsApp ke OpenWA
1. `wa-gateway.js` + `wa-gateway-webhook.js` + `openwa-webhook.routes.js`.
2. Mount webhook **sebelum** `express.json()`.
3. Ubah 3 titik di `wa.js`.
4. Ubah `server.js` (`ensureSession`).
5. Rewrite `whatsapp.ejs` + teks Pengaturan WA.
6. **Verifikasi**: `npm test` (semua suite), `scripts/wa-gateway.test.js`, `scripts/verify-openwa-webhook.js`, uji blast nyata ke 1 nomor (self-test), uji inbound nyata.

### Tahap 5 — Pembersihan
1. Hapus `wa-client.js`, `wa_new.js`, `wa_new_deliverTo.js`, `wa_old_deliverTo.txt`, `wa-lock.test.js`, `wa-webjs-smoke.js`.
2. Hapus dependency `whatsapp-web.js`, `qrcode`, `puppeteer` dari `package.json`.
3. `npm install` → pastikan `node_modules` bersih dari Chromium.
4. **Verifikasi**: `npm test` penuh + `npm start` + boot server di port baru + cek `data/wa-session/` tidak lagi dipakai.

---

## 10. Verifikasi (WAJIB, angka bukan asumsi)

| Cek | Cara | Target |
|---|---|---|
| Semua halaman admin 200 | `scripts/verify-admin-pages.js` | 19/19 |
| Tabel tidak meluber | `document.documentElement.scrollWidth === clientWidth` di 1440/1024/768/390 | 0 overflow |
| Tabel → kartu mobile | `getComputedStyle(td).display === 'grid'`, `data-label` terisi | ≤640px |
| Sidebar 1 item aktif | hitung `.admin-nav a.active` | == 1 |
| Overlay tak menutupi tombol menu | `elementFromPoint` di tengah tombol | return elemen menu |
| Kontras sidebar | luminance + komposit alpha (skill `scripts/wcag-contrast.js`) | ≥ 4.5:1 semua aksen |
| Mode gelap | token override, tak ada aturan baru | semua token punya pasangan gelap |
| Unggah foto | `scripts/verify-upload.js` + `verify-upload-invalid.js` | siklus penuh, 0 berkas yatim |
| HMAC webhook | signature benar/salah/kembar | 200/401/DUPLICATE |
| Blast & pengingat | `scripts/verify-wa-e2e.js` + blast nyata 1 nomor | terkirim |
| Inbound WA | pesan nyata dari nomor terpaut | masuk `data.waInbound` + opt-out aktif |
| Suite penuh | `npm test` | "Semua suite lulus." |
| Chromium hilang | `grep -rn "puppeteer\|whatsapp-web" src/ scripts/ package.json` | 0 hit |

---

## 11. Yang Tertinggal untuk Builder

| # | Item | Catatan |
|---|---|---|
| B1 | Kontrak API Postiz `POST /public/v1/upload` | Sudah terverifikasi dari dokumentasi resmi; butuh uji nyata ke instance Postiz (belum aktif di repo ini — `settings.postizBaseUrl` kosong). Kalau Postiz tak aktif, sosmed tetap jalan **tanpa** media (graceful degrade). |
| B2 | `sessionName` OpenWA | Caller bisa ganti dari Pengaturan; default `seayoulatertrip`. Nama dengan `_` ditolak gateway → validasi sebelum kirim. |
| B3 | Placeholder foto untuk entri lama | Entri tanpa field gambar → render placeholder inisial / ikon, bukan gambar rusak. |
| B4 | Migrasi `data.db.json` | Tidak perlu migrasi data (field baru additive). Cukup jalankan `npm run seed --force` bila ingin data contoh dengan foto. |
| B5 | `.audit/` | Artefak audit sementara sudah dibersihkan. Laporan audit tetap di `docs/audit-admin-redesign-openwa.md`. |

---

## 12. Ringkasan keputusan yang sudah diambil

| Pertanyaan | Jawaban |
|---|---|
| Gaya visual | **Modern dashboard SaaS** — dark-first, sidebar gelap permanen, KPI besar, dense data table |
| Cakupan foto | **Semua** — Booking proof, Galeri batch, Social images, Testimoni, Pelanggan, Pesan, User avatar (Kontak sekalian) |
| Migrasi WA | **Sekarang juga** — migrasi penuh ke OpenWA, hapus `whatsapp-web.js` & Chromium |
| Gaya kerja | Tambah layer CSS baru (bukan tulis ulang), tambah service (bukan ganti kontrak), migrasi bertahap 5 tahap |
