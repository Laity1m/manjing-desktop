/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { invokeEnterpriseAsset } = require("./enterprise-assets");

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const API_TIMEOUT_MS = 30000;
const TEXT_ROLE_TIMEOUT_MS = {
  producer: 300000,
  writer: 420000,
  director: 420000,
  character: 300000,
  scene: 300000,
  storyboard: 420000,
  prompt: 180000,
  image: 300000,
  video: 300000,
  voice: 300000,
  editor: 300000,
};
const TEXT_TASK_TIMEOUT_MS = {
  storyboard: 600000,
  review_storyboard: 420000,
  compile_video_prompt: 180000,
};
const IMAGE_GENERATION_TIMEOUT_MS = 180000;
const TRANSIENT_PROVIDER_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const SEEDANCE_ARK_API = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const SEEDANCE_TASK_PATTERN = /^cgt-[a-z0-9-]{8,100}$/i;
const SEEDANCE_MODEL_PATTERN = /^(?:doubao-seedance-[a-z0-9-]+|ep-[a-z0-9-]+)$/i;
const SEEDANCE_CREATE_CACHE = new Map();
const SEEDANCE_CREATE_INFLIGHT = new Map();
const TEXT_PROTOCOL_CACHE = new Map();
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
  const responsesOutputText = data?.output_text;
  if (typeof responsesOutputText === "string" && responsesOutputText.trim()) return responsesOutputText;
  if (Array.isArray(data?.output)) {
    const text = data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map((item) => item?.text || item?.output_text || "").join("").trim();
    if (text) return text;
  }
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
  const images = Array.isArray(input?.images) ? input.images.slice(0, 8).map((item) => ({ url: String(item?.url || ""), label: String(item?.label || "reference").slice(0, 100) })).filter((item) => /^(?:https:\/\/|data:image\/)/i.test(item.url)) : [];
  if (!model || !prompt) throw Object.assign(new Error("模型 ID 和任务内容不能为空"), { statusCode: 400 });
  const base = cleanApiBase(mode, input?.endpoint);
  const apiKey = String(input?.apiKey || "").trim();
  let target;
  let body;
  let protocolCandidates = [];
  if (mode === "openai" || mode === "pollinations") {
    const userContent = images.length ? [{ type: "text", text: prompt }, ...images.map((item) => ({ type: "image_url", image_url: { url: item.url, detail: "low" }, name: item.label }))] : prompt;
    const chatTarget = appendApiPath(base, "chat/completions");
    const chatBody = { model, messages: [{ role: "system", content: system }, { role: "user", content: userContent }] };
    if (mode === "openai") {
      const responsesTarget = appendApiPath(base, "responses");
      const responsesBody = images.length
        ? { model, instructions: system, input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...images.map((item) => ({ type: "input_image", image_url: item.url, detail: "low" }))] }] }
        : { model, instructions: system, input: prompt };
      const rawEndpoint = validRemoteUrl(String(input?.endpoint || "").trim());
      const exactPath = rawEndpoint && /\/(?:chat\/completions|responses)\/?$/i.test(rawEndpoint.pathname) ? rawEndpoint : null;
      const versionedBase = new URL(base.href);
      if (!/\/v\d+(?:beta)?\/?$/i.test(versionedBase.pathname)) versionedBase.pathname = `${versionedBase.pathname.replace(/\/+$/, "")}/v1`;
      const candidates = [
        exactPath && { target: exactPath, body: /\/responses\/?$/i.test(exactPath.pathname) ? responsesBody : chatBody },
        { target: chatTarget, body: chatBody },
        { target: responsesTarget, body: responsesBody },
        { target: appendApiPath(versionedBase, "chat/completions"), body: chatBody },
        { target: appendApiPath(versionedBase, "responses"), body: responsesBody }
      ].filter(Boolean);
      const unique = new Map(candidates.map((candidate) => [candidate.target.href, candidate]));
      const cacheKey = `${String(input?.endpoint || "")}|${model}`;
      const cached = TEXT_PROTOCOL_CACHE.get(cacheKey);
      protocolCandidates = [...unique.values()].sort((a, b) => Number(b.target.href === cached) - Number(a.target.href === cached));
      target = protocolCandidates[0].target;
      body = protocolCandidates[0].body;
    } else {
      target = chatTarget;
      body = chatBody;
    }
  } else if (mode === "anthropic") {
    target = appendApiPath(base, "messages");
    body = { model, max_tokens: 4096, system, messages: [{ role: "user", content: prompt }] };
  } else if (mode === "gemini") {
    target = appendApiPath(base, `models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`);
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] };
  } else {
    target = validRemoteUrl(String(input?.endpoint || "").trim());
    if (!target) throw Object.assign(new Error("通用 Webhook 需要填写有效接口地址"), { statusCode: 400 });
    body = { role: input?.role, model, task: input?.task, system, prompt, images, ...(input?.payload || {}) };
  }
  const timeoutMs = TEXT_TASK_TIMEOUT_MS[String(input?.task || "")] || TEXT_ROLE_TIMEOUT_MS[role] || 300000;
  const roleLabel = {
    producer: "总制片 AI",
    writer: "编剧 AI",
    director: "导演 AI",
    character: "角色 AI",
    scene: "场景 AI",
    storyboard: "分镜 AI",
    prompt: "镜头总控 AI",
    image: "生图 AI",
    video: "视频 AI",
    voice: "配音 AI",
    editor: "剪辑 AI",
  }[role] || "文本 AI";
  const requestOptions = {
    timeoutMs,
    timeoutMessage: `${roleLabel} 模型 ${model} 在 ${Math.round(timeoutMs / 1000)} 秒内没有响应；已保留现有成果，请检查地址、网络或服务商队列后重新运行该岗位`,
    maxAttempts: 2,
    retryLabel: roleLabel
  };
  let data;
  if (mode === "openai" && protocolCandidates.length) {
    let lastError;
    let transientProtocolFallbacks = 0;
    for (const candidate of protocolCandidates) {
      try {
        data = await fetchProviderJson(candidate.target, { method: "POST", headers: providerHeaders(mode, apiKey, true), body: JSON.stringify(candidate.body) }, fetchImpl, requestOptions);
        TEXT_PROTOCOL_CACHE.set(`${String(input?.endpoint || "")}|${model}`, candidate.target.href);
        break;
      } catch (error) {
        lastError = error;
        const providerStatus = Number(error?.providerStatus);
        if ([404, 405].includes(providerStatus)) continue;
        // OpenAI-compatible relays sometimes expose both Responses and Chat
        // Completions while only one route is temporarily healthy. Retry the
        // current route, then try one alternate protocol before surfacing the
        // error; this makes the UI rerun action materially different from a
        // single repeat of the same failed request without causing an endless
        // or high-cost retry loop.
        if (TRANSIENT_PROVIDER_STATUSES.has(providerStatus) && transientProtocolFallbacks < 1) {
          transientProtocolFallbacks += 1;
          continue;
        }
        throw error;
      }
    }
    if (!data) throw Object.assign(new Error(`镜头总控接口没有可用的 OpenAI 生成路径。已尝试：${protocolCandidates.map((candidate) => candidate.target.pathname).join("、")}。请确认服务商的完整生成接口地址`), { statusCode: 502, providerStatus: lastError?.providerStatus });
  } else {
    data = await fetchProviderJson(target, { method: "POST", headers: providerHeaders(mode, apiKey, true), body: JSON.stringify(body) }, fetchImpl, requestOptions);
  }
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
  const references = Array.isArray(input?.references) ? input.references.map(String).filter(Boolean).slice(0, 6) : [];
  const size = input?.aspect === "16:9" ? "1536x1024" : "1024x1536";
  const target = appendApiPath(base, references.length ? "images/edits" : "images/generations");
  let request;
  if (references.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", size);
    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index];
      let bytes;
      let contentType = "image/png";
      if (/^data:image\//i.test(reference)) {
        const match = reference.match(/^data:([^;,]+);base64,(.+)$/i);
        if (!match) throw Object.assign(new Error(`第 ${index + 1} 张人物参考图格式无效`), { statusCode: 400 });
        contentType = match[1];
        bytes = Buffer.from(match[2], "base64");
      } else {
        const { response } = await fetchProviderResponse(reference, {}, fetchImpl, { timeoutMs: API_TIMEOUT_MS, maxAttempts: 3, retryLabel: `人物参考图 ${index + 1}` });
        if (!response.ok) throw Object.assign(new Error(`第 ${index + 1} 张人物参考图读取失败（${response.status}）`), { statusCode: 502 });
        contentType = (response.headers.get("content-type") || "image/png").split(";")[0];
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (!contentType.startsWith("image/") || !bytes?.byteLength) throw Object.assign(new Error(`第 ${index + 1} 张参考素材不是有效图片`), { statusCode: 400 });
      form.append("image[]", new Blob([bytes], { type: contentType }), `reference-${index + 1}.${contentType.includes("jpeg") ? "jpg" : "png"}`);
    }
    request = { method: "POST", headers: providerHeaders(mode, String(input?.apiKey || "").trim(), false), body: form };
  } else {
    request = { method: "POST", headers: providerHeaders(mode, String(input?.apiKey || "").trim(), true), body: JSON.stringify({ model, prompt, n: 1, size }) };
  }
  const data = await fetchProviderJson(target, request, fetchImpl, {
    timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    timeoutMessage: `生图模型 ${model} 在 180 秒内没有响应；请检查服务商任务队列后重新运行生图岗位`,
    maxAttempts: 1,
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

function parseMcpPayload(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    const messages = text.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(messages[index].slice(5).trim()); } catch {}
    }
  }
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error("MCP 返回了无法解析的数据"), { statusCode: 502 }); }
}

async function mcpRequest(endpoint, apiKey, payload, sessionId = "", fetchImpl = fetch) {
  const headers = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: /^Bearer\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}` } : {}),
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
  };
  const { response } = await fetchProviderResponse(endpoint, { method: "POST", headers, body: JSON.stringify(payload) }, fetchImpl, { timeoutMs: 90000, maxAttempts: 2, retryLabel: "MCP" });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`MCP 返回 ${response.status}：${text.slice(0, 300)}`), { statusCode: 502 });
  return { data: parseMcpPayload(text, response.headers.get("content-type") || ""), sessionId: response.headers.get("mcp-session-id") || sessionId };
}

function mcpResults(result) {
  const content = result?.content || result?.structuredContent || result;
  if (Array.isArray(content)) return content.map((item) => {
    if (item?.type === "text" && typeof item.text === "string") {
      try { return JSON.parse(item.text); } catch { return { text: item.text }; }
    }
    return item;
  }).flatMap((item) => Array.isArray(item) ? item : [item]);
  return Array.isArray(content?.results) ? content.results : [content];
}

async function invokeMcp(input, fetchImpl = fetch) {
  const endpoint = validRemoteUrl(String(input?.endpoint || "").trim());
  if (!endpoint) throw Object.assign(new Error("MCP 需要填写 HTTPS 地址或本机 localhost 地址"), { statusCode: 400 });
  const apiKey = String(input?.apiKey || "").trim();
  let sessionId = "";
  const initialized = await mcpRequest(endpoint, apiKey, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "manjing-desktop", version: "1.4.5" } } }, sessionId, fetchImpl);
  sessionId = initialized.sessionId;
  try { await mcpRequest(endpoint, apiKey, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, fetchImpl); } catch {}
  const listed = await mcpRequest(endpoint, apiKey, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId, fetchImpl);
  const tools = Array.isArray(listed.data?.result?.tools) ? listed.data.result.tools : [];
  if (input?.action === "tools") return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description || "", inputSchema: tool.inputSchema || {} })) };
  const requested = String(input?.tool || "");
  const selected = tools.find((item) => item.name === requested) || tools.find((item) => /search|query|find|discover/i.test(`${item.name} ${item.description || ""}`)) || tools[0];
  if (!selected) throw Object.assign(new Error("该 MCP 没有提供可调用工具"), { statusCode: 502 });
  const properties = selected.inputSchema?.properties || {};
  const queryKey = ["query", "q", "keyword", "keywords", "search", "prompt", "text"].find((key) => Object.prototype.hasOwnProperty.call(properties, key)) || "query";
  const args = { [queryKey]: String(input?.query || "").slice(0, 1000) };
  const called = await mcpRequest(endpoint, apiKey, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: selected.name, arguments: args } }, sessionId, fetchImpl);
  if (called.data?.error) throw Object.assign(new Error(String(called.data.error.message || "MCP 工具调用失败")), { statusCode: 502 });
  return { tool: selected.name, results: mcpResults(called.data?.result) };
}

const generatedVideoCache = new Map();
const recentAgnesVideoHashes = new Map();

async function rememberAgnesVideoHash(digest) {
  const historyFile = path.join(process.env.TEMP || process.env.TMP || process.cwd(), "manjing-agnes-video-hashes.json");
  const now = Date.now();
  let persisted = {};
  try { persisted = JSON.parse(await fs.promises.readFile(historyFile, "utf8")); } catch { persisted = {}; }
  for (const [hash, createdAt] of Object.entries(persisted)) {
    if (now - Number(createdAt) < 24 * 60 * 60 * 1000) recentAgnesVideoHashes.set(hash, Number(createdAt));
  }
  const duplicate = recentAgnesVideoHashes.has(digest);
  recentAgnesVideoHashes.set(digest, now);
  const compact = Object.fromEntries([...recentAgnesVideoHashes.entries()].filter(([, createdAt]) => now - createdAt < 24 * 60 * 60 * 1000).slice(-40));
  await fs.promises.writeFile(historyFile, JSON.stringify(compact), "utf8").catch(() => {});
  return duplicate;
}

async function cacheGeneratedVideo(bytes, contentType) {
  const now = Date.now();
  const cacheRoot = path.join(process.env.TEMP || process.env.TMP || process.cwd(), "manjing-video-cache");
  await fs.promises.mkdir(cacheRoot, { recursive: true });
  for (const [id, item] of generatedVideoCache) {
    if (now - item.createdAt < 2 * 60 * 60 * 1000 && generatedVideoCache.size < 12) continue;
    generatedVideoCache.delete(id);
    fs.promises.unlink(item.filePath).catch(() => {});
  }
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const filePath = path.join(cacheRoot, `${id}.mp4`);
  await fs.promises.writeFile(filePath, bytes);
  generatedVideoCache.set(id, { filePath, contentType, createdAt: now });
  return `/api/desktop/video?cacheId=${encodeURIComponent(id)}`;
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
    const duration = Math.max(4, Math.min(15, Number(input?.duration) || 5));
    const agnesSeed = Number.isInteger(input?._agnesSeed) ? input._agnesSeed : Math.floor(Math.random() * 2147483646) + 1;
    const publicImage = references.find((item) => item.kind === "image" && /^https:\/\//i.test(item.url))?.url || "";
    const cameraVariants = ["slow lateral tracking with a gentle push-in", "low-angle arc movement with layered parallax", "handheld follow movement with a deliberate final hold", "wide establishing move transitioning into a close emotional frame"];
    const motionVariants = ["begin still, accelerate through the main action, then settle", "use asymmetric subject movement and visible environmental response", "stage the action from foreground to background with natural secondary motion", "build motion in two distinct beats without repeating gestures"];
    const variedPrompt = `${prompt}\nCamera execution: ${cameraVariants[agnesSeed % cameraVariants.length]}. Motion execution: ${motionVariants[Math.floor(agnesSeed / 7) % motionVariants.length]}. Create a genuinely new take with a different motion path and timing; do not reuse a prior rendered clip. Variation ${agnesSeed}.`;
    const agnesPayload = {
      model: model || "agnes-video-v2.0",
      prompt: variedPrompt,
      width: landscape ? 1152 : 768,
      height: landscape ? 768 : 1152,
      num_frames: Math.max(97, Math.min(361, Math.round(duration * 3) * 8 + 1)),
      frame_rate: 24,
      seed: agnesSeed,
      negative_prompt: String(input?.negativePrompt || "duplicate motion, frozen frame, repeated action, text, watermark").slice(0, 1200),
      ...(publicImage ? { image: publicImage, mode: "ti2vid" } : {})
    };
    const created = await fetchProviderJson(createUrl, {
      method: "POST",
      headers: providerHeaders("webhook", apiKey, true),
      body: JSON.stringify(agnesPayload)
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
        statusData = await fetchProviderJson(currentPollUrl, { method: "GET", headers: providerHeaders("webhook", apiKey) }, fetchImpl, { timeoutMs: action === "create" ? 180000 : 45000, maxAttempts: 2, retryLabel: "Agnes video status" });
      } catch (error) {
        if (attempt > 1) throw error;
        statusData = await fetchProviderJson(legacyPollUrl, { method: "GET", headers: providerHeaders("webhook", apiKey) }, fetchImpl, { timeoutMs: action === "create" ? 180000 : 45000, maxAttempts: 1, retryLabel: "Agnes legacy video status" });
      }
      const status = String(statusData?.status || statusData?.data?.status || statusData?.state || "").toLowerCase();
      const errorText = statusData?.error?.message || statusData?.error || statusData?.message;
      if (["failed", "error", "cancelled", "canceled"].includes(status)) throw Object.assign(new Error(`Agnes video failed: ${String(errorText || status).slice(0, 260)}`), { statusCode: 502 });
      const candidates = [statusData?.metadata?.url, statusData?.video_url, statusData?.videoUrl, statusData?.url, statusData?.output?.video_url, statusData?.output?.url, statusData?.data?.metadata?.url, statusData?.data?.video_url, statusData?.data?.videoUrl, statusData?.data?.url];
      const videoUrl = candidates.find((value) => typeof value === "string" && /^(?:https?:\/\/|data:video\/)/i.test(value.trim()));
      if (videoUrl) {
        const resolvedVideoUrl = String(videoUrl).trim();
        if (resolvedVideoUrl.startsWith("data:video/")) return { dataUrl: resolvedVideoUrl };

        // Download inside the desktop runtime. Fetching an Agnes signed URL in
        // the renderer is blocked by CORS and surfaces only as "Failed to fetch".
        const { response: mediaResponse, attempts } = await fetchProviderResponse(resolvedVideoUrl, {
          // Agnes returns a pre-signed CDN URL. Adding the API bearer token to
          // that request invalidates authentication on the media host (401).
          method: "GET"
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
        const digest = require("node:crypto").createHash("sha256").update(mediaBytes).digest("hex");
        const duplicate = await rememberAgnesVideoHash(digest);
        if (duplicate) {
          if (!input?._agnesDuplicateRetry) return invokeVideoModel({ ...input, _agnesDuplicateRetry: true, _agnesSeed: Math.floor(Math.random() * 2147483646) + 1 }, fetchImpl);
          throw Object.assign(new Error("Agnes 连续两次返回完全相同的视频文件，漫镜已拒绝把重复成片写入资产库；请稍后重试该镜头"), { statusCode: 502 });
        }
        const safeMediaType = mediaType.startsWith("video/") ? mediaType : "video/mp4";
        const localVideoUrl = await cacheGeneratedVideo(mediaBytes, safeMediaType);
        return { videoUrl: localVideoUrl, remoteUrl: resolvedVideoUrl };
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
  if (/^asset:\/\/[a-z0-9][a-z0-9._:-]{5,179}$/i.test(raw)) return raw;
  return /^(?:https:\/\/|data:(?:image|video|audio)\/)/i.test(raw) ? raw : "";
}

function seedancePermissionError(data, status) {
  const detail = seedanceErrorMessage(data, "");
  const portrait = /(portrait|face|identity|consent|authorization|authorisation|trusted asset|人像|肖像|人脸|实名|授权)/i.test(detail);
  const safety = /(safety|moderation|risk|policy|违规|审核|安全|敏感)/i.test(detail);
  if (portrait) return `Seedance 可信人像未授权或 Asset ID 不可用：${detail || `接口返回 ${status}`}。请在火山方舟完成人像本人授权，并在漫镜资产库中填写对应 Asset ID、标记“已授权”`;
  if (safety) return `Seedance 内容安全审核未通过：${detail || `接口返回 ${status}`}。这不是网络中断，请检查人物、素材版权和提示词`;
  if ([401, 403].includes(status)) return `Seedance 权限校验失败：${detail || `接口返回 ${status}`}。请检查 API Key、模型权限以及可信人像授权`;
  return "";
}

function seedanceParameterError(data, status) {
  const detail = seedanceErrorMessage(data, "");
  if (status === 400 && /resolution/i.test(detail)) return `Seedance 分辨率参数不适用于当前模型：${detail}。漫镜已对 Seedance 2.0 Fast 自动限制为 480p/720p，请重新提交任务`;
  return "";
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
      timeoutMs: action === "create" ? 180000 : 45000,
      maxAttempts: action === "status" ? 4 : 1,
      retryLabel: action === "status" ? "Seedance 任务查询" : "Seedance 创建请求",
      timeoutMessage: action === "status" ? "Seedance 任务查询等待超过 45 秒" : "Seedance 创建请求等待超过 45 秒"
    }));
  } catch (error) {
    if (action === "create") {
      const detail = String(error?.message || error?.cause?.message || "").toLowerCase();
      const code = String(error?.code || error?.cause?.code || "").toUpperCase();
      const timedOut = error?.name === "AbortError" || detail.includes("timeout") || detail.includes("timed out") || detail.includes("aborted");
      const reset = ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code) || detail.includes("connection reset") || detail.includes("socket") || detail.includes("fetch failed");
      if (timedOut) throw Object.assign(new Error("Seedance 创建请求等待超过180秒；为避免重复创建和扣费，漫镜没有自动重提。请使用请求编号在火山方舟控制台确认是否已产生任务"), { statusCode: 504, retryable: false, failureKind: "timeout" });
      if (reset) throw Object.assign(new Error("Seedance 创建连接被服务端或网络代理重置；为避免重复创建和扣费，漫镜没有自动重提。请使用请求编号在火山方舟控制台确认是否已产生任务"), { statusCode: 502, retryable: false, failureKind: "connection_reset" });
      throw Object.assign(new Error("Seedance 创建请求网络连接被中断；为避免重复创建和扣费，漫镜没有自动重复提交。请先在火山方舟控制台确认是否已产生任务，再重新运行视频 AI"), { statusCode: 502, retryable: false });
    }
    throw Object.assign(new Error(`Seedance 任务查询连接失败：${String(error?.message || "网络连接被中断").slice(0, 220)}`), { statusCode: 503, retryable: true });
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const permissionMessage = seedancePermissionError(data, response.status);
    const parameterMessage = seedanceParameterError(data, response.status);
    throw Object.assign(new Error(permissionMessage || parameterMessage || `Seedance 方舟接口返回 ${response.status}：${seedanceErrorMessage(data)}`), {
      statusCode: TRANSIENT_PROVIDER_STATUSES.has(response.status) ? 503 : 502,
      providerStatus: response.status,
      retryable: TRANSIENT_PROVIDER_STATUSES.has(response.status),
      failureKind: permissionMessage ? "authorization" : parameterMessage ? "invalid_parameter" : "provider"
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
    const model = String(input?.model || "doubao-seedance-2-0-fast-260128").trim();
    if (prompt.length < 8) throw Object.assign(new Error("视频提示词至少需要 8 个字"), { statusCode: 400, retryable: false });
    if (!SEEDANCE_MODEL_PATTERN.test(model)) throw Object.assign(new Error("Seedance 模型 ID 或 Endpoint ID 格式不正确"), { statusCode: 400, retryable: false });
    const ratio = input?.ratio === "16:9" ? "16:9" : "9:16";
    const isOmniModel = String(input?.referenceMode || "").toLowerCase() === "omni" || /seedance-2/i.test(model);
    const duration = isOmniModel ? Math.max(4, Math.min(15, Math.round(Number(input?.duration) || 8))) : Number(input?.duration) >= 8 ? 10 : 5;
    const requestedResolution = ["480p", "720p", "1080p"].includes(String(input?.resolution)) ? String(input.resolution) : "720p";
    const resolution = /seedance-2-0-fast/i.test(model) && requestedResolution === "1080p" ? "720p" : requestedResolution;
    const rawVoiceover = input?.voiceover && typeof input.voiceover === "object" ? input.voiceover : {};
    const voiceEnabled = rawVoiceover.enabled === true;
    const backgroundMusic = rawVoiceover.backgroundMusic === true;
    const audioEnabled = rawVoiceover.audioEnabled !== false;
    const voiceMode = String(rawVoiceover.mode || "onscreen_dialogue");
    const musicInstruction = backgroundMusic ? "生成符合剧情节奏的无歌词背景音乐，音乐不得遮盖人声。" : "不要生成背景音乐。";
    const voiceInstruction = voiceEnabled
      ? voiceMode === "inner_monologue" || voiceMode === "voice_over"
        ? `\n生成原生画外音；说话者：${String(rawVoiceover.speaker || "旁白").slice(0, 80)}；准确台词：${String(rawVoiceover.script || "").slice(0, 500)}；声音来自画外，不创建说话者形象，画面人物保持自然闭嘴，不做口型同步。${musicInstruction}保留环境音和动作音效。`
        : `\n生成原生对白音轨；说话者：${String(rawVoiceover.speaker || "角色").slice(0, 80)}；准确台词：${String(rawVoiceover.script || "").slice(0, 500)}；仅说话角色进行自然口型同步；同一角色跨镜头保持相同音色、年龄感、语速和口音。${musicInstruction}保留环境音和动作音效。`
      : `\n不要生成人物对白或旁白。${musicInstruction}保留环境音和动作音效，视频不得完全静音。`;
    const content = [{ type: "text", text: `${prompt}${voiceInstruction}${negativePrompt ? `\n避免：${negativePrompt}` : ""}` }];
    const rawReferences = Array.isArray(input?.references) ? input.references : [];
    const counts = { image: 0, video: 0, audio: 0 };
    const acceptedReferences = [];
    if (isOmniModel) {
      for (const reference of rawReferences) {
        const kind = ["image", "video", "audio"].includes(String(reference?.kind)) ? String(reference.kind) : "image";
        const limit = kind === "image" ? 9 : 3;
        const url = seedanceReferenceUrl(reference?.url);
        if (!url || acceptedReferences.length >= 15 || counts[kind] >= limit) continue;
        counts[kind] += 1;
        // Seedance 2.0 cannot mix first/last-frame control with omni reference
        // media. The desktop runtime therefore submits every image as @Image.
        const role = kind === "image" ? "reference_image" : kind === "video" ? "reference_video" : "reference_audio";
        const token = `@${kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio"}${counts[kind]}`;
        content.push({ type: `${kind}_url`, [`${kind}_url`]: { url }, role });
        acceptedReferences.push({ kind, role, token, name: String(reference?.name || `${kind}-${counts[kind]}`).slice(0, 120) });
      }
    }
    if (acceptedReferences.length && content[0]?.type === "text") {
      const bindings = acceptedReferences.map((reference) => {
        const purpose = reference.role === "reference_audio" ? "只锁定该人物音色、年龄感、语速和口音，不改变画面" : reference.role === "reference_video" ? "只参考其动作、口型或运镜，不复制其剧情内容" : "严格锁定对应人物、服装、场景、道具或视觉风格";
        return `${reference.token || "@Image1"} = ${reference.name}；用途：${purpose}`;
      }).join("\n");
      content[0].text += `\n\n多模态资产绑定清单（必须逐项使用，不得重新设计）：\n${bindings}\n所有图片都只是 @Image 全能参考，绝不作为首帧控制。若不同参考存在冲突，优先级为：Canonical人物身份与服装 > 全片固定风格 > Canonical场景和道具 > 连续状态与动作参考。禁止把动画人物真人化或把真人动画化；禁止新增参考中没有的耳饰、服装、人物或关键道具。`;
    }
    const suppliedRequestId = String(input?.requestId || "").trim();
    const requestId = /^[a-z0-9-]{8,80}$/i.test(suppliedRequestId) ? suppliedRequestId : require("node:crypto").randomUUID();
    const cached = /^[a-z0-9-]{8,80}$/i.test(requestId) ? SEEDANCE_CREATE_CACHE.get(requestId) : null;
    if (cached && cached.expiresAt > Date.now()) return cached.payload;
    const inflight = SEEDANCE_CREATE_INFLIGHT.get(requestId);
    if (inflight) return inflight;
    const createPromise = (async () => {
      let payload;
      try {
        payload = await seedanceProviderJson(SEEDANCE_ARK_API, {
          method: "POST",
          headers: { ...headers, "X-Manjing-Request-Id": requestId },
          body: JSON.stringify({ model, content, resolution, ratio, duration, watermark: false, return_last_frame: false, generate_audio: audioEnabled })
        }, "create", fetchImpl);
      } catch (error) {
        error.message = `${error.message}。漫镜请求编号：${requestId}`;
        error.requestId = requestId;
        throw error;
      }
      if (!payload?.id) throw Object.assign(new Error(`Seedance 没有返回任务编号：${seedanceErrorMessage(payload)}`), { statusCode: 502, retryable: false });
      const result = { id: String(payload.id), requestId, status: "queued", acceptedReferences, ignoredReferences: Math.max(0, rawReferences.length - acceptedReferences.length) };
      SEEDANCE_CREATE_CACHE.set(requestId, { expiresAt: Date.now() + 30 * 60 * 1000, payload: result });
      if (SEEDANCE_CREATE_CACHE.size > 80) for (const [key, value] of SEEDANCE_CREATE_CACHE) if (value.expiresAt <= Date.now()) SEEDANCE_CREATE_CACHE.delete(key);
      return result;
    })();
    SEEDANCE_CREATE_INFLIGHT.set(requestId, createPromise);
    try {
      return await createPromise;
    } finally {
      if (SEEDANCE_CREATE_INFLIGHT.get(requestId) === createPromise) SEEDANCE_CREATE_INFLIGHT.delete(requestId);
    }
  }

  if (input?.action === "status") {
    const id = String(input?.id || "").trim();
    if (!SEEDANCE_TASK_PATTERN.test(id)) throw Object.assign(new Error("Seedance 任务编号无效"), { statusCode: 400, retryable: false });
    const payload = await seedanceProviderJson(`${SEEDANCE_ARK_API}/${encodeURIComponent(id)}`, { headers }, "status", fetchImpl);
    const taskPayload = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const taskStatus = String(taskPayload?.status || payload?.status || "queued").toLowerCase();
    const videoUrl = String(taskPayload?.content?.video_url || taskPayload?.video_url || payload?.content?.video_url || payload?.video_url || "");
    if (["failed", "failure", "cancelled", "canceled"].includes(taskStatus)) {
      throw Object.assign(new Error(seedanceErrorMessage(payload, `Seedance 任务${payload.status}`)), { statusCode: 502, done: true, retryable: false });
    }
    return {
      done: Boolean(videoUrl) || ["succeeded", "success", "completed", "complete", "finished"].includes(taskStatus),
      status: taskStatus,
      videoUrl,
      lastFrameUrl: String(taskPayload?.content?.last_frame_url || taskPayload?.last_frame_url || payload?.content?.last_frame_url || "")
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
    if (url.pathname === "/api/desktop/video" && request.method === "GET") {
      const cacheId = String(url.searchParams.get("cacheId") || "");
      const cached = /^[a-z0-9-]+$/i.test(cacheId) ? generatedVideoCache.get(cacheId) : null;
      if (!cached || !fs.existsSync(cached.filePath)) return jsonResponse({ error: "本机视频缓存已过期，请重新生成该分镜" }, 404);
      const bytes = await fs.promises.readFile(cached.filePath);
      return new Response(bytes, {
        headers: {
          "Cache-Control": "private, max-age=7200",
          "Content-Length": String(bytes.byteLength),
          "Content-Type": cached.contentType || "video/mp4",
          "X-Manjing-Desktop": "video-cache"
        }
      });
    }
    if (request.method !== "POST") return jsonResponse({ error: "只支持 GET 或 POST 请求" }, 405);
    const input = await readJsonRequest(request);
    if (url.pathname === "/api/desktop/enterprise-assets") return jsonResponse(await invokeEnterpriseAsset(input));
    if (url.pathname === "/api/desktop/models") return jsonResponse(await discoverRemoteModels(input));
    if (url.pathname === "/api/desktop/mcp") return jsonResponse(await invokeMcp(input));
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

module.exports = { createDesktopRuntime, discoverRemoteModels, invokeTextModel, invokeImageModel, invokeVideoModel, invokeMcp, invokeSeedance, downloadSeedanceMedia, volcengineSdkStatus, modelsFromPayload, readDesktopSettings, writeDesktopSettings };
