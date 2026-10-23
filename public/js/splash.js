'use strict';
/**
 * splash.js — orkestrasi splash screen "Seayoulatertrip".
 *
 * Kontrak dengan <head> (views/layouts/public.ejs):
 *  - Script inline menambahkan kelas "syt-splash-pending" (splash tampil dari
 *    frame pertama) + "splash-active" (scroll terkunci) SEBELUM body diparse,
 *    sehingga tidak ada flash konten sebelum splash.
 *  - Script inline juga memasang jaring pengaman 6 detik.
 *  - File ini WAJIB melepas kedua kelas tersebut di semua jalur keluar
 *    (timer, tombol lewati, tab ditinggalkan, error, font gagal dimuat).
 *
 * Aturan:
 *  - Muncul SEKALI per tab browser (sessionStorage) — tab baru = kunjungan baru.
 *  - Menunggu font handwriting siap agar huruf tidak melompat saat ditulis.
 *  - Menghormati prefers-reduced-motion.
 *  - Progressive enhancement: tanpa JS, .splash tidak pernah tampil.
 */
(function () {
  var KEY = 'syt_splash_seen';
  var root = document.documentElement;
  var splash = document.getElementById('splash');
  var skipBtn = document.getElementById('splashSkip');

  /** Lepas "tampil" → izinkan transisi keluar (fade) + scroll bebas. */
  function release() {
    root.classList.remove('syt-splash-pending');
  }

  /** Lepas kunci scroll. */
  function unlock() {
    root.classList.remove('splash-active');
  }

  function markSeen() {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch (e) {
      /* Private mode / storage diblokir — abaikan, splash tetap muncul lagi. */
    }
  }

  function remove(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  if (!splash) {
    release();
    unlock();
    return;
  }

  /* Sudah pernah melihat? Buang seketika, jangan pernah tampil lagi. */
  var seen = false;
  try {
    seen = sessionStorage.getItem(KEY) === '1';
  } catch (e) {
    seen = false;
  }
  if (seen) {
    remove(splash);
    remove(skipBtn);
    release();
    unlock();
    return;
  }

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finished = false;
  var timers = [];

  function after(ms, fn) {
    timers.push(setTimeout(fn, ms));
  }

  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    splash.classList.add('is-leaving');
    release();   /* mulai fade-out, situs mulai terlihat di baliknya */
    markSeen();
    after(600, function () {
      unlock();  /* scroll dilepas setelah splash benar-benar hilang */
      remove(splash);
      remove(skipBtn);
    });
  }

  /* ---------- Mulai ---------- */
  splash.classList.add('is-active'); /* latar, tagline, progress, tombol */
  /* Tombol lewati dikendalikan dari elemennya sendiri (class .is-on), bukan
     dari kelas di <html> — supaya tidak ikut hilang di tengah animasi
     fade-out splash. */
  if (skipBtn) skipBtn.classList.add('is-on');

  if (skipBtn) {
    skipBtn.addEventListener('click', finish);
  }

  /* Jangan biarkan splash menggantung bila user pindah tab. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !finished) finish();
  });

  function write() {
    if (finished) return;
    splash.classList.add('is-writing'); /* wordmark mulai ditulis tangan */
    after(reduceMotion ? 700 : 3400, finish);
  }

  /* Tunggu font handwriting siap, tapi jangan menunda lebih dari 1,2 detik. */
  var started = false;
  function begin() {
    if (started) return;
    started = true;
    write();
  }

  if (document.fonts && document.fonts.load && typeof document.fonts.load === 'function') {
    Promise.all([
      document.fonts.load('110px "Great Vibes"').catch(function () {}),
      document.fonts.load('110px "Dancing Script"').catch(function () {})
    ])
      .then(function () {
        /* Beri satu frame agar font benar-benar terender. */
        requestAnimationFrame(function () {
          after(80, begin);
        });
      })
      .catch(begin);
    after(1200, begin); /* batas atas tunggu font */
  } else {
    after(150, begin);
  }

  /* Jaring pengaman: apa pun yang terjadi, situs harus tetap bisa dibuka. */
  after(6500, function () {
    if (!finished) finish();
  });
})();
