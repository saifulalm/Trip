'use strict';

/**
 * Generator ilustrasi SVG pulau untuk seayoulatertrip.com.
 * Setiap destinasi mendapat palet langit/laut yang berbeda.
 * Jalankan: npm run images
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function cloud(cx, cy, s, o) {
  return (
    '<g transform="translate(' + cx + ',' + cy + ')" opacity="' + o + '">' +
    '<ellipse cx="0" cy="0" rx="16" ry="6" fill="#fff"/>' +
    '<ellipse cx="10" cy="-4" rx="10" ry="5" fill="#fff"/>' +
    '<ellipse cx="-10" cy="-2" rx="9" ry="4.5" fill="#fff"/>' +
    '</g>'
  );
}

function stars() {
  let out = '';
  for (let i = 0; i < 40; i += 1) {
    const x = ((i * 97) % 100) + (i % 3);
    const y = ((i * 53) % 45) + 2;
    const r = 0.6 + (i % 3) * 0.35;
    const o = 0.4 + (i % 5) * 0.12;
    out += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff" opacity="' + o + '"/>';
  }
  return out;
}

function scene(cfg) {
  const skyId = 'sky-' + cfg.id;
  const seaId = 'sea-' + cfg.id;
  const glowId = 'glow-' + cfg.id;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 56" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
    '<linearGradient id="' + skyId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + cfg.skyTop + '"/>' +
    '<stop offset="1" stop-color="' + cfg.skyBottom + '"/>' +
    '</linearGradient>' +
    '<linearGradient id="' + seaId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + cfg.seaFar + '"/>' +
    '<stop offset="1" stop-color="' + cfg.seaNear + '"/>' +
    '</linearGradient>' +
    '<linearGradient id="' + glowId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + cfg.sunColor + '" stop-opacity="0.55"/>' +
    '<stop offset="1" stop-color="' + cfg.sunColor + '" stop-opacity="0"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<rect width="100" height="56" fill="url(#' + skyId + ')"/>' +
    (cfg.night ? stars() : '') +
    '<circle cx="' + cfg.sunX + '" cy="' + cfg.sunY + '" r="' + cfg.sunR * 2.6 + '" fill="url(#' + glowId + ')"/>' +
    '<circle cx="' + cfg.sunX + '" cy="' + cfg.sunY + '" r="' + cfg.sunR + '" fill="' + cfg.sunColor + '"/>' +
    cloud(18, 10, 0.9, 0.5) +
    cloud(72, 7, 0.7, 0.4) +
    cloud(45, 14, 0.55, 0.3) +
    '<path d="M0 34 Q 14 26 28 31 T 56 29 T 84 32 T 100 30 L 100 40 L 0 40 Z" fill="' + cfg.hillBack + '" opacity="0.85"/>' +
    '<rect y="33" width="100" height="23" fill="url(#' + seaId + ')"/>' +
    '<path d="M0 36 Q 20 33 38 36 T 74 35 T 100 37 L 100 44 L 0 44 Z" fill="' + cfg.hillFront + '" opacity="0.9"/>' +
    '<ellipse cx="24" cy="42" rx="14" ry="2.4" fill="#ffffff" opacity="0.18"/>' +
    '<ellipse cx="68" cy="47" rx="18" ry="2.8" fill="#ffffff" opacity="0.12"/>' +
    '<ellipse cx="50" cy="52" rx="30" ry="3" fill="#ffffff" opacity="0.08"/>' +
    '<path d="M60 44 q 2 -1.6 4 0" stroke="#ffffff" stroke-width="0.35" fill="none" opacity="0.5"/>' +
    '<path d="M66 46.5 q 2 -1.6 4 0" stroke="#ffffff" stroke-width="0.35" fill="none" opacity="0.4"/>' +
    '<g transform="translate(84,38)">' +
    '<path d="M0 0 L0 -7" stroke="' + cfg.hillFront + '" stroke-width="0.7"/>' +
    '<path d="M0 -7 q -4 -2 -6 0 q 3 1 6 0.6 q 3 0.6 6 -0.6 q -2.2 -2 -6 0" fill="' + cfg.hillFront + '"/>' +
    '<path d="M0 -7 q -3 -3.4 -5.4 -3.6 q 2.6 2 5.4 3.2 q 2.8 -1.2 5.4 -3.2 q -2.4 0.2 -5.4 3.6" fill="' + cfg.hillFront + '"/>' +
    '</g>' +
    '<path d="M10 50 l 7 -1.4 l 7 1.4 l -7 1.4 Z" fill="#ffffff" opacity="0.75"/>' +
    '<path d="M17 48.6 l 0 -2.2 l 2.4 3 Z" fill="#ffffff" opacity="0.85"/>' +
    '</svg>'
  );
}

const scenes = [
  { file: 'dest-sabesi.svg', opts: { id: 'sabesi', skyTop: '#0e3f56', skyBottom: '#f2a65a', sunX: 74, sunY: 22, sunR: 5.2, sunColor: '#ffd27a', seaFar: '#1d7a8c', seaNear: '#0b4a5e', hillBack: '#123a44', hillFront: '#0a2c33', night: false } },
  { file: 'dest-weh.svg', opts: { id: 'weh', skyTop: '#123c64', skyBottom: '#7fd0d8', sunX: 30, sunY: 14, sunR: 4.4, sunColor: '#fff3c4', seaFar: '#1e97a7', seaNear: '#0d5c71', hillBack: '#15525c', hillFront: '#0b333a', night: false } },
  { file: 'dest-misool.svg', opts: { id: 'misool', skyTop: '#1b2a5e', skyBottom: '#e98d68', sunX: 50, sunY: 20, sunR: 5.6, sunColor: '#ffb56b', seaFar: '#246b8c', seaNear: '#102f4a', hillBack: '#17324a', hillFront: '#0c1f31', night: false } },
  { file: 'dest-derawan.svg', opts: { id: 'derawan', skyTop: '#0f4d5c', skyBottom: '#8ee0d2', sunX: 62, sunY: 12, sunR: 4, sunColor: '#fff1b8', seaFar: '#1fa2a8', seaNear: '#0b5a66', hillBack: '#17615f', hillFront: '#0b3a38', night: false } },
  { file: 'dest-togean.svg', opts: { id: 'togean', skyTop: '#25224f', skyBottom: '#c96f8e', sunX: 22, sunY: 24, sunR: 4.8, sunColor: '#ffce8f', seaFar: '#2b5e8f', seaNear: '#132a4b', hillBack: '#1c2a44', hillFront: '#0e182b', night: false } },
  { file: 'dest-ora.svg', opts: { id: 'ora', skyTop: '#0b2a4a', skyBottom: '#3f8f9d', sunX: 84, sunY: 16, sunR: 3.6, sunColor: '#e8f7ff', seaFar: '#178e9d', seaNear: '#083c50', hillBack: '#0f4a52', hillFront: '#08292e', night: true } },
  { file: 'dest-default.svg', opts: { id: 'default', skyTop: '#14495e', skyBottom: '#9fd8cf', sunX: 50, sunY: 15, sunR: 4.2, sunColor: '#ffe9a8', seaFar: '#1e93a3', seaNear: '#0c4d60', hillBack: '#15525c', hillFront: '#0a3038', night: false } }
];

for (const s of scenes) {
  fs.writeFileSync(path.join(OUT, s.file), scene(s.opts), 'utf8');
  console.log('ditulis:', s.file);
}

const logo =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
  '<circle cx="24" cy="24" r="23" fill="#0b3a44"/>' +
  '<circle cx="24" cy="24" r="23" fill="none" stroke="#f2a65a" stroke-width="1.6" stroke-dasharray="3 2.4"/>' +
  '<circle cx="31" cy="16" r="4.4" fill="#ffd27a"/>' +
  '<path d="M6 30 q 6 -5 12 -2 t 12 -1 t 12 2 v 10 h -36 Z" fill="#1d7a8c"/>' +
  '<path d="M6 34 q 6 -3 12 0 t 12 -1 t 12 1 v 7 h -36 Z" fill="#0f5c6e"/>' +
  '<path d="M22 30 l 4 -6 l 4 6 Z" fill="#0a2c33"/>' +
  '</svg>';
fs.writeFileSync(path.join(OUT, 'logo.svg'), logo, 'utf8');
console.log('ditulis: logo.svg');