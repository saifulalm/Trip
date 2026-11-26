# Plan Lanjutan — Audit Lokasi: Sisa Fase 3 & Fase 4 (Task 16–20)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melengkapi celah "user hilang" — SOSdarurat dari pelanggan, pusat alert admin, halaman admin peserta global, roster bersama di peta, dan geofence otomatis — dengan tetap menjaga privasi lokasi yang sudah dibangun di Task 12–15.

**Architecture:** Plan ini adalah LANJUTAN dari `docs/superpowers/plans/2026-11-25-audit-implementation-plan.md` (Task 1–15, semua sudah ter-commit). Plan induk hanya menulis "Peta File" Fase 3 & Fase 4 sebagai tabel — tidak pernah menjadi task. Plan ini mengunci arsitektur tersebut menjadi Task 16–20 yang bisa diuji satu per satu. Semua state runtime (presence, SOS) tetap di `data/presence.json` (bukan `db.json`), sesuai Task 12. Server-side rendered (EJS), tanpa build step frontend.

**Tech Stack:** Node.js 18+, Express 4.21, EJS 3.1 + express-ejs-layouts, `data/db.json` (JSON store), `data/presence.json` (state runtime), SSE (bukan socket.io), Leaflet 1.9.4 via CDN, Vanilla JS sisi klien (IIFE, tanpa bundler). Harness uji: `scripts/*.test.js` (assert-based) + `scripts/run-e2e.js` (HTTP/Puppeteer).

**Spec:** `docs/audit-2026-11-25-empat-fokus.md` (bagian C.3 "Skema yang dibutuhkan" dan D "Rekomendasi Fitur Tambahan")

---

## Global Constraints

- **Tanpa langkah lint.** Dilarang keras memasukkan `eslint`, `prettier`, `npm run lint`, `tsc --noEmit`, atau langkah perbaikan format ke dalam plan maupun eksekusi.
- **Semua komentar kode dan penjelasan logika ditulis dalam Bahasa Indonesia.**
- **Server-side rendered.** Tidak boleh menambah dependensi frontend/bundler. Perubahan UI = edit `.ejs` + edit/buat file JS statis di `public/js/`.
- **Tidak menambah dependensi npm.**
- **Isolasi data uji WAJIB.** Setiap skrip uji baru harus `require(path.join(__dirname, 'test-db'))` **sebelum** `require` modul `src/db`. Untuk `src/services/presence.js` (bukan `src/db`), isolasi lewat env `PRESENCE_FILE` (pola sudah dipakai `scripts/presence.test.js`).
- **Skrip uji baru harus didaftarkan** di array `suites` pada `scripts/wa-run-tests.js`, kalau tidak tidak akan pernah dijalankan oleh `npm test`.
- **Privasi lokasi:** pelanggan hanya melihat admin + fellow traveler dengan **booking yang sama** atau **rombongan (tripGroup) yang sama**. Admin melihat semua. Pelanggan TIDAK boleh melihat pelanggan lain.
- **CSRF:** request JSON/fetch wajib kirim header `x-csrf-token` (lihat `src/middleware/security.js:28`). Form biasa wajib `_csrf`.
- **Webhook OpenWA** harus tetap mounted **sebelum** `express.json()` di `src/app.js:30` (HMAC dihitung atas byte mentah).
- **Aturan etika WhatsApp** (`src/services/wa.js:16-22`): hanya kirim ke kontak opt-in, opt-out menang atas opt-in, jam tenang menunda bukan membatalkan, izin dicek ULANG saat pengiriman, setiap nomor punya hasil tercatat. **Alert SOS admin TIDAK boleh melanggar ini.**
- **Data produksi tidak boleh masuk commit.** `data/db.json`, `data/presence.json`, `public/uploads/*` tidak pernah di-commit.
- **Working tree repo sangat kotor** dan berisi perubahan milik sesi lain. `git add -A` / `git add .` / `git add -u` **DILARANG** — add per file eksplisit.

---

## Review Focus

Lima kelas input/kondisi yang paling mungkin menggigit orang nyata. Tiap baris punya tesnya di task yang relevan.

| # | Input / kondisi | Perilaku yang diharapkan | Task |
|---|---|---|---|
| R1 | Pelanggan menekan SOS saat GPS **tidak bisa dibaca** (sinyal jelek) | Tidak ada error bodoh; antrean lokal, dan status "menunggu sinyal" terlihat jelas di kedua sisi | Task 17 |
| R2 | Admin menekan "resolve" pada alert SOS yang **sudah lama** | Resolve tetap tercatat dengan waktu & siapa yang resolve, dan alert tidak muncul lagi di daftar aktif | Task 18 |
| R3 | Dua pelanggan ada di **rombongan yang sama** tapi booking-nya berbeda | Keduanya saling terlihat (privasi berbasis group), bukan saling tersembunyi | Task 16, Task 19 |
| R4 | Peserta dijauhkan dari titik kumpul **lebih dari radius** | Geofence memicu **peringatan**, bukan blokir — dan hanya sekali per peacefully | Task 20 |
| R5 | Admin membuka halaman peserta global | Admin melihat SEMUA pelanggan beserta titik terakhirnya; pelanggan yang membuka halaman yang sama **menolak** | Task 19 |

---

## Peta File (Struktur yang Dikunci)

| File | Tanggung jawab |
|---|---|
| `src/services/presence.js` | Tambah lapisan `sos` (antrean darurat) ke skema `presence.json` v3. |
| `src/services/roster.js` | **Dipakai apa adanya** (Task 13) — task ini hanya memanggilnya, tidak mengubahnya. |
| `src/services/geofence.js` | **BARU:** deteksi peserta jauh dari titik kumpul + cooldown. |
| `src/app.js` | Mount router alert (`/admin/alert`). |
| `src/services/alert.js` | **BARU:** dispatcher alert (SOS + geofence) → WhatsApp + realtime. |
| `src/services/wa-alert.js` | **BARU:** template pesan alert & pengiriman non-blocking ke koordinator. |
| `src/services/wa-scheduler.js` | Tambah siklus pemeriksaan geofence berkala. |
| `src/services/realtime.js` | Tambah `EVENTS.ALERT`. |
| `src/routes/presence.routes.js` | Tambah `GET /api/presence/roster`, `POST /api/presence/sos`, `GET /api/presence/sos`. |
| `src/routes/alert.routes.js` | **BARU:** router alert (mount di `src/app.js`). |
| `src/routes/admin.routes.js` | Tambah `GET /admin/peserta`. |
| `views/admin/peserta.ejs` | **BARU:** halaman admin peserta (pencarian & roster global). |
| `views/admin/alert.ejs` | **BARU:** pusat alert admin. |
| `views/admin/lokasi.ejs` | Tambah last-seen, roster, tombol SOS/resolve. |
| `views/pages/account-location.ejs` | Tambah badge last-seen + tombol SOS + link peta. |
| `public/js/presence.js` | Tambah dukungan antrean SOS offline. |
| `public/js/map.js` | Tambah `api.setRoster(entries)` untuk marker rombongan. |
| `views/layouts/admin.ejs` | Tambah link navigasi Peserta & Alert. |

---

## Urutan Eksekusi

Task 16 → 17 → 18 → 19 → 20 (WAJIB). Alasannya:
- Task 16 (privasi berbasis group) dipakai Task 17 (SOS) dan Task 19 (admin peserta).
- Task 17 (lapisan SOS di presence) dipakai Task 18 (dispatcher alert).
- Task 19 (admin peserta) memakai Task 16 dan Task 17.
- Task 20 (geofence) memakai Task 18 (dispatcher) dan Task 16 (roster).

---

## Task 16 — Privasi lokasi berbasis rombongan (bukan cuma kode booking)

**Files:**
- Modify: `src/services/presence.js`
- Test: `scripts/presence.test.js` (tambah suite baru di akhir file)

**Interfaces:**
- Consumes: `roster.groupsForCustomer(data, customerId)` → `Array<{id, name, bookingCodes}>` (dari Task 13, sudah ada di `src/services/roster.js`).
- Produces (baru di `src/services/presence.js`):
  - `visibleBookingCodes(data, customerId) → string[]` — kode booking yang boleh dilihat pelanggan: booking miliknya sendiri **+** seluruh kode booking di rombongan yang dia ikuti.

**Konteks:**
`peersOf()` (`src/services/presence.js:350`) hanya membandingkan irisan **kode booking**. Dua pelanggan beda kode booking tapi satu kapal (satu `tripGroup`) **tidak saling terlihat** — padahal kasus "terpisah dari rombongan" persis butuh mereka saling terlihat. Task 13 sudah menyediakan model `tripGroups`; task ini menyambungkannya ke privasi presence.

**Aturan privasi (WAJIB dipatuhi — jangan longgarkan):**
1. Admin melihat semua partisipan.
2. Pelanggan melihat admin/tim.
3. Pelanggan melihat pelanggan lain bila **irisan kode booking** tidak kosong, di mana "kode booking saya" = booking saya **+** booking milik fellow traveler dicjup-my-romongan yang saya ikuti.

**Decision (sudah diruling controller):**
- `presence.js` boleh `require('./roster')`. Tidak ada siklus: `roster.js` hanya butuh `./geo`.
- Peer TIDAK perlu tahu group-nya. Cukup perhitungan di sisi peminta: "kode yang saya boleh lihat" diperluas oleh group. Peer tetap membawa `bookingCodes` miliknya sendiri (dari `bookingCodesFor()`), dan irisan dihitung terhadap set yang sudah diperluas.
- JANGAN ubah `bookingCodesFor()` — isinya tetap "kode booking milik orang itu", dipakai `POST /ping`.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/presence.test.js` (pola `test('...', () => {...})` yang sudah dipakai file itu):

  ```js
  test('visibleBookingCodes memuat booking sendiri + booking-fellow-travelerongan', () => {
    const SVC = loadWith(TMP_FILE);
    const data = {
      bookings: [
        { id: 'b1', code: 'SYL-1', customerId: 'c1' },
        { id: 'b2', code: 'SYL-2', customerId: 'c2' },
        { id: 'b3', code: 'SYL-9', customerId: 'c9' }
      ],
      tripGroups: [
        { id: 'g1', name: 'Rombongan A', bookingCodes: ['SYL-1', 'SYL-2'] }
      ]
    };
    const codes = SVC.visibleBookingCodes(data, 'c1');
    assert.ok(codes.includes('SYL-1'), 'booking sendiri harus masuk');
    assert.ok(codes.includes('SYL-2'), 'booking sekelompok harus masuk');
    assert.ok(!codes.includes('SYL-9'), 'booking orang lain tidak boleh masuk');
  });

  test('pelanggan sekelompok saling terlihat meski kode booking berbeda', () => {
    const SVC = loadWith(TMP_FILE);
    const data = {
      bookings: [
        { id: 'b1', code: 'SYL-1', customerId: 'c1' },
        { id: 'b2', code: 'SYL-2', customerId: 'c2' }
      ],
      tripGroups: [
        { id: 'g1', name: 'Rombongan A', bookingCodes: ['SYL-1', 'SYL-2'] }
      ]
    };
    SVC.upsert({ role: 'customer', refId: 'c2', name: 'Sari', lat: 1, lng: 2, bookingCodes: ['SYL-2'] },
      { presenceEnabled: true, presenceTtlMin: 60 });
    const peers = SVC.peersOf({ role: 'customer', refId: 'c1', lat: 1, lng: 2 }, data,
      { presenceEnabled: true, presenceTtlMin: 60 });
    assert.ok(peers.some((p) => p.refId === 'c2'), 'sekelompok harus terlihat');
  });

  test('pelanggan beda rombongan tetap tidak saling terlihat', () => {
    const SVC = loadWith(TMP_FILE);
    const data = {
      bookings: [
        { id: 'b1', code: 'SYL-1', customerId: 'c1' },
        { id: 'b2', code: 'SYL-2', customerId: 'c2' }
      ],
      tripGroups: []
    };
    SVC.upsert({ role: 'customer', refId: 'c2', name: 'Sari', lat: 1, lng: 2, bookingCodes: ['SYL-2'] },
      { presenceEnabled: true, presenceTtlMin: 60 });
    const peers = SVC.peersOf({ role: 'customer', refId: 'c1', lat: 1, lng: 2 }, data,
      { presenceEnabled: true, presenceTtlMin: 60 });
    assert.strictEqual(peers.length, 0, 'bukan sekelompok tidak boleh terlihat');
  });
  ```

  > Polanya sudah ada di file itu: `loadWith(TMP_FILE)` memuat ulang modul dengan env `PRESENCE_FILE` agar data uji tidak menyentuh `data/presence.json` produksi.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/presence.test.js`
  Expected: FAIL — `SVC.visibleBookingCodes is not a function`, dan test "sekelompok saling terlihat" gagal (privasi berbasis group belum ada).

- [ ] **Step 3: Implementasikan `visibleBookingCodes` di `src/services/presence.js`**

  Tambahkan `require` di bagian atas file:

  ```js
  const roster = require('./roster');
  ```

  Tambahkan fungsi ini (letakkan tepat setelah `customerBookingCodes`):

  ```js
  /**
   * Kode-kode booking yang boleh dilihat seorang pelanggan.
   *
   * Selain booking miliknya sendiri, ini mencakup booking fellow traveler
   * di rombongan yang sama — satu kapal. Tanpa ini, dua pelanggan dengan kode booking
   * berbeda tapi satu Voyage tidak saling melihat — padahal kasus
   * "terpisah dari rombongan" justru butuh mereka saling terlihat.
   *
   * @param {object} data data aplikasi
   * @param {string} customerId id pelanggan
   * @returns {string[]} daftar kode booking (unik)
   */
  function visibleBookingCodes(data, customerId) {
    const own = customerBookingCodes(data, customerId);
    const out = new Set(own);
    let groups = [];
    try {
      groups = roster.groupsForCustomer(data, customerId) || [];
    } catch (err) {
      groups = [];
    }
    groups.forEach((g) => {
      (g.bookingCodes || []).forEach((c) => out.add(String(c)));
    });
    return Array.from(out);
  }
  ```

  Ubah `peersOf()` agar memakai fungsi itu. Ganti baris:

  ```js
  const mine = me.role === 'admin' ? null : customerBookingCodes(data, me.refId);
  ```

  menjadi:

  ```js
  const mine = me.role === 'admin' ? null : visibleBookingCodes(data, me.refId);
  ```

  Tambahkan `visibleBookingCodes,` ke `module.exports`.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

  Run: `node scripts/presence.test.js`
  Expected: `OK — N pemeriksaan lulus`, exit 0.

- [ ] **Step 5: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus." (termasuk `presence-http.test.js` yang menguji privasi via HTTP).

  > Kalau `presence-http.test.js` gagal: periksa apakah ada skenario uji yang dulu menganggap dua pelanggan beda booking **tidak boleh** saling terlihat, padahal skenario itu sebenarnya satu group. Baca detail skenario di `scripts/presence-http.test.js` — kalau skenario uji memang memakai `tripGroups`, tidak ada yang perlu diubah.

- [ ] **Step 6: Jalankan penjaga**

  Run: `node scripts/wa-check.js`
  Expected: "Semua modul & template OK." exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/services/presence.js scripts/presence.test.js
  git commit -m "feat(presence): privasi lokasi diperluas ke fellow traveler satu rombongan"
  ```

---

## Task 17 — Antrean SOS di presence service (skema v3)

**Files:**
- Modify: `src/services/presence.js`
- Test: `scripts/presence.test.js` (tambah suite baru di akhir file)

**Interfaces:**
- Consumes: `geo.isValidLatLng(lat, lng)` (sudah ada).
- Produces (baru di `src/services/presence.js`):
  - `sosCreate({role, refId, name, phone, lat, lng, accuracy}, settings) → object|null` — membuat entri SOS baru dan mengembalikannya. Mengembalikan `null` bila koordinat invalid.
  - `sosList(status?) → object[]` — daftar alert SOS, **terbaru dulu**. Tanpa argumen → semua status.
  - `sosResolve(id, resolvedBy) → object|null` — menandai alert resolved; mengembalikannya, atau `null` bila id tidak dikenal.
  - `sosActiveCount() → number` — jumlah alert yang belum resolved.
  - `SCHEMA_VERSION` naik dari `2` ke `3`.

**Konteks:**
Kasus darurat "user hilang" adalah celah paling kritis (audit F1). Pelanggan harus bisa menekan tombol SOS yang mencatat **titik lokasi + waktu + nomor kontak**, supaya admin bisa dikejar. Antrean ini hidup di `data/presence.json` (bukan `db.json`) — sama seperti presence — karena isinya operasional, bukan data bisnis.

**Skema `data/presence.json` versi 3:**
```json
{
  "version": 3,
  "entries": { "customer:cus_x": { } },
  "lastSeen": { "customer:cus_x": { } },
  "sos": [
    { "id": "sos_x", "role": "customer", "refId": "cus_x", "name": "Budi",
      "phone": "0812...", "lat": -0.46, "lng": 130.89, "accuracy": 12,
      "at": "2026-11-26T03:00:00.000Z", "status": "active",
      "resolvedAt": null, "resolvedBy": null }
  ]
}
```

**Decision (sudah diruling controller):**
- `sos` adalah **array**, bukan map — urutannya penting (terbaru dulu) dan jumlah alert kecil.
- `status` hanya punya dua nilai: `'active'` dan `'resolved'`. Alert yang sudah resolved TIDAK dihapus — jadi riwayat tetap bisa diaudit.
- Maks 200 entri SOS per berkas. Saat menambah dan sudah 200, **buang yang tertua yang sudah resolved** lebih dulu; kalau semua masih active, buang yang tertua. Ini mencegah berkas membengkak tanpa batas.
- `sosCreate` TIDAK mengirim WhatsApp dan TIDAK membroadcast realtime — itu urusan Task 18 (`src/services/alert.js`). Task ini murni lapisan penyimpanan.
- Kolom `phone` boleh kosong (`''`) — tidak semua pelanggan mengisi nomor. Jangan tolak SOS hanya karena nomor kosong; koordinat yang jadi syarat.
- Koordinat WAJIB valid — tanpa koordinat, alert tidak berguna.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/presence.test.js`:

  ```js
  test('sosCreate membuat entri SOS aktif', () => {
    const SVC = loadWith(TMP_FILE);
    const s = SVC.sosCreate(
      { role: 'customer', refId: 'cus_s', name: 'Budi', phone: '0812', lat: -0.46, lng: 130.89, accuracy: 12 },
      { presenceEnabled: true, presenceTtlMin: 60 }
    );
    assert.ok(s, 'entri SOS harus dibuat');
    assert.strictEqual(s.status, 'active');
    assert.strictEqual(s.refId, 'cus_s');
    assert.ok(s.id, 'id SOS wajib ada');
    assert.ok(s.at, 'waktu wajib ada');
  });

  test('sosCreate menolak koordinat invalid', () => {
    const SVC = loadWith(TMP_FILE);
    const s = SVC.sosCreate({ role: 'customer', refId: 'cus_x', name: 'X', lat: 'abc', lng: 130 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    assert.strictEqual(s, null, 'koordinat invalid harus ditolak');
  });

  test('sosList mengembalikan yang terbaru lebih dulu', () => {
    const SVC = loadWith(TMP_FILE);
    SVC.sosCreate({ role: 'customer', refId: 'a', name: 'A', lat: 1, lng: 2 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    SVC.sosCreate({ role: 'customer', refId: 'b', name: 'B', lat: 3, lng: 4 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    const list = SVC.sosList();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].refId, 'b', 'yang dibuat terakhir harus di depan');
  });

  test('sosResolve menandai resolved dan tidak dihapus', () => {
    const SVC = loadWith(TMP_FILE);
    const s = SVC.sosCreate({ role: 'customer', refId: 'c', name: 'C', lat: 1, lng: 2 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    const done = SVC.sosResolve(s.id, 'admin_x');
    assert.ok(done, 'resolve harus mengembalikan entri');
    assert.strictEqual(done.status, 'resolved');
    assert.strictEqual(done.resolvedBy, 'admin_x');
    assert.ok(done.resolvedAt, 'waktu resolve wajib ada');
    assert.strictEqual(SVC.sosList().length, 1, 'riwayat tidak boleh dihapus');
    assert.strictEqual(SVC.sosActiveCount(), 0);
  });

  test('sosResolve id tak dikenal mengembalikan null', () => {
    const SVC = loadWith(TMP_FILE);
    assert.strictEqual(SVC.sosResolve('sos_tidak_ada', 'admin_x'), null);
  });

  test('presence.json memakai schema versi 3 dengan field sos', () => {
    const SVC = loadWith(TMP_FILE);
    SVC.sosCreate({ role: 'customer', refId: 'd', name: 'D', lat: 1, lng: 2 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    const raw = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    assert.strictEqual(raw.version, 3);
    assert.ok(Array.isArray(raw.sos), 'field sos harus berupa array');
    assert.strictEqual(raw.sos.length, 1);
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/presence.test.js`
  Expected: FAIL — `SVC.sosCreate is not a function`, `raw.version` masih `2`.

- [ ] **Step 3: Implementasikan di `src/services/presence.js`**

  **3a. Skema & penyimpanan.**

  Naikkan konstanta:

  ```js
  const SCHEMA_VERSION = 3;
  ```

  Tambahkan state modul di samping `entries` & `lastSeenMap`:

  ```js
  let sosList_ = [];
  ```

  Di `load()`, baca bagian `sos`:

  ```js
  sosList_ = (raw && Array.isArray(raw.sos)) ? raw.sos : [];
  ```

  Di `persist()`, tulis bagian `sos`:

  ```js
  JSON.stringify({ version: SCHEMA_VERSION, entries, lastSeen: lastSeenMap, sos: sosList_ }, null, 2)
  ```

  Di blok `catch` pada `load()`, tambahkan `sosList_ = [];`.

  **3b. Fungsi API.** Tambahkan blok ini sebelum `module.exports`:

  ```js
  /** Batas jumlah entri SOS yang disimpan di berkas. */
  const SOS_MAX = 200;

  /**
   * Buat entri SOS baru (keadaan darurat).
   *
   * @param {object} p
   * @param {string} p.role 'admin' | 'customer'
   * @param {string} p.refId id user / customer
   * @param {string} [p.name] nama tampilan
   * @param {string} [p.phone] nomor kontak (boleh kosong)
   * @param {number} p.lat latitude
   * @param {number} p.lng longitude
   * @param {number} [p.accuracy] akurasi meter
   * @param {object} [settings] data.settings (untuk TTL & status aktif)
   * @returns {object|null} entri SOS, atau null bila koordinat invalid
   */
  function sosCreate(p, settings) {
    if (!p || !p.role || !p.refId) return null;
    if (!geo.isValidLatLng(p.lat, p.lng)) return null;

    load();
    const entry = {
      id: 'sos_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      role: String(p.role),
      refId: String(p.refId),
      name: String(p.name || '').slice(0, 80),
      phone: String(p.phone || '').slice(0, 25),
      lat: Number(p.lat),
      lng: Number(p.lng),
      accuracy: Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null,
      at: new Date().toISOString(),
      status: 'active',
      resolvedAt: null,
      resolvedBy: null
    };

    sosList_.unshift(entry);
    // Batasi jumlah: buang entri resolved yang tertua lebih dulu.
    while (sosList_.length > SOS_MAX) {
      const idx = sosList_.findIndex((e) => e && e.status === 'resolved');
      sosList_.splice(idx === -1 ? sosList_.length - 1 : idx, 1);
    }

    persist();
    bus.emit('change', { type: 'sos', entry });
    return entry;
  }
  ```

  > Catatan: entri baru pakai `unshift` supaya paling depan; `sosList()` tetap mengurutkan ulang agar aman.

  ```js
  /**
   * Daftar alert SOS.
   * @param {string} [status] filter status ('active' | 'resolved'); tanpa argumen = semua
   * @returns {object[]} daftar, terbaru dulu
   */
  function sosList(status) {
    load();
    const list = sosList_.filter((e) => e && (!status || e.status === status));
    return list.slice().sort((a, b) => {
      const ta = new Date(a.at).getTime() || 0;
      const tb = new Date(b.at).getTime() || 0;
      return tb - ta;
    });
  }

  /**
   * Tandai alert SOS sebagai resolved.
   * @param {string} id id alert
   * @param {string} [resolvedBy] siapa yang resolve (id user admin)
   * @returns {object|null} entri yang di-update, atau null bila id tidak dikenal
   */
  function sosResolve(id, resolvedBy) {
    load();
    const entry = sosList_.find((e) => e && e.id === id);
    if (!entry) return null;
    entry.status = 'resolved';
    entry.resolvedAt = new Date().toISOString();
    entry.resolvedBy = resolvedBy ? String(resolvedBy).slice(0, 60) : null;
    persist();
    bus.emit('change', { type: 'sos', entry });
    return entry;
  }

  /** Jumlah alert SOS yang belum resolved. */
  function sosActiveCount() {
    load();
    return sosList_.filter((e) => e && e.status === 'active').length;
  }
  ```

  **3c. Reset.** Di `reset()`, kosongkan `sosList_ = [];` juga (cari fungsi `reset()` yang sudah ada dan tambahkan satu baris).

  **3d. Exports.** Tambahkan ke `module.exports`: `sosCreate,` `sosList,` `sosResolve,` `sosActiveCount,` (dan `SOS_MAX` bila ingin diekspor — opsional).

- [ ] **Step 4: Jalankan test, pastikan LULUS**

  Run: `node scripts/presence.test.js`
  Expected: `OK — N pemeriksaan lulus`, exit 0.

  > Kalau test schema versi 2 yang sudah ada (`presence.json memakai schema versi 2`) gagal, ubah assertion-nya menjadi versi 3 — ini perubahan yang diharapkan oleh task ini, bukan regresi. Catat di laporan.

- [ ] **Step 5: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 6: Commit**

  ```bash
  git add src/services/presence.js scripts/presence.test.js
  git commit -m "feat(presence): tambah antrean SOS darurat pada skema presence"
  ```

---

## Task 18 — Dispatcher alert: SOS → WhatsApp + realtime

**Files:**
- Create: `src/services/wa-alert.js`
- Create: `src/services/alert.js`
- Modify: `src/services/realtime.js` (tambah `EVENTS.ALERT`)
- Test: `scripts/alert.test.js` (BARU)
- Modify: `scripts/wa-run-tests.js` (daftarkan suite baru)

**Interfaces:**
- Consumes:
  - `presence.sosList(status?)`, `presence.sosResolve(id, resolvedBy)`, `presence.sosActiveCount()` (Task 17).
  - `geo.mapsUrl(lat, lng, label)` (Task 14).
  - `wa.deliverTo(target, text)` → `Promise<{status, via?, reason?}>` (`src/services/wa.js` — sudah menyatukan pencatatan log di Task 11).
  - `realtime.publish(type, payload)` (`src/services/realtime.js`).
- Produces:
  - `src/services/wa-alert.js` → `buildSosMessage(sos) → string`, `coordinatorTargets(data) → Array<{phone, name}>`, `notifySos(sos, data) → Promise<{sent: number, failed: number, skipped: number}>`.
  - `src/services/alert.js` → `dispatchSos(sos, data) → Promise<object>`, `resolveSos(id, resolvedBy) → object|null`, `activeAlerts() → object[]`, `EVENTS` konstanta bridging.
  - `realtime.EVENTS.ALERT` = `'alert'`.

**Konteks:**
Task 17 hanya menyimpan SOS. Tanpa dispatcher, alert tak sampai ke siapa pun. Dispatcher-lah yang: (a) mengirim pesan WhatsApp ke koordinator/WhatsApp admin, (b) menyiarkan event realtime supaya panel admin langsung menampilkan alert tanpa reload.

**Aturan etika WhatsApp (WAJIB — ini yang paling rawan):**
- Gunakan `wa.deliverTo(target, text)`, **BUKAN** `gateway.sendText` langsung. `deliverTo` menegakkan: kontak harus terdaftar, `optIn` true, `optOut` tidak, cek frekuensi per kontak, cek batas global harian, dan mencatat hasilnya.
- Kalau koordinator tidak ada / tidak opt-in → hasil `skipped`. Itu NORMAL dan tidak boleh dianggap error.
- Pengiriman alert **tidak boleh memblokir** pemanggilnya: dispatcher memakai `await` di dalam `try/catch`, dan Kegagalan gateway TIDAK boleh membuat route gagal.
- Alert tidak boleh dikirim ke nomor yang sudah opt-out — `deliverTo` sudah menegakkan ini, jangan diakali.

**Decision (sudah diruling controller):**
- **Koordinator** = kontak WhatsApp yang `optIn` dan ada di `data.contacts`, **DITAMBAH** nomor WhatsApp utama dari `data.settings.whatsapp` (kalau ada dan berbeda). Alasannya: nomor utama biasanya ada di pengaturan tapi belum tentu ada di daftar kontak — tanpa ini, alert tidak pernah sampai.
- Nomor utama **tidak** melewati aturan opt-in kontak (kontak = pelanggan). Tapi **tetap** melewati `wa.deliverTo`, yang berarti: kalau nomor utama tidak terdaftar sebagai kontak → `skipped`. Maka implementer WAJIB menambahkan nomor utama sebagai target memakai jalur yang tetap tercatat, atau mendaftarkannya sebagai kontak opt-in otomatis.
  - **Ruling final:** `coordinatorTargets(data)` mengembalikan nomor utama **dengan** memastikan nomor itu terdaftar sebagai kontak opt-in: kalau belum ada di `data.contacts`, tambahkan dengan `{name: 'Koordinator', phone, optIn: true, optOut: false, source: 'alert'}` lalu `db.write()`. Pengiriman tetap lewat `wa.deliverTo` sehingga tercatat di `whatsappSendLogs`.
- `realtime.publish(realtime.EVENTS.ALERT, {type: 'sos', sos})` dikirim setelah dispatch sukses (sukses maupun skipped) — supaya panel admin tahu ada alert baru meski gateway mati.

- [ ] **Step 1: Tulis test yang gagal**

  Create `scripts/alert.test.js`:

  ```js
  'use strict';

  /**
   * Uji dispatcher alert (SOS → WhatsApp + realtime).
   *
   * Isolasi data uji WAJIB: test-db harus di-require SEBELUM src/db.
   */

  const assert = require('assert');
  const path = require('path');

  // Isolasi data uji — WAJIB sebelum require modul src/db.
  require(path.join(__dirname, 'test-db'));

  const db = require('../src/db');
  const alert = require('../src/services/alert');
  const waAlert = require('../src/services/wa-alert');

  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      console.log('  PASS  ' + name);
    } catch (err) {
      failed += 1;
      console.log('  FAIL  ' + name + '  →  ' + err.message);
    }
  }

  const SOS = {
    id: 'sos_1', role: 'customer', refId: 'cus_1', name: 'Budi',
    phone: '081234567890', lat: -0.4644, lng: 130.8924, accuracy: 12,
    at: '2026-11-26T03:00:00.000Z', status: 'active', resolvedAt: null, resolvedBy: null
  };

  console.log('
== Template pesan alert ==');

  test('buildSosMessage memuat nama, koordinat, dan tautan peta', () => {
    const msg = waAlert.buildSosMessage(SOS);
    assert.ok(msg.indexOf('Budi') !== -1, 'nama harus ada: ' + msg);
    assert.ok(msg.indexOf('-0.4644') !== -1, 'latitude harus ada: ' + msg);
    assert.ok(msg.indexOf('google.com/maps') !== -1, 'tautan peta harus ada: ' + msg);
  });

  test('buildSosMessage menangani peserta tanpa nama', () => {
    const msg = waAlert.buildSosMessage(Object.assign({}, SOS, { name: '' }));
    assert.ok(msg.length > 0, 'pesan tidak boleh kosong');
  });

  console.log('
== Target koordinator ==');

  test('coordinatorTargets memuat nomor WhatsApp utama dari settings', () => {
    const data = {
      settings: { whatsapp: '6281234567890' },
      contacts: []
    };
    const targets = waAlert.coordinatorTargets(data);
    assert.ok(targets.some((t) => t.phone === '6281234567890'),
      'nomor utama harus jadi target');
  });

  test('coordinatorTargets melewati kontak opt-out', () => {
    const data = {
      settings: {},
      contacts: [{ name: 'X', phone: '081111111111', optIn: true, optOut: true, source: 'contact' }]
    };
    const targets = waAlert.coordinatorTargets(data);
    assert.strictEqual(targets.length, 0, 'kontak opt-out tidak boleh jadi target');
  });

  console.log('
== Dispatcher ==');

  test('dispatchSos mengembalikan hasil tanpa melempar error saat data kosong', async () => {
    const res = await alert.dispatchSos(SOS, { settings: {}, contacts: [] });
    assert.ok(res, 'hasil dispatch wajib ada');
    assert.ok(typeof res.sent === 'number', 'harus ada jumlah sent');
  });

  test('resolveSos menandai alert resolved', () => {
    const created = alert.resolveSos('sos_tidak_ada', 'admin_x');
    assert.strictEqual(created, null, 'id tak dikenal harus null');
  });

  console.log('
' + (failed === 0
    ? `OK — ${passed} pemeriksaan lulus`
    : `${failed} dari ${passed + failed} pemeriksaan GAGAL`));
  process.exit(failed === 0 ? 0 : 1);
  ```

  > Catatan: fungsi `test()` di atas sinkron. Kalau `dispatchSos` async, panggil dengan `.then()` di dalam wrapper atau ubah wrapper jadi async. Pilih yang bisa mempertahankan `process.exit` di akhir — buat `test()` async-aware (`async function test(...)` + `await fn()` + `await test(...)` di pemanggil), karena `dispatchSos` memang async.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/alert.test.js`
  Expected: FAIL — `Cannot find module '.../src/services/alert'`.

- [ ] **Step 3: Implementasikan `src/services/wa-alert.js`**

  Create file:

  ```js
  'use strict';

  /**
   * Template & pengiriman pesan alert (SOS) via WhatsApp.
   *
   * Terpisah dari `src/services/alert.js` (yang tahu soal event & state) karena
   * file ini hanya boleh concerned dengan TEKS PESAN dan KE MANA pesan dikirim.
   *
   * Aturan etika WhatsApp (WAJIB):
   *  - hanya kirim ke kontak opt-in, opt-out menang atas opt-in,
   *  - jam tenang menunda bukan membatalkan,
   *  - izin dicek ULANG saat pengiriman,
   *  - setiap nomor punya hasil tercatat.
   * Semua itu ditegakkan oleh `wa.deliverTo()` — jadi file ini TIDAK memanggil
   * gateway secara langsung.
   */

  const db = require('../db');
  const geo = require('./geo');
  const wa = require('./wa');

  /**
   * Susun teks pesan alert SOS.
   *
   * @param {object} sos entri SOS (dari presence.sosCreate)
   * @returns {string} teks pesan siap kirim
   */
  function buildSosMessage(sos) {
    const nama = (sos && sos.name) ? sos.name : 'Peserta';
    const lat = sos && Number.isFinite(Number(sos.lat)) ? Number(sos.lat).toFixed(6) : '-';
    const lng = sos && Number.isFinite(Number(sos.lng)) ? Number(sos.lng).toFixed(6) : '-';
    const waktu = sos && sos.at ? new Date(sos.at).toLocaleString('id-ID') : '-';
    const link = geo.mapsUrl(sos && sos.lat, sos && sos.lng, nama) || '-';

    return [
      '🚨 *SOS DARURAT*',
      'Nama: ' + nama,
      'Waktu: ' + waktu,
      'Koordinat: ' + lat + ', ' + lng,
      sos && sos.accuracy ? 'Akurasi: ± ' + Math.round(sos.accuracy) + ' m' : null,
      'Lokasi: ' + link,
      'Mohon hubsungi segera.'
    ].filter(Boolean).join('\n');
  }

  /**
   * Target koordinator yang boleh menerima alert.
   *
   * Nomor WhatsApp utama dari `settings.whatsapp` selalu jadi target — inilah
   * jalur paling mungkin dipakai admin. Kontak opt-in lain juga ikut.
   *
   * @param {object} data data aplikasi
   * @returns {Array<{phone: string, name: string}>}
   */
  function coordinatorTargets(data) {
    const d = data || db.read() || {};
    const settings = d.settings || {};
    const contacts = (d.contacts || []) || [];
    const out = [];
    const seen = new Set();

    const push = (phone, name) => {
      const p = wa.normalizePhone(phone);
      if (!p || seen.has(p)) return;
      seen.add(p);
      out.push({ phone: p, name: name || 'Koordinator' });
    };

    // Kontak opt-in (opt-out menang atas opt-in).
    contacts.forEach((c) => {
      if (!c || c.optOut || !c.optIn) return;
      push(c.phone, c.name);
    });

    // Nomor utama dari pengaturan.
    if (settings.whatsapp) push(settings.whatsapp, 'Nomor Utama');

    return out;
  }

  /**
   * Kirim alert ke semua koordinator. Tidak melempar error.
   *
   * @param {object} sos entri SOS
   * @param {object} [data] data aplikasi
   * @returns {Promise<{sent: number, failed: number, skipped: number}>}
   */
  async function notifySos(sos, data) {
    const d = data || db.read() || {};
    const targets = coordinatorTargets(d);
    const text = buildSosMessage(sos);
    const out = { sent: 0, failed: 0, skipped: 0 };

    for (const target of targets) {
      try {
        const res = await wa.deliverTo(target, text);
        if (res && res.status === 'sent') out.sent += 1;
        else if (res && res.status === 'failed') out.failed += 1;
        else out.skipped += 1;
      } catch (err) {
        // Kegagalan satu target tidak boleh menjatuhkan yang lain.
        out.failed += 1;
      }
    }
    return out;
  }

  module.exports = { buildSosMessage, coordinatorTargets, notifySos };
  ```

  > Catatan: `wa.deliverTo` menolak nomor yang tidak terdaftar sebagai kontak (status `skipped`, alasan "nomor tidak terdaftar"). Agar nomor utama benar-benar sampai, **daftarkan nomor utama sebagai kontak opt-in** sebelum mengirim. Implementasikan di `notifySos`:
  >
  > ```js
  > function ensureCoordinatorContact(data, phone, name) {
  >   const d = data || db.read() || {};
  >   const contacts = d.contacts || [];
  >   const p = wa.normalizePhone(phone);
  >   const found = contacts.find((c) => wa.normalizePhone(c.phone) === p);
  >   if (found) {
  >     // Nomor utama: pastikan opt-in, tapi JANGAN membatalkan opt-out eksplisit.
  >     if (found.optOut) return false;
  >     if (!found.optIn) { found.optIn = true; db.write(); }
  >     return true;
  >   }
  >   contacts.push({
  >     id: db.uid('ctc'), name: name || 'Koordinator', phone: p,
  >     email: '', source: 'alert', optIn: true, optOut: false,
  >     createdAt: new Date().toISOString()
  >   });
  >   db.write();
  >   return true;
  > }
  > ```
  >
  > Panggil `ensureCoordinatorContact` untuk setiap target sebelum `wa.deliverTo`, dan lewati target yang mengembalikan `false` (opted-out).

- [ ] **Step 4: Implementasikan `src/services/alert.js`**

  Create file:

  ```js
  'use strict';

  /**
   * Dispatcher alert — menjembatani alert SOS (state) dengan dunia luar
   * (WhatsApp ke koordinator + panel admin realtime).
   *
   * Modul ini TIDAK menyimpan apa pun: sumber kebenaran status alert tetap
   * `src/services/presence.js` (data/presence.json).
   */

  const db = require('../db');
  const presence = require('./presence');
  const realtime = require('./realtime');
  const waAlert = require('./wa-alert');

  /**
   * Kirim alert SOS ke koordinator & siarkan ke panel admin.
   *
   * Tidak pernah melempar error — kegagalan gateway tidak boleh membuat
   * route pemanggil gagal.
   *
   * @param {object} sos entri SOS
   * @param {object} [data] data aplikasi
   * @returns {Promise<object>} ringkasan hasil pengiriman
   */
  async function dispatchSos(sos, data) {
    const d = data || db.read() || {};
    let res = { sent: 0, failed: 0, skipped: 0 };
    try {
      res = await waAlert.notifySos(sos, d);
    } catch (err) {
      res = { sent: 0, failed: 1, skipped: 0, error: String(err.message || err) };
    }
    try {
      realtime.publish(realtime.EVENTS.ALERT, { type: 'sos', sos: sos, delivery: res });
    } catch (err) {
      // Bus realtime tidak boleh menjatuhkan dispatch
    }
    return res;
  }

  /**
   * Tandai alert SOS resolved.
   * @param {string} id id alert
   * @param {string} [resolvedBy] id user admin
   * @returns {object|null} entri ter-update, atau null bila id tidak dikenal
   */
  function resolveSos(id, resolvedBy) {
    const entry = presence.sosResolve(id, resolvedBy);
    if (!entry) return null;
    try {
      realtime.publish(realtime.EVENTS.ALERT, { type: 'sos-resolved', sos: entry });
    } catch (err) {
      // abaikan
    }
    return entry;
  }

  /** Daftar alert SOS yang belum resolved. */
  function activeAlerts() {
    return presence.sosList('active');
  }

  module.exports = { dispatchSos, resolveSos, activeAlerts };
  ```

  - [ ] **Step 5: Tambah `EVENTS.ALERT` di `src/services/realtime.js`**

  Di objek `EVENTS`, tambahkan:

  ```js
  /** Alert darurat (SOS) — perlu perhatian admin segera. */
  ALERT: 'alert'
  ```

  Ingat tambahkan koma pada entri sebelumnya (`NOTICE: 'notice'` → `NOTICE: 'notice',`).

- [ ] **Step 6: Jalankan test, pastikan LULUS**

  Run: `node scripts/alert.test.js`
  Expected: `OK — N pemeriksaan lulus`, exit 0.

- [ ] **Step 7: Daftarkan suite di `scripts/wa-run-tests.js`**

  Tambahkan `'alert.test.js'` ke array `suites` (dekat `'presence.test.js'`).

  > PENTING: skrip uji baru WAJIB masuk daftar ini, kalau tidak tidak pernah jalan di `npm test`.

- [ ] **Step 8: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus." — termasuk suite `alert.test.js` yang baru.

- [ ] **Step 9: Jalankan penjaga**

  Run: `node scripts/wa-check.js`
  Expected: "Semua modul & template OK." exit 0.

- [ ] **Step 10: Commit**

  ```bash
  git add src/services/wa-alert.js src/services/alert.js src/services/realtime.js \
          scripts/alert.test.js scripts/wa-run-tests.js
  git commit -m "feat(alert): kirim alert SOS ke koordinator lewat WhatsApp dan realtime"
  ```

---

## Task 19 — Halaman admin peserta global (pencarian, roster, last-seen, SOS)

**Files:**
- Modify: `src/routes/admin.routes.js` (tambah `GET /admin/peserta`)
- Create: `views/admin/peserta.ejs` (BARU)
- Create: `src/routes/alert.routes.js` (BARU)
- Create: `views/admin/alert.ejs` (BARU)
- Modify: `src/app.js` (mount router alert)
- Modify: `public/js/map.js` (tambah `api.setRoster(entries)`)
- Modify: `views/layouts/admin.ejs` (tambah link navigasi + ikon bila perlu)
- Test: `scripts/admin-peserta.test.js` (BARU)
- Modify: `scripts/wa-run-tests.js` (daftarkan suite baru)

**Interfaces:**
- Consumes:
  - `presence.lastSeenAll()` → `Array<{role, refId, name, label, lat, lng, accuracy, at, ageMin, source}>` (Task 12).
  - `presence.sosList(status?)`, `presence.sosActiveCount()` (Task 17).
  - `roster.groupOf(data, id)`, `roster.rosterOf(data, group, live, seen)`, `roster.groupsForCustomer(data, customerId)` (Task 13).
  - `geo.mapsUrl`, `geo.formatDistance` (semua ada).
  - `alert.activeAlerts()` (Task 18).
- Produces:
  - route `GET /admin/peserta` (query `?q=&group=`), template `views/admin/peserta.ejs`.
  - route `POST /admin/alert/:id/resolve` (admin me-resolve alert SOS), template `views/admin/alert.ejs`.
  - router `src/routes/alert.routes.js` yang di-mount di `src/app.js`.

**Konteks:**
Admin butuh satu halaman untuk melihat **semua** peserta beserta titik terakhirnya (bukan hanya yang sedang online) — ini jawaban atas "di mana dia terakhir terlihat?". Halaman ini juga jadi tempat melihat roster per rombongan dan alert SOS aktif.

**Privasi (WAJIB):**
- `GET /admin/peserta` hanya untuk admin — `admin.routes.js` sudah memakai `router.use(requireLogin, load)` (`src/routes/admin.routes.js:73`), jadi route baru otomatis terlindungi. **Jangan** buat route ini di `account.routes.js`.
- Admin melihat SEMUA pelanggan — ini memang perbedaan admin/pelanggan yang disengaja.

**Decision (sudah diruling controller):**
- Halaman menampilkan tiga blok: (1) daftar Alert SOS aktif, (2) daftar peserta dengan titik terakhir, (3) roster per rombongan.
- Peserta tanpa titik terakhir tetap tampil (dengan label "belum pernah terlihat") — menyembunyikan mereka justru membutakan.
- Pencarian `q` mencocokkan nama / email / HP pelanggan.
- Filter `group` memfilter peserta berdasarkan rombongan.

- [ ] **Step 1: Tulis test yang gagal**

  Create `scripts/admin-peserta.test.js`:

  ```js
  'use strict';

  /**
   * Uji halaman admin peserta global.
   *
   * Fokus:
   *  - Route /admin/peserta terdaftar di router admin.
   *  - Route memakai requireLogin (bukan publik).
   *  - Halaman menampilkan titik terakhir peserta (last-seen), bukan hanya live.
   *  - Alert SOS aktif tampil.
   *
   * Jalankan: node scripts/admin-peserta.test.js
   */

  const assert = require('assert');
  const fs = require('fs');
  const path = require('path');

  const root = path.join(__dirname, '..');
  const routesSrc = fs.readFileSync(path.join(root, 'src', 'routes', 'admin.routes.js'), 'utf8');
  const layoutSrc = fs.readFileSync(path.join(root, 'views', 'layouts', 'admin.ejs'), 'utf8');

  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      console.log('  PASS  ' + name);
    } catch (err) {
      failed += 1;
      console.log('  FAIL  ' + name + '  →  ' + err.message);
    }
  }

  console.log('\n== Route admin peserta ==');

  test('route GET /admin/peserta terdaftar', () => {
    assert.ok(/router\.get\(['"]\/peserta['"]/.test(routesSrc),
      'route GET /admin/peserta tidak ditemukan');
  });

  test('halaman peserta ada di views/admin', () => {
    assert.ok(fs.existsSync(path.join(root, 'views', 'admin', 'peserta.ejs')),
      'views/admin/peserta.ejs belum ada');
  });

  test('link peserta ada di navigasi admin', () => {
    assert.ok(layoutSrc.indexOf('href="/admin/peserta"') !== -1,
      'nav admin belum punya link ke /admin/peserta');
  });

  test('halaman peserta memakai lastSeen (titik terakhir)', () => {
    const view = fs.readFileSync(path.join(root, 'views', 'admin', 'peserta.ejs'), 'utf8');
    assert.ok(view.indexOf('lastSeen') !== -1 || view.indexOf('last-seen') !== -1,
      'template harus merujuk data titik terakhir');
    assert.ok(view.indexOf('formatAge') !== -1,
      'template harus menampilkan usia relatif (terakhir terlihat)');
  });

  test('halaman peserta menampilkan alert SOS aktif', () => {
    const view = fs.readFileSync(path.join(root, 'views', 'admin', 'peserta.ejs'), 'utf8');
    assert.ok(view.toLowerCase().indexOf('sos') !== -1,
      'template harus menampilkan daftar alert SOS');
  });

  console.log('\n' + (failed === 0
    ? `OK — ${passed} pemeriksaan lulus`
    : `${failed} dari ${passed + failed} pemeriksaan GAGAL`));
  process.exit(failed === 0 ? 0 : 1);
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/admin-peserta.test.js`
  Expected: FAIL — `views/admin/peserta.ejs belum ada`.

- [ ] **Step 3: Tambahkan route `GET /admin/peserta` di `src/routes/admin.routes.js`**

  Letakkan setelah route `GET /lokasi` (yang sudah ada di `src/routes/admin.routes.js:119`).

  ```js
  /* ------------------------------------------------------------------ */
  /* Peserta Global — semua pelanggan + titik terakhir + alert SOS      */
  /* ------------------------------------------------------------------ */
  /**
   * Halaman admin untuk mencari & melihat seluruh peserta.
   *
   * Berbeda dari `/admin/lokasi` yang hanya menampilkan peserta yang SEDANG
   * online, halaman ini juga menampilkan titik terakhir yang diketahui
   * (last-seen) — jawaban atas "di mana dia terakhir terlihat?".
   */
  router.get('/peserta', (req, res) => {
    const data = req.data;
    const settings = data.settings || {};
    const presence = require('../services/presence');
    const roster = require('../services/roster');
    const alert = require('../services/alert');

    // Peta titik terakhir: 'role:refId' → entri.
    const seenMap = {};
    presence.lastSeenAll().forEach((e) => {
      seenMap[e.role + ':' + e.refId] = e;
    });

    // Daftar pelanggan + titik terakhirnya.
    const q = String(req.query.q || '').trim().toLowerCase();
    const groupId = String(req.query.group || '').trim();

    let customers = (data.customers || []).slice();
    if (q) {
      customers = customers.filter((c) =>
        String(c.name || '').toLowerCase().indexOf(q) !== -1 ||
        String(c.email || '').toLowerCase().indexOf(q) !== -1 ||
        String(c.phone || '').indexOf(q) !== -1
      );
    }

    // Peserta dalam rombongan tertentu.
    let groupCustomerIds = null;
    if (groupId) {
      const group = roster.groupOf(data, groupId);
      const members = group ? roster.groupMembersOf(data, group) : [];
      groupCustomerIds = new Set(members);
      customers = customers.filter((c) => groupCustomerIds.has(c.id));
    }

    const people = customers.map((c) => {
      const seen = seenMap['customer:' + c.id] || null;
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        seen: seen,
        lat: seen ? seen.lat : null,
        lng: seen ? seen.lng : null,
        at: seen ? seen.at : null,
        ageMin: seen ? seen.ageMin : null,
        ageLabel: seen ? geo.formatAge(seen.at) : '-',
        mapsUrl: seen ? geo.mapsUrl(seen.lat, seen.lng, c.name) : ''
      };
    });

    // Roster per rombongan.
    const groups = (data.tripGroups || []).map((g) => ({
      group: g,
      members: roster.rosterOf(data, g, {}, seenMap)
    }));

    res.render('admin/peserta', {
      title: 'Peserta',
      people,
      groups,
      alerts: alert.activeAlerts(),
      activeAlertCount: presence.sosActiveCount(),
      q: req.query.q || '',
      groupId
    });
  });
  ```

  > Catatan: field `distance` di draft di atas **sengaja dihapus** — jarak ke diri sendiri tidak berguna. Admin butuh jarak ke titik kumpul, itu urusan Task 20. Yang dipakai di halaman ini: `ageLabel` (terakhir terlihat) dan `mapsUrl`.

- [ ] **Step 4: Buat `views/admin/peserta.ejs`**

  Create file — gunakan pola kelas yang sudah dipakai `views/admin/lokasi.ejs` (`panel`, `panel__head`, `a-list`, `a-chip`, `a-empty-state`, `btn-a`):

  ```ejs
  <div style="margin-bottom:1rem">
    <a href="/admin" class="btn-a btn-a--ghost btn-a--sm">← Kembali ke dashboard</a>
  </div>

  <section class="panel">
    <div class="panel__head">
      <h2>Alert SOS Aktif</h2>
      <span class="a-chip"><%= activeAlertCount %> aktif</span>
    </div>
    <% if (alerts.length === 0) { %>
      <div class="a-empty-state">
        <strong>Tidak ada alert SOS</strong>
        <p>Semua peserta dalam kondisi aman.</p>
      </div>
    <% } else { %>
      <ul class="a-list">
        <% alerts.forEach(function (s) { %>
          <li>
            <span style="flex:1; min-width:0">
              <strong>🚨 <%= s.name || 'Peserta' %></strong>
              <span class="a-chip" style="margin-left:0.4rem"><%= formatAge(s.at) %></span>
              <br>
              <span style="opacity:0.75; font-size:0.82rem">
                <%= s.lat %>, <%= s.lng %>
                <% if (s.phone) { %>
                  · <a href="https://wa.me/<%= String(s.phone).replace(/[^0-9]/g, '') %>" target="_blank" rel="noopener"><%= s.phone %></a>
                <% } %>
              </span>
            </span>
            <a class="btn-a btn-a--sm" href="/admin/alert">Tangani</a>
          </li>
        <% }); %>
      </ul>
    <% } %>
  </section>

  <section class="panel" style="margin-top:1rem">
    <div class="panel__head">
      <h2>Daftar Peserta</h2>
      <span class="a-chip"><%= people.length %> orang</span>
    </div>

    <form action="/admin/peserta" method="get" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.9rem">
      <input type="search" name="q" value="<%= q %>" placeholder="Cari nama / email / HP…" style="flex:1; min-width:200px; padding:0.5rem 0.7rem; border-radius:8px; border:1px solid var(--a-line, #d8dee7)">
      <select name="group" style="padding:0.5rem 0.7rem; border-radius:8px; border:1px solid var(--a-line, #d8dee7)">
        <option value="">Semua rombongan</option>
        <% groups.forEach(function (g) { %>
          <option value="<%= g.group.id %>" <%= groupId === g.group.id ? 'selected' : '' %>><%= g.group.name %></option>
        <% }); %>
      </select>
      <button type="submit" class="btn-a btn-a--primary btn-a--sm">Cari</button>
    </form>

    <% if (people.length === 0) { %>
      <div class="a-empty-state">
        <strong>Tidak ada peserta</strong>
        <p>Ubah kata kunci atau filter rombongan.</p>
      </div>
    <% } else { %>
      <ul class="a-list">
        <% people.forEach(function (p) { %>
          <li>
            <span style="flex:1; min-width:0">
              <strong><%= p.name %></strong>
              <br>
              <span style="opacity:0.75; font-size:0.82rem">
                <% if (p.at) { %>
                  <%= p.lat %>, <%= p.lng %> · terakhir terlihat <%= p.ageLabel %>
                <% } else { %>
                  belum pernah membagikan lokasi
                <% } %>
                <% if (p.phone) { %>
                  · <a href="https://wa.me/<%= String(p.phone).replace(/[^0-9]/g, '') %>" target="_blank" rel="noopener"><%= p.phone %></a>
                <% } %>
              </span>
            </span>
            <% if (p.mapsUrl) { %>
              <a class="btn-a btn-a--sm" href="<%= p.mapsUrl %>" target="_blank" rel="noopener">Peta</a>
            <% } %>
          </li>
        <% }); %>
      </ul>
    <% } %>
  </section>

  <section class="panel" style="margin-top:1rem">
    <div class="panel__head">
      <h2>Roster per Rombongan</h2>
    </div>
    <% if (groups.length === 0) { %>
      <div class="a-empty-state">
        <strong>Belum ada rombongan</strong>
        <p>Rombongan dibuat dari data booking bersama.</p>
      </div>
    <% } else { %>
      <% groups.forEach(function (g) { %>
        <div style="margin-bottom:1rem">
          <h3 style="font-size:0.95rem; margin:0 0 0.4rem"><%= g.group.name %></h3>
          <ul class="a-list">
            <% g.members.forEach(function (m) { %>
              <li>
                <span style="flex:1; min-width:0">
                  <strong><%= m.name %></strong>
                  <span style="opacity:0.75; font-size:0.82rem">
                    · <%= m.bookingCode %>
                    <% if (m.at) { %> · terakhir terlihat <%= formatAge(m.at) %><% } %>
                  </span>
                </span>
              </li>
            <% }); %>
          </ul>
        </div>
      <% }); %>
    <% } %>
  </section>
  ```

- [ ] **Step 5: Buat `src/routes/alert.routes.js` (router alert)**

  Create file:

  ```js
  'use strict';

  /**
   * Router alert darurat (SOS) untuk panel admin.
   *
   * Dipasang di `/admin/alert` (lihat src/app.js). Semua route WAJIB
   * memakai `requireLogin` — panel alert memuat titik lokasi peserta, jadi
   * tidak boleh terbuka untuk pelanggan atau anonim.
   */

  const express = require('express');

  const db = require('../db');
  const { requireLogin } = require('../middleware/security');
  const { flash } = require('../middleware/context');
  const alert = require('../services/alert');
  const presence = require('../services/presence');
  const geo = require('../services/geo');

  const router = express.Router();

  router.use(requireLogin);

  /**
   * Pusat alert admin — daftar alert SOS (aktif & riwayat).
   */
  router.get('/', (req, res) => {
    const data = db.read();
    const active = alert.activeAlerts();
    const history = presence.sosList('resolved');

    res.render('admin/alert', {
      title: 'Alert Darurat',
      active,
      history,
      activeCount: active.length,
      mapData: JSON.stringify({
        dest: null,
        checkIn: null,
        track: [],
        live: null,
        peers: active
          .filter((s) => s.lat != null && s.lng != null)
          .map((s) => ({
            role: 'customer',
            name: s.name || 'Peserta',
            label: geo.formatAge(s.at),
            lat: s.lat,
            lng: s.lng
          }))
      })
    });
  });

  /**
   * Tandai alert SOS resolved.
   */
  router.post('/:id/resolve', (req, res) => {
    const entry = alert.resolveSos(req.params.id, req.session.userId);
    if (!entry) {
      flash('error', 'Alert tidak ditemukan.', req);
      return res.redirect('/admin/alert');
    }
    flash('success', `Alert ${entry.name || 'peserta'} ditandai selesai.`, req);
    res.redirect('/admin/alert');
  });

  module.exports = router;
  ```

  > `module.exports = router` (bukan `{ createAlertRouter }`) — supaya bisa di-mount langsung. Kalau memilih pola `createXxxRouter()` seperti `marketing.routes.js`, sesuaikan mount-nya.

- [ ] **Step 6: Mount router alert di `src/app.js`**

  Di `src/app.js`, tambahkan import di bagian atas:

  ```js
  const alertRoutes = require('./routes/alert.routes');
  ```

  Dan mount-nya **setelah** `app.use('/admin', adminRoutes);`:

  ```js
  app.use('/admin/alert', alertRoutes);
  ```

  > PENTING: mount `/admin/alert` harus SESUDAH `app.use('/admin', adminRoutes)` — kalau sebaliknya, `GET /admin/alert` akan tertangkap router admin dan jatuh ke 404 admin.

  > **Alternatif** (pilih SATU, konsisten): taruh route alert di dalam `src/routes/admin.routes.js` yang sudah punya `requireLogin` global. Kalau memilih ini, **jangan** buat `src/routes/alert.routes.js` dan **jangan** mount di `src/app.js` — lewati Step 5 & 6. Rekomendasi: router terpisah (Step 5+6), supaya `admin.routes.js` yang sudah 1376 baris tidak makin besar.

- [ ] **Step 7: Buat `views/admin/alert.ejs`**

  Create file (pola kelas `panel`, `panel__head`, `a-list`, `a-chip`, `a-empty-state`, `btn-a` seperti `views/admin/lokasi.ejs`):

  ```ejs
  <div style="margin-bottom:1rem">
    <a href="/admin" class="btn-a btn-a--ghost btn-a--sm">← Kembali ke dashboard</a>
  </div>

  <section class="panel">
    <div class="panel__head">
      <h2>Alert Aktif</h2>
      <span class="a-chip"><%= activeCount %> aktif</span>
    </div>

    <% if (active.length === 0) { %>
      <div class="a-empty-state">
        <strong>Tidak ada alert aktif</strong>
        <p>Semua peserta dalam kondisi aman.</p>
      </div>
    <% } else { %>
      <ul class="a-list">
        <% active.forEach(function (s) { %>
          <li>
            <span style="flex:1; min-width:0">
              <strong>🚨 <%= s.name || 'Peserta' %></strong>
              <span class="a-chip" style="margin-left:0.4rem"><%= formatAge(s.at) %></span>
              <br>
              <span style="opacity:0.75; font-size:0.82rem">
                <%= s.lat %>, <%= s.lng %>
                <% if (s.phone) { %>
                  · <a href="https://wa.me/<%= String(s.phone).replace(/[^0-9]/g, '') %>" target="_blank" rel="noopener"><%= s.phone %></a>
                <% } %>
              </span>
            </span>
            <% if (s.lat != null && s.lng != null) { %>
              <a class="btn-a btn-a--sm" href="<%= mapsUrl(s.lat, s.lng, s.name) %>" target="_blank" rel="noopener">Peta</a>
            <% } %>
            <form action="/admin/alert/<%= s.id %>/resolve" method="post" style="display:inline">
              <input type="hidden" name="_csrf" value="<%= csrfToken %>">
              <button type="submit" class="btn-a btn-a--primary btn-a--sm">Tandai Selesai</button>
            </form>
          </li>
        <% }); %>
      </ul>
    <% } %>
  </section>

  <section class="panel" style="margin-top:1rem">
    <div class="panel__head">
      <h2>Riwayat</h2>
      <span class="a-chip"><%= history.length %> selesai</span>
    </div>
    <% if (history.length === 0) { %>
      <div class="a-empty-state">
        <strong>Belum ada riwayat</strong>
      </div>
    <% } else { %>
      <ul class="a-list">
        <% history.forEach(function (s) { %>
          <li>
            <span style="flex:1; min-width:0">
              <strong><%= s.name || 'Peserta' %></strong>
              <br>
              <span style="opacity:0.75; font-size:0.82rem">
                · dibuat <%= formatAge(s.at) %>
                <% if (s.resolvedAt) { %>· diselesaikan <%= formatAge(s.resolvedAt) %><% } %>
              </span>
            </span>
          </li>
        <% }); %>
      </ul>
    <% } %>
  </section>
  ```

  > `csrfToken` sudah tersedia di `res.locals` (middleware context). `mapsUrl` juga sudah di-expose oleh Task 15.

- [ ] **Step 8: Tambah link navigasi di `views/layouts/admin.ejs`**

  Tepat setelah link `/admin/lokasi` (baris ~99), tambahkan:

  ```ejs
  <a href="/admin/peserta" class="<%= adminPath.startsWith('/peserta') ? 'active' : '' %>" data-nav-item data-nav-text="peserta rombongan roster"><span class="ico"><svg viewBox="0 0 22 22"><use href="#i-users"/></svg></span> Peserta</a>
  ```

  > `data-nav-text` dipakai untuk pencarian di panel admin — isi dengan kata kunci yang mungkin diketik operator: `peserta`, `rombongan`, `roster`.
  >
  > Ikon `#i-users` sudah dipakai link Pelanggan — boleh dipakai ulang, tapi `#i-search` lebih tepat. Kalau memilih `#i-search`, pastikan id itu ada di sprite (`views/layouts/admin.ejs` mendefinisikan `i-search`).

- [ ] **Step 9: Tambah `api.setRoster(entries)` di `public/js/map.js`**

  Peta saat ini hanya bisa menampilkan marker **peer live** (`api.setPeers`). Halaman
  peserta & alert butuh marker **titik terakhir** — yang bisa berjam-jam lama dan
  tidak sedang live. Bedakan keduanya: warna berbeda + label "terakhir terlihat".

  Tambahkan di `public/js/map.js`, di dalam objek `api` (dekat `setPeers`):

  ```js
  var rosterMarkers = [];
  var pendingRoster = [];

  /**
   * Pasang marker titik terakhir (last-seen) di peta.
   *
   * Berbeda dengan `setPeers` (posisi live), marker ini menandai "terakhir
   * terlihat" — bisa sudah berjam-jam lalu.
   *
   * @param {object[]} entries [{name, lat, lng, label}]
   * @returns {boolean} true bila marker terpasang
   */
  api.setRoster = function (entries) {
    pendingRoster = entries || [];
    if (!api.map) return false;
    rosterMarkers.forEach(function (m) {
      api.map.removeLayer(m);
    });
    rosterMarkers = [];
    pendingRoster.forEach(function (e) {
      if (!e || typeof e.lat !== 'number' || typeof e.lng !== 'number') return;
      var m = L.circleMarker([e.lat, e.lng], {
        radius: 7,
        color: '#b45309',
        fillColor: '#f2a65a',
        fillOpacity: 0.85,
        weight: 2,
        dashArray: '3 3'
      }).addTo(api.map);
      m.bindPopup(
        '<strong>' + (e.name || '-') + '</strong>' +
        (e.label ? '<br>' + e.label : '') +
        '<br>' + e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) +
        '<br><em>titik terakhir</em>'
      );
      rosterMarkers.push(m);
    });
    pendingRoster = [];
    return true;
  };
  ```

  Lalu di `init()`, setelah `api.map = map;` dan `if (peers.length) api.setPeers(peers);`,
  tambahkan pemasangan roster dari data peta:

  ```js
  var roster = Array.isArray(data.roster) ? data.roster : [];
  if (roster.length) api.setRoster(roster);
  ```

  Dan tambahkan `roster` ke pembacaan data di `init()` — data JSON sekarang boleh
  punya field `roster` (array `{name, lat, lng, label}`), selain `dest`, `checkIn`,
  `track`, `live`, `peers`.

  > Tambahkan juga field `roster` ke `mapData` yang dikirim `views/admin/peserta.ejs`
  > dan `views/admin/alert.ejs` — keduanya sudah punya `mapData` JSON; tambahkan
  > `roster: [...]` berisi titik terakhir peserta yang sedang ditampilkan.

- [ ] **Step 10: Jalankan test, pastikan LULUS**

  Run: `node scripts/admin-peserta.test.js`
  Expected: `OK — N pemeriksaan lulus`, exit 0.

- [ ] **Step 11: Daftarkan suite di `scripts/wa-run-tests.js`**

  Tambahkan `'admin-peserta.test.js'` ke array `suites`.

- [ ] **Step 12: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 13: Verifikasi halaman benar-benar dirender**

  Render nyata template + route dengan data contoh:

  ```bash
  node -e "const ejs=require('ejs');const fs=require('fs');['views/admin/peserta.ejs','views/admin/alert.ejs'].forEach(p=>{ejs.compile(fs.readFileSync(p,'utf8'),{filename:p});console.log('EJS OK '+p)})"
  ```

  Expected: dua baris `EJS OK`.

- [ ] **Step 14: Commit**

  ```bash
  git add src/routes/admin.routes.js src/routes/alert.routes.js src/app.js public/js/map.js \
          views/admin/peserta.ejs views/admin/alert.ejs views/layouts/admin.ejs \
          scripts/admin-peserta.test.js scripts/wa-run-tests.js
  git commit -m "feat(admin): halaman peserta global dan pusat alert darurat"
  ```

---

## Task 20 — Endpoint SOS + tombol SOS + geofence berkala

**Files:**
- Modify: `src/routes/presence.routes.js` (tambah `POST /api/presence/sos`, `GET /api/presence/sos`, `GET /api/presence/roster`)
- Modify: `src/services/wa-scheduler.js` (tambah siklus geofence)
- Create: `src/services/geofence.js` (BARU)
- Modify: `views/pages/account-location.ejs` (tombol SOS + badge last-seen)
- Modify: `views/admin/lokasi.ejs` (badge last-seen + tautan alert)
- Modify: `public/js/presence.js` (antrean SOS offline)
- Test: `scripts/geofence.test.js` (BARU)
- Modify: `scripts/wa-run-tests.js` (daftarkan suite baru)

**Interfaces:**
- Consumes:
  - `presence.sosCreate(...)`, `presence.sosList(status?)` (Task 17).
  - `alert.dispatchSos(sos, data)` (Task 18).
  - `roster.rosterOf(data, group, live, seen)`, `roster.distanceToMeetingPoint(group, participant)`, `roster.radiusM(group)` (Task 13).
  - `presence.lastSeenAll()` (Task 12).
  - `geo.haversineMeters` (ada).
- Produces:
  - `src/services/geofence.js` → `checkGroups(data, settings) → Array<{groupId, groupName, memberId, memberName, distance, radiusM}>`, `ALERT_COOLDOWN_MS` (konstanta).
  - Route `POST /api/presence/sos` (JSON, butuh header `x-csrf-token`).
  - Route `GET /api/presence/sos` (hanya admin).
  - Route `GET /api/presence/roster` (hanya admin).

**Konteks:**
Dua fitur yang saling melengkapi:
1. **Tombol SOS** — pelanggan menekan tombol, sistem mencatat posisi + waktunya lalu  ke koordinator (lewat Task 18). Case.jpeg R1: saat GPS tak terbaca, tombol tidak boleh error bodoh — antrean lokal di sisi klien, dan status terlihat jelas.
2. **Geofence** — peserta yang menjauh dari titik kumpul lebih dari radius perlu peringatan otomatis (Task 20 F5).

**Decision (sudah diruling controller):**
- `POST /api/presence/sos` **hanya untuk pelanggan** (`req.session.customerId`). Admin memaksa lewat panel alert, bukan tombol SOS.
- Koordinat **wajib valid** untuk SOS (tanpa koordinat alert tidak berguna) → 400 kalau invalid. Nomor HP diambil dari `data.customers` (bukan dari body) — jadi klien tidak bisa mengarang nomor orang lain.
- `GET /api/presence/sos` **hanya admin** (`req.session.userId`) → 403 untuk pelanggan.
- `GET /api/presence/roster` **hanya admin** → 403 untuk pelanggan. Mengembalikan roster semua rombongan + titik terakhir tiap anggota.
- Geofence: **peringatan**, bukan blokir. Deduplikasi lewat cooldown per (grup, anggota) selama 1 jam — supaya satu peserta yang menjauh tidak memicu spam alert tiap menit.
- Geofence memakai **titik terakhir** (last-seen), bukan hanya live — karena casing "user hilang" justru ketika sudah offline.
- `wa-scheduler.js` menjalankan pemeriksaan geofence **maksimal sekali per jam** (bukan tiap tick 30 menit) — cooldown internal `geofence.js` yang menentukan frekuensi alert sebenarnya.

- [ ] **Step 1: Tulis test yang gagal**

  Create `scripts/geofence.test.js`:

  ```js
  'use strict';

  /**
   * Uji deteksi geofence (peserta jauh dari titik kumpul).
   *
   * Jalankan: node scripts/geofence.test.js
   */

  const assert = require('assert');
  const path = require('path');

  const root = path.join(__dirname, '..');
  const geofence = require(path.join(root, 'src', 'services', 'geofence'));

  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      console.log('  PASS  ' + name);
    } catch (err) {
      failed += 1;
      console.log('  FAIL  ' + name + '  →  ' + err.message);
    }
  }

  const DATA = {
    bookings: [
      { id: 'b1', code: 'SYL-1', customerId: 'c1' },
      { id: 'b2', code: 'SYL-2', customerId: 'c2' }
    ],
    customers: [
      { id: 'c1', name: 'Budi', phone: '0811' },
      { id: 'c2', name: 'Sari', phone: '0822' }
    ],
    tripGroups: [
      {
        id: 'g1',
        name: 'Rombongan A',
        bookingCodes: ['SYL-1', 'SYL-2'],
        meetingPoint: { lat: 0, lng: 0 },
        radiusM: 5000
      }
    ]
  };

  // Titik ~111 km dari (0,0) — jauh di luar radius 5 km.
  const JAUH = { lat: 1, lng: 0 };

  console.log('\n== Deteksi geofence ==');

  test('peserta di luar radius terdeteksi', () => {
    const seen = { 'customer:c1': { role: 'customer', refId: 'c1', name: 'Budi', lat: JAUH.lat, lng: JAUH.lng, at: new Date().toISOString() } };
    const hits = geofence.checkGroups(DATA, {}, { 'customer:c1': seen['customer:c1'] });
    assert.ok(hits.length >= 1, 'harus ada pelanggaran');
    assert.strictEqual(hits[0].memberId, 'c1');
    assert.strictEqual(hits[0].groupId, 'g1');
    assert.ok(hits[0].distance > hits[0].radiusM, ' jarak harus melampaui radius');
  });

  test('peserta di dalam radius tidak terdeteksi', () => {
    const seen = { 'customer:c1': { role: 'customer', refId: 'c1', name: 'Budi', lat: 0.001, lng: 0, at: new Date().toISOString() } };
    const hits = geofence.checkGroups(DATA, {}, seen);
    assert.strictEqual(hits.length, 0, 'tidak boleh ada pelanggaran');
  });

  test('rombongan tanpa titik kumpul dilewati', () => {
    const data = JSON.parse(JSON.stringify(DATA));
    data.tripGroups[0].meetingPoint = null;
    const seen = { 'customer:c1': { role: 'customer', refId: 'c1', name: 'Budi', lat: JAUH.lat, lng: JAUH.lng, at: new Date().toISOString() } };
    const hits = geofence.checkGroups(data, {}, seen);
    assert.strictEqual(hits.length, 0, 'tanpa titik kumpul tidak bisa dinilai');
  });

  console.log('\n' + (failed === 0
    ? `OK — ${passed} pemeriksaan lulus`
    : `${failed} dari ${passed + failed} pemeriksaan GAGAL`));
  process.exit(failed === 0 ? 0 : 1);
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/geofence.test.js`
  Expected: FAIL — `Cannot find module '.../src/services/geofence'`.

- [ ] **Step 3: Implementasikan `src/services/geofence.js`**

  Create file:

  ```js
  'use strict';

  /**
   * Deteksi geofence — peserta yang menjauh dari titik kumpul rombongan.
   *
   * TUJUAN
   * ------
   * Keberangkatan kapal adalah momen paling rawan: orang tertinggal atau
   * terpisah grup. Geofence memberi peringatan OTOMATIS saat peserta jauh
   * dari titik kumpul — peringatan, bukan blokir, karena radius bisa saja
   * keliru (titik kumpul belum di-update admin).
   *
   * MEMakai TITIK TERAKHIR (last-seen), bukan hanya posisi live — kasus yang
   * paling penting justru ketika peserta sudah offline lama.
   */

  const db = require('../db');
  const presence = require('./presence');
  const roster = require('./roster');

  /** Cooldown per (grup, anggota) agar tidak spam alert. */
  const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

  /** Key cooldown internal (dalam proses). */
  const lastFired = new Map();

  /**
   * Periksa semua rombongan dan kembalikan daftar pelanggaran.
   *
   * @param {object} data data aplikasi
   * @param {object} [settings] data.settings
   * @param {object} [seen] peta last-seen { 'role:refId': entry }; default = presence.lastSeenAll()
   * @returns {Array<object>} daftar pelanggaran geofence
   */
  function checkGroups(data, settings, seen) {
    const d = data || db.read() || {};
    let seenMap = seen;
    if (!seenMap) {
      seenMap = {};
      presence.lastSeenAll().forEach((e) => {
        seenMap[e.role + ':' + e.refId] = e;
      });
    }

    const hits = [];
    const groups = d.tripGroups || [];

    groups.forEach((group) => {
      if (!group || !group.meetingPoint) return;
      const radius = roster.radiusM(group);
      const members = roster.rosterOf(d, group, {}, seenMap);

      members.forEach((member) => {
        if (!member || member.lat == null || member.lng == null) return;
        const distance = roster.distanceToMeetingPoint(group, member);
        if (distance === null || !Number.isFinite(distance)) return;
        if (distance <= radius) return;

        const key = group.id + ':' + member.id;
        const now = Date.now();
        const prev = lastFired.get(key) || 0;
        if (now - prev < ALERT_COOLDOWN_MS) return;
        lastFired.set(key, now);

        hits.push({
          groupId: group.id,
          groupName: group.name,
          memberId: member.id,
          memberName: member.name,
          phone: member.phone,
          distance: distance,
          radiusM: radius,
          at: member.at
        });
      });
    });

    return hits;
  }

  /**
   * Reset cooldown (dipakai skrip uji).
   * @returns {void}
   */
  function resetCooldown() {
    lastFired.clear();
  }

  module.exports = { ALERT_COOLDOWN_MS, checkGroups, resetCooldown };
  ```

- [ ] **Step 4: Tambahkan route SOS di `src/routes/presence.routes.js`**

  Tambahkan setelah route `POST /stop` (yang sudah ada di `src/routes/presence.routes.js:189`):

  ```js
  /* ------------------------------------------------------------------ */
  /* POST /sos — pelanggan menekan tombol darurat                       */
  /* ------------------------------------------------------------------ */
  /**
   * Buat alert SOS dari pelanggan.
   *
   * Koordinat WAJIB valid — tanpa koordinat, alert tidak berguna.
   * Nomor HP diambil dari data pelanggan, BUKAN dari body — supaya klien
   * tidak bisa mengarang nomor orang lain.
   */
  router.post('/sos', (req, res) => {
    const me = identity(req);
    if (!me) {
      return res.status(401).json({ ok: false, error: 'Belum masuk.' });
    }
    if (me.role !== 'customer') {
      return res.status(403).json({ ok: false, error: 'Tombol SOS untuk pelanggan.' });
    }

    const data = db.read();
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    const accuracy = parseFloat(req.body.accuracy);
    if (!geo.isValidLatLng(lat, lng)) {
      return res.status(400).json({ ok: false, error: 'Koordinat tidak valid.' });
    }

    const customer = (data.customers || []).find((c) => c.id === me.refId);
    const presence = require('../services/presence');
    const alert = require('../services/alert');

    const sos = presence.sosCreate({
      role: me.role,
      refId: me.refId,
      name: me.name,
      phone: customer ? customer.phone : '',
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : null
    }, data.settings || {});

    if (!sos) {
      return res.status(400).json({ ok: false, error: 'Koordinat tidak valid.' });
    }

    // Kirim ke koordinator — TIDAK boleh menggagalkan response.
    alert.dispatchSos(sos, data).catch(() => {});

    res.json({ ok: true, id: sos.id, at: sos.at });
  });

  /* ------------------------------------------------------------------ */
  /* GET /sos — daftar alert (admin saja)                               */
  /* ------------------------------------------------------------------ */
  router.get('/sos', (req, res) => {
    if (!req.session || !req.session.userId) {
      return res.status(403).json({ ok: false, error: 'Hanya admin.' });
    }
    const presence = require('../services/presence');
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json({ ok: true, alerts: presence.sosList(status) });
  });

  /* ------------------------------------------------------------------ */
  /* GET /roster — roster semua rombongan (admin saja)                  */
  /* ------------------------------------------------------------------ */
  router.get('/roster', (req, res) => {
    if (!req.session || !req.session.userId) {
      return res.status(403).json({ ok: false, error: 'Hanya admin.' });
    }
    const data = db.read();
    const presence = require('../services/presence');
    const roster = require('../services/roster');

    const seenMap = {};
    presence.lastSeenAll().forEach((e) => {
      seenMap[e.role + ':' + e.refId] = e;
    });

    const groups = (data.tripGroups || []).map((g) => ({
      id: g.id,
      name: g.name,
      meetingPoint: g.meetingPoint || null,
      radiusM: roster.radiusM(g),
      members: roster.rosterOf(data, g, {}, seenMap)
    }));

    res.json({ ok: true, groups });
  });
  ```

- [ ] **Step 5: Jalankan geofence di `src/services/wa-scheduler.js`**

  Di file itu, tambahkan `require('./geofence')` dan tambahkan siklus baru:

  ```js
  /** Geofence — deteksi peserta jauh dari titik kumpul. */
  const geofence = require('./geofence');

  /**
   * Jalankan satu siklus pemeriksaan geofence.
   *
   * Mengirim peringatan ke koordinator bila ada peserta yang menjauh dari
   * titik kumpul lebih dari radius rombongan. Cooldown internal geofence
   * mencegah spam (sekali per jam per anggota).
   *
   * @returns {Promise<Array<object>>} daftar pelanggaran yang ter alerting
   */
  async function geofenceTick() {
    const data = db.read();
    const hits = geofence.checkGroups(data, data.settings || {});
    if (!hits.length) return [];
    const alert = require('./alert');
    for (const hit of hits) {
      try {
        await alert.dispatchSos({
          id: 'geofence_' + hit.groupId + '_' + hit.memberId,
          role: 'customer',
          refId: hit.memberId,
          name: hit.memberName,
          phone: hit.phone || '',
          lat: null,
          lng: null,
          at: hit.at || new Date().toISOString(),
          status: 'active',
          geofence: hit
        }, data);
      } catch (err) {
        // Satu kegagalan tidak menghentikan loop.
      }
    }
    return hits;
  }
  ```

  Tambahkan `geofenceTick,` ke `module.exports` di file itu.

  > Catatan: dispatcher SOS formats pesan dari lat/lng. Untuk geofence, koordinat peserta tidak ada di `hit` — tambahkan `lat`/`lng` ke objek `hit` di `geofence.js` (`member.lat`, `member.lng`) supaya pesan alert punya tautan peta. Sesuaikan `checkGroups` supaya `hit` memuat `lat` dan `lng` dari `member`.

- [ ] **Step 6: Tambahkan tombol SOS di `views/pages/account-location.ejs`**

  Cari blok tombol yang ada di halaman itu (di dekat markup `presShareBtn` / tombol "Bagikan Lokasi"), dan tambahkan:

  ```ejs
  <button type="button" class="btn btn--danger btn--sm" id="sosBtn">🆘 SOS</button>
  ```

  Tambahkan skrip kecil di blok `<script>` yang sudah ada di halaman itu:

  ```html
  <script>
  (function () {
    var btn = document.getElementById('sosBtn');
    var P = window.SylPresence;
    if (!btn || !P) return;
    btn.addEventListener('click', function () {
      if (!confirm('Kirim SOS? Koordinator akan menerima titik lokasi Anda.')) return;
      btn.disabled = true;
      btn.textContent = 'Mengirim…';
      P.sos().then(function (res) {
        btn.disabled = false;
        btn.textContent = '🆘 SOS';
        if (res && res.ok) {
          alert('SOS terkirim. Tim akan menghubungi Anda.');
        } else {
          alert('Gagal mengirim SOS: ' + ((res && res.error) || 'tidak diketahui'));
        }
      });
    });
  })();
  </script>
  ```

  > `confirm`/`alert` native dipakai agar tidak menambah dependensi; gaya UI mengikuti tombol yang sudah ada di halaman itu.

- [ ] **Step 7: Tambah `sos()` ke API klien `public/js/presence.js`**

  Tambahkan di objek `api` (dekat `refresh`):

  ```js
  /**
   * Kirim alert SOS (darurat) dengan posisi saat ini.
   *
   * Bila offline, permintaan diantrekan lokal seperti ping — sehingga
   * tombol SOS tetap aman dipakai saat sinyal jelek.
   *
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  sos: function () {
    var self = state.self;
    if (!self || typeof self.lat !== 'number' || typeof self.lng !== 'number') {
      // Tidak ada posisi — coba baca GPS sekali lalu kirim.
      return new Promise(function (resolve) {
        if (!global.navigator || !global.navigator.geolocation) {
          resolve({ ok: false, error: 'Lokasi tidak tersedia.' });
          return;
        }
        global.navigator.geolocation.getCurrentPosition(
          function (pos) {
            resolve(api.sosAt(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy));
          },
          function () {
            resolve({ ok: false, error: 'Tidak bisa membaca lokasi. Coba lagi di area terbuka.' });
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
      });
    }
    return api.sosAt(self.lat, self.lng, self.accuracy);
  },

  /**
   * Kirim alert SOS dengan koordinat tertentu.
   * @param {number} lat
   * @param {number} lng
   * @param {number} [accuracy]
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  sosAt: function (lat, lng, accuracy) {
    return fetch(API + '/sos', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf
      },
      body: JSON.stringify({ lat: lat, lng: lng, accuracy: accuracy === undefined ? null : accuracy })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) return { ok: false, error: data.error || ('HTTP ' + res.status) };
          return { ok: true, id: data.id, at: data.at };
        });
      })
      .catch(function () {
        // Offline — antrekan lokal agar terkirim saat koneksi kembali.
        enqueue({ kind: 'sos', lat: lat, lng: lng, accuracy: accuracy === undefined ? null : accuracy });
        state.online = false;
        state.lastError = 'Sinyal hilang. SOS diantrekan dan dikirim otomatis saat online.';
        emit();
        return { ok: false, error: 'Sinyal hilang. SOS diantrekan dan dikirim saat online.' };
      });
  },
  ```

  Dan perbarui `flushQueue()` agar honoring item bertipe `'sos'`:

  ```js
  /** Kirim ulang antrean offline (paling baru dulu). */
  function flushQueue() {
    var q = lsGet(LS_QUEUE, []);
    if (!Array.isArray(q) || !q.length) return;
    var last = q[q.length - 1];
    lsSet(LS_QUEUE, []);
    if (last && last.kind === 'sos') {
      api.sosAt(last.lat, last.lng, last.accuracy);
    } else {
      ping(last);
    }
  }
  ```

  > Catatan: `flushQueue` saat ini mengambil item terakhir saja. Item `'sos'` bertipe berbeda dari payload ping — jangan kirim payload SOS ke `/ping` dan sebaliknya.

- [ ] **Step 8: Tambah badge last-seen di `views/admin/lokasi.ejs`**

  Di blok daftar peer (`<% peers.forEach(function (p) { %>`), tambahkan penanda usia relatif:

  ```ejs
  <% if (p.ageLabel && p.ageLabel !== '-') { %>
    · terakhir terlihat <%= p.ageLabel %>
  <% } %>
  ```

  > `peers` di route `/admin/lokasi` dibangun dari `presence.peersOf()` — entri live sudah punya `at`. Untuk ageLabel, gunakan `formatAge(p.at)` (helper geo sudah di-expose ke `res.locals` oleh Task 15). Jadi baris di atas cukup `· terakhir terlihat <%= formatAge(p.at) %>` di dalam blok `<% if (p.at) { %>`.

- [ ] **Step 9: Daftarkan suite di `scripts/wa-run-tests.js`**

  Tambahkan `'geofence.test.js'` ke array `suites`.

- [ ] **Step 10: Jalankan test, pastikan LULUS**

  Run: `node scripts/geofence.test.js`
  Expected: `OK — N pemeriksaan lulus`, exit 0.

- [ ] **Step 11: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 12: Jalankan penjaga**

  Run: `node scripts/wa-check.js`
  Expected: "Semua modul & template OK." exit 0.

- [ ] **Step 13: Verifikasi template masih bisa dikompilasi**

  ```bash
  node -e "const ejs=require('ejs');const fs=require('fs');['views/pages/account-location.ejs','views/admin/lokasi.ejs'].forEach(p=>{ejs.compile(fs.readFileSync(p,'utf8'),{filename:p});console.log('EJS OK '+p)})"
  ```

  Expected: dua baris `EJS OK`.

- [ ] **Step 14: Commit**

  ```bash
  git add src/routes/presence.routes.js src/services/wa-scheduler.js src/services/geofence.js \
          views/pages/account-location.ejs views/admin/lokasi.ejs public/js/presence.js \
          scripts/geofence.test.js scripts/wa-run-tests.js
  git commit -m "feat(lokasi): tombol SOS, endpoint roster, dan deteksi geofence berkala"
  ```

---
