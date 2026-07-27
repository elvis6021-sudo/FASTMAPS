// Config compartida de la generación OSM -> MapInfo. Permite parametrizar país/carpeta por
// variables de entorno (las usa el módulo "Generar" de la app de escritorio), con Ecuador por
// defecto para no romper el uso manual de los scripts.
//   FM_PBF  = ruta al extracto .osm.pbf de entrada
//   FM_OUT  = carpeta de salida de los .TAB / .gst
//   FM_CODE = prefijo de país para los nombres de archivo (ej. 'EC', 'CO', 'MX')
//   FM_NAME = nombre del geoset dentro del .gst (ej. 'ecuador_osm')
//   FM_BBOX = "west,south,east,north" (MBR del país, para el .gst)
const path = require('path');

const CODE = process.env.FM_CODE || 'EC';
const NAME = process.env.FM_NAME || 'ecuador_osm';
const DEFAULT_DIR = path.join(__dirname, 'output', 'osm_ecuador');
const OUT_DIR = process.env.FM_OUT || DEFAULT_DIR;
const PBF_PATH = process.env.FM_PBF || path.join(DEFAULT_DIR, 'ecuador.osm.pbf');

// MBR por defecto = Ecuador continental + Galápagos. Override con FM_BBOX="w,s,e,n".
let BBOX = { south: -5.1, west: -92.1, north: 1.6, east: -75.1 };
if (process.env.FM_BBOX) {
  const [w, s, e, n] = process.env.FM_BBOX.split(',').map(Number);
  if ([w, s, e, n].every((v) => !isNaN(v))) BBOX = { west: w, south: s, east: e, north: n };
}

const tab = (name) => path.join(OUT_DIR, `${name}_${CODE}_OSM.TAB`); // ruta completa del .TAB
const lyr = (name) => `${name}_${CODE}_OSM`;                          // nombre de la tabla adentro

module.exports = { CODE, NAME, OUT_DIR, PBF_PATH, BBOX, tab, lyr };
