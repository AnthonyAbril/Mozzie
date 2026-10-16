const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mozzie", {
  openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  exists: (filePath) => ipcRenderer.invoke("fs:exists", filePath),
});