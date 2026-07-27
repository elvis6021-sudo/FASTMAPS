// Segunda pasada de capas país-completo (2026-07-25): agua (ríos como líneas + lagos/agua grande
// como relaciones multipolígono), bosques/parques GRANDES (relaciones, complementa la capa
// "Green" ya armada con ways simples), y límites administrativos (relaciones boundary=administrative).
const path = require('path');
const { parseOsmPbfWays, parseOsmPbfRelationsMulti } = require('../lib/osm/osmPbfParser');
const { writeStreetsTab } = require('../lib/osm/mapInfoStreetsWriter');
const { writeMultiPolygonTab } = require('../lib/osm/mapInfoMultiPolygonWriter');

const PBF_PATH = path.join(__dirname, 'output', 'osm_ecuador', 'ecuador.osm.pbf');
const OUT_DIR = path.join(__dirname, 'output', 'osm_ecuador');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const t0 = Date.now();

  log('Ríos/arroyos (ways simples, línea)...');
  const rivers = await parseOsmPbfWays(PBF_PATH, (t) => t.waterway === 'river' || t.waterway === 'stream' || t.waterway === 'canal');
  const riversResult = writeStreetsTab(rivers, path.join(OUT_DIR, 'Rivers_EC_OSM.TAB'), 'Rivers_EC_OSM', {});
  log(`Rivers: ${rivers.ways.length} ways, ${riversResult.wayCount} escritas`);

  log('Relaciones multipolígono: agua / bosques-parques grandes / límites administrativos...');
  const rels = await parseOsmPbfRelationsMulti(PBF_PATH, {
    water: (t) => (t.type === 'multipolygon' || t.type === 'boundary') && (t.natural === 'water' || t.waterway === 'riverbank'),
    greenBig: (t) => t.type === 'multipolygon' && (t.natural === 'wood' || t.landuse === 'forest' || t.leisure === 'park' || t.leisure === 'nature_reserve' || t.boundary === 'national_park'),
    admin: (t) => t.type === 'boundary' && t.boundary === 'administrative' && (t.admin_level === '4' || t.admin_level === '6'),
  });
  log(`water rel=${rels.water.length} greenBig rel=${rels.greenBig.length} admin rel=${rels.admin.length}`);

  const waterResult = writeMultiPolygonTab(rels.water, path.join(OUT_DIR, 'Water_EC_OSM.TAB'), 'Water_EC_OSM');
  log(`Water: ${waterResult.featureCount} escritas, ${waterResult.skipped} descartadas`);

  const greenBigResult = writeMultiPolygonTab(rels.greenBig, path.join(OUT_DIR, 'GreenBig_EC_OSM.TAB'), 'GreenBig_EC_OSM');
  log(`GreenBig: ${greenBigResult.featureCount} escritas, ${greenBigResult.skipped} descartadas`);

  const adminResult = writeMultiPolygonTab(rels.admin, path.join(OUT_DIR, 'Admin_EC_OSM.TAB'), 'Admin_EC_OSM');
  log(`Admin: ${adminResult.featureCount} escritas, ${adminResult.skipped} descartadas`);

  const t1 = Date.now();
  log(`TOTAL: ${((t1 - t0) / 1000 / 60).toFixed(1)} min`);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
