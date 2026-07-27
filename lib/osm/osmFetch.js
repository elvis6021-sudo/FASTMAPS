// Descarga un extracto OSM real vía Overpass API para una zona (bbox) -- Objetivo 3, Fase 1.
//
// BUG REAL encontrado 2026-07-24 armando la prueba de concepto: la forma "compacta" de pedir
// ways + sus nodos en un solo bloque (`(way[...](bbox);>;);out body;`) devuelve el archivo con
// la gran mayoría de los nodos referenciados FALTANTES (confirmado real: 405 nodos referenciados
// por 116 ways, pero solo 16 <node> reales en el archivo) -- Overpass no tira error, entrega un
// XML válido pero incompleto, y como el driver/parser de OSM no puede resolver la geometría de
// esos ways, terminan silenciosamente descartados o con huecos. El patrón CORRECTO (confirmado
// real, 115 ways -> 389 nodos resueltos, coincide con los `<nd ref>` reales del archivo) separa
// la recursión en 2 pasos: `out body;` (ways con tags) SEGUIDO de `>;out skel qt;` (recursa a los
// nodos referenciados y los imprime, solo coordenadas -- no hacen falta sus tags).
const https = require('https');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {string[]} [osmFilters] - filtros Overpass a incluir, cada uno el contenido de un
 *   `way[...]` (default: solo `["highway"]`). Ej. `['["highway"]', '["building"]',
 *   '["natural"="water"]']` -- el resultado une todas.
 * @returns {Promise<string>} el XML crudo de la respuesta
 */
function fetchOsmWays(bbox, osmFilters = ['["highway"]']) {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const wayClauses = osmFilters.map((f) => `way${f}(${bboxStr});`).join('\n');
  const query = `[out:xml][timeout:60];\n(\n${wayClauses}\n);\nout body;\n>;\nout skel qt;`;
  return runOverpassQuery(query);
}

/**
 * Como `fetchOsmWays`, pero para `node[...]` en vez de `way[...]` -- POIs (`amenity`/`shop`) y
 * poblaciones (`place`) son puntos en OSM, no ways. No hace falta recursar a otros nodos acá (un
 * nodo YA tiene su propia coordenada), así que la consulta es más simple.
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {string[]} osmFilters - ver `fetchOsmWays`
 * @returns {Promise<string>}
 */
function fetchOsmNodes(bbox, osmFilters) {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const nodeClauses = osmFilters.map((f) => `node${f}(${bboxStr});`).join('\n');
  const query = `[out:xml][timeout:60];\n(\n${nodeClauses}\n);\nout body;`;
  return runOverpassQuery(query);
}

function runOverpassQuery(query) {
  return new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const req = https.request(
      OVERPASS_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          // BUG REAL encontrado 2026-07-24: sin estos 2 headers, el Apache de Overpass devuelve
          // 406 "Not Acceptable" (mod_negotiation rechaza el pedido) -- `curl` los manda solitos
          // por default, `https.request` de Node no.
          Accept: '*/*',
          'User-Agent': 'FastBuild-OSM-converter/1.0',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`Overpass API respondió ${res.statusCode}: ${text.slice(0, 500)}`));
            return;
          }
          resolve(text);
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { fetchOsmWays, fetchOsmNodes };
