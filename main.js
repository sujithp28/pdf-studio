const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs   = require('fs');
const { pathToFileURL } = require('url');

let mainWindow;
let currentFilePath = null;
// Path the user picked in the Save dialog; the renderer can only write here, once.
let approvedSavePath = null;

const INDEX_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;

// Only accept IPC from our own page (Electron security checklist: validate the sender)
function fromApp(event) {
  return !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame?.url === INDEX_URL;
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  780,
    minHeight: 560,
    title: 'PDF Studio',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0C0F1A' : '#ECEEF4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── File open ─────────────────────────────────────────────────────────────────
async function showOpenDialog() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0)
    openFilePath(result.filePaths[0]);
}

function openFilePath(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    currentFilePath = filePath;
    mainWindow.setTitle(path.basename(filePath) + ' — PDF Studio');
    mainWindow.webContents.send('open-file', {
      name: path.basename(filePath),
      path: filePath,
      data: buffer,
      size: buffer.length,
    });
  } catch (err) {
    dialog.showErrorBox('Cannot Open File', err.message);
  }
}

// ── File save ─────────────────────────────────────────────────────────────────
async function showSaveDialog() {
  if (!mainWindow) return;
  const defaultName = currentFilePath
    ? path.basename(currentFilePath, '.pdf') + '-annotated.pdf'
    : 'annotated.pdf';
  approvedSavePath = null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Annotated PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (!result.canceled && result.filePath) {
    approvedSavePath = result.filePath;
    mainWindow.webContents.send('do-save');
  }
}

// ── IPC: renderer asks for dialogs ───────────────────────────────────────────
ipcMain.on('request-open', (event) => { if (fromApp(event)) showOpenDialog(); });

// Open file passed as CLI argument (e.g. double-clicking a PDF) once the UI can receive it
ipcMain.on('renderer-ready', (event) => {
  if (!fromApp(event)) return;
  const arg = process.argv.slice(1).find(a => a.toLowerCase().endsWith('.pdf'));
  if (arg && fs.existsSync(arg)) openFilePath(arg);
});
ipcMain.on('request-save', (event) => { if (fromApp(event)) showSaveDialog(); });

ipcMain.on('write-pdf', (event, data) => {
  const filePath = approvedSavePath;
  approvedSavePath = null;
  if (!fromApp(event) || !filePath) return;
  // Only PDF bytes: must be binary and start with the "%PDF-" header
  if (!(data instanceof Uint8Array) || data.length < 5 || Buffer.from(data.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    dialog.showErrorBox('Save Failed', 'The document could not be exported as a valid PDF.');
    return;
  }
  try {
    fs.writeFileSync(filePath, Buffer.from(data));
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Saved',
      message: 'PDF saved successfully.',
      detail: filePath,
      buttons: ['OK'],
    });
  } catch (err) {
    dialog.showErrorBox('Save Failed', err.message);
  }
});

ipcMain.on('set-title', (event, title) => {
  if (fromApp(event) && typeof title === 'string') mainWindow.setTitle(title + ' — PDF Studio');
});

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF…',
          accelerator: 'CmdOrCtrl+O',
          click: showOpenDialog,
        },
        {
          label: 'Save Annotated PDF…',
          accelerator: 'CmdOrCtrl+S',
          click: showSaveDialog,
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Reload / DevTools only in development builds
        ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PDF Studio',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About PDF Studio',
              message: 'PDF Studio  v1.0.0',
              detail: 'A full-featured PDF viewer, editor & annotator.\n\nBuilt with Electron, PDF.js, and PDF-lib.',
              buttons: ['OK'],
            }),
        },
        {
          label: 'Open GitHub',
          click: () => shell.openExternal('https://github.com'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Web contents hardening: no new windows, no navigation away from the app ──
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (url !== INDEX_URL) event.preventDefault();
  });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Handle file open on macOS via Finder drag
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) openFilePath(filePath);
  else app.once('ready', () => openFilePath(filePath));
});
