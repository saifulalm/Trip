'use strict';

/**
 * Sinkronisasi lokasi pelanggan: online langsung kirim, offline disimpan dulu.
 *
 * Dipasang di halaman detail booking lewat #locSync. Titik GPS masuk ke
 * IndexedDB (SytLocQueue) bila jaringan gagal, lalu dikirim ulang otomatis
 * saat event `online`, saat halaman dibuka kembali, atau lewat Background Sync
 * service worker (/sw.js) meski tab sudah ditutup.
 */
(function () {
  var root = document.getElementById('locSync');
  if (!root || !window.SytLocQueue) return;

  var bookingId = root.getAttribute('data-booking-id');
  var csrf = root.getAttribute('data-csrf') || '';
  var endpoint = '/api/akun/booking/' + encodeURIComponent(bookingId) + '/lokasi';
  var SYNC_TAG = 'syt-location-sync';
  var MIN_MOVE_M = 40;
  var MIN_INTERVAL_MS = 90 * 1000;

  var ui = {
    send: document.getElementById('locSendBtn'),
    watch: document.getElementById('locWatch'),
    dot: document.getElementById('locDot'),
    state: document.getElementById('locStateText'),
    meta: document.getElementById('locMeta'),
    queue: document.getElementById('locQueue')
  };

  var queue = window.SytLocQueue;
  var watchId = null;
  var lastSent = null;
  var flushing = false;

  /* ---------------------------------------------------------------- */
  /* Status                                                            */
  /* ---------------------------------------------------------------- */

  function setState(text, tone) {
    if (ui.state) ui.state.textContent = text;
    if (ui.dot) ui.dot.className = 'loc-sync__dot' + (tone ? ' is-' + tone : '');
  }

  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function setMeta(last, total) {
    if (!ui.meta) return;
    if (!last) {
      ui.meta.textContent = 'Belum ada pembaruan lokasi.';
      return;
    }
    ui.meta.innerHTML =
      'Lokasi terakhir: <strong>' +
      Number(last.lat).toFixed(5) + ', ' + Number(last.lng).toFixed(5) +
      '</strong> · ' + fmtTime(last.at) +
      (last.accuracy ? ' · akurasi ± ' + Math.round(last.accuracy) + ' m' : '') +
      (last.receivedAt ? ' · diterima server ' + fmtTime(last.receivedAt) : '') +
      (total ? '<br>Total pembaruan: ' + total : '');
  }

  function updateQueueLabel(pending) {
    if (!ui.queue) return;
    if (!pending) {
      ui.queue.hidden = true;
      ui.queue.textContent = '';
      return;
    }
    ui.queue.hidden = false;
    ui.queue.textContent =
      pending + ' titik tersimpan di perangkat, menunggu sinyal untuk dikirim.';
    if (navigator.onLine) setState('Mengirim ' + pending + ' titik tertunda…', 'pending');
  }

  function pendingForBooking(items) {
    return (items || []).filter(function (item) {
      // Titik tanpa bookingId berasal dari versi lama; anggap milik halaman ini.
      return !item.bookingId || item.bookingId === bookingId;
    });
  }

  function refreshQueue() {
    return queue
      .all()
      .then(function (items) {
        var n = pendingForBooking(items).length;
        updateQueueLabel(n);
        return n;
      })
      .catch(function () {
        return 0;
      });
  }

  /* ---------------------------------------------------------------- */
  /* Kirim                                                             */
  /* ---------------------------------------------------------------- */

  function post(item) {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': csrf
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        id: item.id,
        lat: item.lat,
        lng: item.lng,
        accuracy: item.accuracy || null,
        at: item.at,
        source: item.source || 'manual',
        offline: item.offline === true
      })
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { status: res.status, data: data };
        });
    });
  }

  function flush() {
    if (flushing) return Promise.resolve();
    if (!navigator.onLine) {
      setState('Offline — lokasi disimpan, dikirim saat sinyal kembali.', 'offline');
      return refreshQueue();
    }
    flushing = true;
    setState('Memeriksa antrean lokasi…', 'busy');

    return queue
      .all()
      .then(function (all) {
        var items = pendingForBooking(all);
        if (!items.length) {
          setState('Tersambung. Belum ada titik tertunda.', 'ok');
          return null;
        }
        var chain = Promise.resolve();
        var sent = 0;
        var stopReason = '';
        items.forEach(function (item) {
          chain = chain.then(function () {
            if (stopReason) return;
            if (!navigator.onLine) {
              stopReason = 'offline';
              return;
            }
            return post(item).then(function (result) {
              if (result.status >= 200 && result.status < 300) {
                sent += 1;
                if (result.data.lastLocation) lastSent = result.data.lastLocation;
                return queue.remove(item.id);
              }
              // 401/403 = sesi/CSRF kedaluwarsa: SIMPAN titik, kirim lagi setelah login.
              if (result.status === 401 || result.status === 403) {
                stopReason = 'auth';
                return;
              }
              // 400/404/409 = tidak akan pernah berhasil; buang agar antrean tidak macet.
              if (result.status === 400 || result.status === 404 || result.status === 409) {
                return queue.remove(item.id);
              }
              stopReason = 'stop';
            }).catch(function () {
              stopReason = 'offline';
            });
          });
        });
        return chain.then(function () {
          if (stopReason === 'auth') {
            setState('Sesi berakhir — masuk lagi untuk mengirim titik tertunda.', 'error');
          } else if (stopReason === 'offline') {
            setState('Koneksi terputus — sisa titik tetap tersimpan.', 'offline');
          } else if (stopReason === 'stop') {
            setState('Server sibuk — antrean dicoba lagi nanti.', 'warn');
          }
          if (lastSent) setMeta(lastSent, null);
          return sent;
        });
      })
      .then(function (sent) {
        if (typeof sent === 'number' && sent > 0) {
          setState(sent + ' titik lokasi terkirim.', 'ok');
        }
        return refreshQueue();
      })
      .catch(function () {
        setState('Gagal mengirim antrean. Akan dicoba lagi.', 'warn');
      })
      .then(function () {
        flushing = false;
      });
  }

  /** Simpan titik: coba kirim sekarang, kalau gagal masuk antrean. */
  function record(pos, source) {
    var coords = pos.coords || pos;
    var item = {
      id: 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      bookingId: bookingId,
      lat: Number(coords.latitude),
      lng: Number(coords.longitude),
      accuracy: Math.round(coords.accuracy || 0) || null,
      at: new Date().toISOString(),
      source: source || 'manual',
      offline: false
    };
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
      setState('Koordinat GPS tidak valid.', 'error');
      return Promise.resolve();
    }
    lastSent = item;

    if (!navigator.onLine) {
      item.offline = true;
      setState('Tidak ada sinyal — titik disimpan di perangkat.', 'offline');
      return queue
        .add(item)
        .then(refreshQueue)
        .then(function () {
          registerBackgroundSync();
        });
    }

    return post(item).then(function (result) {
      if (result.status >= 200 && result.status < 300) {
        setState('Lokasi terkirim ' + fmtTime(item.at) + '.', 'live');
        setMeta(result.data.lastLocation || item, result.data.totalUpdates);
        return refreshQueue();
      }
      if (result.status === 401 || result.status === 403) {
        setState('Sesi berakhir. Titik disimpan; masuk lagi untuk mengirim.', 'error');
        item.offline = true;
        return queue.add(item).then(refreshQueue).then(registerBackgroundSync);
      }
      if (result.status >= 400 && result.status < 500) {
        setState(result.data.error || 'Lokasi ditolak server.', 'error');
        return;
      }
      item.offline = true;
      return queue.add(item).then(refreshQueue).then(registerBackgroundSync);
    }).catch(function () {
      item.offline = true;
      setState('Jaringan gagal — titik disimpan dan dikirim otomatis.', 'offline');
      return queue.add(item).then(refreshQueue).then(registerBackgroundSync);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Background Sync                                                   */
  /* ---------------------------------------------------------------- */

  function registerBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.sync.register(SYNC_TAG);
      })
      .catch(function () {
        /* browser tanpa Background Sync: flush saat online tetap jalan */
      });
  }

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(function () {
        return queue.setMeta('config', { endpoint: endpoint, csrf: csrf, bookingId: bookingId });
      })
      .catch(function () {
        /* SW opsional; halaman tetap menyimpan antrean sendiri */
      });
  }

  /* ---------------------------------------------------------------- */
  /* Pelacakan otomatis                                               */
  /* ---------------------------------------------------------------- */

  function distanceM(a, b) {
    if (!a || !b) return Infinity;
    var R = 6371000;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function onPosition(pos) {
    var point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    var moved = distanceM(lastSent, point);
    var old = !lastSent || !lastSent.at || Date.now() - new Date(lastSent.at).getTime() > MIN_INTERVAL_MS;
    if (moved < MIN_MOVE_M && !old) return;
    record(pos, 'auto');
  }

  function startWatch() {
    if (!navigator.geolocation) {
      setState('Perangkat tidak mendukung GPS.', 'error');
      if (ui.watch) ui.watch.checked = false;
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      onPosition,
      function (err) {
        setState(
          err.code === 1 ? 'Izin lokasi ditolak.' : 'GPS belum mendapat titik. Tetap mencoba…',
          'warn'
        );
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 }
    );
    setState('Berbagi lokasi otomatis aktif (setiap ± 90 detik / 40 m).', 'live');
    try {
      localStorage.setItem('syt_loc_watch_' + bookingId, '1');
    } catch (e) {}
  }

  function stopWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setState('Berbagi otomatis dimatikan.', 'ok');
    try {
      localStorage.removeItem('syt_loc_watch_' + bookingId);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- */
  /* Binding                                                           */
  /* ---------------------------------------------------------------- */

  if (ui.send) {
    ui.send.addEventListener('click', function () {
      if (!navigator.geolocation) {
        setState('Perangkat tidak mendukung GPS.', 'error');
        return;
      }
      ui.send.disabled = true;
      setState('Membaca GPS…', 'busy');
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          ui.send.disabled = false;
          record(pos, 'manual');
        },
        function (err) {
          ui.send.disabled = false;
          setState(
            err.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lalu coba lagi.' : 'Gagal membaca GPS. Coba di tempat terbuka.',
            'error'
          );
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  if (ui.watch) {
    ui.watch.addEventListener('change', function () {
      if (ui.watch.checked) startWatch();
      else stopWatch();
    });
  }

  window.addEventListener('online', function () {
    setState('Sinyal kembali — mengirim titik tertunda…', 'pending');
    flush();
  });
  window.addEventListener('offline', function () {
    setState('Offline — lokasi baru disimpan di perangkat.', 'offline');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && navigator.onLine) flush();
  });

  /* ---------------------------------------------------------------- */
  /* Mulai                                                             */
  /* ---------------------------------------------------------------- */

  setupServiceWorker();
  refreshQueue().then(function (pending) {
    if (!navigator.onLine) {
      setState('Offline — lokasi baru disimpan di perangkat.', 'offline');
      return;
    }
    flush().then(function () {
      if (!pending && !lastSent) setState('Tersambung. Siap mengirim lokasi.', 'ok');
    });
  });

  // Muat status terakhir dari server (sumber kebenaran lintas perangkat).
  fetch(endpoint, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (data && data.lastLocation) setMeta(data.lastLocation, data.totalUpdates);
    })
    .catch(function () {});

  // Lanjutkan mode berbagi otomatis bila sebelumnya diaktifkan di perangkat ini.
  try {
    if (localStorage.getItem('syt_loc_watch_' + bookingId) === '1') {
      if (ui.watch) ui.watch.checked = true;
      startWatch();
    }
  } catch (e) {}
})();
