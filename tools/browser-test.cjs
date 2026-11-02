#!/usr/bin/env node
/*
 * browser-test.cjs — prueba headless del simulador (Playwright + Chromium con SwiftShader).
 *
 * Uso (desde cualquier carpeta; requiere `playwright` instalado globalmente: NODE_PATH o require global):
 *   node tools/browser-test.cjs [opciones]
 *
 * Opciones:
 *   --url  "altohorno/index.html?cam=0,8,14,0,-5&demo=all"   página relativa a la raíz servida (def.: altohorno/index.html)
 *   --wait 3000          ms de espera tras el primer cuadro antes de capturar (def.: 3000)
 *   --out  tools/out/x.png   PNG de salida, relativo a la raíz del repo (def.: tools/out/shot.png)
 *   --size 1280x720      tamaño de la ventana (def.: 1280x720)
 *   --root <dir>         raíz del servidor estático (def.: raíz del repo, o sea .. de tools/)
 *   --timeout 90000      ms máx. para que window.__AH.ready sea true (def.: 90000)
 *   --eval "js"          expresión JS a evaluar en la página antes de capturar (se imprime el resultado)
 *   --show-warnings      imprime también console.warn / console.log de la página
 *
 * Qué hace: sirve la raíz por HTTP en un puerto libre; intercepta https://cdn.jsdelivr.net/npm/three@0.169.0/*
 * y lo sirve desde node_modules/three del repo; abre la URL; espera __AH.ready; imprime renderer.info y fps;
 * guarda el PNG. Sale con código 1 ante console.error, pageerror o fallo de carga local; 0 si todo bien.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }
  catch (e2) { console.error('No se encontró el paquete "playwright" (instalalo global: npm i -g playwright).'); process.exit(1); }
}

// ---- argumentos ----
const argv = process.argv.slice(2), A = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) continue;
  const k = a.slice(2), nx = argv[i + 1];
  if (nx === undefined || nx.startsWith('--')) A[k] = true; else { A[k] = nx; i++; }
}
const REPO = path.resolve(__dirname, '..');
const ROOT = path.resolve(A.root || REPO);
const THREE_DIR = path.join(REPO, 'node_modules', 'three');
const URLPATH = A.url || 'altohorno/index.html';
const WAIT = +(A.wait ?? 3000);
const TIMEOUT = +(A.timeout ?? 90000);
const [W, H] = String(A.size || '1280x720').split('x').map(Number);
const OUT = path.resolve(REPO, A.out || 'tools/out/shot.png');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      fs.readFile(f, (err, buf) => {
        if (err) { rsp.writeHead(404); return rsp.end('404'); }
        rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
        rsp.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const errores = [];
  let code = 0;
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    // three desde node_modules local
    const CDN = 'https://cdn.jsdelivr.net/npm/three@0.169.0/';
    await page.route(u => u.href.startsWith(CDN), route => {
      const rel = new URL(route.request().url()).pathname.replace(/^\/npm\/three@0\.169\.0\//, '');
      const f = path.join(THREE_DIR, rel);
      if (!f.startsWith(THREE_DIR) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'no' });
      route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': MIME[path.extname(f)] || 'text/javascript', 'access-control-allow-origin': '*' } });
    });
    // lo demás externo se bloquea (el simulador no debe depender de red)
    await page.route(u => !u.href.startsWith(base) && !u.href.startsWith(CDN) && /^https?:/.test(u.href), r => r.abort());

    page.on('console', m => {
      const t = m.type();
      if (t === 'error') errores.push('console.error: ' + m.text());
      else if (A['show-warnings']) console.log(`[page ${t}] ${m.text()}`);
    });
    page.on('pageerror', e => errores.push('pageerror: ' + (e.stack || e.message)));
    page.on('requestfailed', r => { if (r.url().startsWith(base)) errores.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)); });

    const url = base + URLPATH.replace(/^\//, '');
    console.log('URL:', url);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    try { await page.waitForFunction(() => window.__AH && window.__AH.ready === true, null, { timeout: TIMEOUT, polling: 200 }); }
    catch (e) { errores.push('timeout esperando window.__AH.ready (' + TIMEOUT + ' ms)'); }
    if (WAIT > 0) await page.waitForTimeout(WAIT);

    if (A.eval) {
      try { console.log('eval =>', JSON.stringify(await page.evaluate(A.eval))); }
      catch (e) { errores.push('eval falló: ' + e.message); }
    }

    // renderer.info y fps (medido sobre el contador de cuadros del renderer)
    const stats = await page.evaluate(async () => {
      const AH = window.__AH; if (!AH) return null;
      const r = AH.renderer, i = r.info;
      const f0 = i.render.frame, t0 = performance.now();
      await new Promise(res => setTimeout(res, 2000));
      const fps = (i.render.frame - f0) / ((performance.now() - t0) / 1000);
      return { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, lines: i.render.lines, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : undefined, fps: +fps.toFixed(1), buildMs: AH.tBuildMs, missingAnchors: AH.missingAnchors };
    });
    if (stats) {
      console.log(`renderer.info: calls=${stats.calls} tris=${stats.triangles} lines=${stats.lines} points=${stats.points} geometries=${stats.geometries} textures=${stats.textures} programs=${stats.programs}`);
      console.log(`fps (SwiftShader, solo orientativo): ${stats.fps} · build furnace: ${stats.buildMs} ms`);
      if (stats.missingAnchors && stats.missingAnchors.length) console.log('anclas faltantes:', stats.missingAnchors.join(', '));
    } else console.log('window.__AH no disponible');

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT });
    console.log('PNG:', OUT);
  } catch (e) {
    errores.push('excepción del test: ' + (e.stack || e.message));
  } finally {
    await browser.close(); srv.close();
  }
  if (errores.length) { console.error('\nFALLÓ (' + errores.length + ' error/es):'); for (const e of errores) console.error(' - ' + e); code = 1; }
  else console.log('OK sin errores de consola.');
  process.exit(code);
})();
