"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { getEditorProjectMetadataById } from "../lib/editor-project";
import {
  ACTIVE_CANVAS_KEY,
  CANVAS_STORAGE_KEY,
  createProductionCanvas,
  loadProductionCanvases,
  saveProductionCanvases,
  type ProductionCanvas,
  type ProductionCanvasNode,
  type ProductionNodeType,
} from "../lib/production-canvas";

const NODE_LABELS: Record<ProductionNodeType, { name: string; icon: string; hint: string }> = {
  script: { name: "剧本", icon: "文", hint: "故事、台词与提示词" },
  character: { name: "角色", icon: "角", hint: "人物设定与一致性" },
  scene: { name: "分镜", icon: "镜", hint: "镜头设计与调度" },
  image: { name: "图片", icon: "图", hint: "关键帧与参考图" },
  video: { name: "视频", icon: "影", hint: "动态镜头素材" },
  audio: { name: "音频", icon: "声", hint: "配音、音乐与音效" },
  output: { name: "成片", icon: "片", hint: "剪辑与最终交付" },
};

const NODE_WIDTH = 238;
const NODE_HEIGHT = 142;

function makeNode(type: ProductionNodeType, index: number): ProductionCanvasNode {
  return {
    id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title: `${NODE_LABELS[type].name}${type === "scene" ? ` ${String(index + 1).padStart(2, "0")}` : ""}`,
    content: NODE_LABELS[type].hint,
    x: 120 + (index % 4) * 290,
    y: 120 + Math.floor(index / 4) * 190,
    status: "draft",
  };
}

function downloadJson(document: ProductionCanvas) {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.title.replace(/[\\/:*?"<>|]/g, "-")}.manjing-canvas.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CanvasClient() {
  const [canvases, setCanvases] = useState<ProductionCanvas[]>([]);
  const [activeId, setActiveId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [connectingFrom, setConnectingFrom] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("画布会自动保存在当前电脑");
  const [showLibrary, setShowLibrary] = useState(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importMarkerRef = useRef(false);
  const connectingRef = useRef("");
  const dragRef = useRef<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const active = useMemo(() => canvases.find((item) => item.id === activeId) || null, [canvases, activeId]);
  const selected = active?.nodes.find((node) => node.id === selectedId) || null;

  useEffect(() => {
    let list = loadProductionCanvases();
    const requested = new URLSearchParams(window.location.search).get("id") || localStorage.getItem(ACTIVE_CANVAS_KEY) || "";
    if (!list.length) list = [createProductionCanvas("我的第一张制片画布")];
    const nextId = list.some((item) => item.id === requested) ? requested : list[0].id;
    setCanvases(list);
    setActiveId(nextId);
    setSelectedId(list.find((item) => item.id === nextId)?.nodes[0]?.id || "");
    localStorage.setItem(ACTIVE_CANVAS_KEY, nextId);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      saveProductionCanvases(canvases);
      setMessage(`已自动保存 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [canvases, loaded]);

  useEffect(() => {
    if (!loaded || !activeId || importMarkerRef.current) return;
    const projectId = localStorage.getItem("manjing-canvas-import-project") || "";
    if (!projectId) return;
    importMarkerRef.current = true;
    localStorage.removeItem("manjing-canvas-import-project");
    void importCurrentProject(projectId);
  }, [loaded, activeId]);

  useEffect(() => {
    function move(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.startX) / zoom;
      const dy = (event.clientY - drag.startY) / zoom;
      editActive((document) => ({ ...document, nodes: document.nodes.map((node) => node.id === drag.id ? { ...node, x: Math.max(10, drag.nodeX + dx), y: Math.max(10, drag.nodeY + dy) } : node) }));
    }
    function end() { dragRef.current = null; }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  });

  function editActive(update: (document: ProductionCanvas) => ProductionCanvas) {
    setCanvases((items) => items.map((item) => item.id === activeId ? { ...update(item), updatedAt: new Date().toISOString() } : item));
  }

  function newCanvas() {
    const document = createProductionCanvas(`制片画布 ${canvases.length + 1}`);
    const next = [document, ...canvases];
    setCanvases(next);
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(next));
    setActiveId(document.id);
    setSelectedId(document.nodes[0]?.id || "");
    setConnectingFrom("");
    connectingRef.current = "";
    setMessage("新画布已创建并打开");
  }

  function openCanvas(id: string) {
    setActiveId(id);
    setSelectedId(canvases.find((item) => item.id === id)?.nodes[0]?.id || "");
    setConnectingFrom("");
    connectingRef.current = "";
    localStorage.setItem(ACTIVE_CANVAS_KEY, id);
    history.replaceState(null, "", `/canvas?id=${encodeURIComponent(id)}`);
  }

  function addNode(type: ProductionNodeType) {
    if (!active) return;
    const node = makeNode(type, active.nodes.length);
    editActive((document) => ({ ...document, nodes: [...document.nodes, node] }));
    setSelectedId(node.id);
    setMessage(`${NODE_LABELS[type].name}节点已加入画布`);
  }

  function nodeClick(id: string) {
    const source = connectingRef.current || connectingFrom;
    if (source && source !== id) {
      editActive((document) => document.edges.some((edge) => edge.from === source && edge.to === id) ? document : ({ ...document, edges: [...document.edges, { id: `edge-${Date.now().toString(36)}`, from: source, to: id }] }));
      setConnectingFrom("");
      connectingRef.current = "";
      setSelectedId(id);
      setMessage("节点连接已建立");
      return;
    }
    setSelectedId(id);
  }

  function removeNode(id: string) {
    editActive((document) => ({ ...document, nodes: document.nodes.filter((node) => node.id !== id), edges: document.edges.filter((edge) => edge.from !== id && edge.to !== id) }));
    setSelectedId("");
    setConnectingFrom("");
    connectingRef.current = "";
  }

  function duplicateNode(node: ProductionCanvasNode) {
    const copy = { ...node, id: `node-${Date.now().toString(36)}`, title: `${node.title} 副本`, x: node.x + 36, y: node.y + 36 };
    editActive((document) => ({ ...document, nodes: [...document.nodes, copy] }));
    setSelectedId(copy.id);
  }

  async function importCurrentProject(requestedId?: string) {
    const projectId = requestedId || localStorage.getItem("manjing-editor-active-project") || "";
    if (!projectId) { setMessage("当前没有可导入的项目，请先在工作台生成或在项目资产中选择项目"); return; }
    setMessage("正在读取项目索引…");
    try {
      const project = await getEditorProjectMetadataById(projectId);
      if (!project) throw new Error("没有找到当前项目");
      const imported = project.clips.slice(0, 40).map((clip, index) => ({
        id: `node-${Date.now().toString(36)}-${index}`,
        type: (clip.type === "text" ? "script" : clip.type) as ProductionNodeType,
        title: clip.name,
        content: `${clip.type.toUpperCase()} · ${clip.duration.toFixed(1)} 秒${clip.mediaId ? " · 已保存在本机" : ""}`,
        x: 110 + (index % 4) * 290,
        y: 160 + Math.floor(index / 4) * 190,
        status: "ready" as const,
      }));
      editActive((document) => ({ ...document, title: `${project.name} · 制片画布`, nodes: [...document.nodes, ...imported] }));
      setMessage(`已从“${project.name}”导入 ${imported.length} 个资产节点`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "导入项目失败");
    }
  }

  function deleteCanvas() {
    if (!active) return;
    const next = canvases.filter((item) => item.id !== active.id);
    if (!next.length) {
      const document = createProductionCanvas("新的制片画布");
      const fallback = [document];
      setCanvases(fallback);
      localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(fallback));
      setActiveId(document.id);
      setSelectedId(document.nodes[0]?.id || "");
      return;
    }
    setCanvases(next);
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(next));
    setActiveId(next[0].id);
    setSelectedId(next[0].nodes[0]?.id || "");
  }

  function importCanvas(file?: File) {
    if (!file) return;
    void file.text().then((raw) => {
      const parsed = JSON.parse(raw) as ProductionCanvas;
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("不是有效的漫镜画布文件");
      const document = { ...parsed, version: 1 as const, id: `canvas-${Date.now().toString(36)}`, title: `${parsed.title || "导入画布"} · 导入`, updatedAt: new Date().toISOString() };
      setCanvases((items) => [document, ...items]);
      setActiveId(document.id);
      setSelectedId(document.nodes[0]?.id || "");
      setMessage("画布文件已导入");
    }).catch((reason) => setMessage(reason instanceof Error ? reason.message : "导入失败"));
  }

  if (!loaded || !active) return <main className="canvas-page"><SiteNav current="canvas" /><div className="canvas-loading">正在恢复本机画布…</div></main>;

  return <main className="canvas-page">
    <SiteNav current="canvas" />
    <header className="canvas-commandbar">
      <div><button className="canvas-library-toggle" onClick={() => setShowLibrary((value) => !value)}>☰</button><span>制作画布</span><input aria-label="画布名称" value={active.title} onChange={(event) => editActive((document) => ({ ...document, title: event.target.value }))} /></div>
      <nav>{(Object.keys(NODE_LABELS) as ProductionNodeType[]).map((type) => <button key={type} onClick={() => addNode(type)}><i>{NODE_LABELS[type].icon}</i>添加{NODE_LABELS[type].name}</button>)}</nav>
      <aside><button onClick={() => setZoom((value) => Math.max(.5, value - .1))}>－</button><b>{Math.round(zoom * 100)}%</b><button onClick={() => setZoom((value) => Math.min(1.6, value + .1))}>＋</button><button onClick={() => { saveProductionCanvases(canvases); setMessage("已手动保存到本机"); }}>保存</button></aside>
    </header>
    <section className={`canvas-layout ${showLibrary ? "with-library" : ""}`}>
      {showLibrary && <aside className="canvas-library">
        <header><div><span>我的画布</span><h2>制作画布</h2></div><button onClick={newCanvas}>＋ 新建画布</button></header>
        <div className="canvas-list">{canvases.map((item) => <button key={item.id} className={item.id === activeId ? "active" : ""} onClick={() => openCanvas(item.id)}><i>{item.nodes.length}</i><span><b>{item.title}</b><small>{new Date(item.updatedAt).toLocaleString("zh-CN")}</small></span></button>)}</div>
        <div className="canvas-library-actions"><button onClick={() => void importCurrentProject()}>从当前项目导入</button><button onClick={() => fileRef.current?.click()}>导入画布文件</button><input ref={fileRef} type="file" accept=".json,.manjing-canvas.json" onChange={(event) => importCanvas(event.target.files?.[0])} /><button onClick={() => downloadJson(active)}>导出画布 JSON</button><ConfirmButton className="danger" onConfirm={deleteCanvas} ariaLabel={`删除画布${active.title}`} confirmLabel="确认删除画布">删除当前画布</ConfirmButton></div>
        <p>参考 Toonflow / React Flow 的节点式制作逻辑。本机画布不需要 LibTV Key，也不会上传你的内容。</p>
      </aside>}
      <div className="canvas-stage-scroll">
        <div className="canvas-stage" style={{ width: 1800 * zoom, height: 1200 * zoom }}>
          <div className="canvas-transform" style={{ width: 1800, height: 1200, transform: `scale(${zoom})` }}>
            <svg className="canvas-edges" width="1800" height="1200" aria-label="节点连接线">{active.edges.map((edge) => {
              const from = active.nodes.find((node) => node.id === edge.from);
              const to = active.nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_WIDTH; const y1 = from.y + NODE_HEIGHT / 2; const x2 = to.x; const y2 = to.y + NODE_HEIGHT / 2;
              const bend = Math.max(55, Math.abs(x2 - x1) * .45);
              return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} />;
            })}</svg>
            {active.nodes.map((node) => <article key={node.id} className={`production-node ${node.type} ${selectedId === node.id ? "selected" : ""} ${connectingFrom === node.id ? "connecting" : ""}`} style={{ left: node.x, top: node.y }} onClick={() => nodeClick(node.id)}>
              <header onPointerDown={(event) => { event.preventDefault(); dragRef.current = { id: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y }; setSelectedId(node.id); }}><i>{NODE_LABELS[node.type].icon}</i><span>{NODE_LABELS[node.type].name}节点</span><em className={node.status}>{node.status === "ready" ? "已就绪" : node.status === "working" ? "制作中" : "草稿"}</em></header>
              <h3>{node.title}</h3><p>{node.content}</p>
              <footer><button onClick={(event) => { event.stopPropagation(); connectingRef.current = node.id; setConnectingFrom(node.id); setMessage("请点击要连接的目标节点"); }}>{connectingFrom === node.id ? "选择目标…" : "连接节点"}</button><small>拖动顶部移动</small></footer>
            </article>)}
            {connectingFrom && <div className="canvas-connect-tip">连线模式：点击另一个节点完成连接 · <button onClick={() => { connectingRef.current = ""; setConnectingFrom(""); }}>取消</button></div>}
          </div>
        </div>
      </div>
      <aside className="canvas-inspector">
        <header><span>属性</span><h2>节点设置</h2></header>
        {selected ? <div className="canvas-node-form"><label>节点类型<select value={selected.type} onChange={(event) => editActive((document) => ({ ...document, nodes: document.nodes.map((node) => node.id === selected.id ? { ...node, type: event.target.value as ProductionNodeType } : node) }))}>{(Object.keys(NODE_LABELS) as ProductionNodeType[]).map((type) => <option key={type} value={type}>{NODE_LABELS[type].name}</option>)}</select></label><label>标题<input value={selected.title} onChange={(event) => editActive((document) => ({ ...document, nodes: document.nodes.map((node) => node.id === selected.id ? { ...node, title: event.target.value } : node) }))} /></label><label>内容<textarea value={selected.content} onChange={(event) => editActive((document) => ({ ...document, nodes: document.nodes.map((node) => node.id === selected.id ? { ...node, content: event.target.value } : node) }))} /></label><label>状态<select value={selected.status} onChange={(event) => editActive((document) => ({ ...document, nodes: document.nodes.map((node) => node.id === selected.id ? { ...node, status: event.target.value as ProductionCanvasNode["status"] } : node) }))}><option value="draft">草稿</option><option value="working">制作中</option><option value="ready">已就绪</option></select></label><div><button onClick={() => duplicateNode(selected)}>复制节点</button><button className="danger" onClick={() => removeNode(selected.id)}>删除节点</button></div></div> : <p className="canvas-no-selection">点击画布中的节点，即可编辑内容和状态。</p>}
        <section className="canvas-next-actions"><b>继续制作</b><a href="/studio">交给 AI 漫剧工作台</a><a href="/video">生成自主 AI 视频</a><a href="/editor">进入专业剪辑台</a></section>
        <small className="canvas-save-state">{message}</small>
      </aside>
    </section>
  </main>;
}
