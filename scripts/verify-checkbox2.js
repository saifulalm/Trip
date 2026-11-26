// Uji KASUS NYATA: hidden "off" + checkbox "on" (duplikat field).
const fs = require('fs');
const BASE = 'http://localhost:' + (process.env.PORT || '4102');
const DB = 'D:/laragon/www/sabesi/data/db.json';
let cookie = '';
function saveCookie(res){ const raw=res.headers.getSetCookie?res.headers.getSetCookie():[];
  for(const c of raw){const p=c.split(';')[0];const [n]=p.split('=');
    cookie=cookie.split('; ').filter(x=>x&&!x.startsWith(n+'=')).concat([p]).join('; ');}}
async function req(url,opts={}){const res=await fetch(BASE+url,{redirect:'manual',...opts,headers:{cookie,...(opts.headers||{})}});saveCookie(res);return res;}
function csrfFrom(h){const m=h.match(/name="_csrf" value="([^"]+)"/);return m?m[1]:null;}
const db=()=>JSON.parse(fs.readFileSync(DB,'utf8'));

(async () => {
  const lp=await req('/admin/login');
  const lt=csrfFrom(await lp.text());
  await req('/admin/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({_csrf:lt,username:'admin',password:'admin123'}).toString()});
  const sp=await req('/admin/pengaturan');
  const t=csrfFrom(await sp.text());

  // Kasus nyata: field sama muncul 2x (hidden off + checkbox on)
  const fd = new FormData();
  fd.set('_csrf', t);
  fd.append('waFloatEnabled', 'off');
  fd.append('waFloatEnabled', 'on');   // user centang
  await req('/admin/pengaturan',{method:'POST', body: fd});
  const v = db().settings.waFloatEnabled;
  console.log('hidden off + checked on -> waFloatEnabled =', v,
    v === true ? 'OK' : 'BUG (cenang tapi tersimpan false)');

  // Kasus nyata unchecked: hanya hidden off
  const fd2 = new FormData();
  fd2.set('_csrf', t);
  fd2.append('waFloatEnabled', 'off');
  await req('/admin/pengaturan',{method:'POST', body: fd2});
  const v2 = db().settings.waFloatEnabled;
  console.log('hidden off saja        -> waFloatEnabled =', v2,
    v2 === false ? 'OK' : 'BUG');
})().catch(e=>{console.error(e);process.exit(1);});
