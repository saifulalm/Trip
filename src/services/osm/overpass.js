'use strict';

/**
 * Pencarian fasilitas terdekat lewat Overpass API (OpenStreetMap).
 *
 * Kenapa Overpass: seluruh datanya OpenStreetMap (ODbL) — open source, tanpa
 * API key, tanpa biaya, dan mencakup Indonesia jauh lebih lengkap daripada
 * layanan berbayar untuk halte, dermaga feri, dan guest house kecil.
 *
 * Aturan yang dipatuhi (lihat https://wiki.openstreetmap.org/wiki/Overpass_API):
 *  - satu User-Agent yang jelas & bisa dihubungi,
 *  - hasil di-cache (default 10 menit) dan permintaan dibatasi,
 *  - endpoint cadangan dipakai bila server utama sibuk/limit.
 */

const { createCache } = require('./cache');
const fallback = require('./fallback');
const nominatim = require('./nominatim');

const ATTRIBUTION = 'Data peta © kontributor OpenStreetMap (ODbL)';

function endpoints() {
  const custom = String(process.env.GEO_OVERPASS_URL || '').trim();
  if (custom) return [custom];
  return [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
}

function userAgent() {
  return (
    String(process.env.GEO_USER_AGENT || '').trim() ||
    `Seayoulatertrip/1.0 (+${String(process.env.SITE_URL || 'https://seayoulatertrip.com').trim()})`
  );
}

function timeoutMs() {
  const n = Number(process.env.GEO_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 2000 ? n : 20000;
}

/* ------------------------------------------------------------------ */
/* Kategori fasilitas                                                  */
/* ------------------------------------------------------------------ */

/**
 * Setiap kategori = daftar filter [key, nilai[]] yang digabung dengan OR.
 * Urutan filter menentukan label tipe yang dipakai saat tag punya beberapa
 * kunci sekaligus (mis. amenity=ferry_terminal + public_transport=station).
 */
const CATEGORIES = {
  transport: {
    label: 'Angkutan Umum',
    icon: '🚌',
    hint: 'Terminal, halte, dermaga feri, bandara, taksi',
    filters: [
      ['amenity', ['bus_station', 'ferry_terminal', 'taxi', 'car_rental']],
      ['public_transport', ['station', 'stop_position', 'platform']],
      ['railway', ['station', 'halt']],
      ['aeroway', ['aerodrome']],
      ['harbour', ['yes']]
    ]
  },
  hotel: {
    label: 'Hotel & Penginapan',
    icon: '🏨',
    hint: 'Hotel, guest house, hostel, resort, camping',
    filters: [
      [
        'tourism',
        ['hotel', 'guest_house', 'hostel', 'resort', 'apartment', 'motel', 'chalet', 'camp_site']
      ]
    ]
  },
  restaurant: {
    label: 'Restoran & Kafe',
    icon: '🍽️',
    hint: 'Restoran, warung, kafe, food court',
    filters: [['amenity', ['restaurant', 'cafe', 'fast_food', 'food_court', 'bar', 'pub']]]
  },
  atm: {
    label: 'ATM & Bank',
    icon: '🏧',
    hint: 'ATM, bank, money changer',
    filters: [['amenity', ['atm', 'bank', 'bureau_de_change']]]
  },
  health: {
    label: 'Kesehatan',
    icon: '🏥',
    hint: 'Rumah sakit, klinik, apotek, dokter',
    filters: [['amenity', ['hospital', 'clinic', 'pharmacy', 'doctors']]]
  },
  emergency: {
    label: 'Darurat & Keamanan',
    icon: '🚓',
    hint: 'Polisi, pemadam kebakaran, pos penjaga',
    filters: [['amenity', ['police', 'fire_station', 'ranger_station']]]
  },
  fuel: {
    label: 'BBM & Charger',
    icon: '⛽',
    hint: 'SPBU dan stasiun pengisian listrik',
    filters: [['amenity', ['fuel', 'charging_station']]]
  },
  market: {
    label: 'Toko & Pasar',
    icon: '🛒',
    hint: 'Pasar, supermarket, minimarket',
    filters: [
      ['amenity', ['marketplace']],
      ['shop', ['supermarket', 'convenience', 'grocery']]
    ]
  }
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);

const TYPE_LABELS = {
  'amenity:bus_station': 'Terminal bus',
  'amenity:ferry_terminal': 'Dermaga feri',
  'amenity:taxi': 'Pangkalan taksi',
  'amenity:car_rental': 'Rental mobil',
  'public_transport:station': 'Stasiun/terminal',
  'public_transport:stop_position': 'Titik halte',
  'public_transport:platform': 'Peron/halte',
  'railway:station': 'Stasiun kereta',
  'railway:halt': 'Halte kereta',
  'aeroway:aerodrome': 'Bandara',
  'harbour:yes': 'Pelabuhan',
  'tourism:hotel': 'Hotel',
  'tourism:guest_house': 'Guest house',
  'tourism:hostel': 'Hostel',
  'tourism:resort': 'Resort',
  'tourism:apartment': 'Apartemen',
  'tourism:motel': 'Motel',
  'tourism:chalet': 'Chalet',
  'tourism:camp_site': 'Camping',
  'amenity:restaurant': 'Restoran',
  'amenity:cafe': 'Kafe',
  'amenity:fast_food': 'Makanan cepat saji',
  'amenity:food_court': 'Food court',
  'amenity:bar': 'Bar',
  'amenity:pub': 'Pub',
  'amenity:atm': 'ATM',
  'amenity:bank': 'Bank',
  'amenity:bureau_de_change': 'Money changer',
  'amenity:hospital': 'Rumah sakit',
  'amenity:clinic': 'Klinik',
  'amenity:pharmacy': 'Apotek',
  'amenity:doctors': 'Praktik dokter',
  'amenity:police': 'Kantor polisi',
  'amenity:fire_station': 'Pemadam kebakaran',
  'amenity:ranger_station': 'Pos penjaga',
  'amenity:fuel': 'SPBU',
  'amenity:charging_station': 'Pengisian listrik',
  'amenity:marketplace': 'Pasar',
  'shop:supermarket': 'Supermarket',
  'shop:convenience': 'Minimarket',
  'shop:grocery': 'Toko kelontong'
};

const FALLBACK_LABELS = {
  transport: 'Sarana angkutan umum',
  hotel: 'Penginapan',
  restaurant: 'Tempat makan',
  atm: 'ATM/Bank',
  health: 'Fasilitas kesehatan',
  emergency: 'Layanan darurat',
  fuel: 'SPBU',
  market: 'Toko'
};

/* ------------------------------------------------------------------ */
/* Utilitas                                                            */
/* ------------------------------------------------------------------ */

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Jarak great-circle (meter) antara dua koordinat. */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function clampCoord(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Label tipe yang enak dibaca: "Dermaga feri", bukan "ferry_terminal". */
function typeLabel(tags) {
  for (const key of Object.keys(tags)) {
    const label = TYPE_LABELS[`${key}:${tags[key]}`];
    if (label) return label;
  }
  return 'Fasilitas';
}

function typeKey(tags) {
  for (const key of Object.keys(tags)) {
    if (TYPE_LABELS[`${key}:${tags[key]}`]) return `${key}:${tags[key]}`;
  }
  return '';
}

function addressOf(tags) {
  const parts = [];
  if (tags['addr:street']) {
    parts.push(tags['addr:housenumber'] ? `${tags['addr:street']} No. ${tags['addr:housenumber']}` : tags['addr:street']);
  }
  const area = tags['addr:village'] || tags['addr:suburb'] || tags['addr:city'] || tags['addr:district'];
  if (area) parts.push(area);
  if (tags['addr:postcode']) parts.push(tags['addr:postcode']);
  return parts.join(', ');
}

/** Query Overpass QL untuk satu kategori di sekitar satu titik. */
function buildQuery({ lat, lng, radius, category }) {
  const cat = CATEGORIES[category];
  if (!cat) throw new Error(`Kategori tidak dikenal: ${category}`);
  const r = Math.round(radius);
  const point = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  const timeoutSec = Math.max(5, Math.ceil(timeoutMs() / 1000));
  const clauses = [];
  for (const [key, values] of cat.filters) {
    const re = `^(${values.map(escapeRe).join('|')})$`;
    // node + way sudah mencakup hampir semua POI; relation memperlambat query
    // tanpa menambah hasil berarti untuk halte, hotel, dan restoran.
    for (const kind of ['node', 'way']) {
      clauses.push(`${kind}(around:${r},${point})["${key}"~"${re}"];`);
    }
  }
  return `[out:json][timeout:${timeoutSec}];\n(\n  ${clauses.join('\n  ')}\n);\nout center tags 60;`;
}

function coordinatesOf(el) {
  if (!el) return null;
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return { lat: el.lat, lng: el.lon };
  if (el.center && Number.isFinite(el.center.lat) && Number.isFinite(el.center.lon)) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

/**
 * Ubah respons Overpass menjadi daftar tempat yang rapi & terurut jarak.
 * Fungsi murni — dipakai juga oleh uji otomatis tanpa jaringan.
 */
function parseElements(json, { lat, lng, category, limit = 25, radius = 1200 } = {}) {
  const elements = (json && Array.isArray(json.elements) && json.elements) || [];
  const cat = CATEGORIES[category] || null;
  const seen = new Map();
  const out = [];

  for (const el of elements) {
    const tags = el && el.tags ? el.tags : null;
    if (!tags) continue;
    const coords = coordinatesOf(el);
    if (!coords) continue;
    let name = String(tags.name || tags['name:id'] || tags.brand || tags.operator || '').trim();
    // Pemeta Indonesia sering mengisi name="TANPA NAMA" — perlakukan sebagai tanpa nama.
    if (/(^|\s)tanpa\s*nama(\s|$)|\bno\s*name\b|^(unnamed|unknown|n\/a|-)$/i.test(name)) name = '';
    const kind = typeKey(tags) || 'other';
    const friendlyType = typeLabel(tags);
    const displayName =
      name ||
      (friendlyType !== 'Fasilitas'
        ? friendlyType
        : cat
          ? FALLBACK_LABELS[category] || cat.label
          : 'Fasilitas');
    const dist = haversine(lat, lng, coords.lat, coords.lng);
    if (dist > radius + 250) continue; // toleransi tepi radius
    const id = `${el.type || 'node'}/${el.id}`;
    // Dedupe: banyak tempat terdaftar sebagai node + way di titik hampir sama.
    const dedupeKey = `${(name || kind).toLowerCase()}|${coords.lat.toFixed(4)}|${coords.lng.toFixed(4)}`;
    const prev = seen.get(dedupeKey);
    if (prev && prev.distance <= dist) continue;

    const place = {
      id,
      osmType: el.type || 'node',
      name: displayName,
      unnamed: !name,
      type: kind,
      typeLabel: typeLabel(tags),
      distance: Math.round(dist),
      lat: Number(coords.lat.toFixed(6)),
      lng: Number(coords.lng.toFixed(6)),
      address: addressOf(tags),
      openingHours: tags.opening_hours || '',
      phone: tags.phone || tags['contact:phone'] || '',
      website: tags.website || tags['contact:website'] || '',
      wheelchair: tags.wheelchair || '',
      cuisine: tags.cuisine || '',
      stars: tags.stars || '',
      rooms: tags.rooms || '',
      operator: tags.operator || '',
      osmUrl: `https://www.openstreetmap.org/${el.type || 'node'}/${el.id}`
    };
    if (prev) {
      const idx = out.indexOf(prev);
      if (idx >= 0) out.splice(idx, 1);
    }
    seen.set(dedupeKey, place);
    out.push(place);
  }

  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Pemanggilan jaringan                                                */
/* ------------------------------------------------------------------ */

const cache = createCache({ ttlMs: 10 * 60 * 1000, max: 400 });
const failures = createCache({ ttlMs: 30 * 1000, max: 100 });
const inFlight = new Map();

function cacheKey({ lat, lng, radius, category, limit }) {
  const bucket = Math.round(radius / 500) * 500;
  return `${category}|${lat.toFixed(3)}|${lng.toFixed(3)}|${bucket}|${limit}`;
}

async function fetchFrom(endpoint, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': userAgent()
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal
    });
    if (!res.ok) {
      const err = new Error(`Overpass membalas HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cari fasilitas terdekat. Mengembalikan { places, cached, fetchedAt, source }.
 * Melempar error dengan `.code` = 'invalid_query' | 'upstream_unavailable'.
 */
async function nearby(options) {
  const center = clampCoord(options.lat, options.lng);
  if (!center) {
    const err = new Error('Koordinat tidak valid.');
    err.code = 'invalid_query';
    throw err;
  }
  const category = String(options.category || 'transport');
  if (!CATEGORIES[category]) {
    const err = new Error('Kategori tidak dikenal.');
    err.code = 'invalid_query';
    throw err;
  }
  const radius = Math.min(5000, Math.max(300, Number(options.radius) || 1200));
  const limit = Math.min(60, Math.max(5, Number(options.limit) || 25));
  const key = cacheKey({ lat: center.lat, lng: center.lng, radius, category, limit });

  const cached = cache.get(key);
  if (cached) return { ...cached, cached: true };

  const negative = failures.get(key);
  if (negative) {
    const err = new Error('Layanan peta sedang sibuk. Coba lagi sebentar lagi.');
    err.code = 'upstream_unavailable';
    err.retryAfterSec = Math.max(5, Math.ceil((negative.expiresAt - Date.now()) / 1000) || 30);
    throw err;
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const query = buildQuery({ lat: center.lat, lng: center.lng, radius, category });
  const task = (async () => {
    let lastError = null;

    const runOverpass = async (endpoint) => {
      const json = await fetchFrom(endpoint, query);
      return {
        category,
        categoryLabel: CATEGORIES[category].label,
        center,
        radius,
        places: parseElements(json, {
          lat: center.lat,
          lng: center.lng,
          category,
          limit,
          radius
        }),
        source: endpoint,
        fetchedAt: new Date().toISOString()
      };
    };

    const eps = endpoints();

    // 1) Endpoint utama.
    try {
      const result = await runOverpass(eps[0]);
      cache.set(key, result);
      return result;
    } catch (err) {
      lastError = err;
    }

    // 2) Cadangan cepat: pencarian kategori Nominatim (data OSM yang sama).
    try {
      const places = await fallback.search({
        category,
        lat: center.lat,
        lng: center.lng,
        radius,
        limit,
        searchInBox: nominatim.searchInBox,
        haversine
      });
      const fallbackResult = {
        category,
        categoryLabel: CATEGORIES[category].label,
        center,
        radius,
        places,
        source: 'nominatim',
        fallback: true,
        fetchedAt: new Date().toISOString()
      };
      cache.set(key, fallbackResult);
      return fallbackResult;
    } catch (fallbackErr) {
      lastError = fallbackErr;
    }

    // 3) Mirror Overpass lain, kalau cadangan juga gagal.
    for (const endpoint of eps.slice(1)) {
      try {
        const result = await runOverpass(endpoint);
        cache.set(key, result);
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    failures.set(key, true);
    const err = new Error('Layanan peta OpenStreetMap tidak dapat dihubungi.');
    err.code = 'upstream_unavailable';
    err.cause = lastError;
    throw err;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

module.exports = {
  ATTRIBUTION,
  CATEGORIES,
  CATEGORY_KEYS,
  TYPE_LABELS,
  haversine,
  buildQuery,
  parseElements,
  typeLabel,
  nearby,
  _cache: cache
};
