// Parser de `.osm.pbf` a escala PAÍS -- Objetivo 3, Fase 1. Distinto de `osmXmlParser.js` (que
// lee el XML chico que devuelve Overpass para un área puntual): acá el archivo de entrada es un
// extracto regional/país completo (Geofabrik, formato binario PBF), demasiado grande para
// Overpass (pensada para consultas puntuales, no descargas masivas) y demasiado grande para
// cargar entero en un solo XML en memoria como hace `osmXmlParser.js`.
//
// BUG REAL encontrado 2026-07-24: el driver OSM de GDAL (gdal-async) resultó no confiable para
// esto tampoco -- incluso usando `gdal.vectorTranslate` (la MISMA maquinaria interna que usa
// `ogr2ogr`), sigue devolviendo solo un puñado de features de un archivo con muchas más
// (confirmado real, no es un bug de conteo -- se verificó el archivo de salida real). En vez de
// seguir invirtiendo tiempo en el driver OSM de GDAL, se usa `osm-pbf-parser` (streaming, PBF
// puro-JS vía `protocol-buffers`, sin compilación nativa) -- confirmado real leyendo 500k+ nodos
// del extracto completo de Ecuador (124MB) sin problema.
//
// DOS PASADAS, no una -- un extracto país completo puede tener decenas de millones de nodos;
// guardar TODOS en memoria (aunque la mayoría no le importen a ninguna `way` que nos interesa)
// desperdicia memoria de sobra. Primera pasada: filtrar las `ways` que cumplen el filtro pedido y
// anotar SOLO los IDs de nodo que van a hacer falta. Segunda pasada: releer el archivo guardando
// coordenadas SOLO para esos IDs ya anotados.
const fs = require('fs');
const OSMParser = require('osm-pbf-parser');
const { BigIdSet, BigIdMap } = require('./bigIdCollections');

/**
 * @param {string} pbfPath
 * @param {(tags: Record<string,string>) => boolean} wayFilter - qué `way` interesa (ej. `t => !!t.highway`)
 * @returns {Promise<{ ways: Array<{id:number, refs:number[], tags:Record<string,string>}>, neededNodeIds: Set<number> }>}
 */
function collectWays(pbfPath, wayFilter) {
  return new Promise((resolve, reject) => {
    const ways = [];
    const neededNodeIds = new BigIdSet();
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'way') continue;
          if (!item.tags || !wayFilter(item.tags)) continue;
          const refs = item.refs;
          ways.push({ id: item.id, refs, tags: item.tags });
          for (const ref of refs) neededNodeIds.add(ref);
        }
      })
      .on('end', () => resolve({ ways, neededNodeIds }))
      .on('error', reject);
  });
}

/**
 * @param {string} pbfPath
 * @param {Set<number>} neededNodeIds
 * @returns {Promise<Map<number,{lat:number,lon:number}>>}
 */
function collectNodeCoords(pbfPath, neededNodeIds) {
  return new Promise((resolve, reject) => {
    const coords = new BigIdMap();
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'node') continue;
          if (!neededNodeIds.has(item.id)) continue;
          coords.set(item.id, { lat: item.lat, lon: item.lon });
        }
      })
      .on('end', () => resolve(coords))
      .on('error', reject);
  });
}

/**
 * Extrae `ways` que cumplan `wayFilter` de un extracto `.osm.pbf` completo, con sus coordenadas
 * resueltas -- misma forma de salida que `osmXmlParser.js::parseOsmXml` (`{nodes, ways}`), para
 * poder reusar los escritores de MapInfo (`mapInfoStreetsWriter.js`/`mapInfoPolygonWriter.js`)
 * SIN modificarlos.
 * @param {string} pbfPath
 * @param {(tags: Record<string,string>) => boolean} wayFilter
 * @returns {Promise<{ nodes: Map<number,{lat:number,lon:number}>, ways: Array<{id:number, refs:number[], tags:Record<string,string>}> }>}
 */
async function parseOsmPbfWays(pbfPath, wayFilter) {
  const { ways, neededNodeIds } = await collectWays(pbfPath, wayFilter);
  const nodes = await collectNodeCoords(pbfPath, neededNodeIds);
  return { nodes, ways };
}

/**
 * Como `parseOsmPbfWays`, pero para VARIOS filtros/capas a la vez -- una sola pasada de `ways`
 * (clasificando cada `way` en el primer grupo cuyo filtro cumpla) + una sola pasada de nodos para
 * la UNIÓN de IDs que hagan falta entre todos los grupos. Evita releer el archivo país completo
 * una vez por capa (con 124MB y varias capas, cada pasada de más suma minutos reales).
 * @param {string} pbfPath
 * @param {Record<string,(tags:Record<string,string>)=>boolean>} wayFilters - `{ nombreGrupo: filtro }`
 * @returns {Promise<Record<string, {nodes:Map<number,{lat:number,lon:number}>, ways:Array}>>}
 */
async function parseOsmPbfWaysMulti(pbfPath, wayFilters) {
  const groupNames = Object.keys(wayFilters);
  const waysByGroup = Object.fromEntries(groupNames.map((n) => [n, []]));
  const neededNodeIds = new BigIdSet();

  await new Promise((resolve, reject) => {
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'way' || !item.tags) continue;
          for (const name of groupNames) {
            if (wayFilters[name](item.tags)) {
              waysByGroup[name].push({ id: item.id, refs: item.refs, tags: item.tags });
              for (const ref of item.refs) neededNodeIds.add(ref);
              break; // cada way pertenece a UN solo grupo -- el primero que matchee, evita duplicar en 2 capas
            }
          }
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const nodes = await collectNodeCoords(pbfPath, neededNodeIds);
  // Todas las capas comparten el MISMO Map de nodos (superset) -- los escritores solo leen las
  // refs que su propia lista de `ways` necesita, así que no hace falta separar por grupo.
  return Object.fromEntries(groupNames.map((n) => [n, { nodes, ways: waysByGroup[n] }]));
}

/**
 * UNA sola pasada -- para capas de PUNTO (POIs, poblaciones): la geometría de un nodo etiquetado
 * directo ES su propia coordenada, no hace falta resolver referencias de una `way` como arriba.
 * @param {string} pbfPath
 * @param {(tags: Record<string,string>) => boolean} nodeFilter - ej. `t => !!t.amenity || !!t.shop`
 * @returns {Promise<Array<{id:number, lat:number, lon:number, tags:Record<string,string>}>>}
 */
function collectTaggedNodes(pbfPath, nodeFilter) {
  return new Promise((resolve, reject) => {
    const taggedNodes = [];
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'node') continue;
          if (!item.tags || !nodeFilter(item.tags)) continue;
          taggedNodes.push({ id: item.id, lat: item.lat, lon: item.lon, tags: item.tags });
        }
      })
      .on('end', () => resolve(taggedNodes))
      .on('error', reject);
  });
}

/**
 * Pedido 2026-07-25 ("que se vean exactamente iguales" a OSM.org): bosques/parques/lagos/límites
 * administrativos GRANDES en OSM casi siempre son RELACIONES multipolígono (varios `way`
 * separados que se combinan), no un solo `way` cerrado -- por eso la capa de "zonas verdes" salía
 * casi vacía a nivel país (nuestro escritor de polígonos solo entendía "way cerrado" simple). Esto
 * agrega ese soporte.
 *
 * Simplificación deliberada de v1: solo se arma el/los anillo(s) EXTERIOR(es) (role=`outer`) --
 * los agujeros internos (role=`inner`, ej. una isla dentro de un lago) se ignoran, el polígono
 * sale relleno de más en esos casos raros. Suficiente para que un bosque/lago/límite se vea en su
 * lugar y forma real -- no es una implementación 100% fiel al spec de multipolígonos de OSM.
 *
 * @param {string} pbfPath
 * @param {(tags: Record<string,string>) => boolean} relationFilter
 * @returns {Promise<{ relations: Array<{id:number, tags:Record<string,string>, outerWayIds:number[]}>, neededWayIds: Set<number> }>}
 */
function collectRelations(pbfPath, relationFilter) {
  return new Promise((resolve, reject) => {
    const relations = [];
    const neededWayIds = new BigIdSet();
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'relation' || !item.tags) continue;
          if (!relationFilter(item.tags)) continue;
          const outerWayIds = item.members
            .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === ''))
            .map((m) => m.id);
          if (outerWayIds.length === 0) continue;
          relations.push({ id: item.id, tags: item.tags, outerWayIds });
          for (const wid of outerWayIds) neededWayIds.add(wid);
        }
      })
      .on('end', () => resolve({ relations, neededWayIds }))
      .on('error', reject);
  });
}

/**
 * Refs (sin importar tags propios -- los miembros de una relación multipolígono casi siempre NO
 * tienen tags propios, viven en la relación) de un conjunto puntual de `way` ya conocidos.
 * @param {string} pbfPath
 * @param {Set<number>} wantedWayIds
 * @returns {Promise<Map<number, number[]>>} wayId -> refs
 */
function collectWayRefsOnly(pbfPath, wantedWayIds) {
  return new Promise((resolve, reject) => {
    const refsByWayId = new BigIdMap();
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'way') continue;
          if (!wantedWayIds.has(item.id)) continue;
          refsByWayId.set(item.id, item.refs);
        }
      })
      .on('end', () => resolve(refsByWayId))
      .on('error', reject);
  });
}

/** Encadena una lista de `way`s (cada uno un array de node-refs) en UN anillo, uniendo por
 * extremos compartidos (algoritmo goloso -- no maneja el caso general de múltiples anillos
 * exteriores desconectados dentro de la misma relación, ver limitación de v1 arriba). Si algún
 * tramo no se puede encadenar más, corta ahí -- mejor un anillo parcial que nada. */
function assembleRing(wayRefsList) {
  if (wayRefsList.length === 0) return null;
  const remaining = wayRefsList.map((r) => r.slice());
  let ring = remaining.shift();
  let guard = remaining.length + 1;
  while (remaining.length > 0 && guard-- > 0) {
    const last = ring[ring.length - 1];
    const first = ring[0];
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i];
      if (w[0] === last) { ring = ring.concat(w.slice(1)); remaining.splice(i, 1); found = true; break; }
      if (w[w.length - 1] === last) { ring = ring.concat(w.slice(0, -1).reverse()); remaining.splice(i, 1); found = true; break; }
      if (w[w.length - 1] === first) { ring = w.slice(0, -1).concat(ring); remaining.splice(i, 1); found = true; break; }
      if (w[0] === first) { ring = w.slice(1).reverse().concat(ring); remaining.splice(i, 1); found = true; break; }
    }
    if (!found) break;
  }
  return ring;
}

/**
 * Extrae relaciones multipolígono que cumplan `relationFilter`, con sus anillos exteriores YA
 * resueltos a coordenadas reales -- forma de salida propia (no la misma que `parseOsmPbfWays`,
 * ver `mapInfoMultiPolygonWriter.js`).
 * @param {string} pbfPath
 * @param {(tags: Record<string,string>) => boolean} relationFilter
 * @returns {Promise<Array<{id:number, tags:Record<string,string>, ring:[number,number][]}>>}
 */
async function parseOsmPbfRelations(pbfPath, relationFilter) {
  const { relations, neededWayIds } = await collectRelations(pbfPath, relationFilter);
  const wayRefs = await collectWayRefsOnly(pbfPath, neededWayIds);
  const neededNodeIds = new BigIdSet();
  for (const refs of wayRefs.values()) for (const r of refs) neededNodeIds.add(r);
  const nodeCoords = await collectNodeCoords(pbfPath, neededNodeIds);

  const result = [];
  for (const rel of relations) {
    const wayRefsList = rel.outerWayIds.map((wid) => wayRefs.get(wid)).filter(Boolean);
    const ringRefs = assembleRing(wayRefsList);
    if (!ringRefs || ringRefs.length < 4) continue; // no se pudo armar un anillo real
    const ring = [];
    let ok = true;
    for (const ref of ringRefs) {
      const c = nodeCoords.get(ref);
      if (!c) { ok = false; break; }
      ring.push([c.lon, c.lat]);
    }
    if (!ok) continue;
    result.push({ id: rel.id, tags: rel.tags, ring });
  }
  return result;
}

/**
 * Como `parseOsmPbfRelations`, pero para VARIOS filtros/capas a la vez -- mismo motivo que
 * `parseOsmPbfWaysMulti` (evitar releer el archivo país completo una vez por capa).
 * @param {string} pbfPath
 * @param {Record<string,(tags:Record<string,string>)=>boolean>} relationFilters
 * @returns {Promise<Record<string, Array<{id:number, tags:Record<string,string>, ring:[number,number][]}>>>}
 */
async function parseOsmPbfRelationsMulti(pbfPath, relationFilters) {
  const groupNames = Object.keys(relationFilters);
  const relsByGroup = Object.fromEntries(groupNames.map((n) => [n, []]));
  const neededWayIds = new BigIdSet();

  await new Promise((resolve, reject) => {
    const parser = OSMParser();
    fs.createReadStream(pbfPath)
      .pipe(parser)
      .on('data', (items) => {
        for (const item of items) {
          if (item.type !== 'relation' || !item.tags) continue;
          for (const name of groupNames) {
            if (relationFilters[name](item.tags)) {
              const outerWayIds = item.members
                .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === ''))
                .map((m) => m.id);
              if (outerWayIds.length === 0) break;
              relsByGroup[name].push({ id: item.id, tags: item.tags, outerWayIds });
              for (const wid of outerWayIds) neededWayIds.add(wid);
              break; // una relación pertenece a UN solo grupo
            }
          }
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const wayRefs = await collectWayRefsOnly(pbfPath, neededWayIds);
  const neededNodeIds = new BigIdSet();
  for (const refs of wayRefs.values()) for (const r of refs) neededNodeIds.add(r);
  const nodeCoords = await collectNodeCoords(pbfPath, neededNodeIds);

  const result = {};
  for (const name of groupNames) {
    const out = [];
    for (const rel of relsByGroup[name]) {
      const wayRefsList = rel.outerWayIds.map((wid) => wayRefs.get(wid)).filter(Boolean);
      const ringRefs = assembleRing(wayRefsList);
      if (!ringRefs || ringRefs.length < 4) continue;
      const ring = [];
      let ok = true;
      for (const ref of ringRefs) {
        const c = nodeCoords.get(ref);
        if (!c) { ok = false; break; }
        ring.push([c.lon, c.lat]);
      }
      if (!ok) continue;
      out.push({ id: rel.id, tags: rel.tags, ring });
    }
    result[name] = out;
  }
  return result;
}

module.exports = {
  collectWays,
  collectNodeCoords,
  parseOsmPbfWays,
  parseOsmPbfWaysMulti,
  collectTaggedNodes,
  collectRelations,
  collectWayRefsOnly,
  assembleRing,
  parseOsmPbfRelations,
  parseOsmPbfRelationsMulti,
};
