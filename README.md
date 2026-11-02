# UTNVR — Simuladores de realidad virtual de la UTN FRSN

Simuladores WebXR (Meta Quest 3; CristaLab también en Quest 2) de la Facultad Regional San Nicolás. Sin build ni dependencias: Three.js 0.169 desde jsDelivr, se publica tal cual en GitHub Pages.

| Carpeta | Qué es |
|---|---|
| `index.html` | **Menú de inicio**: elegí el simulador. |
| `cristalab/` | **CristaLab**: redes cristalinas (CS, BCC, FCC, HCP) y defectos. Ver [`cristalab/`](cristalab/index.html) y el sitio informativo en `cristalab/sitio/`. |
| `altohorno/` | **Alto Horno**: recorrido a escala real (~30 m), animación del proceso y notas explicativas. |
| `tools/` | `serve.mjs` (servidor local) y `browser-test.cjs` (prueba headless con Playwright). |

## Publicar

En **Settings → Pages** elegí **GitHub Actions**. Cada push a `main` publica el sitio. Abrí la URL en el navegador de la Quest, elegí un simulador y tocá **ENTER VR**. Al cambiar de página la sesión VR se cierra: hay que volver a tocar ENTER VR.

## Alto Horno

Modelo a escala real (1 u = 1 m): cimentación, crisol, etalaje, vientre, cuba y garganta, cabezal de doble campana, 4 bajantes de gas, anillo de viento y 18 toberas, piqueras de arrabio y escoria con canales y cuchara torpedo, plataformas con barandas, puente de skips, colector de polvo, 3 estufas Cowper y chimenea.

**Recorrido:** se camina por la nave de colada y se sube por escaleras y pasarelas hasta la plataforma del tragante (y = 36,5 m); hay además dos escalerillas verticales.

**Menú que acompaña:** en VR, un panel compacto en el mando izquierdo con los 8 procesos principales; el menú completo (procesos, datos, controles, glosario) se abre con **B**. **Y** lo muestra u oculta.

**Procesos animados:** carga (skips y doble campana), descenso de la carga y zona cohesiva, viento caliente, combustión en toberas, gas de alto horno, colada, ciclo de estufas, mapa térmico y reacciones por zona; ciclo automático y velocidad de simulación. Las **notas** aparecen al acercarte a cada zona o al activar un proceso.

### Controles

| Quest 3 | Acción |
|---|---|
| Stick izquierdo | Moverse |
| Stick derecho ← → | Girar (30°) |
| Gatillo | Seleccionar con el láser |
| Y (izq.) | Mostrar / ocultar el menú |
| B (der.) | Menú compacto ↔ completo |
| A o X | Ocultar notas |

PC: `W A S D` moverse · ratón mirar (clic para capturar, `C` suelta) · `Shift` correr · `M` menú · `N` notas · `Tab` ampliar · `1`–`8` procesos · `T` térmico · `R` reacciones · `X` corte · `Z` rayos X.

### Parámetros de depuración (URL)

`?debug=1` HUD · `?cam=x,y,z,yawº,pitchº` cámara fija · `?demo=all` todo activo · `?panel=expanded` · `?note=<id>` · `?quality=pc|quest` · `?t=<s>` adelantar la simulación.

## Desarrollo local

```
npm install        # solo three, para pruebas locales
npm run serve      # http://localhost:8080/
node tools/browser-test.cjs --url "altohorno/index.html?cam=22,14,32,35,-8&demo=all" --out tools/out/x.png
```

Con la Quest por USB: `adb reverse tcp:8080 tcp:8080` y abrir `http://localhost:8080/altohorno/` (WebXR exige HTTPS o localhost).

Las cifras de las notas son valores típicos de operación, no de un horno concreto.
