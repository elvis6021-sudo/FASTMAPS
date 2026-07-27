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
- [ ] Ampliar la clasificación `HIGHWAY_TIER` de **3 a ~6-7 clases** (motorway / trunk / primary / secondary / tertiary / residential / service), como hace OSM-Carto.
- [ ] **Ancho por clase y por zoom** (calle fina de lejos, gruesa de cerca) usando `ZOOM\MIN/MAX` por capa.
- [ ] **"Casing"** (borde oscuro + relleno claro): investigar la mejor vía en MapInfo/Roadshow — o dos capas por clase (una gruesa oscura debajo + una fina clara encima), o los estilos de pen compuestos (el `Pattern=193` "autopista" ya usado). Elegir lo que Roadshow renderice bien.
- **Entregable:** nueva clasificación + capas/estilos de calle.
- **Verificación:** comparación visual lado a lado con openstreetmap.org.

## Fase 3 — Editor de escritorio (MVP)
**Meta:** reemplazar GeoSet Manager con una app propia para afinar el estilo sin tocar código.
- [ ] **Electron + React.** Backend Node reutiliza `reference/gstParser.js` (leer) + un escritor con el fix COLORREF (escribir, **preservando** las claves que no editamos).
- [ ] UI: lista de capas en **orden de dibujo**; por capa editar **color / grosor / zoom / etiqueta / relleno**.
- [ ] **Exportar** un `.gst` válido (mismo formato exacto).
- **Entregable:** app que carga un `.gst` real, lo edita y exporta uno válido.

## Fase 4 — Vista previa en vivo (el gran salto de UX)
**Meta:** ver el mapa real actualizándose mientras ajustas, con osm.org al lado.
- [ ] Backend lee la geometría real de los `.TAB` por bounding box (`gdal-async` / `mapInfoReader.js`) → GeoJSON.
- [ ] Frontend **MapLibre GL** + `reference/mapStyle.ts` (que ya traduce `.gst` → capas Mapbox/MapLibre) → preview real.
- [ ] **Reordenar capas** con drag & drop.
- **Entregable:** editor con preview en vivo y comparación contra referencia.

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
