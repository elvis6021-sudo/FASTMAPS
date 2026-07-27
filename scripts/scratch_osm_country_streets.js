// Prueba de escala real: extraer TODAS las calles de Ecuador (`highway=*`) del extracto país
// completo de Geofabrik (124MB `.osm.pbf`) -- primer intento de país-entero, antes de sumar el
// resto de las capas (pedido explícito del usuario, probar 1 capa primero).
const path = require('path');
const { parseOsmPbfWays } = require('../lib/osm/osmPbfParser');
const { writeStreetsTab } = require('../lib/osm/mapInfoStreetsWriter');

const PBF_PATH = path.join(__dirname, 'output', 'osm_ecuador', 'ecuador.osm.pbf');
const OUT_DIR = path.join(__dirname, 'output', 'osm_ecuador');

async function main() {
  const t0 = Date.now();
  console.log('Pasada 1+2: extrayendo ways con highway=* y resolviendo sus nodos...');
  const parsed = await parseOsmPbfWays(PBF_PATH, (tags) => !!tags.highway);
  const t1 = Date.now();
  console.log(`Listo en ${((t1 - t0) / 1000).toFixed(1)}s: ${parsed.ways.length} ways, ${parsed.nodes.size} nodos resueltos`);
  console.log('Memoria usada:', JSON.stringify(process.memoryUsage()));

  for (const tier of [1, 2, 3]) {
    const label = tier === 1 ? 'Highway1' : tier === 2 ? 'Highway2' : 'AllStreets';
    const tabPath = path.join(OUT_DIR, `${label}_EC_OSM.TAB`);
    const result = writeStreetsTab(parsed, tabPath, `${label}_EC_OSM`, { tier });
    console.log(`${label}: ${result.wayCount} ways escritas, ${result.skipped} descartadas`);
  }
  const t2 = Date.now();
  console.log(`Escritura de .TAB terminada en ${((t2 - t1) / 1000).toFixed(1)}s`);
  console.log(`Total: ${((t2 - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
