'use strict';
/**
 * toast.js — notifikasi ringan (gaya Sonner) tanpa dependensi eksternal.
 * Dipakai untuk pesan error / sukses dari fetch dan validasi form.
 *
 *(window.showToast('Pesan', 'success' | 'error' | 'info' | 'warn'))
 */
(function () {
  var ICONS = {
    success: '✓',
    error: '✕',
    warn: '!',
    info: 'i'
  };

  function stack() {
    var el = document.querySelector('.toast-stack');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast-stack';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  function showToast(message, type, duration) {
    if (!message) return null;
    var kind = ICONS[type] ? type : 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + kind;

    var icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.textContent = ICONS[kind];

    var msg = document.createElement('span');
    msg.className = 'toast__msg';
    msg.textContent = String(message);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Tutup notifikasi');
    close.textContent = '×';
    close.addEventListener('click', function () { dismiss(); });

    toast.appendChild(icon);
    toast.appendChild(msg);
    toast.appendChild(close);
    stack().appendChild(toast);

    var timer = setTimeout(dismiss, duration || (kind === 'error' ? 7000 : 4000));

    function dismiss() {
      clearTimeout(timer);
      if (!toast.parentNode) return;
      toast.classList.add('is-leaving');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 240);
    }

    return { dismiss: dismiss };
  }

  window.showToast = showToast;
})();
