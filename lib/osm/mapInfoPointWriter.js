// Escribe una capa de PUNTOS OSM (poblaciones, POIs -- nodos directos, no resueltos de un `way`)
// a un `.TAB` de MapInfo -- Objetivo 3, Fase 1.
const gdal = require('gdal-async');

// Ícono por categoría de POI (pedido 2026-07-24: "íconos por tipo", no un símbolo genérico para
// todos). Usa el set de símbolos "ogr-sym-N" -- portable, entendido directo por GDAL/MITAB sin
// depender de la fuente "Map Symbols" de MapInfo (cuyos códigos de carácter reales no están
// confirmados en este proyecto todavía -- ver nota en gstWriter.js). `ogr-sym-0..9` son formas
// geométricas simples (cuadrado/círculo/triángulo/estrella, vacíos o rellenos) -- alcanza para
// diferenciar categorías visualmente aunque no sean el ícono "real" (tenedor/cruz) que muestra
// OSM.org -- ese nivel de fidelidad necesitaría los códigos reales de la fuente Map Symbols,
// pendiente si hace falta más adelante.
const POI_STYLES = {
  hospital: { sym: 8, color: '#DC143C' }, // estrella rellena, rojo -- salud
  pharmacy: { sym: 8, color: '#DC143C' },
  clinic: { sym: 8, color: '#DC143C' },
  doctors: { sym: 8, color: '#DC143C' },
  restaurant: { sym: 3, color: '#FF8C00' }, // círculo relleno, naranja -- comida
  cafe: { sym: 3, color: '#FF8C00' },
  fast_food: { sym: 3, color: '#FF8C00' },
  bar: { sym: 3, color: '#FF8C00' },
  bank: { sym: 1, color: '#1E90FF' }, // cuadrado relleno, azul -- servicios/finanzas
  atm: { sym: 1, color: '#1E90FF' },
  post_office: { sym: 1, color: '#1E90FF' },
  school: { sym: 5, color: '#8A2BE2' }, // triángulo relleno, violeta -- educación
  university: { sym: 5, color: '#8A2BE2' },
  kindergarten: { sym: 5, color: '#8A2BE2' },
  place_of_worship: { sym: 7, color: '#696969' }, // cruz, gris -- religioso
  fuel: { sym: 1, color: '#B8860B' }, // cuadrado relleno, ocre -- combustible
  ferry_terminal: { sym: 0, color: '#1E90FF' }, // cuadrado vacío, azul -- transporte
  _default: { sym: 3, color: '#555555' }, // círculo relleno gris -- cualquier otro shop/amenity
};

function styleForTags(tags) {
  const key = tags.amenity || tags.shop || '_default';
  const style = POI_STYLES[key] || POI_STYLES._default;
  return `SYMBOL(id:"ogr-sym-${style.sym}",c:${style.color},s:14)`;
}

/**
 * @param {Array<{id:string, lat:number, lon:number, tags:Record<string,string>}>} taggedNodes
 * @param {string} outTabPath
 * @param {string} layerName
 * @param {{ extraFields?: Array<{name:string, tagKey:string}> }} [opts]
 * @returns {{ pointCount:number }}
 */
function writePointTab(taggedNodes, outTabPath, layerName, opts = {}) {
  const ds = gdal.open(outTabPath, 'w', 'MapInfo File');
  const srs = gdal.SpatialReference.fromEPSG(4326);
  const layer = ds.layers.create(layerName, srs, gdal.Point, ['ENCODING=CP1252']);
  layer.fields.add(new gdal.FieldDefn('Name', gdal.OFTString));
  for (const ef of opts.extraFields || []) {
    layer.fields.add(new gdal.FieldDefn(ef.name, gdal.OFTString));
  }

  let pointCount = 0;
  for (const node of taggedNodes) {
    const point = new gdal.Point(node.lon, node.lat);
    const feature = new gdal.Feature(layer);
    feature.setGeometry(point);
    feature.fields.set('Name', node.tags.name || '');
    for (const ef of opts.extraFields || []) {
      feature.fields.set(ef.name, node.tags[ef.tagKey] || '');
    }
    // Estilo NATIVO por feature (no por capa) -- confirmado real que MITAB (driver MapInfo de
    // GDAL) soporta esto (`DCAP_FEATURE_STYLES_WRITE=YES`) -- cada punto guarda su propio símbolo,
    // así una sola capa/`.TAB` puede mostrar íconos distintos por categoría sin tener que separar
    // en un archivo por tipo de POI.
    feature.setStyleString(styleForTags(node.tags));
    layer.features.add(feature);
    pointCount++;
  }

  ds.close();
  return { pointCount };
}

module.exports = { writePointTab };
