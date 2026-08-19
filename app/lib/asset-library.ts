import { characterAssetDisplayName } from "./character-asset-naming";
import { findReusableLibraryAsset } from "./asset-reuse";
import { DUPLICATE_CHARACTER_ARCHIVE_TAG, planCharacterAssetDeduplication } from "./character-asset-deduplication";

export type LibraryAssetCategory = "character" | "scene" | "prop" | "video" | "audio" | "other";
export type LibraryMediaType = "image" | "video" | "audio";
export type AssetReferencePurpose = "identity" | "face" | "hair" | "costume" | "body" | "scene-layout" | "lighting" | "style" | "prop-geometry" | "prop-material" | "spatial-anchor" | "voice" | "shot-continuity";
export type AssetSemanticRegion = { id: string; label: string; purpose: AssetReferencePurpose; box: [number, number, number, number] };

export type LibraryAsset = {
  id: string;
  mediaId: string;
  name: string;
  mediaType: LibraryMediaType;
  category: LibraryAssetCategory;
  size: number;
  duration: number;
  tags: string[];
  createdAt: string;
  reusable: boolean;
  locked: boolean;
  canonical: boolean;
  identityKey?: string;
  lookName?: string;
  entityId?: string;
  variantName?: string;
  purposes?: AssetReferencePurpose[];
  semanticDescription?: string;
  semanticRegions?: AssetSemanticRegion[];
  recognitionStatus?: "pending" | "recognized" | "confirmed" | "rejected";
  recognitionConfidence?: number;
  recognizedAt?: string;
  parentAssetId?: string;
  arkAssetId?: string;
  portraitAuthorizationStatus?: "unbound" | "pending" | "authorized";
  referenceText?: string;
  referenceMediaUrl?: string;
  voiceSource?: "generated-dialogue" | "video-extracted" | "user-uploaded";
  voiceConsent?: "pending" | "confirmed" | "revoked";
  assetState?: "placeholder" | "generating" | "review" | "ready";
  sourceChoice?: "unselected" | "upload" | "ai";
  blueprintKey?: string;
  generationPrompt?: string;
  projectId?: string;
  episodeId?: string;
  scope?: "project" | "global";
  usageCount: number;
  lastUsedAt?: string;
  url?: string;
};

export type LibraryPlaceholderInput = {
  name: string;
  category: "character" | "scene" | "prop" | "audio";
  identityKey: string;
  entityId?: string;
  lookName?: string;
  semanticDescription: string;
  generationPrompt?: string;
  referenceText?: string;
  tags?: string[];
  projectId?: string;
  episodeId?: string;
  scope?: "project" | "global";
  blueprintKey?: string;
};

const DATABASE_NAME = "manjing-media-v1";
const DATABASE_VERSION = 3;
const MEDIA_STORE_NAME = "media";
const PROJECT_STORE_NAME = "projects";
const ASSET_STORE_NAME = "library-assets";
const MAX_ASSET_BYTES = 512 * 1024 * 1024;

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function openLibraryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE_NAME)) request.result.createObjectStore(MEDIA_STORE_NAME);
      if (!request.result.objectStoreNames.contains(PROJECT_STORE_NAME)) request.result.createObjectStore(PROJECT_STORE_NAME);
      if (!request.result.objectStoreNames.contains(ASSET_STORE_NAME)) request.result.createObjectStore(ASSET_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本机资产库"));
    request.onblocked = () => reject(new Error("资产库正被另一个漫镜窗口占用，请关闭其他窗口后重试"));
  });
}

function assetMediaType(file: Blob) {
  if (file.type.startsWith("image/")) return "image" as const;
  if (file.type.startsWith("video/")) return "video" as const;
  if (file.type.startsWith("audio/")) return "audio" as const;
  return null;
}

function defaultAssetPurposes(category: LibraryAssetCategory, mediaType: LibraryMediaType): AssetReferencePurpose[] {
  if (category === "character") return ["identity", "face", "hair", "costume", "body"];
  if (category === "scene") return ["scene-layout", "lighting", "style", "spatial-anchor"];
  if (category === "prop") return ["prop-geometry", "prop-material", "spatial-anchor"];
  if (category === "audio") return ["voice"];
  if (category === "video") return ["shot-continuity", "style", "spatial-anchor"];
  return mediaType === "audio" ? ["voice"] : mediaType === "video" ? ["shot-continuity"] : ["style"];
}

function defaultSemanticRegions(category: LibraryAssetCategory, mediaType: LibraryMediaType): AssetSemanticRegion[] | undefined {
  if (category !== "character" || mediaType !== "image") return undefined;
  return [
    { id: "face", label: "脸部标准区域", purpose: "face", box: [0, 0, 0.38, 1] },
    { id: "front", label: "正面服装全身区域（五官遮挡）", purpose: "costume", box: [0.38, 0.04, 0.2, 0.92] },
    { id: "side", label: "侧面服装全身区域（五官遮挡）", purpose: "costume", box: [0.59, 0.04, 0.18, 0.92] },
    { id: "back", label: "背面全身区域", purpose: "costume", box: [0.79, 0.04, 0.2, 0.92] },
  ];
}

function normalizedAssetMetadata(asset: LibraryAsset): LibraryAsset {
  const generated = asset.tags?.some((item) => item === "自动生成" || item.startsWith("generated:"));
  const extension = asset.name.match(/\.[a-z0-9]{2,8}$/i)?.[0] || "";
  const stem = asset.name.slice(0, extension ? -extension.length : undefined);
  const semantic = stem.match(/(?:^|-)([^-]+)-(角色设定|人物设定|角色资产|场景|分镜|视频|道具设定|配音|口型视频)$/);
  const legacyCharacter = asset.category === "character" ? stem.match(/(?:^|-)([^-]+)-(?:角色设定|人物设定|角色资产)(?:-([^-]+))?(?:-角色)?$/) : null;
  const storedIdentityIsOpaque = /^character:[a-z0-9_-]+$/i.test(asset.identityKey || "");
  const inferredIdentity = (!storedIdentityIsOpaque ? asset.identityKey : undefined) || (asset.category === "character" ? legacyCharacter?.[1] : undefined) || (["character", "prop"].includes(asset.category) ? semantic?.[1] : undefined);
  const inferredLook = asset.lookName || legacyCharacter?.[2] || (asset.category === "character" ? "基础版" : undefined);
  if (asset.category === "character" && inferredIdentity && (generated || legacyCharacter || storedIdentityIsOpaque)) {
    return {
      ...asset,
      name: characterAssetDisplayName(inferredIdentity, inferredLook),
      identityKey: inferredIdentity,
      entityId: asset.entityId || inferredIdentity,
      lookName: inferredLook,
      variantName: asset.variantName || inferredLook,
    };
  }
  if (!generated) return asset;
  return {
    ...asset,
    name: semantic ? `${semantic[1]}-${semantic[2]}${extension}` : asset.name,
    identityKey: inferredIdentity,
    lookName: inferredLook,
  };
}

function transactionDone(transaction: IDBTransaction, message: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(message));
    transaction.onabort = () => reject(transaction.error || new Error(message));
  });
}

export async function saveLibraryFile(file: File, options: { name?: string; category?: LibraryAssetCategory; duration?: number; tags?: string[]; reusable?: boolean; locked?: boolean; identityKey?: string; lookName?: string; entityId?: string; variantName?: string; purposes?: AssetReferencePurpose[]; semanticDescription?: string; semanticRegions?: AssetSemanticRegion[]; recognitionStatus?: "pending" | "recognized" | "confirmed" | "rejected"; recognitionConfidence?: number; parentAssetId?: string; projectId?: string; episodeId?: string; scope?: "project" | "global"; referenceText?: string; referenceMediaUrl?: string; voiceSource?: "generated-dialogue" | "video-extracted" | "user-uploaded"; voiceConsent?: "pending" | "confirmed" | "revoked" } = {}) {
  if (file.size > MAX_ASSET_BYTES) throw new Error("单个资产不能超过 512MB");
  const mediaType = assetMediaType(file);
  if (!mediaType) throw new Error(`“${file.name}”不是支持的图片、视频或音频`);
  const database = await openLibraryDatabase();
  const tags = (options.tags || []).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const generated = tags.some((item) => item.startsWith("generated:") || item === "自动生成");
  const extension = file.name.match(/\.[a-z0-9]{2,8}$/i)?.[0] || (mediaType === "image" ? ".png" : mediaType === "video" ? ".mp4" : ".wav");
  const categoryName = options.category === "character" ? "角色" : options.category === "scene" ? "场景" : options.category === "prop" ? "道具" : mediaType === "video" ? "镜头" : mediaType === "audio" ? "配音" : "资产";
  const fileStem = file.name.replace(/\.[a-z0-9]{2,8}$/i, "");
  const inferredIdentity = options.identityKey?.trim() || (["character", "audio"].includes(String(options.category)) ? fileStem.match(/(?:^|-)([^-]+)-(?:角色设定|人物设定|角色资产|配音|声音资产)$/)?.[1] : undefined);
  const inferredLook = options.lookName?.trim() || tags.find((item) => /^(?:造型|look|声音|voice)[:：]/i.test(item))?.replace(/^(?:造型|look|声音|voice)[:：]/i, "").trim() || (options.category === "character" ? "基础造型" : options.category === "audio" ? "默认声音档案" : undefined);
  const semanticTail = fileStem.match(/(?:^|-)([^-]+)-(角色设定|人物设定|场景|分镜|视频|道具设定|配音|口型视频)$/)?.slice(1).join("-");
  const scriptName = options.name?.trim() || (options.category === "character" ? inferredIdentity : semanticTail);
  const generatedName = scriptName ? `${scriptName}${options.category === "character" && inferredLook ? `-${inferredLook}` : ""}-${categoryName}${extension}` : file.name;
  let activeContext: { projectId?: string; episodeId?: string } = {};
  try { activeContext = JSON.parse(localStorage.getItem("manjing-active-series-context-v1") || "{}"); } catch { activeContext = {}; }
  const projectId = options.scope === "global" ? undefined : options.projectId?.trim() || activeContext.projectId?.trim() || undefined;
  const category = options.category || (mediaType === "video" ? "video" : mediaType === "audio" ? "audio" : "other");
  const entityId = options.entityId?.trim() || inferredIdentity?.trim() || scriptName?.trim() || undefined;
  const purposes = (options.purposes?.length ? options.purposes : defaultAssetPurposes(category, mediaType)).slice(0, 12);
  const semanticRegions = options.semanticRegions?.length ? options.semanticRegions.slice(0, 12) : defaultSemanticRegions(category, mediaType);
  const semanticTags = [entityId ? `entity:${entityId}` : "", ...purposes.map((purpose) => `purpose:${purpose}`)].filter(Boolean);
  const asset: LibraryAsset = {
    id: uid("asset"),
    mediaId: uid("media"),
    name: (options.name?.trim() || (generated ? generatedName : file.name)).slice(0, 180),
    mediaType,
    category,
    size: file.size,
    duration: Math.max(0, Number(options.duration) || (mediaType === "image" ? 5 : 0)),
    tags: [...new Set([...tags, ...semanticTags])].slice(0, 24),
    createdAt: new Date().toISOString(),
    reusable: options.reusable !== false,
    locked: options.locked === true,
    canonical: false,
    identityKey: inferredIdentity?.slice(0, 120) || undefined,
    lookName: inferredLook?.slice(0, 120) || undefined,
    entityId: entityId?.slice(0, 120) || undefined,
    variantName: options.variantName?.trim().slice(0, 120) || inferredLook?.slice(0, 120) || undefined,
    purposes,
    semanticDescription: options.semanticDescription?.trim().slice(0, 1000) || (entityId ? `${entityId} 的${categoryName}，供 Agent 按用途引用` : undefined),
    semanticRegions,
    recognitionStatus: options.recognitionStatus || (generated ? "recognized" : "pending"),
    recognitionConfidence: Math.max(0, Math.min(1, Number(options.recognitionConfidence ?? (generated ? 0.98 : 0)))),
    recognizedAt: generated || options.recognitionStatus === "recognized" || options.recognitionStatus === "confirmed" ? new Date().toISOString() : undefined,
    parentAssetId: options.parentAssetId?.trim() || undefined,
    referenceText: options.referenceText?.trim().slice(0, 500) || undefined,
    referenceMediaUrl: /^https:\/\//i.test(options.referenceMediaUrl || "") ? options.referenceMediaUrl?.trim().slice(0, 2000) : undefined,
    voiceSource: category === "audio" ? options.voiceSource || (generated ? "generated-dialogue" : "user-uploaded") : undefined,
    voiceConsent: category === "audio" ? options.voiceConsent || (generated ? "confirmed" : "pending") : undefined,
    assetState: "ready",
    sourceChoice: generated ? "ai" : "upload",
    projectId,
    episodeId: options.episodeId?.trim() || activeContext.episodeId?.trim() || undefined,
    scope: options.scope || (projectId ? "project" : "global"),
    usageCount: 0,
  };
  try {
    const transaction = database.transaction([MEDIA_STORE_NAME, ASSET_STORE_NAME], "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).put(file, asset.mediaId);
    transaction.objectStore(ASSET_STORE_NAME).put(asset, asset.id);
    await transactionDone(transaction, "资产保存失败，本机存储空间可能不足");
    return { ...asset, url: URL.createObjectURL(file) };
  } finally {
    database.close();
  }
}

export async function saveLibraryPlaceholder(input: LibraryPlaceholderInput) {
  const name = input.name.trim().slice(0, 180);
  const identityKey = input.identityKey.trim().slice(0, 120) || name;
  if (!name || !identityKey) throw new Error("资产框架缺少名称");
  let activeContext: { projectId?: string; episodeId?: string } = {};
  try { activeContext = JSON.parse(localStorage.getItem("manjing-active-series-context-v1") || "{}"); } catch { activeContext = {}; }
  const projectId = input.projectId?.trim() || activeContext.projectId?.trim() || undefined;
  const episodeId = input.episodeId?.trim() || activeContext.episodeId?.trim() || undefined;
  const blueprintKey = (input.blueprintKey?.trim() || `${input.category}:${identityKey}:${input.lookName || "基础版"}`).toLocaleLowerCase("zh-CN").slice(0, 240);
  const library = await listLibraryAssets({ allProjects: true });
  const existing = library.find((asset) => asset.blueprintKey === blueprintKey && (asset.projectId || "") === (projectId || ""));
  const reusableExisting = findReusableLibraryAsset(library, {
    category: input.category,
    identityKey,
    lookName: input.lookName,
    projectId,
    mediaType: input.category === "audio" ? "audio" : "image",
    allowCrossProject: false,
    // A base portrait may lock identity, but it must never silently satisfy a
    // different costume/state blueprint (for example 白衣版 vs 黑衣版).
    allowLookFallback: false,
  });
  const mediaType: LibraryMediaType = input.category === "audio" ? "audio" : "image";
  const tags = [...new Set([...(input.tags || []), input.category === "audio" ? "剧本音色框架" : "剧本资产框架", `entity:${identityKey}`, ...defaultAssetPurposes(input.category, mediaType).map((purpose) => `purpose:${purpose}`)])].slice(0, 24);
  // A stale placeholder for this episode must not hide a real reusable asset
  // from another episode/project. Prefer real media before refreshing a frame.
  if (reusableExisting) return reusableExisting;
  if (existing && existing.assetState === "placeholder") {
    return updateLibraryAsset(existing.id, {
      name,
      identityKey,
      entityId: input.entityId?.trim().slice(0, 120) || identityKey,
      lookName: input.lookName || existing.lookName,
      variantName: input.lookName || existing.variantName,
      semanticDescription: input.semanticDescription,
      generationPrompt: input.generationPrompt,
      referenceText: input.referenceText,
      tags,
      projectId,
      episodeId,
      scope: input.scope || (projectId ? "project" : "global"),
    });
  }
  const id = uid("asset");
  const asset: LibraryAsset = {
    id,
    mediaId: `placeholder:${id}`,
    name,
    mediaType,
    category: input.category,
    size: 0,
    duration: 5,
    tags,
    createdAt: new Date().toISOString(),
    reusable: false,
    locked: true,
    canonical: false,
    identityKey,
    entityId: input.entityId?.trim().slice(0, 120) || identityKey,
    lookName: input.lookName?.trim().slice(0, 120) || (input.category === "character" ? "基础版" : undefined),
    variantName: input.lookName?.trim().slice(0, 120) || (input.category === "character" ? "基础版" : undefined),
    purposes: defaultAssetPurposes(input.category, mediaType),
    semanticDescription: input.semanticDescription.trim().slice(0, 1000),
    recognitionStatus: "recognized",
    recognitionConfidence: 1,
    recognizedAt: new Date().toISOString(),
    assetState: "placeholder",
    sourceChoice: "unselected",
    blueprintKey,
    generationPrompt: input.generationPrompt?.trim().slice(0, 1800),
    referenceText: input.referenceText?.trim().slice(0, 500),
    voiceSource: input.category === "audio" ? "user-uploaded" : undefined,
    voiceConsent: input.category === "audio" ? "pending" : undefined,
    projectId,
    episodeId,
    scope: input.scope || (projectId ? "project" : "global"),
    usageCount: 0,
  };
  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put(asset, asset.id);
    await transactionDone(transaction, "资产框架保存失败");
    return asset;
  } finally {
    database.close();
  }
}

export async function attachLibraryFileToPlaceholder(id: string, file: File, sourceChoice: "upload" | "ai" = "upload") {
  if (file.size > MAX_ASSET_BYTES) throw new Error("单个资产不能超过 512MB");
  const mediaType = assetMediaType(file);
  const database = await openLibraryDatabase();
  try {
    const current = await new Promise<LibraryAsset | undefined>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as LibraryAsset | undefined);
      request.onerror = () => reject(request.error || new Error("读取资产框架失败"));
    });
    if (!current) throw new Error("资产框架不存在或已删除");
    const expectedMediaType: LibraryMediaType = current.category === "audio" ? "audio" : "image";
    if (mediaType !== expectedMediaType) throw new Error(current.category === "audio" ? "音色框架只能绑定音频文件" : "人物、场景或道具框架只能绑定图片");
    const mediaId = uid("media");
    const next: LibraryAsset = {
      ...current,
      mediaId,
      mediaType,
      size: file.size,
      duration: 5,
      reusable: true,
      locked: true,
      assetState: sourceChoice === "ai" ? "review" : "ready",
      sourceChoice,
      recognitionStatus: sourceChoice === "ai" ? "recognized" : "confirmed",
      recognitionConfidence: sourceChoice === "ai" ? 0.98 : 1,
      voiceSource: current.category === "audio" ? (sourceChoice === "ai" ? "generated-dialogue" : "user-uploaded") : current.voiceSource,
      voiceConsent: current.category === "audio" ? "pending" : current.voiceConsent,
      tags: [...new Set([...current.tags, sourceChoice === "ai" ? "AI生成" : "用户上传"])].slice(0, 24),
    };
    const transaction = database.transaction([MEDIA_STORE_NAME, ASSET_STORE_NAME], "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).put(file, mediaId);
    transaction.objectStore(ASSET_STORE_NAME).put(next, id);
    await transactionDone(transaction, "资产图片绑定失败");
    return { ...next, url: URL.createObjectURL(file) };
  } finally {
    database.close();
  }
}

export async function listLibraryAssets(options: { allProjects?: boolean; includeArchived?: boolean } = {}) {
  const database = await openLibraryDatabase();
  try {
    const assets = await new Promise<LibraryAsset[]>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result || []) as LibraryAsset[]);
      request.onerror = () => reject(request.error || new Error("读取资产库失败"));
    });
    let activeProjectId = "";
    try { activeProjectId = String(JSON.parse(localStorage.getItem("manjing-active-series-context-v1") || "{}").projectId || ""); } catch { activeProjectId = ""; }
    return assets.filter((item) => item?.id && item?.mediaId).map(normalizedAssetMetadata)
      .filter((item) => options.includeArchived || !item.tags.includes(DUPLICATE_CHARACTER_ARCHIVE_TAG))
      .filter((item) => options.allProjects || !activeProjectId || !item.projectId || item.projectId === activeProjectId || item.scope === "global")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function consolidateDuplicateCharacterAssets() {
  const assets = await listLibraryAssets({ allProjects: true, includeArchived: true });
  const plan = planCharacterAssetDeduplication(assets);
  if (!plan.length) return { archived: 0, groups: 0 };
  const database = await openLibraryDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    let archived = 0;
    for (const group of plan) {
      for (const duplicate of group.archive) {
        store.put({
          ...duplicate,
          parentAssetId: group.keep.id,
          reusable: false,
          canonical: false,
          tags: [...new Set([...duplicate.tags.filter((tag) => tag !== DUPLICATE_CHARACTER_ARCHIVE_TAG), DUPLICATE_CHARACTER_ARCHIVE_TAG])].slice(0, 24),
        }, duplicate.id);
        archived += 1;
      }
    }
    await transactionDone(transaction, "重复人物资产整理失败");
    return { archived, groups: plan.length };
  } finally {
    database.close();
  }
}

export async function loadLibraryAsset(id: string) {
  const database = await openLibraryDatabase();
  try {
    const asset = await new Promise<LibraryAsset | undefined>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as LibraryAsset | undefined);
      request.onerror = () => reject(request.error || new Error("读取资产信息失败"));
    });
    if (!asset) return null;
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database.transaction(MEDIA_STORE_NAME, "readonly").objectStore(MEDIA_STORE_NAME).get(asset.mediaId);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error || new Error("读取资产文件失败"));
    });
    if (blob) return { ...normalizedAssetMetadata(asset), url: URL.createObjectURL(blob) };
    return asset.assetState === "placeholder" || asset.mediaId.startsWith("placeholder:") ? normalizedAssetMetadata(asset) : null;
  } finally {
    database.close();
  }
}

export async function loadLibraryAssets(ids: string[]) {
  const unique = [...new Set(ids)];
  const loaded: LibraryAsset[] = [];
  for (const id of unique) {
    const asset = await loadLibraryAsset(id);
    if (asset) loaded.push(asset);
  }
  return loaded;
}

export async function updateLibraryAsset(id: string, patch: Partial<Pick<LibraryAsset, "name" | "category" | "tags" | "reusable" | "locked" | "canonical" | "identityKey" | "lookName" | "entityId" | "variantName" | "purposes" | "semanticDescription" | "semanticRegions" | "recognitionStatus" | "recognitionConfidence" | "recognizedAt" | "parentAssetId" | "arkAssetId" | "portraitAuthorizationStatus" | "referenceText" | "referenceMediaUrl" | "voiceSource" | "voiceConsent" | "assetState" | "sourceChoice" | "blueprintKey" | "generationPrompt" | "projectId" | "episodeId" | "scope" | "usageCount" | "lastUsedAt">>) {
  const database = await openLibraryDatabase();
  try {
    const current = await new Promise<LibraryAsset | undefined>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as LibraryAsset | undefined);
      request.onerror = () => reject(request.error || new Error("读取资产失败"));
    });
    if (!current) throw new Error("资产不存在或已删除");
    const next: LibraryAsset = {
      ...current,
      ...(typeof patch.name === "string" ? { name: patch.name.trim().slice(0, 180) || current.name } : {}),
      ...(patch.category ? { category: patch.category } : {}),
      ...(Array.isArray(patch.tags) ? { tags: patch.tags.map((item) => item.trim()).filter(Boolean).slice(0, 12) } : {}),
      ...(typeof patch.reusable === "boolean" ? { reusable: patch.reusable } : {}),
      ...(typeof patch.locked === "boolean" ? { locked: patch.locked } : {}),
      ...(typeof patch.canonical === "boolean" ? { canonical: patch.canonical } : {}),
      ...(typeof patch.identityKey === "string" ? { identityKey: patch.identityKey.trim().slice(0, 120) || undefined } : {}),
      ...(typeof patch.lookName === "string" ? { lookName: patch.lookName.trim().slice(0, 120) || undefined } : {}),
      ...(typeof patch.entityId === "string" ? { entityId: patch.entityId.trim().slice(0, 120) || undefined } : {}),
      ...(typeof patch.variantName === "string" ? { variantName: patch.variantName.trim().slice(0, 120) || undefined } : {}),
      ...(Array.isArray(patch.purposes) ? { purposes: [...new Set(patch.purposes)].slice(0, 12) } : {}),
      ...(typeof patch.semanticDescription === "string" ? { semanticDescription: patch.semanticDescription.trim().slice(0, 1000) || undefined } : {}),
      ...(Array.isArray(patch.semanticRegions) ? { semanticRegions: patch.semanticRegions.slice(0, 12) } : {}),
      ...(patch.recognitionStatus ? { recognitionStatus: patch.recognitionStatus } : {}),
      ...(typeof patch.recognitionConfidence === "number" ? { recognitionConfidence: Math.max(0, Math.min(1, patch.recognitionConfidence)) } : {}),
      ...(typeof patch.recognizedAt === "string" ? { recognizedAt: patch.recognizedAt } : {}),
      ...(typeof patch.parentAssetId === "string" ? { parentAssetId: patch.parentAssetId.trim() || undefined } : {}),
      ...(typeof patch.arkAssetId === "string" ? { arkAssetId: patch.arkAssetId.trim().replace(/^asset:\/\//i, "").slice(0, 180) || undefined } : {}),
      ...(patch.portraitAuthorizationStatus ? { portraitAuthorizationStatus: patch.portraitAuthorizationStatus } : {}),
      ...(typeof patch.referenceText === "string" ? { referenceText: patch.referenceText.trim().slice(0, 500) || undefined } : {}),
      ...(typeof patch.referenceMediaUrl === "string" ? { referenceMediaUrl: /^https:\/\//i.test(patch.referenceMediaUrl) ? patch.referenceMediaUrl.trim().slice(0, 2000) : undefined } : {}),
      ...(patch.voiceSource ? { voiceSource: patch.voiceSource } : {}),
      ...(patch.voiceConsent ? { voiceConsent: patch.voiceConsent } : {}),
      ...(patch.assetState ? { assetState: patch.assetState } : {}),
      ...(patch.sourceChoice ? { sourceChoice: patch.sourceChoice } : {}),
      ...(typeof patch.blueprintKey === "string" ? { blueprintKey: patch.blueprintKey.trim().slice(0, 240) || undefined } : {}),
      ...(typeof patch.generationPrompt === "string" ? { generationPrompt: patch.generationPrompt.trim().slice(0, 1800) || undefined } : {}),
      ...(typeof patch.projectId === "string" ? { projectId: patch.projectId.trim() || undefined } : {}),
      ...(typeof patch.episodeId === "string" ? { episodeId: patch.episodeId.trim() || undefined } : {}),
      ...(patch.scope ? { scope: patch.scope } : {}),
      ...(typeof patch.usageCount === "number" ? { usageCount: Math.max(0, Math.round(patch.usageCount)) } : {}),
      ...(typeof patch.lastUsedAt === "string" ? { lastUsedAt: patch.lastUsedAt } : {}),
    };
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put(next, next.id);
    await transactionDone(transaction, "更新资产失败");
    return next;
  } finally {
    database.close();
  }
}

export async function markLibraryAssetUsed(id: string) {
  const assets = await listLibraryAssets();
  const asset = assets.find((item) => item.id === id);
  if (!asset) return;
  await updateLibraryAsset(id, { usageCount: (asset.usageCount || 0) + 1, lastUsedAt: new Date().toISOString() });
}

export async function deleteLibraryAsset(id: string) {
  const database = await openLibraryDatabase();
  try {
    const asset = await new Promise<LibraryAsset | undefined>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as LibraryAsset | undefined);
      request.onerror = () => reject(request.error || new Error("读取资产失败"));
    });
    if (!asset) return;
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).delete(id);
    await transactionDone(transaction, "删除资产失败");
    // 媒体可能已经被剪辑工程引用。只删除资产索引，保留底层文件，避免破坏旧项目。
  } finally {
    database.close();
  }
}

export async function deleteLibraryAssetsByProject(projectId: string) {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) return 0;
  const assets = await listLibraryAssets({ allProjects: true });
  const projectAssets = assets.filter((asset) => asset.scope !== "global" && asset.projectId === normalizedProjectId);
  await Promise.all(projectAssets.map((asset) => deleteLibraryAsset(asset.id)));
  return projectAssets.length;
}
