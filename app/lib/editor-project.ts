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
  source: "studio" | "libtv" | "manual";
  createdAt: string;
  clips: EditorProjectClip[];
  finalVideo?: { url?: string; mediaId?: string };
  editorNote?: string;
};

const STORAGE_KEY = "manjing-editor-handoff";
const DATABASE_NAME = "manjing-media-v1";
const STORE_NAME = "media";

function openMediaDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地素材库"));
  });
}

async function storeMedia(blob: Blob) {
  const database = await openMediaDatabase();
  const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(blob, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("保存本地素材失败"));
  });
  database.close();
  return id;
}

async function readMedia(id: string) {
  const database = await openMediaDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error || new Error("读取本地素材失败"));
  });
  database.close();
  return blob;
}

async function persistUrl(url?: string) {
  if (!url) return {};
  if (!url.startsWith("blob:") && !url.startsWith("data:")) return { url };
  try {
    const response = await fetch(url);
    if (!response.ok) return { url };
    return { mediaId: await storeMedia(await response.blob()) };
  } catch {
    return { url };
  }
}

export async function persistEditorProject(project: Omit<EditorProject, "version" | "createdAt">) {
  const clips = await Promise.all(project.clips.map(async (clip) => ({ ...clip, ...(await persistUrl(clip.url)), url: clip.url?.startsWith("blob:") || clip.url?.startsWith("data:") ? undefined : clip.url })));
  const finalReference = await persistUrl(project.finalVideo?.url);
  const stored: EditorProject = {
    ...project,
    version: 2,
    createdAt: new Date().toISOString(),
    clips,
    finalVideo: project.finalVideo ? finalReference : undefined,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  localStorage.setItem("manjing-editor-handoff-ready", stored.createdAt);
  return stored;
}

export async function loadEditorProject() {
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
  const clips = await Promise.all(stored.clips.map(async (clip) => {
    if (!clip.mediaId) return clip;
    const blob = await readMedia(clip.mediaId).catch(() => undefined);
    return blob ? { ...clip, url: URL.createObjectURL(blob) } : clip;
  }));
  let finalVideo = stored.finalVideo;
  if (finalVideo?.mediaId) {
    const blob = await readMedia(finalVideo.mediaId).catch(() => undefined);
    if (blob) finalVideo = { ...finalVideo, url: URL.createObjectURL(blob) };
  }
  return { ...stored, clips, finalVideo };
}
