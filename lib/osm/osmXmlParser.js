// Parser liviano de OSM XML (formato de respuesta de Overpass API) -- deliberadamente NO usa el
// driver OSM de GDAL (ver nota en scratch_osm_gst_poc.js): en este binding (gdal-async +
// libgdal embebido) el driver OSM solo devuelve un puñado de features al iterar una sola capa
// (confirmado real: 3 de 115 calles reales) -- es un problema conocido de lectura "entrelazada"
// del driver OSM de GDAL (streaming multi-capa de una pasada), no de los datos. El formato XML de
// OSM es simple y estable (nodos con lat/lon, ways con referencias a nodos + tags) -- parsearlo a
// mano es más confiable acá que pelear con el driver. GDAL se usa solo para ESCRIBIR el `.TAB`
// de salida (confirmado funcionando sin problemas).
const fs = require('fs');

function unescapeXml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const tagRe = /<tag\s+k="([^"]*)"\s+v="([^"]*)"/g;

function parseTagsFromBody(body) {
  const tags = {};
  let tg;
  tagRe.lastIndex = 0;
  while ((tg = tagRe.exec(body))) tags[unescapeXml(tg[1])] = unescapeXml(tg[2]);
  return tags;
}

/**
 * Parsea un archivo `.osm` (XML, formato Overpass "out body" -- nodos y ways con sus tags) a una
 * estructura simple en memoria.
 *
 * Un `<node>` en la respuesta de Overpass viene en 2 formas: self-closing SIN tags (los nodos
 * "esqueleto" de `out skel qt`, solo sirven para resolver coordenadas de un `way` -- la mayoría)
 * o como bloque CON `<tag>` hijos (un nodo pedido directo, ej. `node["amenity"]`/`node["place"]`
 * -- un POI o una población, la geometría en sí ES el nodo). `taggedNodes` guarda estos últimos
 * aparte -- son los candidatos reales para capas de puntos (POIs, poblaciones), a diferencia de
 * `nodes` (solo coordenadas, usado por `resolveWayCoords`).
 * @param {string} osmFilePath
 * @returns {{ nodes: Map<string,{lat:number,lon:number}>,
 *   ways: Array<{id:string, refs:string[], tags:Record<string,string>}>,
 *   taggedNodes: Array<{id:string, lat:number, lon:number, tags:Record<string,string>}> }}
 */
function parseOsmXml(osmFilePath) {
  const xml = fs.readFileSync(osmFilePath, 'utf8');
  const nodes = new Map();
  const taggedNodes = [];
  const ways = [];

  // Nodo self-closing (sin tags): <node id="..." lat="..." lon="..."/>
  const nodeSelfClosingRe = /<node\s+id="(\d+)"\s+lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"\s*\/>/g;
  // Nodo bloque (con tags): <node id="..." lat="..." lon="...">...</node>
  const nodeBlockRe = /<node\s+id="(\d+)"\s+lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"\s*>([\s\S]*?)<\/node>/g;
  let m;
  while ((m = nodeSelfClosingRe.exec(xml))) {
    nodes.set(m[1], { lat: parseFloat(m[2]), lon: parseFloat(m[3]) });
  }
  while ((m = nodeBlockRe.exec(xml))) {
    const lat = parseFloat(m[2]);
    const lon = parseFloat(m[3]);
    nodes.set(m[1], { lat, lon });
    taggedNodes.push({ id: m[1], lat, lon, tags: parseTagsFromBody(m[4]) });
  }

  // Ways: bloque <way id="...">...</way>, con <nd ref="..."/> y <tag k="..." v="..."/> adentro.
  const wayRe = /<way\s+id="(\d+)">([\s\S]*?)<\/way>/g;
  const ndRe = /<nd\s+ref="(\d+)"/g;
  while ((m = wayRe.exec(xml))) {
    const id = m[1];
    const body = m[2];
    const refs = [];
    let nd;
    ndRe.lastIndex = 0;
    while ((nd = ndRe.exec(body))) refs.push(nd[1]);
    ways.push({ id, refs, tags: parseTagsFromBody(body) });
  }

  return { nodes, ways, taggedNodes };
}

/**
 * Resuelve un `way` a su lista de coordenadas reales `[lon,lat]`, en el mismo orden que sus
 * `nd ref`. Si falta algún nodo referenciado (no debería pasar con una consulta Overpass bien
 * armada -- ver nota de recursión `>;`/`out skel qt;` en osmFetch.js), tira error explícito en vez
 * de generar geometría con huecos silenciosos.
 * @param {{nodes: Map, ways: Array}} parsed
 * @param {{id:string, refs:string[]}} way
 * @returns {[number,number][]}
 */
function resolveWayCoords(parsed, way) {
  return way.refs.map((ref) => {
    const node = parsed.nodes.get(ref);
    if (!node) throw new Error(`Way ${way.id} referencia el nodo ${ref}, que no está en el extracto -- ¿la consulta Overpass no recursó bien?`);
    return [node.lon, node.lat];
  });
}

module.exports = { parseOsmXml, resolveWayCoords };
