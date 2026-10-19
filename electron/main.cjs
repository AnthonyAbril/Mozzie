const { app, BrowserWindow, Menu, ipcMain, dialog, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");

Menu.setApplicationMenu(null);

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('reduce-gpu-sandbox'); // Evita el crash de memoria en Windows

const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i;

/** Lee archivos de audio de una carpeta (no recursivo) */
function listAudioFiles(folder) {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isFile() && AUDIO_EXT.test(d.name))
      .map((d) => path.join(folder, d.name));
  } catch (err) {
    console.warn("No se pudo leer la carpeta:", folder, err);
    return [];
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0e0e12",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#15151b",
      symbolColor: "#eee",
      height: 36,
    },
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on("context-menu", (e) => e.preventDefault());

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5555");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.on("render-process-gone", (event, details) => {
    console.error("💥 El renderer ha crasheado:", details.reason, details.exitCode);
  });
}

app.whenReady().then(() => {
  ipcMain.handle("dialog:openFiles", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Audio",
          extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "webm"],
        },
      ],
    });
    return canceled ? [] : filePaths;
  });

  let blockerId = null;
  ipcMain.handle("power:block", () => {
    if (!blockerId) blockerId = powerSaveBlocker.start("prevent-display-sleep");
  });
  ipcMain.handle("power:unblock", () => {
    if (blockerId) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  });
    // ✅ NUEVO: Handler para peticiones HTTP sin CORS
  ipcMain.handle("fetch-url", async (_e, url) => {
    try {
      // Usamos fetch nativo (disponible en Electron 15+)
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mozzie/0.2.0",
        },
      });
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Devuelve { folder, files } | null ──
  ipcMain.handle("dialog:openFolder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths[0]) return null;
    const folder = filePaths[0];
    return { folder, files: listAudioFiles(folder) };
  });

  // ── Escanea una carpeta por ruta (para "Recargar carpetas") ──
  ipcMain.handle("scan-folder", async (_e, folder) => {
    if (!folder || typeof folder !== "string") return [];
    try {
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
    } catch {
      return [];
    }
    return listAudioFiles(folder);
  });

  ipcMain.handle("fs:readFile", async (_e, filePath) => {
    try {
      const buf = fs.readFileSync(filePath);
      return {
        ok: true,
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("fs:exists", async (_e, filePath) => {
    return fs.existsSync(filePath);
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});