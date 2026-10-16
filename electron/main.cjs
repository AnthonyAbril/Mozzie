const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

Menu.setApplicationMenu(null);

const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i;

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

  ipcMain.handle("dialog:openFolder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths[0]) return [];
    const folder = filePaths[0];
    try {
      return fs
        .readdirSync(folder)
        .filter((f) => AUDIO_EXT.test(f))
        .map((f) => path.join(folder, f));
    } catch (err) {
      console.warn("No se pudo leer la carpeta:", err);
      return [];
    }
  });

  ipcMain.handle("fs:readFile", async (_e, filePath) => {
    try {
      const buf = fs.readFileSync(filePath);
      return {
        ok: true,
        data: buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ),
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