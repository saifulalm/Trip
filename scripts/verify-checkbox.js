// Uji parsing checkbox boolean pada form multipart.
const fs = require('fs');
const BASE = 'http://localhost:' + (process.env.PORT || '4102');
const DB = 'D:/laragon/www/sabesi/data/db.json';
let cookie = '';
function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) { const p = c.split(';')[0]; const [n] = p.split('=');
    cookie = cookie.split('; ').filter(x => x && !x.startsWith(n + '=')).concat([p]).join('; '); }
}
async function req(url, opts={}) {
  const res = await fetch(BASE+url, {redirect:'manual', ...opts, headers:{cookie, ...(opts.headers||{})}});
  saveCookie(res); return res;
}
function csrfFrom(h){ const m=h.match(/name="_csrf" value="([^"]+)"/); return m?m[1]:null; }
const db = () => JSON.parse(fs.readFileSync(DB,'utf8'));

(async () => {
  const lp = await req('/admin/login');
  const lt = csrfFrom(await lp.text());
  await req('/admin/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({_csrf:lt,username:'admin',password:'admin123'}).toString()});

  const sp = await req('/admin/pengaturan');
  const t = csrfFrom(await sp.text());

  console.log('--- BEFORE ---');
  console.log('waFloatEnabled =', db().settings.waFloatEnabled);

  // KIRIM checkbox "on" (tanpa hidden off) -> harusny true
  const fd = new FormData();
  fd.set('_csrf', t);
  fd.set('waFloatEnabled', 'on');
  await req('/admin/pengaturan',{method:'POST', body: fd});
  console.log('--- AFTER kirim waFloatEnabled=on ---');
  console.log('waFloatEnabled =', db().settings.waFloatEnabled, db().settings.waFloatEnabled === true ? 'OK' : 'BUG: jadi false');

  // KIRIM hidden off saja -> harusnya false
  const fd2 = new FormData();
  fd2.set('_csrf', t);
  fd2.set('waFloatEnabled', 'off');
  await req('/admin/pengaturan',{method:'POST', body: fd2});
  console.log('--- AFTER kirim waFloatEnabled=off ---');
  console.log('waFloatEnabled =', db().settings.waFloatEnabled, db().settings.waFloatEnabled === false ? 'OK' : 'BUG');
})().catch(e=>{console.error(e);process.exit(1);});
