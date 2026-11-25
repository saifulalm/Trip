'use strict';
/**
 * hero-animated.js — mesin hero interaktif untuk landing page.
 *
 * Fitur:
 *   1. Autoplay video + fallback poster bila video gagal/gagal decode.
 *   2. Tombol mute/unmute audio ambient (pojok kanan bawah).
 *   3. Parallax lembut saat scroll + reveal-on-scroll untuk konten hero.
 *   4. Animasi masuk bertahap (CSS) yang dipicu sekali di sini.
 *
 * Semua fitur bersifat PROGRESSIVE ENHANCEMENT: bila JS tidak jalan,
 * poster tetap menjadi latar dan seluruh konten tetap terbaca.
 * Menghormati prefers-reduced-motion.
 */
(function () {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;

  const media = hero.querySelector('[data-hero-media]');
  const video = hero.querySelector('[data-hero-video]');
  const poster = hero.querySelector('[data-hero-poster]');
  const audioBtn = hero.querySelector('[data-hero-audio]');
  const audioText = hero.querySelector('[data-hero-audio-text]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------
   * 1. Fallback video: bila error / format tak didukung / autoplay
   *    diblokir → video disembunyikan, poster high-res yang tampil.
   * ------------------------------------------------------------- */
  function useFallback(reason) {
    if (!media) return;
    media.classList.add('is-fallback');
    media.classList.remove('is-playing');
    if (video) {
      video.classList.remove('is-playing');
      // Hentikan unduhan sisa agar hemat bandwidth.
      try {
        video.removeAttribute('src');
        video.load();
      } catch (err) { /* abaikan */ }
    }
    console.warn('[hero] video tidak dipakai, memakai poster statis. Alasan:', reason);
  }

  if (video) {
    // Jaring pengaman: bila video sudah siap SEBELUM script ini dieksekusi
    // (mis. cache panas → 'loadeddata' terlewat), pasang flag main manual.
    if (video.readyState >= 2) {
      media && media.classList.add('is-playing');
    }

    video.addEventListener('loadeddata', function () {
      if (video.readyState >= 2) media && media.classList.add('is-playing');
    });

    video.addEventListener('error', function () {
      useFallback('error saat memuat');
    });

    // Event "error" bisa terjadi sebelum script defer selesai dijalankan
    // (video mulai dimuat saat HTML di-parse). Karena itu status error
    // diperiksa ulang setelah inisialisasi.
    if (video.error) {
      useFallback('error terdeteksi saat inisialisasi');
    } else {
      // Jaring pengaman: bila video tidak siap dalam 6 detik, perlakukan
      // sebagai fallback (jaringan lambat / format tak didukung).
      window.setTimeout(function () {
        if (video.readyState < 2) {
          useFallback('video tidak siap dalam 6 detik');
        }
      }, 6000);
    }

    // Beberapa browser tidak bisa memutar format tertentu tanpa error
    // yang Fired; cek dukungan canPlayType lebih dulu.
    if (video.canPlayType && video.canPlayType('video/mp4').length === 0) {
      useFallback('format mp4 tidak didukung');
    }

    // Autoplay diblokir (kebijakan hemat-data / tanpa interaksi) → tetap
    // tampilkan frame pertama sebagai poster, tanpa error.
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () {
        // Bukan kegagalan fatal: poster tetap menutupi video.
        if (media) media.classList.remove('is-playing');
      });
    }

    /* ---------------------------------------------------------------
     * 1b. Autoplay bisa tertahan saat tab kembali aktif.
     *
     * Saat pengguna berpindah dari tab lain, browser tidak otomatis
     * melanjutkan playback yang tertahan. Hero terlihat "beku" padahal
     * tidak ada error. Kita paksa play() lagi saat tab kembali terlihat.
     * ------------------------------------------------------------- */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (video.paused && video.readyState >= 2 && video.muted) {
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () { /* abaikan */ });
      }
    });
  }

  /* ---------------------------------------------------------------
   * 1c. Mode tanpa video (heroMode = 'image')
   *
   * Saat admin memilih mode gambar, <video> tidak dirender sama sekali.
   * Kalau <video> sempat ada (mis. diganti lewat devtools), kelas
   * 'is-static' memastikan poster yang tampil & overlay tetap pekat.
   * ------------------------------------------------------------- */
  if (media && !video) {
    media.classList.add('is-static');
  }

  /* ---------------------------------------------------------------
   * 2. Kontrol audio ambient (mute/unmute)
   * ------------------------------------------------------------- */
  if (audioBtn && video) {
    const ICON_ON =
      '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"></path>' +
      '<path d="M15.5 8.8a4.2 4.2 0 0 1 0 6.4"></path>' +
      '<path d="M18.4 6a8 8 0 0 1 0 12"></path>';
    const ICON_OFF =
      '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"></path>' +
      '<path d="m16 9 5 6M21 9l-5 6"></path>';

    const iconWrap = audioBtn.querySelector('[data-hero-audio-icon]');

    function setSound(on) {
      video.muted = !on;
      audioBtn.classList.toggle('is-on', on);
      audioBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      audioBtn.setAttribute('aria-label', on ? 'Matikan suara ambient' : 'Aktifkan suara ambient');
      if (audioText) audioText.textContent = on ? 'Aktif' : 'Suara';
      if (iconWrap) {
        iconWrap.innerHTML =
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
          'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
          (on ? ICON_ON : ICON_OFF) +
          '</svg>';
      }
      if (on && video.paused) {
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () { /* abaikan */ });
      }
    }

    setSound(false);

    audioBtn.addEventListener('click', function () {
      setSound(video.muted);
    });
  }

  /* ---------------------------------------------------------------
   * 3. Animasi masuk bertahap (pemicu kelas .is-ready)
   * ------------------------------------------------------------- */
  requestAnimationFrame(function () {
    hero.classList.add('is-ready');
  });

  /* ---------------------------------------------------------------
   * 4. Parallax saat scroll + reveal elemen hero
   * ------------------------------------------------------------- */
  /* Tombol audio disembunyikan saat hero tidak terlihat supaya tidak
     pernah bertumpuk dengan tombol WhatsApp mengambang di kanan bawah. */
  if (audioBtn && 'IntersectionObserver' in window) {
    const heroObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          audioBtn.classList.toggle('is-hidden', !entry.isIntersecting);
        });
      },
      { threshold: 0.05 }
    );
    heroObserver.observe(hero);
  }

  if (reduceMotion) {
    // Tetap pastikan konten terlihat (CSS reduced-motion juga menanganinya).
    hero.classList.add('is-ready');
    return;
  }

  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      const y = window.scrollY;
      // Parallax: latar bergerak lebih lambat dari halaman (max 12% tinggi hero).
      if (media) {
        const shift = Math.min(y, 900) * 0.12;
        media.style.transform = 'translate3d(0,' + shift.toFixed(1) + 'px,0)';
      }
      // Konten hero bergeser sedikit ke atas (efek kedalaman).
      const content = hero.querySelector('[data-hero-content]');
      if (content) {
        const fade = Math.min(y / Math.max(window.innerHeight * 0.8, 1), 1);
        content.style.transform = 'translate3d(0,' + (y * 0.08).toFixed(1) + 'px,0)';
        content.style.opacity = String(1 - fade * 0.55);
      }
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------------------------------------------------------
   * 5. Jaga agar form tidak terkirim tanpa kriteria minimal
   * ------------------------------------------------------------- */
  const form = hero.querySelector('[data-hero-search]');
  if (form) {
    form.addEventListener('submit', function (e) {
      const dest = form.querySelector('[name="destinasi"]');
      const date = form.querySelector('[name="tanggal"]');
      // Bila salah satu terisi, biarkan browser mengirim ke /cari.
      // Keduanya kosong → arahkan pengguna ke daftar PACKet agar tak ada
      // request sia-sia.
      if (dest && date && !dest.value.trim() && !date.value) {
        e.preventDefault();
        window.location.href = '/paket';
      }
    });
  }
})();
