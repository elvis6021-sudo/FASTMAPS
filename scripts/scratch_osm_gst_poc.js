// Prueba de concepto end-to-end de Objetivo 3, Fase 1: toma un extracto OSM ya descargado
// (scratch_osm_test_area3.osm, zona de Guayaquil ya usada en toda la investigación de Objetivo 2,
// -2.2870,-79.8900 a -2.2790,-79.8800), lo convierte a una capa `AllStreets` de MapInfo y genera
// un `.gst` mínimo apuntando a ella -- para confirmar que RIIMS/GeoSet Manager dibuja geometría
// real de OSM antes de construir el catálogo completo de 21+ capas.
const fs = require('fs');
const path = require('path');
const { parseOsmXml } = require('../lib/osm/osmXmlParser');
const { writeStreetsTab } = require('../lib/osm/mapInfoStreetsWriter');
const { writePolygonTab } = require('../lib/osm/mapInfoPolygonWriter');
const { writePointTab } = require('../lib/osm/mapInfoPointWriter');
const { buildGeoSet } = require('../lib/osm/gstWriter');

function cleanExisting(tabPath) {
  for (const ext of ['.TAB', '.DAT', '.MAP', '.ID']) {
    const p = tabPath.replace(/\.TAB$/i, ext);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

const OUT_DIR = path.join(__dirname, 'output', 'osm_test');
const BBOX = { south: -2.2870, west: -79.8900, north: -2.2790, east: -79.8800 };

function main() {
  const parsed = parseOsmXml(path.join(__dirname, 'scratch_osm_test_area3.osm'));
  console.log(`Parseado: ${parsed.nodes.size} nodos, ${parsed.ways.length} ways`);

  // Separado en 3 niveles jerárquicos (pedido 2026-07-24: "el color de las avenidas") -- mismo
  // criterio visual que el `.gst` real (Highway_1 = vías principales, Highway_2 = secundarias,
  // AllStreets = todo el resto). Colores tomados del `.gst` real de Ecuador como referencia.
  const hw1TabPath = path.join(OUT_DIR, 'Highway1_OSMTEST.TAB');
  cleanExisting(hw1TabPath);
  const hw1Result = writeStreetsTab(parsed, hw1TabPath, 'Highway1_OSMTEST', { tier: 1 });
  console.log(`Escrito ${hw1TabPath}: ${hw1Result.wayCount} vías principales`);

  const hw2TabPath = path.join(OUT_DIR, 'Highway2_OSMTEST.TAB');
  cleanExisting(hw2TabPath);
  const hw2Result = writeStreetsTab(parsed, hw2TabPath, 'Highway2_OSMTEST', { tier: 2 });
  console.log(`Escrito ${hw2TabPath}: ${hw2Result.wayCount} vías secundarias`);

  const streetsTabPath = path.join(OUT_DIR, 'AllStreets_OSMTEST.TAB');
  cleanExisting(streetsTabPath);
  const streetsResult = writeStreetsTab(parsed, streetsTabPath, 'AllStreets_OSMTEST', { tier: 3 });
  console.log(`Escrito ${streetsTabPath}: ${streetsResult.wayCount} calles locales, ${streetsResult.skipped} descartadas`);

  const buildingsParsed = parseOsmXml(path.join(__dirname, 'scratch_osm_buildings.osm'));
  console.log(`Edificios parseados: ${buildingsParsed.nodes.size} nodos, ${buildingsParsed.ways.length} ways`);
  const buildingsTabPath = path.join(OUT_DIR, 'Buildings_OSMTEST.TAB');
  cleanExisting(buildingsTabPath);
  const buildingsResult = writePolygonTab(buildingsParsed, buildingsTabPath, 'Buildings_OSMTEST');
  console.log(`Escrito ${buildingsTabPath}: ${buildingsResult.wayCount} edificios, ${buildingsResult.skipped} descartados`);

  const landuseParsed = parseOsmXml(path.join(__dirname, 'scratch_osm_landuse.osm'));
  console.log(`Uso de suelo parseado: ${landuseParsed.nodes.size} nodos, ${landuseParsed.ways.length} ways`);
  const landuseTabPath = path.join(OUT_DIR, 'LandUse_OSMTEST.TAB');
  cleanExisting(landuseTabPath);
  const landuseResult = writePolygonTab(landuseParsed, landuseTabPath, 'LandUse_OSMTEST', {
    extraFields: [{ name: 'Landuse', tagKey: 'landuse' }],
  });
  console.log(`Escrito ${landuseTabPath}: ${landuseResult.wayCount} zonas, ${landuseResult.skipped} descartadas`);

  const greenParsed = parseOsmXml(path.join(__dirname, 'scratch_osm_green.osm'));
  console.log(`Zonas verdes parseadas: ${greenParsed.nodes.size} nodos, ${greenParsed.ways.length} ways`);
  const greenTabPath = path.join(OUT_DIR, 'Green_OSMTEST.TAB');
  cleanExisting(greenTabPath);
  const greenResult = writePolygonTab(greenParsed, greenTabPath, 'Green_OSMTEST');
  console.log(`Escrito ${greenTabPath}: ${greenResult.wayCount} zonas verdes, ${greenResult.skipped} descartadas`);

  const poisParsed = parseOsmXml(path.join(__dirname, 'scratch_osm_pois.osm'));
  console.log(`POIs parseados: ${poisParsed.taggedNodes.length} nodos con tags`);
  const poisTabPath = path.join(OUT_DIR, 'Poi_OSMTEST.TAB');
  cleanExisting(poisTabPath);
  const poisResult = writePointTab(poisParsed.taggedNodes, poisTabPath, 'Poi_OSMTEST', {
    extraFields: [{ name: 'Amenity', tagKey: 'amenity' }, { name: 'Shop', tagKey: 'shop' }],
  });
  console.log(`Escrito ${poisTabPath}: ${poisResult.pointCount} POIs`);

  // Capas candidatas + su conteo real -- una capa con 0 features es un `.TAB` técnicamente válido
  // pero sin ningún sentido referenciarla en el `.gst` (mejor no listarla que arriesgar que
  // GeoSet Manager se queje de una capa vacía).
  const candidateLayers = [
    { file: 'LandUse_OSMTEST.TAB', description: 'LandUse (OSM, prueba)', lineColor: 16776176, lineWidth: 1, fillColor: 16776176, count: landuseResult.wayCount },
    { file: 'Green_OSMTEST.TAB', description: 'Green areas (OSM, prueba)', lineColor: 6076508, lineWidth: 1, fillColor: 10145074, count: greenResult.wayCount },
    { file: 'Buildings_OSMTEST.TAB', description: 'Buildings (OSM, prueba)', lineColor: 10066329, lineWidth: 1, fillColor: 14211288, count: buildingsResult.wayCount },
    { file: 'AllStreets_OSMTEST.TAB', description: 'AllStreets (OSM, prueba)', lineColor: 8421504, lineWidth: 1, count: streetsResult.wayCount },
    { file: 'Highway2_OSMTEST.TAB', description: 'Highway_2 (OSM, prueba)', lineColor: 16711680, lineWidth: 2, count: hw2Result.wayCount },
    { file: 'Highway1_OSMTEST.TAB', description: 'Highway_1 (OSM, prueba)', lineColor: 15790080, lineWidth: 3, count: hw1Result.wayCount },
    // Sin symbolColor/symbolCode acá -- cada punto ya trae su propio símbolo (ver
    // mapInfoPointWriter.js::styleForTags), el estilo de capa quedaría ignorado/pisado.
    { file: 'Poi_OSMTEST.TAB', description: 'POIs (OSM, prueba)', count: poisResult.pointCount },
  ];
  const layers = candidateLayers.filter((l) => l.count > 0);
  const omitted = candidateLayers.filter((l) => l.count === 0).map((l) => l.description);
  if (omitted.length) console.log(`Sin datos en esta zona, no se agregan al .gst: ${omitted.join(', ')}`);

  const gst = buildGeoSet({ name: 'ec_osm_test', bbox: BBOX, layers });
  const gstPath = path.join(OUT_DIR, 'ec_osm_test.gst');
  fs.writeFileSync(gstPath, gst);
  console.log(`Escrito ${gstPath}`);
  console.log('\nListo para probar en GeoSet Manager o apuntando rimms.ini a esta carpeta.');
}

main();
