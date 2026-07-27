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
    // AllStreets (calles locales/residenciales): en OSM-Carto es blanco con casing gris. Sin casing
    // todavía (Fase 2) usamos el gris del casing #bbbbbb para que la línea se lea sobre el fondo.
    { file: f('AllStreets'), description: 'AllStreets (OSM)', lineColor: rgb(187, 187, 187), lineWidth: 1, zoomMax: 10, labelZoomMax: 10 },
    // Rivers: línea de agua
    { file: f('Rivers'), description: 'Rivers (OSM)', lineColor: rgb(150, 195, 210), lineWidth: 2, autoLabel: false },
    // Highway2 (secundarias/terciarias): OSM-Carto @secondary-fill #f7fabf
    { file: f('Highway2'), description: 'Highway_2 (OSM)', lineColor: rgb(247, 250, 191), lineWidth: 2, labelZoomMax: 30, thickRoad: true },
    // Highway1 (principales): OSM-Carto @primary-fill #fcd6a4
    { file: f('Highway1'), description: 'Highway_1 (OSM)', lineColor: rgb(252, 214, 164), lineWidth: 3, labelZoomMax: 60, thickRoad: true },
    { file: f('Poi'), description: 'POIs (OSM)', zoomMax: 3 },
    // Oneway: overlay de flechas de sentido; mismo gris que AllStreets
    { file: f('Oneway'), description: 'Oneway streets (OSM)', lineColor: rgb(187, 187, 187), lineWidth: 1, zoomMax: 5, autoLabel: false, showLineDirection: true },
  ];
}

module.exports = { buildCountryLayers, rgb };
