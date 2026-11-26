# Audit Empat Fokus — seayoulatertrip

Repo: `D:\laragon\www\sabesi` (Node.js + Express 4 + EJS + JSON file store, tanpa PostgreSQL)
Tanggal: 2026-11-25
Audit: baca kode sumber langsung (bukan asumsi). Semua temuan sudah diverifikasi lewat
`grep` / probe Node / pembacaan file.

> **Catatan arsitektur:** repo ini TIDAK memakai PostgreSQL. Penyimpanan adalah
> file JSON (`data/db.json` + `data/presence.json`) lewat `src/db.js`.
> Semua "schema" pada plan di bawah berarti bentuk objek JSON, bukan tabel SQL.

---

## Ringkasan Eksekutif

| # | Temuan | Severity | Status |
|---|---|---|---|
| **B1** | `gateway.sendText()` memanggil dirinya sendiri → `RangeError: Maximum call stack size exceeded`. **Seluruh pengiriman WhatsApp gagal.** | **Critical** | **Belum diperbaiki** |
| B2 | Halaman `/admin/galeri` punya tombol "Upload All (WebP)" yang **tidak pernah mengirim berkas ke server** (simulasi aja) | High | Belum diperbaiki |
| B3 | Validasi ukuran berkas upload **global 5 MB** untuk semua slot; tidak ada batas per-slot | Medium | Belum diperbaiki |
| B4 | Batas ukuran upload di-hardcode di **5 tempat** berbeda (partial + galeri + suite + layout publik + partial EJS) | Medium | Belum diperbaiki |
| B5 | Slot `proof` + `FIELD_SLOTS` + JS upload bukti di `layouts/public.ejs` = **dead code** (tidak ada form `#proof` di repo) | Low | Belum diperbaiki |
| B6 | Tidak ada **deep link Google Maps** sama sekali di seluruh repo | Medium | Belum diperbaiki |
| B7 | Presence **tidak menyimpan "last seen"** — entri dihapus permanen saat TTL habis | High | Belum diper_fixed |
| B8 | `frequencyCap` & `globalDailyLimit` **tidak bisa diatur** dari panel admin (tidak ada di seed maupun scope settings) | Low | Belum diperbaiki |
| B9 | `wa.sendText` (wrapper) tidak pernah dipakai; hanya `wa.sendVia` — keduanya juga punya alur pencatatan log berbeda | Low | Kosmetik |

Semua temuan di atas punya **tugas implementasi** di plan terpisah:

| Plan | Fokus |
|---|---|
| `docs/superpowers/plans/2026-11-25-audit-upload-media.md` | Fokus 1 — standardisasi upload |
| `docs/superpowers/plans/2026-11-25-migrasi-whatsapp-openwa.md` | Fokus 2 — OpenWA penuh (termasuk B1) |
| `docs/superpowers/plans/2026-11-25-pencarian-pelacakan-lokasi.md` | Fokus 3 — pencarian & pelacakan posisi |
| `docs/superpowers/plans/2026-11-25-rekomendasi-fitur-tambahan.md` | Fokus 4 — fitur tambahan |

---

## A. FOKUS 1 — Audit Upload Gambar / Media

### A.1 Peta titik upload (semua)

| # | Titik upload | Field form | Route | Slot | Bentuk |
|---|---|---|---|---|---|
| 1 | Destinasi — gambar utama | `imageFile` | `POST /admin/destinasi`, `POST /admin/destinasi/:id` (`src/routes/admin.routes.js:248`, `:289`) | `card` | `imageFields()` |
| 2 | Destinasi — galeri | `galleryFiles` | idem | `card` | `imageFields()` max 8 |
| 3 | Paket — gambar utama | `imageFile` | `POST /admin/paket` (`:424`), `POST /admin/paket/:id` (`:456`) | `card` | `singleImage()` |
| 4 | Artikel — sampul | `imageFile` | `POST /admin/artikel` (`:529`), `POST /admin/artikel/:id` (`:559`) | `article` | `singleImage()` |
| 5 | Logo situs | `logoFile` | `POST /admin/pengaturan` (`:948`) | `logo` | `multiImage()` |
| 6 | Gambar hero beranda | `heroFile` | idem | `hero` | `multiImage()` |
| 7 | OG image (SEO) | `ogFile` | `POST /admin/seo` (`:1086`) | `og` | `multiImage()` |
| 8 | Media Postiz (sosmed) | `mediaFile` | `POST /admin/social/unggah` (`src/routes/social.routes.js:674`) | `media` | `singleImage()` |
| 9 | Galeri admin (batch) | — (JS saja) | **TIDAK ADA endpoint** | — | **FAKE / simulasi** |
| 10 | Bukti transfer | `proof` | **TIDAK ADA route** | `proof` | **dead code** |

### A.2 Pipeline backend (sudah kuat)

`src/middleware/upload.js` → `src/services/image.js`:

1. `multer.memoryStorage()` → isi berkas bisa diperiksa.
2. `detectFormat()` (`image.js:83`) — magic byte, **bukan** ekstensi/header → aman terhadap rename.
3. `validateBuffer()` (`upload.js:82`) — reject format, reject hero polos (`looksBlank`), reject logo transparan (`looksTransparent`).
4. `processImage()` (`image.js:101`) — EXIF rotate → resize sesuai slot → konversi WebP q82 → tulis `public/uploads/`.
5. `cleanupUploads(req)` (`upload.js:269`) — hapus berkas yatim saat validasi route gagal.

**Yang sudah benar dan tidak boleh diubah:** magic-byte detection, validasi hero/logo, cleanup yatim, `withoutEnlargement`, tulis atomik di `src/db.js`.

### A.3 Yang BERMASALAH

**B3 — Batas ukuran global, bukan per-slot.**
`src/services/image.js:32` → `const MAX_FILE_SIZE = 5 * 1024 * 1024;`
`src/middleware/upload.js:44` → `limits: { fileSize: MAX_FILE_SIZE }` (satu batas untuk semua field).

Dampak: bukti transfer (foto struk ATM/transfer bank) wajar bisa > 5 MB, tapi
dipaksa ≤ 5 MB. Sebaliknya logo 512×512 bisa diunggah 5 MB padahal hasil akhirnya < 100 KB.

**B4 — Batas di-hardcode di 5 tempat:**

| Lokasi | Nilai | Konteks |
|---|---|---|
| `public/js/admin-upload.js:15` | `5 * 1024 * 1024` | widget partial `image-upload.ejs` |
| `public/js/admin-gallery-widget.js:20` | `5 * 1024 * 1024` | widget `gallery-upload.ejs` |
| `public/js/admin-gallery-suite.js:98` | `5 * 1024 * 1024` | suite galeri admin |
| `views/layouts/public.ejs:203` | `var MAX = 5 * 1024 * 1024` | upload bukti (dead code) |
| `views/admin/partials/image-upload.ejs:18` | `data-max-size="5242880"` | atribut hardcode, mengabaikan slot |

**B2 — Galeri admin tidak benar-benar mengunggah.**
`public/js/admin-gallery-suite.js:168-176` — blok upload hanya menjalankan
`setInterval` animasi 120 ms per file lalu mengisi `state.uploadedFiles.push({ url: 'pending' })`.
Tidak ada `fetch`/`FormData`/POST ke server. Komentar di kode sendiri mengakui:
`// Simulate WebP conversion (in real app, this POSTs to server)`.
Tombol di UI berbunyi "Upload All (WebP)" dan toast mengklaim "berhasil dikonversi"
padahal tidak ada berkas yang tersimpan.

**B5 — Dead code upload bukti.**
- `src/middleware/upload.js:29` → `proof: 'proof'` di `FIELD_SLOTS`.
- `FIELD_SLOTS` sendiri **tidak pernah dirujuk** di luar `upload.js` (terverifikasi lewat `grep`) — diekspor tapi tidak dipakai.
- `views/layouts/public.ejs:196-240` — blok JS "Unggah bukti transfer" mencari `#proof` / `[data-proof-drop]`.
- `grep 'id="proof"' views/` → **kosong**. Tidak ada form bukti pembayaran di situs publik.

**Tidak ada validasi dimensi di sisi klien.** Widget hanya cek `file.type` + `file.size`.
Rasio yang salah (mis. portrait untuk slot `card` 16:10) lolos ke server lalu dipotong
otomatis oleh sharp `fit: 'cover'` → admin terkejut karena gambarnya terpotong.

### A.4 Spesifikasi teknis yang direkomendasikan

Slot, rasio, dimensi, dan batas ukuran final:

| Slot | Pemakaian | Rasio | Dimensi target | Maks file | Format | `fit` |
|---|---|---|---|---|---|---|
| `card` | Destinasi & paket, galeri | **16:10** | 1280×800 | **2 MB** | JPG/PNG/WEBP | cover |
| `article` | Sampul artikel | **16:9** | 1280×720 | **2 MB** | JPG/PNG/WEBP | cover |
| `hero` | Hero beranda | **16:9** | 1920×1080 | **4 MB** | JPG/PNG/WEBP | cover |
| `logo` | Logo situs | **1:1** | 512×512 | **500 KB** | PNG (transparan) / WEBP | contain |
| `og` | Open Graph | **1200:630** | 1200×630 | **1 MB** | JPG/PNG/WEBP | cover |
| `media` | Postiz / media sosial | **1:1** | 1200×1200 | **3 MB** | JPG/PNG/WEBP | inside |
| `proof` | Bukti pembayaran | **4:3** | 1600×1200 | **8 MB** | JPG/PNG/WEBP | inside |
| `gallery` | Galeri destined (isi galeri) | **16:10** | 1280×800 | **2 MB** | JPG/PNG/WEBP | cover |

Aturan umum:
- **GIF tidak lagi diterima** untuk slot mana pun (animasi tidak dipakai di mana pun di
  situs ini; `image.js` sudah mengambil frame pertama, jadi GIF hanya menambah ukuran).
- Output tetap **WebP** (sudah ada di `processImage`).
- Toleransi rasio sisi klien: **±10%** dari rasio target → dipakai untuk peringatan
  (bukan penolakan), karena rasio persis sering mustahil di foto HP.
- Dimensi Minimum sisi klien: **800 px** sisi terpendek untuk `card`/`article`/`hero`;
  di bawah itu ditolak (gambar akan pecah saat di-crop).

---

## B. FOKUS 2 — Modul WhatsApp: Legacy vs OpenWA

### B.1 Legenda: apa yang sudah OpenWA, apa yang masih "lama"

**Sudah selesai (arsitektur):** gateway OpenWA berbasis REST sudah jadi.
`src/services/wa-gateway.js` (840 baris) + `src/services/wa-gateway-webhook.js` +
`src/routes/openwa-webhook.routes.js`. `whatsapp-web.js` & `qrcode` **sudah hilang**
dari `package.json`. Penjaga `scripts/wa-check.js:76` melarang modul itu kembali.

**Belum bersih — sisa-sisa warisan legacy:**

| Lokasi | Isi | Status |
|---|---|---|
| `src/services/wa.js:12` | Komentar "Generasi berikutnya memakai whatsapp-web.js" | **Komentar basi** |
| `src/services/wa.js:392` | Komentar "perangkat WhatsApp Web (whatsapp-web.js) di dalam proses Node" | **Komentar basi** |
| `src/services/wa.js:62-64` | `config()` mengembalikan `{ token: '', phoneId: '' }` | **Stub mati** — tidak ada pemanggil |
| `src/services/wa.js:74-76` | `isActive()` → alias `isReady()` | **Alias mati** — tidak ada pemanggil |
| `src/services/wa.js:331-340` | `sendText(settings, phoneRaw, text)` | Wrapper berbeda dari `sendVia` — hanya 1 pemanggil |
| `scripts/migrate-data-ipaymu.js:19-20,92-120` | Logika hapus sesi Baileys | **Skrip sekali pakai** — sudah lewat |
| `scripts/migrate-seed-payment.js:36` | Komentar whatsapp-web.js | **Komentar basi** |
| `package.json` | `puppeteer` masih devDependency | Dipakai E2E visual — **bukan** sisa WA |

**Verifikasi `npm test`:** semua suite lulus. Tapi (lihat B1) suite itu **tidak pernah
menguji pengiriman sungguhan**.

### B.2 B1 — Bug Critical: `sendText` rekursif

`src/services/wa-gateway.js` mendefinisikan `sendText` **dua kali di scope modul yang sama**:

| Baris | Signature | Peran |
|---|---|---|
| 439 | `async function sendText(sessionId, chatId, text, settings)` | **transport** → POST `/api/sessions/:id/messages/send-text` |
| 666 | `async function sendText(phone, text, settings)` | **wrapper publik** → normalisasi chatId, cek `isReady()` |

Karena keduanya `function` (bukan `const`), deklarasi **kedua menang** dan
`module.exports.sendText` (`:826`) menunjuk ke **baris 666**.

Baris 688 di dalam wrapper itu memanggil:

```js
const res = await sendText(sessionId, chatId, body, settings);   // ← memanggil dirinya sendiri!
```

`sendText` di baris 688 adalah **binding yang sama** — alias ke wrapper baris 666,
bukan ke transport baris 439. Jadi terjadi rekursi tak berujung.

**Bukti hasil eksekusi (probe Node, sudah dihapus):**

```
Panggil gateway.sendText("628123456789", "halo dunia")
  → argumen asli: phone=628123456789 (12 digit, VALID)

ERROR: RangeError | Maximum call stack size exceeded
fetch dipanggil 0 kali (0 = tidak pernah sampai ke HTTP)
```

Dan dengan `sessionId` numeric 5 digit:

```
ERROR: OpenwaError | Nomor WhatsApp tidak valid.
```

— kedua-dua gejala dari **argumen yang salah tempat**: `toChatId()` menerima `sessionId`
(UUID/kode pendek), bukan nomor telepon. Argumen asli `628123456789` valid, tapi
dipakai sebagai `chatId` di lapisan yang salah.

**Dampak:** `wa.sendVia()` → `gateway.sendText()` → **RangeError**. Jadi:
- Blast WhatsApp: **semua** target gagal (`failed += 1`, pesan `Maximum call stack size exceeded`).
- Pengingat otomatis: **semua** gagal.
- Pesan uji dari `/admin/marketing/whatsapp/test`: gagal.
- **Tidak ada** yang sampai ke perangkat.

**Kenapa tidak tertangkap test:**
- `scripts/wa-mock-gateway.js:25` menimpa `gateway.sendText` sepenuhnya → semua suite
  yang memakai mock (`wa-http`, `wa-loop`, `wa-reminder`, `wa-worker`) tidak pernah
  menyentuh kode rusak.
- `scripts/wa-gateway.test.js` menguji `config`, `toChatId`, `assertSafeSessionName`,
  `verifySignature`, idempotensi — **tidak pernah memanggil `sendText`**.

**Perbaikan (satu baris):** transport baris 439 di-rename menjadi
`sendTextViaSession(sessionId, chatId, text, settings)`, dan baris 688 memanggil nama
baru itu. Alternatif: transport jadi `const sendTextViaSession = async (...) => {...}`
ditempatkan **sebelum** wrapper. whichever — kuncinya: **dua nama berbeda**.

### B.3 Pemetaan trigger notifikasi (sudah terpusat — rapi)

Semua pemicu pesan sudah melewati `wa.js` → `gateway.sendText`:

| Trigger | Pemanggil | Alur |
|---|---|---|
| Blast massal | `src/services/wa-worker.js:175` | `wa.deliverTo()` → `wa.sendVia()` → gateway |
| Pengingat otomatis | `src/services/wa-reminder.js:246` | `wa.sendVia()` → gateway |
| Uji pesan manual | `src/routes/marketing.routes.js:385` | `wa.sendText()` → gateway |
| Pem Bolivian Opt-out | webhook OpenWA | `wa-gateway-webhook.handleEvent()` → `data.contacts[].optOut` |
| Pesan masuk | webhook OpenWA | `data.waInbound` + realtime event `INBOUND` |

**Tidak ada trigger yang masih menembak modul lama.** Struktur modular sudah benar —
yang belum benar adalah (a) bug B1, (b) sisa dead code, (c) konfigurasi/robustness.

### B.4 Error handling, timeout, non-blocking (evaluasi)

| Aspek | Status | Catatan |
|---|---|---|
| Timeout | ✅ | `AbortController` + `DEFAULT_TIMEOUT_MS = 20000` (`wa-gateway.js:43`) |
| Config precedence | ✅ | secret dari ENV dulu, non-secret dari settings dulu (`wa-gateway.js:92-121`) |
| Non-blocking blast | ✅ | `wa.startBroadcast()` → `worker.processJob()` tanpa `await` (`wa.js:560`) |
| Retry | ⚠️ | Worker auto-abort setelah 5 gagal beruntun (`wa-worker.js:23`), **tanpa retry per pesan** |
| Logging | ✅ | `wa.logSend()` → `data.whatsappSendLogs` (dipotong 500/hari) |
| **Failure isolation** | ❌ | `wa.sendText()` (wrapper) **tidak** lewat `logSend()` → pesan tes manual tidak tercatat |
| **Circuit breaker** | ❌ | Gateway mati → worker tetap mencoba tiap pesan |
| **Backoff** | ❌ | Retry delay tetap `MIN_DELAY_MS` (5 s), bukan eksponensial |

### B.5 Konfigurasi — yang perlu dirapikan

| Field | settings | env | bawaan |
|---|---|---|---|
| `openwaBaseUrl` | ✓ | `OPENWA_BASE_URL` | `http://localhost:2785` |
| `openwaSessionName` | ✓ | `OPENWA_SESSION_NAME` | `seayoulatertrip` |
| `openwaApiKey` | ✓ | `OPENWA_API_KEY` (ENV menang) | — |
| `openwaWebhookSecret` | ✓ | `OPENWA_WEBHOOK_SECRET` (ENV menang) | — |
| `openwaWebhookUrl` | ✓ | `OPENWA_WEBHOOK_URL` | — |
| `openwaTimeoutMs` | ❌ | `OPENWA_TIMEOUT_MS` | 20000 |
| `frequencyCap` | ❌ | ❌ | 3/hari (konstan `wa.js:30`) |
| `globalDailyLimit` | ❌ | ❌ | 100/hari (konstan `wa.js:29`) |

`openwaTimeoutMs` **sudah dibaca** di `wa-gateway.js:117` tapi **tidak ada** di seed
maupun scope `SETTINGS_GROUPS.openwa` (`admin.routes.js:854`) → tidak bisa diubah admin.
`frequencyCap` & `globalDailyLimit` dibaca di `wa.js:412` & `wa.js:430` tapi tidak ada
di seed maupun scope → **selalu pakai konstan**, tidak bisa diatur.

---

## C. FOKUS 3 — Pencarian & Pelacakan Posisi di Customer Login

### C.1 Peta area Customer Login saat ini

| Halaman | Route | Isi |
|---|---|---|
| Masuk | `GET /masuk` (`account.routes.js:82`) | form email+sandi |
| Daftar | `GET /daftar` | form registrasi |
| Dasbor | `GET /akun` (`:119`) | KPI, daftar booking, stepper progres, rekomendasi |
| Lokasi Saya | `GET /akun/lokasi` (`:184`) | peta, izin lokasi, presence, riwayat check-in |
| Detail booking | `GET /akun/booking/:id` (`:353`) | check-in GPS, peta rute, ulasan |
| Profil | `GET /akun/profil` (`:274`) | ubah nama/HP/sandi |
| API presence | `/api/presence/*` (`presence.routes.js`) | `GET /state`, `POST /ping`, `POST /stop`, `GET /stream` (SSE) |

**Yang sudah ada dan bagus:**
- Privasi `peersOf()` (`presence.js:254`): admin lihat semua; pelanggan lihat admin +
  pelanggan dengan **kode booking yang sama**.
- TTL (`presence.js:128`): entri basi dibuang → status offline akurat.
- SSE push (`presence.routes.js:201`) + `realtime` bus admin.
- Offline queue sisi klien (`public/js/presence.js:251`) — antrean `localStorage`, flush saat online.
- `geo.haversineMeters()` (`src/services/geo.js:40`) — jarak akurat tanpa dependensi.
- Check-in per booking dengan `distanceToDestination` + peringatan jarak > 5 km
  (`account.routes.js:448`).

### C.2 Yang BERMASALAH

**B7 — Tidak ada "last seen" yang persisten.**
`presence.sweep()` (`presence.js:145`) **menghapus** entri yang lewat TTL:

```js
if (!e || !e.at || now - new Date(e.at).getTime() > ttl) { delete entries[k]; }
```

Konsekuensi: begitu 5 menit berlalu tanpa ping, **titik terakhir hilang selamanya**.
Untuk kasus darurat ("user hilang 2 jam lalu, di mana dia terakhir?"), sistem ini
**tidak bisa menjawab**. Ini persis use case yang diminta.

`presence.get()` (`presence.js:209`) memang tidak memfilter TTL, tapi `sweep()` dipanggil
dari `upsert()` dan `list()` — jadi entri tetap bisa terhapus kapan saja ada aktivitas.

**B6 — Tidak ada deep link Google Maps di seluruh repo.**
`grep -rn "google.com/maps\|maps.google\|geo:" src/ views/ public/js` → **kosong**.
Admin melihat koordinat di layar (`views/admin/lokasi.ejs:75`) tapi tidak bisa
menavigasi ke sana..only `wa.me` link yang ada.

**Tidak ada pencarian peserta di area Customer Login.**
- `/cari` (`public.routes.js:347`) hanya mencari **destinasi/paket/artikel** — bukan orang.
- `views/admin/customers.ejs:12` sudah punya filter `name/email/phone` — itu milik admin, bukan customer login.
- Pelanggan **tidak bisa** mencari fellow traveler dietzijn booking.

**Tidak ada konsep "grup/rombongan".**
Privasi memakai `bookingCodes` — irisan **kode booking**. Dua orang beda kode booking
tapi satu kapal = **tidak saling terlihat**. Ini keterbatasan model data yang perlu
diatasi agar "terpisah dari rombongan" bisa dideteksi.

**Tidak ada tombol SOS / check-in manual untuk admin.**
`/admin/lokasi` hanya menampilkan peta + tombol "Bagikan Lokasi Saya".

**Akurasi & timestamp tidak ditampilkan ke pelanggan.**
`publicEntry()` (`presence.routes.js:70`) mengirim `accuracy` & `at` ke klien, tapi
UI pelanggan (`views/pages/account-location.ejs:145` → `presPeerList`) hanya menampilkan
nama. Tidak ada "terakhir terlihat 3 menit lalu".

### C.3 Skema yang dibutuhkan

```
data/presence.json
{
  version: 2,
  entries: {                      // live (TTL, seperti sekarang)
    "customer:cus_x": { role, refId, name, label, lat, lng, accuracy, bookingCodes, at }
  },
  lastSeen: {                    // BARU — persisten, tidak dihapus oleh TTL
    "customer:cus_x": {
      role, refId, name, label,
      lat, lng, accuracy, at,        // at = waktu terakhir diketahui
      ageMin,                        // dihitung saat baca
      source: 'live' | 'checkin' | 'manual'
    }
  },
  sos: [                          // BARU — antrean darurat
    { id, role, refId, name, phone, lat, lng, accuracy, at, status, resolvedAt, resolvedBy }
  ]
}
```

---

## D. FOKUS 4 — Rekomendasi Fitur Tambahan

Detail & prioritas di `docs/superpowers/plans/2026-11-25-rekomendasi-fitur-tambahan.md`.

| # | Fitur | Kompleksitas | Prioritas | Alasan |
|---|---|---|---|---|
| F1 | **SOS Alert** → kirim titik lokasi via OpenWA ke admin/koordinator | Sedang | **P0** | Menutup celah "user hilang" yang paling kritis; leveraged OpenWA yang sudah ada |
| F2 | **Roster Peserta per Booking** (grup/rombongan) + titik kumpul | Sedang | **P0** | Model data saat ini (irisan kode booking) tidak bisa merepresentasikan satu kapal |
| F3 | **Riwayat Last Seen persisten** | Kecil–Sedang | **P0** | Prasyarat F1 & F2; tanpa ini "di mana dia" tak terjawab |
| F4 | **Deep Link Google Maps + tombol "Hubungi via WhatsApp"** di daftar peserta | Kecil | **P1** | Nilai tinggi, Effort rendah |
| F5 | **Offline Fallback koordinat** (sudah parsial di klien) + **geofence radius** | Sedang | **P1** | Peringatan otomatis saat jauh dari titik kumpul |
| F6 | **Peta " satu-trip" di Customer Login** (semua peserta 1 kapal di 1 peta) | Sedang | **P2** | dependent pada F2 |

---

## E. Verifikasi yang dipakai dalam plan

Repo sudah punya harness uji yang matang — plan **memakai** harness ini, bukan membuat baru.

| Harness | Fungsi | Perintah |
|---|---|---|
| `scripts/wa-run-tests.js` | Runner suite WA (16 file) | `npm test` |
| `scripts/run-e2e.js` | Runner E2E berbasis HTTP + Puppeteer, target bernama | `npm run test:e2e:<target>` |
| `scripts/test-db.js` | Isolasi DB uji (`SABESI_DATA_DIR`) | di-require pertama |
| `scripts/wa-mock-gateway.js` | Mock transport OpenWA | di-require di suite |
| `scripts/wa-check.js` | Penjaga: modul WA usang tidak boleh kembali | `npm run check` |
| `scripts/verify-upload.js` | E2E pipeline upload admin | `node scripts/verify-upload.js` |

> **Batasan dari pengguna:** TIDAK ada langkah lint (`eslint` / `prettier` / `tsc --noEmit`)
> di dalam plan maupun eksekusi. Verifikasi akhir dijalankan manual oleh pengguna.
