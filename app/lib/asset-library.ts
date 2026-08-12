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
  projectId?: string;
  episodeId?: string;
  scope?: "project" | "global";
  usageCount: number;
  lastUsedAt?: string;
  url?: string;
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
  if (!generated) return asset;
  const extension = asset.name.match(/\.[a-z0-9]{2,8}$/i)?.[0] || "";
  const stem = asset.name.slice(0, extension ? -extension.length : undefined);
  const semantic = stem.match(/(?:^|-)([^-]+)-(角色设定|人物设定|角色资产|场景|分镜|视频|道具设定|配音|口型视频)$/);
  const inferredIdentity = asset.identityKey || (["character", "prop"].includes(asset.category) ? semantic?.[1] : undefined);
  return {
    ...asset,
    name: semantic ? `${semantic[1]}-${semantic[2]}${extension}` : asset.name,
    identityKey: inferredIdentity,
    lookName: asset.lookName || (asset.category === "character" ? "基础造型" : undefined),
  };
}

function transactionDone(transaction: IDBTransaction, message: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(message));
    transaction.onabort = () => reject(transaction.error || new Error(message));
  });
}

export async function saveLibraryFile(file: File, options: { name?: string; category?: LibraryAssetCategory; duration?: number; tags?: string[]; reusable?: boolean; locked?: boolean; identityKey?: string; lookName?: string; entityId?: string; variantName?: string; purposes?: AssetReferencePurpose[]; semanticDescription?: string; semanticRegions?: AssetSemanticRegion[]; recognitionStatus?: "pending" | "recognized" | "confirmed" | "rejected"; recognitionConfidence?: number; parentAssetId?: string; projectId?: string; episodeId?: string; scope?: "project" | "global" } = {}) {
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
  const projectId = options.projectId?.trim() || activeContext.projectId?.trim() || undefined;
  const category = options.category || (mediaType === "video" ? "video" : mediaType === "audio" ? "audio" : "other");
  const entityId = options.entityId?.trim() || inferredIdentity?.trim() || scriptName?.trim() || undefined;
  const purposes = (options.purposes?.length ? options.purposes : defaultAssetPurposes(category, mediaType)).slice(0, 12);
  const semanticRegions = options.semanticRegions?.length ? options.semanticRegions.slice(0, 12) : defaultSemanticRegions(category, mediaType);
  const semanticTags = [entityId ? `entity:${entityId}` : "", ...purposes.map((purpose) => `purpose:${purpose}`)].filter(Boolean);
  const asset: LibraryAsset = {
    id: uid("asset"),
    mediaId: uid("media"),
    name: (generated ? generatedName : options.name?.trim() || file.name).slice(0, 180),
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

export async function listLibraryAssets(options: { allProjects?: boolean } = {}) {
  const database = await openLibraryDatabase();
  try {
    const assets = await new Promise<LibraryAsset[]>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result || []) as LibraryAsset[]);
      request.onerror = () => reject(request.error || new Error("读取资产库失败"));
    });
    let activeProjectId = "";
    try { activeProjectId = String(JSON.parse(localStorage.getItem("manjing-active-series-context-v1") || "{}").projectId || ""); } catch { activeProjectId = ""; }
    return assets.filter((item) => item?.id && item?.mediaId).map(normalizedAssetMetadata).filter((item) => options.allProjects || !activeProjectId || !item.projectId || item.projectId === activeProjectId || item.scope === "global").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
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
    return blob ? { ...normalizedAssetMetadata(asset), url: URL.createObjectURL(blob) } : null;
  } finally {
    database.close();
  }
}

export async function loadLibraryAssets(ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 60);
  const loaded: LibraryAsset[] = [];
  for (const id of unique) {
    const asset = await loadLibraryAsset(id);
    if (asset) loaded.push(asset);
  }
  return loaded;
}

export async function updateLibraryAsset(id: string, patch: Partial<Pick<LibraryAsset, "name" | "category" | "tags" | "reusable" | "locked" | "canonical" | "identityKey" | "lookName" | "entityId" | "variantName" | "purposes" | "semanticDescription" | "semanticRegions" | "recognitionStatus" | "recognitionConfidence" | "recognizedAt" | "parentAssetId" | "arkAssetId" | "portraitAuthorizationStatus" | "projectId" | "episodeId" | "scope" | "usageCount" | "lastUsedAt">>) {
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
