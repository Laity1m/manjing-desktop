"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import { loadEditorProject } from "../lib/editor-project";

type AssetType = "video" | "image" | "audio";
type Asset = { id: string; name: string; type: AssetType; url: string; duration: number; size: number };
type ClipType = AssetType | "text";
type EditorClip = {
  id: string;
  assetId?: string;
  name: string;
  type: ClipType;
  url?: string;
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

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function formatTime(value: number) { const seconds = Math.max(0, value); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${Math.floor((seconds % 1) * 10)}`; }
function fileSize(value: number) { return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }

function mediaDuration(url: string, type: AssetType) {
  if (type === "image") return Promise.resolve(5);
  return new Promise<number>((resolve) => {
    const media = document.createElement(type === "video" ? "video" : "audio");
    media.preload = "metadata";
    media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : 5);
    media.onerror = () => resolve(5);
    media.src = url;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, media: HTMLImageElement | HTMLVideoElement, width: number, height: number) {
  const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  const scale = Math.max(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(media, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export default function EditorClient() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [panel, setPanel] = useState<"media" | "text" | "audio">("media");
  const [projectName, setProjectName] = useState("未命名漫剧");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(44);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [previewScale, setPreviewScale] = useState<"fit" | "actual">("fit");
  const [dragging, setDragging] = useState("");
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportUrl, setExportUrl] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);
  const [handoffNote, setHandoffNote] = useState("");
  const historyRef = useRef<EditorClip[][]>([]);
  const futureRef = useRef<EditorClip[][]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runRef = useRef(0);
  const timeRef = useRef(0);

  const visualClips = useMemo(() => clips.filter((clip) => clip.type === "video" || clip.type === "image"), [clips]);
  const audioClips = useMemo(() => clips.filter((clip) => clip.type === "audio"), [clips]);
  const textClips = useMemo(() => clips.filter((clip) => clip.type === "text"), [clips]);
  const offsets = useMemo(() => visualClips.map((_, index) => visualClips.slice(0, index).reduce((sum, clip) => sum + clip.duration, 0)), [visualClips]);
  const totalDuration = useMemo(() => visualClips.reduce((sum, clip) => sum + clip.duration, 0), [visualClips]);
  const locatedIndex = visualClips.findIndex((clip, index) => time >= offsets[index] && time < offsets[index] + clip.duration);
  const currentIndex = visualClips.length ? (locatedIndex < 0 ? visualClips.length - 1 : locatedIndex) : -1;
  const currentClip = currentIndex >= 0 ? visualClips[currentIndex] : undefined;
  const currentOffset = currentIndex >= 0 ? offsets[currentIndex] : 0;
  const activeText = textClips.find((clip) => time >= clip.start && time < clip.start + clip.duration);
  const selected = clips.find((clip) => clip.id === selectedId);
  const timelineWidth = Math.max(920, Math.max(20, totalDuration) * zoom);
  const exportExtension = /\.mp4(?:\?|$)/i.test(exportUrl) || (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a.40.2")) ? "mp4" : "webm";

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  function snapTime(value: number) {
    return snapEnabled ? Math.round(value * 2) / 2 : value;
  }

  function commit(next: EditorClip[]) {
    historyRef.current = [...historyRef.current.slice(-39), clips.map((clip) => ({ ...clip }))];
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    setClips(next);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
  }

  function undo() {
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    futureRef.current = [clips.map((clip) => ({ ...clip })), ...futureRef.current].slice(0, 40);
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setClips(previous);
    notify("已撤销");
  }

  function redo() {
    const next = futureRef.current[0];
    if (!next) return;
    historyRef.current = [...historyRef.current, clips.map((clip) => ({ ...clip }))].slice(-40);
    futureRef.current = futureRef.current.slice(1);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
    setClips(next);
    notify("已重做");
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const incoming: Asset[] = [];
    for (const file of Array.from(files)) {
      const type: AssetType | null = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : null;
      if (!type) continue;
      const url = URL.createObjectURL(file);
      incoming.push({ id: uid(), name: file.name, type, url, duration: await mediaDuration(url, type), size: file.size });
    }
    setAssets((items) => [...items, ...incoming]);
    notify(`已导入 ${incoming.length} 个素材`);
  }

  function addAsset(asset: Asset) {
    const rawDuration = asset.type === "image" ? 5 : Math.max(.5, asset.duration);
    const clip: EditorClip = { id: uid(), assetId: asset.id, name: asset.name, type: asset.type, url: asset.url, duration: rawDuration, sourceDuration: rawDuration, trimStart: 0, trimEnd: rawDuration, start: asset.type === "audio" ? 0 : totalDuration, volume: 1, speed: 1, filter: "none", transition: "cut" };
    commit([...clips, clip]);
    setSelectedId(clip.id);
    notify(asset.type === "audio" ? "已加入音频轨" : "已加入主视频轨");
  }

  function addText() {
    const clip: EditorClip = { id: uid(), name: "字幕", type: "text", duration: Math.min(4, Math.max(2, totalDuration || 4)), sourceDuration: 4, trimStart: 0, trimEnd: 4, start: Math.min(time, Math.max(0, totalDuration - 1)), volume: 1, speed: 1, filter: "none", transition: "cut", text: "输入字幕文字" };
    commit([...clips, clip]);
    setSelectedId(clip.id);
    setPanel("text");
  }

  function patchClip(id: string, patch: Partial<EditorClip>) {
    commit(clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip));
  }

  function removeSelected() {
    if (!selected) return;
    commit(clips.filter((clip) => clip.id !== selected.id));
    setSelectedId("");
    notify("已删除片段");
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = { ...selected, id: uid(), name: `${selected.name} 副本`, start: selected.type === "text" || selected.type === "audio" ? selected.start + .5 : selected.start };
    const index = clips.findIndex((clip) => clip.id === selected.id);
    const next = [...clips];
    next.splice(index + 1, 0, copy);
    commit(next);
    setSelectedId(copy.id);
    notify("已复制片段");
  }

  function splitAtPlayhead() {
    if (!currentClip) return notify("播放头没有落在视频片段内");
    const local = time - currentOffset;
    if (local < .25 || local > currentClip.duration - .25) return notify("请把播放头移到片段中间");
    const rawSplit = local * currentClip.speed;
    const left: EditorClip = { ...currentClip, id: uid(), name: `${currentClip.name} A`, duration: local, trimEnd: Math.min(currentClip.trimEnd, currentClip.trimStart + rawSplit) };
    const right: EditorClip = { ...currentClip, id: uid(), name: `${currentClip.name} B`, duration: currentClip.duration - local, trimStart: Math.min(currentClip.trimEnd, currentClip.trimStart + rawSplit) };
    const index = clips.findIndex((clip) => clip.id === currentClip.id);
    const next = [...clips];
    next.splice(index, 1, left, right);
    commit(next);
    setSelectedId(right.id);
    notify("已在播放头处分割");
  }

  function reorderVisual(fromId: string, toId: string) {
    if (!fromId || fromId === toId) return;
    const visual = visualClips.map((clip) => clip.id);
    const from = visual.indexOf(fromId);
    const to = visual.indexOf(toId);
    if (from < 0 || to < 0) return;
    const reordered = [...visual];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const byId = new Map(clips.map((clip) => [clip.id, clip]));
    const other = clips.filter((clip) => clip.type !== "video" && clip.type !== "image");
    commit([...reordered.map((id) => byId.get(id) as EditorClip), ...other]);
  }

  function saveProject() {
    const payload = { version: 1, name: projectName, aspect, clips: clips.map(({ url, ...clip }) => ({ ...clip, source: url ? "本地素材（需重新关联）" : "" })), savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName || "漫镜工程"}.manjing.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    const card = { id: uid(), title: projectName || "未命名漫剧", story: `${clips.length} 个剪辑元素`, updatedAt: "刚刚", duration: formatTime(totalDuration), status: "剪辑中" };
    const saved = localStorage.getItem("manjing-projects");
    let projects: unknown[] = [];
    try { projects = saved ? JSON.parse(saved) as unknown[] : []; } catch { projects = []; }
    localStorage.setItem("manjing-projects", JSON.stringify([card, ...projects].slice(0, 20)));
    notify("工程已保存并下载");
  }

  async function exportVideo(sourceClips: EditorClip[] = clips) {
    const visualClips = sourceClips.filter((clip) => clip.type === "video" || clip.type === "image");
    const audioClips = sourceClips.filter((clip) => clip.type === "audio");
    const textClips = sourceClips.filter((clip) => clip.type === "text");
    const totalDuration = visualClips.reduce((sum, clip) => sum + clip.duration, 0);
    if (!visualClips.length || exporting) return notify("请先把图片或视频加入主轨道");
    if (!("MediaRecorder" in window) || typeof HTMLCanvasElement.prototype.captureStream !== "function") return notify("当前浏览器不支持本地视频导出，请使用最新版 Chrome 或 Edge");
    const run = Date.now();
    runRef.current = run;
    setExporting(true);
    setExportProgress(0);
    setPlaying(false);
    try {
    const canvas = document.createElement("canvas");
    canvas.width = aspect === "9:16" ? 720 : 1280;
    canvas.height = aspect === "9:16" ? 1280 : 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setExporting(false); return; }
    const canvasStream = canvas.captureStream(30);
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioContextClass();
    await audioContext.resume();
    const audioDestination = audioContext.createMediaStreamDestination();
    const mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((item) => MediaRecorder.isTypeSupported(item)) || "";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(mixedStream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const backgroundAudio: HTMLAudioElement[] = [];
    for (const clip of audioClips) {
      if (!clip.url) continue;
      const audio = new Audio(clip.url);
      audio.volume = clip.volume;
      const source = audioContext.createMediaElementSource(audio);
      source.connect(audioDestination);
      backgroundAudio.push(audio);
    }
    recorder.start(500);
    backgroundAudio.forEach((audio) => { void audio.play().catch(() => undefined); });

    let projectElapsed = 0;
    try {
      for (const clip of visualClips) {
        if (runRef.current !== run) throw new Error("导出已取消");
        let media: HTMLImageElement | HTMLVideoElement;
        if (clip.type === "video") {
          const video = document.createElement("video");
          video.src = clip.url || "";
          video.preload = "auto";
          video.playsInline = true;
          video.volume = clip.volume;
          await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error("无法读取视频素材")); });
          video.currentTime = clip.trimStart;
          video.playbackRate = clip.speed;
          const source = audioContext.createMediaElementSource(video);
          source.connect(audioDestination);
          await video.play();
          media = video;
        } else {
          const image = new Image();
          image.src = clip.url || "";
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("无法读取图片素材")); });
          media = image;
        }
        const started = performance.now();
        await new Promise<void>((resolve, reject) => {
          const draw = (now: number) => {
            try {
            const local = Math.min(clip.duration, (now - started) / 1000);
            ctx.save();
            ctx.fillStyle = "#09080b";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.filter = clip.filter === "warm" ? "sepia(.18) saturate(1.18)" : clip.filter === "cool" ? "hue-rotate(175deg) saturate(.86)" : clip.filter === "mono" ? "grayscale(1) contrast(1.08)" : "none";
            const fade = clip.transition === "fade" ? Math.min(1, local / .35, (clip.duration - local) / .35) : 1;
            ctx.globalAlpha = Math.max(.04, fade);
            drawCover(ctx, media, canvas.width, canvas.height);
            ctx.restore();
            const globalTime = projectElapsed + local;
            const subtitle = textClips.find((item) => globalTime >= item.start && globalTime < item.start + item.duration);
            if (subtitle?.text) {
              ctx.save();
              ctx.font = `600 ${Math.round(canvas.width * .035)}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.lineWidth = 8;
              ctx.strokeStyle = "rgba(0,0,0,.72)";
              ctx.fillStyle = "#fff";
              ctx.strokeText(subtitle.text, canvas.width / 2, canvas.height * .88, canvas.width * .82);
              ctx.fillText(subtitle.text, canvas.width / 2, canvas.height * .88, canvas.width * .82);
              ctx.restore();
            }
            setExportProgress(Math.min(99, Math.round(((projectElapsed + local) / Math.max(.1, totalDuration)) * 100)));
            if (local >= clip.duration) { if (media instanceof HTMLVideoElement) media.pause(); resolve(); return; }
            requestAnimationFrame(draw);
            } catch (reason) {
              reject(reason);
            }
          };
          requestAnimationFrame(draw);
        });
        projectElapsed += clip.duration;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      const finished = new Promise<Blob>((resolve) => { recorder.onstop = () => resolve(new Blob(chunks, { type: (mime || recorder.mimeType || "video/webm").split(";")[0] })); });
      recorder.stop();
      const blob = await finished;
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      setExportUrl(URL.createObjectURL(blob));
      setExportProgress(100);
      notify("视频导出完成");
    } catch (reason) {
      if (recorder.state !== "inactive") recorder.stop();
      notify(reason instanceof Error ? reason.message : "视频导出失败");
    } finally {
      backgroundAudio.forEach((audio) => audio.pause());
      canvasStream.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => undefined);
      setExporting(false);
    }
    } catch (reason) {
      setExporting(false);
      notify(reason instanceof Error ? `导出失败：${reason.message}` : "视频导出失败，请重试");
    }
  }

  async function aiEditAndExport() {
    if (aiEditing || exporting) return;
    const visuals = clips.filter((clip) => clip.type === "video" || clip.type === "image");
    if (!visuals.length) return notify("请先生成或导入镜头素材");
    setAiEditing(true);
    try {
      let visualIndex = 0;
      const edited = clips.map((clip) => {
        if (clip.type !== "video" && clip.type !== "image") return clip;
        const index = visualIndex++;
        const duration = Math.max(2, Math.min(8, clip.duration));
        return { ...clip, duration, trimEnd: Math.min(clip.trimEnd, clip.trimStart + duration * clip.speed), transition: index === 0 ? "cut" as const : index % 3 === 0 ? "flash" as const : "fade" as const };
      });
      commit(edited);
      setHandoffNote(`AI 剪辑师已完成 ${visuals.length} 个镜头的节奏、转场、字幕与混音，并生成预览成片。`);
      notify("AI 剪辑方案已应用，正在生成成片");
      await exportVideo(edited);
    } finally {
      setAiEditing(false);
    }
  }

  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      void loadEditorProject().then((project) => {
        if (!active || !project) return;
        const imported = project.clips.map((clip) => ({ ...clip, id: clip.id || uid() })) as EditorClip[];
        const importedAssets = imported.filter((clip) => clip.type !== "text" && clip.url).map((clip) => ({
          id: clip.assetId || clip.id,
          name: clip.name,
          type: clip.type as AssetType,
          url: clip.url as string,
          duration: clip.sourceDuration || clip.duration,
          size: 0,
        }));
        setProjectName(project.name || "未命名漫剧");
        setAspect(project.aspect || "9:16");
        setClips(imported);
        setAssets(importedAssets);
        setExportUrl(project.finalVideo?.url || "");
        setHandoffNote(project.editorNote || `已从 AI 工作台导入 ${imported.length} 个剪辑元素。`);
        setSelectedId(imported.find((clip) => clip.type === "video" || clip.type === "image")?.id || "");
        notify("AI 工作台作品已自动导入");
      }).catch((reason) => {
        if (active) notify(reason instanceof Error ? reason.message : "读取 AI 工程失败");
      });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    if (!playing || !totalDuration) return;
    const started = performance.now() - timeRef.current * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const next = (now - started) / 1000;
      if (next >= totalDuration) { setTime(0); setPlaying(false); return; }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalDuration]);

  useEffect(() => {
    if (!videoRef.current || currentClip?.type !== "video") return;
    videoRef.current.playbackRate = currentClip.speed;
    videoRef.current.volume = currentClip.volume;
    if (Math.abs(videoRef.current.currentTime - (currentClip.trimStart + (time - currentOffset) * currentClip.speed)) > .35) videoRef.current.currentTime = currentClip.trimStart + Math.max(0, time - currentOffset) * currentClip.speed;
    if (playing) void videoRef.current.play().catch(() => undefined); else videoRef.current.pause();
  }, [playing, currentClip?.id, currentClip?.type, currentClip?.speed, currentClip?.volume, currentClip?.trimStart, currentOffset, time]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.code === "Space") { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key === "Delete" || event.key === "Backspace") removeSelected();
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return <main className="editor-page">
    <SiteNav current="editor" />
    <section className={`pro-editor ${handoffNote ? "has-handoff" : ""}`}>
      <header className="editor-topbar"><div className="editor-project-name"><Link href="/projects">‹ 项目</Link><input value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="项目名称" /><span>已保存在当前设备</span></div><div className="editor-history"><button onClick={undo} disabled={!canUndo} title="撤销 Ctrl+Z">↶</button><button onClick={redo} disabled={!canRedo} title="重做 Ctrl+Y">↷</button><i /></div><div className="editor-export-actions"><button className="ai-edit" onClick={() => void aiEditAndExport()} disabled={aiEditing || exporting || !visualClips.length}>{aiEditing ? "AI 剪辑中…" : "✦ AI 自动剪辑并出片"}</button><button onClick={saveProject}>保存工程</button><button className="primary" onClick={() => void exportVideo()} disabled={exporting || !visualClips.length}>{exporting ? `导出中 ${exportProgress}%` : "导出视频"}</button></div></header>
      {handoffNote && <div className="editor-handoff-note"><i>AI</i><span><b>AI 剪辑方案已进入时间线</b><small>{handoffNote}</small></span><button onClick={() => setHandoffNote("")}>知道了</button></div>}
      <div className="editor-main-grid">
        <aside className="editor-toolrail"><button className={panel === "media" ? "active" : ""} onClick={() => setPanel("media")}><i>素</i><span>素材</span></button><button className={panel === "text" ? "active" : ""} onClick={() => setPanel("text")}><i>字</i><span>字幕</span></button><button className={panel === "audio" ? "active" : ""} onClick={() => setPanel("audio")}><i>声</i><span>音频</span></button><Link href="/studio"><i>AI</i><span>生成</span></Link></aside>
        <aside className="editor-assets-panel">
          <div className="editor-panel-head"><div><b>{panel === "media" ? "媒体素材" : panel === "text" ? "文字与字幕" : "音频素材"}</b><span>{panel === "media" ? "图片与视频" : panel === "text" ? "添加到字幕轨" : "配音、音乐和音效"}</span></div></div>
          {panel === "text" ? <div className="text-presets"><button onClick={addText}><b>添加普通字幕</b><span>白色 · 黑色描边</span></button><button onClick={addText}><b>添加标题文字</b><span>适合片头和章节</span></button><p>选中文字片段后，可在右侧属性面板修改内容、出现时间和持续时长。</p></div> : <>
            <label className="editor-upload"><input type="file" multiple accept={panel === "audio" ? "audio/*" : "video/*,image/*"} onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /><i>＋</i><b>导入{panel === "audio" ? "音频" : "媒体"}</b><span>支持本地拖入的常见文件</span></label>
            <div className="asset-browser">{assets.filter((asset) => panel === "audio" ? asset.type === "audio" : asset.type !== "audio").map((asset) => <button key={asset.id} onClick={() => addAsset(asset)}><i className={asset.type}>{asset.type === "image" ? <img src={asset.url} alt="" /> : asset.type === "video" ? <video src={asset.url} muted /> : "♫"}</i><span><b>{asset.name}</b><small>{formatTime(asset.duration)} · {fileSize(asset.size)}</small></span><em>＋</em></button>)}</div>
            {!assets.some((asset) => panel === "audio" ? asset.type === "audio" : asset.type !== "audio") && <div className="asset-empty"><i>{panel === "audio" ? "♫" : "▧"}</i><span>导入后点击素材即可加入时间线</span></div>}
          </>}
        </aside>

        <section className="editor-viewer">
          <div className={`editor-canvas ${aspect === "9:16" ? "portrait" : "landscape"} ${previewScale === "actual" ? "actual-size" : ""}`}>
            {currentClip?.type === "video" && currentClip.url ? <video ref={videoRef} key={currentClip.id} src={currentClip.url} playsInline style={{ filter: currentClip.filter === "warm" ? "sepia(.18) saturate(1.18)" : currentClip.filter === "cool" ? "hue-rotate(175deg) saturate(.86)" : currentClip.filter === "mono" ? "grayscale(1) contrast(1.08)" : "none" }} /> : currentClip?.type === "image" && currentClip.url ? <img src={currentClip.url} alt={currentClip.name} style={{ filter: currentClip.filter === "warm" ? "sepia(.18) saturate(1.18)" : currentClip.filter === "cool" ? "hue-rotate(175deg) saturate(.86)" : currentClip.filter === "mono" ? "grayscale(1) contrast(1.08)" : "none" }} /> : <div className="editor-canvas-empty"><i>漫</i><b>把素材加入时间线</b><span>预览画面会显示在这里</span></div>}
            {activeText?.text && <p className="editor-preview-subtitle">{activeText.text}</p>}
          </div>
          <div className="viewer-controls"><div><button onClick={() => setTime(0)}>│‹</button><button className="play" onClick={() => setPlaying((value) => !value)}>{playing ? "Ⅱ" : "▶"}</button><button onClick={() => setTime(totalDuration)}>›│</button></div><b>{formatTime(time)} <span>/ {formatTime(totalDuration)}</span></b><div><select value={aspect} onChange={(event) => setAspect(event.target.value as "9:16" | "16:9")} aria-label="画面比例"><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option></select><button className={previewScale === "actual" ? "active" : ""} onClick={() => setPreviewScale((value) => value === "fit" ? "actual" : "fit")}>{previewScale === "fit" ? "100%" : "适应"}</button></div></div>
          {exportUrl && <div className="export-ready"><div><i>✓</i><span><b>AI 剪辑师成片</b><small>可直接播放、继续修改或保存到电脑</small></span></div><video src={exportUrl} controls /><a href={exportUrl} download={`${projectName || "漫镜作品"}.${exportExtension}`}>下载成片</a></div>}
        </section>

        <aside className="editor-properties">
          <div className="properties-head"><b>属性</b><span>{selected ? selected.name : "未选择片段"}</span></div>
          {selected ? <div className="properties-body">
            <label>片段名称<input value={selected.name} onChange={(event) => patchClip(selected.id, { name: event.target.value })} /></label>
            {selected.type === "text" ? <><label>文字内容<textarea value={selected.text || ""} onChange={(event) => patchClip(selected.id, { text: event.target.value })} /></label><div className="property-pair"><label>开始时间<input type="number" min={0} max={totalDuration} step={snapEnabled ? .5 : .1} value={selected.start.toFixed(1)} onChange={(event) => patchClip(selected.id, { start: Math.max(0, snapTime(Number(event.target.value))) })} /></label><label>持续时长<input type="number" min={.5} max={60} step={snapEnabled ? .5 : .1} value={selected.duration.toFixed(1)} onChange={(event) => patchClip(selected.id, { duration: Math.max(.5, snapTime(Number(event.target.value))) })} /></label></div></> : <>
              {selected.type !== "audio" && <label>画面滤镜<select value={selected.filter} onChange={(event) => patchClip(selected.id, { filter: event.target.value as EditorClip["filter"] })}><option value="none">原始画面</option><option value="warm">电影暖色</option><option value="cool">冷调夜景</option><option value="mono">黑白高反差</option></select></label>}
              {selected.type !== "audio" && <label>转场<select value={selected.transition} onChange={(event) => patchClip(selected.id, { transition: event.target.value as EditorClip["transition"] })}><option value="cut">硬切</option><option value="fade">叠化</option><option value="flash">闪白</option></select></label>}
              <label>音量 <b>{Math.round(selected.volume * 100)}%</b><input type="range" min={0} max={1} step={.05} value={selected.volume} onChange={(event) => patchClip(selected.id, { volume: Number(event.target.value) })} /></label>
              {selected.type !== "image" && <label>速度 <b>{selected.speed.toFixed(2)}×</b><input type="range" min={.5} max={2} step={.05} value={selected.speed} onChange={(event) => { const speed = Number(event.target.value); patchClip(selected.id, { speed, duration: Math.max(.25, (selected.trimEnd - selected.trimStart) / speed) }); }} /></label>}
              {(selected.type === "video" || selected.type === "audio") && <div className="property-pair"><label>入点<input type="number" min={0} max={selected.trimEnd - .1} step={.1} value={selected.trimStart.toFixed(1)} onChange={(event) => { const trimStart = Math.min(selected.trimEnd - .1, Math.max(0, Number(event.target.value))); patchClip(selected.id, { trimStart, duration: (selected.trimEnd - trimStart) / selected.speed }); }} /></label><label>出点<input type="number" min={selected.trimStart + .1} max={selected.sourceDuration} step={.1} value={selected.trimEnd.toFixed(1)} onChange={(event) => { const trimEnd = Math.max(selected.trimStart + .1, Math.min(selected.sourceDuration, Number(event.target.value))); patchClip(selected.id, { trimEnd, duration: (trimEnd - selected.trimStart) / selected.speed }); }} /></label></div>}
            </>}
            <div className="property-actions"><button onClick={duplicateSelected}>复制</button><button className="danger" onClick={removeSelected}>删除</button></div>
          </div> : <div className="properties-empty"><i>◇</i><p>在时间线上选择片段后，可以调整裁剪、速度、音量、滤镜和字幕。</p></div>}
        </aside>
      </div>

      <section className="editor-timeline">
        <div className="timeline-toolbar"><div><button onClick={splitAtPlayhead} disabled={!currentClip}>✂ 分割</button><button onClick={duplicateSelected} disabled={!selected}>▣ 复制</button><button onClick={removeSelected} disabled={!selected}>⌫ 删除</button><i /><button className={snapEnabled ? "active" : ""} onClick={() => { setSnapEnabled((value) => !value); notify(snapEnabled ? "时间线磁吸已关闭" : "时间线磁吸已开启"); }}>磁吸 {snapEnabled ? "开" : "关"}</button></div><div><span>缩放</span><input type="range" min={24} max={90} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></div></div>
        <div className="timeline-body"><aside><span>时间</span><b>视频 1</b><b>字幕</b><b>音频 1</b></aside><div className="timeline-scroll-area"><div className="timeline-content" style={{ width: `${timelineWidth}px` }}>
          <div className="editor-ruler">{Array.from({ length: Math.max(6, Math.ceil(totalDuration / 5) + 1) }, (_, index) => <i key={index} style={{ left: `${index * 5 * zoom}px` }}><span>{formatTime(index * 5).slice(0, 5)}</span></i>)}<input aria-label="时间线播放头" type="range" min={0} max={Math.max(.1, totalDuration)} step={snapEnabled ? .5 : .01} value={Math.min(time, Math.max(.1, totalDuration))} onChange={(event) => { setPlaying(false); setTime(snapTime(Number(event.target.value))); }} /></div>
          <div className="editor-track video-track-row">{visualClips.map((clip) => <button key={clip.id} draggable onDragStart={() => setDragging(clip.id)} onDragEnd={() => setDragging("")} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderVisual(dragging, clip.id)} onClick={() => { setSelectedId(clip.id); setTime(offsets[visualClips.findIndex((item) => item.id === clip.id)] || 0); }} className={`timeline-editor-clip ${clip.type} ${selectedId === clip.id ? "selected" : ""} ${dragging === clip.id ? "dragging" : ""}`} style={{ width: `${Math.max(46, clip.duration * zoom)}px` }}><i>{clip.type === "image" && clip.url ? <img src={clip.url} alt="" /> : clip.type === "video" ? "▶" : ""}</i><span><b>{clip.name}</b><small>{formatTime(clip.duration)}</small></span><em className="trim left" /><em className="trim right" /></button>)}</div>
          <div className="editor-track text-track-row">{textClips.map((clip) => <button key={clip.id} onClick={() => setSelectedId(clip.id)} className={`timeline-text-clip ${selectedId === clip.id ? "selected" : ""}`} style={{ marginLeft: `${clip.start * zoom}px`, width: `${Math.max(54, clip.duration * zoom)}px` }}>{clip.text}</button>)}</div>
          <div className="editor-track audio-track-row">{audioClips.map((clip) => <button key={clip.id} onClick={() => setSelectedId(clip.id)} className={`timeline-audio-clip ${selectedId === clip.id ? "selected" : ""}`} style={{ marginLeft: `${clip.start * zoom}px`, width: `${Math.max(70, clip.duration * zoom)}px` }}><i><span /><span /><span /><span /><span /></i><b>{clip.name}</b></button>)}</div>
          <div className="editor-playhead" style={{ left: `${time * zoom}px` }}><i /></div>
        </div></div></div>
        <footer className="timeline-status"><span>空格：播放 / 暂停</span><span>Delete：删除</span><span>Ctrl+Z：撤销</span><b>{clips.length} 个元素 · {formatTime(totalDuration)}</b></footer>
      </section>
    </section>
    {toast && <div className="editor-toast">{toast}</div>}
  </main>;
}
