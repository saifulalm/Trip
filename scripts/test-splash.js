'use strict';
/**
 * Harness pengujian splash.js tanpa browser.
 * Mensimulasikan DOM minimum + jam virtual untuk memverifikasi:
 *  1. Script inline <head> memasang layer splash sebelum body diparse.
 *  2. Semua jalur keluar melepas kunci scroll (situs tidak pernah terkunci).
 *  3. Pengunjung yang sudah pernah melihat splash tidak melihat apa-apa.
 *  4. Font gagal dimuat / DOM rusak tidak membuat situs terkunci.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'splash.js'), 'utf8');

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c)
  };
}

function makeEl(id) {
  return {
    id,
    classList: makeClassList(),
    parentNode: { removeChild(child) { child.removed = true; } },
    removed: false,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  };
}

/** Jalankan splash.js dengan skenario tertentu. */
function run(opts = {}) {
  const root = { classList: makeClassList() };
  const splash = opts.noSplash ? null : makeEl('splash');
  const skip = makeEl('splashSkip');
  const store = new Map(opts.seen ? [['syt_splash_seen', '1']] : []);
  const queue = [];

  /* Meniru script inline <head>: splash tampil + scroll terkunci sebelum body. */
  if (!opts.seen && !opts.noHeadScript) {
    root.classList.add('syt-splash-pending', 'splash-active');
  }

  const sandbox = {
    document: {
      documentElement: root,
      getElementById: (id) => (id === 'splash' ? splash : id === 'splashSkip' ? skip : null),
      addEventListener: () => {},
      fonts: opts.noFonts ? undefined : { load: () => Promise.resolve([]) },
      hidden: false
    },
    window: { matchMedia: () => ({ matches: !!opts.reduceMotion }) },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v)
    },
    requestAnimationFrame: (fn) => { queue.push({ fn, t: 0, kind: 'raf' }); return 1; },
    setTimeout: (fn, ms) => { queue.push({ fn, t: ms || 0, kind: 'timer' }); return queue.length; },
    clearTimeout: (id) => { if (queue[id - 1]) queue[id - 1].cancelled = true; },
    Promise,
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  /** Majukan jam virtual sampai `ms`; jalankan timer & flush microtask. */
  async function advance(ms) {
    let now = 0;
    let guard = 0;
    while (guard++ < 2000) {
      const pending = queue.filter((q) => !q.done && !q.cancelled);
      if (!pending.length) break;
      const next = pending.reduce((a, b) => (b.t < a.t ? b : a));
      if (next.t > ms) break;
      next.done = true;
      now = next.t;
      next.fn();
      await Promise.resolve();  /* flush microtask (Promise.then) */
      await new Promise((r) => setImmediate(r));
    }
    void now;
  }

  return { root, splash, skip, store, queue, advance };
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.log('  ✗', name, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}

(async () => {
  console.log('\n[1] Pengunjung baru: splash tampil, lalu situs dibuka');
  {
    const t = run();
    await t.advance(0);
    check('kunci scroll aktif saat splash', t.root.classList.contains('splash-active'));
    check('kelas is-active ditambahkan', t.splash.classList.contains('is-active'));
    check('tombol lewati diaktifkan (is-on)', t.skip.classList.contains('is-on'));
    await t.advance(6000);
    check('kelas is-writing ditambahkan', t.splash.classList.contains('is-writing'));
    check('kunci scroll dilepas', !t.root.classList.contains('splash-active'));
    check('kelas pending dilepas', !t.root.classList.contains('syt-splash-pending'));
    check('splash ditandai sudah dilihat', t.store.get('syt_splash_seen') === '1');
    check('elemen splash dibuang', t.splash.removed === true);
  }

  console.log('\n[2] Tombol "Lewati intro" langsung menutup splash');
  {
    const t = run();
    await t.advance(0);
    t.skip.listeners.click[0]();
    await t.advance(1000);
    check('kunci scroll dilepas', !t.root.classList.contains('splash-active'));
    check('elemen splash dibuang', t.splash.removed === true);
  }

  console.log('\n[3] Pengunjung yang sudah pernah melihat splash');
  {
    const t = run({ seen: true });
    await t.advance(0);
    check('splash langsung dibuang', t.splash.removed === true);
    check('tombol lewati dibuang', t.skip.removed === true);
    check('tidak pernah mengunci scroll', !t.root.classList.contains('splash-active'));
  }

  console.log('\n[4] Font tidak pernah dimuat (document.fonts tidak ada)');
  {
    const t = run({ noFonts: true });
    await t.advance(0);
    await t.advance(8000);
    check('kunci scroll dilepas', !t.root.classList.contains('splash-active'));
    check('splash ditandai sudah dilihat', t.store.get('syt_splash_seen') === '1');
  }

  console.log('\n[5] prefers-reduced-motion');
  {
    const t = run({ reduceMotion: true });
    await t.advance(0);
    await t.advance(3000);
    check('kunci scroll dilepas', !t.root.classList.contains('splash-active'));
    check('splash ditandai sudah dilihat', t.store.get('syt_splash_seen') === '1');
  }

  console.log('\n[6] Elemen splash tidak ada di DOM (template rusak)');
  {
    const t = run({ noSplash: true });
    await t.advance(0);
    check('tidak error', true);
    check('kunci scroll tidak menyala', !t.root.classList.contains('splash-active'));
  }

  console.log('\n[7] Script inline <head> dilewati (situs harus tetap terbuka)');
  {
    const t = run({ noHeadScript: true });
    await t.advance(0);
    await t.advance(8000);
    check('kunci scroll dilepas', !t.root.classList.contains('splash-active'));
  }

  console.log(failures ? `\n✗ ${failures} assertion gagal\n` : '\n✓ Semua assertion lulus\n');
  process.exit(failures ? 1 : 0);
})();
