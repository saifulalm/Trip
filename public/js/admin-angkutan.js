'use strict';

/**
 * admin-angkutan.js — interaksi halaman "Cari Angkutan Umum".
 *
 * Halaman ini bekerja tanpa JS (form GET biasa). Skrip ini hanya menambah:
 * - tombol "Gunakan lokasi saya" (Geolocation API),
 * - saling mengosongkan antara pilihan destinasi dan koordinat manual,
 * - state sibuk + skeleton saat form dikirim.
 */
(function () {
  const form = document.getElementById('transportForm');
  if (!form) return;

  const dest = document.getElementById('transportDest');
  const latInput = document.getElementById('transportLat');
  const lngInput = document.getElementById('transportLng');
  const submit = document.getElementById('transportSubmit');
  const skeleton = document.getElementById('transportSkeleton');
  const body = document.getElementById('transportResultsBody');
  const geoBtn = document.getElementById('useLocation');
  const geoStatus = document.getElementById('geoStatus');
  const results = document.querySelector('.transport-results');
  const draftKey = 'syt.transport.draft';

  function setStatus(text) {
    if (geoStatus) geoStatus.textContent = text || '';
  }

  function clearCoords() {
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
  }

  /* Destinasi dipilih → koordinat manual dikosongkan supaya server memakai
     titik destinasi. */
  if (dest) {
    dest.addEventListener('change', function () {
      if (dest.value) clearCoords();
      setStatus('');
    });
  }

  [latInput, lngInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener('input', function () {
      if (input.value && dest) dest.value = '';
    });
  });

  /* Simpan ketikan supaya tidak hilang saat halaman dimuat ulang. */
  try {
    const saved = sessionStorage.getItem(draftKey);
    if (saved && (latInput || lngInput)) {
      const draft = JSON.parse(saved);
      if (!latInput.value && !lngInput.value && draft && draft.lat) {
        if (latInput) latInput.value = draft.lat;
        if (lngInput) lngInput.value = draft.lng;
        if (dest) dest.value = '';
      }
    }
  } catch (err) {
    /* sessionStorage bisa diblokir; abaikan. */
  }

  form.addEventListener('input', function () {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ lat: latInput ? latInput.value : '', lng: lngInput ? lngInput.value : '' })
      );
    } catch (err) {
      /* abaikan */
    }
  });

  if (geoBtn) {
    geoBtn.addEventListener('click', function () {
      if (!navigator.geolocation) {
        setStatus('Perangkat ini tidak mendukung lokasi otomatis. Isi koordinat manual.');
        return;
      }
      geoBtn.disabled = true;
      setStatus('Meminta izin lokasi…');
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          geoBtn.disabled = false;
          if (dest) dest.value = '';
          if (latInput) latInput.value = pos.coords.latitude.toFixed(6);
          if (lngInput) lngInput.value = pos.coords.longitude.toFixed(6);
          setStatus(
            'Lokasi terpakai: ' +
              pos.coords.latitude.toFixed(5) +
              ', ' +
              pos.coords.longitude.toFixed(5) +
              '. Tekan “Cari sekarang”.'
          );
          if (submit) submit.focus();
        },
        function (err) {
          geoBtn.disabled = false;
          const pesan =
            err && err.code === 1
              ? 'Izin lokasi ditolak. Isi koordinat manual atau pilih destinasi.'
              : 'Lokasi tidak tersedia sekarang. Isi koordinat manual atau pilih destinasi.';
          setStatus(pesan);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  form.addEventListener('submit', function (event) {
    const lat = latInput ? latInput.value.trim() : '';
    const lng = lngInput ? lngInput.value.trim() : '';
    const hasDest = dest && dest.value;

    if (!hasDest && (!lat || !lng)) {
      event.preventDefault();
      setStatus('Pilih destinasi atau isi latitude dan longitude lebih dulu.');
      if (latInput) latInput.focus();
      return;
    }

    if (!hasDest && (isNaN(Number(lat)) || isNaN(Number(lng)))) {
      event.preventDefault();
      setStatus('Koordinat harus berupa angka, mis. -0.4719 dan 130.7515.');
      if (latInput) latInput.focus();
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.querySelector('.ico') && submit.classList.add('is-loading');
    }
    if (results) results.classList.add('is-search-busy');
    if (skeleton) skeleton.hidden = false;
    if (body) body.querySelectorAll('.transport-results__stale, .a-empty').forEach(function (el) {
      el.setAttribute('aria-hidden', 'true');
    });
  });
})();
