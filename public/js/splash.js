'use strict';

/**
 * Splash screen — pembuka website.
 *
 * Aturan:
 *  - Splash tampil **sekali per sesi browser** (sessionStorage).
 *    Muat ulang halaman (F5) atau berpindah halaman TIDAK memunculkan
 *    splash lagi selama sesi yang sama masih hidup.
 *  - Elemen dirender dengan atribut `hidden` di server (anti-flicker).
 *    Script ini yang melepas `hidden` hanya bila ini sesi pertama.
 *  - Setelah animasi selesai, tombol "Masuk" aktif; klik menutup splash.
 *  - Tombol "Lewati" (ikon) langsung menutup splash.
 *  - Splash menutup otomatis setelah `AUTO_CLOSE_MS` supaya pengunjung
 *    tidak terjebak (tombol "Masuk" tetap bisa dipakai lebih dulu).
 *  - Bila JS dimatikan, splash tidak boleh menutup situs → atribut
 *    `hidden` tidak pernah dilepas, jadi situs langsung tampil utuh.
 */

(function () {
  var splash = document.getElementById('splash');
  if (!splash) return;

  /* Kunci sessionStorage: bisa diblokir browser (mode privat / iframe
    Origin Trial). Semua akses dibungkus try/catch agar tidak fatal. */
  var STORAGE_KEY = 'syl.splash.seen.v1';
  var AUTO_CLOSE_MS = 3500; // tutup otomatis setelah animasi selesai

  /** Baca penanda "sudah pernah tampil" dari sessionStorage. */
  function alreadySeen() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  /** Tandai bahwa splash sudah pernah tampil pada sesi ini. */
  function markSeen() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, '1');
    } catch (err) {
      /* Diabaikan: bila storage diblokir, splash akan tampil lagi
         pada muat berikutnya — perilaku aman (tidak merusak situs). */
    }
  }

  // Sudah pernah tampil pada sesi ini → sembunyikan splash sepenuhnya
  // dan JANGAN sentuh scroll lock. Situs langsung normal.
  if (alreadySeen()) {
    splash.hidden = true;
    splash.setAttribute('aria-hidden', 'true');
    return;
  }

  // Sesi baru → tampilkan splash.
  splash.hidden = false;
  splash.removeAttribute('aria-hidden');
  markSeen();

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wordEl = splash.querySelector('[data-splash-word]');
  var barEl = splash.querySelector('[data-splash-bar]');
  var statusEl = splash.querySelector('[data-splash-status]');
  var enterBtn = splash.querySelector('[data-splash-enter]');
  var skipBtn = splash.querySelector('[data-splash-skip]');
  var logoEl = splash.querySelector('[data-splash-logo]');

  // Kunci scroll selama splash tampil.
  document.body.classList.add('splash-active');
  var finished = false;

  /** Tutup splash dan lepaskan kunci scroll. */
  function closeSplash() {
    if (finished) return;
    finished = true;
    splash.classList.add('is-done');
    document.body.classList.remove('splash-active');
    window.removeEventListener('scroll', lockScroll);
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = null;
    // Kembalikan fokus ke konten utama agar navigasi keyboard lancar.
    var main = document.querySelector('main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  }

  /** Cegah gulir selama splash tampil (cadangan untuk browser lama). */
  function lockScroll() {
    window.scrollTo(0, 0);
  }
  window.addEventListener('scroll', lockScroll);

  // --- Bangun animasi huruf bergiliran -------------------------------------
  if (wordEl) {
    var text = wordEl.getAttribute('data-splash-word') || '';
    var accentFrom = Number(wordEl.getAttribute('data-splash-accent-from') || -1);
    wordEl.textContent = '';
    for (var i = 0; i < text.length; i += 1) {
      var span = document.createElement('span');
      span.className = 'splash__letter';
      span.textContent = text[i];
      // Aksen-orange pada huruf tertentu (mis. awal "later"/"trip").
      if (i === accentFrom) span.classList.add('splash__letter--accent');
      span.style.animationDelay = 0.12 + i * 0.055 + 's';
      wordEl.appendChild(span);
    }
  }

  // --- Progress bar --------------------------------------------------------
  var progress = 0;
  var timer = null;
  var autoTimer = null;

  function step() {
    // Progres meloncat ke 92% lalu melambat; 100% diisi saat animasi selesai.
    progress += Math.max(0.6, (92 - progress) * 0.09);
    if (progress > 92) progress = 92;
    if (barEl) barEl.style.width = progress.toFixed(1) + '%';
  }

  if (reduceMotion) {
    progress = 100;
    if (barEl) barEl.style.width = '100%';
    if (statusEl) statusEl.textContent = 'Siap';
    if (enterBtn) enterBtn.classList.add('is-ready');
  } else {
    timer = window.setInterval(step, 60);
    if (statusEl) statusEl.textContent = 'Menyiapkan perjalanan…';
  }

  // --- Selesai -------------------------------------------------------------
  function complete() {
    if (timer) window.clearInterval(timer);
    timer = null;
    progress = 100;
    if (barEl) barEl.style.width = '100%';
    if (statusEl) statusEl.textContent = 'Siap menjelajah';
    if (enterBtn) {
      enterBtn.classList.add('is-ready');
      // Fokuskan tombol agar pengguna bisa langsung menekan Enter.
      enterBtn.focus({ preventScroll: true });
    }
    // Tutup otomatis — pengunjung tidak boleh terjebak di splash.
    autoTimer = window.setTimeout(closeSplash, AUTO_CLOSE_MS);
  }

  if (reduceMotion) {
    complete();
  } else {
    // Tunggu animasi huruf + garis selesai (±1.6 detik), lalu aktifkan tombol.
    window.setTimeout(complete, 1600);
  }

  if (enterBtn) {
    enterBtn.addEventListener('click', closeSplash);
  }
  if (skipBtn) {
    skipBtn.addEventListener('click', closeSplash);
  }

  // Pintasan keyboard: Enter/Spasi menutup splash bila tombol sudah siap.
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && finished === false && enterBtn && enterBtn.classList.contains('is-ready')) {
      e.preventDefault();
      closeSplash();
    }
  });

  // Fallback keamanan: bila ada masalah (mis. JS error), buka situs
  // setelah 20 detik. Ini jaring pengaman, BUKAN pintasan keluar —
  // pada alur normal splash ditutup otomatis setelah AUTO_CLOSE_MS.
  window.setTimeout(closeSplash, 20000);
})();
