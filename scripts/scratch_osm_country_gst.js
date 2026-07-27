// Genera el `.gst` final para el extracto completo de Ecuador ya procesado (15 capas: 3 niveles de
// calles + edificios + uso de suelo + zonas verdes chicas/grandes + agua + ríos + costa + admin +
// poblaciones + POIs + oneway, ver scratch_osm_country_all.js / _relations.js / _extras.js).
//
// FASE 1 (2026-07-27): este script antes duplicaba la lista de capas y una función `rgb()` con el
// bug de canal invertido (R↔B). Ahora usa `buildCountryLayers()` de `lib/osm/countryMapTemplate.js`
// como ÚNICA fuente de verdad del estilo -- así el fix de color COLORREF y la calibración OSM-Carto
// aplican también acá, y cualquier ajuste futuro se hace en un solo lugar para todos los países.
const fs = require('fs');
const path = require('path');
const { buildGeoSet } = require('../lib/osm/gstWriter');
const { buildCountryLayers } = require('../lib/osm/countryMapTemplate');

const OUT_DIR = path.join(__dirname, 'output', 'osm_ecuador');
// MBR real de Ecuador continental + Galápagos (Geofabrik incluye ambos en el extracto de país).
const BBOX = { south: -5.1, west: -92.1, north: 1.6, east: -75.1 };

const gst = buildGeoSet({
  name: 'ecuador_osm',
  bbox: BBOX,
  layers: buildCountryLayers('EC'),
});
const gstPath = path.join(OUT_DIR, 'ecuador_osm.gst');
fs.writeFileSync(gstPath, gst);
console.log(`Escrito ${gstPath}`);
