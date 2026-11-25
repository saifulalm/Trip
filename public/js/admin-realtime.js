'use strict';

/**
 * admin-realtime.js — klien realtime untuk panel admin.
 *
 * Berbeda dari `public/js/presence.js` (yang khusus untuk berbagi lokasi),
 * modul ini dipakai halaman marketing admin: Blast, Kontak, WhatsApp.
 *
 * FITUR
 * -----
 * 1. Membuka `EventSource` ke `/admin/marketing/stream` (SSE).
 * 2. Menampilkan indikator status koneksi (live / reconnecting / offline).
 * 3. Memperbarui angka & badge progres blast secara langsung.
 * 4. Memperbarui jumlah kontak, kontak siap blast, dan status perangkat.
 * 5. Fallback polling bila EventSource tidak tersedia (browser sangat lama).
 *
 * Kontrak markup: elemen ditandai dengan atribut `data-rt-*`.
 *   data-rt-status    → indikator koneksi (elemen dengan .a-live)
 *   data-rt-blast-bar → bilah progres blast
 *   data-rt-blast-sent / -skipped / -failed / -total → angka
 *   data-rt-blast-state → badge status blast
 *   data-rt-contacts / -marketable → angka kontak
 *   data-rt-device → badge perangkat WhatsApp
 *   data-rt-quiet → label jam tenang
 *   data-rt-inbound → jumlah pesan masuk
 *
 * Semua elemen bersifat opsional — modul aman dipakai di halaman mana pun.
 */

(function () {
  'use strict';

  var STREAM_URL = '/admin/marketing/stream';
  var STATE_URL = '/admin/marketing/state';

  /** Koneksi SSE aktif (null bila belum ada / sudah ditutup). */
  var source = null;
  /** Timer fallback polling (dipakai hanya bila SSE gagal). */
  var pollTimer = null;
  /** Hitung kegagalan berturut-turut — dipakai untuk memutuskan fallback. */
  var failures = 0;

  /**
   * Ambil elemen yang ditandai atribut tertentu.
   * @param {string} attr nama atribut
   * @returns {NodeList} daftar elemen
   */
  function all(attr) {
    return document.querySelectorAll('[' + attr + ']');
  }

  /**
   * Perbarui teks konten sebuah elemen.
   * @param {string} attr atribut penanda
   * @param {string|number} value nilai baru
   */
  function setText(attr, value) {
    var nodes = all(attr);
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = String(value);
    }
  }

  /**
   * Tambah / hapus kelas pada sebuah elemen.
   * @param {string} attr atribut penanda
   * @param {string} cls nama kelas
   * @param {boolean} on true = tambahkan
   */
  function toggleClass(attr, cls, on) {
    var nodes = all(attr);
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].classList.toggle(cls, !!on);
    }
  }

  /**
   * Setel status indikator koneksi realtime.
   * @param {string} mode 'live' | 'connecting' | 'offline'
   * @param {string} [label] teks yang ditampilkan
   */
  function setConnection(mode, label) {
    var nodes = all('data-rt-status');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      el.classList.remove('is-live', 'is-connecting', 'is-offline');
      el.classList.add('is-' + mode);
      var text = el.querySelector('[data-rt-status-text]');
      if (text) text.textContent = label || defaultLabel(mode);
      el.setAttribute('data-state', mode);
      el.setAttribute('aria-label', defaultLabel(mode));
    }
  }

  /**
   * Label bawaan untuk tiap mode koneksi.
   * @param {string} mode mode koneksi
   * @returns {string} label
   */
  function defaultLabel(mode) {
    if (mode === 'live') return 'Realtime aktif';
    if (mode === 'connecting') return 'Menyambung…';
    return 'Koneksi terputus';
  }

  /**
   * Render snapshot state ke DOM.
   * @param {object} state snapshot dari server
   */
  function renderState(state) {
    if (!state || typeof state !== 'object') return;

    if (typeof state.contacts === 'number') setText('data-rt-contacts', state.contacts);
    if (typeof state.marketable === 'number') setText('data-rt-marketable', state.marketable);
    if (typeof state.inbound === 'number') setText('data-rt-inbound', state.inbound);

    // Jam tenang: tampilkan label dari server (sumber kebenaran tunggal).
    if (state.quietLabel) {
      setText('data-rt-quiet', state.quietLabel);
      toggleClass('data-rt-quiet', 'is-on', !!state.quietHour);
    }

    // Perangkat WhatsApp.
    if (typeof state.deviceReady === 'boolean') {
      toggleClass('data-rt-device', 'is-ready', state.deviceReady);
      toggleClass('data-rt-device', 'is-off', !state.deviceReady);
      var devNodes = all('data-rt-device');
      for (var d = 0; d < devNodes.length; d += 1) {
        var txt = devNodes[d].querySelector('[data-rt-device-text]');
        if (txt) txt.textContent = state.deviceReady ? 'Terhubung' : 'Belum terhubung';
      }
    }

    // Antrean worker.
    if (state.worker && typeof state.worker.pending === 'number') {
      setText('data-rt-pending', state.worker.pending);
    }

    // Progres blast.
    var blast = state.blast;
    if (!blast) {
      toggleClass('data-rt-blast-card', 'is-empty', true);
      setText('data-rt-blast-state', 'Tidak ada blast berjalan');
      setText('data-rt-blast-sent', 0);
      setText('data-rt-blast-skipped', 0);
      setText('data-rt-blast-failed', 0);
      setText('data-rt-blast-total', 0);
      setText('data-rt-blast-percent', 0);
      var bar = all('data-rt-blast-bar');
      for (var b = 0; b < bar.length; b += 1) bar[b].style.width = '0%';
      return;
    }

    toggleClass('data-rt-blast-card', 'is-empty', false);
    setText('data-rt-blast-sent', blast.sent || 0);
    setText('data-rt-blast-skipped', blast.skipped || 0);
    setText('data-rt-blast-failed', blast.failed || 0);
    setText('data-rt-blast-total', blast.total || 0);

    var percent = blast.total ? Math.round(((blast.sent || 0) / blast.total) * 100) : 0;
    setText('data-rt-blast-percent', percent);
    var bars = all('data-rt-blast-bar');
    for (var i = 0; i < bars.length; i += 1) bars[i].style.width = percent + '%';

    var stateText = blast.pausedReason
      ? blast.pausedReason
      : (blast.dryRun ? 'Mode uji' : (blast.status || 'berjalan'));
    setText('data-rt-blast-state', stateText);

    // Badge status blast: warna mengikuti status.
    var stateNodes = all('data-rt-blast-state');
    for (var s = 0; s < stateNodes.length; s += 1) {
      var node = stateNodes[s];
      node.classList.remove('is-queued', 'is-running', 'is-done', 'is-paused');
      if (blast.pausedReason) node.classList.add('is-paused');
      else if (blast.status === 'running') node.classList.add('is-running');
      else if (blast.status === 'done') node.classList.add('is-done');
      else node.classList.add('is-queued');
    }
  }

  /**
   * Ambil snapshot via HTTP (fallback).
   */
  function pollState() {
    fetch(STATE_URL, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) renderState(d.state);
      })
      .catch(function () { /* abaikan — coba lagi nanti */ });
  }

  /**
   * Mulai polling fallback.
   */
  function startPolling() {
    if (pollTimer) return;
    pollState();
    pollTimer = window.setInterval(pollState, 5000);
  }

  /**
   * Hentikan polling fallback.
   */
  function stopPolling() {
    if (!pollTimer) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /**
   * Sambungkan EventSource.
   */
  function connect() {
    if (typeof window.EventSource !== 'function') {
      // Browser lama tanpa SSE → pakai polling sepenuhnya.
      setConnection('offline', 'Realtime tidak didukung — memakai polling');
      startPolling();
      return;
    }

    setConnection('connecting');

    try {
      source = new window.EventSource(STREAM_URL);
    } catch (err) {
      setConnection('offline');
      startPolling();
      return;
    }

    source.addEventListener('hello', function () {
      failures = 0;
      stopPolling();
      setConnection('live');
    });

    source.addEventListener('state', function (e) {
      failures = 0;
      setConnection('live');
      try {
        renderState(JSON.parse(e.data));
      } catch (err) { /* abaikan */ }
    });

    // Event per-jenis (blast, contact, gateway, inbound) — dipakai untuk
    // notifikasi ringan (mis. bunyi / sorotan) oleh halaman tertentu.
    ['blast', 'contact', 'gateway', 'inbound'].forEach(function (name) {
      source.addEventListener(name, function (e) {
        var detail = { type: name };
        try { detail.payload = JSON.parse(e.data); } catch (err) { /* abaikan */ }
        document.dispatchEvent(new CustomEvent('admin:realtime', { detail: detail }));
      });
    });

    source.onerror = function () {
      failures += 1;
      // EventSource otomatis menyambung ulang sendiri. Kita hanya perlu
      // memberi tahu UI dan menyiapkan polling sebagai jaring pengaman.
      setConnection('connecting', 'Menyambung ulang…');
      if (failures >= 3) startPolling();
    };
  }

  /**
   * Putuskan koneksi (dipakai saat halaman leaving).
   */
  function disconnect() {
    if (source) {
      source.close();
      source = null;
    }
    stopPolling();
  }

  // Mulai otomatis bila ada elemen penanda realtime di halaman.
  if (all('data-rt-status').length || all('data-rt-blast-bar').length || all('data-rt-contacts').length) {
    connect();
  }

  // Expose API untuk halaman yang butuh kontrol manual.
  window.SylAdminRealtime = {
    connect: connect,
    disconnect: disconnect,
    renderState: renderState,
    setConnection: setConnection
  };
})();
