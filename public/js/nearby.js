'use strict';

/**
 * Halaman /sekitar — cari fasilitas terdekat lewat API /api/geo/nearby.
 *
 * Peta memakai Leaflet + tile OpenStreetMap (keduanya open source, tanpa key).
 * Semua permintaan data lewat server sendiri agar ter-cache dan tidak melanggar
 * kebijakan pemakaian Overpass/Nominatim.
 */
(function () {
  const configEl = document.getElementById('nearby-config');
  if (!configEl) return;

  let cfg = {};
  try {
    cfg = JSON.parse(configEl.textContent || '{}');
  } catch (err) {
    cfg = {};
  }

  const el = {
    locate: document.getElementById('geo-locate'),
    status: document.getElementById('geo-status'),
    form: document.getElementById('geo-search-form'),
    place: document.getElementById('geo-place'),
    placeResults: document.getElementById('geo-place-results'),
    dest: document.getElementById('geo-dest'),
    radius: document.getElementById('geo-radius'),
    chips: document.getElementById('geo-chips'),
    results: document.getElementById('geo-results'),
    map: document.getElementById('geo-map')
  };

  const STORAGE_KEY = 'syt_geo_center';
  const state = {
    center: null,
    category: (cfg.preset && cfg.preset.category) || 'transport',
    radius: 1200,
    places: [],
    loading: false,
    controller: null
  };

  const map = { instance: null, markers: null, center: null };

  /* ---------------------------------------------------------------- */
  /* Utilitas                                                          */
  /* ---------------------------------------------------------------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function fmtDistance(meters) {
    const m = Number(meters) || 0;
    if (m < 950) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  }

  function categoryMeta(key) {
    const list = cfg.categories || [];
    return list.find((c) => c.key === key) || { key: key, label: 'Fasilitas', icon: '📍' };
  }

  function setStatus(text, tone) {
    el.status.textContent = text;
    el.status.className = 'geo-status' + (tone ? ` is-${tone}` : '');
  }

  function saveCenter(center) {
    state.center = center;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(center));
    } catch (err) {
      /* mode privat: abaikan */
    }
  }

  function loadSavedCenter() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) return parsed;
    } catch (err) {
      /* abaikan */
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Peta                                                              */
  /* ---------------------------------------------------------------- */

  function initMap() {
    if (map.instance || !window.L || !el.map) return;
    map.instance = window.L.map(el.map, {
      center: [-2.5, 118],
      zoom: 5,
      scrollWheelZoom: false
    });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map.instance);
    map.markers = window.L.layerGroup().addTo(map.instance);
  }

  function drawMap(places, fit) {
    initMap();
    if (!map.instance) return;
    map.markers.clearLayers();

    if (state.center) {
      window.L.circleMarker([state.center.lat, state.center.lng], {
        radius: 9,
        color: '#0b3a44',
        weight: 3,
        fillColor: '#f2a65a',
        fillOpacity: 1
      })
        .bindPopup(`<strong>${escapeHtml(state.center.label || 'Lokasi Anda')}</strong>`)
        .addTo(map.markers);
    }

    const meta = categoryMeta(state.category);
    (places || []).forEach((p) => {
      const marker = window.L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: '#0b3a44',
        weight: 2,
        fillColor: '#2f9fb0',
        fillOpacity: 0.95
      });
      const links = [
        `<a href="${escapeHtml(p.osmUrl)}" target="_blank" rel="noopener">Detail OSM</a>`,
        `<a href="https://www.openstreetmap.org/directions?from=&to=${p.lat}%2C${p.lng}" target="_blank" rel="noopener">Rute</a>`
      ].join(' · ');
      marker.bindPopup(
        `<strong>${escapeHtml(p.name)}</strong><br>` +
        `${escapeHtml(p.typeLabel)} · ${fmtDistance(p.distance)}` +
        (p.address ? `<br><span>${escapeHtml(p.address)}</span>` : '') +
        `<br>${links}`
      );
      marker.bindTooltip(`${meta.icon} ${escapeHtml(p.name)}`);
      marker.addTo(map.markers);
    });

    if (fit && state.center) {
      const points = [[state.center.lat, state.center.lng]].concat(
        (places || []).slice(0, 40).map((p) => [p.lat, p.lng])
      );
      map.instance.fitBounds(points, { padding: [28, 28], maxZoom: 16 });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Data                                                              */
  /* ---------------------------------------------------------------- */

  async function loadNearby({ fit = true } = {}) {
    if (!state.center) {
      setStatus('Pilih lokasi dulu: gunakan GPS, ketik nama tempat, atau pilih destinasi.', 'warn');
      return;
    }
    if (!navigator.onLine) {
      renderOffline();
      return;
    }

    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    state.loading = true;

    const meta = categoryMeta(state.category);
    setStatus(`Mencari ${meta.label.toLowerCase()} dalam radius ${fmtDistance(state.radius)}…`, 'busy');
    el.results.setAttribute('aria-busy', 'true');

    const params = new URLSearchParams({
      lat: String(state.center.lat),
      lng: String(state.center.lng),
      category: state.category,
      radius: String(state.radius),
      limit: '30'
    });

    try {
      const res = await fetch(`/api/geo/nearby?${params.toString()}`, {
        signal: state.controller.signal,
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengambil data.');

      state.places = data.places || [];
      renderResults(data);
      drawMap(state.places, fit);
      const total = state.places.length;
      setStatus(
        total
          ? `${total} ${meta.label.toLowerCase()} ditemukan di sekitar ${state.center.label || 'lokasi ini'}.`
          : `Tidak ada ${meta.label.toLowerCase()} dalam radius ${fmtDistance(state.radius)}. Coba perbesar radius.`,
        total ? 'ok' : 'warn'
      );
    } catch (err) {
      if (err.name === 'AbortError') return;
      renderError(err.message || 'Gagal mengambil data. Periksa koneksi Anda.');
      setStatus(err.message || 'Gagal mengambil data.', 'error');
    } finally {
      state.loading = false;
      el.results.removeAttribute('aria-busy');
      state.controller = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  function emptyState(title, text) {
    return `<div class="geo-empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
  }

  function renderOffline() {
    el.results.innerHTML = emptyState(
      'Anda sedang offline',
      'Pencarian fasilitas butuh koneksi. Lokasi terakhir tetap tersimpan di perangkat; daftar akan muncul otomatis begitu sinyal kembali.'
    );
    setStatus('Offline — menunggu sinyal.', 'warn');
  }

  function renderError(message) {
    el.results.innerHTML = emptyState('Pencarian belum berhasil', message);
  }

  function renderResults(data) {
    const meta = categoryMeta(state.category);
    const places = data.places || [];
    if (!places.length) {
      el.results.innerHTML = emptyState(
        `Belum ada ${meta.label.toLowerCase()} di sini`,
        `Data OpenStreetMap untuk titik ini masih kosong pada radius ${fmtDistance(state.radius)}. Coba perbesar radius atau pindah titik pencarian.`
      );
      return;
    }

    const cards = places.map((p, index) => {
      const extras = [];
      if (p.openingHours) extras.push(`🕒 ${escapeHtml(p.openingHours)}`);
      if (p.phone) extras.push(`☎ <a href="tel:${escapeHtml(p.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(p.phone)}</a>`);
      if (p.website) {
        let host = '';
        try { host = new URL(p.website).hostname.replace(/^www\./, ''); } catch (e) { host = 'situs web'; }
        extras.push(`🌐 <a href="${escapeHtml(p.website)}" target="_blank" rel="noopener nofollow">${escapeHtml(host)}</a>`);
      }
      if (p.cuisine) extras.push(`🍴 ${escapeHtml(p.cuisine.replace(/;/g, ', '))}`);
      if (p.stars) extras.push(`⭐ ${escapeHtml(p.stars)}`);
      if (p.wheelchair === 'yes') extras.push('♿ Akses kursi roda');

      return `
        <article class="geo-card" data-place-index="${index}">
          <div class="geo-card__icon" aria-hidden="true">${escapeHtml(meta.icon)}</div>
          <div class="geo-card__body">
            <div class="geo-card__top">
              <h3>${escapeHtml(p.name)}</h3>
              <span class="geo-card__dist">${fmtDistance(p.distance)}</span>
            </div>
            <p class="geo-card__meta">${escapeHtml(p.typeLabel)}${p.address ? ' · ' + escapeHtml(p.address) : ''}</p>
            ${extras.length ? `<p class="geo-card__extra">${extras.join(' · ')}</p>` : ''}
            <div class="geo-card__links">
              <a href="https://www.openstreetmap.org/directions?from=${state.center ? state.center.lat + '%2C' + state.center.lng : ''}&to=${p.lat}%2C${p.lng}" target="_blank" rel="noopener">Rute di peta</a>
              <a href="geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}(${encodeURIComponent(p.name)})">Buka aplikasi peta</a>
              <a href="${escapeHtml(p.osmUrl)}" target="_blank" rel="noopener">Detail OSM</a>
            </div>
          </div>
        </article>`;
    });

    el.results.innerHTML = `
      <div class="geo-results__head">
        <h2>${escapeHtml(meta.label)} terdekat</h2>
        <p>${places.length} tempat · radius ${fmtDistance(state.radius)} dari ${escapeHtml(state.center.label || 'lokasi Anda')} · diurutkan dari yang paling dekat</p>
      </div>
      <div class="geo-results__list">${cards.join('')}</div>`;

    el.results.querySelectorAll('.geo-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        const place = places[Number(card.dataset.placeIndex)];
        if (!place) return;
        if (map.instance) {
          map.instance.setView([place.lat, place.lng], 17);
          if (map.markers) {
            map.markers.eachLayer((layer) => {
              if (layer.getLatLng && layer.getLatLng().lat === place.lat && layer.getLatLng().lng === place.lng) {
                layer.openPopup();
              }
            });
          }
          el.map.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Interaksi                                                         */
  /* ---------------------------------------------------------------- */

  function applyCenter(center, { fit = true, reverseName = false } = {}) {
    saveCenter(center);
    if (!center.label) {
      setStatus(`Lokasi: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`, 'busy');
    } else {
      setStatus(`Lokasi: ${center.label}`, 'ok');
    }
    initMap();
    if (map.instance) map.instance.setView([center.lat, center.lng], 14);
    loadNearby({ fit });

    if (reverseName && !center.label) {
      fetch(`/api/geo/reverse?lat=${center.lat}&lng=${center.lng}`, { headers: { Accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data || !data.name) return;
          saveCenter({ ...state.center, label: data.name });
          setStatus(`Lokasi: ${data.name}`, 'ok');
          const head = el.results.querySelector('.geo-results__head p');
          if (head) head.textContent = head.textContent.replace(/dari .*? · /, `dari ${data.name} · `);
        })
        .catch(() => {});
    }
  }

  function geolocate() {
    if (!navigator.geolocation) {
      setStatus('Perangkat ini tidak mendukung geolokasi. Ketik nama tempat atau pilih destinasi.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('Offline — GPS tetap bisa dibaca, tetapi pencarian menunggu sinyal.', 'warn');
    }
    el.locate.disabled = true;
    setStatus('Membaca GPS…', 'busy');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        el.locate.disabled = false;
        applyCenter(
          {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            label: '',
            accuracy: Math.round(pos.coords.accuracy || 0)
          },
          { fit: true, reverseName: true }
        );
      },
      (err) => {
        el.locate.disabled = false;
        const messages = {
          1: 'Izin lokasi ditolak. Aktifkan izin lokasi di browser, atau ketik nama tempat.',
          2: 'Lokasi tidak tersedia. Pastikan GPS aktif atau ketik nama tempat.',
          3: 'Waktu membaca GPS habis. Coba lagi di tempat terbuka.'
        };
        setStatus(messages[err.code] || 'Gagal membaca lokasi.', 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function searchPlace(query) {
    if (!query || query.trim().length < 3) {
      setStatus('Ketik minimal 3 karakter nama tempat.', 'warn');
      return;
    }
    el.placeResults.hidden = false;
    el.placeResults.innerHTML = '<p class="geo-place-results__hint">Mencari tempat…</p>';
    try {
      const res = await fetch(`/api/geo/places?q=${encodeURIComponent(query.trim())}`, {
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Pencarian gagal.');
      const places = data.places || [];
      if (!places.length) {
        el.placeResults.innerHTML = '<p class="geo-place-results__hint">Tempat tidak ditemukan. Coba nama lain.</p>';
        return;
      }
      el.placeResults.innerHTML = places
        .map(
          (p, i) => `
          <button type="button" class="geo-place-option" data-index="${i}">
            <strong>${escapeHtml(p.name)}</strong>
            <span>${escapeHtml(p.displayName)}</span>
          </button>`
        )
        .join('');
      el.placeResults.querySelectorAll('.geo-place-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = places[Number(btn.dataset.index)];
          el.placeResults.hidden = true;
          el.place.value = p.name;
          applyCenter({ lat: p.lat, lng: p.lng, label: p.name }, { fit: true });
        });
      });
    } catch (err) {
      el.placeResults.innerHTML = `<p class="geo-place-results__hint">${escapeHtml(err.message || 'Pencarian gagal.')}</p>`;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Binding                                                           */
  /* ---------------------------------------------------------------- */

  el.locate.addEventListener('click', geolocate);

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    searchPlace(el.place.value);
  });

  el.dest.addEventListener('change', () => {
    const option = el.dest.selectedOptions[0];
    if (!option || !option.value) return;
    applyCenter(
      {
        lat: parseFloat(option.dataset.lat),
        lng: parseFloat(option.dataset.lng),
        label: option.textContent.trim()
      },
      { fit: true }
    );
  });

  el.radius.addEventListener('change', () => {
    state.radius = Number(el.radius.value) || 1200;
    if (state.center) loadNearby({ fit: true });
  });

  el.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.geo-chip');
    if (!chip) return;
    state.category = chip.dataset.category;
    el.chips.querySelectorAll('.geo-chip').forEach((c) => {
      c.setAttribute('aria-selected', c === chip ? 'true' : 'false');
    });
    if (state.center) loadNearby({ fit: true });
  });

  window.addEventListener('online', () => {
    setStatus('Sinyal kembali — memuat ulang data.', 'busy');
    if (state.center) loadNearby({ fit: false });
  });
  window.addEventListener('offline', () => {
    setStatus('Offline — data terakhir tetap tampil.', 'warn');
  });

  /* ---------------------------------------------------------------- */
  /* Mulai                                                             */
  /* ---------------------------------------------------------------- */

  initMap();

  if (cfg.preset && Number.isFinite(cfg.preset.lat) && Number.isFinite(cfg.preset.lng)) {
    applyCenter(
      { lat: cfg.preset.lat, lng: cfg.preset.lng, label: cfg.preset.name || '' },
      { fit: true, reverseName: !cfg.preset.name }
    );
  } else {
    const saved = loadSavedCenter();
    if (saved) {
      applyCenter(saved, { fit: true, reverseName: !saved.label });
    } else if (navigator.onLine) {
      setStatus('Lokasi belum dipilih.', '');
    } else {
      renderOffline();
    }
  }

  // Sorot chip sesuai kategori awal.
  el.chips.querySelectorAll('.geo-chip').forEach((chip) => {
    chip.setAttribute('aria-selected', chip.dataset.category === state.category ? 'true' : 'false');
  });
})();
