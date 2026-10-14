const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

// Quita el menú superior (File/Edit/View/...)
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0e0e12",
    // ── NUEVO: barra de título oculta, con overlay nativo (Win/Linux)
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#15151b",
      symbolColor: "#eee",
      height: 36,
    },
    webPreferences: {
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});