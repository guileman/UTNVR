// process.js — Simulación visual del proceso del alto horno (Contrato 4 del SPEC).
// Agente PROCESS · UTN FRSN · Three.js 0.169 · presupuesto Meta Quest 3.
//
// Decisiones de diseño:
// * La carga interior es UNA columna de revolución (sector de 270° + tapas planas en el corte, y un
//   sector complementario de 90° que sólo se ve con el corte cerrado). La geometría es fija; las capas
//   (coque / mineral + fundente), su descenso, la zona cohesiva en V invertida y el mapa térmico se
//   dibujan con colores por vértice recalculados a ~20 Hz (sin reconstruir geometría ni crear objetos).
//   El tope de la carga (nivel de tragante) se mueve aplastando los vértices superiores.
// * El cuadrante abierto por defecto es x>0, z>0 (cuña del .scad). Si furnace.root.userData.cutaway
//   trae { theta0, theta1 } (rad, ángulo θ con (x,z) = (r cosθ, r sinθ)) se usa ese.
// * Los flujos dentro de tubos opacos (viento, gas en bajantes, colector de polvo, humos de estufas) se
//   dibujan con depthTest=false: se leen como "diagrama de flujo" a través de la chapa. Los flujos dentro
//   del horno (CO en la cuba, gotas, chispas) usan depthTest=true y viven en el cuadrante del corte.
// * Partículas: Points con color RGBA por vértice (alfa por partícula), geometrías y texturas compartidas.

const CUT_DEF = [0, Math.PI / 2];

export function createProcess({ THREE, scene, furnace, content } = {}) {
  const F = furnace || {};
  const AN = F.anchors || {};
  const DIRS = F.dirs || {};
  const parts = F.parts || {};
  const mats = parts.mats || {};
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const D2R = Math.PI / 180, SRGB = THREE.SRGBColorSpace;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------------ perfil interior
  const PZ = [4, 9, 12.5, 14, 28, 31, 34], PR = [5.5, 5.5, 6.2, 6.2, 4.2, 4.2, 1.6], PT = [1.4, 1.4, 0.9, 0.9, 0.7, 0.7, 0.5];
  const interp = (a, y) => {
    const z = clamp(y, PZ[0], PZ[6]); let i = 0;
    for (let k = 0; k < 6; k++) if (z >= PZ[k]) i = k;
    if (i > 5) i = 5;
    const t = (z - PZ[i]) / (PZ[i + 1] - PZ[i]); return a[i] * (1 - t) + a[i + 1] * t;
  };
  const rintF = y => { try { const v = F.profile?.rint?.(y); if (Number.isFinite(v)) return v; } catch (e) { /* perfil propio */ } return interp(PR, y) - interp(PT, y); };
  const rextF = y => { try { const v = F.profile?.rext?.(y); if (Number.isFinite(v)) return v; } catch (e) { /* perfil propio */ } return interp(PR, y); };
  // tabla para no llamar a furnace.profile por vértice
  const RT0 = 3, RTS = 0.05, RTN = 641, RTAB = new Float32Array(RTN);
  for (let i = 0; i < RTN; i++) RTAB[i] = rintF(RT0 + i * RTS);
  const RINT = y => { const f = clamp((y - RT0) / RTS, 0, RTN - 1.001), i = f | 0, t = f - i; return RTAB[i] * (1 - t) + RTAB[i + 1] * t; };
  const Y_HEARTH = F.profile?.yHearth ?? 6.5;

  // ------------------------------------------------------------------ anclas (con valores del .scad)
  const anc = (n, x, y, z) => (AN[n] && AN[n].isVector3) ? AN[n].clone() : V3(x, y, z);
  const tuyTip = [], tuyDir = [], tuyAng = [];
  for (let k = 0; k < 18; k++) {
    const a = (k * 20 + 10) * D2R, ri = rintF(10.5);
    const tip = anc('tuyere' + k, Math.cos(a) * ri, 10.5, -Math.sin(a) * ri);
    let d = DIRS['tuyere' + k];
    d = (d && d.isVector3) ? d.clone().normalize() : V3(-tip.x, 0, -tip.z).normalize();
    tuyTip.push(tip); tuyDir.push(d); tuyAng.push(Math.atan2(tip.z, tip.x));
  }
  const stoveZ = [12, 0, -12];
  const stoveTop = [0, 1, 2].map(i => anc('stove' + i + 'Top', -24, 36.7, stoveZ[i]));
  const stoveBase = [0, 1, 2].map(i => anc('stove' + i + 'Base', -24, 2.3, stoveZ[i]));
  const uptake = [0, 1, 2, 3].map(i => { const a = (45 + 90 * i) * D2R; return anc('uptake' + i, 3.5 * Math.cos(a), 42, -3.5 * Math.sin(a)); });
  const P = {
    stockline: anc('stockline', 0, 30.5, 0), throat: anc('throat', 0, 31, 0),
    hopperDump: anc('hopperDump', 0, 46.4, 0), bellSmall: anc('bellSmallCenter', 0, 42.5, 0), bellLarge: anc('bellLargeCenter', 0, 33.6, 0),
    skipTop: anc('skipTop', 0, 47.5, -3.5), skipBottom: anc('skipBottom', 0, 1.8, -32),
    downcomerTop: anc('downcomerTop', 16, 42, 0), dcTop: anc('dustCatcherTop', 16, 35, 0), dcBottom: anc('dustCatcherBottom', 16, 4.2, 0),
    dcOut: anc('dustCatcherGasOut', 16, 27, -4.2),
    bustleCenter: anc('bustleCenter', 0, 14.2, 0), bustleRing: anc('bustleRing', -8.3, 14.2, 0),
    hotMain: anc('hotBlastMain', -17.5, 30, 0), hotRiser: anc('hotBlastRiser', -17.5, 14.2, 0),
    chimneyTop: anc('chimneyTop', -34, 67.5, 0),
    tap: [anc('tapIron0', -2.15, 7.2, 5.92), anc('tapIron1', 2.15, 7.2, 5.92)],
    trough: [anc('troughEnd0', -5.2, 5.5, 14.28), anc('troughEnd1', 5.2, 5.5, 14.28)],
    slagNotch: anc('slagNotch', -5.16, 8.9, 3.61), slagEnd: anc('slagTroughEnd', -11.5, 5.5, 8.0),
    torpStart: anc('torpedoStart', -12, 3.2, 16), torpEnd: anc('torpedoEnd', 12, 3.2, 16),
    cleanGasEnd: AN.cleanGasEnd?.isVector3 ? AN.cleanGasEnd.clone() : null,
    cleanGasDown: AN.cleanGasDown?.isVector3 ? AN.cleanGasDown.clone() : null,
    slagPit: AN.slagPit?.isVector3 ? AN.slagPit.clone() : null,
    torpMouth: AN.torpedoMouth?.isVector3 ? AN.torpedoMouth.clone() : null,
  };
  const ringR = Math.hypot(P.bustleRing.x - P.bustleCenter.x, P.bustleRing.z - P.bustleCenter.z) || 8.3;
  const ringY = P.bustleRing.y;

  // cuadrante del corte
  const cutUD = F.root?.userData?.cutaway;
  const CUT0 = Number.isFinite(cutUD?.theta0) ? cutUD.theta0 : CUT_DEF[0];
  const CUT1 = Number.isFinite(cutUD?.theta1) ? cutUD.theta1 : CUT_DEF[1];
  const CUTM = (CUT0 + CUT1) / 2;

  // ------------------------------------------------------------------ grupos
  const root = new THREE.Group(); root.name = 'process';
  (scene || F.root)?.add?.(root);
  const inner = parts.interiorGroup?.isObject3D ? parts.interiorGroup : root;
  const innerG = new THREE.Group(); innerG.name = 'process.interior'; inner.add(innerG);

  // ------------------------------------------------------------------ texturas compartidas
  const mkCv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const dotTex = (() => {
    const c = mkCv(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const smokeTex = (() => {
    const c = mkCv(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const disposables = [dotTex, smokeTex];

  // ------------------------------------------------------------------ caminos (polilíneas)
  function mkPath(pts, knee) {
    const n = pts.length, p = new Float32Array(n * 3), cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = pts[i].x; p[i * 3 + 1] = pts[i].y; p[i * 3 + 2] = pts[i].z;
      if (i) cum[i] = cum[i - 1] + pts[i].distanceTo(pts[i - 1]);
    }
    return { p, cum, n, len: Math.max(cum[n - 1], 1e-3), knee: knee ?? 1 };
  }
  const polar = (r, th, y) => V3(r * Math.cos(th), y, r * Math.sin(th));
  const arcPts = (r, y, a0, a1, step = 10 * D2R) => { // arco por el lado corto
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(d) / step)), o = [];
    for (let i = 0; i <= n; i++) o.push(polar(r, a0 + d * i / n, y).add(V3(P.bustleCenter.x, 0, P.bustleCenter.z)));
    return o;
  };

  // ------------------------------------------------------------------ sistema de flujo por polilínea
  const flows = [];
  class Flow {
    constructor(o) {
      const n = o.n; this.n = n; this.paths = o.paths; this.speed = o.speed; this.jr = o.jit || 0;
      this.choose = o.choose || (() => (Math.random() * this.paths.length) | 0);
      this.fadeIn = o.fadeIn ?? 1.5; this.fadeOut = o.fadeOut ?? 1.5;
      this.c0 = o.c0; this.c1 = o.c1 || o.c0; this.rate = 1; this.emit = false; this.alpha = o.alpha ?? 1;
      this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4);
      this.pi = new Uint16Array(n); this.s = new Float32Array(n); this.seg = new Uint16Array(n); this.sp = new Float32Array(n);
      this.j = new Float32Array(n * 3); this.alive = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        this.sp[i] = rnd(0.75, 1.25);
        let x, y, z; do { x = rnd(-1, 1); y = rnd(-1, 1); z = rnd(-1, 1); } while (x * x + y * y + z * z > 1);
        this.j[i * 3] = x * this.jr; this.j[i * 3 + 1] = y * this.jr; this.j[i * 3 + 2] = z * this.jr;
        this.pos[i * 3 + 1] = -1000;
      }
      const g = new THREE.BufferGeometry();
      this.aP = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.aC = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.aP); g.setAttribute('color', this.aC);
      this.mat = new THREE.PointsMaterial({
        size: o.size, map: o.map || dotTex, vertexColors: true, transparent: true, depthWrite: false,
        depthTest: o.depthTest !== false, blending: o.normal ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false, sizeAttenuation: true,
      });
      this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.visible = false;
      this.obj.renderOrder = o.renderOrder ?? 5; this.obj.name = 'flow.' + (o.name || '');
      (o.parent || root).add(this.obj);
      flows.push(this);
    }
    start() {
      this.emit = true; this.obj.visible = true;
      for (let i = 0; i < this.n; i++) if (!this.alive[i]) {
        this.alive[i] = 1; const p = this.choose(i); this.pi[i] = p; this.seg[i] = 0;
        this.s[i] = -Math.random() * this.paths[p].len / (this.speed * this.sp[i]) * this.speed * this.sp[i];
      }
    }
    stop() { this.emit = false; }
    kill() { this.emit = false; this.alive.fill(0); this.obj.visible = false; }
    update(dt) {
      if (!this.obj.visible) return;
      const { pos, col, s, pi, seg, sp, j, alive } = this; let any = false;
      for (let i = 0; i < this.n; i++) {
        const i3 = i * 3, i4 = i * 4;
        if (!alive[i]) { col[i4 + 3] = 0; continue; }
        let path = this.paths[pi[i]];
        s[i] += this.speed * sp[i] * dt * (0.4 + 0.6 * this.rate);
        if (s[i] >= path.len) {
          if (this.emit) { s[i] -= path.len; const p = this.choose(i); pi[i] = p; seg[i] = 0; path = this.paths[p]; if (s[i] > path.len) s[i] = 0; }
          else { alive[i] = 0; col[i4 + 3] = 0; continue; }
        }
        any = true;
        const si = s[i];
        if (si < 0) { col[i4 + 3] = 0; pos[i3 + 1] = -1000; continue; }
        const cum = path.cum, pp = path.p; let k = seg[i];
        while (k < path.n - 2 && cum[k + 1] < si) k++;
        seg[i] = k;
        const sl = cum[k + 1] - cum[k], t = sl > 1e-6 ? (si - cum[k]) / sl : 0, k3 = k * 3;
        pos[i3] = pp[k3] + (pp[k3 + 3] - pp[k3]) * t + j[i3];
        pos[i3 + 1] = pp[k3 + 1] + (pp[k3 + 4] - pp[k3 + 1]) * t + j[i3 + 1];
        pos[i3 + 2] = pp[k3 + 2] + (pp[k3 + 5] - pp[k3 + 2]) * t + j[i3 + 2];
        const u = Math.min(1, si / (path.len * path.knee)), c0 = this.c0, c1 = this.c1;
        col[i4] = c0[0] + (c1[0] - c0[0]) * u; col[i4 + 1] = c0[1] + (c1[1] - c0[1]) * u; col[i4 + 2] = c0[2] + (c1[2] - c0[2]) * u;
        col[i4 + 3] = Math.min(1, si / this.fadeIn, (path.len - si) / this.fadeOut) * this.rate * this.alpha;
      }
      this.aP.needsUpdate = true; this.aC.needsUpdate = true;
      if (!any && !this.emit) this.obj.visible = false;
    }
  }

  // ------------------------------------------------------------------ partículas balísticas
  class Ballistic {
    constructor(o) {
      const n = o.n; this.n = n; this.spawn = o.spawn; this.rateMax = o.rate; this.rate = 0; this.acc = 0;
      this.g = o.gravity ?? -9.8; this.drag = o.drag ?? 0; this.fade = o.fade ?? 0.3; this.alpha = o.alpha ?? 1; this.next = 0;
      this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4);
      this.life = new Float32Array(n); this.ttl = new Float32Array(n); this.floor = new Float32Array(n).fill(-1e9);
      this.rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
      const g = new THREE.BufferGeometry();
      this.aP = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.aC = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.aP); g.setAttribute('color', this.aC);
      this.mat = new THREE.PointsMaterial({
        size: o.size, map: o.map || dotTex, vertexColors: true, transparent: true, depthWrite: false,
        depthTest: o.depthTest !== false, blending: o.normal ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false, sizeAttenuation: true,
      });
      this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.visible = false;
      this.obj.renderOrder = o.renderOrder ?? 6; this.obj.name = 'ballistic.' + (o.name || '');
      (o.parent || root).add(this.obj); this.live = 0;
    }
    emitOne() {
      const n = this.n; let i = this.next, tries = 0;
      while (this.life[i] > 0 && tries < n) { i = (i + 1) % n; tries++; }
      if (tries >= n) return;
      this.next = (i + 1) % n; this.floor[i] = -1e9;
      this.spawn(i, this.pos, this.vel, this.rgb, this);
      this.life[i] = this.ttl[i];
    }
    update(dt) {
      if (this.rate > 0) {
        this.obj.visible = true; this.acc += this.rate * this.rateMax * dt;
        let k = 0; while (this.acc >= 1 && k < 200) { this.acc -= 1; this.emitOne(); k++; }
      }
      if (!this.obj.visible) return;
      const { pos, vel, col, life, ttl, floor, rgb } = this; let live = 0;
      const dg = this.g * dt, dk = Math.max(0, 1 - this.drag * dt);
      for (let i = 0; i < this.n; i++) {
        const i3 = i * 3, i4 = i * 4;
        if (life[i] <= 0) { col[i4 + 3] = 0; continue; }
        life[i] -= dt;
        vel[i3 + 1] += dg; vel[i3] *= dk; vel[i3 + 1] *= dk; vel[i3 + 2] *= dk;
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
        if (pos[i3 + 1] < floor[i] || life[i] <= 0) { life[i] = 0; col[i4 + 3] = 0; pos[i3 + 1] = -1000; continue; }
        live++;
        const a = Math.min(1, life[i] / this.fade, (ttl[i] - life[i]) / 0.08 + 0.2) * this.alpha;
        col[i4] = rgb[i3]; col[i4 + 1] = rgb[i3 + 1]; col[i4 + 2] = rgb[i3 + 2]; col[i4 + 3] = a;
      }
      this.live = live;
      this.aP.needsUpdate = true; this.aC.needsUpdate = true;
      if (!live && this.rate <= 0) this.obj.visible = false;
    }
    kill() { this.life.fill(0); this.rate = 0; this.obj.visible = false; }
  }

  // ==================================================================== COLUMNA DE CARGA
  // vértices paramétricos (y0, rf, θ) → posición por perfil; colores por campo (capas, temperatura)
  function buildSector(ys, rfs, th0, th1, nTh, R, opts) {
    const PY = [], PRf = [], PC = [], PS = [], SH = [], idx = [];
    const add = (y, rf, th, sh) => { PY.push(y); PRf.push(rf); PC.push(Math.cos(th)); PS.push(Math.sin(th)); SH.push(sh); return PY.length - 1; };
    const grid = (rows, cols, f) => {
      const base = []; for (let a = 0; a < rows; a++) for (let b = 0; b < cols; b++) base.push(f(a, b));
      for (let a = 0; a < rows - 1; a++) for (let b = 0; b < cols - 1; b++) {
        const i0 = base[a * cols + b], i1 = base[a * cols + b + 1], i2 = base[(a + 1) * cols + b], i3 = base[(a + 1) * cols + b + 1];
        idx.push(i0, i2, i1, i1, i2, i3);
      }
    };
    const thAt = i => th0 + (th1 - th0) * i / nTh;
    const nY = ys.length, nR = rfs.length, yTop = ys[nY - 1], yBot = ys[0];
    if (opts.wall) grid(nY, nTh + 1, (a, b) => add(ys[a], 1, thAt(b), 0.62 + 0.22 * Math.cos(thAt(b) - 2.2)));
    if (opts.top) grid(nR, nTh + 1, (a, b) => add(yTop, rfs[a], thAt(b), 1.0));
    if (opts.bottom) grid(nR, nTh + 1, (a, b) => add(yBot, rfs[a], thAt(b), 0.45));
    if (opts.caps) {
      grid(nY, nR, (a, b) => add(ys[a], rfs[b], th0, 0.92));
      grid(nY, nR, (a, b) => add(ys[a], rfs[b], th1, 0.80));
    }
    const n = PY.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = R(PY[i]) * PRf[i]; pos[i * 3] = r * PC[i]; pos[i * 3 + 1] = PY[i]; pos[i * 3 + 2] = r * PS[i]; }
    const aP = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const aC = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', aP); g.setAttribute('color', aC); g.setIndex(idx);
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) { const h = Math.sin(i * 12.9898 + PY[i] * 78.233) * 43758.5453; noise[i] = (h - Math.floor(h)) * 2 - 1; }
    g.computeBoundingSphere();
    return { g, n, py: Float32Array.from(PY), pr: Float32Array.from(PRf), pc: Float32Array.from(PC), ps: Float32Array.from(PS), sh: Float32Array.from(SH), noise, pos, col, aP, aC };
  }
  const COL_Y0 = Y_HEARTH, COL_Y1 = 31.0, ys = [];
  for (let y = COL_Y0; y < COL_Y1 - 1e-6; y += 0.15) ys.push(y);
  ys.push(COL_Y1);
  const rfs = []; for (let k = 0; k <= 12; k++) rfs.push(k / 12);
  const Rcol = y => Math.max(0.05, RINT(y) - 0.03);
  const cut0 = CUT1, cut1 = CUT0 + 2 * Math.PI; // sector visible (270°) de CUT1 a CUT0+2π
  const colA = buildSector(ys, rfs, cut0, cut1, 27, Rcol, { wall: true, top: true, bottom: false, caps: true });
  const colB = buildSector(ys, rfs, CUT0, CUT1, 9, Rcol, { wall: true, top: true, bottom: false, caps: false });
  const colMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const colMeshA = new THREE.Mesh(colA.g, colMat), colMeshB = new THREE.Mesh(colB.g, colMat);
  colMeshA.name = 'carga.270'; colMeshB.name = 'carga.90'; colMeshB.visible = false;
  colMeshA.frustumCulled = colMeshB.frustumCulled = false;
  innerG.add(colMeshA, colMeshB);

  // ---------- líquidos del crisol (sectores de altura unitaria, escalados en Y) ----------
  const RH = Math.max(0.5, RINT(7.5) - 0.03);
  const liqMk = (color, name) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const a = buildSector([0, 1], [0, 0.5, 1], cut0, cut1, 27, () => RH, { wall: true, top: true, bottom: false, caps: true });
    const b = buildSector([0, 1], [0, 0.5, 1], CUT0, CUT1, 9, () => RH, { wall: true, top: true, bottom: false, caps: false });
    const ma = new THREE.Mesh(a.g, m), mb = new THREE.Mesh(b.g, m);
    a.g.deleteAttribute('color'); b.g.deleteAttribute('color');
    ma.name = name + '.270'; mb.name = name + '.90'; mb.visible = false; ma.frustumCulled = mb.frustumCulled = false;
    innerG.add(ma, mb); return { m, ma, mb };
  };
  const ironLiq = liqMk(0xff7a1a, 'arrabio'), slagLiq = liqMk(0xd9b25a, 'escoria');

  // ==================================================================== CAPAS (coordenada material u)
  const TILT = 0.8, T_COKE = 0.78, T_ORE = 0.62;
  const LU = [], LT = []; // inicio u de cada capa y tipo (0 coque, 1 mineral+fundente)
  const S = { // estado de simulación
    simT: 0, D: 0, level: 29.7, heat: 0.85, comb: 0, melt: 0, ironH: 1.45, slagH: 0.55,
    blastT: 25, topGasT: 60, ironT: 1490, prod: 0, layers: 0, nextType: 0, charged: 0,
    stoveH: [1.0, 0.8, 0.6], stoveBlow: 0, stoveClock: 0, stovePh: ['blast', 'gas', 'gas'],
    tapStatus: 'idle', torpFill: 0, hole: 0,
  };
  const uTop = () => S.level + S.D - 0.6 * TILT;
  function initLayers() {
    LU.length = 0; LT.length = 0;
    let u = COL_Y0 + S.D - TILT - 2, t = 0;
    const top = uTop();
    while (u < top - 0.05) { LU.push(u); LT.push(t); u += t ? T_ORE : T_COKE; t ^= 1; }
    // ajusta el nivel al tope de la última capa entera
    S.level = u - S.D + 0.6 * TILT; S.nextType = t;
  }
  function addLayer(type) {
    const u = uTop(); LU.push(u); LT.push(type);
    S.level += type ? T_ORE : T_COKE; S.charged++;
    while (LU.length > 4 && LU[2] < S.D + COL_Y0 - TILT - 3) { LU.shift(); LT.shift(); }
    if (LU.length > 120) { LU.shift(); LT.shift(); }
  }
  let lyrIdx = 0, lyrFrac = 0;
  function layerAt(u) {
    let lo = 0, hi = LU.length - 1;
    if (hi < 0 || u < LU[0]) { lyrIdx = -1; lyrFrac = 0; return 0; }
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (LU[m] <= u) lo = m; else hi = m - 1; }
    lyrIdx = lo;
    const end = lo + 1 < LU.length ? LU[lo + 1] : uTop();
    lyrFrac = (u - LU[lo]) / Math.max(1e-3, end - LU[lo]);
    return LT[lo];
  }

  // ==================================================================== CAMPO TÉRMICO Y COLORES
  let cr = 0, cg = 0, cb = 0;
  const CM_T = [0, 300, 700, 1000, 1250, 1500, 1900, 2300];
  const CM_C = [[0.05, 0.05, 0.35], [0.0, 0.35, 0.95], [0.0, 0.8, 0.6], [0.6, 0.9, 0.1], [1.0, 0.75, 0.0], [1.0, 0.35, 0.0], [0.85, 0.05, 0.05], [1.0, 0.92, 0.88]];
  function cmap(T) {
    let i = 0; while (i < CM_T.length - 2 && T > CM_T[i + 1]) i++;
    const t = clamp((T - CM_T[i]) / (CM_T[i + 1] - CM_T[i]), 0, 1), a = CM_C[i], b = CM_C[i + 1];
    cr = a[0] + (b[0] - a[0]) * t; cg = a[1] + (b[1] - a[1]) * t; cb = a[2] + (b[2] - a[2]) * t;
  }
  let ysC = 21.5, ysW = 13.2;
  const ySoft = rf => ysW + (ysC - ysW) * Math.pow(1 - rf, 1.1);
  const yMeltOf = (rf, yS) => yS - (1.4 + 1.3 * (1 - rf));
  function tempAt(y, rf, yS, yM, yT) {
    let T;
    if (y > yT + 0.05) T = 200;
    else if (y > yS) {
      const d = y - yS, span = Math.max(1, yT - yS - 3);
      T = d < 3 ? 1100 - 200 * sstep(0, 3, d) : 900 - 700 * Math.pow(clamp((d - 3) / span, 0, 1), 0.8);
    } else if (y > yM) T = 1100 + 300 * (yS - y) / Math.max(0.2, yS - yM);
    else T = 1400 + 100 * clamp((yM - y) / 3, 0, 1);
    if (y < Y_HEARTH + S.ironH + S.slagH + 0.2) T = Math.max(T, 1480);
    const rw = 2250 * Math.exp(-((y - 10.5) * (y - 10.5)) / 1.0 - ((1 - rf) * (1 - rf)) / 0.025) * (0.3 + 0.7 * S.comb);
    if (rw > T) T = rw;
    return 20 + (T - 20) * (0.3 + 0.7 * S.heat);
  }
  let thermalOn = false;
  function shadeColumn(C) {
    const { n, py, pr, pc, ps, sh, noise, pos, col } = C;
    const lev = S.level, D = S.D, hot = S.heat, comb = S.comb, rwOn = V.raceway ? 1 : 0.35;
    const k = 0.55 + 0.45 * hot;
    ysC = 10.5 + (21.5 - 10.5) * k; ysW = 10.5 + (13.2 - 10.5) * k;
    for (let i = 0; i < n; i++) {
      const rf = pr[i], yT = lev + TILT * (rf - 0.6);
      const y = py[i] < yT ? py[i] : yT;
      const r = Rcol(y) * rf, i3 = i * 3;
      pos[i3] = r * pc[i]; pos[i3 + 1] = y; pos[i3 + 2] = r * ps[i];
      const yS = ySoft(rf), yM = yMeltOf(rf, yS);
      if (thermalOn) {
        cmap(tempAt(y, rf, yS, yM, yT));
        const s = 0.85 + 0.15 * sh[i]; col[i3] = cr * cr * s; col[i3 + 1] = cg * cg * s; col[i3 + 2] = cb * cb * s; continue;
      }
      const u = y + D - TILT * rf, typ = layerAt(u), nz = noise[i], s = sh[i] * (1 + 0.16 * nz);
      let R, G, B;
      if (y > yS) {
        const red = clamp((yS + 6 - y) / 6, 0, 1); // grado de reducción aparente
        if (typ === 0) { R = 0.10; G = 0.10; B = 0.11; }
        else if (lyrFrac > 0.42 && lyrFrac < 0.6) { R = 0.66 + 0.14 * red; G = 0.63 + 0.14 * red; B = 0.55 + 0.17 * red; } // caliza → cal viva
        else { R = 0.55 - 0.22 * red; G = 0.27 + 0.04 * red; B = 0.18 + 0.11 * red; }
        const gl = Math.pow(clamp((y - (yS + 7)) / -7, 0, 1), 2) * 0.55 * hot;
        R = R * s + gl * 0.95; G = G * s + gl * 0.32; B = B * s + gl * 0.06;
      } else if (y > yM) {
        const f = (yS - y) / Math.max(0.2, yS - yM);
        if (typ === 0) { R = 0.22 + 0.25 * f; G = 0.10 + 0.08 * f; B = 0.05; } // ventanas de coque
        else if (lyrFrac > 0.42 && lyrFrac < 0.6) { R = 1.0; G = 0.82; B = 0.45; } // escoria primaria
        else { R = 0.78 + 0.22 * f; G = 0.36 + 0.30 * f; B = 0.08 + 0.12 * f; } // mineral ablandado → fundido
        R *= (0.55 + 0.45 * hot) * (0.9 + 0.1 * nz); G *= (0.55 + 0.45 * hot) * (0.9 + 0.1 * nz); B *= (0.55 + 0.45 * hot);
      } else {
        // zona de goteo / coque activo / hombre muerto
        const dead = rf < 0.62 && y < 12.5 ? 1 : 0;
        const gl = (dead ? 0.22 : 0.42) * hot;
        R = 0.12 * s + gl * (0.85 + 0.3 * nz); G = 0.08 * s + gl * (0.30 + 0.12 * nz); B = 0.06 * s + gl * 0.05;
        const rw = Math.exp(-((y - 10.5) * (y - 10.5)) / 0.9 - ((1 - rf) * (1 - rf)) / 0.02) * comb * rwOn;
        R += rw; G += rw * 0.78; B += rw * 0.38;
      }
      // sRGB aproximado → lineal (los colores de vértice se interpretan lineales)
      col[i3] = R * R; col[i3 + 1] = G * G; col[i3 + 2] = B * B;
    }
    C.aP.needsUpdate = true; C.aC.needsUpdate = true;
  }

  // ==================================================================== CARGA (skips, campanas, trozos)
  const skips = Array.isArray(parts.skips) ? parts.skips : [];
  const skipPose = (i, t) => { try { if (typeof parts.skipPose === 'function') parts.skipPose(i, t); } catch (e) { /* opcional */ } };
  const bellInfo = o => {
    if (!o?.isObject3D) return null;
    const cy = Number.isFinite(o.userData?.closedY) ? o.userData.closedY : o.position.y;
    const oy = Number.isFinite(o.userData?.openY) ? o.userData.openY : cy - Math.abs(Number.isFinite(o.userData?.openOffset) ? o.userData.openOffset : 0.8);
    return { o, cy, oy };
  };
  const bellS = bellInfo(parts.bellSmall), bellL = bellInfo(parts.bellLarge);
  const setBell = (b, k) => { if (b) b.o.position.y = b.cy + (b.oy - b.cy) * sstep(0, 1, k); };
  const bellLR = (() => {
    if (!bellL) return 1.6;
    const bx = new THREE.Box3().setFromObject(bellL.o); const s = bx.getSize(V3(0, 0, 0)); return Math.max(0.6, Math.min(2.4, Math.max(s.x, s.z) / 2));
  })();

  const NCH = 120;
  const chunkGeo = new THREE.IcosahedronGeometry(0.24, 0);
  const chunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, NCH);
  chunks.name = 'carga.trozos'; chunks.frustumCulled = false; chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const chP = new Float32Array(NCH * 3), chV = new Float32Array(NCH * 3), chF = new Float32Array(NCH), chL = new Float32Array(NCH);
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), EU = new THREE.Euler(), VS = V3(1, 1, 1), VT = V3(0, 0, 0), VZ = V3(0, 0, 0);
  const COL_COKE = new THREE.Color(0x1d1d20), COL_ORE = new THREE.Color(0x8a4a30), COL_FLUX = new THREE.Color(0xd8d3c2), TMPC = new THREE.Color();
  M4.makeScale(0, 0, 0);
  for (let i = 0; i < NCH; i++) { chunks.setMatrixAt(i, M4); chunks.setColorAt(i, COL_COKE); }
  root.add(chunks);
  let chNext = 0, chAny = false;
  function burst(n, type, from, rad, toY, vy, to) {
    for (let k = 0; k < n; k++) {
      const i = chNext; chNext = (chNext + 1) % NCH;
      const a = Math.random() * Math.PI * 2, r = rad * Math.sqrt(Math.random());
      chP[i * 3] = from.x + Math.cos(a) * r; chP[i * 3 + 1] = from.y + rnd(-0.3, 0.3); chP[i * 3 + 2] = from.z + Math.sin(a) * r;
      chV[i * 3] = Math.cos(a) * rnd(0, 1.2); chV[i * 3 + 1] = vy + rnd(-0.6, 0.6); chV[i * 3 + 2] = Math.sin(a) * rnd(0, 1.2);
      if (to) { const k = rnd(0.9, 1.3); chV[i * 3] += (to.x - from.x) * k; chV[i * 3 + 2] += (to.z - from.z) * k; }
      chF[i] = toY; chL[i] = 4;
      chunks.setColorAt(i, type === 0 ? COL_COKE : (Math.random() < 0.22 ? COL_FLUX : COL_ORE));
    }
    chunks.instanceColor.needsUpdate = true; chAny = true;
  }
  function updateChunks(dt) {
    if (!chAny) return;
    let any = false;
    for (let i = 0; i < NCH; i++) {
      if (chL[i] <= 0) continue;
      const i3 = i * 3;
      chL[i] -= dt; chV[i3 + 1] -= 9.8 * dt;
      chP[i3] += chV[i3] * dt; chP[i3 + 1] += chV[i3 + 1] * dt; chP[i3 + 2] += chV[i3 + 2] * dt;
      if (chP[i3 + 1] < chF[i] || chL[i] <= 0) { chL[i] = 0; M4.makeScale(0, 0, 0); chunks.setMatrixAt(i, M4); continue; }
      any = true;
      EU.set(chL[i] * 3 + i, chL[i] * 2, i); Q.setFromEuler(EU); VT.set(chP[i3], chP[i3 + 1], chP[i3 + 2]);
      const sc = 0.7 + (i % 5) * 0.15; VS.set(sc, sc * 0.8, sc);
      M4.compose(VT, Q, VS); chunks.setMatrixAt(i, M4);
    }
    chunks.instanceMatrix.needsUpdate = true;
    if (!any) chAny = false;
  }

  // máquina de estados de carga
  const CH = { phase: 'idle', t: 0, skip: 0, type: 0, skipT: [0, 1] };
  const CH_DUR = { up: 6.0, dump: 1.6, sOpen: 1.0, sHold: 1.0, sClose: 0.9, lOpen: 1.0, lHold: 1.3, lClose: 0.9 };
  const setSkips = () => { skipPose(0, CH.skipT[0]); skipPose(1, CH.skipT[1]); };
  setSkips(); setBell(bellS, 0); setBell(bellL, 0);
  function chargeUpdate(dt) {
    const on = V.charge;
    CH.t += dt;
    const ph = CH.phase, d = CH_DUR[ph];
    const go = (p, msg) => { CH.phase = p; CH.t = 0; if (msg) emit('step', 'charge', msg); };
    switch (ph) {
      case 'idle':
        if (on && S.level < 30.55) { CH.type = S.nextType; go('up', CH.type ? 'Skip con mineral/sinter + fundente sube por el puente' : 'Skip con coque sube por el puente'); }
        break;
      case 'up': {
        const k = sstep(0, 1, CH.t / d) * 0.93; CH.skipT[CH.skip] = k; CH.skipT[CH.skip ^ 1] = 1 - k; setSkips();
        if (CH.t >= d) go('dump', 'La vagoneta vuelca en la tolva receptora');
        break;
      }
      case 'dump': {
        const k = 0.93 + 0.07 * sstep(0, 0.4, CH.t / d); CH.skipT[CH.skip] = k; CH.skipT[CH.skip ^ 1] = 1 - k; setSkips();
        if (CH.t > 0.45 && CH.t - dt <= 0.45) burst(26, CH.type, VT.copy(P.skipTop).lerp(P.hopperDump, 0.45).add(VZ.set(0, 0.7, 0)), 0.45, P.hopperDump.y - 1.6, 2.0, P.hopperDump);
        if (CH.t >= d) go('sOpen', 'Abre la campana pequeña (la grande sigue cerrada: cierre de gas)');
        break;
      }
      case 'sOpen': setBell(bellS, CH.t / d); if (CH.t >= d) { go('sHold'); burst(24, CH.type, P.bellSmall, 1.0, P.bellLarge.y + 0.3, -1); } break;
      case 'sHold': if (CH.t >= d) go('sClose'); break;
      case 'sClose': setBell(bellS, 1 - CH.t / d); if (CH.t >= d) { setBell(bellS, 0); go('lOpen', 'Cierra la pequeña; abre la campana grande'); } break;
      case 'lOpen': setBell(bellL, CH.t / d); if (CH.t >= d) { go('lHold'); burst(40, CH.type, P.bellLarge, bellLR + 0.2, S.level - 0.1, -1); } break;
      case 'lHold':
        if (CH.t >= 0.55 && CH.t - dt < 0.55) { addLayer(CH.type); S.nextType = CH.type ^ 1; emit('step', 'charge', CH.type ? 'Nueva capa de mineral + fundente en el tragante' : 'Nueva capa de coque en el tragante'); }
        if (CH.t >= d) go('lClose');
        break;
      case 'lClose': setBell(bellL, 1 - CH.t / d); if (CH.t >= d) { setBell(bellL, 0); CH.skip ^= 1; go('idle'); } break;
    }
  }

  // ==================================================================== VIENTO CALIENTE
  const blastPaths = [0, 1, 2].map(i => {
    const b = stoveBase[i], t = stoveTop[i], hm = P.hotMain, x0 = b.x, z = b.z, yDome = t.y - 2.8;
    const pts = [V3(x0 + 1.5, b.y + 0.8, z), V3(x0 + 1.5, yDome, z), V3(x0, t.y - 1.3, z), V3(x0 - 2.1, yDome, z), V3(x0 - 2.1, hm.y, z),
      V3(hm.x, hm.y, z), V3(hm.x, hm.y, hm.z), V3(P.hotRiser.x, hm.y, P.hotRiser.z), P.hotRiser.clone(), P.bustleRing.clone()];
    const p = mkPath(pts); p.knee = (p.cum[2]) / p.len; return p;
  });
  const ringA0 = Math.atan2(P.bustleRing.z - P.bustleCenter.z, P.bustleRing.x - P.bustleCenter.x);
  const ringPaths = tuyTip.map((tip, k) => {
    const a = tuyAng[k], pts = arcPts(ringR, ringY, ringA0, a);
    const rTip = Math.hypot(tip.x, tip.z);
    pts.push(polar(ringR - 0.2, a, ringY - 0.9), polar(Math.max(rTip + 3.4, 7.9), a, 13.5), polar(rTip + 1.6, a, tip.y + 0.05), tip.clone());
    return mkPath(pts);
  });
  const fBlast = new Flow({ name: 'viento', n: 520, paths: blastPaths, speed: 14, size: 0.42, jit: 0.45, c0: [0.35, 0.55, 1.0], c1: [1.0, 0.55, 0.22], depthTest: false, choose: () => S.stoveBlow, fadeIn: 2, fadeOut: 0.5, alpha: 0.85, renderOrder: 8 });
  const fRing = new Flow({ name: 'anillo', n: 640, paths: ringPaths, speed: 9, size: 0.3, jit: 0.3, c0: [1.0, 0.6, 0.25], depthTest: false, fadeIn: 0.5, fadeOut: 0.6, alpha: 0.85, renderOrder: 8 });

  // ==================================================================== COMBUSTIÓN EN TOBERAS
  const flameGeo = new THREE.ConeGeometry(0.5, 1.9, 12, 3, true);
  flameGeo.translate(0, -0.95, 0); flameGeo.rotateX(-Math.PI / 2); // base en el origen, punta hacia +Z
  {
    const p = flameGeo.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const f = clamp(p.getZ(i) / 1.9, 0, 1); c[i * 3] = 1 - 0.1 * f; c[i * 3 + 1] = 0.85 - 0.6 * f; c[i * 3 + 2] = 0.55 - 0.5 * f; const a = 1 - f; c[i * 3] *= a; c[i * 3 + 1] *= a; c[i * 3 + 2] *= a; }
    flameGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const flames = new THREE.InstancedMesh(flameGeo, flameMat, 18); flames.name = 'raceway.llamas'; flames.frustumCulled = false; flames.visible = false;
  flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cavGeo = new THREE.SphereGeometry(1, 14, 10);
  const cavMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const cavs = new THREE.InstancedMesh(cavGeo, cavMat, 18); cavs.name = 'raceway.cavidad'; cavs.frustumCulled = false; cavs.visible = false;
  cavs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  innerG.add(flames, cavs);
  const tuyQ = tuyDir.map(d => new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), d));
  let flameAmp = 0;
  function updateFlames(t) {
    if (flameAmp < 0.01) { flames.visible = cavs.visible = false; return; }
    flames.visible = cavs.visible = true;
    for (let k = 0; k < 18; k++) {
      const fl = 0.82 + 0.18 * Math.sin(t * 17 + k * 2.1) * Math.sin(t * 7.3 + k);
      const L = flameAmp * fl, tip = tuyTip[k], d = tuyDir[k];
      VS.set(0.55 + 0.45 * flameAmp, 0.55 + 0.45 * flameAmp, L); VT.copy(tip);
      M4.compose(VT, tuyQ[k], VS); flames.setMatrixAt(k, M4);
      const cs = 0.25 + 0.95 * flameAmp * (0.9 + 0.1 * fl);
      VT.set(tip.x + d.x * 1.1 * cs, tip.y + 0.15, tip.z + d.z * 1.1 * cs); VS.set(cs * 1.25, cs * 0.85, cs * 1.25);
      M4.compose(VT, tuyQ[k], VS); cavs.setMatrixAt(k, M4);
    }
    flames.instanceMatrix.needsUpdate = true; cavs.instanceMatrix.needsUpdate = true;
    cavMat.opacity = 0.12 + 0.28 * flameAmp;
  }
  const bSparks = new Ballistic({
    name: 'chispas', n: 300, rate: 260, size: 0.11, gravity: -2.5, drag: 1.2, fade: 0.25, parent: innerG,
    spawn(i, pos, vel, rgb, B) {
      const k = (Math.random() * 18) | 0, tip = tuyTip[k], d = tuyDir[k], i3 = i * 3, sp = rnd(2.5, 6);
      pos[i3] = tip.x + d.x * 0.3; pos[i3 + 1] = tip.y + rnd(-0.1, 0.2); pos[i3 + 2] = tip.z + d.z * 0.3;
      vel[i3] = d.x * sp + rnd(-1, 1); vel[i3 + 1] = rnd(0.5, 3); vel[i3 + 2] = d.z * sp + rnd(-1, 1);
      rgb[i3] = 1; rgb[i3 + 1] = rnd(0.7, 0.95); rgb[i3 + 2] = rnd(0.3, 0.6); B.ttl[i] = rnd(0.35, 0.8);
    },
  });

  // ==================================================================== GAS DE ALTO HORNO
  const upDist = u => { let a = Math.atan2(u.z, u.x) - CUTM; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return Math.abs(a); };
  let upQ = 0; for (let i = 1; i < 4; i++) if (upDist(uptake[i]) < upDist(uptake[upQ])) upQ = i;
  const shaftPaths = [];
  for (let k = 0; k < 22; k++) {
    const th = CUT0 + (CUT1 - CUT0) * (0.08 + 0.84 * ((k * 0.618) % 1)), rf0 = 0.12 + 0.8 * ((k * 0.381 + 0.2) % 1);
    const pts = [polar(RINT(10.6) * 0.9, th, 10.6), polar(RINT(12) * Math.min(0.92, rf0 + 0.25), th, 12.2)];
    for (let y = 14; y <= 30; y += 2) { const w = 0.05 * Math.sin(y * 1.3 + k); pts.push(polar(RINT(y) * clamp(rf0 + w, 0.08, 0.92), th, y)); }
    const u = uptake[upQ], ua = Math.atan2(u.z, u.x);
    pts.push(polar(RINT(32) * 0.6, (th + ua) / 2, 32.2), polar(Math.hypot(u.x, u.z) * 0.85, ua, 34.2));
    shaftPaths.push(mkPath(pts));
  }
  const fShaft = new Flow({ name: 'gas.cuba', n: 1100, paths: shaftPaths, speed: 3.2, size: 0.26, jit: 0.35, c0: [1.0, 0.6, 0.3], c1: [0.35, 0.6, 1.0], fadeIn: 1.2, fadeOut: 1.5, alpha: 0.5, parent: innerG, renderOrder: 7 });
  fShaft.paths.forEach(p => { p.knee = 1; });
  const dcx = P.dcTop.x, dcz = P.dcTop.z;
  const cleanBottom = P.cleanGasDown ? P.cleanGasDown.clone() : V3(P.dcOut.x, 3.2, P.dcOut.z - 7.8);
  const topPaths = uptake.map(u => {
    const ua = Math.atan2(u.z, u.x), Ru = Math.hypot(u.x, u.z), pts = [polar(Ru * 0.85, ua, 34.2), polar(Ru, ua, 35.5), u.clone()];
    const a0 = Math.atan2(P.downcomerTop.z, P.downcomerTop.x);
    let d = a0 - ua; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    for (let s = 1; s <= 4; s++) pts.push(polar(Ru, ua + d * s / 4, u.y));
    pts.push(P.downcomerTop.clone());
    if (Math.abs(P.downcomerTop.y - P.dcTop.y) > 1.5) pts.push(V3(dcx, P.downcomerTop.y, dcz));
    pts.push(P.dcTop.clone(), V3(dcx, 18, dcz), V3(dcx + 0.8, 22, dcz - 1.5), P.dcOut.clone(),
      V3(cleanBottom.x, P.dcOut.y, cleanBottom.z), cleanBottom.clone());
    return mkPath(pts);
  });
  const fTop = new Flow({ name: 'gas.bajantes', n: 760, paths: topPaths, speed: 11, size: 0.36, jit: 0.45, c0: [0.5, 0.78, 1.0], c1: [0.55, 0.95, 0.85], depthTest: false, fadeIn: 1.5, fadeOut: 1, alpha: 0.7, renderOrder: 8 });
  const cleanPaths = [0, 1, 2].map(i => {
    const b = stoveBase[i], e = P.cleanGasEnd;
    const pts = [cleanBottom.clone()];
    if (e) pts.push(e.clone());
    else pts.push(V3(b.x + 6.5, cleanBottom.y, cleanBottom.z));
    pts.push(V3(b.x + 6.5, cleanBottom.y, b.z), V3(b.x + 4.2, b.y + 1.0, b.z), V3(b.x - 2.1, b.y + 1.0, b.z));
    return mkPath(pts);
  });
  const fClean = new Flow({ name: 'gas.limpio', n: 300, paths: cleanPaths, speed: 9, size: 0.34, jit: 0.3, c0: [0.55, 0.95, 0.85], depthTest: false, fadeIn: 1, fadeOut: 1, alpha: 0.6, renderOrder: 8,
    choose: () => { const b = S.stoveBlow; const o = (b + 1 + ((Math.random() * 2) | 0)) % 3; return o; } });
  const bDust = new Ballistic({
    name: 'polvo', n: 260, rate: 90, size: 0.16, gravity: -1.2, drag: 0.6, fade: 0.5, depthTest: false, normal: true, alpha: 0.85, renderOrder: 9,
    spawn(i, pos, vel, rgb, B) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 3.4, i3 = i * 3;
      pos[i3] = dcx + Math.cos(a) * r; pos[i3 + 1] = rnd(16, 26); pos[i3 + 2] = dcz + Math.sin(a) * r;
      vel[i3] = -Math.cos(a) * 0.35; vel[i3 + 1] = rnd(-1.5, -0.5); vel[i3 + 2] = -Math.sin(a) * 0.35;
      const c = rnd(0.35, 0.5); rgb[i3] = c; rgb[i3 + 1] = c * 0.8; rgb[i3 + 2] = c * 0.62; B.ttl[i] = 9; B.floor[i] = P.dcBottom.y + 1.0;
    },
  });

  // ==================================================================== GOTEO (metal / escoria)
  const bDrips = new Ballistic({
    name: 'goteo', n: 360, rate: 160, size: 0.13, gravity: -7, fade: 0.1, parent: innerG,
    spawn(i, pos, vel, rgb, B) {
      const th = CUT0 + (CUT1 - CUT0) * rnd(0.05, 0.95), rf = Math.sqrt(Math.random()) * 0.9;
      const yS = ySoft(rf), y = yMeltOf(rf, yS) + rnd(-0.3, 0.3), r = RINT(y) * rf * 0.97, i3 = i * 3;
      pos[i3] = r * Math.cos(th); pos[i3 + 1] = y; pos[i3 + 2] = r * Math.sin(th);
      vel[i3] = 0; vel[i3 + 1] = rnd(-1.5, -0.5); vel[i3 + 2] = 0;
      if (Math.random() < 0.7) { rgb[i3] = 1; rgb[i3 + 1] = rnd(0.5, 0.65); rgb[i3 + 2] = 0.15; } else { rgb[i3] = 1; rgb[i3 + 1] = 0.85; rgb[i3 + 2] = 0.45; }
      B.ttl[i] = 6; B.floor[i] = Y_HEARTH + S.ironH + S.slagH;
    },
  });

  // ==================================================================== ESTUFAS
  const stoveFlowPaths = [0, 1, 2].map(i => {
    const b = stoveBase[i], t = stoveTop[i], x0 = b.x, z = b.z, yD = t.y - 2.8, ch = P.chimneyTop;
    const yF = b.y + 1.2;
    return mkPath([V3(x0 - 2.1, b.y + 1.0, z), V3(x0 - 2.1, yD, z), V3(x0, t.y - 1.3, z), V3(x0 + 1.5, yD, z), V3(x0 + 1.5, yF, z),
      V3(x0 - 4.0, yF, z), V3(ch.x + 4, yF, z), V3(ch.x + 4, yF, ch.z), V3(ch.x, yF, ch.z), V3(ch.x, ch.y - 0.5, ch.z)], 0);
  });
  stoveFlowPaths.forEach(p => { p.knee = p.cum[3] / p.len; });
  const fStove = new Flow({ name: 'estufas.humos', n: 420, paths: stoveFlowPaths, speed: 8, size: 0.38, jit: 0.5, c0: [1.0, 0.62, 0.2], c1: [0.55, 0.42, 0.38], depthTest: false, fadeIn: 1, fadeOut: 2.5, alpha: 0.75, renderOrder: 8,
    choose: () => { const b = S.stoveBlow; return (b + 1 + ((Math.random() * 2) | 0)) % 3; } });
  const bSmoke = new Ballistic({
    name: 'chimenea', n: 140, rate: 9, size: 2.6, map: smokeTex, gravity: 0.4, drag: 0.15, fade: 3, normal: true, alpha: 0.32, renderOrder: 4,
    spawn(i, pos, vel, rgb, B) {
      const c = P.chimneyTop, i3 = i * 3; pos[i3] = c.x + rnd(-0.6, 0.6); pos[i3 + 1] = c.y + 0.3; pos[i3 + 2] = c.z + rnd(-0.6, 0.6);
      vel[i3] = rnd(0.6, 1.4); vel[i3 + 1] = rnd(1.5, 2.5); vel[i3 + 2] = rnd(-0.4, 0.4);
      const g = rnd(0.62, 0.78); rgb[i3] = g; rgb[i3 + 1] = g; rgb[i3 + 2] = g * 1.02; B.ttl[i] = rnd(8, 12);
    },
  });

  // carteles de estado de estufas
  const mkLabel = (w, h, pw) => {
    const cv = mkCv(w, h), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; disposables.push(tex);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw * h / w), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = 20; return { cv, g: cv.getContext('2d'), tex, m };
  };
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const FONT = 'system-ui, sans-serif';
  const stoveLbl = [0, 1, 2].map(i => { const L = mkLabel(320, 120, 3.6); L.m.position.copy(stoveTop[i]).add(V3(0, 3.2, 0)); L.m.visible = false; root.add(L.m); L.last = ''; return L; });
  const PH_TXT = { gas: ['CALENTANDO', '#ffb347', 'gas de alto horno + aire'], blast: ['SOPLANDO', '#9cc6ff', 'viento caliente al horno'], idle: ['EN ESPERA', '#8fa0c0', 'ciclo detenido'], change: ['CAMBIO', '#ffd34d', 'conmutando válvulas'] };
  function drawStoveLbl(i) {
    const L = stoveLbl[i], ph = S.stovePh[i], key = ph + '|' + Math.round(S.stoveH[i] * 20);
    if (L.last === key) return; L.last = key;
    const g = L.g, [txt, c, sub] = PH_TXT[ph] || PH_TXT.idle;
    g.clearRect(0, 0, 320, 120); rr(g, 2, 2, 316, 116, 18); g.fillStyle = 'rgba(16,21,34,.94)'; g.fill(); g.lineWidth = 3; g.strokeStyle = c; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffd34d'; g.font = 'bold 26px ' + FONT; g.fillText('Estufa ' + (i + 1), 160, 34);
    g.fillStyle = c; g.font = 'bold 34px ' + FONT; g.fillText(txt, 160, 72);
    // barra de calor del damero
    rr(g, 30, 86, 260, 18, 8); g.fillStyle = '#1b2233'; g.fill();
    rr(g, 30, 86, Math.max(16, 260 * S.stoveH[i]), 18, 8); g.fillStyle = ph === 'blast' ? '#3c8cff' : '#e0702a'; g.fill();
    g.fillStyle = '#c9d4ea'; g.font = '14px ' + FONT; g.fillText(sub, 160, 116);
    L.tex.needsUpdate = true;
  }

  // ==================================================================== COLADA
  const torp = parts.torpedo?.isObject3D ? parts.torpedo : null;
  const torpBase = torp ? torp.position.clone() : null;
  const tAx = P.torpEnd.clone().sub(P.torpStart), tLen = Math.max(0.1, tAx.length()); tAx.normalize();
  let torpTopY = P.torpStart.y + 1.5, torpOff = V3(0, 0, 0);
  if (P.torpMouth) { torpTopY = P.torpMouth.y; torpOff.set(P.torpMouth.x - P.torpStart.x, 0, P.torpMouth.z - P.torpStart.z); }
  else if (torp) {
    torp.updateWorldMatrix(true, true);
    const bx = new THREE.Box3().setFromObject(torp);
    if (!bx.isEmpty()) { torpTopY = bx.max.y; const c = bx.getCenter(V3(0, 0, 0)); torpOff.set(c.x - P.torpStart.x, 0, c.z - P.torpStart.z); }
  }
  const torpPosAt = (s, out) => out.copy(P.torpStart).addScaledVector(tAx, s * tLen);
  const projS = p => clamp((p.x - P.torpStart.x) * tAx.x + (p.z - P.torpStart.z) * tAx.z, 0, tLen) / tLen;
  function tapCurve(mouth, end, dropY, land) {
    const out = V3(end.x - mouth.x, 0, end.z - mouth.z).normalize();
    const p4 = end.clone().addScaledVector(out, 0.45); p4.y -= 0.2;
    const pts = [mouth.clone(), mouth.clone().addScaledVector(out, 0.55).add(V3(0, -0.12, 0)), mouth.clone().addScaledVector(out, 1.3).add(V3(0, -0.65, 0)),
      mouth.clone().lerp(end, 0.55).add(V3(0, -0.6 * 0.5 + 0.0, 0)), end.clone().add(V3(0, 0.05, 0)), p4, V3(p4.x, p4.y - 0.5, p4.z), land ? V3(land.x, dropY, land.z) : V3(p4.x, dropY, p4.z)];
    pts[3].y = (pts[2].y + end.y) / 2;
    // densifica la polilínea para que la spline no se pase en los quiebres (caída vertical)
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 6; k++) dense.push(pts[i].clone().lerp(pts[i + 1], k / 6));
    dense.push(pts[pts.length - 1].clone());
    return { curve: new THREE.CatmullRomCurve3(dense, false, 'centripetal'), p4 };
  }
  const tapS = [0, 1].map(i => projS(tapCurve(P.tap[i], P.trough[i], 0).p4));
  const mkStream = (mouth, end, dropY, rad, color, land) => {
    const { curve } = tapCurve(mouth, end, dropY, land);
    const SEG = 96, RS = 8, geo = new THREE.TubeGeometry(curve, SEG, rad, RS, false);
    const mat = new THREE.MeshBasicMaterial({ color, fog: false });
    const m = new THREE.Mesh(geo, mat); m.visible = false; m.frustumCulled = false; root.add(m);
    // halo aditivo (misma curva, radio mayor) para el brillo incandescente
    const hgeo = new THREE.TubeGeometry(curve, SEG, rad * 2.4, RS, false);
    const hm = new THREE.Mesh(hgeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    hm.visible = false; hm.frustumCulled = false; root.add(hm);
    const samp = new Float32Array((SEG + 1) * 3); const tv = V3(0, 0, 0);
    for (let i = 0; i <= SEG; i++) { curve.getPointAt(i / SEG, tv); samp[i * 3] = tv.x; samp[i * 3 + 1] = tv.y; samp[i * 3 + 2] = tv.z; }
    return { m, geo, hm, hgeo, SEG, RS, samp, mat, head: 0, tail: 0 };
  };
  const torpMouthY = () => torpTopY + 0.1;
  const streams = [
    mkStream(P.tap[0], P.trough[0], torpMouthY(), 0.2, 0xffa040),
    mkStream(P.tap[1], P.trough[1], torpMouthY(), 0.2, 0xffa040),
    P.slagPit && Math.hypot(P.slagPit.x - P.slagEnd.x, P.slagPit.z - P.slagEnd.z) < 4
      ? mkStream(P.slagNotch, P.slagEnd, P.slagPit.y + 0.2, 0.15, 0xffd27a, P.slagPit)
      : mkStream(P.slagNotch, P.slagEnd, Math.max(1.7, P.slagEnd.y - 2.6), 0.15, 0xffd27a),
  ];
  const setStream = (st, head, tail) => {
    st.head = head; st.tail = tail;
    const a = Math.floor(clamp(tail, 0, 1) * st.SEG), b = Math.ceil(clamp(head, 0, 1) * st.SEG);
    st.m.visible = st.hm.visible = b > a;
    st.geo.setDrawRange(a * st.RS * 6, Math.max(0, b - a) * st.RS * 6);
    st.hgeo.setDrawRange(a * st.RS * 6, Math.max(0, b - a) * st.RS * 6);
  };
  const bTapSp = new Ballistic({
    name: 'colada', n: 380, rate: 220, size: 0.12, gravity: -6, drag: 0.4, fade: 0.2,
    spawn(i, pos, vel, rgb, B) {
      const st = streams[B.src] || streams[0], lo = st.tail, hi = st.head;
      const u = lo + Math.random() * Math.max(0, hi - lo), k = Math.min(st.SEG - 1, Math.floor(u * st.SEG)), i3 = i * 3;
      pos[i3] = st.samp[k * 3] + rnd(-0.15, 0.15); pos[i3 + 1] = st.samp[k * 3 + 1] + 0.12; pos[i3 + 2] = st.samp[k * 3 + 2] + rnd(-0.15, 0.15);
      vel[i3] = rnd(-1.2, 1.2); vel[i3 + 1] = rnd(1, 3.5); vel[i3 + 2] = rnd(-1.2, 1.2);
      if (B.src === 2) { rgb[i3] = 1; rgb[i3 + 1] = 0.85; rgb[i3 + 2] = 0.5; } else { rgb[i3] = 1; rgb[i3 + 1] = rnd(0.6, 0.85); rgb[i3 + 2] = rnd(0.2, 0.45); }
      B.ttl[i] = rnd(0.3, 0.7);
    },
  });
  bTapSp.src = 0;
  // tapones de arcilla (cañón de tapón) en las 3 bocas
  const plugGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.45, 10); plugGeo.rotateX(Math.PI / 2);
  const plugs = new THREE.InstancedMesh(plugGeo, new THREE.MeshLambertMaterial({ color: 0x5b4636 }), 3); plugs.name = 'colada.tapones'; plugs.frustumCulled = false;
  const plugPts = [P.tap[0], P.tap[1], P.slagNotch], plugQ = plugPts.map(p => new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(p.x, 0, p.z).normalize()));
  const plugK = [1, 1, 1];
  const setPlug = (i, k) => { plugK[i] = k; VS.setScalar(Math.max(1e-4, k)); M4.compose(plugPts[i], plugQ[i], VS); plugs.setMatrixAt(i, M4); plugs.instanceMatrix.needsUpdate = true; };
  for (let i = 0; i < 3; i++) setPlug(i, 1);
  root.add(plugs);
  // brillo en la boca del torpedo
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const torpGlow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMat); torpGlow.scale.set(1, 0.3, 1); torpGlow.visible = false; root.add(torpGlow);
  const TP = { phase: 'idle', t: 0, ts: 0, tsTarget: 0, tWait: 0, stream: null };
  function setTorp(s) {
    TP.ts = s;
    if (torp && torpBase) { torpPosAt(s, VT); torp.position.set(torpBase.x + VT.x - P.torpStart.x, torpBase.y, torpBase.z + VT.z - P.torpStart.z); }
  }
  function tapUpdate(dt) {
    // torpedo hacia su objetivo
    const dv = TP.tsTarget - TP.ts, vmax = 2.2 / tLen * dt;
    if (Math.abs(dv) > 1e-4) setTorp(TP.ts + clamp(dv, -vmax, vmax));
    if (TP.phase === 'idle' && TP.ts > 0.999 && TP.tsTarget >= 1) { TP.tWait += dt; if (TP.tWait > 2.5) { S.torpFill = 0; TP.tsTarget = 0; TP.tWait = 0; emit('step', 'tap', 'Vuelve una cuchara torpedo vacía'); } }
    TP.t += dt;
    const h = S.hole, st = streams[h], ss = streams[2];
    const go = (p, msg) => { TP.phase = p; TP.t = 0; if (msg) emit('step', 'tap', msg); };
    switch (TP.phase) {
      case 'idle': break;
      case 'move':
        S.tapStatus = 'idle';
        TP.tsTarget = tapS[h];
        if (Math.abs(TP.ts - tapS[h]) < 0.003) go('drill', `Se perfora la piquera de arrabio ${h + 1}`);
        break;
      case 'drill': setPlug(h, 1 - TP.t / 1.5); if (TP.t >= 1.5) { setPlug(h, 0); go('iron', 'Colada de arrabio: el chorro corre por el canal hacia la cuchara torpedo'); } break;
      case 'iron': {
        S.tapStatus = 'iron';
        setStream(st, Math.min(1, TP.t / 2.2), 0);
        if (TP.t > 1.8) { const dh = Math.min(S.ironH - 0.35, 0.055 * dt); if (dh > 0) { S.ironH -= dh; S.torpFill = Math.min(1, S.torpFill + dh * 0.62); } }
        bTapSp.src = h; bTapSp.rate = 1;
        if (S.ironH <= 0.5 || S.torpFill >= 0.995 || !V.tap) go('plugIron', 'El cañón de tapón cierra la piquera con masa refractaria');
        break;
      }
      case 'plugIron':
        S.tapStatus = 'plug';
        setStream(st, 1, Math.min(1, TP.t / 1.8)); setPlug(h, Math.min(1, TP.t / 1.2)); bTapSp.rate = TP.t < 1.2 ? 0.5 : 0;
        if (TP.t >= 2) {
          setStream(st, 0, 0); TP.tsTarget = 1; emit('step', 'tap', `Cuchara torpedo llena al ${Math.round(S.torpFill * 100)} %: parte hacia la acería`);
          if (V.tap) go('slag', 'Se abre la piquera de escoria'); else go('end');
        }
        break;
      case 'slag':
        S.tapStatus = 'slag';
        setPlug(2, Math.max(0, 1 - TP.t / 0.8));
        setStream(ss, Math.min(1, TP.t / 2.2), 0); bTapSp.src = 2; bTapSp.rate = 0.7;
        if (TP.t > 1.5) S.slagH = Math.max(0.18, S.slagH - 0.04 * dt);
        if (S.slagH <= 0.2 || !V.tap) go('plugSlag', 'Se tapona la piquera de escoria');
        break;
      case 'plugSlag':
        S.tapStatus = 'plug';
        setStream(ss, 1, Math.min(1, TP.t / 1.6)); setPlug(2, Math.min(1, TP.t / 1.0)); bTapSp.rate = 0;
        if (TP.t >= 1.8) { setStream(ss, 0, 0); go('end'); }
        break;
      case 'end':
        S.tapStatus = 'idle'; bTapSp.rate = 0; S.hole ^= 1; TP.phase = 'idle';
        emit('step', 'tap', 'Fin de la colada; la próxima usará la otra piquera');
        if (V.tap) { V.tap = false; emit('stop', 'tap'); }
        break;
    }
    // brillo de la boca del torpedo (nivel)
    const fillOn = S.torpFill > 0.01;
    torpGlow.visible = fillOn;
    if (fillOn) { torpPosAt(TP.ts, VT); torpGlow.position.set(VT.x + torpOff.x, torpTopY - 0.35 + 0.3 * S.torpFill, VT.z + torpOff.z); glowMat.opacity = 0.15 + 0.4 * S.torpFill; }
  }
  function startTap() { if (TP.phase === 'idle') { TP.phase = 'move'; TP.t = 0; if (S.torpFill > 0.6) { S.torpFill = 0; } emit('step', 'tap', 'La cuchara torpedo se posiciona bajo el pico del canal'); } }

  // ==================================================================== MAPA TÉRMICO Y REACCIONES (carteles)
  const signs = [];
  function mkSign(title, lines, temp, w = 3.8) {
    const W = 768, H = 384, L = mkLabel(W, H, w), g = L.g;
    rr(g, 4, 4, W - 8, H - 8, 34); g.fillStyle = 'rgba(16,21,34,.94)'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#46526e'; g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffd34d'; g.font = 'bold 46px ' + FONT; g.fillText(title, 36, 76, W - 72);
    if (temp) { g.fillStyle = '#c9d4ea'; g.font = 'bold 32px ' + FONT; g.fillText(temp, 36, 122, W - 72); }
    g.fillStyle = '#34405c'; g.fillRect(36, 140, W - 72, 3);
    g.fillStyle = '#eef3ff'; g.font = '40px ' + FONT;
    lines.forEach((l, i) => g.fillText(l, 36, 200 + i * 58, W - 72));
    L.tex.needsUpdate = true; return L;
  }
  const RX = content?.REACTIONS || [
    { y: 29.2, title: 'Tragante: secado', temp: 'Gas de salida 150–250 °C', lines: ['H₂O(l) → H₂O(g)', '3 Fe₂O₃ + CO → 2 Fe₃O₄ + CO₂'] },
    { y: 24.6, title: 'Reducción indirecta', temp: '500–900 °C', lines: ['Fe₃O₄ + CO → 3 FeO + CO₂', 'FeO + CO → Fe + CO₂'] },
    { y: 20.0, title: 'Reserva térmica', temp: '900–1000 °C', lines: ['CaCO₃ → CaO + CO₂ (calcinación)', 'C + CO₂ ⇌ 2 CO (Boudouard)'] },
    { y: 15.4, title: 'Zona cohesiva', temp: '1100–1400 °C · ablandamiento y fusión', lines: ['FeO + C → Fe + CO (reducción directa)', 'CaO + SiO₂ → CaO·SiO₂ (escoria)'] },
    { y: 10.8, title: 'Toberas · raceway', temp: '2000–2300 °C', lines: ['C + O₂ → CO₂ ;  CO₂ + C → 2 CO', 'Neto: 2 C + O₂ → 2 CO'] },
    { y: 6.6, title: 'Crisol · desulfuración', temp: 'Arrabio 1480–1520 °C · 4–4,5 % C', lines: ['FeS + CaO + C → Fe + CaS + CO', 'El S pasa a la escoria básica'] },
  ];
  const SIGN_TH = CUT0 + (CUT1 - CUT0) * 0.42;
  const leadPos = new Float32Array(RX.length * 6);
  RX.forEach((rx, i) => {
    const L = mkSign(rx.title, rx.lines, rx.temp);
    const r = Math.max(rextF(rx.y) + 3.4, 9.6);
    L.m.position.copy(polar(r, SIGN_TH, rx.y)); L.m.visible = false; root.add(L.m);
    const tgt = rx.y < 9 ? polar(RH * 0.55, CUT0 + 0.02, Y_HEARTH + 0.9) : polar(RINT(rx.y) * 0.55, CUT0 + 0.02, rx.y);
    const from = polar(r - 1.95, SIGN_TH, rx.y);
    leadPos.set([from.x, from.y, from.z, tgt.x, tgt.y, tgt.z], i * 6);
    signs.push(L);
  });
  const leadGeo = new THREE.BufferGeometry(); leadGeo.setAttribute('position', new THREE.BufferAttribute(leadPos, 3));
  const leads = new THREE.LineSegments(leadGeo, new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.8, fog: false }));
  leads.visible = false; leads.frustumCulled = false; root.add(leads);
  // escala térmica
  const thermSign = (() => {
    const W = 320, H = 1024, L = mkLabel(W, H, 2.2), g = L.g;
    rr(g, 4, 4, W - 8, H - 8, 30); g.fillStyle = 'rgba(16,21,34,.94)'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#46526e'; g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#ffd34d'; g.font = 'bold 40px ' + FONT; g.fillText('T (°C)', W / 2, 64);
    g.fillStyle = '#c9d4ea'; g.font = '22px ' + FONT; g.fillText('interior del horno', W / 2, 96);
    const y0 = 950, y1 = 130, x = 40, w = 70;
    for (let y = y1; y <= y0; y++) { cmap(2300 * (y0 - y) / (y0 - y1)); g.fillStyle = `rgb(${(cr * 255) | 0},${(cg * 255) | 0},${(cb * 255) | 0})`; g.fillRect(x, y, w, 1.5); }
    g.strokeStyle = '#9fb3d9'; g.lineWidth = 2; g.strokeRect(x, y1, w, y0 - y1);
    g.textAlign = 'left'; g.font = 'bold 26px ' + FONT;
    for (const T of [0, 200, 500, 900, 1100, 1400, 1500, 2000, 2300]) {
      const y = y0 - (y0 - y1) * T / 2300; g.fillStyle = '#9fb3d9'; g.fillRect(x + w, y - 1, 14, 2);
      g.fillStyle = '#eef3ff'; g.fillText(String(T), x + w + 20, y + 9);
    }
    g.font = '19px ' + FONT; g.fillStyle = '#c9d4ea';
    const tag = (T, s) => { const y = y0 - (y0 - y1) * T / 2300; g.fillText(s, 200, y + 30); };
    tag(200, 'tragante'); tag(950, 'reserva'); tag(1250, 'cohesiva'); tag(2150, 'raceway');
    L.tex.needsUpdate = true;
    const th = CUT1 + 0.75; L.m.position.copy(polar(Math.max(rextF(20) + 4.5, 10), th, 20)); L.m.visible = false; root.add(L.m);
    return L;
  })();

  // ==================================================================== MATERIALES EMISIVOS
  const emis = [];
  const regMat = m => {
    if (!m || !m.emissive) return null;
    const e = { m, c0: m.emissive.clone(), i0: m.emissiveIntensity ?? 1 }; emis.push(e); return e;
  };
  const eHot = regMat(mats.hotMain), eBustle = mats.bustle === mats.hotMain ? null : regMat(mats.bustle), eTuy = regMat(mats.tuyereGlow), eShell = regMat(mats.shellHot);
  const eStove = Array.isArray(mats.stoveGlow) ? mats.stoveGlow.map(regMat) : [];
  const C_HOT = new THREE.Color(0xb8320c), C_TUY = new THREE.Color(0xd8661c), C_ST_GAS = new THREE.Color(0xff6a1a), C_ST_BL = new THREE.Color(0xffc080);
  const setEm = (e, col, k, inten) => { if (!e) return; e.m.emissive.copy(e.c0).lerp(col, clamp(k, 0, 1)); e.m.emissiveIntensity = e.i0 + inten * k; };
  const restoreMats = () => { for (const e of emis) { e.m.emissive.copy(e.c0); e.m.emissiveIntensity = e.i0; } };

  // ==================================================================== ITEMS / ESTADO
  const items = [
    { id: 'auto', label: 'Ciclo automático', short: 'Automático', sub: 'todo en secuencia', group: 'Proceso', type: 'toggle', value: false, icon: '⟳', key: '1',
      hint: 'Arranca estufas, viento, combustión, gas, carga y descenso en orden y cuela el arrabio periódicamente.' },
    { id: 'charge', label: 'Carga (skips y campanas)', short: 'Carga', sub: 'skips + doble campana', group: 'Proceso', type: 'toggle', value: false, icon: '⛏', key: '2',
      hint: 'Los skips suben por el puente, vuelcan en la tolva; campana pequeña y luego grande: capas de coque y mineral+fundente.' },
    { id: 'descent', label: 'Descenso de la carga', short: 'Descenso', sub: 'zona cohesiva', group: 'Proceso', type: 'toggle', value: false, icon: '⇣', key: '3',
      hint: 'Las capas bajan, se reducen, se ablandan y funden (zona cohesiva en V invertida); gotean arrabio y escoria al crisol.' },
    { id: 'blast', label: 'Viento caliente', short: 'Viento', sub: 'estufa → toberas', group: 'Proceso', type: 'toggle', value: false, icon: '≋', key: '4',
      hint: 'Aire a ~1150 °C: estufa en soplado → colector → bajada → anillo de viento → 18 toberas.' },
    { id: 'raceway', label: 'Combustión en toberas', short: 'Toberas', sub: 'raceway 2000 °C', group: 'Proceso', type: 'toggle', value: false, icon: '✹', key: '5',
      hint: 'Frente a cada tobera el coque arde con el viento: 2C + O₂ → 2CO, 2000–2300 °C. Sin viento no hay combustión.' },
    { id: 'gas', label: 'Gas de alto horno', short: 'Gas', sub: 'CO ascendente', group: 'Proceso', type: 'toggle', value: false, icon: '☁', key: '6',
      hint: 'El CO sube por la cuba, sale por 4 bajantes, pasa por el colector de polvo y el gas limpio va a las estufas.' },
    { id: 'tap', label: 'Colada', short: 'Colada', sub: 'arrabio y escoria', group: 'Proceso', type: 'toggle', value: false, icon: '⤵', key: '7',
      hint: 'Se perfora la piquera, el arrabio corre por el canal a la cuchara torpedo; luego la escoria por su canal. Piqueras alternadas.' },
    { id: 'stoves', label: 'Ciclo de estufas', short: 'Estufas', sub: 'Cowper ×3', group: 'Proceso', type: 'toggle', value: false, icon: '♨', key: '8',
      hint: 'Dos estufas se calientan quemando gas mientras la tercera sopla el viento caliente; rotan.' },
    { id: 'thermal', label: 'Mapa térmico', sub: 'gradiente interior', group: 'Vista', type: 'toggle', value: false, icon: '🌡', key: 't',
      hint: 'Colorea la carga por temperatura (°C) con su escala.' },
    { id: 'reactions', label: 'Reacciones por zona', sub: 'carteles', group: 'Vista', type: 'toggle', value: false, icon: '⚗', key: 'r',
      hint: 'Carteles con las reacciones químicas de cada zona del horno.' },
    { id: 'cutaway', label: 'Corte (cuarto abierto)', group: 'Vista', type: 'toggle', value: true, icon: '◔', key: 'x', hint: 'Abre un cuarto del horno para ver el interior.' },
    { id: 'xray', label: 'Rayos X', group: 'Vista', type: 'toggle', value: false, icon: '◌', key: 'z', hint: 'Chapa y ladrillo translúcidos.' },
    { id: 'timeScale', label: 'Velocidad de simulación', group: 'Sistema', type: 'slider', value: 1, min: 0.25, max: 4, step: 0.25, icon: '⏱',
      hint: 'Escala de tiempo de la animación (teclas + / −).' },
    { id: 'reset', label: 'Reiniciar proceso', group: 'Sistema', type: 'button', value: false, icon: '↺', key: 'backspace', hint: 'Vuelve todo al estado inicial.' },
  ];
  const ITEM = new Map(items.map(i => [i.id, i]));
  const V = {}; for (const it of items) V[it.id] = it.value;
  const state = {
    levelStockline: 0, burdenLayers: 0, blastTempC: 25, topGasTempC: 60, ironTempC: 1490, productionTph: 0,
    stovePhase: ['blast', 'gas', 'gas'], tapStatus: 'idle',
    ironLevel: 0, slagLevel: 0, torpedoFill: 0, heat: 0, combustion: 0, cohesiveTopY: 0, stoveHeat: [0, 0, 0], layersCharged: 0, simTime: 0,
  };

  // eventos
  const listeners = new Set();
  const evt = { type: '', id: '', detail: null };
  function emit(type, id, detail) {
    if (!listeners.size) return;
    evt.type = type; evt.id = id; evt.detail = detail ?? null;
    for (const cb of listeners) { try { cb({ type, id, detail: detail ?? null }); } catch (e) { console.error('[process] listener', e); } }
  }

  // ---------- aplicar cambios ----------
  const AUTO_SEQ = [['stoves', 0], ['blast', 1.5], ['raceway', 3], ['gas', 4.5], ['charge', 6], ['descent', 7.5]];
  const AU = { t: 0, started: new Set(), idx: 0 };
  function apply(id, v, silent) {
    const it = ITEM.get(id); if (!it) return;
    if (it.type === 'slider') { const st = it.step || 0.01; v = clamp(Math.round(Number(v) / st) * st, it.min, it.max); if (!Number.isFinite(v)) return; V[id] = v; it.value = v; return; }
    if (it.type === 'button') { if (id === 'reset') reset(); return; }
    v = !!v; if (V[id] === v) return;
    V[id] = v; it.value = v;
    switch (id) {
      case 'cutaway': try { F.setCutaway?.(v); } catch (e) { console.error(e); } colMeshB.visible = !v; ironLiq.mb.visible = slagLiq.mb.visible = !v; break;
      case 'xray': try { F.setXray?.(v); } catch (e) { console.error(e); } break;
      case 'thermal': thermalOn = v; thermSign.m.visible = v; dirtyCol = true; break;
      case 'reactions': for (const s of signs) s.m.visible = v; leads.visible = v; break;
      case 'blast': if (v) fBlast.start(), fRing.start(); else fBlast.stop(), fRing.stop(); break;
      case 'gas': if (v) fShaft.start(), fTop.start(), fClean.start(); else fShaft.stop(), fTop.stop(), fClean.stop(); break;
      case 'stoves': if (v) fStove.start(); else fStove.stop(); for (const L of stoveLbl) L.m.visible = v; break;
      case 'tap': if (v) startTap(); break;
      case 'auto':
        if (v) { AU.t = 0; AU.idx = 0; AU.started.clear(); }
        else { for (const k of AU.started) apply(k, false); AU.started.clear(); }
        break;
    }
    if (!silent) emit(v ? 'start' : 'stop', id);
  }
  function autoUpdate(dt) {
    if (!V.auto) return;
    AU.t += dt;
    while (AU.idx < AUTO_SEQ.length && AU.t >= AUTO_SEQ[AU.idx][1]) {
      const id = AUTO_SEQ[AU.idx][0]; if (!V[id]) { apply(id, true); AU.started.add(id); } AU.idx++;
    }
    if (AU.idx >= AUTO_SEQ.length && TP.phase === 'idle' && !V.tap && S.ironH > 1.75 && TP.ts < 0.01) { apply('tap', true); emit('step', 'auto', 'Nivel de arrabio alto: se inicia una colada'); }
  }

  // ==================================================================== RESET
  let dirtyCol = true, colAcc = 1;
  function reset() {
    for (const it of items) if (it.type === 'toggle' && it.id !== 'cutaway' && V[it.id]) apply(it.id, false);
    apply('cutaway', true); apply('timeScale', 1);
    for (const f of flows) f.kill();
    for (const b of [bSparks, bDust, bDrips, bSmoke, bTapSp]) b.kill();
    Object.assign(S, { simT: 0, D: 0, level: 29.7, heat: 0.85, comb: 0, melt: 0, ironH: 1.45, slagH: 0.55, blastT: 25, topGasT: 60, ironT: 1490, prod: 0, charged: 0,
      stoveBlow: 0, stoveClock: 0, tapStatus: 'idle', torpFill: 0, hole: 0 });
    S.stoveH[0] = 1; S.stoveH[1] = 0.8; S.stoveH[2] = 0.6; S.stovePh[0] = 'blast'; S.stovePh[1] = 'gas'; S.stovePh[2] = 'gas';
    initLayers();
    CH.phase = 'idle'; CH.t = 0; CH.skip = 0; CH.skipT[0] = 0; CH.skipT[1] = 1; setSkips(); setBell(bellS, 0); setBell(bellL, 0);
    chL.fill(0); M4.makeScale(0, 0, 0); for (let i = 0; i < NCH; i++) chunks.setMatrixAt(i, M4); chunks.instanceMatrix.needsUpdate = true;
    TP.phase = 'idle'; TP.t = 0; TP.tsTarget = 0; TP.tWait = 0; setTorp(0);
    for (const s of streams) setStream(s, 0, 0);
    for (let i = 0; i < 3; i++) setPlug(i, 1);
    torpGlow.visible = false; flameAmp = 0; updateFlames(0);
    restoreMats(); dirtyCol = true; colAcc = 1;
    for (const L of stoveLbl) L.last = '';
    syncState();
  }

  // ==================================================================== ESTADO VIVO
  function syncState() {
    state.levelStockline = S.level;
    let n = 0; const u0 = 15 + S.D - TILT * 0.5, u1 = uTop();
    for (let i = 0; i < LU.length; i++) if (LU[i] > u0 && LU[i] < u1) n++;
    state.burdenLayers = n;
    state.blastTempC = S.blastT; state.topGasTempC = S.topGasT; state.ironTempC = S.ironT; state.productionTph = S.prod;
    state.stovePhase[0] = S.stovePh[0]; state.stovePhase[1] = S.stovePh[1]; state.stovePhase[2] = S.stovePh[2];
    state.tapStatus = S.tapStatus;
    state.ironLevel = Y_HEARTH + S.ironH; state.slagLevel = Y_HEARTH + S.ironH + S.slagH; state.torpedoFill = Math.round(S.torpFill * 100);
    state.heat = S.heat; state.combustion = S.comb; state.cohesiveTopY = ysC;
    state.stoveHeat[0] = S.stoveH[0]; state.stoveHeat[1] = S.stoveH[1]; state.stoveHeat[2] = S.stoveH[2];
    state.layersCharged = S.charged; state.simTime = S.simT;
  }

  // ==================================================================== UPDATE
  const EYE = V3(0, 6.6, 11);
  const PERIOD_ST = 40;
  function update(dtIn, t, ctx) {
    const dtr = clamp(Number(dtIn) || 0, 0, 0.25), ts = V.timeScale || 1, dt = dtr * ts;
    S.simT += dt;
    autoUpdate(dt);

    // --- combustión y calor (sin viento no hay combustión)
    const kc = 1 - Math.exp(-dt / 5);
    S.comb += ((V.blast ? 1 : 0) - S.comb) * kc;
    S.heat += ((0.35 + 0.65 * S.comb) - S.heat) * (1 - Math.exp(-dt / 40));
    if (S.comb < 1e-4) S.comb = 0;

    // --- estufas
    if (V.stoves) {
      S.stoveClock += dt;
      if (S.stoveClock >= PERIOD_ST) {
        S.stoveClock -= PERIOD_ST; const old = S.stoveBlow; S.stoveBlow = (old + 1) % 3;
        emit('step', 'stoves', `Estufa ${old + 1} pasa a calentamiento; estufa ${S.stoveBlow + 1} pasa a soplado`);
      }
    }
    for (let i = 0; i < 3; i++) {
      const blow = i === S.stoveBlow;
      if (blow) { if (V.blast) S.stoveH[i] = Math.max(0.15, S.stoveH[i] - 0.4 / PERIOD_ST * dt); S.stovePh[i] = 'blast'; }
      else if (V.stoves) {
        S.stoveH[i] = Math.min(1, S.stoveH[i] + 0.2 / PERIOD_ST * dt);
        S.stovePh[i] = (i === (S.stoveBlow + 1) % 3 && S.stoveClock > PERIOD_ST - 3) ? 'change' : 'gas';
      } else S.stovePh[i] = 'idle';
      const e = eStove[i];
      if (e) {
        const fl = 0.92 + 0.08 * Math.sin(t * 9 + i * 3);
        if (S.stovePh[i] === 'gas' || S.stovePh[i] === 'change') setEm(e, C_ST_GAS, 0.35 + 0.65 * S.stoveH[i], 1.6 * fl);
        else if (S.stovePh[i] === 'blast') setEm(e, C_ST_BL, (V.blast ? 0.25 + 0.6 * S.stoveH[i] : 0.2 * S.stoveH[i]), 1.2);
        else setEm(e, C_ST_GAS, 0.25 * S.stoveH[i], 0.8);
      }
      if (V.stoves) drawStoveLbl(i);
    }
    fStove.rate = V.stoves ? 1 : 0;
    bSmoke.rate = V.stoves ? 1 : 0;

    // --- viento
    const bt = V.blast ? 900 + 330 * S.stoveH[S.stoveBlow] : 25;
    S.blastT += (bt - S.blastT) * (1 - Math.exp(-dt / 3));
    const hk = V.blast ? clamp((S.blastT - 600) / 600, 0, 1) : 0;
    setEm(eHot, C_HOT, hk * 0.7, 0.3 * (0.95 + 0.05 * Math.sin(t * 3)));
    if (eBustle) setEm(eBustle, C_HOT, hk * 0.7, 0.3 * (0.95 + 0.05 * Math.sin(t * 3 + 1)));

    // --- combustión en toberas
    const fa = V.raceway ? (0.12 + 0.88 * S.comb) : 0;
    flameAmp += (fa - flameAmp) * (1 - Math.exp(-dt / 0.8));
    updateFlames(t);
    bSparks.rate = V.raceway ? S.comb : 0;
    setEm(eTuy, C_TUY, Math.max(flameAmp, S.comb * 0.4) * 0.8, 0.6);
    setEm(eShell, C_HOT, (V.raceway ? 0.2 : 0.06) * S.heat * S.comb, 0.25);

    // --- gas (débil sin combustión)
    const gr = 0.2 + 0.8 * S.comb;
    fShaft.rate = gr; fTop.rate = gr; fClean.rate = gr;
    bDust.rate = V.gas ? gr : 0;
    S.topGasT += ((V.blast ? 60 + 150 * S.comb * (0.85 + 0.15 * S.heat) : 40) + 6 * Math.sin(S.simT * 0.21) - S.topGasT) * (1 - Math.exp(-dt / 6));

    // --- descenso, fusión y producción
    const vBase = 0.05;
    const mv = V.descent ? (0.3 + 0.7 * S.comb) : 0;
    S.melt += (mv - S.melt) * (1 - Math.exp(-dt / 2));
    if (S.melt > 1e-3) {
      const ds = vBase * S.melt * dt;
      if (S.level > 24.5) { S.D += ds; S.level -= ds; dirtyCol = true; }
      S.ironH = Math.min(2.4, S.ironH + 0.0105 * S.melt * dt);
      S.slagH = Math.min(1.25, S.slagH + 0.0036 * S.melt * dt);
    }
    bDrips.rate = V.descent ? S.melt * (0.3 + 0.7 * S.heat) : 0;
    S.prod += ((V.descent ? 420 * S.melt * (0.5 + 0.5 * S.comb) : 0) - S.prod) * (1 - Math.exp(-dt / 4));
    S.ironT = 1440 + 70 * S.heat + 6 * Math.sin(S.simT * 0.37);

    // --- carga
    chargeUpdate(dt);
    if (CH.phase !== 'idle') dirtyCol = true;
    updateChunks(dt);

    // --- colada
    tapUpdate(dt);

    // --- crisol: niveles
    const ih = Math.max(0.02, S.ironH), sh = Math.max(0.02, S.slagH);
    ironLiq.ma.position.y = ironLiq.mb.position.y = Y_HEARTH; ironLiq.ma.scale.y = ironLiq.mb.scale.y = ih;
    slagLiq.ma.position.y = slagLiq.mb.position.y = Y_HEARTH + ih; slagLiq.ma.scale.y = slagLiq.mb.scale.y = sh;
    if (thermalOn) { cmap(20 + 1480 * (0.3 + 0.7 * S.heat)); ironLiq.m.color.setRGB(cr, cg, cb, SRGB); cmap(20 + 1430 * (0.3 + 0.7 * S.heat)); slagLiq.m.color.setRGB(cr, cg, cb, SRGB); }
    else {
      const k = 0.55 + 0.45 * S.heat, f = 0.96 + 0.04 * Math.sin(t * 5);
      ironLiq.m.color.setRGB(1.0 * k * f, 0.52 * k * k * f, 0.12 * k, SRGB);
      slagLiq.m.color.setRGB(0.88 * k, 0.70 * k * k, 0.36 * k, SRGB);
    }

    // --- partículas
    for (let i = 0; i < flows.length; i++) flows[i].update(dt);
    bSparks.update(dt); bDust.update(dt); bDrips.update(dt); bSmoke.update(dt); bTapSp.update(dt);

    // --- columna (~20 Hz en tiempo real)
    colAcc += dtr;
    if (colAcc >= 0.05 && (dirtyCol || colAcc >= 0.5)) {
      colAcc = 0; dirtyCol = false;
      shadeColumn(colA); if (colMeshB.visible) shadeColumn(colB);
    }

    // --- carteles orientados al usuario
    const pp = ctx?.playerPos;
    if (pp && Number.isFinite(pp.x)) EYE.set(pp.x, pp.y + 1.6, pp.z);
    if (V.reactions) for (const s of signs) s.m.lookAt(EYE);
    if (thermalOn) thermSign.m.lookAt(EYE);
    if (V.stoves) for (const L of stoveLbl) L.m.lookAt(EYE);

    syncState();
  }

  // ==================================================================== API
  initLayers();
  try { F.setCutaway?.(true); } catch (e) { console.error(e); }
  syncState();
  shadeColumn(colA); shadeColumn(colB);

  const api = {
    items, state,
    get: id => V[id],
    set: (id, v) => apply(id, v),
    toggle: id => { const it = ITEM.get(id); if (!it) return; if (it.type === 'toggle') apply(id, !V[id]); else if (it.type === 'button') apply(id, true); },
    trigger: id => { const it = ITEM.get(id); if (!it) return; if (it.type === 'button') apply(id, true); else if (it.type === 'toggle') apply(id, !V[id]); },
    update, reset,
    on: cb => { if (typeof cb === 'function') listeners.add(cb); },
    off: cb => { listeners.delete(cb); },
    // depuración
    debug: {
      root, innerG, S, CH, TP, flows, get particleCount() { return flows.reduce((a, f) => a + f.n, 0) + [bSparks, bDust, bDrips, bSmoke, bTapSp].reduce((a, b) => a + b.n, 0) + NCH; },
      columnVerts: colA.n + colB.n,
    },
    dispose() {
      root.parent?.remove(root); innerG.parent?.remove(innerG);
      const seen = new Set();
      const kill = o => o.traverse(c => { if (c.geometry && !seen.has(c.geometry)) { seen.add(c.geometry); c.geometry.dispose(); } if (c.material && !seen.has(c.material)) { seen.add(c.material); c.material.dispose(); } });
      kill(root); kill(innerG); for (const d of disposables) d.dispose(); restoreMats(); listeners.clear();
    },
  };
  return api;
}
