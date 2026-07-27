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

// ─── MÓDULO GENERAR (OSM -> MapInfo): correr el pipeline y transmitir el log ──
const { spawn } = require('child_process');

ipcMain.handle('pick-pbf', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'OSM PBF', extensions: ['pbf', 'osm'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('read-gst', async (_e, { path: p }) => {
  const buf = fs.readFileSync(p);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { path: p, text: s };
});

// Corre un script del pipeline con Electron actuando como Node (ELECTRON_RUN_AS_NODE=1), pasando
// la config por variables de entorno (ver scripts/genConfig.js). Transmite stdout/stderr al UI.
function runScript(scriptRel, env) {
  return new Promise((res, rej) => {
    const full = path.join(__dirname, '..', 'scripts', scriptRel);
    win.webContents.send('gen-log', `\n$ scripts/${scriptRel}\n`);
    const child = spawn(process.execPath, [full], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
    });
    child.stdout.on('data', (d) => win.webContents.send('gen-log', d.toString()));
    child.stderr.on('data', (d) => win.webContents.send('gen-log', d.toString()));
    child.on('error', rej);
    child.on('close', (c) => (c === 0 ? res() : rej(new Error(`${scriptRel} terminó con código ${c}`))));
  });
}

ipcMain.handle('generate-map', async (_e, opts) => {
  const env = {};
  if (opts.pbf) env.FM_PBF = opts.pbf;
  if (opts.out) env.FM_OUT = opts.out;
  if (opts.code) env.FM_CODE = opts.code;
  if (opts.name) env.FM_NAME = opts.name;
  if (opts.bbox) env.FM_BBOX = opts.bbox;
  // Pipeline completo, en orden: calles+edificios+usosuelo+verde+POI -> relaciones (agua/bosque/
  // admin/ríos) -> extras (poblaciones/costa/oneway) -> .gst final.
  await runScript('scratch_osm_country_all.js', env);
  await runScript('scratch_osm_country_relations.js', env);
  await runScript('scratch_osm_country_extras.js', env);
  await runScript('scratch_osm_country_gst.js', env);
  const outDir = opts.out || path.join(__dirname, '..', 'scripts', 'output', 'osm_ecuador');
  const gstPath = path.join(outDir, (opts.name || 'ecuador_osm') + '.gst');
  win.webContents.send('gen-log', `\n✅ Listo: ${gstPath}\n`);
  return { gstPath };
});
