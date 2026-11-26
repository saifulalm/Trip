'use strict';

/**
 * Cache in-memory sederhana dengan TTL & batas jumlah entri.
 *
 * Dipakai layanan geo supaya satu permintaan pengguna tidak selalu menjadi
 * satu permintaan ke Overpass/Nominatim. Kebijakan pemakaian kedua layanan
 * publik itu mewajibkan cache hasil, jadi ini bukan sekadar optimasi.
 */
function createCache({ ttlMs = 10 * 60 * 1000, max = 500 } = {}) {
  const store = new Map();

  function prune(now) {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
    // Map menyimpan urutan sisip; buang yang paling lama bila masih penuh.
    while (store.size > max) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
  }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value, customTtl) {
      const now = Date.now();
      store.delete(key);
      store.set(key, { value, expiresAt: now + (customTtl || ttlMs) });
      prune(now);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    }
  };
}

module.exports = { createCache };
