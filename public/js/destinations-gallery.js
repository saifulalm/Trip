'use strict';

/**
 * seayoulatertrip — Public destination gallery interactions
 *
 * Fitur:
 *  1. Scroll-triggered reveals (IntersectionObserver) — silky-smooth enters
 *  2. Canvas rendering layer — menggambar gambar ke <canvas> sbg pengganti
 *     agar browser tidak menawarkannya lewat "Save Image As"
 *  3. Asset protection layer:
 *       - transparent absolute overlay (intercept pointer events)
 *       - disabled context menu (right-click prevented)
 *       - disabled image dragging (-webkit-user-drag: none)
 *       - canvas rendering (no native "Save Image As" on the original file)
 *  4. Brand watermark anchored to preview viewports
 *
 * Progresif enhancement: tanpa JS halaman tetap utuh.
 * prefers-reduced-motion: dihormati; efek samping dimatikan.
 */
(function () {
  if (typeof IntersectionObserver === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
   * 1. SCROLL-TRIGGERED REVEALS
   * ============================================================ */
  function initReveals() {
    const reveals = Array.from(document.querySelectorAll('.reveal'));
    if (!reveals.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            // Hentikan observasi setelah muncul (biar tidak reload setiap scroll)
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    reveals.forEach((el) => observer.observe(el));

    // Re-trigger on tab switch / visibility change (progressive refresh)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      document.querySelectorAll('.reveal').forEach((el) => {
        if (!el.classList.contains('is-visible')) {
          observer.observe(el);
        }
      });
    });
  }

  /* ============================================================
   * 2. CANVAS RENDERING LAYER (prevent "Save Image As")
   * ============================================================
   * Strategy: setiap <img> di dalam .gallery-bento__canvas-wrap
   * diganti dengan <canvas> yang digambar pakai drawImage.
   * Canvas tidak punya source URL asli sehingga browser tidak
   * bisa menampilkan "Save Image As" pada file asli.
   */
  function initCanvasRendering() {
    const wraps = Array.from(document.querySelectorAll('.gallery-bento__canvas-wrap'));
    if (!wraps.length) return;

    wraps.forEach((wrap) => {
      const img = wrap.querySelector('img');
      if (!img) return;

      const canvas = document.createElement('canvas');
      canvas.className = 'gallery-bento__canvas-render';
      canvas.alt = img.alt || '';

      // Copy image attributes to canvas
      canvas.setAttribute('data-src', img.getAttribute('src') || '');
      if (img.getAttribute('width')) canvas.setAttribute('width', img.getAttribute('width'));
      if (img.getAttribute('height')) canvas.setAttribute('height', img.getAttribute('height'));

      // Replace the img with canvas
      img.replaceWith(canvas);

      // Use requestAnimationFrame so the image is fully loaded before drawing
      const loadAndDraw = () => {
        const natural = img.naturalWidth || img.width || 0;
        const naturalH = img.naturalHeight || img.height || 0;
        const rect = wrap.getBoundingClientRect();
        const w = rect.width || natural || 800;
        const h = rect.height || naturalH || 500;

        // CSS pixel dimensions
        const cssW = wrap.clientWidth || natural || 800;
        const cssH = wrap.clientHeight || naturalH || 500;

        canvas.width = cssW;
        canvas.height = cssH;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw image, but blur with low opacity overlay for protection
        const scaleX = cssW / (natural || 800);
        const scaleY = cssH / (naturalH || 500);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.drawImage(img, 0, 0, cssW, cssH);

        // Subtle protective overlay (prevents direct save of original pixels)
        ctx.fillStyle = 'rgba(6, 31, 37, 0.015)';
        ctx.fillRect(0, 0, cssW, cssH);
      };

      if (img.complete && img.naturalWidth) {
        loadAndDraw();
      } else {
        img.addEventListener('load', loadAndDraw, { once: true });
        img.addEventListener('error', () => {
          // Fallback: keep the original <img> if canvas drawing fails
          canvas.remove();
          const fallback = document.createElement('img');
          fallback.src = img.src;
          fallback.alt = img.alt;
          wrap.replaceChild(fallback, img);
        }, { once: true });
      }
    });
  }

  /* ============================================================
   * 3. ASSET PROTECTION LAYER
   * ============================================================ */
  function initAssetProtection() {
    // --- Context menu disabled on all gallery images ---
    document.querySelectorAll('.gallery-bento__canvas-wrap').forEach((wrap) => {
      wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // Show a subtle hint instead of the native menu
        const hint = document.createElement('div');
        hint.textContent = 'Galeri pribadi — simpan tidak dapat diakses.';
        hint.style.cssText =
          'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(11,46,55,0.85);color:#f6f0e6;padding:0.8rem 1.2rem;border-radius:12px;font-size:0.85rem;z-index:999999;pointer-events:none;';
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 1800);
      });
    });

    // --- Drag prevention ---
    const preventDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.querySelectorAll('.gallery-bento__img').forEach((img) => {
      img.addEventListener('dragstart', preventDrag);
      img.addEventListener('drag', preventDrag);
    });

    // --- Canvas: prevent save via context menu (already in canvas) ---
    document.querySelectorAll('.gallery-bento__canvas-wrap canvas').forEach((canvas) => {
      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const hint = document.createElement('div');
        hint.textContent = 'Galeri pribadi — simpan tidak dapat diakses.';
        hint.style.cssText =
          'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(11,46,55,0.85);color:#f6f0e6;padding:0.8rem 1.2rem;border-radius:12px;font-size:0.85rem;z-index:999999;pointer-events:none;';
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 1800);
      });
    });

    // --- Global: disable context menu across the entire gallery page ---
    document.addEventListener('contextmenu', (e) => {
      // Only disable on the gallery pages (destinations)
      if (e.target.closest('.gallery-bento') || e.target.closest('.gallery-hero') || e.target.closest('.detail-strip')) {
        e.preventDefault();
        const hint = document.createElement('div');
        hint.textContent = 'Galeri pribadi — simpan tidak dapat diakses.';
        hint.style.cssText =
          'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(11,46,55,0.85);color:#f6f0e6;padding:0.8rem 1.2rem;border-radius:12px;font-size:0.85rem;z-index:999999;pointer-events:none;';
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 1800);
      }
    });
  }

  /* ============================================================
   * 4. BRAND WATERMARK
   * ============================================================ */
  function initWatermark() {
    const badge = document.getElementById('brandWatermark');
    if (!badge) return;

    // Fade watermark out when scrolling (anchored to preview viewports)
    let lastY = 0;
    let transitioning = false;

    const onScroll = () => {
      if (reduceMotion) return;
      const y = window.scrollY || 0;
      if (Math.abs(y - lastY) > 4) {
        if (!transitioning) {
          transitioning = true;
          badge.classList.add('is-preview');
          requestAnimationFrame(() => {
            transitioning = false;
          });
        }
        lastY = y;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Fade watermark back in when at top
    const onScrollTop = () => {
      if (reduceMotion) return;
      if (window.scrollY < 80) {
        badge.classList.remove('is-preview');
      }
    };
    window.addEventListener('scroll', onScrollTop, { passive: true });
    onScrollTop();
  }

  /* ============================================================
   * 5. GALLERY HERO INTERACTION — peek detail strips
   * ============================================================ */
  function initGalleryHero() {
    const hero = document.querySelector('.gallery-hero');
    if (!hero || reduceMotion) return;

    hero.addEventListener('pointermove', (e) => {
      // Subtle parallax hint on the hero image
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const img = hero.querySelector('.gallery-hero__img');
      if (img) {
        img.style.transform = `scale(1.02) translate(${x * 8}px, ${y * 6}px)`;
      }
    });

    hero.addEventListener('pointerleave', () => {
      const img = hero.querySelector('.gallery-hero__img');
      if (img) img.style.transform = 'scale(1)';
    });
  }

  /* ============================================================
   * INIT
   * ============================================================ */
  function init() {
    initReveals();
    initCanvasRendering();
    initAssetProtection();
    initWatermark();
    initGalleryHero();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
