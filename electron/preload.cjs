const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mozzie", {
  openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  scanFolder: (folder) => ipcRenderer.invoke("scan-folder", folder),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  exists: (filePath) => ipcRenderer.invoke("fs:exists", filePath),
  blockSleep: () => ipcRenderer.invoke("power:block"),
  unblockSleep: () => ipcRenderer.invoke("power:unblock"),
  fetchUrl: (url) => ipcRenderer.invoke("fetch-url", url),
});