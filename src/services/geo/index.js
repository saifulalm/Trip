'use strict';

/**
 * Layanan geo — pembungkus tunggal untuk fitur "Sekitar Saya".
 *
 * Sumber data: OpenStreetMap (Overpass API untuk POI, Nominatim untuk
 * geocoding). Keduanya open source, tanpa API key maupun biaya, sehingga
 * fitur tetap jalan tanpa akun pihak ketiga.
 */

const overpass = require('./overpass');
const nominatim = require('./nominatim');

module.exports = {
  ATTRIBUTION: overpass.ATTRIBUTION,
  GEOCODING_ATTRIBUTION: nominatim.ATTRIBUTION,
  CATEGORIES: overpass.CATEGORIES,
  CATEGORY_KEYS: overpass.CATEGORY_KEYS,
  haversine: overpass.haversine,
  buildQuery: overpass.buildQuery,
  parseElements: overpass.parseElements,
  nearby: overpass.nearby,
  reverse: nominatim.reverse,
  searchPlaces: nominatim.search
};
