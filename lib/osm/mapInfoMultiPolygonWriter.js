// Escribe relaciones multipolígono OSM YA RESUELTAS (ver `osmPbfParser.js::parseOsmPbfRelations`,
// un anillo exterior por feature, sin huecos internos -- limitación de v1 documentada ahí) a un
// `.TAB` de MapInfo.
const gdal = require('gdal-async');

/**
 * @param {Array<{id:number, tags:Record<string,string>, ring:[number,number][]}>} features
 * @param {string} outTabPath
 * @param {string} layerName
 * @param {{ nameField?: string, extraFields?: Array<{name:string, tagKey:string}> }} [opts]
 * @returns {{ featureCount:number, skipped:number }}
 */
function writeMultiPolygonTab(features, outTabPath, layerName, opts = {}) {
  const ds = gdal.open(outTabPath, 'w', 'MapInfo File');
  const srs = gdal.SpatialReference.fromEPSG(4326);
  const layer = ds.layers.create(layerName, srs, gdal.Polygon, ['ENCODING=CP1252']);
  layer.fields.add(new gdal.FieldDefn('Name', gdal.OFTString));
  for (const ef of opts.extraFields || []) {
    layer.fields.add(new gdal.FieldDefn(ef.name, gdal.OFTString));
  }

  let featureCount = 0;
  let skipped = 0;
  for (const item of features) {
    if (item.ring.length < 4) { skipped++; continue; }
    const gdalRing = new gdal.LinearRing();
    for (const [lon, lat] of item.ring) gdalRing.points.add(lon, lat);
    // Cerrar el anillo si el ensamblado goloso no lo dejó exactamente cerrado (primer/último
    // punto iguales) -- MapInfo/GDAL necesitan un anillo cerrado para un polígono válido.
    const first = item.ring[0];
    const last = item.ring[item.ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) gdalRing.points.add(first[0], first[1]);

    const polygon = new gdal.Polygon();
    polygon.rings.add(gdalRing);

    const feature = new gdal.Feature(layer);
    feature.setGeometry(polygon);
    feature.fields.set('Name', item.tags.name || '');
    for (const ef of opts.extraFields || []) {
      feature.fields.set(ef.name, item.tags[ef.tagKey] || '');
    }
    layer.features.add(feature);
    featureCount++;
  }

  ds.close();
  return { featureCount, skipped };
}

module.exports = { writeMultiPolygonTab };
