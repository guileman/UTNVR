// ============================================================================
//  ALTO HORNO (BLAST FURNACE) A ESCALA REAL  -  OpenSCAD
//  Unidades del modelo: 1 unidad = 1 metro  (ver 'escala' para exportar en mm)
//
//  Altura del horno (solera -> garganta): ~30 m | Diámetro de crisol: 11 m
//  Incluye: cimentación, crisol, etalaje, vientre, cuba, garganta, cabezal de
//  carga, 4 bajantes de gas, anillo de viento + 18 toberas, piqueras y canales
//  de colada, nave de colada, plataformas, puente de skips, 3 estufas Cowper,
//  chimenea, colector de polvo y conducciones.
//
//  Texturas (geométricas, reales en la malla): chapas con costuras y remaches,
//  placas de refrigeración (staves), ladrillo refractario por hileras,
//  rejilla de plataformas, damero (checker) de estufas, juntas de hormigón.
//
//  Render rápido:  F5 (vista previa).  Render final (F6): usar OpenSCAD
//  2023+ con backend "Manifold" (Preferencias > Funciones) o LOD = 0.
// ============================================================================

/* [Opciones] */
LOD = 1;                     // 0 = borrador | 1 = normal | 2 = detalle alto
corte = true;                // cuarto de corte: muestra refractario y carga
interior = true;             // carga interna (coque, mineral, escoria, arrabio)
mostrar_estufas = true;
mostrar_skip = true;
mostrar_plataformas = true;
mostrar_nave_colada = true;
escala = 1;                  // 1 = metros | 1000 = exportar STL en milímetros

$fn = [32, 64, 96][LOD];
$vpr = [62, 0, 35];  $vpt = [-5, 0, 25];  $vpd = 230;

// ---------------------------- COLORES ---------------------------------------
c_acero    = [0.50, 0.51, 0.54];
c_horno    = [0.50, 0.38, 0.31];   // chapa oxidada
c_costura  = [0.27, 0.23, 0.21];
c_hormigon = [0.66, 0.65, 0.62];
c_ladrillo = [0.72, 0.34, 0.22];
c_amarillo = [0.92, 0.76, 0.10];
c_reja     = [0.30, 0.31, 0.33];
c_cobre    = [0.72, 0.45, 0.20];
c_viento   = [0.62, 0.30, 0.20];
c_naranja  = [0.82, 0.45, 0.12];

// ---------------------------- PERFIL DEL HORNO ------------------------------
// Vértices (z): solera/crisol | etalaje | vientre | cuba | garganta | cono sup.
Zs = [4,   9,   12.5, 14,  28,  31,  34 ];
Ro = [5.5, 5.5, 6.2,  6.2, 4.2, 4.2, 1.6];   // radio exterior de chapa
Th = [1.4, 1.4, 0.9,  0.9, 0.7, 0.7, 0.5];   // espesor del refractario
z_sol = 6.5;                                  // cota del fondo del crisol (interior)

function seg(z) = let(c = [for (i = [0 : len(Zs) - 2]) if (z >= Zs[i]) i])
                  len(c) > 0 ? c[len(c) - 1] : 0;
function interp(a, z) = let(i = seg(z),
                            zc = min(max(z, Zs[0]), Zs[len(Zs) - 1]),
                            t = (zc - Zs[i]) / (Zs[i + 1] - Zs[i]))
                        a[i] * (1 - t) + a[i + 1] * t;
function rext(z) = interp(Ro, z);
function rint(z) = interp(Ro, z) - interp(Th, z);

// soldaduras horizontales (cada ~1.5 m)
function zs_sold() = concat(
    [for (i = [0 : len(Zs) - 2])
        let (n = max(1, round((Zs[i + 1] - Zs[i]) / 1.5)))
        for (k = [0 : n - 1]) Zs[i] + (Zs[i + 1] - Zs[i]) * k / n],
    [Zs[len(Zs) - 1]]);

// ---------------------------- UTILIDADES ------------------------------------
module tubo(a, b, d) {
    v = b - a;  L = norm(v);
    if (L > 0.001)
        translate(a)
            rotate([0, acos(min(1, max(-1, v[2] / L))), atan2(v[1], v[0])])
                cylinder(d = d, h = L, $fn = 24);
}
module nudo(p, d) translate(p) sphere(d = d, $fn = 20);
module linea_tubos(pts, d) {
    for (i = [0 : len(pts) - 2]) tubo(pts[i], pts[i + 1], d);
    if (len(pts) > 2) for (i = [1 : len(pts) - 2]) nudo(pts[i], d);
}

// cilindro de chapa con anillos de soldadura y costuras verticales
module cilindro_tex(r, h, paso = 2, costuras = 16, col = c_acero, solido = true) {
    color(col) if (solido) cylinder(r = r, h = h);
    color(c_costura) {
        for (z = [paso : paso : h - 0.01])
            translate([0, 0, z - 0.07]) rotate_extrude()
                translate([r - 0.01, 0]) square([0.08, 0.14]);
        for (k = [0 : costuras - 1])
            rotate(k * 360 / costuras)
                translate([r - 0.01, -0.04, 0]) cube([0.08, 0.08, h]);
    }
}

// ============================================================================
//  1. CIMENTACIÓN
// ============================================================================
module cimentacion() {
    color(c_hormigon) translate([-42, -24, 0]) cube([72, 62, 1.5]);
    // juntas de dilatación de la losa
    color([0.35, 0.35, 0.35]) {
        for (x = [-42 : 6 : 30]) translate([x - 0.03, -24, 1.49]) cube([0.06, 62, 0.02]);
        for (y = [-24 : 6 : 38]) translate([-42, y - 0.03, 1.49]) cube([72, 0.06, 0.02]);
    }
    // pedestal del crisol
    color(c_hormigon) {
        translate([0, 0, 1.5]) cylinder(r = 8, h = 0.4);
        translate([0, 0, 1.9]) cylinder(r = 5.4, h = 1.7);
        for (a = [0 : 22.5 : 359]) rotate(a) translate([6.4, -0.5, 1.9]) cube([1.0, 1.0, 1.7]);
        translate([0, 0, 3.6]) difference() {
            cylinder(r = 7.4, h = 0.4);
            translate([0, 0, -1]) cylinder(r = 4.0, h = 3);
        }
    }
}

// ============================================================================
//  2. CUERPO DEL HORNO (chapa + ladrillo refractario + carga)
// ============================================================================
function rev(v) = [for (i = [len(v) - 1 : -1 : 0]) v[i]];

// superficie interior con juntas de hilada (ladrillo) cada 0.5 m
function pts_int() = [for (k = [0 : 55]) let (zt = 34 - 0.5 * k)
    each (k == 55
          ? [[rint(zt), zt]]
          : [[rint(zt), zt], [rint(zt) + 0.05, zt],
             [rint(zt - 0.06) + 0.05, zt - 0.06], [rint(zt - 0.06), zt - 0.06]])];

module ladrillo2d() polygon(concat(
    [[0, Zs[0]]],
    [for (i = [0 : len(Zs) - 1]) [Ro[i] - 0.06, Zs[i]]],
    pts_int(),
    [[0, z_sol]]));

module chapa2d() polygon(concat(
    [for (i = [0 : len(Zs) - 1]) [Ro[i], Zs[i]]],
    [for (i = [len(Zs) - 1 : -1 : 0]) [Ro[i] - 0.06, Zs[i]]]));

module vacio2d() polygon(concat(
    [[0, z_sol], [Ro[0] - Th[0] - 0.02, z_sol]],
    [for (i = [1 : len(Zs) - 1]) [Ro[i] - Th[i] - 0.02, Zs[i]]],
    [[0, Zs[len(Zs) - 1]]]));

module capa(z0, z1, c) color(c) intersection() {
    rotate_extrude() vacio2d();
    translate([-12, -12, z0]) cube([24, 24, z1 - z0]);
}
module carga() {
    capa(z_sol, 8.5, [1.0, 0.38, 0.05]);        // arrabio líquido
    capa(8.5, 9.3, [0.80, 0.78, 0.60]);         // escoria
    capa(9.3, 14, [0.10, 0.10, 0.10]);          // hombre muerto de coque
    for (i = [0 : 9])                            // capas alternas mineral / coque
        capa(14 + i * 1.65, 14 + (i + 1) * 1.65,
             i % 2 == 0 ? [0.42, 0.26, 0.20] : [0.12, 0.12, 0.12]);
}

module cuna() translate([0, -30, 3.5]) cube([30, 30, 41]);
module cortar() {
    if (corte) difference() { union() { children(); } cuna(); }
    else children();
}

// placas de refrigeración (staves) sobre un tramo troncocónico
module placas(z0, z1, filas, n) {
    h = (z1 - z0) / filas;
    tilt = atan2(rext(z1) - rext(z0), z1 - z0);
    for (f = [0 : filas - 1]) {
        zc = z0 + h * (f + 0.5);
        rc = rext(zc);
        for (a = [0 : n - 1])
            rotate(a * 360 / n + (f % 2) * 180 / n)
                translate([rc + 0.03, 0, zc]) rotate([0, tilt, 0])
                    cube([0.07, 2 * PI * rc / n * 0.9, h * 0.92], center = true);
    }
}

module texturas_horno() {
    N = LOD == 0 ? 12 : 28;
    // costuras horizontales (cordones de soldadura)
    color(c_costura) for (z = zs_sold())
        translate([0, 0, z]) rotate_extrude()
            translate([rext(z) - 0.02, -0.05]) square([0.1, 0.1]);
    // costuras verticales escalonadas
    color(c_costura) for (i = [0 : len(Zs) - 2]) for (a = [0 : N - 1])
        rotate(a * 360 / N + (i % 2) * 180 / N) hull() {
            translate([Ro[i] - 0.01, -0.04, Zs[i]]) cube([0.07, 0.08, 0.01]);
            translate([Ro[i + 1] - 0.01, -0.04, Zs[i + 1] - 0.01]) cube([0.07, 0.08, 0.01]);
        }
    // remaches / pernos hexagonales a ambos lados de cada cordón
    if (LOD >= 1) color([0.22, 0.20, 0.19])
        for (z = zs_sold()) for (dz = [-0.18, 0.18])
            if (z + dz > Zs[0] + 0.1 && z + dz < Zs[len(Zs) - 1] - 0.1) {
                r = rext(z + dz);
                n = round(2 * PI * r / 0.45);
                for (a = [0 : n - 1]) rotate(a * 360 / n)
                    translate([r - 0.02, 0, z + dz]) rotate([0, 90, 0])
                        cylinder(d = 0.09, h = 0.07, $fn = 6);
            }
    // placas de refrigeración en etalaje, vientre y cuba
    if (LOD >= 1) color(c_horno * 0.85) {
        placas(9, 12.5, 5, 36);
        placas(12.5, 14, 2, 36);
        placas(14, 28, 7, 28);
    }
    // anillos de aspersión en el crisol + bajantes de agua
    color(c_acero) {
        for (z = [5.0, 6.5, 8.0]) translate([0, 0, z]) rotate_extrude()
            translate([Ro[0] + 0.25, 0]) circle(d = 0.14, $fn = 12);
        for (a = [0 : 45 : 359]) rotate(a)
            tubo([Ro[0] + 0.25, 0, 4.4], [Ro[0] + 0.25, 0, 8.2], 0.1);
    }
}

module cuerpo() {
    color(c_ladrillo) rotate_extrude() ladrillo2d();
    color(c_horno) rotate_extrude() chapa2d();
    color(c_costura) cylinder(r = Ro[0], h = 0.08);
}

module horno() {
    cortar() {
        cuerpo();
        if (interior) carga();
        texturas_horno();
    }
}

// ============================================================================
//  3. ANILLO DE VIENTO, TOBERAS, PIQUERAS Y CANALES DE COLADA
// ============================================================================
module anillo_viento() {
    color(c_viento) {
        translate([0, 0, 14.2]) rotate_extrude() translate([8.3, 0]) circle(d = 2.0);
        linea_tubos([[-17.5, 0, 30], [-17.5, 0, 14.2], [-8.4, 0, 14.2]], 2.2);
    }
    // bridas del anillo
    color(c_costura) for (a = [0 : 15 : 359]) rotate(a)
        translate([8.3, 0, 14.2]) rotate([90, 0, 0]) rotate_extrude() translate([0.95, 0]) square([0.1, 0.12]);
    // ménsulas de apoyo
    color(c_acero) for (a = [10 : 45 : 359]) rotate(a)
        translate([8.3, 0, 9.3]) cylinder(d = 0.3, h = 4.0, $fn = 16);
}

module toberas() {
    n = 18;
    for (a = [0 : n - 1]) rotate(a * 360 / n + 10) {
        color(c_viento) tubo([8.0, 0, 13.5], [6.2, 0, 10.5], 0.5);
        color(c_acero) translate([rext(10.5) - 0.1, 0, 10.5]) rotate([0, 90, 0]) cylinder(d = 0.9, h = 0.65);
        color(c_acero) translate([6.35, 0, 10.5]) rotate([0, 90, 0]) cylinder(d = 0.55, h = 0.15);
        color(c_cobre) translate([rint(10.5) + 0.1, 0, 10.5]) rotate([0, 90, 0])
            cylinder(d1 = 0.15, d2 = 0.45, h = rext(10.5) - rint(10.5) - 0.1);
    }
}

module canal(L = 9, w = 1.0) {
    difference() {
        hull() {
            translate([0, -w / 2 - 0.15, 6.2]) cube([0.01, w + 0.3, 0.6]);
            translate([L, -w / 2 - 0.15, 5.2]) cube([0.01, w + 0.3, 0.6]);
        }
        hull() {
            translate([-0.1, -w / 2, 6.5]) cube([0.01, w, 0.7]);
            translate([L + 0.1, -w / 2, 5.5]) cube([0.01, w, 0.7]);
        }
    }
    for (x = [3, 8]) translate([x, -0.4, 5.0]) cube([0.3, 0.8, 5.9 - 5.0 - (x / L) * 1.0]);
}

module piqueras() {
    for (a = [250, 290]) rotate(a) {
        color(c_acero) translate([Ro[0] - 0.1, -0.5, 6.7]) cube([0.9, 1.0, 1.0]);       // cañón de tapón
        color(c_ladrillo * 0.7) translate([Ro[0] + 0.7, 0, 0]) canal();
    }
}

module nave_colada() {
    color(c_hormigon) difference() {
        translate([-16, -22, 4.6]) cube([32, 22, 0.4]);
        translate([0, 0, 4]) cylinder(r = 5.6, h = 2);
    }
    color([0.35, 0.35, 0.35])
        for (x = [-16 : 4 : 16]) translate([x - 0.02, -22, 4.99]) cube([0.04, 22, 0.02]);
    color(c_hormigon)
        for (x = [-14 : 7 : 14]) for (y = [-20, -12, -4])
            if (norm([x, y]) > 8.5) translate([x - 0.4, y - 0.4, 1.5]) cube([0.8, 0.8, 3.1]);
}

// ============================================================================
//  4. CABEZAL DE CARGA, BAJANTES DE GAS, COLECTOR DE POLVO
// ============================================================================
module cabezal() {
    color(c_acero) {
        translate([0, 0, 34]) cylinder(r = 1.6, h = 8);
        translate([0, 0, 42]) cylinder(r1 = 1.6, r2 = 3.0, h = 4);
        translate([0, 0, 46]) cylinder(r = 3.0, h = 0.4);
    }
    color(c_costura) for (z = [36, 38, 40]) translate([0, 0, z]) rotate_extrude()
        translate([1.55, 0]) square([0.1, 0.14]);
    // 4 conductos ascendentes + anillo colector
    R = 3.5;
    for (a = [45 : 90 : 315]) rotate(a) {
        translate([R, 0, 31.5]) cilindro_tex(0.75, 10.5, 2.1, 8, c_horno);
        color(c_horno) translate([R, 0, 42]) sphere(d = 1.5);
        color(c_acero) tubo([R, 0, 42], [R, 0, 45], 0.7);               // válvula de purga
        color(c_acero) translate([R, 0, 45]) cylinder(d1 = 0.9, d2 = 0.2, h = 0.7);
    }
    color(c_horno) translate([0, 0, 42]) rotate_extrude() translate([R, 0]) circle(d = 1.4);
    // bajante principal hacia el colector de polvo
    color(c_horno) linea_tubos([[R, 0, 42], [16, 0, 42], [16, 0, 35.5]], 2.2);
    color(c_acero) translate([9, 0, 42]) rotate([0, 90, 0]) cylinder(d = 3, h = 0.5, center = true);
}

module colector_polvo() {
    R = 4.5;
    translate([16, 0, 0]) {
        color(c_hormigon) for (a = [45 : 90 : 315]) rotate(a)
            translate([3.6, 0, 1.5]) cylinder(d = 0.8, h = 9.3, $fn = 16);
        color(c_horno) translate([0, 0, 7]) cylinder(r1 = 0.8, r2 = R, h = 5);
        translate([0, 0, 12]) cilindro_tex(R, 18, 2.25, 16, c_horno);
        color(c_horno) translate([0, 0, 30]) cylinder(r1 = R, r2 = 1.2, h = 5);
        color(c_acero) translate([0, 0, 4.2]) cylinder(r = 0.5, h = 2.9);
        color(c_acero) linea_tubos([[0, 4.2, 27], [0, 12, 27], [0, 12, 3]], 1.8);  // gas limpio
    }
}

// ============================================================================
//  5. PLATAFORMAS Y BARANDILLAS
// ============================================================================
module reja2d(ri, ro) difference() {
    difference() { circle(r = ro); circle(r = ri); }
    if (LOD >= 1) for (a = [0 : 3 : 359]) rotate(a)
        translate([ri + 0.15, -0.012]) square([ro - ri - 0.3, 0.024]);
}

module plataforma(z, ri, ro) {
    translate([0, 0, z]) {
        color(c_reja) linear_extrude(0.08) reja2d(ri, ro);
        color(c_acero) for (a = [0 : 15 : 359]) rotate(a)
            translate([ri, -0.06, -0.35]) cube([ro - ri, 0.12, 0.35]);
        color(c_amarillo) {
            for (a = [0 : 7.5 : 359]) rotate(a)
                translate([ro - 0.05, 0, 0]) cylinder(d = 0.05, h = 1.1, $fn = 8);
            for (h = [0.55, 1.1]) translate([0, 0, h]) rotate_extrude()
                translate([ro - 0.05, 0]) circle(d = 0.05, $fn = 8);
        }
    }
}

module plataformas() {
    for (z = [9.2, 16.5, 23, 30]) plataforma(z, rext(z) + 0.15, max(rext(z) + 2.8, 7.5));
    plataforma(36.5, 5.3, 7.6);
    // columnas de apoyo (r = 6.9 m) desde la losa hasta la plataforma superior
    color(c_acero) for (a = [45, 135, 225, 315]) rotate(a)
        translate([6.9, 0, 1.5]) cylinder(d = 0.5, h = 35, $fn = 16);
}

// ============================================================================
//  6. PUENTE DE SKIPS (celosía inclinada, carriles y vagonetas)
// ============================================================================
ang_skip = 58;
p_top  = [0, 3.5, 47.5];
p_base = [0, 3.5 + (47.5 - 1.8) / tan(ang_skip), 1.8];
function pb(t) = p_base + t * (p_top - p_base);
function u_skip() = (p_top - p_base) / norm(p_top - p_base);

module puente_skip() {
    u = u_skip();
    nu = [0, u[2], -u[1]];           // normal "hacia arriba" dentro del plano del puente
    alt = 1.4;  N = 24;
    color(c_naranja) {
        for (s = [-1, 1]) {
            sx = [s * 1.4, 0, 0];
            for (i = [0 : N]) {
                B = pb(i / N) + sx;  T = B + nu * alt;
                tubo(B, T, 0.22);
                if (i < N) {
                    B2 = pb((i + 1) / N) + sx;  T2 = B2 + nu * alt;
                    tubo(B, B2, 0.3);  tubo(T, T2, 0.3);
                    if (i % 2 == 0) tubo(B, T2, 0.18); else tubo(T, B2, 0.18);
                }
            }
        }
        for (i = [0 : 2 : N]) {
            P = pb(i / N);
            tubo(P + [-1.4, 0, 0], P + [1.4, 0, 0], 0.2);
            tubo(P + [-1.4, 0, 0] + nu * alt, P + [1.4, 0, 0] + nu * alt, 0.2);
        }
    }
    // carriles
    color(c_acero) for (s = [-1, 1]) tubo(p_base + [s * 0.6, 0, 0] + nu * 0.15, p_top + [s * 0.6, 0, 0] + nu * 0.15, 0.14);
    // vagonetas (skips)
    for (t = [0.18, 0.62]) translate(pb(t) + nu * 0.95) rotate([atan2(u[2], u[1]), 0, 0]) {
        color([0.25, 0.25, 0.28]) cube([1.5, 3.0, 1.1], center = true);
        color(c_costura) translate([0, 0, 0.5]) cube([1.6, 3.1, 0.12], center = true);
    }
    // caballetes de apoyo
    color(c_naranja) for (t = [0.12, 0.30, 0.48, 0.66, 0.84]) {
        b = pb(t);  y = b[1];  zz = b[2] * 0.5;
        for (s = [-1, 1]) tubo([s * 1.4, y, 1.5], [s * 1.4, y, b[2]], 0.45);
        tubo([-1.4, y, zz], [1.4, y, zz], 0.25);
        tubo([-1.4, y, 1.5], [1.4, y, zz], 0.2);
        tubo([1.4, y, 1.5], [-1.4, y, zz], 0.2);
    }
    color([0.15, 0.15, 0.15]) translate([-2.5, p_base[1] - 2, 1.5]) cube([5, 6, 0.4]);   // foso
}

// ============================================================================
//  7. ESTUFAS COWPER, CHIMENEA Y CONDUCCIONES
// ============================================================================
module perfil_estufa(R, H, e = 0) {
    Re = R - e;
    polygon(concat([[0, 0], [Re, 0]],
        [for (a = [0 : 10 : 90]) [Re * cos(a), H + 0.6 * Re * sin(a)]]));
}
// damero de ladrillos (celdas cuadradas) de la cámara de regeneración
module damero2d(r) difference() {
    intersection() { circle(r = r); translate([-1.0, -r]) square([2 * r, 2 * r]); }
    for (i = [-14 : 14]) for (j = [-14 : 14])
        translate([i * 0.28, j * 0.28]) square(0.13, center = true);
}

module estufa(cut = false) {
    R = 4;  H = 32;
    difference() {
        union() {
            color(c_horno) rotate_extrude()
                difference() { perfil_estufa(R, H); perfil_estufa(R, H, 0.08); }
            cilindro_tex(R, H, 2.2, 20, c_costura, false);
            color(c_costura) translate([0, 0, H]) rotate_extrude()
                translate([R - 0.01, 0]) square([0.1, 0.14]);
            if (cut) {
                color(c_ladrillo) rotate_extrude()
                    difference() { perfil_estufa(R, H, 0.08); perfil_estufa(R, H, 0.7); }
                color(c_ladrillo * 0.85) translate([0, 0, 0.2]) linear_extrude(H - 6) damero2d(R - 0.7);
                color(c_ladrillo) translate([-1.15, -R + 0.7, 0.2]) cube([0.15, 2 * R - 1.4, H - 4]);
            }
        }
        if (cut) translate([-R - 2, -R - 2, -1]) cube([2 * R + 4, R + 2, H + R + 3]);
    }
    color(c_hormigon) translate([0, 0, -0.8]) cylinder(r = R + 0.5, h = 0.8);
}

ys_estufa = [-12, 0, 12];
module estufas() {
    for (i = [0 : 2]) translate([-24, ys_estufa[i], 2.3]) estufa(cut = corte && i == 0);
    // colector de aire caliente y ramales
    color(c_viento) {
        linea_tubos([[-17.5, -12, 30], [-17.5, 12, 30]], 2.2);
        nudo([-17.5, -12, 30], 2.2);  nudo([-17.5, 12, 30], 2.2);
        for (y = ys_estufa) {
            linea_tubos([[-20, y, 30], [-17.5, y, 30]], 1.6);
            color(c_acero) translate([-18.8, y, 30]) rotate([0, 90, 0]) cylinder(d = 2.4, h = 0.4, center = true);
        }
    }
    // conductos de humos hacia la chimenea
    color(c_acero) {
        for (y = ys_estufa) tubo([-28, y, 3.5], [-30, y, 3.5], 1.4);
        linea_tubos([[-30, -12, 3.5], [-30, 12, 3.5]], 1.8);
        tubo([-30, 0, 3.5], [-33, 0, 3.5], 1.8);
    }
}

module chimenea() {
    translate([-34, 0, 1.5]) {
        color(c_hormigon) cylinder(r = 3.2, h = 1);
        for (i = [0 : 9])
            translate([0, 0, 1 + i * 6.5])
                color(i % 2 == 0 ? [0.75, 0.15, 0.12] : [0.95, 0.95, 0.95])
                    cylinder(r1 = 2.6 - i * 0.09, r2 = 2.6 - (i + 1) * 0.09, h = 6.5);
    }
}

// ============================================================================
//  ENSAMBLE
// ============================================================================
module alto_horno() {
    cimentacion();
    horno();
    anillo_viento();
    toberas();
    piqueras();
    cabezal();
    colector_polvo();
    if (mostrar_nave_colada) nave_colada();
    if (mostrar_plataformas) plataformas();
    if (mostrar_skip) puente_skip();
    if (mostrar_estufas) { estufas(); chimenea(); }
}

scale(escala) alto_horno();
