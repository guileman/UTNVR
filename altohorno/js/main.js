// Alto Horno VR — UTN FRSN · punto de entrada (Contrato 8).
// Único módulo que importa a los demás: arma renderer/XR/entorno, cablea los módulos y corre el bucle.
// Parámetros de depuración: ?debug=1 ?cam=x,y,z,yawDeg,pitchDeg ?demo=all ?panel=expanded ?note=<id> ?quality=pc|quest ?t=<s>

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- errores en pantalla + consola ----------
let hayError = false;
function mostrarError(titulo, err) {
  const msg = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
  console.error('[AltoHorno] ' + titulo, err);
  hayError = true;
  const box = $('error'); if (!box) return;
  $('errorTitulo').textContent = titulo;
  const pre = document.createElement('pre'); pre.textContent = msg;
  $('errorCuerpo').appendChild(pre);
  box.style.display = 'block';
  const c = $('carga'); if (c) c.classList.add('fuera');
}
addEventListener('error', e => { if (!hayError) mostrarError('Error inesperado', e.error || e.message); else console.error(e.error || e.message); });
addEventListener('unhandledrejection', e => { if (!hayError) mostrarError('Promesa rechazada', e.reason); else console.error(e.reason); });
const estado = t => { const m = $('cargaMsg'); if (m) m.textContent = t; };
const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// ---------- parámetros ----------
const isQuestUA = /OculusBrowser|Quest/i.test(navigator.userAgent);
const quality = params.get('quality') === 'quest' || params.get('quality') === 'pc' ? params.get('quality') : (isQuestUA ? 'quest' : 'pc');
const camParam = (params.get('cam') || '').split(',').map(Number);
const CAM = camParam.length >= 3 && camParam.every(Number.isFinite) ? { x: camParam[0], y: camParam[1], z: camParam[2], yaw: (camParam[3] || 0) * Math.PI / 180, pitch: (camParam[4] || 0) * Math.PI / 180 } : null;
const DEBUG = params.get('debug') === '1';

// ---------- carga de módulos (cada uno por separado para informar todos los fallos) ----------
async function cargarModulos() {
  const defs = [
    ['three', 'three'], ['VRButton', 'three/addons/webxr/VRButton.js'],
    ['furnace.js', './furnace.js'], ['process.js', './process.js'], ['locomotion.js', './locomotion.js'],
    ['ui.js', './ui.js'], ['content.js', './content.js'],
  ];
  const res = await Promise.allSettled(defs.map(([, u]) => import(u)));
  const out = {}; let fallos = 0;
  res.forEach((r, i) => {
    if (r.status === 'fulfilled') out[defs[i][0]] = r.value;
    else { fallos++; mostrarError('No se pudo cargar ' + defs[i][0], r.reason); }
  });
  if (fallos) throw new Error('Fallaron ' + fallos + ' módulo(s); ver detalle arriba.');
  const need = [['furnace.js', 'buildFurnace'], ['process.js', 'createProcess'], ['locomotion.js', 'createLocomotion'], ['ui.js', 'createUI'], ['VRButton', 'VRButton']];
  for (const [m, f] of need) if (typeof out[m][f] !== 'function') throw new Error(`${m} no exporta ${f}()`);
  return out;
}

// ---------- entorno ----------
function crearCielo(THREE, horizonte) {
  const geo = new THREE.SphereGeometry(700, 24, 16);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const cima = new THREE.Color(0x3f6fb0), medio = new THREE.Color(0x8fb4d9), hor = horizonte.clone(), bajo = new THREE.Color(0x6f7680), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 700; // -1..1
    if (h > 0.35) c.lerpColors(medio, cima, Math.min(1, (h - 0.35) / 0.65));
    else if (h > 0) c.lerpColors(hor, medio, h / 0.35);
    else c.lerpColors(hor, bajo, Math.min(1, -h / 0.3));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}
function texGrava(THREE, renderer) {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#6b6862'; g.fillRect(0, 0, S, S);
  let s = 1234567; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 5200; i++) {
    const v = 70 + rnd() * 90 | 0, r = 0.8 + rnd() * 2.2;
    g.fillStyle = `rgb(${v + 6},${v + 3},${v - 4})`;
    g.beginPath(); g.ellipse(rnd() * S, rnd() * S, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, 6.3); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(100, 100); t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// ---------- arranque ----------
async function main() {
  estado('Cargando módulos…');
  const M = await cargarModulos();
  const THREE = M['three'];
  const { VRButton } = M['VRButton'];
  const content = M['content.js'];

  // renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'quest' ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1);
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // aviso si WebXR no está disponible
  const xrmsg = $('xrmsg');
  const avisoXR = t => { xrmsg.textContent = t; xrmsg.style.display = 'block'; };
  if (!navigator.xr) avisoXR(window.isSecureContext ? 'WebXR no está disponible en este navegador: podés recorrer el modelo en modo PC (teclado y mouse).' : 'WebXR requiere HTTPS: abrí la página por una dirección https:// para usar el visor. Mientras tanto funciona el modo PC.');
  else navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (!ok) avisoXR('Este dispositivo no admite realidad virtual inmersiva: usá el modo PC (teclado y mouse).'); }).catch(() => avisoXR('No se pudo consultar WebXR: usá el modo PC.'));

  // escena, cámara y rig (el rig es padre de cámara y mandos; moverlo mueve al jugador)
  const HOR = new THREE.Color(0xb7c6d6);
  const scene = new THREE.Scene();
  scene.background = HOR;
  scene.fog = new THREE.Fog(HOR, 90, 480);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1500);
  camera.position.set(0, 1.7, 0);
  const rig = new THREE.Group(); rig.name = 'rig';
  rig.add(camera); scene.add(rig);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // luces (sin sombras)
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5b5a52, 1.15));
  const sol = new THREE.DirectionalLight(0xfff1dc, 1.9); sol.position.set(40, 90, 30); scene.add(sol);

  // cielo y suelo
  const cielo = crearCielo(THREE, HOR); scene.add(cielo);
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ map: texGrava(THREE, renderer) }));
  suelo.rotation.x = -Math.PI / 2; suelo.position.y = 1.46; suelo.name = 'suelo-grava'; scene.add(suelo);

  // mandos (hijos del rig) con un modelo simple
  const ctrls = [];
  const matMando = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.6, metalness: 0.2 });
  const matAnillo = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x332400, roughness: 0.5 });
  for (let i = 0; i < 2; i++) {
    const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
    const modelo = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.11, 12), matMando); cuerpo.rotation.x = Math.PI / 2 - 0.5; cuerpo.position.set(0, -0.01, 0.04); modelo.add(cuerpo);
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 8, 20), matAnillo); anillo.position.set(0, 0.01, -0.03); anillo.rotation.x = 0.9; modelo.add(anillo);
    grip.add(modelo);
    rig.add(ctrl, grip);
    ctrl.userData.grip = grip; ctrl.userData.index = i;
    ctrl.addEventListener('connected', e => { ctrl.userData.handedness = e.data.handedness; ctrl.userData.gamepad = e.data.gamepad; ctrl.userData.inputSource = e.data; modelo.visible = true; });
    ctrl.addEventListener('disconnected', () => { ctrl.userData.handedness = null; ctrl.userData.gamepad = null; modelo.visible = false; });
    modelo.visible = false;
    ctrls.push(ctrl);
  }

  // módulos
  estado('Construyendo el alto horno…');
  await frame2(); // deja pintar la pantalla de carga antes del trabajo pesado
  const t0 = performance.now();
  const furnace = M['furnace.js'].buildFurnace(THREE, { quality });
  scene.add(furnace.root);
  const tBuild = Math.round(performance.now() - t0);

  // validación blanda de anclas obligatorias
  const req = ['spawn', 'hearthCenter', 'slagLevel', 'ironLevel', 'stockline', 'throat', 'hopperDump', 'bellSmallCenter', 'bellLargeCenter', 'skipBottom', 'skipTop', 'downcomerTop', 'dustCatcherTop', 'dustCatcherBottom', 'dustCatcherGasOut', 'bustleCenter', 'hotBlastMain', 'hotBlastRiser', 'chimneyTop', 'tapIron0', 'tapIron1', 'troughEnd0', 'troughEnd1', 'slagNotch', 'slagTroughEnd', 'torpedoStart', 'torpedoEnd'];
  for (let i = 0; i < 4; i++) req.push('uptake' + i);
  for (let i = 0; i < 18; i++) req.push('tuyere' + i);
  for (let i = 0; i < 3; i++) req.push('stove' + i + 'Top');
  const faltan = req.filter(n => !furnace.anchors?.[n]);
  if (faltan.length) console.warn('[AltoHorno] anclas faltantes en furnace.anchors:', faltan.join(', '));

  estado('Preparando el proceso…');
  await frame2();
  const process = M['process.js'].createProcess({ THREE, scene, furnace, content });
  const loco = M['locomotion.js'].createLocomotion({ THREE, renderer, camera, rig, nav: furnace.nav, domElement: renderer.domElement });
  const ui = M['ui.js'].createUI({ THREE, renderer, scene, camera, rig, process, furnace, content, locomotion: loco });
  ui.setControllers?.(ctrls[0], ctrls[1]);

  // jugador al punto de inicio
  const sp = furnace.nav?.spawn || furnace.anchors?.spawn || { x: 0, y: 5, z: 11, yaw: 0 };
  loco.teleportTo(sp.x, sp.y, sp.z, sp.yaw || 0);
  loco.setEnabled?.(!CAM);

  // cámara fija para capturas
  const poseCam = () => {
    if (!CAM) return;
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    camera.position.set(CAM.x, CAM.y, CAM.z);
    camera.rotation.set(CAM.pitch, CAM.yaw, 0, 'YXZ');
  };
  if (CAM) poseCam();

  // ---------- parámetros de demostración ----------
  const quitarCarga = () => { const c = $('carga'); c.classList.add('fuera'); setTimeout(() => c.remove(), 700); };
  if (params.get('demo') === 'all') {
    for (const it of process.items || []) if (it.type === 'toggle' && it.id !== 'auto' && it.id !== 'xray') process.set(it.id, true);
    process.set('cutaway', true);
  }
  const tAdel = parseFloat(params.get('t'));
  const guard = (nombre, fn) => { let n = 0; return (...a) => { try { fn(...a); } catch (e) { if (n++ < 3) console.error(`[AltoHorno] error en ${nombre}:`, e); } }; };
  const fUpdate = guard('furnace.update', (dt, t) => furnace.update?.(dt, t));
  const pUpdate = guard('process.update', (dt, t) => process.update(dt, t, { playerPos: loco.position }));
  const lUpdate = guard('locomotion.update', (dt, fr) => loco.update(dt, fr));
  const uUpdate = guard('ui.update', (dt, t, info) => ui.update(dt, t, info));
  let tSim = 0;
  if (Number.isFinite(tAdel) && tAdel > 0) { // adelantar la simulación
    const paso = Math.max(0.1, tAdel / 1500); let acc = 0;
    while (acc < tAdel) { fUpdate(paso, tSim); pUpdate(paso, tSim); tSim += paso; acc += paso; }
  }
  if (params.get('panel') === 'expanded') {
    if (ui.setExpanded) ui.setExpanded(true);
    else if (ui.onKey) ui.onKey({ code: 'Tab', key: 'Tab', preventDefault() {}, stopPropagation() {} });
  }
  if (params.get('note')) ui.showNote?.(params.get('note'));

  // teclado hacia la UI (la locomoción lee WASD por su cuenta)
  addEventListener('keydown', e => { try { ui.onKey?.(e); } catch (err) { console.error('[AltoHorno] ui.onKey', err); } });

  // panel de información
  const info = $('info'), infoBtn = $('infoBtn'), mira = $('mira');
  if (content?.INTRO) {
    const I = content.INTRO;
    if (I.title) $('infoTitulo').textContent = I.title;
    if (I.subtitle) $('infoSub').textContent = I.subtitle;
    if (Array.isArray(I.lines) && I.lines.length) $('infoLineas').textContent = I.lines.join(' ');
  }
  const cerrarInfo = () => { info.classList.add('min'); infoBtn.style.display = 'block'; };
  $('infoCerrar').onclick = cerrarInfo;
  infoBtn.onclick = () => { info.classList.remove('min'); infoBtn.style.display = 'none'; };
  if (CAM && params.get('info') !== '1') cerrarInfo();
  if (CAM) infoBtn.style.display = 'none';
  document.addEventListener('pointerlockchange', () => { mira.style.display = document.pointerLockElement ? 'block' : 'none'; if (document.pointerLockElement) cerrarInfo(); });

  // sesión XR
  renderer.xr.addEventListener('sessionstart', () => {
    renderer.xr.setFoveation(1); cerrarInfo(); infoBtn.style.display = 'none';
    loco.teleportTo(loco.position.x, loco.position.y, loco.position.z, loco.yaw);
  });
  renderer.xr.addEventListener('sessionend', () => {
    camera.position.set(0, 1.7, 0); camera.rotation.set(0, 0, 0);
    loco.teleportTo(loco.position.x, loco.position.y, loco.position.z, loco.yaw);
    poseCam();
  });

  // HUD de depuración
  const dbg = $('dbg'); if (DEBUG) dbg.style.display = 'block';
  let fpsAcc = 0, fpsN = 0, fps = 0;

  // ---------- bucle ----------
  let last = performance.now(), tiempo = tSim, nFrame = 0;
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  renderer.setAnimationLoop((ts, xrFrame) => {
    const now = performance.now();
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05); last = now; tiempo += dt; nFrame++;
    const xr = renderer.xr.isPresenting;
    if (!xr) poseCam();
    if (!CAM || xr) lUpdate(dt, xrFrame);
    fUpdate(dt, tiempo);
    pUpdate(dt, tiempo);
    uUpdate(dt, tiempo, { frame: xrFrame || null, xr, session: xr ? renderer.xr.getSession() : null, time: ts });
    if (DEBUG) {
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
        const r = renderer.info.render, m = renderer.info.memory, p = loco.position;
        dbg.textContent = `fps ${fps.toFixed(0)}  calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k\ngeom ${m.geometries}  tex ${m.textures}  q=${quality}\npos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`;
      }
    }
    renderer.render(scene, camera);
  });

  window.__AH = { THREE, scene, camera, rig, furnace, process, ui, loco, renderer, content, params, quality, ready: false, tBuildMs: tBuild, missingAnchors: faltan };
  // listo tras el primer cuadro
  await frame2();
  window.__AH.ready = true;
  quitarCarga();
}

main().catch(e => { if (!hayError) mostrarError('No se pudo iniciar el simulador', e); });
