'use strict';

/**
 * Peta Leaflet terpusat untuk portal pelanggan & admin.
 *
 * Membaca data dari <script id="map-data" type="application/json"> yang
 * ditanam di halaman:
 *   { dest: {lat,lng,name}|null, checkIn: {lat,lng,at,accuracy}|null,
 *     track: [{label,lat,lng}], live: {lat,lng,accuracy}|null }
 *
 * Menyediakan window.SylMap agar halaman "Lokasi Saya" bisa menyuntik
 * marker posisi live tanpa me-render ulang peta.
 */
(function () {
  // Peer presence disimpan di scope modul supaya api.setPeers bisa dipakai
  // SEBELUM peta selesai di-init (modul presence dimuat lebih dulu).
  var peerMarkers = [];
  var pendingPeers = [];

  var api = {
    map: null,
    peerMarkers: peerMarkers,
    setLive: function (lat, lng, accuracy) { return false; },
    setPeers: function (peers) { return false; },
    focus: function (lat, lng) {}
  };
  window.SylMap = api;

  /**
   * Pasang / perbarui marker peer di peta.
   * Bila peta belum siap, peer disimpan sebagai antrean dan dipasang
   * otomatis setelah peta ter-init.
   */
  api.setPeers = function (peers) {
    pendingPeers = peers || [];
    if (!api.map) return false;
    peerMarkers.forEach(function (m) {
      api.map.removeLayer(m);
    });
    peerMarkers = [];
    api.peerMarkers = peerMarkers;
    pendingPeers.forEach(function (p) {
      if (!p || typeof p.lat !== 'number') return;
      var isAdmin = p.role === 'admin';
      var m = L.circleMarker([p.lat, p.lng], {
        radius: 8,
        color: isAdmin ? '#166b7a' : '#7c3aed',
        fillColor: isAdmin ? '#2f9fb0' : '#a78bfa',
        fillOpacity: 0.9,
        weight: 2
      }).addTo(api.map);
      m.bindPopup(
        '<strong>' + (isAdmin ? '🧭 Tim: ' : '👤 ') + (p.name || '-') + '</strong>' +
        (p.label ? '<br>' + p.label : '') +
        '<br>' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) +
        (typeof p.distance === 'number' ? '<br>Jarak ± ' + Math.round(p.distance) + ' m' : '') +
        (p.stale ? '<br><em>offline — data terakhir</em>' : '')
      );
      peerMarkers.push(m);
    });
    api.peerMarkers = peerMarkers;
    pendingPeers = [];
    return true;
  };

  function init() {
    var el = document.getElementById('syl-map');
    var dataEl = document.getElementById('map-data');
    if (!el || !dataEl || typeof L === 'undefined') return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (e) {
      return;
    }
    if (!data) data = {};

    var track = Array.isArray(data.track) ? data.track : [];

    // Titik awal: posisi live > check-in > destinasi > tengah Indonesia.
    var start = data.live || data.checkIn || data.dest || { lat: -2.5, lng: 118.0 };
    var zoom = data.live || data.checkIn || track.length ? 13 : 6;
    var map = L.map(el).setView([start.lat, start.lng], zoom);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    var bounds = [];
    var liveMarker = null;

    function addLiveMarker(lat, lng, accuracy) {
      if (liveMarker) {
        liveMarker.setLatLng([lat, lng]);
        return liveMarker;
      }
      liveMarker = L.circleMarker([lat, lng], {
        radius: 10,
        color: '#166b7a',
        fillColor: '#2f9fb0',
        fillOpacity: 0.95,
        weight: 3
      }).addTo(map);
      liveMarker.bindPopup(
        '<strong>📍 Posisi Anda Saat Ini</strong><br>' +
          lat.toFixed(5) + ', ' + lng.toFixed(5) +
          (accuracy ? '<br>Akurasi ± ' + Math.round(accuracy) + ' m' : '')
      );
      return liveMarker;
    }

    if (data.dest && typeof data.dest.lat === 'number') {
      var destMarker = L.marker([data.dest.lat, data.dest.lng]).addTo(map);
      destMarker.bindPopup('<strong>Destinasi:</strong> ' + (data.dest.name || '-'));
      bounds.push([data.dest.lat, data.dest.lng]);
    }

    if (track.length) {
      var latlngs = track
        .filter(function (p) { return typeof p.lat === 'number' && typeof p.lng === 'number'; })
        .map(function (p) { return [p.lat, p.lng]; });
      if (latlngs.length) {
        L.polyline(latlngs, { color: '#0f4c47', weight: 3, dashArray: '6 8' }).addTo(map);
        track.forEach(function (p) {
          if (typeof p.lat !== 'number') return;
          var m = L.circleMarker([p.lat, p.lng], {
            radius: 6,
            color: '#f2a65a',
            fillColor: '#f2a65a',
            fillOpacity: 0.9
          }).addTo(map);
          m.bindPopup('<strong>' + (p.label || 'Waypoint') + '</strong>');
          bounds.push([p.lat, p.lng]);
        });
      }
    }

    if (data.checkIn && typeof data.checkIn.lat === 'number') {
      var ciMarker = L.circleMarker([data.checkIn.lat, data.checkIn.lng], {
        radius: 9,
        color: '#c96f4a',
        fillColor: '#c96f4a',
        fillOpacity: 0.95
      }).addTo(map);
      ciMarker.bindPopup(
        '<strong>📍 Check-in GPS</strong><br>' +
          (data.checkIn.at ? new Date(data.checkIn.at).toLocaleString('id-ID') : '') +
          (data.checkIn.accuracy ? '<br>Akurasi ± ' + Math.round(data.checkIn.accuracy) + ' m' : '')
      );
      bounds.push([data.checkIn.lat, data.checkIn.lng]);
    }

    if (data.live && typeof data.live.lat === 'number') {
      addLiveMarker(data.live.lat, data.live.lng, data.live.accuracy);
      bounds.push([data.live.lat, data.live.lng]);
    }

    // Peer presence (admin/pelanggan lain yang sedang membagikan lokasi).
    // Marker ini ditandai berbeda dari check-in & posisi live.
    var peers = Array.isArray(data.peers) ? data.peers : [];
    peers.forEach(function (p) {
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
      bounds.push([p.lat, p.lng]);
    });

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    api.map = map;
    // Peer yang tiba sebelum peta siap dijawab di sini.
    if (peers.length) api.setPeers(peers);
    api.setLive = function (lat, lng, accuracy) {
      if (typeof lat !== 'number' || typeof lng !== 'number') return false;
      addLiveMarker(lat, lng, accuracy);
      return true;
    };
    api.focus = function (lat, lng) {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      map.setView([lat, lng], Math.max(map.getZoom(), 14));
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
