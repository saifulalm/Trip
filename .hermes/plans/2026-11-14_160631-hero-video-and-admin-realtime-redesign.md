# Rencana Redesign: Beranda Video Animasi + Panel Admin (Perangkat WA, Blast, Media Sosial) Realtime

Tanggal: 2026-11-14 · Repo: `D:\laragon\www\sabesi` · Stack: Express 4 + EJS (express-ejs-layouts) + JSON file DB (`data/db.json`) + vanilla JS/CSS. Tidak ada PostgreSQL, tidak ada build step.

---

## 1. Goal

Mengbaiki beranda agar video hero kembali berjalan (dan tampil lebih baik), redesign total panel admin untuk tautan perangkat WhatsApp + blast WhatsApp + integrasi media sosial dengan pembaruan **realtime** (SSE), sekaligus memperbarui skill referensi `sabesi-website-upload-theme` agar cocok dengan arsitektur dan redesign terbaru.

---

## 2. Current context / assumptions

### 2.1 Temuan terverifikasi (bukan asumsi — diukur di repo & browser)

Semua angka di bawah hasil inspeksi repo + probe browser nyata (login admin `admin` / `admin123`, server uji di port 4398/4399).

| # | Temuan | Bukti |
|---|---|---|
| H1 | **Video hero TIDAK dirender sama sekali** di situs publik. Penyebabnya bukan kode video, tapi `settings.heroImageUrl` terisi gambar unggahan admin. `views/pages/home.ejs:9` → `const heroUsesVideo = !heroCustomImage;` → bila ada gambar unggahan, `<video>` dihapus dari HTML. | Probe DOM (port 4399): `{"hasVideo":false,"mediaClass":"hero-video","poster":"/uploads/1794614857741-e96bd7d37523.webp"}`. HTML hasil `curl` tidak mengandung `hero-video__el`. |
| H2 | Gambar hero yang diunggah admin **gambar polos merah**. `sharp` stats: mean RGB `255.0, 1.0, 0.0`, stdev `0.01, 0.01, 0.00` → bukan foto. | `node -e "sharp('public/uploads/1794614857741-e96bd7d37523.webp').stats()"` |
| H3 | **Logo situs juga polos/transparan**. `settings.logo` = `/uploads/1794615732793-f797762e6749.webp`, mean `0,0,0,0`, stdev ~1 → logo tidak terlihat di header, footer, splash, halaman login, dan favicon. | `sharp(...).stats()` + `grep settings.logo views/` |
| H4 | **Video & pipeline-nya sendiri sehat.** Pada DB bersih (seed) video dirender & diputar: `readyState 4, duration 14.2, videoWidth 1280, mediaClass "hero-video is-playing", opacity 1, paused false`. | Probe browser port 4398 (SABESI_DATA_DIR kosong). `ffprobe`: h264 Main 1280×720, 20fps, 14.2s, `moov` di offset 36 (faststart OK), HTTP 206 Range didukung. |
| H5 | Hero poster bawaan sehat (stdev 64/57/53) — `public/img/hero-island-poster.jpg`. | `sharp(...).stats()` |
| H6 | **Sprite ikon SVG tidak lengkap.** `i-plus` (5×), `i-trash` (12×), `i-eye` (2×) dipakai di 19 template tapi **tidak pernah didefinisikan** di `views/layouts/admin.ejs` → ikon kosong. | `grep -rho 'href="#i-[a-z]*"' views/` vs `id="i-…"` di layout. Probe DOM: `missing: ["i-plus","i-trash"]` (halaman kontak) dan `i-eye` (dashboard, settings). |
| A1 | **Halaman Blast & Kontak tidak punya realtime sama sekali.** `grep fetch\|setInterval\|EventSource` → `blast.ejs` & `contacts.ejs` = 0 match. Progres blast hanya terlihat setelah reload manual. | `views/admin/blast.ejs`, `views/admin/contacts.ejs` |
| A2 | Halaman WhatsApp hanya *poll* QR via `fetch` (bukan SSE). Halaman Social pakai `fetch` status/diagnostik. | `views/admin/whatsapp.ejs:185`, `views/admin/social.ejs:328,356` |
| A3 | **Pola SSE sudah ada & terbukti** di repo: `src/services/presence.js` (EventEmitter `bus`) + `src/routes/presence.routes.js` (`GET /stream`) + `public/js/presence.js` (EventSource). Pola ini yang akan dipakai ulang. | `grep -n "bus\|EventEmitter" src/services/presence.js` |
| A4 | `postiz.analytics(settings, integrationId, days)` **sudah ada di service tapi tidak pernah dipakai** di route mana pun → fitur mati. | `grep -rn "analytics(" src/routes/ views/` = kosong |
| A5 | Jam tenang di `views/admin/contacts.ejs:8` **hardcoded** `(21.00–08.00)`, padahal route sudah mengirim `quietHour` (tanpa label). Salah tampil bila admin mengubah pengaturan. | `views/admin/contacts.ejs:8` vs `src/routes/marketing.routes.js:16-26` |
| A6 | 6 lapis CSS admin (`admin.css`, `admin-design.css`, `admin-components.css`, `admin-gallery.css`, `admin-v2.css`, `admin-social.css`) → sumber kebenaran token tersebar. `admin-v2.css` dimuat terakhir. | `views/layouts/admin.ejs:11-17` |
| A7 | `admin-components.css` punya komponen `a-tabs`, `a-toast`, `a-progress`, `a-drawer`, `a-segmented`, `a-kpi-row`, `a-skeleton` yang **belum dipakai** di template — bahan siap pakai untuk redesign. | `grep -c` per class di `views/` |
| A8 | `hero-search__field--dest` / `--date` dipakai di `views/partials/hero-animated.ejs` tapi tidak ada definisi CSS-nya (class yatim). | `grep "hero-search__field--" public/css/` = kosong |
| A9 | Layout admin **tidak** punya overflow horizontal di 1440/1024/768/390 pada semua halaman yang diuji. | Probe browser 4 halaman: `overflow: 0` |
| A10 | Gateway OpenWA hidup di `http://localhost:2785` (`/api/health` → `{"status":"ok"}`). Kanal tunggal = OpenWA REST; `whatsapp-web.js`/`wa-client.js` **sudah dihapus** (dijaga oleh `scripts/wa-check.js`). | `curl localhost:2785/api/health`, `ls src/services/wa-client.js` → tidak ada |
| A11 | Git: branch `main`, 2 commit, 59 modified + 124 untracked, 2 commit di belakang origin. `data/db.json` berstatus modified. | `git status --short`, `git log --oneline` |
| A12 | Folder `.audit/` dibuat saat probing (**baru, untracked**) — harus dibersihkan atau di-`.gitignore`. | `git status --short` → `?? .audit/` |
| A13 | Skill `sabesi-website-upload-theme` **basi**: masih mendokumentasikan `whatsapp-web.js`, `src/services/wa-client.js`, `scripts/wa-lock.test.js`, `profilePath()`, `clearStaleProfileLock()`, `forceCloseBrowser()` — semuanya **sudah tidak ada** di repo. | `grep -rn "wa-client\|whatsapp-web.js" src/ package.json scripts/` → hanya sebutan di komentar/skrip penjaga |

### 2.2 Asumsi

- A1: Admin memang ingin **video hero menjadi tumbnail default** lagi. Gambar polos yang terunggah dianggap kesalahan, bukan desain. Bila maksudnya sebaliknya, Task B1 harus diganti menjadi pertanyaan konfirmasi ke user sebelum implementasi.
- A2: Tidak ada perubahan pada kontrak publik `src/services/wa.js` (`isReady`, `isQuietHour`, `renderTemplate`, `segmentTargets`, `startBroadcast`, `deliverTo`, …) — dipakai `wa-worker.js`, `wa-reminder.js`, `wa-scheduler.js`, `marketing.routes.js`.
- A3: Realtime = SSE (tanpa dependensi baru), mengikuti pola `presence` yang sudah ada. Tidak memakai WebSocket/polling socket.io (YAGNI).
- A4: Rede admin memakai CSS **layer baru** (`admin-v3.css`) — layer lama tidak dihapus, hanya di-override.
- A5: 所有 pengujian lewat `scripts/run-e2e.js` (data terisolasi) atau `WA_DISABLE_BG=1` — `data/db.json` produksi tidak boleh disentuh.

---

## 3. Architecture / proposed approach

Tiga lapisan perubahan yang saling terpisah, dikerjakan berurutan agar tiap lapisan bisa diverifikasi sendiri:

1. **Lapisan Data & Kontrak** — tambahkan setting `heroMode` (`auto|video|image`) + validasi anti-gambar-polos di `src/services/image.js`; tambahkan bus event + endpoint SSE untuk marketing di `src/routes/marketing.routes.js`; tambahkan route analytics Postiz yang selama ini mati.
2. **Lapisan View** — `views/pages/home.ejs` + `views/partials/hero-animated.ejs` + `public/css/hero-animated.css` + `public/js/hero-animated.js` (hero), dan `views/admin/{whatsapp,blast,contacts,social,social-compose,social-history}.ejs` + `public/css/admin-v3.css` + `public/js/admin-realtime.js` (admin).
3. **Lapisan Referensi** — perbarui SKILL.md `sabesi-website-upload-theme` (bagian OpenWA menggantikan whatsapp-web.js, bagian hero mode, bagian realtime admin, aturan sprite) dan tambah `references/admin-realtime.md`.

Alasan memilih "layer baru + override" alih-alih menulis ulang: `admin-components.css` sudah menyediakan 11 komponen modern yang belum dipakai (A7), dan `admin-v2.css` sudah establishes token `--a2-*` — redesign cukup combination token + komponen yang ada, tanpa membangun sistem baru dari nol (YAGNI).

Prinsip lain yang dipakai: **DRY** (satu sumber kebenaran untuk status gateway = `src/services/wa-gateway.js`; satu sumber untuk sprite = `views/layouts/admin.ejs`; satu sumber untuk label jam tenang = `wa.quietLabel()`), **TDD** (setiap task menyertakan uji gagal → implementasi → uji lulus → commit), **komit sering** (1 commit per task).

---

---

## 4. Step-by-step tasks

> Konvensi:
> - Semua komentar & penjelasan kode ditulis dalam **Bahasa Indonesia**.
> - Semua perintah dijalankan dari root repo `D:\laragon\www\sabesi`.
> - **Jangan pernah** menulis langsung ke `data/db.json` (cache modul menimpanya). Gunakan route admin atau `SABESI_DATA_DIR`.
> - Background shell di Hermes杀 proses `node` bisa gagal dengan `stdin is not a tty` → itu artefak wrapper, **bukan** bug aplikasi. Untuk server uji, pakai `npm run test:e2e:*` (runner punya `resolveNodeBin()` yang mencari `C:\Program Files\nodejs\node.exe`).

### BAGIAN A — Beranda: video hero kembali hidup & tampil lebih baik

---

#### A1. [TDD] Uji regresi: hero harus punya `<video>` di DB bersih

Buat `scripts/hero-hero.test.js` —既能 jalan sebagai uji unit (marker),又能 dipakai runner E2E.

Buat berkas `scripts/hero-mode.test.js`:

```js
'use strict';
/**
 * Uji mode hero beranda.
 *
 * Menjamin:
 *  1. `heroMode` bawaan = 'auto' → beranda merender <video>.
 *  2. `heroMode` = 'image' → beranda TIDAK merender <video>.
 *  3. `heroMode` = 'video' → beranda merender <video> walau ada heroImageUrl.
 *  4. Gambar polos (stdev < 3) ditolak saat unggah → pesan error jelas.
 */
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, 'test-db'));

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'src', 'db'));
const image = require(path.join(root, 'src', 'services', 'image'));

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail += 1;
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

(async () => {
  await t('heroMode bawaan = auto', () => {
    const s = db.read().settings || {};
    assert.strictEqual(s.heroMode === undefined ? 'auto' : s.heroMode, 'auto');
  });

  await t('gambar polos terdeteksi (stdev < 3)', async () => {
    // PNG 4x4 merah solid.
    const solid = await image.looksBlank(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4AWMwZDBkYPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64'
    ));
    assert.strictEqual(solid.blank, true, 'harus terdeteksi polos');
  });

  await t('gambar berdetail TIDAK terdeteksi polos', async () => {
    const fs = require('fs');
    const real = fs.readFileSync(path.join(root, 'public', 'img', 'hero-island-poster.jpg'));
    const r = await image.looksBlank(real);
    assert.strictEqual(r.blank, false, 'poster asli bukan gambar polos');
  });

  console.log(fail === 0 ? '\nSemua suite lulus.' : `\n${fail} gagal.`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

**Langkah 1 — jalankan, harus GAGAL** (fungsi `looksBlank` belum ada):

```bash
cd /d/laragon/www/sabesi && node scripts/hero-mode.test.js
```

Harapan output: `FAIL  gambar polos terdeteksi (stdev < 3) -> Cannot read properties of undefined (reading 'blank')` dan `FAIL  gambar berdetail TIDAK terdeteksi polos -> ...`. Exit code ≠ 0.

**Langkah 2 — implementasi `looksBlank` di `src/services/image.js`** (tambahkan sebelum `module.exports`, dan tambahkan ke export):

```js
/**
 * Deteksi gambar yang secara visual "polos" (solid color / nyaris tanpa detail).
 *
 *(admin sering mengunggah placeholder merah/kuning secara tidak sengaja —
 *  hasil itu membuat beranda tampil seperti blok warna, bukan foto.)
 *
 * Ambang: deviasi standar tiap kanal < 3 (dari 0–255) ATAU rentang
 * max-min < 6 → dianggap polos.
 *
 * @param {Buffer} buffer isi berkas gambar
 * @returns {Promise<{blank: boolean, stdev: number[], spread: number}>} hasil deteksi
 */
async function looksBlank(buffer) {
  if (!sharp) return { blank: false, stdev: [], spread: 0 };
  try {
    const { channels } = await sharp(buffer, { animated: false })
      .rotate()
      .resize(64, 64, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const stdev = [];
    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let i = c; i < channels * (64 * 64); i += channels) {
        const v = buffer[i];
        sum += v;
        sumSq += v * v;
        n += 1;
      }
      const mean = sum / n;
      stdev.push(Math.sqrt(Math.max(0, sumSq / n - mean * mean)));
    }
    const mins = stdev.length ? Math.min.apply(null, stdev) : 255;
    const maxs = stdev.length ? Math.max.apply(null, stdev) : 0;
    const spread = maxs - mins;
    return { blank: mins < 3 || spread < 6, stdev, spread };
  } catch (err) {
    // Gambar tidak bisa dianalisis → anggap tidak polos (biarkan admin lewat).
    return { blank: false, stdev: [], spread: 0 };
  }
}
```

Tambahkan `looksBlank` ke objek `module.exports` di `src/services/image.js`.

**Langkah 3 — jalankan lagi, harus LULUS**:

```bash
cd /d/laragon/www/sabesi && node scripts/hero-mode.test.js
```

Harapan: 3× `PASS`, lalu `Semua suite lulus.` Exit code 0.

**Langkah 4 — commit**:

```bash
cd /d/laragon/www/sabesi && git add scripts/hero-mode.test.js src/services/image.js && git commit -m "feat(hero): deteksi gambar polos pada service image"
```

---

#### A2. Setting `heroMode` + penolakan gambar polos saat unggah

**TDD — lihat `scripts/hero-mode.test.js`, tambahkan kasus baru di blok `(async () => {` (setelah kasus `looksBlank`):**

```js
  await t('heroMode ada di seed = auto', () => {
    const seed = fs.readFileSync(path.join(root, 'src', 'seed.js'), 'utf8');
    assert.ok(/heroMode:\s*'auto'/.test(seed), 'seed harus punya heroMode: auto');
  });
```

Tambahkan `const fs = require('fs');` di bagian atas skrip bila belum ada.

**Langkah 1 — jalankan, harus GAGAL**: `node scripts/hero-mode.test.js` → `FAIL  heroMode ada di seed = auto -> seed harus punya heroMode: auto`.

**Langkah 2 — implementasi**:

(a) `src/seed.js` — di dalam objek `settings`, tambahkan baris baru **tepat setelah** `heroImageUrl: '',` (baris ~819):

```js
    // Mode tampilan hero beranda:
    //   'auto'  → pakai video, tapi bila admin mengunggah gambar hero, gambar itu jadi poster
    //   'video' → selalu pakai video (unggahan admin hanya dipakai sebagai poster)
    //   'image' → tidak pakai video sama sekali (hemat bandwidth)
    heroMode: 'auto',
```

(b) `src/routes/admin.routes.js` — di dalam `SETTINGS_GROUPS` (baris ~836), tambahkan `'heroMode'` ke array `site`:

```js
  site: [
    'siteName', 'tagline', 'heroTitle', 'heroSubtitle', 'whatsapp', 'email',
    'phone', 'address', 'instagram', 'facebook', 'about', 'waFloatEnabled',
    'waFloatMessage', 'logoFile', 'logoImageReset', 'heroFile', 'heroImageReset',
    'heroMode'
  ],
```

(c) `src/routes/admin.routes.js` — di dalam handler `POST /pengaturan`, **tepat setelah** blok `heroImageUrl` (sekitar baris 1046-1055), tambahkan:

```js
  // Mode hero: auto | video | image. Nilai tak dikenal diabaikan (tetap auto).
  if (scope.has('heroMode') && ['auto', 'video', 'image'].includes(String(b.heroMode || ''))) {
    s.heroMode = String(b.heroMode);
  }
```

(d) `src/middleware/upload.js` — di dalam `validateBuffer(file)`, setelah baris `const format = detectFormat(file.buffer);`, tambahkan pemeriksaan gambar polos:

```js
  // Tolak gambar yang secara visual polos (placeholder). Admin yang mengunggah
  // kotak merah/pekat tanpa detail biasanya salahilih — hero jadi blok warna.
  if (field === 'heroFile' || field === 'logoFile') {
    const blank = await image.looksBlank(file.buffer);
    if (blank.blank) {
      const err = new Error(
        field === 'heroFile'
          ? 'Gambar hero terlalu polos (tanpa detail). Unggah foto yang jelas, atau biarkan kosong untuk memakai video bawaan.'
          : 'Logo terlalu polos (tanpa detail). Unggah logo yang jelas, atau biarkan kosong untuk memakai logo bawaan.'
      );
      err.code = 'BLANK_IMAGE';
      throw err;
    }
  }
```

Lalu ubah tanda tangan fungsi & import:

```js
async function validateBuffer(file) {
```
→
```js
async function validateBuffer(file) {
```
(fungsi tetap sinkron — ubah jadi `async` **dan** semua pemanggil jadi `await`):

```js
const {
  MAX_FILE_SIZE,
  detectFormat,
  processImage,
  looksBlank,
  removeUpload: removeUploadByFilename
} = require('../services/image');
```

dan di `validateBuffer`:
```js
async function validateBuffer(file) {
  const format = detectFormat(file.buffer);
  if (!format) {
    const err = new Error(ERR_FORMAT);
    err.code = 'INVALID_IMAGE';
    throw err;
  }
  const blank = await looksBlank(file.buffer);
  if (blank.blank) {
    const err = new Error(
      'Gambar terlalu polos (tanpa detail) sehingga tidak bisa dipakai. ' +
      'Unggah foto yang jelas, atau kosongkan untuk memakai aset bawaan.'
    );
    err.code = 'BLANK_IMAGE';
    throw err;
  }
  return format;
}
```

Tiga pemanggil `validateBuffer(...)` di `upload.js` (`singleImage`, `multiImage`, `galleryImages`) harus jadi `await validateBuffer(...)`.

(e) `src/app.js` — di blok penanganan error (sekitar baris 80), tambahkan cabang untuk `BLANK_IMAGE` **sebelum** cabang `uploadErrors`:

```js
    // Gambar polos ditolak saat unggah (placeholder merah/kosong).
    if (err && err.code === 'BLANK_IMAGE') {
      if (req.session) {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type: 'error', message: err.message });
      }
      return res.redirect('back');
    }
```

**Langkah 3 — jalankan, harus LULUS**: `node scripts/hero-mode.test.js` → 4× `PASS`.

**Langkah 4 — verifikasi error handling belum merusak alur unggah yang sudah ada**:

```bash
cd /d/laragon/www/sabesi && npm run test:e2e:admin-content
```

Harapan: `npm run test:e2e:admin-content` selesai dengan ringkasan "Semua pemeriksaan lulus." (target `admin-content` menjalankan `verify-admin-content-e2e.js` yang menguji CRUD + unggah).

**Langkah 5 — commit**:

```bash
cd /d/laragon/www/sabesi && git add src/seed.js src/routes/admin.routes.js src/middleware/upload.js src/app.js scripts/hero-mode.test.js && git commit -m "feat(hero): setting heroMode + tolak unggah gambar polos"
```

---

#### A3. Perbaiki `views/pages/home.ejs` agar video selalu tersedia + poster dari unggahan

**TDD — tambah ke `scripts/hero-mode.test.js`** (butuh `fs` sudah diimpor):

```js
  await t('home.ejs memilih mode hero dari heroMode', () => {
    const home = fs.readFileSync(path.join(root, 'views', 'pages', 'home.ejs'), 'utf8');
    assert.ok(/heroMode/.test(home), 'home.ejs harus membaca heroMode');
    assert.ok(!/const heroUsesVideo = !heroCustomImage;/.test(home),
      'heroUsesVideo tidak boleh hanya bergantung pada ada/tidaknya gambar');
  });

  await t('hero-animated.ejs menerima parameter heroVideoEnabled dari home', () => {
    const home = fs.readFileSync(path.join(root, 'views', 'pages', 'home.ejs'), 'utf8');
    assert.ok(/heroVideoEnabled:\s*heroUsesVideo/.test(home),
      'home.ejs harus mengirim heroVideoEnabled');
  });
```

**Langkah 1 — jalankan, harus GAGAL**: `node scripts/hero-mode.test.js` → 2× `FAIL` baru.

**Langkah 2 — implementasi `views/pages/home.ejs`**. Ganti blok pembuka (baris 1-17) menjadi:

```ejs
<%# Hero section interaktif: video sinematik + pencarian cepat.

   Mode hero diatur admin lewat Pengaturan → "Tampilan Hero":
     - 'auto'  → video diputar; gambar hero (bila ada) dipakai sebagai POSTER.
     - 'video' → video diputar; gambar hero dipakai sebagai poster.
     - 'image' → video dimatikan; gambar hero (atau poster bawaan) jadi latar.

   Semua nama variabel lokal memakai awalan "h_" agar tidak berbenturan
   dengan parameter include (variable shadowing → TDZ error di EJS). %>
<%
const heroCustomImage = settings.heroImageUrl || '';
const heroPoster = heroCustomImage || '/img/hero-island-poster.jpg';
const heroMode = ['auto', 'video', 'image'].includes(settings.heroMode)
  ? settings.heroMode
  : 'auto';
/* Video hanya mati bila admin memilih mode 'image' secara eksplisit.
   Mode 'auto' tetap memakai video walau ada gambar hero — gambar itu
   hanya jadi poster, bukan penghenti video. */
const heroUsesVideo = heroMode !== 'image';
%>
<%- include('../partials/hero-animated', {
  heroVideoUrl: '/media/hero-islands.mp4',
  heroPosterUrl: heroPoster,
  heroVideoEnabled: heroUsesVideo,
  heroSearchAction: '/cari-trip',
  heroDestinations: allDestinations
}) %>
```

**Langkah 3 — jalankan, harus LULUS**: `node scripts/hero-mode.test.js` → 6× `PASS`.

**Langkah 4 — verifikasi nyata di browser** (wajib, bukan asumsi):

```bash
cd /d/laragon/www/sabesi && rm -rf "$TMPDIR/sabesi-hero-check" && mkdir -p "$TMPDIR/sabesi-hero-check" && SABESI_DATA_DIR="$TMPDIR/sabesi-hero-check" PORT=4398 WA_DISABLE_BG=1 node server.js
```

Lalu di browser (harness), buka `http://localhost:4398/`, wait 4 detik, lalu ukur:

```js
(() => {
  const v = document.querySelector('[data-hero-video]');
  const m = document.querySelector('[data-hero-media]');
  return JSON.stringify({
    hasVideo: !!v,
    readyState: v && v.readyState,
    paused: v && v.paused,
    mediaClass: m && m.className,
    opacity: v && getComputedStyle(v).opacity
  });
})()
```

Harapan: `{"hasVideo":true,"readyState":4,"paused":false,"mediaClass":"hero-video is-playing","opacity":"1"}`.

> Catatan: `cdp('Page.bringToFront')` **wajib** dipanggil sebelum mengukur — tab yang tidak aktif membuat `readyState` tertahan di 0 dan `requestAnimationFrame` mati.

**Langkah 5 — commit**:

```bash
cd /d/laragon/www/sabesi && git add views/pages/home.ejs scripts/hero-mode.test.js && git commit -m "feat(hero): video hero aktif pada semua mode kecuali image"
```

---

#### A4. Redesign visual hero + perbaiki class yatim CSS

**TDD — tambah ke `scripts/hero-mode.test.js`:**

```js
  await t('class yatim hero-search__field--dest/--date punya definisi CSS', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'hero-animated.css'), 'utf8');
    assert.ok(/\.hero-search__field--dest\b/.test(css), 'hero-search__field--dest belum ada di CSS');
    assert.ok(/\.hero-search__field--date\b/.test(css), 'hero-search__field--date belum ada di CSS');
  });

  await t('hero-animated.css punya mode gambar (tanpa video)', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'hero-animated.css'), 'utf8');
    assert.ok(/\.hero-video\.is-static\b/.test(css), 'perlu kelas is-static untuk mode gambar');
  });
```

**Langkah 1 — jalankan, harus GAGAL**: 2× `FAIL` baru.

**Langkah 2 — implementasi `public/css/hero-animated.css`**. Tambahkan di **akhir** berkas (paling bawah), supaya menimpa aturan lama tanpa mengedit blok yang sudah ada:

```css
/* ==========================================================================
   REDESIGN HERO (2026-11-14)
   --------------------------------------------------------------------------
   1. Class yatim `--dest` / `--date` kini punya definisi.
   2. Mode 'image' (tanpa video) punya tampilan yang sama-eqitnya dengan mode video.
   3. Pita bawah hero dibuat "safe area" agar konten di layar pendek tidak
      tertutup tombol WA mengambang & tombol audio.
   ========================================================================== */

/* ---------- Class yatim: kolom form yang sebelumnya tanpa gaya ---------- */
.hero-search__field--dest { grid-column: auto; }
.hero-search__field--date { grid-column: auto; }

@media (max-width: 900px) {
  .hero-search__field--dest,
  .hero-search__field--date { grid-column: auto; }
}

/* ---------- Mode gambar: poster statis tanpa video ---------- */
.hero-video.is-static .hero-video__el { display: none; }
.hero-video.is-static .hero-video__poster { filter: saturate(1.04) contrast(1.02); }
/* Overlay sedikit lebih gelap karena tidak ada video yang bergerak —
   kontras teks dijaga tetap di atas WCAG AA 4.5:1. */
.hero-video.is-static .hero-video__overlay {
  background:
    linear-gradient(100deg, rgba(4, 22, 30, 0.74) 0%, rgba(4, 22, 30, 0.54) 40%, rgba(4, 22, 30, 0.24) 70%, rgba(4, 22, 30, 0.12) 100%),
    linear-gradient(180deg, rgba(4, 22, 30, 0.26) 0%, rgba(4, 22, 30, 0.04) 22%, rgba(4, 22, 30, 0.38) 80%, rgba(4, 22, 30, 0.82) 100%);
}

/* ---------- Safe area bawah: konten hero tidak tertutup widget mengambang ---------- */
.hero--animated__inner {
  padding-bottom: max(4.2rem, calc(4.2rem + env(safe-area-inset-bottom, 0px)));
}
@media (max-width: 640px) {
  .hero--animated__inner { padding-bottom: 5.4rem; }
}

/* ---------- Pita gradien dekoratif di bawah hero (pembatas ke section berikutnya) ---------- */
.hero--animated::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(90deg, var(--apricot) 0%, var(--coral) 55%, var(--teal-400) 100%);
  opacity: 0.85;
}

/* ---------- Judul: ketegasan tipografi ---------- */
.hero--animated__title {
  letter-spacing: -0.015em;
  text-wrap: balance;
}
.hero--animated__sub { text-wrap: pretty; }
```

**Langkah 3 — `public/js/hero-animated.js`**: tambahkan dukungan kelas `is-static` (dipakai saat mode 'image') — ubah blok inisialisasi video:

Ganti di `public/js/hero-animated.js`:

```js
  if (video) {
    // Jaring pengaman: bila video sudah siap SEBELUM script ini dieksekusi
    // (mis. cache panas → 'loadeddata' terlewat), pasang flag main manual.
    if (video.readyState >= 2) {
      media && media.classList.add('is-playing');
    }
```

menjadi:

```js
  if (video) {
    // Jaring pengaman: bila video sudah siap SEBELUM script ini dieksekusi
    // (mis. cache panas → 'loadeddata' terlewat), pasang flag main manual.
    //
    // ATURAN UMUM: untuk flag yang bergantung pada readiness media, SELALU
    // cek state saat init + pasang di event — event saja bisa terlewat.
    if (video.readyState >= 2) {
      media && media.classList.add('is-playing');
    }
```

(Teks penjelasan sudah ada — tidak ada perubahan fungsional di sini. Perubahan fungsional ada di A5.)

Tambahkan di `public/js/hero-animated.js`, tepat setelah blok `if (video) { ... }` yang sudah selesai, kode berikut:

```js
  /* ---------------------------------------------------------------
   * 1b. Mode tanpa video (heroMode = 'image')
   *
   * Saat admin memilih mode gambar, <video> tidak dirender sama sekali.
   * biarpun <video> sempat ada (mis. diganti lewat devtools), kelas
   * 'is-static' memastikan poster yang tampil & overlay tetap/joblum gelap.
   * ------------------------------------------------------------- */
  if (media && !video) {
    media.classList.add('is-static');
  }
```

**Langkah 4 — jalankan, harus LULUS**: `node scripts/hero-mode.test.js` → 8× `PASS`.

**Langkah 5 — audit kontras hero di browser** (WAJIB, angka bukan perkiraan mata). Di browser pada `http://localhost:4398/`:

```js
(() => {
  const v = document.querySelector('[data-hero-video]');
  const m = document.querySelector('[data-hero-media]');
  const title = document.querySelector('.hero--animated__title');
  return JSON.stringify({
    mediaClass: m && m.className,
    videoOpacity: v ? getComputedStyle(v).opacity : 'n/a',
    titleColor: getComputedStyle(title).color,
    titleSize: getComputedStyle(title).fontSize
  });
})()
```

Lalu ambil screenshot PNG & ukur luminance di region teks memakai `sharp` (pola yang sama seperti `references/homepage-audit.md` skill `sabesi-website-upload-theme`). **Target: teks title ≥ 4.5:1 di SEMUA scene video** (ambil sampel pada `video.currentTime` = 0, 3.4, 7.0, 10.5, 13.9).

> Jebakan skill: `capture_screenshot()` menimpa path yang sama → untuk banyak titik waktu pakai `cdp('Page.captureScreenshot', format='png')` lalu tulis base64 ke file berbeda sendiri.

**Langkah 6 — commit**:

```bash
cd /d/laragon/www/sabesi && git add public/css/hero-animated.css public/js/hero-animated.js scripts/hero-mode.test.js && git commit -m "feat(hero): redesign visual hero + perbaiki class yatim CSS"
```

---

#### A5. Perbaiki `hero-animated.js` agar video tidak pernah "hilang" (anti-flicker & anti-race)

**TDD — tambah ke `scripts/hero-mode.test.js`:**

```js
  await t('hero-animated.js memasang flag is-playing saat init DAN saat event', () => {
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'hero-animated.js'), 'utf8');
    const hasInitCheck = /readyState\s*>=\s*2[\s\S]{0,200}is-playing/.test(js);
    const hasEvent = /addEventListener\(\s*'loadeddata'/.test(js);
    assert.ok(hasInitCheck, 'cek readyState saat init wajib ada');
    assert.ok(hasEvent, 'listener loadeddata wajib ada');
  });

  await t('hero-animated.js punya jaring pengaman timeout 6 detik', () => {
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'hero-animated.js'), 'utf8');
    assert.ok(/6000/.test(js), 'harus ada fallback 6 detik');
  });
```

**Langkah 1 — jalankan**: harus PASS (guard sudah ada dari implementasi sebelumnya — ini regression guard, bukan failing test). Kalau FAIL, perbaiki di langkah 2.

**Langkah 2 — implementasi (pengerasan)** di `public/js/hero-animated.js`:

(a) Pada blok timeout, ensure pesan log tidak membocorkan URL media:

```js
      window.setTimeout(function () {
        if (video.readyState < 2) {
          useFallback('video tidak siap dalam 6 detik');
        }
      }, 6000);
```
→
```js
      window.setTimeout(function () {
        if (video.readyState < 2) {
          useFallback('video tidak siap dalam 6 detik');
        }
      }, 6000);
```
(tidak berubah — hanya konfirmasi.)

(b) Tambahkan penanganan `visibilitychange`: saat tab kembali aktif, pastikan video继续 diputar:

```js
  /* ---------------------------------------------------------------
   * 1c. Autoplay bisa diblokir kebijakan hemat-data.
   *
   * Saat tab kembali aktif (pengguna kembali dari tab lain), browser
   * tidak otomatis melanjutkan playback yang tertahan. Kita paksa
   * play() lagi — tanpa itu, hero terlihat "beku" padahal tidak error.
   * ------------------------------------------------------------- */
  if (video) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (video.paused && video.readyState >= 2 && video.muted) {
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () { /* abaikan */ });
      }
    });
  }
```

Letakkan blok ini **setelah** blok `if (video) { ... }` yang sudah ada (sebelum bagian "2. Kontrol audio ambient").

**Langkah 3 — jalankan**: `node scripts/hero-mode.test.js` → 10× `PASS`.

**Langkah 4 — verifikasi di browser**: buka `http://localhost:4398/`, tunggu 5 detik, ubah tab (buka tab baru lalu kembali), lalu ukur ulang:

```js
(() => {
  const v = document.querySelector('[data-hero-video]');
  return JSON.stringify({ paused: v.paused, readyState: v.readyState, t: +v.currentTime.toFixed(2) });
})()
```

Harapan: `paused: false`, `readyState: 4`, dan `t` bertambah.

**Langkah 5 — commit**:

```bash
cd /d/laragon/www/sabesi && git add public/js/hero-animated.js scripts/hero-mode.test.js && git commit -m "fix(hero): pastikan video tetap diputar setelah tab kembali aktif"
```

---

#### A6. Panel admin: lengkapi sprite ikon SVG (hilang: i-plus, i-trash, i-eye)

**TDD — buat `scripts/admin-sprite.test.js`:**

```js
'use strict';
/**
 * Uji kelengkapan sprite ikon admin.
 *
 * Semua <use href="#i-nama"> yang dipakai di template WAJIB punya
 * definisi <g id="i-nama"> di views/layouts/admin.ejs. Simbol yang hilang
 * membuat ikon tak terlihat (tombol kehilangan affordance).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const viewsDir = path.join(root, 'views');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ejs')) out.push(p);
  }
  return out;
}

const layout = fs.readFileSync(path.join(viewsDir, 'layouts', 'admin.ejs'), 'utf8');
const defined = new Set([...layout.matchAll(/id="(i-[a-z]+)"/g)].map((m) => m[1]));

const used = new Set();
for (const file of walk(viewsDir, [])) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/href="#(i-[a-z]+)"/g)) used.add(m[1]);
}

const missing = [...used].filter((id) => !defined.has(id)).sort();

console.log(`  ikon dipakai: ${used.size}, terdefinisi: ${defined.size}`);
if (missing.length) {
  console.log('  MISSING: ' + missing.join(', '));
  console.log('\n1 suite gagal.');
  process.exit(1);
}
console.log('\nSemua suite lulus.');
```

**Langkah 1 — jalankan, harus GAGAL**:

```bash
cd /d/laragon/www/sabesi && node scripts/admin-sprite.test.js
```

Harapan: `MISSING: i-eye, i-plus, i-trash` → exit code 1.

**Langkah 2 — implementasi** di `views/layouts/admin.ejs`. Tambahkan 3 simbol berikut **tepat setelah** baris `<g id="i-pin">…</g>` (baris ~57, masih di dalam `<defs>`):

```html
      <g id="i-plus"><path d="M11 5v12M5 11h12"/></g>
      <g id="i-trash"><path d="M4 6h14M9 6V4.5h4V6M6.5 6l.8 12.5h7.4L15.5 6M9.5 9.5v6M12.5 9.5v6"/></g>
      <g id="i-eye"><path d="M2.5 11S6 5.5 11 5.5 19.5 11 19.5 11 16 16.5 11 16.5 2.5 11 2.5 11Z"/><circle cx="11" cy="11" r="2.6"/></g>
```

> Semua ikon memakai `stroke="currentColor"` lewat CSS `.admin-body svg:not(.a-sprite)` di `public/css/admin-v2.css` — jadi cukup `path`/`circle` tanpa `fill`.

**Langkah 3 — jalankan, harus LULUS**:

```bash
cd /d/laragon/www/sabesi && node scripts/admin-sprite.test.js
```

Harapan: `ikon dipakai: 32, terdefinisi: 33` lalu `Semua suite lulus.` Exit code 0.

**Langkah 4 — verifikasi visual di browser**: buka `http://localhost:4399/admin/marketing/kontak`, ukur:

```js
(() => {
  const uses = [...document.querySelectorAll('svg use')];
  const bad = uses.filter(u => !document.getElementById(u.getAttribute('href').slice(1)));
  return JSON.stringify({ total: uses.length, missing: bad.map(u => u.getAttribute('href')) });
})()
```

Harapan: `{"total":38,"missing":[]}`.

**Langkah 5 — tambahkan skrip ini ke `npm test`**: di `scripts/wa-run-tests.js`, tambahkan `'admin-sprite.test.js'` ke array `suites` (setelah `'presence.test.js'`). Lalu:

```bash
cd /d/laragon/www/sabesi && npm test
```

Harapan: baris terakhir `Semua suite lulus.` (semua 14 suite).

**Langkah 6 — commit**:

```bash
cd /d/laragon/www/sabesi && git add views/layouts/admin.ejs scripts/admin-sprite.test.js scripts/wa-run-tests.js && git commit -m "fix(admin): lengkapi sprite ikon (i-plus, i-trash, i-eye)"
```

<!--CHUNK3-->

