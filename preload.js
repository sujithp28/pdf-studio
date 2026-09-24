/**
 * Preload — exposes a safe, narrow API to the renderer via contextBridge.
 * No raw Node/Electron APIs are exposed; only the functions the UI needs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfStudio', {
  // Let renderer know it is running inside Electron
  isElectron: true,

  // Ask main process to show the native Open dialog
  requestOpen: () => ipcRenderer.send('request-open'),

  // Ask main process to show the native Save dialog
  requestSave: () => ipcRenderer.send('request-save'),

  // Write annotated PDF bytes; main process writes only to the path the user picked in the Save dialog
  writePDF: (data) => ipcRenderer.send('write-pdf', data),

  // Update window title
  setTitle: (title) => ipcRenderer.send('set-title', title),

  // Tell main process the UI listeners are registered
  ready: () => ipcRenderer.send('renderer-ready'),

  // Receive a file that was opened from the menu / Finder / CLI
  onOpenFile: (cb) => {
    ipcRenderer.on('open-file', (_event, payload) => cb(payload));
  },

  // Main process asks for the PDF bytes after the user confirmed the Save dialog
  onDoSave: (cb) => {
    ipcRenderer.on('do-save', () => cb());
  },
});
