// Uji penggantian gambar UTAMA (bukan galeri) pada Destinasi.
const fs=require('fs'), path=require('path');
const BASE='http://localhost:'+(process.env.PORT||4106);
const UPLOAD_DIR=path.join(__dirname,'..','public','uploads');
const DB=path.join(__dirname,'..','data','db.json');
let cookie='';
function saveCookie(res){const raw=res.headers.getSetCookie?res.headers.getSetCookie():[];
 for(const c of raw){const p=c.split(';')[0];const [n]=p.split('=');
  cookie=cookie.split('; ').filter(x=>x&&!x.startsWith(n+'=')).concat([p]).join('; ');}}
async function req(u,o={}){const r=await fetch(BASE+u,{redirect:'manual',...o,headers:{cookie,...(o.headers||{})}});saveCookie(r);return r;}
function csrf(h){const m=h.match(/name="_csrf" value="([^"]+)"/);return m?m[1]:null;}
function png(){return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');}
function listU(){return fs.existsSync(UPLOAD_DIR)?fs.readdirSync(UPLOAD_DIR).filter(f=>!f.endsWith('.gitkeep')):[];}
const db=()=>JSON.parse(fs.readFileSync(DB,'utf8'));
(async()=>{
 const lp=await req('/admin/login');const lt=csrf(await lp.text());
 await req('/admin/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:lt,username:'admin',password:'admin123'}).toString()});
 const fp=await req('/admin/destinasi/baru');const t=csrf(await fp.text());
 const fd=new FormData();
 fd.set('_csrf',t); fd.set('name','Uji Ganti Utama'); fd.set('region','Uji Region'); fd.set('description','Deskripsi uji ganti gambar utama.');
 fd.set('imageFile',new Blob([png()],{type:'image/png'}),'a.png');
 await req('/admin/destinasi',{method:'POST',body:fd});
 const l=await req('/admin/destinasi?q='+encodeURIComponent('Uji Ganti Utama'));
 const id=(await l.text()).match(/\/admin\/destinasi\/([\w-]+)\/edit/)[1];
 const before=db().destinations.find(d=>d.id===id);
 const filesBefore=listU();
 const ep=await req('/admin/destinasi/'+id+'/edit');const et=csrf(await ep.text());
 const fd2=new FormData();
 fd2.set('_csrf',et); fd2.set('name','Uji Ganti Utama'); fd2.set('region','Uji Region'); fd2.set('description','Deskripsi uji ganti gambar utama.');
 fd2.set('imageFile',new Blob([png()],{type:'image/png'}),'b.png');
 await req('/admin/destinasi/'+id,{method:'POST',body:fd2});
 const after=db().destinations.find(d=>d.id===id);
 console.log('gambar utama berubah:', before.image!==after.image?'OK':'BUG');
 console.log('berkas lama terhapus:', !fs.existsSync(path.join(UPLOAD_DIR,before.image.split('/').pop()))?'OK':'BUG');
 const dp=await req('/admin/destinasi/'+id+'/edit');const dt=csrf(await dp.text());
 await req('/admin/destinasi/'+id+'/hapus',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:dt}).toString()});
 console.log('cleanup done');
})().catch(e=>{console.error(e);process.exit(1);});
