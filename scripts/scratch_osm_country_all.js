// País completo, TODAS las capas de esta fase (calles en 3 niveles, edificios, uso de suelo,
// zonas verdes, POIs) -- versión optimizada: una sola pasada de `ways` para todos los grupos +
// una sola pasada de nodos para la unión de IDs (ver `parseOsmPbfWaysMulti` en osmPbfParser.js).
// Se corre DESPUÉS de validar que la extracción de calles sola funciona bien (pedido explícito
// del usuario: probar 1 capa primero).
const path = require('path');
const { parseOsmPbfWaysMulti, collectTaggedNodes } = require('../lib/osm/osmPbfParser');
const { writeStreetsTab, ROAD_CLASSES } = require('../lib/osm/mapInfoStreetsWriter');
const { writePolygonTab } = require('../lib/osm/mapInfoPolygonWriter');
const { writePointTab } = require('../lib/osm/mapInfoPointWriter');

const PBF_PATH = path.join(__dirname, 'output', 'osm_ecuador', 'ecuador.osm.pbf');
const OUT_DIR = path.join(__dirname, 'output', 'osm_ecuador');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const t0 = Date.now();

  log('Pasada única de ways (streets/buildings/landuse/green) + pasada de nodos...');
  const groups = await parseOsmPbfWaysMulti(PBF_PATH, {
    streets: (t) => !!t.highway,
    buildings: (t) => !!t.building,
    landuse: (t) => !!t.landuse && t.landuse !== 'forest' && t.landuse !== 'grass',
    green: (t) => t.leisure === 'park' || t.landuse === 'forest' || t.landuse === 'grass' || t.natural === 'wood',
  });
  log(`ways: streets=${groups.streets.ways.length} buildings=${groups.buildings.ways.length} landuse=${groups.landuse.ways.length} green=${groups.green.ways.length}`);
  log(`nodos resueltos (compartidos): ${groups.streets.nodes.size}`);
  log('Memoria: ' + JSON.stringify(process.memoryUsage()));

  // FASE 2: un `.TAB` por CLASE OSM (motorway/trunk/primary/secondary/tertiary/residential), para
  // darle a cada una su color + "casing" reales en el `.gst` (ver countryMapTemplate.js).
  // residential conserva el nombre `AllStreets` (calles locales).
  const CLASS_FILE = {
    motorway: 'Motorway', trunk: 'Trunk', primary: 'Primary',
    secondary: 'Secondary', tertiary: 'Tertiary', residential: 'AllStreets',
  };
  for (const roadClass of ROAD_CLASSES) {
    const label = CLASS_FILE[roadClass];
    const r = writeStreetsTab(groups.streets, path.join(OUT_DIR, `${label}_EC_OSM.TAB`), `${label}_EC_OSM`, { roadClass });
    log(`${label} (${roadClass}): ${r.wayCount} escritas, ${r.skipped} descartadas`);
  }

  const buildingsResult = writePolygonTab(groups.buildings, path.join(OUT_DIR, 'Buildings_EC_OSM.TAB'), 'Buildings_EC_OSM');
  log(`Buildings: ${buildingsResult.wayCount} escritos, ${buildingsResult.skipped} descartados`);

  const landuseResult = writePolygonTab(groups.landuse, path.join(OUT_DIR, 'LandUse_EC_OSM.TAB'), 'LandUse_EC_OSM', {
    extraFields: [{ name: 'Landuse', tagKey: 'landuse' }],
  });
  log(`LandUse: ${landuseResult.wayCount} escritas, ${landuseResult.skipped} descartadas`);

  const greenResult = writePolygonTab(groups.green, path.join(OUT_DIR, 'Green_EC_OSM.TAB'), 'Green_EC_OSM');
  log(`Green: ${greenResult.wayCount} escritas, ${greenResult.skipped} descartadas`);

  log('Pasada de nodos con amenity/shop (POIs)...');
  const poiNodes = await collectTaggedNodes(PBF_PATH, (t) => !!t.amenity || !!t.shop);
  log(`POIs encontrados: ${poiNodes.length}`);
  const poiResult = writePointTab(poiNodes, path.join(OUT_DIR, 'Poi_EC_OSM.TAB'), 'Poi_EC_OSM', {
    extraFields: [{ name: 'Amenity', tagKey: 'amenity' }, { name: 'Shop', tagKey: 'shop' }],
  });
  log(`Poi: ${poiResult.pointCount} escritos`);

  const t1 = Date.now();
  log(`TOTAL: ${((t1 - t0) / 1000 / 60).toFixed(1)} min`);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
