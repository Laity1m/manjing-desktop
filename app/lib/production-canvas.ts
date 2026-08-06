export type ProductionNodeType = "script" | "character" | "scene" | "image" | "video" | "audio" | "output";

export type ProductionCanvasNode = {
  id: string;
  type: ProductionNodeType;
  title: string;
  content: string;
  x: number;
  y: number;
  status: "draft" | "ready" | "working";
};

export type ProductionCanvasEdge = {
  id: string;
  from: string;
  to: string;
};

export type ProductionCanvas = {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: ProductionCanvasNode[];
  edges: ProductionCanvasEdge[];
};

export const CANVAS_STORAGE_KEY = "manjing-production-canvases-v1";
export const ACTIVE_CANVAS_KEY = "manjing-production-canvas-active";

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadProductionCanvases(): ProductionCanvas[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(CANVAS_STORAGE_KEY) || "[]") as ProductionCanvas[];
    return Array.isArray(value) ? value.filter((item) => item && item.version === 1 && Array.isArray(item.nodes)) : [];
  } catch {
    return [];
  }
}

export function saveProductionCanvases(canvases: ProductionCanvas[]) {
  localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(canvases));
}

export function createProductionCanvas(title = "未命名制片画布", nodes?: ProductionCanvasNode[], edges?: ProductionCanvasEdge[]) {
  const now = new Date().toISOString();
  const document: ProductionCanvas = {
    version: 1,
    id: id("canvas"),
    title,
    createdAt: now,
    updatedAt: now,
    nodes: nodes || [
      { id: id("node"), type: "script", title: "故事与剧本", content: "双击或在右侧填写故事、人物关系与制作要求。", x: 90, y: 110, status: "draft" },
      { id: id("node"), type: "scene", title: "分镜 01", content: "规划画面、台词、镜头运动和时长。", x: 410, y: 110, status: "draft" },
      { id: id("node"), type: "output", title: "成片交付", content: "把生成的视频与声音连接到这里，再进入剪辑台。", x: 730, y: 110, status: "draft" },
    ],
    edges: edges || [],
  };
  localStorage.setItem(ACTIVE_CANVAS_KEY, document.id);
  return document;
}

export function createCanvasFromStudio(input: {
  title: string;
  story: string;
  characters: Array<{ name?: string; role?: string; appearance?: string }>;
  scenes: Array<{ title?: string; visual?: string; action?: string; dialogue?: string; status?: string }>;
}) {
  const nodes: ProductionCanvasNode[] = [];
  const edges: ProductionCanvasEdge[] = [];
  const scriptId = id("node");
  nodes.push({ id: scriptId, type: "script", title: "故事与剧本", content: input.story || "等待填写故事", x: 70, y: 100, status: input.story ? "ready" : "draft" });
  input.characters.slice(0, 8).forEach((character, index) => {
    const nodeId = id("node");
    nodes.push({ id: nodeId, type: "character", title: character.name || `角色 ${index + 1}`, content: [character.role, character.appearance].filter(Boolean).join("\n") || "等待设定角色", x: 70, y: 310 + index * 180, status: "ready" });
    edges.push({ id: id("edge"), from: scriptId, to: nodeId });
  });
  input.scenes.slice(0, 30).forEach((scene, index) => {
    const nodeId = id("node");
    nodes.push({ id: nodeId, type: "scene", title: scene.title || `分镜 ${String(index + 1).padStart(2, "0")}`, content: [scene.visual, scene.action, scene.dialogue].filter(Boolean).join("\n") || "等待生成分镜", x: 390 + (index % 3) * 300, y: 100 + Math.floor(index / 3) * 190, status: scene.status === "ready" ? "ready" : scene.status === "queued" ? "draft" : "working" });
    edges.push({ id: id("edge"), from: scriptId, to: nodeId });
  });
  if (!input.scenes.length) {
    const sceneId = id("node");
    nodes.push({ id: sceneId, type: "scene", title: "分镜 01", content: "等待生成分镜", x: 390, y: 100, status: "draft" });
    edges.push({ id: id("edge"), from: scriptId, to: sceneId });
  }
  const outputId = id("node");
  nodes.push({ id: outputId, type: "output", title: "成片交付", content: "连接生成的视频、配音和剪辑结果。", x: 1320, y: 100, status: "draft" });
  return createProductionCanvas(input.title ? `${input.title} · 制片画布` : "AI 漫剧制片画布", nodes, edges);
}
