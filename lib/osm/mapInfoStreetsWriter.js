// Escribe una capa de calles OSM a un `.TAB` de MapInfo -- Objetivo 3, Fase 1 (prueba de
// concepto). Esquema confirmado real contra un `.TAB` de producción (`AllStreets_EC.TAB`, ver
// `C:\MAPS\ECUADOR\Mapinfo\AllStreets_EC.TAB`): un solo campo `Street_Name` (Char 80) -- esta capa
// es puramente visual (el ruteo real lo maneja el `.lmb`, no este archivo), así que no hace falta
// replicar más atributos que el nombre para que Roadshow la dibuje y la use para el fondo.
const gdal = require('gdal-async');
const { resolveWayCoords } = require('./osmXmlParser');

// Clasificación por jerarquía vial (pedido 2026-07-24: "el color de las avenidas" -- las
// avenidas principales necesitan verse DISTINTAS de una calle residencial cualquiera, igual que
// el `.gst` real de producción, que separa `Highway_1`/`Highway_2`/`AllStreets` en 3 capas con
// colores distintos, ver `C:\MAPS\ECUADOR\Mapinfo\ec.gst`). Mapeo de `highway=*` de OSM a esos 3
// niveles -- HERE/Navteq no tiene un equivalente exacto a las clases de OSM, así que esto es un
// mapeo razonable, no una correspondencia 1:1 confirmada contra ninguna muestra real de Navteq.
const HIGHWAY_TIER = {
  motorway: 1, motorway_link: 1, trunk: 1, trunk_link: 1, primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
};

function tierForWay(way) {
  return HIGHWAY_TIER[way.tags.highway] || 3; // 3 = local/residencial (AllStreets)
}

/**
 * @param {{nodes:Map, ways:Array<{id:string, refs:string[], tags:Record<string,string>}>}} parsed
 * @param {string} outTabPath
 * @param {string} layerName - nombre de la tabla adentro del `.TAB` (sin extensión)
 * @param {{ tier?: 1|2|3 }} [opts] - si viene, solo escribe ways de ESE nivel jerárquico
 *   (ver `HIGHWAY_TIER`) -- para separar en `Highway_1`/`Highway_2`/`AllStreets`.
 * @returns {{ wayCount:number, skipped:number }}
 */
function writeStreetsTab(parsed, outTabPath, layerName, opts = {}) {
  const ds = gdal.open(outTabPath, 'w', 'MapInfo File');
  const srs = gdal.SpatialReference.fromEPSG(4326);
  // BUG REAL encontrado 2026-07-24: sin `ENCODING`, GDAL escribe charset "Neutral" (sin recodificar)
  // -- cualquier nombre con tilde/ñ queda mal codificado ("Callejón" -> "CallejÃ³n", confirmado
  // real en GeoSet Manager). El nombre de la opción NO es el charset de MapInfo en sí
  // ("WindowsLatin1") sino el nombre iconv equivalente ("CP1252") -- ver
  // `IMapInfoFile::EncodingToCharset` en el driver MITAB de GDAL. Con esto el `.TAB` de salida
  // queda `!charset WindowsLatin1` (igual que los `.TAB` reales de producción, ver
  // `C:\MAPS\ECUADOR\Mapinfo\AllStreets_EC.TAB`) y los acentos se leen bien.
  const layer = ds.layers.create(layerName, srs, gdal.LineString, ['ENCODING=CP1252']);
  layer.fields.add(new gdal.FieldDefn('Street_Name', gdal.OFTString));

  let wayCount = 0;
  let skipped = 0;
  for (const way of parsed.ways) {
    if (opts.tier !== undefined && tierForWay(way) !== opts.tier) continue; // no cuenta como "skipped" -- pertenece a otra capa
    if (way.refs.length < 2) { skipped++; continue; } // una línea necesita al menos 2 puntos
    let coords;
    try {
      coords = resolveWayCoords(parsed, way);
    } catch {
      skipped++;
      continue;
    }
    const line = new gdal.LineString();
    for (const [lon, lat] of coords) line.points.add(lon, lat);

    const feature = new gdal.Feature(layer);
    feature.setGeometry(line);
    // `name` puede faltar (calles sin nombre real en OSM, ej. caminos de servicio) -- se deja
    // vacío en vez de inventar uno, mismo criterio ya establecido en todo este proyecto.
    feature.fields.set('Street_Name', way.tags.name || '');
    layer.features.add(feature);
    wayCount++;
  }

  ds.close();
  return { wayCount, skipped };
}

module.exports = { writeStreetsTab };
