"use strict";

const routes = ["/", "/studio", "/video", "/editor", "/models", "/projects"];

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

let baseUrl = "";
let currentRoute = "/";
let downloadTimer = 0;
let siteStarted = false;

function setLoading(active) {
  loadingBar.classList.toggle("active", active);
}

function updateNetwork() {
  const online = navigator.onLine;
  networkPill.classList.toggle("offline", !online);
  networkPill.querySelector("b").textContent = online ? "AI 网络可用" : "本机模式 · AI 离线";
  networkLabel.textContent = "本机工作区";
}

function routeLabel(pathname) {
  return ({
    "/": ["创作首页", "MANJING / HOME"],
    "/studio": ["AI 工作台", "MANJING / AI STUDIO"],
    "/video": ["自主 AI 视频", "MANJING / FREE VIDEO"],
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
  if (!baseUrl) return;
  setLoading(true);
  siteStarted = true;
  frame.src = `${baseUrl}${route}`;
  welcomePanel.classList.remove("visible");
}

function showWelcome() {
  welcomePanel.classList.add("visible");
}

async function initialize() {
  setLoading(true);
  offlineCard.hidden = true;
  try {
    const meta = await window.manjingDesktop.getMeta();
    if (!meta?.appUrl || !meta.local) throw new Error("本机服务未就绪");
    baseUrl = meta.appUrl;
    document.getElementById("versionLabel").textContent = `版本 ${meta.version}`;
    siteStarted = true;
    frame.src = `${baseUrl}${currentRoute}`;
    showWelcome();
  } catch {
    setLoading(false);
    offlineCard.hidden = false;
  }
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
document.getElementById("retryButton").addEventListener("click", initialize);
document.getElementById("browserButton").addEventListener("click", () => navigate("/"));
document.getElementById("downloadButton").addEventListener("click", () => window.manjingDesktop.showDownload());
document.getElementById("showDownloadButton").addEventListener("click", () => window.manjingDesktop.showDownload());
document.getElementById("minimizeButton").addEventListener("click", () => window.manjingDesktop.minimize());
document.getElementById("maximizeButton").addEventListener("click", () => window.manjingDesktop.toggleMaximize());
document.getElementById("closeButton").addEventListener("click", () => window.manjingDesktop.close());

frame.addEventListener("load", () => {
  if (!siteStarted) return;
  window.setTimeout(() => setLoading(false), 240);
  offlineCard.hidden = true;
  window.manjingDesktop.siteReady();
});

window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey && /^[1-6]$/.test(event.key)) {
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

updateNetwork();
void initialize();
