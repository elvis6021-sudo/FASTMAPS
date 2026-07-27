// Escribe una capa de POLÍGONOS OSM (edificios, agua, uso de suelo -- todos "closed ways" en
// OSM: el primer y último `nd ref` son el mismo nodo) a un `.TAB` de MapInfo -- Objetivo 3, Fase 1.
// Mismo criterio que mapInfoStreetsWriter.js (capa puramente visual, no toca el `.lmb`/ruteo).
const gdal = require('gdal-async');
const { resolveWayCoords } = require('./osmXmlParser');

/**
 * @param {{nodes:Map, ways:Array}} parsed
 * @param {string} outTabPath
 * @param {string} layerName
 * @param {{ nameField?: string, extraFields?: Array<{name:string, tagKey:string}> }} [opts]
 *   `extraFields`: campos adicionales a copiar de `way.tags[tagKey]` -- ej. para uso de suelo,
 *   `[{name:'Landuse', tagKey:'landuse'}]`.
 * @returns {{ wayCount:number, skipped:number }}
 */
function writePolygonTab(parsed, outTabPath, layerName, opts = {}) {
  const ds = gdal.open(outTabPath, 'w', 'MapInfo File');
  const srs = gdal.SpatialReference.fromEPSG(4326);
  const layer = ds.layers.create(layerName, srs, gdal.Polygon, ['ENCODING=CP1252']);
  layer.fields.add(new gdal.FieldDefn('Name', gdal.OFTString));
  for (const ef of opts.extraFields || []) {
    layer.fields.add(new gdal.FieldDefn(ef.name, gdal.OFTString));
  }

  let wayCount = 0;
  let skipped = 0;
  for (const way of parsed.ways) {
    // Polígono válido en OSM "closed way": >=4 refs (3 vértices + cierre) y primer/último ref
    // iguales -- si no cierra, no es un polígono real (podría ser una línea abierta con la misma
    // etiqueta, ej. landuse a veces aparece en relaciones multipolígono -- fuera de alcance de
    // esta v1, que solo maneja "closed way" simple, el caso más común).
    if (way.refs.length < 4 || way.refs[0] !== way.refs[way.refs.length - 1]) { skipped++; continue; }
    let coords;
    try {
      coords = resolveWayCoords(parsed, way);
    } catch {
      skipped++;
      continue;
    }
    const ring = new gdal.LinearRing();
    for (const [lon, lat] of coords) ring.points.add(lon, lat);
    const polygon = new gdal.Polygon();
    polygon.rings.add(ring);

    const feature = new gdal.Feature(layer);
    feature.setGeometry(polygon);
    feature.fields.set('Name', way.tags.name || '');
    for (const ef of opts.extraFields || []) {
      feature.fields.set(ef.name, way.tags[ef.tagKey] || '');
    }
    layer.features.add(feature);
    wayCount++;
  }

  ds.close();
  return { wayCount, skipped };
}

module.exports = { writePolygonTab };
