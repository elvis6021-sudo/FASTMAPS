// Genera el `.gst` final para el extracto completo de Ecuador ya procesado (7 capas: 3 niveles de
// calles + edificios + uso de suelo + zonas verdes + POIs, ver scratch_osm_country_all.js).
const fs = require('fs');
const path = require('path');
const { buildGeoSet } = require('../lib/osm/gstWriter');

const OUT_DIR = path.join(__dirname, 'output', 'osm_ecuador');
// MBR real de Ecuador continental + Galápagos (Geofabrik incluye ambos en el extracto de país).
const BBOX = { south: -5.1, west: -92.1, north: 1.6, east: -75.1 };

// Paleta pedida 2026-07-25: "que se parezca a OSM" -- mismos tonos que el estilo estándar
// "OSM Carto" (openstreetmap.org por defecto): crema urbano, verde parques, arena edificios,
// naranja/amarillo avenidas. Empaquetado confirmado real contra el `.gst` de Ecuador
// (`C:\MAPS\ECUADOR\Mapinfo\ec.gst`): entero = R*65536 + G*256 + B (NO el orden COLORREF de
// Windows) -- ej. Highway_1 real = 15790080 = RGB(240,240,0), un amarillo/oliva claro.
function rgb(r, g, b) {
  return r * 65536 + g * 256 + b;
}

const gst = buildGeoSet({
  name: 'ecuador_osm',
  bbox: BBOX,
  layers: [
    // Orden: fondo (país/admin) -> áreas grandes (bosques/agua) -> uso de suelo/áreas chicas ->
    // edificios -> calles -> ríos -> POIs. Recordar: en este `.gst`, la capa listada DESPUÉS se
    // dibuja ENCIMA (mismo criterio ya confirmado con el `.gst` real de Ecuador).
    // `autoLabel: false` en las capas de fondo/alta densidad a nivel país -- confirmado real
    // (2026-07-25) que el "mapa se ve raro/no se puede ver" era el auto-etiquetado de TODAS las
    // capas mostrando texto a la vez, no una rotación (el contorno de Ecuador ya se confirmó bien
    // orientado). Etiquetas solo donde importan de verdad: avenidas/calles principales, edificios
    // (de cerca) y POIs.
    { file: 'Admin_EC_OSM.TAB', description: 'Admin boundaries (OSM)', lineColor: rgb(150, 100, 150), lineWidth: 1, autoLabel: false },
    { file: 'GreenBig_EC_OSM.TAB', description: 'Forests/parks grandes (OSM)', lineColor: rgb(164, 202, 138), lineWidth: 1, fillColor: rgb(200, 225, 175), autoLabel: false },
    { file: 'Water_EC_OSM.TAB', description: 'Water bodies (OSM)', lineColor: rgb(120, 170, 200), lineWidth: 1, fillColor: rgb(170, 211, 223), autoLabel: false },
    // Línea de costa -- siempre visible (es LA referencia geográfica más importante para
    // orientarse en un país costero como Ecuador), sin etiqueta propia (no tiene nombre).
    { file: 'Coastline_EC_OSM.TAB', description: 'Coastline (OSM)', lineColor: rgb(120, 170, 200), lineWidth: 2, autoLabel: false },
    { file: 'LandUse_EC_OSM.TAB', description: 'LandUse (OSM)', lineColor: rgb(224, 217, 204), lineWidth: 1, fillColor: rgb(232, 225, 212), zoomMax: 200, autoLabel: false },
    { file: 'Green_EC_OSM.TAB', description: 'Green areas (OSM)', lineColor: rgb(164, 202, 138), lineWidth: 1, fillColor: rgb(200, 225, 175), zoomMax: 200, autoLabel: false },
    { file: 'Buildings_EC_OSM.TAB', description: 'Buildings (OSM)', lineColor: rgb(189, 172, 156), lineWidth: 1, fillColor: rgb(217, 208, 201), zoomMax: 5 },
    // Poblaciones -- pedido explícito "para no perderse al alejar el zoom". Aldeas/caseríos solo
    // de cerca (16mil son demasiados para verlos todos a nivel país); ciudades/pueblos SIEMPRE
    // visibles y con letra más grande/negrita, igual que un mapa real necesita para orientarse.
    { file: 'Villages_EC_OSM.TAB', description: 'Villages (OSM)', zoomMax: 30, labelZoomMax: 30 },
    { file: 'CitiesTowns_EC_OSM.TAB', description: 'Cities/Towns (OSM)', labelBold: true, labelSize: 11 },
    // Blanco puro (como OSM real) quedaría invisible acá -- nuestro `.gst` solo soporta 1 PEN por
    // capa (sin el "casing" gris + relleno blanco de 2 trazos que usa OSM de verdad), así que un
    // gris medio es el mejor compromiso visible sin ese efecto de doble trazo.
    { file: 'AllStreets_EC_OSM.TAB', description: 'AllStreets (OSM)', lineColor: rgb(153, 153, 153), lineWidth: 1, zoomMax: 10, labelZoomMax: 10 },
    { file: 'Rivers_EC_OSM.TAB', description: 'Rivers (OSM)', lineColor: rgb(120, 170, 200), lineWidth: 2, autoLabel: false },
    // La LÍNEA sigue visible a cualquier zoom (son las avenidas/rutas principales, tiene sentido
    // verlas desde lejos) -- el NOMBRE recién aparece zoomeado (si no, 44mil textos saturan el
    // país entero, ver captura real 2026-07-25).
    { file: 'Highway2_EC_OSM.TAB', description: 'Highway_2 (OSM)', lineColor: rgb(247, 250, 191), lineWidth: 2, labelZoomMax: 30, thickRoad: true },
    { file: 'Highway1_EC_OSM.TAB', description: 'Highway_1 (OSM)', lineColor: rgb(252, 214, 164), lineWidth: 3, labelZoomMax: 60, thickRoad: true },
    { file: 'Poi_EC_OSM.TAB', description: 'POIs (OSM)', zoomMax: 3 },
    // Flechas de sentido único -- capa APARTE (solo los tramos oneway=yes/1/-1), dibujada ENCIMA
    // de las calles normales, con SHOWLINEDIRECTION prendido -- así solo estos tramos muestran
    // flecha, no toda la red mezclada. Sin relleno propio (transparente, mismo color que
    // AllStreets) para no duplicar visualmente la línea, solo agregar la flecha.
    { file: 'Oneway_EC_OSM.TAB', description: 'Oneway streets (OSM)', lineColor: rgb(153, 153, 153), lineWidth: 1, zoomMax: 5, autoLabel: false, showLineDirection: true },
  ],
});
const gstPath = path.join(OUT_DIR, 'ecuador_osm.gst');
fs.writeFileSync(gstPath, gst);
console.log(`Escrito ${gstPath}`);
