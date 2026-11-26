# Audit Panel Admin + Rencana Redesign & Migrasi OpenWA

Repo: `D:\laragon\www\sabesi` (Express 4 + EJS + JSON file store)
Tanggal: 2026-11-13 · Semua temuan diverifikasi dengan boots server di port 4288 + browser nyata.

---

## A. Peta Halaman Admin

| # | Route | View | Catatan |
|---|---|---|---|
| 1 | `/admin` | `dashboard.ejs` | 5 stat card + 2 panel |
| 2 | `/admin/destinasi` | `destinations.ejs` | tabel + thumbnail |
| 3 | `/admin/destinasi/baru`, `/edit` | `destination-form.ejs` | gambar utama + galeri |
| 4 | `/admin/galeri` | `galeri.ejs` | UI galeri, **tanpa backend** |
| 5 | `/admin/paket`, `/baru`, `/edit` | `packages.ejs`, `package-form.ejs` | ada gambar |
| 6 | `/admin/artikel`, `/baru`, `/edit` | `articles.ejs`, `article-form.ejs` | ada cover |
| 7 | `/admin/booking`, `/:id` | `bookings.ejs`, `booking-detail.ejs` | **tidak ada bukti bayar** |
| 8 | `/admin/lokasi` | `lokasi.ejs` | peta Leaflet |
| 9 | `/admin/pelanggan` | `customers.ejs` | tanpa foto |
| 10 | `/admin/pesan` | `messages.ejs` | tanpa lampiran |
| 11 | `/admin/testimoni` | `testimoni.ejs` | tanpa foto |
| 12 | `/admin/marketing/kontak` | `contacts.ejs` | tanpa foto |
| 13 | `/admin/marketing/blast` | `blast.ejs` | teks saja |
| 14 | `/admin/marketing/whatsapp` | `whatsapp.ejs` | QR whatsapp-web.js |
| 15 | `/admin/marketing/pengingat` | `reminder.ejs` | teks saja |
| 16 | `/admin/social`, `/tulis`, `/riwayat` | `social*.ejs` | composer tanpa media |
| 17 | `/admin/seo` | `seo.ejs` | upload OG image |
| 18 | `/admin/pengaturan` | `settings.ejs` | logo, hero, tema, WA, presence, social |
| 19 | `/admin/akun` | `account.ejs` | ganti password saja |

---

## B. Temuan UI/UX (verifikasi langsung)

| # | Severity | Temuan | Bukti |
|---|---|---|---|
| Q1 | **Critical** | `.a-table-wrap` dipakai 7 halaman tapi **tidak pernah didefinisikan** di CSS mana pun → `overflow-x: visible` → tabel meluber keluar panel | `views/admin/blast.ejs:49`, `contacts.ejs:26`, `reminder.ejs:36,56,92`, `whatsapp.ejs:96,130`; `grep -rn "a-table-wrap" public/css/` → kosong. Terukur: `wrapOverflowX: "visible"`, `docScroll 699 > win 713` di 1280 |
| Q2 | **Critical** | `.admin-head` + `.admin-head__actions` dipakai 7 halaman, **tidak ada definisi CSS** → judul halaman & tombol aksi jadi blok teks tanpa hierarki | `blast.ejs:1`, `contacts.ejs:1`, `reminder.ejs:1`, `social*.ejs:1`, `whatsapp.ejs:1`; `grep -rn "\.admin-head" public/css/` → kosong |
| Q3 | **High** | Dua item sidebar aktif bersamaan. `/social` cocok dengan `/social/tulis` karena pakai `startsWith` | `views/layouts/admin.ejs:49-50`. Terverifikasi: `activeCount: 2`, active = `["🔗 Connect Social Media","✍ Tulis & Publikasikan"]` |
| Q4 | **High** | Overlay sidebar `z-index:95` > topbar `z-index:40` → di mobile overlay menutupi tombol menu | `public/css/admin.css:196` vs `:215` |
| Q5 | **High** | Sidebar off-canvas tidak focus-trap, tidak `inert` konten di belakang, tidak mengembalikan fokus ke pemicu | `views/layouts/admin.ejs:139-163` |
| Q6 | **Medium** | `.help` hanya terdefinisi di dalam `.a-field` → 13 pemakaian di luar `.a-field` tak bergaya (16px hitam, bukan 12px abu) | `public/css/admin.css:342`; dipakai di `settings.ejs:100,113,121,146,153,165`, `blast.ejs:38`, `reminder.ejs:83`, `account.ejs:13` |
| Q7 | **Medium** | Grid inline `grid-template-columns:2fr 1fr 1fr auto` di `booking-detail.ejs:68` → tidak pernah di-override media query, form waypoint tetap 4 kolom di 390px | `views/admin/booking-detail.ejs:68` |
| Q8 | **Medium** | 11 komponen `admin-components.css` **tidak pernah dipakai**: `a-section-title`, `a-switch`, `a-progress`, `a-skeleton`, `a-toast`, `a-tabs`, `a-drawer`, `a-icon-btn`, `a-segmented`, `a-kpi-row` (+ `.review-item__actions`) | `grep -rho` di `views/` → 0 hit |
| Q9 | **Medium** | `settings.ejs:176-179` indentasi `</form></div>` tidak seimbang → 2 dari 6 panel (Presence, Media Sosial) jatuh **di luar** `.panel-grid` | `views/admin/settings.ejs:176-179` |
| Q10 | **Medium** | Emoji sebagai ikon navigasi (🏝 ▣ 🎫 ✍ 📌 📡 👥 ✉ ⭐ 📇 📣 📱 ⏰ 🔗 🗓 🔎 ⚙ 👤) → tampilan tidak konsisten antar font/platform, bukan vektor | `views/layouts/admin.ejs:31-55` |
| Q11 | **Low** | `admin.css` (721 baris) = fallback, `admin-design.css` (266) = override, `admin-components.css` (567) = komponen baru → 3 sumber kebenaran token, mudah bentrok | `views/layouts/admin.ejs:11-14` |
| Q12 | **Low** | Tidak ada breadcrumb / konteks halaman selain `<h1>` di topbar | `views/layouts/admin.ejs:70` |

### Yang sudah working (jangan diutak-atik)
- Tabel → kartu bertumpuk di ≤640px, label kolom otomatis dari `<th>` via `admin-tables.js` ✅
- Off-canvas sidebar ≤900px, scroll lock, Escape ✅ (hanya kurang focus-trap)
- Token semantik + mode gelap hanya menimpa token ✅
- Kontras sidebar dijamin ≥4.59:1 untuk semua warna aksen ✅

---

## C. Audit Dukungan FOTO per Entitas

| Entitas | Field gambar di DB | Route upload | Widget form | Thumbnail tabel | Kekurangan |
|---|---|---|---|---|---|
| Destinasi | `image` + `gallery[]` | ✅ `admin.routes.js:248,289` | ✅ `destination-form.ejs:65,80` | ✅ `destinations.ejs:21` | — |
| Paket | `image` | ✅ `:424,456` | ✅ `package-form.ejs:64` | ✅ `packages.ejs:19` | — |
| Artikel | `coverImage` | ✅ `:515,545` | ✅ `article-form.ejs:31` | ✅ `articles.ejs:19` | — |
| Logo | `settings.logo` | ✅ `:925-929` | ✅ `settings.ejs:63` | — | — |
| Hero | `settings.heroImageUrl` | ✅ `:928-929` | ✅ `settings.ejs:77` | — | — |
| OG image | `settings.ogImageUrl` | ✅ `:1036` | ✅ `seo.ejs:15` | — | — |
| **Booking** | `proofImage` (seed `null`) | ❌ **tidak ada** | ❌ | ❌ | Field ada, jalur nol. Slot `proof` sudah ada di `image.js:50` tapi tak dipakai |
| **Galeri batch** | `destination.gallery` | ❌ **tidak ada** (`admin-gallery-suite.js` hanya simulasi) | UI ada (`galeri.ejs:101-119`) | — | UI jadi, backend nol |
| **Social post** | `channels[].images` | ❌ hardcoded `images: []` | ❌ | ❌ | `src/routes/social.routes.js:283` |
| **Testimoni** | ❌ | ❌ | ❌ | ❌ | Tidak ada kolom foto pelanggan |
| **Pelanggan** | ❌ | ❌ | ❌ | ❌ | Tidak ada avatar |
| **Pesan masuk** | ❌ | ❌ | ❌ | ❌ | Tidak ada lampiran |
| **Kontak marketing** | ❌ | ❌ | ❌ | ❌ | Tidak ada foto/kontak card |
| **User admin** | ❌ | ❌ | ❌ | ❌ | Tidak ada avatar, tidak ada CRUD user |
| Blast / Pengingat | ❌ | — | ❌ | — | Teks saja (WA blast memang teks) |

**Ringkas:** 7 entitas punya jalur foto utuh, 3 entitas punya **UI tanpa backend** (booking proof, galeri batch, social images), 6 entitas **tidak punya kolom gambar sama sekali**.

---

## D. Modul WhatsApp Saat Ini vs OpenWA

### Yang bisa dihapus wholesale

| File | Baris | Alasan |
|---|---|---|
| `src/services/wa-client.js` | 947 | Seluruh mesin whatsapp-web.js + Puppeteer + Chromium + lockfile management. Digantikan `wa-gateway.js` (~200 baris REST). |
| `src/services/wa_new.js` | 53 | Potongan `wa.js` yang disalin, **tidak di-require siapa pun** (`grep -rn wa_new` → kosong). Sampah. |
| `src/services/wa_new_deliverTo.js` | 39 | Sama — potongan `deliverTo`, tak terpakai. |
| `wa_old_deliverTo.txt` | — | Catatan lama. |
| `package.json`: `whatsapp-web.js`, `qrcode`, `puppeteer` | — | Setelah rewrite. `qrcode` masih di-require di `wa-client.js:547,667` → harus hilang baris itu. |

### Yang TIDAK berubah (kontrak publik)

`src/services/wa.js` (599 baris) — API publik dipakai 3 service + 1 route:

```
wa-worker.js:17   require('./wa')
wa-reminder.js:23 require('./wa')
wa-scheduler.js:19 require('./wa')
marketing.routes.js:6 require('../services/wa')
```

Fungsi yang dipakai: `isReady`, `isActive`, `canSend`, `isQuietHour`, `quietWindow`, `quietLabel`, `normalizeHour`, `normalizePhone`, `isValidPhone`, `renderTemplate`, `marketableContacts`, `segmentTargets`, `contactFor`, `sendText`, `sendVia`, `deliverTo`, `createBroadcastJob`, `startBroadcast`, `checkFrequencyCap`, `checkDailyLimit`, `logSend`, `MAX_PER_RUN`, `MIN_DELAY_MS`.

**Hanya 3 fungsi menyentuh `wa-client` secara langsung:**
- `wa.js:166` → `require('./wa-client').isReady()`
- `wa.js:335` → `require('./wa-client').sendText(...)`
- `wa.js:408` → `require('./wa-client').sendText(...)`

→ Ganti 3 baris itu dengan adapter OpenWA. `wa-worker`, `wa-reminder`, `wa-scheduler` **tidak berubah sama sekali**.

### Migrasi Inbound (pesan masuk + opt-out)

Hari ini: `wa-client.js:161 handleInbound()` dipanggil dari event `message` whatsapp-web.js, menyimpan ke `data.waInbound`, mendeteksi kata "berhenti" → set `contact.optOut = true`.

OpenWA: pesan masuk datang via **webhook**, bukan push dari library. Perlu:
- Route baru `POST /api/webhooks/openwa` → mount **sebelum** `express.json()` dengan `express.raw({type:'application/json'})` (body harus mentah untuk HMAC).
- Verifikasi `X-OpenWA-Signature` (HMAC-SHA256 atas body mentah) → 401 bila salah.
- Idempotensi via `X-OpenWA-Idempotency-Key` (dokumentasi sudah menyaltkan key per webhook, jadi 1 session = 1 key).
- Pindahkan logika `handleInbound` (simpan `waInbound` + deteksi opt-out) ke service baru yang menerima payload OpenWA (`data.body`, `data.from`, `data.fromMe`).

### Pemetaan API

| whatsapp-web.js | OpenWA | Catatan |
|---|---|---|
| `connect()` | `POST /api/sessions` + `POST /api/sessions/:id/start` | Engine hidup di luar proses Node |
| `getQr()` → PNG data URL | `GET /api/sessions/:id/qr` → `qrCode` data URL PNG | Sudah PNG, **jangan** bungkus ulang |
| `requestPairingCode(phone)` | `POST /api/sessions/:id/pairing-code` body `{phoneNumber}` | Kode 8 karakter |
| `sendText(phone, text)` | `POST /api/sessions/:id/messages/send-text` body `{chatId, text}` | `chatId` = `628xxx@c.us` |
| `logout()` | `POST /api/sessions/:id/logout` + `DELETE /api/sessions/:id` | OpenWA sudah hapus kredensial |
| `disconnect()` | `POST /api/sessions/:id/stop` | Tidak perlu matikan Chromium |
| `isReady()` | `GET /api/sessions/:id` → `status === 'ready'` | Status lowercase di wire |
| `onInbound(fn)` | webhook `message.received` | Perubahan arsitektur |

Status OpenWA: `created` → `initializing` → `qr_ready` → `authenticating` → `ready` / `disconnected` / `action_required` / `failed`.

### Prasyarat OpenWA (TERVERIFIKASI LIVE)

| Item | Status |
|---|---|
| Gateway hidup | ✅ `http://localhost:2785/api/health` → `{"status":"ok"}` |
| API key | ✅ ada di `D:\laragon\www\sanata\backend\.env` (`OPENWA_API_KEY`) — **perlu disalin ke `.env` sabesi** |
| Session | ✅ `wa-openwa-a` (`d214ea26-…`) & `wa-openwa-b` (`1882baea-…`) status `qr_ready` |
| QR endpoint | ✅ `GET /api/sessions/:id/qr` → `{"qrCode":"data:image/png;base64,…"}` |
| Jangkauan WSL → host Windows | ✅ `curl http://172.18.112.1:4288/` dari WSL → **200** (host bridge `172.18.112.1` hidup) |
| Webhook URL | ⚠️ pakai `http://172.18.112.1:4288/api/webhooks/openwa` + `OPENWA_WEBHOOK_SECRET` (min 16 karakter) + whitelist `SSRF_ALLOWED_HOSTS=172.18.112.1` di sisi OpenWA |

### Risiko

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | Body webhook ter-parse JSON → HMAC tidak cocok → semua delivery 401 | Mount router **sebelum** `express.json()` (`app.js:24`) dengan `express.raw()` |
| R2 | Nama session OpenWA hanya boleh `[A-Za-z0-9-]{1,50}` | Pakai nama tetap `seayoulatertrip` (tanpa underscore) |
| R3 | `sessionId` = UUID, bukan nama | Simpan id di `settings` atau mapbyname tiap poll |
| R4 | `chatId` wajib format JID | `normalizePhone()` → `${phone}@c.us` di adapter |
| R5 | OpenWA mati → blast/pengingin mati diam-diam | Timeout `AbortController` 20s + pesan error jelas + status badge "Gateway Offline" |
| R6 | `qrcode` dihapus tapi masih di-require | Hapus `wa-client.js:547,667` saat rewrite |
| R7 | Webhook belum terdaftar → inbound mati | `ensureWebhookRegistered()` saat session dibuat |
| R8 | Blast lama masih jalan saat migrasi | Job `data.broadcasts` menyimpan `cursor` → lanjut aman |

---

## E. Rekomendasi Arsitektur

### Layer baru

```
src/services/wa-gateway.js      (~200 baris)  Klien REST OpenWA murni
  - request(method, path, body)  dengan X-API-Key + timeout
  - findSessionByName / getSession / createSession / startSession
  - getQr / requestPairingCode / sendText / stopSession / logoutSession / deleteSession
  - createWebhook / listWebhooks / deleteWebhook
src/services/wa-gateway-webhook.js (~120 baris)
  - verifySignature(rawBody, header)  HMAC constant-time
  - handleInbound(payload)  simpan waInbound + deteksi opt-out "berhenti"
src/routes/openwa-webhook.routes.js  POST /api/webhooks/openwa (express.raw)
```

`wa.js` berubah **hanya 3 titik**: `isReady()`, `sendText()`, `sendVia()` — ketiganya memanggil adapter, bukan `wa-client`.

`server.js`: hapus blok `client.connect()` + `client.disconnect()`; ganti dengan `ensureSession()` yang mendaftarkan webhook.

### Pengaturan baru (settings scope `wa`)

| Key | Default | Fungsi |
|---|---|---|
| `openwaBaseUrl` | `http://localhost:2785` | Alamat gateway |
| `openwaSessionName` | `seayoulatertrip` | Nama session (hanya `[A-Za-z0-9-]`) |
| `openwaApiKey` | — | API key (dari `.env`, boleh disimpan di settings) |
| `openwaWebhookSecret` | — | Secret HMAC (min 16 karakter) |

### Test yang perlu disesuaikan

| Script | Aksi |
|---|---|
| `scripts/wa-lock.test.js` (8 kasus) | **Hapus** — menguji lockfile Chromium, tidak relevan |
| `scripts/wa-webjs-smoke.js` | **Hapus** — smoke test whatsapp-web.js |
| `scripts/wa-http.test.js` | Sesuaikan —stub `wa-gateway`, bukan `wa-client` |
| `scripts/wa-unit.test.js`, `wa-worker.test.js`, `wa-loop.test.js`, `wa-reminder.test.js` | Sesuaikan stub `require('./wa-client')` → stub `wa-gateway` |
| `scripts/wa-check.js` | Ganti target cek dari file whatsapp-web.js ke `wa-gateway.js` |
| `scripts/verify-wa-e2e.js` | Sesuaikan: punish blast via API mock gateway, **tetap wajib** nonaktifkan opt-out kontak via route admin (bukan tulis db.json) + snapshot/pulihkan `waQuietStart/End` |
| **Baru** `scripts/wa-gateway.test.js` | Unit test adapter: HMAC, normalisasi chatId, status mapping, timeout |
| **Baru** `scripts/verify-openwa-webhook.js` | E2E webhook: signature benar→200, salah→401, kembar→DUPLICATE, event tersimpan, opt-out terpicu |
| `scripts/wa-run-tests.js` | Update daftar suite |

---

## F. Gap Foto yang Harus Ditutup

| Prioritas | Entitas | Solusi |
|---|---|---|
| P1 | Booking — bukti transfer | Pakai slot `proof` yang sudah ada (`image.js:50`); tambah `singleImage('proofFile','proof')` di route create/edit booking; tampilkan di `booking-detail.ejs` + thumbnail di `bookings.ejs`. Hapus alur `awaiting_review` yang sudah tidak dipakai. |
| P1 | Galeri batch (`/admin/galeri`) | Tambahkan route `POST /admin/galeri/upload` (pakai `galleryImages('galleryFiles','card',8)`) + simpan ke `destination.gallery`; pasang `admin-gallery-suite.js` ke backend sungguhan (sekarang simulasi). |
| P2 | Social composer | Tambahkan upload media → isi `channels[].images` (Postiz sudah mendukung array `{id,path}`) |
| P2 | Testimoni | Tambah kolom `photo` pada entri testimoni + upload dari form moderasi → tampilkan avatar di beranda |
| P2 | Pelanggan | Tambah kolom `avatar` + upload di halaman detail pelanggan |
| P3 | Pesan masuk | Tambahkan `attachments[]` (satu field multi) → tampilkan di detail pesan |
| P3 | Kontak marketing | Tambah kolom `photo` (kontak card) — opsional |
| P3 | Admin user | Tambah kolom `avatar` + upload di `/admin/akun` → tampilkan di topbar & sidebar |
