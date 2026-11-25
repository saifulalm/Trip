'use strict';
/**
 * Audit kontras numerik untuk modul media sosial (a-so-*).
 *
 * Metode: PROBE KOMPOSIT-LAPIS (semua background ancestor dikumpulkan dari
 * elemen ke body, lalu dikomposit dari bawah ke atas) — wajib, karena probe
 * satu-lapis menghasilkan angka salah.
 *
 * Jalankan dengan server hidup: PORT=4310 node scripts/audit-social-contrast.js
 */
const http = require('http');
const puppeteer = require('puppeteer');

const PORT = Number(process.env.PORT) || 4310;
const BASE = `http://localhost:${PORT}`;

/** Parse warna CSS (rgb/rgba/hex) menjadi {r,g,b,a}. */
function parseColor(str) {
  const s = String(str || '').trim();
  if (!s || s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
  }
  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  return { r: 0, g: 0, b: 0, a: 0 };
}

/** Komposit `fg` di atas `bg` (alpha-aware). */
function over(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a: a
  };
}

/** Relatif luminance (WCAG 2.1). */
function luminance(c) {
  const ch = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Rasio kontras. */
function ratio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Probe sumber untuk konteks browser — WAJIB mandiri (self-contained):
 * fungsi pembantu harus didefinisikan DI DALAM string-nya, karena fungsi
 * Node tidak tersedia di dalam halaman browser.
 */
const BG_PROBE = `
(function (sel) {
  function __parseColor(str) {
    const s = String(str || '').trim();
    if (!s || s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let m = s.match(/^rgba?\\(([^)]+)\\)$/i);
    if (m) {
      const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
      return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
    }
    m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const el = document.querySelector(sel);
  if (!el) return null;
  const layers = [];
  let opacityProduct = 1;
  let node = el;
  while (node && node !== document.documentElement) {
    const s = getComputedStyle(node);
    opacityProduct *= parseFloat(s.opacity);
    const bg = __parseColor(s.backgroundColor);
    const bi = s.backgroundImage;
    if (bg.a > 0) layers.push(bg);
    // Gradien: ambil warna opaque pertama (alpha >= .99) sebagai basis.
    if (bi && bi !== 'none') {
      const m = bi.match(/rgba?\\([^)]+\\)/g) || [];
      for (const c of m) {
        const p = __parseColor(c);
        if (p.a >= 0.99) { layers.push(p); break; }
      }
    }
    node = node.parentElement;
  }
  const bodyBg = __parseColor(getComputedStyle(document.body).backgroundColor);
  if (bodyBg.a > 0) layers.push(bodyBg);
  const htmlBg = __parseColor(getComputedStyle(document.documentElement).backgroundColor);
  if (htmlBg.a > 0) layers.push(htmlBg);
  const es = getComputedStyle(el);
  return {
    layers,
    opacityProduct,
    color: es.color,
    fontSize: parseFloat(es.fontSize),
    fontWeight: es.fontWeight
  };
})
`;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  // Login admin.
  await page.goto(BASE + '/admin/login', { waitUntil: 'networkidle2' });
  await page.type('input[name=username]', 'admin');
  await page.type('input[name=password]', 'admin123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type=submit]')
  ]);

  /*
   * Konfigurasi Postiz sementara (mock lokal) supaya SEMUA state UI teruji:
   * composer dengan kanal, riwayat dengan post, kartu platform terhubung.
   * Nilai asli dipulihkan di akhir (bukan konfigurasi mock yang tertinggal).
   */
  const dbMod = require('../src/db');
  dbMod.reload();
  const originalConfig = {
    postizBaseUrl: (dbMod.read().settings || {}).postizBaseUrl || '',
    postizApiKey: (dbMod.read().settings || {}).postizApiKey || ''
  };
  const MOCK_URL = 'http://127.0.0.1:' + (Number(process.env.MOCK_PORT) || 4250);
  const MOCK_KEY = process.env.MOCK_POSTIZ_KEY || 'kunci-uji-123';

  await page.goto(BASE + '/admin/social', { waitUntil: 'networkidle2' });
  await page.evaluate((base, key) => {
    document.getElementById('postizBaseUrl').value = base;
    document.getElementById('postizApiKey').value = key;
    document.getElementById('postizBaseUrl').form.submit();
  }, MOCK_URL, MOCK_KEY);
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  const results = [];

  async function audit(label, url, selectors) {
    await page.goto(BASE + url, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await new Promise((r) => setTimeout(r, 400));
      for (const item of selectors) {
        const data = await page.evaluate(
          (sel, probeSrc) => {
            // Probe dibungkus fungsi mandiri agar tidak butuh closure Node.
            // Penting: string dirapikan (trim) agar tidak kena ASI —
            // "return \n(function...)" mengembalikan undefined.
            const probe = new Function('return ' + probeSrc.trim())();
            return probe(sel);
          },
          item.sel,
          BG_PROBE
        );
        if (!data) {
          results.push({ label, theme, sel: item.sel, ratio: null, note: 'elemen tidak ditemukan' });
          continue;
        }
        // Komposit background dari bawah ke atas.
        let bg = { r: 0, g: 0, b: 0, a: 0 };
        for (let i = data.layers.length - 1; i >= 0; i--) bg = over(data.layers[i], bg);
        // Foreground: alpha warna teks × produk opacity leluhur.
        const fgRaw = parseColor(data.color);
        const fg = { ...fgRaw, a: fgRaw.a * (data.opacityProduct || 1) };
        const fgFinal = over(fg, bg);
        // Teks besar (>=18.66px bold atau >=24px) ambang 3:1, selainnya 4.5:1.
        const large = data.fontSize >= 24 || (data.fontSize >= 18.66 && parseInt(data.fontWeight, 10) >= 700);
        const need = large ? 3 : 4.5;
        const r = ratio(fgFinal, bg);
        results.push({
          label, theme, sel: item.sel, ratio: r, need,
          pass: r >= need,
          note: data.fontSize.toFixed(1) + 'px/' + data.fontWeight +
            ' op=' + (data.opacityProduct || 1).toFixed(2)
        });
      }
    }
  }

  const hub = [
    { sel: '.a-so-hero__title' },
    { sel: '.a-so-hero__desc' },
    { sel: '.a-so-hero__eyebrow' },
    { sel: '.a-so-stat' },
    { sel: '.a-so-stat strong' },
    { sel: '.a-so-setup__head h2' },
    { sel: '.a-so-steps li' },
    { sel: '.a-so-steps strong' },
    { sel: '.a-so-card__name' },
    { sel: '.a-so-card__handle' },
    { sel: '.a-so-card__desc' },
    { sel: '.a-so-card__note' },
    { sel: '.a-so-channel__name' },
    { sel: '.a-so-channel__profile' },
    { sel: '.a-so-link__name' },
    { sel: '.a-so-link__url' },
    { sel: '.a-so-empty strong' },
    { sel: '.a-so-empty p' },
    { sel: '.a-so-clear' }
  ];

  await audit('hub', '/admin/social', hub);
  await audit('composer', '/admin/social/tulis', [
    { sel: '.a-so-pick__name' },
    { sel: '.a-so-pick__meta' },
    { sel: '.a-so-pick__limit' },
    { sel: '.a-so-counter__num' },
    { sel: '.a-so-actions__hint' },
    { sel: '.a-so-required__label' }
  ]);
  await audit('riwayat', '/admin/social/riwayat', [
    { sel: '.a-so-post__content' },
    { sel: '.a-so-post__meta' },
    { sel: '.a-so-post__error' }
  ]);

  /* ---------- Pulihkan konfigurasi Postiz ASLI ---------- */
  /*
   * WAJIB: skrip ini menyalakan konfigurasi mock lokal supaya semua state
   * UI teruji. Kalau tidak dipulihkan, data/db.json produksi menyimpan
   * http://127.0.0.1:4250 secara permanen.
   */
  await page.goto(BASE + '/admin/social', { waitUntil: 'networkidle2' });
  if (originalConfig.postizBaseUrl) {
    await page.evaluate((base, key) => {
      document.getElementById('postizBaseUrl').value = base;
      document.getElementById('postizApiKey').value = key;
      document.getElementById('postizBaseUrl').form.submit();
    }, originalConfig.postizBaseUrl, originalConfig.postizApiKey);
  } else {
    await page.evaluate(() => {
      const cb = document.querySelector('input[name=postizClear]');
      if (cb) {
        cb.checked = true;
        cb.form.submit();
      }
    });
  }
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  await browser.close();

  let pass = 0;
  let fail = 0;
  console.log('\n=== AUDIT KONTRAS MODUL MEDIA SOSIAL ===\n');
  let lastTheme = null;
  for (const r of results) {
    if (r.theme !== lastTheme) {
      console.log('--- mode ' + r.theme + ' ---');
      lastTheme = r.theme;
    }
    if (r.ratio === null) {
      console.log('  SKIP  ' + r.label + ' [' + r.sel + '] — ' + r.note);
      continue;
    }
    const status = r.pass ? 'PASS' : 'FAIL';
    if (r.pass) pass += 1; else fail += 1;
    console.log('  ' + status + '  ' + r.ratio.toFixed(2) + ':1 (butuh ' + r.need + ':1)  ' +
      r.label + ' [' + r.sel + '] ' + r.note);
  }
  console.log('\n' + pass + ' lulus, ' + fail + ' gagal.');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + e.stack); process.exit(1); });
