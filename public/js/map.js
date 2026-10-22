'use strict';

/**
 * Peta Leaflet terpusat untuk portal pelanggan & admin.
 * Membaca data dari <script id="map-data" type="application/json"> yang
 * ditanam di halaman: { dest: {lat,lng,name} | null, checkIn: {lat,lng,at} | null, track: [{label,lat,lng}] }
 */
(function () {
  function init() {
    var el = document.getElementById('jje-map');
    var dataEl = document.getElementById('map-data');
    if (!el || !dataEl || typeof L === 'undefined') return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (e) {
      return;
    }

    // Titik awal: check-in > destinasi > tengah Indonesia.
    var start = data.checkIn || data.dest || { lat: -2.5, lng: 118.0 };
    var map = L.map(el).setView([start.lat, start.lng], data.checkIn || data.track.length ? 12 : 6);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    var bounds = [];

    if (data.dest && typeof data.dest.lat === 'number') {
      var destMarker = L.marker([data.dest.lat, data.dest.lng]).addTo(map);
      destMarker.bindPopup('<strong>Destinasi:</strong> ' + (data.dest.name || '-'));
      bounds.push([data.dest.lat, data.dest.lng]);
    }

    if (Array.isArray(data.track) && data.track.length) {
      var latlngs = data.track
        .filter(function (p) { return typeof p.lat === 'number' && typeof p.lng === 'number'; })
        .map(function (p) { return [p.lat, p.lng]; });
      if (latlngs.length) {
        L.polyline(latlngs, { color: '#0f4c47', weight: 3, dashArray: '6 8' }).addTo(map);
        data.track.forEach(function (p) {
          if (typeof p.lat !== 'number') return;
          var m = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#f2a65a', fillColor: '#f2a65a', fillOpacity: 0.9 }).addTo(map);
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

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();