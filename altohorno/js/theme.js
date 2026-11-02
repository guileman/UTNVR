// theme.js — paleta y utilidades de lienzo 2D (mismo lenguaje visual que CristaLab)
// Todo el dibujo de menús/notas pasa por estas funciones para que la estética sea idéntica.

export const FONT = 'system-ui, sans-serif';

// Paleta exacta de CristaLab
export const C = {
  panel: 'rgba(16,21,34,.94)',   // fondo de panel
  frame: 0x2a3140,               // marco 3D flat
  leg: 0x4a5160,                 // patas / soportes
  card: '#1b2233',               // tarjetas internas
  sep: '#34405c',                // separadores
  gold: '#ffd34d',               // títulos
  text: '#eef3ff',               // texto principal
  text2: '#c9d4ea',              // texto secundario
  text3: '#8fa0c0',              // texto terciario
  text4: '#9fb0cf',
  section: '#7f93b8',            // encabezados de sección
  btn: '#2e3850', btnHover: '#3d4a66', btnBorder: '#46526e', btnBorderHover: '#9fb3d9',
  on: '#2d6fd6', onHover: '#3c8cff', onBorder: '#9cc6ff',
  danger: '#8e2f2a', dangerHover: '#c2423a',
  disabled: '#262c3a', disabledText: '#5e6779',
  btnText: '#f1f5ff', btnSub: '#a9b4cc', btnSubOn: '#e5efff',
  accent: '#4f9dff', warn: '#ff9f43', hot: '#ff6a3d', hotText: '#ff9f80', ok: '#9dffcf',
  laser: 0x9cd0ff,
};

export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function canvasTex(THREE, cv) {
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// rectángulo con esquinas redondeadas (solo traza el camino)
export function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// texto con salto de línea; devuelve la y siguiente (igual que CristaLab)
export function wrap(g, text, x, y, maxW, lh, maxY) {
  for (const par of String(text).split('\n')) {
    let line = '';
    for (const w of par.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { if (y > maxY) return y; g.fillText(line, x, y); y += lh; line = w; } else line = t;
    }
    if (y > maxY) return y; g.fillText(line, x, y); y += lh;
  }
  return y;
}

// parte el texto en líneas (para paginar / medir); usa la fuente actual de g
export function wrapLines(g, text, maxW, out = []) {
  for (const par of String(text).split('\n')) {
    let line = '';
    for (const w of par.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// texto de una línea que se achica hasta entrar en maxW
export function fitText(g, t, x, y, maxW, px, weight = '') {
  let f = px;
  do { g.font = weight + f + 'px ' + FONT; f--; } while (g.measureText(t).width > maxW && f > 12);
  g.fillText(t, x, y);
}

// logo UTN FRSN — marca de texto como en CristaLab (si hay imagen cargada con setLogo se usa)
let logoImg = null;
export function setLogo(img) { logoImg = img; }
export function drawLogo(g, x, y, w, h) {
  if (logoImg && logoImg.width) {
    const r = Math.min(w / logoImg.width, h / logoImg.height), iw = logoImg.width * r, ih = logoImg.height * r;
    g.drawImage(logoImg, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); return;
  }
  rr(g, x, y, w, h, 14); g.fillStyle = C.card; g.fill(); g.lineWidth = 3; g.strokeStyle = C.gold; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C.gold;
  g.font = 'bold ' + Math.round(h * .44) + 'px ' + FONT; g.fillText('UTN', x + w / 2, y + h * .36);
  g.fillStyle = C.text; g.font = 'bold ' + Math.round(h * .30) + 'px ' + FONT; g.fillText('FRSN', x + w / 2, y + h * .72);
}

// fondo de botón (colores y bordes de CristaLab). b: {x,y,w,h,on,en,danger}
export function buttonBase(g, b, hov, radius = 14) {
  hov = !!hov && b.en !== false;
  rr(g, b.x, b.y, b.w, b.h, radius);
  g.fillStyle = b.en === false ? C.disabled : b.danger ? (hov ? C.dangerHover : C.danger) : b.on ? (hov ? C.onHover : C.on) : (hov ? C.btnHover : C.btn);
  g.fill();
  g.lineWidth = hov ? 4 : 2; g.strokeStyle = b.on ? C.onBorder : hov ? C.btnBorderHover : C.btnBorder; g.stroke();
  return hov;
}

// botón completo. Modos: b.big (título+sub, como CristaLab), b.small, por defecto negrita 27px.
// Extra: b.icon (emoji/letra arriba del rótulo), b.lines (rótulo en 2 líneas), b.fs (tamaño del rótulo)
export function drawButton(g, b, hover) {
  buttonBase(g, b, hover);
  g.fillStyle = b.en === false ? C.disabledText : C.btnText; g.textAlign = 'center'; g.textBaseline = 'middle';
  const cx = b.x + b.w / 2;
  if (b.big) {
    g.font = 'bold 44px ' + FONT; g.fillText(b.label, cx, b.y + 38);
    g.font = '19px ' + FONT; g.fillStyle = b.on ? C.btnSubOn : C.btnSub; g.fillText(b.sub || '', cx, b.y + 78);
  } else if (b.icon || b.lines) {
    const fs = b.fs || 25, lines = b.lines || [b.label];
    const top = b.icon ? b.y + b.h * .30 : b.y + b.h / 2 - (lines.length - 1) * fs * .6;
    if (b.icon) { g.font = Math.round(b.h * .30) + 'px ' + FONT; g.fillText(b.icon, cx, top); }
    g.font = 'bold ' + fs + 'px ' + FONT;
    const y0 = b.icon ? b.y + b.h * .62 - (lines.length - 1) * fs * .55 : top;
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], cx, y0 + i * fs * 1.15 + 1);
  } else if (b.sub) {
    g.font = (b.small ? '23px' : 'bold 26px') + ' ' + FONT; g.fillText(b.label, cx, b.y + b.h * .40);
    g.font = '18px ' + FONT; g.fillStyle = b.on ? C.btnSubOn : C.btnSub; g.fillText(b.sub, cx, b.y + b.h * .76);
  } else { g.font = (b.small ? '23px' : 'bold 27px') + ' ' + FONT; g.fillText(b.label, cx, b.y + b.h / 2 + 1); }
}

// encabezado de sección (#7f93b8 bold 22px)
export function drawSection(g, text, x, y, size = 22) {
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.section; g.font = 'bold ' + size + 'px ' + FONT; g.fillText(text, x, y);
}

// barra deslizante (misma que la de τ en CristaLab). r={x,y,w,h}: caja de la tarjeta.
// frac 0..1, label, valueText, hover: resalta
export function drawSliderCard(g, r, label, valueText, frac, hover, sub) {
  rr(g, r.x, r.y, r.w, r.h, 14); g.fillStyle = C.card; g.fill();
  g.lineWidth = hover ? 4 : 2; g.strokeStyle = hover ? C.btnBorderHover : C.btnBorder; g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.gold; g.font = 'bold 22px ' + FONT; g.fillText(label, r.x + 18, r.y + 28);
  if (sub) { g.fillStyle = C.text3; g.font = '17px ' + FONT; g.fillText(sub, r.x + 18, r.y + 48); }
  g.textAlign = 'right'; g.fillStyle = C.text; g.font = 'bold 26px ' + FONT; g.fillText(valueText, r.x + r.w - 18, r.y + 30);
  const x0 = r.x + 20, x1 = r.x + r.w - 20, bh = 20, by = r.y + r.h - bh - 12;
  rr(g, x0, by, x1 - x0, bh, 10); g.fillStyle = C.btn; g.fill();
  const xv = x0 + Math.max(0, Math.min(1, frac)) * (x1 - x0);
  if (xv > x0 + 1) { rr(g, x0, by, xv - x0, bh, 10); g.fillStyle = C.accent; g.fill(); }
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(xv, by + bh / 2, 13, 0, 7); g.fill();
}

// material de marco 3D flat (#2a3140)
export function frameMat(THREE, extra = {}) {
  return new THREE.MeshLambertMaterial({ color: C.frame, flatShading: true, ...extra });
}
