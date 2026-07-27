// Plantilla de capas para el mapa OSM->MapInfo de un país completo -- Objetivo 3, Fase 1.
// Mismo orden y estilo confirmado y aprobado con Ecuador (2026-07-25): fondo/admin -> áreas
// grandes (bosques/agua) -> costa -> uso de suelo/áreas chicas -> edificios -> poblaciones ->
// calles -> ríos -> POIs -> sentido único. Recordar: en el `.gst`, la capa listada DESPUÉS se
// dibuja ENCIMA. Cualquier cambio acá se aplica a TODOS los países que se generen después --
// ese es el punto de tenerlo en un solo lugar en vez de repetido por país.
//
// Paleta "que se parezca a OSM Carto" (confirmada contra el `.gst` real de Ecuador,
// `C:\MAPS\ECUADOR\Mapinfo\ec.gst`): entero de color = R*65536 + G*256 + B (no es el orden
// COLORREF de Windows).
function rgb(r, g, b) {
  return r * 65536 + g * 256 + b;
}

/**
 * @param {string} code - prefijo corto del país para los nombres de archivo `.TAB`, ej. 'EC', 'CO'.
 * @returns {Array} lista de configs de capa, en el orden real usado por `gstWriter.buildGeoSet`.
 */
function buildCountryLayers(code) {
  const f = (name) => `${name}_${code}_OSM.TAB`;
  return [
    { file: f('Admin'), description: 'Admin boundaries (OSM)', lineColor: rgb(150, 100, 150), lineWidth: 1, autoLabel: false },
    { file: f('GreenBig'), description: 'Forests/parks grandes (OSM)', lineColor: rgb(164, 202, 138), lineWidth: 1, fillColor: rgb(200, 225, 175), autoLabel: false },
    { file: f('Water'), description: 'Water bodies (OSM)', lineColor: rgb(120, 170, 200), lineWidth: 1, fillColor: rgb(170, 211, 223), autoLabel: false },
    { file: f('Coastline'), description: 'Coastline (OSM)', lineColor: rgb(120, 170, 200), lineWidth: 2, autoLabel: false },
    { file: f('LandUse'), description: 'LandUse (OSM)', lineColor: rgb(224, 217, 204), lineWidth: 1, fillColor: rgb(232, 225, 212), zoomMax: 200, autoLabel: false },
    { file: f('Green'), description: 'Green areas (OSM)', lineColor: rgb(164, 202, 138), lineWidth: 1, fillColor: rgb(200, 225, 175), zoomMax: 200, autoLabel: false },
    { file: f('Buildings'), description: 'Buildings (OSM)', lineColor: rgb(189, 172, 156), lineWidth: 1, fillColor: rgb(217, 208, 201), zoomMax: 5 },
    { file: f('Villages'), description: 'Villages (OSM)', zoomMax: 30, labelZoomMax: 30 },
    { file: f('CitiesTowns'), description: 'Cities/Towns (OSM)', labelBold: true, labelSize: 11 },
    { file: f('AllStreets'), description: 'AllStreets (OSM)', lineColor: rgb(153, 153, 153), lineWidth: 1, zoomMax: 10, labelZoomMax: 10 },
    { file: f('Rivers'), description: 'Rivers (OSM)', lineColor: rgb(120, 170, 200), lineWidth: 2, autoLabel: false },
    { file: f('Highway2'), description: 'Highway_2 (OSM)', lineColor: rgb(247, 250, 191), lineWidth: 2, labelZoomMax: 30, thickRoad: true },
    { file: f('Highway1'), description: 'Highway_1 (OSM)', lineColor: rgb(252, 214, 164), lineWidth: 3, labelZoomMax: 60, thickRoad: true },
    { file: f('Poi'), description: 'POIs (OSM)', zoomMax: 3 },
    { file: f('Oneway'), description: 'Oneway streets (OSM)', lineColor: rgb(153, 153, 153), lineWidth: 1, zoomMax: 5, autoLabel: false, showLineDirection: true },
  ];
}

module.exports = { buildCountryLayers, rgb };
