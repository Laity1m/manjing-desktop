/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } = require("electron");
const { createDesktopRuntime, invokeImageModel, volcengineSdkStatus } = require("./desktop-runtime");

const APP_SCHEME = "manjing";
const APP_URL = "manjing://app/";
const isSmokeTest = process.argv.includes("--smoke-test");
const isDirectorModelSmokeTest = process.argv.includes("--smoke-director-model");
const isEditorHandoffSmokeTest = process.argv.includes("--smoke-editor-handoff");
const isCanvasSmokeTest = process.argv.includes("--smoke-canvas");
const isProjectWorkflowSmokeTest = process.argv.includes("--smoke-project-workflow");
const isVideoAudioSmokeTest = process.argv.includes("--smoke-video-audio");
const isStudioVoiceSmokeTest = process.argv.includes("--smoke-studio-voice");
const isNavigationSmokeTest = process.argv.includes("--smoke-navigation");
const isTest = isSmokeTest || isDirectorModelSmokeTest || isEditorHandoffSmokeTest || isCanvasSmokeTest || isProjectWorkflowSmokeTest || isVideoAudioSmokeTest || isStudioVoiceSmokeTest || isNavigationSmokeTest;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// 软件渲染兼容更多 Windows 显卡与远程桌面环境，避免启动白屏。
if (process.platform === "win32") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

if (isTest) {
  app.setPath("userData", path.join(app.getPath("temp"), `manjing-desktop-smoke-${process.pid}`));
}

let mainWindow = null;
let lastDownloadedFile = "";
let smokeTimer = null;

function isAppUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === `${APP_SCHEME}:` && url.hostname === "app";
  } catch {
    return false;
  }
}

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents && isAppUrl(event.sender.getURL()));
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const APP_ROUTES = new Set(["/", "/studio", "/video", "/canvas", "/editor", "/assets", "/models", "/projects", "/projects/detail"]);

function safeAppNavigationUrl(value) {
  try {
    const target = new URL(String(value || ""), APP_URL);
    return isAppUrl(target.href) && APP_ROUTES.has(target.pathname) ? target.href : "";
  } catch {
    return "";
  }
}

function finishSmokeTest() {
  if (!isTest) return;
  if (smokeTimer) clearTimeout(smokeTimer);
  console.log("MANJING_DESKTOP_DIRECT_OK");
  setTimeout(() => app.exit(0), 250);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f1eb",
    title: "漫镜 · AI 漫剧工作室",
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
  mainWindow.once("ready-to-show", () => {
    if (!isTest && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.on("unresponsive", () => {
    if (isTest) {
      console.error("漫镜窗口在交互测试中失去响应");
      app.exit(1);
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (isTest) {
      console.error(`漫镜渲染进程异常退出：${details.reason}`);
      app.exit(1);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      void mainWindow.loadURL(url);
    } else {
      const target = safeHttpsUrl(url);
      if (target) void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    const target = safeHttpsUrl(url);
    if (target) void shell.openExternal(target);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (isTest) {
      console.error(`漫镜直载失败：${errorCode} ${errorDescription}`);
      app.exit(1);
      return;
    }
    dialog.showErrorBox("漫镜无法启动", `内置应用加载失败：${errorDescription}（${errorCode}）\n\n请重新安装漫镜最新版。`);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (isNavigationSmokeTest) {
      setTimeout(async () => {
        try {
          const routes = [
            ["/studio", "#story"],
            ["/video", ".video-lab-page"],
            ["/canvas", ".canvas-page"],
            ["/editor", ".editor-page"],
            ["/assets", ".asset-library-page"],
            ["/models", ".keys-page"],
            ["/projects", ".projects-page"],
            ["/", ".portal-home"]
          ];
          for (const [pathname, selector] of routes) {
            const loaded = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error(`顶部导航超时：${pathname}`)), 6000);
              const check = () => {
                try {
                  if (new URL(mainWindow.webContents.getURL()).pathname !== pathname) return;
                  clearTimeout(timeout);
                  mainWindow.webContents.removeListener("did-finish-load", check);
                  resolve();
                } catch { /* keep waiting for the requested route */ }
              };
              mainWindow.webContents.on("did-finish-load", check);
            });
            const clicked = await mainWindow.webContents.executeJavaScript(`(() => { const link = document.querySelector('.global-nav a[href="${pathname}"]'); if (!link) return false; link.click(); return true; })()`);
            if (!clicked) throw new Error(`没有找到顶部导航：${pathname}`);
            await loaded;
            await new Promise((resolve) => setTimeout(resolve, 160));
            const state = await mainWindow.webContents.executeJavaScript(`({ route: location.pathname, ready: Boolean(document.querySelector(${JSON.stringify(selector)})), links: document.querySelectorAll('.global-nav a').length, responsive: document.visibilityState === 'visible' || document.visibilityState === 'hidden' })`);
            if (state.route !== pathname || !state.ready || state.links < 9 || !state.responsive) throw new Error(`顶部导航页面不可交互：${pathname} ${JSON.stringify(state)}`);
          }
          if (smokeTimer) clearTimeout(smokeTimer);
          console.log("MANJING_TOP_NAV_OK");
          setTimeout(() => app.exit(0), 250);
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 350);
      return;
    }
    if (isStudioVoiceSmokeTest) {
      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector('.studio-voice-setting'); attempt += 1) await wait(100);
            const toggle = document.querySelector('button[aria-label="一键漫剧自动配音"]');
            const provider = document.querySelector('.studio-voice-provider');
            if (!toggle || !provider) return { ok: false, step: 'controls' };
            const initial = toggle.getAttribute('aria-pressed') === 'true';
            toggle.click();
            let changed = null;
            for (let attempt = 0; attempt < 20; attempt += 1) {
              await wait(80);
              changed = JSON.parse(localStorage.getItem('manjing-workspace') || 'null');
              if (changed?.voiceEnabled === !initial) break;
            }
            const changedToggle = document.querySelector('button[aria-label="一键漫剧自动配音"]');
            if (changedToggle?.getAttribute('aria-pressed') !== String(!initial) || changed?.voiceEnabled !== !initial) return { ok: false, step: 'changed', initial, pressed: changedToggle?.getAttribute('aria-pressed'), persisted: changed?.voiceEnabled };
            changedToggle.click();
            let restored = null;
            for (let attempt = 0; attempt < 20; attempt += 1) {
              await wait(80);
              restored = JSON.parse(localStorage.getItem('manjing-workspace') || 'null');
              if (restored?.voiceEnabled === initial) break;
            }
            const restoredToggle = document.querySelector('button[aria-label="一键漫剧自动配音"]');
            return { ok: location.protocol === 'manjing:' && restoredToggle?.getAttribute('aria-pressed') === String(initial) && restored?.voiceEnabled === initial, protocol: location.protocol, initial, restored: restored?.voiceEnabled };
          })()`);
          if (!result?.ok) throw new Error(`一键漫剧配音开关交互测试失败：${JSON.stringify(result)}`);
          if (smokeTimer) clearTimeout(smokeTimer);
          console.log("MANJING_STUDIO_VOICE_OK");
          setTimeout(() => app.exit(0), 250);
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 350);
      return;
    }
    if (isVideoAudioSmokeTest) {
      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector('.video-audio-setting'); attempt += 1) await wait(100);
            const toggle = document.querySelector('button[aria-label="生成视频配音"]');
            if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') return { ok: false, step: 'initial-toggle' };
            toggle.click();
            await wait(250);
            const enabledToggle = document.querySelector('button[aria-label="生成视频配音"]');
            const options = document.querySelector('.video-voice-options');
            const draftOn = JSON.parse(localStorage.getItem('manjing-free-video-draft-v1') || 'null');
            if (!enabledToggle || enabledToggle.getAttribute('aria-pressed') !== 'true' || !options || !options.querySelector('textarea') || draftOn?.voiceEnabled !== true) return { ok: false, step: 'enabled-state', pressed: enabledToggle?.getAttribute('aria-pressed'), persisted: draftOn?.voiceEnabled };
            enabledToggle.click();
            await wait(250);
            const disabledToggle = document.querySelector('button[aria-label="生成视频配音"]');
            const draftOff = JSON.parse(localStorage.getItem('manjing-free-video-draft-v1') || 'null');
            return { ok: location.protocol === 'manjing:' && disabledToggle?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.video-voice-options') && draftOff?.voiceEnabled === false, protocol: location.protocol, pressed: disabledToggle?.getAttribute('aria-pressed'), persisted: draftOff?.voiceEnabled };
          })()`);
          if (!result?.ok) throw new Error(`自主视频配音开关交互测试失败：${JSON.stringify(result)}`);
          if (smokeTimer) clearTimeout(smokeTimer);
          console.log("MANJING_VIDEO_AUDIO_OK");
          setTimeout(() => app.exit(0), 250);
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 350);
      return;
    }
    if (isProjectWorkflowSmokeTest) {
      setTimeout(async () => {
        try {
          const clickAndWait = async (script, pathname, selector) => {
            await mainWindow.webContents.executeJavaScript(script);
            for (let attempt = 0; attempt < 100; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              try {
                const ready = await mainWindow.webContents.executeJavaScript(`location.pathname === ${JSON.stringify(pathname)} && Boolean(document.querySelector(${JSON.stringify(selector)}))`);
                if (ready) return;
              } catch { /* the renderer context can be replaced while navigating */ }
            }
            throw new Error(`页面跳转超时：${pathname}`);
          };
          const draft = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector("#story"); attempt += 1) await wait(100);
            const story = document.querySelector("#story");
            if (!story) return { ok: false, step: "story-input" };
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
            setter.call(story, "页面切换后仍然保留的漫剧草稿，用于检查项目恢复和新建同类作品。");
            story.dispatchEvent(new Event("input", { bubbles: true }));
            await wait(700);
            const session = JSON.parse(localStorage.getItem("manjing-studio-session-v2") || "null");
            const drafts = JSON.parse(localStorage.getItem("manjing-studio-drafts-v1") || "{}");
            const cards = JSON.parse(localStorage.getItem("manjing-projects") || "[]");
            return { ok: Boolean(session?.projectId && drafts[session.projectId] && cards.some((item) => item.id === session.projectId)), id: session?.projectId, story: session?.story };
          })()`);
          if (!draft?.ok || !draft.id) throw new Error(`工作台草稿写入失败：${JSON.stringify(draft)}`);

          await clickAndWait(`document.querySelector('.global-nav a[href="/projects"]').click(); true`, "/projects", ".projects-page");
          const list = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector(".project-grid"); attempt += 1) await wait(100);
            const cards = [...document.querySelectorAll(".project-grid > article")];
            const target = cards.find((card) => card.textContent.includes("页面切换后仍然保留"));
            return { ok: Boolean(target && target.textContent.includes("制作中") && [...target.querySelectorAll("button")].some((button) => button.textContent.includes("新建同类作品")) && [...target.querySelectorAll("button")].some((button) => button.textContent.includes("继续制作"))), cards: cards.length };
          })()`);
          if (!list?.ok) throw new Error(`制作中项目列表检查失败：${JSON.stringify(list)}`);

          await clickAndWait(`(() => { const card = [...document.querySelectorAll('.project-grid > article')].find((item) => item.textContent.includes('页面切换后仍然保留')); const link = card?.querySelector('a[href*="/projects/detail"]'); if (!link) throw new Error('项目详情链接不存在'); link.click(); return true; })()`, "/projects/detail", ".project-detail-page");
          const detail = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector(".project-draft-detail, .project-detail-missing"); attempt += 1) await wait(100);
            const panel = document.querySelector(".project-draft-detail");
            return { ok: Boolean(panel && panel.textContent.includes("页面切换后仍然保留") && panel.querySelector("button")), text: panel?.textContent || document.body.textContent.slice(0, 200) };
          })()`);
          if (!detail?.ok) throw new Error(`制作中项目详情检查失败：${JSON.stringify(detail)}`);

          await clickAndWait(`document.querySelector('.project-draft-detail button').click(); true`, "/studio", "#story");
          const restored = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector("#story")?.value.includes("页面切换后仍然保留"); attempt += 1) await wait(100);
            return document.querySelector("#story")?.value || "";
          })()`);
          if (!restored.includes("页面切换后仍然保留")) throw new Error("跨页面返回工作台后草稿没有恢复");

          await clickAndWait(`document.querySelector('.global-nav a[href="/projects"]').click(); true`, "/projects", ".project-grid");
          const clickSimilar = `(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector(".project-grid"); attempt += 1) await wait(100);
            const button = [...document.querySelectorAll(".project-grid button")].find((item) => item.textContent.includes("新建同类作品"));
            if (!button) throw new Error("没有找到新建同类作品按钮");
            button.click();
            return true;
          })()`;
          await clickAndWait(clickSimilar, "/studio", "#story");
          const fresh = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 50 && !document.querySelector("#story"); attempt += 1) await wait(100);
            await wait(400);
            return { story: document.querySelector("#story")?.value || "", search: location.search, marker: localStorage.getItem("manjing-new-studio") };
          })()`);
          if (fresh.story || fresh.marker || !fresh.search.includes("new=1")) throw new Error(`新建同类作品没有建立独立空白工程：${JSON.stringify(fresh)}`);
          if (smokeTimer) clearTimeout(smokeTimer);
          console.log("MANJING_PROJECT_WORKFLOW_OK");
          setTimeout(() => app.exit(0), 250);
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 350);
      return;
    }
    if (isCanvasSmokeTest) {
      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let attempt = 0; attempt < 40 && !document.querySelector(".canvas-library"); attempt += 1) await wait(100);
            const newButton = [...document.querySelectorAll(".canvas-library header button")].find((button) => button.textContent.includes("新建画布"));
            if (!newButton) return { ok: false, step: "new-canvas-button" };
            const beforeCanvases = document.querySelectorAll(".canvas-list > button").length;
            newButton.click();
            await wait(180);
            const afterCanvases = document.querySelectorAll(".canvas-list > button").length;
            const addScene = [...document.querySelectorAll(".canvas-commandbar nav button")].find((button) => button.textContent.includes("添加分镜"));
            if (!addScene) return { ok: false, step: "add-scene-button" };
            const beforeNodes = document.querySelectorAll(".production-node").length;
            addScene.click();
            await wait(120);
            const nodes = [...document.querySelectorAll(".production-node")];
            const afterNodes = nodes.length;
            if (afterNodes !== beforeNodes + 1) return { ok: false, step: "add-node", beforeNodes, afterNodes };
            const connect = nodes[0].querySelector("footer button");
            if (!connect || nodes.length < 2) return { ok: false, step: "connect-controls" };
            connect.click();
            nodes[1].click();
            await wait(120);
            const edgeCount = document.querySelectorAll(".canvas-edges path").length;
            const nodeHeader = nodes[0].querySelector("header");
            const oldLeft = parseFloat(nodes[0].style.left);
            nodeHeader.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
            window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 180, clientY: 150, pointerId: 1 }));
            window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 180, clientY: 150, pointerId: 1 }));
            await wait(120);
            const movedLeft = parseFloat(document.querySelector(".production-node").style.left);
            const titleInput = document.querySelector('input[aria-label="画布名称"]');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(titleInput, "画布交互稳定性测试");
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            await wait(450);
            const activeId = localStorage.getItem("manjing-production-canvas-active");
            const stored = JSON.parse(localStorage.getItem("manjing-production-canvases-v1") || "[]");
            const active = stored.find((item) => item.id === activeId);
            return { ok: location.protocol === "manjing:" && afterCanvases === beforeCanvases + 1 && edgeCount >= 1 && movedLeft > oldLeft && active?.title === "画布交互稳定性测试" && active.nodes.length === afterNodes, protocol: location.protocol, beforeCanvases, afterCanvases, beforeNodes, afterNodes, edgeCount, oldLeft, movedLeft, savedTitle: active?.title, activeId };
          })()`);
          if (!result?.ok) throw new Error(`制片画布交互测试失败：${JSON.stringify(result)}`);
          if (smokeTimer) clearTimeout(smokeTimer);
          console.log("MANJING_CANVAS_OK");
          setTimeout(() => app.exit(0), 250);
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 350);
      return;
    }
    if (isEditorHandoffSmokeTest) {
      setTimeout(async () => {
        try {
          const seeded = await mainWindow.webContents.executeJavaScript(`(async () => {
            const database = await new Promise((resolve, reject) => {
              const request = indexedDB.open("manjing-media-v1", 2);
              request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains("media")) request.result.createObjectStore("media");
                if (!request.result.objectStoreNames.contains("projects")) request.result.createObjectStore("projects");
              };
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const clips = [];
            const transaction = database.transaction("media", "readwrite");
            const store = transaction.objectStore("media");
            for (let index = 0; index < 8; index += 1) {
              const mediaId = "smoke-editor-media-" + index;
              store.put(new Blob([new Uint8Array(512 * 1024)], { type: "video/webm" }), mediaId);
              clips.push({ id: "smoke-visual-" + index, name: "稳定性镜头 " + (index + 1), type: "video", mediaId, duration: 4, sourceDuration: 4, trimStart: 0, trimEnd: 4, start: index * 4, volume: 1, speed: 1, filter: "none", transition: index ? "fade" : "cut" });
            }
            await new Promise((resolve, reject) => {
              transaction.oncomplete = resolve;
              transaction.onerror = () => reject(transaction.error);
              transaction.onabort = () => reject(transaction.error);
            });
            const project = { version: 2, id: "smoke-editor-project", name: "剪辑导入稳定性测试", aspect: "9:16", source: "studio", createdAt: new Date().toISOString(), clips, finalVideo: { mediaId: "smoke-editor-media-0" }, editorNote: "工作台素材已安全导入" };
            const projectTransaction = database.transaction("projects", "readwrite");
            projectTransaction.objectStore("projects").put(project, project.id);
            await new Promise((resolve, reject) => {
              projectTransaction.oncomplete = resolve;
              projectTransaction.onerror = () => reject(projectTransaction.error);
              projectTransaction.onabort = () => reject(projectTransaction.error);
            });
            database.close();
            localStorage.setItem("manjing-editor-handoff", JSON.stringify(project));
            localStorage.setItem("manjing-editor-handoff-ready", project.createdAt);
            return true;
          })()`);
          if (!seeded) throw new Error("剪辑工程测试数据写入失败");
          mainWindow.webContents.once("did-finish-load", () => {
            setTimeout(async () => {
              try {
                const result = await mainWindow.webContents.executeJavaScript(`(async () => {
                  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                  for (let attempt = 0; attempt < 50 && document.querySelector(".editor-project-loading"); attempt += 1) await wait(120);
                  const initialClips = document.querySelectorAll(".timeline-editor-clip");
                  const placeholders = document.querySelectorAll(".video-asset-placeholder");
                  const playhead = document.querySelector('input[aria-label="时间线播放头"]');
                  const splitButton = [...document.querySelectorAll(".timeline-toolbar button")].find((button) => button.textContent.includes("分割"));
                  const historyButtons = document.querySelectorAll(".editor-history button");
                  if (!playhead || !splitButton || historyButtons.length < 2) return { ok: false, step: "editor-controls" };
                  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
                  setter.call(playhead, "2");
                  playhead.dispatchEvent(new Event("input", { bubbles: true }));
                  await wait(100);
                  splitButton.click();
                  await wait(120);
                  const afterSplit = document.querySelectorAll(".timeline-editor-clip").length;
                  historyButtons[0].click();
                  await wait(100);
                  const afterUndo = document.querySelectorAll(".timeline-editor-clip").length;
                  historyButtons[1].click();
                  await wait(100);
                  const afterRedo = document.querySelectorAll(".timeline-editor-clip").length;
                  const saveButton = [...document.querySelectorAll(".editor-export-actions button")].find((button) => button.textContent.includes("保存工程"));
                  if (!saveButton) return { ok: false, step: "save-project-button" };
                  saveButton.click();
                  let currentSaveButton = saveButton;
                  for (let attempt = 0; attempt < 300; attempt += 1) {
                    currentSaveButton = [...document.querySelectorAll(".editor-export-actions button")].find((button) => button.textContent.includes("保存"));
                    if (currentSaveButton && !currentSaveButton.disabled && !currentSaveButton.textContent.includes("正在保存")) break;
                    await wait(100);
                  }
                  const database = await new Promise((resolve, reject) => {
                    const request = indexedDB.open("manjing-media-v1", 2);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                  });
                  const mediaCount = await new Promise((resolve, reject) => {
                    const request = database.transaction("media", "readonly").objectStore("media").count();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                  });
                  const storedProject = await new Promise((resolve, reject) => {
                    const request = database.transaction("projects", "readonly").objectStore("projects").get("smoke-editor-project");
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                  });
                  database.close();
                  currentSaveButton = [...document.querySelectorAll(".editor-export-actions button")].find((button) => button.textContent.includes("保存"));
                  const loadingDone = !document.querySelector(".editor-project-loading");
                  const hasHandoff = Boolean(document.querySelector(".editor-handoff-note"));
                  const decoderCount = document.querySelectorAll(".asset-browser video").length;
                  const saveReady = Boolean(currentSaveButton && !currentSaveButton.disabled && !currentSaveButton.textContent.includes("正在保存"));
                  const storedClipCount = Array.isArray(storedProject?.clips) ? storedProject.clips.length : 0;
                  return { ok: location.protocol === "manjing:" && loadingDone && hasHandoff && initialClips.length === 8 && placeholders.length === 8 && decoderCount === 0 && afterSplit === 9 && afterUndo === 8 && afterRedo === 9 && saveReady && mediaCount === 8 && storedClipCount === 9, clips: initialClips.length, placeholders: placeholders.length, afterSplit, afterUndo, afterRedo, mediaCount, storedClipCount, loadingDone, hasHandoff, decoderCount, saveReady, saveText: currentSaveButton && currentSaveButton.textContent, saveDisabled: currentSaveButton && currentSaveButton.disabled, toast: document.querySelector(".editor-toast")?.textContent || "", protocol: location.protocol };
                })()`);
                if (!result?.ok) throw new Error(`剪辑导入交互测试失败：${JSON.stringify(result)}`);
                if (smokeTimer) clearTimeout(smokeTimer);
                console.log("MANJING_EDITOR_HANDOFF_OK");
                setTimeout(() => app.exit(0), 250);
              } catch (error) {
                console.error(error);
                app.exit(1);
              }
            }, 250);
          });
          mainWindow.webContents.reload();
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 300);
      return;
    }
    if (!isDirectorModelSmokeTest) {
      finishSmokeTest();
      return;
    }
    setTimeout(async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const setInput = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          };
          const setSelect = (select, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
            setter.call(select, value);
            select.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const selector = document.querySelector('select[aria-label="选择导演 AI"]');
          const card = selector && selector.closest("article");
          const configButton = card && card.querySelector(".agent-config-button");
          if (!configButton) return { ok: false, step: "config-button" };
          configButton.click();
          await wait(120);
          const directMode = card.querySelector('select[aria-label="导演 AI自定义 API 模式"]');
          if (!directMode || ![...directMode.options].some((option) => option.value === "openai")) return { ok: false, step: "direct-api-mode" };
          setSelect(directMode, "openai");
          await wait(100);
          const directPanel = card.querySelector(".agent-config-panel");
          const directModel = directPanel && directPanel.querySelector('input[placeholder="模型名称或 ID"]');
          const directSave = directPanel && directPanel.querySelector(".agent-api-save");
          if (!directModel || !directSave) return { ok: false, step: "direct-save-button" };
          setInput(directModel, "gpt-director-test");
          await wait(80);
          directSave.click();
          await wait(360);
          if (!card.querySelector(".agent-api-status.saved")) return { ok: false, step: "direct-save-status" };
          let directSaved = JSON.parse(localStorage.getItem("manjing-custom-models") || "[]");
          let directNativeResponse = await fetch("/api/desktop/settings", { cache: "no-store" });
          let directNative = directNativeResponse.ok ? await directNativeResponse.json() : {};
          if (!directSaved.some((item) => item.id === "custom-director-direct" && item.model === "gpt-director-test") || !directNative.customModels?.some((item) => item.id === "custom-director-direct" && item.model === "gpt-director-test")) return { ok: false, step: "direct-library-sync" };
          setInput(directModel, "gpt-director-test-updated");
          await wait(80);
          directSave.click();
          await wait(360);
          directSaved = JSON.parse(localStorage.getItem("manjing-custom-models") || "[]");
          directNativeResponse = await fetch("/api/desktop/settings", { cache: "no-store" });
          directNative = directNativeResponse.ok ? await directNativeResponse.json() : {};
          if (directSaved.filter((item) => item.id === "custom-director-direct").length !== 1 || !directSaved.some((item) => item.id === "custom-director-direct" && item.model === "gpt-director-test-updated") || !directNative.customModels?.some((item) => item.id === "custom-director-direct" && item.model === "gpt-director-test-updated")) return { ok: false, step: "direct-library-update" };
          const addButton = card.querySelector(".add-custom-model-link");
          if (!addButton || addButton.tagName !== "BUTTON") return { ok: false, step: "inline-button" };
          addButton.click();
          await wait(120);
          const panel = card.querySelector(".quick-custom-model");
          const inputs = panel && panel.querySelectorAll("input");
          if (!panel || !inputs || inputs.length < 4) return { ok: false, step: "inline-form" };
          const apiMode = panel.querySelector('select');
          const discoverButton = panel.querySelector(".quick-model-discover");
          const endpointInput = [...inputs].find((input) => input.placeholder.includes("https://"));
          const modelInput = [...inputs].find((input) => input.placeholder.includes("手动输入"));
          const nameInput = [...inputs].find((input) => input.placeholder.includes("默认使用模型 ID"));
          if (!apiMode || apiMode.options.length < 5 || !discoverButton || !endpointInput || !modelInput || !nameInput) return { ok: false, step: "api-form" };
          setInput(endpointInput, "https://example.invalid/v1/director");
          setInput(modelInput, "director-test-model");
          setInput(nameInput, "导演测试模型");
          await wait(80);
          const saveButton = panel.querySelector(".quick-custom-save");
          if (!saveButton) return { ok: false, step: "save-button" };
          saveButton.click();
          await wait(320);
          let saved = JSON.parse(localStorage.getItem("manjing-custom-models") || "[]");
          let nativeSettingsResponse = await fetch("/api/desktop/settings", { cache: "no-store" });
          let nativeSettings = nativeSettingsResponse.ok ? await nativeSettingsResponse.json() : {};
          const selected = document.querySelector('select[aria-label="选择导演 AI"]');
          const quickSaved = saved.find((item) => item.role === "director" && item.model === "director-test-model");
          if (!quickSaved || !nativeSettings.customModels?.some((item) => item.id === quickSaved.id) || selected.value !== quickSaved.id) return { ok: false, step: "inline-library-sync" };
          const savedRows = [...card.querySelectorAll(".agent-saved-models article")];
          const quickRow = savedRows.find((row) => row.textContent.includes("director-test-model"));
          const deleteButton = quickRow && quickRow.querySelector("button");
          if (!deleteButton) return { ok: false, step: "delete-button" };
          deleteButton.click();
          await wait(80);
          if (deleteButton.getAttribute("aria-pressed") !== "true" || !deleteButton.textContent.includes("确认删除")) return { ok: false, step: "nonblocking-delete-confirmation" };
          deleteButton.click();
          await wait(380);
          saved = JSON.parse(localStorage.getItem("manjing-custom-models") || "[]");
          nativeSettingsResponse = await fetch("/api/desktop/settings", { cache: "no-store" });
          nativeSettings = nativeSettingsResponse.ok ? await nativeSettingsResponse.json() : {};
          const selectedAfterDelete = document.querySelector('select[aria-label="选择导演 AI"]');
          return {
            ok: location.protocol === "manjing:" && !saved.some((item) => item.id === quickSaved.id) && !nativeSettings.customModels?.some((item) => item.id === quickSaved.id) && nativeSettings.agentConfigs?.director?.preset === "horde-director" && selectedAfterDelete.value === "horde-director" && saved.some((item) => item.id === "custom-director-direct" && item.model === "gpt-director-test-updated"),
            step: "complete",
            protocol: location.protocol,
            selected: selectedAfterDelete && selectedAfterDelete.value
          };
        })()`);
        if (!result?.ok) throw new Error(`导演模型交互测试失败：${JSON.stringify(result)}`);
        if (smokeTimer) clearTimeout(smokeTimer);
        console.log("MANJING_DIRECTOR_MODEL_OK");
        setTimeout(() => app.exit(0), 250);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    }, 350);
  });
  const initialUrl = isDirectorModelSmokeTest || isProjectWorkflowSmokeTest || isStudioVoiceSmokeTest ? `${APP_URL}studio` : isEditorHandoffSmokeTest ? `${APP_URL}editor` : isCanvasSmokeTest ? `${APP_URL}canvas` : isVideoAudioSmokeTest ? `${APP_URL}video` : APP_URL;
  void mainWindow.loadURL(initialUrl).catch((error) => {
    if (isTest) {
      console.error(error);
      app.exit(1);
    } else {
      dialog.showErrorBox("漫镜无法启动", `内置应用加载失败：${error.message}`);
    }
  });
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

ipcMain.on("app:navigate", (event, value) => {
  if (!isTrustedSender(event) || !mainWindow || mainWindow.isDestroyed()) return;
  const target = safeAppNavigationUrl(value);
  if (!target || target === mainWindow.webContents.getURL()) return;
  void mainWindow.loadURL(target).catch((error) => {
    if (Number(error?.errno) === -3 || String(error?.message || "").includes("ERR_ABORTED")) return;
    if (isTest) {
      console.error(`独立版页面切换失败：${String(error?.message || error)}`);
      app.exit(1);
    }
  });
});

ipcMain.handle("app:get-meta", (event) => {
  if (!isTrustedSender(event)) return null;
  return { version: app.getVersion(), platform: process.platform, appUrl: APP_URL, local: true, direct: true };
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

app.whenReady().then(async () => {
  try {
    if (isSmokeTest) {
      let attempts = 0;
      const recovered = await invokeImageModel({ mode: "openai", endpoint: "https://api.example.com/v1", apiKey: "test", model: "gpt-image-smoke", prompt: "测试瞬时断线重试", aspect: "9:16" }, async () => {
        attempts += 1;
        if (attempts < 3) return new Response(JSON.stringify({ error: { message: "upstream connection termination" } }), { status: 503, headers: { "Retry-After": "0" } });
        return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), { status: 200 });
      });
      if (attempts !== 3 || recovered.dataUrl !== "data:image/png;base64,aW1hZ2U=") throw new Error("生图接口瞬时断线重试自检失败");
      const volcengineSdk = volcengineSdkStatus();
      if (!volcengineSdk.installed || volcengineSdk.version !== "1.36.2" || !volcengineSdk.signerReady) {
        throw new Error(`火山引擎 SDK 内置自检失败：${volcengineSdk.note}`);
      }
    }
    const runtime = await createDesktopRuntime({ dataRoot: app.getPath("userData") });
    protocol.handle(APP_SCHEME, runtime.handle);

    const healthResponse = await runtime.handle(new Request("manjing://app/studio"));
    if (!healthResponse.ok || !(await healthResponse.text()).includes("漫镜")) {
      throw new Error("内置应用启动自检失败");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isTest) {
      console.error(detail);
      app.exit(1);
      return;
    }
    dialog.showErrorBox("漫镜无法启动", `内置应用初始化失败：${detail}\n\n请重新安装漫镜最新版。`);
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(isAppUrl(requestingUrl) && permission === "clipboard-sanitized-write");
  });

  session.defaultSession.on("will-download", (_event, item) => {
    if (isTest) {
      item.cancel();
      return;
    }
    item.on("updated", () => {
      const total = item.getTotalBytes();
      const progress = total > 0 ? item.getReceivedBytes() / total : -1;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(progress);
    });
    item.once("done", (_downloadEvent, state) => {
      if (state === "completed") lastDownloadedFile = item.getSavePath();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
        if (state === "completed") mainWindow.flashFrame(true);
      }
    });
  });

  if (isTest) {
    smokeTimer = setTimeout(() => {
      console.error("漫镜桌面直载测试超时");
      app.exit(1);
    }, isEditorHandoffSmokeTest ? 90000 : isProjectWorkflowSmokeTest || isNavigationSmokeTest ? 60000 : isCanvasSmokeTest || isVideoAudioSmokeTest || isStudioVoiceSmokeTest ? 30000 : 15000);
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (smokeTimer) clearTimeout(smokeTimer);
  try { protocol.unhandle(APP_SCHEME); } catch {}
});
