"use strict";

const BASE_URL = "https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site";
const routes = ["/", "/studio", "/editor", "/models", "/projects"];

const frame = document.getElementById("appFrame");
const loadingBar = document.getElementById("loadingBar");
const welcomePanel = document.getElementById("welcomePanel");
const networkPill = document.getElementById("networkPill");
const networkLabel = document.getElementById("networkLabel");
const offlineCard = document.getElementById("offlineCard");
const routeName = document.getElementById("routeName");
const routeEyebrow = document.getElementById("routeEyebrow");
const pageTitle = document.getElementById("pageTitle");
const downloadToast = document.getElementById("downloadToast");

let currentRoute = "/";
let downloadTimer = 0;

function setLoading(active) {
  loadingBar.classList.toggle("active", active);
}

function updateNetwork() {
  const online = navigator.onLine;
  networkPill.classList.toggle("offline", !online);
  networkPill.querySelector("b").textContent = online ? "云端已连接" : "网络已断开";
  networkLabel.textContent = online ? "云端服务在线" : "离线模式";
  offlineCard.hidden = online;
  frame.classList.toggle("is-offline", !online);
}

function routeLabel(pathname) {
  return ({
    "/": ["创作首页", "MANJING / HOME"],
    "/studio": ["AI 工作台", "MANJING / AI STUDIO"],
    "/editor": ["专业剪辑台", "MANJING / EDITOR"],
    "/models": ["模型与 Key", "MANJING / MODELS"],
    "/projects": ["项目与资产", "MANJING / PROJECTS"]
  })[pathname] || ["漫镜", "MANJING / STUDIO"];
}

function navigate(pathname) {
  const route = routes.includes(pathname) ? pathname : "/";
  const [name, eyebrow] = routeLabel(route);
  currentRoute = route;
  routeName.textContent = name;
  routeEyebrow.textContent = eyebrow;
  pageTitle.textContent = name;
  document.querySelectorAll(".rail-item[data-route]").forEach((button) => {
    button.classList.toggle("active", button.dataset.route === route);
  });
  setLoading(true);
  frame.src = `${BASE_URL}${route}`;
  welcomePanel.classList.remove("visible");
}

function showWelcome() {
  welcomePanel.classList.add("visible");
}

document.querySelectorAll(".rail-item[data-route]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.route));
});

document.querySelectorAll("[data-welcome-route]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.welcomeRoute));
});

document.getElementById("welcomeButton").addEventListener("click", showWelcome);
document.getElementById("welcomeClose").addEventListener("click", () => welcomePanel.classList.remove("visible"));
document.getElementById("reloadButton").addEventListener("click", () => navigate(currentRoute));
document.getElementById("retryButton").addEventListener("click", () => { updateNetwork(); if (navigator.onLine) navigate(currentRoute); });
document.getElementById("browserButton").addEventListener("click", () => window.manjingDesktop.openExternal(`${BASE_URL}${currentRoute}`));
document.getElementById("downloadButton").addEventListener("click", () => window.manjingDesktop.showDownload());
document.getElementById("showDownloadButton").addEventListener("click", () => window.manjingDesktop.showDownload());
document.getElementById("minimizeButton").addEventListener("click", () => window.manjingDesktop.minimize());
document.getElementById("maximizeButton").addEventListener("click", () => window.manjingDesktop.toggleMaximize());
document.getElementById("closeButton").addEventListener("click", () => window.manjingDesktop.close());

frame.addEventListener("load", () => {
  window.setTimeout(() => setLoading(false), 240);
});

window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey && /^[1-5]$/.test(event.key)) {
    event.preventDefault();
    navigate(routes[Number(event.key) - 1]);
  }
  if (event.ctrlKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    navigate(currentRoute);
  }
  if (event.key === "Escape" && welcomePanel.classList.contains("visible")) {
    welcomePanel.classList.remove("visible");
  }
});

window.manjingDesktop.onMaximized((maximized) => {
  document.getElementById("maximizeButton").textContent = maximized ? "❐" : "□";
});

window.manjingDesktop.onDownload((download) => {
  window.clearTimeout(downloadTimer);
  downloadToast.hidden = false;
  document.getElementById("downloadTitle").textContent = download.state === "completed" ? "下载完成" : download.state === "cancelled" ? "下载已取消" : download.state === "interrupted" ? "下载中断" : "正在下载";
  document.getElementById("downloadDetail").textContent = download.state === "completed" ? download.name : `${download.name} · ${download.percent || 0}%`;
  document.getElementById("showDownloadButton").hidden = download.state !== "completed";
  if (["completed", "cancelled", "interrupted"].includes(download.state)) {
    downloadTimer = window.setTimeout(() => { downloadToast.hidden = true; }, 7000);
  }
});

window.manjingDesktop.getMeta().then((meta) => {
  if (meta) document.getElementById("versionLabel").textContent = `版本 ${meta.version}`;
});

updateNetwork();
showWelcome();
