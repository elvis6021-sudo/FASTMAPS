// Proceso principal de Electron -- envuelve el editor web (editor/index.html) como app de
// escritorio y expone, vía IPC seguro (preload.js -> window.fastmaps):
//   - openGst()  : diálogo nativo "Abrir", lee el .gst preservando bytes (latin1 1:1)
//   - saveGst()  : diálogo nativo "Guardar", escribe el .gst con fidelidad de bytes
//   - readTab()  : lee la geometría real de un .TAB por bbox -> GeoJSON (gdal-async) -- base del
//                  preview real con MapLibre (Fase 4b). Requiere gdal-async instalado (Windows).
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'FastMaps · Editor de estilo .gst',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'editor', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Abrir .gst (preserva bytes: cada byte -> un char) ───────────────────────
ipcMain.handle('open-gst', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'MapInfo GeoSet', extensions: ['gst'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = fs.readFileSync(r.filePaths[0]);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { path: r.filePaths[0], text: s };
});

// ─── Guardar .gst (fidelidad de bytes: char & 0xff -> byte) ──────────────────
ipcMain.handle('save-gst', async (_e, { suggested, text }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: suggested || 'geoset_editado.gst',
    filters: [{ name: 'MapInfo GeoSet', extensions: ['gst'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  fs.writeFileSync(r.filePath, bytes);
  return r.filePath;
});

// ─── Leer geometría real de un .TAB por bbox -> GeoJSON (Fase 4b) ────────────
// Base del preview real con MapLibre. Corre en Windows con gdal-async compilado. Se filtra por
// bbox {west,south,east,north} para no traer un país entero de golpe (rendimiento).
ipcMain.handle('read-tab', async (_e, { tabPath, bbox, maxFeatures = 20000 }) => {
  const gdal = require('gdal-async');
  const ds = gdal.open(tabPath);
  const layer = ds.layers.get(0);
  if (bbox) {
    layer.setSpatialFilter(bbox.west, bbox.south, bbox.east, bbox.north);
  }
  const features = [];
  let f;
  layer.features.rewind();
  while ((f = layer.features.next()) && features.length < maxFeatures) {
    const g = f.getGeometry();
    if (!g) continue;
    features.push({
      type: 'Feature',
      properties: f.fields.toObject(),
      geometry: JSON.parse(g.toJSON()),
    });
  }
  ds.close();
  return { type: 'FeatureCollection', features };
});
