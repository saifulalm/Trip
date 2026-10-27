# Seayoulatertrip — Website Wisata & Panel Admin

Situs publik + panel admin untuk operator wisata bahari.
Stack: **Node.js + Express + EJS** (tanpa build step), data disimpan di
file JSON (`data/db.json`) dengan penulisan atomik.

```bash
npm install          # dependency wajib
npm start            # http://localhost:4100
npm run dev          # mode watch
npm run check        # cek sintaks + konsistensi brand + checkbox + redirect
npm test             # uji alur splash (kunci scroll, jalur keluar)
npm run test:upload  # uji upload gambar + keamanan upload (terisolasi)
npm run test:admin   # uji hak akses admin, role, & CRUD data (terisolasi)
npm run smoke        # render SEMUA halaman & pastikan tidak ada error template
```

> `npm run seed` **tidak** lagi menghapus database diam-diam. Perintah itu
> hanya menampilkan ringkasan isi database; untuk benar-benar seed ulang
> pakai `npm run seed:force` (membuat backup otomatis lebih dulu).
>
> `npm run test:upload` dan `npm run test:admin` berjalan di **lingkungan
> terpisah** (DB + folder upload sintetis di `/tmp`). Data produksi tidak
> pernah disentuh oleh kedua perintah itu.

Kredensial admin bawaan dicetak di terminal saat `npm start`
(lihat juga `src/seed.js`). Segera ganti lewat menu **Akun Saya**.

---

## 1. Branding — "seayoulatertrip"

Semua kemunculan nama brand kini terpusat di **`src/brand.js`**:

| Kunci | Nilai |
|---|---|
| `display` | `Seayoulatertrip` (dipakai di navbar, footer, judul halaman, admin) |
| `domain` | `seayoulatertrip.com` |
| `codePrefix` | `SYLT` (kode booking baru → `SYLT-251203-K7F2Q9`) |
| `company` | `PT Seayoulatertrip Wisata` |
| `email` | `halo@seayoulatertrip.com` |
| `descriptor` | `Wisata Bahari Nusantara` (subtitle logo) |

`res.locals.brand` tersedia di semua template EJS.

### Migrasi data lama (opsional, sudah dijalankan di repo ini)

Data lama (`data/db.json`) masih bisa memakai nama brand lama. Jalankan:

```bash
npm run migrate:brand:dry    # lihat pratinjau perubahan (tidak menulis)
npm run migrate:brand         # jalankan migrasi (membuat backup otomatis)
```

Migrasi **tidak pernah menghapus atau mengganti nama field** — hanya
mengganti nilai string dan memindahkan awalan kode booking. Sebelum menulis,
file dicadangkan ke `data/db.backup-<timestamp>.json`.

> `npm run check` akan gagal bila masih ada sisa nama brand lama — di kode
> **maupun** di `data/db.json` (backup di `data/db.backup-*.json` sengaja
> dikecualikan).

---

## 2. Splash screen handwriting

* Markup: `views/partials/splash.ejs` (disisipkan di `views/layouts/public.ejs`)
* Logika: `public/js/splash.js`
* Gaya: `public/css/splash.css`

Cara kerja:

* Wordmark **"Seayoulatertrip"** ditulis tangan dengan font "Great Vibes":
  judulnya dibuka dari kiri ke kanan memakai `clipPath` + `rect` yang di
  `scaleX(0 → 1)`, lalu diisi gradien (teal → apricot → coral).
  *Catatan:* reveal **tidak** memakai `pathLength` + `stroke-dasharray` pada
  `<text>`. Atribut `pathLength` hanya berlaku untuk
  `circle|ellipse|line|path|polygon|polyline|rect` dan **diabaikan** pada
  `<text>` oleh semua browser — kalau dipaksa, `stroke-dasharray:"1"` hanya
  menghasilkan titik-titik 1px dan animasi tulis-tangannya tidak pernah jalan.
* **Splash menutupi situs dari frame pertama.** Script inline di `<head>`
  (sebelum `<body>` diparse) menambahkan kelas `syt-splash-pending` ke
  `<html>`, sehingga layer splash sudah opaque sebelum konten apa pun
  dirender — tidak ada "flash" isi situs mendahului splash. Scroll juga
  dikunci lewat kelas `splash-active`.
* Jaring pengaman berlapis: `splash.js` melepas kedua kelas di **semua** jalur
  keluar (timer, tombol lewati, tab ditinggalkan, font gagal dimuat), dan
  script inline punya timer 6 detik sebagai cadangan terakhir. Situs tidak
  pernah terkunci scroll.
* Muncul **sekali per sesi browser** (`sessionStorage` `syt_splash_seen`).
  Pengunjung yang sudah pernah melihatnya tidak melihat flicker sama sekali:
  script inline membaca flag itu sebelum Splash dirender.
* Tombol **"Lewati intro"** berada di luar `aria-hidden` (tetap bisa difokus
  keyboard & terbaca screen reader), `prefers-reduced-motion` dihormati, dan
  splash otomatis berhenti bila tab ditinggalkan.
* Tanpa JS: `.splash` tidak pernah tampil (progressive enhancement).

Font tambahan dimuat dari Google Fonts: `Great Vibes`, `Dancing Script`,
`Inter`, `Poppins` (ditambahkan ke `layouts/public.ejs`).

---

## 3. Peningkatan UI/UX 3D/4D

* `public/css/ux.css` (baru) — glassmorphism, neon edge, floating orbs,
  gradient text, aksen cursive, magnetic button, ripple, scroll progress.
* `public/js/depth.js` (diperluas) — sekarang juga menangani:
  1. parallax hero berlapis (tetap),
  2. tilt 3D + glare pada kartu (tetap),
  3. count-up statistik (tetap),
  4. **cursor trail** (titik + ring, membesar saat hover elemen interaktif),
  5. **magnetic button** (`[data-magnetic]`),
  6. **scroll progress bar** di atas halaman,
  7. **ripple** pada `.btn` / `.btn-a`,
  8. **floating element** (`[data-float]`).

Kelas baru dipakai di `views/pages/home.ejs`:
`glass`, `neon-edge`, `aurora`, `data-magnetic`, `data-float`.
Tampilan yang sudah ada **tidak berubah** untuk elemen yang tidak diberi
kelas baru.

---

## 4. Admin Panel — Geolokasi (Latitude / Longitude)

Semua input koordinat kini tervalidasi di **server** dan **UI**:

* Validasi rentang: Latitude **−90…90**, Longitude **−180…180**.
* Input harus angka desimal; koma desimal Indonesia (`-0,4719`) diterima.
* Koordinat boleh kosong, tapi **tidak boleh setengah terisi**.
* Disimpan sebagai **number** dengan presisi 7 desimal (≈1,1 cm).
* Label UI: “Latitude” / “Longitude”.
* Input memakai `type="number" step="any"` + `min`/`max`, dengan
  pesan error per-field.

Berkas terkait:

| File | Perubahan |
|---|---|
| `src/utils/helpers.js` | `parseCoordinate`, `isValidLatitude`, `isValidLongitude`, `validateCoordinates`, `formatCoord` |
| `src/routes/admin.routes.js` | validasi coord saat create & edit; isian form disimpan ke session bila error (tidak hilang) |
| `views/admin/destination-form.ejs` | input angka + **pemilih peta Leaflet** (klik peta / geser marker) |
| `public/js/coord-picker.js` | logika picker + validasi langsung di browser |
| `public/css/admin.css` | gaya panel koordinat |

Pemilih peta memakai Leaflet dari CDN — sama seperti peta yang sudah ada di
proyek ini. Bila CDN gagal dimuat, form tetap bisa diisi manual.

---

## 5. Admin Panel — Pencarian, Filter & Sorting

Setiap tabel admin memakai **partial** yang sama untuk render server dan
live-search:

```
views/admin/partials/list-destinations.ejs
views/admin/partials/list-packages.ejs
views/admin/partials/list-articles.ejs
views/admin/partials/list-bookings.ejs
views/admin/partials/list-customers.ejs
views/admin/partials/list-messages.ejs
views/admin/partials/list-reviews.ejs
views/admin/partials/list-contacts.ejs
views/admin/partials/th.ejs            ← header sortable
views/admin/partials/pagination.ejs    ← q/status/sort/dir dipertahankan
```

* **Live search**: ketik → request `?partial=1` (debounce 320 ms) →
  tabel diganti tanpa reload. Server tetap sumber data, jadi pagination
  & sorting akurat untuk dataset besar.
* **Multi-field search**: ID/kode, nama, email, HP, paket, status,
  pembayaran, harga, koordinat, dsb. (lihat `SEARCH_*` di route).
* **Sorting server-side**: klik header tabel (`↕` → `▲`/`▼`).
* **Filter status** untuk booking, pesan, dan testimoni.
* **Error handling**: gagal fetch → toast “Gagal memuat data…” (`toast.js`).
* Tanpa JS: form tetap submit normal → halaman reload. Tidak ada fitur
  yang hilang.

Pintasan: tekan **/** untuk fokus ke kotak pencarian.

---

## 6. Admin Panel — WhatsApp (QR scan & integrasi)

Kode lama `src/services/wa.js` dipecah menjadi modul di `src/services/wa/`:

```
src/services/wa/index.js   ← facade (API lama tetap sama)
src/services/wa/cloud.js   ← WhatsApp Cloud API (Meta)
src/services/wa/web.js     ← WhatsApp Web (Baileys) + QR + reconnect
src/services/wa/qr.js      ← render QR PNG di server
```

`require('../services/wa')` **tidak berubah** — semua pemanggil lama
(`marketing.routes.js`) tetap jalan.

### Dua provider

| Provider | Kebutuhan | Panel |
|---|---|---|
| `cloud` (default) | token + phone id Meta | status & “Periksa Koneksi” |
| `web` | `npm install baileys qrcode` | QR scan, reconnect, hapus sesi |

Provider dipilih di **Pengaturan → WhatsApp** atau di panel
**Admin → WhatsApp & QR**.

### Yang sudah ditangani

* **Satu socket saja** (singleton) — `connect()` berkali-kali tidak
  membuat socket ganda.
* **Reconnect dengan exponential backoff**, maksimal 5 percobaan, lalu
  berhenti dan menunggu perintah manual (tidak ada loop tak berujung).
* **Semua listener dilepas** saat socket di-destroy → tidak ada
  memory leak.
* **Log dibatasi** (ring buffer 60 entri).
* **Status jelas** di panel: `Belum Terpasang` / `Terputus` /
  `Menghubungkan…` / `Memindai QR` / `Terhubung` / `Gagal`.
* **Tombol**: `Sambung / Refresh QR`, `Refresh QR`, `Putuskan Sesi`,
  `Hapus Sesi` (logout + hapus kredensial).
* **Endpoint**:
  * `GET  /admin/whatsapp` — halaman panel
  * `GET  /admin/whatsapp/status` — JSON status (dipakai polling)
  * `GET  /admin/whatsapp/qr` — JSON string QR mentah
  * `GET  /admin/whatsapp/qr.png` — **gambar QR** (PNG, dibuat server-side)
  * `POST /admin/whatsapp/connect` · `/disconnect` · `/logout` ·
    `/refresh-qr` · `/provider` · `/test` · `/check`
* **Blast & notifikasi** memakai provider aktif; tetap menghormati
  opt-in/opt-out, quiet hour (21.00–08.00), batas 50 pesan/run, dan
  berhenti setelah 5 gagal beruntun.

### ⚠️ Satu langkah yang perlu Anda jalankan

WhatsApp Web memakai Baileys, yang **belum terpasang** di lingkungan ini
(installasi paket eksternal diblokir sandbox). Aplikasi tetap berjalan
normal tanpa itu — panel menampilkan “Belum Terpasang” beserta
instruksinya. Untuk mengaktifkan:

```bash
npm install baileys qrcode
```

Lalu **restart server**, buka **Admin → WhatsApp & QR**, pilih provider
**“WhatsApp Web”**, tekan **Sambung / Refresh QR**, dan pindai QR dari
ponsel (WhatsApp → Perangkat tertaut → Tautkan perangkat).

Sesi tersimpan di `data/wa-session/` (sudah masuk `.gitignore`).
Bila modul belum terpasang, QR tetap tercetak di terminal server.

---

## 7. Perbaikan Keamanan & Keandalan

| Masalah | Perbaikan |
|---|---|
| Setiap upload file (logo, cover, bukti transfer) selalu **403** | `req.body` untuk `multipart/form-data` belum ter-parse saat middleware CSRF global berjalan. Verifikasi token kini ditunda dan dijalankan **setelah** multer mengurai body (`src/multer.js`). File yang ditolak langsung dihapus dari disk. |
| Halaman error CSRF (403) ikut 500 + stack trace | `attachCustomer` dipindah **sebelum** `verifyCsrf` di `src/app.js`, dan `currentCustomer` punya nilai default di `context.js`. |
| Kode booking bisa kembar (dua booking pada detik yang sama → pembayaran masuk ke booking orang lain) | `helpers.uniqueBookingCode()` guaranteeing keunikan, format `SYLT-YYMMDD-XXXXXX` (6 karakter acak, tidak bisa ditebak). |
| `npm run seed` menghapus seluruh isi database tanpa diminta | `npm run seed` kini hanya menampilkan ringkasan; penghapusan harus eksplisit lewat `npm run seed:force` (+ backup otomatis). |
| `package-lock.json` tidak sinkron → `npm ci` gagal di clone baru | Lockfile diperbarui; `npm ci` sudah terverifikasi berhasil (termasuk dependensi opsional `baileys` & `qrcode`). |
| Server memakai session secret hardcoded di source | Tanpa `SESSION_SECRET` di `.env`, server memakai secret acak per proses (dengan peringatan di terminal). |
| Server tidak_myarat data yang diubah dari luar (mis. hasil migrasi) | `src/db.js` mendeteksi perubahan `mtime/ukuran` file dan memuat ulang cache. |
| Nama brand lama masih tertinggal di konten (`Thanks JJE!`) | `scripts/migrate-brand.js` sekarang menyisir nama lama telanjang (bukan hanya `JJE-`) dan memverifikasi sendiri hasilnya; `npm run check` ikut memindai `data/db.json`. |

---

## 8. Ringkasan berkas yang diubah

**Baru**
```
src/brand.js                    src/services/wa/index.js
src/services/wa/cloud.js        src/services/wa/web.js
src/services/wa/qr.js           src/routes/whatsapp.routes.js
public/css/ux.css               public/css/splash.css
public/js/splash.js             public/js/coord-picker.js
public/js/toast.js              public/js/admin-table.js
public/js/wa-panel.js           scripts/migrate-brand.js
scripts/check-syntax.js         views/partials/splash.ejs
views/admin/whatsapp.ejs        views/admin/partials/list-*.ejs (8)
views/admin/partials/th.ejs
```

**Diubah**
```
server.js            package.json        .gitignore
src/app.js           src/db.js (tidak berubah skema)
src/middleware/context.js               src/middleware/security.js (tidak berubah)
src/routes/admin.routes.js              src/routes/marketing.routes.js
src/routes/public.routes.js             src/seed.js
src/utils/helpers.js                    src/payment/gateways.js
public/css/style.css                    public/css/admin.css
public/js/depth.js                      public/js/map.js
views/layouts/public.ejs                views/layouts/admin.ejs
views/partials/header.ejs               views/partials/footer.ejs
views/admin/*.ejs (9 view)              views/pages/home.ejs, about.ejs, …
```

---

## 9. Cara menguji

```bash
npm run check        # sintaks + helper template + sisa brand lama + checkbox + redirect
npm test             # uji alur splash (kunci scroll, jalur keluar, mode reduced-motion)
npm run test:upload  # 23 pemeriksaan: upload, validasi, rate limit, path traversal
npm run test:admin   # 36 pemeriksaan: role, sesi, CRUD, pencarian, pengaturan
npm run smoke        # request semua halaman publik + admin, pastikan tidak ada 500
npm start            # jalankan server
```

> `npm run smoke` menjalankan aplikasi sungguhan lalu meng-request seluruh
> halaman (publik, detail, form, admin, dan partial live-search). Ini yang
> menangkap error render seperti `currentCustomer is not defined` — error
> yang lolos dari pemeriksaan sintaks. Data uji yang dibuat test otomatis
> dibersihkan kembali.
>
> `npm run test:upload` & `npm run test:admin` membangun **basis data
> sintetis** sendiri di `/tmp` (tidak menyalin `data/db.json`), sehingga
> data pelanggan asli tidak pernah tersalin keluar folder proyek.

1. **Branding** — buka `/`; navbar/footer menampilkan “Seayoulatertrip”,
   `<title>` berisi `seayoulatertrip.com`.
2. **Splash** — buka `/` di jendela browser baru → animasi handwriting
   terlihat; buka lagi → tidak muncul (sudah pernah per sesi). Tekan
   “Lewati intro” untuk keluar cepat.
3. **Koordinat** — Admin → Destinasi → Tambah. Klik peta → Latitude &
   Longitude terisi. Coba isi Latitude `99` → pesan
   “Latitude harus antara -90 sampai 90”. Isi `abc` → “harus berupa
   angka desimal”.
4. **Live search** — Admin → Booking. Ketik `SYLT-2405` → tabel menyempit
   tanpa reload; klik header “Total” → urut naik/turun; klik “Next ›” →
   halaman berikutnya tetap dengan filter aktif.
5. **WhatsApp** — Admin → WhatsApp & QR. Tanpa `npm install baileys qrcode`
   → status “Belum Terpasang” + instruksi. Setelah di-install → tekan
   “Sambung / Refresh QR”, pindai QR, status jadi “Terhubung”.
6. **WhatsApp Cloud API** — Pengaturan → isi Access Token & Phone
   Number ID → simpan → Admin → WhatsApp & QR → “Periksa Koneksi”.
7. **Blast** — Admin → Blast WhatsApp → “Mode Uji” (tidak mengirim apa pun)
   → cek jumlah kontak cocok.
8. **Regresi** — buat booking lewat `/paket/<slug>`; kode booking harus
   berawalan `SYLT-` dan berbentuk `SYLT-YYMMDD-XXXXXX`; halaman
   `/pembayaran/<kode>` terbuka normal.
9. **Upload** — Admin → Pengaturan → unggah logo → tersimpan (sebelum
   perbaikan ini, unggahan selalu gagal 403). Lihat §10 untuk daftar
   pemeriksaan upload yang otomatis.
10. **Keamanan** — POST form tanpa token `_csrf` → halaman "Permintaan
    Ditolak" (403) yang rapi, bukan error 500.

---

## 10. Audit & Perbaikan Keamanan

Bagian ini merangkum hasil audit menyeluruh atas proyek (frontend, backend,
database, API, autentikasi) beserta perbaikannya. Semua poin **diuji dengan
perintah otomatis**, bukan hanya dibaca.

### 10.1 Upload gambar

| Masalah lama | Perbaikan | File |
|---|---|---|
| Upload hanya memvalidasi **ekstensi** — berkas `evil.jpg` berisi skrip berhasil tersimpan & disajikan lewat `express.static` | Validasi 3 lapis: ekstensi → MIME → **magic byte** (signature JPEG/PNG/GIF/WEBP). Berkas yang menyamar langsung dihapus dari disk | `src/multer.js` |
| Berkas upload **orphan**: validasi form gagal *setelah* berkas tersimpan → berkas tertinggal selamanya di `public/uploads` | `discardUpload(req)` dipanggil di setiap jalur validasi-gagal. Berkas lama juga dihapus saat gambar diganti | `src/multer.js`, `src/routes/admin.routes.js` |
| Nama berkas diambil dari input mentah pengguna | Nama berkas dibuat ulang: `<timestamp>-<random>.<ext>`; `path.basename` + cek prefix folder mencegah path traversal | `src/multer.js` |
| Logo/hero/OG lama menumpuk saat diganti | Berkas lama dihapus saat diganti, dan saat “kembalikan ke default” ditekan | `src/routes/admin.routes.js` |
| Tidak ada feedback ke pengguna saat mengunggah | `public/js/upload.js`: validasi tipe & ukuran **sebelum** submit, preview thumbnail, pesan error jelas, tombol submit jadi “Mengunggah…” | `public/js/upload.js`, `views/*` |
| Bukti transfer bisa membanjiri folder upload | Endpoint pembayaran manual dibatasi 10×/10 menit per IP | `src/middleware/security.js` |
| Logo yang diunggah tidak pernah tampil di situs | Header & footer memakai `settings.logo` bila ada | `views/partials/header.ejs`, `views/partials/footer.ejs` |

### 10.2 Autentikasi & hak akses

| Masalah lama | Perbaikan |
|---|---|
| **Rate limit login admin tidak aktif.** `POST /admin/login` didefinisikan ganda di `public.routes.js`, dan router publik dimuat **sebelum** router admin — sehingga handler tanpa `loginLimiter` yang menang. Admin bisa ditebak tanpa batas | Route duplikat dihapus. Login admin kini hanya ditangani `src/routes/admin.routes.js` yang memakai `loginLimiter()` → **429 setelah 5 percobaan** |
| **Role di database tidak pernah dipakai.** `requireLogin` hanya mengecek `session.userId`, jadi siapa pun yang punya sesi login = admin penuh | `requireAdmin()` memverifikasi user masih ada **dan** `role === 'admin'`. Akun non-admin otomatis ditolak (403) |
| **Session fixation** — ID sesi tidak berubah setelah login | `req.session.regenerate()` dipakai untuk login admin, login pelanggan, dan pendaftaran pelanggan |
| Rate limit login pelanggan menulis flash sebagai **objek**, bukan array → pesan “terlalu banyak percobaan” tidak pernah tampil | Flash diubah jadi array (`push`), pesan tampil benar |
| `/daftar` bisa kehilangan akun baru bila `data.customers` belum ada (`|| []` membuat array baru yang tidak menempel ke `data`) | `data.customers = data.customers || []` sebelum `push` |
| `db.write(data)` — argumen diabaikan (`write()` tidak menerima parameter) | Semua panggilan jadi `db.write()` |

### 10.3 Bug “checkbox tidak pernah tersimpan”

Pola HTML `hidden "off"` + `checkbox "on"` (dipakai agar pilihan pengguna tidak
hilang saat validasi gagal) membuat browser mengirim **dua field bernama sama**.
Express mem-parse hasilnya menjadi **array** `['off','on']`, sehingga
perbandingan `x === 'on'` **selalu salah**. Akibatnya:

| Field | Gejala |
|---|---|
| `featured` (Destinasi & Paket) | Checkbox “Jadikan destinasi unggulan” tidak pernah tersimpan |
| `waFloatEnabled` (Pengaturan) | Tombol WhatsApp mengambang mati setiap kali pengaturan disimpan |
| `seoIndex` (SEO) | **Setiap kali admin menyimpan form SEO, situs menjadi `noindex, nofollow`** — hilang dari Google |
| `midtransProduction` / `tripayProduction` | Mode produksi tidak bisa diaktifkan |
| `optIn` / `waConsent` | Risiko yang sama, sudah dinormalkan |

Perbaikan: helper baru `helpers.isChecked()` menormalkan string **dan** array.
`npm run check` kini **gagal** kalau ada route yang membandingkan checkbox
langsung dengan `=== 'on'` — supaya bug ini tidak bisa masuk lagi.

### 10.4 Lain-lain

* **Header keamanan**: `X-Content-Type-Options: nosniff` (penting untuk
  folder upload), `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
* **Redirect “back”** yang deprecated di Express 4 (dan melempar 500 bila
  request tanpa header `Referer`) diganti redirect aman ke `Referer`.
* **Halaman `/pembayaran/:code/manual`** adalah endpoint publik. Kini
  memverifikasi **email pemesan** (dikirim sebagai field tersembunyi) sebelum
  menerima bukti transfer, plus rate limit per IP.
* **Form Pengaturan punya 4 form terpisah** yang semua POST ke
  `/admin/pengaturan`. Field seperti `waProvider` kini memakai penjaga
  `if ('namaField' in body)` agar form lain tidak diam-diam menimpanya.

### 10.5 Berkas yang diubah

```
Baru:
  public/js/upload.js              scripts/test-upload.js
  scripts/test-admin.js

Diubah:
  src/app.js                        src/db.js
  src/middleware/security.js        src/middleware/customerAuth.js
  src/multer.js                     src/utils/helpers.js
  src/routes/admin.routes.js        src/routes/account.routes.js
  src/routes/marketing.routes.js    src/routes/payment.routes.js
  src/routes/public.routes.js       scripts/check-syntax.js
  scripts/smoke-test.js             package.json
  views/admin/{destination-form,package-form,article-form,settings,seo}.ejs
  views/layouts/{admin,public}.ejs  views/pages/payment.ejs
  views/partials/{header,footer}.ejs
  public/css/{admin,style}.css      .env.example
```

---

## 11. Panduan Konfigurasi AI Agent (belum diimplementasikan)

> **Status: belum ada integrasi AI di proyek ini.** Tidak ada kode LLM,
> tidak ada SDK, tidak ada panggilan jaringan ke penyedia AI. Bagian ini
> adalah panduan konfigurasi, **bukan** klaim bahwa integrasi sudah aktif.

### 11.1 Provider yang dipilih

**Anthropic Claude (Messages API)**. Tidak memerlukan SDK atau dependensi
baru — Node 18+ sudah menyediakan `fetch` global.

### 11.2 Environment

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MAX_TOKENS=2048
ANTHROPIC_TIMEOUT_MS=30000
```

Ambil API key di <https://console.anthropic.com/settings/keys>.
**Jangan pernah** menaruh kunci ini di dalam repo, di `data/db.json`,
atau menyalinnya ke chat/issue. `.env` sudah masuk `.gitignore`.

### 11.3 Bentuk request & response (Messages API)

```http
POST https://api.anthropic.com/v1/messages
x-api-key: $ANTHROPIC_API_KEY
anthropic-version: 2023-06-01
content-type: application/json
```

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 2048,
  "system": "Kamu editor Bahia untuk operator wisata Indonesia.",
  "messages": [
    { "role": "user", "content": "Tulis 3 paragraf deskripsi Pulau Sabesi." }
  ]
}
```

```json
{
  "id": "msg_…",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-5",
  "content": [{ "type": "text", "text": "…" }],
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 42, "output_tokens": 380 }
}
```

Cuplikan klien (Node, tanpa SDK):

```js
async function askClaude(prompt, { system } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI belum dikonfigurasi (ANTHROPIC_API_KEY kosong).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.ANTHROPIC_TIMEOUT_MS) || 30000);
  try {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS) || 2048,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    const body = await res.json();
    if (!res.ok) throw new Error((body && body.error && body.error.message) || `HTTP ${res.status}`);
    return (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  } finally {
    clearTimeout(timer);
  }
}
```

### 11.4 Di mana harus dipasang bilarudskirts diimplementasikan

```
src/services/ai/index.js       ← facade: isConfigured(), generate(), status()
src/routes/admin.ai.routes.js  ← /admin/ai (wajib sesi admin + role admin)
views/admin/ai.ejs             ← panel "Asisten AI"
```

Aturan wajib bila diimplementasikan:

1. **Graceful degradation** — tanpa `ANTHROPIC_API_KEY`, panel menampilkan
   “Belum dikonfigurasi”, bukan error 500. Mirip pola yang dipakai modul
   WhatsApp (`src/services/wa/web.js`).
2. **Kunci hanya dari env**, tidak pernah disimpan di `data/db.json` dan
   tidak pernah ditampilkan kembali di UI.
3. **Endpoint privat** — hanya boleh dipanggil dari sesi admin; jangan
   pernah menambah AI ke halaman publik tanpa rate limit.
4. **Jangan kirim PII** — nama/email/telepon tamu tidak boleh dikirim ke
   API pihak ketiga tanpa persetujuan.
5. **Timeout + batas token + rate limit** per admin, dan log hanya metadata
   (model, jumlah token, durasi) — jangan log isi percakapan.
6. **Semua hasil AI adalah draf** — harus ada tombol “Terapkan” eksplisit
   sebelum hasil disimpan ke database; jangan pernah menimpa data langsung.

---

## 12. Skills & MCP yang Direkomendasikan

> **Status saat audit: tidak ada MCP server yang terpasang**
> (`claude mcp list` → “No MCP servers configured”) dan belum ada folder
> `.claude/` di dalam proyek. Plugin yang aktif di lingkungan ini hanya
> `frontend-design`. Semua rekomendasi di bawah **belum dipasang** —
> pemasangan perlu persetujuan Anda karena beberapa menuntut akses ke
> layanan eksternal.

### 12.1 MCP server (dari marketplace resmi)

| MCP | Kegunaan di proyek ini | Cara pasang |
|---|---|---|
| **playwright** | Menguji UI sungguhan: preview upload, live-search admin, alur login, splash screen. Saat ini semua uji bersifat HTTP-level, belum ada uji klik | `claude mcp add playwright -- npx -y @playwright/mcp@latest` |
| **context7** | Dokumentasi versi terbaru Express / Multer / EJS — berguna saat menaikkan versi dependency | `claude mcp add context7 -- npx -y @upstash/context7-mcp@latest` |
| **github** | Membuka PR/issue lewat `gh` tanpa keluar dari terminal | `claude mcp add github -- npx -y @modelcontextprotocol/server-github` (butuh token) |
| **filesystem** | Menjelajah & menulis file proyek secara terstruktur | `claude mcp add fs -- npx -y @modelcontextprotocol/server-filesystem /var/www/Trip` |

> **Perhatian:** `github`, `gitlab`, `linear`, `asana`, `discord`,
> `telegram`, `imessage` semuanya butuh token/izin eksternal. Pasang hanya
> yang benar-benar dipakai, dan **jangan pernah** menaruh token di dalam
> repo.

### 12.2 Skills / plugin

| Skill / Plugin | Kegunaan | Catatan |
|---|---|---|
| `security-guidance` | Review keamanan untuk perubahan baru — cocok untuk auditing upload, auth, dan hak akses | Plugin resmi, belum diaktifkan |
| `feature-dev` | Alur terstruktur untuk fitur besar (planning → implementasi → testing) | Plugin resmi, belum diaktifkan |
| `frontend-design` | Sudah aktif — berguna untuk polish UI/UX upload & panel admin | Terpasang |
| `plugin-dev` | Membuat skill/MCP sendiri bila butuh integrasi internal | Plugin resmi |
| `commit-commands` | Membantu konsistensi pesan commit | Plugin resmi |
| `session-report` | Ringkasan sesi untuk jejak audit | Plugin resmi |

### 12.3 Skill khusus proyek yang layak dibuat

Folder `.claude/skills/` di dalam repo bisa berisi skill yang spesifik untuk
proyek ini, misalnya:

* `syt-upload-test` — menjalankan `npm run test:upload` + `npm run test:admin`
  lalu merangkum hasilnya.
* `syt-release` — checklist sebelum deploy (backup `data/db.json`, jalankan
  `npm run check && npm run smoke`, pastikan `public/uploads` tidak menumpuk).

---

## 13. Menjalankan proyek

```bash
# 1. Dependency
npm install

# 2. Siapkan environment
cp .env.example .env
#   lalu isi SESSION_SECRET dengan string acak yang panjang, misalnya:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Jalankan
npm start          # http://localhost:4100
npm run dev        # mode watch (auto-restart)

# 4. Masuk ke panel admin
#   http://localhost:4100/admin
#   Login bawaan: admin / admin123  → GANTI SEGERA lewat Akun → Akun Saya
```

Database terisi otomatis dari `src/seed.js` saat pertama kali dijalankan.
Kredensial admin bawaan juga dicetak di terminal saat `npm start`.

> **PENTING bila diakses lewat reverse proxy (nginx/Apache/Caddy):** isi
> `TRUST_PROXY=1` di `.env`. Tanpa itu semua permintaan terlihat datang dari
> IP proxy, dan **rate limit login akan mengunci seluruh pengguna** setelah
> beberapa percobaan. Lihat juga `SESSION_SECRET` — tanpa itu, sesi admin
> hilang setiap server restart.

### Perintah lain

```bash
npm run seed               # ringkasan isi database (TIDAK menghapus data)
npm run seed:force         # seed ulang + backup otomatis
npm run migrate:brand:dry  # pratinjau migrasi brand
npm run migrate:brand      # jalankan migrasi brand (+ backup)
npm run images             # buat ulang gambar SVG aset
```
