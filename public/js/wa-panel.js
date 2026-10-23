'use strict';
/**
 * wa-panel.js — Panel WhatsApp: polling status, refresh QR otomatis,
 * dan umpan balik visual (badge status + log koneksi).
 *
 * Polling dihentikan otomatis saat status sudah 'connected' (tidak ada
 * resource yang sia-sia) dan saat tab tidak terlihat.
 */
(function () {
  var POLL_MS = 3000;
  var badge = document.getElementById('waStateBadge');
  var stateText = document.getElementById('waStateText');
  var stateLabel = document.getElementById('waStateLabel');
  var updatedAt = document.getElementById('waUpdatedAt');
  var qrImage = document.getElementById('waQrImage');
  var qrPlaceholder = document.getElementById('waQrPlaceholder');
  var qrHint = document.getElementById('waQrHint');
  var qrRaw = document.getElementById('waQrRaw');
  var logEl = document.getElementById('waLog');
  var meEl = document.getElementById('waMe');
  var connectedAtEl = document.getElementById('waConnectedAt');

  if (!badge) return; // bukan halaman panel WhatsApp

  var timer = null;
  var lastState = badge.getAttribute('data-state') || '';

  var TONE = {
    connected: 'confirmed',
    error: 'cancelled',
    scanning: 'pending',
    connecting: 'pending',
    disconnected: 'pending',
    unavailable: 'cancelled'
  };

  function setState(state, label) {
    lastState = state;
    if (stateText) {
      stateText.textContent = label || state;
      stateText.setAttribute('data-state', state);
    }
    if (stateLabel) stateLabel.textContent = label || state;
    if (badge) {
      badge.setAttribute('data-state', state);
      badge.className = 'badge badge--' + (TONE[state] || 'pending');
    }
  }

  function renderQr(hasQr, rawValue) {
    if (!qrImage) return;
    if (hasQr) {
      // cache-buster supaya QR baru langsung tampil tanpa hard refresh
      qrImage.src = '/admin/whatsapp/qr.png?t=' + Date.now();
      qrImage.hidden = false;
      if (qrPlaceholder) qrPlaceholder.hidden = true;
      if (qrHint) {
        qrHint.textContent = 'Pindai kode di atas dengan WhatsApp → Perangkat tertaut → Tautkan perangkat.';
      }
    } else {
      qrImage.hidden = true;
      if (qrPlaceholder) {
        qrPlaceholder.hidden = false;
        var p = qrPlaceholder.querySelector('p');
        if (p) {
          p.textContent =
            lastState === 'unavailable'
              ? 'Modul WhatsApp Web belum terpasang.'
              : 'Belum ada QR aktif. Tekan "Sambung / Refresh QR".';
        }
        var sp = qrPlaceholder.querySelector('.wa-spinner');
        if (sp) sp.hidden = lastState === 'unavailable' || lastState === 'disconnected';
      }
    }
    if (qrRaw && rawValue !== undefined) qrRaw.textContent = rawValue || 'Belum ada QR aktif.';
  }

  function renderLog(items) {
    if (!logEl || !Array.isArray(items)) return;
    logEl.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'wa-log__empty';
      empty.textContent = 'Belum ada aktivitas koneksi.';
      logEl.appendChild(empty);
      return;
    }
    items.slice(0, 10).forEach(function (l) {
      var li = document.createElement('li');
      li.className = 'wa-log__item wa-log__item--' + (l.level || 'info');
      var time = document.createElement('span');
      time.className = 'wa-log__time';
      time.textContent = new Date(l.at).toLocaleTimeString('id-ID');
      var msg = document.createElement('span');
      msg.className = 'wa-log__msg';
      msg.textContent = l.message;
      li.appendChild(time);
      li.appendChild(msg);
      logEl.appendChild(li);
    });
  }

  function poll() {
    fetch('/admin/whatsapp/status', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setState(data.state, data.stateLabel);
        if (updatedAt) {
          updatedAt.textContent =
            'Diperbarui ' + new Date(data.updatedAt || Date.now()).toLocaleTimeString('id-ID');
        }
        if (meEl) meEl.textContent = data.me ? data.me.name || data.me.id : '—';
        if (connectedAtEl) {
          connectedAtEl.textContent = data.connectedAt
            ? new Date(data.connectedAt).toLocaleString('id-ID')
            : '—';
        }
        renderQr(Boolean(data.qr), data.qr);
        renderLog(data.log);
      })
      .catch(function () {
        // Jaringan sementara bermasalah — coba lagi pada tick berikutnya.
      });
  }

  function start() {
    stop();
    timer = setInterval(poll, POLL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Hentikan polling saat status sudah terhubung (hemat resource).
  var observer = new MutationObserver(function () {
    if (lastState === 'connected') stop();
  });
  observer.observe(badge, { attributes: true, attributeFilter: ['data-state'] });

  // Jangan polling saat tab tidak terlihat.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stop();
    } else if (lastState !== 'connected') {
      poll();
      start();
    }
  });

  // Muat status sekali di awal supaya tampilan langsung akurat.
  poll();
  if (lastState !== 'connected') start();
})();
