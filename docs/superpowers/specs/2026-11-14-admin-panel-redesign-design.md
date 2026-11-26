# Redesign Admin Panel seayoulatertrip — Dokumen Desain

Tanggal: 2026-11-14
Status: disetujui (implementasi dimulai — opsi default yang direkomendasikan dipakai karena klarifikasi tidak dijawab)

## 1. Tujuan

Redesign total panel admin `seayoulatertrip`:
- Logo admin (ikon + wordmark) diperbarui ke bahasa visual yang lebih modern.
- Komposisi visual admin dirapikan total (sidebar, topbar, dashboard, komponen).
- Seluruh konten & alur kerja (content management) **tetap berfungsi** — tidak ada
  perubahan URL, nama route, nama field form, atau perilaku CSRF/upload.

## 2. Batasan keras (non-goals)

- Tidak mengubah route, controller, atau skema data.
- Tidak mengubah nama field form (audit `scripts/verify-admin-audit.js` bergantung pada itu).
- Tidak mengganti `settings.logo` sebagai sumber logo admin: logo bawaan dipindah ke
  `/img/logo.svg` (tetap slot `logo`, 1:1, transparan).
- Mode gelap tetap bekerja lewat token semantik (`[data-theme="dark"]` hanya menimpa token).

## 3. Baseline (sebelum perubahan)

Diukur dengan server uji di port 4300:

| Uji | Hasil |
|---|---|
| `npm test` (6 suite WA + presence) | Semua suite lulus |
| `scripts/verify-admin-pages.js` | 14 halaman admin → 200 + sidebar OK |
| `scripts/verify-admin-audit.js` | 9/9 lulus (upload, isolasi form, hapus berkas logo) |

## 4. Rancangan

### 4.1 Logo
- **Mark**: lambang pulau tropis + bulan sabit + dua gelombang, bentuk kotak rounded
  (rx 13), warna datar `#0b3a44` (teal malam) + `#f2a65a` (apricot) + `#f6f0e6` (pasir).
  Semua warna hard-coded dan kontras tinggi terhadap latar, jadi terbaca di sidebar
  gelap maupun di favicon 16px.
- Berkas: `public/img/logo.svg` (dipakai bersama situs publik agar konsisten).
- **Wordmark**: tetap dua nada memakai `brandParts()` dari `src/services/brand.js`
  (kepala accent-aligned + ekor berwarna aksen), konsisten dengan splash & situs publik.

### 4.2 Sidebar
- Ikon emoji digantikan ikon garis SVG 24×24 (inline `<symbol>` sprite, `currentColor`).
- Item aktif: bar aksen 3px + gradien lembut + teks terang.
- Pencarian menu (filter client-side, tanpa network) di atas daftar.
- Label grup lebih rapat; brand block menampilkan mark + wordmark dua nada + eyebrow.

### 4.3 Topbar
- Kiri: tombol menu (mobile) + breadcrumb `Panel Admin / <judul>`.
- Kanan: tombol tema, "Lihat Situs ↗", chip user dengan dropdown
  (Akun Saya / Pengaturan / Keluar — logout tetap POST + CSRF).

### 4.4 Dashboard
- KPI: kartu dengan ikon, label, nilai besar, hint; aksen garis atas.
- Panel: header dengan judul + aksi, tabel & pesan tetap (struktur data tidak berubah).

### 4.5 Lapisan CSS
Menambah **layer 5** `public/css/admin-v2.css` (dimuat terakhir di `views/layouts/admin.ejs`).
Prinsip: layer ini **hanyaoverride**, bukan menghapus class lama — jadi template lama
tetap aman. Mode gelap tetap handled lewat token.

### 4.6 JS baru
`public/js/admin-v2.js` — filter pencarian menu, dropdown user, scroll item aktif ke
pandangan,remember sidebar state. Tanpa menyentuh alur form.

## 5. Verifikasi (wajib)

| Uji | Target |
|---|---|
| `npm test` | Semua suite lulus |
| `scripts/verify-admin-pages.js` | 14/14 halaman 200 |
| `scripts/verify-admin-audit.js` | 9/9 lulus |
| `scripts/verify-inline-scripts.js` | Semua inline script valid |
| `scripts/verify-admin-content-e2e.js` (baru) | CRUD konten: Destinasi, Paket, Artikel, Galeri, Booking status, Testimoni, Pesan, Pelanggan, Marketing, Social, Pengaturan — create → edit → delete, data uji dibersihkan |
| Audit browser (CDP) | 1440/1024/390 px, mode terang & gelap, sidebar off-canvas, overflow horizontal 0 |

## 6. Yang diubah (berkas)

- `public/img/logo.svg` — logo baru.
- `views/layouts/admin.ejs` — sprite ikon, sidebar, topbar, link CSS/JS baru.
- `public/css/admin-v2.css` — layer redesign.
- `public/js/admin-v2.js` — interaksi sidebar/topbar.
- `views/admin/dashboard.ejs` — KPI + panel.
- `scripts/verify-admin-content-e2e.js` — audit CRUD konten end-to-end.
