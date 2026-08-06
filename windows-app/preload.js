/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("manjingDesktop", {
  navigate: (pathname) => ipcRenderer.send("app:navigate", pathname),
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  siteReady: () => ipcRenderer.send("app:site-ready"),
  getMeta: () => ipcRenderer.invoke("app:get-meta"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  showDownload: () => ipcRenderer.invoke("app:show-download"),
  onMaximized: (listener) => ipcRenderer.on("window:maximized", (_event, value) => listener(Boolean(value))),
  onDownload: (listener) => ipcRenderer.on("download:state", (_event, value) => listener(value))
});
