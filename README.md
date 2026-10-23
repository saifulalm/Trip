# Seayoulatertrip — Website Wisata & Panel Admin

Situs publik + panel admin untuk operator wisata bahari.
Stack: **Node.js + Express + EJS** (tanpa build step), data disimpan di
file JSON (`data/db.json`) dengan penulisan atomik.

```bash
npm install          # dependency wajib
npm start            # http://localhost:4100
npm run dev          # mode watch
npm run check        # cek sintaks + konsistensi brand (sebelum commit)
npm test             # uji alur splash (kunci scroll, jalur keluar)
npm run smoke        # render SEMUA halaman & pastikan tidak ada error template
```

> `npm run seed` **tidak** lagi menghapus database diam-diam. Perintah itu
> hanya menampilkan ringkasan isi database; untuk benar-benar seed ulang
> pakai `npm run seed:force` (membuat backup otomatis lebih dulu).

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
npm run check     # sintaks + helper template + sisa brand lama (kode & data)
npm test          # uji alur splash (kunci scroll, jalur keluar, mode reduced-motion)
npm run smoke     # request semua halaman publik + admin, pastikan tidak ada 500
npm start         # jalankan server
```

> `npm run smoke` menjalankan aplikasi sungguhan lalu meng-request seluruh
> halaman (publik, detail, form, admin, dan partial live-search). Ini yang
> menangkap error render seperti `currentCustomer is not defined` — error
> yang lolos dari pemeriksaan sintaks. Data uji yang dibuat test otomatis
> dibersihkan kembali.

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
   perbaikan ini, unggahan selalu gagal 403).
10. **Keamanan** — POST form tanpa token `_csrf` → halaman "Permintaan
   Ditolak" (403) yang rapi, bukan error 500.
