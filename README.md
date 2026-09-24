# PDF Studio

A desktop app for viewing and annotating PDFs on Windows, macOS, and Linux. It's built with Electron, [PDF.js](https://mozilla.github.io/pdf.js/), and [pdf-lib](https://pdf-lib.js.org/).

## Download

Get the latest installer from the [Releases page](https://github.com/sujithp28/pdf-studio/releases/latest):

| OS | File |
|----|------|
| Windows | `PDF.Studio.Setup.x.x.x.exe` |
| macOS (Apple Silicon) | `PDF.Studio-x.x.x-arm64.dmg` |
| macOS (Intel) | `PDF.Studio-x.x.x.dmg` |
| Linux | `PDF.Studio-x.x.x.AppImage` |

> **The builds are unsigned**, so your OS may warn you the first time you open the app:
> - **Windows**: on the "Windows protected your PC" screen, click **More info → Run anyway**.
> - **macOS**: right-click the app, choose **Open**, then click **Open** again. If macOS says the app is "damaged", run `xattr -cr "/Applications/PDF Studio.app"`.
> - **Linux**: run `chmod +x PDF.Studio-*.AppImage`, then start the file.

## Features

- Open a PDF with the Open button, Ctrl+O, or by dragging the file onto the window
- Page thumbnails in the sidebar, page navigation, zoom, and fit-to-width
- Annotation tools: freehand draw, highlight, text, rectangle, and eraser
- Adjustable color, brush/text size, and highlight opacity
- Save a new PDF with your annotations included
- Panels for document info (pages, size, page dimensions) and extracted page text
- Follows your system's light or dark mode

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + O` | Open PDF |
| `Ctrl/Cmd + S` | Save annotated PDF |
| `V` | Select |
| `D` | Draw |
| `H` | Highlight |
| `T` | Text |
| `S` | Rectangle |
| `E` | Erase |
| `←` / `→` | Previous / next page |
| `+` / `-` | Zoom in / out |
| `W` | Fit width |

## Run from source

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone https://github.com/sujithp28/pdf-studio.git
cd pdf-studio
npm install
npm start
```

## Build installers

```bash
npm run dist-win     # Windows (.exe)
npm run dist-mac     # macOS (.dmg), must be built on a Mac
npm run dist-linux   # Linux (.AppImage)
```

The installers are written to `dist/`. The Windows and macOS builds also need an icon file, `assets/icon.ico` or `assets/icon.icns`. The CI workflow creates these from `assets/icon.png`.

Every push to `master` runs [GitHub Actions](.github/workflows/build.yml), which builds for all three platforms and publishes the installers to the release.

## Project layout

```
main.js      Electron main process: window, menus, open/save dialogs
preload.js   Safe IPC bridge between the main process and the UI
index.html   The whole UI: PDF rendering and annotation tools
assets/      App icon
```

## License

MIT
