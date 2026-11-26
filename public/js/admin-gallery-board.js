/**
 * Papan "Susun Portfolio" — mengatur urutan dan penanda unggulan
 * destinasi langsung dari kartu portofolio di /admin/galeri.
 *
 * Semua perubahan ditulis ke server lewat endpoint yang sudah ada:
 *   POST /admin/galeri/urutan   { order: [id, ...] }
 *   POST /admin/galeri/unggulan { id, featured }
 * Token CSRF diambil dari input hidden layout admin.
 */
(function () {
  'use strict';

  const list = document.getElementById('reorderCanvasList');
  if (!list) return;

  const saveBtn = document.getElementById('gallerySaveOrder');
  const stateChip = document.getElementById('galleryOrderState');
  const hint = document.getElementById('galleryHint');
  const search = document.getElementById('gallerySearch');
  const toastContainer = document.getElementById('galleryToastContainer');
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  let dirty = false;
  let saving = false;
  const featuredChanges = new Map(); // id -> boolean (nilai terbaru)

  function csrfToken() {
    const el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  function toast(type, message) {
    if (!toastContainer) return;
    const el = document.createElement('div');
    el.className = `gallery-toast gallery-toast--${type}`;
    el.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'gallery-toast__icon';
    icon.textContent = type === 'error' ? '✕' : type === 'success' ? '✓' : 'ℹ';
    const msg = document.createElement('span');
    msg.className = 'gallery-toast__msg';
    msg.textContent = String(message);
    el.appendChild(icon);
    el.appendChild(msg);
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function cards() {
    return Array.from(list.querySelectorAll('.portfolio-card'));
  }

  function setState(label, tone) {
    if (!stateChip) return;
    stateChip.textContent = label;
    stateChip.classList.toggle('is-dirty', tone === 'dirty');
    stateChip.classList.toggle('is-error', tone === 'error');
  }

  function markDirty() {
    dirty = true;
    setState('Belum disimpan', 'dirty');
    if (hint) hint.textContent = 'Ada perubahan yang belum disimpan. Tekan “Simpan urutan” untuk menerapkannya.';
  }

  /** Perbarui nomor posisi P01…, label tombol, dan status nonaktif. */
  function renumber() {
    const items = cards();
    items.forEach((card, idx) => {
      const rank = card.querySelector('[data-rank]');
      if (rank) {
        const label = `P${String(idx + 1).padStart(2, '0')}`;
        rank.textContent = label;
        rank.setAttribute('aria-label', `Posisi ${idx + 1}`);
      }
      const up = card.querySelector('[data-move="up"]');
      const down = card.querySelector('[data-move="down"]');
      if (up) up.disabled = idx === 0;
      if (down) down.disabled = idx === items.length - 1;
    });
  }

  function moveCard(card, direction) {
    const sibling = direction === 'up' ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling || !sibling.classList.contains('portfolio-card')) return;
    if (direction === 'up') {
      list.insertBefore(card, sibling);
    } else {
      list.insertBefore(sibling, card);
    }
    if (!reduceMotion) {
      card.animate(
        [{ transform: 'scale(0.985)' }, { transform: 'scale(1)' }],
        { duration: 160, easing: 'ease-out' }
      );
    }
    renumber();
    markDirty();
    const btn = card.querySelector(`[data-move="${direction}"]`);
    if (btn) btn.focus();
  }

  list.addEventListener('click', (e) => {
    const moveBtn = e.target.closest('[data-move]');
    if (moveBtn) {
      const card = moveBtn.closest('.portfolio-card');
      if (card) moveCard(card, moveBtn.dataset.move);
      return;
    }

    const star = e.target.closest('[data-featured]');
    if (star) {
      const card = star.closest('.portfolio-card');
      if (!card) return;
      const next = star.getAttribute('aria-pressed') !== 'true';
      star.setAttribute('aria-pressed', String(next));
      card.classList.toggle('is-featured', next);
      star.lastChild.textContent = next ? ' Unggulan' : ' Jadikan unggulan';
      star.title = next
        ? `Lepas ${card.dataset.name} dari unggulan`
        : `Tandai ${card.dataset.name} sebagai unggulan`;
      star.setAttribute('aria-label', star.title);
      featuredChanges.set(card.dataset.id, next);
      markDirty();
      toast('info', next ? `${card.dataset.name} ditandai unggulan` : `${card.dataset.name} bukan unggulan lagi`);
    }
  });

  // ── Seret-lepas antar kartu ───────────────────────────────────
  let dragged = null;

  list.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.portfolio-card');
    if (!card) return;
    dragged = card;
    card.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    }
  });

  list.addEventListener('dragover', (e) => {
    if (!dragged) return;
    const over = e.target.closest('.portfolio-card');
    if (!over || over === dragged) return;
    e.preventDefault();
    const rect = over.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    list.insertBefore(dragged, after ? over.nextElementSibling : over);
  });

  list.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged.classList.remove('is-dragging');
    dragged = null;
    renumber();
    markDirty();
  });

  // ── Pencarian kartu ───────────────────────────────────────────
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      cards().forEach((card) => {
        const name = (card.dataset.name || '').toLowerCase();
        const region = (card.querySelector('.portfolio-card__region') || {}).textContent || '';
        const match = !q || name.includes(q) || region.toLowerCase().includes(q);
        card.hidden = !match;
      });
    });
  }

  // ── Simpan ke server ──────────────────────────────────────────
  async function save() {
    if (saving) return;
    const order = cards().map((card) => card.dataset.id).filter(Boolean);
    if (!order.length) return;

    saving = true;
    if (saveBtn) saveBtn.disabled = true;
    setState('Menyimpan…', '');

    try {
      const res = await fetch('/admin/galeri/urutan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ order })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) throw new Error(data.error || 'Server menolak urutan baru.');

      for (const [id, featured] of featuredChanges.entries()) {
        const fres = await fetch('/admin/galeri/unggulan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          body: JSON.stringify({ id, featured })
        });
        const fdata = await fres.json().catch(() => ({}));
        if (!fres.ok || fdata.ok !== true) {
          throw new Error(fdata.error || 'Gagal menyimpan penanda unggulan.');
        }
      }

      featuredChanges.clear();
      dirty = false;
      setState('Tersimpan', '');
      if (hint) hint.textContent = 'Urutan tersimpan. Pengunjung melihat galeri dalam urutan ini.';
      toast('success', 'Urutan portofolio tersimpan.');
    } catch (err) {
      setState('Gagal menyimpan', 'error');
      toast('error', err.message || 'Tidak dapat menyimpan urutan. Coba lagi.');
    } finally {
      saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', save);

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  renumber();
})();
