// Parsea archivos MapInfo GeoSet (.gst) — formato de texto tipo INI con claves jerárquicas
// (`"\TABLE\8\DISPLAY\LINEPEN\Color" = "8421504"`). Un GeoSet define, para cada capa MapInfo
// combinada en un mapa, su orden de dibujo, rango de zoom visible, y estilo (color/grosor de
// línea, relleno, fuente de etiquetas) — es decir, el diseño cartográfico YA HECHO por HERE/
// Navteq para estos mapas, que sería un desperdicio reinventar a mano.
const fs = require('fs');

/** Convierte un color MapInfo (entero decimal, formato Windows COLORREF 0x00BBGGRR) a "#RRGGBB". */
function mapInfoColorToHex(decimalColor) {
  const n = Number(decimalColor) >>> 0;
  const r = n & 0xff;
  const g = (n >> 8) & 0xff;
  const b = (n >> 16) & 0xff;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Parsea un .gst y devuelve { meta, layers: [...] } — `layers` en el MISMO orden en que
 * aparecen en el archivo (orden de dibujo: la convención de MapInfo es que la tabla \TABLE\1 es
 * la de MÁS ABAJO/primera en dibujarse, y las siguientes se dibujan encima — confirmar
 * visualmente al armar el estilo Mapbox, invertir el arreglo si el resultado se ve al revés).
 */
function parseGst(gstPath) {
  const text = fs.readFileSync(gstPath, 'latin1');
  const kv = {};
  const lineRe = /^"([^"]*)"\s*=\s*"([^"]*)"\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;
    kv[m[1]] = m[2];
  }

  const meta = {
    name: kv['\\GEOSET\\NAME'],
    center: (kv['\\GEOSET\\CENTER'] || '').split(',').map(Number),
    mbr: {
      lowerLeft: (kv['\\GEOSET\\MBR\\LOWERLEFT'] || '').split(',').map(Number),
      upperRight: (kv['\\GEOSET\\MBR\\UPPERRIGHT'] || '').split(',').map(Number),
    },
  };

  // Encuentra los índices de tabla presentes: claves "\TABLE\N\FILE"
  const tableIndices = new Set();
  for (const key of Object.keys(kv)) {
    const m = /^\\TABLE\\(\d+)\\FILE$/.exec(key);
    if (m) tableIndices.add(Number(m[1]));
  }
  const sortedIndices = [...tableIndices].sort((a, b) => a - b);

  const layers = sortedIndices.map((i) => {
    const p = (suffix) => kv[`\\TABLE\\${i}\\${suffix}`];
    const num = (suffix) => (p(suffix) !== undefined ? Number(p(suffix)) : undefined);
    const bool = (suffix) => p(suffix) === 'TRUE';

    const linePenColor = p('DISPLAY\\LINEPEN\\Color');
    const brushForecolor = p('DISPLAY\\BRUSH\\Forecolor');

    return {
      file: p('FILE'), // ej. "AllStreets.TAB"
      name: p('FILE') ? p('FILE').replace(/\.TAB$/i, '') : undefined,
      description: p('DESCRIPTION'),
      visible: bool('ISVISIBLE'),
      zoomMin: num('ZOOM\\MIN'),
      zoomMax: num('ZOOM\\MAX'), // undefined = sin límite (visible en todo el rango de zoom)
      style: {
        lineColor: linePenColor !== undefined ? mapInfoColorToHex(linePenColor) : undefined,
        lineWidth: num('DISPLAY\\LINEPEN\\LineWidth'),
        fillColor: brushForecolor !== undefined ? mapInfoColorToHex(brushForecolor) : undefined,
        fillTransparent: bool('DISPLAY\\BRUSH\\Transparent'),
      },
      label: {
        autoLabel: bool('AUTOLABEL'),
        fontSize: num('LABEL\\FONT\\Size'),
        zoomMax: num('LABEL\\ZOOM\\MAX'),
        color: p('LABEL\\FONT\\Forecolor') !== undefined
          ? mapInfoColorToHex(p('LABEL\\FONT\\Forecolor'))
          : undefined,
      },
    };
  });

  return { meta, layers };
}

module.exports = { parseGst, mapInfoColorToHex };
