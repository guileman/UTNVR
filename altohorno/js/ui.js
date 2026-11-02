// ui.js — menú acompañante (compacto en la muñeca / expandido flotante / HUD en PC) + notas flotantes.
// Estética idéntica a CristaLab (ver theme.js). Sin allocations por frame: vectores y rectángulos reutilizados,
// texturas canvas redibujadas solo cuando cambian (flags dirty) y geometrías compartidas.
import { C, FONT, mkCanvas, rr, wrap, wrapLines, fitText, canvasTex, drawLogo, drawButton, drawSection, drawSliderCard, frameMat } from './theme.js';

const MAIN_IDS = ['auto', 'charge', 'descent', 'blast', 'raceway', 'gas', 'tap', 'stoves'];
const TABS = [['proc', 'Procesos'], ['datos', 'Datos'], ['ctrl', 'Controles'], ['glos', 'Glosario']];

// tamaños de lienzo (px) y de panel (m)
const CW = 512, CH = 760, CWM = 0.22, CHM = CWM * CH / CW;       // compacto
const EW = 1152, EH = 864, EWM = 0.80, EHM = EWM * EH / EW;      // expandido
const NW = 700, NH = 500, NWM = 0.55, NHM = NWM * NH / NW;       // nota

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const fmtNum = (v, d = 0) => (typeof v !== 'number' || !isFinite(v)) ? '—' : v.toFixed(d).replace('.', ',');

export function createUI({ THREE, renderer, scene, camera, rig, process, furnace, content, locomotion }) {
  const dom = renderer.domElement;
  const items = process.items || [];
  const itemById = new Map(items.map(i => [i.id, i]));
  const getV = it => (process.get ? process.get(it.id) : it.value);
  const isPres = () => !!renderer.xr.isPresenting;

  // ---------- estado general ----------
  let menuOpen = true, expanded = false, notesOn = true, pcMode = true;
  let tab = 'proc', page = 0, toast = '', toastT = 0;
  let layoutDirty = true;
  const ui = { goHome: null };

  // ---------- geometrías compartidas ----------
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const dotGeo = new THREE.SphereGeometry(.008, 8, 6);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false });
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

  // ---------- fábrica de paneles ----------
  function makePanel(wM, hM, cw, ch, order) {
    const cv = mkCanvas(cw, ch), g = cv.getContext('2d'), tex = canvasTex(THREE, cv);
    const pm = new THREE.MeshBasicMaterial({ map: tex, fog: false, transparent: true, depthTest: false, depthWrite: false });
    const fm = frameMat(THREE, { transparent: true, depthTest: false, depthWrite: false });
    const holder = new THREE.Group();
    const plane = new THREE.Mesh(planeGeo, pm); plane.scale.set(wM, hM, 1); plane.renderOrder = order;
    const frame = new THREE.Mesh(boxGeo, fm); const pad = wM * .05;
    frame.scale.set(wM + pad, hM + pad * .9, .02); frame.position.z = -.012; frame.renderOrder = order - 1;
    holder.add(frame, plane);
    return { cv, g, tex, pm, fm, holder, plane, frame, cw, ch, wM, hM, alpha: 1, dirty: true, lastDraw: -1 };
  }
  const cP = makePanel(CWM, CHM, CW, CH, 900);
  const eP = makePanel(EWM, EHM, EW, EH, 902);
  for (const p of [cP, eP]) { p.holder.visible = false; p.holder.matrixAutoUpdate = true; }
  let parentMode = '';       // 'vr' | 'pc'
  function setPanelOpacity(p, a) { p.alpha = a; p.pm.opacity = a; p.fm.opacity = a; }

  // ---------- vectores reutilizables ----------
  const H = new THREE.Vector3(), F = new THREE.Vector3(), O = new THREE.Vector3(), D = new THREE.Vector3();
  const T1 = new THREE.Vector3(), T2 = new THREE.Vector3(), PL = new THREE.Vector3();
  const Mx = new THREE.Matrix4(), Q1 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  let headYaw = 0;

  function readHead() {
    rig.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    H.set(e[12], e[13], e[14]); F.set(-e[8], -e[9], -e[10]).normalize();
    const fl = Math.hypot(F.x, F.z); if (fl > .3) headYaw = Math.atan2(F.x, F.z);
  }
  function playerPos() { if (locomotion && locomotion.position) return locomotion.position; return PL.set(H.x, H.y - 1.6, H.z); }

  // =====================================================================
  //                       MENÚ COMPACTO (muñeca / HUD)
  // =====================================================================
  const mainItems = [];
  for (const id of MAIN_IDS) { const it = itemById.get(id); if (it) mainItems.push(it); }
  for (const it of items) { if (mainItems.length >= 8) break; if (it.type === 'toggle' && !mainItems.includes(it) && it.group !== 'Vista' && it.group !== 'Sistema') mainItems.push(it); }

  const cRects = []; let hovC = null;
  (function layoutCompact() {
    const g = cP.g; g.font = 'bold 25px ' + FONT;
    mainItems.slice(0, 8).forEach((it, i) => {
      const lab = it.short || it.label || it.id;
      const lines = wrapLines(g, lab, 206).slice(0, 2);
      cRects.push({ kind: 'item', item: it, x: 16 + (i % 2) * 248, y: 122 + Math.floor(i / 2) * 132, w: 232, h: 122, lines, label: lab, icon: it.icon, fs: lines.length > 1 ? 24 : 26, on: false, num: String(i + 1) });
    });
    cRects.push({ kind: 'more', x: 16, y: 654, w: 480, h: 80, label: '···   Menú completo', on: false, small: false });
  })();

  function activeCount() { let n = 0; for (const r of cRects) if (r.kind === 'item' && r.item.type === 'toggle' && getV(r.item)) n++; return n; }
  const st = () => process.state || {};

  function compactStatusKey() {
    const s = st(), ts = itemById.get('timeScale');
    return activeCount() + '|' + Math.round(s.blastTempC || 0) + '|' + (ts ? getV(ts) : '') + '|' + toast + '|' + pcMode;
  }

  function drawCompact() {
    const p = cP, g = p.g;
    g.clearRect(0, 0, CW, CH);
    rr(g, 0, 0, CW, CH, 30); g.fillStyle = C.panel; g.fill();
    // barra de estado
    rr(g, 16, 14, 480, 96, 16); g.fillStyle = C.card; g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.gold; g.font = 'bold 32px ' + FONT; g.fillText('ALTO HORNO', 32, 54);
    const ts = itemById.get('timeScale');
    if (ts) { g.textAlign = 'right'; g.fillStyle = C.onBorder; g.font = 'bold 28px ' + FONT; g.fillText('×' + fmtNum(getV(ts), 2).replace(/,?0+$/, ''), 480, 54); }
    g.textAlign = 'left';
    if (toast) { g.fillStyle = C.ok; fitText(g, toast, 32, 90, 448, 24, 'bold '); }
    else {
      const s = st(), bt = s.blastTempC;
      g.fillStyle = C.text2;
      fitText(g, `${activeCount()}/${cRects.length - 1} activos · Viento ${fmtNum(bt, 0)} °C`, 32, 90, 448, 24);
    }
    for (const r of cRects) {
      r.on = r.kind === 'item' && r.item.type === 'toggle' ? !!getV(r.item) : false;
      if (r.kind === 'item' && r.item.type === 'button') r.on = false;
      drawButton(g, r, hovC === r);
      if (r.kind === 'item' && pcMode) { g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = r.on ? C.btnSubOn : C.text3; g.font = 'bold 19px ' + FONT; g.fillText(r.item.key ? String(r.item.key).toUpperCase() : r.num, r.x + 12, r.y + 24); }
    }
    p.tex.needsUpdate = true; p.dirty = false;
  }

  // =====================================================================
  //                       MENÚ EXPANDIDO
  // =====================================================================
  const chrome = [];   // cabecera, pestañas, pie: layout fijo
  let hovE = null, pager = null;
  const eRects = {};
  function mkR(kind, x, y, w, h, extra) { const r = { kind, x, y, w, h, on: false, en: true, label: '' }; if (extra) Object.assign(r, extra); chrome.push(r); return r; }
  eRects.compact = mkR('compact', EW - 20 - 210, 16, 210, 52, { label: 'Compacto', small: true });
  TABS.forEach(([id, name], i) => { eRects['tab_' + id] = mkR('tab', 20 + i * 230, 118, 220, 48, { tab: id, label: name }); });
  eRects.prev = mkR('prev', EW - 20 - 52 * 2 - 88, 118, 52, 48, { label: '‹' });
  eRects.next = mkR('next', EW - 20 - 52, 118, 52, 48, { label: '›' });
  const FW = 212, FG = 13;
  eRects.notes = mkR('notes', 20, 792, FW, 56, { label: 'Notas: sí', small: true });
  eRects.cut = mkR('cut', 20 + (FW + FG), 792, FW, 56, { label: 'Corte', small: true });
  eRects.xray = mkR('xray', 20 + (FW + FG) * 2, 792, FW, 56, { label: 'Rayos X', small: true });
  eRects.home = mkR('home', 20 + (FW + FG) * 3, 792, FW, 56, { label: 'Inicio', small: true });
  eRects.exit = mkR('exit', 20 + (FW + FG) * 4, 792, FW, 56, { label: 'SALIR DE VR', danger: true });

  let procPages = [], glosPages = [], ctrlPages = [], ctrlKey = '';
  const dataRects = [];  // sin interacción

  function buildProcPages() {
    const GAP = 16, U = (1112 + GAP) / 6, TOP = 186, BOT = 732, RG = 10, HEAD = 34;
    const groups = []; for (const it of items) if (!groups.includes(it.group || 'Proceso')) groups.push(it.group || 'Proceso');
    procPages = [{ rects: [] }]; let pg = procPages[0], y = TOP;
    const newPage = () => { pg = { rects: [] }; procPages.push(pg); y = TOP; };
    for (const gr of groups) {
      const list = items.filter(i => (i.group || 'Proceso') === gr);
      let u = 0, rowH = 0, first = true, head = null;
      const putHead = cont => { head = { kind: 'sec', text: (gr + (cont ? ' (cont.)' : '')).toUpperCase(), x: 24, y: y + 24 }; pg.rects.push(head); y += HEAD; };
      const h0 = list.length ? (list[0].type === 'slider' || list[0].type === 'choice' ? 76 : 60) : 60;
      if (y + HEAD + h0 > BOT) newPage();
      putHead(false);
      for (const it of list) {
        const need = it.type === 'slider' ? 3 : it.type === 'choice' ? 6 : 2, h = (it.type === 'slider' || it.type === 'choice') ? 76 : 60;
        if (u + need > 6) { y += rowH + RG; u = 0; rowH = 0; }
        if (y + h > BOT) { newPage(); putHead(true); u = 0; rowH = 0; }
        const x = 20 + u * U, w = need * U - GAP;
        if (it.type === 'choice') {
          const card = { kind: 'choice', item: it, x, y, w, h, label: it.label };
          pg.rects.push(card);
          const opts = it.options || [], ox = x + 330, ow = (x + w - 14 - ox - (opts.length - 1) * 10) / Math.max(1, opts.length);
          opts.forEach((o, k) => pg.rects.push({ kind: 'opt', item: it, opt: o, x: ox + k * (ow + 10), y: y + 10, w: ow, h: h - 20, label: o.label, small: true, on: false, en: true }));
        } else pg.rects.push({ kind: it.type === 'slider' ? 'slider' : 'item', item: it, x, y, w, h, label: it.label, sub: it.sub, on: false, en: true, small: false });
        u += need; rowH = Math.max(rowH, h);
      }
      y += rowH + RG + 6;
    }
  }

  function buildGlosPages() {
    const g = eP.g, G = content.GLOSSARY || [], TOP = 196, BOT = 722;
    glosPages = [{ blocks: [] }]; let pg = glosPages[0], y = TOP;
    for (const e of G) {
      g.font = '23px ' + FONT; const lines = wrapLines(g, e.def, 1080);
      const h = 34 + lines.length * 30 + 12;
      if (y + h > BOT && pg.blocks.length) { pg = { blocks: [] }; glosPages.push(pg); y = TOP; }
      pg.blocks.push({ term: e.term, lines, y }); y += h;
    }
  }
  function buildCtrlPages() {
    const g = eP.g, hp = content.HELP || {}, txt = (isPres() ? hp.vr : hp.pc) || '';
    g.font = '25px ' + FONT; const lines = wrapLines(g, txt, 1070);
    const per = 14; ctrlPages = [];
    for (let i = 0; i < Math.max(1, lines.length); i += per) ctrlPages.push({ lines: lines.slice(i, i + per) });
    ctrlKey = isPres() ? 'vr' : 'pc';
  }
  function ensureLayout() {
    if (!layoutDirty && ctrlKey === (isPres() ? 'vr' : 'pc')) return;
    buildProcPages(); buildGlosPages(); buildCtrlPages(); layoutDirty = false;
  }
  const pageCount = () => tab === 'proc' ? procPages.length : tab === 'glos' ? glosPages.length : tab === 'ctrl' ? ctrlPages.length : 1;

  function curRects() { // rectángulos interactivos actuales del expandido
    return null;
  }

  const STOVE_NAMES = { gas: 'Calentando', heat: 'Calentando', heating: 'Calentando', calentando: 'Calentando', blast: 'Soplando', blow: 'Soplando', blowing: 'Soplando', soplado: 'Soplando', soplando: 'Soplando', idle: 'En espera', change: 'Cambio', cambio: 'Cambio' };
  const phaseName = v => typeof v === 'string' ? (STOVE_NAMES[v.toLowerCase()] || v) : (v === 0 ? 'Calentando' : v === 1 ? 'Soplando' : fmtNum(v, 0));
  const TAP_NAMES = { idle: 'En reposo', closed: 'En reposo', iron: 'Colando arrabio', arrabio: 'Colando arrabio', slag: 'Colando escoria', escoria: 'Colando escoria', plug: 'Tapando piquera', tapping: 'Colando' };
  const tapName = v => typeof v === 'string' ? (TAP_NAMES[v.toLowerCase()] || v) : fmtNum(v, 0);

  function dataRows() {
    const s = st();
    return [
      ['Nivel de carga (tragante)', fmtNum(s.levelStockline, 1), 'm', C.text],
      ['Capas de carga', fmtNum(s.burdenLayers, 0), 'capas', C.text],
      ['Temperatura del viento', fmtNum(s.blastTempC, 0), '°C', C.warn],
      ['Gas de tragante', fmtNum(s.topGasTempC, 0), '°C', C.warn],
      ['Temperatura del arrabio', fmtNum(s.ironTempC, 0), '°C', C.hot],
      ['Producción (ilustrativa)', fmtNum(s.productionTph, 0), 't/h', C.text],
      ['STOVES', null, null, null],
      ['Colada', tapName(s.tapStatus), '', C.ok],
    ];
  }
  function dataKey() { return dataRows().map(r => r[1] + (r[0] === 'STOVES' ? (st().stovePhase || []).join(',') : '')).join('|'); }

  function drawExpanded() {
    ensureLayout();
    const p = eP, g = p.g, pres = isPres();
    g.clearRect(0, 0, EW, EH);
    rr(g, 0, 0, EW, EH, 30); g.fillStyle = C.panel; g.fill();
    // cabecera
    drawLogo(g, 20, 12, 132, 76);
    const intro = content.INTRO || {};
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = C.gold; fitText(g, intro.title || 'Alto Horno', 172, 52, 700, 46, 'bold ');
    g.fillStyle = C.text2; fitText(g, intro.subtitle || 'Simulador VR del proceso siderúrgico', 172, 80, 740, 22);
    g.fillStyle = C.text3; g.font = '18px ' + FONT; g.fillText('UTN · Facultad Regional San Nicolás', 172, 103);
    const nRead = notesSeen, nTot = nrec.length;
    g.textAlign = 'right'; g.fillStyle = C.text3; g.font = '19px ' + FONT; g.fillText(`Notas leídas ${nRead}/${nTot}`, EW - 22, 98);
    // pestañas
    for (const [id] of TABS) { const r = eRects['tab_' + id]; r.on = tab === id; }
    const np = pageCount(); const showPager = np > 1;
    eRects.prev.en = showPager && page > 0; eRects.next.en = showPager && page < np - 1;
    eRects.notes.label = 'Notas: ' + (notesOn ? 'sí' : 'no'); eRects.notes.on = notesOn;
    const cut = itemById.get('cutaway'), xr = itemById.get('xray');
    eRects.cut.label = 'Corte: ' + (cut && getV(cut) ? 'sí' : 'no'); eRects.cut.on = !!(cut && getV(cut)); eRects.cut.en = !!cut;
    eRects.xray.label = 'Rayos X: ' + (xr && getV(xr) ? 'sí' : 'no'); eRects.xray.on = !!(xr && getV(xr)); eRects.xray.en = !!xr;
    eRects.exit.label = pres ? 'SALIR DE VR' : 'Soltar mouse';
    for (const r of chrome) {
      if ((r.kind === 'prev' || r.kind === 'next') && !showPager) continue;
      drawButton(g, r, hovE === r);
    }
    if (showPager) { g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C.text2; g.font = 'bold 22px ' + FONT; g.fillText(`${page + 1} / ${np}`, EW - 20 - 52 - 44, 118 + 25); }
    // contenido
    let hint = '';
    if (tab === 'proc') {
      const pg = procPages[Math.min(page, procPages.length - 1)];
      for (const r of pg.rects) {
        if (r.kind === 'sec') { drawSection(g, r.text, r.x, r.y); continue; }
        const it = r.item;
        if (r.kind === 'item') {
          r.on = it.type === 'toggle' ? !!getV(it) : false;
          drawButton(g, r, hovE === r);
          if (it.type === 'toggle') { g.fillStyle = r.on ? C.onBorder : C.btnBorder; g.beginPath(); g.arc(r.x + 22, r.y + r.h / 2, 7, 0, 7); g.fill(); }
          if (pcMode && it.key) { g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = r.on ? C.btnSubOn : C.text3; g.font = 'bold 18px ' + FONT; g.fillText(String(it.key).toUpperCase(), r.x + r.w - 12, r.y + 22); }
        } else if (r.kind === 'slider') {
          const v = getV(it), mn = it.min ?? 0, mx = it.max ?? 1;
          drawSliderCard(g, r, it.label, sliderText(it, v), (v - mn) / (mx - mn || 1), hovE === r, it.sub);
        } else if (r.kind === 'choice') {
          rr(g, r.x, r.y, r.w, r.h, 14); g.fillStyle = C.card; g.fill(); g.lineWidth = 2; g.strokeStyle = C.btnBorder; g.stroke();
          g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = C.gold; g.font = 'bold 23px ' + FONT; g.fillText(it.label, r.x + 18, r.y + r.h / 2 + 1);
        } else if (r.kind === 'opt') {
          r.on = getV(it) === r.opt.id; drawButton(g, r, hovE === r);
        }
        if (hovE === r && it.hint) hint = it.hint;
      }
    } else if (tab === 'datos') {
      dataRows().forEach((row, i) => {
        const x = 20 + (i % 2) * 564, y = 186 + Math.floor(i / 2) * 138, w = 548, h = 124;
        rr(g, x, y, w, h, 14); g.fillStyle = C.card; g.fill(); g.lineWidth = 2; g.strokeStyle = C.btnBorder; g.stroke();
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        if (row[0] === 'STOVES') {
          g.fillStyle = C.gold; g.font = 'bold 22px ' + FONT; g.fillText('Estufas Cowper', x + 18, y + 32);
          const ph = st().stovePhase || [];
          for (let k = 0; k < 3; k++) {
            const sx = x + 18 + k * 174, name = phaseName(ph[k]), blow = name === 'Soplando';
            rr(g, sx, y + 50, 162, 56, 12); g.fillStyle = blow ? C.on : C.btn; g.fill(); g.lineWidth = 2; g.strokeStyle = blow ? C.onBorder : C.btnBorder; g.stroke();
            g.textAlign = 'center'; g.fillStyle = C.btnText; g.font = 'bold 20px ' + FONT; g.fillText('Estufa ' + (k + 1), sx + 81, y + 72);
            g.font = '19px ' + FONT; g.fillStyle = blow ? C.btnSubOn : C.btnSub; g.fillText(name, sx + 81, y + 96); g.textAlign = 'left';
          }
        } else {
          g.fillStyle = C.gold; g.font = 'bold 22px ' + FONT; g.fillText(row[0], x + 18, y + 32);
          g.fillStyle = row[3]; fitText(g, row[1], x + 18, y + 94, w - 160, 54, 'bold ');
          if (row[2]) { g.textAlign = 'right'; g.fillStyle = C.text3; g.font = '26px ' + FONT; g.fillText(row[2], x + w - 18, y + 94); }
        }
      });
      hint = 'Valores en vivo de la simulación (la producción es ilustrativa).';
    } else if (tab === 'ctrl') {
      const pg = ctrlPages[Math.min(page, ctrlPages.length - 1)];
      rr(g, 20, 186, 1112, 546, 16); g.fillStyle = C.card; g.fill();
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.gold; g.font = 'bold 28px ' + FONT; g.fillText(pres ? 'Controles (Quest)' : 'Controles (PC)', 44, 228);
      g.fillStyle = C.text; g.font = '25px ' + FONT;
      pg.lines.forEach((l, i) => g.fillText(l, 44, 272 + i * 33));
      hint = pcMode ? 'Teclas: M menú · N notas · Tab compacto/completo · C liberar el mouse.' : 'Y: mostrar/ocultar menú · A / X: notas · B (der.): menú completo.';
    } else if (tab === 'glos') {
      const pg = glosPages[Math.min(page, glosPages.length - 1)];
      rr(g, 20, 182, 1112, 546, 16); g.fillStyle = C.card; g.fill();
      for (const b of pg.blocks) {
        g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.gold; g.font = 'bold 26px ' + FONT; g.fillText(b.term, 44, b.y + 8);
        g.fillStyle = C.text2; g.font = '23px ' + FONT; b.lines.forEach((l, i) => g.fillText(l, 44, b.y + 40 + i * 30));
      }
      if (!pg.blocks.length) { g.fillStyle = C.text3; g.font = '24px ' + FONT; g.fillText('Sin términos cargados.', 44, 240); }
    }
    // barra de ayuda contextual
    rr(g, 20, 740, 1112, 40, 12); g.fillStyle = C.card; g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.text2;
    fitText(g, hint || (hovE && hovE.hint) || (pcMode ? 'Clic en un botón o usá la tecla indicada.' : 'Apuntá con el láser y apretá el gatillo.'), 36, 767, 1080, 22);
    p.tex.needsUpdate = true; p.dirty = false; p.lastDraw = now;
  }
  function sliderText(it, v) {
    if (it.id === 'timeScale') return '×' + fmtNum(v, 2).replace(/,?0+$/, '');
    const d = (it.step && it.step < 1) ? 2 : 0;
    return fmtNum(v, d).replace(/,?0+$/, d ? '' : '$&') + (it.unit ? ' ' + it.unit : '');
  }

  function curList() {
    if (tab === 'proc') return procPages[Math.min(page, procPages.length - 1)].rects;
    return null;
  }
  function rectAt(list, px, py) {
    for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.kind === 'sec' || r.en === false) continue; if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r; }
    return null;
  }
  function findE(px, py) {
    ensureLayout();
    for (const r of chrome) { if ((r.kind === 'prev' || r.kind === 'next') && pageCount() < 2) continue; if (r.en === false) continue; if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r; }
    const l = curList(); return l ? rectAt(l, px, py) : null;
  }
  function findC(px, py) { return rectAt(cRects, px, py); }

  // ---------- acciones ----------
  function setToast(t) { toast = t; toastT = 2.2; cP.dirty = true; }
  function setNotes(v) {
    v = !!v; if (v === notesOn) return; notesOn = v;
    if (!v) { hideNotes(); } else { for (const r of nrec) { r.armed = true; r.inside = false; } }
    setToast('Notas: ' + (v ? 'sí' : 'no')); cP.dirty = eP.dirty = true;
  }
  function setExpanded(v) {
    if (v === expanded) return; expanded = v; cP.dirty = eP.dirty = true; pcLayoutKey = '';
    if (!isPres() && v && document.pointerLockElement) document.exitPointerLock();   // PC: soltar el mouse para hacer clic
  }
  function toggleMenu() { menuOpen = !menuOpen; cP.dirty = eP.dirty = true; return menuOpen; }
  function goHome() {
    if (typeof ui.goHome === 'function') { ui.goHome(); return; }
    const s = renderer.xr.getSession && renderer.xr.getSession(); if (s) { try { s.end(); } catch (e) { } }
    setTimeout(() => { window.location.href = '../index.html'; }, s ? 200 : 0);
  }
  function exitApp() {
    const s = renderer.xr.getSession && renderer.xr.getSession();
    if (s) { try { s.end(); } catch (e) { console.error(e); } } else if (document.pointerLockElement) document.exitPointerLock();
  }
  function doItem(it) {
    if (!it) return;
    if (it.type === 'toggle') process.toggle(it.id);
    else if (it.type === 'button') process.trigger(it.id);
    else if (it.type === 'slider') { const mn = it.min ?? 0, mx = it.max ?? 1, st_ = it.step || (mx - mn) / 10, v = getV(it) + st_; process.set(it.id, v > mx + 1e-9 ? mn : v); }
    else if (it.type === 'choice') { const o = it.options || [], i = o.findIndex(x => x.id === getV(it)); if (o.length) process.set(it.id, o[(i + 1) % o.length].id); }
    cP.dirty = eP.dirty = true;
  }
  function setSliderFromPx(r, px) {
    const it = r.item, mn = it.min ?? 0, mx = it.max ?? 1, step = it.step || 0;
    let v = mn + clamp((px - (r.x + 20)) / (r.w - 40), 0, 1) * (mx - mn);
    if (step) v = Math.round((v - mn) / step) * step + mn;
    v = clamp(Math.round(v * 1e4) / 1e4, mn, mx);
    if (v !== getV(it)) { process.set(it.id, v); eP.dirty = cP.dirty = true; }
  }
  // devuelve true si el clic hizo algo
  function clickRect(panel, r) {
    if (!r) return false;
    switch (r.kind) {
      case 'item': doItem(r.item); break;
      case 'opt': process.set(r.item.id, r.opt.id); break;
      case 'more': setExpanded(true); break;
      case 'compact': setExpanded(false); break;
      case 'tab': tab = r.tab; page = 0; break;
      case 'prev': page = Math.max(0, page - 1); break;
      case 'next': page = Math.min(pageCount() - 1, page + 1); break;
      case 'notes': setNotes(!notesOn); break;
      case 'cut': doItem(itemById.get('cutaway')); break;
      case 'xray': doItem(itemById.get('xray')); break;
      case 'home': goHome(); break;
      case 'exit': exitApp(); break;
      default: return false;
    }
    cP.dirty = eP.dirty = true; return true;
  }

  // =====================================================================
  //                       RAYOS (mandos y ratón)
  // =====================================================================
  const hit = { px: 0, py: 0, t: 0, x: 0, y: 0, z: 0 };
  function hitPanel(P, o, d, free) {
    const e = P.plane.matrixWorld.elements;
    let nx = e[8], ny = e[9], nz = e[10]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const den = d.x * nx + d.y * ny + d.z * nz; if (den > -1e-5) return false;
    const t = ((e[12] - o.x) * nx + (e[13] - o.y) * ny + (e[14] - o.z) * nz) / den; if (t < 0 || t > 8) return false;
    const wx = o.x + d.x * t, wy = o.y + d.y * t, wz = o.z + d.z * t, dx = wx - e[12], dy = wy - e[13], dz = wz - e[14];
    const u = (dx * e[0] + dy * e[1] + dz * e[2]) / (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
    const v = (dx * e[4] + dy * e[5] + dz * e[6]) / (e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
    if (!free && (u < -.5 || u > .5 || v < -.5 || v > .5)) return false;
    hit.px = (u + .5) * P.cw; hit.py = (.5 - v) * P.ch; hit.t = t; hit.x = wx; hit.y = wy; hit.z = wz; return true;
  }

  // controladores
  const hands = { left: null, right: null }, allHands = [];
  const pads = { left: { trig: false, a: false, b: false }, right: { trig: false, a: false, b: false } };
  const prevPads = { left: { trig: false, a: false, b: false }, right: { trig: false, a: false, b: false } };
  let injected = null;
  function readPads() {
    for (const h of ['left', 'right']) { const p = pads[h], q = prevPads[h]; q.trig = p.trig; q.a = p.a; q.b = p.b; }
    if (injected) { for (const h of ['left', 'right']) { const p = pads[h], s = injected[h] || {}; p.trig = !!s.trig; p.a = !!s.a; p.b = !!s.b; } return; }
    const s = renderer.xr.getSession && renderer.xr.getSession(); if (!s) return;
    for (const h of ['left', 'right']) { pads[h].trig = pads[h].a = pads[h].b = false; }
    for (const src of s.inputSources) {
      if (!src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const b = src.gamepad.buttons, p = pads[src.handedness];
      p.trig = !!(b[0] && b[0].pressed); p.a = !!(b[4] && b[4].pressed); p.b = !!(b[5] && b[5].pressed);
    }
  }
  const edge = (h, k) => pads[h][k] && !prevPads[h][k];
  function haptic(hand, i, ms) {
    const s = renderer.xr.getSession && renderer.xr.getSession(); if (!s) return;
    for (const src of s.inputSources) if (src.handedness === hand && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]) { try { src.gamepad.hapticActuators[0].pulse(i, ms); } catch (e) { } }
  }
  function setControllers(c0, c1) {
    for (const c of [c0, c1]) {
      if (!c || allHands.some(h => h.ctrl === c)) continue;
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: C.laser, transparent: true, opacity: .8, fog: false, depthTest: false }));
      line.visible = false; line.renderOrder = 997; c.add(line);
      const dot = new THREE.Mesh(dotGeo, dotMat); dot.renderOrder = 998; dot.visible = false; scene.add(dot);
      const h = { ctrl: c, line, dot, hand: null };
      c.addEventListener('connected', e => { const hd = e.data && e.data.handedness; if (hd === 'left' || hd === 'right') { h.hand = hd; hands[hd] = h; } });
      c.addEventListener('disconnected', () => { if (h.hand && hands[h.hand] === h) hands[h.hand] = null; line.visible = false; dot.visible = false; });
      allHands.push(h);
    }
  }
  let overUI = false, drag = null;   // drag: {src:'left'|'right'|'mouse', r}

  // ratón (PC)
  let mx = 0, my = 0, mouseIn = false;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; mouseIn = true; });
  function mouseRay() {
    const r = dom.getBoundingClientRect();
    T1.set(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1, .5).unproject(camera);
    O.copy(H); D.copy(T1).sub(H).normalize();
  }
  dom.addEventListener('mousedown', e => {
    if (isPres() || !menuOpen || e.button !== 0 || document.pointerLockElement) return;
    mx = e.clientX; my = e.clientY; readHead(); placePC(0); mouseRay();
    const P = expanded ? eP : cP;
    if (hitPanel(P, O, D, false)) {
      const r = P === eP ? findE(hit.px, hit.py) : findC(hit.px, hit.py);
      if (r) {
        if (r.kind === 'slider') { drag = { src: 'mouse', r }; setSliderFromPx(r, hit.px); }
        else clickRect(P, r);
      }
      e.stopImmediatePropagation(); e.preventDefault();      // no re-capturar el puntero al clicar el menú
    }
  }, true);
  window.addEventListener('mouseup', () => { if (drag && drag.src === 'mouse') drag = null; });
  window.addEventListener('mousemove', () => {
    if (drag && drag.src === 'mouse' && !isPres()) { readHead(); mouseRay(); if (hitPanel(eP, O, D, true)) setSliderFromPx(drag.r, hit.px); }
  });

  // mira central (como #mira de CristaLab): visible mientras el puntero está capturado
  let mira = document.getElementById('mira');
  if (!mira) {
    mira = document.createElement('div'); mira.id = 'mira'; mira.dataset.ui = '1';
    mira.style.cssText = 'position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;pointer-events:none;display:none;';
    mira.innerHTML = '<div style="position:absolute;left:7px;top:0;width:2px;height:16px;background:rgba(255,255,255,.85)"></div><div style="position:absolute;top:7px;left:0;height:2px;width:16px;background:rgba(255,255,255,.85)"></div>';
    document.body.appendChild(mira);
  }
  document.addEventListener('pointerlockchange', () => { if (mira.dataset.ui) mira.style.display = document.pointerLockElement && !isPres() ? 'block' : 'none'; });

  // =====================================================================
  //                       COLOCACIÓN DE LOS PANELES
  // =====================================================================
  function setParent(mode) {
    if (parentMode === mode) return; parentMode = mode;
    for (const p of [cP, eP]) { p.holder.removeFromParent(); (mode === 'vr' ? scene : camera).add(p.holder); }
    snapC = snapE = true; pcLayoutKey = '';
  }
  // PC: HUD pegado a la cámara, abajo-izquierda (compacto) / izquierda (expandido)
  let pcLayoutKey = '';
  function placePC(dt) {
    const asp = camera.aspect || 1.7, fov = camera.fov || 70, key = asp + '|' + fov + '|' + expanded;
    const P = expanded ? eP : cP;
    if (key !== pcLayoutKey) {
      pcLayoutKey = key;
      const z = .62, vh = 2 * z * Math.tan(fov * Math.PI / 360), vw = vh * asp, mg = vh * .03;
      let s, x, y;
      if (!expanded) { s = Math.min(.44 * vh / CHM, .32 * vw / CWM); x = -vw / 2 + mg + CWM * s / 2; y = -vh / 2 + mg + CHM * s / 2; }
      else { s = Math.min(.82 * vh / EHM, .62 * vw / EWM); x = -vw / 2 + mg + EWM * s / 2; y = -vh / 2 + mg + EHM * s / 2 + vh * .02; }
      P.holder.position.set(x, y, -z); P.holder.quaternion.identity(); P.holder.scale.setScalar(s);
    }
    P.holder.updateMatrixWorld(true);
  }

  let snapC = true, snapE = true, expYaw = 0, expY = 0;
  function placeVR(dt) {
    // compacto: sobre el mando izquierdo, orientado al usuario
    const lh = hands.left, k = snapC ? 1 : 1 - Math.exp(-dt * 14);
    if (lh) {
      lh.ctrl.updateWorldMatrix(true, false); const e = lh.ctrl.matrixWorld.elements;
      T1.set(e[12], e[13] + CHM * .5 + .01, e[14]);
      T2.set(H.x - e[12], 0, H.z - e[14]).normalize().multiplyScalar(.04); T1.add(T2);
    } else { T1.set(H.x + Math.sin(headYaw + .6) * .45, H.y - .4, H.z + Math.cos(headYaw + .6) * .45); }
    cP.holder.position.lerp(T1, k);
    Mx.lookAt(H, cP.holder.position, UP); Q1.setFromRotationMatrix(Mx);
    if (snapC) cP.holder.quaternion.copy(Q1); else cP.holder.quaternion.slerp(Q1, k);
    snapC = false; cP.holder.scale.setScalar(1); cP.holder.updateMatrixWorld(true);
    // expandido: sigue suavemente la cabeza (zona muerta de ~23°)
    if (snapE) { expYaw = headYaw + .5; expY = H.y - .08; }
    const diff = wrapPi(headYaw + .5 - expYaw), exc = Math.sign(diff) * Math.max(0, Math.abs(diff) - .4);
    expYaw += exc * (1 - Math.exp(-dt * 3)); expY += (H.y - .08 - expY) * (1 - Math.exp(-dt * 2));
    eP.holder.position.set(H.x + Math.sin(expYaw) * 1.0, expY, H.z + Math.cos(expYaw) * 1.0);
    Mx.lookAt(H, eP.holder.position, UP); eP.holder.quaternion.setFromRotationMatrix(Mx);
    snapE = false; eP.holder.scale.setScalar(1); eP.holder.updateMatrixWorld(true);
  }
  function gazeAlpha(P, lo, hi) {
    const e = P.holder.position; T2.set(e.x - H.x, e.y - H.y, e.z - H.z).normalize();
    const c = T2.dot(F); return clamp((c - lo) / (hi - lo), 0, 1);
  }

  // =====================================================================
  //                       NOTAS FLOTANTES
  // =====================================================================
  const NOTES = content.NOTES || [], ZONES = content.ZONES || [];
  const nrec = NOTES.map(n => {
    let anchor = null, useY = false;
    const an = furnace && furnace.anchors;
    if (n.anchor && an && an[n.anchor]) anchor = an[n.anchor];
    else if (typeof n.y === 'number') { anchor = new THREE.Vector3(0, n.y, 0); useY = true; }
    else if (n.zone) { const z = ZONES.find(z => z.name === n.zone); if (z && an && an[z.anchor]) anchor = an[z.anchor]; }
    const procs = n.onProcess ? (Array.isArray(n.onProcess) ? n.onProcess : [n.onProcess]) : [];
    return { n, anchor, useY, procs, inside: false, armed: true, seen: false, lastShown: -1e9, queued: false, proc: false, active: false, score: 0, dist: 0 };
  });
  const noteById = new Map(nrec.map(r => [r.n.id, r]));
  let notesSeen = 0;
  const queue = [];
  const zoneLabel = name => { const z = ZONES.find(z => z.name === name); return z ? z.label : (name || ''); };

  const slots = [];
  for (let i = 0; i < 2; i++) {
    const p = makePanel(NWM, NHM, NW, NH, 700);
    const lm = new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0, fog: false, depthTest: false });
    const lg = new THREE.BufferGeometry(); const pos = new Float32Array(6); lg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(lg, lm); line.frustumCulled = false; line.renderOrder = 698; line.visible = false;
    const dm = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0, fog: false, depthTest: false });
    const adot = new THREE.Mesh(dotGeo, dm); adot.scale.setScalar(1.6); adot.renderOrder = 699; adot.visible = false;
    p.holder.visible = false; scene.add(p.holder, line, adot);
    slots.push(Object.assign(p, { idx: i, rec: null, state: 'off', t0: 0, minT: 0, pinned: false, line, lpos: pos, lm, adot, dm, pos: new THREE.Vector3(), anchorV: new THREE.Vector3(), hasAnchor: false, sc: 1, a: 0, seenBefore: false }));
  }

  function drawNote(s, rec) {
    const g = s.g, n = rec.n;
    g.clearRect(0, 0, NW, NH); rr(g, 0, 0, NW, NH, 26); g.fillStyle = C.panel; g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = 'bold 34px ' + FONT; let tl = wrapLines(g, n.title || '', NW - 56);
    if (tl.length > 2) { g.font = 'bold 28px ' + FONT; tl = wrapLines(g, n.title, NW - 56).slice(0, 2); }
    g.fillStyle = C.gold; tl.forEach((l, i) => g.fillText(l, 28, 56 + i * 40));
    const sepY = 56 + (tl.length - 1) * 40 + 20;
    g.fillStyle = C.sep; g.fillRect(28, sepY, NW - 56, 2);
    // cuerpo: el tamaño más grande que entra
    const maxY = 440, y0 = sepY + 42; let fs = 28;
    for (const f of [28, 27, 26, 24, 22]) { fs = f; g.font = f + 'px ' + FONT; if (y0 + (wrapLines(g, n.body || '', NW - 56).length - 1) * Math.round(f * 1.28) <= maxY) break; }
    g.fillStyle = C.text; g.font = fs + 'px ' + FONT; wrap(g, n.body || '', 28, y0, NW - 56, Math.round(fs * 1.28), maxY + 10);
    // pie
    g.fillStyle = C.section; g.font = 'bold 19px ' + FONT; g.textAlign = 'left'; g.fillText(String(zoneLabel(n.zone)).toUpperCase().slice(0, 34), 28, NH - 22);
    g.textAlign = 'right'; g.fillStyle = s.seenBefore ? C.ok : C.text3; g.font = '19px ' + FONT;
    g.fillText((s.seenBefore ? '✓ leída · ' : '') + `nota ${Math.max(1, NOTES.indexOf(n) + 1)}/${NOTES.length}`, NW - 28, NH - 22);
    s.tex.needsUpdate = true; s.dirty = false;
  }

  function placeCard(s, rec) {
    const P = playerPos(), A = rec.anchor;
    // dirección de la tarjeta: delante del usuario, sesgada hacia el anchor
    let ax = F.x, az = F.z; const fl = Math.hypot(ax, az) || 1; ax /= fl; az /= fl;
    let dd = 3;
    if (A) { let dx = A.x - P.x, dz = A.z - P.z; dd = Math.hypot(dx, dz); if (rec.useY) { dd = 3; dx = 0; dz = 0; } if (dd > .01) { ax = ax + .6 * dx / dd; az = az + .6 * dz / dd; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; } }
    const d = clamp(dd * .6, 1.3, 2.2), side = s.idx === 0 ? -.45 : .45;
    s.pos.set(P.x + ax * d - az * side, 0, P.z + az * d + ax * side);
    s.pos.y = clamp(A ? A.y : P.y + 1.6, P.y + 1.3, P.y + 2.0);
    s.hasAnchor = !!A;
    if (A) { s.anchorV.copy(A); if (rec.useY) { s.anchorV.x = P.x + ax * d * .2 - az * side * .2; s.anchorV.z = P.z + az * d * .2 + ax * side * .2; } }
    // evitar solaparse con la otra tarjeta
    const o = slots[1 - s.idx];
    if (o.state !== 'off') { const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z, dy = o.pos.y - s.pos.y; if (Math.hypot(dx, dz) < .75 && Math.abs(dy) < .45) { s.pos.x += -az * (s.idx === 0 ? -.62 : .62); s.pos.z += ax * (s.idx === 0 ? -.62 : .62); } }
  }

  function startCard(s, rec, pinned) {
    s.rec = rec; s.seenBefore = rec.seen; s.pinned = !!pinned; s.state = 'in'; s.t0 = now; s.a = 0;
    s.minT = 7 + (rec.n.body ? rec.n.body.length : 100) * .022;
    placeCard(s, rec); drawNote(s, rec);
    s.holder.position.copy(s.pos); s.holder.visible = true; s.line.visible = s.hasAnchor; s.adot.visible = s.hasAnchor;
    if (s.hasAnchor) s.adot.position.copy(s.anchorV);
    if (!rec.seen) { rec.seen = true; notesSeen++; eP.dirty = true; }
    rec.active = true; rec.lastShown = now; rec.queued = false; lastSpawn = now;
  }
  function endCard(s) { if (s.state === 'on' || s.state === 'in') { s.state = 'out'; } }

  let now = 0, lastSpawn = -1e9, scanT = 0;
  function enqueue(rec, proc) {
    if (rec.active || rec.queued) { if (proc) rec.proc = true; return; }
    rec.queued = true; rec.proc = !!proc; queue.push(rec);
  }
  function scoreRec(r) { return (r.seen ? 1000 : 0) + (r.n.order || 0) + r.dist * .5 - (r.proc ? 5000 : 0); }
  function scanNotes() {
    const P = playerPos();
    for (const r of nrec) {
      if (!r.anchor) { r.inside = false; continue; }
      const A = r.anchor, rad = r.n.radius || 5;
      const dx = A.x - P.x, dz = A.z - P.z, dy = A.y - P.y;
      const d = r.useY ? Math.abs(dy) : Math.sqrt(dx * dx + dy * dy + dz * dz); r.dist = d;
      if (!r.inside && d < rad) { r.inside = true; if (r.armed && notesOn && now - r.lastShown > 30 + (r.seen ? 30 : 0)) { r.armed = false; enqueue(r, false); } else if (r.armed && !notesOn) { /* se arma cuando se activen */ } }
      else if (r.inside && d > rad * 1.15) { r.inside = false; r.armed = true; }
    }
    for (let i = queue.length - 1; i >= 0; i--) { const r = queue[i]; if (!r.inside && !r.proc) { queue.splice(i, 1); r.queued = false; } }
  }
  function spawnNext() {
    if (!notesOn || !queue.length || now - lastSpawn < 1.2) return;
    let s = slots.find(x => x.state === 'off'); if (!s) return;
    let bi = 0, bs = 1e9; for (let i = 0; i < queue.length; i++) { const sc = scoreRec(queue[i]); if (sc < bs) { bs = sc; bi = i; } }
    const rec = queue.splice(bi, 1)[0]; startCard(s, rec, false);
  }
  function updateNotes(dt) {
    scanT -= dt; if (scanT <= 0) { scanT = .25; scanNotes(); }
    if (!notesOn) { for (const s of slots) endCard(s); }
    spawnNext();
    for (const s of slots) {
      if (s.state === 'off') continue;
      const el = now - s.t0, rec = s.rec;
      if (s.state === 'in') { s.a = Math.min(1, el / .5); if (s.a >= 1) s.state = 'on'; }
      else if (s.state === 'on') {
        if (!s.pinned) {
          const away = rec.anchor && !rec.inside && !rec.proc, wait = queue.length > 0;
          if ((el > s.minT && (away || wait)) || (rec.proc && el > s.minT + 4) || el > s.minT + 25) endCard(s);
        }
      } else if (s.state === 'out') { s.a -= dt / .8; if (s.a <= 0) { s.a = 0; s.state = 'off'; s.holder.visible = false; s.line.visible = false; s.adot.visible = false; rec.active = false; rec.proc = false; s.rec = null; continue; } }
      // billboard sobre Y, escala por distancia para conservar el tamaño angular
      const dx = H.x - s.pos.x, dz = H.z - s.pos.z, dist = Math.hypot(dx, dz, H.y - s.pos.y);
      s.sc = clamp(dist / 2.2, 1, 2.4);
      s.holder.rotation.y = Math.atan2(dx, dz); s.holder.scale.setScalar(s.sc);
      setPanelOpacity(s, s.a * .96); s.lm.opacity = s.a * .55; s.dm.opacity = s.a * .9;
      if (s.hasAnchor) {
        const lp = s.lpos; lp[0] = s.pos.x; lp[1] = s.pos.y - NHM * .5 * s.sc; lp[2] = s.pos.z; lp[3] = s.anchorV.x; lp[4] = s.anchorV.y; lp[5] = s.anchorV.z;
        s.line.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
  function showNote(id) {
    const rec = noteById.get(id); if (!rec) { console.error('[ui] nota inexistente:', id); return false; }
    readHead();
    if (rec.active) return true;
    const qi = queue.indexOf(rec); if (qi >= 0) { queue.splice(qi, 1); rec.queued = false; }
    let s = slots.find(x => x.state === 'off');
    if (!s) { s = slots[0].t0 <= slots[1].t0 ? slots[0] : slots[1]; if (s.rec) { s.rec.active = false; } }
    startCard(s, rec, true); return true;
  }
  function hideNotes() {
    queue.length = 0; for (const r of nrec) r.queued = false;
    for (const s of slots) { s.pinned = false; endCard(s); }
  }

  // eventos de proceso → notas
  const onProc = ev => {
    if (!ev) return;
    if (ev.type === 'start') {
      let n = 0;
      for (const r of nrec) if (r.procs.includes(ev.id)) {
        if (!notesOn || now - r.lastShown < 60) continue;
        enqueue(r, true); n++;
      }
    }
    cP.dirty = eP.dirty = true;
  };
  if (process.on) process.on(onProc);

  // =====================================================================
  //                       TECLADO (PC)
  // =====================================================================
  function onKey(e) {
    if (!e || e.__ui || isPres() || e.ctrlKey || e.altKey || e.metaKey) return false;
    const k = (e.key || '').toLowerCase();
    let handled = true;
    if (k === 'm') { if (!e.repeat) toggleMenu(); }
    else if (k === 'n') { if (!e.repeat) setNotes(!notesOn); }
    else if (k === 'tab') { if (!menuOpen) { menuOpen = true; setExpanded(true); } else setExpanded(!expanded); }
    else if (k === 'c') { if (!e.repeat && document.pointerLockElement) document.exitPointerLock(); }
    else if ((k === '+' || k === '=' || k === '-' || k === '_') && itemById.has('timeScale')) {
      const it = itemById.get('timeScale'), st_ = it.step || .25, dir = (k === '+' || k === '=') ? 1 : -1;
      process.set(it.id, clamp(getV(it) + dir * st_, it.min ?? 0, it.max ?? 1)); cP.dirty = eP.dirty = true;
    } else {
      const it = items.find(i => i.key && String(i.key).toLowerCase() === k);
      if (it) { if (!e.repeat || it.type === 'slider') { if (it.type === 'slider' && e.shiftKey) { const st_ = it.step || 1; process.set(it.id, clamp(getV(it) - st_, it.min ?? 0, it.max ?? 1)); cP.dirty = eP.dirty = true; } else doItem(it); } }
      else if (k >= '1' && k <= '8') { const r = cRects[+k - 1]; if (r && r.kind === 'item' && !e.repeat) doItem(r.item); else handled = false; }
      else if (k === '9') { if (!e.repeat) { menuOpen = true; setExpanded(!expanded); } }
      else handled = false;
    }
    if (handled) { e.__ui = true; if (e.preventDefault) e.preventDefault(); }
    return handled;
  }
  window.addEventListener('keydown', onKey);

  // =====================================================================
  //                       ACTUALIZACIÓN POR CUADRO
  // =====================================================================
  const lastVals = items.map(() => undefined);
  let statKey = '', dataK = '', statT = 0;
  function update(dt, t) {
    now = t !== undefined ? t : now + dt; dt = Math.min(dt || .016, .1);
    readHead();
    const pres = isPres(); pcMode = !pres;
    if (pcMode !== (parentMode === 'pc')) { cP.dirty = eP.dirty = true; layoutDirty = true; }
    setParent(pres ? 'vr' : 'pc');
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) { toast = ''; cP.dirty = true; } }

    // valores de los ítems (cambios hechos por otros módulos o por teclas)
    let ch = false;
    for (let i = 0; i < items.length; i++) { const v = getV(items[i]); if (v !== lastVals[i]) { lastVals[i] = v; ch = true; } }
    if (ch) cP.dirty = eP.dirty = true;
    statT -= dt;
    if (statT <= 0) {
      statT = .25;
      if (menuOpen) {
        const k = compactStatusKey(); if (k !== statKey) { statKey = k; cP.dirty = true; }
        if (expanded && tab === 'datos') { const dk = dataKey(); if (dk !== dataK) { dataK = dk; eP.dirty = true; } }
      }
    }

    // visibilidad
    const showC = menuOpen && !expanded, showE = menuOpen && expanded;
    cP.holder.visible = showC; eP.holder.visible = showE;

    // posición
    let nh = false, nhC = null, nhE = null;
    overUI = false;
    if (menuOpen) {
      if (pres) {
        placeVR(dt);
        readPads();
        // botones: Y (izq) menú; A/X notas; B (der) menú completo
        if (edge('left', 'b')) { toggleMenu(); haptic('left', .3, 15); }
        if (edge('left', 'a') || edge('right', 'a')) { setNotes(!notesOn); haptic('right', .3, 15); }
        if (edge('right', 'b')) { setExpanded(!expanded); }
      } else { placePC(dt); }
    } else if (pres) { readPads(); if (edge('left', 'b')) { toggleMenu(); snapC = snapE = true; haptic('left', .3, 15); } if (edge('left', 'a') || edge('right', 'a')) setNotes(!notesOn); }

    if (menuOpen && pres) {
      const P = expanded ? eP : cP;
      for (const hd of ['left', 'right']) {
        const h = hands[hd]; if (!h) continue;
        h.ctrl.updateWorldMatrix(true, false); const e = h.ctrl.matrixWorld.elements;
        O.set(e[12], e[13], e[14]); D.set(-e[8], -e[9], -e[10]).normalize();
        let over = false;
        if (!(P === cP && hd === 'left') && hitPanel(P, O, D, drag && drag.src === hd)) {
          over = true; overUI = true;
          h.line.visible = true; h.line.scale.z = hit.t; h.dot.visible = true; h.dot.position.set(hit.x, hit.y, hit.z);
          const r = P === eP ? findE(hit.px, hit.py) : findC(hit.px, hit.py);
          if (!drag) { if (P === eP) nhE = r || nhE; else nhC = r || nhC; }
          if (edge(hd, 'trig')) {
            if (r) { if (r.kind === 'slider') { drag = { src: hd, r }; setSliderFromPx(r, hit.px); } else clickRect(P, r); haptic(hd, .35, 18); }
          }
          if (drag && drag.src === hd && pads[hd].trig) setSliderFromPx(drag.r, hit.px);
        } else { h.line.visible = false; h.dot.visible = false; }
        if (drag && drag.src === hd && !pads[hd].trig) drag = null;
        if (drag && drag.src === hd && !over) { // arrastre fuera del panel: proyectar en el plano
          if (hitPanel(P, O, D, true)) setSliderFromPx(drag.r, hit.px);
        }
        if (drag && drag.src === hd) nhE = drag.r;
      }
    } else if (menuOpen && !pres) {
      for (const h of allHands) { h.line.visible = false; h.dot.visible = false; }
      if (!document.pointerLockElement && mouseIn) {
        const P = expanded ? eP : cP; mouseRay();
        if (hitPanel(P, O, D, false)) { overUI = true; const r = P === eP ? findE(hit.px, hit.py) : findC(hit.px, hit.py); if (P === eP) nhE = r; else nhC = r; }
        dom.style.cursor = (nhE || nhC) ? 'pointer' : '';
      }
    } else { for (const h of allHands) { h.line.visible = false; h.dot.visible = false; } }
    if (nhC !== hovC) { hovC = nhC; cP.dirty = true; }
    if (nhE !== hovE) { hovE = nhE; eP.dirty = true; }

    // opacidad: baja si no se mira ni se apunta (solo VR)
    if (pres) {
      const aC = (hovC || (drag && !expanded)) ? 1 : .42 + .58 * gazeAlpha(cP, .82, .94);
      const aE = (hovE || drag) ? 1 : .45 + .55 * gazeAlpha(eP, .76, .9);
      const k = 1 - Math.exp(-dt * 8);
      setPanelOpacity(cP, cP.alpha + (aC - cP.alpha) * k); setPanelOpacity(eP, eP.alpha + (aE - eP.alpha) * k);
    } else { setPanelOpacity(cP, (hovC ? 1 : .93)); setPanelOpacity(eP, (hovE ? 1 : .96)); }

    // redibujado (solo si cambió)
    if (showC && cP.dirty) drawCompact();
    if (showE && eP.dirty && now - eP.lastDraw >= 0.045) drawExpanded();

    updateNotes(dt);
  }

  // API (los accesores se definen con defineProperties: Object.assign copiaría el valor)
  Object.assign(ui, {
    update, setControllers, onKey, showNote, hideNotes, toggleMenu,
    isOverUI: () => overUI,
    setExpanded: v => setExpanded(!!v),
    toggleExpanded: () => setExpanded(!expanded),
    setNotes,
    // utilidades de prueba/depuración
    debug: { injectPads(p) { injected = p; }, compact: cP, expandedPanel: eP, slots, nrec, setTab(t) { tab = t; page = 0; eP.dirty = true; }, setPage(p) { page = p; eP.dirty = true; }, hands },
  });
  Object.defineProperties(ui, {
    notesEnabled: { get: () => notesOn, set: v => setNotes(v), enumerable: true },
    menuOpen: { get: () => menuOpen, set: v => { menuOpen = !!v; cP.dirty = eP.dirty = true; }, enumerable: true },
    expanded: { get: () => expanded, set: v => setExpanded(!!v), enumerable: true },
    notesRead: { get: () => notesSeen, enumerable: true },
  });
  return ui;
}
