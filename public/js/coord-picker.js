'use strict';
/**
 * coord-picker.js — Pemilih koordinat Latitude/Longitude di Admin Panel.
 *
 * - Peta Leaflet dengan marker yang bisa digeser.
 * - Klik peta → isi Latitude & Longitude otomatis.
 * - Ketik manual → marker ikut bergerak.
 * - Validasi rentang langsung: Latitude −90..90, Longitude −180..180.
 * - Tanpa Leaflet (CDN gagal) form tetap bisa diisi manual, hanya peta
 *   yang dilewati — tidak ada yang rusak.
 */
(function () {
  var latInput = document.getElementById('latInput');
  var lngInput = document.getElementById('lngInput');
  var mapEl = document.getElementById('coordMap');
  var statusEl = document.getElementById('coordStatus');
  var statusText = document.getElementById('coordStatusText');
  if (!latInput || !lngInput) return;

  var LAT_MIN = -90;
  var LAT_MAX = 90;
  var LNG_MIN = -180;
  var LNG_MAX = 180;
  var DEFAULT_CENTER = [-2.5, 118.0];

  /* ---------------- Validasi ---------------- */
  function parseNum(v) {
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (s === '') return null;
    if (!/^[+-]?\d*\.?\d+$/.test(s)) return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  function setError(field, message) {
    var el = document.querySelector('[data-err-for="' + field + '"]');
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function validateField(field, input, min, max, label) {
    var raw = input.value;
    if (String(raw).trim() === '') {
      setError(field, '');
      input.removeAttribute('aria-invalid');
      return null;
    }
    var n = parseNum(raw);
    if (Number.isNaN(n)) {
      setError(field, label + ' harus berupa angka desimal (contoh: -0.4719).');
      input.setAttribute('aria-invalid', 'true');
      return null;
    }
    if (n < min || n > max) {
      setError(field, label + ' harus antara ' + min + ' s/d ' + max + '.');
      input.setAttribute('aria-invalid', 'true');
      return null;
    }
    setError(field, '');
    input.removeAttribute('aria-invalid');
    return n;
  }

  function validateAll() {
    var lat = validateField('lat', latInput, LAT_MIN, LAT_MAX, 'Latitude');
    var lng = validateField('lng', lngInput, LNG_MIN, LNG_MAX, 'Longitude');
    updateStatus(lat, lng);
    return { lat: lat, lng: lng };
  }

  function updateStatus(lat, lng) {
    if (!statusEl || !statusText) return;
    var dot = statusEl.querySelector('.coord-status__dot');
    if (lat !== null && lng !== null) {
      statusText.textContent = 'Koordinat valid — ' + lat.toFixed(6) + ', ' + lng.toFixed(6);
      statusEl.classList.add('is-valid');
      statusEl.classList.remove('is-invalid');
    } else if (lat !== null || lng !== null) {
      statusText.textContent = 'Isi Latitude dan Longitude sekaligus.';
      statusEl.classList.add('is-invalid');
      statusEl.classList.remove('is-valid');
    } else {
      statusText.textContent = 'Belum ada koordinat.';
      statusEl.classList.remove('is-valid', 'is-invalid');
    }
    if (dot) dot.style.background = '';
  }

  /* ---------------- Peta (opsional) ---------------- */
  var map = null;
  var marker = null;

  function buildMap() {
    if (typeof L === 'undefined' || !mapEl) return;
    try {
      var startLat = parseNum(latInput.value);
      var startLng = parseNum(lngInput.value);
      var hasStart = Number.isFinite(startLat) && Number.isFinite(startLng);
      var center = hasStart ? [startLat, startLng] : DEFAULT_CENTER;

      map = L.map(mapEl).setView(center, hasStart ? 12 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      marker = L.marker(center, { draggable: true }).addTo(map);

      marker.on('dragend', function () {
        var p = marker.getLatLng();
        latInput.value = p.lat.toFixed(6);
        lngInput.value = p.lng.toFixed(6);
        validateAll();
      });

      map.on('click', function (e) {
        var lat = e.latlng.lat;
        var lng = e.latlng.lng;
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
        marker.setLatLng(e.latlng);
        validateAll();
      });

      if (hasStart) {
        marker.setLatLng([startLat, startLng]);
        map.setView(center, 12);
      } else {
        marker.setLatLng(center);
      }
      mapEl.classList.add('is-ready');
    } catch (err) {
      /* Peta gagal diinisialisasi — form manual tetap berfungsi. */
      if (window.console) console.warn('coord-picker: peta tidak tersedia', err);
    }
  }

  /* ---------------- Sinkronisasi input ↔ peta ---------------- */
  function syncFromInputs() {
    var lat = parseNum(latInput.value);
    var lng = parseNum(lngInput.value);
    if (!map || !marker) return;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng], Math.max(map.getZoom(), 10));
    }
  }

  [latInput, lngInput].forEach(function (input) {
    input.addEventListener('input', function () {
      validateAll();
      syncFromInputs();
    });
    input.addEventListener('blur', validateAll);
  });

  /* ---------------- Cegah submit bila koordinat tidak valid ---------------- */
  var form = document.getElementById('destForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      var lat = validateField('lat', latInput, LAT_MIN, LAT_MAX, 'Latitude');
      var lng = validateField('lng', lngInput, LNG_MIN, LNG_MAX, 'Longitude');
      var latFilled = String(latInput.value).trim() !== '';
      var lngFilled = String(lngInput.value).trim() !== '';
      if ((latFilled && lat === null) || (lngFilled && lng === null) || (latFilled !== lngFilled)) {
        e.preventDefault();
        updateStatus(lat, lng);
        var firstBad = latFilled && lat === null ? latInput : lngInput;
        firstBad.focus();
        if (window.showToast) {
          window.showToast('Koordinat tidak valid. Periksa Latitude (-90..90) dan Longitude (-180..180).', 'error');
        }
      }
    });
  }

  validateAll();
  buildMap();
})();
