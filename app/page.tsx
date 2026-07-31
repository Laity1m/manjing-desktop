"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "community" | "cloud";
type Phase = "idle" | "story" | "characters" | "images" | "video" | "voice" | "music" | "ready" | "exporting" | "error";
type SceneStatus = "queued" | "writing" | "painting" | "animating" | "voicing" | "ready" | "error";
type CharacterAsset = {
  id: string;
  name: string;
  role: string;
  appearance: string;
  voice: string;
  imageUrl?: string;
  remoteUrl?: string;
  status: "queued" | "generating" | "ready" | "error";
};
type Scene = {
  id: string;
  title: string;
  visual: string;
  action: string;
  shot: string;
  camera: string;
  dialogue: string;
  speaker: string;
  emotion: string;
  sfx: string;
  characters: string[];
  duration: number;
  imageUrl?: string;
  remoteImageUrl?: string;
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

function closeTruncatedJson(source: string) {
  const start = source.indexOf("{");
  if (start < 0) return "";
  let repaired = source.slice(start).trim();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of repaired) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" && stack.at(-1) === "{") stack.pop();
    else if (character === "]" && stack.at(-1) === "[") stack.pop();
  }
  if (inString) {
    if (escaped) repaired = repaired.slice(0, -1);
    repaired += '"';
  }
  repaired = repaired.trimEnd();
  if (repaired.endsWith(":")) repaired += "null";
  else if (repaired.endsWith(",")) repaired = repaired.slice(0, -1);
  while (stack.length) repaired += stack.pop() === "{" ? "}" : "]";
  return repaired;
}

function parseStoryboard(raw: string, targetSeconds: number): { title: string; characters: CharacterAsset[]; music: string; scenes: Scene[] } {
  const unfenced = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0) throw new Error("AI 没有返回可识别的剧本，请重试");
  let parsed: Record<string, unknown> | null = null;
  try {
    if (end > start) parsed = JSON.parse(unfenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(closeTruncatedJson(unfenced)) as Record<string, unknown>;
    } catch {
      throw new Error("免费模型的剧本输出被截断，请再次生成");
    }
  }
  const sceneSource = Array.isArray(parsed.scenes) ? parsed.scenes : Array.isArray(parsed.s) ? parsed.s : [];
  if (sceneSource.length < 2) throw new Error("AI 没有生成足够的完整分镜，请再次生成");
  const picked = sceneSource.slice(0, 6) as Array<Record<string, unknown>>;
  const seconds = Math.max(4, Math.round(targetSeconds / picked.length));
  const characterSource = Array.isArray(parsed.characters) ? parsed.characters : Array.isArray(parsed.c) ? parsed.c : [];
  const rawCharacters = characterSource.slice(0, 4) as Array<Record<string, unknown>>;
  const characters: CharacterAsset[] = rawCharacters.map((item, index) => ({
    id: uid(),
    name: String(item.name || item.n || `角色 ${index + 1}`).slice(0, 16),
    role: String(item.role || item.r || (index === 0 ? "主角" : "重要角色")).slice(0, 24),
    appearance: String(item.appearance || item.a || "具有鲜明辨识度的年轻角色，固定发型、五官与服装").slice(0, 260),
    voice: ["nova", "coral", "onyx", "echo"].includes(String(item.voice || item.v)) ? String(item.voice || item.v) : VOICES[index % VOICES.length].value,
    status: "queued" as const,
  }));
  if (!characters.length) characters.push({ id: uid(), name: "主角", role: "故事主角", appearance: "与剧情匹配、具有鲜明辨识度的年轻角色，固定五官、发型和服装", voice: "nova", status: "queued" });
  return {
    title: String(parsed.title || parsed.t || "未命名漫剧").slice(0, 32),
    characters,
    music: String(parsed.music || parsed.m || "cinematic emotional Chinese animation soundtrack, instrumental, no vocals").slice(0, 220),
    scenes: picked.map((item, index) => ({
      id: uid(),
      title: String(item.title || item.t || `镜头 ${index + 1}`).slice(0, 32),
      visual: String(item.visual || item.v || item.description || "电影感人物场景").slice(0, 520),
      action: String(item.action || item.a || "角色做出符合剧情的自然动作与表情变化").slice(0, 220),
      shot: String(item.shot || item.h || "中景").slice(0, 24),
      camera: String(item.camera || item.k || "缓慢推进").slice(0, 60),
      dialogue: String(item.dialogue || item.d || "……").replace(/^[“\"']|[”\"']$/g, "").slice(0, 120),
      speaker: String(item.speaker || item.p || characters[0].name).slice(0, 16),
      emotion: String(item.emotion || item.e || "克制").slice(0, 24),
      sfx: String(item.sfx || item.x || "环境氛围声").slice(0, 80),
      characters: Array.isArray(item.characters) ? item.characters.map(String).slice(0, 4) : Array.isArray(item.c) ? item.c.map(String).slice(0, 4) : [String(item.speaker || item.p || characters[0].name)],
      duration: Math.max(4, Math.min(15, Number(item.duration || item.u) || seconds)),
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

function drawCover(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  width: number,
  height: number,
  zoom = 1,
  panX = 0,
  panY = 0,
  opacity = 1,
) {
  const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media instanceof HTMLImageElement ? media.naturalWidth : width;
  const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media instanceof HTMLImageElement ? media.naturalHeight : height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * zoom;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const overflowX = Math.max(0, drawWidth - width);
  const overflowY = Math.max(0, drawHeight - height);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(
    media,
    (width - drawWidth) / 2 + panX * overflowX * 0.46,
    (height - drawHeight) / 2 + panY * overflowY * 0.46,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
}

function drawMovingShot(ctx: CanvasRenderingContext2D, media: CanvasImageSource, width: number, height: number, index: number, progress: number, opacity = 1) {
  const eased = 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, progress))) / 2;
  const direction = index % 4;
  const panX = direction === 0 ? eased * 2 - 1 : direction === 1 ? 1 - eased * 2 : direction === 2 ? 0.35 : -0.35;
  const panY = direction === 2 ? eased * 2 - 1 : direction === 3 ? 1 - eased * 2 : 0;
  const zoom = direction < 2 ? 1.045 + eased * 0.075 : 1.12 - eased * 0.065;
  drawCover(ctx, media, width, height, zoom, panX, panY, opacity);
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
  const [bgmEnabled, setBgmEnabled] = useState(true);
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
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
  const [showFilm, setShowFilm] = useState(false);
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
          { role: "system", content: `你是专业 AI 漫剧导演。把故事改编成恰好 ${count} 个连续、可拍摄的短剧镜头，只返回 JSON，所有内容使用简体中文。先建立最多 4 个固定角色，再写分镜。结构：{"title":"标题","music":"无歌词配乐描述","characters":[{"name":"角色名","role":"身份","appearance":"固定五官、发型、服装、年龄和气质","voice":"nova|coral|onyx|echo"}],"scenes":[{"title":"镜头标题","characters":["角色名"],"shot":"景别","visual":"场景、构图、灯光","action":"人物连续动作、表情与互动","camera":"运镜","speaker":"说话角色","emotion":"台词情绪","dialogue":"自然简短台词","sfx":"环境音或动作音","duration":6}]}。角色外观跨镜头必须一致；每镜都要推动剧情，结尾形成钩子；不要复述用户原文。` },
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

  async function pollinationsMedia(
    kind: "image" | "audio" | "video",
    prompt: string,
    index = 0,
    options: { references?: string[]; voiceName?: string; duration?: number; music?: boolean } = {},
  ) {
    const base = "https://gen.pollinations.ai";
    let url = "";
    if (kind === "image") {
      const params = new URLSearchParams({
        model: options.references?.length ? "kontext" : "zimage",
        width: aspect === "9:16" ? "768" : "1280",
        height: aspect === "9:16" ? "1280" : "720",
        seed: String(Math.abs(story.length * 97 + index * 7919)),
        enhance: "true",
        safe: "true",
      });
      if (options.references?.length) params.set("image", options.references.join("|"));
      url = `${base}/image/${encodeURIComponent(prompt)}?${params}`;
    } else if (kind === "audio") {
      const params = new URLSearchParams({ response_format: "mp3", safe: "true" });
      if (options.music) {
        params.set("model", "elevenmusic");
        params.set("duration", String(Math.max(6, Math.min(180, Math.round(options.duration || targetDuration)))));
        params.set("instrumental", "true");
      } else {
        params.set("voice", options.voiceName || voice);
      }
      url = `${base}/audio/${encodeURIComponent(prompt)}?${params}`;
    } else {
      const params = new URLSearchParams({
        model: "seedance-2.0",
        duration: String(Math.max(4, Math.min(10, Math.round(options.duration || 6)))),
        aspectRatio: aspect,
        audio: "false",
        safe: "true",
      });
      if (options.references?.length) params.set("image", options.references.slice(0, 1).join("|"));
      url = `${base}/video/${encodeURIComponent(prompt)}?${params}`;
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    const expected = kind === "image" ? "image/" : kind === "audio" ? "audio/" : "video/";
    if (!blob.type.startsWith(expected)) throw new Error(`${kind === "image" ? "图片" : kind === "audio" ? "配音" : "视频"}服务返回了无效文件`);
    return { url: URL.createObjectURL(blob), blob };
  }

  async function uploadPollinationsMedia(blob: Blob, filename: string) {
    const form = new FormData();
    form.append("file", blob, filename);
    const response = await fetch("https://gen.pollinations.ai/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: form,
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error("角色参考素材上传失败");
    return data.url;
  }

  async function makeImage(scene: Scene, index: number, run: number, characterGuide = "") {
    const prompt = `${STYLE_PROMPTS[style]}, ${scene.shot}, ${scene.visual}, ${scene.action}, ${characterGuide}, preserve the exact same faces, hair and costumes across every shot, no typography`;
    if (mode === "cloud") return (await pollinationsMedia("image", prompt, index)).url;
    const task = await startHorde("image", { prompt, aspect });
    const result = await pollHorde("image", task.id, run);
    const remote = String(result.imageUrl || "");
    const response = await fetch(`/api/media?url=${encodeURIComponent(remote)}`);
    if (!response.ok) throw new Error(await responseError(response));
    return URL.createObjectURL(await response.blob());
  }

  async function generateAll() {
    if (story.trim().length < 8 || !["idle", "ready", "error"].includes(phase)) return;
    if (mode === "cloud" && !apiKey.trim().startsWith("pk_")) {
      setShowKey(true);
      setError("增强模式需要填写以 pk_ 开头的发布密钥");
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setError("");
    setExportUrl("");
    setMusicUrl("");
    setCharacters([]);
    setShowFilm(false);
    setPlaying(false);
    setTime(0);
    setPhase("story");
    setProgress(5);
    setStatusText("AI 正在理解故事并编写分镜");
    try {
      let raw = "";
      if (mode === "cloud") raw = await pollinationsStoryboard();
      else {
        const task = await startHorde("story", { story: story.trim(), style, count: Math.max(3, Math.min(4, Math.ceil(targetDuration / 15))) });
        const result = await pollHorde("text", task.id, run);
        raw = String(result.text || "");
      }
      const storyboard = parseStoryboard(raw, targetDuration);
      setProjectTitle(storyboard.title);
      setMusicPrompt(storyboard.music);
      let cast = storyboard.characters;
      let work = storyboard.scenes;
      setCharacters(cast);
      setScenes(work);
      setSelected(0);

      setPhase("characters");
      for (let index = 0; index < cast.length; index += 1) {
        const character = cast[index];
        setStatusText(`正在建立角色资产 ${index + 1}/${cast.length}：${character.name}`);
        cast = cast.map((item) => item.id === character.id ? { ...item, status: "generating" as const } : item);
        setCharacters(cast);
        const characterPrompt = `${STYLE_PROMPTS[style]}, professional animation character model sheet, ${character.name}, ${character.role}, ${character.appearance}, full body and face close-up, clean neutral background, exact fixed facial features and costume, no typography`;
        if (mode === "cloud") {
          const asset = await pollinationsMedia("image", characterPrompt, 50 + index);
          const remoteUrl = await uploadPollinationsMedia(asset.blob, `character-${index + 1}.png`);
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: asset.url, remoteUrl, status: "ready" as const } : item);
        } else {
          const referenceScene: Scene = { id: uid(), title: character.name, visual: characterPrompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
          const imageUrl = await makeImage(referenceScene, 50 + index, run);
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl, status: "ready" as const } : item);
        }
        setCharacters(cast);
        setProgress(10 + Math.round(((index + 1) / cast.length) * 16));
      }

      setPhase("images");
      for (let index = 0; index < work.length; index += 1) {
        const scene = work[index];
        setStatusText(`正在制作第 ${index + 1}/${work.length} 个一致性分镜`);
        updateScene(scene.id, { status: "painting" });
        const presentCast = cast.filter((character) => scene.characters.includes(character.name) || scene.speaker === character.name);
        const castForScene = presentCast.length ? presentCast : cast.slice(0, 2);
        const characterGuide = castForScene.map((character) => `${character.name}: ${character.appearance}`).join("; ");
        if (mode === "cloud") {
          const framePrompt = `${STYLE_PROMPTS[style]}, exact identities and costumes from the character references, ${scene.shot}, ${scene.visual}, ${scene.action}, cinematic composition, coherent spatial layout, no text`;
          const frame = await pollinationsMedia("image", framePrompt, index, { references: castForScene.map((item) => item.remoteUrl).filter(Boolean) as string[] });
          const remoteImageUrl = await uploadPollinationsMedia(frame.blob, `scene-${index + 1}.png`);
          work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: frame.url, remoteImageUrl, status: "ready" as SceneStatus } : item);
        } else {
          const imageUrl = await makeImage(scene, index, run, characterGuide);
          work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl, status: "ready" as SceneStatus } : item));
        }
        setScenes(work);
        setProgress(26 + Math.round(((index + 1) / work.length) * (mode === "cloud" ? 18 : 48)));
      }

      if (mode === "cloud") {
        setPhase("video");
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          setStatusText(`正在让镜头真正动起来 ${index + 1}/${work.length}：${scene.action}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
          setScenes(work);
          const motionPrompt = `${STYLE_PROMPTS[style]}, preserve the exact character identity, face, hair and costume from the start frame. ${scene.action}. Camera: ${scene.camera}. ${scene.speaker} performs with ${scene.emotion} emotion and natural mouth movement. One continuous cinematic shot, coherent physics, no subtitles, no cuts.`;
          const clip = await pollinationsMedia("video", motionPrompt, index, { references: scene.remoteImageUrl ? [scene.remoteImageUrl] : [], duration: scene.duration });
          work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: clip.url, duration: Math.max(4, Math.min(10, scene.duration)), status: "ready" as SceneStatus } : item);
          setScenes(work);
          setProgress(44 + Math.round(((index + 1) / work.length) * 26));
        }
      }

      if (voiceEnabled && mode === "cloud") {
        setPhase("voice");
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          setStatusText(`正在生成 ${scene.speaker} 的${scene.emotion}配音 ${index + 1}/${work.length}`);
          updateScene(scene.id, { status: "voicing" });
          const castVoice = cast.find((character) => character.name === scene.speaker)?.voice || voice;
          const speech = await pollinationsMedia("audio", scene.dialogue, index, { voiceName: castVoice });
          const audioSeconds = await mediaDuration(speech.url);
          work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: speech.url, duration: Math.max(item.duration, Math.ceil(audioSeconds + 0.6)), status: "ready" as SceneStatus } : item);
          setScenes(work);
          setProgress(70 + Math.round(((index + 1) / work.length) * 13));
        }
      }

      let generatedMusicUrl = "";
      if (mode === "cloud" && bgmEnabled) {
        setPhase("music");
        setStatusText("正在生成与剧情节奏匹配的无歌词配乐");
        const soundtrack = await pollinationsMedia("audio", storyboard.music, 0, { music: true, duration: work.reduce((sum, item) => sum + item.duration, 0) });
        generatedMusicUrl = soundtrack.url;
        setMusicUrl(soundtrack.url);
      }
      setScenes(work);
      setProgress(88);
      setStatusText(mode === "cloud" ? "角色、动态镜头和声音已完成，正在自动剪辑" : "免费流程预览已完成，正在生成低动态样片");
      const exported = await exportFilm(work, true, generatedMusicUrl);
      if (!exported) return;
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
      if (scene.imageUrl) URL.revokeObjectURL(scene.imageUrl);
      if (mode === "cloud") {
        const presentCast = characters.filter((character) => scene.characters.includes(character.name) || scene.speaker === character.name);
        const frame = await pollinationsMedia("image", `${STYLE_PROMPTS[style]}, preserve the exact identities and costumes from references, ${scene.shot}, ${scene.visual}, ${scene.action}, cinematic composition, no text`, index, { references: presentCast.map((item) => item.remoteUrl).filter(Boolean) as string[] });
        const remoteImageUrl = await uploadPollinationsMedia(frame.blob, `scene-${index + 1}-revision.png`);
        updateScene(scene.id, { imageUrl: frame.url, remoteImageUrl, videoUrl: undefined, status: "ready" });
      } else {
        const characterGuide = characters.filter((character) => scene.characters.includes(character.name)).map((character) => `${character.name}: ${character.appearance}`).join("; ");
        const imageUrl = await makeImage(scene, index, run, characterGuide);
        updateScene(scene.id, { imageUrl, videoUrl: undefined, status: "ready" });
      }
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
    updateScene(scene.id, { status: "animating" });
    try {
      const clip = await pollinationsMedia("video", `${STYLE_PROMPTS[style]}, preserve exact character identity and costume. ${scene.action}. Camera: ${scene.camera}. Natural expressions and coherent motion, one continuous shot, no text.`, 0, { references: scene.remoteImageUrl ? [scene.remoteImageUrl] : [], duration: scene.duration });
      if (scene.videoUrl) URL.revokeObjectURL(scene.videoUrl);
      updateScene(scene.id, { videoUrl: clip.url, status: "ready", duration: Math.max(4, Math.min(10, scene.duration)) });
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
    const lead = characters[0]?.name || "主角";
    setScenes((items) => [...items, { id: uid(), title: "新镜头", visual: "描述场景、构图和光线", action: "描述角色连续动作和表情变化", shot: "中景", camera: "缓慢推进", dialogue: "输入角色台词", speaker: lead, emotion: "自然", sfx: "环境氛围声", characters: [lead], duration: 6, status: "queued" }]);
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

  async function exportFilm(sourceScenes: Scene[] = scenes, automatic = false, sourceMusicUrl = musicUrl) {
    const movieScenes = sourceScenes;
    if (!movieScenes.length || !movieScenes.every((scene) => scene.imageUrl || scene.videoUrl)) {
      setError("请先为所有镜头生成画面");
      return false;
    }
    if (!("MediaRecorder" in window)) {
      setError("当前浏览器不支持视频导出，请使用最新版 Chrome 或 Edge");
      return false;
    }
    const movieOffsets = movieScenes.map((_, index) => movieScenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0));
    const movieDuration = movieScenes.reduce((sum, item) => sum + item.duration, 0);
    setPlaying(false);
    setShowFilm(false);
    setPhase("exporting");
    setExportProgress(0);
    setError("");
    if (!automatic) setStatusText("正在重新剪辑漫剧成片");
    try {
      const width = aspect === "9:16" ? 720 : 1280;
      const height = aspect === "9:16" ? 1280 : 720;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建视频画布");
      const visuals = await Promise.all(movieScenes.map(loadVisual));
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const buffers = await Promise.all(movieScenes.map(async (scene) => {
        if (!scene.audioUrl) return null;
        const bytes = await (await fetch(scene.audioUrl)).arrayBuffer();
        return audioContext.decodeAudioData(bytes);
      }));
      const soundtrackBuffer = sourceMusicUrl
        ? await audioContext.decodeAudioData(await (await fetch(sourceMusicUrl)).arrayBuffer())
        : null;
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
        audioOffset += movieScenes[index].duration;
      });
      if (soundtrackBuffer) {
        const soundtrack = audioContext.createBufferSource();
        const soundtrackGain = audioContext.createGain();
        soundtrack.buffer = soundtrackBuffer;
        soundtrack.loop = soundtrackBuffer.duration < movieDuration;
        soundtrackGain.gain.value = buffers.some(Boolean) ? 0.13 : 0.24;
        soundtrack.connect(soundtrackGain).connect(destination);
        soundtrack.start(audioStart);
        soundtrack.stop(audioStart + movieDuration);
      }
      const started = performance.now() + 120;
      let visualIndex = -1;
      await new Promise<void>((resolve) => {
        const render = (now: number) => {
          const elapsed = Math.max(0, (now - started) / 1000);
          if (elapsed >= movieDuration) {
            resolve();
            return;
          }
          const index = Math.max(0, movieScenes.findIndex((scene, sceneIndex) => elapsed >= movieOffsets[sceneIndex] && elapsed < movieOffsets[sceneIndex] + scene.duration));
          const scene = movieScenes[index];
          const local = (elapsed - movieOffsets[index]) / scene.duration;
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
          const transition = Math.min(1, local * 5);
          if (index > 0 && transition < 1) drawMovingShot(ctx, visuals[index - 1], width, height, index - 1, 1, 1);
          drawMovingShot(ctx, visual, width, height, index, local, transition);
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
          setExportProgress(Math.min(99, Math.round((elapsed / movieDuration) * 100)));
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
      setShowFilm(true);
      setExportProgress(100);
      setProgress(100);
      setPhase("ready");
      setStatusText(buffers.some(Boolean) ? `AI 漫剧已生成，动态镜头、字幕、配音${soundtrackBuffer ? "和配乐" : ""}均已写入` : "免费流程样片已生成，可直接播放或下载");
      return true;
    } catch (reason) {
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "视频导出失败");
      return false;
    }
  }

  function downloadFilm() {
    if (!exportUrl) return;
    const anchor = document.createElement("a");
    anchor.href = exportUrl;
    anchor.download = `${projectTitle || "漫镜作品"}.${exportUrl && MediaRecorder.isTypeSupported("video/mp4") ? "mp4" : "webm"}`;
    anchor.click();
  }

  const busy = !["idle", "ready", "error"].includes(phase);
  const visibleProgress = phase === "exporting" ? exportProgress : progress;
  const selectedScene = scenes[selected];

  return (
    <main id="top">
      <nav className="nav">
        <a className="brand" href="#top"><span>漫</span><strong>漫镜</strong><small>AI 漫剧工作台</small></a>
        <div className="nav-links"><a href="#studio">创作</a><a href="#works">剪辑台</a><a href="#capabilities">能力说明</a></div>
        <button className={`connection ${mode}`} onClick={() => document.getElementById("provider")?.scrollIntoView({ behavior: "smooth" })}>
          <i />{mode === "community" ? "免费流程体验" : "完整 AI 漫剧"}
        </button>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">真实生成 · 真实播放 · 真实导出</p>
          <h1>把一句故事，<br /><em>做成能播放的漫剧。</em></h1>
          <p className="subhead">先锁定角色，再生成连续表演：剧本、角色资产、分镜视频、分角色配音、配乐与自动剪辑组成一条真实漫剧生产线。</p>
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
            {mode === "cloud" && <div className="voice-row"><div><label>剧情配乐</label><small>生成无歌词 BGM 并自动混音</small></div><button className={`toggle ${bgmEnabled ? "on" : ""}`} aria-label="切换剧情配乐" onClick={() => setBgmEnabled((value) => !value)}><i /></button></div>}
            {mode === "cloud" && voiceEnabled && <select aria-label="配音音色" value={voice} onChange={(event) => setVoice(event.target.value)}>{VOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}
          </div>
        </div>

        <div id="provider" className="provider-box">
          <div className="provider-tabs">
            <button className={mode === "community" ? "active" : ""} onClick={() => setMode("community")}><b>免费流程体验</b><span>剧本 · 人设 · 分镜 · 低动态样片</span></button>
            <button className={mode === "cloud" ? "active" : ""} onClick={() => { setMode("cloud"); setShowKey(true); }}><b>完整 AI 漫剧</b><span>角色锁定 · 图生视频 · 配音配乐</span></button>
          </div>
          {mode === "community" ? <p className="provider-note"><b>边界说明：</b>免费模式用于体验完整生产流程，输出是图片运镜样片，不会冒充人物原生动画。要生成角色真正表演、动作连续的 AI 漫剧，请使用“完整 AI 漫剧”。</p> : <div className="key-panel"><div><b>Pollinations 发布密钥</b><span>系统会先生成角色参考资产，再据此制作一致性关键帧和逐镜头视频；密钥只保存在你的设备，请设置预算上限。</span></div>{showKey && <div className="key-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder="pk_..." aria-label="Pollinations 发布密钥" /><a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">获取密钥 ↗</a></div>}</div>}
        </div>

        <div className="generate-row">
          <button className="generate-button" onClick={generateAll} disabled={busy || story.trim().length < 8}><span>✦</span>{busy ? "正在制作完整成片" : mode === "cloud" ? "一键生成 AI 漫剧" : "生成免费流程样片"}<small>{mode === "community" ? "不调用视频模型" : "角色锁定 + 动态表演 + 声音设计"}</small></button>
          {busy && phase !== "exporting" && <button className="cancel-button" onClick={cancelGeneration}>停止</button>}
        </div>
        {(phase !== "idle" || error) && <div className={`job-status ${error ? "has-error" : ""}`}><div className="status-copy"><b>{error || statusText}</b><span>{error ? "请检查设置后重新尝试，页面不会伪装成已完成。" : `${visibleProgress}%`}</span></div><div className="status-bar"><i style={{ width: `${visibleProgress}%` }} /></div><div className="status-steps"><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>剧本</span><span className={["characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>角色</span><span className={["images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>分镜</span><span className={["video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>{mode === "cloud" ? "动态" : "样片"}</span><span className={["voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>声音</span><span className={["exporting", "ready"].includes(phase) ? "active" : ""}>成片</span></div></div>}
      </section>

      <section id="works" className="works section-shell">
        <div className="section-heading"><span>02</span><div><p>剪辑工作台</p><h2>{scenes.length ? projectTitle : "生成后在这里剪辑"}</h2></div><aside>{scenes.length ? `${scenes.length} 个镜头 · ${formatTime(totalDuration)}` : "尚无作品"}</aside></div>
        {!!characters.length && <div className="production-assets">
          <div className="asset-heading"><div><b>角色资产库</b><span>固定人物的五官、发型、服装与专属音色，作为后续镜头参考</span></div><em>{characters.filter((item) => item.status === "ready").length}/{characters.length} 已锁定</em></div>
          <div className="character-list">{characters.map((character) => <article key={character.id} className={character.status}>
            <div className="character-portrait">{character.imageUrl ? <img src={character.imageUrl} alt={`${character.name}角色设定`} /> : <span>{character.status === "generating" ? "生成中" : character.name.slice(0, 1)}</span>}</div>
            <div><b>{character.name}</b><small>{character.role} · {VOICES.find((item) => item.value === character.voice)?.label || "角色音色"}</small><p>{character.appearance}</p></div>
          </article>)}</div>
          <div className="quality-gates">
            <span className={characters.every((item) => item.imageUrl) ? "passed" : ""}>角色参考</span>
            <span className={scenes.every((item) => item.imageUrl) ? "passed" : ""}>一致性分镜</span>
            <span className={mode === "cloud" && scenes.every((item) => item.videoUrl) ? "passed" : ""}>动态表演</span>
            <span className={mode === "cloud" && voiceEnabled && scenes.every((item) => item.audioUrl) ? "passed" : ""}>分角色配音</span>
            <span className={mode === "cloud" && bgmEnabled && !!musicUrl ? "passed" : ""}>剧情配乐</span>
            <span className={!!exportUrl ? "passed" : ""}>最终成片</span>
          </div>
        </div>}
        {!scenes.length ? <div className="empty-work"><div className="empty-orbit"><span>✦</span></div><h3>你的第一部漫剧还没开机</h3><p>在上方输入故事并点击“一键生成 AI 漫剧”，完成后这里会直接出现可播放成片。</p></div> : <div className="workbench">
          <div className="preview-column">
            <div className={`stage ${aspect === "9:16" ? "portrait" : "landscape"} ${showFilm && exportUrl ? "film-ready" : ""}`}>
              {showFilm && exportUrl ? <video src={exportUrl} controls autoPlay playsInline muted={mode === "community" || !voiceEnabled} /> : current?.videoUrl ? <video ref={videoRef} key={current.videoUrl} src={current.videoUrl} muted loop playsInline /> : current?.imageUrl ? <img key={current.imageUrl} src={current.imageUrl} alt={current.visual} /> : <div className="stage-placeholder"><span>{String(currentIndex + 1).padStart(2, "0")}</span><p>{current?.status === "animating" ? "AI 正在生成角色动态表演" : current?.status === "painting" ? "AI 正在绘制一致性关键帧" : "等待生成镜头"}</p></div>}
              {showFilm && exportUrl ? <div className="film-corner">AI 漫剧成片</div> : current && <><div className="stage-shade" /><div className="stage-label"><span>{String(currentIndex + 1).padStart(2, "0")}</span><b>{current.title}</b></div><div className="subtitle">“{current.dialogue}”</div></>}
            </div>
            {showFilm && exportUrl ? <div className="film-toolbar"><div><b>{mode === "cloud" ? "AI 漫剧成片已生成" : "低动态流程样片已生成"}</b><span>{mode === "cloud" ? `角色参考、逐镜头 AI 动画、分角色配音${musicUrl ? "与剧情配乐" : ""}已经合成` : "这是图片运镜预览，不是人物原生动画；可用于确认剧本、分镜与节奏"}</span></div><button className="secondary" onClick={() => setShowFilm(false)}>编辑分镜</button><button onClick={downloadFilm}>下载成片</button></div> : <>
              <div className="play-controls"><button onClick={() => setPlaying((value) => !value)} disabled={!scenes.length}>{playing ? "Ⅱ" : "▶"}</button><span>{formatTime(time)}</span><input type="range" aria-label="播放进度" min={0} max={100} value={totalDuration ? (time / totalDuration) * 100 : 0} onChange={(event) => seek(Number(event.target.value))} /><span>{formatTime(totalDuration)}</span><button onClick={() => { setPlaying(false); setTime(0); }}>↺</button></div>
              <div className="export-panel"><div><b>{mode === "cloud" ? "重新合成 AI 漫剧" : "重新生成流程样片"}</b><span>{mode === "cloud" && voiceEnabled ? "动态表演、字幕、分角色配音与配乐将写入视频" : "关键帧、运镜、转场和字幕将写入样片"}</span></div><button onClick={() => void exportFilm()} disabled={phase === "exporting"}>{phase === "exporting" ? `正在录制 ${exportProgress}%` : mode === "cloud" ? "生成 AI 漫剧成片" : "生成低动态样片"}</button></div>
              {exportUrl && <div className="export-result"><video src={exportUrl} controls playsInline /><div><b>已有漫剧成片</b><span>可以返回成片模式播放，或重新剪辑。</span><button onClick={() => setShowFilm(true)}>播放成片</button><button onClick={downloadFilm}>下载成片</button></div></div>}
            </>}
          </div>

          <div className="timeline-panel">
            <div className="timeline-title"><div><b>智能分镜</b><span>点击选择，下面可编辑</span></div><button onClick={addScene}>＋ 新增镜头</button></div>
            <div className="scene-list">{scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}><div className="scene-thumb">{scene.videoUrl ? <video src={scene.videoUrl} muted /> : scene.imageUrl ? <img src={scene.imageUrl} alt="" /> : <span>{["painting", "animating"].includes(scene.status) ? "生成中" : String(index + 1).padStart(2, "0")}</span>}</div><div><b>{scene.title}</b><p>{scene.action}</p><small>{scene.duration} 秒 · {scene.videoUrl ? "AI 动态表演" : scene.imageUrl ? "一致性关键帧" : "待生成"} · {scene.camera}</small></div><i className={`scene-state ${scene.status}`} /></button>)}</div>
            {selectedScene && <div className="scene-editor"><div className="editor-heading"><b>镜头 {String(selected + 1).padStart(2, "0")}</b><div><button onClick={() => moveScene(selected, -1)} disabled={selected === 0}>↑</button><button onClick={() => moveScene(selected, 1)} disabled={selected === scenes.length - 1}>↓</button><button className="danger" onClick={() => deleteScene(selected)}>删除</button></div></div><label>镜头标题<input value={selectedScene.title} onChange={(event) => updateScene(selectedScene.id, { title: event.target.value })} /></label><div className="editor-grid"><label>景别<input value={selectedScene.shot} onChange={(event) => updateScene(selectedScene.id, { shot: event.target.value })} /></label><label>运镜<input value={selectedScene.camera} onChange={(event) => updateScene(selectedScene.id, { camera: event.target.value })} /></label><label>说话角色<input value={selectedScene.speaker} onChange={(event) => updateScene(selectedScene.id, { speaker: event.target.value })} /></label><label>表演情绪<input value={selectedScene.emotion} onChange={(event) => updateScene(selectedScene.id, { emotion: event.target.value })} /></label></div><label>场景与构图<textarea value={selectedScene.visual} onChange={(event) => updateScene(selectedScene.id, { visual: event.target.value })} /></label><label>人物动作与表演<textarea value={selectedScene.action} onChange={(event) => updateScene(selectedScene.id, { action: event.target.value })} /></label><label>角色台词<textarea value={selectedScene.dialogue} onChange={(event) => updateScene(selectedScene.id, { dialogue: event.target.value })} /></label><div className="editor-grid"><label>音效设计<input value={selectedScene.sfx} onChange={(event) => updateScene(selectedScene.id, { sfx: event.target.value })} /></label><label>镜头时长<input type="number" min={3} max={20} value={selectedScene.duration} onChange={(event) => updateScene(selectedScene.id, { duration: Math.max(3, Math.min(20, Number(event.target.value))) })} /></label></div><div className="editor-actions"><button onClick={() => regenerateImage(selectedScene, selected)}>重做一致性关键帧</button><button className="video-action" onClick={() => generateVideo(selectedScene)}>{mode === "cloud" ? "重做 AI 动态表演" : "转为 AI 动态镜头"}</button></div></div>}
          </div>
        </div>}
      </section>

      <section id="capabilities" className="capabilities section-shell">
        <div className="section-heading"><span>03</span><div><p>能力说明</p><h2>每个按钮背后，都有真实结果</h2></div></div>
        <div className="capability-grid"><article><i>人</i><b>角色资产锁定</b><p>先生成固定人设，后续关键帧和视频都引用同一角色资产。</p></article><article><i>演</i><b>分镜级动态表演</b><p>完整模式以关键帧驱动视频模型，生成人物动作、表情和运镜。</p></article><article><i>声</i><b>角色声音设计</b><p>按说话角色匹配音色，并生成剧情配乐后自动混音。</p></article><article><i>片</i><b>自动剪辑成片</b><p>字幕、镜头衔接、声音和视频真正写入可下载的成片。</p></article></div>
      </section>

      <footer><div className="brand"><span>漫</span><strong>漫镜</strong></div><p>让每一个好故事，都真正被看见。</p><small>生成服务可能排队或限流，失败会如实提示。</small></footer>
    </main>
  );
}
