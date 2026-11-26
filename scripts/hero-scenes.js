'use strict';

/**
 * Modul scene sinematik untuk generator video hero.
 *
 * Setiap scene adalah fungsi render(p) yang menghasilkan SVG lengkap
 * (1280x720) untuk progress lokal p ∈ [0,1). Semua gerak memakai sin/cos dari
 * 2π sehingga akhir scene == awal scene, jadi tiap scene bisa diputar
 * seamless saat digabung.
 *
 * Coordinate space: 1280 x 720, horizon default di y=430.
 */

/* ------------------------------------------------------------------ */
/* Utilitas                                                           */
/* ------------------------------------------------------------------ */

/** Nilai 0..1 untuk sinus siklus penuh — menjamin loop seamless. */
function wave(t, phase = 0, cycles = 1) {
  return (Math.sin((t * cycles + phase) * Math.PI * 2) + 1) / 2;
}

/** Kelembutan transisi antar frame (ease in-out sinus). */
function ease(t) {
  return (1 - Math.cos(t * Math.PI * 2)) / 2;
}

function cloud(x, y, s, opacity, tint) {
  return (
    '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + s.toFixed(3) + ')" opacity="' + opacity.toFixed(3) + '">' +
    '<ellipse cx="0" cy="0" rx="62" ry="17" fill="' + tint + '"/>' +
    '<ellipse cx="34" cy="-12" rx="44" ry="21" fill="' + tint + '"/>' +
    '<ellipse cx="-30" cy="-6" rx="38" ry="15" fill="' + tint + '"/>' +
    '</g>'
  );
}

function palm(x, y, s, color) {
  return (
    '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + s.toFixed(3) + '">' +
    '<path d="M0 0 q -2 -26 2 -44" stroke="' + color + '" stroke-width="3" fill="none"/>' +
    '<path d="M2 -44 q -16 -8 -26 2 q 13 -1 26 4 q 13 -5 26 -4 q -10 -10 -26 -2 Z" fill="' + color + '"/>' +
    '<path d="M2 -44 q 14 -12 30 -8 q -14 3 -24 12 Z" fill="' + color + '"/>' +
    '</g>'
  );
}

function bird(x, y, s, color) {
  return (
    '<path transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + s.toFixed(3) + ')" ' +
    'd="M -12 0 q 6 -7 12 0 q 6 -7 12 0" stroke="' + color + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
  );
}

/** Garis gelombang laut yang bergeser fase (efek air mengalir). */
function waveLines(t, horizon, count, color, step, spread) {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const y = horizon + 16 + i * step;
    const amp = spread + i * (spread * 0.28);
    const phase = t * (1 + i * 0.13);
    const d =
      'M0 ' + (y + Math.sin(phase * Math.PI * 2) * amp).toFixed(1) +
      ' Q 160 ' + (y - amp + Math.sin((phase + 0.25) * Math.PI * 2) * amp).toFixed(1) +
      ' 320 ' + (y + Math.sin(phase * Math.PI * 2 + 1) * amp).toFixed(1) +
      ' T 640 ' + (y + Math.sin((phase + 0.5) * Math.PI * 2) * amp).toFixed(1) +
      ' T 960 ' + (y + Math.sin((phase + 0.75) * Math.PI * 2) * amp).toFixed(1) +
      ' T 1280 ' + (y + Math.sin((phase + 0.25) * Math.PI * 2) * amp).toFixed(1);
    out +=
      '<path d="' + d + '" stroke="' + color + '" stroke-width="' + Math.max(1.2, 3 - i * 0.22).toFixed(2) +
      '" fill="none" stroke-linecap="round" opacity="' + Math.max(0.05, 0.2 - i * 0.014).toFixed(3) + '"/>';
  }
  return out;
}

/** Silpulau karst ikonik Raja Ampat (tinggi, curam). */
function karst(x, baseY, w, h, fill, opacity) {
  return (
    '<path d="M' + (x - w / 2).toFixed(1) + ' ' + baseY +
    ' q ' + (w * 0.18).toFixed(1) + ' ' + (-h * 0.55).toFixed(1) + ' ' + (w * 0.36).toFixed(1) + ' ' + (-h).toFixed(1) +
    ' q ' + (w * 0.16).toFixed(1) + ' ' + (h * 0.34).toFixed(1) + ' ' + (w * 0.3).toFixed(1) + ' ' + (h * 0.62).toFixed(1) +
    ' q ' + (w * 0.1).toFixed(1) + ' ' + (h * 0.22).toFixed(1) + ' ' + (w * 0.34).toFixed(1) + ' ' + (h * 0.38).toFixed(1) +
    ' Z" fill="' + fill + '" opacity="' + opacity.toFixed(3) + '"/>'
  );
}

/* ------------------------------------------------------------------ */
/* Scene 1 — Fajar di Sabesi (subuh, kabut tipis, perahu jauh)       */
/* ------------------------------------------------------------------ */

function sceneDawn(p) {
  const horizon = 430;
  const t = p;

  // Perahu baru tethered — bergerak sangat pelan ke kanan.
  const boatX = 300 + wave(t, 0.1, 1) * 420;
  const boatY = 498 + Math.sin(t * Math.PI * 4) * 3;

  const clouds = [
    cloud(180 + wave(t, 0, 1) * 110, 140, 1.1, 0.16, '#f7efe2'),
    cloud(560 + wave(t, 0.4, 1) * 130, 92, 0.85, 0.13, '#f7efe2'),
    cloud(1020 + wave(t, 0.7, 1) * 120, 176, 1.0, 0.12, '#f7efe2')
  ].join('');

  const birds = [
    bird(420 + wave(t, 0.2, 1) * 90, 196 + wave(t, 0.55, 1) * 16, 0.9, 'rgba(18,54,62,.6)'),
    bird(492 + wave(t, 0.6, 1) * 70, 224 + wave(t, 0.15, 1) * 12, 0.7, 'rgba(18,54,62,.5)'),
    bird(336 + wave(t, 0.85, 1) * 60, 252 + wave(t, 0.4, 1) * 10, 0.55, 'rgba(18,54,62,.4)')
  ].join('');

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' +
    '<defs>' +
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#20465f"/>' +
    '<stop offset="0.34" stop-color="#4c7f96"/>' +
    '<stop offset="0.62" stop-color="#9dc0be"/>' +
    '<stop offset="0.85" stop-color="#e7c69b"/>' +
    '<stop offset="1" stop-color="#f7d9b0"/>' +
    '</linearGradient>' +
    '<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#4a9aa4"/>' +
    '<stop offset="0.28" stop-color="#2b7688"/>' +
    '<stop offset="0.68" stop-color="#144a5a"/>' +
    '<stop offset="1" stop-color="#0a2c38"/>' +
    '</linearGradient>' +
    '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">' +
    '<stop offset="0" stop-color="#ffe6bd" stop-opacity="0.6"/>' +
    '<stop offset="0.5" stop-color="#f0b978" stop-opacity="0.24"/>' +
    '<stop offset="1" stop-color="#f0b978" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#f4ece0" stop-opacity="0.2"/>' +
    '<stop offset="1" stop-color="#f4ece0" stop-opacity="0"/>' +
    '</linearGradient>' +
    '</defs>' +

    '<rect width="1280" height="' + (horizon + 2) + '" fill="url(#sky)"/>' +
    // Matahari terbit di balik silpulau kiri
    '<circle cx="392" cy="392" r="132" fill="url(#glow)"/>' +
    '<circle cx="392" cy="' + (396 - wave(t, 0, 1) * 5).toFixed(1) + '" r="36" fill="#ffe2b4"/>' +
    '<g fill="#f7efe2">' + clouds + '</g>' +
    birds +
    // Silpulau jauh (lembut, berkabut)
    '<path d="M0 430 L0 372 Q 92 318 190 348 Q 258 302 344 344 Q 420 314 500 356 L 546 430 Z" fill="rgba(28,72,86,.42)"/>' +
    '<path d="M840 430 L892 356 Q 966 306 1062 344 Q 1152 300 1280 338 L1280 430 Z" fill="rgba(24,64,78,.5)"/>' +
    // Laut
    '<rect y="' + horizon + '" width="1280" height="' + (720 - horizon) + '" fill="url(#sea)"/>' +
    '<rect y="' + horizon + '" width="1280" height="110" fill="url(#haze)"/>' +
    waveLines(t, horizon, 7, '#ffffff', 40, 4) +
    // Perahu
    '<g transform="translate(' + boatX.toFixed(1) + ',' + boatY.toFixed(1) + ') scale(0.9)">' +
    '<path d="M0 18 L64 18 L54 31 L10 31 Z" fill="#f6f0e6"/>' +
    '<path d="M30 18 L30 -16 L56 14 L32 14 Z" fill="#e8a15c"/>' +
    '<path d="M28 18 L28 -10 L8 14 L26 14 Z" fill="#dccbb0"/>' +
    '<path d="M4 33 q 30 6 56 0" stroke="rgba(255,255,255,.32)" stroke-width="2" fill="none"/>' +
    '</g>' +
    // Pulau dekat kiri + kelapa
    '<path d="M0 720 L0 512 Q 118 448 244 492 Q 334 446 442 504 L506 720 Z" fill="rgba(10,46,56,.88)"/>' +
    palm(112, 496, 1.3, '#072c36') +
    palm(188, 508, 1.0, '#072c36') +
    palm(258, 492, 0.82, '#072c36') +
    // Pulau dekat kanan
    '<path d="M1280 720 L1280 548 Q 1164 494 1054 546 Q 986 510 912 560 L872 720 Z" fill="rgba(8,40,50,.9)"/>' +
    palm(1124, 540, 1.1, '#062630') +
    palm(1046, 554, 0.82, '#062630') +
    '<rect width="1280" height="720" fill="none" stroke="rgba(4,20,28,.26)" stroke-width="90" opacity=".15"/>' +
    '</svg>'
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — Perahu bahari (di tengah laut, hari terik, snorkeling)  */
/* ------------------------------------------------------------------ */

function sceneVoyage(p) {
  const horizon = 410;
  const t = p;

  // Perahu utama melaju ke kanan dengan hollow motion (tidak ada lompatan).
  const boatProgress = (1 - Math.cos(t * Math.PI * 2)) / 2;
  const boatX = 520 + boatProgress * 380;
  const boatY = 470 + Math.sin(t * Math.PI * 6) * 6;
  const boatScale = 0.95 + boatProgress * 0.16;

  // Perahu kedua di kejauhan
  const boat2X = 170 + wave(t, 0.45, 1) * 240;

  const clouds = [
    cloud(260 + wave(t, 0.15, 1) * 100, 110, 1.0, 0.14, '#ffffff'),
    cloud(700 + wave(t, 0.55, 1) * 120, 76, 0.8, 0.12, '#ffffff'),
    cloud(1080 + wave(t, 0.9, 1) * 90, 148, 0.95, 0.11, '#ffffff')
  ].join('');

  // Per snorkeler kecil di sebelah perahu
  const diverX = boatX - 92;
  const diverY = 508 + Math.sin((t + 0.25) * Math.PI * 2) * 8;

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' +
    '<defs>' +
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0f6ea8"/>' +
    '<stop offset="0.45" stop-color="#4fb0cf"/>' +
    '<stop offset="0.8" stop-color="#a9dbe0"/>' +
    '<stop offset="1" stop-color="#d8efe8"/>' +
    '</linearGradient>' +
    '<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#37b6c4"/>' +
    '<stop offset="0.26" stop-color="#15849b"/>' +
    '<stop offset="0.66" stop-color="#0a4a60"/>' +
    '<stop offset="1" stop-color="#04283a"/>' +
    '</linearGradient>' +
    '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/>' +
    '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>' +
    '</radialGradient>' +
    '</defs>' +

    '<rect width="1280" height="' + (horizon + 2) + '" fill="url(#sky)"/>' +
    '<circle cx="900" cy="120" r="190" fill="url(#glow)"/>' +
    '<g fill="#ffffff">' + clouds + '</g>' +
    // Pulau sangat jauh, kabut biru
    '<path d="M0 410 L0 372 Q 70 340 150 366 Q 220 336 300 372 L300 410 Z" fill="rgba(70,120,140,.32)"/>' +
    '<path d="M1010 410 L1060 366 Q 1140 330 1220 362 L1280 356 L1280 410 Z" fill="rgba(70,120,140,.28)"/>' +
    // Laut
    '<rect y="' + horizon + '" width="1280" height="' + (720 - horizon) + '" fill="url(#sea)"/>' +
    // Perahu kedua
    '<g transform="translate(' + boat2X.toFixed(1) + ',468) scale(0.55)" opacity=".85">' +
    '<path d="M0 18 L64 18 L54 31 L10 31 Z" fill="#f4eee3"/>' +
    '<path d="M30 18 L30 -16 L56 14 L32 14 Z" fill="#2f8fb0"/>' +
    '</g>' +
    waveLines(t, horizon, 8, '#ffffff', 38, 6) +
    // Perahu utama + snorkeler
    '<g transform="translate(' + diverX.toFixed(1) + ',' + diverY.toFixed(1) + ')">' +
    '<circle cx="0" cy="0" r="5" fill="rgba(10,40,52,.85)"/>' +
    '<path d="M0 5 q -3 12 6 18" stroke="rgba(10,40,52,.8)" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<path d="M6 20 q 7 4 12 0" stroke="rgba(255,255,255,.45)" stroke-width="2" fill="none"/>' +
    '</g>' +
    '<g transform="translate(' + boatX.toFixed(1) + ',' + boatY.toFixed(1) + ') scale(' + boatScale.toFixed(3) + ')">' +
    '<path d="M0 18 L64 18 L54 31 L10 31 Z" fill="#fbf6ec"/>' +
    '<path d="M30 18 L30 -16 L56 14 L32 14 Z" fill="#ef8f4e"/>' +
    '<path d="M28 18 L28 -10 L8 14 L26 14 Z" fill="#e5d3b7"/>' +
    '<path d="M4 33 q 30 6 56 0" stroke="rgba(255,255,255,.4)" stroke-width="2" fill="none"/>' +
    '<path d="M20 -26 q 10 -6 20 0" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>' +
    '</g>' +
    // Percikan air dari gelombang
    '<g opacity=".5">' +
    '<ellipse cx="' + (300 + wave(t, 0.2, 1) * 500).toFixed(1) + '" cy="600" rx="26" ry="6" fill="rgba(255,255,255,.3)"/>' +
    '<ellipse cx="' + (900 - wave(t, 0.6, 1) * 520).toFixed(1) + '" cy="640" rx="34" ry="7" fill="rgba(255,255,255,.22)"/>' +
    '</g>' +
    '<rect width="1280" height="720" fill="none" stroke="rgba(3,20,30,.24)" stroke-width="90" opacity=".14"/>' +
    '</svg>'
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Senja di Raja Ampat (karst, matahari terbenam)            */
/* ------------------------------------------------------------------ */

function sceneSunset(p) {
  const horizon = 445;
  const t = p;

  // Perahu menjauh ke arah matahari
  const boatProgress = (1 - Math.cos(t * Math.PI * 2)) / 2;
  const boatX = 600 + boatProgress * 300;
  const boatY = 520 + Math.sin(t * Math.PI * 5) * 4;
  const boatScale = 0.9 - boatProgress * 0.42;

  // Silpulau karst Raja Ampat — parallax antar layer
  const far = karst(150, 445, 150, 190, '#1d4c5e', 0.45) +
    karst(330, 445, 120, 140, '#1d4c5e', 0.4) +
    karst(1120, 445, 190, 240, '#173f50', 0.5) +
    karst(930, 445, 110, 120, '#173f50', 0.42);
  const near = karst(60, 470, 210, 280, '#0a2f3c', 0.82) +
    karst(1230, 470, 230, 300, '#082a36', 0.86);

  const clouds = [
    cloud(220 + wave(t, 0.05, 1) * 120, 130, 1.15, 0.16, '#ffd9ac'),
    cloud(640 + wave(t, 0.4, 1) * 110, 88, 0.9, 0.13, '#ffd9ac'),
    cloud(1040 + wave(t, 0.75, 1) * 120, 186, 1.0, 0.14, '#ffd9ac')
  ].join('');

  const birds = [
    bird(430 + wave(t, 0.3, 1) * 100, 208 + wave(t, 0.6, 1) * 18, 1.0, 'rgba(10,32,40,.7)'),
    bird(508 + wave(t, 0.7, 1) * 80, 238 + wave(t, 0.2, 1) * 14, 0.75, 'rgba(10,32,40,.58)')
  ].join('');

  // Pantulan matahari (shimmer) makin lebar ke bawah
  const shimmer = [];
  for (let i = 0; i < 13; i += 1) {
    const y = horizon + 12 + i * 20;
    const w = 60 - i * 3 + wave(t, i * 0.09, 1) * 30;
    const x = 700 - w / 2 + Math.sin((t + i * 0.13) * Math.PI * 2) * 24;
    shimmer.push(
      '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
      '" height="3.5" rx="2" fill="rgba(255,206,140,' + Math.max(0.04, 0.24 - i * 0.016).toFixed(3) + ')"/>'
    );
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' +
    '<defs>' +
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#123a5c"/>' +
    '<stop offset="0.28" stop-color="#2d6b8a"/>' +
    '<stop offset="0.55" stop-color="#8fa9a8"/>' +
    '<stop offset="0.78" stop-color="#e0a172"/>' +
    '<stop offset="1" stop-color="#f7c88f"/>' +
    '</linearGradient>' +
    '<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#c98a5f"/>' +
    '<stop offset="0.16" stop-color="#3d7f8c"/>' +
    '<stop offset="0.52" stop-color="#124b5c"/>' +
    '<stop offset="1" stop-color="#051f2b"/>' +
    '</linearGradient>' +
    '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">' +
    '<stop offset="0" stop-color="#ffd9a0" stop-opacity="0.62"/>' +
    '<stop offset="0.5" stop-color="#f29a52" stop-opacity="0.24"/>' +
    '<stop offset="1" stop-color="#f29a52" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#f7e6cf" stop-opacity="0.22"/>' +
    '<stop offset="1" stop-color="#f7e6cf" stop-opacity="0"/>' +
    '</linearGradient>' +
    '</defs>' +

    '<rect width="1280" height="' + (horizon + 2) + '" fill="url(#sky)"/>' +
    '<circle cx="700" cy="398" r="176" fill="url(#glow)"/>' +
    '<circle cx="700" cy="' + (404 - wave(t, 0, 1) * 8).toFixed(1) + '" r="46" fill="#ffd79c"/>' +
    '<g>' + clouds + '</g>' +
    birds +
    far +
    // Laut
    '<rect y="' + horizon + '" width="1280" height="' + (720 - horizon) + '" fill="url(#sea)"/>' +
    '<rect y="' + horizon + '" width="1280" height="120" fill="url(#haze)"/>' +
    shimmer.join('') +
    waveLines(t, horizon, 7, '#ffffff', 40, 5) +
    // Perahu menjauh
    '<g transform="translate(' + boatX.toFixed(1) + ',' + boatY.toFixed(1) + ') scale(' + boatScale.toFixed(3) + ')" opacity=".9">' +
    '<path d="M0 18 L64 18 L54 31 L10 31 Z" fill="#f6f0e6"/>' +
    '<path d="M30 18 L30 -16 L56 14 L32 14 Z" fill="#c2543c"/>' +
    '<path d="M28 18 L28 -10 L8 14 L26 14 Z" fill="#dccbb0"/>' +
    '</g>' +
    near +
    // Siluet pohon kelapa di silpulau dekat
    palm(120, 560, 1.15, '#062028') +
    palm(1160, 566, 0.95, '#051b23') +
    '<rect width="1280" height="720" fill="none" stroke="rgba(6,14,20,.3)" stroke-width="90" opacity=".18"/>' +
    '</svg>'
  );
}

/* ------------------------------------------------------------------ */
/* Daftar scene                                                       */
/* ------------------------------------------------------------------ */

module.exports = [
  { id: 'dawn', name: 'Fajar di Sabesi', duration: 4, render: sceneDawn },
  { id: 'voyage', name: 'Perahu Bahari', duration: 4, render: sceneVoyage },
  { id: 'sunset', name: 'Senja Raja Ampat', duration: 4, render: sceneSunset }
];
