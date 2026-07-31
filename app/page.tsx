"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "community" | "cloud";
type Phase = "idle" | "story" | "characters" | "images" | "video" | "voice" | "music" | "ready" | "exporting" | "error";
type SceneStatus = "queued" | "writing" | "painting" | "animating" | "voicing" | "ready" | "error";
type AgentRole = "director" | "writer" | "image" | "video" | "voice" | "editor";
type AgentAdapter = "horde" | "pollinations" | "browser" | "webhook";
type MotionPreset = "push" | "pull" | "pan-left" | "pan-right" | "float";
type TransitionPreset = "fade" | "cut" | "flash";
type VisualFilter = "none" | "warm" | "cool" | "mono";
type SubtitlePosition = "top" | "center" | "bottom";
type ActivityState = "running" | "done" | "warning" | "error";
type ActivityEvent = { id: string; role: AgentRole; state: ActivityState; message: string; time: string };
type AgentConfig = { preset: string; adapter: AgentAdapter; model: string; endpoint: string; apiKey: string };
type AgentPreset = { id: string; adapter: AgentAdapter; name: string; model: string; note: string; badge?: string; endpoint?: string };
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
  motion?: MotionPreset;
  motionIntensity?: number;
  transition?: TransitionPreset;
  filter?: VisualFilter;
  speed?: number;
  volume?: number;
  subtitleEnabled?: boolean;
  subtitlePosition?: SubtitlePosition;
};
type Storyboard = { title: string; characters: CharacterAsset[]; music: string; scenes: Scene[] };

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
const MOTION_OPTIONS: Array<{ value: MotionPreset; label: string }> = [
  { value: "push", label: "缓慢推进" },
  { value: "pull", label: "拉远揭示" },
  { value: "pan-left", label: "向左横移" },
  { value: "pan-right", label: "向右横移" },
  { value: "float", label: "悬浮手持感" },
];
const TRANSITION_OPTIONS: Array<{ value: TransitionPreset; label: string }> = [
  { value: "fade", label: "叠化" },
  { value: "cut", label: "硬切" },
  { value: "flash", label: "闪白" },
];

const AGENT_ROLES: Array<{ id: AgentRole; icon: string; title: string; duty: string; recommends: string[] }> = [
  { id: "director", icon: "导", title: "导演 AI", duty: "审片、纠错、统一风格与节奏", recommends: ["GPT-5.6 Terra", "Gemini 3 Pro", "Qwen 3.5"] },
  { id: "writer", icon: "编", title: "编剧与分镜 AI", duty: "剧本改编、分镜表、提示词", recommends: ["GPT-5.6 Luna", "Gemini 3 Flash", "DeepSeek"] },
  { id: "image", icon: "图", title: "生图 AI", duty: "角色设定、场景与一致性关键帧", recommends: ["GPT Image 2", "Nano Banana", "FLUX"] },
  { id: "video", icon: "影", title: "视频 AI", duty: "文生视频、图生视频、参考图生视频", recommends: ["Veo 3.1", "Sora 2", "Seedance 2.0"] },
  { id: "voice", icon: "声", title: "配音 AI", duty: "角色音色、情绪、对白与旁白", recommends: ["Eleven v3", "Gemini TTS", "OpenAI Speech"] },
  { id: "editor", icon: "剪", title: "剪辑 AI", duty: "节奏、镜头排序、字幕与混音", recommends: ["漫镜智能剪辑", "GPT-5.6 Terra", "自定义工作流"] },
];

const AGENT_PRESETS: Record<AgentRole, AgentPreset[]> = {
  director: [
    { id: "horde-director", adapter: "horde", name: "AI Horde 导演", model: "Qwen 自动调度", note: "免费默认 · 独立复核剧本", badge: "免费" },
    { id: "pollinations-director", adapter: "pollinations", name: "Pollinations 导演", model: "openai", note: "推荐 · 需要发布密钥", badge: "推荐" },
    { id: "webhook-director", adapter: "webhook", name: "自定义导演接口", model: "your-director-model", note: "漫镜通用 Webhook" },
  ],
  writer: [
    { id: "horde-writer", adapter: "horde", name: "AI Horde 编剧", model: "Gemma 自动调度", note: "免费默认 · 剧本与分镜", badge: "免费" },
    { id: "pollinations-writer", adapter: "pollinations", name: "Pollinations 编剧", model: "openai", note: "推荐 · JSON 分镜", badge: "推荐" },
    { id: "webhook-writer", adapter: "webhook", name: "自定义语言模型", model: "your-llm", note: "OpenAI 兼容或自建转接" },
  ],
  image: [
    { id: "horde-image", adapter: "horde", name: "AI Horde 生图", model: "Stable Horde", note: "免费默认 · 需要排队", badge: "免费" },
    { id: "pollinations-image", adapter: "pollinations", name: "Pollinations 生图", model: "kontext", note: "推荐 · 支持角色参考图", badge: "推荐" },
    { id: "webhook-image", adapter: "webhook", name: "自定义生图接口", model: "gpt-image-2", note: "可接 GPT Image、FLUX 等" },
  ],
  video: [
    { id: "browser-video", adapter: "browser", name: "本地 2.5D 运镜", model: "Depth Motion", note: "免费默认 · 推拉/横移/景深光效，人物不会生成新动作", badge: "免费" },
    { id: "pollinations-video", adapter: "pollinations", name: "Pollinations 视频", model: "seedance-2.0", note: "推荐 · 文/图/参考图生视频", badge: "推荐" },
    { id: "webhook-video", adapter: "webhook", name: "自定义视频接口", model: "veo-3.1", note: "可接 Veo、Sora、Seedance" },
  ],
  voice: [
    { id: "browser-voice", adapter: "browser", name: "系统中文语音", model: "Web Speech", note: "免费默认 · 使用本机音色", badge: "免费" },
    { id: "pollinations-voice", adapter: "pollinations", name: "Pollinations 配音", model: "tts", note: "推荐 · 分角色生成音轨", badge: "推荐" },
    { id: "webhook-voice", adapter: "webhook", name: "自定义配音接口", model: "eleven-v3", note: "可接 ElevenLabs、Gemini TTS" },
  ],
  editor: [
    { id: "browser-editor", adapter: "browser", name: "漫镜智能剪辑", model: "AutoCut v1", note: "免费默认 · 本地合成", badge: "免费" },
    { id: "pollinations-editor", adapter: "pollinations", name: "Pollinations 剪辑师", model: "openai", note: "推荐 · AI 先给节奏方案", badge: "推荐" },
    { id: "webhook-editor", adapter: "webhook", name: "自定义剪辑接口", model: "your-editor-agent", note: "返回镜头顺序与时长" },
  ],
};

function configFromPreset(role: AgentRole, presetId: string): AgentConfig {
  const preset = AGENT_PRESETS[role].find((item) => item.id === presetId) || AGENT_PRESETS[role][0];
  return { preset: preset.id, adapter: preset.adapter, model: preset.model, endpoint: preset.endpoint || "", apiKey: "" };
}

function makeTeam(profile: "free" | "pollinations"): Record<AgentRole, AgentConfig> {
  return Object.fromEntries(AGENT_ROLES.map(({ id }) => [id, configFromPreset(id, profile === "free" ? AGENT_PRESETS[id][0].id : AGENT_PRESETS[id][1].id)])) as Record<AgentRole, AgentConfig>;
}

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

function parseStoryboard(raw: string, targetSeconds: number, minimumScenes = 2): Storyboard {
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
  if (sceneSource.length < minimumScenes) throw new Error("AI 没有生成足够的完整分镜，请再次生成");
  const picked = sceneSource.slice(0, 8) as Array<Record<string, unknown>>;
  const seconds = Math.max(1, Math.floor(targetSeconds / picked.length));
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
      duration: Math.max(1, Math.min(30, index === picked.length - 1 ? targetSeconds - seconds * (picked.length - 1) : seconds)),
      status: "queued",
      motion: (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4],
      motionIntensity: 1,
      transition: index === 0 ? "cut" : "fade",
      filter: "none",
      speed: 1,
      volume: 1,
      subtitleEnabled: true,
      subtitlePosition: "bottom",
    })),
  };
}

function completeFreeStoryboard(partial: Storyboard | null, story: string, visualStyle: string, targetSeconds: number): Storyboard {
  const count = targetSeconds < 10 ? 2 : targetSeconds > 75 ? 4 : 3;
  const seconds = Math.max(1, Math.floor(targetSeconds / count));
  const premise = story.replace(/\s+/g, " ").slice(0, 140);
  const characters = partial?.characters.length ? partial.characters : [
    { id: uid(), name: "主角", role: "故事推动者", appearance: `${visualStyle}风格，具有明确五官、固定发型和标志性服装的年轻主角`, voice: "nova", status: "queued" },
    { id: uid(), name: "关键人物", role: "冲突与秘密的承载者", appearance: `${visualStyle}风格，与主角形成轮廓和色彩对比，固定服装与神态`, voice: "onyx", status: "queued" },
  ];
  const beats = [
    { title: "异样开场", shot: "全景转中景", camera: "缓慢推进", visual: `建立故事空间与时间，围绕“${premise}”呈现一个反常细节，电影感光影和明确前后景`, action: "主角进入环境并注意到异常，先停顿观察，再主动靠近关键线索", dialogue: "这里，和我记得的不一样。", emotion: "警觉", sfx: "环境底噪渐弱，细微提示音出现" },
    { title: "线索逼近", shot: "双人中景", camera: "跟拍后轻微环绕", visual: "关键人物或关键物件进入画面，构图把双方关系和隐藏信息同时交代清楚", action: "主角试探，对方回避，动作和视线逐步暴露双方掌握的信息并不对等", dialogue: "你是不是早就知道了？", emotion: "克制质问", sfx: "脚步、衣料摩擦与短促停顿" },
    { title: "冲突反转", shot: "近景与特写", camera: "快速推近后停住", visual: "矛盾在同一空间内爆发，通过表情、手部动作和关键证据形成视觉反转", action: "关键人物揭开部分真相，主角从拒绝相信转为必须立即作出选择", dialogue: "如果现在不选，就再也来不及了。", emotion: "急迫", sfx: "低频冲击后瞬间安静" },
    { title: "悬念收束", shot: "特写转远景", camera: "拉远并留下空镜", visual: "主角做出第一步选择，但画面边缘出现新的代价或更大秘密，形成下一集钩子", action: "主角伸手触碰关键物件，画面在结果揭晓前切黑，只留下新的异常信号", dialogue: "原来，这才是开始。", emotion: "震惊后坚定", sfx: "心跳、信号声与切黑余响" },
  ];
  const existing = partial?.scenes || [];
  const names = characters.slice(0, 2).map((character) => character.name);
  const scenes = Array.from({ length: count }, (_, index) => {
    const source = existing[index];
    const beat = beats[index];
    return source ? { ...source, duration: index === count - 1 ? targetSeconds - seconds * (count - 1) : seconds, motion: source.motion || (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4], motionIntensity: source.motionIntensity || 1, transition: source.transition || (index === 0 ? "cut" : "fade"), filter: source.filter || "none", speed: source.speed || 1, volume: source.volume ?? 1, subtitleEnabled: source.subtitleEnabled !== false, subtitlePosition: source.subtitlePosition || "bottom" } : {
      id: uid(),
      title: beat.title,
      visual: beat.visual,
      action: beat.action,
      shot: beat.shot,
      camera: beat.camera,
      dialogue: beat.dialogue,
      speaker: characters[0].name,
      emotion: beat.emotion,
      sfx: beat.sfx,
      characters: names,
      duration: index === count - 1 ? targetSeconds - seconds * (count - 1) : seconds,
      status: "queued" as SceneStatus,
      motion: (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4],
      motionIntensity: 1,
      transition: index === 0 ? "cut" : "fade",
      filter: "none",
      speed: 1,
      volume: 1,
      subtitleEnabled: true,
      subtitlePosition: "bottom",
    };
  });
  return {
    title: partial?.title || "自动补全漫剧",
    characters,
    music: partial?.music || "cinematic emotional Chinese animation soundtrack, instrumental, rising tension, no vocals",
    scenes,
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

function drawMovingShot(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  width: number,
  height: number,
  index: number,
  progress: number,
  opacity = 1,
  motion: MotionPreset = "push",
  intensity = 1,
) {
  const eased = 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, progress))) / 2;
  const strength = Math.max(0.35, Math.min(1.8, intensity));
  let panX = 0;
  let panY = 0;
  let zoom = 1.05 + eased * 0.08 * strength;
  if (motion === "pull") zoom = 1.16 - eased * 0.1 * strength;
  if (motion === "pan-left") { panX = 1 - eased * 2; zoom = 1.11; }
  if (motion === "pan-right") { panX = eased * 2 - 1; zoom = 1.11; }
  if (motion === "float") {
    panX = Math.sin((progress * 2 + index) * Math.PI) * 0.24 * strength;
    panY = Math.cos((progress * 1.6 + index) * Math.PI) * 0.18 * strength;
    zoom = 1.085 + Math.sin(progress * Math.PI) * 0.025 * strength;
  }
  if (!(media instanceof HTMLVideoElement)) {
    ctx.save();
    ctx.filter = "blur(18px) saturate(.82) brightness(.58)";
    drawCover(ctx, media, width, height, 1.22, -panX * 0.2, -panY * 0.2, opacity);
    ctx.restore();
  }
  drawCover(ctx, media, width, height, zoom, panX, panY, opacity);
  if (!(media instanceof HTMLVideoElement)) {
    const lightX = width * (-0.25 + progress * 1.5);
    const glow = ctx.createRadialGradient(lightX, height * 0.22, 0, lightX, height * 0.22, width * 0.7);
    glow.addColorStop(0, `rgba(210,190,255,${0.11 * opacity})`);
    glow.addColorStop(1, "rgba(210,190,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
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
  const [agentConfigs, setAgentConfigs] = useState<Record<AgentRole, AgentConfig>>(() => makeTeam("free"));
  const [agentTeamLoaded, setAgentTeamLoaded] = useState(false);
  const [configuringRole, setConfiguringRole] = useState<AgentRole | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [draggingScene, setDraggingScene] = useState<number | null>(null);
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [musicVolume, setMusicVolume] = useState(0.16);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runRef = useRef(0);

  const totalDuration = useMemo(() => scenes.reduce((sum, item) => sum + item.duration, 0), [scenes]);
  const productionDuration = targetDuration || 30;
  const offsets = useMemo(() => scenes.map((_, index) => scenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0)), [scenes]);
  const timelineWidth = Math.max(720, totalDuration * 34 * timelineZoom);
  const currentIndex = scenes.length
    ? Math.max(0, scenes.findIndex((scene, index) => time >= offsets[index] && time < offsets[index] + scene.duration))
    : 0;
  const current = scenes[currentIndex] || scenes[selected];
  const activityByRole = useMemo(() => Object.fromEntries(AGENT_ROLES.map(({ id }) => [id, activityLog.find((item) => item.role === id)])) as Partial<Record<AgentRole, ActivityEvent>>, [activityLog]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedKey = window.localStorage.getItem("manjing-pollinations-key") || "";
      const savedDraft = window.localStorage.getItem("manjing-text-draft");
      const savedAgents = window.localStorage.getItem("manjing-agent-team");
      if (savedKey.startsWith("pk_")) setApiKey(savedKey);
      if (savedDraft) setStory(savedDraft);
      if (savedAgents) {
        try {
          const parsed = JSON.parse(savedAgents) as Partial<Record<AgentRole, AgentConfig>>;
          const merged = { ...makeTeam("free"), ...parsed };
          setAgentConfigs(merged);
          setMode(AGENT_ROLES.some(({ id }) => merged[id].adapter === "pollinations" || merged[id].adapter === "webhook") ? "cloud" : "community");
        } catch {
          window.localStorage.removeItem("manjing-agent-team");
        }
      }
      setAgentTeamLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("manjing-text-draft", story);
  }, [story]);

  useEffect(() => {
    if (apiKey.startsWith("pk_")) window.localStorage.setItem("manjing-pollinations-key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (agentTeamLoaded) window.localStorage.setItem("manjing-agent-team", JSON.stringify(agentConfigs));
  }, [agentConfigs, agentTeamLoaded]);

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
    videoRef.current.playbackRate = current?.speed || 1;
    if (playing) void videoRef.current.play().catch(() => undefined);
    else videoRef.current.pause();
  }, [playing, currentIndex, current?.speed]);

  function recordActivity(role: AgentRole, message: string, state: ActivityState = "running") {
    setActivityLog((items) => [{ id: uid(), role, message, state, time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...items].slice(0, 30));
  }

  function invalidateExport() {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function updateScene(id: string, patch: Partial<Scene>) {
    setScenes((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    invalidateExport();
  }

  function applyTeamProfile(profile: "free" | "pollinations") {
    setAgentConfigs(makeTeam(profile));
    setMode(profile === "free" ? "community" : "cloud");
    setConfiguringRole(null);
  }

  function selectAgentPreset(role: AgentRole, presetId: string) {
    const previous = agentConfigs[role];
    const next = configFromPreset(role, presetId);
    if (next.adapter === "webhook") {
      next.endpoint = previous.endpoint;
      next.apiKey = previous.apiKey;
      if (previous.adapter === "webhook") next.model = previous.model;
    }
    setAgentConfigs((current) => ({ ...current, [role]: next }));
    if (next.adapter !== "horde" && next.adapter !== "browser") setMode("cloud");
  }

  function updateAgentConfig(role: AgentRole, patch: Partial<AgentConfig>) {
    setAgentConfigs((current) => ({ ...current, [role]: { ...current[role], ...patch } }));
  }

  function agentName(role: AgentRole) {
    const config = agentConfigs[role];
    return AGENT_PRESETS[role].find((item) => item.id === config.preset)?.name || config.model;
  }

  function agentKey(role: AgentRole) {
    return agentConfigs[role].apiKey.trim() || apiKey.trim();
  }

  async function callAgentWebhook(role: AgentRole, payload: Record<string, unknown>) {
    const config = agentConfigs[role];
    if (!config.endpoint.startsWith("https://")) throw new Error(`${agentName(role)}需要填写 HTTPS 接口地址`);
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ role, model: config.model, ...payload }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return response;
  }

  async function webhookText(role: "director" | "writer" | "editor", payload: Record<string, unknown>) {
    const response = await callAgentWebhook(role, payload);
    const data = await response.json() as { text?: string; content?: string; result?: string };
    const text = data.text || data.content || data.result;
    if (!text) throw new Error(`${agentName(role)}没有返回文本结果`);
    return text;
  }

  async function webhookMedia(role: "image" | "video" | "voice", payload: Record<string, unknown>) {
    const response = await callAgentWebhook(role, payload);
    let blob: Blob;
    let remoteUrl = "";
    if ((response.headers.get("content-type") || "").startsWith(role === "image" ? "image/" : role === "video" ? "video/" : "audio/")) {
      blob = await response.blob();
    } else {
      const data = await response.json() as { url?: string; dataUrl?: string };
      remoteUrl = data.url || data.dataUrl || "";
      if (!remoteUrl) throw new Error(`${agentName(role)}没有返回媒体地址`);
      const mediaResponse = await fetch(remoteUrl);
      if (!mediaResponse.ok) throw new Error(`${agentName(role)}返回的媒体无法读取`);
      blob = await mediaResponse.blob();
    }
    const expected = role === "image" ? "image/" : role === "video" ? "video/" : "audio/";
    if (!blob.type.startsWith(expected)) throw new Error(`${agentName(role)}返回的文件类型不正确`);
    return { url: URL.createObjectURL(blob), blob, remoteUrl };
  }

  async function startHorde(action: "story" | "director" | "image", payload: Record<string, unknown>) {
    const response = await fetch("/api/horde", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return (await response.json()) as { id: string; kind: "text" | "image" };
  }

  async function pollHorde(
    kind: "text" | "image",
    id: string,
    run: number,
    options: { maxAttempts?: number; onPending?: (attempt: number, data: Record<string, unknown>) => void; timeoutMessage?: string } = {},
  ) {
    const maxAttempts = options.maxAttempts || 160;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (runRef.current !== run) throw new Error("任务已取消");
      const response = await fetch(`/api/horde?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.error) throw new Error(String(data.error || `生成失败（${response.status}）`));
      if (data.done) return data;
      options.onPending?.(attempt + 1, data);
      if (kind === "image" && typeof data.wait_time === "number") setStatusText(`社区队列处理中，预计等待 ${data.wait_time} 秒`);
      await wait(kind === "image" ? 4200 : 3000);
    }
    throw new Error(options.timeoutMessage || "生成等待超时，请稍后重试");
  }

  async function pollinationsText(role: "director" | "writer" | "editor", system: string, user: string) {
    const key = agentKey(role);
    if (!key.startsWith("pk_")) throw new Error(`${agentName(role)}需要 Pollinations 发布密钥`);
    const response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: agentConfigs[role].model || "openai",
        temperature: 0.7,
        safe: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("云端模型没有返回剧本");
    return content;
  }

  async function generateStoryboard(run: number) {
    const count = Math.max(3, Math.min(8, Math.ceil(productionDuration / 15)));
    const config = agentConfigs.writer;
    if (config.adapter === "horde") {
      const task = await startHorde("story", { story: story.trim(), style, count: Math.min(4, count), role: "writer", model: config.model });
      const result = await pollHorde("text", task.id, run);
      return String(result.text || "");
    }
    const system = `你是专业 AI 漫剧编剧和分镜师。把故事改编成恰好 ${count} 个连续、可拍摄的短剧镜头，只返回 JSON，所有内容使用简体中文。先建立最多 4 个固定角色，再写分镜和生成提示词。结构：{"title":"标题","music":"无歌词配乐描述","characters":[{"name":"角色名","role":"身份","appearance":"固定五官、发型、服装、年龄和气质","voice":"nova|coral|onyx|echo"}],"scenes":[{"title":"镜头标题","characters":["角色名"],"shot":"景别","visual":"场景、构图、灯光与生图提示词","action":"人物连续动作、表情、互动与视频提示词","camera":"运镜","speaker":"说话角色","emotion":"台词情绪","dialogue":"自然简短台词","sfx":"环境音或动作音","duration":6}]}。角色外观跨镜头必须一致；每镜都要推动剧情，结尾形成钩子；不要复述用户原文。`;
    const user = `视觉风格：${style}\n目标时长：${productionDuration} 秒\n故事：${story.trim()}`;
    if (config.adapter === "webhook") return webhookText("writer", { task: "storyboard", system, prompt: user, count, duration: productionDuration });
    return pollinationsText("writer", system, user);
  }

  async function directorReview(draft: string, run: number) {
    const config = agentConfigs.director;
    setStatusText(`${agentName("director")}正在审查人物一致性、节奏和结尾钩子`);
    if (config.adapter === "horde") {
      const task = await startHorde("director", { story: story.trim(), style, draft, count: Math.max(3, Math.min(4, Math.ceil(productionDuration / 30))), model: config.model });
      const result = await pollHorde("text", task.id, run, {
        maxAttempts: 6,
        timeoutMessage: "导演复核排队超时",
        onPending: (attempt) => {
          setProgress(Math.min(14, 10 + Math.ceil(attempt / 2)));
          setStatusText(`免费导演 AI 正在排队复核（已等待 ${attempt * 3} 秒），超过 18 秒将自动采用编剧初稿`);
        },
      });
      return String(result.text || draft);
    }
    const system = "你是 AI 漫剧总导演。审查编剧交付的 JSON 分镜，修复格式、人物一致性、时长、节奏和结尾钩子。保留同一 JSON 结构，只返回修订后的完整 JSON，不要解释。";
    const user = `原故事：${story.trim()}\n视觉风格：${style}\n编剧初稿：${draft}`;
    if (config.adapter === "webhook") return webhookText("director", { task: "review_storyboard", system, prompt: user, draft });
    return pollinationsText("director", system, user);
  }

  async function pollinationsMedia(
    kind: "image" | "audio" | "video",
    prompt: string,
    index = 0,
    options: { references?: string[]; voiceName?: string; duration?: number; music?: boolean } = {},
  ) {
    const role: "image" | "video" | "voice" = kind === "image" ? "image" : kind === "video" ? "video" : "voice";
    const config = agentConfigs[role];
    if (config.adapter === "webhook") return webhookMedia(role, { task: kind, prompt, index, aspect, ...options });
    if (config.adapter !== "pollinations") throw new Error(`${agentName(role)}不支持当前云端媒体任务`);
    const key = agentKey(role);
    if (!key.startsWith("pk_")) throw new Error(`${agentName(role)}需要 Pollinations 发布密钥`);
    const base = "https://gen.pollinations.ai";
    let url = "";
    if (kind === "image") {
      const params = new URLSearchParams({
        model: options.references?.length ? config.model || "kontext" : config.model === "kontext" ? "zimage" : config.model || "zimage",
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
        if (config.model && config.model !== "tts") params.set("model", config.model);
        params.set("voice", options.voiceName || voice);
      }
      url = `${base}/audio/${encodeURIComponent(prompt)}?${params}`;
    } else {
      const params = new URLSearchParams({
        model: config.model || "seedance-2.0",
        duration: String(Math.max(4, Math.min(10, Math.round(options.duration || 6)))),
        aspectRatio: aspect,
        audio: "false",
        safe: "true",
      });
      if (options.references?.length) params.set("image", options.references.slice(0, 1).join("|"));
      url = `${base}/video/${encodeURIComponent(prompt)}?${params}`;
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    const expected = kind === "image" ? "image/" : kind === "audio" ? "audio/" : "video/";
    if (!blob.type.startsWith(expected)) throw new Error(`${kind === "image" ? "图片" : kind === "audio" ? "配音" : "视频"}服务返回了无效文件`);
    return { url: URL.createObjectURL(blob), blob };
  }

  async function uploadPollinationsMedia(blob: Blob, filename: string, uploadKey = agentKey("image")) {
    const form = new FormData();
    form.append("file", blob, filename);
    const response = await fetch("https://gen.pollinations.ai/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${uploadKey}` },
      body: form,
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error("角色参考素材上传失败");
    return data.url;
  }

  async function makeImage(scene: Scene, index: number, run: number, characterGuide = "") {
    const prompt = `${STYLE_PROMPTS[style]}, premium animated film keyframe, one coherent scene rather than a comic page, polished linework, expressive eyes and natural hands, cinematic color grading, layered foreground middle ground and background for 2.5D motion, ${scene.shot}, ${scene.visual}, ${scene.action}, ${characterGuide}, preserve the exact same faces, hair and costumes across every shot, no typography, no speech bubbles, no panel borders`;
    if (agentConfigs.image.adapter === "pollinations" || agentConfigs.image.adapter === "webhook") return (await pollinationsMedia("image", prompt, index)).url;
    const task = await startHorde("image", { prompt, aspect, model: agentConfigs.image.model });
    const result = await pollHorde("image", task.id, run);
    const remote = String(result.imageUrl || "");
    const response = await fetch(`/api/media?url=${encodeURIComponent(remote)}`);
    if (!response.ok) throw new Error(await responseError(response));
    return URL.createObjectURL(await response.blob());
  }

  async function applyEditorPlan(work: Scene[]) {
    const config = agentConfigs.editor;
    if (config.adapter === "browser") return work;
    setStatusText(`${agentName("editor")}正在分析镜头节奏和剪辑顺序`);
    const compactScenes = work.map((scene) => ({ id: scene.id, title: scene.title, action: scene.action, dialogue: scene.dialogue, duration: scene.duration }));
    const system = "你是短视频剪辑师。根据剧情调整镜头顺序和单镜头时长，只返回 JSON：{\"order\":[\"镜头id\"],\"durations\":{\"镜头id\":6}}。不要删除镜头；每镜 2–30 秒；总时长尽量接近目标。";
    const prompt = `目标时长：${productionDuration} 秒\n镜头：${JSON.stringify(compactScenes)}`;
    let raw = "";
    if (config.adapter === "webhook") raw = await webhookText("editor", { task: "edit_plan", system, prompt, scenes: compactScenes, duration: productionDuration });
    else raw = await pollinationsText("editor", system, prompt);
    try {
      const parsed = JSON.parse(raw.replace(/```json/gi, "").replace(/```/g, "").trim()) as { order?: string[]; durations?: Record<string, number> };
      const byId = new Map(work.map((scene) => [scene.id, scene]));
      const order = Array.isArray(parsed.order) ? parsed.order.filter((id) => byId.has(id)) : [];
      const ordered = order.length === work.length ? order.map((id) => byId.get(id) as Scene) : work;
      return ordered.map((scene) => ({ ...scene, duration: Math.max(2, Math.min(30, Number(parsed.durations?.[scene.id]) || scene.duration)) }));
    } catch {
      return work;
    }
  }

  async function generateAll() {
    if (story.trim().length < 8 || !["idle", "ready", "error"].includes(phase)) return;
    const missingPollinationsKey = AGENT_ROLES.find(({ id }) => agentConfigs[id].adapter === "pollinations" && !agentKey(id).startsWith("pk_"));
    if (missingPollinationsKey) {
      setError(`${missingPollinationsKey.title}需要填写以 pk_ 开头的 Pollinations 发布密钥`);
      return;
    }
    const missingWebhook = AGENT_ROLES.find(({ id }) => agentConfigs[id].adapter === "webhook" && !agentConfigs[id].endpoint.startsWith("https://"));
    if (missingWebhook) {
      setConfiguringRole(missingWebhook.id);
      setError(`${missingWebhook.title}需要填写 HTTPS Webhook 地址`);
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
    setActivityLog([]);
    setPhase("story");
    setProgress(5);
    setStatusText("AI 正在理解故事并编写分镜");
    recordActivity("writer", `${agentName("writer")}开始改编剧本和拆分镜头`);
    try {
      let raw = await generateStoryboard(run);
      recordActivity("writer", "剧本初稿与分镜提示词已交付", "done");
      setProgress(10);
      recordActivity("director", `${agentName("director")}开始复核节奏、角色一致性和结尾钩子`);
      try {
        const reviewed = await directorReview(raw, run);
        parseStoryboard(reviewed, productionDuration);
        raw = reviewed;
        recordActivity("director", "导演复核通过，已锁定制作稿", "done");
      } catch {
        if (runRef.current !== run) throw new Error("任务已取消");
        setStatusText("导演复核暂时不可用，保留编剧初稿继续制作");
        recordActivity("director", "免费导演未及时交稿，已采用编剧初稿继续制作", "warning");
      }
      setProgress(15);
      let storyboard: Storyboard;
      try {
        storyboard = parseStoryboard(raw, productionDuration);
      } catch (reason) {
        if (agentConfigs.writer.adapter !== "horde") throw reason;
        let partial: Storyboard | null = null;
        try {
          partial = parseStoryboard(raw, productionDuration, 1);
        } catch {
          partial = null;
        }
        setStatusText("免费编剧输出不完整，漫镜正在自动补全分镜");
        storyboard = completeFreeStoryboard(partial, story.trim(), style, productionDuration);
        recordActivity("writer", "免费输出被截断，漫镜已补齐缺失镜头", "warning");
      }
      setProjectTitle(storyboard.title);
      setMusicPrompt(storyboard.music);
      let cast = storyboard.characters;
      let work = storyboard.scenes;
      setCharacters(cast);
      setScenes(work);
      setSelected(0);

      setPhase("characters");
      recordActivity("image", `${agentName("image")}开始生成角色设定与一致性参考`);
      for (let index = 0; index < cast.length; index += 1) {
        const character = cast[index];
        setStatusText(`正在建立角色资产 ${index + 1}/${cast.length}：${character.name}`);
        cast = cast.map((item) => item.id === character.id ? { ...item, status: "generating" as const } : item);
        setCharacters(cast);
        const characterPrompt = `${STYLE_PROMPTS[style]}, premium animation character design, ${character.name}, ${character.role}, ${character.appearance}, full body and face close-up, correct anatomy and natural hands, clean neutral background, exact fixed facial features and costume, polished linework, no typography`;
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", characterPrompt, 50 + index);
          const assetUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : assetUploadKey ? await uploadPollinationsMedia(asset.blob, `character-${index + 1}.png`, assetUploadKey) : "";
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: asset.url, remoteUrl, status: "ready" as const } : item);
        } else {
          const referenceScene: Scene = { id: uid(), title: character.name, visual: characterPrompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
          const imageUrl = await makeImage(referenceScene, 50 + index, run);
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl, status: "ready" as const } : item);
        }
        setCharacters(cast);
        setProgress(10 + Math.round(((index + 1) / cast.length) * 16));
      }
      recordActivity("image", `${cast.length} 个角色资产已建立，开始绘制连续分镜`);

      setPhase("images");
      for (let index = 0; index < work.length; index += 1) {
        const scene = work[index];
        setStatusText(`正在制作第 ${index + 1}/${work.length} 个一致性分镜`);
        updateScene(scene.id, { status: "painting" });
        const presentCast = cast.filter((character) => scene.characters.includes(character.name) || scene.speaker === character.name);
        const castForScene = presentCast.length ? presentCast : cast.slice(0, 2);
        const characterGuide = castForScene.map((character) => `${character.name}: ${character.appearance}`).join("; ");
        if (agentConfigs.image.adapter !== "horde") {
          const framePrompt = `${STYLE_PROMPTS[style]}, premium animated film keyframe, one coherent scene rather than a comic page, exact identities and costumes from the character references, ${scene.shot}, ${scene.visual}, ${scene.action}, expressive face, natural anatomy and hands, cinematic composition and color grading, layered depth for 2.5D camera motion, coherent spatial layout, no text, no speech bubbles, no panel borders`;
          const frame = await pollinationsMedia("image", framePrompt, index, { references: castForScene.map((item) => item.remoteUrl).filter(Boolean) as string[] });
          const frameUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : frameUploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${index + 1}.png`, frameUploadKey) : "";
          work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: frame.url, remoteImageUrl, status: "ready" as SceneStatus } : item);
        } else {
          const imageUrl = await makeImage(scene, index, run, characterGuide);
          work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl, status: "ready" as SceneStatus } : item));
        }
        setScenes(work);
        setProgress(26 + Math.round(((index + 1) / work.length) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
      }
      recordActivity("image", `${work.length} 张分镜关键帧已生成`, "done");

      if (agentConfigs.video.adapter !== "browser") {
        setPhase("video");
        recordActivity("video", `${agentName("video")}开始把关键帧生成原生动态镜头`);
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
        recordActivity("video", `${work.length} 个动态视频镜头已生成`, "done");
      } else {
        recordActivity("video", "免费模式使用 2.5D 运镜、景深和光影动画，不包含人物肢体生成", "warning");
      }

      if (voiceEnabled && agentConfigs.voice.adapter !== "browser") {
        setPhase("voice");
        recordActivity("voice", `${agentName("voice")}开始逐镜生成角色配音`);
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
        recordActivity("voice", `${work.length} 条角色音轨已生成`, "done");
      } else if (voiceEnabled) {
        recordActivity("voice", "免费模式使用设备中文语音预览，不会写入可下载音轨", "warning");
      } else {
        recordActivity("voice", "用户已关闭自动配音", "warning");
      }

      let generatedMusicUrl = "";
      if (bgmEnabled && agentConfigs.voice.adapter !== "browser") {
        setPhase("music");
        setStatusText("正在生成与剧情节奏匹配的无歌词配乐");
        const soundtrack = await pollinationsMedia("audio", storyboard.music, 0, { music: true, duration: work.reduce((sum, item) => sum + item.duration, 0) });
        generatedMusicUrl = soundtrack.url;
        setMusicUrl(soundtrack.url);
      }
      recordActivity("editor", `${agentName("editor")}开始调整顺序、节奏、字幕和混音`);
      work = await applyEditorPlan(work);
      setScenes(work);
      setProgress(88);
      setStatusText(agentConfigs.video.adapter !== "browser" ? "AI 制片组已完成素材，正在合成最终漫剧" : "免费制片组已完成，正在生成低动态样片");
      const exported = await exportFilm(work, true, generatedMusicUrl);
      if (!exported) return;
      recordActivity("editor", "剪辑完成，成片和全部中间素材均可下载", "done");
    } catch (reason) {
      if (runRef.current !== run) return;
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "生成失败，请重试");
      setStatusText("生成中断");
      recordActivity("director", reason instanceof Error ? `制作中断：${reason.message}` : "制作中断", "error");
    }
  }

  function cancelGeneration() {
    runRef.current = Date.now();
    setPhase(scenes.length ? "ready" : "idle");
    setStatusText("已停止当前任务");
  }

  async function regenerateImage(scene: Scene, index: number) {
    if (agentConfigs.image.adapter === "pollinations" && !agentKey("image").startsWith("pk_")) {
      setError("生图 AI 需要先填写发布密钥");
      return;
    }
    if (agentConfigs.image.adapter === "webhook" && !agentConfigs.image.endpoint.startsWith("https://")) {
      setConfiguringRole("image");
      setError("请先配置生图 AI 的 Webhook");
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setError("");
    updateScene(scene.id, { status: "painting" });
    recordActivity("image", `${agentName("image")}正在重绘“${scene.title}”`);
    try {
      if (scene.imageUrl) URL.revokeObjectURL(scene.imageUrl);
      if (agentConfigs.image.adapter !== "horde") {
        const presentCast = characters.filter((character) => scene.characters.includes(character.name) || scene.speaker === character.name);
        const frame = await pollinationsMedia("image", `${STYLE_PROMPTS[style]}, premium animated film keyframe, one coherent scene, preserve the exact identities and costumes from references, ${scene.shot}, ${scene.visual}, ${scene.action}, expressive face, natural anatomy and hands, cinematic composition and color grading, layered depth, no text, no speech bubbles, no panel borders`, index, { references: presentCast.map((item) => item.remoteUrl).filter(Boolean) as string[] });
        const revisionUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
        const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : revisionUploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${index + 1}-revision.png`, revisionUploadKey) : "";
        updateScene(scene.id, { imageUrl: frame.url, remoteImageUrl, videoUrl: undefined, status: "ready" });
      } else {
        const characterGuide = characters.filter((character) => scene.characters.includes(character.name)).map((character) => `${character.name}: ${character.appearance}`).join("; ");
        const imageUrl = await makeImage(scene, index, run, characterGuide);
        updateScene(scene.id, { imageUrl, videoUrl: undefined, status: "ready" });
      }
      recordActivity("image", `“${scene.title}”的新画面已交付`, "done");
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "画面生成失败");
      recordActivity("image", `“${scene.title}”重绘失败`, "error");
    }
  }

  async function generateVideo(scene: Scene) {
    if (agentConfigs.video.adapter === "browser") {
      setConfiguringRole("video");
      setError("当前是免费本地运镜样片，请为视频 AI 选择 Seedance 或自定义视频接口");
      return;
    }
    if (agentConfigs.video.adapter === "pollinations" && !agentKey("video").startsWith("pk_")) {
      setError("视频 AI 需要发布密钥");
      return;
    }
    if (agentConfigs.video.adapter === "webhook" && !agentConfigs.video.endpoint.startsWith("https://")) {
      setConfiguringRole("video");
      setError("请先配置视频 AI 的 Webhook");
      return;
    }
    setError("");
    updateScene(scene.id, { status: "animating" });
    recordActivity("video", `${agentName("video")}正在重做“${scene.title}”的动态表演`);
    try {
      const clip = await pollinationsMedia("video", `${STYLE_PROMPTS[style]}, preserve exact character identity and costume. ${scene.action}. Camera: ${scene.camera}. Natural expressions and coherent motion, one continuous shot, no text.`, 0, { references: scene.remoteImageUrl ? [scene.remoteImageUrl] : [], duration: scene.duration });
      if (scene.videoUrl) URL.revokeObjectURL(scene.videoUrl);
      updateScene(scene.id, { videoUrl: clip.url, status: "ready", duration: Math.max(4, Math.min(10, scene.duration)) });
      recordActivity("video", `“${scene.title}”的原生动态镜头已交付`, "done");
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "动态镜头生成失败");
      recordActivity("video", `“${scene.title}”视频生成失败`, "error");
    }
  }

  function moveScene(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    reorderScene(index, nextIndex);
  }

  function reorderScene(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= scenes.length || to >= scenes.length) return;
    setScenes((items) => {
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setTime(next.slice(0, to).reduce((sum, item) => sum + item.duration, 0));
      return next;
    });
    setSelected(to);
    setPlaying(false);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function deleteScene(index: number) {
    const item = scenes[index];
    if (item?.imageUrl && !scenes.some((scene, sceneIndex) => sceneIndex !== index && scene.imageUrl === item.imageUrl)) URL.revokeObjectURL(item.imageUrl);
    if (item?.audioUrl && !scenes.some((scene, sceneIndex) => sceneIndex !== index && scene.audioUrl === item.audioUrl)) URL.revokeObjectURL(item.audioUrl);
    if (item?.videoUrl && !scenes.some((scene, sceneIndex) => sceneIndex !== index && scene.videoUrl === item.videoUrl)) URL.revokeObjectURL(item.videoUrl);
    setScenes((items) => items.filter((_, itemIndex) => itemIndex !== index));
    setSelected(Math.max(0, Math.min(selected, scenes.length - 2)));
    setPlaying(false);
    setTime(0);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function splitAtPlayhead() {
    const index = scenes.findIndex((scene, sceneIndex) => {
      const localTime = time - offsets[sceneIndex];
      return localTime >= 2 && localTime <= scene.duration - 2;
    });
    if (index < 0) {
      setError("请把播放头移到镜头内部，且距离片段两端至少 2 秒后再分割");
      return;
    }
    const scene = scenes[index];
    const firstDuration = Number((time - offsets[index]).toFixed(1));
    const secondDuration = Number((scene.duration - firstDuration).toFixed(1));
    const first = { ...scene, duration: firstDuration };
    const second = { ...scene, id: uid(), title: `${scene.title} · 后段`, duration: secondDuration };
    setScenes((items) => [...items.slice(0, index), first, second, ...items.slice(index + 1)]);
    setSelected(index + 1);
    setPlaying(false);
    setError("");
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function addScene() {
    const lead = characters[0]?.name || "主角";
    setScenes((items) => [...items, { id: uid(), title: "新镜头", visual: "描述场景、构图和光线", action: "描述角色连续动作和表情变化", shot: "中景", camera: "缓慢推进", dialogue: "输入角色台词", speaker: lead, emotion: "自然", sfx: "环境氛围声", characters: [lead], duration: 6, status: "queued", motion: "push", motionIntensity: 1, transition: "fade", filter: "none", speed: 1, volume: 1, subtitleEnabled: true, subtitlePosition: "bottom" }]);
    setSelected(scenes.length);
    invalidateExport();
  }

  function duplicateScene(index: number) {
    const source = scenes[index];
    if (!source) return;
    const copy = { ...source, id: uid(), title: `${source.title} · 副本` };
    setScenes((items) => [...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
    setSelected(index + 1);
    invalidateExport();
    recordActivity("editor", `已复制镜头“${source.title}”`, "done");
  }

  function replaceSceneMedia(scene: Scene, kind: "image" | "video" | "audio", file?: File) {
    if (!file) return;
    const field = kind === "image" ? "imageUrl" : kind === "video" ? "videoUrl" : "audioUrl";
    const previous = scene[field];
    if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    updateScene(scene.id, { [field]: url, status: "ready", model: "本地导入" });
    recordActivity("editor", `已为“${scene.title}”替换${kind === "image" ? "画面" : kind === "video" ? "视频" : "配音"}`, "done");
  }

  function safeFilename(value: string) {
    return (value || "漫镜素材").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadAsset(url: string, filename: string, fallbackExtension: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("素材读取失败");
      const blob = await response.blob();
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : blob.type.includes("jpeg") ? "jpg" : blob.type.includes("mp4") ? "mp4" : blob.type.includes("mpeg") ? "mp3" : blob.type.includes("wav") ? "wav" : blob.type.includes("webm") ? "webm" : fallbackExtension;
      saveBlob(blob, `${safeFilename(filename)}.${extension}`);
    } catch {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFilename(filename)}.${fallbackExtension}`;
      anchor.target = "_blank";
      anchor.click();
    }
  }

  function downloadScript() {
    const content = [
      `《${projectTitle || "未命名漫剧"}》`,
      `原始梗概：${story.trim()}`,
      `画面风格：${style}｜比例：${aspect}｜总时长：${totalDuration} 秒`,
      "",
      ...scenes.flatMap((scene, index) => [
        `第 ${index + 1} 镜｜${scene.title}｜${scene.duration} 秒`,
        `场景：${scene.visual}`,
        `表演：${scene.action}`,
        `镜头：${scene.shot}，${scene.camera}`,
        `对白：${scene.speaker}（${scene.emotion}）：${scene.dialogue}`,
        `声音：${scene.sfx}`,
        "",
      ]),
    ].join("\n");
    saveBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), `${safeFilename(projectTitle)}-剧本.txt`);
  }

  function downloadStoryboard() {
    const payload = { title: projectTitle, premise: story.trim(), style, aspect, duration: totalDuration, music: musicPrompt, characters: characters.map((character) => ({ id: character.id, name: character.name, role: character.role, appearance: character.appearance, voice: character.voice, status: character.status, reference: character.remoteUrl || "" })), scenes: scenes.map(({ imageUrl, videoUrl, audioUrl, ...scene }, index) => ({ order: index + 1, ...scene, image: imageUrl?.startsWith("http") ? imageUrl : "", video: videoUrl?.startsWith("http") ? videoUrl : "", audio: audioUrl?.startsWith("http") ? audioUrl : "" })) };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFilename(projectTitle)}-分镜.json`);
  }

  function downloadProject() {
    const payload = { format: "manjing-project", version: 1, savedAt: new Date().toISOString(), projectTitle, story, style, targetDuration, aspect, voiceEnabled, bgmEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, characters: characters.map(({ imageUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined })), scenes: scenes.map(({ imageUrl, videoUrl, audioUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined, videoUrl: videoUrl?.startsWith("http") ? videoUrl : undefined, audioUrl: audioUrl?.startsWith("http") ? audioUrl : undefined })) };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFilename(projectTitle)}-漫镜工程.json`);
  }

  async function importProject(file?: File) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>;
      if (payload.format !== "manjing-project" || !Array.isArray(payload.scenes)) throw new Error("这不是有效的漫镜工程文件");
      const importedScenes = (payload.scenes as Scene[]).slice(0, 50).map((scene, index) => ({ ...scene, id: uid(), title: String(scene.title || `镜头 ${index + 1}`), duration: Math.max(1, Math.min(30, Number(scene.duration) || 6)), status: scene.imageUrl || scene.videoUrl ? "ready" as SceneStatus : "queued" as SceneStatus }));
      setProjectTitle(String(payload.projectTitle || "导入的漫镜工程").slice(0, 60));
      setStory(String(payload.story || "导入工程的故事梗概"));
      if (typeof payload.style === "string" && STYLE_PROMPTS[payload.style]) setStyle(payload.style);
      if (payload.aspect === "9:16" || payload.aspect === "16:9") setAspect(payload.aspect);
      setTargetDuration(Number(payload.targetDuration) || 0);
      setScenes(importedScenes);
      setCharacters(Array.isArray(payload.characters) ? (payload.characters as CharacterAsset[]).slice(0, 12).map((item) => ({ ...item, id: uid() })) : []);
      setMusicPrompt(String(payload.musicPrompt || ""));
      setSubtitleScale(Math.max(0.7, Math.min(1.6, Number(payload.subtitleScale) || 1)));
      setSubtitleColor(typeof payload.subtitleColor === "string" ? payload.subtitleColor : "#ffffff");
      setMusicVolume(Math.max(0, Math.min(0.8, Number(payload.musicVolume) || 0.16)));
      setSelected(0);
      setTime(0);
      setPhase("ready");
      setError("");
      invalidateExport();
      recordActivity("editor", `已导入工程，共 ${importedScenes.length} 个镜头`, "done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工程文件导入失败");
    }
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
      video.loop = true;
      video.playbackRate = scene.speed || 1;
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
          const voiceGain = audioContext.createGain();
          source.buffer = buffer;
          voiceGain.gain.value = Math.max(0, Math.min(2, movieScenes[index].volume ?? 1));
          source.connect(voiceGain).connect(destination);
          source.start(audioStart + audioOffset);
        }
        audioOffset += movieScenes[index].duration;
      });
      if (soundtrackBuffer) {
        const soundtrack = audioContext.createBufferSource();
        const soundtrackGain = audioContext.createGain();
        soundtrack.buffer = soundtrackBuffer;
        soundtrack.loop = soundtrackBuffer.duration < movieDuration;
        soundtrackGain.gain.value = Math.max(0, Math.min(0.8, musicVolume));
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
          const transitionMode = scene.transition || "fade";
          const transition = index === 0 || transitionMode === "cut" ? 1 : Math.min(1, local * (transitionMode === "flash" ? 9 : 5));
          const filter = scene.filter === "warm" ? "sepia(.14) saturate(1.12)" : scene.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : scene.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";
          if (index > 0 && transition < 1) {
            const previous = movieScenes[index - 1];
            ctx.save();
            ctx.filter = previous.filter === "warm" ? "sepia(.14) saturate(1.12)" : previous.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : previous.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";
            drawMovingShot(ctx, visuals[index - 1], width, height, index - 1, 1, 1, previous.motion, previous.motionIntensity);
            ctx.restore();
          }
          ctx.save();
          ctx.filter = filter;
          drawMovingShot(ctx, visual, width, height, index, local, transition, scene.motion, scene.motionIntensity);
          ctx.restore();
          if (transitionMode === "flash" && local < 0.14) {
            ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.75 - local * 5.3)})`;
            ctx.fillRect(0, 0, width, height);
          }
          const shade = ctx.createLinearGradient(0, height * 0.48, 0, height);
          shade.addColorStop(0, "rgba(9,7,12,0)");
          shade.addColorStop(1, "rgba(9,7,12,.88)");
          ctx.fillStyle = shade;
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "rgba(255,255,255,.72)";
          ctx.font = `${Math.round(width * 0.022)}px Microsoft YaHei, sans-serif`;
          ctx.fillText(`${String(index + 1).padStart(2, "0")}  ${scene.title}`, width * 0.07, height * 0.09);
          if (scene.subtitleEnabled !== false && scene.dialogue) {
            const subtitleY = scene.subtitlePosition === "top" ? height * 0.18 : scene.subtitlePosition === "center" ? height * 0.5 : height * 0.86;
            ctx.textAlign = "center";
            ctx.fillStyle = subtitleColor;
            ctx.font = `600 ${Math.round(width * 0.044 * subtitleScale)}px Microsoft YaHei, sans-serif`;
            ctx.shadowColor = "rgba(0,0,0,.92)";
            ctx.shadowBlur = Math.round(width * 0.012);
            wrapCanvasText(ctx, `“${scene.dialogue}”`, width / 2, subtitleY, width * 0.78, width * 0.06 * subtitleScale, 3);
            ctx.shadowBlur = 0;
          }
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
  const nativeVideoEnabled = agentConfigs.video.adapter !== "browser";
  const generatedVoiceEnabled = agentConfigs.voice.adapter !== "browser";
  const freeTeamActive = AGENT_ROLES.every(({ id }) => agentConfigs[id].preset === AGENT_PRESETS[id][0].id);
  const recommendedTeamActive = AGENT_ROLES.every(({ id }) => agentConfigs[id].preset === AGENT_PRESETS[id][1].id);
  const previewFilter = current?.filter === "warm" ? "sepia(.14) saturate(1.12)" : current?.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : current?.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";

  return (
    <main id="top">
      <nav className="nav">
        <a className="brand" href="#top"><span>漫</span><strong>漫镜</strong><small>AI 漫剧工作台</small></a>
        <div className="nav-links"><a href="#studio">创作</a><a href="#works">剪辑台</a><a href="#capabilities">能力说明</a></div>
        <button className={`connection ${mode}`} onClick={() => document.getElementById("provider")?.scrollIntoView({ behavior: "smooth" })}>
          <i />{freeTeamActive ? "免费 AI 制片组" : "自定义 AI 制片组"}
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
            <div className="duration-setting">
              <div><label htmlFor="target-duration">目标时长</label><b>{targetDuration === 0 ? "自动" : formatTime(targetDuration)}</b></div>
              <input id="target-duration" type="range" min={0} max={120} step={5} value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))} />
              <small><span>0 秒</span><span>{targetDuration === 0 ? "自动判断剧情长度" : "拖动选择成片长度"}</span><span>2 分钟</span></small>
            </div>
            <div className="aspect-setting"><label>画面比例</label><select value={aspect} onChange={(event) => setAspect(event.target.value as "9:16" | "16:9")}><option value="9:16">竖屏 9:16</option><option value="16:9">横屏 16:9</option></select></div>
            <div className="voice-row"><div><label>自动配音</label><small>{generatedVoiceEnabled ? "由配音 AI 生成音轨并写入成片" : "使用设备中文语音预览"}</small></div><button className={`toggle ${voiceEnabled ? "on" : ""}`} aria-label="切换自动配音" onClick={() => setVoiceEnabled((value) => !value)}><i /></button></div>
            {generatedVoiceEnabled && <div className="voice-row"><div><label>剧情配乐</label><small>由声音岗位生成无歌词 BGM 并自动混音</small></div><button className={`toggle ${bgmEnabled ? "on" : ""}`} aria-label="切换剧情配乐" onClick={() => setBgmEnabled((value) => !value)}><i /></button></div>}
            {generatedVoiceEnabled && voiceEnabled && <select aria-label="配音音色" value={voice} onChange={(event) => setVoice(event.target.value)}>{VOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}
          </div>
        </div>

        <div className="ai-team">
          <div className="ai-team-heading"><div><span>AI 制片组</span><h3>六个岗位，各自调用自己的模型</h3><p>编剧先交稿，导演复核；画面、视频和声音分工生产，最后由剪辑 AI 形成成片。</p></div><div className="team-profiles"><button className={freeTeamActive ? "active" : ""} onClick={() => applyTeamProfile("free")}>免费默认阵容</button><button className={recommendedTeamActive ? "active" : ""} onClick={() => applyTeamProfile("pollinations")}>一键应用推荐阵容</button></div></div>
          <div className="agent-grid">
            {AGENT_ROLES.map((role) => {
              const config = agentConfigs[role.id];
              const presets = AGENT_PRESETS[role.id];
              return <article key={role.id} className={`agent-card ${config.adapter}`}>
                <div className="agent-card-top"><i>{role.icon}</i><div><b>{role.title}</b><span>{role.duty}</span></div><em>{config.adapter === "horde" || config.adapter === "browser" ? "免费" : config.adapter === "webhook" ? "自定义" : "已托管"}</em></div>
                <select aria-label={`选择${role.title}`} value={config.preset} onChange={(event) => selectAgentPreset(role.id, event.target.value)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.model}</option>)}</select>
                <div className="agent-model"><span>当前模型</span><b>{config.model}</b><small>{presets.find((item) => item.id === config.preset)?.note}</small></div>
                <div className="recommend-row"><span>推荐</span>{role.recommends.map((item) => <i key={item}>{item}</i>)}</div>
                <button className="agent-config-button" onClick={() => setConfiguringRole(configuringRole === role.id ? null : role.id)}>{configuringRole === role.id ? "收起设置" : "配置模型与接口"}</button>
                {configuringRole === role.id && <div className="agent-config-panel">
                  <label>模型 ID<input value={config.model} onChange={(event) => updateAgentConfig(role.id, { model: event.target.value })} placeholder="模型名称或 ID" /></label>
                  {config.adapter === "webhook" && <label>Webhook 地址<input value={config.endpoint} onChange={(event) => updateAgentConfig(role.id, { endpoint: event.target.value.trim() })} placeholder="https://..." /></label>}
                  {(config.adapter === "pollinations" || config.adapter === "webhook") && <label>岗位专用 API 密钥（可选）<input type="password" value={config.apiKey} onChange={(event) => updateAgentConfig(role.id, { apiKey: event.target.value.trim() })} placeholder={config.adapter === "pollinations" ? "留空则使用下方统一密钥" : "Bearer token，可留空"} /></label>}
                  {config.adapter === "webhook" && <small>漫镜会 POST role、model、task 和输入内容；接口返回 text，或可下载的 url。需允许浏览器跨域访问。</small>}
                </div>}
              </article>;
            })}
          </div>
        </div>

        <div id="provider" className="provider-box">
          <div className="provider-tabs">
            <button className={freeTeamActive ? "active" : ""} onClick={() => applyTeamProfile("free")}><b>免费多 AI 流程</b><span>Horde 编剧/导演/生图 · 本地配音剪辑</span></button>
            <button className={recommendedTeamActive ? "active" : ""} onClick={() => applyTeamProfile("pollinations")}><b>推荐 AI 制片组</b><span>独立导演 · 编剧 · 生图 · 视频 · 配音 · 剪辑</span></button>
          </div>
          {freeTeamActive ? <p className="provider-note"><b>免费边界：</b>语言和生图岗位使用社区算力，画质与一致性会随在线模型变化；视频岗位只做 2.5D 推拉、横移、景深和光影动画，人物本身不会产生走路、口型等新动作。可只替换“生图 AI”或“视频 AI”，不必整套更换。</p> : <div className="key-panel"><div><b>统一备用密钥</b><span>未填写岗位专用密钥时使用这里的 Pollinations 密钥；所有密钥只保存在当前设备。</span></div><div className="key-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder="pk_..." aria-label="Pollinations 发布密钥" /><a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">获取密钥 ↗</a></div></div>}
        </div>

        <div className="generate-row">
          <button className="generate-button" onClick={generateAll} disabled={busy || story.trim().length < 8}><span>✦</span>{busy ? "AI 制片组正在协作" : nativeVideoEnabled ? "让 AI 制片组生成漫剧" : "让免费 AI 制片组生成样片"}<small>导演审片 + 编剧分镜 + 图像 + 视频 + 配音 + 剪辑</small></button>
          {busy && phase !== "exporting" && <button className="cancel-button" onClick={cancelGeneration}>停止</button>}
        </div>
        {(phase !== "idle" || error) && <div className={`job-status ${error ? "has-error" : ""}`}><div className="status-copy"><b>{error || statusText}</b><span>{error ? "请检查对应 AI 岗位的接口设置后重试。" : `${visibleProgress}%`}</span></div><div className="status-bar"><i style={{ width: `${visibleProgress}%` }} /></div><div className="status-steps"><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>编剧</span><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>导演</span><span className={["characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>生图</span><span className={["video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>{nativeVideoEnabled ? "视频" : "运镜"}</span><span className={["voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>配音</span><span className={["exporting", "ready"].includes(phase) ? "active" : ""}>剪辑</span></div></div>}
        {(activityLog.length > 0 || busy) && <div className="workflow-monitor">
          <div className="workflow-heading"><div><b>AI 制作现场</b><span>每个岗位正在做什么、用了哪个模型、交付了什么，都实时记录</span></div><em>{busy ? "制作直播中" : "本次流程已保存"}</em></div>
          <div className="workflow-roles">{AGENT_ROLES.map((role) => {
            const latest = activityByRole[role.id];
            return <article key={role.id} className={latest?.state || "waiting"}><i>{role.icon}</i><div><b>{role.title}</b><span>{latest?.message || "等待上游交付"}</span><small>{agentName(role.id)}</small></div><em>{latest?.state === "running" ? "工作中" : latest?.state === "done" ? "已交付" : latest?.state === "warning" ? "已降级" : latest?.state === "error" ? "中断" : "等待"}</em></article>;
          })}</div>
          <div className="workflow-log"><b>制作记录</b><div>{activityLog.length ? activityLog.map((item) => <p key={item.id} className={item.state}><time>{item.time}</time><span>{AGENT_ROLES.find((role) => role.id === item.role)?.title}</span>{item.message}</p>) : <p><time>--:--</time><span>制片组</span>任务开始后，这里会显示每一步真实进度</p>}</div></div>
        </div>}
      </section>

      <section id="works" className="works section-shell">
        <div className="section-heading"><span>02</span><div><p>剪辑工作台</p><h2>{scenes.length ? projectTitle : "生成后在这里剪辑"}</h2></div><aside>{scenes.length ? `${scenes.length} 个镜头 · ${formatTime(totalDuration)}` : "尚无作品"}</aside></div>
        {!!characters.length && <div className="production-assets">
          <div className="asset-heading"><div><b>角色资产库</b><span>固定人物的五官、发型、服装与专属音色，作为后续镜头参考</span></div><em>{characters.filter((item) => item.status === "ready").length}/{characters.length} 已锁定</em></div>
          <div className="character-list">{characters.map((character) => <article key={character.id} className={character.status}>
            <div className="character-portrait">{character.imageUrl ? <img src={character.imageUrl} alt={`${character.name}角色设定`} /> : <span>{character.status === "generating" ? "生成中" : character.name.slice(0, 1)}</span>}</div>
            <div><b>{character.name}</b><small>{character.role} · {VOICES.find((item) => item.value === character.voice)?.label || "角色音色"}</small><p>{character.appearance}</p>{character.imageUrl && <button className="asset-download-mini" onClick={() => void downloadAsset(character.imageUrl as string, `${projectTitle}-${character.name}-角色设定`, "png")}>下载角色图</button>}</div>
          </article>)}</div>
          <div className="quality-gates">
            <span className={characters.every((item) => item.imageUrl) ? "passed" : ""}>角色参考</span>
            <span className={scenes.every((item) => item.imageUrl) ? "passed" : ""}>一致性分镜</span>
            <span className={nativeVideoEnabled && scenes.every((item) => item.videoUrl) ? "passed" : ""}>动态表演</span>
            <span className={generatedVoiceEnabled && voiceEnabled && scenes.every((item) => item.audioUrl) ? "passed" : ""}>分角色配音</span>
            <span className={generatedVoiceEnabled && bgmEnabled && !!musicUrl ? "passed" : ""}>剧情配乐</span>
            <span className={!!exportUrl ? "passed" : ""}>最终成片</span>
          </div>
        </div>}
        {!!scenes.length && <div className="delivery-center">
          <div className="delivery-heading"><div><b>交付物与素材库</b><span>剧本、分镜、角色图、镜头图片、视频、配音和成片都可以单独下载</span></div><label className="project-import">导入漫镜工程<input type="file" accept="application/json,.json" onChange={(event) => { void importProject(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
          <div className="delivery-actions">
            <button onClick={downloadScript}><i>文</i><span><b>下载剧本</b><small>TXT · 含对白、动作和声音</small></span></button>
            <button onClick={downloadStoryboard}><i>镜</i><span><b>下载分镜</b><small>JSON · 可交给其他模型继续制作</small></span></button>
            <button onClick={downloadProject}><i>工</i><span><b>保存工程</b><small>JSON · 保留剪辑参数，稍后再改</small></span></button>
            <button onClick={downloadFilm} disabled={!exportUrl}><i>片</i><span><b>下载成片</b><small>{exportUrl ? "视频文件已就绪" : "重新合成后可下载"}</small></span></button>
          </div>
          <div className="media-bin">{scenes.map((scene, index) => <article key={scene.id} className={selected === index ? "selected" : ""} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}>
            <div className="media-bin-thumb">{scene.videoUrl ? <video src={scene.videoUrl} muted /> : scene.imageUrl ? <img src={scene.imageUrl} alt="" /> : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
            <div><b>{String(index + 1).padStart(2, "0")} · {scene.title}</b><small>{scene.videoUrl ? "原生视频" : scene.imageUrl ? "2.5D 图片镜头" : "等待画面"} · {scene.duration} 秒</small></div>
            <div className="media-downloads">{scene.imageUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.imageUrl as string, `${projectTitle}-${index + 1}-${scene.title}`, "png"); }}>图片</button>}{scene.videoUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.videoUrl as string, `${projectTitle}-${index + 1}-${scene.title}`, "mp4"); }}>视频</button>}{scene.audioUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.audioUrl as string, `${projectTitle}-${index + 1}-${scene.speaker}-配音`, "mp3"); }}>配音</button>}</div>
          </article>)}</div>
          <div className="delivery-note"><b>{nativeVideoEnabled ? "当前使用原生视频模型" : "为什么现在人物不会真正动？"}</b><span>{nativeVideoEnabled ? "每个带“原生视频”标记的镜头都由视频 AI 生成，可单独下载和替换。" : "免费默认视频岗位没有调用人物动画模型，只对静态图做 2.5D 推拉、横移、景深和光影动画。若需要人物口型、走路和表演，请把“视频 AI”切换到 Seedance 或自定义视频接口。"}</span></div>
        </div>}
        {!scenes.length ? <div className="empty-work"><div className="empty-orbit"><span>✦</span></div><h3>你的第一部漫剧还没开机</h3><p>在上方输入故事并点击“一键生成 AI 漫剧”，完成后这里会直接出现可播放成片。</p></div> : <><div className="workbench">
          <div className="preview-column">
            <div className={`stage ${aspect === "9:16" ? "portrait" : "landscape"} ${showFilm && exportUrl ? "film-ready" : ""}`}>
              {showFilm && exportUrl ? <video src={exportUrl} controls autoPlay playsInline muted={!generatedVoiceEnabled || !voiceEnabled} /> : current?.videoUrl ? <video ref={videoRef} key={current.videoUrl} src={current.videoUrl} muted loop playsInline style={{ filter: previewFilter }} /> : current?.imageUrl ? <img className={`motion-preview motion-${current.motion || "push"}`} key={current.imageUrl} src={current.imageUrl} alt={current.visual} style={{ filter: previewFilter, animationDuration: `${Math.max(3, current.duration)}s` }} /> : <div className="stage-placeholder"><span>{String(currentIndex + 1).padStart(2, "0")}</span><p>{current?.status === "animating" ? "视频 AI 正在生成角色动态表演" : current?.status === "painting" ? "生图 AI 正在绘制一致性关键帧" : "等待生成镜头"}</p></div>}
              {showFilm && exportUrl ? <div className="film-corner">AI 漫剧成片</div> : current && <><div className="stage-shade" /><div className="stage-label"><span>{String(currentIndex + 1).padStart(2, "0")}</span><b>{current.title}</b></div>{current.subtitleEnabled !== false && <div className={`subtitle ${current.subtitlePosition || "bottom"}`} style={{ color: subtitleColor, fontSize: `${14 * subtitleScale}px` }}>“{current.dialogue}”</div>}</>}
            </div>
            {showFilm && exportUrl ? <div className="film-toolbar"><div><b>{nativeVideoEnabled ? "AI 漫剧成片已生成" : "低动态流程样片已生成"}</b><span>{nativeVideoEnabled ? `六岗位协作生成，动态镜头、字幕${generatedVoiceEnabled ? "、分角色配音" : ""}${musicUrl ? "与剧情配乐" : ""}已经合成` : "这是图片运镜预览，不是人物原生动画；可用于确认剧本、分镜与节奏"}</span></div><button className="secondary" onClick={() => setShowFilm(false)}>编辑分镜</button><button onClick={downloadFilm}>下载成片</button></div> : <>
              <div className="play-controls"><button onClick={() => setPlaying((value) => !value)} disabled={!scenes.length}>{playing ? "Ⅱ" : "▶"}</button><span>{formatTime(time)}</span><input type="range" aria-label="播放进度" min={0} max={100} value={totalDuration ? (time / totalDuration) * 100 : 0} onChange={(event) => seek(Number(event.target.value))} /><span>{formatTime(totalDuration)}</span><button onClick={() => { setPlaying(false); setTime(0); }}>↺</button></div>
              <div className="export-panel"><div><b>{nativeVideoEnabled ? "重新合成 AI 漫剧" : "重新生成流程样片"}</b><span>{nativeVideoEnabled && generatedVoiceEnabled && voiceEnabled ? "动态表演、字幕、分角色配音与配乐将写入视频" : "关键帧、运镜、转场和字幕将写入样片"}</span></div><button onClick={() => void exportFilm()} disabled={phase === "exporting"}>{phase === "exporting" ? `正在录制 ${exportProgress}%` : nativeVideoEnabled ? "生成 AI 漫剧成片" : "生成低动态样片"}</button></div>
              {exportUrl && <div className="export-result"><video src={exportUrl} controls playsInline /><div><b>已有漫剧成片</b><span>可以返回成片模式播放，或重新剪辑。</span><button onClick={() => setShowFilm(true)}>播放成片</button><button onClick={downloadFilm}>下载成片</button></div></div>}
            </>}
          </div>

          <div className="timeline-panel">
            <div className="timeline-title"><div><b>智能分镜</b><span>点击选择，下面可编辑</span></div><button onClick={addScene}>＋ 新增镜头</button></div>
            <div className="scene-list">{scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}><div className="scene-thumb">{scene.videoUrl ? <video src={scene.videoUrl} muted /> : scene.imageUrl ? <img src={scene.imageUrl} alt="" /> : <span>{["painting", "animating"].includes(scene.status) ? "生成中" : String(index + 1).padStart(2, "0")}</span>}</div><div><b>{scene.title}</b><p>{scene.action}</p><small>{scene.duration} 秒 · {scene.videoUrl ? "AI 动态表演" : scene.imageUrl ? "一致性关键帧" : "待生成"} · {scene.camera}</small></div><i className={`scene-state ${scene.status}`} /></button>)}</div>
            {selectedScene && <div className="scene-editor">
              <div className="editor-heading"><b>镜头 {String(selected + 1).padStart(2, "0")} · 属性检查器</b><div><button onClick={() => moveScene(selected, -1)} disabled={selected === 0}>↑</button><button onClick={() => moveScene(selected, 1)} disabled={selected === scenes.length - 1}>↓</button><button onClick={() => duplicateScene(selected)}>复制</button><button className="danger" onClick={() => deleteScene(selected)}>删除</button></div></div>
              <div className="local-media-tools"><label>替换图片<input type="file" accept="image/*" onChange={(event) => { replaceSceneMedia(selectedScene, "image", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label>导入视频<input type="file" accept="video/*" onChange={(event) => { replaceSceneMedia(selectedScene, "video", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label>导入配音<input type="file" accept="audio/*" onChange={(event) => { replaceSceneMedia(selectedScene, "audio", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
              <label>镜头标题<input value={selectedScene.title} onChange={(event) => updateScene(selectedScene.id, { title: event.target.value })} /></label>
              <div className="editor-grid"><label>景别<input value={selectedScene.shot} onChange={(event) => updateScene(selectedScene.id, { shot: event.target.value })} /></label><label>文字运镜描述<input value={selectedScene.camera} onChange={(event) => updateScene(selectedScene.id, { camera: event.target.value })} /></label><label>说话角色<input value={selectedScene.speaker} onChange={(event) => updateScene(selectedScene.id, { speaker: event.target.value })} /></label><label>表演情绪<input value={selectedScene.emotion} onChange={(event) => updateScene(selectedScene.id, { emotion: event.target.value })} /></label></div>
              <label>场景与构图<textarea value={selectedScene.visual} onChange={(event) => updateScene(selectedScene.id, { visual: event.target.value })} /></label>
              <label>人物动作与表演<textarea value={selectedScene.action} onChange={(event) => updateScene(selectedScene.id, { action: event.target.value })} /></label>
              <label>角色台词<textarea value={selectedScene.dialogue} onChange={(event) => updateScene(selectedScene.id, { dialogue: event.target.value })} /></label>
              <div className="editor-grid"><label>2.5D 动态<select value={selectedScene.motion || "push"} onChange={(event) => updateScene(selectedScene.id, { motion: event.target.value as MotionPreset })}>{MOTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>转场<select value={selectedScene.transition || "fade"} onChange={(event) => updateScene(selectedScene.id, { transition: event.target.value as TransitionPreset })}>{TRANSITION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>画面滤镜<select value={selectedScene.filter || "none"} onChange={(event) => updateScene(selectedScene.id, { filter: event.target.value as VisualFilter })}><option value="none">原色</option><option value="warm">暖调电影感</option><option value="cool">冷调悬疑</option><option value="mono">黑白漫画</option></select></label><label>字幕位置<select value={selectedScene.subtitlePosition || "bottom"} onChange={(event) => updateScene(selectedScene.id, { subtitlePosition: event.target.value as SubtitlePosition })}><option value="top">顶部</option><option value="center">中央</option><option value="bottom">底部</option></select></label></div>
              <div className="editor-grid"><label>镜头时长<input type="number" min={1} max={30} step={0.5} value={selectedScene.duration} onChange={(event) => updateScene(selectedScene.id, { duration: Math.max(1, Math.min(30, Number(event.target.value))) })} /></label><label>视频速度<input type="number" min={0.5} max={2} step={0.1} value={selectedScene.speed || 1} onChange={(event) => updateScene(selectedScene.id, { speed: Math.max(0.5, Math.min(2, Number(event.target.value))) })} /></label><label>配音音量<input type="range" min={0} max={2} step={0.05} value={selectedScene.volume ?? 1} onChange={(event) => updateScene(selectedScene.id, { volume: Number(event.target.value) })} /></label><label>运镜强度<input type="range" min={0.35} max={1.8} step={0.05} value={selectedScene.motionIntensity || 1} onChange={(event) => updateScene(selectedScene.id, { motionIntensity: Number(event.target.value) })} /></label></div>
              <div className="subtitle-switch"><div><b>显示本镜字幕</b><span>关闭后对白仍保留在剧本中</span></div><button className={`toggle ${selectedScene.subtitleEnabled !== false ? "on" : ""}`} onClick={() => updateScene(selectedScene.id, { subtitleEnabled: selectedScene.subtitleEnabled === false })}><i /></button></div>
              <label>音效设计<input value={selectedScene.sfx} onChange={(event) => updateScene(selectedScene.id, { sfx: event.target.value })} /></label>
              <div className="editor-actions"><button onClick={() => regenerateImage(selectedScene, selected)}>让生图 AI 重做</button><button className="video-action" onClick={() => generateVideo(selectedScene)}>{nativeVideoEnabled ? "让视频 AI 重做" : "配置视频 AI"}</button></div>
            </div>}
          </div>
        </div>

        <div className="nle-workspace">
          <div className="nle-toolbar">
            <div><b>多轨剪辑台</b><span>像剪映一样拖动片段排序，移动播放头后可以分割</span></div>
            <div className="nle-actions">
              <button onClick={() => setPlaying((value) => !value)}>{playing ? "暂停" : "播放"}</button>
              <button onClick={splitAtPlayhead}>分割</button>
              <button onClick={() => deleteScene(selected)} disabled={!selectedScene}>删除片段</button>
              <label>缩放<input type="range" aria-label="时间轴缩放" min={0.6} max={2.4} step={0.2} value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} /></label>
              <label>字幕<input type="range" aria-label="字幕大小" min={0.7} max={1.6} step={0.1} value={subtitleScale} onChange={(event) => { setSubtitleScale(Number(event.target.value)); invalidateExport(); }} /></label>
              <label className="color-tool">颜色<input type="color" aria-label="字幕颜色" value={subtitleColor} onChange={(event) => { setSubtitleColor(event.target.value); invalidateExport(); }} /></label>
              <label>BGM<input type="range" aria-label="背景音乐音量" min={0} max={0.8} step={0.02} value={musicVolume} onChange={(event) => { setMusicVolume(Number(event.target.value)); invalidateExport(); }} /></label>
            </div>
          </div>
          <div className="nle-grid">
            <div className="track-labels"><span className="ruler-label">时间</span><span>视频</span><span>配音</span><span>字幕</span><span>配乐</span></div>
            <div className="timeline-scroll">
              <div className="timeline-canvas" style={{ width: timelineWidth }}>
                <div className="time-ruler">
                  {Array.from({ length: Math.floor(totalDuration / 5) + 1 }, (_, index) => <i key={index} style={{ left: `${totalDuration ? (index * 5 / totalDuration) * 100 : 0}%` }}><span>{formatTime(index * 5)}</span></i>)}
                </div>
                <input className="timeline-scrubber" type="range" aria-label="时间轴播放头" min={0} max={totalDuration || 1} step={0.1} value={Math.min(time, totalDuration)} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); setShowFilm(false); }} />
                <div className="playhead" style={{ left: totalDuration ? (time / totalDuration) * timelineWidth : 0 }}><i /></div>
                <div className="timeline-track video-track">
                  {scenes.map((scene, index) => <button type="button" draggable key={scene.id} className={`video-clip ${selected === index ? "selected" : ""} ${draggingScene === index ? "dragging" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onDragStart={() => setDraggingScene(index)} onDragEnd={() => setDraggingScene(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingScene !== null) reorderScene(draggingScene, index); setDraggingScene(null); }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }} aria-label={`选择并拖动镜头 ${scene.title}`}>
                    <span className="clip-thumb">{scene.videoUrl ? <video src={scene.videoUrl} muted /> : scene.imageUrl ? <img src={scene.imageUrl} alt="" /> : <i>{String(index + 1).padStart(2, "0")}</i>}</span><b>{scene.title}</b><small>{scene.duration} 秒</small>
                  </button>)}
                </div>
                <div className="timeline-track voice-track">
                  {scenes.map((scene, index) => <button type="button" key={scene.id} className={`audio-clip ${selected === index ? "selected" : ""} ${!scene.audioUrl ? "device-voice" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }}><i><span /><span /><span /><span /><span /><span /></i><b>{scene.speaker || "旁白"}</b></button>)}
                </div>
                <div className="timeline-track subtitle-track">
                  {scenes.map((scene, index) => <button type="button" key={scene.id} className={`subtitle-clip ${selected === index ? "selected" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }} title={scene.dialogue}>{scene.dialogue || "（无台词）"}</button>)}
                </div>
                <div className="timeline-track music-track"><div className={`music-clip ${musicUrl ? "ready" : ""}`}><i>♪</i><span>{musicUrl ? musicPrompt || "剧情配乐" : bgmEnabled ? "配乐将在生成后进入这里" : "配乐已关闭"}</span></div></div>
              </div>
            </div>
          </div>
          <div className="nle-footer"><span>播放头 <b>{formatTime(time)}</b></span><span>选中 <b>{selectedScene?.title}</b></span><span>成片 <b>{formatTime(totalDuration)}</b></span><button onClick={() => void exportFilm()} disabled={phase === "exporting"}>{phase === "exporting" ? `正在合成 ${exportProgress}%` : "重新合成成片"}</button></div>
        </div></>}
      </section>

      <section id="capabilities" className="capabilities section-shell">
        <div className="section-heading"><span>03</span><div><p>能力说明</p><h2>每个按钮背后，都有真实结果</h2></div></div>
        <div className="capability-grid"><article><i>人</i><b>角色资产锁定</b><p>先生成固定人设，后续关键帧和视频都引用同一角色资产。</p></article><article><i>演</i><b>分镜级动态表演</b><p>完整模式以关键帧驱动视频模型，生成人物动作、表情和运镜。</p></article><article><i>声</i><b>角色声音设计</b><p>按说话角色匹配音色，并生成剧情配乐后自动混音。</p></article><article><i>片</i><b>自动剪辑成片</b><p>字幕、镜头衔接、声音和视频真正写入可下载的成片。</p></article></div>
      </section>

      <footer><div className="brand"><span>漫</span><strong>漫镜</strong></div><p>让每一个好故事，都真正被看见。</p><small>生成服务可能排队或限流，失败会如实提示。</small></footer>
    </main>
  );
}
