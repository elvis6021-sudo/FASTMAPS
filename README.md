# Handoff técnico: pipeline OSM → capas visuales MapInfo (`.TAB` + `.gst`) para Roadshow

**Fecha de este documento:** 2026-07-27
**Autor:** investigación de código real (no diseño nuevo) sobre `C:\desktopApp\FastBuild\backend\`
**Para quién es esto:** un desarrollador nuevo, en un repositorio SEPARADO, que va a construir una
herramienta de escritorio para editar visualmente las capas de mapa (ancho de línea, color, zoom
por capa, orden de dibujo) que hoy se generan con el pipeline descrito acá — reemplazando el uso
manual de **GeoSet Manager** de MapInfo. Este documento es autocontenido: no asume que el lector
tiene acceso al resto del repo de FastBuild, aunque al final se listan las rutas reales por si
hace falta ir a mirar el código fuente.

---

## 1. Resumen ejecutivo

Roadshow (el software de navegación/ruteo del cliente) usa como "mapa de fondo" un dataset de
Navteq/HERE en formato **MapInfo Native** (archivos `.TAB`/`.DAT`/`.MAP`/`.ID` por capa) más un
archivo **`.gst`** (GeoSet) que define cómo dibujar esas capas juntas: orden, color, grosor,
rango de zoom visible, etiquetas. Ese dataset Navteq/HERE está **desactualizado** para varios
países de Latinoamérica (calles nuevas faltantes, barrios enteros sin mapear).

Este pipeline (carpeta `backend/` de un proyecto separado, `FastBuild`) resuelve esto para el
**fondo visual únicamente** (no toca el ruteo, que es un problema aparte — ver sección 5):

1. Descarga datos crudos de **OpenStreetMap** (OSM) — o bien un extracto de país completo
   (Geofabrik, formato `.pbf`) o bien un área puntual chica (Overpass API, formato `.osm` XML).
2. Convierte esos datos a **15 capas MapInfo `.TAB`** (calles en 3 niveles jerárquicos, edificios,
   uso de suelo, zonas verdes chicas/grandes, agua, ríos, costa, límites administrativos, POIs con
   ícono por categoría, ciudades/pueblos, aldeas, calles de sentido único).
3. Genera un archivo **`.gst`** que referencia esas 15 capas con un estilo visual básico (colores/
   grosores actualmente **genéricos, sin calibrar contra ningún estándar real** — este es
   exactamente el problema que la nueva herramienta de escritorio debe permitir arreglar a mano,
   capa por capa).

Este proceso completo fue **confirmado funcionando en Roadshow real** (no solo en GeoSet Manager)
con el país de **Ecuador completo** el 2026-07-25: 516,451 calles, 1,296,490 edificios, 43,859
zonas de uso de suelo, 17,086 zonas verdes chicas, 79,597 POIs, 23,515 ríos/arroyos, 342 cuerpos
de agua grandes, 299 bosques/parques grandes, 275 límites administrativos, ~13.8 millones de nodos
resueltos, en ~10 minutos de proceso con ~3GB de RAM. Quedan pendientes 16-17 países más de
Latinoamérica con el mismo proceso (tarea mecánica de "cierre", no investigación nueva).

**El problema que motiva la nueva herramienta** (ver sección 5 para el detalle): el `.gst` que
genera este pipeline hoy usa colores/grosores puestos "a ojo" por quien escribió el código, sin
ninguna calibración contra un estándar visual real — se ve peor que Google Maps/HERE. Además (
hallazgo de ESTA investigación, ver sección 4.4) el generador actual tiene un **bug real de
codificación de color** que invierte los canales Rojo y Azul. Ambos problemas — falta de
calibración Y el bug de canales — se resuelven mejor con una herramienta visual de edición capa
por capa que con seguir ajustando números a mano en el código del generador.

---

## 2. Flujo de datos end-to-end

```
Overpass API (área chica)  ─┐
                             ├─→  XML .osm  ─→  osmXmlParser.js  ─┐
Geofabrik .osm.pbf (país)  ─┘                                     │
                             └─→  binario .pbf → osmPbfParser.js ─┤
                                                                    ▼
                                          { nodes: Map, ways: Array<{id,refs,tags}> }
                                          (misma forma de salida en ambos casos)
                                                                    │
                             ┌──────────────────────────────────────┤
                             ▼                                      ▼
                   mapInfoStreetsWriter.js              mapInfoPolygonWriter.js
                   mapInfoMultiPolygonWriter.js          mapInfoPointWriter.js
                   (todos usan gdal-async, driver "MapInfo File", ENCODING=CP1252)
                             │
                             ▼
                    15 archivos <Capa>_<CC>_OSM.TAB  (+ .DAT/.MAP/.ID, generados por GDAL)
                             │
                             ▼
                        gstWriter.js (buildGeoSet)
                             │
                             ▼
                      <pais>_osm.gst  (texto plano, formato GeoSet de MapInfo)
                             │
                             ▼
              Se copian el .gst + los .TAB a la carpeta de mapas de Roadshow
              (mismo lugar donde vive el .gst real del proveedor, ej. C:\MAPS\ECUADOR\Mapinfo\)
              y Roadshow los usa como fondo visual del Route Planner.
```

Dos caminos de entrada, según la escala:

- **Overpass API** (`osmFetch.js`) — para áreas puntuales chicas (una cuadra, un barrio). Rápido,
  pero **no sirve para descargar un país entero** (Overpass está pensado para consultas
  acotadas, no bulk export — tiene timeouts y límites de tamaño).
- **Extracto Geofabrik `.osm.pbf`** — para país completo. Se descarga manualmente (no hay un
  script de descarga automática en este pipeline) desde
  `https://download.geofabrik.de/south-america/<pais>-latest.osm.pbf` (o la región que
  corresponda — `north-america`, `central-america`, `south-america`, etc. según el país), y se
  guarda en `backend/output/osm_<pais>/<pais>.osm.pbf`. Para un país mediano tipo Ecuador (124MB)
  el procesamiento completo toma ~10 minutos y ~3GB de RAM.

---

## 3. Los archivos fuente, uno por uno

Todo vive en `C:\desktopApp\FastBuild\backend\lib\osm\` (y los scripts orquestadores en
`C:\desktopApp\FastBuild\backend\` directamente, con prefijo `scratch_osm_country_*.js` — el
proyecto usa "scratch_*" como convención para scripts ejecutables sueltos, no son código muerto).

### 3.1 `osmFetch.js` — descarga vía Overpass API (áreas chicas)

Dos funciones exportadas: `fetchOsmWays(bbox, osmFilters)` y `fetchOsmNodes(bbox, osmFilters)`.
Arman una query Overpass QL contra `https://overpass-api.de/api/interpreter` (POST,
`Content-Type: application/x-www-form-urlencoded`, cuerpo `data=<query urlencoded>`).

Dos bugs reales documentados en el propio archivo (relevantes si alguien reimplementa esto en
otro lenguaje/stack):

1. **Recursión de nodos en 2 pasos, no 1.** La forma "compacta" de Overpass QL
   (`way[...](bbox);>;out body;` en un solo bloque) devuelve el XML con la gran mayoría de los
   nodos referenciados por los `way` **faltantes** — Overpass no tira error, entrega un XML válido
   pero incompleto. El patrón correcto, usado acá, es:
   ```
   [out:xml][timeout:60];
   ( way["highway"](sur,oeste,norte,este); );
   out body;
   >;
   out skel qt;
   ```
   Es decir: primero `out body;` para los `way` con sus tags, LUEGO `>;` (recursa a los nodos
   referenciados) seguido de `out skel qt;` (los imprime, solo coordenadas, sin tags — no hacen
   falta para resolver geometría).
2. **Headers HTTP explícitos obligatorios.** Sin `Accept: */*` y `User-Agent: <algo>`, el Apache
   de Overpass devuelve `406 Not Acceptable` (rechazo de `mod_negotiation`) — `curl` los manda por
   default, `https.request` de Node.js no.

`fetchOsmNodes` es más simple (no necesita el paso de recursión — un nodo pedido directo YA es su
propia coordenada): usada para POIs (`amenity=*`/`shop=*`) y poblaciones (`place=*`), que en OSM
son nodos, no ways.

### 3.2 `osmXmlParser.js` — parser del XML de Overpass (áreas chicas)

Parser manual con regex, **deliberadamente sin usar el driver OSM de GDAL**. Motivo documentado:
en el binding usado (`gdal-async` + libgdal embebido), el driver OSM de GDAL solo devuelve un
puñado de features al iterar una capa (confirmado real: 3 de 115 calles reales en una prueba) —
problema conocido del driver con lectura "entrelazada" multi-capa en una sola pasada, no de los
datos. El formato XML de OSM es simple y estable, así que parsearlo a mano resultó más confiable.
GDAL sigue usándose, pero **solo para escribir** los `.TAB` de salida (ahí funciona sin problemas).

Exporta:

- **`parseOsmXml(osmFilePath)`** → `{ nodes: Map<id,{lat,lon}>, ways: Array<{id,refs,tags}>,
  taggedNodes: Array<{id,lat,lon,tags}> }`. Distingue 2 formas de `<node>` en el XML de Overpass:
  self-closing sin tags (nodos "esqueleto" de `out skel qt;`, solo para resolver coordenadas de un
  `way`, van a `nodes`) vs. bloque con `<tag>` hijos (un nodo pedido directo — un POI o una
  población — va a `taggedNodes` ADEMÁS de a `nodes`).
- **`resolveWayCoords(parsed, way)`** → `[lon,lat][]`, resolviendo cada `nd ref` del `way` contra
  el `Map` de nodos. Tira error explícito (no genera geometría con huecos) si falta algún nodo
  referenciado.

### 3.3 `osmPbfParser.js` — parser de `.osm.pbf` a escala país (Geofabrik)

Distinto caso de uso que 3.2: acá el archivo de entrada es un extracto país/región completo
(decenas de MB, formato binario PBF), demasiado grande para Overpass y demasiado grande para
cargar entero en memoria como XML.

**Decisión técnica clave, ya probada y descartada la alternativa**: el driver OSM de GDAL tampoco
sirve para esto — incluso usando `gdal.vectorTranslate` (la misma maquinaria interna que
`ogr2ogr`), sigue devolviendo solo un puñado de features de un archivo con miles más (confirmado
real comparando contra el archivo de salida, no un bug de conteo). Se usa en su lugar
**`osm-pbf-parser`** (paquete npm, streaming PBF puro JS vía `protocol-buffers`, sin compilación
nativa) — confirmado real leyendo 500k+ nodos de un extracto de 124MB sin problema.

**Arquitectura de 2 (o 3) pasadas, memoria-eficiente** — clave para entender el código:

1. `collectWays(pbfPath, wayFilter)` — primera pasada: filtra los `way` que cumplen el filtro
   pedido (ej. `t => !!t.highway`) y anota SOLO los IDs de nodo que van a hacer falta (no todos
   los nodos del país, que pueden ser decenas de millones).
2. `collectNodeCoords(pbfPath, neededNodeIds)` — segunda pasada: relee el archivo, guardando
   coordenadas SOLO para esos IDs ya anotados.
3. `parseOsmPbfWays(pbfPath, wayFilter)` — combina las dos anteriores, devuelve la MISMA forma de
   salida que `osmXmlParser.js::parseOsmXml` (`{nodes, ways}`) para poder reusar los mismos
   escritores de `.TAB` sin modificarlos.
4. `parseOsmPbfWaysMulti(pbfPath, wayFilters)` — versión multi-capa: **una sola pasada** de `way`
   para VARIOS grupos a la vez (clasifica cada `way` en el primer grupo cuyo filtro matchea) +
   una sola pasada de nodos para la unión de IDs de todos los grupos. Evita releer el archivo país
   completo una vez por capa (con 124MB y 4+ capas, cada pasada de más suma minutos reales).
5. `collectTaggedNodes(pbfPath, nodeFilter)` — una sola pasada, para capas de PUNTO (POIs,
   poblaciones): la geometría de un nodo etiquetado directo ES su propia coordenada.
6. `collectRelations` / `assembleRing` / `parseOsmPbfRelations` / `parseOsmPbfRelationsMulti` —
   soporte para **relaciones multipolígono** de OSM (agregado 2026-07-25, pedido "que se vea
   exactamente igual a OSM.org"): bosques/parques/lagos/límites administrativos GRANDES en OSM
   casi siempre son relaciones (varios `way` separados combinados con roles `outer`/`inner`), no
   un solo `way` cerrado simple — sin esto, la capa de "zonas verdes" salía casi vacía a nivel
   país. **Limitación deliberada de v1**: solo se arma el/los anillo(s) exterior(es)
   (`role=outer`) — los agujeros internos (`role=inner`, ej. una isla dentro de un lago) se
   ignoran, el polígono sale relleno de más en esos casos. El ensamblado de anillo
   (`assembleRing`) es un algoritmo goloso simple: encadena los `way` por extremos compartidos, no
   es un armador de multipolígono 100% fiel al spec de OSM.

**Bug de escala encontrado y corregido, relevante si se procesan países grandes**: ver
`bigIdCollections.js` abajo (sección 3.4).

### 3.4 `bigIdCollections.js` — `BigIdSet`/`BigIdMap` (workaround de límite de V8)

Bug real encontrado procesando Colombia (322MB, 2.6x Ecuador): V8 limita `Set`/`Map` nativos de
JavaScript a ~16.7 millones de entradas (comparten la misma tabla hash interna) — Ecuador (124MB)
nunca se acercó a ese límite, Colombia sí (`RangeError: Set maximum size exceeded` juntando los
nodos referenciados por TODAS las ways de streets+buildings+landuse+green en una sola pasada).

`BigIdSet`/`BigIdMap` shardean los IDs por `id % 64` en 64 `Set`/`Map` nativos separados — mismo
API mínimo que ya usaba el código llamador (`add`/`has` para Set; `set`/`get`/`has`/`values()`/
`entries()` para Map), sin tocar la lógica de `osmPbfParser.js`.

### 3.5 `mapInfoStreetsWriter.js` — capa de calles (línea)

`writeStreetsTab(parsed, outTabPath, layerName, opts)` → `{wayCount, skipped}`.

- Usa `gdal-async`: `gdal.open(outTabPath, 'w', 'MapInfo File')`, `SpatialReference.fromEPSG(4326)`
  (WGS84 lat/lon directo, sin reproyección), `layer.fields.add(FieldDefn('Street_Name',
  OFTString))` — **un solo campo**, `Street_Name` (Char 80 en el `.TAB` real de producción). Esquema
  confirmado contra un `.TAB` de producción real (`C:\MAPS\ECUADOR\Mapinfo\AllStreets_EC.TAB`).
  Esta capa es puramente visual (el ruteo real lo maneja el `.lmb`, un formato binario propietario
  totalmente distinto — no relacionado a este pipeline), así que no hace falta replicar más
  atributos que el nombre.
- **`ENCODING=CP1252` es obligatorio** al crear la capa — sin esto, GDAL escribe charset "Neutral"
  (sin recodificar) y cualquier nombre con tilde/ñ queda mal codificado ("Callejón" →
  "CallejÃ³n", confirmado real en GeoSet Manager). El nombre de la opción GDAL no es el nombre de
  charset de MapInfo en sí (`WindowsLatin1`) sino su equivalente iconv (`CP1252`) — ver
  `IMapInfoFile::EncodingToCharset` en el driver MITAB de GDAL. Con esto el `.TAB` de salida queda
  `!charset WindowsLatin1` (igual que los `.TAB` reales de producción) y los acentos se leen bien.
- **Clasificación jerárquica por nivel de vía** (`HIGHWAY_TIER`), usada para separar en 3 capas
  distintas (`Highway_1`/`Highway_2`/`AllStreets`, ver sección 4):
  ```js
  const HIGHWAY_TIER = {
    motorway: 1, motorway_link: 1, trunk: 1, trunk_link: 1, primary: 1, primary_link: 1,
    secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
  };
  // cualquier otro valor de highway=* (residential, service, unclassified, footway, etc.) = tier 3
  ```
  Este mapeo es **arbitrario/razonable, no una correspondencia 1:1 confirmada** contra ninguna
  muestra real de clasificación Navteq — HERE/Navteq no tiene un equivalente exacto a las clases
  de OSM. Para la nueva herramienta o para calibrar mejor, ver la recomendación de usar
  **OSM-Carto** como referencia real (sección 5) — ese proyecto SÍ tiene un mapeo completo y
  público de `highway=*` a nivel visual (7-8 niveles, no solo 3).
- `writeStreetsTab` con `opts.tier` filtra solo los `way` de ESE nivel (para escribir
  `Highway1_XX_OSM.TAB`, `Highway2_XX_OSM.TAB`, `AllStreets_XX_OSM.TAB` como 3 llamadas separadas
  a la misma función). Sin `opts.tier`, escribe TODOS los `way` recibidos (usado para capas que no
  son de calles jerárquicas, ej. Rivers, Coastline, Oneway — reusan este mismo escritor).
- Un `way` con `refs.length < 2` (no forma una línea válida) o cuyos nodos no se pueden resolver
  (`resolveWayCoords` tira error) se cuenta como `skipped`, no se escribe.
- `way.tags.name` puede faltar (calles sin nombre en OSM, ej. caminos de servicio) — se deja
  vacío (`''`) en vez de inventar un nombre.

### 3.6 `mapInfoPolygonWriter.js` — capas de polígono simple (edificios, uso de suelo, zonas verdes chicas)

`writePolygonTab(parsed, outTabPath, layerName, opts)` → `{wayCount, skipped}`.

- Mismo esquema base que streets (GDAL, EPSG:4326, `ENCODING=CP1252`), pero geometría
  `gdal.Polygon` en vez de `LineString`, y campo base `Name` (no `Street_Name`).
- `opts.extraFields`: `Array<{name, tagKey}>` — campos adicionales copiados de
  `way.tags[tagKey]`. Usado por ejemplo para la capa de uso de suelo:
  `[{name:'Landuse', tagKey:'landuse'}]`.
- Solo maneja **"closed way" simple de OSM** (un `way` cuyo primer y último `nd ref` son el mismo
  nodo, con `refs.length >= 4`) — el caso más común de polígono en OSM. `way` que no cierran, o
  con menos de 4 refs, cuentan como `skipped`. Los polígonos GRANDES que en OSM real son
  relaciones multipolígono (no un solo `way` cerrado) **no** los maneja este escritor — para esos
  está `mapInfoMultiPolygonWriter.js` (sección 3.7).

### 3.7 `mapInfoMultiPolygonWriter.js` — capas de relación multipolígono (agua grande, bosques/parques grandes, límites administrativos)

`writeMultiPolygonTab(features, outTabPath, layerName, opts)` → `{featureCount, skipped}`.

- Toma la salida YA RESUELTA de `osmPbfParser.js::parseOsmPbfRelations`/`parseOsmPbfRelationsMulti`
  (un anillo exterior por feature, `{id, tags, ring:[lon,lat][]}`, sin huecos internos — ver
  limitación de v1 en 3.3), no la misma forma `{nodes, ways}` que usan los otros escritores.
- Mismo esquema GDAL base (`Polygon`, `Name` + `extraFields`), con un detalle extra: si el anillo
  ensamblado por `assembleRing` no quedó exactamente cerrado (primer punto ≠ último punto —
  posible con el algoritmo goloso de ensamblado), se agrega el punto de cierre a mano antes de
  escribir el polígono (MapInfo/GDAL necesitan un anillo cerrado válido).
- `item.ring.length < 4` → `skipped` (no alcanza para un polígono real).

### 3.8 `mapInfoPointWriter.js` — capa de puntos (POIs, poblaciones)

`writePointTab(taggedNodes, outTabPath, layerName, opts)` → `{pointCount}`.

- Geometría `gdal.Point`, campo base `Name` + `extraFields` igual que polígonos.
- **Estilo NATIVO por feature** (no por capa): cada punto guarda su propio símbolo vía
  `feature.setStyleString(...)`, confirmado real que el driver MITAB de GDAL soporta esto
  (`DCAP_FEATURE_STYLES_WRITE=YES`) — así una sola capa/`.TAB` de POIs puede mostrar íconos
  distintos por categoría sin tener que separar en un archivo por tipo.
- Tabla `POI_STYLES` — ícono/color por categoría de `amenity`/`shop` de OSM (usa símbolos
  portables `ogr-sym-0`..`ogr-sym-9` de GDAL — formas geométricas simples, círculo/cuadrado/
  triángulo/estrella/cruz, vacías o rellenas — no los íconos "reales" tipo tenedor/cruz que
  muestra OSM.org, eso necesitaría los códigos de carácter reales de la fuente "Map Symbols" de
  MapInfo, que **no están confirmados en este proyecto** — pendiente si se quiere ese nivel de
  fidelidad):

  | Categoría OSM (`amenity`/`shop`) | Símbolo | Color | Uso |
  |---|---|---|---|
  | `hospital`, `pharmacy`, `clinic`, `doctors` | `ogr-sym-8` (estrella rellena) | `#DC143C` rojo | Salud |
  | `restaurant`, `cafe`, `fast_food`, `bar` | `ogr-sym-3` (círculo relleno) | `#FF8C00` naranja | Comida |
  | `bank`, `atm`, `post_office` | `ogr-sym-1` (cuadrado relleno) | `#1E90FF` azul | Servicios/finanzas |
  | `school`, `university`, `kindergarten` | `ogr-sym-5` (triángulo relleno) | `#8A2BE2` violeta | Educación |
  | `place_of_worship` | `ogr-sym-7` (cruz) | `#696969` gris | Religioso |
  | `fuel` | `ogr-sym-1` (cuadrado relleno) | `#B8860B` ocre | Combustible |
  | `ferry_terminal` | `ogr-sym-0` (cuadrado vacío) | `#1E90FF` azul | Transporte |
  | cualquier otro `amenity`/`shop` | `ogr-sym-3` (círculo relleno) | `#555555` gris | Default |

### 3.9 `countryMapTemplate.js` — plantilla de las 15 capas (config declarativa)

`buildCountryLayers(code)` — dado un código corto de país (ej. `'EC'`), devuelve el `Array` de 15
configs de capa (`{file, description, lineColor, lineWidth, fillColor, zoomMax, ...}`) en el orden
real usado por `gstWriter.buildGeoSet`. Es la fuente única de verdad del **orden y estilo por
defecto** — cualquier cambio ahí se aplica a TODOS los países que se generen después. Ver la
tabla completa en la sección 4.

Nota importante: este archivo **existe como plantilla genérica reusable**, pero los scripts
`scratch_osm_country_*.js` actuales (sección 6) NO lo usan todavía — tienen los colores/capas
de Ecuador **hardcodeados directamente** en el propio script (`scratch_osm_country_gst.js`).
`countryMapTemplate.js` es la extracción "para cuando se repita en los otros 16 países", ya
preparada, pero el primer país (Ecuador) se armó a mano antes de que existiera esta plantilla.

### 3.10 `gstWriter.js` — generador del archivo `.gst`

`buildGeoSet({name, bbox, layers})` → `string` (contenido completo del `.gst`).

Formato confirmado real contra `C:\MAPS\ECUADOR\Mapinfo\ec.gst` — texto plano tipo INI, líneas
`"\ruta\clave" = "valor"`, envuelto en `begin_metadata`/`end_metadata`, terminador de línea
`\r\n`. Ver sección 4 para el detalle completo del formato y qué escribe esta función
exactamente por cada capa (ZOOM, PEN/LINEPEN, BRUSH, SYMBOL, LABEL).

### 3.11 Scripts orquestadores (`scratch_osm_country_*.js`)

Ver sección 6 — son los que arman el set completo llamando a las funciones de 3.1–3.10 en orden.

---

## 4. Las 15 capas confirmadas — nombre exacto, tags OSM, geometría

Confirmado contra el código real (`countryMapTemplate.js` y los 4 scripts `scratch_osm_country_*`)
y contra la memoria de cierre de sesión 2026-07-25 ("FASE 1 CERRADA POR HOY — Ecuador completo, 17
países pendientes"), que dice textualmente: *"Fase 1 (fondo visual OSM → MapInfo/GeoSet) queda
demostrada y funcionando de punta a punta con Ecuador completo (15 capas: calles en 3 niveles,
edificios, uso de suelo, zonas verdes chicas y grandes, agua, ríos, línea de costa, límites
administrativos, POIs con íconos por categoría, ciudades/pueblos, aldeas, calles de sentido único
con flecha — todo confirmado visualmente en Roadshow real, no solo en GeoSet Manager)"*. También
verificado directamente contra los archivos `.TAB` reales presentes en
`backend/output/osm_ecuador/` (exactamente 15, más el `.pbf` fuente y el `.gst` final).

Convención de nombre de archivo: `<Capa>_<CC>_OSM.TAB` (ej. `AllStreets_EC_OSM.TAB` para Ecuador),
generado por `countryMapTemplate.js::buildCountryLayers(code)` como `` `${name}_${code}_OSM.TAB` ``.

| # | Nombre de capa (`layerName`/archivo) | Geometría | Filtro OSM (tags) | Escritor usado | Notas |
|---|---|---|---|---|---|
| 1 | `Admin` | Polígono (multipolígono) | `boundary=administrative` con `admin_level=4` o `6`, dentro de una relación `type=boundary` | `mapInfoMultiPolygonWriter.js` | admin_level 4 ≈ provincia/estado, 6 ≈ municipio/cantón (según país) |
| 2 | `GreenBig` | Polígono (multipolígono) | relación `type=multipolygon` con `natural=wood` \| `landuse=forest` \| `leisure=park` \| `leisure=nature_reserve` \| `boundary=national_park` | `mapInfoMultiPolygonWriter.js` | bosques/parques grandes representados como relación (no way simple) |
| 3 | `Water` | Polígono (multipolígono) | relación `type=multipolygon\|boundary` con `natural=water` \| `waterway=riverbank` | `mapInfoMultiPolygonWriter.js` | lagos/cuerpos de agua grandes |
| 4 | `Coastline` | Línea | `natural=coastline` (way simple) | `mapInfoStreetsWriter.js` (sin filtro de tier) | reusa el escritor de calles, no es jerárquico |
| 5 | `LandUse` | Polígono simple | `landuse=*` **excepto** `forest` y `grass` (way cerrado simple) | `mapInfoPolygonWriter.js` | campo extra `Landuse` = valor del tag `landuse` |
| 6 | `Green` | Polígono simple | `leisure=park` \| `landuse=forest` \| `landuse=grass` \| `natural=wood` (way cerrado simple, NO relación) | `mapInfoPolygonWriter.js` | zonas verdes CHICAS (complementa `GreenBig`, que son las mismas categorías pero como relación grande) |
| 7 | `Buildings` | Polígono simple | `building=*` (way cerrado simple) | `mapInfoPolygonWriter.js` | |
| 8 | `Villages` | Punto | `place=village` \| `place=hamlet` | `mapInfoPointWriter.js` | aldeas/caseríos, solo visibles de cerca (`zoomMax:30`) |
| 9 | `CitiesTowns` | Punto | `place=city` \| `place=town` | `mapInfoPointWriter.js` | siempre visibles, etiqueta bold |
| 10 | `AllStreets` | Línea | `highway=*` que NO cae en tier 1 o 2 (ver tabla `HIGHWAY_TIER`, sección 3.5) — calles locales/residenciales/servicio | `mapInfoStreetsWriter.js` con `opts.tier:3` | |
| 11 | `Rivers` | Línea | `waterway=river` \| `waterway=stream` \| `waterway=canal` (way simple) | `mapInfoStreetsWriter.js` (sin tier) | |
| 12 | `Highway2` | Línea | `highway=secondary\|secondary_link\|tertiary\|tertiary_link` (tier 2) | `mapInfoStreetsWriter.js` con `opts.tier:2` | vías secundarias |
| 13 | `Highway1` | Línea | `highway=motorway\|motorway_link\|trunk\|trunk_link\|primary\|primary_link` (tier 1) | `mapInfoStreetsWriter.js` con `opts.tier:1` | vías principales |
| 14 | `Poi` | Punto | `amenity=*` \| `shop=*` (nodo etiquetado directo) | `mapInfoPointWriter.js` | campos extra `Amenity`, `Shop`; ícono por categoría (ver tabla 3.8) |
| 15 | `Oneway` | Línea | `highway=*` **y** `oneway=yes\|1\|-1` (way simple) | `mapInfoStreetsWriter.js` (sin tier) | capa APARTE, dibujada encima de la calle normal, solo para mostrar flecha de sentido (`SHOWLINEDIRECTION=TRUE` en el `.gst`) — NO reemplaza la calle en `AllStreets`/`Highway1`/`Highway2`, es un overlay |

**Orden de dibujo real** (el orden de la tabla de arriba, que es el mismo orden en que aparecen en
`countryMapTemplate.js` y en `scratch_osm_country_gst.js`): en el `.gst`, la capa listada
**DESPUÉS se dibuja ENCIMA**. Orden pensado: fondo/administrativo → áreas grandes (bosques/agua) →
costa → uso de suelo/áreas chicas → edificios → poblaciones → calles → ríos → vías principales →
POIs → sentido único (al tope, para que las flechas sean visibles sobre todo lo demás).

**Discrepancia con FINDINGS.md / la memoria**: ninguna encontrada — el conteo de 15 capas, la
lista de categorías temáticas mencionada en la memoria de cierre ("calles en 3 niveles, edificios,
uso de suelo, zonas verdes chicas y grandes, agua, ríos, línea de costa, límites administrativos,
POIs con íconos por categoría, ciudades/pueblos, aldeas, calles de sentido único") coincide
exactamente 1:1 con las 15 entradas de `countryMapTemplate.js` y con los 15 archivos `.TAB`
realmente presentes en `backend/output/osm_ecuador/`.

---

## 5. El problema que motiva la nueva herramienta: calidad visual del `.gst` generado

### 5.1 Contexto: qué reportó el usuario

Sesión 2026-07-27 (ver `FastBuild/bridge/FINDINGS.md`, entrada "Objetivo 3, Fase 4 ... + Fase 1
(nota de calidad visual)"): el usuario notó que la **red vial (ruteo)** coincide bien contra mapas
de referencia (HERE web, Google Maps web), pero el **fondo visual** generado por este pipeline
"se ve raro"/menos preciso en comparación. Se investigó a fondo y se confirmó que:

- El escritor de MapInfo (`mapInfoStreetsWriter.js`, vía `gdal-async`) es **fiel a los datos OSM
  crudos**: sin reproyección (EPSG:4326 igual que el OSM original), sin redondeo (usa
  `parseFloat`/double de punta a punta), sin simplificación de geometría. Confirmado comparando
  coordenadas reales, diferencia <1m.
- La conclusión de esa sesión fue: **no es un bug de precisión/datos** — es calidad de estilo
  cartográfico sin calibrar (líneas finas sin buena jerarquía visual por grosor/color, sin el
  tratamiento visual pulido de HERE/Google).

### 5.2 Hallazgo adicional de ESTA investigación (2026-07-27): bug real de codificación de color

Comparando `gstWriter.js`/`countryMapTemplate.js` (proyecto `FastBuild`, este pipeline) contra
`gstParser.js` (proyecto separado `map-editor`, que YA lee y decodifica `.gst` reales de
producción y fue validado visualmente contra GeoSet Manager), aparece una inconsistencia real:

**`gstParser.js` (map-editor, validado)** decodifica el color como un **`COLORREF` estándar de
Windows** (`0x00BBGGRR` — el byte MÁS BAJO es Rojo):
```js
function mapInfoColorToHex(decimalColor) {
  const n = Number(decimalColor) >>> 0;
  const r = n & 0xff;          // byte 0 (más bajo) = R
  const g = (n >> 8) & 0xff;   // byte 1 = G
  const b = (n >> 16) & 0xff;  // byte 2 = B
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}
```
Este decode fue confirmado real leyendo `mx.gst` (México) y comparando visualmente contra GeoSet
Manager: `Highway_1` real decodifica a `#00f0f0` (cian), `Highway_2` a `#0000ff` (azul) — colores
que el usuario confirmó ver correctamente en GeoSet Manager.

**`gstWriter.js` (FastBuild, este pipeline)** en cambio construye el entero de color así:
```js
function rgb(r, g, b) {
  return r * 65536 + g * 256 + b;
}
```
El propio comentario del archivo dice explícitamente: *"entero de color = R\*65536 + G\*256 + B
(no es el orden COLORREF de Windows)"* — un reconocimiento consciente de que se usa un orden
DISTINTO al de `gstParser.js`.

**Estas dos fórmulas no son compatibles.** Haciendo el álgebra: si `gstWriter.js` construye
`V = R*65536 + G*256 + B` con la intención de un color `RGB(R,G,B)`, y MapInfo (según el formato
real confirmado por `gstParser.js`) decodifica ese mismo entero como COLORREF estándar
(`r_real = V & 0xFF`, `g_real = (V>>8) & 0xFF`, `b_real = (V>>16) & 0xFF`), el resultado es:

```
r_real = B        (el canal Azul que se quería, termina en el canal Rojo)
g_real = G        (el canal Verde sí coincide — está en el medio en ambos esquemas)
b_real = R        (el canal Rojo que se quería, termina en el canal Azul)
```

Es decir, **`gstWriter.js` invierte los canales Rojo y Azul** de cada color que escribe. Ejemplo
concreto con la capa `Water` de `countryMapTemplate.js` (`rgb(120, 170, 200)`, intención: azul
agua): el entero resultante, decodificado como COLORREF real, se muestra como `RGB(200,170,120)`
— un **tono cálido/tostado**, no azul. El propio comentario de `scratch_osm_country_gst.js` que
afirma *"Highway_1 real = 15790080 = RGB(240,240,0), un amarillo/oliva claro"* es, con el decode
COLORREF real, en realidad `RGB(0,240,240)` — **cian**, no amarillo — que además coincide
exactamente con el valor de `Highway_1` ya confirmado independientemente para México
(`#00f0f0`, cian) en la investigación del proyecto `map-editor`. Esto es evidencia cruzada fuerte
de que `gstParser.js` tiene el formato correcto y `gstWriter.js` tiene un bug real de canal
invertido.

**Impacto práctico**: todos los colores definidos en `countryMapTemplate.js` /
`scratch_osm_country_gst.js` (Admin morado, GreenBig/Green verde, Water/Rivers/Coastline azul,
LandUse crema, Buildings arena, AllStreets gris, Highway1/2 amarillo/naranja) se están escribiendo
al `.gst` con Rojo y Azul intercambiados respecto a lo que el código pretendía. Esto es probable
que sea PARTE de por qué el fondo visual "se ve raro" — no solo falta de calibración de estilo,
sino un bug de codificación concreto y arreglable.

**Recomendación para quien construya la nueva herramienta**: implementar la codificación de color
usando el formato COLORREF confirmado y validado (`gstParser.js`/`mapInfoColorToHex`), NO copiar
la función `rgb()` de `gstWriter.js` tal cual. Ver sección 6 (`gstParser.js`) para el código de
referencia exacto.

### 5.3 Recomendación de fuente de calibración: OSM-Carto

Independientemente del bug de canal de la sección 5.2, el estilo (qué color/grosor usar para cada
categoría) sigue siendo, en el mejor caso, una elección arbitraria hecha por quien escribió
`countryMapTemplate.js` — no está calibrado contra ningún estándar visual real.

**Recomendación concreta**: usar como referencia **OSM-Carto**
(`https://github.com/gravitystorm/openstreetmap-carto`), el renderizador estándar open-source que
usa `openstreetmap.org` por defecto. Es la fuente más apropiada porque:

- Es **público y de código abierto** — se puede leer su hoja de estilos real (`style.mss`, formato
  CartoCSS) y ver EXACTAMENTE qué ancho/color usa para cada nivel de `highway=*`
  (`motorway`/`trunk`/`primary`/`secondary`/`tertiary`/`residential`/`service`/`unclassified`/
  etc.), qué color usa para `building=*`, `landuse=*` (por sub-tipo: `residential`,
  `commercial`, `industrial`, etc.), `natural=water`, `natural=wood`, y así para cada categoría
  que ya está siendo extraída por este pipeline.
- **Ya está calibrado sobre los MISMOS tags de OSM** que alimentan estas 15 capas — no hace falta
  traducir de un esquema de clasificación a otro (a diferencia de intentar copiar el estilo de
  Google Maps o HERE, que usan sus propias jerarquías internas de vía, no expuestas públicamente).
- **Google Maps NO es una fuente viable** para esto — no expone su paleta de colores/anchos vía
  ninguna API pública; solo se puede "mirar y adivinar" a ojo, lo cual es exactamente el problema
  actual (valores puestos sin fuente real).

La nueva herramienta de escritorio (sección 6) es el lugar natural para aplicar esta calibración:
en vez de hardcodear valores "mejorados" en el código generador (que habría que volver a tocar
código y regenerar para cada ajuste), la idea es que un diseñador/desarrollador pueda cargar el
`.gst` actual, ver cada capa, y ajustar color/grosor/zoom comparando visualmente contra
OSM-Carto/openstreetmap.org como referencia, sin tocar el pipeline de generación.

---

## 6. Formato `.gst` (GeoSet de MapInfo) — estructura completa

Ya documentado con más detalle operativo en la memoria del proyecto hermano
`map_editor_mapinfo_visual.md` — acá el resumen técnico completo, con el código real de referencia.

### 6.1 Estructura general

Texto plano, tipo INI, con claves jerárquicas tipo ruta de Windows Registry:
```
!GEOSET
!VERSION 450
begin_metadata
"\GEOSET" = ""
"\GEOSET\NAME" = "ecuador_osm"
"\GEOSET\PROJECTION" = "1,104"
"\GEOSET\CENTER" = "<centerLon>,<centerLat>"
"\GEOSET\MBR" = ""
"\GEOSET\MBR\LOWERLEFT" = "<west>,<south>"
"\GEOSET\MBR\UPPERRIGHT" = "<east>,<north>"
"\GEOSET\ZOOMLEVEL" = "2954.15"
"\GEOSET\AUTOLAYER" = "FALSE"
"\GEOSET\MAPUNIT" = "1"
"\GEOSET\ROTATION" = "0"
"\TABLE" = ""
"\TABLE\1" = ""
"\TABLE\1\FILE" = "Admin_EC_OSM.TAB"
"\TABLE\1\DESCRIPTION" = "Admin boundaries (OSM)"
"\TABLE\1\ISVISIBLE" = "TRUE"
"\TABLE\1\AUTOLABEL" = "FALSE"
... (ver claves completas más abajo, una capa por bloque \TABLE\N)
end_metadata
```
Terminador de línea `\r\n` en cada línea (formato Windows). Un `.gst` referencia sus `.TAB` por
ruta RELATIVA a la carpeta donde vive el propio `.gst` — todos los archivos (capas + `.gst`) deben
vivir en la misma carpeta.

### 6.2 Claves por capa (bloque `\TABLE\N\...`, N = 1-indexado, orden = orden de dibujo)

| Clave | Significado | Cómo se calcula hoy (`gstWriter.js`) |
|---|---|---|
| `FILE` | nombre del `.TAB`, relativo a la carpeta del `.gst` | config de entrada, ej. `AllStreets_EC_OSM.TAB` |
| `DESCRIPTION` | nombre mostrado en el panel de capas | config de entrada |
| `ISVISIBLE` | capa visible al abrir | siempre `TRUE` |
| `AUTOLABEL` | ¿mostrar etiquetas automáticas? | config `autoLabel` (default `TRUE`; `FALSE` para capas de fondo/alta densidad — límites, ríos, agua, uso de suelo, bosques grandes, para no saturar de texto) |
| `ZOOM\MIN` / `ZOOM\MAX` | rango de zoom visible, en **millas** (ancho aproximado del viewport) | config `zoomMin`/`zoomMax` (default `0`/`100000` = sin límite práctico) |
| `DISPLAY\BRUSH\Forecolor` / `Backcolor` / `Pattern` / `Transparent` | relleno (solo si la capa tiene `fillColor`, i.e. es de polígono) | `Pattern=2` (sólido), `Backcolor=16777215` (blanco) fijos; `Forecolor` = color codificado (ver 6.3) |
| `DISPLAY\PEN\...` | lápiz "de referencia/selección", fino | fijo: `LineWidth=1`, `LineStyle=1`, `Pattern=2`; `Color` = `lineColor` si es capa de polígono, si no `0` |
| `DISPLAY\LINEPEN\...` | lápiz REAL visible (solo en capas de LÍNEA, sin `fillColor`) | `LineWidth` = config `lineWidth`; `LineStyle`/`Pattern` = `193` si `thickRoad:true` (patrón "autopista" grueso, usado en Highway_1/2) o `1`/`2` si no; `Color` = `lineColor` codificado |
| `DISPLAY\SYMBOL\...` | símbolo de punto (solo si la capa tiene `symbolColor`) | `Type=0`, `Code` = `symbolCode` (default `32`, círculo relleno), `Pointsize=12` |
| `LABEL\ZOOM\MIN`/`MAX` | rango de zoom SOLO para el TEXTO de la etiqueta (la geometría sigue con su propio `ZOOM\MAX`, puede verse desde más lejos que su nombre) | solo si config trae `labelZoomMax` |
| `LABEL\FONT\...` | fuente de la etiqueta | `Description="Arial"`, `Size` = config `labelSize` (default `9`), `Style=1` (bold) si `labelBold:true`, `Forecolor=0` (negro), `Backcolor=16777215` (blanco), `Opaque=FALSE` |
| `SHOWLINEDIRECTION` | flechas de sentido en la línea | `TRUE` solo si config `showLineDirection:true` (usado en la capa `Oneway`) |

**Dos lápices, no uno, en capas de línea**: hallazgo real documentado en el propio código —
las capas de línea reales de producción (`Highway_1`/`Highway_2`/`AllStreets` en un `.gst` real de
Navteq) usan DOS lápices: `PEN` (fino, de referencia/selección) + `LINEPEN` (el que se ve de
verdad, con color/ancho real). Una primera versión de `gstWriter.js` solo escribía `PEN`, lo que
hacía que los caminos generados salieran finitos/apagados en vez del look "grueso y sólido" de un
camino real — corregido agregando `LINEPEN`. Las capas de POLÍGONO (con `fillColor`) NO tienen
`LINEPEN` en la muestra real (solo `PEN` como borde del relleno) — esa distinción se preserva.

### 6.3 Codificación del color — **usar este formato, no el de `gstWriter.js`**

El color de MapInfo es un entero decimal que representa un **`COLORREF` de Windows**
(`0x00BBGGRR`): el byte más bajo es Rojo, el del medio es Verde, el tercero es Azul. Código de
referencia REAL Y VALIDADO (de `C:\desktopApp\map-editor\backend\lib\gstParser.js`):

```js
// decimal → "#RRGGBB"
function mapInfoColorToHex(decimalColor) {
  const n = Number(decimalColor) >>> 0;
  const r = n & 0xff;
  const g = (n >> 8) & 0xff;
  const b = (n >> 16) & 0xff;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// inverso, "#RRGGBB" o {r,g,b} → decimal, para ESCRIBIR un .gst
function hexToMapInfoColor(r, g, b) {
  return r + (g << 8) + (b << 16); // == r + g*256 + b*65536
}
```
**No usar** `r*65536 + g*256 + b` (la fórmula de `gstWriter.js` actual) — ver sección 5.2 para el
análisis completo del bug que eso introduce.

### 6.4 Zoom: unidad = millas (confirmado, con una salvedad)

Confirmado con GeoSet Manager real (proyecto `map-editor`, memoria `map_editor_mapinfo_visual.md`):
el número que GeoSet Manager muestra en la barra de estado, en la vista MÁS cercana lograda
(calles individuales visibles, ~200-400m de ancho), fue `0.25` — consistente con la unidad siendo
**millas** (0.25mi ≈ 400m). El campo `\GEOSET\ZOOMLEVEL` (nivel de zoom inicial al abrir el
geoset completo) **no tiene una fórmula exacta confirmada** — se copia el mismo orden de magnitud
que una muestra real comparable (`2954.15` para un país del tamaño de Ecuador) en vez de un valor
inventado, porque un valor equivocado (`"10"`, probado antes) causaba que Roadshow mostrara una
escala rara y el fondo no se dibujara en el Route Planner — evidencia de que Roadshow usa este
campo para algo más que cosmética inicial. **Pendiente de calibrar la fórmula exacta** (¿proporcional
al ancho del MBR en grados? ¿unidad fija?) para países de tamaño muy distinto a Ecuador — la nueva
herramienta debería permitir ajustar este valor a mano por dataset mientras tanto.

---

## 7. Alcance sugerido para la nueva herramienta de escritorio

Objetivo: reemplazar el uso manual de **GeoSet Manager** (que solo permite reordenar/activar
capas y editar estilo con una UI limitada, poco práctica para iterar rápido comparando contra una
referencia visual) por una herramienta propia, con mejor UX, enfocada específicamente en calibrar
el estilo de las 15 capas de este pipeline (aunque debería funcionar con cualquier `.gst`+`.TAB`
válido, no solo los generados por este pipeline específico).

**Funcionalidad mínima sugerida:**

1. **Cargar** un `.gst` + su carpeta de `.TAB` asociados (parseo — reusar/portar la lógica de
   `gstParser.js`, sección 8).
2. **Listar las capas** en su orden de dibujo real (tal como aparecen en `\TABLE\1..N`).
3. **Por capa, permitir editar:**
   - Color de línea (`DISPLAY\PEN\Color` / `DISPLAY\LINEPEN\Color`) y de relleno
     (`DISPLAY\BRUSH\Forecolor`) — con selector de color estándar, mostrando el valor ya
     decodificado a `#RRGGBB` (no el entero crudo).
   - Ancho de línea (`DISPLAY\LINEPEN\LineWidth`).
   - Relleno on/off y transparencia (`DISPLAY\BRUSH\Transparent`).
   - Rango de zoom visible de la geometría (`ZOOM\MIN`/`ZOOM\MAX`, en millas).
   - Rango de zoom visible de la etiqueta (`LABEL\ZOOM\MIN`/`MAX`), independiente del anterior.
   - Fuente/tamaño/negrita de etiqueta (`LABEL\FONT\...`).
   - Auto-etiquetado on/off (`AUTOLABEL`).
4. **Reordenar capas** (drag & drop) — cambia qué capa se dibuja encima de cuál. (Ya existe una
   implementación de referencia de esta interacción específica — drag & drop entre filas, HTML5
   `draggable` nativo — en el panel de capas del proyecto `map-editor`, componente
   `LayerPanel.tsx`/`MapEditor.tsx::handleReorderLayer`, aunque esa es para visualización web, no
   para exportar `.gst`.)
5. **Vista previa** de cómo se ve cada capa con el estilo actual — sea renderizando el `.TAB` real
   (con una librería GIS de escritorio, ej. algo sobre GDAL/OGR sea cual sea el stack elegido) o,
   más simple para arrancar, mostrando muestras de color/grosor sin geometría real todavía.
6. **Exportar** de vuelta a un `.gst` válido — mismo formato exacto de texto (sección 6.1),
   preservando todas las claves que la herramienta no edita (para no corromper capas con
   configuración que la v1 de la herramienta no cubra todavía).

**Referencia de implementación ya existente** (de un proyecto hermano, `map-editor` — NO es este
mismo pipeline, pero ya resuelve el parseo/traducción de `.gst` de forma probada y validada
visualmente contra GeoSet Manager real):

- `C:\desktopApp\map-editor\backend\lib\gstParser.js` — `parseGst(path)` (parser completo,
  devuelve `{meta, layers[]}` con cada capa ya con sus propiedades de estilo decodificadas a tipos
  usables — colores en `#RRGGBB`, no enteros crudos) y `mapInfoColorToHex()` (sección 6.3). Es
  **texto plano parseado con regex línea por línea** (`/^"([^"]*)"\s*=\s*"([^"]*)"\s*$/`), sin
  ninguna dependencia de librería GST específica — portable a cualquier lenguaje sin esfuerzo.
- `C:\desktopApp\map-editor\frontend\src\mapStyle.ts` — traduce el `.gst` ya parseado a capas de
  **Mapbox GL/MapLibre GL** para visualización WEB (no es la herramienta de escritorio en sí, pero
  es el ejemplo más completo y ya confirmado funcionando de cómo mapear cada propiedad del `.gst`
  a un renderizado real: `gstLayerToMapboxLayers()`, manejo de `LABEL_FIELD` por prefijo de capa —
  el nombre de campo de texto a usar como etiqueta difiere por capa y no hay convención uniforme
  en los `.TAB` —, `activeLayers()` para filtrar por rango de zoom actual, etc.). Útil como
  referencia de "qué significa visualmente cada propiedad del `.gst`", aunque la nueva herramienta
  sea de escritorio y probablemente use un motor de render distinto.

Estos dos archivos son de un proyecto DISTINTO (`map-editor`, el reemplazo de RIIMS para edición
de rutas — Proyecto 1 en la terminología del cliente), pero comparten el mismo formato `.gst` real
de MapInfo, así que su lógica de parseo/traducción es 100% reusable como base o referencia para la
nueva herramienta, sin tener que reinventar el parser desde cero.

**NO es necesario para esta herramienta**: nada relacionado al `.lmb` (formato binario propietario
de ruteo, completamente separado — ingeniería reversa de otro proyecto/objetivo distinto, no
aplica a edición de capas visuales), ni al pipeline de descarga/generación de OSM en sí (esta
herramienta trabaja SOBRE los `.TAB`/`.gst` ya generados, no los genera).

---

## 8. Rutas de archivos reales (estado actual del repo, para referencia)

Todo en `C:\desktopApp\FastBuild\backend\` salvo que se indique lo contrario.

**Pipeline OSM → MapInfo (código fuente, genérico, reusable):**
- `lib/osm/osmFetch.js` — descarga Overpass API (áreas chicas)
- `lib/osm/osmXmlParser.js` — parser de `.osm` XML (Overpass)
- `lib/osm/osmPbfParser.js` — parser de `.osm.pbf` (Geofabrik, país completo)
- `lib/osm/bigIdCollections.js` — `BigIdSet`/`BigIdMap`, workaround límite de `Set`/`Map` de V8
- `lib/osm/mapInfoStreetsWriter.js` — escritor de capas de línea (calles, ríos, costa, oneway)
- `lib/osm/mapInfoPolygonWriter.js` — escritor de polígono simple (edificios, landuse, green chico)
- `lib/osm/mapInfoMultiPolygonWriter.js` — escritor de relación multipolígono (admin, water, greenBig)
- `lib/osm/mapInfoPointWriter.js` — escritor de puntos (POIs, poblaciones)
- `lib/osm/countryMapTemplate.js` — plantilla declarativa de las 15 capas + estilo
- `lib/osm/gstWriter.js` — generador del `.gst`

**Scripts orquestadores (nivel país, hoy con Ecuador hardcodeado):**
- `scratch_osm_country_streets.js` — primer intento, solo calles (prueba de escala)
- `scratch_osm_country_all.js` — streets (3 niveles) + buildings + landuse + green + POIs, en una
  pasada combinada (`parseOsmPbfWaysMulti`)
- `scratch_osm_country_relations.js` — rivers + relaciones multipolígono (water, greenBig, admin)
- `scratch_osm_country_extras.js` — poblaciones (cities/towns/villages) + coastline + oneway
- `scratch_osm_country_gst.js` — genera el `.gst` final referenciando las 15 capas
- `scratch_osm_gst_poc.js` — versión mínima de prueba (un área chica vía XML de Overpass, útil
  como ejemplo end-to-end más corto de leer que los 4 scripts de país completo)

**Salida real generada (Ecuador, ya confirmada en Roadshow real):**
- `output/osm_ecuador/ecuador.osm.pbf` — extracto Geofabrik fuente
- `output/osm_ecuador/<Capa>_EC_OSM.TAB` (+ `.DAT`/`.MAP`/`.ID`) — las 15 capas
- `output/osm_ecuador/ecuador_osm.gst` — GeoSet final

**Muestras reales de producción (proveedor Navteq/HERE, usadas como referencia/ground-truth
durante el desarrollo de este pipeline, NO generadas por él):**
- `C:\MAPS\ECUADOR\Mapinfo\ec.gst` — `.gst` real de Ecuador (formato de referencia)
- `C:\MAPS\ECUADOR\Mapinfo\AllStreets_EC.TAB` — `.TAB` real de Ecuador (esquema de campos de
  referencia, confirmó que `Street_Name` Char 80 es el único campo necesario)
- `C:\MAPS\mexico\MapInfo\` — set completo de México (22 capas en su `.gst`, usado como primera
  referencia de formato en el proyecto hermano `map-editor`)

**Documento de bitácora completo del proyecto** (todas las sesiones de investigación, en orden
cronológico, formato "diario de investigación" — mucho más detallado y con contexto de otros
objetivos no relacionados a este documento):
- `C:\desktopApp\FastBuild\bridge\FINDINGS.md`

**Proyecto hermano con el parser/traductor de `.gst` YA implementado y validado** (Proyecto 1,
reemplazo de RIIMS — arquitectura distinta, pero mismo formato `.gst`):
- `C:\desktopApp\map-editor\backend\lib\gstParser.js`
- `C:\desktopApp\map-editor\frontend\src\mapStyle.ts`
- `C:\desktopApp\map-editor\backend\lib\mapInfoReader.js` (lectura de `.TAB` por bounding box con
  `gdal-async`, recorte de geometría — no imprescindible para la nueva herramienta, pero relevante
  si en algún momento la herramienta necesita leer/mostrar la geometría real de los `.TAB`, no
  solo editar el `.gst`)
