// Uji siklus unggah galeri (multi-file) pada admin Destinasi.
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:' + (process.env.PORT || 4104);
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const DB = path.join(__dirname, '..', 'data', 'db.json');
let cookie = '';
function saveCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) { const p = c.split(';')[0]; const [n] = p.split('=');
    cookie = cookie.split('; ').filter(x => x && !x.startsWith(n + '=')).concat([p]).join('; '); }
}
async function req(u, o = {}) { const r = await fetch(BASE+u, {redirect:'manual', ...o, headers:{cookie, ...(o.headers||{})}}); saveCookie(r); return r; }
function csrf(h) { const m = h.match(/name="_csrf" value="([^"]+)"/); return m ? m[1] : null; }
function png() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'); }
function listUploads() { return fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter(f => !f.endsWith('.gitkeep')) : []; }
const db = () => JSON.parse(fs.readFileSync(DB,'utf8'));

(async () => {
  const lp = await req('/admin/login'); const lt = csrf(await lp.text());
  await req('/admin/login', {method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({_csrf:lt,username:'admin',password:'admin123'}).toString()});

  const fp = await req('/admin/destinasi/baru');
  const t = csrf(await fp.text());

  // Buat destinasi dengan 1 gambar utama + 3 foto galeri
  const fd = new FormData();
  fd.set('_csrf', t);
  fd.set('name','Uji Galeri Multi');
  fd.set('region','Uji Region');
  fd.set('description','Deskripsi uji galeri multi berkas.');
  fd.set('imageFile', new Blob([png()],{type:'image/png'}), 'main.png');
  fd.append('galleryFiles', new Blob([png()],{type:'image/png'}), 'g1.png');
  fd.append('galleryFiles', new Blob([png()],{type:'image/png'}), 'g2.png');
  fd.append('galleryFiles', new Blob([png()],{type:'image/png'}), 'g3.png');
  const cRes = await req('/admin/destinasi', {method:'POST', body: fd});
  console.log('create:', cRes.status, cRes.headers.get('location'));

  const lp2 = await req('/admin/destinasi?q=' + encodeURIComponent('Uji Galeri Multi'));
  const html = await lp2.text();
  const idm = html.match(/\/admin\/destinasi\/([\w-]+)\/edit/);
  const id = idm && idm[1];
  console.log('id:', id);

  const dest = db().destinations.find(d => d.id === id);
  console.log('gallery length:', dest.gallery.length, '(harus 4: 1 utama + 3 galeri)');
  console.log('gallery:', dest.gallery.map(u=>u.split('/').pop()).join(', '));

  // Hapus 1 foto galeri via checkbox removeGallery
  const ep = await req('/admin/destinasi/'+id+'/edit');
  const et = csrf(await ep.text());
  const fd2 = new FormData();
  fd2.set('_csrf', et);
  fd2.set('name','Uji Galeri Multi');
  fd2.set('region','Uji Region');
  fd2.set('description','Deskripsi uji galeri multi berkas.');
  const toRemove = dest.gallery[1];
  fd2.append('removeGallery', toRemove);
  const eRes = await req('/admin/destinasi/'+id, {method:'POST', body: fd2});
  const dest2 = db().destinations.find(d => d.id === id);
  console.log('after remove 1:', dest2.gallery.length, '(harus 3)');
  const stillThere = dest2.gallery.includes(toRemove);
  console.log('foto yang dicentang hilang dari data:', !stillThere ? 'OK' : 'BUG');
  const fileGone = !fs.existsSync(path.join(UPLOAD_DIR, toRemove.split('/').pop()));
  console.log('berkas foto dihapus dari disk:', fileGone ? 'OK' : 'BUG');

  // Bersihkan
  const dp = await req('/admin/destinasi/'+id+'/edit');
  const dt = csrf(await dp.text());
  await req('/admin/destinasi/'+id+'/hapus', {method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({_csrf:dt}).toString()});
  console.log('cleanup: dihapus');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
