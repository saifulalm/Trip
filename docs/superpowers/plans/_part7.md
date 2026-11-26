
## Task 14: Deep link Google Maps + helper format usia

**Files:**
- Modify: `src/services/geo.js` (tambah `mapsUrl`, `formatAge`, `mapsDirUrl`)
- Test: `scripts/geo-trip.test.js` (tambah suite)

**Interfaces:**
- Consumes: tidak ada.
- Produces (baru di `src/services/geo.js`):
  - `mapsUrl(lat, lng, label?)` → string URL Google Maps.
  - `mapsDirUrl(lat, lng, label?)` → string URL rute Directions.
  - `formatAge(iso)` → teks relatif ("baru saja", "3 menit lalu", "2 jam lalu", "3 hari lalu").

**Format URL yang dipakai:**

| Goal | URL |
|---|---|
| Lihat lokasi | `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>` |
| Dengan label | `...&query=<lat>,<lng>(<label>)` |
| Rute directions | `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` |

Label harus di-URL-encode. `encodeURIComponent` cukup untuk koordinat + label
sederhana; kalau label mengandung koma, ganti koma dengan `%2C` — `encodeURIComponent`
tidak men-encode koma. Tulis helper kecil:

```js
function mapsUrl(lat, lng, label) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return '';
  let q = la.toFixed(6) + ',' + ln.toFixed(6);
  if (label) q += '(' + encodeURIComponent(String(label)) + ')';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}
```

> Perhatikan: `encodeURIComponent` applied ke seluruh query (termasuk koma)
> menghasilkan `%2C` — itu valid dan diterima Google Maps.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/geo-trip.test.js`:

  ```js
  // -- Deep link peta & format usia -------------------------------------
  console.log('\n== Deep link peta ==');

  t('mapsUrl menghasilkan URL Google Maps yang valid', () => {
    const u = geo.mapsUrl(-0.4719, 130.7515);
    assert.ok(u.startsWith('https://www.google.com/maps/search/?api=1&query='), u);
    assert.ok(u.indexOf('-0.471900') !== -1, 'latitude harus ada: ' + u);
    assert.ok(u.indexOf('130.751500') !== -1, 'longitude harus ada: ' + u);
  });

  t('mapsUrl menyertakan label yang ter-encode', () => {
    const u = geo.mapsUrl(-0.47, 130.75, 'Dermaga Waisai');
    assert.ok(u.indexOf('Dermaga') !== -1, 'label harus ada: ' + u);
    assert.ok(u.indexOf(' ') === -1, 'spasi harus ter-encode: ' + u);
  });

  t('mapsUrl menolak koordinat invalid', () => {
    assert.strictEqual(geo.mapsUrl('abc', 130.75), '');
    assert.strictEqual(geo.mapsUrl(-0.47, null), '');
    assert.strictEqual(geo.mapsUrl(0, 0), '');
  });

  t('mapsDirUrl menghasilkan URL directions', () => {
    const u = geo.mapsDirUrl(-0.4719, 130.7515);
    assert.ok(u.startsWith('https://www.google.com/maps/dir/?api=1&destination='), u);
  });

  t('formatAge menghasilkan teks relatif yang wajar', () => {
    const now = Date.now();
    assert.strictEqual(geo.formatAge(new Date(now - 5000).toISOString()), 'baru saja');
    assert.strictEqual(geo.formatAge(new Date(now - 3 * 60000).toISOString()), '3 menit lalu');
    assert.strictEqual(geo.formatAge(new Date(now - 2 * 3600000).toISOString()), '2 jam lalu');
    assert.strictEqual(geo.formatAge(new Date(now - 3 * 86400000).toISOString()), '3 hari lalu');
  });

  t('formatAge aman untuk input tidak valid', () => {
    assert.strictEqual(geo.formatAge(null), '-');
    assert.strictEqual(geo.formatAge('bukan tanggal'), '-');
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/geo-trip.test.js`
  Expected: FAIL — `geo.mapsUrl` bukan fungsi.

- [ ] **Step 3: Implementasikan di `src/services/geo.js`**

  Tambahkan sebelum `module.exports`:

  ```js
  /**
   * Link Google Maps untuk melihat satu titik.
   *
   * Dipakai admin & pelanggan untuk membuka lokasi terakhir peserta
   * di aplikasi peta — jauh lebih cepat daripada menyalin koordinat
   * secara manual ke aplikasi peta.
   *
   * @param {number|string} lat latitude
   * @param {number|string} lng longitude
   * @param {string} [label] nama titik (opsional)
   * @returns {string} URL Google Maps, atau string kosong bila koordinat invalid
   */
  function mapsUrl(lat, lng, label) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return '';
    if (la === 0 && ln === 0) return '';
    let q = la.toFixed(6) + ',' + ln.toFixed(6);
    if (label) q += '(' + String(label) + ')';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  /**
   * Link Google Maps untuk rute menuju satu titik.
   *
   * @param {number|string} lat latitude tujuan
   * @param {number|string} lng longitude tujuan
   * @returns {string} URL Directions, atau string kosong bila koordinat invalid
   */
  function mapsDirUrl(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return '';
    if (la === 0 && ln === 0) return '';
    return 'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent(la.toFixed(6) + ',' + ln.toFixed(6));
  }

  /**
   * Format waktu relatif yang enak dibaca ("3 menit lalu").
   *
   * Dipakai untuk menampilkan kapan posisi terakhir seseorang tercatat.
   * @param {string|number|Date} value waktu ISO
   * @returns {string} teks relatif, atau '-' bila tidak valid
   */
  function formatAge(value) {
    if (!value) return '-';
    const d = value instanceof Date ? value : new Date(value);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return '-';

    const diff = Date.now() - ms;
    if (diff < 0) return 'baru saja';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'baru saja';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + ' menit lalu';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' jam lalu';
    const day = Math.floor(hour / 24);
    if (day < 30) return day + ' hari lalu';
    const month = Math.floor(day / 30);
    if (month < 12) return month + ' bulan lalu';
    return Math.floor(month / 12) + ' tahun lalu';
  }
  ```

  Tambahkan ke `module.exports`: `mapsUrl,` `mapsDirUrl,` `formatAge,`

- [ ] **Step 4: Jalankan test, pastikan LULUS**

  Run: `node scripts/geo-trip.test.js`
  Expected: semua suite lulus.

- [ ] **Step 5: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 6: Commit**

  ```bash
  git add src/services/geo.js scripts/geo-trip.test.js
  git commit -m "feat(geo): tambah deep link Google Maps dan format usia relatif"
  ```

---

## Task 15: Pencarian peserta & halaman rombongan di Customer Login

**Files:**
- Modify: `src/routes/account.routes.js` — tambah `GET /akun/cari`, `GET /akun/rombongan/:id`
- Modify: `src/middleware/context.js` — expose `geo.mapsUrl` & `geo.formatAge` ke template
- Create: `views/pages/account-search.ejs` (BARU)
- Create: `views/pages/account-group.ejs` (BARU)
- Modify: `views/partials/header.ejs` — tambah link navigasi (opsional)
- Test: `scripts/account-search.test.js` (BARU)

**Interfaces:**
- Consumes: `roster` (Task 13), `presence.lastSeen/lastSeenAll` (Task 12), `geo.mapsUrl/formatAge` (Task 14).
- Produces:
  - `GET /akun/cari?q=<kata>&booking=<kode>` — halaman pencarian peserta.
  - `GET /akun/rombongan/:id` — halaman roster satu rombongan.
  - Helper template: `mapsUrl(lat, lng, label)`, `formatAge(iso)`.

**Aturan privasi (WAJIB dipatuhi):**

Pelanggan HANYA boleh melihat:
1. Diri sendiri.
2. Admin (tim).
3. Fellow traveler dengan **kode booking yang sama**.
4. Fellow traveler dalam **group/rombongan yang sama**.

Pelanggan TIDAK boleh melihat pelanggan lain. Ini persis aturan yang sudah
dijalankan `presence.peersOf()` — Task ini memakai fungsi yang sama, bukan
menggantinya.

- [ ] **Step 1: Tulis test yang gagal**

  Create `scripts/account-search.test.js`:

  ```js
  'use strict';

  /**
   * Uji privasi pencarian peserta & roster rombongan.
   *
   * Fokus: pelanggan hanya boleh melihat fellow traveler yang memang
   * boleh dia lihat (booking sama atau(group sama). Pelanggan lain
   * harus tersembunyi.
   *
   * Jalankan: node scripts/account-search.test.js
   */

  const assert = require('assert');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const roster = require(path.join(root, 'src', 'services', 'roster'));

  let pass = 0;
  let fail = 0;
  function t(name, fn) {
    try {
      fn();
      pass += 1;
      console.log('  PASS  ' + name);
    } catch (err) {
      fail += 1;
      console.log('  FAIL  ' + name + '  ->  ' + err.message);
    }
  }

  const DATA = {
    tripGroups: [
      { id: 'grp_a', name: 'Rombongan A', bookingCodes: ['SYL-1', 'SYL-2'], meetingPoint: null, radiusM: 5000 }
    ],
    bookings: [
      { id: 'b1', code: 'SYL-1', name: 'Budi', customerId: 'c1', phone: '0811', packageName: 'P', departureDate: '2026-11-12' },
      { id: 'b2', code: 'SYL-2', name: 'Sari', customerId: 'c2', phone: '0822', packageName: 'P', departureDate: '2026-11-12' },
      { id: 'b3', code: 'SYL-9', name: 'Rahasia', customerId: 'c9', phone: '0899', packageName: 'Q', departureDate: '2026-11-12' }
    ],
    customers: [
      { id: 'c1', name: 'Budi', email: 'budi@x.com', phone: '0811' },
      { id: 'c2', name: 'Sari', email: 'sari@x.com', phone: '0822' },
      { id: 'c9', name: 'Rahasia', email: 'r@x.com', phone: '0899' }
    ]
  };

  console.log('\n== Privasi roster ==');

  t('roster group hanya berisi anggota group', () => {
    const g = roster.groupOf(DATA, 'grp_a');
    const r = roster.rosterOf(DATA, g);
    const names = r.map((x) => x.name);
    assert.ok(names.includes('Budi'));
    assert.ok(names.includes('Sari'));
    assert.ok(!names.includes('Rahasia'), 'bukan anggota group tidak boleh masuk');
  });

  t('groupsForCustomer tidak membocorkan group orang lain', () => {
    const gs = roster.groupsForCustomer(DATA, 'c9');
    assert.strictEqual(gs.length, 0, 'c9 bukan anggota group mana pun');
  });

  t('distanceToMeetingPoint null bila group tanpa titik kumpul', () => {
    const g = roster.groupOf(DATA, 'grp_a');
    const r = roster.rosterOf(DATA, g);
    const d = roster.distanceToMeetingPoint(g, r[0]);
    assert.strictEqual(d, null);
  });

  t('distanceToMeetingPoint null bila peserta tanpa koordinat', () => {
    const g = { id: 'g', meetingPoint: { lat: 1, lng: 2 }, bookingCodes: [] };
    assert.strictEqual(roster.distanceToMeetingPoint(g, { lat: null, lng: null }), null);
  });

  console.log('\n' + (fail === 0
    ? 'OK - ' + pass + ' pemeriksaan lulus'
    : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
  process.exit(fail === 0 ? 0 : 1);
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/account-search.test.js`
  Expected: FAIL — modul `roster` mungkin sudah ada (Task 13), tapi suite
  ini harus **lulus** kalau Task 13 sudah dikerjakan. Kalau gagal, itu berarti
  Task 13 belum selesai — **kerjakan Task 13 dulu**.

  > Ini disengaja: Task 15 bergantung pada Task 13. Urutan eksekusi WAJIB.

- [ ] **Step 3: Expose helper geo ke template**

  Di `src/middleware/context.js`, tambahkan di blok `res.locals`:

  ```js
  // Helper peta untuk template (deep link Google Maps + usia relatif).
  res.locals.mapsUrl = geo.mapsUrl;
  res.locals.mapsDirUrl = geo.mapsDirUrl;
  res.locals.formatAge = geo.formatAge;
  ```

  Dan tambahkan import di bagian atas:

  ```js
  const geo = require('../services/geo');
  ```

- [ ] **Step 4: Tambahkan route `GET /akun/cari`**

  Di `src/routes/account.routes.js`, tambahkan (setelah route `/akun/lokasi`):

  ```js
  /* ------------------------------------------------------------------ */
  /* Cari peserta (fellow traveler) — untukentional device safety       */
  /* ------------------------------------------------------------------ */
  /*
   * Pelanggan boleh mencari fellow traveler-nya sendiri. Ini bukan
   * directorio publik: hasil pencarian hanya berisi orang yang memang
   * sudah berhak dilihat (booking sama atau rombongan sama).
   *
   * Yang TIDAK boleh terjadi: satu pelanggan melihat pelanggan lain
   * yang tidak punya hubungan trip dengan dia.
   */
  router.get('/akun/cari', requireCustomer, (req, res) => {
    const data = db.read();
    const customer = req.customer;
    const q = String(req.query.q || '').trim().toLowerCase();
    const bookingCode = String(req.query.booking || '').trim().toUpperCase();

    // Kumpulkan booking milik pelanggan ini.
    const myBookings = (data.bookings || []).filter((b) => b.customerId === customer.id);
    const myCodes = myBookings.map((b) => b.code);

    // Kumpulkan groupe yang diikuti pelanggan ini.
    const myGroups = roster.groupsForCustomer(data, customer.id);
    const myGroupIds = myGroups.map((g) => g.id);

    // Kandidat: semua pelanggan yang ada di booking saya atau group saya.
    const allowedCodes = new Set();
    myBookings.forEach((b) => allowedCodes.add(b.code));
    myGroups.forEach((g) => (g.bookingCodes || []).forEach((c) => allowedCodes.add(c)));

    const customers = data.customers || [];
    const allowedCustomerIds = new Set();
    (data.bookings || []).forEach((b) => {
      if (allowedCodes.has(b.code) && b.customerId) allowedCustomerIds.add(b.customerId);
    });

    // Kumpulkan posisi terakhir (live + last-seen).
    const seenMap = {};
    presence.lastSeenAll().forEach((e) => {
      seenMap[e.role + ':' + e.refId] = e;
    });
    const liveMap = {};
    (data.customers || []).forEach(() => {});
    presence.list ? null : null;

    let results = customers
      .filter((c) => allowedCustomerIds.has(c.id))
      .map((c) => {
        const entry = seenMap['customer:' + c.id] || null;
        const at = entry && entry.at ? new Date(entry.at).getTime() : 0;
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          lat: entry ? entry.lat : null,
          lng: entry ? entry.lng : null,
          accuracy: entry ? entry.accuracy : null,
          at: entry ? entry.at : null,
          ageMin: at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null,
          shared: Boolean(c.id !== customer.id && entry)
        };
      });

    // Filter pencarian.
    if (q) {
      results = results.filter((c) =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.phone || '').includes(q)
      );
    }
    if (bookingCode) {
      const b = (data.bookings || []).find((x) => x.code === bookingCode);
      const allowed = b && allowedCustomerIds.has(b.customerId);
      if (!allowed) results = [];
    }

    res.render('pages/account-search', {
      title: 'Cari Peserta',
      q: req.query.q || '',
      bookingCode: bookingCode,
      results,
      myBookings,
      myGroups,
      allowedCodes: Array.from(allowedCodes),
      myGroupIds
    });
  });
  ```

  > **PENTING — bersihkan kode di atas sebelum implementasi.** Baris
  > `presence.list ? null : null;` dan `const liveMap = {};` adalah sisa
  > percobaan — **HAPUS KEDUA BARIS ITU**. Kode final:
  >
  > ```js
  >     // Kumpulkan posisi terakhir (live + last-seen).
  >     const seenMap = {};
  >     presence.lastSeenAll().forEach((e) => {
  >       seenMap[e.role + ':' + e.refId] = e;
  >     });
  > ```
  >
  > `liveMap` tidak dipakai — hapus.

  > `requireCustomer` dan `roster` dan `presence` harus sudah di-require di
  > `src/routes/account.routes.js`. Kalau `roster` belum ada, tambahkan:
  > `const roster = require('../services/roster');`

- [ ] **Step 5: Tambahkan route `GET /akun/rombongan/:id`**

  ```js
  /* ------------------------------------------------------------------ */
  /* Roster rombongan — peta bersama satu kapal                         */
  /* ------------------------------------------------------------------ */
  router.get('/akun/rombongan/:id', requireCustomer, (req, res, next) => {
    const data = db.read();
    const customer = req.customer;
    const group = roster.groupOf(data, req.params.id);

    // Pelanggan hanya boleh membuka group yang dia ikuti.
    const myGroupIds = roster.groupsForCustomer(data, customer.id).map((g) => g.id);
    if (!group || !myGroupIds.includes(group.id)) return next();

    const seenMap = {};
    presence.lastSeenAll().forEach((e) => {
      seenMap[e.role + ':' + e.refId] = e;
    });

    const members = roster.rosterOf(data, group, {}, seenMap).map((p) => {
      const distance = roster.distanceToMeetingPoint(group, p);
      return {
        ...p,
        distance: distance,
        distanceLabel: Number.isFinite(distance) ? geo.formatDistance(distance) : null,
        mapsUrl: geo.mapsUrl(p.lat, p.lng, p.name),
        ageLabel: geo.formatAge(p.at)
      };
    });

    res.render('pages/account-group', {
      title: group.name,
      group,
      members,
      meetingPoint: group.meetingPoint || null,
      mapsUrl: geo.mapsUrl(group.meetingPoint && group.meetingPoint.lat, group.meetingPoint && group.meetingPoint.lng, group.name),
      mapData: JSON.stringify({
        dest: group.meetingPoint || null,
        checkIn: null,
        track: [],
        live: null,
        peers: members
          .filter((m) => m.lat != null && m.lng != null)
          .map((m) => ({
            role: 'customer',
            name: m.name,
            label: m.ageLabel,
            lat: m.lat,
            lng: m.lng,
            distance: m.distance
          }))
      })
    });
  });
  ```

  > `geo` harus di-require di `src/routes/account.routes.js`:
  > `const geo = require('../services/geo');`

- [ ] **Step 6: Buat `views/pages/account-search.ejs`**

  ```ejs
  <section class="portal-shell">
    <div class="container">
      <header class="portal-hero reveal">
        <div>
          <span class="portal-hero__eyebrow">Portal Pelanggan</span>
          <h1 class="portal-hero__title">Cari Peserta</h1>
          <p class="portal-hero__sub">
            Cari fellow traveler Anda. Hanya orang yang memang berada dalam trip
            atau rombongan yang sama dengan Anda yang bisa terlihat di sini.
          </p>
        </div>
        <div class="portal-hero__actions">
          <a href="/akun/lokasi" class="btn btn--outline btn--sm">📍 Lokasi Saya</a>
          <a href="/akun" class="btn btn--ghost btn--sm">← Dashboard</a>
        </div>
      </header>

      <section class="portal-panel reveal">
        <div class="portal-panel__head">
          <div>
            <h2 class="portal-panel__title">Pencarian</h2>
            <p class="portal-panel__hint">Cari berdasarkan nama, email, atau nomor HP.</p>
          </div>
        </div>

        <form action="/akun/cari" method="get" class="portal-form" style="display:flex; gap:0.6rem; flex-wrap:wrap">
          <input type="search" name="q" value="<%= q %>" placeholder="Nama peserta…" style="flex:1; min-width:220px">
          <select name="booking" class="portal-field" style="flex:0 1 220px">
            <option value="">Semua trip saya</option>
            <% myBookings.forEach(function (b) { %>
              <option value="<%= b.code %>" <%= bookingCode === b.code ? 'selected' : '' %>><%= b.code %> — <%= b.packageName %></option>
            <% }); %>
          </select>
          <button type="submit" class="btn btn--deep btn--sm">Cari</button>
        </form>

        <% if (results.length === 0) { %>
          <div class="portal-empty">
            <div class="portal-empty__icon">🔎</div>
            <h3 class="portal-empty__title">Tidak ada peserta ditemukan</h3>
            <p>Coba kata kunci lain, atau pilih trip tertentu di atas.</p>
          </div>
        <% } else { %>
          <ul class="loc-history" style="margin-top:1rem">
            <% results.forEach(function (r) { %>
              <li>
                <span class="loc-history__code"><%= r.name %></span>
                <span class="loc-history__time">
                  <%= r.phone || r.email || '-' %>
                  <% if (r.at) { %> · terakhir terlihat <%= formatAge(r.at) %><% } else { %> · belum pernah membagikan lokasi<% } %>
                </span>
                <% if (r.mapsUrl) { %>
                  <br><a href="<%= r.mapsUrl %>" target="_blank" rel="noopener" style="font-size:0.8rem">Buka di Google Maps ↗</a>
                <% } %>
              </li>
            <% }); %>
          </ul>
        <% } %>
      </section>

      <% if (myGroups.length) { %>
        <section class="portal-panel reveal">
          <div class="portal-panel__head">
            <div>
              <h2 class="portal-panel__title">Rombongan Saya</h2>
              <p class="portal-panel__hint">Daftar peserta dalamITLEMbongan yang Anda ikuti.</p>
            </div>
          </div>
          <ul class="loc-history">
            <% myGroups.forEach(function (g) { %>
              <li>
                <span class="loc-history__code"><%= g.name %></span>
                <span class="loc-history__time"><%= (g.bookingCodes || []).length %> booking</span>
                <br><a href="/akun/rombongan/<%= g.id %>" style="font-size:0.8rem">Lihat peta rombongan →</a>
              </li>
            <% }); %>
          </ul>
        </section>
      <% } %>
    </div>
  </section>
  ```

  > **Perbaikan mandatory:** kalimat "Daftar peserta dalamITLEMbongan yang Anda
  > ikuti." harus menjadi "Daftar peserta dalam rombongan yang Anda ikuti."

- [ ] **Step 7: Buat `views/pages/account-group.ejs`**

  ```ejs
  <section class="portal-shell">
    <div class="container">
      <header class="portal-hero reveal">
        <div>
          <span class="portal-hero__eyebrow">Rombongan</span>
          <h1 class="portal-hero__title"><%= group.name %></h1>
          <p class="portal-hero__sub">
            Peta bersama seluruh peserta rombongan ini beserta posisi terakhir
            masing-masing.
          </p>
        </div>
        <div class="portal-hero__actions">
          <a href="/akun/cari" class="btn btn--outline btn--sm">🔎 Cari Peserta</a>
          <a href="/akun" class="btn btn--ghost btn--sm">← Dashboard</a>
        </div>
      </header>

      <div class="portal-grid">
        <div class="portal-stack">
          <section class="portal-panel reveal">
            <div class="portal-panel__head">
              <div>
                <h2 class="portal-panel__title">Peta Rombongan</h2>
                <p class="portal-panel__hint">Titik kumpul ditandai bintang.</p>
              </div>
            </div>
            <div class="portal-map portal-map--tall" id="syl-map"></div>
            <% if (mapsUrl) { %>
              <p style="margin-top:0.8rem">
                <a class="btn btn--outline btn--sm" href="<%= mapsUrl %>" target="_blank" rel="noopener">Buka Titik Kumpul di Google Maps ↗</a>
              </p>
            <% } %>
          </section>
        </div>

        <div class="portal-stack">
          <section class="portal-panel reveal">
            <div class="portal-panel__head">
              <div>
                <h2 class="portal-panel__title">Peserta (<%= members.length %>)</h2>
                <p class="portal-panel__hint">Posisi terakhir yang diketahui tiap peserta.</p>
              </div>
            </div>
            <ul class="loc-history">
              <% members.forEach(function (m) { %>
                <li>
                  <span class="loc-history__code"><%= m.name %></span>
                  <span class="loc-history__time">
                    <%= m.bookingCode %> · <%= m.packageName %>
                    <% if (m.ageLabel && m.ageLabel !== '-') { %> · terakhir terlihat <%= m.ageLabel %><% } %>
                    <% if (m.distanceLabel) { %> · <%= m.distanceLabel %> dari titik kumpul<% } %>
                  </span>
                  <% if (m.phone) { %>
                    <br><a href="https://wa.me/<%= String(m.phone).replace(/[^0-9]/g, '') %>" target="_blank" rel="noopener" style="font-size:0.8rem">📞 Hubungi via WhatsApp</a>
                  <% } %>
                  <% if (m.mapsUrl) { %>
                    <br><a href="<%= m.mapsUrl %>" target="_blank" rel="noopener" style="font-size:0.8rem">Buka di Google Maps ↗</a>
                  <% } %>
                </li>
              <% }); %>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </section>

  <script id="map-data" type="application/json"><%- mapData %></script>
  ```

  > `mapData` di-render sebagai JSON mentah. Pastikan tidak ada karakter `</script>`
  > di dalam data (nama peserta bisa mengandung `<`). **Safety:** escape `</` jadi
  > `<\/` — lihat `src/seo.js` pola yang sama untuk JSON-LD. Tambahkan di route:
  >
  > ```js
  > mapData: JSON.stringify({...}).replace(/</g, '\\u003c')
  > ```

- [ ] **Step 8: Tambah link navigasi**

  Di `views/partials/header.ejs`, setelah link "📍 Lokasi" (sekitar baris 37),
  tambahkan:

  ```ejs
  <a href="/akun/cari" class="nav__link <%= currentPath.startsWith('/akun/cari') ? 'active' : '' %>">🔎 Cari Peserta</a>
  ```

  > Perhatikan: `currentPath` untuk `/akun/rombongan` juga.startsWith('/akun/cari')?
  > Tidak — `startsWith('/akun/cari')` tidak cocok dengan `/akun/rombongan`.
  > Tapi supaya menu Rombongan ikut aktif, tambahkan juga pengecekan
  > `currentPath.startsWith('/akun/rombongan')` pada link yang sama.

- [ ] **Step 9: Jalankan test, pastikan LULUS**

  Run: `node scripts/account-search.test.js`
  Expected: "OK - 5 pemeriksaan lulus".

- [ ] **Step 10: Verifikasi halaman**

  Run: `npm run test:e2e:portal`
  Expected: script portal lulus.

- [ ] **Step 11: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 12: Commit**

  ```bash
  git add src/routes/account.routes.js src/middleware/context.js \
          views/pages/account-search.ejs views/pages/account-group.ejs \
          views/partials/header.ejs scripts/account-search.test.js
  git commit -m "feat(portal): pencarian peserta dan peta rombongan di customer login"
  ```

---
