// Genera un `.gst` (GeoSet de MapInfo) -- Objetivo 3, Fase 1. Formato CONFIRMADO real (ver
// `C:\MAPS\ECUADOR\Mapinfo\ec.gst`): texto plano tipo INI, `"\ruta\clave" = "valor"` una por
// línea, envuelto en `begin_metadata`/`end_metadata`. No hace falta ingeniería reversa -- es
// simplemente generar el mismo texto.
//
// v1 (prueba de concepto): un GeoSet mínimo de UNA sola capa (o pocas), sin todo el catálogo real
// de 21+ capas de un dataset de producción -- suficiente para confirmar que RIIMS/GeoSet Manager
// abre el resultado y dibuja la geometría real de OSM.

/**
 * @param {object} opts
 * @param {string} opts.name - nombre corto del geoset (ej. "ec_osm_test")
 * @param {{south:number, west:number, north:number, east:number}} opts.bbox - MBR real de los datos
 * @param {Array<{
 *   file: string,          // nombre del .TAB, relativo a la carpeta del .gst
 *   description: string,
 *   zoomMin?: number,
 *   zoomMax?: number,
 *   lineColor?: number,    // BGR empaquetado en un entero, mismo esquema que MapInfo (ver muestra real)
 *   lineWidth?: number,
 *   fillColor?: number,    // si viene, agrega un BRUSH sólido (capas de polígono -- edificios, agua, uso de suelo)
 *   symbolColor?: number,  // si viene, agrega un SYMBOL (capas de punto -- POIs, poblaciones)
 *   symbolCode?: number,   // código de símbolo MapInfo (default 32, un círculo relleno)
 *   autoLabel?: boolean,   // default true -- apagar en capas de fondo/alta densidad a nivel país
 *                          // (límites, ríos, agua, uso de suelo, bosques grandes) para no
 *                          // saturar la vista con texto superpuesto (pedido 2026-07-25, "no
 *                          // logro ver bien el mapa" -- confirmado que el ruido visual real era
 *                          // el auto-etiquetado de TODAS las capas a la vez, no una rotación).
 *   labelZoomMax?: number, // zoom máximo SOLO para el texto de la etiqueta -- la geometría de la
 *                          // capa sigue con su propio `zoomMax` (puede seguir visible de lejos),
 *                          // el NOMBRE recién aparece por debajo de este valor (más cerca).
 *                          // Confirmado real que el `.gst` de MapInfo soporta esto por separado
 *                          // (`\LABEL\ZOOM\MIN`/`MAX`, ver `ec.gst` real) -- pedido 2026-07-25,
 *                          // Highway_1/Highway_2 con 44mil tramos saturaban el país entero de
 *                          // texto aunque la línea en sí debía seguir visible desde lejos.
 *   thickRoad?: boolean,   // si viene TRUE en una capa de línea (sin fillColor), usa el patrón
 *                          // LINEPEN "193" que usan Highway_1/Highway_2 en la muestra real (línea
 *                          // gruesa tipo autopista) en vez del "1" plano de una calle común.
 *   showLineDirection?: boolean, // flechas de sentido -- pensado para una capa APARTE de solo
 *                          // los tramos `oneway=yes/1/-1` (dibujada encima de la calle normal),
 *                          // no para prenderlo en TODA una capa de calles mixtas.
 * }>} opts.layers
 * @returns {string} contenido completo del `.gst`
 */
function buildGeoSet({ name, bbox, layers }) {
  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;

  const lines = ['!GEOSET', '!VERSION 450', 'begin_metadata'];
  const kv = (path, value) => lines.push(`"${path}" = "${value}"`);

  kv('\\GEOSET', '');
  kv('\\GEOSET\\NAME', name);
  kv('\\GEOSET\\PROJECTION', '1,104');
  kv('\\GEOSET\\CENTER', `${centerLon},${centerLat}`);
  kv('\\GEOSET\\MBR', '');
  kv('\\GEOSET\\MBR\\LOWERLEFT', `${bbox.west},${bbox.south}`);
  kv('\\GEOSET\\MBR\\UPPERRIGHT', `${bbox.east},${bbox.north}`);
  // BUG REAL encontrado 2026-07-25: acá había un valor arbitrario ("10") en vez de uno real -- el
  // `.gst` real de Ecuador usa `2954.15` para un país de tamaño comparable. Sospecha confirmada
  // por el usuario en Roadshow real: la ventana de "instalar mapa" mostraba un "Scale" raro
  // (62) para nuestro geoset, y el fondo visual no se dibujaba en el Route Planner -- consistente
  // con que Roadshow usa este campo para calcular la escala/extensión inicial del geoset entero,
  // no solo un valor cosmético. Se copia el mismo orden de magnitud que la muestra real en vez de
  // inventar un número -- no se terminó de confirmar la fórmula exacta (¿proporcional al ancho del
  // MBR en grados? ¿unidad fija?), pendiente si hace falta calibrar más countries de tamaño muy
  // distinto a Ecuador.
  kv('\\GEOSET\\ZOOMLEVEL', '2954.15');
  kv('\\GEOSET\\AUTOLAYER', 'FALSE');
  kv('\\GEOSET\\MAPUNIT', '1');
  kv('\\GEOSET\\ROTATION', '0');
  kv('\\TABLE', '');

  layers.forEach((layer, i) => {
    const n = i + 1;
    const p = `\\TABLE\\${n}`;
    kv(p, '');
    kv(`${p}\\FILE`, layer.file);
    kv(`${p}\\DESCRIPTION`, layer.description);
    kv(`${p}\\ISVISIBLE`, 'TRUE');
    kv(`${p}\\AUTOLABEL`, layer.autoLabel === false ? 'FALSE' : 'TRUE');
    kv(`${p}\\DRAWLABELSAFTER`, 'FALSE');
    kv(`${p}\\SHOWLINEDIRECTION`, layer.showLineDirection ? 'TRUE' : 'FALSE');
    kv(`${p}\\SHOWNODES`, 'FALSE');
    kv(`${p}\\SHOWCENTROIDS`, 'FALSE');
    kv(`${p}\\EDITABLE`, 'FALSE');
    kv(`${p}\\SELECTABLE`, 'TRUE');
    kv(`${p}\\REGISTERINGEOODICT`, 'TRUE');
    kv(`${p}\\ZOOM`, '');
    kv(`${p}\\ZOOM\\MIN`, String(layer.zoomMin ?? 0));
    kv(`${p}\\ZOOM\\MAX`, String(layer.zoomMax ?? 100000));
    kv(`${p}\\DISPLAY`, '');
    if (typeof layer.fillColor === 'number') {
      kv(`${p}\\DISPLAY\\BRUSH`, '');
      kv(`${p}\\DISPLAY\\BRUSH\\Pattern`, '2');
      kv(`${p}\\DISPLAY\\BRUSH\\Forecolor`, String(layer.fillColor));
      kv(`${p}\\DISPLAY\\BRUSH\\Backcolor`, '16777215');
      kv(`${p}\\DISPLAY\\BRUSH\\Transparent`, 'FALSE');
    }
    // BUG REAL encontrado 2026-07-25 (pedido "que se vea como OSM"): las capas de LÍNEA reales
    // (Highway_1/Highway_2/AllStreets en `ec.gst`) usan DOS lápices, no uno -- `PEN` (fino,
    // negro, referencia/selección) + `LINEPEN` (el que se ve de verdad, con el color/ancho real).
    // Nuestro generador solo escribía `PEN` -- por eso los caminos salían finitos/apagados en vez
    // del look "grueso y sólido" de un camino real. Las capas de POLÍGONO (con `fillColor`) NO
    // tienen `LINEPEN` en la muestra real (solo `PEN` como borde del relleno) -- se preserva esa
    // distinción acá.
    kv(`${p}\\DISPLAY\\PEN`, '');
    kv(`${p}\\DISPLAY\\PEN\\LineWidth`, '1');
    kv(`${p}\\DISPLAY\\PEN\\LineStyle`, '1');
    kv(`${p}\\DISPLAY\\PEN\\Pattern`, '2');
    kv(`${p}\\DISPLAY\\PEN\\Color`, typeof layer.fillColor === 'number' ? String(layer.lineColor ?? 0) : '0');
    if (typeof layer.fillColor !== 'number') {
      kv(`${p}\\DISPLAY\\LINEPEN`, '');
      kv(`${p}\\DISPLAY\\LINEPEN\\LineWidth`, String(layer.lineWidth ?? 1));
      kv(`${p}\\DISPLAY\\LINEPEN\\LineStyle`, layer.thickRoad ? '193' : '1');
      kv(`${p}\\DISPLAY\\LINEPEN\\Pattern`, layer.thickRoad ? '193' : '2');
      kv(`${p}\\DISPLAY\\LINEPEN\\Color`, String(layer.lineColor ?? 0));
    }
    if (typeof layer.symbolColor === 'number') {
      kv(`${p}\\DISPLAY\\SYMBOL`, '');
      kv(`${p}\\DISPLAY\\SYMBOL\\Type`, '0');
      kv(`${p}\\DISPLAY\\SYMBOL\\Code`, String(layer.symbolCode ?? 32));
      kv(`${p}\\DISPLAY\\SYMBOL\\Color`, String(layer.symbolColor));
      kv(`${p}\\DISPLAY\\SYMBOL\\Pointsize`, '12');
    }
    kv(`${p}\\LABEL`, '');
    if (typeof layer.labelZoomMax === 'number') {
      kv(`${p}\\LABEL\\ZOOM`, '');
      kv(`${p}\\LABEL\\ZOOM\\MIN`, '0');
      kv(`${p}\\LABEL\\ZOOM\\MAX`, String(layer.labelZoomMax));
    }
    kv(`${p}\\LABEL\\FONT`, '');
    kv(`${p}\\LABEL\\FONT\\Style`, layer.labelBold ? '1' : '0');
    kv(`${p}\\LABEL\\FONT\\ExtStyle`, '0');
    kv(`${p}\\LABEL\\FONT\\Description`, 'Arial');
    kv(`${p}\\LABEL\\FONT\\Size`, String(layer.labelSize ?? 9));
    kv(`${p}\\LABEL\\FONT\\Forecolor`, '0');
    kv(`${p}\\LABEL\\FONT\\Backcolor`, '16777215');
    kv(`${p}\\LABEL\\FONT\\Opaque`, 'FALSE');
    kv(`${p}\\LABEL\\DUPLICATE`, 'FALSE');
    kv(`${p}\\LABEL\\PARALLEL`, 'TRUE');
    kv(`${p}\\LABEL\\OVERLAP`, 'FALSE');
    kv(`${p}\\LABEL\\PARTIALSEGMENTS`, 'FALSE');
    kv(`${p}\\LABEL\\LINETYPE`, '2');
    kv(`${p}\\LABEL\\OFFSET`, '2');
    kv(`${p}\\LABEL\\POSITION`, '2');
  });

  lines.push('end_metadata');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildGeoSet };
