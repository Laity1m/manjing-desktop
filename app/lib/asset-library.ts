export type LibraryAssetCategory = "character" | "scene" | "video" | "audio" | "other";
export type LibraryMediaType = "image" | "video" | "audio";

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

function transactionDone(transaction: IDBTransaction, message: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(message));
    transaction.onabort = () => reject(transaction.error || new Error(message));
  });
}

export async function saveLibraryFile(file: File, options: { category?: LibraryAssetCategory; duration?: number; tags?: string[] } = {}) {
  if (file.size > MAX_ASSET_BYTES) throw new Error("单个资产不能超过 512MB");
  const mediaType = assetMediaType(file);
  if (!mediaType) throw new Error(`“${file.name}”不是支持的图片、视频或音频`);
  const database = await openLibraryDatabase();
  const asset: LibraryAsset = {
    id: uid("asset"),
    mediaId: uid("media"),
    name: file.name.slice(0, 180),
    mediaType,
    category: options.category || (mediaType === "video" ? "video" : mediaType === "audio" ? "audio" : "other"),
    size: file.size,
    duration: Math.max(0, Number(options.duration) || (mediaType === "image" ? 5 : 0)),
    tags: (options.tags || []).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    createdAt: new Date().toISOString(),
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

export async function listLibraryAssets() {
  const database = await openLibraryDatabase();
  try {
    const assets = await new Promise<LibraryAsset[]>((resolve, reject) => {
      const request = database.transaction(ASSET_STORE_NAME, "readonly").objectStore(ASSET_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result || []) as LibraryAsset[]);
      request.onerror = () => reject(request.error || new Error("读取资产库失败"));
    });
    return assets.filter((item) => item?.id && item?.mediaId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
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
    return blob ? { ...asset, url: URL.createObjectURL(blob) } : null;
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

export async function updateLibraryAsset(id: string, patch: Partial<Pick<LibraryAsset, "name" | "category" | "tags">>) {
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
    };
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put(next, next.id);
    await transactionDone(transaction, "更新资产失败");
    return next;
  } finally {
    database.close();
  }
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
