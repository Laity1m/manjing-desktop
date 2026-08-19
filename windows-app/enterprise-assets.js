/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const crypto = require("node:crypto");
const { Service } = require("@volcengine/openapi");
const { TosClient } = require("@volcengine/tos-sdk");

const ARK_VERSION = "2024-01-01";
const MAX_PORTRAIT_BYTES = 24 * 1024 * 1024;

function clean(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function enterpriseConfig(input = {}) {
  const region = clean(input.tosRegion || "cn-beijing", 40);
  return {
    companyName: clean(input.companyName, 120),
    plan: ["advanced", "premium"].includes(input.plan) ? input.plan : "advanced",
    accessKeyId: clean(input.accessKeyId, 180),
    secretKey: clean(input.secretKey, 300),
    projectName: clean(input.projectName || "default", 120),
    callbackUrl: clean(input.callbackUrl || "https://console.volcengine.com/ark", 1000),
    tosBucket: clean(input.tosBucket, 180),
    tosRegion: region,
    tosEndpoint: clean(input.tosEndpoint || `tos-${region}.volces.com`, 300).replace(/^https?:\/\//i, "").replace(/\/$/, ""),
  };
}

function validateConfig(config, options = {}) {
  if (!config.companyName || !config.accessKeyId || !config.secretKey || !config.projectName) {
    throw Object.assign(new Error("请填写企业名称、Access Key ID、Secret Key 和方舟项目名"), { statusCode: 400, retryable: false });
  }
  if (!/^https:\/\//i.test(config.callbackUrl)) {
    throw Object.assign(new Error("真人授权回跳地址必须是 HTTPS 地址"), { statusCode: 400, retryable: false });
  }
  if (options.requireTos && (!config.tosBucket || !config.tosRegion || !config.tosEndpoint)) {
    throw Object.assign(new Error("本地人物图自动入库需要填写企业 TOS Bucket、地域和 Endpoint"), { statusCode: 400, retryable: false });
  }
  return config;
}

function arkService(config) {
  validateConfig(config);
  return new Service({
    host: "ark.cn-beijing.volcengineapi.com",
    region: "cn-beijing",
    serviceName: "ark",
    defaultVersion: ARK_VERSION,
    accessKeyId: config.accessKeyId,
    secretKey: config.secretKey,
  });
}

async function arkJson(config, action, payload) {
  const call = arkService(config).createJSONAPI(action, { Version: ARK_VERSION, method: "POST" });
  return call(payload);
}

function valueFrom(data, keys) {
  const roots = [data, data?.Result, data?.result, data?.ResponseMetadata].filter(Boolean);
  for (const root of roots) {
    for (const key of keys) {
      if (root?.[key] !== undefined && root?.[key] !== null) return root[key];
    }
  }
  return undefined;
}

function apiError(prefix, error, options = {}) {
  const message = clean(error?.message || error, 700) || "未知错误";
  const statusCode = Number(error?.response?.status || error?.statusCode || 502);
  const requestId = clean(error?.requestId || error?.response?.headers?.["x-tt-logid"] || error?.response?.data?.ResponseMetadata?.RequestId, 160);
  const wrapped = new Error(`${prefix}：${message}${requestId ? `（Request id: ${requestId}）` : ""}`);
  return Object.assign(wrapped, { statusCode: options.statusCode || (statusCode >= 400 && statusCode < 500 ? statusCode : 502), retryable: options.retryable ?? statusCode >= 500, requestId });
}

function parseImageData(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw Object.assign(new Error("人物素材不是有效的本地图片数据"), { statusCode: 400, retryable: false });
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_PORTRAIT_BYTES) {
    throw Object.assign(new Error("企业可信人像单图需小于 24MB"), { statusCode: 413, retryable: false });
  }
  const extension = match[1].includes("png") ? "png" : match[1].includes("webp") ? "webp" : "jpg";
  return { bytes, contentType: match[1], extension };
}

async function uploadPortrait(config, input) {
  validateConfig(config, { requireTos: true });
  const image = parseImageData(input.mediaDataUrl);
  const safeName = clean(input.name || "portrait", 80).replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").replace(/^-+|-+$/g, "") || "portrait";
  const digest = crypto.createHash("sha256").update(image.bytes).digest("hex").slice(0, 16);
  const date = new Date().toISOString().slice(0, 10);
  const key = `manjing/trusted-portraits/${date}/${safeName}-${digest}.${image.extension}`;
  try {
    const client = new TosClient({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.secretKey,
      region: config.tosRegion,
      endpoint: config.tosEndpoint,
    });
    await client.putObject({ bucket: config.tosBucket, key, body: image.bytes, contentLength: image.bytes.length, contentType: image.contentType });
    return { key, url: client.getPreSignedUrl({ bucket: config.tosBucket, key, method: "GET", expires: 3600 }) };
  } catch (error) {
    throw apiError("上传企业 TOS 素材失败，请检查 Bucket 地域及 TOS 权限", error);
  }
}

async function startPortraitValidation(config) {
  validateConfig(config);
  try {
    const data = await arkJson(config, "CreateVisualValidateSession", { CallbackURL: config.callbackUrl, ProjectName: config.projectName });
    const bytedToken = clean(valueFrom(data, ["BytedToken", "Token"]), 1000);
    const h5Link = clean(valueFrom(data, ["H5Link", "H5URL", "Url", "URL"]), 3000);
    if (!bytedToken || !/^https:\/\//i.test(h5Link)) throw new Error("方舟未返回真人授权链接或授权令牌");
    return { bytedToken, h5Link, state: "awaiting_actor" };
  } catch (error) {
    throw apiError("创建方舟可信人物授权失败", error, { retryable: false });
  }
}

async function getPortraitValidation(config, bytedToken) {
  if (!clean(bytedToken, 1000)) throw Object.assign(new Error("真人授权会话不存在或已过期"), { statusCode: 400, retryable: false });
  try {
    const data = await arkJson(config, "GetVisualValidateResult", { BytedToken: bytedToken, ProjectName: config.projectName });
    const groupId = clean(valueFrom(data, ["GroupId", "GroupID", "AssetGroupId"]), 300);
    if (!groupId) return { state: "awaiting_actor" };
    return { state: "validated", groupId };
  } catch (error) {
    const message = clean(error?.message || error, 700).toLocaleLowerCase("en-US");
    if (/not.{0,16}(complete|finish|found|ready)|pending|validat|result.{0,16}(empty|none)/i.test(message)) return { state: "awaiting_actor" };
    throw apiError("查询可信人物授权结果失败", error);
  }
}

async function createPortraitAsset(config, input) {
  const groupId = clean(input.groupId, 300);
  const name = clean(input.name, 180);
  if (!groupId || !name) throw Object.assign(new Error("可信人物素材缺少人物组或素材名称"), { statusCode: 400, retryable: false });
  let sourceUrl = clean(input.url, 4000);
  let tosKey = "";
  if (!/^https:\/\//i.test(sourceUrl)) {
    const uploaded = await uploadPortrait(config, input);
    sourceUrl = uploaded.url;
    tosKey = uploaded.key;
  }
  try {
    const data = await arkJson(config, "CreateAsset", { AssetType: "Image", GroupId: groupId, Name: name, ProjectName: config.projectName, URL: sourceUrl });
    const id = clean(valueFrom(data, ["Id", "AssetId", "AssetID"]), 300);
    if (!id) throw new Error("方舟未返回 Asset ID");
    return { id, tosKey, state: "processing" };
  } catch (error) {
    throw apiError("提交方舟可信人物素材失败", error, { retryable: false });
  }
}

async function getPortraitAsset(config, id) {
  const assetId = clean(id, 300).replace(/^asset:\/\//i, "");
  if (!assetId) throw Object.assign(new Error("Asset ID 为空"), { statusCode: 400, retryable: false });
  try {
    const data = await arkJson(config, "GetAsset", { Id: assetId, ProjectName: config.projectName });
    const rawStatus = clean(valueFrom(data, ["Status", "State"]), 80);
    const normalized = rawStatus.toLocaleLowerCase("en-US");
    const failureReason = clean(valueFrom(data, ["FailureReason", "ErrorMessage", "Message"]), 500);
    if (/active|success|ready|available/.test(normalized)) return { id: assetId, state: "active", status: rawStatus || "Active" };
    if (/fail|error|inactive|reject/.test(normalized)) return { id: assetId, state: "failed", status: rawStatus, error: failureReason || "方舟素材处理失败" };
    return { id: assetId, state: "processing", status: rawStatus || "Processing" };
  } catch (error) {
    throw apiError("查询方舟可信人物素材状态失败", error);
  }
}

async function probeEnterpriseAssets(config) {
  validateConfig(config);
  try {
    await arkJson(config, "ListAssetGroups", { Filter: { GroupType: "LivenessFace" }, PageNumber: 1, PageSize: 1, ProjectName: config.projectName });
    return { ok: true };
  } catch (error) {
    throw apiError("企业 Assets API 权限检测失败", error, { retryable: false });
  }
}

module.exports = { enterpriseConfig, validateConfig, probeEnterpriseAssets, startPortraitValidation, getPortraitValidation, createPortraitAsset, getPortraitAsset };
