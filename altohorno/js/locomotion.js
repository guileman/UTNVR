// locomotion.js — caminar, escaleras, escalerillas, giro, teleport opcional, viñeta de confort y PC (WASD + ratón).
//
// Convenciones (ver también el informe):
//  * `rig` (Group) es el padre de `camera` y de los mandos. Solo se le aplica yaw (rotation.y) y posición; escala 1.
//    rig.position.y = altura de los PIES (en VR con 'local-floor' la altura de ojos la da el visor).
//  * En PC la cámara cuelga del rig a (0, eyeHeight, 0): el YAW del ratón va en `rig.rotation.y` y el PITCH en
//    `camera.rotation.x` (orden 'YXZ'). Así `rig.position` es siempre la proyección de la cabeza al suelo.
//  * En VR la posición real de la cabeza es camera.position (local al rig, la escribe three.js desde la pose XR).
//    Cada cuadro se compara con la posición resuelta del cuadro anterior: la diferencia es el caminar físico, se
//    pasa por la misma colisión que el stick y el rig se desplaza para que la cabeza quede en la posición válida.
//  * nav.ladders[].facing se interpreta como la normal saliente (lado desde el que se sube, el jugador mira hacia
//    -facing). Igualmente el lado se deduce por geometría al engancharse, así que el signo no es crítico.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createLocomotion({ THREE, renderer, camera, rig, nav, domElement }) {
  const dom = domElement || renderer.domElement;

  // ---------- ajustes (se leen en vivo; ui.js puede cambiarlos) ----------
  const settings = {
    speedVR: 1.8,            // m/s con el stick a fondo
    speedPC: 1.6,            // m/s WASD
    runPC: 3.2,              // m/s con Shift
    accelTau: 0.10,          // s, suavizado de la aceleración
    moveRelative: 'head',    // 'head' | 'controller' (mando izquierdo)
    snapTurn: true,          // true = giro por pasos; false = giro suave
    snapAngle: 30,           // grados por paso
    smoothTurnSpeed: 100,    // grados/s en giro suave
    deadzone: 0.15,
    vignette: true,
    vignetteStrength: 1,     // 0..1.5 multiplicador
    vignetteOnPC: false,
    teleport: false,         // arco con stick derecho hacia adelante
    teleportMaxDist: 10,
    radius: 0.3,             // radio del cilindro de colisión del jugador
    stepUp: 0.55,            // altura máx. que se sube sin escalón (coincide con nav.floorY)
    maxStepDown: 0.7,        // caída máx. por paso (más = se rechaza el movimiento: nunca caer)
    blockedLift: 0.1,        // se pasa a nav.blocked la base = suelo + este valor
    floorSmoothTime: 0.12,   // s, suavizado vertical (amortiguamiento crítico)
    ladders: true,
    ladderSpeed: 1.1,        // m/s
    ladderGrabDist: 0.9,
    ladderStandoff: 0.5,     // distancia de la cabeza al plano de la escalerilla
    eyeHeight: 1.65,         // PC
    mouseSensitivity: 0.0022,
    pointerLockOnClick: true,
    alignYawOnEnter: true,   // al entrar en VR gira el rig para que mires hacia el yaw actual
  };

  // ---------- estado público ----------
  const position = new THREE.Vector3();
  const input = {
    vr: false,
    left: mkHand(), right: mkHand(),
    move: { x: 0, y: 0 },    // x derecha(+), y adelante(+), tras zona muerta (VR: stick izq.; PC: WASD)
    turn: 0,                 // stick derecho x
    run: false,              // Shift (PC)
  };
  function mkHand() {
    // x,y = ejes del stick tal cual (y: adelante = negativo). down = flanco de subida en este cuadro.
    return { connected: false, x: 0, y: 0, click: false, trigger: false, grip: false, a: false, b: false,
      down: { click: false, trigger: false, grip: false, a: false, b: false } };
  }
  const prevBtn = { left: {}, right: {} };

  let enabled = true;
  let lookYaw = 0;           // yaw de la mirada (0 = −Z)
  let pitch = 0;             // PC
  let wasPres = false, vrEnter = false;
  let floorCur = nav.spawn ? nav.spawn.y : 0;   // altura de suelo objetivo bajo los pies
  let yVel = 0;
  let vx = 0, vz = 0;        // velocidad suavizada
  let speedNow = 0;          // m/s reales (para viñeta)
  let moving = false;
  let lastX = 0, lastZ = 0;  // cabeza (pies) resuelta el cuadro anterior
  let snapArmed = true, pulse = 0, vig = 0, turnAmt = 0, slideSign = 1;
  const keys = Object.create(null);

  // escalerilla
  const lad = { on: false, ld: null, side: 1, y: 0, holding: false, cooldown: 0, lockEnd: 0 }; // lockEnd: +1 no salir por arriba, -1 por abajo (hasta soltar el stick)

  // ---------- temporales ----------
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  let hx = 0, hz = 0;        // cabeza en mundo (resultado de headWorld)
  let cx = 0, cz = 0, tmpFy = 0, escape = false;

  camera.rotation.order = 'YXZ';

  // ---------- cabeza ↔ rig ----------
  function headWorld() {
    const c = Math.cos(rig.rotation.y), s = Math.sin(rig.rotation.y);
    const lx = camera.position.x, lz = camera.position.z;
    hx = rig.position.x + c * lx + s * lz;
    hz = rig.position.z - s * lx + c * lz;
  }
  function setHeadTo(x, z) {
    const c = Math.cos(rig.rotation.y), s = Math.sin(rig.rotation.y);
    const lx = camera.position.x, lz = camera.position.z;
    rig.position.x = x - (c * lx + s * lz);
    rig.position.z = z - (-s * lx + c * lz);
  }
  function rotateAboutHead(dy) {
    headWorld(); const x = hx, z = hz;
    rig.rotation.y += dy;
    setHeadTo(x, z);
  }
  function headYawLocal() {
    _e.setFromQuaternion(camera.quaternion, 'YXZ');
    return _e.y;
  }

  // ---------- entrada ----------
  function dzApply(h, x, y) {
    const dz = settings.deadzone, m = Math.hypot(x, y);
    if (m < dz) { h.x = 0; h.y = 0; return; }
    const k = (Math.min(m, 1) - dz) / (1 - dz) / m;
    h.x = x * k; h.y = y * k;
  }
  function readVR() {
    const s = renderer.xr.getSession && renderer.xr.getSession();
    for (const hand of ['left', 'right']) {
      const h = input[hand];
      h.connected = false; h.x = 0; h.y = 0;
      h.click = h.trigger = h.grip = h.a = h.b = false;
    }
    if (s) {
      for (const src of s.inputSources) {
        const hand = src.handedness;
        if ((hand !== 'left' && hand !== 'right') || !src.gamepad) continue;
        const h = input[hand], ax = src.gamepad.axes, b = src.gamepad.buttons;
        h.connected = true;
        // Quest (xr-standard): thumbstick = axes[2], axes[3]; si solo hay 2 ejes, son el stick
        dzApply(h, ax.length >= 4 ? ax[2] || 0 : ax[0] || 0, ax.length >= 4 ? ax[3] || 0 : ax[1] || 0);
        h.trigger = !!(b[0] && b[0].pressed); h.grip = !!(b[1] && b[1].pressed);
        h.click = !!(b[3] && b[3].pressed);
        h.a = !!(b[4] && b[4].pressed); h.b = !!(b[5] && b[5].pressed);
      }
    }
    for (const hand of ['left', 'right']) {
      const h = input[hand], p = prevBtn[hand];
      for (const k of ['click', 'trigger', 'grip', 'a', 'b']) { h.down[k] = h[k] && !p[k]; p[k] = h[k]; }
    }
    input.move.x = input.left.x; input.move.y = -input.left.y;
    input.turn = input.right.x; input.run = false;
  }
  function readPC() {
    let x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), y = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    input.move.x = x; input.move.y = y; input.turn = 0;
    input.run = !!(keys.ShiftLeft || keys.ShiftRight);
    for (const hand of ['left', 'right']) {
      const h = input[hand]; h.connected = false; h.x = h.y = 0; h.click = h.trigger = h.grip = h.a = h.b = false;
      for (const k in h.down) h.down[k] = false;
    }
  }

  // ---------- listeners PC ----------
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);
  const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  const onKeyDown = e => { if (MOVE_KEYS.has(e.code) && !typing(e)) keys[e.code] = true; };
  const onKeyUp = e => { if (MOVE_KEYS.has(e.code)) keys[e.code] = false; };
  const onBlur = () => { for (const k in keys) keys[k] = false; };
  const onMouseMove = e => {
    if (!enabled || renderer.xr.isPresenting || document.pointerLockElement !== dom) return;
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // salto espurio de Chromium
    look(e.movementX, e.movementY);
  };
  const onMouseDown = () => {
    if (!enabled || !settings.pointerLockOnClick || renderer.xr.isPresenting) return;
    if (document.pointerLockElement !== dom && dom.requestPointerLock) { try { dom.requestPointerLock(); } catch (err) { console.error(err); } }
  };
  addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp); addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  dom.addEventListener('mousedown', onMouseDown);

  // mandos (para modo relativo al mando y origen del arco de teleport)
  const ctrls = { left: null, right: null };
  if (renderer.xr.getController) {
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      if (c && c.addEventListener) c.addEventListener('connected', e => { const h = e.data && e.data.handedness; if (h === 'left' || h === 'right') ctrls[h] = c; });
    }
  }

  function look(dx, dy) { // píxeles de ratón → yaw/pitch (PC)
    rig.rotation.y -= dx * settings.mouseSensitivity;
    pitch = clamp(pitch - dy * settings.mouseSensitivity, -1.5, 1.5);
  }

  // ---------- colisión / suelo ----------
  const SLIDE_ROT = [0, 0.2, -0.2, 0.45, -0.45, 0.8, -0.8, 1.2, -1.2].map(v => v * 1); // rad
  function stepOK(x, z) {
    const b = nav.bounds;
    if (b && (x < b.minX + 0.2 || x > b.maxX - 0.2 || z < b.minZ + 0.2 || z > b.maxZ - 0.2)) return false;
    const fy = nav.floorY(x, z, floorCur);
    if (fy === null || fy === undefined || Number.isNaN(fy)) return false;           // sin vacío caminable
    if (fy > floorCur + settings.stepUp + 0.02 || fy < floorCur - settings.maxStepDown) return false; // sin caídas
    if (!escape && nav.blocked(x, z, fy + settings.blockedLift, settings.radius)) return false;
    tmpFy = fy; return true;
  }
  function tryPos(x, z) {
    if (!stepOK(x, z)) return false;
    cx = x; cz = z; floorCur = tmpFy; return true;
  }
  // un micro-paso con deslizamiento: completo → por eje → proyección sobre la tangente del obstáculo
  function slide1(sx, sz) {
    if (tryPos(cx + sx, cz + sz)) return true;
    const l = Math.hypot(sx, sz);
    if (Math.abs(sx) > 0.35 * l && tryPos(cx + sx, cz)) return true;
    if (Math.abs(sz) > 0.35 * l && tryPos(cx, cz + sz)) return true;
    // normal estimada: direcciones sondeadas (r=6 cm) que no son válidas
    let ox = 0, oz = 0; const sx0 = cx, sz0 = cz, fy0 = floorCur;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, dx = Math.cos(a) * 0.06, dz = Math.sin(a) * 0.06;
      if (!stepOK(sx0 + dx, sz0 + dz)) { ox += dx; oz += dz; }
    }
    floorCur = fy0; cx = sx0; cz = sz0;
    const om = Math.hypot(ox, oz);
    if (om < 1e-6) return false;
    ox /= om; oz /= om;
    const into = Math.max(0, sx * ox + sz * oz);
    let px = sx - into * ox, pz = sz - into * oz;
    if (Math.hypot(px, pz) < 0.06 * l) { // exactamente de frente: empuje mínimo de costado (rompe la simetría en obstáculos curvos)
      px = -oz * slideSign * l * 0.06; pz = ox * slideSign * l * 0.06;
    }
    // la normal sondeada es discreta: se prueban pequeñas rotaciones de la dirección proyectada
    for (const a of SLIDE_ROT) {
      const ca = Math.cos(a), sa = Math.sin(a);
      if (tryPos(cx + px * ca - pz * sa, cz + px * sa + pz * ca)) return true;
    }
    slideSign = -slideSign;
    return false;
  }
  function advance(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-7) return;
    const n = Math.ceil(len / 0.08), sx = dx / n, sz = dz / n;
    for (let i = 0; i < n; i++) if (!slide1(sx, sz)) break;
  }

  // ---------- escalerillas ----------
  function ladderHoldXZ(ld, side, out) {
    const fl = Math.hypot(ld.facing.x, ld.facing.z) || 1;
    out.x = ld.base.x + side * (ld.facing.x / fl) * settings.ladderStandoff;
    out.z = ld.base.z + side * (ld.facing.z / fl) * settings.ladderStandoff;
  }
  const _h = { x: 0, z: 0 };
  function tryGrab(dirx, dirz, mag) {
    if (!settings.ladders || !nav.ladders || !nav.ladders.length || lad.cooldown > 0 || mag < 0.5) return;
    const py = rig.position.y;
    for (const ld of nav.ladders) {
      const fl = Math.hypot(ld.facing.x, ld.facing.z) || 1, fx = ld.facing.x / fl, fz = ld.facing.z / fl;
      const dBase = Math.abs(py - ld.base.y), dTop = Math.abs(py - ld.top.y);
      const useTop = dTop < dBase;
      if ((useTop ? dTop : dBase) > 0.5) continue;
      const pt = useTop ? ld.top : ld.base;
      const dx = pt.x - cx, dz = pt.z - cz, dist = Math.hypot(dx, dz);
      if (dist > settings.ladderGrabDist) continue;
      const depth = -dx * fx - dz * fz;                  // (p - pt)·facing
      const lateral = -dx * (-fz) - dz * fx;             // (p - pt)·perp
      if (Math.abs(depth) > 1.1 || Math.abs(lateral) > (ld.width || 0.6) * 0.5 + 0.3) continue;
      if (dist > 0.05 && (dirx * dx + dirz * dz) / dist < 0.5) continue; // debe empujar hacia ella
      const ps = depth >= 0 ? 1 : -1;
      lad.on = true; lad.ld = ld; lad.holding = false; lad.y = py; lad.lockEnd = useTop ? 1 : -1;
      lad.side = useTop ? -ps : ps;
      vx = vz = 0;
      return;
    }
  }
  function validExit(x, z, y) {
    const fy = nav.floorY(x, z, y);
    if (fy === null || fy === undefined || Math.abs(fy - y) > 0.5) return null;
    if (nav.blocked(x, z, fy + settings.blockedLift, settings.radius)) return null;
    return fy;
  }
  function ladderExit(ld, atTop) {
    const pt = atTop ? ld.top : ld.base, fl = Math.hypot(ld.facing.x, ld.facing.z) || 1;
    const s = (atTop ? -1 : 1) * lad.side;
    for (const k of [1, -1]) {                           // intenta el lado esperado y, si no vale, el opuesto
      const x = pt.x + k * s * (ld.facing.x / fl) * 0.75, z = pt.z + k * s * (ld.facing.z / fl) * 0.75;
      const fy = validExit(x, z, pt.y);
      if (fy !== null) {
        setHeadTo(x, z); cx = x; cz = z; floorCur = fy; yVel = 0;
        lad.on = false; lad.ld = null; lad.cooldown = 0.7; vx = vz = 0;
        return true;
      }
    }
    return false;
  }
  function ladderFrame(dt, iy) {
    const ld = lad.ld; headWorld();
    ladderHoldXZ(ld, lad.side, _h);
    if (!lad.holding) {                                   // acercar la cabeza al punto de agarre
      const dx = _h.x - hx, dz = _h.z - hz, d = Math.hypot(dx, dz);
      if (d < 0.06) lad.holding = true;
      else { const st = Math.min(d, 1.5 * dt) / d; rig.position.x += dx * st; rig.position.z += dz * st; }
      speedNow = 0.3;
    } else {
      if (Math.abs(iy) < 0.3) lad.lockEnd = 0;          // tras engancharse en un extremo hay que soltar el stick antes de salir por él
      const dy = iy * settings.ladderSpeed * dt;
      lad.y = clamp(lad.y + dy, ld.base.y, ld.top.y);
      speedNow = Math.abs(dy) / dt;
      if (lad.y >= ld.top.y - 0.02 && iy > 0.3 && lad.lockEnd !== 1 && ladderExit(ld, true)) { /* salió arriba */ }
      else if (lad.y <= ld.base.y + 0.02 && iy < -0.3 && lad.lockEnd !== -1 && ladderExit(ld, false)) { /* salió abajo */ }
    }
    if (lad.on) { rig.position.y = lad.y; floorCur = lad.y; yVel = 0; }
    headWorld(); cx = lastX = hx; cz = lastZ = hz;
  }

  // ---------- teleport por arco ----------
  let arc = null, marker = null, tpValid = false, tpActive = false;
  const ARC_N = 32, tpPt = new THREE.Vector3();
  function ensureTeleportObjs() {
    if (arc) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_N * 3), 3));
    arc = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, depthTest: false }));
    arc.frustumCulled = false; arc.visible = false; arc.renderOrder = 998; arc.raycast = () => {}; arc.name = 'locoTeleportArc';
    const rg = new THREE.RingGeometry(0.18, 0.26, 24); rg.rotateX(-Math.PI / 2);
    marker = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, depthTest: false }));
    marker.visible = false; marker.renderOrder = 998; marker.raycast = () => {}; marker.name = 'locoTeleportMarker';
  }
  function teleportAim() {
    ensureTeleportObjs();
    const host = rig.parent;
    if (!host) return;
    if (arc.parent !== host) { host.add(arc); host.add(marker); }
    // origen y dirección: mando derecho si se conoce; si no, la mirada
    const c = ctrls.right;
    let ox, oy, oz, dx, dy, dz;
    if (c) { const m = c.matrixWorld.elements; ox = m[12]; oy = m[13]; oz = m[14]; dx = -m[8]; dy = -m[9]; dz = -m[10]; }
    else {
      camera.updateMatrixWorld(true); const m = camera.matrixWorld.elements;
      ox = m[12]; oy = m[13]; oz = m[14]; dx = -m[8]; dy = -m[9]; dz = -m[10];
    }
    const sp = 7, dtS = 0.04, pos = arc.geometry.attributes.position.array;
    let vxA = dx * sp, vyA = dy * sp, vzA = dz * sp, px = ox, py = oy, pz = oz, hit = false, n = 0;
    tpValid = false;
    for (let i = 0; i < ARC_N; i++) {
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz; n = i + 1;
      const nx = px + vxA * dtS, ny = py + vyA * dtS, nz = pz + vzA * dtS;
      vyA -= 9.8 * dtS;
      const fy = nav.floorY(nx, nz, py);
      if (fy !== null && fy !== undefined && ny <= fy + 0.02) { // toca el suelo
        px = nx; pz = nz; py = fy; hit = true;
        pos[i * 3 + 3] = px; pos[i * 3 + 4] = py; pos[i * 3 + 5] = pz; n = i + 2;
        break;
      }
      px = nx; py = ny; pz = nz;
    }
    for (let i = n; i < ARC_N; i++) { pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz; }
    arc.geometry.attributes.position.needsUpdate = true;
    if (hit) {
      const b = nav.bounds;
      const inB = !b || (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ);
      headWorld();
      tpValid = inB && Math.hypot(px - hx, pz - hz) <= settings.teleportMaxDist &&
        !nav.blocked(px, pz, py + settings.blockedLift, settings.radius);
      tpPt.set(px, py, pz);
    }
    arc.material.color.setHex(tpValid ? 0x66ccff : 0xff5a4a);
    arc.visible = true;
    marker.visible = hit; marker.position.set(px, py + 0.03, pz);
    marker.material.color.setHex(tpValid ? 0x66ccff : 0xff5a4a);
    tpActive = true;
  }
  function teleportHide() { if (arc) { arc.visible = false; marker.visible = false; } tpActive = false; }

  // ---------- viñeta de confort ----------
  let vigMesh = null;
  function ensureVignette() {
    if (vigMesh) return;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 64, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.4, 'rgba(0,0,0,0.3)');
    gr.addColorStop(0.75, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    vigMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.24, 2.24), mat); // a 0.3 m cubre ±75°
    vigMesh.position.set(0, 0, -0.3); vigMesh.renderOrder = 9999; vigMesh.frustumCulled = false;
    vigMesh.visible = false; vigMesh.raycast = () => {}; vigMesh.name = 'locoVignette';
    camera.add(vigMesh);
  }
  function updateVignette(dt, pres) {
    const on = settings.vignette && (pres || settings.vignetteOnPC);
    let tgt = 0;
    if (on) {
      const ref = settings.speedVR;
      tgt = Math.max(clamp(speedNow / ref, 0, 1) * 0.55, turnAmt * 0.5, pulse) * settings.vignetteStrength;
    }
    pulse = Math.max(0, pulse - dt / 0.3);
    const tau = tgt > vig ? 0.12 : 0.4;
    vig += (tgt - vig) * (1 - Math.exp(-dt / tau));
    if (vig < 0.01 && !on) { if (vigMesh) vigMesh.visible = false; vig = 0; return; }
    if (vig < 0.01) { if (vigMesh) vigMesh.visible = false; return; }
    ensureVignette();
    vigMesh.visible = true;
    const s = 1 - clamp(vig, 0, 1) * 0.72;
    vigMesh.scale.set(s, s, 1);
    vigMesh.material.opacity = Math.min(1, vig * 4);
  }

  // ---------- suavizado vertical ----------
  function smoothY(target, dt) {
    const cur = rig.position.y, diff = cur - target;
    if (Math.abs(diff) > 2) { rig.position.y = target; yVel = 0; return; }
    const st = Math.max(settings.floorSmoothTime, 1e-3), om = 2 / st, x = om * dt;
    const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const tmp = (yVel + om * diff) * dt;
    yVel = (yVel - om * tmp) * ex;
    let out = target + (diff + tmp) * ex;
    if (Math.abs(out - target) < 0.0005 && Math.abs(yVel) < 0.01) { out = target; yVel = 0; }
    rig.position.y = out;
  }

  // ---------- actualización ----------
  function onModeChange(pres) {
    if (pres) { vrEnter = true; }
    else { // salir de VR: la cabeza vuelve al modo PC
      const hy = rig.rotation.y + headYawLocal();
      headWorld(); const x = hx, z = hz;
      rig.rotation.y = hy; camera.position.set(0, settings.eyeHeight, 0); camera.quaternion.identity(); pitch = 0;
      rig.position.x = x; rig.position.z = z;
      lastX = x; lastZ = z;
    }
    wasPres = pres;
  }

  function update(dt, frame) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const pres = !!renderer.xr.isPresenting;
    if (!enabled) { headWorld(); lastX = hx; lastZ = hz; if (vigMesh) vigMesh.visible = false; return; }
    if (pres !== wasPres) onModeChange(pres);

    if (pres) readVR(); else readPC();
    input.vr = pres;

    // PC: la cámara cuelga a la altura de ojos con el pitch del ratón
    if (!pres) { camera.position.set(0, settings.eyeHeight, 0); camera.rotation.set(pitch, 0, 0); }
    else if (vrEnter) { // primer cuadro en VR: la cabeza queda sobre los pies actuales y mirando hacia el yaw actual
      vrEnter = false;
      if (settings.alignYawOnEnter) rig.rotation.y = lookYaw - headYawLocal();
      setHeadTo(position.x, position.z);
      lastX = position.x; lastZ = position.z;
    }

    // --- giro (VR) ---
    turnAmt = 0;
    let aiming = false;
    if (pres) {
      const tx = input.right.x, ty = input.right.y;
      aiming = settings.teleport && !lad.on && ty < -0.7 && Math.abs(tx) < 0.7;
      if (settings.snapTurn) {
        if (snapArmed && Math.abs(tx) > 0.7 && !aiming) {
          rotateAboutHead(-Math.sign(tx) * settings.snapAngle * DEG); snapArmed = false; pulse = 0.7;
        } else if (Math.abs(tx) < 0.3) snapArmed = true;
      } else if (tx && !aiming) {
        rotateAboutHead(-tx * settings.smoothTurnSpeed * DEG * dt); turnAmt = Math.abs(tx);
      }
    }
    // teleport
    if (aiming) teleportAim();
    else if (tpActive) {
      const ok = tpValid; teleportHide();
      if (ok) { teleportTo(tpPt.x, tpPt.y, tpPt.z); pulse = 1; }
    }

    // --- dirección del movimiento ---
    headWorld();
    const hy = rig.rotation.y + (pres ? headYawLocal() : 0);
    lookYaw = hy;
    let heading = hy;
    if (pres && settings.moveRelative === 'controller' && ctrls.left) {
      const m = ctrls.left.matrixWorld.elements, fx = -m[8], fz = -m[10];
      if (Math.hypot(fx, fz) > 0.2) heading = Math.atan2(-fx, -fz);
    }
    const mx = input.move.x, my = input.move.y, mag = Math.min(1, Math.hypot(mx, my));
    const s = Math.sin(heading), c = Math.cos(heading);
    // adelante = (−sin, −cos), derecha = (cos, −sin)
    let dirx = -s * my + c * mx, dirz = -c * my - s * mx;
    const dl = Math.hypot(dirx, dirz); if (dl > 1e-6) { dirx /= dl; dirz /= dl; }
    const top = pres ? settings.speedVR : (input.run ? settings.runPC : settings.speedPC);

    lad.cooldown = Math.max(0, lad.cooldown - dt);
    if (lad.on) {
      ladderFrame(dt, my);
      if (!lad.on) smoothY(floorCur, dt);           // acaba de soltarse: el suavizado vertical sigue
    } else {
      const k = 1 - Math.exp(-dt / Math.max(settings.accelTau, 1e-3));
      vx += (dirx * mag * top - vx) * k; vz += (dirz * mag * top - vz) * k;
      if (mag === 0 && Math.hypot(vx, vz) < 0.02) { vx = 0; vz = 0; }

      headWorld();
      cx = lastX; cz = lastZ;
      escape = !!nav.blocked(cx, cz, floorCur + settings.blockedLift, settings.radius); // si ya está dentro, deja salir
      const dxP = hx - lastX, dzP = hz - lastZ;
      if (Math.hypot(dxP, dzP) > 1.5) { cx = hx; cz = hz; floorCur = nav.floorY(hx, hz, floorCur) ?? floorCur; } // salto de tracking
      else advance(dxP, dzP);                       // caminar físico (con colisión)
      const bx = cx, bz = cz;
      tryGrab(dirx, dirz, mag);
      if (!lad.on) {
        advance(vx * dt, vz * dt);                  // stick / teclado
        speedNow = Math.hypot(cx - bx, cz - bz) / dt;
        setHeadTo(cx, cz);                          // el rig se desplaza por la diferencia
        lastX = cx; lastZ = cz;
        smoothY(floorCur, dt);
      } else { speedNow = 0; lastX = hx; lastZ = hz; }
    }
    moving = speedNow > 0.1 || (lad.on && lad.holding && Math.abs(my) > 0.1);
    headWorld();
    position.set(hx, rig.position.y, hz);
    updateVignette(dt, pres);
  }

  function teleportTo(x, y, z, yaw) {
    lad.on = false; lad.ld = null; vx = vz = 0; yVel = 0; speedNow = 0;
    if (typeof yaw === 'number') { // gira la mirada hacia yaw
      rig.rotation.y = renderer.xr.isPresenting ? yaw - headYawLocal() : yaw;
      lookYaw = yaw;
    }
    setHeadTo(x, z);
    rig.position.y = y; floorCur = y;
    headWorld(); lastX = hx; lastZ = hz; cx = hx; cz = hz;
    position.set(hx, y, hz);
  }

  function setEnabled(b) {
    enabled = !!b;
    if (!enabled) { onBlur(); vx = vz = 0; speedNow = 0; moving = false; teleportHide(); }
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur);
    document.removeEventListener('mousemove', onMouseMove); dom.removeEventListener('mousedown', onMouseDown);
    if (vigMesh) camera.remove(vigMesh);
    if (arc && arc.parent) { arc.parent.remove(arc); marker.parent.remove(marker); }
  }

  // ---------- inicio ----------
  const sp = nav.spawn || { x: 0, y: 0, z: 0, yaw: 0 };
  teleportTo(sp.x, sp.y, sp.z, sp.yaw || 0);
  if (!renderer.xr.isPresenting) camera.position.set(0, settings.eyeHeight, 0);

  return {
    settings, input, position, update, teleportTo, setEnabled, dispose, look,
    get yaw() { return lookYaw; },
    get pitch() { return pitch; },
    get onLadder() { return lad.on; },
    get isMoving() { return moving; },
    get enabled() { return enabled; },
    get pointerLocked() { return document.pointerLockElement === dom; },
    get vignetteIntensity() { return vig; },
    get floorY() { return floorCur; },
  };
}
