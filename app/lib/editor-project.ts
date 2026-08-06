export type EditorMediaType = "video" | "image" | "audio" | "text";

export type EditorProjectClip = {
  id: string;
  name: string;
  type: EditorMediaType;
  url?: string;
  mediaId?: string;
  duration: number;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  start: number;
  volume: number;
  speed: number;
  filter: "none" | "warm" | "cool" | "mono";
  transition: "cut" | "fade" | "flash";
  text?: string;
};

export type EditorProject = {
  version: 2;
  id: string;
  name: string;
  aspect: "9:16" | "16:9";
  source: "studio" | "libtv" | "manual" | "video";
  createdAt: string;
  clips: EditorProjectClip[];
  finalVideo?: { url?: string; mediaId?: string };
  editorNote?: string;
  studioSnapshot?: Record<string, unknown>;
};

const STORAGE_KEY = "manjing-editor-handoff";
const ACTIVE_PROJECT_KEY = "manjing-editor-active-project";
const DATABASE_NAME = "manjing-media-v1";
const MEDIA_STORE_NAME = "media";
const PROJECT_STORE_NAME = "projects";
const MAX_PERSISTED_MEDIA_BYTES = 512 * 1024 * 1024;

type TransferProgress = { completed: number; total: number; label: string };
type TransferOptions = { onProgress?: (progress: TransferProgress) => void };
type MediaReference = { url?: string; mediaId?: string };

function currentStoredProject(id: string) {
  try {
    const project = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as EditorProject | null;
    return project?.id === id ? project : undefined;
  } catch {
    return undefined;
  }
}

function openMediaDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE_NAME)) request.result.createObjectStore(MEDIA_STORE_NAME);
      if (!request.result.objectStoreNames.contains(PROJECT_STORE_NAME)) request.result.createObjectStore(PROJECT_STORE_NAME);
      if (!request.result.objectStoreNames.contains("library-assets")) request.result.createObjectStore("library-assets");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地素材库"));
    request.onblocked = () => reject(new Error("本机素材库正被另一个漫镜窗口占用，请关闭其他漫镜窗口后重试"));
  });
}

function projectMediaIds(project?: EditorProject) {
  if (!project) return [];
  return [...new Set([...project.clips.map((clip) => clip.mediaId).filter(Boolean), project.finalVideo?.mediaId].filter(Boolean) as string[])];
}

async function readStoredProject(database: IDBDatabase, id: string) {
  return new Promise<EditorProject | undefined>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE_NAME, "readonly");
    const request = transaction.objectStore(PROJECT_STORE_NAME).get(id);
    let result: EditorProject | undefined;
    request.onsuccess = () => { result = request.result as EditorProject | undefined; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || request.error || new Error("读取项目历史失败"));
    transaction.onabort = () => reject(transaction.error || new Error("项目读取被中断"));
  });
}

async function removeUnreferencedMedia(database: IDBDatabase, candidates: string[]) {
  if (!candidates.length) return;
  const projects = await new Promise<EditorProject[]>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE_NAME, "readonly");
    const request = transaction.objectStore(PROJECT_STORE_NAME).getAll();
    let result: EditorProject[] = [];
    request.onsuccess = () => { result = (request.result || []) as EditorProject[]; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || request.error || new Error("读取项目引用失败"));
    transaction.onabort = () => reject(transaction.error || new Error("项目引用读取被中断"));
  });
  const referenced = new Set(projects.flatMap((project) => projectMediaIds(project)));
  const removable = candidates.filter((id) => !referenced.has(id));
  if (!removable.length) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE_NAME);
    removable.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("清理旧素材失败"));
  });
}

async function storeMedia(database: IDBDatabase, blob: Blob) {
  const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).put(blob, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("保存本地素材失败"));
    transaction.onabort = () => reject(transaction.error || new Error("本机素材库空间不足，保存已取消"));
  });
  return id;
}

async function writeStoredProject(database: IDBDatabase, stored: EditorProject) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE_NAME, "readwrite");
    const timer = window.setTimeout(() => {
      try { transaction.abort(); } catch { /* an already completed transaction needs no abort */ }
      reject(new Error("工程索引写入超时，正在重试"));
    }, 5000);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    transaction.objectStore(PROJECT_STORE_NAME).put(stored, stored.id);
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(transaction.error || new Error("保存项目历史失败"));
    transaction.onabort = () => finish(transaction.error || new Error("项目写入被中断，请重试"));
  });
}

async function readMedia(database: IDBDatabase, id: string) {
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readonly");
    const request = transaction.objectStore(MEDIA_STORE_NAME).get(id);
    let result: Blob | undefined;
    request.onsuccess = () => { result = request.result as Blob | undefined; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || request.error || new Error("读取本地素材失败"));
    transaction.onabort = () => reject(transaction.error || new Error("本地素材读取被中断"));
  });
  return blob;
}

async function cleanupProjectMedia(candidates: string[]) {
  if (!candidates.length) return;
  const database = await openMediaDatabase();
  try {
    await removeUnreferencedMedia(database, candidates);
  } finally {
    database.close();
  }
}

async function persistUrl(url: string | undefined, database: IDBDatabase, cache: Map<string, MediaReference>) {
  if (!url) return {};
  const cached = cache.get(url);
  if (cached) return cached;
  if (!url.startsWith("blob:") && !url.startsWith("data:")) {
    const reference = { url };
    cache.set(url, reference);
    return reference;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取待导入的本地素材，请重新生成或重新选择文件");
  const blob = await response.blob();
  if (blob.size > MAX_PERSISTED_MEDIA_BYTES) throw new Error("单个素材超过 512 MB。为避免软件卡死，请先压缩视频或分段导入");
  const reference = { mediaId: await storeMedia(database, blob) };
  cache.set(url, reference);
  return reference;
}

export async function persistEditorProject(project: Omit<EditorProject, "version" | "createdAt">, options: TransferOptions = {}) {
  let database = await openMediaDatabase();
  const references = new Map<string, MediaReference>();
  const total = project.clips.length + (project.finalVideo?.url || project.finalVideo?.mediaId ? 1 : 0) + 1;
  let completed = 0;
  try {
    // The active handoff already contains the previous media references. Reading
    // the old project from IndexedDB here can queue the whole save behind a
    // closing hydration transaction in a background Electron window.
    const previous = currentStoredProject(project.id);
    const clips: EditorProjectClip[] = [];
    for (const clip of project.clips) {
      const reference: MediaReference = clip.mediaId ? { mediaId: clip.mediaId } : await persistUrl(clip.url, database, references);
      if (clip.url && clip.mediaId) references.set(clip.url, reference);
      clips.push({ ...clip, ...reference, url: reference.url });
      completed += 1;
      options.onProgress?.({ completed, total, label: clip.name });
    }
    const finalReference: MediaReference | undefined = project.finalVideo?.mediaId
      ? { mediaId: project.finalVideo.mediaId }
      : project.finalVideo?.url
        ? await persistUrl(project.finalVideo.url, database, references)
        : undefined;
    if (project.finalVideo?.url || project.finalVideo?.mediaId) {
      completed += 1;
      options.onProgress?.({ completed, total, label: "最终成片" });
    }
    const stored: EditorProject = {
      ...project,
      version: 2,
      createdAt: new Date().toISOString(),
      clips,
      finalVideo: project.finalVideo ? finalReference : undefined,
    };
    try {
      await writeStoredProject(database, stored);
    } catch {
      database.close();
      database = await openMediaDatabase();
      await writeStoredProject(database, stored);
    }
    completed += 1;
    options.onProgress?.({ completed, total, label: "工程索引" });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    localStorage.setItem(ACTIVE_PROJECT_KEY, stored.id);
    localStorage.setItem("manjing-editor-handoff-ready", stored.createdAt);
    // Cleanup is maintenance, not part of the user's foreground save. Run it
    // independently so a slow browser storage sweep can never freeze the button.
    void cleanupProjectMedia(projectMediaIds(previous)).catch(() => undefined);
    return stored;
  } finally {
    database.close();
  }
}

async function hydrateEditorProject(stored: EditorProject, options: TransferOptions = {}) {
  const references = [...stored.clips.filter((clip) => clip.mediaId), ...(stored.finalVideo?.mediaId ? [{ name: "最终成片", mediaId: stored.finalVideo.mediaId }] : [])];
  if (!references.length) return stored;
  const database = await openMediaDatabase();
  const urls = new Map<string, string>();
  let completed = 0;
  try {
    const clips: EditorProjectClip[] = [];
    for (const clip of stored.clips) {
      if (!clip.mediaId) {
        clips.push(clip);
        continue;
      }
      let url = urls.get(clip.mediaId);
      if (!url) {
        const blob = await readMedia(database, clip.mediaId).catch(() => undefined);
        if (blob) {
          url = URL.createObjectURL(blob);
          urls.set(clip.mediaId, url);
        }
      }
      clips.push(url ? { ...clip, url } : clip);
      completed += 1;
      options.onProgress?.({ completed, total: references.length, label: clip.name });
    }
    let finalVideo = stored.finalVideo;
    if (finalVideo?.mediaId) {
      let url = urls.get(finalVideo.mediaId);
      if (!url) {
        const blob = await readMedia(database, finalVideo.mediaId).catch(() => undefined);
        if (blob) {
          url = URL.createObjectURL(blob);
          urls.set(finalVideo.mediaId, url);
        }
      }
      if (url) finalVideo = { ...finalVideo, url };
      completed += 1;
      options.onProgress?.({ completed, total: references.length, label: "最终成片" });
    }
    return { ...stored, clips, finalVideo };
  } finally {
    database.close();
  }
}

export async function loadEditorProject(options: TransferOptions = {}) {
  const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (activeId) {
    const database = await openMediaDatabase();
    let active: EditorProject | undefined;
    try {
      active = await readStoredProject(database, activeId);
    } finally {
      database.close();
    }
    if (active?.version === 2 && Array.isArray(active.clips)) return hydrateEditorProject(active, options);
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let stored: EditorProject;
  try {
    stored = JSON.parse(raw) as EditorProject;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  if (stored.version !== 2 || !Array.isArray(stored.clips)) return null;
  return hydrateEditorProject(stored, options);
}

export async function loadEditorProjectById(id: string, options: TransferOptions = {}) {
  const database = await openMediaDatabase();
  let stored: EditorProject | undefined;
  try {
    stored = await readStoredProject(database, id);
  } finally {
    database.close();
  }
  if (!stored || stored.version !== 2 || !Array.isArray(stored.clips)) return null;
  return hydrateEditorProject(stored, options);
}

export async function getEditorProjectMetadataById(id: string) {
  const database = await openMediaDatabase();
  try {
    return await readStoredProject(database, id) || null;
  } finally {
    database.close();
  }
}

export async function listEditorProjects() {
  const database = await openMediaDatabase();
  const projects = await new Promise<EditorProject[]>((resolve, reject) => {
    const request = database.transaction(PROJECT_STORE_NAME, "readonly").objectStore(PROJECT_STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result || []) as EditorProject[]);
    request.onerror = () => reject(request.error || new Error("读取项目历史失败"));
  });
  database.close();
  return projects.filter((project) => project?.version === 2 && Array.isArray(project.clips)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
}

export async function activateEditorProject(id: string) {
  const database = await openMediaDatabase();
  const stored = await new Promise<EditorProject | undefined>((resolve, reject) => {
    const request = database.transaction(PROJECT_STORE_NAME, "readonly").objectStore(PROJECT_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as EditorProject | undefined);
    request.onerror = () => reject(request.error || new Error("读取项目失败"));
  });
  database.close();
  if (!stored) throw new Error("项目不存在或已被删除");
  // Keep activation tiny. Large projects no longer need to be serialized into
  // localStorage before navigation; the editor reads the project by id from IDB.
  localStorage.setItem(ACTIVE_PROJECT_KEY, stored.id);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, clips: stored.clips.map((clip) => ({ ...clip, url: clip.url?.startsWith("blob:") ? undefined : clip.url })), finalVideo: stored.finalVideo?.url?.startsWith("blob:") ? { mediaId: stored.finalVideo.mediaId } : stored.finalVideo })); } catch { /* active id is sufficient */ }
  localStorage.setItem("manjing-editor-handoff-ready", new Date().toISOString());
  return stored;
}

export async function deleteEditorProject(id: string) {
  const database = await openMediaDatabase();
  try {
    const target = await readStoredProject(database, id);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE_NAME, "readwrite");
      transaction.objectStore(PROJECT_STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("删除项目失败"));
    });
    await removeUnreferencedMedia(database, projectMediaIds(target));
    try {
      const active = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as EditorProject | null;
      if (active?.id === id) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem("manjing-editor-handoff-ready");
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    if (localStorage.getItem(ACTIVE_PROJECT_KEY) === id) localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } finally {
    database.close();
  }
}
