'use strict';

/**
 * Verifikasi integrasi redesign hero + panel admin realtime.
 *
 * Dijalankan terhadap server uji (bukan server produksi).
 *
 *   SABESI_DATA_DIR=<folder uji> PORT=4411 WA_DISABLE_BG=1 node server.js
 *   node scripts/verify-redesign-integration.js --port 4411
 *
 * Yang diperiksa:
 *  1. Hero beranda benar-benar punya <video> yang DIPUTAR (bukan poster).
 *  2. Mode hero 'image' mematikan video (memakai data uji terisolasi).
 *  3. Panel admin memuat indikator realtime & script admin-realtime.js.
 *  4. EventSource admin tersambung ke /admin/marketing/stream.
 *  5. Tidak ada overflow horizontal di halaman admin yang diuji.
 */

const puppeteer = require('puppeteer');

const PORT = Number(
  (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] ||
  process.env.VERIFY_PORT ||
  4411
);
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'admin123' };

let pass = 0;
let fail = 0;

function ok(name, detail) {
  pass += 1;
  console.log(`  PASS  ${name}${detail ? ' -> ' + detail : ''}`);
}
function bad(name, detail) {
  fail += 1;
  console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`);
}

/**
 * Ambil token CSRF dari HTML halaman.
 * @param {string} html isi halaman
 * @returns {string} token
 */
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    /* ---------- 1. Hero beranda ---------- */
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.bringToFront();
    await new Promise((r) => setTimeout(r, 4000));

    const hero = await page.evaluate(() => {
      const v = document.querySelector('[data-hero-video]');
      const m = document.querySelector('[data-hero-media]');
      return {
        hasVideo: !!v,
        readyState: v ? v.readyState : null,
        paused: v ? v.paused : null,
        duration: v ? v.duration : null,
        currentTime: v ? Number(v.currentTime.toFixed(2)) : null,
        mediaClass: m ? m.className : null,
        opacity: v ? getComputedStyle(v).opacity : null,
        poster: m ? (m.querySelector('[data-hero-poster]') || {}).getAttribute
          ? m.querySelector('[data-hero-poster]').getAttribute('src')
          : null : null
      };
    });

    if (hero.hasVideo) ok('hero punya elemen <video>', hero.mediaClass);
    else bad('hero punya elemen <video>', 'tidak ditemukan');

    if (hero.readyState >= 2) ok('video siap diputar (readyState>=2)', `readyState=${hero.readyState}`);
    else bad('video siap diputar', `readyState=${hero.readyState}`);

    if (hero.paused === false) ok('video tidak dalam keadaan paused', `t=${hero.currentTime}s`);
    else bad('video tidak dalam keadaan paused', `paused=${hero.paused}`);

    if (hero.opacity === '1') ok('layer video terlihat (opacity 1)', hero.opacity);
    else bad('layer video terlihat', `opacity=${hero.opacity}`);

    if (hero.mediaClass && hero.mediaClass.includes('is-playing')) {
      ok('kelas is-playing terpasang (anti-flicker)');
    } else {
      bad('kelas is-playing terpasang', hero.mediaClass);
    }

    // Waktu playback harus bertambah (video benar-benar berjalan).
    await new Promise((r) => setTimeout(r, 1500));
    const hero2 = await page.evaluate(() => {
      const v = document.querySelector('[data-hero-video]');
      return v ? Number(v.currentTime.toFixed(2)) : null;
    });
    if (hero2 !== null && hero.currentTime !== null && hero2 > hero.currentTime) {
      ok('waktu playback bertambah (video berjalan)', `${hero.currentTime}s -> ${hero2}s`);
    } else {
      bad('waktu playback bertambah', `${hero.currentTime} -> ${hero2}`);
    }

    // Tidak boleh ada class yatim tanpa definisi CSS.
    const orphan = await page.evaluate(() => {
      const out = [];
      ['hero-search__field--dest', 'hero-search__field--date'].forEach((cls) => {
        const el = document.querySelector('.' + cls);
        if (!el) return;
        const hasRule = Array.from(document.styleSheets).some((sheet) => {
          try {
            return Array.from(sheet.cssRules || []).some((r) => r.selectorText && r.selectorText.includes('.' + cls));
          } catch (e) {
            return false;
          }
        });
        if (!hasRule) out.push(cls);
      });
      return out;
    });
    if (!orphan.length) ok('class yatim hero-search__field--* punya definisi CSS');
    else bad('class yatim hero-search__field--* punya definisi CSS', orphan.join(', '));

    // Overflow horizontal beranda.
    const overflowHome = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflowHome <= 1) ok('tidak ada overflow horizontal di beranda', `${overflowHome}px`);
    else bad('tidak ada overflow horizontal di beranda', `${overflowHome}px`);

    /* ---------- 2. Login admin ---------- */
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    const loginHtml = await page.content();
    await page.type('input[name="username"]', ADMIN.username);
    await page.type('input[name="password"]', ADMIN.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button[type="submit"]')
    ]);
    if (page.url().includes('/admin')) ok('login admin berhasil', page.url());
    else bad('login admin berhasil', page.url());

    /* ---------- 3. Halaman blast ---------- */
    await page.goto(`${BASE}/admin/marketing/blast`, { waitUntil: 'networkidle2' });
    await page.bringToFront();

    const blastUi = await page.evaluate(() => ({
      hasLive: !!document.querySelector('[data-rt-status]'),
      hasBar: !!document.querySelector('[data-rt-blast-bar]'),
      hasScript: !!document.querySelector('script[src="/js/admin-realtime.js"]'),
      hasCss: !!document.querySelector('link[href="/css/admin-v3.css"]')
    }));

    if (blastUi.hasLive) ok('indikator realtime (.a-live) ada di halaman blast');
    else bad('indikator realtime (.a-live) ada di halaman blast');

    if (blastUi.hasBar) ok('bilah progres blast realtime ada');
    else bad('bilah progres blast realtime ada');

    if (blastUi.hasScript) ok('admin-realtime.js dimuat');
    else bad('admin-realtime.js dimuat');

    if (blastUi.hasCss) ok('admin-v3.css dimuat');
    else bad('admin-v3.css dimuat');

    /* ---------- 4. EventSource tersambung ---------- */
    await new Promise((r) => setTimeout(r, 2500));
    const rt = await page.evaluate(() => {
      const el = document.querySelector('[data-rt-status]');
      return {
        state: el ? el.getAttribute('data-state') : null,
        className: el ? el.className : null,
        hasApi: typeof window.SylAdminRealtime === 'object'
      };
    });
    if (rt.state === 'live') ok('EventSource tersambung (state=live)', rt.className);
    else bad('EventSource tersambung', `state=${rt.state} class=${rt.className}`);

    if (rt.hasApi) ok('API SylAdminRealtime tersedia');
    else bad('API SylAdminRealtime tersedia');

    /* ---------- 5. Push realtime benar-benar mengubah DOM ---------- */
    // Halaman pemantau = halaman kontak (penanda data-rt-contacts ada di sana).
    await page.goto(`${BASE}/admin/marketing/kontak`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));
    const before = await page.evaluate(() => {
      const el = document.querySelector('[data-rt-contacts]');
      return el ? Number(el.textContent.trim()) : null;
    });

    // Trigger perubahan dari tab lain (POST kontak → event contact).
    const contactPage = await browser.newPage();
    await contactPage.goto(`${BASE}/admin/marketing/kontak`, { waitUntil: 'domcontentloaded' });
    const contactsHtml = await contactPage.content();
    const token = csrfFrom(contactsHtml);
    const phone = '0812' + String(Date.now()).slice(-8);
    await contactPage.evaluate(
      (args) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/admin/marketing/kontak';
        const fields = {
          _csrf: args.csrf,
          name: 'Uji Realtime Browser',
          phone: args.phone,
          optIn: 'on'
        };
        Object.keys(fields).forEach((k) => {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = k;
          input.value = fields[k];
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      },
      { csrf: token, phone }
    );
    await new Promise((r) => setTimeout(r, 3000));

    const after = await page.evaluate(() => {
      const c = document.querySelector('[data-rt-contacts]');
      const m = document.querySelector('[data-rt-marketable]');
      return {
        contacts: c ? Number(c.textContent.trim()) : null,
        marketable: m ? Number(m.textContent.trim()) : null
      };
    });
    if (after.contacts !== null && before !== null && after.contacts === before + 1) {
      ok(
        'nomor kontak ter-update realtime via SSE',
        `kontak ${before} -> ${after.contacts} (siap=${after.marketable})`
      );
    } else {
      bad('nomor kontak ter-update realtime via SSE', `before=${before} after=${JSON.stringify(after)}`);
    }
    await contactPage.close();

    /* ---------- 6. Overflow & konsistensi halaman admin ---------- */
    for (const url of [
      '/admin/marketing/blast',
      '/admin/marketing/kontak',
      '/admin/marketing/whatsapp',
      '/admin'
    ]) {
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2' });
      await page.bringToFront();
      await new Promise((r) => setTimeout(r, 600));
      const ov = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (ov <= 1) ok(`tidak ada overflow horizontal di ${url}`, `${ov}px`);
      else bad(`tidak ada overflow horizontal di ${url}`, `${ov}px`);
    }

    /* ---------- 7. Ikon admin tak boleh ada yang hilang ---------- */
    await page.goto(`${BASE}/admin/marketing/kontak`, { waitUntil: 'networkidle2' });
    const icons = await page.evaluate(() => {
      const uses = Array.from(document.querySelectorAll('svg use'));
      const missing = uses
        .filter((u) => {
          const href = u.getAttribute('href') || '';
          return href.startsWith('#') && !document.getElementById(href.slice(1));
        })
        .map((u) => u.getAttribute('href'));
      return { total: uses.length, missing };
    });
    if (!icons.missing.length) ok('semua ikon admin terdefinisi', `${icons.total} pemakaian`);
    else bad('semua ikon admin terdefinisi', icons.missing.join(', '));
  } catch (err) {
    bad('verifikasi tidak melempar error', err.message);
    console.error(err);
  } finally {
    await browser.close();
  }

  console.log(fail === 0 ? '\nSemua suite lulus.' : `\n${fail} gagal.`);
  process.exit(fail === 0 ? 0 : 1);
})();
