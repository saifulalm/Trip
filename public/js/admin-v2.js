'use strict';
/**
 * Admin panel v2 — interaksi sidebar & topbar.
 *
 * Tidak memengaruhi: modul ini HANYA menangani tampilan. Tidak ada form, tidak ada
 * request jaringan, tidak ada perubahan state server. Semua aksi tetap
 * memakai form & route yang sudah ada.
 */
(function () {
  /* =========================================================
     1. Pencarian menu sidebar (filter client-side)
     ========================================================= */
  var search = document.getElementById('adminNavSearch');
  var nav = document.getElementById('adminNav');
  var empty = document.getElementById('adminNavEmpty');

  if (search && nav) {
    var items = Array.prototype.slice.call(nav.querySelectorAll('[data-nav-item]'));
    var labels = Array.prototype.slice.call(nav.querySelectorAll('.admin-nav__label'));

    /**
     * Terapkan filter pada daftar menu.
     * @param {string} query teks pencarian (lowercase)
     */
    function filterMenu(query) {
      var q = String(query || '').trim().toLowerCase();
      var visible = 0;

      items.forEach(function (item) {
        // Cocok bila teks menu ATAU kata kunci tambahan (data-nav-text) memuat query.
        var label = (item.textContent || '').toLowerCase();
        var keywords = (item.getAttribute('data-nav-text') || '').toLowerCase();
        var match = !q || label.indexOf(q) !== -1 || keywords.indexOf(q) !== -1;
        item.hidden = !match;
        if (match) visible += 1;
      });

      // Sembunyikan label grup yang tidak punya item terlihat di bawahnya.
      //
      // CATATAN: perulangan WAJIB berhenti saat ketemu label grup
      // berikutnya. Kalau tidak, label pertama ("Ringkasan") akan terus
      // menelusuri seluruh menu dan menemukan item yang terlihat milik
      // grup lain → semua label tetap tampil walau hanya 1 menu cocok.
      labels.forEach(function (label) {
        var next = label.nextElementSibling;
        var hasVisible = false;
        while (next) {
          // Berhenti di label grup berikutnya — jangan mencari item milik
          // grup lain.
          if (next.classList && next.classList.contains('admin-nav__label')) break;
          if (next.tagName === 'A' && !next.hidden) { hasVisible = true; break; }
          next = next.nextElementSibling;
        }
        label.hidden = !hasVisible;
      });

      if (empty) empty.hidden = visible > 0;
    }

    search.addEventListener('input', function () {
      filterMenu(search.value);
    });

    // Escape mengembalikan seluruh menu.
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        search.value = '';
        filterMenu('');
        search.blur();
      }
    });
  }

  /* =========================================================
     2. Dropdown menu user
     ========================================================= */
  var userBtn = document.getElementById('adminUserBtn');
  var userPop = document.getElementById('adminUserPop');

  if (userBtn && userPop) {
    /**
     * Buka/tutup dropdown user.
     * @param {boolean} open true = buka
     */
    function setUserMenu(open) {
      userPop.hidden = !open;
      userBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    userBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setUserMenu(userPop.hidden);
    });

    // Klik di luar menutup dropdown.
    document.addEventListener('click', function (e) {
      if (userPop.hidden) return;
      var wrap = document.getElementById('adminUserMenu');
      if (wrap && !wrap.contains(e.target)) setUserMenu(false);
    });

    // Escape menutup dropdown dan mengembalikan fokus ke pemicu.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (userPop.hidden) return;
      setUserMenu(false);
      userBtn.focus();
    });

    // Tutup dropdown bila layar mengecil (menu user disembunyikan di mobile).
    window.addEventListener('resize', function () {
      if (userPop.hidden) return;
      if (window.matchMedia('(max-width: 640px)').matches) setUserMenu(false);
    });
  }

  /* =========================================================
     3. Gulir item menu aktif ke dalam pandangan
     ========================================================= */
  var active = document.querySelector('.admin-nav a.active');
  if (active && nav && nav.scrollHeight > nav.clientHeight) {
    // Tunda sampai layout selesai (font & aset selesai dimuat).
    window.setTimeout(function () {
      var top = active.offsetTop - nav.clientHeight / 2 + active.offsetHeight / 2;
      nav.scrollTop = Math.max(0, top);
    }, 120);
  }
})();
