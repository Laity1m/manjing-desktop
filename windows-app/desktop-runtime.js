/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const API_TIMEOUT_MS = 30000;
const TEXT_ROLE_TIMEOUT_MS = { writer: 120000, director: 120000, editor: 90000 };
const IMAGE_GENERATION_TIMEOUT_MS = 180000;
const TRANSIENT_PROVIDER_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const SEEDANCE_ARK_API = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const SEEDANCE_TASK_PATTERN = /^cgt-[a-z0-9-]{8,100}$/i;
const SEEDANCE_MODEL_PATTERN = /^(?:doubao-seedance-[a-z0-9-]+|ep-[a-z0-9-]+)$/i;
const SEEDANCE_CREATE_CACHE = new Map();
const API_DEFAULT_ENDPOINTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  pollinations: "https://gen.pollinations.ai/v1"
};
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".zip": "application/zip"
};

function findAppRoot() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "desktop-app") : "",
    path.join(__dirname, "..", "dist")
  ].filter(Boolean);
  const appRoot = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "server", "index.js")) &&
    fs.existsSync(path.join(candidate, "client"))
  );
  if (!appRoot) throw new Error("安装包中缺少漫镜内置应用，请重新安装。");
  return appRoot;
}

function resolveStaticFile(clientRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "";
  }
  if (decoded.endsWith("/")) return "";
  const resolved = path.resolve(clientRoot, decoded.replace(/^\/+/, ""));
  const prefix = `${path.resolve(clientRoot)}${path.sep}`;
  return resolved.startsWith(prefix) ? resolved : "";
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || "");
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : NaN;
  let end = match[2] ? Number(match[2]) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    const suffixLength = Math.min(end, size);
    start = size - suffixLength;
    end = size - 1;
  } else {
    end = Number.isNaN(end) ? size - 1 : Math.min(end, size - 1);
  }
  if (start < 0 || start >= size || end < start) return null;
  return { start, end };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Manjing-Desktop": "direct"
    }
  });
}

function volcengineSdkStatus() {
  try {
    const sdk = require("@volcengine/openapi");
    const packageInfo = require("@volcengine/openapi/package.json");
    return {
      installed: true,
      package: "@volcengine/openapi",
      version: String(packageInfo.version || "unknown"),
      signerReady: typeof sdk.Signer === "function",
      serviceReady: typeof sdk.Service === "function",
      seedanceTransport: "Ark API Key",
      note: "火山官方 SDK 已随漫镜安装；Seedance 视频生成按官方文档使用方舟 API Key，签名类 OpenAPI 可使用内置 Signer。"
    };
  } catch (error) {
    return { installed: false, package: "@volcengine/openapi", version: "", signerReady: false, serviceReady: false, seedanceTransport: "Ark API Key", note: String(error?.message || "火山引擎 SDK 未能加载") };
  }
}

async function readJsonRequest(request) {
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES) throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
  try {
    return JSON.parse(Buffer.from(body).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("请求格式不是有效 JSON"), { statusCode: 400 });
  }
}

function validRemoteUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(host) ? url : null;
  } catch {
    return null;
  }
}

function cleanApiBase(mode, endpoint) {
  const fallback = API_DEFAULT_ENDPOINTS[mode] || "";
  const url = validRemoteUrl(String(endpoint || fallback).trim());
  if (!url) throw Object.assign(new Error("请填写 HTTPS API 地址，或本机 localhost 地址"), { statusCode: 400 });
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const suffixes = ["/chat/completions", "/responses", "/messages", "/models", "/images/generations", "/generate"];
  for (const suffix of suffixes) {
    if (url.pathname.toLowerCase().endsWith(suffix)) {
      url.pathname = url.pathname.slice(0, -suffix.length) || "/";
      break;
    }
  }
  return url;
}

function appendApiPath(base, pathname) {
  const next = new URL(base.href);
  next.pathname = `${base.pathname.replace(/\/+$/, "")}/${String(pathname).replace(/^\/+/, "")}`;
  return next;
}

function providerHeaders(mode, apiKey, json = false) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (apiKey) {
    if (mode === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (mode === "gemini") {
      headers["x-goog-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  return headers;
}

function providerRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.get("retry-after");
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15000, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(15000, date - Date.now()));
  }
  return attempt === 1 ? 1500 : 4000;
}

function pause(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function fetchProviderResponse(url, init, fetchImpl = fetch, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || API_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || 1));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (response.ok || !TRANSIENT_PROVIDER_STATUSES.has(response.status) || attempt === maxAttempts) {
        return { response, attempts: attempt };
      }
      const delay = providerRetryDelay(response, attempt);
      try { await response.body?.cancel(); } catch {}
      await pause(delay);
    } catch (error) {
      if (error?.name === "AbortError") {
        const seconds = Math.round(timeoutMs / 1000);
        throw Object.assign(new Error(options.timeoutMessage || `接口在 ${seconds} 秒内没有响应，请检查地址、网络或服务商队列后重新运行`), { statusCode: 504 });
      }
      if (attempt === maxAttempts) {
        const label = options.retryLabel || "接口";
        const detail = String(error?.message || "连接被中断").slice(0, 240);
        throw Object.assign(new Error(maxAttempts > 1 ? `${label}连续 ${attempt} 次连接失败：${detail}。已保留现有成果，请稍后重新运行该岗位` : detail), { statusCode: 503 });
      }
      await pause(attempt === 1 ? 1500 : 4000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(new Error("接口连接失败"), { statusCode: 503 });
}

async function fetchProviderJson(url, init, fetchImpl = fetch, options = {}) {
  const { response, attempts } = await fetchProviderResponse(url, init, fetchImpl, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || data?.detail || text || `HTTP ${response.status}`;
    const transient = TRANSIENT_PROVIDER_STATUSES.has(response.status);
    const label = options.retryLabel || "接口";
    const prefix = transient && attempts > 1 ? `${label}连续 ${attempts} 次返回 ${response.status}` : `接口返回 ${response.status}`;
    const guidance = transient ? "。服务商连接暂时中断，已保留现有成果，请稍后重新运行该岗位" : "";
    throw Object.assign(new Error(`${prefix}：${String(detail).slice(0, 300)}${guidance}`), { statusCode: transient ? 503 : 502, providerStatus: response.status });
  }
  return data;
}

function modelsFromPayload(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data?.result?.models)
          ? data.result.models
          : [];
  const seen = new Set();
  return source.map((item) => {
    if (typeof item === "string") return { id: item, name: item };
    const rawId = item?.id || item?.name || item?.model || item?.baseModelId;
    if (!rawId) return null;
    const id = String(rawId).replace(/^models\//, "");
    return { id, name: String(item?.displayName || item?.name || item?.id || id).replace(/^models\//, "") };
  }).filter((item) => item && !seen.has(item.id) && seen.add(item.id));
}

async function discoverRemoteModels(input, fetchImpl = fetch) {
  const mode = String(input?.mode || "");
  if (!["openai", "anthropic", "gemini", "pollinations", "webhook"].includes(mode)) {
    throw Object.assign(new Error("不支持的 API 模式"), { statusCode: 400 });
  }
  const base = cleanApiBase(mode, input?.endpoint);
  const listUrl = appendApiPath(base, "models");
  const data = await fetchProviderJson(listUrl, { method: "GET", headers: providerHeaders(mode, String(input?.apiKey || "").trim()) }, fetchImpl);
  const models = modelsFromPayload(data);
  if (!models.length) throw Object.assign(new Error("接口已连接，但返回内容中没有模型列表"), { statusCode: 502 });
  return { models, endpoint: base.href.replace(/\/$/, "") };
}

function responseText(data) {
  const direct = data?.text || data?.content || data?.result;
  if (typeof direct === "string" && direct.trim()) return direct;
  const openAi = data?.choices?.[0]?.message?.content;
  if (typeof openAi === "string" && openAi.trim()) return openAi;
  if (Array.isArray(openAi)) {
    const text = openAi.map((item) => item?.text || item?.content || "").join("").trim();
    if (text) return text;
  }
  if (Array.isArray(data?.content)) {
    const text = data.content.map((item) => item?.text || "").join("").trim();
    if (text) return text;
  }
  const gemini = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(gemini)) {
    const text = gemini.map((item) => item?.text || "").join("").trim();
    if (text) return text;
  }
  return "";
}

function pickFirstVideoUrl(value, seen = new Set()) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  const preferred = ["dataUrl", "videoUrl", "url", "output", "result", "payload", "data", "path", "file", "src"];
  for (const key of preferred) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const candidate = pickFirstVideoUrl(value[key], seen);
    if (candidate) return candidate;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (preferred.includes(key)) continue;
    const candidate = pickFirstVideoUrl(nested, seen);
    if (candidate) return candidate;
  }
  return "";
}

async function invokeTextModel(input, fetchImpl = fetch) {
  const mode = String(input?.mode || "");
  if (!["openai", "anthropic", "gemini", "pollinations", "webhook"].includes(mode)) {
    throw Object.assign(new Error("该 API 模式不支持文本岗位调用"), { statusCode: 400 });
  }
  const model = String(input?.model || "").trim();
  const role = String(input?.role || "");
  const prompt = String(input?.prompt || "").trim();
  const system = String(input?.system || "").trim();
  if (!model || !prompt) throw Object.assign(new Error("模型 ID 和任务内容不能为空"), { statusCode: 400 });
  const base = cleanApiBase(mode, input?.endpoint);
  const apiKey = String(input?.apiKey || "").trim();
  let target;
  let body;
  if (mode === "openai" || mode === "pollinations") {
    target = appendApiPath(base, "chat/completions");
    body = { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] };
  } else if (mode === "anthropic") {
    target = appendApiPath(base, "messages");
    body = { model, max_tokens: 4096, system, messages: [{ role: "user", content: prompt }] };
  } else if (mode === "gemini") {
    target = appendApiPath(base, `models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`);
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] };
  } else {
    target = validRemoteUrl(String(input?.endpoint || "").trim());
    if (!target) throw Object.assign(new Error("通用 Webhook 需要填写有效接口地址"), { statusCode: 400 });
    body = { role: input?.role, model, task: input?.task, system, prompt, ...(input?.payload || {}) };
  }
  const timeoutMs = TEXT_ROLE_TIMEOUT_MS[role] || 90000;
  const roleLabel = { writer: "编剧 AI", director: "导演 AI", editor: "剪辑 AI" }[role] || "文本 AI";
  const data = await fetchProviderJson(target, {
    method: "POST",
    headers: providerHeaders(mode, apiKey, true),
    body: JSON.stringify(body)
  }, fetchImpl, {
    timeoutMs,
    timeoutMessage: `${roleLabel} 模型 ${model} 在 ${Math.round(timeoutMs / 1000)} 秒内没有响应；已保留现有成果，请检查地址、网络或服务商队列后重新运行该岗位`
  });
  const text = responseText(data);
  if (!text) throw Object.assign(new Error("接口调用成功，但没有返回可用文本"), { statusCode: 502 });
  return { text };
}

async function invokeImageModel(input, fetchImpl = fetch) {
  const mode = String(input?.mode || "");
  if (mode !== "openai") throw Object.assign(new Error("该 API 模式不支持 OpenAI 兼容生图"), { statusCode: 400 });
  const model = String(input?.model || "").trim();
  const prompt = String(input?.prompt || "").trim();
  if (!model || !prompt) throw Object.assign(new Error("生图模型 ID 和提示词不能为空"), { statusCode: 400 });
  const base = cleanApiBase(mode, input?.endpoint);
  const target = appendApiPath(base, "images/generations");
  const data = await fetchProviderJson(target, {
    method: "POST",
    headers: providerHeaders(mode, String(input?.apiKey || "").trim(), true),
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: input?.aspect === "16:9" ? "1536x1024" : "1024x1536"
    })
  }, fetchImpl, {
    timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    timeoutMessage: `生图模型 ${model} 在 180 秒内没有响应；请检查服务商任务队列后重新运行生图岗位`,
    maxAttempts: 3,
    retryLabel: `生图模型 ${model}`
  });
  const result = Array.isArray(data?.data) ? data.data[0] : data?.result;
  if (result?.b64_json) return { dataUrl: `data:image/png;base64,${result.b64_json}` };
  if (result?.dataUrl && String(result.dataUrl).startsWith("data:image/")) return { dataUrl: result.dataUrl };
  const remoteUrl = validRemoteUrl(result?.url);
  if (!remoteUrl) throw Object.assign(new Error("生图接口调用成功，但没有返回图片"), { statusCode: 502 });
  const { response, attempts } = await fetchProviderResponse(remoteUrl, {}, fetchImpl, { timeoutMs: API_TIMEOUT_MS, maxAttempts: 3, retryLabel: "生成图片下载" });
  if (!response.ok) {
    const repeated = TRANSIENT_PROVIDER_STATUSES.has(response.status) && attempts > 1 ? `，已尝试 ${attempts} 次` : "";
    throw Object.assign(new Error(`生成图片下载失败（${response.status}${repeated}）`), { statusCode: 502 });
  }
  const contentType = (response.headers.get("content-type") || "image/png").split(";")[0];
  if (!contentType.startsWith("image/")) throw Object.assign(new Error("生图接口返回的文件不是图片"), { statusCode: 502 });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REQUEST_BYTES) throw Object.assign(new Error("生成图片超过 32MB，无法保存"), { statusCode: 413 });
  return { dataUrl: `data:${contentType};base64,${bytes.toString("base64")}` };
}

async function invokeVideoModel(input, fetchImpl = fetch) {
  if (String(input?.mode || "") !== "webhook") throw Object.assign(new Error("当前桌面代理只支持通用 Webhook 视频接口"), { statusCode: 400 });
  const target = validRemoteUrl(String(input?.endpoint || "").trim());
  const model = String(input?.model || "").trim();
  const prompt = String(input?.prompt || "").trim();
  if (!target) throw Object.assign(new Error("通用视频 Webhook 需要填写 HTTPS 地址，或本机 localhost 地址"), { statusCode: 400 });
  if (!model || prompt.length < 6) throw Object.assign(new Error("视频模型 ID 和至少 6 个字的创作指令不能为空"), { statusCode: 400 });
  const references = Array.isArray(input?.references) ? input.references.slice(0, 15).map((item) => ({
    name: String(item?.name || "reference").slice(0, 160),
    kind: ["image", "video", "audio"].includes(item?.kind) ? item.kind : "image",
    role: String(item?.role || "reference").slice(0, 40),
    url: String(item?.url || ""),
    weight: Math.max(10, Math.min(100, Number(item?.weight) || 80))
  })) : [];
  const rawVoiceover = input?.voiceover && typeof input.voiceover === "object" ? input.voiceover : {};
  const voiceover = {
    enabled: rawVoiceover.enabled === true,
    language: String(rawVoiceover.language || "普通话").slice(0, 30),
    style: String(rawVoiceover.style || "自然对白").slice(0, 60),
    script: String(rawVoiceover.script || "").slice(0, 500)
  };
  const isAgnes = /(?:^|\.)agnes-ai\.com$/i.test(target.hostname) || /^agnes-video-/i.test(model);
  if (isAgnes) {
    const apiKey = String(input?.apiKey || "").trim();
    if (!apiKey) throw Object.assign(new Error("Agnes video requires an API key"), { statusCode: 400 });
    const createUrl = new URL(target.href);
    if (/(?:^|\.)agnes-ai\.com$/i.test(createUrl.hostname)) {
      // Agnes users may paste the API base, /agnesapi status URL, or the full
      // creation URL. They all belong to the same fixed creation endpoint.
      createUrl.pathname = "/v1/videos";
    } else if (!/\/v1\/videos\/?$/i.test(createUrl.pathname)) {
      createUrl.pathname = `${createUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "")}/v1/videos`.replace(/\/+/g, "/");
    }
    createUrl.search = "";
    const landscape = input?.aspect === "16:9";
    const duration = Math.max(4, Math.min(10, Number(input?.duration) || 5));
    const created = await fetchProviderJson(createUrl, {
      method: "POST",
      headers: providerHeaders("webhook", apiKey, true),
      body: JSON.stringify({
        model: model || "agnes-video-v2.0",
        prompt,
        width: landscape ? 1152 : 768,
        height: landscape ? 768 : 1152,
        num_frames: Math.max(97, Math.min(241, Math.round(duration * 24) + 1)),
        frame_rate: 24
      })
    }, fetchImpl, { timeoutMs: 60000, maxAttempts: 1, retryLabel: "Agnes create video" });
    const videoId = String(created?.video_id || created?.data?.video_id || created?.id || created?.data?.id || "").trim();
    if (!videoId) throw Object.assign(new Error("Agnes response did not include video_id. Use model agnes-video-v2.0"), { statusCode: 502 });
    const currentPollUrl = new URL("/agnesapi", createUrl.origin);
    currentPollUrl.searchParams.set("video_id", videoId);
    const legacyPollUrl = new URL(`/v1/videos/${encodeURIComponent(videoId)}`, createUrl.origin);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await pause(attempt === 0 ? 2500 : 5000);
      let statusData;
      try {
        statusData = await fetchProviderJson(currentPollUrl, { method: "GET", headers: providerHeaders("webhook", apiKey) }, fetchImpl, { timeoutMs: 45000, maxAttempts: 2, retryLabel: "Agnes video status" });
      } catch (error) {
        if (attempt > 1) throw error;
        statusData = await fetchProviderJson(legacyPollUrl, { method: "GET", headers: providerHeaders("webhook", apiKey) }, fetchImpl, { timeoutMs: 45000, maxAttempts: 1, retryLabel: "Agnes legacy video status" });
      }
      const status = String(statusData?.status || statusData?.data?.status || statusData?.state || "").toLowerCase();
      const errorText = statusData?.error?.message || statusData?.error || statusData?.message;
      if (["failed", "error", "cancelled", "canceled"].includes(status)) throw Object.assign(new Error(`Agnes video failed: ${String(errorText || status).slice(0, 260)}`), { statusCode: 502 });
      const candidates = [statusData?.video_url, statusData?.videoUrl, statusData?.url, statusData?.output?.video_url, statusData?.output?.url, statusData?.data?.video_url, statusData?.data?.videoUrl, statusData?.data?.url, statusData?.remixed_from_video_id];
      const videoUrl = candidates.find((value) => typeof value === "string" && /^(?:https?:\/\/|data:video\/)/i.test(value.trim()));
      if (videoUrl) {
        const resolvedVideoUrl = String(videoUrl).trim();
        if (resolvedVideoUrl.startsWith("data:video/")) return { dataUrl: resolvedVideoUrl };

        // Download inside the desktop runtime. Fetching an Agnes signed URL in
        // the renderer is blocked by CORS and surfaces only as "Failed to fetch".
        const { response: mediaResponse, attempts } = await fetchProviderResponse(resolvedVideoUrl, {
          method: "GET",
          headers: providerHeaders("webhook", apiKey)
        }, fetchImpl, {
          timeoutMs: 180000,
          maxAttempts: 3,
          retryLabel: "Agnes video download",
          timeoutMessage: "Agnes 视频已生成，但下载在 180 秒内没有完成；请重新运行，漫镜会继续尝试读取成片"
        });
        if (!mediaResponse.ok) {
          const repeated = attempts > 1 ? `，已尝试 ${attempts} 次` : "";
          throw Object.assign(new Error(`Agnes 视频已生成，但下载失败（${mediaResponse.status}${repeated}）`), { statusCode: 502 });
        }
        const mediaType = (mediaResponse.headers.get("content-type") || "video/mp4").split(";")[0].trim().toLowerCase();
        if (!mediaType.startsWith("video/") && mediaType !== "application/octet-stream") {
          throw Object.assign(new Error(`Agnes 返回的成片类型不正确（${mediaType || "unknown"}）`), { statusCode: 502 });
        }
        const mediaBytes = Buffer.from(await mediaResponse.arrayBuffer());
        if (!mediaBytes.byteLength) throw Object.assign(new Error("Agnes 返回了空的视频文件"), { statusCode: 502 });
        if (mediaBytes.byteLength > 256 * 1024 * 1024) throw Object.assign(new Error("Agnes 成片超过 256MB，暂时无法载入工作台"), { statusCode: 413 });
        const safeMediaType = mediaType.startsWith("video/") ? mediaType : "video/mp4";
        return { dataUrl: `data:${safeMediaType};base64,${mediaBytes.toString("base64")}`, videoUrl: resolvedVideoUrl };
      }
      if (["completed", "complete", "succeeded", "success", "done"].includes(status)) throw Object.assign(new Error("Agnes completed without a playable video URL"), { statusCode: 502 });
    }
    throw Object.assign(new Error(`Agnes video is still processing. Task: ${videoId}`), { statusCode: 504 });
  }
  const { response } = await fetchProviderResponse(target, {
    method: "POST",
    headers: providerHeaders("webhook", String(input?.apiKey || "").trim(), true),
    body: JSON.stringify({
      task: "generate_video",
      role: "video",
      model,
      prompt,
      negativePrompt: String(input?.negativePrompt || "").slice(0, 1200),
      aspect: input?.aspect === "16:9" ? "16:9" : "9:16",
      duration: Math.max(4, Math.min(15, Number(input?.duration) || 8)),
      resolution: ["480p", "720p", "1080p"].includes(input?.resolution) ? input.resolution : "720p",
      references,
      voiceover
    })
  }, fetchImpl, {
    timeoutMs: 300000,
    timeoutMessage: `视频模型 ${model} 在 5 分钟内没有返回；如接口采用异步任务，请让 Webhook 立即返回 videoUrl 或 dataUrl`,
    maxAttempts: 2,
    retryLabel: `视频模型 ${model}`
  });
  const contentType = (response.headers.get("content-type") || "").split(";")[0];
  if (response.ok && contentType.startsWith("video/")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 256 * 1024 * 1024) throw Object.assign(new Error("生成视频超过 256MB，请让 Webhook 返回可下载的 videoUrl"), { statusCode: 413 });
    return { dataUrl: `data:${contentType};base64,${bytes.toString("base64")}` };
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || text || `HTTP ${response.status}`;
    throw Object.assign(new Error(`视频接口返回 ${response.status}：${String(detail).slice(0, 300)}`), { statusCode: 502 });
  }
  const resultUrl = String(pickFirstVideoUrl(data));
  if (resultUrl.startsWith("data:video/") || resultUrl.startsWith("data:application/octet-stream")) return { dataUrl: resultUrl };
  const remoteUrl = validRemoteUrl(resultUrl);
  if (remoteUrl) return { videoUrl: remoteUrl.href };
  throw Object.assign(new Error("Webhook 调用成功，但没有返回视频文件、dataUrl 或可信的 videoUrl"), { statusCode: 502 });
}

function seedanceErrorMessage(data, fallback = "Seedance 方舟接口暂时不可用") {
  return String(data?.error?.message || data?.error || data?.message || data?.detail || fallback).slice(0, 300);
}

function seedanceReferenceUrl(value) {
  const raw = String(value || "").trim();
  return /^(?:https:\/\/|data:(?:image|video|audio)\/|asset:\/\/)/i.test(raw) ? raw : "";
}

function validSeedanceMediaUrl(value) {
  try {
    const target = new URL(String(value || ""));
    const host = target.hostname.toLowerCase();
    const trusted = host === "volces.com" || host.endsWith(".volces.com") || host === "volcengine.com" || host.endsWith(".volcengine.com");
    return target.protocol === "https:" && trusted && !target.username && !target.password ? target : null;
  } catch {
    return null;
  }
}

async function seedanceProviderJson(url, init, action, fetchImpl = fetch) {
  let response;
  try {
    ({ response } = await fetchProviderResponse(url, init, fetchImpl, {
      timeoutMs: 45000,
      maxAttempts: action === "status" ? 3 : 1,
      retryLabel: action === "status" ? "Seedance 任务查询" : "Seedance 创建请求",
      timeoutMessage: action === "status" ? "Seedance 任务查询等待超过 45 秒" : "Seedance 创建请求等待超过 45 秒"
    }));
  } catch (error) {
    if (action === "create") {
      throw Object.assign(new Error("Seedance 创建请求网络连接被中断；为避免重复创建和扣费，漫镜没有自动重复提交。请先在火山方舟控制台确认是否已产生任务，再重新运行视频 AI"), { statusCode: 502, retryable: false });
    }
    throw Object.assign(new Error(`Seedance 任务查询连接失败：${String(error?.message || "网络连接被中断").slice(0, 220)}`), { statusCode: 503, retryable: true });
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    throw Object.assign(new Error(`Seedance 方舟接口返回 ${response.status}：${seedanceErrorMessage(data)}`), {
      statusCode: TRANSIENT_PROVIDER_STATUSES.has(response.status) ? 503 : 502,
      providerStatus: response.status,
      retryable: TRANSIENT_PROVIDER_STATUSES.has(response.status)
    });
  }
  return data;
}

async function invokeSeedance(input, fetchImpl = fetch) {
  const apiKey = String(input?.apiKey || "").trim();
  if (apiKey.length < 8 || apiKey.length > 500) throw Object.assign(new Error("请填写有效的火山方舟 API Key"), { statusCode: 400, retryable: false });
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  if (input?.action === "create") {
    const prompt = String(input?.prompt || "").trim().slice(0, 1800);
    const negativePrompt = String(input?.negativePrompt || "").trim().slice(0, 800);
    const model = String(input?.model || "doubao-seedance-1-5-pro-251215").trim();
    if (prompt.length < 8) throw Object.assign(new Error("视频提示词至少需要 8 个字"), { statusCode: 400, retryable: false });
    if (!SEEDANCE_MODEL_PATTERN.test(model)) throw Object.assign(new Error("Seedance 模型 ID 或 Endpoint ID 格式不正确"), { statusCode: 400, retryable: false });
    const ratio = input?.ratio === "16:9" ? "16:9" : "9:16";
    const isOmniModel = /seedance-2/i.test(model);
    const duration = isOmniModel ? Math.max(4, Math.min(15, Math.round(Number(input?.duration) || 8))) : Number(input?.duration) >= 8 ? 10 : 5;
    const resolution = ["480p", "720p", "1080p"].includes(String(input?.resolution)) ? String(input.resolution) : "720p";
    const rawVoiceover = input?.voiceover && typeof input.voiceover === "object" ? input.voiceover : {};
    const voiceEnabled = rawVoiceover.enabled === true;
    const voiceInstruction = voiceEnabled
      ? `\n生成原生音轨；配音语言：${String(rawVoiceover.language || "普通话").slice(0, 30)}；人声风格：${String(rawVoiceover.style || "自然对白").slice(0, 60)}；${rawVoiceover.script ? `准确台词：${String(rawVoiceover.script).slice(0, 500)}` : "根据画面生成一句简短自然的对白或旁白"}；人物口型与声音同步。`
      : "\n输出静音视频，不生成对白、旁白、音乐或环境音。";
    const content = [{ type: "text", text: `${prompt}${voiceInstruction}${negativePrompt ? `\n避免：${negativePrompt}` : ""}` }];
    const rawReferences = Array.isArray(input?.references) ? input.references : [];
    const counts = { image: 0, video: 0, audio: 0 };
    const acceptedReferences = [];
    if (isOmniModel) {
      for (const reference of rawReferences) {
        const kind = ["image", "video", "audio"].includes(String(reference?.kind)) ? String(reference.kind) : "image";
        const limit = kind === "image" ? 9 : 3;
        const url = seedanceReferenceUrl(reference?.url);
        if (!url || counts[kind] >= limit) continue;
        counts[kind] += 1;
        const requestedRole = String(reference?.role || "");
        const role = kind === "image"
          ? requestedRole === "first_frame" ? "first_frame" : requestedRole === "last_frame" ? "last_frame" : "reference_image"
          : kind === "video" ? "reference_video" : "reference_audio";
        content.push({ type: `${kind}_url`, [`${kind}_url`]: { url }, role });
        acceptedReferences.push({ kind, role, name: String(reference?.name || `${kind}-${counts[kind]}`).slice(0, 120) });
      }
    } else {
      const imageUrl = seedanceReferenceUrl(input?.imageUrl) || seedanceReferenceUrl(rawReferences.find((item) => item?.kind === "image")?.url);
      if (imageUrl) {
        content.push({ type: "image_url", image_url: { url: imageUrl }, role: "first_frame" });
        acceptedReferences.push({ kind: "image", role: "first_frame", name: "首帧" });
      }
    }
    const requestId = String(input?.requestId || "").trim();
    const cached = /^[a-z0-9-]{8,80}$/i.test(requestId) ? SEEDANCE_CREATE_CACHE.get(requestId) : null;
    if (cached && cached.expiresAt > Date.now()) return cached.payload;
    const payload = await seedanceProviderJson(SEEDANCE_ARK_API, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, content, resolution, ratio, duration, watermark: false, return_last_frame: true, generate_audio: voiceEnabled })
    }, "create", fetchImpl);
    if (!payload?.id) throw Object.assign(new Error(`Seedance 没有返回任务编号：${seedanceErrorMessage(payload)}`), { statusCode: 502, retryable: false });
    const result = { id: String(payload.id), status: "queued", acceptedReferences, ignoredReferences: Math.max(0, rawReferences.length - acceptedReferences.length) };
    if (/^[a-z0-9-]{8,80}$/i.test(requestId)) {
      SEEDANCE_CREATE_CACHE.set(requestId, { expiresAt: Date.now() + 30 * 60 * 1000, payload: result });
      if (SEEDANCE_CREATE_CACHE.size > 80) for (const [key, value] of SEEDANCE_CREATE_CACHE) if (value.expiresAt <= Date.now()) SEEDANCE_CREATE_CACHE.delete(key);
    }
    return result;
  }

  if (input?.action === "status") {
    const id = String(input?.id || "").trim();
    if (!SEEDANCE_TASK_PATTERN.test(id)) throw Object.assign(new Error("Seedance 任务编号无效"), { statusCode: 400, retryable: false });
    const payload = await seedanceProviderJson(`${SEEDANCE_ARK_API}/${encodeURIComponent(id)}`, { headers }, "status", fetchImpl);
    if (payload?.status === "failed" || payload?.status === "cancelled") {
      throw Object.assign(new Error(seedanceErrorMessage(payload, `Seedance 任务${payload.status}`)), { statusCode: 502, done: true, retryable: false });
    }
    return {
      done: payload?.status === "succeeded",
      status: String(payload?.status || "queued"),
      videoUrl: String(payload?.content?.video_url || ""),
      lastFrameUrl: String(payload?.content?.last_frame_url || "")
    };
  }

  throw Object.assign(new Error("不支持的 Seedance 操作"), { statusCode: 400, retryable: false });
}

async function downloadSeedanceMedia(value, fetchImpl = fetch) {
  const target = validSeedanceMediaUrl(value);
  if (!target) throw Object.assign(new Error("Seedance 视频地址无效或来源不受信任"), { statusCode: 403, retryable: false });
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetchImpl(target, { redirect: "follow", signal: controller.signal });
      if (!response.ok) {
        if (!TRANSIENT_PROVIDER_STATUSES.has(response.status)) throw Object.assign(new Error(`Seedance 视频下载返回 ${response.status}`), { statusCode: 502, retryable: false });
        throw new Error(`Seedance 视频下载暂时返回 ${response.status}`);
      }
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > 256 * 1024 * 1024) throw Object.assign(new Error("Seedance 视频超过 256MB，无法导入漫镜"), { statusCode: 413, retryable: false });
      const contentType = (response.headers.get("content-type") || "video/mp4").split(";")[0];
      if (!contentType.startsWith("video/")) throw Object.assign(new Error("Seedance 返回的文件不是视频"), { statusCode: 502, retryable: false });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > 256 * 1024 * 1024) throw Object.assign(new Error("Seedance 视频超过 256MB，无法导入漫镜"), { statusCode: 413, retryable: false });
      return { bytes, contentType };
    } catch (error) {
      if (error?.retryable === false || [403, 413].includes(Number(error?.statusCode))) throw error;
      lastError = error;
      if (attempt === 3) break;
      await pause(attempt === 1 ? 1200 : 3000);
    } finally {
      clearTimeout(timer);
    }
  }
  const detail = lastError?.name === "AbortError" ? "单次连接等待超过 120 秒" : String(lastError?.message || "网络连接被中断").slice(0, 180);
  throw Object.assign(new Error(`Seedance 视频下载连续 3 次失败：${detail}。任务编号仍已保留，请稍后重新运行视频 AI 继续下载`), { statusCode: 503, retryable: true });
}

function settingsFile(dataRoot) {
  return dataRoot ? path.join(dataRoot, "manjing-settings.json") : "";
}

let settingsWriteQueue = Promise.resolve();

function localFileDeadline(promise, message, timeoutMs = 4000) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { statusCode: 503, retryable: true })), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function readDesktopSettings(dataRoot) {
  const filePath = settingsFile(dataRoot);
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const raw = await localFileDeadline(fs.promises.readFile(filePath, "utf8"), "读取本机设置超过 4 秒");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDesktopSettings(dataRoot, value) {
  const filePath = settingsFile(dataRoot);
  if (!filePath) throw Object.assign(new Error("独立版设置目录不可用"), { statusCode: 500 });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("设置内容格式无效"), { statusCode: 400 });
  const save = async () => {
    await localFileDeadline(fs.promises.mkdir(dataRoot, { recursive: true }), "创建本机设置目录超过 4 秒");
    const current = await readDesktopSettings(dataRoot);
    const merged = { ...current, ...value };
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(merged, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > 2 * 1024 * 1024) throw Object.assign(new Error("本机设置异常过大，已拒绝写入以避免界面卡死"), { statusCode: 413, retryable: false });
    await localFileDeadline(fs.promises.writeFile(temporary, serialized, "utf8"), "写入本机设置超过 4 秒");
    await localFileDeadline(fs.promises.rename(temporary, filePath), "应用本机设置超过 4 秒");
    return { saved: true, savedAt: new Date().toISOString() };
  };
  const pending = settingsWriteQueue.then(save, save);
  settingsWriteQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function desktopApiResponse(request, url, dataRoot) {
  try {
    if (url.pathname === "/api/desktop/settings" && request.method === "GET") return jsonResponse(await readDesktopSettings(dataRoot));
    if (url.pathname === "/api/desktop/volcengine-sdk" && request.method === "GET") return jsonResponse(volcengineSdkStatus());
    if (url.pathname === "/api/desktop/seedance" && request.method === "GET") {
      const media = await downloadSeedanceMedia(url.searchParams.get("url"));
      return new Response(media.bytes, {
        headers: {
          "Cache-Control": "private, max-age=1800",
          "Content-Length": String(media.bytes.byteLength),
          "Content-Type": media.contentType,
          "X-Manjing-Desktop": "direct"
        }
      });
    }
    if (request.method !== "POST") return jsonResponse({ error: "只支持 GET 或 POST 请求" }, 405);
    const input = await readJsonRequest(request);
    if (url.pathname === "/api/desktop/models") return jsonResponse(await discoverRemoteModels(input));
    if (url.pathname === "/api/desktop/invoke") return jsonResponse(await invokeTextModel(input));
    if (url.pathname === "/api/desktop/image") return jsonResponse(await invokeImageModel(input));
    if (url.pathname === "/api/desktop/video") return jsonResponse(await invokeVideoModel(input));
    if (url.pathname === "/api/desktop/seedance") return jsonResponse(await invokeSeedance(input), input?.action === "create" ? 202 : 200);
    if (url.pathname === "/api/desktop/settings") return jsonResponse(await writeDesktopSettings(dataRoot, input));
    return null;
  } catch (error) {
    return jsonResponse({ error: String(error?.message || "自定义 API 调用失败"), retryable: error?.retryable !== false, done: error?.done === true }, Number(error?.statusCode) || 500);
  }
}

async function staticResponse(request, clientRoot, url) {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const filePath = resolveStaticFile(clientRoot, url.pathname);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return null;

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, stat.size) : null;
  if (rangeHeader && !range) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    "Content-Length": String(Math.max(0, end - start + 1)),
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Last-Modified": stat.mtime.toUTCString(),
    "X-Manjing-Desktop": "direct"
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  const body = request.method === "HEAD" ? null : (await fs.promises.readFile(filePath)).subarray(start, end + 1);
  return new Response(body, { status: range ? 206 : 200, headers });
}

async function toWorkerRequest(request, url) {
  const workerUrl = new URL(`${url.pathname}${url.search}`, "http://manjing.localhost");
  const init = { method: request.method, headers: request.headers };
  if (!["GET", "HEAD"].includes(request.method)) {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BYTES) throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    if (body.byteLength) init.body = body;
  }
  return new Request(workerUrl, init);
}

function localError(error) {
  const status = Number(error?.statusCode) || 500;
  const message = status === 413 ? "请求内容过大" : "漫镜内置应用暂时无法打开";
  const detail = String(error?.message || "未知错误").replace(/[<>&\"']/g, "");
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>漫镜</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f2ed;color:#2b2530;font-family:"Microsoft YaHei UI",sans-serif}.card{width:min(520px,80vw);padding:42px;border:1px solid #ddd3e0;border-radius:22px;background:#fff;box-shadow:0 24px 70px #3a28401f;text-align:center}h1{font-size:24px}p{color:#766c79;line-height:1.8}button{border:0;border-radius:10px;padding:11px 18px;background:#6f4b91;color:#fff;cursor:pointer}</style><main class="card"><h1>${message}</h1><p>这是安装包内置应用，不会连接漫镜网页。请重新打开软件；如果仍失败，请重新安装最新版。</p><p>${detail}</p><button onclick="location.reload()">重新加载</button></main></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Manjing-Desktop": "direct" }
  });
}

async function createDesktopRuntime(options = {}) {
  const appRoot = findAppRoot();
  const clientRoot = path.join(appRoot, "client");
  const dataRoot = String(options.dataRoot || "");
  const workerModule = await import(pathToFileURL(path.join(appRoot, "server", "index.js")).href);
  const worker = workerModule.default;
  if (!worker || typeof worker.fetch !== "function") throw new Error("漫镜内置应用入口无效，请重新安装。");

  return {
    async handle(request) {
      try {
        const url = new URL(request.url);
        if (url.protocol !== "manjing:" || url.hostname !== "app") return new Response("Not found", { status: 404 });
        if (url.pathname.startsWith("/api/desktop/")) {
          const desktopApi = await desktopApiResponse(request, url, dataRoot);
          if (desktopApi) return desktopApi;
        }
        const asset = await staticResponse(request, clientRoot, url);
        if (asset) return asset;
        const webRequest = await toWorkerRequest(request, url);
        const response = await worker.fetch(webRequest, process.env, {
          passThroughOnException() {},
          waitUntil() {}
        });
        const headers = new Headers(response.headers);
        headers.set("X-Manjing-Desktop", "direct");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        return localError(error);
      }
    }
  };
}

module.exports = { createDesktopRuntime, discoverRemoteModels, invokeTextModel, invokeImageModel, invokeVideoModel, invokeSeedance, downloadSeedanceMedia, volcengineSdkStatus, modelsFromPayload, readDesktopSettings, writeDesktopSettings };
