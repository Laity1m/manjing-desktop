"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "community" | "cloud";
type Phase = "idle" | "story" | "images" | "voice" | "ready" | "exporting" | "error";
type SceneStatus = "queued" | "writing" | "painting" | "voicing" | "ready" | "error";
type Scene = {
  id: string;
  title: string;
  visual: string;
  dialogue: string;
  duration: number;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  status: SceneStatus;
  model?: string;
};

const SAMPLE_STORY = "雨夜，女孩在即将关门的旧书店前，遇见了消失三年的恋人。他带着一封从未寄出的信，藏着两人错过彼此的真相。";
const STYLE_PROMPTS: Record<string, string> = {
  "国漫电影感": "cinematic Chinese manhua, elegant facial features, dramatic film lighting, rich atmospheric depth",
  "日系清新": "fresh Japanese anime, soft daylight, delicate line art, airy pastel colors",
  "赛博朋克": "cyberpunk comic, neon city, rain, holographic glow, strong rim light",
  "水墨古风": "Chinese ink wash animation, ancient costume, poetic mist, expressive brush texture",
};
const VOICES = [
  { value: "nova", label: "温柔女声" },
  { value: "coral", label: "叙事女声" },
  { value: "onyx", label: "沉稳男声" },
  { value: "echo", label: "青年男声" },
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function responseError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error || data.message || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

function parseStoryboard(raw: string, targetSeconds: number): { title: string; scenes: Scene[] } {
  const unfenced = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回的剧本格式不完整，请重试");
  let parsed: { title?: unknown; scenes?: unknown };
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的剧本格式不正确，请重试");
  }
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 2) throw new Error("AI 没有生成足够的分镜，请重试");
  const picked = parsed.scenes.slice(0, 6) as Array<Record<string, unknown>>;
  const seconds = Math.max(4, Math.round(targetSeconds / picked.length));
  return {
    title: String(parsed.title || "未命名漫剧").slice(0, 32),
    scenes: picked.map((item, index) => ({
      id: uid(),
      title: String(item.title || `镜头 ${index + 1}`).slice(0, 32),
      visual: String(item.visual || item.description || "电影感人物场景").slice(0, 520),
      dialogue: String(item.dialogue || "……").replace(/^[“\"']|[”\"']$/g, "").slice(0, 120),
      duration: Math.max(4, Math.min(15, Number(item.duration) || seconds)),
      status: "queued",
    })),
  };
}

async function mediaDuration(url: string) {
  return new Promise<number>((resolve) => {
    const audio = new Audio(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
  });
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3) {
  let line = "";
  let row = 0;
  for (const char of text) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + row * lineHeight);
      line = char;
      row += 1;
      if (row >= maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && row < maxLines) ctx.fillText(line, x, y + row * lineHeight);
}

function drawCover(ctx: CanvasRenderingContext2D, media: CanvasImageSource, width: number, height: number, zoom = 1) {
  const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media instanceof HTMLImageElement ? media.naturalWidth : width;
  const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media instanceof HTMLImageElement ? media.naturalHeight : height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * zoom;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(media, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export default function Home() {
  const [story, setStory] = useState(SAMPLE_STORY);
  const [projectTitle, setProjectTitle] = useState("雨夜重逢");
  const [style, setStyle] = useState("国漫电影感");
  const [targetDuration, setTargetDuration] = useState(30);
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [mode, setMode] = useState<Mode>("community");
  const [apiKey, setApiKey] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voice, setVoice] = useState("nova");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("等待创作");
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [exportUrl, setExportUrl] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runRef = useRef(0);

  const totalDuration = useMemo(() => scenes.reduce((sum, item) => sum + item.duration, 0), [scenes]);
  const offsets = useMemo(() => scenes.map((_, index) => scenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0)), [scenes]);
  const currentIndex = scenes.length
    ? Math.max(0, scenes.findIndex((scene, index) => time >= offsets[index] && time < offsets[index] + scene.duration))
    : 0;
  const current = scenes[currentIndex] || scenes[selected];

  useEffect(() => {
    const savedKey = window.localStorage.getItem("manjing-pollinations-key") || "";
    const savedDraft = window.localStorage.getItem("manjing-text-draft");
    if (savedKey.startsWith("pk_")) setApiKey(savedKey);
    if (savedDraft) setStory(savedDraft);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("manjing-text-draft", story);
  }, [story]);

  useEffect(() => {
    if (apiKey.startsWith("pk_")) window.localStorage.setItem("manjing-pollinations-key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (!playing || !totalDuration) return;
    const started = performance.now() - time * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const next = (now - started) / 1000;
      if (next >= totalDuration) {
        setTime(0);
        setPlaying(false);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalDuration]);

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (!playing || !current || !voiceEnabled) return;
    if (current.audioUrl) {
      const audio = new Audio(current.audioUrl);
      audioRef.current = audio;
      void audio.play().catch(() => undefined);
    } else if ("speechSynthesis" in window) {
      const speech = new SpeechSynthesisUtterance(current.dialogue);
      speech.lang = "zh-CN";
      speech.rate = 0.92;
      window.speechSynthesis.speak(speech);
    }
    return () => {
      audioRef.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [currentIndex, playing, voiceEnabled, current]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (playing) void videoRef.current.play().catch(() => undefined);
    else videoRef.current.pause();
  }, [playing, currentIndex]);

  function updateScene(id: string, patch: Partial<Scene>) {
    setScenes((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function startHorde(action: "story" | "image", payload: Record<string, unknown>) {
    const response = await fetch("/api/horde", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return (await response.json()) as { id: string; kind: "text" | "image" };
  }

  async function pollHorde(kind: "text" | "image", id: string, run: number) {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      if (runRef.current !== run) throw new Error("任务已取消");
      const response = await fetch(`/api/horde?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.error) throw new Error(String(data.error || `生成失败（${response.status}）`));
      if (data.done) return data;
      if (kind === "image" && typeof data.wait_time === "number") setStatusText(`社区队列处理中，预计等待 ${data.wait_time} 秒`);
      await wait(kind === "image" ? 4200 : 3000);
    }
    throw new Error("生成等待超时，请稍后重试");
  }

  async function pollinationsStoryboard() {
    const count = Math.max(3, Math.min(6, Math.ceil(targetDuration / 10)));
    const response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model: "openai",
        temperature: 0.7,
        safe: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `你是专业漫剧编剧。把故事拆成恰好 ${count} 个连贯镜头，只返回 JSON。所有内容使用简体中文。结构为 {"title":"标题","scenes":[{"title":"镜头标题","visual":"包含人物动作、景别、灯光的详细画面描述","dialogue":"自然简短的台词","duration":7}]}。不要复述用户原文，要进行真正的剧情改编。` },
          { role: "user", content: `视觉风格：${style}\n目标时长：${targetDuration} 秒\n故事：${story.trim()}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("云端模型没有返回剧本");
    return content;
  }

  async function pollinationsMedia(kind: "image" | "audio" | "video", prompt: string, index = 0) {
    const base = "https://gen.pollinations.ai";
    let url = "";
    if (kind === "image") {
      const size = aspect === "9:16" ? "768&height=1280" : "1280&height=720";
      url = `${base}/image/${encodeURIComponent(prompt)}?model=zimage&width=${size}&seed=${Math.abs(story.length * 97 + index * 7919)}&safe=true`;
    } else if (kind === "audio") {
      url = `${base}/audio/${encodeURIComponent(prompt)}?voice=${encodeURIComponent(voice)}&response_format=mp3&safe=true`;
    } else {
      url = `${base}/video/${encodeURIComponent(prompt)}?model=wan&duration=6&aspectRatio=${encodeURIComponent(aspect)}&audio=true&safe=true`;
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    const expected = kind === "image" ? "image/" : kind === "audio" ? "audio/" : "video/";
    if (!blob.type.startsWith(expected)) throw new Error(`${kind === "image" ? "图片" : kind === "audio" ? "配音" : "视频"}服务返回了无效文件`);
    return URL.createObjectURL(blob);
  }

  async function makeImage(scene: Scene, index: number, run: number) {
    const prompt = `${STYLE_PROMPTS[style]}, ${scene.visual}, same lead character design across every shot, no typography`;
    if (mode === "cloud") return pollinationsMedia("image", prompt, index);
    const task = await startHorde("image", { prompt, aspect });
    const result = await pollHorde("image", task.id, run);
    const remote = String(result.imageUrl || "");
    const response = await fetch(`/api/media?url=${encodeURIComponent(remote)}`);
    if (!response.ok) throw new Error(await responseError(response));
    return URL.createObjectURL(await response.blob());
  }

  async function generateAll() {
    if (story.trim().length < 8 || ["story", "images", "voice", "exporting"].includes(phase)) return;
    if (mode === "cloud" && !apiKey.trim().startsWith("pk_")) {
      setShowKey(true);
      setError("增强模式需要填写以 pk_ 开头的发布密钥");
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setError("");
    setExportUrl("");
    setPlaying(false);
    setTime(0);
    setPhase("story");
    setProgress(5);
    setStatusText("AI 正在理解故事并编写分镜");
    try {
      let raw = "";
      if (mode === "cloud") raw = await pollinationsStoryboard();
      else {
        const task = await startHorde("story", { story: story.trim(), style, count: Math.max(3, Math.min(6, Math.ceil(targetDuration / 10))) });
        const result = await pollHorde("text", task.id, run);
        raw = String(result.text || "");
      }
      const storyboard = parseStoryboard(raw, targetDuration);
      setProjectTitle(storyboard.title);
      let work = storyboard.scenes;
      setScenes(work);
      setSelected(0);
      setPhase("images");
      for (let index = 0; index < work.length; index += 1) {
        const scene = work[index];
        setStatusText(`正在生成第 ${index + 1}/${work.length} 个真实画面`);
        updateScene(scene.id, { status: "painting" });
        const imageUrl = await makeImage(scene, index, run);
        work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl, status: "ready" as SceneStatus } : item));
        setScenes(work);
        setProgress(18 + Math.round(((index + 1) / work.length) * (voiceEnabled && mode === "cloud" ? 52 : 76)));
      }
      if (voiceEnabled && mode === "cloud") {
        setPhase("voice");
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          setStatusText(`正在合成第 ${index + 1}/${work.length} 段中文配音`);
          updateScene(scene.id, { status: "voicing" });
          const audioUrl = await pollinationsMedia("audio", scene.dialogue, index);
          const audioSeconds = await mediaDuration(audioUrl);
          work = work.map((item) => item.id === scene.id ? { ...item, audioUrl, duration: Math.max(item.duration, Math.ceil(audioSeconds + 0.6)), status: "ready" as SceneStatus } : item);
          setScenes(work);
          setProgress(70 + Math.round(((index + 1) / work.length) * 28));
        }
      }
      setProgress(100);
      setPhase("ready");
      setStatusText(mode === "cloud" && voiceEnabled ? "画面与配音已生成，可以播放或导出" : "真实画面已生成，可以播放或导出视频");
    } catch (reason) {
      if (runRef.current !== run) return;
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "生成失败，请重试");
      setStatusText("生成中断");
    }
  }

  function cancelGeneration() {
    runRef.current = Date.now();
    setPhase(scenes.length ? "ready" : "idle");
    setStatusText("已停止当前任务");
  }

  async function regenerateImage(scene: Scene, index: number) {
    if (mode === "cloud" && !apiKey.trim().startsWith("pk_")) {
      setShowKey(true);
      setError("请先填写发布密钥");
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setError("");
    updateScene(scene.id, { status: "painting" });
    try {
      const imageUrl = await makeImage(scene, index, run);
      if (scene.imageUrl) URL.revokeObjectURL(scene.imageUrl);
      updateScene(scene.id, { imageUrl, videoUrl: undefined, status: "ready" });
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "画面生成失败");
    }
  }

  async function generateVideo(scene: Scene) {
    if (!apiKey.trim().startsWith("pk_")) {
      setShowKey(true);
      setError("AI 动态镜头需要增强模式发布密钥");
      return;
    }
    setError("");
    updateScene(scene.id, { status: "painting" });
    try {
      const videoUrl = await pollinationsMedia("video", `${STYLE_PROMPTS[style]}, ${scene.visual}, cinematic camera movement`);
      if (scene.videoUrl) URL.revokeObjectURL(scene.videoUrl);
      updateScene(scene.id, { videoUrl, status: "ready", duration: 6 });
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "动态镜头生成失败");
    }
  }

  function moveScene(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= scenes.length) return;
    setScenes((items) => {
      const next = [...items];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setSelected(nextIndex);
  }

  function deleteScene(index: number) {
    const item = scenes[index];
    if (item?.imageUrl) URL.revokeObjectURL(item.imageUrl);
    if (item?.audioUrl) URL.revokeObjectURL(item.audioUrl);
    if (item?.videoUrl) URL.revokeObjectURL(item.videoUrl);
    setScenes((items) => items.filter((_, itemIndex) => itemIndex !== index));
    setSelected(Math.max(0, Math.min(selected, scenes.length - 2)));
  }

  function addScene() {
    setScenes((items) => [...items, { id: uid(), title: "新镜头", visual: "描述人物、环境、动作、景别和光线", dialogue: "输入角色台词", duration: 6, status: "queued" }]);
    setSelected(scenes.length);
  }

  function seek(value: number) {
    setPlaying(false);
    setTime((value / 100) * totalDuration);
  }

  async function loadVisual(scene: Scene) {
    if (scene.videoUrl) {
      const video = document.createElement("video");
      video.src = scene.videoUrl;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("动态镜头加载失败"));
      });
      return video;
    }
    if (!scene.imageUrl) throw new Error(`“${scene.title}”还没有生成画面`);
    const image = new Image();
    image.src = scene.imageUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("生成图片加载失败"));
    });
    return image;
  }

  async function exportFilm() {
    if (!scenes.length || !scenes.every((scene) => scene.imageUrl || scene.videoUrl)) {
      setError("请先为所有镜头生成画面");
      return;
    }
    if (!("MediaRecorder" in window)) {
      setError("当前浏览器不支持视频导出，请使用最新版 Chrome 或 Edge");
      return;
    }
    setPlaying(false);
    setPhase("exporting");
    setExportProgress(0);
    setError("");
    try {
      const width = aspect === "9:16" ? 720 : 1280;
      const height = aspect === "9:16" ? 1280 : 720;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建视频画布");
      const visuals = await Promise.all(scenes.map(loadVisual));
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const buffers = await Promise.all(scenes.map(async (scene) => {
        if (!scene.audioUrl) return null;
        const bytes = await (await fetch(scene.audioUrl)).arrayBuffer();
        return audioContext.decodeAudioData(bytes);
      }));
      const canvasStream = canvas.captureStream(30);
      const stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
      const choices = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
      const mimeType = choices.find((choice) => MediaRecorder.isTypeSupported(choice)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.start(500);
      await audioContext.resume();
      const audioStart = audioContext.currentTime + 0.12;
      let audioOffset = 0;
      buffers.forEach((buffer, index) => {
        if (buffer) {
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(destination);
          source.start(audioStart + audioOffset);
        }
        audioOffset += scenes[index].duration;
      });
      const started = performance.now() + 120;
      let visualIndex = -1;
      await new Promise<void>((resolve) => {
        const render = (now: number) => {
          const elapsed = Math.max(0, (now - started) / 1000);
          if (elapsed >= totalDuration) {
            resolve();
            return;
          }
          const index = Math.max(0, scenes.findIndex((scene, sceneIndex) => elapsed >= offsets[sceneIndex] && elapsed < offsets[sceneIndex] + scene.duration));
          const scene = scenes[index];
          const local = (elapsed - offsets[index]) / scene.duration;
          const visual = visuals[index];
          if (index !== visualIndex) {
            visuals.forEach((item, itemIndex) => {
              if (item instanceof HTMLVideoElement && itemIndex !== index) item.pause();
            });
            if (visual instanceof HTMLVideoElement) {
              visual.currentTime = 0;
              void visual.play().catch(() => undefined);
            }
            visualIndex = index;
          }
          ctx.fillStyle = "#0d0b12";
          ctx.fillRect(0, 0, width, height);
          drawCover(ctx, visual, width, height, 1 + local * 0.055);
          const shade = ctx.createLinearGradient(0, height * 0.48, 0, height);
          shade.addColorStop(0, "rgba(9,7,12,0)");
          shade.addColorStop(1, "rgba(9,7,12,.88)");
          ctx.fillStyle = shade;
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "rgba(255,255,255,.72)";
          ctx.font = `${Math.round(width * 0.022)}px Microsoft YaHei, sans-serif`;
          ctx.fillText(`${String(index + 1).padStart(2, "0")}  ${scene.title}`, width * 0.07, height * 0.09);
          ctx.textAlign = "center";
          ctx.fillStyle = "#fff";
          ctx.font = `600 ${Math.round(width * 0.044)}px Microsoft YaHei, sans-serif`;
          wrapCanvasText(ctx, `“${scene.dialogue}”`, width / 2, height * 0.86, width * 0.78, width * 0.06, 3);
          ctx.textAlign = "left";
          setExportProgress(Math.min(99, Math.round((elapsed / totalDuration) * 100)));
          requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
      });
      recorder.stop();
      await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      visuals.forEach((item) => { if (item instanceof HTMLVideoElement) item.pause(); });
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
      const finalType = recorder.mimeType || "video/webm";
      const blob = new Blob(chunks, { type: finalType });
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
      setExportProgress(100);
      setPhase("ready");
      setStatusText(buffers.some(Boolean) ? "成片已导出，画面、字幕和配音均已写入" : "成片已导出，免费系统配音仅用于在线播放");
    } catch (reason) {
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "视频导出失败");
    }
  }

  function downloadFilm() {
    if (!exportUrl) return;
    const anchor = document.createElement("a");
    anchor.href = exportUrl;
    anchor.download = `${projectTitle || "漫镜作品"}.${exportUrl && MediaRecorder.isTypeSupported("video/mp4") ? "mp4" : "webm"}`;
    anchor.click();
  }

  const busy = ["story", "images", "voice", "exporting"].includes(phase);
  const selectedScene = scenes[selected];

  return (
    <main id="top">
      <nav className="nav">
        <a className="brand" href="#top"><span>漫</span><strong>漫镜</strong><small>AI 漫剧工作台</small></a>
        <div className="nav-links"><a href="#studio">创作</a><a href="#works">剪辑台</a><a href="#capabilities">能力说明</a></div>
        <button className={`connection ${mode}`} onClick={() => document.getElementById("provider")?.scrollIntoView({ behavior: "smooth" })}>
          <i />{mode === "community" ? "免费社区模式" : "增强云端模式"}
        </button>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">真实生成 · 真实播放 · 真实导出</p>
          <h1>把一句故事，<br /><em>做成能播放的漫剧。</em></h1>
          <p className="subhead">AI 改编剧本、生成分镜画面、中文配音、动态镜头与视频合成，每一步都有真实结果，不再用假进度糊弄你。</p>
          <a className="hero-cta" href="#studio">开始创作 <span>↘</span></a>
        </div>
        <div className="hero-card" aria-hidden="true">
          <div className="card-number">01 — 04</div>
          <div className="card-scene"><div className="card-moon" /><div className="card-rain" /><b>雨夜重逢</b><p>“这一次，别再错过了。”</p></div>
          <div className="card-track"><span /><span /><span /><span /></div>
        </div>
      </section>

      <section id="studio" className="studio section-shell">
        <div className="section-heading"><span>01</span><div><p>创作输入</p><h2>先告诉 AI，你想讲什么</h2></div></div>
        <div className="creation-grid">
          <div className="story-panel">
            <label htmlFor="story">故事梗概</label>
            <textarea id="story" value={story} onChange={(event) => setStory(event.target.value)} maxLength={1200} placeholder="例如：末班地铁上，女孩遇见了十年后的自己……" />
            <div className="text-meta"><button onClick={() => setStory("末班地铁上，女孩发现对面的乘客竟是十年后的自己。车门打开前，她只有三分钟改变人生。")}>换一个灵感</button><span>{story.length} / 1200</span></div>
          </div>
          <div className="settings-panel">
            <label>视觉风格</label>
            <div className="choice-grid">{Object.keys(STYLE_PROMPTS).map((item) => <button key={item} className={style === item ? "active" : ""} onClick={() => setStyle(item)}>{item}</button>)}</div>
            <div className="setting-pair"><div><label>目标时长</label><select value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))}><option value={30}>约 30 秒</option><option value={60}>约 60 秒</option><option value={90}>约 90 秒</option></select></div><div><label>画面比例</label><select value={aspect} onChange={(event) => setAspect(event.target.value as "9:16" | "16:9")}><option value="9:16">竖屏 9:16</option><option value="16:9">横屏 16:9</option></select></div></div>
            <div className="voice-row"><div><label>自动配音</label><small>{mode === "cloud" ? "生成音轨并写入成片" : "使用设备中文语音播放"}</small></div><button className={`toggle ${voiceEnabled ? "on" : ""}`} aria-label="切换自动配音" onClick={() => setVoiceEnabled((value) => !value)}><i /></button></div>
            {mode === "cloud" && voiceEnabled && <select aria-label="配音音色" value={voice} onChange={(event) => setVoice(event.target.value)}>{VOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}
          </div>
        </div>

        <div id="provider" className="provider-box">
          <div className="provider-tabs">
            <button className={mode === "community" ? "active" : ""} onClick={() => setMode("community")}><b>免费社区</b><span>无需密钥 · 真 AI 图片</span></button>
            <button className={mode === "cloud" ? "active" : ""} onClick={() => { setMode("cloud"); setShowKey(true); }}><b>增强云端</b><span>AI 配音 · 动态视频</span></button>
          </div>
          {mode === "community" ? <p className="provider-note">由开源社区算力排队生成；在线播放支持系统中文配音，导出视频不含系统朗读。提示词与图片会交由社区节点处理，请勿输入隐私内容。</p> : <div className="key-panel"><div><b>Pollinations 发布密钥</b><span>只保存在你的设备，建议使用设置过预算上限的 pk_ 密钥。</span></div>{showKey && <div className="key-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder="pk_..." aria-label="Pollinations 发布密钥" /><a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">免费获取 ↗</a></div>}</div>}
        </div>

        <div className="generate-row">
          <button className="generate-button" onClick={generateAll} disabled={busy || story.trim().length < 8}><span>✦</span>{busy && phase !== "exporting" ? "正在制作漫剧" : "一键生成漫剧"}<small>{mode === "community" ? "无需登录" : "真实画面 + AI 音轨"}</small></button>
          {busy && phase !== "exporting" && <button className="cancel-button" onClick={cancelGeneration}>停止</button>}
        </div>
        {(phase !== "idle" || error) && <div className={`job-status ${error ? "has-error" : ""}`}><div className="status-copy"><b>{error || statusText}</b><span>{error ? "请检查设置后重新尝试，页面不会伪装成已完成。" : `${progress}%`}</span></div><div className="status-bar"><i style={{ width: `${progress}%` }} /></div><div className="status-steps"><span className={["story", "images", "voice", "ready"].includes(phase) ? "active" : ""}>剧本</span><span className={["images", "voice", "ready"].includes(phase) ? "active" : ""}>画面</span><span className={["voice", "ready"].includes(phase) ? "active" : ""}>配音</span><span className={phase === "ready" ? "active" : ""}>成片</span></div></div>}
      </section>

      <section id="works" className="works section-shell">
        <div className="section-heading"><span>02</span><div><p>剪辑工作台</p><h2>{scenes.length ? projectTitle : "生成后在这里剪辑"}</h2></div><aside>{scenes.length ? `${scenes.length} 个镜头 · ${formatTime(totalDuration)}` : "尚无作品"}</aside></div>
        {!scenes.length ? <div className="empty-work"><div className="empty-orbit"><span>✦</span></div><h3>你的第一部漫剧还没开机</h3><p>在上方输入故事并点击“一键生成漫剧”。生成结果会包含可编辑分镜和真实图片。</p></div> : <div className="workbench">
          <div className="preview-column">
            <div className={`stage ${aspect === "9:16" ? "portrait" : "landscape"}`}>
              {current?.videoUrl ? <video ref={videoRef} key={current.videoUrl} src={current.videoUrl} muted loop playsInline /> : current?.imageUrl ? <img key={current.imageUrl} src={current.imageUrl} alt={current.visual} /> : <div className="stage-placeholder"><span>{String(currentIndex + 1).padStart(2, "0")}</span><p>{current?.status === "painting" ? "AI 正在绘制这个镜头" : "等待生成画面"}</p></div>}
              {current && <><div className="stage-shade" /><div className="stage-label"><span>{String(currentIndex + 1).padStart(2, "0")}</span><b>{current.title}</b></div><div className="subtitle">“{current.dialogue}”</div></>}
            </div>
            <div className="play-controls"><button onClick={() => setPlaying((value) => !value)} disabled={!scenes.length}>{playing ? "Ⅱ" : "▶"}</button><span>{formatTime(time)}</span><input type="range" aria-label="播放进度" min={0} max={100} value={totalDuration ? (time / totalDuration) * 100 : 0} onChange={(event) => seek(Number(event.target.value))} /><span>{formatTime(totalDuration)}</span><button onClick={() => { setPlaying(false); setTime(0); }}>↺</button></div>
            <div className="export-panel"><div><b>合成成片</b><span>{mode === "cloud" && voiceEnabled ? "画面、动态镜头、字幕和 AI 配音将合成到视频" : "画面、运镜和字幕将合成到视频"}</span></div><button onClick={exportFilm} disabled={phase === "exporting"}>{phase === "exporting" ? `正在录制 ${exportProgress}%` : "生成可播放视频"}</button></div>
            {exportUrl && <div className="export-result"><video src={exportUrl} controls playsInline /><div><b>成片已经生成</b><span>先播放检查，再下载到设备。</span><button onClick={downloadFilm}>下载视频</button></div></div>}
          </div>

          <div className="timeline-panel">
            <div className="timeline-title"><div><b>智能分镜</b><span>点击选择，下面可编辑</span></div><button onClick={addScene}>＋ 新增镜头</button></div>
            <div className="scene-list">{scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }}><div className="scene-thumb">{scene.videoUrl ? <video src={scene.videoUrl} muted /> : scene.imageUrl ? <img src={scene.imageUrl} alt="" /> : <span>{scene.status === "painting" ? "生成中" : String(index + 1).padStart(2, "0")}</span>}</div><div><b>{scene.title}</b><p>{scene.visual}</p><small>{scene.duration} 秒 · {scene.videoUrl ? "动态镜头" : scene.imageUrl ? "AI 画面" : "待生成"}</small></div><i className={`scene-state ${scene.status}`} /></button>)}</div>
            {selectedScene && <div className="scene-editor"><div className="editor-heading"><b>镜头 {String(selected + 1).padStart(2, "0")}</b><div><button onClick={() => moveScene(selected, -1)} disabled={selected === 0}>↑</button><button onClick={() => moveScene(selected, 1)} disabled={selected === scenes.length - 1}>↓</button><button className="danger" onClick={() => deleteScene(selected)}>删除</button></div></div><label>镜头标题<input value={selectedScene.title} onChange={(event) => updateScene(selectedScene.id, { title: event.target.value })} /></label><label>画面描述<textarea value={selectedScene.visual} onChange={(event) => updateScene(selectedScene.id, { visual: event.target.value })} /></label><label>角色台词<textarea value={selectedScene.dialogue} onChange={(event) => updateScene(selectedScene.id, { dialogue: event.target.value })} /></label><label>镜头时长<input type="number" min={3} max={20} value={selectedScene.duration} onChange={(event) => updateScene(selectedScene.id, { duration: Math.max(3, Math.min(20, Number(event.target.value))) })} /></label><div className="editor-actions"><button onClick={() => regenerateImage(selectedScene, selected)}>重新生成画面</button><button className="video-action" onClick={() => generateVideo(selectedScene)}>生成 AI 动态镜头</button></div></div>}
          </div>
        </div>}
      </section>

      <section id="capabilities" className="capabilities section-shell">
        <div className="section-heading"><span>03</span><div><p>能力说明</p><h2>每个按钮背后，都有真实结果</h2></div></div>
        <div className="capability-grid"><article><i>文</i><b>AI 剧本改编</b><p>调用真实语言模型输出结构化分镜，不再复读输入。</p></article><article><i>画</i><b>真实图片生成</b><p>每个镜头调用图片模型，完成后才显示成功。</p></article><article><i>声</i><b>中文配音</b><p>免费模式可朗读；增强模式生成音频并写入成片。</p></article><article><i>影</i><b>视频生成与剪辑</b><p>可生成 AI 动态镜头，也可将全部分镜合成为可播放视频。</p></article></div>
      </section>

      <footer><div className="brand"><span>漫</span><strong>漫镜</strong></div><p>让每一个好故事，都真正被看见。</p><small>生成服务可能排队或限流，失败会如实提示。</small></footer>
    </main>
  );
}
