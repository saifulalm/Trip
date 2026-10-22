'use strict';
/**
 * depth.js — mesin efek kedalaman 3D/4D jalanjalanenak.com
 * Semua efek bersifat PROGRESIF ENHANCEMENT: tanpa JS halaman tetap
 * utuh. Dihormati prefers-reduced-motion; tilt dinonaktifkan di perangkat
 * sentuh. Hanya transform/opacity (GPU-friendly), listener passive + rAF.
 */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  /* ---------------------------------------------------------------
   * 1. HEADER — mengecil & menambah bayangan saat scroll (kebiasaan)
   * ------------------------------------------------------------- */
  const header = document.querySelector('.site-header');
  let lastY = -1;
  function onScrollHeader() {
    const y = window.scrollY;
    if (y === lastY) return;
    lastY = y;
    if (header) header.classList.toggle('is-scrolled', y > 24);
  }
  window.addEventListener('scroll', onScrollHeader, { passive: true });
  onScrollHeader();

  if (reduceMotion) return; // semua efek kedalaman berhenti di sini

  /* ---------------------------------------------------------------
   * 2. HERO PARALAX BERLAPIS — pointer + scroll (dimensi ruang & waktu)
   *    Setiap elemen [data-depth] bergerak sesuai koefisiennya sendiri,
   *    menciptakan kesan tiga dimensi saat kursor & gulir bergerak.
   * ------------------------------------------------------------- */
  const layers = Array.from(document.querySelectorAll('[data-depth]'));
  if (layers.length && !isTouch) {
    let targetX = 0, targetY = 0, curX = 0, curY = 0, scrollShift = 0, raf = null;

    function tick() {
      curX += (targetX - curX) * 0.07; // easing lembut
      curY += (targetY - curY) * 0.07;
      layers.forEach((el) => {
        const d = parseFloat(el.dataset.depth) || 0;
        const baseY = parseFloat(el.dataset.shiftY) || 0;
        el.style.transform =
          'translate3d(' + (curX * d * 60).toFixed(2) + 'px,' +
          (curY * d * 40 + scrollShift * d * 0.35 + baseY).toFixed(2) + 'px,0)';
      });
      if (Math.abs(targetX - curX) > 0.001 || Math.abs(targetY - curY) > 0.001 || scrollShift !== 0) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    const hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        targetX = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
        targetY = (e.clientY - r.top) / r.height - 0.5;
        kick();
      }, { passive: true });
      hero.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; kick(); }, { passive: true });
    }
    window.addEventListener('scroll', () => {
      scrollShift = Math.min(window.scrollY, 700);
      kick();
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
   * 3. TILT 3D + GLARE — kartu [data-tilt] mengikuti sudut pandang
   * ------------------------------------------------------------- */
  if (!isTouch) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      const max = parseFloat(card.dataset.tilt) || 7; // derajat maksimum
      card.classList.add('tilt-3d');
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--tilt-x', (-py * max).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', (px * max).toFixed(2) + 'deg');
        card.style.setProperty('--glare-x', ((px + 0.5) * 100).toFixed(1) + '%');
        card.style.setProperty('--glare-y', ((py + 0.5) * 100).toFixed(1) + '%');
        card.classList.add('is-tilting');
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
        card.classList.remove('is-tilting');
      }, { passive: true });
    });
  }

  /* ---------------------------------------------------------------
   * 4. COUNT-UP statistik hero — angka tumbuh saat masuk viewport
   * ------------------------------------------------------------- */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        cio.unobserve(entry.target);
        const el = entry.target;
        const end = parseFloat(el.dataset.count);
        const suffix = el.dataset.suffix || '';
        const decimals = (el.dataset.decimals | 0);
        const dur = 1400;
        const t0 = performance.now();
        (function step(t) {
          const k = Math.min((t - t0) / dur, 1);
          const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
          el.textContent = (end * eased).toFixed(decimals).replace('.', ',') + suffix;
          if (k < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.4 });
    counters.forEach((el) => cio.observe(el));
  }
})();