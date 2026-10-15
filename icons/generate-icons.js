// ============================================================
// generate-icons.js — génère les icônes de l'application
// ------------------------------------------------------------
// Aucun module à installer : on dessine les pixels nous-mêmes
// et on les encode en PNG avec zlib (inclus dans Node.js).
//
// Utilisation (depuis le dossier du projet) :
//     node tools/generate-icons.js
//
// Fichiers produits dans le dossier icons/ :
//   icon.svg               icône vectorielle (onglet du navigateur)
//   icon-192.png           icône Android / ordinateur
//   icon-512.png           grande icône (écran de démarrage Android)
//   icon-maskable-512.png  icône "adaptative" Android (fond plein)
//   apple-touch-icon.png   icône iPhone (180 x 180, fond plein)
// ============================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');

// Couleurs (R, V, B)
const COLORS = {
  background: [156, 74, 42],  // caramel / chocolat (#9c4a2a)
  frosting:   [255, 248, 240], // crème
  wrapper:    [244, 190, 110], // caissette dorée
  stripe:     [214, 150, 72],  // rayures de la caissette
  cherry:     [214, 40, 57],   // cerise
};

// ---------- Dessin du cupcake (coordonnées normalisées 0..1) ----------

// Couches de glaçage : ellipses empilées (cx, cy, rx, ry)
const FROSTING = [
  [0.5, 0.540, 0.290, 0.080],
  [0.5, 0.450, 0.240, 0.090],
  [0.5, 0.360, 0.170, 0.080],
  [0.5, 0.290, 0.090, 0.060],
];
const CHERRY = { cx: 0.5, cy: 0.215, r: 0.055 };
const WRAPPER = { top: 0.56, bottom: 0.84, halfTop: 0.23, halfBottom: 0.17 };

function inEllipse(u, v, [cx, cy, rx, ry]) {
  const dx = (u - cx) / rx, dy = (v - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

// Couleur du contenu (cupcake) au point (u, v), ou null si rien.
function cupcakeColor(u, v) {
  const dc = Math.hypot(u - CHERRY.cx, v - CHERRY.cy);
  if (dc <= CHERRY.r) return COLORS.cherry;
  if (FROSTING.some(e => inEllipse(u, v, e))) return COLORS.frosting;
  if (v >= WRAPPER.top && v <= WRAPPER.bottom) {
    const t = (v - WRAPPER.top) / (WRAPPER.bottom - WRAPPER.top);
    const half = WRAPPER.halfTop + (WRAPPER.halfBottom - WRAPPER.halfTop) * t;
    const rel = (u - 0.5) / half; // -1 .. 1 dans la caissette
    if (Math.abs(rel) <= 1) {
      // 5 rayures verticales
      const stripe = ((rel + 1) * 2.5) % 1;
      return stripe < 0.14 && Math.abs(rel) < 0.9 ? COLORS.stripe : COLORS.wrapper;
    }
  }
  return null;
}

// Le point (x, y) est-il dans le carré aux coins arrondis de rayon r ?
function inRoundedSquare(x, y, r) {
  if (r <= 0) return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// Couleur [r, g, b, a] d'un point de l'icône.
//   radius : arrondi des coins (0 = carré plein)
//   scale  : taille du cupcake (plus petit = plus de marge)
function iconColor(x, y, { radius, scale }) {
  if (!inRoundedSquare(x, y, radius)) return [0, 0, 0, 0];
  const u = (x - 0.5) / scale + 0.5;
  const v = (y - 0.5) / scale + 0.5;
  const c = cupcakeColor(u, v) || COLORS.background;
  return [c[0], c[1], c[2], 255];
}

// Dessine l'icône avec anticrénelage (4 x 4 échantillons par pixel).
function render(size, opts) {
  const S = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = iconColor((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, opts);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
      pixels[i + 3] = Math.round(a / (S * S));
    }
  }
  return pixels;
}

// ---------- Encodage PNG minimal ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 8 bits par canal
  ihdr[9] = 6;  // RGBA
  // Chaque ligne commence par un octet de filtre (0 = aucun)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Version SVG (mêmes formes) ----------

function buildSVG({ radius, scale }) {
  const N = 512;
  const hex = c => '#' + c.map(n => n.toString(16).padStart(2, '0')).join('');
  const w = WRAPPER;
  const pts = [
    [0.5 - w.halfTop, w.top], [0.5 + w.halfTop, w.top],
    [0.5 + w.halfBottom, w.bottom], [0.5 - w.halfBottom, w.bottom],
  ].map(([x, y]) => `${(x * N).toFixed(1)},${(y * N).toFixed(1)}`).join(' ');
  const ellipses = FROSTING.map(([cx, cy, rx, ry]) =>
    `<ellipse cx="${cx * N}" cy="${(cy * N).toFixed(1)}" rx="${(rx * N).toFixed(1)}" ry="${(ry * N).toFixed(1)}"/>`
  ).join('');
  const t = (0.5 - scale / 2) * N;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}">
<rect width="${N}" height="${N}" rx="${radius * N}" fill="${hex(COLORS.background)}"/>
<g transform="translate(${t.toFixed(1)} ${t.toFixed(1)}) scale(${scale})">
<polygon points="${pts}" fill="${hex(COLORS.wrapper)}"/>
<g fill="${hex(COLORS.frosting)}">${ellipses}</g>
<circle cx="${CHERRY.cx * N}" cy="${(CHERRY.cy * N).toFixed(1)}" r="${(CHERRY.r * N).toFixed(1)}" fill="${hex(COLORS.cherry)}"/>
</g>
</svg>
`;
}

// ---------- Génération des fichiers ----------

const ICONS = [
  { file: 'icon-192.png',          size: 192, radius: 0.22, scale: 0.9 },
  { file: 'icon-512.png',          size: 512, radius: 0.22, scale: 0.9 },
  // "maskable" : fond plein, dessin dans la zone de sécurité centrale (80 %)
  { file: 'icon-maskable-512.png', size: 512, radius: 0,    scale: 0.72 },
  // iPhone arrondit lui-même les coins : fond plein, sans transparence
  { file: 'apple-touch-icon.png',  size: 180, radius: 0,    scale: 0.82 },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const icon of ICONS) {
  const png = encodePNG(icon.size, render(icon.size, icon));
  fs.writeFileSync(path.join(OUT_DIR, icon.file), png);
  console.log('✓', icon.file, `(${icon.size}x${icon.size})`);
}
fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), buildSVG({ radius: 0.22, scale: 0.9 }));
console.log('✓ icon.svg');
