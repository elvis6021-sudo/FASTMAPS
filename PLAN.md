# Plan de trabajo — Mapas OSM → MapInfo bonitos y ligeros para Roadshow

**Objetivo (North Star):** entregar al cliente de Roadshow un set de mapas
`.gst` + `.TAB` generado desde **OpenStreetMap**, con **cobertura completa**,
**visualmente bonito (nivel openstreetmap.org / OSM-Carto)** y **ligero**, para que
**deje de pagar** el plugin de Google Maps / HERE que hoy usa por falta de cobertura de Navteq.

**Estado de partida:**
- ✅ El pipeline OSM → 15 capas `.TAB` + `.gst` **ya existe y funciona** (Ecuador completo, confirmado en Roadshow real).
- ⚠️ Lo que falta es **calidad visual**: falta jerarquía de anchos de calle, colores mal codificados (bug R↔B), estilo sin calibrar.
- 🔨 Falta el **editor de escritorio** para afinar el estilo capa por capa (reemplazo de GeoSet Manager).

**Regla de oro del proyecto:** el ruteo (`.lmb`) es un problema APARTE. Este plan es **solo el fondo visual**. Podemos simplificar/embellecer lo visual sin tocar el ruteo.

---

## Fase 0 — Setup y línea base *(rápida)*
**Meta:** poder iterar rápido y medir "antes/después".
- [x] Clonar repo FASTMAPS y entender el código.
- [ ] Definir un **área de prueba chica y reproducible** (una ciudad vía Overpass, con `scratch_osm_gst_poc.js`) para iterar el estilo en segundos, sin reprocesar un país.
- [ ] Capturar el **estado visual actual** (captura del mapa de Ecuador en GeoSet Manager y/o Roadshow) como referencia "antes".
- **Nota de entorno:** la generación de `.TAB` usa `gdal-async` (nativo, corre en tu Windows). El **estilo (`.gst` + plantilla) es texto plano y portable** → eso lo trabajo yo directo. El render real lo validas tú en Windows, o lo montamos en el editor (Fase 4).

## Fase 1 — Arreglar el color + calibrar la paleta con OSM-Carto ✅ HECHA (2026-07-27)
**Meta:** que los colores salgan correctos y calibrados → salto visual inmediato sin tocar geometría.
- [x] **Bug de color:** `rgb()` cambiado a **COLORREF** (`r + (g<<8) + (b<<16)`) en `lib/osm/countryMapTemplate.js`. Confirmado que `gstWriter.js` NO codifica color (solo escribe el entero), así que no requería cambio.
- [x] **Paleta real de OSM-Carto** extraída de `github.com/gravitystorm/openstreetmap-carto` (`road-colors-generated.mss`, `landcover.mss`, `buildings.mss`, `admin.mss`): agua `#aad3df`, bosque `#add19e`, parque `#c8facc`, residencial `#e0dfdf`, edificios `#d9d0c9`, primary `#fcd6a4`, secondary `#f7fabf`, admin `#8d618b`.
- [x] **15 capas recoloreadas** en `countryMapTemplate.js`; verificado que el `.gst` generado decodifica a los hex correctos (test con la fórmula de `gstParser.js`).
- [x] **Consolidado:** `scripts/scratch_osm_country_gst.js` ahora usa `buildCountryLayers('EC')` (una sola fuente de verdad) en vez de duplicar la lista + el `rgb()` con bug.
- **PENDIENTE (tú, en Windows):** re-generar el `.gst` — solo correr `node scripts/scratch_osm_country_gst.js` (NO hay que reprocesar el OSM, los `.TAB` de Ecuador ya existen; solo se reescribe el texto del `.gst` en ~1 seg) y reabrir en GeoSet Manager / Roadshow para ver el antes/después.

## Fase 2 — Jerarquía de anchos de calle + "casing" *(lo que más pediste)*
**Meta:** que las calles se vean como en osm.org — jerarquía por grosor, y el borde/relleno ("casing") que da el look pulido.
- [x] **Grosor jerárquico** (2026-07-27): AllStreets=1 (finas) < Highway2/avenidas=3 < Highway1/principales=5. Patrón `193` (vía gruesa) en Highway1/2.
- [x] **Flecha de sentido** en `Oneway`: `SHOWLINEDIRECTION=TRUE` confirmado, grosor 2 para que la flecha se vea, capa dibujada encima de la calle normal.
- [x] **Casing** (2026-07-27): cada clase de vía se dibuja 2 veces sobre el mismo `.TAB` (casing ancho oscuro debajo + fill angosto claro encima), todos los casings y luego los fills. Calles blanco/#bbb, avenidas #f7fabf/#707d05, principales #fcd6a4/#a06b00. 18 capas en el `.gst`, mismos 15 `.TAB`.
- [ ] Ampliar `HIGHWAY_TIER` de **3 a ~6-7 clases** (motorway/trunk/primary/secondary/tertiary/residential/service) para distinguir motorway (rosa) y trunk (naranja), no solo 3 niveles.
- [ ] **Ancho por zoom** (más fino de lejos, más grueso de cerca) con rangos `ZOOM`.
- **Verificación:** comparación visual lado a lado con openstreetmap.org.
- **NOTA oneway=-1:** los tramos con `oneway=-1` (sentido inverso al de digitalización) mostrarán la flecha al revés a menos que el escritor invierta su geometría — pendiente de revisar en `mapInfoStreetsWriter.js` si se nota en la práctica.

## Fase 3 — Editor de estilo (MVP) ✅ HECHA (2026-07-27)
**Meta:** reemplazar GeoSet Manager con una herramienta propia para afinar el estilo sin tocar código.
- [x] **Editor web** autónomo en `editor/index.html` (un solo archivo, se abre en el navegador; Electron lo envolverá en Fase 4 para el preview).
- [x] **Parser que preserva líneas**: carga un `.gst`, indexa las claves editables por capa y re-emite conservando TODAS las claves que no se tocan. Round-trip **byte-idéntico** verificado.
- [x] UI: capas en **orden de dibujo**; por capa se edita **color de línea/borde, relleno, grosor, zoom min/max, zoom de etiqueta y auto-etiqueta**, con vista previa del trazo. Color en COLORREF automático (usa el mismo formato validado).
- [x] **Exportar** `.gst` válido (descarga con fidelidad de bytes latin1; editar 1 color cambia solo 1 línea).
- **Cómo usarlo:** abrir `editor/index.html` → "Cargar .gst" (o "Cargar muestra") → editar → "Exportar .gst" → copiar a la carpeta de Roadshow.
- **Falta (Fase 4):** vista previa del mapa real + reordenar capas (drag&drop) + empaquetar como app de escritorio.

## Fase 4 — Vista previa en vivo + reordenar
**Meta:** ver el resultado mientras ajustas y poder cambiar el orden de dibujo.
- [x] **Vista previa en vivo** (2026-07-27): escena de ejemplo (agua, parque, edificios, río, red vial con las 6 clases + casing + flecha oneway) dibujada en SVG con los estilos actuales, en el orden real de las capas; se actualiza al editar. Sirve para calibrar comparando con openstreetmap.org.
- [x] **Reordenar capas** con drag & drop (renumeración correcta de `\TABLE\N` al exportar).
- [ ] **Preview con geometría REAL** del `.TAB` (Electron + Node `gdal-async`/`mapInfoReader.js` → GeoJSON → MapLibre GL, reusando `reference/mapStyle.ts`). Necesita el entorno Windows/gdal; la escena de ejemplo cubre la calibración de estilo mientras tanto.
- [x] **Esqueleto Electron** (2026-07-27): `desktop/` con `main.js`/`preload.js`/`package.json` -- envuelve el editor como app de escritorio, abrir/guardar `.gst` nativo, y canal `readTab` (gdal-async -> GeoJSON) listo para el preview real. Falta conectar MapLibre (4b) y empaquetar `.exe`.

## Fase 5 — Detalles finos + ligereza
**Meta:** rematar el look y garantizar que sea liviano y rápido.
- [ ] **Rangos de zoom por capa** bien calibrados (no saturar de detalle/etiquetas de lejos).
- [ ] **POIs con símbolos reales** (íconos por categoría), flechas de sentido único, agua/costa pulidas, etiquetas.
- [ ] **Ligereza:** visibilidad por zoom para render rápido; evaluar **simplificación de geometría por nivel SOLO en lo visual** (sin tocar el ruteo `.lmb`) para bajar peso sin perder cobertura.
- **Entregable:** set visual pulido y liviano.

## Fase 6 — Empaquetado y rollout
**Meta:** dejarlo listo para instalar en Roadshow y cerrar los países.
- [ ] Empaquetar el set por país listo para copiar a la carpeta de mapas de Roadshow + guía de instalación.
- [ ] Correr los **16-17 países pendientes** (tarea mecánica).
- [ ] Mensaje de valor al cliente: cobertura OSM completa, bonito, ligero, **sin suscripción Google/HERE**.

---

## Orden recomendado
Fase 1 primero (máximo impacto visual con mínimo esfuerzo: solo texto/estilo), luego Fase 2 (anchos/casing), y en paralelo empezar el editor (Fase 3-4) para poder calibrar visualmente el resto.

## Archivos clave (referencia rápida)
- `lib/osm/countryMapTemplate.js` — estilos por capa (aquí está el bug `rgb()`).
- `lib/osm/gstWriter.js` — genera el `.gst` (aquí también se codifica color).
- `reference/gstParser.js` — parser validado (formato COLORREF correcto) → base del editor.
- `reference/mapStyle.ts` — traduce `.gst` → MapLibre → base del preview.
- `scripts/scratch_osm_gst_poc.js` — ejemplo end-to-end corto (área chica).
