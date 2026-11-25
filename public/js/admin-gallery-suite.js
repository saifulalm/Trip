'use strict';

/**
 * seayoulatertrip — Admin Gallery Management Suite
 *
 * Fitur:
 *  1. Drag-and-drop batch media upload zone dengan real-time WebP
 *     compression indicators (animasi dots).
 *  2. Interactive reordering canvas (drag-to-sort grid) untuk
 *     mengatur urutan portfolio destinasi.
 *  3. Granular controls:
 *       - Toggle "Featured Hero"
 *       - Edit captions
 *       - Batch delete dengan instant visual feedback
 *  4. Toast notifications untuk instant feedback.
 *
 * Progresif enhancement: tanpa JS halaman tetap utuh.
 * prefers-reduced-motion: dihormati.
 */
(function () {
  if (typeof window === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STORAGE_KEY = 'syl-admin-galeri-order';

  /* ============================================================
   * STATE
   * ============================================================ */
  const state = {
    items: [],
    draggingId: null,
    overId: null,
    uploadedFiles: [], // { file, url, status: 'pending'|'processing'|'done'|'error', progress }
    isBusy: false,
  };

  /* ============================================================
   * UTILITY
   * ============================================================ */
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Escape teks supaya aman disisipkan ke dalam `innerHTML`.
   *
   * Semua nilai dinamis (nama berkas, URL, ID destinasi, pesan error
   * server) bisa memuat karakter HTML. Tanpa escape, markup itu
   * dieksekusi browser — sumber self-XSS / injeksi HTML.
   *
   * @param {*} value nilai apa pun
   * @returns {string} teks yang aman untuk `innerHTML`
   */
  function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(type, message) {
    const container = document.getElementById('galleryToastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `gallery-toast gallery-toast--${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };

    // `message` bisa berisi pesan error dari server. Isi lewat
    // `textContent` (bukan `innerHTML`) supaya karakter HTML apa pun
    // tidak pernah dieksekusi browser — sumber self-XSS / injeksi HTML.
    const ikon = document.createElement('span');
    ikon.className = 'gallery-toast__icon';
    ikon.textContent = icons[type] || 'ℹ';

    const pesan = document.createElement('span');
    pesan.className = 'gallery-toast__msg';
    pesan.textContent = message === undefined || message === null ? '' : String(message);

    const tutup = document.createElement('button');
    tutup.className = 'gallery-toast__close';
    tutup.setAttribute('aria-label', 'Tutup');
    tutup.innerHTML = '&times;';

    toast.appendChild(ikon);
    toast.appendChild(pesan);
    toast.appendChild(tutup);
    toast.querySelector('.gallery-toast__close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4000);
  }

  /* ============================================================
   * 1. DRAG-AND-DROP BATCH MEDIA UPLOAD
   * ============================================================ */
  function initUploadZone() {
    const dropZone = document.getElementById('galleryUploadZone');
    if (!dropZone) return;

    const input = dropZone.querySelector('input[type="file"]');
    const drop = dropZone.querySelector('[data-drop]');
    const filenameEl = dropZone.querySelector('[data-filename]');
    const metaEl = dropZone.querySelector('[data-meta]');
    const dots = dropZone.querySelectorAll('[data-dot]');
    const uploadBtn = dropZone.querySelector('[data-upload]');
    const totalFilesEl = dropZone.querySelector('[data-total]');
    const hintEl = dropZone.querySelector('[data-gallery-hint]');
    const destInput = dropZone.querySelector('[data-destination-id]');
    const resultsEl = dropZone.querySelector('[data-upload-results]');

    // Slot dan batas ukuran diambil dari spesifikasi slot agar selalu
    // sinkron dengan validasi server.
    const SPEC = window.SylUploadSpec || null;
    const slotName = dropZone.dataset.slot || 'gallery';
    const spec = SPEC ? SPEC.get(slotName) : null;

    // Tampilkan hint dari spesifikasi slot (batas per-slot, bukan
    // konstanta hardcode "5 MB").
    if (hintEl && spec && spec.hint) {
      hintEl.textContent = spec.hint + ' · maksimal 8 file per unggahan';
    }

    let files = [];
    let isDragging = false;

    // ── Upload status ──────────────────────────────────────────
    function setDotStatus(index, status) {
      dots.forEach((d, i) => {
        d.className = 'gallery-upload-bundle__dot';
        if (i === index) {
          if (status === 'processing') d.classList.add('is-active');
          else if (status === 'done') d.classList.add('is-done');
          else if (status === 'error') d.classList.add('is-error');
        }
      });
    }

    // ── Handle file selection ──────────────────────────────────
    function applyFiles(newFiles) {
      // Batas ukuran diambil dari spesifikasi slot (bukan konstanta 5 MB).
      const maxBytes = spec ? spec.maxBytes : 2 * 1024 * 1024;
      files = files.concat(Array.from(newFiles || []).filter(f =>
        f.type.startsWith('image/') && f.size <= maxBytes
      ).sort((a, b) => b.size - a.size));

      if (!files.length) {
        drop.classList.remove('is-ready', 'is-error');
        filenameEl.textContent = '';
        metaEl.textContent = '';
        uploadBtn.disabled = true;
        return;
      }

      drop.classList.add('is-ready');
      filenameEl.textContent = `${files.length} foto dipilih · maks ${formatBytes(maxBytes)}`;
      metaEl.textContent = files.map(f => `${f.name} · ${formatBytes(f.size)}`).join(' · ');
      uploadBtn.disabled = false;
      setDotStatus(0, 'pending');
    }

    input.addEventListener('change', () => applyFiles(input.files));
    input.addEventListener('click', () => { input.value = ''; });

    // ── Drag & drop ────────────────────────────────────────────
    ['dragenter', 'dragover'].forEach((evt) => {
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        drop.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = false;
        drop.classList.remove('is-dragover');
      });
    });
    drop.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        applyFiles(dt.files);
      }
    });

    /**
     * Tampilkan hasil unggahan di halaman: pratinjau gambar + URL.
     *
     * Tanpa ini admin hanya melihat toast "berhasil diunggah" tanpa
     * akses ke berkas yang baru diunggah (URL-nya tidak diketahui).
     *
     * @param {Array<{filename: string, url: string, width: number, height: number, bytes: number}>} files hasil unggah
     * @param {string} destinationId ID destinasi tujuan (boleh kosong)
     */
    function renderUploadResults(files, destinationId) {
      if (!resultsEl) return;
      const list = Array.isArray(files) ? files : [];
      if (!list.length) return;

      const kartu = list.map((f) => {
        const size = f.bytes ? formatBytes(f.bytes) : '';
        const dims = f.width && f.height ? f.width + '×' + f.height : '';
        // Semua nilai dinamis (URL, nama berkas, dimensi, ukuran) DI-escape
        // sebelum masuk `innerHTML`. URL & nama berkas berasal dari server
        // / input admin — tanpa escape keduanya vektor injeksi HTML.
        const url = escapeHtml(f.url);
        const filename = escapeHtml(f.filename);
        const meta = escapeHtml([dims, size].filter(Boolean).join(' · '));
        return `
          <figure class="upload-result">
            <img src="${url}" alt="${filename}" loading="lazy">
            <figcaption>
              <a href="${url}" target="_blank" rel="noopener">${url}</a>
              <span>${meta}</span>
            </figcaption>
          </figure>`;
      }).join('');

      const catatan = destinationId
        ? ` Berkas ditempel ke destinasi <code>${escapeHtml(destinationId)}</code>.`
        : ' Berkas tersimpan di folder uploads (galeri umum).';

      resultsEl.innerHTML =
        `<p class="upload-results__note">${list.length} berkas berhasil diunggah.${catatan}</p>` +
        `<div class="upload-results__grid">${kartu}</div>`;
      resultsEl.hidden = false;
    }

    // ── Upload button ──────────────────────────────────────────
    uploadBtn.addEventListener('click', async () => {
      if (state.isBusy || !files.length) {
        if (!files.length) showToast('error', 'Pilih setidaknya satu gambar.');
        return;
      }
      state.isBusy = true;
      uploadBtn.classList.add('is-busy');
      uploadBtn.textContent = 'Mengunggah…';

      // Tampilkan progres per berkas.
      for (let i = 0; i < files.length; i++) {
        setDotStatus(i, 'processing');
      }

      try {
        // Token CSRF diambil dari input hidden yang sudah ada di layout
        // admin — tidak perlu menambah <meta> baru.
        const csrfEl = document.querySelector('input[name="_csrf"]');
        const csrfToken = csrfEl ? csrfEl.value : '';

        const batch = window.SylUploadBatch;
        if (!batch) throw new Error('Modul unggah batch belum termuat.');

        // Destinasi tujuan (opsional). Kalau diisi, berkas langsung
        // ditempel ke galeri / gambar utama destinasi tersebut.
        // Kalau kosong, hasil unggahan tetap ditampilkan sebagai galeri
        // umum di halaman ini.
        const destinationId = destInput ? String(destInput.value || '').trim() : '';

        const result = await batch.upload(files, {
          url: '/admin/galeri/unggah',
          field: 'galleryFiles',
          csrfToken: csrfToken,
          extra: { kind: 'gallery', destinationId: destinationId }
        });

        if (!result.ok) {
          for (let i = 0; i < files.length; i++) setDotStatus(i, 'error');
          throw new Error(result.error || 'Upload gagal.');
        }

        result.files.forEach((f, i) => {
          setDotStatus(i, 'done');
          state.uploadedFiles.push({
            file: files[i],
            url: f.url,
            status: 'done',
            progress: 100
          });
        });

        // Tampilkan hasil unggahan (URL + pratinjau) supaya admin bisa
        // melihat & menyalin alamat berkasnya — tanpa ini admin hanya
        // melihat toast dan berkas jadi "hilang".
        renderUploadResults(result.files, destinationId);

        state.isBusy = false;
        uploadBtn.classList.remove('is-busy');
        uploadBtn.textContent = 'Upload All (WebP)';
        showToast('success', '✓ ' + result.files.length + ' gambar berhasil diunggah.');

        // Kosongkan pilihan supaya admin bisa mengunggah batch berikutnya.
        files = [];
        input.value = '';
        drop.classList.remove('is-ready');
        filenameEl.textContent = '';
        metaEl.textContent = '';
        uploadBtn.disabled = true;
        dots.forEach(d => {
          d.className = 'gallery-upload-bundle__dot';
          d.classList.remove('is-active', 'is-done', 'is-error');
        });

      } catch (err) {
        state.isBusy = false;
        uploadBtn.classList.remove('is-busy');
        uploadBtn.textContent = 'Upload All (WebP)';
        showToast('error', err.message || 'Gagal mengunggah gambar. Coba lagi.');
        console.error(err);
      }
    });
  }

  /* ============================================================
   * 2. REORDER CANVAS (drag-to-sort grid)
   * ============================================================ */
  function initReorderCanvas() {
    const list = document.getElementById('reorderCanvasList');
    if (!list) return;

    const items = Array.from(list.querySelectorAll('.reorder-canvas__item'));
    if (!items.length) return;

    let dragPath = [];

    function renderReorderList() {
      list.innerHTML = '';
      state.items.forEach((item, idx) => {
        const el = createReorderItem(item, idx + 1);
        list.appendChild(el);
      });
    }

    function createReorderItem(item, rank) {
      const div = document.createElement('div');
      div.className = 'reorder-canvas__item';
      div.dataset.id = item.id || `item-${Date.now()}-${rank}`;
      // `item.name` & `item.image` berasal dari basis data — escape
      // keduanya sebelum masuk `innerHTML` supaya tidak jadi vektor
      // injeksi HTML (nama destinations bisa berisi karakter HTML).
      const nama = escapeHtml(item.name);
      const gambar = escapeHtml(item.image);
      div.innerHTML = `
        <div class="reorder-canvas__handle">☰</div>
        <div class="reorder-canvas__thumbnail">
          ${item.image ? `<img src="${gambar}" alt="${nama}">` : '<span class="gallery-empty">📷</span>'}
        </div>
        <div class="reorder-canvas__body">
          <div class="reorder-canvas__title">
            <span>${nama}</span>
            <span class="reorder-canvas__rank">Posisi ${rank}</span>
          </div>
          <div class="reorder-canvas__caption">${escapeHtml(item.tagline || '')}</div>
        </div>
      `;
      return div;
    }

    // ── Mouse drag ──────────────────────────────────────────────
    items.forEach((item) => {
      item.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.reorder-canvas__handle')) return;
        const id = item.dataset.id;
        const dragImage = item.cloneNode(true);
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        dragImage.style.opacity = '0.6';
        dragImage.style.pointerEvents = 'none';
        document.body.appendChild(dragImage);
        dragPath = [dragImage];

        state.draggingId = id;
        item.classList.add('is-dragging');

        const onMove = (ev) => {
          if (reduceMotion) return;
          ev.preventDefault();
          const rect = list.getBoundingClientRect();
          dragPath[0].style.left = (ev.clientX - rect.left) + 'px';
          dragPath[0].style.top = (ev.clientY - rect.top) + 'px';
          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          if (!target) return;
          const targetItem = target.closest('.reorder-canvas__item');
          if (!targetItem) return;
          const targetId = targetItem.dataset.id;
          if (targetId === id || state.overId === targetId) return;
          list.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
          targetItem.classList.add('is-over');
          state.overId = targetId;
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          dragPath.forEach((el) => el.remove());
          dragPath = [];
          state.draggingId = null;
          state.overId = null;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    // ── Touch drag ──────────────────────────────────────────────
    items.forEach((item) => {
      let touchId = null;
      item.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        touchId = t.identifier;
      }, { passive: true });
      item.addEventListener('touchmove', (e) => {
        const t = e.changedTouches[0];
        if (t.identifier !== touchId) return;
        if (reduceMotion) return;
        e.preventDefault();
        if (!dragPath.length) {
          const id = item.dataset.id;
          const dragImage = item.cloneNode(true);
          dragImage.style.position = 'absolute';
          dragImage.style.top = '-1000px';
          dragImage.style.opacity = '0.6';
          dragImage.style.pointerEvents = 'none';
          document.body.appendChild(dragImage);
          dragPath = [dragImage];
        }
        const rect = list.getBoundingClientRect();
        dragPath[0].style.left = (t.clientX - rect.left) + 'px';
        dragPath[0].style.top = (t.clientY - rect.top) + 'px';
        const target = document.elementFromPoint(t.clientX, t.clientY);
        if (!target) return;
        const targetItem = target.closest('.reorder-canvas__item');
        if (!targetItem) return;
        const targetId = targetItem.dataset.id;
        if (targetId === state.draggingId || state.overId === targetId) return;
        list.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
        targetItem.classList.add('is-over');
        state.overId = targetId;
      }, { passive: false });
      item.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        if (t.identifier !== touchId) return;
        list.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
        list.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
        if (state.draggingId && state.overId && state.overId !== state.draggingId) {
          const fromIdx = state.items.findIndex((i) => i.id === state.draggingId);
          const toIdx = state.items.findIndex((i) => i.id === state.overId);
          if (fromIdx !== -1 && toIdx !== -1) {
            const [moved] = state.items.splice(fromIdx, 1);
            const newToIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
            state.items.splice(newToIdx, 0, moved);
            renderReorderList();
            persistOrder();
          }
        }
        state.draggingId = null;
        state.overId = null;
        touchId = null;
        dragPath.forEach((el) => el.remove());
        dragPath = [];
      }, { passive: true });
    });

    // ── Persist order ───────────────────────────────────────────
    function persistOrder() {
      const order = state.items.map((item, idx) => ({ id: item.id || item.slug, rank: idx + 1 }));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch (e) { /* ignore */ }
    }

    // Expose for external use
    window.__reorderCanvas = { getOrder: () => state.items.map((i, idx) => ({ id: i.id || i.slug, rank: idx + 1 })), persistOrder };
  }

  /* ============================================================
   * 3. GRANULAR CONTROLS (Featured Hero toggle, caption, delete)
   * ============================================================ */
  function initGranularControls() {
    const featuredSwitches = document.querySelectorAll('.feature-switch input[type="checkbox"]');
    featuredSwitches.forEach((sw) => {
      sw.addEventListener('change', () => {
        const card = sw.closest('.granular-controls__card');
        if (!card) return;
        const label = card.querySelector('.feature-switch__label');
        if (label) label.classList.toggle('is-active', sw.checked);
        showToast('info', sw.checked
          ? `★ ${card.dataset.target || 'Destinasi'} dijadikan Featured Hero`
          : '★ Featured Hero dinonaktifkan');
      });
    });

    const captionEditors = document.querySelectorAll('.caption-editor textarea');
    captionEditors.forEach((ta) => {
      const wrapper = ta.closest('.caption-editor');
      const saveBtn = wrapper.querySelector('[data-save-caption]');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', () => {
        if (!ta.value.trim()) { showToast('error', 'Caption tidak boleh kosong.'); return; }
        showToast('success', '✓ Caption berhasil disimpan');
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveBtn.click(); }
      });
    });

    const checkboxes = document.querySelectorAll('.batch-delete input[type="checkbox"]');
    const batchBtn = document.querySelector('.batch-delete__btn');
    const countEl = document.querySelector('.batch-delete__count');
    if (checkboxes.length && batchBtn) {
      function updateBatchCount() {
        const checked = Array.from(checkboxes).filter((c) => c.checked).length;
        countEl.textContent = checked > 0 ? `${checked} dipilih` : 'Pilih item';
      }
      checkboxes.forEach((cb) => cb.addEventListener('change', updateBatchCount));
      updateBatchCount();
      batchBtn.addEventListener('click', async () => {
        const selected = Array.from(checkboxes).filter((c) => c.checked);
        if (!selected.length) return;
        if (!confirm('Hapus pilihan ini secara permanen?')) return;
        batchBtn.classList.add('is-busy');
        batchBtn.textContent = 'Menghapus…';
        showToast('info', `Menghapus ${selected.length} item…`);
        await new Promise((resolve) => setTimeout(resolve, 600));
        selected.forEach((cb) => {
          const card = cb.closest('.reorder-canvas__item');
          if (card) card.remove();
          cb.checked = false;
        });
        batchBtn.classList.remove('is-busy');
        batchBtn.textContent = 'Batch Delete';
        showToast('success', '✓ Berhasil menghapus pilihan');
        updateBatchCount();
      });
    }
  }

  /* ============================================================
   * 4. INIT
   * ============================================================ */
  function init() {
    // Inisialisasi TIDAK boleh dilewati saat pengguna memilih
    // "kurangi animasi" — upload sudah jadi nyata, jadi alur unggah harus
    // tetap berfungsi. `reduceMotion` hanya memengaruhi animasi visual.
    initUploadZone();
    initReorderCanvas();
    initGranularControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
