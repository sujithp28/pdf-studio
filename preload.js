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

  // Write annotated PDF bytes to a path chosen by main process
  writePDF: (filePath, data) => ipcRenderer.send('write-pdf', { filePath, data }),

  // Update window title
  setTitle: (title) => ipcRenderer.send('set-title', title),

  // Tell main process the UI listeners are registered
  ready: () => ipcRenderer.send('renderer-ready'),

  // Receive a file that was opened from the menu / Finder / CLI
  onOpenFile: (cb) => {
    ipcRenderer.on('open-file', (_event, payload) => cb(payload));
  },

  // Receive the save-path chosen by the native dialog
  onDoSave: (cb) => {
    ipcRenderer.on('do-save', (_event, filePath) => cb(filePath));
  },
});
