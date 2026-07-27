// Plantilla de capas para el mapa OSM->MapInfo de un país completo -- Objetivo 3, Fase 1.
// Mismo orden y estilo confirmado y aprobado con Ecuador (2026-07-25): fondo/admin -> áreas
// grandes (bosques/agua) -> costa -> uso de suelo/áreas chicas -> edificios -> poblaciones ->
// calles -> ríos -> POIs -> sentido único. Recordar: en el `.gst`, la capa listada DESPUÉS se
// dibuja ENCIMA. Cualquier cambio acá se aplica a TODOS los países que se generen después --
// ese es el punto de tenerlo en un solo lugar en vez de repetido por país.
//
// ─── FASE 1 (2026-07-27): color COLORREF + calibración OSM-Carto ───────────────────────────────
// (1) BUG DE COLOR CORREGIDO. MapInfo guarda el color como COLORREF de Windows (0x00BBGGRR): el
//     byte MÁS BAJO es Rojo, el del medio Verde, el alto Azul. La versión anterior de `rgb()`
//     empaquetaba `r*65536 + g*256 + b` (byte bajo = Azul), lo que INVERTÍA los canales Rojo y
//     Azul en TODAS las capas (el agua azul se veía tostada, las vías amarillas se veían cian,
//     etc.). Ahora `rgb()` empaqueta el COLORREF correcto -- validado contra
//     `reference/gstParser.js`, que decodifica `r = n & 0xff; g = (n>>8)&0xff; b = (n>>16)&0xff`.
//     Nota: la mayoría de los valores (agua #aad3df, edificios #d9d0c9, primary #fcd6a4,
//     secondary #f7fabf) YA eran los correctos de OSM-Carto -- solo se escribían mal codificados.
// (2) PALETA calibrada contra OSM-Carto (github.com/gravitystorm/openstreetmap-carto -- el estilo
//     real de openstreetmap.org). Cada color lleva su hex y su origen. La jerarquía de anchos de
//     calle y el "casing" (borde + relleno) son de la FASE 2; acá solo se tocan los colores.
function rgb(r, g, b) {
  return r + (g << 8) + (b << 16); // COLORREF (0x00BBGGRR): byte bajo = R. == r + g*256 + b*65536
}

/**
 * @param {string} code - prefijo corto del país para los nombres de archivo `.TAB`, ej. 'EC', 'CO'.
 * @returns {Array} lista de configs de capa, en el orden real usado por `gstWriter.buildGeoSet`.
 */
function buildCountryLayers(code) {
  const f = (name) => `${name}_${code}_OSM.TAB`;
  return [
    // Admin: OSM-Carto @admin-boundaries #8d618b (morado)
    { file: f('Admin'), description: 'Admin boundaries (OSM)', lineColor: rgb(141, 97, 139), lineWidth: 1, autoLabel: false },
    // GreenBig (bosques/parques grandes): OSM-Carto @forest #add19e; borde más oscuro
    { file: f('GreenBig'), description: 'Forests/parks grandes (OSM)', lineColor: rgb(140, 175, 125), lineWidth: 1, fillColor: rgb(173, 209, 158), autoLabel: false },
    // Water: OSM-Carto @water-color #aad3df; borde apenas más oscuro
    { file: f('Water'), description: 'Water bodies (OSM)', lineColor: rgb(150, 195, 210), lineWidth: 1, fillColor: rgb(170, 211, 223), autoLabel: false },
    // Coastline: línea de agua
    { file: f('Coastline'), description: 'Coastline (OSM)', lineColor: rgb(150, 195, 210), lineWidth: 2, autoLabel: false },
    // LandUse (catch-all landuse=*): OSM-Carto @residential #e0dfdf (gris neutro)
    { file: f('LandUse'), description: 'LandUse (OSM)', lineColor: rgb(213, 212, 212), lineWidth: 1, fillColor: rgb(224, 223, 223), zoomMax: 200, autoLabel: false },
    // Green (zonas verdes chicas): OSM-Carto @park #c8facc
    { file: f('Green'), description: 'Green areas (OSM)', lineColor: rgb(160, 215, 165), lineWidth: 1, fillColor: rgb(200, 250, 204), zoomMax: 200, autoLabel: false },
    // Buildings: OSM-Carto @building-fill #d9d0c9, @building-line ≈ darken 15% #b8b1ab
    { file: f('Buildings'), description: 'Buildings (OSM)', lineColor: rgb(184, 177, 171), lineWidth: 1, fillColor: rgb(217, 208, 201), zoomMax: 5 },
    { file: f('Villages'), description: 'Villages (OSM)', zoomMax: 30, labelZoomMax: 30 },
    { file: f('CitiesTowns'), description: 'Cities/Towns (OSM)', labelBold: true, labelSize: 11 },
    // Rivers: línea de agua -- va DEBAJO de las calles (las calles se dibujan encima, como puentes)
    { file: f('Rivers'), description: 'Rivers (OSM)', lineColor: rgb(150, 195, 210), lineWidth: 2, autoLabel: false },

    // ─── FASE 2: CALLES CON "CASING" (borde oscuro debajo + relleno claro encima) ──────────────
    // Técnica cartográfica de OSM: cada clase de vía se dibuja DOS veces sobre el MISMO `.TAB` --
    // primero el "casing" (trazo más ANCHO, color OSCURO) y encima el "fill" (trazo más ANGOSTO,
    // color CLARO). Se listan TODOS los casings primero y luego TODOS los fills, para que en los
    // cruces los rellenos se fundan sin que el borde corte por encima (orden = look de osm.org).
    // Pen SÓLIDO (sin patrón 193) para controlar el efecto con dos trazos. Jerarquía de grosor:
    // calles < avenidas < principales. Colores de casing = OSM-Carto `road-colors-generated.mss`.
    // 6 clases OSM (motorway/trunk/primary/secondary/tertiary/residential), cada una con su color
    // y casing reales de OSM-Carto. Orden: TODOS los casings (de menor a mayor clase) y luego TODOS
    // los fills (mismo orden) -> en los cruces la vía mayor tapa a la menor, sin bordes cortados.
    // -- casings (debajo, sin etiqueta) --
    { file: f('AllStreets'), description: 'Residential casing (OSM)', lineColor: rgb(187, 187, 187), lineWidth: 3, zoomMax: 10, autoLabel: false }, // @residential-casing #bbb
    { file: f('Tertiary'), description: 'Tertiary casing (OSM)', lineColor: rgb(143, 143, 143), lineWidth: 4, autoLabel: false },   // @tertiary-casing #8f8f8f
    { file: f('Secondary'), description: 'Secondary casing (OSM)', lineColor: rgb(112, 125, 5), lineWidth: 5, autoLabel: false },   // @secondary-casing #707d05
    { file: f('Primary'), description: 'Primary casing (OSM)', lineColor: rgb(160, 107, 0), lineWidth: 6, autoLabel: false },       // @primary-casing #a06b00
    { file: f('Trunk'), description: 'Trunk casing (OSM)', lineColor: rgb(200, 78, 47), lineWidth: 7, autoLabel: false },           // @trunk-casing #c84e2f
    { file: f('Motorway'), description: 'Motorway casing (OSM)', lineColor: rgb(220, 42, 103), lineWidth: 7, autoLabel: false },    // @motorway-casing #dc2a67
    // -- fills (encima, con etiqueta) --
    { file: f('AllStreets'), description: 'Residential (OSM)', lineColor: rgb(255, 255, 255), lineWidth: 1, zoomMax: 10, labelZoomMax: 10 },   // blanco
    { file: f('Tertiary'), description: 'Tertiary (OSM)', lineColor: rgb(255, 255, 255), lineWidth: 2, labelZoomMax: 20 },          // @tertiary-fill #ffffff
    { file: f('Secondary'), description: 'Secondary (OSM)', lineColor: rgb(247, 250, 191), lineWidth: 3, labelZoomMax: 30 },        // @secondary-fill #f7fabf
    { file: f('Primary'), description: 'Primary (OSM)', lineColor: rgb(252, 214, 164), lineWidth: 4, labelZoomMax: 60 },            // @primary-fill #fcd6a4
    { file: f('Trunk'), description: 'Trunk (OSM)', lineColor: rgb(249, 178, 156), lineWidth: 5, labelZoomMax: 80 },                // @trunk-fill #f9b29c
    { file: f('Motorway'), description: 'Motorway (OSM)', lineColor: rgb(232, 146, 162), lineWidth: 5, labelZoomMax: 100 },         // @motorway-fill #e892a2
    { file: f('Poi'), description: 'POIs (OSM)', zoomMax: 3 },
    // Oneway: capa APARTE (solo tramos oneway=yes/1/-1), dibujada ENCIMA, con la FLECHA de sentido
    // (SHOWLINEDIRECTION=TRUE, sigue el sentido de digitalización de la vía). Grosor 2 para que la
    // flecha se vea; color un poco más marcado que la calle normal.
    { file: f('Oneway'), description: 'Oneway streets (OSM)', lineColor: rgb(150, 150, 150), lineWidth: 2, zoomMax: 5, autoLabel: false, showLineDirection: true },
  ];
}

module.exports = { buildCountryLayers, rgb };
