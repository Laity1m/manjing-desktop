/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const path = require("node:path");
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");

const APP_URL = "https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site";
const APP_ORIGIN = new URL(APP_URL).origin;
const isSmokeTest = process.argv.includes("--smoke-test");

if (isSmokeTest) {
  app.disableHardwareAcceleration();
  app.setPath("userData", path.join(app.getPath("temp"), "manjing-desktop-smoke"));
}

let mainWindow = null;
let lastDownloadedFile = "";

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: !isSmokeTest,
    frame: false,
    backgroundColor: "#15121a",
    icon: path.join(__dirname, "build", "icon.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "shell.html"));

  mainWindow.on("maximize", () => send("window:maximized", true));
  mainWindow.on("unmaximize", () => send("window:maximized", false));
  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = safeHttpsUrl(url);
    if (target) void shell.openExternal(target);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });

  if (isSmokeTest) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => app.exit(0), 700);
    });
  }
}

ipcMain.on("window:minimize", (event) => {
  if (isTrustedSender(event)) mainWindow.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  if (!isTrustedSender(event)) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on("window:close", (event) => {
  if (isTrustedSender(event)) mainWindow.close();
});

ipcMain.handle("app:get-meta", (event) => {
  if (!isTrustedSender(event)) return null;
  return { version: app.getVersion(), platform: process.platform, appUrl: APP_URL };
});

ipcMain.handle("app:open-external", async (event, value) => {
  if (!isTrustedSender(event)) return false;
  const target = safeHttpsUrl(value);
  if (!target) return false;
  await shell.openExternal(target);
  return true;
});

ipcMain.handle("app:show-download", async (event) => {
  if (!isTrustedSender(event)) return false;
  if (lastDownloadedFile) shell.showItemInFolder(lastDownloadedFile);
  else await shell.openPath(app.getPath("downloads"));
  return true;
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    const trusted = requestingUrl.startsWith(APP_ORIGIN);
    callback(trusted && permission === "clipboard-sanitized-write");
  });

  session.defaultSession.on("will-download", (_event, item) => {
    const initial = { state: "started", name: item.getFilename(), percent: 0 };
    send("download:state", initial);

    item.on("updated", (_downloadEvent, state) => {
      const total = item.getTotalBytes();
      const percent = total > 0 ? Math.round((item.getReceivedBytes() / total) * 100) : 0;
      send("download:state", { state, name: item.getFilename(), percent });
    });

    item.once("done", (_downloadEvent, state) => {
      if (state === "completed") lastDownloadedFile = item.getSavePath();
      send("download:state", { state, name: item.getFilename(), percent: state === "completed" ? 100 : 0 });
    });
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
