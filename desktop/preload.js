// Puente seguro entre el editor (renderer) y el proceso principal. Expone SOLO estas funciones
// en window.fastmaps -- el editor detecta si existen para usar diálogos nativos (Electron) o caer
// al modo web (input file + descarga) si corre en un navegador normal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fastmaps', {
  openGst: () => ipcRenderer.invoke('open-gst'),
  saveGst: (suggested, text) => ipcRenderer.invoke('save-gst', { suggested, text }),
  readTab: (tabPath, bbox, maxFeatures) => ipcRenderer.invoke('read-tab', { tabPath, bbox, maxFeatures }),
  // módulo Generar
  pickPbf: () => ipcRenderer.invoke('pick-pbf'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  readGst: (p) => ipcRenderer.invoke('read-gst', { path: p }),
  generateMap: (opts) => ipcRenderer.invoke('generate-map', opts),
  onGenLog: (cb) => ipcRenderer.on('gen-log', (_e, line) => cb(line)),
});
