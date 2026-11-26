'use strict';

/**
 * Antrean lokasi offline (IndexedDB) — dipakai halaman booking DAN service
 * worker, jadi berkas ini sengaja bebas DOM: cukup `self`/`window`.
 *
 * Menyimpan titik GPS yang belum terkirim saat tidak ada sinyal. Setelah
 * sinyal kembali, antrean dikirim berurutan lalu dihapus satu per satu.
 */
(function (scope) {
  var DB_NAME = 'syt_location';
  var DB_VERSION = 1;
  var STORE = 'pending';
  var META = 'meta';

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB tidak tersedia'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('at', 'at', { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('Gagal membuka IndexedDB'));
      };
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, mode);
        var store = t.objectStore(storeName);
        var result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = function () {
          resolve(result && result.result !== undefined ? result.result : result);
        };
        t.onerror = function () {
          reject(t.error || new Error('Transaksi IndexedDB gagal'));
        };
        t.onabort = function () {
          reject(t.error || new Error('Transaksi IndexedDB dibatalkan'));
        };
      });
    });
  }

  function requestValue(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  var api = {
    /**
     * item = { id, lat, lng, accuracy, at, source }
     * `id` dipakai server untuk dedupe, jadi pengiriman ulang aman.
     */
    add: function (item) {
      return tx(STORE, 'readwrite', function (store) {
        store.put(item);
      }).then(function () {
        return item;
      });
    },
    all: function () {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, 'readonly');
          var req = t.objectStore(STORE).index('at').getAll();
          req.onsuccess = function () {
            resolve(req.result || []);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      });
    },
    count: function () {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, 'readonly');
          var req = t.objectStore(STORE).count();
          req.onsuccess = function () {
            resolve(req.result || 0);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      });
    },
    remove: function (id) {
      return tx(STORE, 'readwrite', function (store) {
        store.delete(id);
      });
    },
    clear: function () {
      return tx(STORE, 'readwrite', function (store) {
        store.clear();
      });
    },
    setMeta: function (key, value) {
      return tx(META, 'readwrite', function (store) {
        store.put({ key: key, value: value });
      });
    },
    getMeta: function (key) {
      return open().then(function (db) {
        return requestValue(db.transaction(META, 'readonly').objectStore(META).get(key)).then(
          function (row) {
            return row ? row.value : null;
          }
        );
      });
    },
    available: function () {
      return typeof indexedDB !== 'undefined';
    }
  };

  scope.SytLocQueue = api;
})(typeof self !== 'undefined' ? self : this);
