'use strict';
/**
 * admin-table.js — pencarian real-time (debounced) + sorting + pagination
 * untuk seluruh tabel Admin Panel.
 *
 * Cara kerja:
 *  - Setiap form pencarian ditandai `data-live-search`.
 *  - Oblast tabel dibungkus `<div class="table-region" data-partial-url="...">`.
 *  - Saat mengetik, script melakukan fetch ke URL yang sama + `partial=1`,
 *    lalu mengganti isi tabel dengan HTML balasan.
 *  - Server tetap menjadi sumber data (bukan filter di sisi client), jadi
 *    pagination & sorting tetap akurat untuk dataset besar.
 *  - Tanpa JS: form tetap bekerja normal (submit biasa → reload halaman).
 */
(function () {
  var DEBOUNCE_MS = 320;

  function toast(msg, type) {
    if (window.showToast) window.showToast(msg, type);
    else if (window.console) console.warn(msg);
  }

  function initForm(form) {
    var panel = form.closest('.panel') || document;
    var region = panel.querySelector('.table-region');
    if (!region) return;

    var searchBox = form.querySelector('.search-box');
    var input = form.querySelector('input[name="q"]');
    var meta = form.querySelector('[data-search-meta]');
    var baseUrl = region.getAttribute('data-partial-url') || form.getAttribute('action') || window.location.pathname;
    var timer = null;
    var inflight = null;
    var lastRequest = 0;

    /* Status pencarian saat ini (sumber kebenaran untuk URL & request). */
    var initial = new URLSearchParams(window.location.search);
    var state = {
      q: initial.get('q') || '',
      status: initial.get('status') || '',
      sort: initial.get('sort') || '',
      dir: initial.get('dir') || '',
      page: initial.get('page') || ''
    };

    function readForm() {
      var data = new FormData(form);
      state.q = (data.get('q') || '').toString();
      state.status = (data.get('status') || '').toString();
    }

    function buildUrl(extra) {
      var params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.status) params.set('status', state.status);
      if (state.sort) params.set('sort', state.sort);
      if (state.dir) params.set('dir', state.dir);
      if (state.page) params.set('page', state.page);
      if (extra) {
        Object.keys(extra).forEach(function (key) {
          var v = extra[key];
          if (v === null || v === undefined || v === '') {
            params.delete(key);
            state[key] = '';
          } else {
            params.set(key, v);
            state[key] = v;
          }
        });
      }
      params.set('partial', '1');
      return baseUrl + '?' + params.toString();
    }

    function visibleUrl() {
      var params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.status) params.set('status', state.status);
      if (state.sort) params.set('sort', state.sort);
      if (state.dir) params.set('dir', state.dir);
      if (state.page) params.set('page', state.page);
      var s = params.toString();
      return window.location.pathname + (s ? '?' + s : '');
    }

    function setLoading(on) {
      if (searchBox) searchBox.classList.toggle('is-loading', on);
    }

    function updateMeta(html) {
      if (!meta) return;
      var m = html.match(/dari\s+([\d.]+)/i);
      if (m) meta.textContent = m[1] + ' hasil';
    }

    function load(extra) {
      readForm();
      var url = buildUrl(extra);
      var seq = ++lastRequest;
      setLoading(true);

      if (inflight) inflight.abort();
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      inflight = controller;

      fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal: controller ? controller.signal : undefined,
        credentials: 'same-origin'
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (html) {
          if (seq !== lastRequest) return; // respons lama dibuang
          region.innerHTML = html;
          updateMeta(html);
          try {
            window.history.replaceState({}, '', visibleUrl());
          } catch (e) {
            /* history tidak tersedia — abaikan */
          }
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          toast('Gagal memuat data: ' + (err.message || 'kesalahan jaringan') + '. Coba muat ulang halaman.', 'error');
        })
        .finally(function () {
          if (seq === lastRequest) setLoading(false);
        });
    }

    /* ---- Ketik: debounce ---- */
    if (input) {
      input.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          load({ page: null }); // kembali ke halaman 1 saat filter berubah
        }, DEBOUNCE_MS);
      });
      // Submit manual tetap didukung (tanpa JS pun form bekerja).
      form.addEventListener('submit', function (e) {
        if (!window.fetch) return; // fallback: submit normal
        e.preventDefault();
        clearTimeout(timer);
        load({ page: null });
      });
    }

    /* ---- Ganti filter (select) ---- */
    form.querySelectorAll('select[name]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        load({ page: null });
      });
    });

    /* ---- Klik pagination & header sorting (event delegation) ---- */
    region.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (!link) return;
      var href = link.getAttribute('href') || '';

      // Sorting
      if (link.closest('th.is-sortable')) {
        e.preventDefault();
        var sp = new URLSearchParams(href.split('?')[1] || '');
        load({ sort: sp.get('sort'), dir: sp.get('dir'), page: null });
        return;
      }

      // Pagination
      if (link.classList.contains('disabled')) {
        e.preventDefault();
        return;
      }
      if (href.indexOf('?') !== -1) {
        e.preventDefault();
        var p = new URLSearchParams(href.split('?')[1] || '');
        load({ page: p.get('page'), sort: p.get('sort'), dir: p.get('dir') });
      }
    });

    /* ---- Pintasan: "/" untuk fokus pencarian ---- */
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  function boot() {
    document.querySelectorAll('form[data-live-search]').forEach(initForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
