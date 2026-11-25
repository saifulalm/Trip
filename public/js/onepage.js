'use strict';

/**
 * onepage.js — navigasi section halaman beranda (mode onepage).
 *
 * Tanggung jawab:
 *  1. Menandai section yang sedang terlihat (scrollspy) lalu menyorot
 *     tautan nav header & titik rail yang sesuai.
 *  2. Menggulir ke section dengan benar saat tautan anchor diklik —
 *     dengan memperhitungkan tinggi header sticky (72px) supaya judul
 *     section tidak tertutup header.
 *  3. Menyorot rail / nav secara otomatis.
 *
 * Prinsip: PROGRESSIVE ENHANCEMENT.
 *  - Tanpa JS, tautan anchor native + `scroll-behavior: smooth` (style.css)
 *    tetap berfungsi normal.
 *  - Semua listener bersifat pasif & dibersihkan saat halaman dilepas.
 */

(function () {
  var rail = document.querySelector('[data-section-rail]');
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('[data-section-nav]'));

  // Tanpa rail dan tanpa tautan section → tidak ada yang perlu dikerjakan.
  if (!rail && navLinks.length === 0) return;

  /* ------------------------------------------------------------------
   * 1. Kumpulan target section
   * ------------------------------------------------------------------ */
  var targets = [];
  navLinks.forEach(function (link) {
    var id = link.getAttribute('data-section-nav');
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    if (!targets.some(function (t) { return t.id === id; })) {
      targets.push({ id: id, el: el });
    }
  });
  if (!targets.length) return;

  /* ------------------------------------------------------------------
   * 1a. Urutkan target berdasarkan posisi dokumen
   *
   * PENTING: urutan DOM tidak sama dengan urutan halaman. Header memuat
   * tautan nav section (Destinasi, Paket, Artikel) yang berada DI ATAS
   * rail section (Beranda, Sorotan Pulau, ...). Bila target dipakai
   * sesuai urutan DOM, scrollspy menghitung section yang salah —
   * contoh nyata: di scrollY 0, rail menyorot "destinasi-unggulan"
   * padahal section yang terlihat adalah "hero".
   *
   * Solusi: urutkan ulang berdasarkan offsetTop dokumen.
   * ------------------------------------------------------------------ */
  function sortTargets() {
    targets.sort(function (a, b) {
      return offsetOf(a.el) - offsetOf(b.el);
    });
  }

  function offsetOf(el) {
    return Math.round(el.getBoundingClientRect().top + window.scrollY);
  }

  sortTargets();

  /* ------------------------------------------------------------------
   * 2. Offset scroll — tinggi header sticky + jarak aman
   * ------------------------------------------------------------------ */
  var header = document.querySelector('.site-header');
  var EXTRA_GAP = 16; // jarak tambahan di bawah header (px)

  function headerOffset() {
    var h = header ? header.getBoundingClientRect().height : 0;
    return Math.round(h + EXTRA_GAP);
  }

  /* ------------------------------------------------------------------
   * 3. Gulir ke section
   *    `scroll-margin-top` di CSS sudah menangani sebagian offset, tapi
   *    kita hitung manual supaya konsisten di semua browser.
   * ------------------------------------------------------------------ */
  function scrollToSection(id, options) {
    var el = document.getElementById(id);
    if (!el) return false;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var behavior = (options && options.instant) || reduceMotion ? 'auto' : 'smooth';

    var offset = headerOffset();
    var top = el.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({ top: Math.max(top, 0), behavior: behavior });
    correctAfterScroll(id, offset);
    return true;
  }

  /* ------------------------------------------------------------------
   * 3a. Koreksi posisi setelah scroll selesai
   *
   * Layout shift: gambar ber-`loading="lazy"` di atas section bisa selesai
   * dimuat SETELAH posisi scroll dihitung → section bergeser beberapa px
   * sehingga judulnya tertutup header sticky.
   *
   * Solusi: setelah scroll berhenti, ukur ulang posisi target. Bila
   * meleset lebih dari 2px, geser scroll sekali lagi (tanpa animasi).
   * `scrollend` dipakai bila tersedia; timeout jadi cadangan.
   * ------------------------------------------------------------------ */
  var correctTimer = null;

  function correctAfterScroll(id, offset) {
    if (correctTimer) window.clearTimeout(correctTimer);

    var el = document.getElementById(id);
    if (!el) return;

    var correct = function () {
      var delta = el.getBoundingClientRect().top - offset;
      // Toleransi 2px — di bawah itu posisi sudah pas, jangan digoyang.
      if (Math.abs(delta) > 2) {
        window.scrollBy({ top: delta, behavior: 'auto' });
      }
    };

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', correct, { once: true });
    }
    // Cadangan: smooth scroll biasanya selesai < 1 detik, tapi animasi
    // bisa lebih lama pada halaman panjang.
    correctTimer = window.setTimeout(correct, 900);
  }

  /* ------------------------------------------------------------------
   * 4. Scrollspy — tandai section aktif
   *    Section aktif = section terakhir yang posisinya sudah melewati
   *    garis horizon (header + sedikit). Pakai IntersectionObserver
   *    agar murah, dan fallback ke calculation saat scroll.
   * ------------------------------------------------------------------ */
  var activeId = null;

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    navLinks.forEach(function (link) {
      var on = link.getAttribute('data-section-nav') === id;
      link.classList.toggle('is-active', on);
      if (on) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function computeActive() {
    var line = headerOffset() + 8;
    var current = targets[0].id;
    for (var i = 0; i < targets.length; i += 1) {
      var rect = targets[i].el.getBoundingClientRect();
      if (rect.top - line <= 0) {
        current = targets[i].id;
      } else {
        break;
      }
    }
    // Di dasar halaman, section terakhir yang aktif.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      current = targets[targets.length - 1].id;
    }
    setActive(current);
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      computeActive();
      updateProgress();
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  computeActive();

  /* ------------------------------------------------------------------
   * 4a. Indikator progres scroll (bar tipis di bawah header)
   *
   * Memberi umpan balik visual soal seberapa jauh pengunjung sudah
   * membaca halaman — strengthens "beranda sesuai scroll".
   * ------------------------------------------------------------------ */
  var progressBar = document.querySelector('[data-scroll-progress]');

  function updateProgress() {
    if (!progressBar) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var pct = max > 0 ? (window.scrollY / max) * 100 : 0;
    // Batasi 0..100 agar tidak meluber saat overscroll (bounce iOS).
    progressBar.style.width = Math.min(100, Math.max(0, pct)).toFixed(2) + '%';
    // Sembunyikan bar ketika halaman tidak bisa digulir (mis. mobile).
    progressBar.classList.toggle('is-hidden', max <= 0);
  }
  updateProgress();

  /* ------------------------------------------------------------------
   * 5. Klik tautan anchor → gulir manual (bukan native)
   *    Native anchor tidak memperhitungkan header sticky.
   * ------------------------------------------------------------------ */
  navLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('data-section-nav');
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return; // biarkan browser menangani (mis. link mati)
      e.preventDefault();
      scrollToSection(id);
      // Perbarui URL tanpa memicu lompatan sekunder.
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', '#' + id);
      }
      // Fokuskan target agar navigasi keyboard & pembaca layar Lancar.
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      setActive(id);
    });
  });

  /* ------------------------------------------------------------------
   * 6. Dukungan hash saat halaman dibuka langsung (#destinasi-unggulan)
   *    Tunggu satu frame supaya layout sudah stabil (gambar/foto load).
   * ------------------------------------------------------------------ */
  function applyHashOnLoad() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    var id = hash.slice(1);
    if (!document.getElementById(id)) return;
    scrollToSection(id, { instant: true });
    setActive(id);
  }
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(applyHashOnLoad);
  });
  window.addEventListener('load', applyHashOnLoad, { once: true });
})();
