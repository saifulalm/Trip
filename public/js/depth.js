'use strict';
/**
 * depth.js — mesin efek kedalaman 3D/4D seayoulatertrip.com
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
  /* ---------------------------------------------------------------
   * 5. CURSOR TRAIL — titik + ring yang mengikuti kursor (desktop).
   *    Ring membesar saat hover elemen interaktif.
   * ------------------------------------------------------------- */
  if (!isTouch) {
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.body.classList.add('has-cursor');

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let dx = mx;
    let dy = my;
    let raf = null;

    function cursorTick() {
      dx += (mx - dx) * 0.22;
      dy += (my - dy) * 0.22;
      dot.style.transform = `translate3d(${mx - 4}px, ${my - 4}px, 0)`;
      ring.style.transform = `translate3d(${dx - ring.offsetWidth / 2}px, ${dy - ring.offsetHeight / 2}px, 0)`;
      if (Math.abs(mx - dx) > 0.4 || Math.abs(my - dy) > 0.4) {
        raf = requestAnimationFrame(cursorTick);
      } else {
        raf = null;
      }
    }
    function cursorKick() {
      if (!raf) raf = requestAnimationFrame(cursorTick);
    }

    window.addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      cursorKick();
    }, { passive: true });

    document.addEventListener('pointerover', (e) => {
      const interactive = e.target.closest('a, button, input, select, textarea, [role="button"], .dest-card, .pass-card, .article-card');
      ring.classList.toggle('is-active', Boolean(interactive));
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
   * 6. MAGNETIC BUTTON — elemen [data-magnetic] tertarik ringan ke kursor.
   * ------------------------------------------------------------- */
  if (!isTouch) {
    document.querySelectorAll('[data-magnetic]').forEach((el) => {
      const strength = parseFloat(el.dataset.magnetic) || 0.28;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = e.clientX - (r.left + r.width / 2);
        const py = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate3d(${px * strength}px, ${py * strength}px, 0)`;
      }, { passive: true });
      el.addEventListener('pointerleave', () => {
        el.style.transform = 'translate3d(0, 0, 0)';
      }, { passive: true });
    });
  }

  /* ---------------------------------------------------------------
   * 7. SCROLL PROGRESS BAR — indikator progres baca di atas halaman.
   * ------------------------------------------------------------- */
  const progressBar = document.createElement('div');
  progressBar.className = 'scroll-progress';
  document.body.appendChild(progressBar);
  let progressRaf = null;
  function updateProgress() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const ratio = max > 0 ? Math.min(Math.max(doc.scrollTop / max, 0), 1) : 0;
    progressBar.style.transform = `scaleX(${ratio})`;
    progressRaf = null;
  }
  window.addEventListener('scroll', () => {
    if (!progressRaf) progressRaf = requestAnimationFrame(updateProgress);
  }, { passive: true });
  updateProgress();

  /* ---------------------------------------------------------------
   * 8. RIPPLE pada tombol — umpan balik sentuhan ringan.
   * ------------------------------------------------------------- */
  document.querySelectorAll('.btn, .btn-a').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height);
      const wave = document.createElement('span');
      wave.className = 'ripple__wave';
      wave.style.width = wave.style.height = `${size}px`;
      wave.style.left = `${e.clientX - r.left - size / 2}px`;
      wave.style.top = `${e.clientY - r.top - size / 2}px`;
      btn.appendChild(wave);
      setTimeout(() => wave.remove(), 650);
    }, { passive: true });
  });

  /* ---------------------------------------------------------------
   * 9. FLOATING ORBS — parallax lembut untuk elemen [data-float].
   * ------------------------------------------------------------- */
  const floaters = Array.from(document.querySelectorAll('[data-float]'));
  if (floaters.length) {
    floaters.forEach((el, i) => {
      const amp = parseFloat(el.dataset.float) || 14;
      const dur = 6 + i * 1.4;
      el.style.animation = `floatSoft ${dur}s ease-in-out ${i * 0.4}s infinite alternate`;
      el.style.setProperty('--float-amp', `${amp}px`);
    });
  }
})();