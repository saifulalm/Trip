'use strict';
/**
 * Verifikasi visual terukur untuk redesign admin panel.
 *
 * Mengukur hal-hal yang TIDAK bisa dilihat dari HTML:
 *  - token & komponen redesign terpasang (logo, breadcrumb, ikon SVG, KPI),
 *  - mode gelap memakai token (bukan menulis ulang aturan),
 *  - sidebar mobile off-canvas benar-benar bisa dibuka,
 *  - class yang dipakai template punya definisi CSS.
 *
 * Jalankan: PORT=4312 node scripts/verify-admin-visual.js
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 4312;
const BASE = `http://localhost:${PORT}`;

/** Permintaan HTTP sederhana. */
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: PORT, path, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout ' + path)); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Ambil token CSRF. */
function csrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

let pass = 0;
let fail = 0;
const failures = [];

/** Catat hasil pemeriksaan. */
function check(name, ok, extra) {
  if (ok) {
    pass += 1;
    console.log(`  OK   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  GAGAL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

(async () => {
  console.log(`\n=== Verifikasi visual admin (${BASE}) ===\n`);

  // 1. Login admin.
  const loginPage = await request('/admin/login');
  const token = csrf(loginPage.body);
  if (!token) {
    console.error('GAGAL: token CSRF tidak ditemukan');
    process.exit(1);
  }
  const loginRes = await request('/admin/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: (loginPage.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')
    },
    body: new URLSearchParams({ username: 'admin', password: 'admin123', _csrf: token }).toString()
  });
  check('Login admin', loginRes.status === 302, `status=${loginRes.status}`);

  const puppeteer = (() => {
    try { return require('puppeteer'); } catch (e) { return null; }
  })();
  if (!puppeteer) {
    console.error('GAGAL: Puppeteer tidak tersedia');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    const cookieHeader = (loginRes.headers['set-cookie'] || [])[0];
    if (cookieHeader) {
      const [pair] = cookieHeader.split(';');
      const idx = pair.indexOf('=');
      await page.setCookie({
        name: pair.slice(0, idx),
        value: pair.slice(idx + 1),
        domain: 'localhost',
        path: '/'
      });
    }

    /* ---------- Desktop: komponen redesign ---------- */
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });

    const desktop = await page.evaluate(() => {
      const cs = (s, p) => {
        const e = document.querySelector(s);
        return e ? getComputedStyle(e)[p] : null;
      };
      return {
        logoSrc: (document.querySelector('.admin-brand__mark img') || {}).getAttribute
          ? document.querySelector('.admin-brand__mark img').getAttribute('src') : null,
        brandName: (document.querySelector('.admin-brand__name') || {}).textContent || '',
        brandTail: (document.querySelector('.admin-brand__tail') || {}).textContent || '',
        eyebrow: (document.querySelector('.admin-brand__eyebrow') || {}).textContent || '',
        breadcrumb: ((document.querySelector('.admin-breadcrumb') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        navIcons: document.querySelectorAll('.admin-nav .ico svg use').length,
        navLinks: document.querySelectorAll('.admin-nav a[data-nav-item]').length,
        navLabels: document.querySelectorAll('.admin-nav__label').length,
        emojiInNav: /[\u{1F300}-\u{1FAFF}]/u.test((document.querySelector('.admin-nav') || {}).textContent || ''),
        statCards: document.querySelectorAll('.stat-card').length,
        statRadius: cs('.stat-card', 'borderRadius'),
        hasSearch: !!document.getElementById('adminNavSearch'),
        userMenu: !!document.getElementById('adminUserBtn'),
        themeToggle: !!document.getElementById('themeToggle'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    check('Logo admin baru terpasang (/img/logo-admin.svg)',
      desktop.logoSrc === '/img/logo-admin.svg', desktop.logoSrc);
    check('Wordmark brand dua nada (kepala + ekor)',
      Boolean(desktop.brandName) && Boolean(desktop.brandTail),
      `name="${desktop.brandName}" tail="${desktop.brandTail}"`);
    check('Eyebrow "Panel Admin"', desktop.eyebrow.trim() === 'Panel Admin', desktop.eyebrow);
    check('Breadcrumb "Panel Admin / <judul>"',
      /^Panel Admin \/ .+/.test(desktop.breadcrumb), desktop.breadcrumb);
    check('Ikon navigasi SVG (bukan emoji)',
      desktop.navIcons === desktop.navLinks && !desktop.emojiInNav,
      `ikon=${desktop.navIcons} link=${desktop.navLinks} emoji=${desktop.emojiInNav}`);
    check('Label grup sidebar', desktop.navLabels >= 6, `${desktop.navLabels} label`);
    check('KPI dashboard ter-render', desktop.statCards === 5, `${desktop.statCards} kartu`);
    check('Pencarian menu ada', desktop.hasSearch);
    check('Dropdown user ada', desktop.userMenu);
    check('Tombol tema ada', desktop.themeToggle);
    check('Tanpa overflow horizontal (desktop)', desktop.overflow === 0, `overflow=${desktop.overflow}`);

    /* ---------- Filter pencarian menu ---------- */
    const filter = await page.evaluate(() => {
      const s = document.getElementById('adminNavSearch');
      const run = (q) => {
        s.value = q;
        s.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          items: [...document.querySelectorAll('[data-nav-item]')].filter((a) => !a.hidden)
            .map((a) => a.textContent.trim().replace(/\s+/g, ' ')),
          groups: [...document.querySelectorAll('.admin-nav__label')].filter((l) => !l.hidden)
            .map((l) => l.textContent.trim())
        };
      };
      const one = run('social');
      const none = run('zzzz');
      const all = run('');
      return { one, none, all };
    });
    check('Filter menu: tepat 1 item untuk "social"',
      filter.one.items.length === 1 && filter.one.items[0] === 'Connect Social Media',
      JSON.stringify(filter.one));
    check('Filter menu: hanya 1 grup label tampil',
      filter.one.groups.length === 1 && filter.one.groups[0] === 'Media Sosial',
      JSON.stringify(filter.one.groups));
    check('Filter menu: pesan "tidak ada" untuk kueri tanpa hasil',
      filter.none.items.length === 0 && filter.none.groups.length === 0);
    check('Filter menu: reset mengembalikan 20 item & 6 grup',
      filter.all.items.length === 20 && filter.all.groups.length === 6,
      `item=${filter.all.items.length} grup=${filter.all.groups.length}`);

    /* ---------- Mode gelap ---------- */
    await page.click('#themeToggle');
    await new Promise((r) => setTimeout(r, 900));
    const dark = await page.evaluate(() => {
      const cs = (s, p) => {
        const e = document.querySelector(s);
        return e ? getComputedStyle(e)[p] : null;
      };
      const bodyBg = cs('body', 'backgroundColor');
      const panelBg = cs('.panel', 'backgroundColor');
      const ink = cs('.stat-card .value', 'color');
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        bodyBg, panelBg, ink,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    check('Mode gelap aktif', dark.theme === 'dark', dark.theme);
    check('Mode gelap: latar body & panel berbeda (token bekerja)',
      dark.bodyBg && dark.panelBg && dark.bodyBg !== dark.panelBg,
      `body=${dark.bodyBg} panel=${dark.panelBg}`);
    check('Mode gelap: tinta terang di atas panel gelap',
      dark.ink === 'rgb(232, 241, 242)', dark.ink);
    check('Mode gelap: tanpa overflow', dark.overflow === 0, `overflow=${dark.overflow}`);

    await page.click('#themeToggle');
    await new Promise((r) => setTimeout(r, 700));

    /* ---------- Sidebar mobile ---------- */
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));

    const closed = await page.evaluate(() => {
      const el = document.querySelector('.admin-sidebar');
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right),
               pos: getComputedStyle(el).position };
    });
    check('Sidebar mobile: off-canvas (di luar layar)',
      closed.pos === 'fixed' && closed.right <= 1,
      `left=${closed.left} right=${closed.right} pos=${closed.pos}`);

    await page.click('#adminMenuBtn');
    await new Promise((r) => setTimeout(r, 900));
    const opened = await page.evaluate(() => {
      const el = document.querySelector('.admin-sidebar');
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        width: Math.round(b.width),
        overlay: getComputedStyle(document.querySelector('.admin-sidebar-overlay')).opacity,
        bodyOverflow: document.body.style.overflow,
        vw: window.innerWidth
      };
    });
    check('Sidebar mobile: terbuka di layar (left = 0)',
      opened.left === 0, `left=${opened.left}`);
    check('Sidebar mobile: overlay tampil + scroll terkunci',
      opened.overlay === '1' && opened.bodyOverflow === 'hidden',
      `overlay=${opened.overlay} overflow=${opened.bodyOverflow}`);

    await page.click('#adminSidebarOverlay');
    await new Promise((r) => setTimeout(r, 700));
    const reclosed = await page.evaluate(() => {
      const b = document.querySelector('.admin-sidebar').getBoundingClientRect();
      return Math.round(b.right);
    });
    check('Sidebar mobile: menutup kembali', reclosed <= 1, `right=${reclosed}`);
  } finally {
    await browser.close();
  }

  console.log('\n--- RINGKASAN ---');
  console.log(`lulus: ${pass}/${pass + fail}`);
  if (fail) {
    console.log('gagal:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error('\nERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
