# FastMaps · Editor de escritorio (Electron)

Envuelve el editor de estilo `.gst` (`../editor/index.html`) como **app de escritorio**, con:

- **Abrir / Guardar `.gst` nativos** (diálogos del sistema, con fidelidad de bytes).
- **Vista previa de estilo en vivo** (escena de ejemplo) — ya funciona.
- Base para el **preview con geometría REAL** de los `.TAB` (`readTab` → GeoJSON vía `gdal-async`) — pendiente conectar a MapLibre (Fase 4b).

## Requisitos
- Node.js 18+ y npm.
- En Windows: las herramientas de compilación para `gdal-async` (normalmente vienen con el binario precompilado de npm; no suele hacer falta compilar).

## Cómo correrlo
```bash
cd desktop
npm install        # instala electron + gdal-async
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
