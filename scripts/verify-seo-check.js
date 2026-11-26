const fs=require('fs');
const BASE='http://localhost:'+(process.env.PORT||'4103');
const DB='D:/laragon/www/sabesi/data/db.json';
let cookie='';
function saveCookie(res){const raw=res.headers.getSetCookie?res.headers.getSetCookie():[];
 for(const c of raw){const p=c.split(';')[0];const [n]=p.split('=');
  cookie=cookie.split('; ').filter(x=>x&&!x.startsWith(n+'=')).concat([p]).join('; ');}}
async function req(u,o={}){const r=await fetch(BASE+u,{redirect:'manual',...o,headers:{cookie,...(o.headers||{})}});saveCookie(r);return r;}
function csrf(h){const m=h.match(/name="_csrf" value="([^"]+)"/);return m?m[1]:null;}
const db=()=>JSON.parse(fs.readFileSync(DB,'utf8'));
(async()=>{
 const lp=await req('/admin/login');const lt=csrf(await lp.text());
 await req('/admin/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:lt,username:'admin',password:'admin123'}).toString()});
 const sp=await req('/admin/seo');const t=csrf(await sp.text());
 // dicentang
 let fd=new FormData(); fd.set('_csrf',t); fd.append('seoIndex','off'); fd.append('seoIndex','on');
 await req('/admin/seo',{method:'POST',body:fd});
 console.log('seoIndex dicentang ->', db().settings.seoIndex, db().settings.seoIndex===true?'OK':'BUG');
 // tidak dicentang
 fd=new FormData(); fd.set('_csrf',t); fd.append('seoIndex','off');
 await req('/admin/seo',{method:'POST',body:fd});
 console.log('seoIndex tidak      ->', db().settings.seoIndex, db().settings.seoIndex===false?'OK':'BUG');
})();
