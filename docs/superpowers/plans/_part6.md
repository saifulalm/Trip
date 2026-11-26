
# FASE 3 — Pencarian & Pelacakan Posisi di Customer Login

## Task 12: Simpan "last seen" persisten di presence service

**Files:**
- Modify: `src/services/presence.js` (tambah `lastSeen`, ubah schema ke v2)
- Test: `scripts/presence.test.js` (tambah suite), `scripts/presence-http.test.js`

**Interfaces:**
- Consumes: `geo.isValidLatLng` (sudah ada), `db.uid`.
- Produces (baru di `src/services/presence.js`):
  - `lastSeen(role, refId)` → `{role, refId, name, label, lat, lng, accuracy, at, ageMin, source}` atau `null`.
  - `lastSeenAll()` → array seluruh entri last-seen (dipakai admin & roster).
  - `recordLastSeen(entry)` → uptick internal (dipanggil `upsert`).
  - `upsert(entry, settings)` — **perilaku tambahan**: selain menyimpan entri live, juga menyalin ke `lastSeen` dengan `source: 'live'`.
  - `schemaVersion` — konstanta `2`.

**Masalah yang diselesaikan (B7):**

`presence.sweep()` menghapus entri yang lewat TTL. Begitu 5 menit berlalu tanpa ping,
titik terakhir hilang selamanya. Untuk kasus darurat ("user hilang 2 jam lalu, di mana
dia terakhir?") sistem ini tidak bisa menjawab.

**Solusi:** dua lapis penyimpanan di `data/presence.json`:

```json
{
  "version": 2,
  "entries": {
    "customer:cus_x": { "role": "customer", "refId": "cus_x", "name": "...", "lat": 0.1, "lng": 1.2, "accuracy": 15, "at": "2026-11-25T10:00:00.000Z" }
  },
  "lastSeen": {
    "customer:cus_x": { "role": "customer", "refId": "cus_x", "name": "...", "lat": 0.1, "lng": 1.2, "accuracy": 15, "at": "2026-11-25T10:00:00.000Z", "source": "live" }
  }
}
```

- `entries` = posisi **live**, dihapus oleh TTL (perilaku sekarang, tidak berubah).
- `lastSeen` = posisi **terakhir yang diketahui**, TIDAK dihapus oleh TTL.

- [ ] **Step 1: Tulis test yang gagal**

  Tambahkan di `scripts/presence.test.js`, sebelum blok `cleanup()`:

  ```js
  test('lastSeen menyimpan titik terakhir setelah entri live dihapus TTL', () => {
    const SVC = loadWith(TMP_FILE);
    SVC.reset();

    // Simpan posisi, lalu majukan waktu lewat TTL.
    SVC.upsert({
      role: 'customer', refId: 'cus_last', name: 'Budi',
      lat: -0.47, lng: 130.75, accuracy: 12
    }, { presenceEnabled: true, presenceTtlMin: 1 });

    const live = SVC.get('customer', 'cus_last');
    assert.ok(live, 'entri live harus ada');

    // Paksa entri live jadi basi dengan menyuntik waktu lama.
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    SVC.upsert({ role: 'admin', refId: 'usr_x', name: 'X', lat: 1, lng: 2, at: stale },
      { presenceEnabled: true, presenceTtlMin: 1 });

    const seen = SVC.lastSeen('customer', 'cus_last');
    assert.ok(seen, 'lastSeen harus tetap ada walau live sudah basi');
    assert.strictEqual(Number(seen.lat).toFixed(2), (-0.47).toFixed(2));
    assert.strictEqual(seen.source, 'live');
  });

  test('lastSeen punya ageMin yang bertambah seiring waktu', () => {
    const SVC = loadWith(TMP_FILE);
    SVC.reset();
    SVC.upsert({
      role: 'customer', refId: 'cus_age', name: 'Sari',
      lat: -0.5, lng: 130.8
    }, { presenceEnabled: true, presenceTtlMin: 60 });

    const seen = SVC.lastSeen('customer', 'cus_age');
    assert.ok(seen);
    assert.ok(typeof seen.ageMin === 'number', 'ageMin harus angka');
    assert.ok(seen.ageMin >= 0, 'ageMin tidak boleh negatif');
  });

  test('lastSeenAll mengembalikan daftar untuk admin', () => {
    const SVC = loadWith(TMP_FILE);
    SVC.reset();
    SVC.upsert({ role: 'customer', refId: 'cus_a', name: 'A', lat: 1, lng: 2 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    SVC.upsert({ role: 'customer', refId: 'cus_b', name: 'B', lat: 3, lng: 4 },
      { presenceEnabled: true, presenceTtlMin: 60 });

    const all = SVC.lastSeenAll();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 2, 'harus ada minimal 2 entri');
  });

  test('presence.json memakai schema versi 2', () => {
    const SVC = loadWith(TMP_FILE);
    SVC.reset();
    SVC.upsert({ role: 'customer', refId: 'cus_v', name: 'V', lat: 1, lng: 2 },
      { presenceEnabled: true, presenceTtlMin: 60 });
    const raw = JSON.parse(require('fs').readFileSync(TMP_FILE, 'utf8'));
    assert.strictEqual(raw.version, 2);
    assert.ok(raw.lastSeen, 'field lastSeen harus ada');
  });
  ```

  > Test memakai `SVC.reset()` — pastikan fungsi itu ada di `presence.js`.
  > Kalau belum ada, tambahkan (lihat Step 3).

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/presence.test.js`
  Expected: FAIL — `SVC.lastSeen` bukan fungsi.

- [ ] **Step 3: Ubah skema & tambah API lastSeen di `src/services/presence.js`**

  **3a. Fungsi baca/tulis berkas.** Temukan fungsi yang membaca/menulis
  `data/presence.json`. Ganti agar file bisa punya dua bagian (`entries` +
  `lastSeen`) dan default versi 2.

  ```js
  /**
   * Versi skema berkas presence.
   *
   * v1: hanya `entries` (posisi live dengan TTL).
   * v2: `entries` + `lastSeen` (posisi terakhir yang diketahui, persisten).
   */
  const SCHEMA_VERSION = 2;

  /**
   * Baca isi berkas presence, dengan bentuk default bila file belum ada
   * atau versinya lama.
   * @returns {object} { version, entries, lastSeen }
   */
  function readStore() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (err) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') {
      return { version: SCHEMA_VERSION, entries: {}, lastSeen: {} };
    }
    return {
      version: raw.version || 1,
      entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {},
      lastSeen: raw.lastSeen && typeof raw.lastSeen === 'object' ? raw.lastSeen : {}
    };
  }
  ```

  Sesuaikan semua tempat yang membaca/menulis berkas agar memakai `readStore()`
  dan menyimpan ulang `version: SCHEMA_VERSION`.

  **3b. Fungsi `reset()`** (kalau belum ada):

  ```js
  /** Kosongkan seluruh data presence (dipakai pengujian). */
  function reset() {
    try {
      fs.writeFileSync(FILE, JSON.stringify({
        version: SCHEMA_VERSION,
        entries: {},
        lastSeen: {}
      }, null, 2), 'utf8');
    } catch (err) {
      /* abaikan */
    }
  }
  ```

  **3c. Catat last-seen di `upsert()`.** Di dalam `upsert(entry, settings)`,
  setelah entri live berhasil disimpan, tambahkan:

  ```js
  // Simpan juga sebagai "titik terakhir yang diketahui".
  //
  // Alasan penyimpanan terpisah: entri live dihapus oleh TTL, tapi
  // lastSeen tidak — supaya posisi terakhir tetap bisa dilihat.
  // Untuk kasus darurat (pengguna hilang berjam-jam), admin masih bisa
  // melihat di mana posisinya terakhir kali tercatat.
  const key = role + ':' + refId;
  store.lastSeen[key] = {
    role: role,
    refId: refId,
    name: entry.name || (store.lastSeen[key] && store.lastSeen[key].name) || '',
    label: entry.label || (store.lastSeen[key] && store.lastSeen[key].label) || '',
    lat: Number(entry.lat),
    lng: Number(entry.lng),
    accuracy: entry.accuracy == null ? null : Number(entry.accuracy),
    at: entry.at || new Date().toISOString(),
    source: 'live'
  };
  ```

  **3d. Fungsi publik lastSeen.**

  ```js
  /**
   * Ambil titik terakhir yang diketahui untuk satu peserta.
   *
   * Tidak dipengaruhi TTL — ini justru tujuannya: menjawab "di mana dia
   * terakhir terlihat" walaupun sudah offline berjam-jam.
   *
   * @param {string} role 'admin' atau 'customer'
   * @param {string} refId id peserta
   * @returns {object|null} entri last-seen dengan `ageMin`, atau null
   */
  function lastSeen(role, refId) {
    const store = readStore();
    const key = role + ':' + refId;
    const e = store.lastSeen[key];
    if (!e || !geo.isValidLatLng(e.lat, e.lng)) return null;
    const at = e.at ? new Date(e.at).getTime() : 0;
    const ageMin = at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;
    return { ...e, ageMin };
  }

  /**
   * Semua titik terakhir yang diketahui (untuk admin).
   * @returns {Array<object>} daftar entri last-seen
   */
  function lastSeenAll() {
    const store = readStore();
    const out = [];
    Object.keys(store.lastSeen).forEach((k) => {
      const e = store.lastSeen[k];
      if (!e || !geo.isValidLatLng(e.lat, e.lng)) return;
      const at = e.at ? new Date(e.at).getTime() : 0;
      out.push({
        ...e,
        ageMin: at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null
      });
    });
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }
  ```

  Tambahkan `lastSeen,` `lastSeenAll,` `reset,` `SCHEMA_VERSION,` ke `module.exports`.

  > `geo` mungkin belum di-require di `presence.js`. Kalau belum:
  > `const geo = require('./geo');` di bagian atas.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

  Run: `node scripts/presence.test.js`
  Expected: semua suite lulus, termasuk 4 test baru.

- [ ] **Step 5: Jalankan suite HTTP presence**

  Run: `npm run test:e2e:presence`
  Expected: script lulus (alur admin <-> pelanggan).

- [ ] **Step 6: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 7: Commit**

  ```bash
  git add src/services/presence.js scripts/presence.test.js
  git commit -m "feat(presence): simpan titik terakhir yang diketahui secara persisten"
  ```

---

## Task 13: Model data grup/rombongan (roster)

**Files:**
- Create: `src/services/roster.js` (BARU)
- Modify: `src/seed.js` — tambah `tripGroups` ke data seed (bila belum ada)
- Test: `scripts/roster.test.js` (BARU)

**Interfaces:**
- Consumes: `db.read()`, `geo.isValidLatLng`.
- Produces (baru `src/services/roster.js`):
  - `groupsForBooking(data, booking)` → array `group` yang berisi booking tersebut.
  - `groupOf(data, groupId)` → objek group atau `null`.
  - `rosterOf(data, group)` → array peserta `{id, name, role, phone, email, bookingCode, packageName, departureDate, lat, lng, accuracy, at, ageMin, online}`.
  - `groupMembersOf(data, group)` → id peserta.
  - `groupsForCustomer(data, customerId)` → group yang diikuti pelanggan.
  - `groupIdForBooking(data, booking)` → id group atau `null`.

**Model data group (di `data/db.json`, array `tripGroups`):**

```json
{
  "id": "grp_ab12",
  "name": "Rombongan Sabesi — 12 Nov 2026",
  "bookingCodes": ["SYL-240501", "SYL-240512"],
  "meetingPoint": { "label": "Dermaga Waisai", "lat": -0.4644, "lng": 130.8924 },
  "radiusM": 5000,
  "createdAt": "2026-11-01T00:00:00.000Z"
}
```

**Kenapa perlu:** privasi presence sekarang memakai irisan **kode booking**. Dua orang
di kapal yang sama tapi punya kode booking berbeda **tidak saling terlihat**. Untuk
mendeteksi "terpisah dari rombongan", model ini diperlukan.

**Relationship:**

```
tripGroups (baru)           bookings (ada)              customers (ada)
  id                          code                       id
  bookingCodes []  <--------  code                       booking.customerId --> id
  meetingPoint
  radiusM
```

- [ ] **Step 1: Tulis test yang gagal**

  Create `scripts/roster.test.js`:

  ```js
  'use strict';

  /**
   * Uji model data rombongan (trip groups) & roster peserta.
   *
   * Jalankan: node scripts/roster.test.js
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
      {
        id: 'grp_a',
        name: 'Rombongan A',
        bookingCodes: ['SYL-1', 'SYL-2'],
        meetingPoint: { label: 'Dermaga Waisai', lat: -0.4644, lng: 130.8924 },
        radiusM: 5000
      },
      {
        id: 'grp_b',
        name: 'Rombongan B',
        bookingCodes: ['SYL-3'],
        meetingPoint: null,
        radiusM: 5000
      }
    ],
    bookings: [
      { id: 'b1', code: 'SYL-1', name: 'Budi', email: 'budi@x.com', phone: '0811', customerId: 'c1', packageName: 'Paket A', departureDate: '2026-11-12', participants: 2 },
      { id: 'b2', code: 'SYL-2', name: 'Sari', email: 'sari@x.com', phone: '0822', customerId: 'c2', packageName: 'Paket A', departureDate: '2026-11-12', participants: 2 },
      { id: 'b3', code: 'SYL-3', name: 'Andi', email: 'andi@x.com', phone: '0833', customerId: 'c3', packageName: 'Paket B', departureDate: '2026-11-20', participants: 1 }
    ],
    customers: [
      { id: 'c1', name: 'Budi', email: 'budi@x.com', phone: '0811' },
      { id: 'c2', name: 'Sari', email: 'sari@x.com', phone: '0822' },
      { id: 'c3', name: 'Andi', email: 'andi@x.com', phone: '0833' }
    ]
  };

  console.log('\n== Model rombongan ==');

  t('groupOf mengembalikan group berdasarkan id', () => {
    const g = roster.groupOf(DATA, 'grp_a');
    assert.ok(g);
    assert.strictEqual(g.name, 'Rombongan A');
    assert.strictEqual(roster.groupOf(DATA, 'tidak-ada'), null);
  });

  t('groupIdForBooking menemukan group dari kode booking', () => {
    assert.strictEqual(roster.groupIdForBooking(DATA, DATA.bookings[0]), 'grp_a');
    assert.strictEqual(roster.groupIdForBooking(DATA, DATA.bookings[2]), 'grp_b');
    assert.strictEqual(roster.groupIdForBooking(DATA, { code: 'SYL-X' }), null);
  });

  t('groupsForBooking mengembalikan semua group yang memuat booking', () => {
    const gs = roster.groupsForBooking(DATA, DATA.bookings[0]);
    assert.strictEqual(gs.length, 1);
    assert.strictEqual(gs[0].id, 'grp_a');
  });

  t('rosterOf mengembalikan peserta dari seluruh booking dalam group', () => {
    const g = roster.groupOf(DATA, 'grp_a');
    const r = roster.rosterOf(DATA, g);
    assert.strictEqual(r.length, 2);
    assert.deepStrictEqual(r.map((x) => x.name).sort(), ['Budi', 'Sari']);
  });

  t('peserta roster membawa data kontak untukGBR emergency', () => {
    const g = roster.groupOf(DATA, 'grp_a');
    const r = roster.rosterOf(DATA, g);
    const budi = r.find((x) => x.name === 'Budi');
    assert.strictEqual(budi.phone, '0811');
    assert.strictEqual(budi.bookingCode, 'SYL-1');
    assert.ok('email' in budi);
  });

  t('groupsForCustomer menemukan group yang diikuti pelanggan', () => {
    const gs = roster.groupsForCustomer(DATA, 'c1');
    assert.strictEqual(gs.length, 1);
    assert.strictEqual(gs[0].id, 'grp_a');
  });

  t('group tanpa titik kumpul tetap punya radius default', () => {
    const g = roster.groupOf(DATA, 'grp_b');
    assert.strictEqual(g.meetingPoint, null);
    assert.ok(roster.radiusM(g) >= 5000);
  });

  t('roster tanpa group menghasilkan array kosong, bukan error', () => {
    assert.deepStrictEqual(roster.rosterOf(DATA, null), []);
  });

  console.log('\n' + (fail === 0
    ? 'OK - ' + pass + ' pemeriksaan lulus'
    : fail + ' dari ' + (pass + fail) + ' pemeriksaan GAGAL'));
  process.exit(fail === 0 ? 0 : 1);
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Run: `node scripts/roster.test.js`
  Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Buat `src/services/roster.js`**

  ```js
  'use strict';

  /**
   * Model data rombongan (trip group) & roster peserta.
   *
   * MASALAH YANG DISELESAIKAN
   * -------------------------
   * Privasi lokasi presence memakai irisan KODE BOOKING: dua pelanggan
   * saling terlihat hanya bila punya kode booking yang sama. Padahal
   * satu kapal sering memuat beberapa booking (mis. 3 booking × 2 orang
   * = 6 orang dalam satu kapal). Akibatnya peserta satu rombongan tidak saling
   * melihat, sehingga kasus "terpisah dari rombongan" tidak bisa dideteksi.
   *
   * Model `tripGroups` menyatukan beberapa booking ke dalam satu
   * rombongan, sehingga:
   *  - privacy check bisa memakai group, bukan cuma kode booking,
   *  - admin bisa melihat seluruh peserta satu kapal,
   *  - titik kumpul (meeting point) bisa ditetapkan per rombongan.
   *
   * TIDAK ADA database — data disimpan sebagai array `tripGroups` di
   * data/db.json, konsisten dengan entity lain di repo ini.
   */

  const geo = require('./geo');

  /** Radius default titik kumpul (meter) bila group tidak menetapkan. */
  const DEFAULT_RADIUS_M = 5000;

  /**
   * Ambil group berdasarkan id.
   * @param {object} data isi db
   * @param {string} groupId id group
   * @returns {object|null} group atau null
   */
  function groupOf(data, groupId) {
    if (!groupId) return null;
    const list = (data && data.tripGroups) || [];
    return list.find((g) => g.id === groupId) || null;
  }

  /**
   * Semua group yang memuat booking tertentu.
   * @param {object} data isi db
   * @param {object} booking booking
   * @returns {Array<object>} daftar group
   */
  function groupsForBooking(data, booking) {
    if (!booking || !booking.code) return [];
    const list = (data && data.tripGroups) || [];
    return list.filter((g) => (g.bookingCodes || []).includes(booking.code));
  }

  /**
   * Id group pertama yang memuat booking (null bila tidak ada).
   * @param {object} data isi db
   * @param {object} booking booking
   * @returns {string|null} id group
   */
  function groupIdForBooking(data, booking) {
    const gs = groupsForBooking(data, booking);
    return gs.length ? gs[0].id : null;
  }

  /**
   * Semua group yang diikuti pelanggan tertentu.
   * @param {object} data isi db
   * @param {string} customerId id pelanggan
   * @returns {Array<object>} daftar group
   */
  function groupsForCustomer(data, customerId) {
    if (!customerId) return [];
    const list = (data && data.tripGroups) || [];
    const codes = ((data && data.bookings) || [])
      .filter((b) => b.customerId === customerId)
      .map((b) => b.code);
    return list.filter((g) => (g.bookingCodes || []).some((c) => codes.includes(c)));
  }

  /**
   * Radius titik kumpul group (meter).
   * @param {object} group group
   * @returns {number} radius dalam meter
   */
  function radiusM(group) {
    if (!group) return DEFAULT_RADIUS_M;
    const n = Number(group.radiusM);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M;
  }

  /**
   * Daftar peserta dalam satu group.
   *
   * Setiap peserta diambil dari booking di dalam group. Kalau satu booking
   * punya beberapa peserta (booking.participants > 1), hanya pemesan
   * utama yang tercatat — peserta tambahan tidak punya identitas sendiri
   * di model data sekarang.
   *
   * @param {object} data isi db
   * @param {object} group group
   * @param {object} [live] peta posisi live { 'role:refId': entry }
   * @param {object} [seen] peta last-seen { 'role:refId': entry }
   * @returns {Array<object>} daftar peserta
   */
  function rosterOf(data, group, live, seen) {
    if (!group) return [];
    const codes = group.bookingCodes || [];
    const bookings = (data && data.bookings) || [];
    const customers = (data && data.customers) || [];
    const liveMap = live || {};
    const seenMap = seen || {};
    const out = [];

    codes.forEach((code) => {
      const booking = bookings.find((b) => b.code === code);
      if (!booking) return;
      const customer = customers.find((c) => c.id === booking.customerId) || null;

      const key = customer ? 'customer:' + customer.id : 'booking:' + booking.id;
      const liveEntry = liveMap[key];
      const seenEntry = seenMap[key];

      const pos = liveEntry || seenEntry || null;
      const at = pos && pos.at ? new Date(pos.at).getTime() : 0;
      const ageMin = at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;

      out.push({
        id: customer ? customer.id : booking.id,
        bookingId: booking.id,
        bookingCode: booking.code,
        name: customer ? customer.name : booking.name,
        role: 'customer',
        phone: customer ? customer.phone : booking.phone,
        email: customer ? customer.email : booking.email,
        packageName: booking.packageName,
        departureDate: booking.departureDate,
        participants: booking.participants || 1,
        lat: pos ? Number(pos.lat) : null,
        lng: pos ? Number(pos.lng) : null,
        accuracy: pos ? (pos.accuracy == null ? null : Number(pos.accuracy)) : null,
        at: pos ? pos.at : null,
        ageMin: ageMin,
        online: Boolean(liveEntry),
        lastSeenOnly: !liveEntry && Boolean(seenEntry)
      });
    });

    return out;
  }

  /**
   * Id peserta dalam group.
   * @param {object} data isi db
   * @param {object} group group
   * @returns {Array<string>} daftar id peserta
   */
  function groupMembersOf(data, group) {
    return rosterOf(data, group).map((p) => p.id);
  }

  /**
   * Jarak peserta dari titik kumpul group (meter).
   * @param {object} group group
   * @param {object} participant peserta dari rosterOf
   * @returns {number|null} jarak dalam meter, atau null bila tidak bisa dihitung
   */
  function distanceToMeetingPoint(group, participant) {
    if (!group || !group.meetingPoint) return null;
    if (!participant || !geo.isValidLatLng(participant.lat, participant.lng)) return null;
    const d = geo.haversineMeters(
      participant.lat,
      participant.lng,
      group.meetingPoint.lat,
      group.meetingPoint.lng
    );
    return Number.isFinite(d) ? d : null;
  }

  module.exports = {
    DEFAULT_RADIUS_M,
    groupOf,
    groupsForBooking,
    groupIdForBooking,
    groupsForCustomer,
    radiusM,
    rosterOf,
    groupMembersOf,
    distanceToMeetingPoint
  };
  ```

- [ ] **Step 4: Tambahkan `tripGroups` ke seed**

  Di `src/seed.js`, pada fungsi seed, tambahkan array `tripGroups`. Letakkan
  setelah `const bookings = [...]` (dan **sebelum** `const customers`, karena
  `tripGroups` merujuk kode booking yang sudah ada).

  ```js
  // Rombongan (trip group).
  //
  // Satu kapal bisa memuat beberapa booking. `tripGroups` menyatukan
  // booking-booking itu supaya semua peserta kapal bisa saling melihat
  // posisi dan tidak saling terpisah tanpa terdeteksi.
  //
  // Kode booking di bawah HARUS benar-benar ada di array `bookings`
  // (lihat `const bookings` di atas): SYL-240501 dan SYL-240504.
  const tripGroups = [
    {
      id: 'grp_sabesi_nov',
      name: 'Rombongan Weh — 28 Nov 2026',
      bookingCodes: ['SYL-240504'],
      meetingPoint: {
        label: 'Titik Kumpul Weh',
        lat: -0.4719,
        lng: 130.7515
      },
      radiusM: 5000,
      createdAt: day(7)
    },
    {
      id: 'grp_sabesi_nov_12',
      name: 'Rombongan Sabesi — 12 Nov 2026',
      bookingCodes: ['SYL-240501'],
      meetingPoint: {
        label: 'Dermaga Sabesi',
        lat: -0.4719,
        lng: 130.7515
      },
      radiusM: 5000,
      createdAt: day(7)
    }
  ];
  ```

  > **PENTING — kode booking harus cocok.** `SYL-240504` (Ayu Lestari, 28 Nov 2026)
  > dan `SYL-240501` (Ayu Lestari, 12 Nov 2026) memang ada di seed. Tapi
  > keduanya pemesan yang sama (email `ayu.lestari@example.com`), jadi
  > **customerId-nya sama** — dua-"group" ini sebenarnya orang yang sama di
  > dua trip berbeda. Itu **memang benar secara data** (dua perjalanan
  > berbeda), dan justru menguji bahwa `groupsForCustomer` mengembalikan dua
  > group.
  >
  > Koordinat titik kumpul `-0.4719, 130.7515` diambil dari koordinat
  > destinations "Sabesi Island Escape" di seed — konsisten dengan data yang
  > sudah ada.
  >
  > Kalau admin ingin group yang benar-benar berisi beberapa peserta,
  > ia perlu menambah `tripGroups` lewat panel admin (Task 16). Seed hanya
  > memberi contoh struktur.

  Lalu tambahkan `tripGroups` ke objek return seed (sekitar baris 908):

  ```js
  return { users, destinations, packages, articles, bookings, messages, contacts, customers, reviews, tripGroups, broadcasts: [], settings, version: 1 };
  ```

  > **PENTING:** kode booking di seed harus benar-benar ada. Cek `const bookings`
  > di `src/seed.js` — kode yang dipakai adalah `SYL-240501`, `SYL-240512`, dst.
  > **Baca daftar kode booking yang sebenarnya** dan pakai yang ada. Kalau
  > tidak ada yang cocok, buat group dengan kode yang benar-benar ada.

  > **JUGA PENTING:** `src/db.js` `initIfEmpty` hanya menjalankan seed bila
  > `data.users` kosong. Installasi yang sudah punya data **tidak** akan
  > mendapat `tripGroups` otomatis. Buat skrip migrasi kecil
  > `scripts/migrate-trip-groups.js` yang menambahkan `tripGroups` ke db yang
  > sudah ada (idempoten). Jalankan sekali di server.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

  Run: `node scripts/roster.test.js`
  Expected: "OK - 8 pemeriksaan lulus".

- [ ] **Step 6: Daftarkan suite baru di runner**

  Di `scripts/wa-run-tests.js`, array `suites`, tambahkan `'roster.test.js'`
  setelah `'presence.test.js'`.

- [ ] **Step 7: Jalankan seluruh suite**

  Run: `npm test`
  Expected: "Semua suite lulus."

- [ ] **Step 8: Commit**

  ```bash
  git add src/services/roster.js src/seed.js scripts/roster.test.js scripts/wa-run-tests.js
  git commit -m "feat(roster): model data rombongan untuk deteksi peserta terpisah"
  ```

---
