// Traduce el estilo parseado del .gst de MapInfo (ver backend/lib/gstParser.js) a capas de
// Mapbox GL. Es una traducción mecánica de estructura, no un rediseño — el color/grosor/orden
// ya viene decidido en los datos del dataset (ver memoria map_editor_mapinfo_visual.md).
import type * as mapboxgl from 'maplibre-gl';
import type { GstLayerStyle } from './api';

const MILES_PER_DEGREE_LAT = 69.0;

/** Ancho aproximado del viewport actual, en millas (mismo tipo de unidad que usa el .gst). */
export function viewportWidthMiles(bounds: mapboxgl.LngLatBounds): number {
  const centerLat = (bounds.getNorth() + bounds.getSouth()) / 2;
  const milesPerDegreeLon = MILES_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  return (bounds.getEast() - bounds.getWest()) * milesPerDegreeLon;
}

/** Capas que sí conviene mostrar dado el ancho actual del viewport (en millas). */
export function activeLayers(layers: GstLayerStyle[], widthMiles: number): GstLayerStyle[] {
  return layers.filter((l) => {
    if (!l.visible) return false;
    const min = l.zoomMin ?? 0;
    const max = l.zoomMax ?? Infinity;
    return widthMiles >= min && widthMiles <= max;
  });
}

function sourceId(layerName: string) {
  return `src-${layerName}`;
}

/** IDs de las capas Mapbox generadas para una capa GST (puede ser más de una: fill + línea). */
export function mapboxLayerIds(layerName: string): string[] {
  return [`fill-${layerName}`, `line-${layerName}`, `label-${layerName}`];
}

// Campo de texto a usar como etiqueta, por capa — confirmado contra datos reales de México
// (distinto nombre de campo por capa, no hay una convención uniforme en los .TAB). Capas sin
// entrada acá simplemente no muestran etiqueta (autolabel del .gst se ignora si no sabemos
// el campo).
const LABEL_FIELD: Record<string, string> = {
  AllStreets: 'Street_Name',
  Highway_1: 'Highway_Name',
  Highway_2: 'Highway_Name',
  // Nombre de ciudad/localidad — mismo campo confirmado en México y Colombia para las 4
  // capas de Settlement (áreas) y sus variantes "_S" (puntos, usadas cuando el zoom está
  // demasiado alejado para dibujar el polígono completo). Sin esto, encender estas capas
  // desde el panel de Capas no mostraba ningún nombre — solo la forma/punto, sin etiqueta.
  Settlement_1: 'Polygon_Name',
  Settlement_2: 'Polygon_Name',
  Settlement_3: 'Polygon_Name',
  Settlement_4: 'Polygon_Name',
  Settlement_1_S: 'Polygon_Name',
  Settlement_2_S: 'Polygon_Name',
  Settlement_3_S: 'Polygon_Name',
};

// Capas cuya geometría es una LÍNEA (calles/autopistas) — ahí sí conviene que la etiqueta siga
// el trazo (`symbol-placement: 'line'`). Las capas de Settlement son polígonos (áreas urbanas) o
// puntos (variantes "_S"), donde seguir el borde del polígono da una etiqueta rara pegada al
// contorno — para esas se usa el placement por defecto de Mapbox ('point', centrado en la forma).
const LINE_GEOMETRY_PREFIXES = ['AllStreets', 'Highway_1', 'Highway_2'];

// Los nombres de capa NO son iguales entre países — confirmado (2026-07-08) contra los 8
// datasets reales disponibles (México, Colombia, Ecuador, Honduras, Panamá, Jamaica, Curazao,
// Barbados): el nombre BASE de cada capa (AllStreets, Highway_1, Settlement_4, etc.) y sus
// campos (Street_Name, Highway_Name, Polygon_Name) son IDÉNTICOS en los 8 — es un esquema fijo
// del proveedor (HERE/Navteq), no una convención nuestra. Lo único que cambia por país es un
// sufijo de 2 letras (México/Jamaica/Curazao: sin sufijo; Colombia: "_CO"; Ecuador: "_EC";
// Honduras: "_HN"; Panamá: "_PA"). Por eso NINGÚN lookup acá puede ser por nombre exacto — todo
// matchea por prefijo, lo que significa que un dataset nuevo de cualquier país de LatAm que siga
// este mismo esquema del proveedor funciona automáticamente, sin tocar código.
function matchesBase(name: string, base: string): boolean {
  return name === base || name.startsWith(`${base}_`);
}

function lookupByPrefix<T>(table: Record<string, T>, name: string): T | undefined {
  for (const key in table) {
    if (matchesBase(name, key)) return table[key];
  }
  return undefined;
}

/** Ídem `lookupByPrefix`, pero para listas simples (ej. "capas visibles por defecto"). */
export function matchesAnyBase(name: string, bases: string[]): boolean {
  return bases.some((base) => matchesBase(name, base));
}

/**
 * Construye las capas Mapbox GL (fill/line) para UNA capa GST, en el orden en que deben
 * agregarse al mapa. Las fuentes deben existir de antemano (ver ensureSources).
 */
export function gstLayerToMapboxLayers(gst: GstLayerStyle): mapboxgl.AddLayerObject[] {
  const src = sourceId(gst.name);
  const out: mapboxgl.AddLayerObject[] = [];

  if (gst.style.fillColor && !gst.style.fillTransparent) {
    out.push({
      id: `fill-${gst.name}`,
      type: 'fill',
      source: src,
      filter: ['==', ['geometry-type'], 'Polygon'],
      // Colores/opacidad del .gst tal cual (confirmado que se ven bien) — el único ajuste
      // pedido fue el color de las ETIQUETAS, no el fondo.
      paint: { 'fill-color': gst.style.fillColor, 'fill-opacity': 0.6 },
    });
  }
  if (gst.style.lineColor) {
    out.push({
      id: `line-${gst.name}`,
      type: 'line',
      source: src,
      paint: {
        'line-color': gst.style.lineColor,
        'line-width': gst.style.lineWidth ?? 1,
      },
    });
  }

  const labelField = lookupByPrefix(LABEL_FIELD, gst.name);
  if (labelField && gst.label.autoLabel) {
    const followsLine = matchesAnyBase(gst.name, LINE_GEOMETRY_PREFIXES);
    out.push({
      id: `label-${gst.name}`,
      type: 'symbol',
      source: src,
      layout: {
        ...(followsLine ? { 'symbol-placement': 'line' as const } : {}),
        'text-field': ['get', labelField],
        // Bold en vez de Regular: a tamaño chico y rotado (etiquetas de calle siguiendo la
        // línea), un trazo Regular es tan fino que el antialiasing lo licúa a gris pase lo que
        // pase con el color/halo -- Bold da grosor real de píxeles para que el negro se vea
        // negro.
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold', 'Open Sans Regular'],
        'text-size': Math.max(gst.label.fontSize ?? 10, 13),
      },
      paint: {
        // Color real de LABEL\FONT\Forecolor del .gst (fallback a negro si esa capa no lo
        // define). Halo fino sin blur, solo para separar el texto de líneas que cruzan por
        // debajo -- ya no tiene que cargar con el trabajo de "hacerse notar" que hacía con
        // Regular, así que un ancho chico alcanza sin lavar el negro a gris.
        'text-color': gst.label.color ?? '#000000',
        'text-halo-color': '#ffffff',
        'text-halo-width': 0.6,
        'text-halo-blur': 0,
      },
    });
  }
  return out;
}

// Etiquetas/colores por tipo de edición — compartidos entre el overlay de calles editadas en
// el mapa (MapEditor.tsx) y la lista de ediciones (EditsPanel.tsx), para que el color de la
// línea en el mapa siempre coincida con el color mostrado en la lista.
export const EDIT_KIND_LABELS: Record<string, string> = {
  block: 'Bloqueo',
  speed: 'Velocidad',
  'population-code': 'Población',
  turn: 'Giro',
};

export const EDIT_KIND_COLORS: Record<string, string> = {
  block: '#ef4444', // rojo
  speed: '#f59e0b', // ámbar
  'population-code': '#a855f7', // púrpura
  turn: '#06b6d4', // cian
};

export { sourceId };
