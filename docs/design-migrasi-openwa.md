# Migrasi Modul WhatsApp → OpenWA (Full Cut-Over)

Repo: `D:\laragon\www\sabesi` · Tanggal: 2026-11-14
Status: **disetujui** (pengguna memilih "Full cut-over")

---

## 1. Tujuan

Ganti satu-satunya kanal WhatsApp dari **whatsapp-web.js** (Chromium/Puppeteer
di dalam proses Node) menjadi **OpenWA** — gateway self-hosted yang berdiri
sendiri, diakses lewat REST API + webhook.

Setelah migrasi:

- Tidak ada lagi Chromium, Puppeteer, atau `lockfile` profil di server.
- `whatsapp-web.js` + `qrcode` dihapus dari `package.json`.
- Blast, pengingat otomatis, pesan masuk, dan deteksi opt-out "berhenti"
  tetap berfungsi — lewat mekanisme yang berbeda, bukan lewat socket in-process.

## 2. Yang TIDAK berubah (kontrak publik)

`src/services/wa.js` (599 baris) tetap mengekspos API yang sama. File-file ini
tidak berubah bentuk pemanggilannya:

| Pemanggil | Fungsi yang dipakai |
|---|---|
| `src/services/wa-worker.js` | `isQuietHour`, `quietLabel`, `canSend`, `renderTemplate`, `deliverTo`, `MIN_DELAY_MS` |
| `src/services/wa-reminder.js` | `canSend`, `isQuietHour`, `quietLabel`, `normalizePhone`, `renderTemplate`, `sendVia` |
| `src/services/wa-scheduler.js` | `canSend` |
| `src/routes/marketing.routes.js` | `isReady`, `isQuietHour`, `quietLabel`, `normalizePhone`, `isValidPhone`, `MAX_PER_RUN`, `MIN_DELAY_MS`, `marketableContacts`, `segmentTargets`, `startBroadcast` |

Tiga titik di `wa.js` yang menyentuh `wa-client` diganti menjadi `wa-gateway`:

| Lokasi | Sebelum | Sesudah |
|---|---|---|
| `wa.js:166` (`isReady`) | `client.isReady()` | `gateway.isReady()` — status cache OpenWA |
| `wa.js:335` (`sendText`) | `client.sendText(phone, text)` | `gateway.sendText(phone, text)` |
| `wa.js:408` (`sendVia`) | `client.sendText(phone, text)` | `gateway.sendText(phone, text)` |

## 3. Arsitektur baru

```
src/services/wa-gateway.js          Klien REST OpenWA (transport murni)
src/services/wa-gateway-webhook.js  Verifikasi HMAC + handleInbound (waInbound + opt-out)
src/routes/openwa-webhook.routes.js POST /api/webhooks/openwa (express.raw)
```

### 3.1 Kontrak OpenWA (verifikasi terhadap source `/var/www/OpenWA`, v0.30.0)

|咀 WhatsApp Web (lama) | OpenWA (baru) | Catatan |
|---|---|---|
| `connect()` | `POST /api/sessions` + `POST /api/sessions/:id/start` | Engine hidup di luar proses Node |
| `getQr()` → PNG dirender sendiri | `GET /api/sessions/:id/qr` → `{ qrCode: "data:image/png;base64,…" }` | **sudah PNG** — jangan bungkus ulang |
| `requestPairingCode(phone)` | `POST /api/sessions/:id/pairing-code` body `{ phoneNumber }` → `{ pairingCode }` | kode 8 karakter |
| `sendText(phone, text)` | `POST /api/sessions/:id/messages/send-text` body `{ chatId, text }` | `chatId` = `628…@c.us` |
| `logout()` | `POST /api/sessions/:id/logout` | gateway sudah hapus kredensial |
| `disconnect()` | `POST /api/sessions/:id/stop` | tidak perlu matikan Chromium |
| `isReady()` | `GET /api/sessions/:id` → `status === 'ready'` | status lowercase di wire |
| `onInbound(fn)` | webhook `message.received` | **perubahan arsitektur** |

Header autentikasi: `X-API-Key: <key>` (tanpa "Bearer").

Status session OpenWA: `created` → `initializing` → `qr_ready` →
`authenticating` → `ready` / `disconnected` / `action_required` / `failed`.

### 3.2 Kontrak webhook (verifikasi terhadap source OpenWA)

- Signature: `X-OpenWA-Signature: sha256=<hex>` — HMAC-SHA256 atas **body
  mentah yang sudah di-stringify** oleh gateway. Sumber:
  `src/modules/webhook/utils/deliver-once.ts:52-56` (`generateSignature`).
- Header lain: `X-OpenWA-Event`, `X-OpenWA-Idempotency-Key` (stabil antar
  retry), `X-OpenWA-Delivery-Id` (baru tiap retry), `X-OpenWA-Retry-Count`.
- Body: `{ event, timestamp, sessionId, idempotencyKey, deliveryId, data }`.
  Sumber: `webhook-delivery.service.ts:35-42` (`WebhookPayload`).
- `data` untuk `message.received` berisi `from` (JID), `chatId`, `body`,
  `type`, `fromMe`, `isGroup`, `contact.pushName`.
  Sumber: `engine/interfaces/whatsapp-engine.interface.ts:100-202`.

**Kritical**: HMAC dihitung atas byte yang persis sama dengan yang dikirim.
Karena itu route webhook wajib memakai `express.raw()` dan **mounted sebelum
`express.json()`** di `src/app.js`. Kalau body di-parse lalu di-stringify
ulang, urutan kunci berubah dan signature tidak cocok — semua delivery ditolak.

### 3.3 Idempotensi

`X-OpenWA-Idempotency-Key` disimpan di `data.waWebhookEvents` (tabel JSON).
Kunci yang sudah ada → balas 200 dengan `status: "DUPLICATE"` supaya OpenWA
berhenti retry. Tanpa header idempotensi, fallback ke HMAC hash atas isi
payload (event kembar tetap dikenali karena isinya identik).

### 3.4 Nama session

OpenWA hanya menerima nama `[A-Za-z0-9-]{1,50}` (underscore DITOLAK).
Bawaan: `seayoulatertrip`.

## 4. Konfigurasi

Sumber nilai (urutan prioritas):

| Field | settings (Pengaturan) | env | bawaan |
|---|---|---|---|
| `openwaBaseUrl` | ✓ | `OPENWA_BASE_URL` | `http://localhost:2785` |
| `openwaSessionName` | ✓ | `OPENWA_SESSION_NAME` | `seayoulatertrip` |
| `openwaApiKey` | ✓ | `OPENWA_API_KEY` | — |
| `openwaWebhookSecret` | ✓ | `OPENWA_WEBHOOK_SECRET` | — |
| `openwaWebhookUrl` | ✓ | `OPENWA_WEBHOOK_URL` | — |

**Secret (API key & webhook secret) dibaca dari ENV lebih dulu**, lalu
settings. Alasannya: `data/db.json` memang gitignored, tapi kredensial yang
bisa di-rotate tanpa menyentuh database lebih aman di env. Field non-secret
(base URL, nama session, URL webhook) memakai settings lebih dulu supaya
admin bisa mengubahnya dari panel.

Fallback env: `OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET`.

### 4.1 Jaringan: OpenWA (WSL) → backend (Windows)

OpenWA berjalan di WSL, backend di Windows. `localhost` dari sisi OpenWA =
localhost WSL, yang **tidak** terjangkau backend Windows. Harus pakai IP
host Windows:

```
wsl.exe -d Ubuntu -- bash -lc "ip route | grep default"   # -> 172.18.112.1
```

`OPENWA_WEBHOOK_URL="http://172.18.112.1:4100/api/webhooks/openwa"`.

Host itu **sudah** ter-whitelist di sisi OpenWA
(`/var/www/OpenWA/.env`: `SSRF_ALLOWED_HOSTS=172.18.112.1`) — diverifikasi live.
IP bisa berubah tiap restart WSL.

## 5. Berkas yang berubah

### Baru

| Berkas | Isi |
|---|---|
| `src/services/wa-gateway.js` | Klien REST OpenWA + cache status + polling |
| `src/services/wa-gateway-webhook.js` | `verifySignature`, `handleInbound`, `detectStop` |
| `src/routes/openwa-webhook.routes.js` | `POST /api/webhooks/openwa` dengan `express.raw()` |
| `scripts/wa-gateway.test.js` | Uji adapter: normalisasi chatId, status mapping, HMAC |
| `scripts/verify-openwa-webhook.js` | E2E webhook: signature benar→200, salah→401, kembar→DUPLICATE |

### Dihapus

| Berkas | Alasan |
|---|---|
| `src/services/wa-client.js` (947 baris) | Seluruh mesin whatsapp-web.js + Puppeteer |
| `src/services/wa_new.js` | Potongan `wa.js` yang disalin — tidak di-require siapa pun |
| `src/services/wa_new_deliverTo.js` | Sama — tidak di-require siapa pun |
| `wa_old_deliverTo.txt` | Catatan lama |
| `test_wa.js` | Skrip manual, digantikan suite uji |
| `scripts/wa-lock.test.js` | Menguji lockfile Chromium — tidak relevan |
| `scripts/wa-webjs-smoke.js` | Smoke test whatsapp-web.js |

### Diubah

| Berkas | Perubahan |
|---|---|
| `src/app.js` | Mount router webhook **sebelum** `express.json()` |
| `src/middleware/security.js` | Exempt path webhook dari CSRF (server-to-server) |
| `src/services/wa.js` | 3 titik: `isReady`, `sendText`, `sendVia` |
| `src/services/wa-worker.js` | Tidak berubah bentuk API |
| `src/services/wa-reminder.js` | Tidak berubah bentuk API |
| `src/services/wa-scheduler.js` | Tidak berubah bentuk API |
| `server.js` | Ganti `client.connect()/disconnect()` → `gateway.ensureSession()` + polling |
| `src/routes/marketing.routes.js` | Pakai `wa-gateway` (state, QR, pairing, kirim) |
| `src/routes/admin.routes.js` | Scope `wa` += field OpenWA |
| `views/admin/whatsapp.ejs` | Status OpenWA (lowercase), QR PNG data-URL, badge gateway |
| `views/admin/settings.ejs` | Panel konfigurasi OpenWA |
| `src/seed.js` | Field OpenWA bawaan di `settings` |
| `package.json` | Hapus `whatsapp-web.js` + `qrcode`; tambah script uji |
| `scripts/wa-check.js` | Target modul baru |
| `scripts/wa-run-tests.js` | Suite baru |
| `scripts/wa-unit.test.js` | `detectStop` dari modul baru |
| `scripts/wa-worker.test.js` | Stub `wa-gateway` |
| `scripts/wa-loop.test.js` | Stub `wa-gateway` |
| `scripts/wa-reminder.test.js` | Stub `wa-gateway` |
| `scripts/wa-http.test.js` | Tidak lagi menyalakan Chromium |
| `scripts/verify-wa-e2e.js` | Sesuaikan alasan "belum siap" |
| `.env` / `.env.example` | Variabel OpenWA |
| `README.md` | Ditulis ulang (dasar `origin/main:README.md` + bagian baru) |

## 6. Risiko & mitigasi

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | Body webhook ter-parse JSON → HMAC tidak cocok → semua delivery 401 | Router `express.raw()` mounted **sebelum** `express.json()` (`src/app.js`) |
| R2 | Webhook ditolak CSRF | Path `/api/webhooks/openwa/` di-exempt dari `verifyCsrf` (pola sama seperti `/payment/webhook/`) |
| R3 | OpenWA mati → blast/pengingin mati diam-diam | Timeout `AbortController` 20s + status badge "Gateway Offline" + `pausedReason` eksplisit di job blast |
| R4 | Nama session mengandung underscore → OpenWA tolak | Validasi `^[A-Za-z0-9-]{1,50}$` di adapter |
| R5 | `chatId` salah format → 400 | `toChatId()` → `<nomor>@c.us` |
| R6 | Blast lama masih jalan saat migrasi | Job `data.broadcasts` menyimpan `cursor` → lanjut aman |
| R7 | Gateway lambat merespons → worker blocking | Timeout 20s + `canSend()` membaca cache, bukan memanggil jaringan inline |
| R8 | Event kembar diproses dua kali | Kunci idempotensi di `data.waWebhookEvents` |
| R9 | `data/db.json` jadi bengkak | `waInbound` dipotong 500, `waWebhookEvents` dipotong 1000 |

## 7. Verifikasi

```bash
npm test                    # seluruh suite (wa-gateway, worker, loop, reminder, http, …)
npm run test:wa-e2e         # e2e terhadap server nyata
npm run check               # sintaks + konsistensi
node scripts/wa-gateway.test.js
```

Verifikasi live terhadap OpenWA:

```bash
curl -s -H "X-API-Key: $OPENWA_API_KEY" http://localhost:2785/api/sessions
curl -s -H "X-API-Key: $OPENWA_API_KEY" \
  http://localhost:2785/api/sessions/<id>/webhooks
```
