# Seayoulatertrip — Website Wisata & Panel Admin

Situs publik + panel admin untuk operator wisata bahari.
Stack: **Node.js 18+ / Express 4 / EJS** (tanpa build step), data disimpan
di file JSON (`data/db.json`) dengan penulisan atomik.

```bash
npm install          # dependency wajib
npm start            # http://localhost:4100
npm run dev          # mode watch (auto-restart)
npm run check        # cek sintaks + template + penjaga whatsapp-web.js
npm test             # seluruh suite uji
npm run test:e2e     # seluruh uji end-to-end (server uji terisolasi)
```

> **Penting:** `npm run test:e2e` menyalakan server uji sendiri di folder
> data sementara (`%TEMP%/sabesi-e2e-<target>`) lalu mematikannya.
> `data/db.json` dan `data/presence.json` produksi **tidak pernah**
> disentuh. Jangan pernah menjalankan skrip audit langsung terhadap
> server produksi — itu yang sempat menghapus akun pelanggan.

Kredensial admin bawaan dicetak di terminal saat `npm start`
(`admin` / `admin123`) — segera ganti lewat **Akun → Akun Saya**.

---

## 1. Modul WhatsApp — Gateway OpenWA

Kanal WhatsApp adalah **OpenWA**: gateway open-source self-hosted yang
berdiri sendiri, diakses lewat REST API + webhook. Backend **tidak**
menjalankan browser/Chromium lagi.

> Riwayat: sebelumnya memakai `whatsapp-web.js` (Puppeteer di dalam proses
> Node). Sekarang diganti total — lihat `docs/design-migrasi-openwa.md`
> untuk desain & analisis risikonya.

### Arsitektur

```
┌──────────────┐   REST (X-API-Key)   ┌──────────────┐
│  Backend     │ ───────────────────► │  OpenWA      │
│  Express     │ ◄─────────────────── │  (gateway    │
│  (Windows)   │   webhook (HMAC)    │   WhatsApp)  │
└──────────────┘                       └──────────────┘
```

| Berkas | Peran |
|---|---|
| `src/services/wa-gateway.js` | Klien REST OpenWA: session, QR, pairing, kirim, webhook, cache status, polling |
| `src/services/wa-gateway-webhook.js` | Verifikasi HMAC-SHA256, idempotensi, pesan masuk, deteksi opt-out |
| `src/routes/openwa-webhook.routes.js` | `POST /api/webhooks/openwa` (pakai `express.raw()`) |
| `src/services/wa.js` | Fasad lama — **API publik tidak berubah** |
| `src/services/wa-worker.js` | Worker blast (loop job berstatus `queued`) |
| `src/services/wa-reminder.js` | Pengingat otomatis (booking jatuh tempo) |
| `src/services/wa-scheduler.js` | Penjadwalan berkala pengingat |

### Aturan yang tidak boleh dilanggar

* Hanya kirim ke kontak **opt-in**; opt-out selalu menang atas opt-in.
* Jam tenang (bawaan 21.00–08.00) **menunda**, bukan membatalkan.
* Izin dicek **ulang saat pengiriman**, bukan hanya saat job dibuat.
* Setiap nomor punya hasil tercatat di log job.
* Pelanggan yang balas **"berhenti"** otomatis ditandai opt-out.

### Kontrak API OpenWA

| Operasi | Endpoint |
|---|---|
| Daftar session | `GET /api/sessions` |
| Buat session | `POST /api/sessions` |
| Jalankan engine | `POST /api/sessions/:id/start` |
| Ambil QR (PNG data-URL) | `GET /api/sessions/:id/qr` |
| Kode pairing | `POST /api/sessions/:id/pairing-code` |
| Kirim teks | `POST /api/sessions/:id/messages/send-text` |
| Logout / stop | `POST /api/sessions/:id/logout` · `/stop` |
| Webhook | `GET`/`POST /api/sessions/:id/webhooks` |

Header autentikasi: `X-API-Key: <key>` (tanpa awalan `Bearer`).
Status session: `created` → `initializing` → `qr_ready` →
`authenticating` → `ready` / `disconnected` / `action_required` / `failed`.

### Webhook inbound

OpenWA mengirim event ke `POST /api/webhooks/openwa`:

* Tanda tangan `X-OpenWA-Signature: sha256=<hex>` — HMAC-SHA256 atas **byte
  mentah** body. Karena itu router memakai `express.raw()` dan dipasang
  **sebelum** `express.json()` di `src/app.js`. Kalau body di-parse lalu
  di-stringify ulang, urutan kunci berubah dan signature tidak cocok —
  semua delivery ditolak 401.
* `X-OpenWA-Idempotensi-Key` stabil antar retry → disimpan di
  `data.waWebhookEvents`. Event kembar dibalas 200 dengan
  `status: "DUPLICATE"` supaya gateway berhenti mencoba.
* Event `message.received` → pesan masuk dicatat ke `data.waInbound` +
  deteksi opt-out "berhenti".
* Route ini dikecualikan dari CSRF (server-to-server).

### Konfigurasi

Urutan prioritas: **secret dari env lebih dulu**, field non-secret dari
`settings` lebih dulu.

| Field | settings (Pengaturan) | env | bawaan |
|---|---|---|---|
| `openwaBaseUrl` | ✓ | `OPENWA_BASE_URL` | `http://localhost:2785` |
| `openwaSessionName` | ✓ | `OPENWA_SESSION_NAME` | `seayoulatertrip` |
| `openwaApiKey` | ✓ | `OPENWA_API_KEY` | — |
| `openwaWebhookUrl` | ✓ | `OPENWA_WEBHOOK_URL` | — |
| `openwaWebhookSecret` | ✓ | `OPENWA_WEBHOOK_SECRET` | — |

> Nama session OpenWA hanya boleh `[A-Za-z0-9-]{1,50}` — underscore
> ditolak. Validasi ada di adapter (`assertSafeSessionName`).

### Jaringan: OpenWA (WSL) → backend (Windows)

`localhost` dari sisi WSL = localhost WSL, **tidak** terjangkau backend
Windows. Webhook harus memakai IP host Windows:

```bash
wsl.exe -d Ubuntu -- bash -lc "ip route | grep default"   # -> 172.18.112.1
```

`OPENWA_WEBHOOK_URL="http://172.18.112.1:4100/api/webhooks/openwa"`.

Host itu harus ter-whitelist di sisi OpenWA
(`/var/www/OpenWA/.env`: `SSRF_ALLOWED_HOSTS=172.18.112.1`).
IP bisa berubah tiap restart WSL — cek ulang bila webhook mati.

Untuk mengetes delivery dari WSL:

```bash
wsl.exe -d Ubuntu -- bash -lc \
  "bash /mnt/d/laragon/www/sabesi/scripts/openwa-webhook-probe.sh"
```

---

## 2. Modul lain

| Modul | Ringkas |
|---|---|
| **Media sosial (Postiz)** | `src/services/postiz.js`, `src/services/social.js` — compose, riwayat, publish terjadwal. Konfigurasi instance + API key di `/admin/social`. |
| **Pembayaran (iPaymu)** | `src/payment/ipaymu.js` — VA + verifikasi status. Beralih dari Midtrans/Tripay. |
| **Lokasi langsung (presence)** | `src/services/presence.js` — berbagi posisi real-time, berkas terpisah `data/presence.json`, TTL & privasi antar-pelanggan. |
| **Tema & brand** | `src/services/theme.js`, `src/services/brand.js` — satu sumber kebenaran untuk nama brand & warna. |
| **SEO** | `src/seo.js` — meta tag, OG image, sitemap, `robots.txt`. |
| **Wisata/trip** | `src/services/trip.js`, `src/services/geo.js` — resolusi destinasi, jarak, progres booking. |

---

## 3. Struktur data

Semua data aplikasi ada di `data/db.json` (gitignored), ditulis atomik:

| Koleksi | Isi |
|---|---|
| `settings` | Konfigurasi situs, OpenWA, WA blast, presence, sosial |
| `users` | Akun admin (`role`) |
| `customers` | Akun pelanggan (portal) |
| `destinations`, `packages`, `articles` | Konten wisata |
| `bookings` | Pesanan + pembayaran + progres |
| `contacts` | Kontak blast (`optIn` / `optOut`) |
| `broadcasts` | Job blast (cursor, hasil per nomor) |
| `waReminders` | Riwayat pengingat (dedupe per hari) |
| `waInbound` | Pesan masuk dari webhook (500 terakhir) |
| `waWebhookEvents` | Jejak idempotensi webhook (1000 terakhir) |
| `whatsappSendLogs` | Log pengiriman (batas harian, frekuensi per kontak) |

Berkas terpisah: `data/presence.json` (posisi) — supaya tulisannya tidak
pernah mengunci `db.json` yang sedang dibaca.

---

## 4. Pengujian

```bash
npm test                     # seluruh suite (wa-check, wa-gateway, wa-unit,
                              # wa-worker, wa-loop, wa-reminder, wa-http,
                              # verify-openwa-webhook, ipaymu, social, geo,
                              # presence)
npm run check                # sintaks + EJS + penjaga whatsapp-web.js
npm run test:wa-gateway      # adapter OpenWA (normalisasi, HMAC, idempotensi)
npm run test:openwa-webhook  # E2E route webhook (200/401/400/DUPLICATE)
npm run test:e2e             # SEMUA uji end-to-end lewat runner terisolasi
npm run test:e2e:wa          # hanya E2E WhatsApp
npm run test:e2e:portal      # hanya E2E portal pelanggan
```

### Runner E2E terisolasi (`scripts/run-e2e.js`)

Skrip audit lama menguji lewat HTTP terhadap server yang sedang berjalan —
dan kalau server itu yang produksi, pengujian bisa menghapus akun
pelanggan, mengubah `settings`, atau menulis ke `data/db.json` produksi.

Runner menyelesaikan ini:

| Aspek | Cara runner Isolasi |
|---|---|
| Data | Folder sendiri per target: `%TEMP%/sabesi-e2e-<target>` |
| Env | `SABESI_DATA_DIR` + `SABESI_TEST_DIR` menunjuk folder itu |
| Presence | `PRESENCE_FILE` ikut terisolasi (lihat `src/services/presence.js`) |
| Port | Server anak memakai port unik; **semua** nama variabel port skrip (`PORT`, `VERIFY_PORT`, `AUDIT_PORT`, …) diarahkan ke port itu |
| Latar belakang | `WA_DISABLE_BG=1` → tidak ada pesan WhatsApp sungguhan |

```bash
node scripts/run-e2e.js wa-e2e      # satu target
node scripts/run-e2e.js all         # semua target (ringkasan di akhir)
```

> **Jebakan:** kalau nama variabel port skrip tidak ikut diarahkan, skrip
> memakai port bawaannya → membaca server LAMA → GAGAL palsu.

Semua suite WhatsApp memakai `scripts/wa-mock-gateway.js` — gateway OpenWA
sungguhan **tidak pernah** dihubungi saat uji, jadi tidak ada pesan asli
yang terkirim.

---

## 5. Menjalankan proyek

```bash
# 1. Dependency
npm install

# 2. Environment
cp .env.example .env
#   isi SESSION_SECRET:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   isi OPENWA_* sesuai instance OpenWA Anda

# 3. Jalankan
npm start          # http://localhost:4100
npm run dev        # mode watch

# 4. Panel admin
#   http://localhost:4100/admin
```

Database terisi otomatis dari `src/seed.js` saat pertama kali dijalankan.

> **PENTING di belakang reverse proxy (nginx/Apache/Caddy):** isi
> `TRUST_PROXY=1` di `.env`. Tanpa itu semua permintaan terlihat datang dari
> IP proxy, dan **rate limit login mengunci seluruh pengguna** setelah
> beberapa percobaan.

---

## 6. Dokumentasi

| Berkas | Isi |
|---|---|
| `docs/design-migrasi-openwa.md` | Desain & analisis risiko migrasi WhatsApp → OpenWA |
| `docs/audit-admin-redesign-openwa.md` | Audit panel admin + temuan UI/UX |
