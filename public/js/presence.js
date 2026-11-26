'use strict';

/**
 * Modul presence sisi klien — berbagi posisi langsung dengan tim/admin.
 *
 * FITUR
 * -----
 * 1. Ping berkala (default 20 detik) selama tab aktif & lokasi disetujui.
 * 2. SSE (`/api/presence/stream`) untuk pembaruan real-time saat peer berubah.
 * 3. MODE OFFLINE:
 *    - Posisi terakhir + snapshot peer disimpan di `localStorage`.
 *    - Saat jaringan mati, ping masuk antrean (`syl.presence.queue`).
 *    - Snapshot peer tetap ditampilkan dengan penanda "offline — data terakhir".
 *    - Saat jaringan kembali, antrean dikirim ulang.
 * 4. Indikator status: online / offline / error / dimatikan.
 *
 * PEMAKAIAN
 * ---------
 * ```html
 * <script src="/js/presence.js"></script>
 * <script>
 *   SylPresence.init({ csrf: '<%= csrfToken %>', el: '#presencePanel' });
 * </script>
 * ```
 */

(function (global) {
  var API = '/api/presence';
  var LS_SELF = 'syl.presence.self';
  var LS_PEERS = 'syl.presence.peers';
  var LS_QUEUE = 'syl.presence.queue';

  /** Jarak minimal (meter) agar posisi dianggap berubah & worth ping. */
  var MOVE_THRESHOLD_M = 15;

  /** Selang ping berkala (ms). */
  var PING_INTERVAL_MS = 20000;

  var state = {
    enabled: true,
    online: true,
    started: false,
    sharing: false,
    lastError: '',
    self: null,
    peers: [],
    ttlSec: 300,
    role: 'customer'
  };

  var listeners = [];
  var timer = null;
  var watchId = null;
  var es = null;
  var lastSent = null;
  var csrf = '';
  var rootEl = null;

  /* ---------------------------------------------------------------- */
  /* Penyimpanan lokal (offline)                                       */
  /* ---------------------------------------------------------------- */

  function lsGet(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Utilitas                                                          */
  /* ---------------------------------------------------------------- */

  function emit() {
    var snapshot = {
      enabled: state.enabled,
      online: state.online,
      sharing: state.sharing,
      lastError: state.lastError,
      self: state.self,
      peers: state.peers.slice(),
      role: state.role,
      ttlSec: state.ttlSec
    };
    listeners.forEach(function (fn) {
      try {
        fn(snapshot);
      } catch (e) {
        /* abaikan error render */
      }
    });
  }

  function on(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return api;
  }

  /** Jarak dua titik (meter) — formula haversine ringkas. */
  function distanceMeters(a, b) {
    if (!a || !b) return NaN;
    var R = 6371008.8;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var la1 = toRad(a.lat);
    var la2 = toRad(b.lat);
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
  }

  function formatDistance(m) {
    if (!isFinite(m) || m < 0) return '-';
    if (m < 1000) return Math.round(m) + ' m';
    var km = m / 1000;
    if (km < 100) return km.toFixed(1).replace('.', ',') + ' km';
    return Math.round(km) + ' km';
  }

  /* ---------------------------------------------------------------- */
  /* Jaringan                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Pasang marker peer di peta.
   *
   * Peta (Leaflet) dimuat setelah modul presence, jadi SylMap belum tentu
   * tersedia saat state pertama diterima. Bila belum ada, tunggu event
   * 'load' lalu pasang ulang.
   *
   * @param {object[]} peers daftar peer
   */
  function paintPeers(peers) {
    if (window.SylMap && window.SylMap.setPeers) {
      window.SylMap.setPeers(peers || []);
      return true;
    }
    window.addEventListener('load', function () {
      if (window.SylMap && window.SylMap.setPeers) {
        window.SylMap.setPeers(peers || []);
      }
    }, { once: true });
    return false;
  }

  /** Ambil state server (posisi saya + daftar peer).
   * @returns {Promise<object|null>}
   */
  function fetchState() {
    return fetch(API + '/state', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.enabled = data.enabled !== false;
        state.ttlSec = data.ttlSec || state.ttlSec;
        state.role = (data.me && data.me.role) || state.role;
        state.self = data.me || null;
        state.peers = Array.isArray(data.peers) ? data.peers : [];
        state.online = true;
        state.lastError = '';
        // Simpan snapshot supaya tetap tampil saat offline.
        lsSet(LS_SELF, state.self);
        lsSet(LS_PEERS, state.peers);
        emit();
        flushQueue();
        return data;
      })
      .catch(function (err) {
        state.online = false;
        state.lastError = 'Tidak bisa menghubungi server. Mode offline: memakai data terakhir.';
        loadCached();
        emit();
        return null;
      });
  }

  /** Muat snapshot offline dari localStorage. */
  function loadCached() {
    var self = lsGet(LS_SELF, null);
    var peers = lsGet(LS_PEERS, []);
    if (self) state.self = self;
    if (Array.isArray(peers)) {
      state.peers = peers.map(function (p) {
        return Object.assign({}, p, { stale: true });
      });
    }
  }

  /**
   * Kirim posisi ke server. Bila gagal (offline), masukkan ke antrean.
   * @param {object} p {lat,lng,accuracy}
   */
  function ping(p) {
    if (!state.enabled) return Promise.resolve(false);
    var payload = {
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy === undefined ? null : p.accuracy
    };
    return fetch(API + '/ping', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf
      },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        state.online = true;
        state.lastError = '';
        lastSent = { lat: p.lat, lng: p.lng, at: Date.now() };
        lsSet(LS_SELF, {
          role: state.role,
          refId: state.self ? state.self.refId : null,
          name: state.self ? state.self.name : '',
          lat: p.lat,
          lng: p.lng,
          accuracy: payload.accuracy,
          at: new Date().toISOString()
        });
        emit();
        return true;
      })
      .catch(function () {
        state.online = false;
        state.lastError = 'Sinyal hilang. Posisi disimpan lokal dan akan dikirim saat koneksi kembali.';
        enqueue(payload);
        emit();
        return false;
      });
  }

  /** Masukkan payload ke antrean offline (maks 50 entri). */
  function enqueue(payload) {
    var q = lsGet(LS_QUEUE, []);
    if (!Array.isArray(q)) q = [];
    q.push(payload);
    while (q.length > 50) q.shift();
    lsSet(LS_QUEUE, q);
  }

  /** Kirim ulang antrean offline (paling baru dulu). */
  function flushQueue() {
    var q = lsGet(LS_QUEUE, []);
    if (!Array.isArray(q) || !q.length) return;
    var last = q[q.length - 1];
    lsSet(LS_QUEUE, []);
    ping(last);
  }

  /* ---------------------------------------------------------------- */
  /* SSE                                                                */
  /* ---------------------------------------------------------------- */

  /** Hubungkan stream perubahan presence. */
  function connectStream() {
    if (es || typeof global.EventSource === 'undefined') return;
    try {
      es = new global.EventSource(API + '/stream', { withCredentials: true });
    } catch (e) {
      return;
    }
    es.addEventListener('change', function () {
      // Muat ulang state penuh (hanya pada perubahan, bukan tiap detik).
      fetchState();
    });
    es.addEventListener('error', function () {
      // EventSource otomatis mencoba menyambung ulang.
      state.online = false;
      emit();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Geolokasi                                                         */
  /* ---------------------------------------------------------------- */

  /** Ambil posisi sekali lalu kirim. */
  function readAndPing() {
    if (!global.navigator || !global.navigator.geolocation) return Promise.resolve(false);
    return new Promise(function (resolve) {
      global.navigator.geolocation.getCurrentPosition(
        function (pos) {
          var p = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          // Kirim hanya bila posisi benar-benar berubah (hemat kuota & I/O).
          var moved = !lastSent || distanceMeters(lastSent, p) >= MOVE_THRESHOLD_M;
          if (moved) {
            ping(p).then(resolve);
          } else {
            resolve(true);
          }
        },
        function () {
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
      );
    });
  }

  /** Mulai peng.watchPosition (agar posisi live akurat). */
  function startWatch() {
    if (watchId !== null || !global.navigator || !global.navigator.geolocation) return;
    try {
      watchId = global.navigator.geolocation.watchPosition(
        function (pos) {
          var p = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          var moved = !lastSent || distanceMeters(lastSent, p) >= MOVE_THRESHOLD_M;
          if (moved) ping(p);
        },
        function () {
          /* diabaikan — mode offline ditangani oleh ping berkala */
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
      );
    } catch (e) {
      /* browser lama — andalkan ping berkala */
    }
  }

  /* ---------------------------------------------------------------- */
  /* API publik                                                         */
  /* ---------------------------------------------------------------- */

  var api = {
    state: state,

    /**
     * Inisialisasi modul presence.
     * @param {object} opts {csrf, el, auto}
     */
    init: function (opts) {
      opts = opts || {};
      csrf = opts.csrf || '';
      rootEl = opts.el ? document.querySelector(opts.el) : null;

      fetchState().then(function (data) {
        if (!data || data.enabled === false) return;
        connectStream();
        startWatch();
        readAndPing();
        if (timer) clearInterval(timer);
        timer = setInterval(function () {
          readAndPing();
        }, PING_INTERVAL_MS);
        state.started = true;
        emit();
      });

      // Deteksi kembali ke online → kirim antrean & muat state.
      global.addEventListener('online', function () {
        state.online = true;
        fetchState().then(function () {
          flushQueue();
        });
      });
      global.addEventListener('offline', function () {
        state.online = false;
        state.lastError = 'Anda sedang offline. Posisi disimpan lokal dan dikirim otomatis saat online.';
        loadCached();
        emit();
      });

      if (opts.auto) api.share();
      return api;
    },

    /** Mulai membagikan lokasi (dipanggil setelah izin geolokasi diberikan). */
    share: function () {
      state.sharing = true;
      startWatch();
      readAndPing();
      emit();
      return api;
    },

    /** Berhenti membagikan lokasi (hapus dari server). */
    stop: function () {
      state.sharing = false;
      if (watchId !== null && global.navigator && global.navigator.geolocation) {
        try {
          global.navigator.geolocation.clearWatch(watchId);
        } catch (e) { /* abaikan */ }
        watchId = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      fetch(API + '/stop', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrf }
      }).catch(function () { /* abaikan */ });
      emit();
      return api;
    },

    /** Muat ulang state (manual refresh). */
    refresh: function () {
      return fetchState();
    },

    on: on,
    formatDistance: formatDistance,
    distanceMeters: distanceMeters,
    api: api
  };

  global.SylPresence = api;
})(window);
