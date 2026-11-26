'use strict';

/**
 * Modul Permission Lokasi untuk portal pelanggan.
 *
 * Menangani seluruh keadaan izin geolokasi browser secara terpusat:
 *   - tidak didukung (browser lama / desktop tanpa GPS)
 *   - konteks tidak aman (http:// — geolokasi diblokir browser)
 *   - izin sudah diberikan (granted)
 *   - izin ditolak (denied) — perlu instruksi cara mengaktifkan ulang
 *   - belum diminta (prompt) — tombol "Izinkan Lokasi"
 *
 * Semua halaman portal memakai modul ini agar perilakunya konsisten
 * dan pelanggan mendapat pesan yang jelas, bukan error generik.
 */
(function (global) {
  var MESSAGES = {
    unsupported:
      'Perangkat/browser Anda tidak mendukung GPS. Silakan gunakan ponsel atau browser yang lebih baru untuk fitur lokasi.',
    insecure:
      'Fitur lokasi hanya bisa dipakai pada koneksi aman (https://). Coba buka ulang situs lewat alamat https.',
    denied:
      'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini melalui pengaturan browser Anda, lalu muat ulang halaman ini.',
    prompt:
      'Izin lokasi belum diberikan. Tekan "Izinkan Lokasi" lalu pilih "Izinkan" pada dialog browser.',
    unavailable:
      'Lokasi tidak dapat dibaca saat ini. Pastikan GPS perangkat aktif dan area sinyal terbuka.',
    timeout: 'Pencarian lokasi terlalu lama. Coba lagi di area dengan sinyal GPS lebih baik.',
    success: 'Lokasi berhasil dibaca.'
  };

  function isSupported() {
    return !!(global.navigator && global.navigator.geolocation);
  }

  function isSecure() {
    // Browser memblokir geolokasi pada konteks tidak aman (kecuali localhost).
    if (global.isSecureContext !== undefined) return global.isSecureContext;
    var h = global.location && global.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }

  /**
   * Status izin saat ini tanpa memicu dialog.
   * @returns {Promise<{state: string, message: string, supported: boolean, secure: boolean}>}
   */
  function getState() {
    if (!isSupported()) {
      return Promise.resolve({
        state: 'unsupported',
        message: MESSAGES.unsupported,
        supported: false,
        secure: isSecure()
      });
    }
    if (!isSecure()) {
      return Promise.resolve({
        state: 'insecure',
        message: MESSAGES.insecure,
        supported: true,
        secure: false
      });
    }
    if (global.navigator.permissions && global.navigator.permissions.query) {
      return global.navigator
        .permissions.query({ name: 'geolocation' })
        .then(function (perm) {
          return { state: perm.state, message: MESSAGES[perm.state] || '', supported: true, secure: true, permission: perm };
        })
        .catch(function () {
          return { state: 'unknown', message: '', supported: true, secure: true };
        });
    }
    return Promise.resolve({ state: 'unknown', message: '', supported: true, secure: true });
  }

  /**
   * Meminta akses lokasi. Callback onError menerima kode error
   * ('denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure').
   */
  function request(onSuccess, onError) {
    if (!isSupported()) {
      if (onError) onError('unsupported', MESSAGES.unsupported);
      return;
    }
    if (!isSecure()) {
      if (onError) onError('insecure', MESSAGES.insecure);
      return;
    }
    global.navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (onSuccess) {
          onSuccess({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            at: new Date().toISOString()
          });
        }
      },
      function (err) {
        var code = 'unavailable';
        if (err && err.code === 1) code = 'denied';
        else if (err && err.code === 3) code = 'timeout';
        if (onError) onError(code, MESSAGES[code] || MESSAGES.unavailable);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  /**
   * Pantau perubahan izin (mis. pelanggan menyalakan lokasi dari
   * pengaturan browser lalu kembali ke tab).
   */
  function watch(onChange) {
    if (!global.navigator.permissions || !global.navigator.permissions.query) return null;
    try {
      var perm = global.navigator.permissions.query({ name: 'geolocation' });
      if (perm && perm.then) {
        perm.then(function (p) {
          p.onchange = function () {
            onChange(p.state);
          };
        });
      }
    } catch (err) {
      /* tidak didukung — abaikan */
    }
    return null;
  }

  global.LocationPermission = {
    MESSAGES: MESSAGES,
    isSupported: isSupported,
    isSecure: isSecure,
    getState: getState,
    request: request,
    watch: watch
  };
})(window);
