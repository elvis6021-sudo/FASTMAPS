# FastMaps · Editor de escritorio (Electron)

App de escritorio con **dos módulos**:
1. **Generar mapa** (OSM → MapInfo/Navteq): eliges un `.osm.pbf` y produce las capas `.TAB` + el `.gst`.
2. **Editar estilo** (`.gst`): carga, edita color/grosor/zoom/orden con vista previa (escena y **mapa real**) y exporta.

Envuelve `../editor/index.html`, con:

- **Abrir / Guardar `.gst` nativos** (diálogos del sistema, con fidelidad de bytes).
- **Vista previa de estilo en vivo** (escena de ejemplo) — ya funciona.
- Base para el **preview con geometría REAL** de los `.TAB` (`readTab` → GeoJSON vía `gdal-async`) — pendiente conectar a MapLibre (Fase 4b).

## Requisitos
- Node.js 18+ y npm.
- En Windows: las herramientas de compilación para `gdal-async` (normalmente vienen con el binario precompilado de npm; no suele hacer falta compilar).

## Cómo correrlo
El módulo **Generar** corre el pipeline (scripts en `../scripts/`) que usa `gdal-async` y
`osm-pbf-parser`, resueltos desde la RAÍZ del repo. Por eso hay que instalar en los dos sitios:
```bash
# 1) dependencias del pipeline (en la raíz del repo)
cd FASTMAPS
npm install

# 2) dependencias de la app de escritorio
cd desktop
npm install
npm start          # abre la app
```

La app carga el mismo editor de `../editor/index.html`. Si `gdal-async` está disponible, el canal
`readTab` puede leer la geometría de un `.TAB` por bounding box y devolver GeoJSON (para el preview
real con MapLibre, que se conecta en la Fase 4b).

## Estado
- ✅ Ventana de escritorio + editor embebido + abrir/guardar nativo + preview de estilo (escena).
- ⏳ Fase 4b: conectar `readTab` (GeoJSON real) a un mapa **MapLibre GL** dentro de la app,
  reusando la lógica de `../reference/mapStyle.ts` (`.gst` → capas MapLibre) para ver la geometría
  real estilizada y compararla con openstreetmap.org.

## Empaquetar (más adelante)
Para generar un `.exe` instalable se puede añadir `electron-builder`:
```bash
npm i -D electron-builder
npx electron-builder --win
```
