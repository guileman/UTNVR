// furnace.js — Alto horno a escala real (1 u = 1 m) + navegación analítica (Contratos 1 y 3 del SPEC).
// Port de /work/alto_horno.scad. Mapeo OpenSCAD → three.js: (x, y, z)_scad → (x, z, −y)_three.
// Sin imports: recibe THREE por parámetro (funciona también en Node para probar `nav`).
//
// Convenciones internas:
//  * Ángulo en planta θ = atan2(z, x)  (x = r·cosθ, z = r·sinθ). Un ángulo a del .scad equivale a θ = −a.
//  * Revoluciones con lathe propio: x = r·sinφ, z = r·cosφ (como THREE.LatheGeometry); UV en metros.
//  * Cuarto de corte = cuadrante x>0, z>0 (φ∈[0,π/2]); se construye "principal" (270°) + "cuña" (90°).
//  * Geometría estática agrupada por material en lotes (merge) → pocas draw calls; repetidos con InstancedMesh.

export function buildFurnace(THREE, opts = {}) {
  const PC = opts.quality === 'pc';
  const NF = PC ? 160 : 96;      // segmentos de revolución del horno
  const NM = PC ? 80 : 48;       // estufas, colector, cabezal
  const NS = PC ? 14 : 10;       // tubos
  const NT = PC ? 8 : 6;         // tubitos (barandas, celosía)
  const TAU = Math.PI * 2, DEG = Math.PI / 180, HALF = Math.PI / 2;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const Y_UP = V(0, 1, 0);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const root = new THREE.Group(); root.name = 'AltoHorno';
  const anchors = {}, dirs = {}, parts = {};
  const A = (n, x, y, z) => (anchors[n] = V(x, y, z));

  // ============================================================ PERFIL (igual que el .scad)
  const ZS = [4, 9, 12.5, 14, 28, 31, 34];
  const RO = [5.5, 5.5, 6.2, 6.2, 4.2, 4.2, 1.6];
  const TH = [1.4, 1.4, 0.9, 0.9, 0.7, 0.7, 0.5];
  function interp(a, y) {
    const yc = clamp(y, ZS[0], ZS[ZS.length - 1]);
    let i = 0;
    for (let k = 0; k < ZS.length - 1; k++) if (yc >= ZS[k]) i = k;
    i = Math.min(i, ZS.length - 2);
    const t = (yc - ZS[i]) / (ZS[i + 1] - ZS[i]);
    return a[i] * (1 - t) + a[i + 1] * t;
  }
  const rext = (y) => interp(RO, y);
  const rint = (y) => interp(RO, y) - interp(TH, y);
  const profile = { zs: ZS.slice(), ro: RO.slice(), th: TH.slice(), yHearth: 6.5, yTop: 34, rext, rint };

  // ============================================================ TEXTURAS PROCEDURALES (CanvasTexture)
  const hasDOM = typeof document !== 'undefined';
  let seed = 1234567;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function canvasTex(w, h, tileW, tileH, draw) {
    if (!hasDOM) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tileW, 1 / tileH);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function blotches(g, w, h, n, pal, rmin, rmax, amin, amax) {
    for (let i = 0; i < n; i++) {
      const c = pal[(rnd() * pal.length) | 0], a = amin + rnd() * (amax - amin);
      g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      const x = rnd() * w, y = rnd() * h, rx = rmin + rnd() * (rmax - rmin), ry = rx * (0.5 + rnd());
      for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) { // costura sin cortes (tileable)
        if (x + ox + rx < 0 || x + ox - rx > w || y + oy + ry < 0 || y + oy - ry > h) continue;
        g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, 0, 0, TAU); g.fill();
      }
    }
  }
  // chapa oxidada 2.0 m × 1.5 m: cordón horizontal arriba, vertical a la izquierda, remaches a ambos lados
  const texRust = canvasTex(512, 384, 2.0, 1.5, (g, w, h) => {
    g.fillStyle = 'rgb(126,94,76)'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, 900, [[150, 88, 52], [92, 68, 56], [118, 104, 94], [168, 112, 66], [76, 58, 50], [140, 120, 100]], 2, 16, 0.06, 0.22);
    for (let i = 0; i < 70; i++) { // chorreaduras
      const x = rnd() * w, y = rnd() * h, L = 30 + rnd() * 160;
      const gr = g.createLinearGradient(0, y, 0, y + L);
      gr.addColorStop(0, 'rgba(110,58,30,0.22)'); gr.addColorStop(1, 'rgba(110,58,30,0)');
      g.fillStyle = gr; g.fillRect(x, y, 2 + rnd() * 4, L);
    }
    const seamH = (y) => { g.fillStyle = 'rgb(58,48,44)'; g.fillRect(0, y, w, 7); g.fillStyle = 'rgba(190,160,140,0.35)'; g.fillRect(0, y + 7, w, 2); };
    const seamV = (x) => { g.fillStyle = 'rgb(58,48,44)'; g.fillRect(x, 0, 7, h); g.fillStyle = 'rgba(190,160,140,0.35)'; g.fillRect(x + 7, 0, 2, h); };
    seamH(0); seamV(0);
    const rivet = (x, y) => {
      g.fillStyle = 'rgb(48,40,37)'; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill();
      g.fillStyle = 'rgba(205,180,160,0.55)'; g.beginPath(); g.arc(x - 1.5, y - 1.5, 2, 0, TAU); g.fill();
    };
    for (let x = 20; x < w; x += 38) { rivet(x, 20); rivet(x, h - 12); }
    for (let y = 24; y < h; y += 38) { rivet(20, y); rivet(w - 12, y); }
  });
  // ladrillo refractario 1 m × 1 m: 8 hiladas de 0.125 m, ladrillos de 0.25 m trabados
  const texBrick = canvasTex(256, 256, 1, 1, (g, w, h) => {
    g.fillStyle = 'rgb(206,182,150)'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 4; c++) {
      const x = c * 64 + (r % 2) * 32, y = r * 32, k = 0.8 + rnd() * 0.35;
      g.fillStyle = `rgb(${(184 * k) | 0},${(88 * k) | 0},${(56 * k) | 0})`;
      g.fillRect(x + 2, y + 2, 60, 28);
      g.fillStyle = 'rgba(60,20,10,0.12)'; g.fillRect(x + 2, y + 24, 60, 6);
    }
    blotches(g, w, h, 180, [[120, 60, 40], [230, 200, 170], [90, 50, 35]], 1, 4, 0.08, 0.25);
  });
  // hormigón 6 m × 6 m con juntas de dilatación en el borde
  const texConc = canvasTex(256, 256, 6, 6, (g, w, h) => {
    g.fillStyle = 'rgb(168,166,158)'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, 700, [[150, 148, 140], [185, 183, 176], [130, 128, 122], [160, 150, 135]], 1, 9, 0.05, 0.2);
    g.fillStyle = 'rgb(88,88,88)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
  });
  // rejilla (grating) 0.5 m × 0.5 m
  const texGrate = canvasTex(128, 128, 0.5, 0.5, (g, w, h) => {
    g.fillStyle = 'rgb(52,54,58)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(150,153,160)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 3, h);
    g.fillStyle = 'rgb(122,125,132)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
  });
  // damero de estufa (celdas 0.28 m, huecos 0.13 m)
  const texChecker = canvasTex(128, 128, 0.56, 0.56, (g, w, h) => {
    g.fillStyle = 'rgb(176,92,60)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(40,18,12)';
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.fillRect(i * 64 + 17, j * 64 + 17, 30, 30);
  });

  // ============================================================ MATERIALES
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0.1 }, o));
  const tex = (map, flat, tint, o = {}) => std(Object.assign({ map: map || null, color: map ? tint : flat }, o));
  const M = {
    concrete: tex(texConc, 0xa8a69e, 0xffffff, { roughness: 0.95, metalness: 0 }),
    shellF: tex(texRust, 0x80614f, 0xffffff, { roughness: 0.85, metalness: 0.25 }),          // casco del horno (rayos X)
    head: tex(texRust, 0x80614f, 0xffffff, { roughness: 0.85, metalness: 0.25, side: THREE.DoubleSide }),
    stave: tex(texRust, 0x6c5244, 0xd0c4bc, { roughness: 0.9, metalness: 0.2 }),
    shell: tex(texRust, 0x80614f, 0xffffff, { roughness: 0.85, metalness: 0.25 }),           // estufas, colector, bajantes
    lining: tex(texBrick, 0xb85738, 0xffffff, { roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    trough: tex(texConc, 0x5e4b42, 0x8a6e60, { roughness: 0.95, metalness: 0 }),   // hormigón refractario de canal
    checker: tex(texChecker, 0xa85a3c, 0xffffff, { roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    steel: std({ color: 0x80838a, roughness: 0.5, metalness: 0.6 }),
    hopper: std({ color: 0x6f7176, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    dark: std({ color: 0x45403c, roughness: 0.7, metalness: 0.4 }),
    yellow: std({ color: 0xebc21a, roughness: 0.55, metalness: 0.2 }),
    grate: tex(texGrate, 0x4d4f53, 0xffffff, { roughness: 0.6, metalness: 0.5 }),
    hotMain: std({ color: 0x9e4d33, roughness: 0.75, metalness: 0.2, emissive: 0xff4a12, emissiveIntensity: 0 }),
    bustle: std({ color: 0x9e4d33, roughness: 0.75, metalness: 0.2, emissive: 0xff4a12, emissiveIntensity: 0 }),
    tuyereGlow: std({ color: 0xb87333, roughness: 0.4, metalness: 0.8, emissive: 0xff8a2a, emissiveIntensity: 0 }),
    orange: std({ color: 0xd17320, roughness: 0.6, metalness: 0.3 }),
    chimRed: std({ color: 0xbf2a20, roughness: 0.8 }),
    chimWhite: std({ color: 0xf0f0ee, roughness: 0.8 }),
    rail: std({ color: 0x5c5d62, roughness: 0.35, metalness: 0.85 }),
    ballast: std({ color: 0x4d4944, roughness: 1, metalness: 0 }),
    torpedo: std({ color: 0x77706a, roughness: 0.65, metalness: 0.4 }),
    slag: std({ color: 0x2b2724, roughness: 1, metalness: 0 }),
    bell: std({ color: 0x6a6662, roughness: 0.5, metalness: 0.6 }),
    beacon: std({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 1 }),
  };
  const stoveGlow = [0, 1, 2].map(() => tex(texRust, 0x80614f, 0xffffff, { roughness: 0.85, metalness: 0.25, emissive: 0xff5a20, emissiveIntensity: 0 }));
  M.shellHot = M.shellF; M.shellF.emissive = new THREE.Color(0xff3a10); M.shellF.emissiveIntensity = 0;

  // ============================================================ LOTES DE GEOMETRÍA
  const batches = new Map();
  function defB(key, mat, vis = 'all', worldUV = false) { batches.set(key, { mat, vis, worldUV, list: [] }); }
  function add(key, g) { const b = batches.get(key); if (!b) throw new Error('lote ' + key); b.list.push(g); return g; }
  // lotes con versión "cuña" (cuarto de corte) automática: key / key+'W'
  function defCut(key, mat, worldUV = false) { defB(key, mat, 'all', worldUV); defB(key + 'W', mat, 'wedge', worldUV); }
  defB('concrete', M.concrete, 'all', true);
  defCut('shellF', M.shellF); defCut('head', M.head); defCut('lining', M.lining); defCut('steelC', M.steel); defCut('darkC', M.dark);
  defCut('hopper', M.hopper);
  defB('liningCap', M.lining, 'cut', true); defB('shellCap', M.dark, 'cut', true);
  defB('shell', M.shell); defB('shellW', M.shell, 'wedge'); // estufa 0: mitad de corte
  defB('stoveIn', M.lining, 'cut', false); defB('checker', M.checker, 'cut', true);
  defB('steel', M.steel); defB('dark', M.dark); defB('yellow', M.yellow);
  defB('grate', M.grate); defB('grateW', M.grate, 'all', true);
  defB('hotMain', M.hotMain); defB('bustle', M.bustle); defB('orange', M.orange);
  defB('chimRed', M.chimRed); defB('chimWhite', M.chimWhite); defB('trough', M.trough, 'all', true);
  defB('rail', M.rail); defB('ballast', M.ballast, 'all', true); defB('slag', M.slag);

  function planarUV(g) { // UV en metros proyectando según la normal dominante
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
      else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
      else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  function mergeList(list, worldUV) {
    const ps = []; let n = 0;
    for (let g of list) {
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (worldUV) planarUV(g);
      ps.push(g); n += g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of ps) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
      nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
      o += c;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }

  // ---------- constructores de geometría (devuelven geometrías ya en coordenadas de mundo)
  // lathe propio: pts [[r,y],...]; normales planas por tramo; u = φ·rref, v = longitud de perfil
  function lathe(pts, seg, phi0 = 0, phiLen = TAU, rref) {
    rref = rref ?? Math.max(...pts.map((p) => p[0]));
    const pos = [], nor = [], uv = [], idx = [];
    let vacc = 0;
    for (let j = 0; j < pts.length - 1; j++) {
      const [r0, y0] = pts[j], [r1, y1] = pts[j + 1];
      const dr = r1 - r0, dy = y1 - y0, L = Math.hypot(dr, dy);
      if (L < 1e-6) continue;
      const nr = dy / L, ny = -dr / L, base = pos.length / 3;
      for (let i = 0; i <= seg; i++) {
        const ph = phi0 + (phiLen * i) / seg, s = Math.sin(ph), c = Math.cos(ph), u = ph * rref;
        pos.push(r0 * s, y0, r0 * c, r1 * s, y1, r1 * c);
        nor.push(nr * s, ny, nr * c, nr * s, ny, nr * c);
        uv.push(u, vacc, u, vacc + L);
      }
      for (let i = 0; i < seg; i++) { const a = base + 2 * i, b = a + 2, c = a + 1, d = a + 3; idx.push(a, b, c, b, d, c); }
      vacc += L;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // revolución con cuarto de corte: principal (270°) en key, cuña (90°) en key+'W'
  function latheCut(key, pts, seg, rref, ox = 0, oz = 0) {
    const s3 = Math.max(6, Math.round(seg * 0.75)), s1 = Math.max(2, Math.round(seg * 0.25));
    add(key, lathe(pts, s3, HALF, 3 * HALF, rref).translate(ox, 0, oz));
    add(key + 'W', lathe(pts, s1, 0, HALF, rref).translate(ox, 0, oz));
  }
  const circlePts = (rc, yc, rad, n = 10) => { const a = []; for (let i = 0; i <= n; i++) { const t = (i / n) * TAU; a.push([rc + rad * Math.cos(t), yc + rad * Math.sin(t)]); } return a; };
  function tube(a, b, r, seg = NS, open = true, rTop) {
    const d = V().subVectors(b, a), L = d.length();
    const g = new THREE.CylinderGeometry(rTop ?? r, r, L, seg, 1, open);
    g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_UP, d.normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
  }
  function polyTube(key, pts, r, seg = NS, knots = true) {
    for (let i = 0; i < pts.length - 1; i++) add(key, tube(pts[i], pts[i + 1], r, seg));
    if (knots) for (let i = 1; i < pts.length - 1; i++) add(key, new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)).translate(pts[i].x, pts[i].y, pts[i].z));
  }
  const box = (cx, cy, cz, sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
  const boxMinMax = (x0, y0, z0, x1, y1, z1) => box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  // caja orientada: eje largo `axis` (unitario), sección w (lateral) × h (vertical aprox.)
  const _m = new THREE.Matrix4();
  function basisFromAxis(axis) {
    const Z = axis.clone().normalize();
    let X = V().crossVectors(Y_UP, Z);
    if (X.lengthSq() < 1e-8) X = V(1, 0, 0); X.normalize();
    const Yv = V().crossVectors(Z, X).normalize();
    return [X, Yv, Z];
  }
  function obox(center, axis, len, w, h) {
    const [X, Yv, Z] = basisFromAxis(axis);
    const g = new THREE.BoxGeometry(w, h, len);
    _m.makeBasis(X, Yv, Z).setPosition(center);
    return g.applyMatrix4(_m);
  }
  function beam(a, b, w, h) { const d = V().subVectors(b, a); return obox(V().addVectors(a, b).multiplyScalar(0.5), d, d.length(), w, h); }

  // ---------- instancias
  const cutInst = [];   // { im, nOut, n }
  const wedgeMeshes = []; // mallas sueltas que se ocultan en modo corte
  function inst(geom, mat, list, name) {
    list.sort((p, q) => (p.cut ? 1 : 0) - (q.cut ? 1 : 0));
    const im = new THREE.InstancedMesh(geom, mat, Math.max(1, list.length));
    list.forEach((e, i) => im.setMatrixAt(i, e.m));
    im.count = list.length; im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere(); im.name = name || '';
    const nOut = list.filter((e) => !e.cut).length;
    if (nOut < list.length) cutInst.push({ im, nOut, n: list.length });
    root.add(im); return im;
  }
  const mat4 = (pos, quat, scl) => new THREE.Matrix4().compose(pos, quat || new THREE.Quaternion(), scl || V(1, 1, 1));
  const inQuad = (x, z) => x > 0.01 && z > 0.01;

  // ============================================================ NAVEGACIÓN: superficies y obstáculos analíticos
  const SURF = [], OBS = [];
  function sBox(s) { // caja envolvente para descarte rápido
    if (s.type === 'rect') { s.bx0 = s.x0; s.bx1 = s.x1; s.bz0 = s.z0; s.bz1 = s.z1; }
    else if (s.type === 'ring') { s.bx0 = s.cx - s.ro; s.bx1 = s.cx + s.ro; s.bz0 = s.cz - s.ro; s.bz1 = s.cz + s.ro; }
    else if (s.type === 'ramp') {
      const ex = [s.ox + s.uz * s.hw, s.ox - s.uz * s.hw, s.ox + s.ux * s.len + s.uz * s.hw, s.ox + s.ux * s.len - s.uz * s.hw];
      const ez = [s.oz - s.ux * s.hw, s.oz + s.ux * s.hw, s.oz + s.uz * s.len - s.ux * s.hw, s.oz + s.uz * s.len + s.ux * s.hw];
      s.bx0 = Math.min(...ex); s.bx1 = Math.max(...ex); s.bz0 = Math.min(...ez); s.bz1 = Math.max(...ez);
    }
    SURF.push(s); return s;
  }
  const surfRect = (x0, x1, z0, z1, y, name, holes) => sBox({ type: 'rect', x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y, name, holes });
  const surfRing = (ri, ro, y, name, cx = 0, cz = 0) => sBox({ type: 'ring', cx, cz, ri, ro, y, name });
  // rampa de escalera: (ox,oz) centro del borde inferior, (ux,uz) dirección de subida, len horizontal, hw medio ancho
  // altura: y0 + h·(0.5 + s/run) acotada a [y0,y1] → coincide con el centro de cada huella (±h/2)
  const surfRamp = (ox, oz, ux, uz, len, hw, y0, y1, h, run, name) => sBox({ type: 'ramp', ox, oz, ux, uz, len, hw, y0, y1, h, run, name });

  function oBounds(o) {
    if (o.t === 'cyl') { o.bx0 = o.x - o.R; o.bx1 = o.x + o.R; o.bz0 = o.z - o.R; o.bz1 = o.z + o.R; }
    else if (o.t === 'seg') { o.bx0 = Math.min(o.ax, o.bx) - o.th; o.bx1 = Math.max(o.ax, o.bx) + o.th; o.bz0 = Math.min(o.az, o.bz) - o.th; o.bz1 = Math.max(o.az, o.bz) + o.th; }
    else if (o.t === 'arc') { o.bx0 = o.x - o.R - o.th; o.bx1 = o.x + o.R + o.th; o.bz0 = o.z - o.R - o.th; o.bz1 = o.z + o.R + o.th; }
    else if (o.t === 'box') { o.bx0 = o.x0; o.bx1 = o.x1; o.bz0 = o.z0; o.bz1 = o.z1; }
    else if (o.t === 'obox') { const e = Math.abs(o.ux) * o.hl + Math.abs(o.uz) * o.hw, f = Math.abs(o.uz) * o.hl + Math.abs(o.ux) * o.hw; o.bx0 = o.x - e; o.bx1 = o.x + e; o.bz0 = o.z - f; o.bz1 = o.z + f; }
    else { o.bx0 = -1e9; o.bx1 = 1e9; o.bz0 = -1e9; o.bz1 = 1e9; }
    OBS.push(o); return o;
  }
  const oCyl = (x, z, R, y0, y1, name) => oBounds({ t: 'cyl', x, z, R, y0, y1, name });
  const oSeg = (ax, az, bx, bz, y0, y1, th = 0.04, name) => oBounds({ t: 'seg', ax, az, bx, bz, y0, y1, th, name });
  const oBox = (x0, x1, z0, z1, y0, y1, noR = false, name) => oBounds({ t: 'box', x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0, y1, noR, name });
  const oOBox = (x, z, ux, uz, hl, hw, y0, y1, name) => oBounds({ t: 'obox', x, z, ux, uz, hl, hw, y0, y1, name });
  const angIn = (a, g) => { // ¿ángulo a dentro del intervalo [g0,g1] (con vuelta)?
    let d = a - g[0]; d = ((d % TAU) + TAU) % TAU; let w = g[1] - g[0]; w = ((w % TAU) + TAU) % TAU; return d <= w;
  };

  // ---------- barandas (visual + obstáculo). Posts instanciados, pasamanos en lote 'yellow'.
  const postList = [];
  const POST_H = 1.1;
  function railLine(a, b, opts = {}) { // a,b: Vector3 sobre el piso (la baranda sube 1.1 m)
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 1.5));
    for (let i = opts.skipFirst ? 1 : 0; i <= n; i++) {
      if (i === n && opts.skipLast) continue;
      const p = V().lerpVectors(a, b, i / n);
      postList.push({ m: mat4(V(p.x, p.y + POST_H / 2, p.z)) });
    }
    for (const hh of [0.55, 1.08]) add('yellow', tube(V(a.x, a.y + hh, a.z), V(b.x, b.y + hh, b.z), 0.024, NT));
    add('yellow', beam(V(a.x, a.y + 0.05, a.z), V(b.x, b.y + 0.05, b.z), 0.012, 0.1)); // rodapié
    if (!opts.noBlock) oSeg(a.x, a.z, b.x, b.z, Math.min(a.y, b.y) - 0.05, Math.max(a.y, b.y) + POST_H, 0.04, opts.name || 'baranda');
  }
  function railPoly(pts, opts = {}) { for (let i = 0; i < pts.length - 1; i++) railLine(pts[i], pts[i + 1], Object.assign({}, opts, { skipFirst: i > 0 })); }
  // baranda circular con huecos [θ0,θ1] (rad, θ = atan2(z,x))
  function railArc(R, y, gaps = [], name = 'baranda anillo', cx = 0, cz = 0) {
    const n = Math.ceil((TAU * R) / 1.4);
    let run = [];
    const flush = () => { if (run.length > 1) railPoly(run, { noBlock: true }); run = []; };
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * TAU;
      if (gaps.some((g) => angIn(th, g))) { flush(); continue; }
      run.push(V(cx + R * Math.cos(th), y, cz + R * Math.sin(th)));
    }
    flush();
    oBounds({ t: 'arc', x: cx, z: cz, R, th: 0.04, y0: y - 0.05, y1: y + POST_H, gaps, name });
  }

  // ---------- escaleras (rampa analítica + huellas instanciadas + zancas + barandas)
  const treadList = [];
  const RUN = 0.28;
  function flight(ox, oz, ux, uz, y0, y1, n, w, o = {}) {
    const h = (y1 - y0) / n, len = (n - 1) * RUN, lx = -uz, lz = ux; // lateral (izquierda)
    surfRamp(ox, oz, ux, uz, len, w / 2, y0, y1, h, RUN, o.name || 'escalera');
    const q = new THREE.Quaternion().setFromAxisAngle(Y_UP, Math.atan2(ux, uz));
    for (let k = 0; k < n - 1; k++) {
      const s = (k + 0.5) * RUN;
      treadList.push({ m: mat4(V(ox + ux * s, y0 + (k + 1) * h - 0.02, oz + uz * s), q, V(w, 1, 1)) });
    }
    for (const sd of [-1, 1]) { // zancas
      const ex = lx * sd * (w / 2 + 0.05), ez = lz * sd * (w / 2 + 0.05);
      add('steel', beam(V(ox + ex - ux * 0.15, y0 - 0.05, oz + ez - uz * 0.15), V(ox + ex + ux * (len + 0.15), y1 - 0.12, oz + ez + uz * (len + 0.15)), 0.06, 0.3));
    }
    const side = (sd) => { const ex = lx * sd * (w / 2 + 0.06), ez = lz * sd * (w / 2 + 0.06); return [V(ox + ex, y0 + h, oz + ez), V(ox + ex + ux * len, y1, oz + ez + uz * len)]; };
    if (o.railL !== false) { const [a, b] = side(1); railLine(a, b, { noBlock: o.noBlock, name: 'baranda escalera' }); }
    if (o.railR !== false) { const [a, b] = side(-1); railLine(a, b, { noBlock: o.noBlock, name: 'baranda escalera' }); }
    return { h, len };
  }
  function landing(x0, x1, z0, z1, y, name, visual = true) {
    surfRect(x0, x1, z0, z1, y, name);
    if (visual) add('grateW', boxMinMax(x0, y - 0.06, z0, x1, y, z1));
  }

  // ============================================================ 1. CIMENTACIÓN
  add('concrete', boxMinMax(-42, 0, -38, 30, 1.5, 24));                     // losa
  surfRect(-42, 30, -38, 24, 1.5, 'losa');
  add('concrete', lathe([[8, 1.5], [8, 1.9], [0, 1.9]], NM));               // pedestal
  surfRing(0, 8, 1.9, 'pedestal');
  add('concrete', lathe([[5.4, 1.9], [5.4, 3.6]], NM));
  for (let a = 0; a < 360; a += 22.5) {
    const th = -a * DEG, c = Math.cos(th), s = Math.sin(th);
    add('concrete', obox(V(6.9 * c, 2.75, 6.9 * s), V(c, 0, s), 1.0, 1.0, 1.7));
  }
  add('concrete', lathe([[4.0, 3.6], [7.4, 3.6], [7.4, 4.0], [4.0, 4.0], [4.0, 3.6]], NM));
  oCyl(0, 0, 7.4, 1.9, 4.0, 'pedestal');

  // ============================================================ 2. CUERPO DEL HORNO
  const outerPts = ZS.map((z, i) => [RO[i], z]);
  latheCut('shellF', outerPts, NF);
  latheCut('darkC', [[0, 4.0], [5.5, 4.0], [5.5, 4.08], [0, 4.08]], NF); // placa base / costura inferior
  // superficie interior del refractario (de arriba hacia abajo → normal hacia el eje) + solera del crisol
  const innerYs = [34, 31, 28, 14, 12.5, 9, 6.5];
  latheCut('lining', innerYs.map((y) => [rint(y), y]), NF);
  latheCut('lining', [[rint(6.5), 6.5], [0, 6.5]], NF);
  // caras planas del corte (refractario y chapa) en los planos x=0 (z>0) y z=0 (x>0)
  function capShape(poly) { const s = new THREE.Shape(); poly.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]))); return s; }
  function addCaps(key, poly) {
    const g1 = new THREE.ShapeGeometry(capShape(poly)); // plano z=0, normal +z → cara x>0
    add(key, g1.clone());
    const g2 = g1.clone(); // plano x=0 (r → +z): intercambio x↔z (espejo) + inversión de normales
    const p = g2.attributes.position, n = g2.attributes.normal;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setX(i, p.getZ(i)); p.setZ(i, x); n.setXYZ(i, 1, 0, 0); }
    const idx = g2.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    add(key, g2);
  }
  const brickPoly = [[0, 4], ...ZS.map((z, i) => [RO[i] - 0.06, z]), ...innerYs.map((y) => [rint(y), y]), [0, 6.5]];
  addCaps('liningCap', brickPoly);
  addCaps('shellCap', [...ZS.map((z, i) => [RO[i], z]), ...ZS.slice().reverse().map((z, i) => [RO[ZS.length - 1 - i] - 0.06, z])]);
  // placas de refrigeración (staves): etalaje, vientre y cuba
  {
    const list = [];
    const placas = (z0, z1, filas, n) => {
      const h = (z1 - z0) / filas, tilt = Math.atan2(rext(z1) - rext(z0), z1 - z0);
      for (let f = 0; f < filas; f++) {
        const zc = z0 + h * (f + 0.5), rc = rext(zc);
        for (let a = 0; a < n; a++) {
          const th = -((a * 360) / n + ((f % 2) * 180) / n) * DEG, c = Math.cos(th), s = Math.sin(th);
          const X = V(c, 0, s), Z = V().crossVectors(X, Y_UP);
          const m = new THREE.Matrix4().makeBasis(X, Y_UP, Z).multiply(new THREE.Matrix4().makeRotationZ(-tilt));
          m.scale(V(0.07, h * 0.92, ((TAU * rc) / n) * 0.9)); m.setPosition((rc + 0.03) * c, zc, (rc + 0.03) * s);
          list.push({ m, cut: inQuad(c, s) });
        }
      }
    };
    placas(9, 12.5, 5, 36); placas(12.5, 14, 2, 36); placas(14, 28, 7, 28);
    const g = new THREE.BoxGeometry(1, 1, 1);
    inst(g, M.stave, list, 'staves');
  }
  // anillos de aspersión del crisol + bajantes de agua
  for (const y of [5.0, 6.5, 8.0]) latheCut('steelC', circlePts(5.75, y, 0.07, 6), NM);
  for (let a = 0; a < 360; a += 45) {
    const th = -a * DEG, c = Math.cos(th), s = Math.sin(th);
    add(inQuad(c, s) ? 'steelCW' : 'steelC', tube(V(5.75 * c, 4.4, 5.75 * s), V(5.75 * c, 8.2, 5.75 * s), 0.05, 6));
  }
  // obstáculo del casco (radio máximo en el tramo vertical del jugador)
  function shellR(y) {
    if (y < 1.9) return 0;
    if (y < 4.0) return 7.4;
    if (y <= 34) { let r = rext(y) + 0.1; if (y > 4.3 && y < 8.3) r = Math.max(r, 5.85); return r; }
    if (y < 42) return 1.65;
    if (y < 46) return 1.65 + ((y - 42) / 4) * 1.4;
    if (y < 46.4) return 3.05;
    if (y < 48.3) return 1.95;
    return 0;
  }
  const SH_KEYS = [4.0, 9, 12.5, 14, 28, 31, 34, 42, 46, 46.4];
  function shellRmax(a, b) {
    let m = Math.max(shellR(a), shellR(b));
    for (const k of SH_KEYS) if (k > a && k < b) m = Math.max(m, shellR(k), shellR(k - 1e-3));
    for (let i = 1; i < 4; i++) m = Math.max(m, shellR(a + ((b - a) * i) / 4));
    return m;
  }
  oBounds({ t: 'furn', y0: 1.9, y1: 48.3, name: 'casco del horno' });

  A('hearthCenter', 0, 7.5, 0); A('ironLevel', 0, 8.5, 0); A('slagLevel', 0, 9.3, 0);
  A('bosh', 0, 10.75, 0); A('belly', 0, 13.25, 0); A('shaft', 0, 21, 0);
  A('stockline', 0, 30.5, 0); A('throat', 0, 31, 0);

  // ============================================================ 3. CABEZAL, DOBLE CAMPANA, TOLVAS
  latheCut('head', [[1.6, 34], [1.6, 42], [3.0, 46], [3.0, 46.4], [0.8, 46.4]], NM, 3.0);
  for (const z of [36, 38, 40]) latheCut('darkC', [[1.66, z - 0.07], [1.66, z + 0.07]], NM);
  latheCut('hopper', [[1.95, 48.3], [0.75, 46.7], [0.75, 45.95]], NM);     // tolva receptora
  latheCut('hopper', [[2.75, 45.95], [0.55, 42.2]], NM);                    // tolva de campana chica
  latheCut('hopper', [[1.5, 41.4], [1.5, 37.8], [0.95, 33.4]], NM);         // tolva de campana grande
  latheCut('darkC', [[1.5, 41.4], [0.2, 41.4]], NM);              // tapa intermedia (sello de gas)
  function bell(rBase, hUp, hDown, rodLen, rodR) {
    const g = new THREE.Group();
    const prof = [[0, hUp], [0.12, hUp - 0.05], [rBase, -hDown], [rBase - 0.06, -hDown - 0.07], [0, -hDown - 0.07]];
    const m = new THREE.Mesh(lathe(prof.slice().reverse(), NM), M.bell);
    g.add(m);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(rodR, rodR, rodLen, 8, 1, true).translate(0, hUp + rodLen / 2, 0), M.steel);
    g.add(rod);
    return g;
  }
  {
    // la campana es un cono (vértice arriba): el contacto con la tolva queda en y_local ≈ 0
    const bs = bell(0.8, 0.5, 0.25, 5.6, 0.07); bs.position.set(0, 42.2, 0);
    bs.userData = { closedY: 42.2, openY: 41.5, openOffset: -0.7 }; bs.name = 'campanaChica';
    const bl = bell(1.35, 0.62, 0.35, 14.5, 0.045); bl.position.set(0, 33.4, 0);
    bl.userData = { closedY: 33.4, openY: 32.5, openOffset: -0.9 }; bl.name = 'campanaGrande';
    root.add(bs, bl); parts.bellSmall = bs; parts.bellLarge = bl;
    A('bellSmallCenter', 0, 42.2, 0); A('bellLargeCenter', 0, 33.4, 0);
  }

  // ============================================================ 4. BAJANTES DE GAS, BAJANTE PRINCIPAL, COLECTOR DE POLVO
  {
    const R = 3.5;
    [45, 135, 225, 315].forEach((a, i) => {
      const th = -a * DEG, x = R * Math.cos(th), z = R * Math.sin(th);
      add('shell', lathe([[0.75, 31.5], [0.75, 42]], 16, 0, TAU).translate(x, 0, z));
      add('shell', new THREE.SphereGeometry(0.75, 16, 10).translate(x, 42, z));
      add('steel', tube(V(x, 42, z), V(x, 45, z), 0.35, NS));
      add('steel', tube(V(x, 45, z), V(x, 45.7, z), 0.45, NS, false, 0.1));
      oCyl(x, z, 0.75, 31.5, 42.8, 'bajante de gas');
      A('uptake' + i, x, 42, z);
    });
    add('shell', new THREE.TorusGeometry(R, 0.7, 10, NM).rotateX(HALF).translate(0, 42, 0));
    polyTube('shell', [V(R, 42, 0), V(16, 42, 0), V(16, 35.5, 0)], 1.1, 20);
    add('steel', tube(V(8.75, 42, 0), V(9.25, 42, 0), 1.5, 20, false));
    A('downcomerStart', 4.2, 42, 0); A('downcomerTop', 16, 42, 0);
  }
  {
    const cx = 16, cz = 0, R = 4.5;
    for (const a of [45, 135, 225, 315]) {
      const th = -a * DEG, x = cx + 3.6 * Math.cos(th), z = cz + 3.6 * Math.sin(th);
      add('concrete', new THREE.CylinderGeometry(0.4, 0.4, 9.3, 16).translate(x, 1.5 + 4.65, z));
      oCyl(x, z, 0.4, 1.5, 10.8, 'pata colector');
    }
    add('shell', lathe([[0.8, 7], [R, 12], [R, 30], [1.2, 35], [0.0, 35]], NM, 0, TAU, R).translate(cx, 0, cz));
    add('steel', new THREE.CylinderGeometry(0.5, 0.5, 2.9, 16).translate(cx, 4.2 + 1.45, cz));
    oCyl(cx, cz, 0.5, 4.2, 7.2, 'válvula de polvo');
    polyTube('steel', [V(cx, 27, -4.2), V(cx, 27, -12), V(cx, 5.5, -12)], 0.9, NS);
    add('shell', lathe([[1.6, 1.5], [1.6, 5.5], [0.9, 6.3], [0, 6.3]], 24, 0, TAU, 1.6).translate(cx, 0, -12)); // lavador
    oCyl(cx, -12, 1.6, 1.5, 6.3, 'lavador'); oCyl(cx, -12, 0.9, 6.3, 27.9, 'tubo gas limpio');
    A('dustCatcherTop', cx, 35, cz); A('dustCatcherBottom', cx, 4.2, cz); A('dustCatcherGasOut', cx, 27, -4.6);
    A('cleanGasDown', cx, 6.3, -12);
  }

  // ============================================================ 5. ANILLO DE VIENTO, TOBERAS, AIRE CALIENTE
  {
    add('bustle', new THREE.TorusGeometry(8.3, 1.0, 12, NF).rotateX(HALF).translate(0, 14.2, 0));
    polyTube('hotMain', [V(-17.5, 30, 0), V(-17.5, 14.2, 0), V(-8.4, 14.2, 0)], 1.1, 20);
    add('steel', new THREE.CylinderGeometry(0.35, 0.35, 11.6, 12).translate(-17.5, 1.5 + 5.8, 0)); // apoyo de la bajada
    oCyl(-17.5, 0, 0.4, 1.5, 31.2, 'bajada de aire caliente');
    for (let a = 0; a < 360; a += 15) { // bridas del anillo
      const th = -a * DEG, c = Math.cos(th), s = Math.sin(th);
      const g = new THREE.TorusGeometry(1.02, 0.06, 6, 20);
      const m = new THREE.Matrix4().makeBasis(V(c, 0, s), Y_UP, V(-s, 0, c)).setPosition(8.3 * c, 14.2, 8.3 * s);
      add('dark', g.applyMatrix4(m));
    }
    for (let a = 10; a < 360; a += 45) { // ménsulas de apoyo
      const th = -a * DEG, x = 8.3 * Math.cos(th), z = 8.3 * Math.sin(th);
      add('steel', new THREE.CylinderGeometry(0.15, 0.15, 4, 10, 1, true).translate(x, 9.3 + 2, z));
      oCyl(x, z, 0.15, 9.2, 13.3, 'ménsula anillo');
    }
    A('bustleCenter', 0, 14.2, 0); A('bustleRing', -8.3, 14.2, 0);
    A('hotBlastRiser', -17.5, 14.2, 0); A('hotBlastBustle', -8.4, 14.2, 0); A('hotBlastTop', -17.5, 30, 0);
    // toberas (18): tobera de cobre dentro del casco, porta-tobera, collar y codo/tubo de soplado
    const lp = [], ls = [], lc = [], ln = [];
    const rN0 = rint(10.5) + 0.1, rN1 = rext(10.5), Ln = rN1 - rN0;
    for (let k = 0; k < 18; k++) {
      const th = -(k * 20 + 10) * DEG, c = Math.cos(th), s = Math.sin(th), X = V(c, 0, s);
      const qX = new THREE.Quaternion().setFromUnitVectors(Y_UP, X);
      const a = V(8.0 * c, 13.5, 8.0 * s), b = V(6.2 * c, 10.5, 6.2 * s), d = V().subVectors(a, b);
      lp.push({ m: mat4(V().addVectors(a, b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y_UP, d.clone().normalize()), V(1, d.length(), 1)) });
      ls.push({ m: mat4(V((rN1 - 0.1 + 0.325) * c, 10.5, (rN1 - 0.1 + 0.325) * s), qX, V(1, 0.65, 1)) });
      lc.push({ m: mat4(V(6.42 * c, 10.5, 6.42 * s), qX, V(1, 0.15, 1)) });
      ln.push({ m: mat4(V((rN0 + Ln / 2) * c, 10.5, (rN0 + Ln / 2) * s), qX, V(1, Ln, 1)), cut: false });
      A('tuyere' + k, rint(10.5) * c, 10.5, rint(10.5) * s); dirs['tuyere' + k] = V(-c, 0, -s);
      oCyl(6.1 * c, 6.1 * s, 0.5, 10.0, 11.1, 'tobera'); oCyl(6.75 * c, 6.75 * s, 0.35, 10.6, 12.2, 'tobera');
    }
    inst(new THREE.CylinderGeometry(0.25, 0.25, 1, 12, 1, true), M.bustle, lp, 'soplado');
    inst(new THREE.CylinderGeometry(0.45, 0.45, 1, 14), M.steel, ls, 'portaToberas');
    inst(new THREE.CylinderGeometry(0.3, 0.3, 1, 12), M.dark, lc, 'collares');
    inst(new THREE.CylinderGeometry(0.225, 0.075, 1, 12), M.tuyereGlow, ln, 'toberasCobre');
  }

  // ============================================================ 6. ESTUFAS COWPER, CHIMENEA, HUMOS
  {
    const R = 4, H = 32, zsS = [12, 0, -12];
    const domePts = (r, y0) => { const a = []; for (let d = 0; d <= 90; d += 10) a.push([r * Math.cos(d * DEG), y0 + 0.6 * r * Math.sin(d * DEG)]); return a; };
    parts.stoves = [];
    zsS.forEach((z, i) => {
      const x = -24, yb = 2.3;
      add('concrete', lathe([[R + 0.5, 1.5], [R + 0.5, yb], [0, yb]], NM).translate(x, 0, z));
      const dome = domePts(R, H).map((p) => [p[0], p[1] + yb]);
      const cyl = [[R, yb], [R, yb + H]];
      const band = [[R + 0.06, yb + H - 0.07], [R + 0.06, yb + H + 0.07]];
      if (i === 0) { add('dark', lathe(band, NM / 2, HALF, Math.PI, R).translate(x, 0, z)); wedgeMeshes.push(new THREE.Mesh(lathe(band, NM / 2, -HALF, Math.PI, R).translate(x, 0, z), M.dark)); root.add(wedgeMeshes[wedgeMeshes.length - 1]); }
      else add('dark', lathe(band, NM).translate(x, 0, z));
      // estufa 0: mitad delantera (+z local) removible en modo corte
      if (i === 0) {
        add('shell', lathe(cyl, NM / 2, HALF, Math.PI, R).translate(x, 0, z));
        add('shellW', lathe(cyl, NM / 2, -HALF, Math.PI, R).translate(x, 0, z));
        const dm = new THREE.Mesh(lathe(dome, NM / 2, HALF, Math.PI, R).translate(x, 0, z), stoveGlow[i]);
        const dw = new THREE.Mesh(lathe(dome, NM / 2, -HALF, Math.PI, R).translate(x, 0, z), stoveGlow[i]);
        root.add(dm, dw); wedgeMeshes.push(dw);
        // interior visible en corte: revestimiento, damero, cámara de combustión
        add('stoveIn', lathe([[R - 0.7, yb + 0.2], [R - 0.7, yb + H], ...domePts(R - 0.7, H).slice(1).map((p) => [p[0], p[1] + yb])].reverse(), NM / 2, HALF, Math.PI, R).translate(x, 0, z));
        const wall = [[R - 0.7, yb + 0.2], [R, yb], ...dome, ...domePts(R - 0.7, H).reverse().map((p) => [p[0], p[1] + yb])];
        add('stoveIn', new THREE.ShapeGeometry(capShape(wall)).translate(x, 0, z));
        add('stoveIn', new THREE.ShapeGeometry(capShape(wall)).scale(-1, 1, 1).translate(x, 0, z));
        add('checker', boxMinMax(x - 1.0, yb + 0.2, z - 0.02, x + R - 0.7, yb + H - 6, z));
        const tp = new THREE.Shape(); tp.moveTo(-1, 0); tp.lineTo(R - 0.7, 0);
        const aEnd = Math.acos(-1 / (R - 0.7));
        for (let k = 1; k <= 16; k++) { const t = (k / 16) * aEnd; tp.lineTo((R - 0.7) * Math.cos(t), -(R - 0.7) * Math.sin(t)); }
        add('checker', new THREE.ShapeGeometry(tp).rotateX(HALF).translate(x, yb + H - 6, z)); // tapa superior del damero
        add('stoveIn', boxMinMax(x - 1.15, yb + 0.2, z - Math.sqrt((R - 0.7) ** 2 - 1), x - 1.0, yb + H - 4, z));
      } else {
        add('shell', lathe(cyl, NM, 0, TAU, R).translate(x, 0, z));
        const dm = new THREE.Mesh(lathe(dome, NM, 0, TAU, R).translate(x, 0, z), stoveGlow[i]);
        root.add(dm);
      }
      oCyl(x, z, R + 0.5, 1.5, yb + H + 2.4, 'estufa');
      A('stove' + i + 'Top', x, yb + H + 0.6 * R, z); A('stove' + i + 'Base', x, yb, z); A('stove' + i + 'Branch', -19, 30, z);
      polyTube('hotMain', [V(-20, 30, z), V(-17.5, 30, z)], 0.8, 16, false);
      add('steel', tube(V(-19.0, 30, z), V(-18.6, 30, z), 1.2, 20, false));
      add('steel', tube(V(-28, 3.5, z), V(-30, 3.5, z), 0.7, NS));
      oBox(-30, -28, z - 0.7, z + 0.7, 2.8, 4.2, false, 'conducto de humos');
    });
    polyTube('hotMain', [V(-17.5, 30, 12), V(-17.5, 30, -12)], 1.1, 20, false);
    for (const z of [12, -12]) add('hotMain', new THREE.SphereGeometry(1.1, 20, 12).translate(-17.5, 30, z));
    A('hotBlastMain', -17.5, 30, 0);
    polyTube('steel', [V(-30, 3.5, 12), V(-30, 3.5, -12)], 0.9, NS, false);
    for (const z of [12, -12]) add('steel', new THREE.SphereGeometry(0.9, NS, 8).translate(-30, 3.5, z));
    add('steel', tube(V(-30, 3.5, 0), V(-33, 3.5, 0), 0.9, NS));
    oBox(-30.9, -29.1, -12.9, 12.9, 2.6, 4.4, false, 'colector de humos'); oBox(-33, -30, -0.9, 0.9, 2.6, 4.4, false, 'humos');
    // chimenea a franjas
    const cx = -34;
    add('concrete', lathe([[3.2, 1.5], [3.2, 2.5], [0, 2.5]], NM).translate(cx, 0, 0));
    for (let i = 0; i < 10; i++) {
      const y0 = 2.5 + i * 6.5, r0 = 2.6 - i * 0.09, r1 = 2.6 - (i + 1) * 0.09;
      add(i % 2 === 0 ? 'chimRed' : 'chimWhite', lathe([[r0, y0], [r1, y0 + 6.5]], NM, 0, TAU, 2.6).translate(cx, 0, 0));
    }
    add('dark', lathe([[1.75, 67.5], [1.75, 67.8], [1.35, 67.8]], NM).translate(cx, 0, 0));
    oCyl(cx, 0, 3.2, 1.5, 70, 'chimenea');
    A('chimneyTop', cx, 67.5, 0);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), M.beacon); bc.position.set(cx + 1.6, 68.1, 0); root.add(bc);
    parts.beacon = bc;
  }

  // ============================================================ 7. NAVE DE COLADA, PIQUERAS, CANALES, VÍA TORPEDO
  const PIT = { x0: -9.5, x1: 9.5, z0: 13.8, z1: 16.8 };          // foso sobre la vía del torpedo
  const SPIT = { x0: 10.8, x1: 15.0, z0: 5.0, z1: 9.0 };           // foso de escoria
  const TRACK_Z = 15.32;
  {
    const sh = new THREE.Shape();
    sh.moveTo(-16, 0); sh.lineTo(-5.6, 0); sh.absarc(0, 0, 5.6, Math.PI, 0, true); sh.lineTo(16, 0); sh.lineTo(16, 22); sh.lineTo(-16, 22); sh.lineTo(-16, 0);
    for (const p of [PIT, SPIT]) { const h = new THREE.Path(); h.moveTo(p.x0, p.z0); h.lineTo(p.x0, p.z1); h.lineTo(p.x1, p.z1); h.lineTo(p.x1, p.z0); h.lineTo(p.x0, p.z0); sh.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: false, curveSegments: 24 });
    g.rotateX(HALF); g.translate(0, 5.0, 0);
    add('concrete', g);
    surfRect(-16, 16, 0, 22, 5.0, 'nave de colada', [{ c: true, x: 0, z: 0, r: 5.6 }, PIT, SPIT]);
    for (const x of [-14, -7, 0, 7, 14]) for (const z of [20, 12, 4]) {
      if (Math.hypot(x, z) <= 8.5) continue;
      add('concrete', box(x, 1.5 + 1.55, z, 0.8, 3.1, 0.8));
      oBox(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 1.5, 4.6, false, 'columna nave');
    }
    A('spawn', 0, 5.0, 11); A('casthouse', 0, 5.0, 12);
  }
  // canal genérico inclinado: dirección horizontal d, de r0 a r0+L; piso interior yf0→yf1; ancho interior wi
  function trough(d, r0, L, yf0, yf1, wi, wallH, name, piers) {
    const wo = wi + 0.3, at = (s) => V(d.x * (r0 + s), 0, d.z * (r0 + s)), yf = (s) => yf0 + ((yf1 - yf0) * s) / L;
    const axis = V(d.x * L, yf1 - yf0, d.z * L).normalize(), lat = V(-d.z, 0, d.x), Ls = Math.hypot(L, yf1 - yf0);
    const mid = at(L / 2);
    add('trough', obox(V(mid.x, yf(L / 2) - 0.15, mid.z), axis, Ls, wo, 0.3));
    for (const sd of [-1, 1]) {
      const o = (wi / 2 + 0.075) * sd;
      add('trough', obox(V(mid.x + lat.x * o, yf(L / 2) + wallH / 2, mid.z + lat.z * o), axis, Ls, 0.15, wallH));
    }
    for (const s of piers) {
      const p = at(s), yb = yf(s) - 0.3;
      add('concrete', obox(V(p.x, (5.0 + yb) / 2, p.z), d, 0.3, 0.8, yb - 5.0));
    }
    for (let s = 0; s < L; s += 1) { // obstáculo por tramos (techo variable → se puede pasar por debajo o por encima)
      const s1 = Math.min(L, s + 1), p = at((s + s1) / 2);
      const top = Math.max(yf(s), yf(s1)) + wallH, bot = Math.min(yf(s), yf(s1)) - 0.3;
      oOBox(p.x, p.z, d.x, d.z, (s1 - s) / 2, wo / 2, bot, top, name);
    }
  }
  {
    // piqueras de arrabio (a = 250°, 290° del .scad) → hacia +Z
    const L = 10.1;
    [250, 290].forEach((a, i) => {
      const th = -a * DEG, d = V(Math.cos(th), 0, Math.sin(th));
      add('steel', obox(V(d.x * 5.85, 7.2, d.z * 5.85), d, 0.9, 1.0, 1.0));
      trough(d, 6.2, L, 6.5, 5.5, 1.0, 0.3, 'canal de arrabio', [3, 8]);
      const e = V(d.x * (6.2 + L), 5.5, d.z * (6.2 + L));
      add('trough', obox(V(e.x + d.x * 0.25, 5.3, e.z + d.z * 0.25), V(d.x, -0.8, d.z).normalize(), 0.6, 0.7, 0.2)); // pico
      A('tapIron' + i, d.x * 6.3, 6.75, d.z * 6.3); A('troughEnd' + i, e.x, 5.5, e.z);
      dirs['tapIron' + i] = d.clone(); dirs['troughEnd' + i] = d.clone();
    });
    // piquera de escoria (más alta) con canal hacia el foso de escoria
    const th = 30 * DEG, d = V(Math.cos(th), 0, Math.sin(th)); // 60° desde +Z hacia +X
    add('steel', obox(V(d.x * 5.85, 8.0, d.z * 5.85), d, 0.9, 0.8, 0.8));
    add('dark', tube(V(d.x * 6.25, 8.0, d.z * 6.25), V(d.x * 6.45, 8.0, d.z * 6.45), 0.28, 12, false));
    trough(d, 6.2, 7.3, 7.8, 6.0, 0.8, 0.45, 'canal de escoria', [2, 5]);
    A('slagNotch', d.x * 6.4, 8.0, d.z * 6.4); A('slagTroughEnd', d.x * 13.5, 6.0, d.z * 13.5);
    dirs.slagNotch = d.clone();
    // foso de escoria: lecho de escoria en el suelo
    add('slag', lathe([[2.0, 1.5], [0.2, 2.6], [0, 2.6]], 16).translate(12.9, 0, 7.0));
    A('slagPit', 12.9, 2.6, 7.0);
  }
  {
    // vía del torpedo (bajo la nave, z = 15.32) + vagón torpedo
    const x0 = -13.5, x1 = 29.5;
    add('ballast', boxMinMax(x0, 1.5, TRACK_Z - 1.5, x1, 1.7, TRACK_Z + 1.5));
    surfRect(x0, x1, TRACK_Z - 1.5, TRACK_Z + 1.5, 1.7, 'vía');
    const sl = [];
    for (let x = x0 + 0.3; x < x1; x += 0.65) sl.push({ m: mat4(V(x, 1.76, TRACK_Z)) });
    inst(new THREE.BoxGeometry(0.25, 0.12, 2.6), M.dark, sl, 'durmientes');
    for (const s of [-1, 1]) add('rail', boxMinMax(x0, 1.82, TRACK_Z + s * 0.7175 - 0.035, x1, 1.96, TRACK_Z + s * 0.7175 + 0.035));
    add('dark', box(x1 - 0.3, 2.2, TRACK_Z, 0.6, 1.0, 2.4)); oBox(x1 - 0.6, x1, TRACK_Z - 1.2, TRACK_Z + 1.2, 1.7, 2.7, false, 'tope de vía');
    const tg = new THREE.Group(); tg.name = 'torpedo';
    const vessel = lathe([[0, -4.6], [0.55, -4.6], [1.05, -2.5], [1.05, 2.5], [0.55, 4.6], [0, 4.6]], 28, 0, TAU, 1.05).toNonIndexed().rotateZ(-HALF);
    const neck = new THREE.CylinderGeometry(0.5, 0.55, 0.6, 20).translate(0, 1.0, 0).toNonIndexed();
    const lip = new THREE.TorusGeometry(0.5, 0.06, 6, 20).rotateX(HALF).translate(0, 1.3, 0).toNonIndexed();
    tg.add(new THREE.Mesh(mergeList([vessel, neck, lip], false), M.torpedo));
    const fr = [];
    for (const s of [-1, 1]) {
      fr.push(box(s * 5.3, -0.45, 0, 2.6, 0.5, 2.0), tube(V(s * 4.5, 0, 0), V(s * 5.6, 0, 0), 0.3, 12, false));
      for (const dx of [-0.8, 0.8]) for (const dz of [-0.72, 0.72]) fr.push(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14).rotateX(HALF).translate(s * 5.3 + dx, -0.82, dz));
    }
    tg.add(new THREE.Mesh(mergeList(fr, false), M.dark));
    tg.position.set(anchors.troughEnd0.x, 3.2, TRACK_Z);
    root.add(tg); parts.torpedo = tg;
    A('torpedoStart', anchors.troughEnd0.x, 3.2, TRACK_Z); A('torpedoEnd', 23, 3.2, TRACK_Z);
    A('torpedoMouth', anchors.troughEnd0.x, 4.5, TRACK_Z);
    oBounds({ t: 'dyn', y0: 1.8, y1: 4.6, name: 'torpedo', test(x, z, r) { const p = tg.position; return Math.abs(x - p.x) < 6.0 + r && Math.abs(z - p.z) < 1.2 + r; } });
  }
  // foso de escape del skip
  {
    add('dark', boxMinMax(-2.5, 1.5, -36.06, 2.5, 1.9, -30.06));
    surfRect(-2.5, 2.5, -36.06, -30.06, 1.9, 'foso de skips');
  }

  // ============================================================ 8. PLATAFORMAS ANULARES Y COLUMNAS
  const LEVELS = [9.2, 16.5, 23.0, 30.0, 36.5];
  const RINGS = LEVELS.map((y) => (y < 36 ? { y, ri: rext(y) + 0.15, ro: Math.max(rext(y) + 2.8, 7.5) } : { y, ri: 5.3, ro: 7.6 }));
  const beamList = [];
  // torre de escaleras: cuadrante −X/+Z, sobre la nave de colada
  const TW = { xn: -9.84, land: 1.2, fz: 3.08, z0: 2.5, z1: 5.0, zm: 3.75 };
  TW.xA = TW.xn - TW.land; TW.xB = TW.xA - TW.fz; TW.xf = TW.xB - TW.land;
  const bridgeGap = (ro) => [Math.atan2(TW.z1 + 0.02, -Math.sqrt(ro * ro - (TW.z1 + 0.02) ** 2)), Math.atan2(TW.z0 - 0.02, -Math.sqrt(ro * ro - (TW.z0 - 0.02) ** 2))];
  const LAD2 = { x: 0, z: 7.92 };
  const ladGap = (ro) => [HALF - 0.4 / ro, HALF + 0.4 / ro];
  RINGS.forEach((P, li) => {
    const { y, ri, ro } = P;
    add('grate', lathe([[ro, y], [ri, y]], NF, 0, TAU, ro));
    add('grate', lathe([[ri, y - 0.06], [ro, y - 0.06]], NF / 2, 0, TAU, ro));
    add('steel', lathe([[ro, y - 0.35], [ro, y + 0.1], [ro - 0.02, y + 0.1]], NF / 2, 0, TAU, ro));
    surfRing(ri, ro, y, 'plataforma ' + y);
    for (let a = 0; a < 360; a += 15) {
      const th = a * DEG, c = Math.cos(th), s = Math.sin(th), rm = (ri + ro) / 2;
      beamList.push({ m: new THREE.Matrix4().makeBasis(V(c, 0, s), Y_UP, V(-s, 0, c)).scale(V(ro - ri, 1, 1)).setPosition(rm * c, y - 0.06 - 0.175, rm * s) });
    }
    const gaps = [bridgeGap(ro)];
    if (y === 30.0 || y === 36.5) gaps.push(ladGap(ro));
    railArc(ro - 0.05, y, gaps, 'baranda plataforma ' + y);
    if (y === 36.5) railArc(ri + 0.05, y, [], 'baranda interior 36.5');
    A('plat' + Math.round(y * 10), -(ri + ro) / 2, y, 0);
  });
  inst(new THREE.BoxGeometry(1, 0.35, 0.12), M.steel, beamList, 'vigasPlataformas');
  for (const a of [45, 135, 225, 315]) {
    const th = a * DEG, x = 6.9 * Math.cos(th), z = 6.9 * Math.sin(th);
    add('steel', new THREE.CylinderGeometry(0.25, 0.25, 35, 16, 1, true).translate(x, 1.5 + 17.5, z));
    oCyl(x, z, 0.25, 1.5, 36.5, 'columna');
  }

  // ============================================================ 9. ESCALERAS: suelo → nave → torre → plataformas
  const route = [];
  const R = (x, y, z, tag) => route.push({ x, y, z, tag });
  // 9a. escalera suelo (1.5) → nave (5.0), lado oeste de la nave (x = −16.8), sube hacia −Z
  const GS = { x: -16.8, w: 1.2, zb: 23.3 };
  {
    const n = 10, h = 3.5 / 20, len = (n - 1) * RUN;
    flight(GS.x, GS.zb, 0, -1, 1.5, 1.5 + n * h, n, GS.w, { name: 'escalera suelo-nave' });
    const zl1 = GS.zb - len, zl0 = zl1 - 1.2;
    landing(GS.x - 0.6, GS.x + 0.6, zl0, zl1, 1.5 + n * h, 'descanso escalera nave');
    flight(GS.x, zl0, 0, -1, 1.5 + n * h, 5.0, n, GS.w, { name: 'escalera suelo-nave' });
    const zt1 = zl0 - len, zt0 = zt1 - 1.2;
    landing(GS.x - 0.6, -15.85, zt0, zt1, 5.0, 'llegada a la nave');
    railLine(V(GS.x - 0.66, 1.5 + n * h, zl0), V(GS.x - 0.66, 1.5 + n * h, zl1), { name: 'baranda descanso' });
    railLine(V(GS.x + 0.66, 1.5 + n * h, zl0), V(GS.x + 0.66, 1.5 + n * h, zl1), { name: 'baranda descanso' });
    railLine(V(GS.x - 0.66, 5.0, zt0), V(GS.x - 0.66, 5.0, zt1), { name: 'baranda llegada' });
    railLine(V(GS.x - 0.66, 5.0, zt0), V(-16.0, 5.0, zt0), { name: 'baranda llegada' });
    oBox(GS.x - 0.6, GS.x + 0.6, zt0, zl1, 1.4, 1.65, true, 'bajo escalera');
    // columnas de la escalera
    for (const z of [zl0, zl1]) for (const dx of [-0.66, 0.66]) add('steel', boxMinMax(GS.x + dx - 0.06, 1.5, z - 0.06, GS.x + dx + 0.06, 1.5 + n * h - 0.06, z + 0.06));
    add('steel', boxMinMax(GS.x - 0.72, 1.5, zt0 - 0.06, GS.x - 0.6, 5.0 - 0.06, zt0 + 0.06));
    GS.zt0 = zt0; GS.zt1 = zt1;
    R(GS.x, 1.5, 23.7, 'suelo'); R(GS.x, 5.0, (zt0 + zt1) / 2, 'llegada nave'); R(-15.2, 5.0, (zt0 + zt1) / 2, 'nave');
  }
  // barandas perimetrales de la nave de colada (huecos: escalera oeste y escalerilla este)
  const LAD1 = { x: 16.2, z: 18.5 };
  railPoly([V(-16, 5, 0.0), V(-16, 5, GS.zt0)], { name: 'baranda nave' });
  railPoly([V(-16, 5, GS.zt1), V(-16, 5, 22), V(16, 5, 22), V(16, 5, LAD1.z + 0.45)], { name: 'baranda nave' });
  railPoly([V(16, 5, LAD1.z - 0.45), V(16, 5, 0)], { name: 'baranda nave' });
  railLine(V(-16, 5, 0), V(-5.7, 5, 0), { name: 'baranda nave' });
  railLine(V(5.7, 5, 0), V(16, 5, 0), { name: 'baranda nave' });
  // barandas de los fosos (huecos donde pasan los canales)
  {
    const gx = 5.02;
    railPoly([V(PIT.x0, 5, PIT.z0), V(-gx - 0.95, 5, PIT.z0)], { name: 'baranda foso' });
    railPoly([V(-gx + 0.95, 5, PIT.z0), V(gx - 0.95, 5, PIT.z0)], { name: 'baranda foso' });
    railPoly([V(gx + 0.95, 5, PIT.z0), V(PIT.x1, 5, PIT.z0), V(PIT.x1, 5, PIT.z1), V(PIT.x0, 5, PIT.z1), V(PIT.x0, 5, PIT.z0)], { name: 'baranda foso' });
    railPoly([V(SPIT.x0, 5, 7.15), V(SPIT.x0, 5, SPIT.z1), V(SPIT.x1, 5, SPIT.z1), V(SPIT.x1, 5, SPIT.z0), V(SPIT.x0, 5, SPIT.z0), V(SPIT.x0, 5, 5.35)], { name: 'baranda foso escoria' });
  }
  // 9b. pasarelas sobre los canales de arrabio (7 escalones por lado)
  [250, 290].forEach((a) => {
    const th = -a * DEG, d = V(Math.cos(th), 0, Math.sin(th)), p = V(d.z, 0, -d.x); // p ⟂ canal
    const C = V(d.x * 13.0, 0, d.z * 13.0), yd = 6.3, n = 7, half = 0.8, w = 1.1;
    const len = (n - 1) * RUN;
    for (const sd of [1, -1]) {
      const bx = C.x + p.x * sd * (half + len), bz = C.z + p.z * sd * (half + len);
      flight(bx, bz, -p.x * sd, -p.z * sd, 5.0, yd, n, w, { name: 'pasarela canal', railL: false, railR: false });
    }
    surfRamp(C.x - p.x * half, C.z - p.z * half, p.x, p.z, 2 * half, w / 2, yd, yd, 0, RUN, 'pasarela canal');
    add('grateW', obox(V(C.x, yd - 0.04, C.z), p, 2 * half, w, 0.08));
    for (const sd of [-1, 1]) { // barandas laterales continuas
      const o = (w / 2 + 0.06) * sd, ox = d.x * o, oz = d.z * o;
      const P0 = V(C.x + p.x * (half + len) + ox, 5.0 + 0.18, C.z + p.z * (half + len) + oz), P1 = V(C.x + p.x * half + ox, yd, C.z + p.z * half + oz);
      const P2 = V(C.x - p.x * half + ox, yd, C.z - p.z * half + oz), P3 = V(C.x - p.x * (half + len) + ox, 5.0 + 0.18, C.z - p.z * (half + len) + oz);
      railPoly([P0, P1, P2, P3], { name: 'baranda pasarela' });
    }
    for (const sd of [-1, 1]) for (const s of [-half, half]) add('steel', boxMinMax(C.x + p.x * s + d.x * sd * 0.6 - 0.05, 5.0, C.z + p.z * s + d.z * sd * 0.6 - 0.05, C.x + p.x * s + d.x * sd * 0.6 + 0.05, yd - 0.08, C.z + p.z * s + d.z * sd * 0.6 + 0.05));
    if (a === 250) { // ruta: lado oeste → pasarela → zona del spawn → regreso
      const W = [C.x - p.x * (half + len + 0.5), C.z - p.z * (half + len + 0.5)], E = [C.x + p.x * (half + len + 0.5), C.z + p.z * (half + len + 0.5)];
      R(W[0], 5.0, W[1], 'pasarela O'); R(C.x, yd, C.z, 'pasarela'); R(E[0], 5.0, E[1], 'pasarela E');
      R(0, 5.0, 11, 'spawn'); R(E[0], 5.0, E[1], 'pasarela E'); R(C.x, yd, C.z, 'pasarela'); R(W[0], 5.0, W[1], 'pasarela O');
    }
  });
  // 9c. torre de escaleras de doble tramo (zigzag): carril A (z 2.5–3.7) baja→sube hacia −X, carril B (3.8–5.0) hacia +X
  {
    const zA = (TW.z0 + TW.zm - 0.05) / 2, zB = (TW.zm + 0.05 + TW.z1) / 2, wL = 1.15;
    const secs = [{ to: 9.2, nf: 2, n: 12 }, { to: 16.5, nf: 4, n: 10 }, { to: 23.0, nf: 4, n: 9 }, { to: 30.0, nf: 4, n: 10 }, { to: 36.5, nf: 4, n: 9 }];
    let y = 5.0, f = 0;
    R(-9.3, 5.0, 6.4, 'hacia la torre'); R(-9.3, 5.0, zA, 'entrada torre'); R(TW.xA + 0.3, 5.0, zA, 'torre');
    const nearYs = [], farYs = [];
    for (const sc of secs) {
      const dy = (sc.to - y) / sc.nf;
      for (let j = 0; j < sc.nf; j++, f++) {
        const y1 = y + dy, laneA = f % 2 === 0;
        const len = (sc.n - 1) * RUN;
        if (laneA) {
          flight(TW.xA, zA, -1, 0, y, y1, sc.n, wL, { noBlock: true, name: 'torre de escaleras' });
          if (len < TW.fz - 0.01) landing(TW.xB, TW.xA - len, TW.zm - 0.05 - wL - 0.05, TW.zm - 0.05, y1, 'torre', true);
          landing(TW.xf, TW.xB + 0.02, TW.z0, TW.z1, y1, 'descanso torre'); farYs.push(y1);
          R(TW.xB - 0.55, y1, zA, 'descanso'); R(TW.xB - 0.55, y1, zB, 'descanso');
        } else {
          flight(TW.xB, zB, 1, 0, y, y1, sc.n, wL, { noBlock: true, name: 'torre de escaleras' });
          if (len < TW.fz - 0.01) landing(TW.xB + len, TW.xA, TW.zm + 0.05, TW.zm + 0.1 + wL, y1, 'torre', true);
          landing(TW.xA - 0.02, TW.xn + 0.05, TW.z0, TW.z1, y1, 'descanso torre'); nearYs.push(y1);
          R(TW.xA + 0.55, y1, zB, 'descanso');
          if (Math.abs(y1 - sc.to) < 1e-6) { R(TW.xA + 0.55, y1, TW.zm, 'nivel ' + sc.to); }
          else R(TW.xA + 0.55, y1, zA, 'descanso');
        }
        y = y1;
      }
      // puente a la plataforma
      const P = RINGS.find((q) => q.y === sc.to);
      const xEnd = -Math.sqrt(P.ro * P.ro - TW.z1 * TW.z1) + 0.15;
      landing(TW.xn - 0.05, xEnd, TW.z0, TW.z1, sc.to, 'puente a plataforma ' + sc.to);
      for (const z of [TW.z0, TW.z1]) railLine(V(TW.xn, sc.to, z), V(-Math.sqrt(P.ro * P.ro - z * z), sc.to, z), { name: 'baranda puente' });
      add('steel', boxMinMax(TW.xn, sc.to - 0.3, TW.z0, xEnd, sc.to - 0.06, TW.z0 + 0.1));
      add('steel', boxMinMax(TW.xn, sc.to - 0.3, TW.z1 - 0.1, xEnd, sc.to - 0.06, TW.z1));
      const rw = { 9.2: 7.75, 16.5: 7.8, 23: 5.75, 30: 5.4, 36.5: 6.4 }[sc.to];
      R(TW.xn + 0.8, sc.to, TW.zm, 'puente ' + sc.to);
      R(-Math.sqrt(rw * rw - TW.zm * TW.zm), sc.to, TW.zm, 'plataforma ' + sc.to);
      R(TW.xn + 0.8, sc.to, TW.zm, 'puente ' + sc.to);
      if (sc.to < 36.5) R(TW.xA + 0.55, sc.to, zA, 'torre');
    }
    // paredes de la torre (obstáculos) y barandas visibles
    const yTop = 36.5 + POST_H;
    oSeg(TW.xf, TW.z0, TW.xn, TW.z0, 5.0, yTop, 0.04, 'torre (lado)');
    oSeg(TW.xf, TW.z1, TW.xn, TW.z1, 5.0, yTop, 0.04, 'torre (lado)');
    oSeg(TW.xf, TW.z0, TW.xf, TW.z1, 5.0, yTop, 0.04, 'torre (fondo)');
    oSeg(TW.xB, TW.zm, TW.xA, TW.zm, 5.0, yTop, 0.05, 'torre (divisor)');
    const win = [5.0, ...LEVELS];
    for (let i = 0; i < win.length; i++) {
      const y0 = win[i] + 2.0, y1 = i + 1 < win.length ? win[i + 1] - 0.06 : yTop;
      if (y1 > y0) oSeg(TW.xn, TW.z0, TW.xn, TW.z1, y0, y1, 0.04, 'torre (frente)');
    }
    oBox(TW.xf, TW.xA, TW.z0, TW.z1, 4.9, 5.15, true, 'bajo la escalera');
    // baranda de cierre arriba (carril A en 36.5)
    railLine(V(TW.xA, 36.5, TW.z0), V(TW.xA, 36.5, TW.zm), { name: 'baranda torre' });
    // barandas visibles: laterales por tramo + descansos + frente intermedio
    const rails = [];
    for (const yy of [...farYs]) { rails.push([V(TW.xf, yy, TW.z0), V(TW.xf, yy, TW.z1)], [V(TW.xf, yy, TW.z0), V(TW.xB, yy, TW.z0)], [V(TW.xf, yy, TW.z1), V(TW.xB, yy, TW.z1)]); }
    for (const yy of nearYs) {
      rails.push([V(TW.xA, yy, TW.z0), V(TW.xn, yy, TW.z0)], [V(TW.xA, yy, TW.z1), V(TW.xn, yy, TW.z1)]);
      if (!LEVELS.includes(Math.round(yy * 1000) / 1000)) rails.push([V(TW.xn, yy, TW.z0), V(TW.xn, yy, TW.z1)]);
    }
    for (const [a, b] of rails) railLine(a, b, { noBlock: true });
    // estructura: columnas y riostras
    for (const x of [TW.xf, TW.xB, TW.xA, TW.xn]) for (const z of [TW.z0, TW.z1]) add('steel', boxMinMax(x - 0.08, 5.0, z - 0.08, x + 0.08, yTop, z + 0.08));
    for (const yy of [...farYs, ...nearYs]) for (const z of [TW.z0, TW.z1]) add('steel', boxMinMax(TW.xf, yy - 0.25, z - 0.06, TW.xn, yy - 0.06, z + 0.06));
    A('stairTowerBase', TW.xA + 0.5, 5.0, TW.zm); A('stairTowerTop', TW.xA + 0.5, 36.5, TW.zm);
    A('ladderLabelTower', TW.xn + 0.3, 7.2, TW.z1 + 0.2);
  }
  // 9d. escalerillas verticales (accesos secundarios)
  const ladders = [];
  function ladder(base, top, facing, width = 0.5) {
    const lat = V(-facing.z, 0, facing.x);
    for (const s of [-1, 1]) add('steel', tube(V(base.x + lat.x * s * width / 2, base.y, base.z + lat.z * s * width / 2), V(top.x + lat.x * s * width / 2, top.y + 1.1, top.z + lat.z * s * width / 2), 0.03, 8));
    const rl = [], q = new THREE.Quaternion().setFromUnitVectors(Y_UP, lat);
    for (let y = base.y + 0.3; y < top.y + 0.05; y += 0.3) rl.push({ m: mat4(V(base.x, y, base.z), q, V(1, width, 1)) });
    inst(new THREE.CylinderGeometry(0.017, 0.017, 1, 6), M.steel, rl, 'peldaños');
    for (let y = base.y + 2.4; y < top.y + 1.0; y += 1.0) { // jaula de protección
      const g = new THREE.TorusGeometry(0.4, 0.015, 4, 16, Math.PI).rotateX(HALF);
      const m = new THREE.Matrix4().makeBasis(lat, Y_UP, V().crossVectors(lat, Y_UP)).setPosition(base.x - facing.x * 0.0, y, base.z - facing.z * 0.0);
      add('steel', g.applyMatrix4(m).translate(-facing.x * 0.02, 0, -facing.z * 0.02));
    }
    ladders.push({ base: base.clone(), top: top.clone(), facing: facing.clone().normalize(), width });
  }
  ladder(V(LAD1.x, 1.5, LAD1.z), V(LAD1.x, 5.0, LAD1.z), V(1, 0, 0));
  ladder(V(LAD2.x, 30.0, LAD2.z), V(LAD2.x, 36.5, LAD2.z), V(0, 0, -1));
  A('ladderLabelEast', LAD1.x + 0.4, 3.2, LAD1.z); A('ladderLabel30', LAD2.x, 33.0, LAD2.z + 0.4);

  // ============================================================ 10. PUENTE DE SKIPS, VAGONETAS, CARGA SUPERIOR
  const angSk = 58 * DEG;
  const pTop = V(0, 47.5, -3.5), pBase = V(0, 1.8, -(3.5 + (47.5 - 1.8) / Math.tan(angSk)));
  const pb = (t) => V().lerpVectors(pBase, pTop, t);
  const uS = V().subVectors(pTop, pBase).normalize();
  const nuS = V(0, -uS.z, uS.y).negate(); // normal "arriba" del plano del puente (sube y se aleja del horno)
  if (nuS.y < 0) nuS.negate();
  {
    const alt = 1.4, N = 24;
    for (const s of [-1, 1]) {
      const sx = V(s * 1.4, 0, 0);
      for (let i = 0; i <= N; i++) {
        const B = pb(i / N).add(sx), T = B.clone().addScaledVector(nuS, alt);
        add('orange', tube(B, T, 0.11, NT));
        if (i < N) {
          const B2 = pb((i + 1) / N).add(sx), T2 = B2.clone().addScaledVector(nuS, alt);
          add('orange', tube(B, B2, 0.15, NT)); add('orange', tube(T, T2, 0.15, NT));
          add('orange', i % 2 === 0 ? tube(B, T2, 0.09, NT) : tube(T, B2, 0.09, NT));
        }
      }
    }
    for (let i = 0; i <= N; i += 2) {
      const P = pb(i / N);
      add('orange', tube(V(-1.4, P.y, P.z), V(1.4, P.y, P.z), 0.1, NT));
      const T = P.clone().addScaledVector(nuS, alt);
      add('orange', tube(V(-1.4, T.y, T.z), V(1.4, T.y, T.z), 0.1, NT));
    }
    for (const s of [-1, 1]) add('rail', tube(pBase.clone().add(V(s * 0.6, 0, 0)).addScaledVector(nuS, 0.15), pTop.clone().add(V(s * 0.6, 0, 0)).addScaledVector(nuS, 0.15), 0.07, 8));
    for (const t of [0.12, 0.3, 0.48, 0.64, 0.8]) { // caballetes
      const b = pb(t), z = b.z, zz = b.y * 0.5;
      for (const s of [-1, 1]) { add('orange', tube(V(s * 1.4, 1.5, z), V(s * 1.4, b.y, z), 0.22, NS)); oCyl(s * 1.4, z, 0.22, 1.5, b.y, 'caballete'); }
      add('orange', tube(V(-1.4, zz, z), V(1.4, zz, z), 0.12, NT));
      add('orange', tube(V(-1.4, 1.5, z), V(1.4, zz, z), 0.1, NT));
      add('orange', tube(V(1.4, 1.5, z), V(-1.4, zz, z), 0.1, NT));
    }
    // canaleta de descarga: del skip a la tolva receptora
    add('hopper', obox(V(0, 48.15, -2.4), V(0, -0.55, 1).normalize(), 2.2, 1.3, 0.08));
    for (const s of [-1, 1]) add('hopper', obox(V(s * 0.65, 48.4, -2.4), V(0, -0.55, 1).normalize(), 2.2, 0.06, 0.5));
    A('hopperDump', 0, 47.9, -1.4);
  }
  {
    const mkSkip = () => {
      const g = new THREE.Group();
      const body = [box(0, 0, 0, 1.5, 1.1, 3.0)];
      const rim = [box(0, 0.5, 0, 1.6, 0.12, 3.1), box(0, 0.62, 0, 0.12, 0.25, 3.1)];
      for (const s of [-1, 1]) for (const z of [-1.0, 1.0]) rim.push(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12).rotateZ(HALF).translate(s * 0.8, -0.65, z));
      g.add(new THREE.Mesh(mergeList(body, false), M.torpedo), new THREE.Mesh(mergeList(rim, false), M.dark));
      return g;
    };
    const basis = new THREE.Matrix4().makeBasis(V(1, 0, 0), nuS, uS);
    const qBase = new THREE.Quaternion().setFromRotationMatrix(basis);
    const qTip = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
    parts.skips = [mkSkip(), mkSkip()];
    parts.skips.forEach((s, i) => { s.name = 'skip' + i; root.add(s); });
    parts.skipPose = (i, t) => {
      const s = parts.skips[i]; if (!s) return null;
      t = clamp(t, 0, 1);
      s.position.copy(pb(t)).addScaledVector(nuS, 0.95);
      const tip = t > 0.93 ? ((t - 0.93) / 0.07) * 55 * DEG : 0; // vuelco al llegar arriba
      qTip.setFromAxisAngle(V(1, 0, 0), tip);
      s.quaternion.copy(qBase).multiply(qTip);
      if (tip > 0) s.position.addScaledVector(uS, (tip / (55 * DEG)) * 0.6);
      return s;
    };
    parts.skipPose(0, 0.18); parts.skipPose(1, 0.62);
    A('skipBottom', ...pb(0).addScaledVector(nuS, 0.95).toArray());
    A('skipTop', ...pb(1).addScaledVector(nuS, 0.95).toArray());
    A('skipMid', ...pb(0.5).addScaledVector(nuS, 0.95).toArray());
    dirs.skipUp = uS.clone();
  }

  // ============================================================ ENSAMBLE DE LOTES E INSTANCIAS
  inst(new THREE.CylinderGeometry(0.025, 0.025, POST_H, 6, 1, true), M.yellow, postList, 'postes');
  {
    const g = planarUV(new THREE.BoxGeometry(1, 0.04, RUN + 0.02));
    inst(g, M.grate, treadList, 'huellas');
  }
  const meshByVis = { all: [], cut: [], wedge: [] };
  for (const [key, b] of batches) {
    if (!b.list.length) continue;
    const mesh = new THREE.Mesh(mergeList(b.list, b.worldUV), b.mat);
    mesh.name = 'lote:' + key;
    root.add(mesh); meshByVis[b.vis].push(mesh);
  }
  for (const m of wedgeMeshes) meshByVis.wedge.push(m);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  parts.interiorGroup = new THREE.Group(); parts.interiorGroup.name = 'interior'; root.add(parts.interiorGroup);
  parts.labels = new THREE.Group(); parts.labels.name = 'carteles'; root.add(parts.labels);
  parts.mats = { stoveGlow, hotMain: M.hotMain, bustle: M.bustle, tuyereGlow: M.tuyereGlow, shellHot: M.shellF, lining: M.lining, all: M };

  // ============================================================ NAV (Contrato 3)
  function surfY(s, x, z) {
    switch (s.type) {
      case 'rect': {
        if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
        if (s.holes) for (const h of s.holes) {
          if (h.c) { if ((x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r) return null; }
          else if (x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) return null;
        }
        return s.y;
      }
      case 'ring': { const d = Math.hypot(x - s.cx, z - s.cz); return d >= s.ri && d <= s.ro ? s.y : null; }
      case 'ramp': {
        const dx = x - s.ox, dz = z - s.oz, a = dx * s.ux + dz * s.uz, t = -dx * s.uz + dz * s.ux;
        if (a < -1e-4 || a > s.len + 1e-4 || t < -s.hw || t > s.hw) return null;
        if (s.y1 === s.y0) return s.y0;
        return clamp(s.y0 + s.h * (0.5 + a / s.run), s.y0, s.y1);
      }
    }
    return null;
  }
  function floorY(x, z, fromY) {
    const lim = (fromY ?? 1e9) + 0.55 + 1e-4;
    let best = null;
    for (let i = 0; i < SURF.length; i++) {
      const s = SURF[i];
      if (x < s.bx0 || x > s.bx1 || z < s.bz0 || z > s.bz1) continue;
      const y = surfY(s, x, z);
      if (y === null || y > lim) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  }
  function hitObs(o, x, z, y, yT, r) {
    switch (o.t) {
      case 'furn': { const R = shellRmax(Math.max(y, 1.9), yT); return R > 0 && x * x + z * z < (R + r) ** 2; }
      case 'cyl': return (x - o.x) ** 2 + (z - o.z) ** 2 < (o.R + r) ** 2;
      case 'seg': {
        const vx = o.bx - o.ax, vz = o.bz - o.az, wx = x - o.ax, wz = z - o.az;
        const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz || 1), 0, 1);
        return (wx - vx * t) ** 2 + (wz - vz * t) ** 2 < (o.th + r) ** 2;
      }
      case 'arc': {
        const d = Math.hypot(x - o.x, z - o.z);
        if (Math.abs(d - o.R) >= o.th + r) return false;
        const a = Math.atan2(z - o.z, x - o.x);
        for (const g of o.gaps) if (angIn(a, g)) return false;
        return true;
      }
      case 'box': { const e = o.noR ? 0 : r; return x > o.x0 - e && x < o.x1 + e && z > o.z0 - e && z < o.z1 + e; }
      case 'obox': { const dx = x - o.x, dz = z - o.z, a = dx * o.ux + dz * o.uz, t = -dx * o.uz + dz * o.ux; return Math.abs(a) < o.hl + r && Math.abs(t) < o.hw + r; }
      case 'dyn': return o.test(x, z, r);
    }
    return false;
  }
  function blocked(x, z, y, r = 0.3) {
    const yT = y + 1.7;
    for (let i = 0; i < OBS.length; i++) {
      const o = OBS[i];
      if (o.y0 >= yT || o.y1 <= y) continue;
      if (x < o.bx0 - r || x > o.bx1 + r || z < o.bz0 - r || z > o.bz1 + r) continue;
      if (hitObs(o, x, z, y, yT, r)) return true;
    }
    return false;
  }
  function whatBlocks(x, z, y, r = 0.3) { // depuración: nombre del obstáculo
    const yT = y + 1.7;
    for (const o of OBS) { if (o.y0 >= yT || o.y1 <= y) continue; if (hitObs(o, x, z, y, yT, r)) return o.name || o.t; }
    return null;
  }
  const Z = (name, label, anchor, radius) => ({ name, label, anchor, center: anchors[anchor].clone(), radius });
  const zones = [
    Z('nave', 'Nave de colada', 'spawn', 14),
    Z('crisol', 'Crisol y piqueras', 'hearthCenter', 8),
    Z('etalaje', 'Etalaje y toberas', 'bosh', 8),
    Z('toberas', 'Toberas', 'tuyere0', 7),
    Z('vientre', 'Vientre', 'belly', 8),
    Z('viento', 'Anillo de viento', 'bustleCenter', 10),
    Z('cuba', 'Cuba', 'shaft', 10),
    Z('tragante', 'Tragante', 'stockline', 7),
    Z('cabezal', 'Cabezal y doble campana', 'bellSmallCenter', 8),
    Z('estufas', 'Estufas Cowper', 'stove1Top', 16),
    Z('chimenea', 'Chimenea', 'chimneyTop', 12),
    Z('colada', 'Piqueras y canales', 'tapIron0', 9),
    Z('escoria', 'Escoria y cuchara torpedo', 'slagNotch', 10),
    Z('torpedo', 'Cuchara torpedo', 'torpedoStart', 8),
    Z('carga', 'Puente de skips', 'skipMid', 12),
    Z('gas', 'Bajantes de gas', 'uptake0', 9),
    Z('polvo', 'Colector de polvo', 'dustCatcherTop', 12),
    Z('torre', 'Torre de escaleras', 'stairTowerBase', 6),
  ];
  const nav = {
    spawn: { x: 0, y: 5.0, z: 11, yaw: 0 },
    floorY, blocked, whatBlocks, ladders, zones,
    bounds: { minX: -42, maxX: 30, minZ: -38, maxZ: 24 },
    route, surfaces: SURF, obstacles: OBS,
    levels: [1.5, 5.0, ...LEVELS],
    debugDraw(T = THREE) {
      const g = new T.Group(), pts = [];
      const seg = (a, b) => pts.push(a.x, a.y + 0.03, a.z, b.x, b.y + 0.03, b.z);
      for (const s of SURF) {
        if (s.type === 'rect') { const c = [V(s.x0, s.y, s.z0), V(s.x1, s.y, s.z0), V(s.x1, s.y, s.z1), V(s.x0, s.y, s.z1)]; for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]); }
        else if (s.type === 'ring') for (const r of [s.ri, s.ro]) for (let i = 0; i < 48; i++) { const a0 = (i / 48) * TAU, a1 = ((i + 1) / 48) * TAU; seg(V(s.cx + r * Math.cos(a0), s.y, s.cz + r * Math.sin(a0)), V(s.cx + r * Math.cos(a1), s.y, s.cz + r * Math.sin(a1))); }
        else { const lx = -s.uz * s.hw, lz = s.ux * s.hw, ex = s.ux * s.len, ez = s.uz * s.len; const c = [V(s.ox + lx, s.y0, s.oz + lz), V(s.ox + lx + ex, s.y1, s.oz + lz + ez), V(s.ox - lx + ex, s.y1, s.oz - lz + ez), V(s.ox - lx, s.y0, s.oz - lz)]; for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]); }
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      g.add(new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0x00ff88 })));
      return g;
    },
  };

  // ============================================================ MODOS
  const xrayMats = [M.shellF, M.head, M.stave, M.lining];
  let cutOn = true, xrayOn = false;
  function setCutaway(on) {
    cutOn = !!on;
    for (const m of meshByVis.wedge) m.visible = !cutOn;
    for (const m of meshByVis.cut) m.visible = cutOn;
    for (const c of cutInst) c.im.count = cutOn ? c.nOut : c.n;
  }
  function setXray(on) {
    xrayOn = !!on;
    for (const m of xrayMats) {
      m.transparent = xrayOn; m.opacity = xrayOn ? 0.15 : 1; m.depthWrite = !xrayOn; m.needsUpdate = true;
    }
  }
  setCutaway(true);
  function update(dt, t) {
    if (parts.beacon) parts.beacon.material.emissiveIntensity = (t % 1.5) < 0.25 ? 2.5 : 0.15;
  }

  return {
    root, profile, anchors, dirs, parts, nav, setCutaway, setXray, update,
    get cutaway() { return cutOn; }, get xray() { return xrayOn; },
  };
}
