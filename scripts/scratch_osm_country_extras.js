// Tercera pasada de capas país-completo (2026-07-25): poblaciones (para orientarse al alejar el
// zoom), línea de costa, y calles de sentido único (para las flechas de dirección).
const path = require('path');
const { parseOsmPbfWays, collectTaggedNodes } = require('../lib/osm/osmPbfParser');
const { writeStreetsTab } = require('../lib/osm/mapInfoStreetsWriter');
const { writePointTab } = require('../lib/osm/mapInfoPointWriter');

const { PBF_PATH, OUT_DIR, CODE, NAME, BBOX, tab, lyr } = require('./genConfig');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const t0 = Date.now();

  log('Poblaciones (place=city/town/village/hamlet, nodos)...');
  const places = await collectTaggedNodes(PBF_PATH, (t) =>
    t.place === 'city' || t.place === 'town' || t.place === 'village' || t.place === 'hamlet'
  );
  log(`Poblaciones encontradas: ${places.length} (${places.filter((p) => p.tags.place === 'city').length} ciudades, ${places.filter((p) => p.tags.place === 'town').length} pueblos)`);
  // Separadas en 2 capas por tamaño real -- mismo criterio que Settlement_1..4 del `.gst` real
  // (ciudades siempre visibles/legibles, pueblos/aldeas solo de cerca).
  const cities = places.filter((p) => p.tags.place === 'city' || p.tags.place === 'town');
  const villages = places.filter((p) => p.tags.place === 'village' || p.tags.place === 'hamlet');
  const citiesResult = writePointTab(cities, tab('CitiesTowns'), lyr('CitiesTowns'));
  const villagesResult = writePointTab(villages, tab('Villages'), lyr('Villages'));
  log(`CitiesTowns: ${citiesResult.pointCount}, Villages: ${villagesResult.pointCount}`);

  log('Línea de costa (natural=coastline, ways)...');
  const coastline = await parseOsmPbfWays(PBF_PATH, (t) => t.natural === 'coastline');
  const coastlineResult = writeStreetsTab(coastline, tab('Coastline'), lyr('Coastline'), {});
  log(`Coastline: ${coastline.ways.length} ways, ${coastlineResult.wayCount} escritas`);

  log('Calles de sentido único (highway=* + oneway=yes/1/-1, ways)...');
  const oneway = await parseOsmPbfWays(PBF_PATH, (t) =>
    !!t.highway && (t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1')
  );
  const onewayResult = writeStreetsTab(oneway, tab('Oneway'), lyr('Oneway'), {});
  log(`Oneway: ${oneway.ways.length} ways, ${onewayResult.wayCount} escritas`);

  const t1 = Date.now();
  log(`TOTAL: ${((t1 - t0) / 1000 / 60).toFixed(1)} min`);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
