# Panel Presisi — redesign panel admin + pencarian angkutan umum

## Brief (5 baris)
- Untuk staf admin Seayoulatertrip yang menyusun galeri destinasi dan memeriksa booking dari ponsel.
- Tugas tiap layar: Galeri = menyusun urutan portofolio tanpa ragu; Angkutan Umum = menemukan halte/stasiun/dermaga terdekat untuk sebuah destinasi.
- Mood: presisi, tenang, operasional.
- Arah terpilih: **Panel Presisi** (kanvas terang #F4F6F9, kartu abu lembut bertepi tegas, aksen biru #1D6AE5, radius 8, sans Jakarta Sans + Inter).
- Yang diingat: setiap blok punya label, garis tepi, dan status yang terbaca — tidak ada lagi blok putih yang menyatu dengan latar.

## Goal dan pengguna
Admin trip (1–3 orang) mengelola 8 destinasi, booking, dan kanal marketing. "Berhasil" = halaman Galeri jelas dalam sekali lihat (apa yang disusun, status tiap kartu, aksi yang tersimpan), dan pencarian angkutan umum memberi hasil nyata dari OpenStreetMap tanpa keluar panel.

## Scope
Di dalam:
- Skin admin "Panel Presisi" (tokens, tipografi, kartu, tabel, form, sidebar, topbar; mode gelap tetap ada).
- Redesign halaman Galeri Destinasi: hierarki 3 langkah, kartu portofolio berlabel posisi + status + unggulan, urutan benar-benar tersimpan, aksi keyboard, empty state.
- Halaman admin baru `/admin/angkutan`: pencarian halte/stasiun/dermaga (juga hotel/restoran) dari OpenStreetMap Overpass, dengan loading, kosong, error + retry, dan atribusi ODbL.

Di luar (sekarang): pencarian di situs publik, perubahan skema database, penggantian penyedia peta, penghapusan massal destinasi (tetap lewat halaman Destinasi).

## Arsitektur
- Express 4 + EJS (sudah ada); satu layout admin `views/layouts/admin.ejs`.
- Token desain di `public/css/admin-presisi.css` yang dimuat terakhir: menimpa token `--a-*` / `--a2-*` pada `.admin-body`, jadi semua halaman admin ikut tanpa menulis ulang aturan.
- Geo: `src/services/osm/*` (Overpass + Nominatim, cache 10 menit, fallback mirror) — tanpa dependensi baru, data OpenStreetMap ODbL.
- Rute: `GET /admin/angkutan` (server-render hasil), `POST /admin/galeri/urutan`, `POST /admin/galeri/unggulan` (JSON + CSRF).
- Data: `data/db.json`; urutan destinasi = urutan array `destinations`; unggulan = `destination.featured`.

## Risiko dan asumsi
- Jaringan sandbox memblokir Google Fonts dan tile OSM; font memakai fallback sistem, peta tidak ditampilkan (hasil berupa daftar).
- Overpass bisa lambat/limit; permintaan dibatasi timeout dan cache, error ditampilkan dengan tombol coba lagi.
- Preferensi aksen global (Pengaturan) tetap berlaku di situs publik; panel memakai aksen biru Panel Presisi.

## Phase 1: Panel Presisi + Galeri jelas + Angkutan Umum
Goal: admin membuka panel, melihat galeri yang terbaca, menyusun urutan yang tersimpan, dan mencari angkutan umum terdekat.
- [ ] Token & skin "Panel Presisi" untuk seluruh panel (terang + gelap)
- [ ] Halaman Galeri Destinasi ditata ulang: header, 3 langkah, kartu posisi/status/unggulan
- [ ] Simpan urutan dan toggle unggulan benar-benar menulis ke data
- [ ] Halaman `/admin/angkutan` + menu sidebar, hasil Overpass dengan state lengkap
- [ ] Verifikasi: syntax check, uji admin, browser 390 px & 1280 px

Acceptance: `/admin/galeri` menampilkan kartu berciri tegas dengan nomor posisi dan status; menekan "Simpan Urutan" mengubah urutan destinasi di `/admin/destinasi`; `/admin/angkutan` menampilkan halte terdekat untuk destinasi terpilih, dan pesan jelas saat kosong/gagal.

## Phase 2 (nanti): Peta mini + filter lanjutan
Menambah peta Leaflet pada hasil angkutan, filter jenis transportasi (bus, feri, ojek), dan tautan "Buka rute" ke penyedia peta.
