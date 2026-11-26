'use strict';

/**
 * Generator media hero: video sinematik 3 scene + poster.
 *
 * Video dibuat secara prosedural (SVG → JPEG → H.264) memakai sharp + ffmpeg,
 * sehingga tidak butuh berkas rekaman mentah dan hasilnya tetap ringan.
 *
 * Struktur:
 *   - scripts/hero-scenes.js  → definisi 3 scene (fajar, perahu bahari, senja)
 *   - generator ini           → render frame, encode, mux audio, buat poster
 *
 * Alur scene (total 14,2 detik):
 *   1) Fajar di Sabesi   → kabut subuh, perahu tethered, silpulau jauh
 *   2) Perahu Bahari     → laut terik, speedboat, Diving/snorkeling
 *   3) Senja Raja Ampat  → silpulau karst, matahari terbenam
 *   4) Fajar di Sabesi   → penutup, kembali ke awal (loop tertutup)
 *
 * Transisi antar scene memakai xfade (cross-dissolve) 0,6 detik.
 * Scene 1 diputar dua kali (awal & akhir). Karena semua gerak scene berbasis
 * sin/cos dari 2πp, frame p=1 identik dengan p=0 → video kembali ke awal
 * tanpa kedipan.
 *
 * Jalankan: npm run hero-media
 * Keluaran:
 *   public/media/hero-islands.mp4       (video + ambient audio AAC)
 *   public/img/hero-island-poster.jpg   (poster fallback)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

const SCENES = require('./hero-scenes');

const ROOT = path.join(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'public', 'media');
const IMG_DIR = path.join(ROOT, 'public', 'img');

const FPS = 20;
const SCENE_SECONDS = 4; // durasi tiap scene (detik)
const XFADE = 0.6; // durasi transisi cross-dissolve (detik)

/* Urutan playback: 3 scene + penutup scene 1 (loop tertutup). */
const SEQUENCE = [SCENES[0], SCENES[1], SCENES[2], SCENES[0]];

const FRAMES_PER_SCENE = FPS * SCENE_SECONDS;

/* Durasi akhir: jumlah scene - jumlah transisi yang saling tumpang tindih. */
const DURATION = SCENE_SECONDS + (SEQUENCE.length - 1) * (SCENE_SECONDS - XFADE);

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Utilitas                                                           */
/* ------------------------------------------------------------------ */

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(cmd + ' gagal (exit ' + res.status + ')');
  }
}

function kb(file) {
  return Math.round(fs.statSync(file).size / 1024);
}

/* ------------------------------------------------------------------ */
/* Render frame                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render tiap scene unik ke folder terpisah berisi JPEG bernomor,
 * agar ffmpeg bisa mengumpulkannya dengan pola %05d.jpg.
 */
async function renderFrames() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jje-hero-'));
  console.log('Folder sementara:', tmpDir);

  const unique = [];
  SEQUENCE.forEach((scene) => {
    if (!unique.some((s) => s.id === scene.id)) unique.push(scene);
  });

  let done = 0;

  for (let s = 0; s < unique.length; s += 1) {
    const scene = unique[s];
    const dir = path.join(tmpDir, 'scene' + String(s).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });

    for (let i = 0; i < FRAMES_PER_SCENE; i += 1) {
      // p berada di [0,1) supaya frame terakhir tidak identik dengan frame 0.
      const p = i / FRAMES_PER_SCENE;
      const svg = scene.render(p);
      const buf = await sharp(Buffer.from(svg))
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer();
      fs.writeFileSync(path.join(dir, String(i).padStart(5, '0') + '.jpg'), buf);

      done += 1;
      if (done % 40 === 0) {
        console.log('  frame ' + done + '/' + FRAMES_PER_SCENE * unique.length + '  (' + scene.name + ')');
      }
    }

    console.log('  scene ' + (s + 1) + '/' + unique.length + ': ' + scene.name + ' selesai');
  }

  return tmpDir;
}

/* ------------------------------------------------------------------ */
/* Encode                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const tmpDir = await renderFrames();

  const silentVideo = path.join(tmpDir, 'silent.mp4');
  const audioWav = path.join(tmpDir, 'ambient.wav');
  const outMp4 = path.join(MEDIA_DIR, 'hero-islands.mp4');
  const posterJpg = path.join(IMG_DIR, 'hero-island-poster.jpg');

  /* --- 1. Video: rantai xfade antar scene --------------------------- */
  console.log('Encoding video (H.264 + crossfade)...');

  const sceneDirs = SEQUENCE.map((scene, idx) => {
    // Scene 1 diulang → folder yang sama dipakai dua kali.
    const uniqueIdx = SEQUENCE.findIndex((s) => s.id === scene.id);
    return path.join(tmpDir, 'scene' + String(uniqueIdx).padStart(2, '0'), '%05d.jpg');
  });

  const inputs = [];
  SEQUENCE.forEach((_, idx) => {
    inputs.push('-framerate', String(FPS), '-i', sceneDirs[idx]);
  });

  const filters = [];
  let prev = '0:v';
  for (let s = 1; s < SEQUENCE.length; s += 1) {
    // Offset kumulatif: transisi ke-1 mulai di (D-F), berikutnya ditambah (D-F).
    const offset = s * (SCENE_SECONDS - XFADE);
    filters.push(
      '[' + prev + '][' + s + ':v]xfade=transition=fade:duration=' + XFADE +
      ':offset=' + offset.toFixed(3) + '[v' + s + ']'
    );
    prev = 'v' + s;
  }

  const lastLabel = 'v' + (SEQUENCE.length - 1);
  filters.push(
    '[' + lastLabel + ']eq=brightness=0.035:contrast=1.06:saturation=1.18[outv]'
  );

  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    '-t', DURATION.toFixed(3),
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-profile:v', 'main',
    '-preset', 'slow',
    '-crf', '30',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-g', String(FPS * 2),
    silentVideo
  ]);

  /* --- 2. Audio ambient: ombak + drone ------------------------------ */
  console.log('Menyusun ambient audio (ombak)…');
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.22:duration=' + DURATION + ':sample_rate=44100',
    '-f', 'lavfi', '-i', 'sine=frequency=58:duration=' + DURATION + ':sample_rate=44100',
    '-filter_complex',
    '[0:a]lowpass=f=620,volume=0.55,tremolo=f=0.13:d=0.75[sea];' +
    '[1:a]volume=0.035,tremolo=f=0.11:d=0.6[drone];' +
    '[sea][drone]amix=inputs=2:duration=first,afade=t=in:st=0:d=1.4,' +
    'afade=t=out:st=' + (DURATION - 1.6).toFixed(2) + ':d=1.6,' +
    'aformat=sample_fmts=fltp:channel_layouts=stereo[out]',
    '-map', '[out]',
    audioWav
  ]);

  /* --- 3. Mux video + audio ----------------------------------------- */
  console.log('Mux video + audio...');
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', silentVideo,
    '-i', audioWav,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
    '-shortest',
    '-movflags', '+faststart',
    outMp4
  ]);

  /* --- 4. Poster: frame dari video final ---------------------------- */
  console.log('Membuat poster…');
  // Poster diambil dari frame video final (bukan gambar mentah) supaya
  // warna poster identik dengan video yang tampil — termasuk koreksi eq=.
  const posterFrame = path.join(tmpDir, 'poster.png');
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', '5', '-i', outMp4, '-vframes', '1', posterFrame
  ]);
  await sharp(posterFrame)
    .resize(1600, 900, { fit: 'cover' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(posterJpg);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\nSelesai:');
  console.log('  video  : ' + outMp4 + ' (' + kb(outMp4) + ' KB, ' + DURATION.toFixed(1) + ' detik)');
  console.log('  poster : ' + posterJpg + ' (' + kb(posterJpg) + ' KB)');
}

main().catch((err) => {
  console.error('Gagal:', err.message);
  process.exit(1);
});
