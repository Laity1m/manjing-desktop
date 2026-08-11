"use client";

import StudioProjectBinding from "./components/StudioProjectBinding";

import { agentContext, markContextUsed } from "./agent-system/learning-store";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteNav from "./components/SiteNav";
import ConfirmButton from "./components/ConfirmButton";
import { API_MODE_DEFAULT_ENDPOINTS, API_MODE_LABELS, apiModesForRole, discoverApiModels, type DiscoverableApiMode, type DiscoveredModel } from "./lib/custom-api";
import { loadEditorProjectById, persistEditorProject, type EditorProjectClip } from "./lib/editor-project";
import { loadCustomModels, saveCustomModels, type CustomModel } from "./lib/custom-models";
import { createCanvasFromStudio } from "./lib/production-canvas";
import { listLibraryAssets, loadLibraryAssets, markLibraryAssetUsed, saveLibraryFile, updateLibraryAsset, type LibraryAsset, type LibraryAssetCategory } from "./lib/asset-library";

async function archiveGeneratedAsset(url: string, name: string, category: LibraryAssetCategory, duration: number, tags: string[]) {
  if (!url) return;
  const archiveKey = `generated:${tags.join(":")}:${name}`.slice(0, 160);
  const existing = await listLibraryAssets();
  if (existing.some((item) => item.tags.includes(archiveKey))) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`生成资产归档失败（${response.status}）`);
  const blob = await response.blob();
  const extension = blob.type.startsWith("image/") ? (blob.type.includes("jpeg") ? "jpg" : "png") : blob.type.startsWith("audio/") ? (blob.type.includes("mpeg") ? "mp3" : "wav") : "mp4";
  const file = new File([blob], `${name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120)}.${extension}`, { type: blob.type || (category === "video" ? "video/mp4" : category === "audio" ? "audio/wav" : "image/png") });
  const identityTag = tags.find((tag) => tag.startsWith("asset:"));
  const identityKey = identityTag?.slice("asset:".length) || (category === "prop" ? tags.find((tag) => tag !== "自动生成" && tag !== "重要道具") : undefined);
  if (identityKey) {
    const existing = (await listLibraryAssets()).find((asset) => asset.category === category && asset.identityKey === identityKey && asset.reusable !== false);
    if (existing) { await markLibraryAssetUsed(existing.id); return; }
  }
  const locked = Boolean(identityKey && ["character", "prop", "scene", "audio"].includes(category));
  const saved = await saveLibraryFile(file, { category, duration, tags: [...tags, archiveKey], identityKey, locked });
  if (identityKey) await updateLibraryAsset(saved.id, { canonical: category === "prop", locked, reusable: true, identityKey });
}

function autoArchive(url: string, name: string, category: LibraryAssetCategory, duration: number, tags: string[]) {
  void archiveGeneratedAsset(url, name, category, duration, tags).catch((error) => console.warn("[manjing asset archive]", error));
}

function labeledVisualAssets(text: string, label: "场景" | "道具") {
  const values: string[] = [];
  const pattern = new RegExp(`\\[${label}[：:]([^\\]]+)\\]`, "gi");
  for (const match of text.matchAll(pattern)) values.push(...String(match[1] || "").split(/[，,、]/));
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, label === "场景" ? 1 : 6);
}

type Mode = "community" | "cloud";
type Phase = "idle" | "story" | "characters" | "images" | "video" | "voice" | "music" | "ready" | "exporting" | "error";
type SceneStatus = "queued" | "writing" | "painting" | "animating" | "voicing" | "ready" | "error";
type AgentRole = "director" | "writer" | "prompt" | "image" | "video" | "voice" | "editor";
type AgentAdapter = "horde" | "openai" | "anthropic" | "gemini" | "pollinations" | "seedance" | "browser" | "webhook";
type MotionPreset = "push" | "pull" | "pan-left" | "pan-right" | "float";
type TransitionPreset = "fade" | "cut" | "flash";
type VisualFilter = "none" | "warm" | "cool" | "mono";
type SubtitlePosition = "top" | "center" | "bottom";
type ActivityState = "running" | "done" | "warning" | "error";
type ActivityEvent = { id: string; role: AgentRole; state: ActivityState; message: string; time: string };
type BridgeHealth = { state: "idle" | "testing" | "ready" | "partial" | "error"; message: string; nodes?: Record<string, boolean>; workflows?: Record<string, boolean> };
type AgentConfig = { preset: string; adapter: AgentAdapter; model: string; endpoint: string; apiKey: string };
type AgentPreset = { id: string; adapter: AgentAdapter; name: string; model: string; note: string; badge?: string; endpoint?: string };
type QuickModelDraft = { name: string; adapter: DiscoverableApiMode; model: string; endpoint: string; apiKey: string; note: string };
type RoleSaveState = { role: AgentRole | null; state: "idle" | "saving" | "saved" | "error"; message: string };
type SceneAction = { id: string; type: "image" | "video" };
type CharacterAsset = {
  id: string;
  name: string;
  role: string;
  appearance: string;
  voice: string;
  imageUrl?: string;
  remoteUrl?: string;
  arkAssetId?: string;
  portraitAuthorizationStatus?: "unbound" | "pending" | "authorized";
  sheetVersion?: 2;
  status: "queued" | "generating" | "ready" | "error";
};
type ConsistencyScores = { characterIdentity: number | null; costume: number | null; scene: number | null; props: number | null; spatialContinuity: number | null; shotContinuity: number | null; lighting: number | null };
type ConsistencyReport = { scores: ConsistencyScores; overall: number; decision: "pass" | "review" | "reject"; mode: "vision" | "structural"; findings: string[]; checkedAt: string; attempts: number };
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
  environmentKey?: string;
  environmentBible?: string;
  continuity?: string;
  startState?: string;
  endState?: string;
  consistencyReport?: ConsistencyReport;
  consistencyDecision?: "pass" | "review" | "reject";
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
type StudioSession = {
  version: 2;
  projectId: string;
  projectTitle: string;
  story: string;
  style: string;
  targetDuration: number;
  aspect: "9:16" | "16:9";
  characters: CharacterAsset[];
  scenes: Scene[];
  selected: number;
  phase: Phase;
  progress: number;
  statusText: string;
  activityLog: ActivityEvent[];
  musicPrompt: string;
  musicUrl?: string;
  exportUrl?: string;
  updatedAt: string;
};

function stableReuseToken(value: string) {
  let hash = 2166136261;
  const normalized = value.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
  for (let index = 0; index < normalized.length; index += 1) { hash ^= normalized.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function shotReuseIdentity(scene: Scene) {
  return `shot:${stableReuseToken([scene.title, scene.visual, scene.action, scene.camera, scene.environmentKey, scene.startState, scene.endState].join("|"))}`;
}

function voiceReuseIdentity(scene: Scene, voiceName: string) {
  return `voice:${stableReuseToken([scene.speaker, voiceName, scene.emotion, scene.dialogue].join("|"))}`;
}
type Storyboard = { title: string; characters: CharacterAsset[]; music: string; scenes: Scene[] };
type LibTvResult = { kind: "image" | "video"; url: string };
type LibTvMessage = { id: string; seq: number; role: "user" | "assistant"; content: string };
type SeedancePendingTask = { id: string; model: string; createdAt: number };

const SAMPLE_STORY = "雨夜，女孩在即将关门的旧书店前，遇见了消失三年的恋人。他带着一封从未寄出的信，藏着两人错过彼此的真相。";
const STUDIO_SESSION_KEY = "manjing-studio-session-v2";
const STUDIO_DRAFTS_KEY = "manjing-studio-drafts-v1";
const NEW_STUDIO_KEY = "manjing-new-studio";
const OPEN_STUDIO_PROJECT_KEY = "manjing-studio-open-project";
const SEEDANCE_PENDING_KEY = "manjing-seedance-pending-v1";

function durableMediaUrl(url?: string) {
  return url && !url.startsWith("blob:") ? url : undefined;
}

function serializableScene(scene: Scene): Scene {
  return { ...scene, imageUrl: durableMediaUrl(scene.imageUrl), audioUrl: durableMediaUrl(scene.audioUrl), videoUrl: durableMediaUrl(scene.videoUrl) };
}

function serializableCharacter(character: CharacterAsset): CharacterAsset {
  return { ...character, imageUrl: durableMediaUrl(character.imageUrl) };
}
type VisualStylePreset = {
  name: string;
  category: "写实" | "动画" | "艺术";
  description: string;
  preview: string;
  base: string;
  character: string;
  frame: string;
  motion: string;
};

const STYLE_PRESETS: VisualStylePreset[] = [
  {
    name: "电影写实", category: "写实", description: "真人演员、电影镜头与自然皮肤质感", preview: "/styles/cinematic-photoreal.webp",
    base: "photorealistic cinematic live-action, real Chinese actors, natural skin pores and fine facial details, physically accurate lighting, realistic fabric and environment textures, correct anatomy and natural hands, restrained feature-film color grade, 35mm cinema lens, not illustration, not anime, not comic, not 3D",
    character: "live-action casting and wardrobe reference sheet, natural facial asymmetry, realistic hair strands, full body and clean face close-up",
    frame: "live-action feature film still, subtle acting, practical lighting, believable set dressing, shallow depth of field, cinematic composition",
    motion: "realistic actor performance, natural blinking and breathing, subtle facial micro-expressions, physically believable hair and cloth motion",
  },
  {
    name: "都市生活写实", category: "写实", description: "当代城市、自然光与生活流表演", preview: "/styles/urban-realism.webp",
    base: "photorealistic contemporary Chinese urban drama, real actors, documentary-level natural detail, soft available light, authentic modern locations and wardrobe, realistic skin and anatomy, understated color grade, not illustration, not anime, not CGI",
    character: "modern live-action casting photo and wardrobe continuity reference, natural expression, full body and face close-up",
    frame: "naturalistic urban television drama frame, believable daily-life production design, observational camera, realistic depth",
    motion: "restrained natural acting, conversational gestures, realistic eye focus, breathing and fabric physics",
  },
  {
    name: "古装剧写实", category: "写实", description: "真人古装、考究服化道与历史氛围", preview: "/styles/historical-live-action.webp",
    base: "photorealistic Chinese historical costume drama, real Chinese actors, period-accurate layered silk and linen costumes, detailed hair ornaments, authentic architecture and props, cinematic practical lighting, natural skin texture, not animation, not illustration",
    character: "live-action historical casting and costume continuity reference, intricate period hairstyle, full body and clean face close-up",
    frame: "prestige historical drama film still, atmospheric lantern light, authentic production design, elegant widescreen composition",
    motion: "graceful but physically realistic period performance, subtle sleeves and hair ornaments moving naturally, restrained facial acting",
  },
  {
    name: "港风复古", category: "写实", description: "90 年代胶片、霓虹街景与浓郁情绪", preview: "/styles/hong-kong-retro.webp",
    base: "photorealistic 1990s Hong Kong cinema, real Chinese actors, 35mm film grain, neon reflected on wet streets, warm tungsten interiors, deep green and red color palette, cinematic halation, realistic anatomy, not illustration",
    character: "live-action Hong Kong film casting portrait and retro wardrobe continuity sheet, natural textured hair and skin",
    frame: "moody 1990s Hong Kong film still, expressive practical neon, subtle film grain, intimate cinematic blocking",
    motion: "natural live-action performance, handheld camera energy, realistic rain, smoke, hair and fabric movement",
  },
  {
    name: "国漫电影感", category: "动画", description: "精致国漫角色与大片式光影", preview: "/styles/chinese-animation.webp",
    base: "premium cinematic Chinese animation and manhua, elegant facial features, polished linework, dramatic film lighting, rich atmospheric depth, coherent anatomy and natural hands",
    character: "premium animation character design sheet, clean silhouette, full body and face close-up, production-ready turnaround feeling",
    frame: "single cinematic Chinese animated film keyframe, layered foreground middle ground and background, expressive acting",
    motion: "fluid premium animation performance, expressive eyes and mouth, controlled secondary hair and costume motion",
  },
  {
    name: "日系清新", category: "动画", description: "轻盈日漫、柔和天光与青春气息", preview: "/styles/japanese-anime.webp",
    base: "fresh Japanese anime feature style, delicate clean line art, soft daylight, airy pastel colors, expressive but consistent faces, correct anatomy",
    character: "anime production character sheet, clean cel shading, full body and facial expression close-up",
    frame: "single polished anime film keyframe, poetic light, detailed painted background, cinematic composition",
    motion: "smooth anime acting, subtle eye and mouth animation, gentle wind through hair and clothes",
  },
  {
    name: "美式漫画", category: "动画", description: "大胆墨线、网点与英雄式构图", preview: "/styles/american-comic.webp",
    base: "bold American graphic novel art, confident ink contours, controlled halftone texture, expressive shadows, saturated accent colors, strong anatomy, sophisticated comic illustration",
    character: "graphic novel character design sheet, bold silhouette, full body and expressive portrait",
    frame: "one cinematic graphic-novel frame without panel borders, dynamic perspective, dramatic inked lighting",
    motion: "stylized graphic-novel motion, strong readable poses, controlled parallax and energetic camera movement",
  },
  {
    name: "赛博朋克", category: "动画", description: "雨夜霓虹、未来城市与强轮廓光", preview: "/styles/cyberpunk.webp",
    base: "cinematic cyberpunk animation, neon megacity at night, wet reflections, holographic glow, strong rim light, detailed technology, coherent faces and anatomy",
    character: "cyberpunk character design sheet, distinctive futuristic wardrobe and accessories, full body and face close-up",
    frame: "single premium cyberpunk animated-film keyframe, volumetric neon, layered city depth, no comic panels",
    motion: "cinematic cyberpunk performance, animated neon and rain, realistic secondary motion and continuous camera movement",
  },
  {
    name: "3D 动画", category: "动画", description: "院线级三维角色、材质与柔和表演", preview: "/styles/feature-3d.webp",
    base: "polished stylized 3D animated feature, appealing Chinese character design, physically based materials, soft global illumination, detailed environments, correct anatomy, cinematic rendering",
    character: "3D feature-animation character model reference, full body and expressive face close-up, consistent materials and proportions",
    frame: "single theatrical 3D animation frame, cinematic lighting, volumetric depth, production-quality render",
    motion: "appealing 3D character acting, smooth facial animation, believable body mechanics, hair and cloth simulation",
  },
  {
    name: "黑白漫画", category: "动画", description: "高反差墨稿、速度线与日式网点", preview: "/styles/american-comic.webp",
    base: "high-contrast black and white manga, professional ink linework, screentone shading, expressive faces, precise anatomy, crisp white paper texture",
    character: "black-and-white manga character reference sheet, clean contours, full body and facial expression close-up",
    frame: "one complete manga cinematic frame without borders or speech bubbles, dramatic blacks, controlled screentones",
    motion: "dynamic manga-inspired animation, controlled camera movement, ink accents and subtle parallax without text",
  },
  {
    name: "水墨古风", category: "艺术", description: "东方留白、宣纸墨韵与诗意云雾", preview: "/styles/ink-wash.webp",
    base: "Chinese ink-wash animation, expressive brush texture on xuan paper, elegant restrained color accents, poetic mist and negative space, coherent faces and anatomy",
    character: "ink-wash character design reference, expressive brush contours, full body and face study",
    frame: "single poetic Chinese ink-wash animated keyframe, layered mountains and mist, cinematic visual rhythm",
    motion: "flowing ink-wash animation, drifting mist and brush textures, graceful continuous character movement",
  },
  {
    name: "绘本水彩", category: "艺术", description: "透明水色、纸张纹理与温柔叙事", preview: "/styles/watercolor.webp",
    base: "delicate watercolor storybook illustration, transparent pigments, visible cold-press paper texture, gentle edges, luminous color washes, consistent appealing characters",
    character: "watercolor storybook character reference sheet, full body and expressive portrait, clean readable silhouette",
    frame: "single complete watercolor storybook scene, cinematic composition, layered washes and atmospheric depth",
    motion: "gentle storybook animation, subtle watercolor blooms, natural character gestures and slow cinematic camera",
  },
  {
    name: "黏土定格", category: "艺术", description: "手工黏土、微缩布景与定格质感", preview: "/styles/clay-stop-motion.webp",
    base: "handcrafted clay stop-motion film, tactile fingerprints in clay, miniature practical sets, warm studio lighting, charming consistent puppets, realistic material texture",
    character: "clay puppet model sheet, handcrafted wardrobe, full body and face close-up, consistent proportions",
    frame: "single premium stop-motion film frame, miniature set depth, practical light and tactile surfaces",
    motion: "expressive stop-motion puppet acting, deliberate frame-by-frame movement, physical miniature effects",
  },
  {
    name: "油画奇幻", category: "艺术", description: "古典油画笔触与史诗奇幻光线", preview: "/styles/watercolor.webp",
    base: "cinematic fantasy oil painting, rich impasto brushwork, classical chiaroscuro, luminous atmosphere, elegant detailed characters, epic environmental depth",
    character: "fantasy oil-painted character design study, full body and portrait, ornate consistent costume",
    frame: "single cinematic fantasy oil-painting scene, dramatic classical lighting, layered atmospheric perspective",
    motion: "painterly cinematic motion, subtle living brush texture, majestic natural gestures and drifting atmosphere",
  },
  {
    name: "暗黑奇幻", category: "艺术", description: "哥特建筑、低调光影与神秘史诗", preview: "/styles/cyberpunk.webp",
    base: "dark gothic fantasy cinematic art, monumental architecture, moody low-key lighting, intricate costumes, atmospheric fog, sophisticated restrained palette, coherent anatomy",
    character: "dark-fantasy character design sheet, ornate silhouette, full body and expressive portrait",
    frame: "single gothic fantasy cinematic keyframe, deep atmospheric perspective, dramatic motivated light",
    motion: "weighty dark-fantasy performance, believable cloth and fog motion, slow ominous camera movement",
  },
  {
    name: "治愈插画", category: "艺术", description: "温暖色彩、柔软造型与轻松日常", preview: "/styles/watercolor.webp",
    base: "warm healing editorial illustration, soft rounded shapes, gentle textured brushwork, harmonious warm palette, expressive friendly characters, cozy detailed environment",
    character: "warm illustrated character design sheet, approachable silhouette, full body and facial expression close-up",
    frame: "single cozy illustrated film frame, soft light, readable staging and layered environment",
    motion: "gentle charming character animation, relaxed gestures, soft environmental movement and calm camera drift",
  },
];

const STYLE_PROMPTS: Record<string, string> = Object.fromEntries(STYLE_PRESETS.map((preset) => [preset.name, preset.base]));

function visualStyle(name: string) {
  return STYLE_PRESETS.find((preset) => preset.name === name) || STYLE_PRESETS[4];
}

function characterVisualPrompt(name: string) {
  const preset = visualStyle(name);
  return `${preset.base}, ${preset.character}`;
}

function characterSheetPrompt(styleName: string, character: Pick<CharacterAsset, "name" | "role" | "appearance">) {
  return `${characterVisualPrompt(styleName)}, ${character.name}, ${character.role}, ${character.appearance}. 16:9 horizontal standard character turnaround model sheet on a pure seamless light-gray cyclorama studio background. Strict layout from left to right: an extreme close-up of the front face at the far left, then a front full-body view, a side full-body view, and a back full-body view. The face, facial proportions, hairstyle, hair color, costume, accessories, footwear, socks and body proportions must remain exactly identical across all four views. Show the three full-body views completely from head to toe without cropping. Calm natural standing posture, both arms hanging naturally, empty hands, no props, no scenery, no furniture, no text, no labels, no decorative frame. 构图硬性要求：16:9 横版，纯浅灰色无缝影棚背景；画面最左侧为人物正面面部大特写，右侧依次排列人物正面全身、侧面全身、背面全身三视图；四个视图的面部、发型、服装、饰品、鞋袜和身体比例严格一致；人物从头到脚完整展示，站姿沉稳自然，双手自然下垂，不拿任何道具。`;
}

function isVisualCharacterAsset(character: Pick<CharacterAsset, "name" | "role" | "appearance">) {
  const description = `${character.name} ${character.role} ${character.appearance}`;
  const voiceOnly = /旁白|画外音|广告声|广播声|系统音|系统播报|提示音|播音|解说|声音|voice\s*over|narrator|announcer/i.test(description);
  const explicitlyInvisible = /无实体|不出镜|仅声音|只闻其声|画外传来|未实体化/i.test(description);
  return !voiceOnly && !explicitlyInvisible;
}

function frameVisualPrompt(name: string) {
  const preset = visualStyle(name);
  return `${preset.base}, ${preset.frame}`;
}

function motionVisualPrompt(name: string) {
  const preset = visualStyle(name);
  return `${preset.base}, ${preset.motion}`;
}
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
  { id: "prompt", icon: "控", title: "镜头总控 AI", duty: "调用资产、继承状态、整合最终视频提示词", recommends: ["GPT-5.6 Luna", "Gemini 3 Flash", "Qwen 3.5"] },
  { id: "image", icon: "图", title: "生图 AI", duty: "角色设定、场景与一致性关键帧", recommends: ["GPT Image 2", "Nano Banana", "FLUX"] },
  { id: "video", icon: "影", title: "视频 AI", duty: "文生视频、图生视频、参考图生视频", recommends: ["Veo 3.1", "Sora 2", "Seedance 2.0"] },
  { id: "voice", icon: "声", title: "配音 AI", duty: "角色音色、情绪、对白与旁白", recommends: ["Eleven v3", "Gemini TTS", "OpenAI Speech"] },
  { id: "editor", icon: "剪", title: "剪辑 AI", duty: "节奏、镜头排序、字幕与混音", recommends: ["漫镜智能剪辑", "GPT-5.6 Terra", "自定义工作流"] },
];
const CUSTOM_TEXT_ADAPTERS: AgentAdapter[] = ["openai", "anthropic", "gemini", "webhook"];

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
  prompt: [
    { id: "browser-prompt", adapter: "browser", name: "漫镜本地镜头总控", model: "Manjing Shot Compiler", note: "免费默认 · 资产绑定、状态继承与提示词编译", badge: "内置" },
    { id: "pollinations-prompt", adapter: "pollinations", name: "Pollinations 镜头总控", model: "openai", note: "推荐 · 智能整合 Seedance 提示词", badge: "推荐" },
    { id: "webhook-prompt", adapter: "webhook", name: "自定义镜头总控接口", model: "your-prompt-model", note: "OpenAI 兼容或自建提示词模型" },
  ],
  image: [
    { id: "horde-image", adapter: "horde", name: "AI Horde 生图", model: "Stable Horde", note: "免费默认 · 需要排队", badge: "免费" },
    { id: "pollinations-image", adapter: "pollinations", name: "Pollinations 生图", model: "kontext", note: "推荐 · 支持角色参考图", badge: "推荐" },
    { id: "comfyui-image", adapter: "webhook", name: "本地 ComfyUI 生图", model: "ComfyUI Image Workflow", note: "开源节点 · 通过漫镜桥接服务调用" },
    { id: "webhook-image", adapter: "webhook", name: "自定义生图接口", model: "gpt-image-2", note: "可接 GPT Image、FLUX 等" },
  ],
  video: [
    { id: "browser-video", adapter: "browser", name: "本地 2.5D 运镜", model: "Depth Motion", note: "免费默认 · 推拉/横移/景深光效，人物不会生成新动作", badge: "免费" },
    { id: "pollinations-video", adapter: "pollinations", name: "Pollinations 视频", model: "seedance-2.0", note: "推荐 · 文/图/参考图生视频", badge: "推荐" },
    { id: "volc-seedance", adapter: "seedance", name: "Seedance 2.0 · 方舟", model: "doubao-seedance-2-0-260128", note: "火山方舟 Ark API · 文生视频、图生视频与原生音轨", badge: "官方" },
    { id: "wan22-video", adapter: "webhook", name: "本地 Wan2.2 视频", model: "Wan2.2 / ComfyUI", note: "开源节点 · 真实图生视频，需要本机 GPU" },
    { id: "webhook-video", adapter: "webhook", name: "自定义视频接口", model: "veo-3.1", note: "可接 Veo、Sora、Seedance" },
  ],
  voice: [
    { id: "browser-voice", adapter: "browser", name: "系统中文语音", model: "Web Speech", note: "免费默认 · 使用本机音色", badge: "免费" },
    { id: "pollinations-voice", adapter: "pollinations", name: "Pollinations 配音", model: "tts", note: "推荐 · 分角色生成音轨", badge: "推荐" },
    { id: "cosyvoice-voice", adapter: "webhook", name: "本地 CosyVoice", model: "CosyVoice", note: "开源节点 · 中文情绪配音与声音复刻" },
    { id: "vibevoice-realtime-voice", adapter: "webhook", name: "VibeVoice Realtime", model: "VibeVoice-Realtime-0.5B", note: "微软开源实验节点 · 英文单角色流式配音" },
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

function clipStoryboardText(value: string, limit: number) {
  const text = value.trim();
  if (text.length <= limit) return text;
  const headLength = Math.floor(limit * 0.68);
  const tailLength = Math.max(0, limit - headLength - 32);
  return `${text.slice(0, headLength)}\n\n【中段已压缩，保留结尾】\n\n${text.slice(-tailLength)}`;
}

function compactStoryboardContext(value: string, limit = 14000) {
  const text = value.trim();
  if (text.length <= limit) return text;
  const marker = "【本集完整剧本】";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return clipStoryboardText(text, limit);
  const rules = text.slice(0, markerIndex).trim();
  const episode = text.slice(markerIndex + marker.length).trim();
  const rulesBudget = Math.min(3200, Math.floor(limit * 0.24));
  const compactRules = clipStoryboardText(rules, rulesBudget);
  const episodeBudget = Math.max(8000, limit - compactRules.length - marker.length - 8);
  return `${compactRules}\n\n${marker}\n${clipStoryboardText(episode, episodeBudget)}`;
}

async function withStageTimeout<T>(task: Promise<T>, timeoutMs: number, message: string) {
  let timer = 0;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

async function withStageProgress<T>(task: Promise<T>, hardTimeoutMs: number, timeoutMessage: string, onTick: (elapsedSeconds: number) => void) {
  const startedAt = Date.now();
  const ticker = window.setInterval(() => onTick(Math.floor((Date.now() - startedAt) / 1000)), 10000);
  try {
    return await withStageTimeout(task, hardTimeoutMs, timeoutMessage);
  } finally {
    window.clearInterval(ticker);
  }
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

function validAgentEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
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

function sceneCountForDuration(seconds: number) {
  return Math.max(1, Math.min(8, Math.ceil(Math.max(1, seconds) / 15)));
}

function normalizeSceneDurations(items: Array<Record<string, unknown>>, targetSeconds: number) {
  if (!items.length) return [];
  if (targetSeconds <= 15) return [Math.max(1, Math.round(targetSeconds))];
  const target = Math.max(items.length, Math.round(targetSeconds));
  const raw = items.map((item) => Math.max(1, Math.min(15, Number(item.duration) || target / items.length)));
  const rawTotal = raw.reduce((sum, value) => sum + value, 0) || 1;
  const durations = raw.map((value) => Math.max(1, Math.min(15, Math.round(value * target / rawTotal))));
  let delta = target - durations.reduce((sum, value) => sum + value, 0);
  while (delta !== 0) {
    let changed = false;
    for (let index = 0; index < durations.length && delta !== 0; index += 1) {
      if (delta > 0 && durations[index] < 15) {
        durations[index] += 1;
        delta -= 1;
        changed = true;
      } else if (delta < 0 && durations[index] > 1) {
        durations[index] -= 1;
        delta += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return durations;
}

function parseStoryboard(raw: string, targetSeconds: number, minimumScenes = 1, maximumScenes = 8): Storyboard {
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
  const picked = sceneSource.slice(0, targetSeconds <= 15 ? 1 : Math.max(minimumScenes, Math.min(16, maximumScenes))) as Array<Record<string, unknown>>;
  const normalizedDurations = normalizeSceneDurations(picked, targetSeconds);
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
      duration: normalizedDurations[index],
      environmentKey: String(item.environmentKey || item.location || item.l || item.environment || `场景-${index + 1}`).slice(0, 60),
      environmentBible: String(item.environmentBible || item.background || item.b || item.visual || "保持场景空间布局、固定道具、光线方向与时间天气一致").slice(0, 520),
      continuity: String(item.continuity || item.link || (index === 0 ? "开场建立镜头" : "承接上一镜结束状态，保持人物位置、朝向、道具和动作方向连续")).slice(0, 260),
      endState: String(item.endState || item.end || "记录人物最终位置、朝向、手持道具与动作结束姿态").slice(0, 260),
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

function storyboardDraft(title: string, music: string, cast: CharacterAsset[], work: Scene[]) {
  return JSON.stringify({
    title,
    music,
    characters: cast.map((character) => ({ name: character.name, role: character.role, appearance: character.appearance, voice: character.voice })),
    scenes: work.map((scene) => ({ id: scene.id, title: scene.title, characters: scene.characters, shot: scene.shot, visual: scene.visual, action: scene.action, camera: scene.camera, speaker: scene.speaker, emotion: scene.emotion, dialogue: scene.dialogue, sfx: scene.sfx, duration: scene.duration })),
  });
}

function mergeReviewedStoryboard(reviewed: Storyboard, previousCast: CharacterAsset[], previousScenes: Scene[]) {
  const characters = reviewed.characters.map((character, index) => {
    const previous = previousCast.find((item) => item.name === character.name) || previousCast[index];
    return previous ? { ...character, id: previous.id, imageUrl: previous.imageUrl, remoteUrl: previous.remoteUrl, arkAssetId: previous.arkAssetId, portraitAuthorizationStatus: previous.portraitAuthorizationStatus, status: previous.status } : character;
  });
  const scenes = reviewed.scenes.map((scene, index) => {
    const previous = previousScenes[index];
    if (!previous) return scene;
    return {
      ...previous,
      ...scene,
      id: previous.id,
      imageUrl: previous.imageUrl,
      remoteImageUrl: previous.remoteImageUrl,
      audioUrl: previous.audioUrl,
      videoUrl: previous.videoUrl,
      status: previous.videoUrl || previous.imageUrl ? "ready" as SceneStatus : "queued" as SceneStatus,
    };
  });
  return { ...reviewed, characters, scenes };
}

function completeFreeStoryboard(partial: Storyboard | null, story: string, visualStyle: string, targetSeconds: number): Storyboard {
  const count = targetSeconds <= 15 ? 1 : partial?.scenes.length || sceneCountForDuration(targetSeconds);
  const premise = story.replace(/\s+/g, " ").slice(0, 140);
  const characters: CharacterAsset[] = partial?.characters.length ? partial.characters : [
    { id: uid(), name: "主角", role: "故事推动者", appearance: `${visualStyle}风格，具有明确五官、固定发型和标志性服装的年轻主角`, voice: "nova", status: "queued" as const },
    { id: uid(), name: "关键人物", role: "冲突与秘密的承载者", appearance: `${visualStyle}风格，与主角形成轮廓和色彩对比，固定服装与神态`, voice: "onyx", status: "queued" as const },
  ];
  const beats = [
    { title: "异样开场", shot: "全景转中景", camera: "缓慢推进", visual: `建立故事空间与时间，围绕“${premise}”呈现一个反常细节，电影感光影和明确前后景`, action: "主角进入环境并注意到异常，先停顿观察，再主动靠近关键线索", dialogue: "这里，和我记得的不一样。", emotion: "警觉", sfx: "环境底噪渐弱，细微提示音出现" },
    { title: "线索逼近", shot: "双人中景", camera: "跟拍后轻微环绕", visual: "关键人物或关键物件进入画面，构图把双方关系和隐藏信息同时交代清楚", action: "主角试探，对方回避，动作和视线逐步暴露双方掌握的信息并不对等", dialogue: "你是不是早就知道了？", emotion: "克制质问", sfx: "脚步、衣料摩擦与短促停顿" },
    { title: "冲突反转", shot: "近景与特写", camera: "快速推近后停住", visual: "矛盾在同一空间内爆发，通过表情、手部动作和关键证据形成视觉反转", action: "关键人物揭开部分真相，主角从拒绝相信转为必须立即作出选择", dialogue: "如果现在不选，就再也来不及了。", emotion: "急迫", sfx: "低频冲击后瞬间安静" },
    { title: "悬念收束", shot: "特写转远景", camera: "拉远并留下空镜", visual: "主角做出第一步选择，但画面边缘出现新的代价或更大秘密，形成下一集钩子", action: "主角伸手触碰关键物件，画面在结果揭晓前切黑，只留下新的异常信号", dialogue: "原来，这才是开始。", emotion: "震惊后坚定", sfx: "心跳、信号声与切黑余响" },
  ];
  const existing = partial?.scenes || [];
  const durationSources = Array.from({ length: count }, (_, index) => ({ duration: existing[index]?.duration || targetSeconds / count }));
  const normalizedDurations = normalizeSceneDurations(durationSources, targetSeconds);
  const names = characters.slice(0, 2).map((character) => character.name);
  const scenes: Scene[] = Array.from({ length: count }, (_, index) => {
    const source = existing[index];
    const beat = beats[index];
    return source ? { ...source, duration: normalizedDurations[index], motion: source.motion || (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4], motionIntensity: source.motionIntensity || 1, transition: source.transition || (index === 0 ? "cut" : "fade"), filter: source.filter || "none", speed: source.speed || 1, volume: source.volume ?? 1, subtitleEnabled: source.subtitleEnabled !== false, subtitlePosition: source.subtitlePosition || "bottom" } : {
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
      duration: normalizedDurations[index],
      status: "queued" as SceneStatus,
      motion: (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4],
      motionIntensity: 1,
      transition: (index === 0 ? "cut" : "fade") as TransitionPreset,
      filter: "none" as VisualFilter,
      speed: 1,
      volume: 1,
      subtitleEnabled: true,
      subtitlePosition: "bottom" as SubtitlePosition,
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

async function normalizeImageBlobForAspect(blob: Blob, aspect: "9:16" | "16:9") {
  const bitmap = await createImageBitmap(blob);
  const width = aspect === "9:16" ? 720 : 1280;
  const height = aspect === "9:16" ? 1280 : 720;
  const targetRatio = width / height;
  const sourceRatio = bitmap.width / bitmap.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;
  if (sourceRatio > targetRatio) {
    sourceWidth = bitmap.height * targetRatio;
    sourceX = (bitmap.width - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = bitmap.width / targetRatio;
    sourceY = (bitmap.height - sourceHeight) / 2;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("无法建立视频关键帧画布");
  }
  context.fillStyle = "#111";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  bitmap.close();
  const normalized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  if (!normalized) throw new Error("无法把生图结果转换为视频关键帧尺寸");
  return normalized;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("关键帧读取失败"));
    reader.readAsDataURL(blob);
  });
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

export default function StudioClient({ surface = "studio" }: { surface?: "studio" | "legacy-editor" }) {
  const router = useRouter();
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
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
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
  const [quickModelRole, setQuickModelRole] = useState<AgentRole | null>(null);
  const [quickModelDraft, setQuickModelDraft] = useState<QuickModelDraft>({ name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" });
  const [quickModelMessage, setQuickModelMessage] = useState("");
  const [quickModelLoading, setQuickModelLoading] = useState(false);
  const [quickModelSaving, setQuickModelSaving] = useState(false);
  const [quickModelOptions, setQuickModelOptions] = useState<DiscoveredModel[]>([]);
  const [roleSaveState, setRoleSaveState] = useState<RoleSaveState>({ role: null, state: "idle", message: "" });
  const [roleModelOptions, setRoleModelOptions] = useState<Partial<Record<AgentRole, DiscoveredModel[]>>>({});
  const [roleModelLoading, setRoleModelLoading] = useState<AgentRole | null>(null);
  const [retryingRole, setRetryingRole] = useState<AgentRole | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [draggingScene, setDraggingScene] = useState<number | null>(null);
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [musicVolume, setMusicVolume] = useState(0.16);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [bridgeUrl, setBridgeUrl] = useState("");
  const [bridgeToken, setBridgeToken] = useState("");
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealth>({ state: "idle", message: "尚未检测" });
  const [lipsyncEnabled, setLipsyncEnabled] = useState(false);
  const [libtvAccessKey, setLibtvAccessKey] = useState("");
  const [libtvSessionId, setLibtvSessionId] = useState("");
  const [libtvProjectUrl, setLibtvProjectUrl] = useState("");
  const [libtvResults, setLibtvResults] = useState<LibTvResult[]>([]);
  const [libtvRunning, setLibtvRunning] = useState(false);
  const [libtvMessages, setLibtvMessages] = useState<LibTvMessage[]>([]);
  const [libtvInstruction, setLibtvInstruction] = useState("");
  const [libtvCanvasOpen, setLibtvCanvasOpen] = useState(false);
  const [libtvPollingPaused, setLibtvPollingPaused] = useState(false);
  const [libtvSending, setLibtvSending] = useState(false);
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [editorSyncState, setEditorSyncState] = useState<"idle" | "saving" | "ready" | "error">("idle");
  const [editorSyncProgress, setEditorSyncProgress] = useState(0);
  const [sceneAction, setSceneAction] = useState<SceneAction | null>(null);
  const [seedanceApiKey, setSeedanceApiKey] = useState("");
  const [seedanceModel, setSeedanceModel] = useState("doubao-seedance-2-0-260128");
  const [videoResolution, setVideoResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [importMessage, setImportMessage] = useState("可按需导入，已具备的环节会自动跳过");
  const [scriptImported, setScriptImported] = useState(false);
  const [volcengineSdk, setVolcengineSdk] = useState<{ installed: boolean; version: string; signerReady: boolean; note: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const assetReuseKeyRef = useRef("");
  const runRef = useRef(0);
  const editorSyncRef = useRef(false);
  const quickModelSaveRef = useRef(false);
  const roleModelWriteRef = useRef<AgentRole | null>(null);
  const sceneActionRef = useRef("");
  const editorProjectIdRef = useRef(`studio-${Date.now().toString(36)}`);
  const libtvPauseRef = useRef(false);
  const runtimeShotReuseRef = useRef(new Map<string, string>());
  const runtimeVoiceReuseRef = useRef(new Map<string, { url: string; duration: number }>());

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
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        type SavedSettings = {
          agentConfigs?: Partial<Record<AgentRole, AgentConfig>>;
          customModels?: CustomModel[];
          pollinationsKey?: string;
          bridge?: { url?: string; token?: string; lipsync?: boolean };
          cloudEngines?: { libtvKey?: string; libtvSessionId?: string; libtvProjectUrl?: string; seedanceKey?: string; seedanceModel?: string; videoResolution?: "480p" | "720p" | "1080p" };
          workspace?: { projectTitle?: string; story?: string; style?: string; targetDuration?: number; aspect?: "9:16" | "16:9"; voiceEnabled?: boolean; bgmEnabled?: boolean; subtitleEnabled?: boolean; voice?: string; musicPrompt?: string; subtitleScale?: number; subtitleColor?: string; musicVolume?: number; scriptImported?: boolean };
        };
        const startingFresh = window.localStorage.getItem(NEW_STUDIO_KEY) === "1";
        const requestedProjectId = window.localStorage.getItem(OPEN_STUDIO_PROJECT_KEY) || "";
        if (startingFresh) {
          window.localStorage.removeItem(NEW_STUDIO_KEY);
          window.localStorage.removeItem(STUDIO_SESSION_KEY);
          window.localStorage.removeItem("manjing-text-draft");
          setStory("");
          setScriptImported(false);
          setProjectTitle("未命名项目");
          editorProjectIdRef.current = `studio-${Date.now().toString(36)}`;
        }
        if (requestedProjectId) window.localStorage.removeItem(OPEN_STUDIO_PROJECT_KEY);
        let savedSession: StudioSession | null = null;
        if (!startingFresh) {
          try { savedSession = JSON.parse(window.localStorage.getItem(STUDIO_SESSION_KEY) || "null") as StudioSession | null; } catch { savedSession = null; }
        }
        let restoredProject = null as Awaited<ReturnType<typeof loadEditorProjectById>>;
        const mediaProjectId = requestedProjectId || savedSession?.projectId || "";
        if (mediaProjectId) restoredProject = await loadEditorProjectById(mediaProjectId).catch(() => null);
        let desktop: SavedSettings = {};
        try {
          const response = await fetch("/api/desktop/settings", { cache: "no-store" });
          if (response.ok) desktop = await response.json() as SavedSettings;
        } catch {
          desktop = {};
        }
        if (!active) return;
        const savedKey = desktop.pollinationsKey || window.localStorage.getItem("manjing-pollinations-key") || "";
        const savedDraft = startingFresh ? "" : window.localStorage.getItem("manjing-text-draft");
        const savedAgents = desktop.agentConfigs || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-agent-team") || "null") as Partial<Record<AgentRole, AgentConfig>> | null; } catch { return null; }
        })();
        const savedBridge = desktop.bridge || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-local-bridge") || "null") as SavedSettings["bridge"]; } catch { return undefined; }
        })();
        const savedCloudEngines = desktop.cloudEngines || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-cloud-engines") || "null") as SavedSettings["cloudEngines"]; } catch { return undefined; }
        })();
        const savedWorkspace = startingFresh ? undefined : desktop.workspace || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-workspace") || "null") as SavedSettings["workspace"]; } catch { return undefined; }
        })();
        if (savedKey) setApiKey(savedKey);
        if (savedWorkspace?.story || savedDraft) setStory(savedWorkspace?.story || savedDraft || SAMPLE_STORY);
        if (savedAgents) {
          const merged = { ...makeTeam("free"), ...savedAgents };
          setAgentConfigs(merged);
          setMode(AGENT_ROLES.some(({ id }) => !["horde", "browser"].includes(merged[id].adapter)) ? "cloud" : "community");
        }
        if (savedBridge) {
          setBridgeUrl(savedBridge.url || "");
          setBridgeToken(savedBridge.token || "");
          setLipsyncEnabled(Boolean(savedBridge.lipsync));
        }
        if (savedCloudEngines) {
          setLibtvAccessKey(savedCloudEngines.libtvKey || "");
          setLibtvSessionId(savedCloudEngines.libtvSessionId || "");
          setLibtvProjectUrl(savedCloudEngines.libtvProjectUrl || "");
          setSeedanceApiKey(savedCloudEngines.seedanceKey || "");
          setSeedanceModel(savedCloudEngines.seedanceModel || "doubao-seedance-2-0-260128");
          setVideoResolution(savedCloudEngines.videoResolution || "720p");
        }
        if (savedWorkspace) {
          if (savedWorkspace.projectTitle) setProjectTitle(savedWorkspace.projectTitle);
          if (savedWorkspace.style && STYLE_PROMPTS[savedWorkspace.style]) setStyle(savedWorkspace.style);
          if (typeof savedWorkspace.targetDuration === "number") setTargetDuration(savedWorkspace.targetDuration);
          if (savedWorkspace.aspect === "9:16" || savedWorkspace.aspect === "16:9") setAspect(savedWorkspace.aspect);
          if (typeof savedWorkspace.voiceEnabled === "boolean") setVoiceEnabled(savedWorkspace.voiceEnabled);
          if (typeof savedWorkspace.bgmEnabled === "boolean") setBgmEnabled(savedWorkspace.bgmEnabled);
          if (typeof savedWorkspace.subtitleEnabled === "boolean") setSubtitleEnabled(savedWorkspace.subtitleEnabled);
          if (savedWorkspace.voice) setVoice(savedWorkspace.voice);
          if (savedWorkspace.musicPrompt) setMusicPrompt(savedWorkspace.musicPrompt);
          if (typeof savedWorkspace.subtitleScale === "number") setSubtitleScale(savedWorkspace.subtitleScale);
          if (savedWorkspace.subtitleColor) setSubtitleColor(savedWorkspace.subtitleColor);
          if (typeof savedWorkspace.musicVolume === "number") setMusicVolume(savedWorkspace.musicVolume);
          setScriptImported(savedWorkspace.scriptImported === true);
        }
        if (requestedProjectId && !restoredProject) {
          try {
            const drafts = JSON.parse(window.localStorage.getItem(STUDIO_DRAFTS_KEY) || "{}") as Record<string, StudioSession>;
            if (drafts[requestedProjectId]) savedSession = drafts[requestedProjectId];
          } catch { /* keep the latest session fallback */ }
        }
        const snapshot = (requestedProjectId && restoredProject?.studioSnapshot ? restoredProject.studioSnapshot : savedSession) as Partial<StudioSession> | null;
        if (snapshot && !startingFresh) {
          const sessionScenes = Array.isArray(snapshot.scenes) ? snapshot.scenes as Scene[] : [];
          const restoredScenes = sessionScenes.map((scene) => {
            const visual = restoredProject?.clips.find((clip) => clip.id === `${scene.id}-visual`);
            const audio = restoredProject?.clips.find((clip) => clip.id === `${scene.id}-audio`);
            return {
              ...scene,
              imageUrl: visual?.type === "image" ? visual.url : durableMediaUrl(scene.imageUrl),
              videoUrl: visual?.type === "video" ? visual.url : durableMediaUrl(scene.videoUrl),
              audioUrl: audio?.url || durableMediaUrl(scene.audioUrl),
            };
          });
          if (snapshot.projectId || restoredProject?.id) editorProjectIdRef.current = String(restoredProject?.id || snapshot.projectId);
          if (snapshot.projectTitle) setProjectTitle(snapshot.projectTitle);
          if (snapshot.story) setStory(snapshot.story);
          if (snapshot.style && STYLE_PROMPTS[snapshot.style]) setStyle(snapshot.style);
          if (typeof snapshot.targetDuration === "number") setTargetDuration(snapshot.targetDuration);
          if (snapshot.aspect === "9:16" || snapshot.aspect === "16:9") setAspect(snapshot.aspect);
          if (Array.isArray(snapshot.characters)) setCharacters(snapshot.characters as CharacterAsset[]);
          if (restoredScenes.length) setScenes(restoredScenes);
          if (typeof snapshot.selected === "number") setSelected(Math.max(0, Math.min(restoredScenes.length - 1, snapshot.selected)));
          if (snapshot.phase) setPhase(snapshot.phase as Phase);
          if (typeof snapshot.progress === "number") setProgress(snapshot.progress);
          if (snapshot.statusText) setStatusText(snapshot.statusText);
          if (Array.isArray(snapshot.activityLog)) setActivityLog(snapshot.activityLog as ActivityEvent[]);
          if (snapshot.musicPrompt) setMusicPrompt(snapshot.musicPrompt);
          setMusicUrl(restoredProject?.clips.find((clip) => clip.id === "project-music")?.url || durableMediaUrl(snapshot.musicUrl) || "");
          setExportUrl(restoredProject?.finalVideo?.url || durableMediaUrl(snapshot.exportUrl) || "");
        } else if (requestedProjectId && restoredProject) {
          editorProjectIdRef.current = restoredProject.id;
          const visuals = restoredProject.clips.filter((clip) => clip.type === "video" || clip.type === "image");
          const reconstructed = visuals.map((clip, index) => ({ id: clip.id.replace(/-visual$/, ""), title: clip.name, visual: clip.name, action: "已保存的生成镜头", shot: "镜头", camera: "保持原镜头", dialogue: "", speaker: "", emotion: "自然", sfx: "", characters: [], duration: clip.duration, imageUrl: clip.type === "image" ? clip.url : undefined, videoUrl: clip.type === "video" ? clip.url : undefined, status: "ready" as SceneStatus }));
          setProjectTitle(restoredProject.name); setScenes(reconstructed); setPhase("ready"); setProgress(100); setStatusText("已从项目资产恢复镜头"); setExportUrl(restoredProject.finalVideo?.url || "");
        }
        const models = Array.isArray(desktop.customModels) ? desktop.customModels.filter((item) => item?.id && item?.role && item?.model) : loadCustomModels();
        setCustomModels(models);
        if (desktop.customModels) {
          try { saveCustomModels(models); } catch { /* localStorage fallback is optional in the desktop app */ }
        }
        setAgentTeamLoaded(true);
      })();
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const raw = window.sessionStorage.getItem("manjing-active-series-context-v1") || window.localStorage.getItem("manjing-active-series-context-v1");
    if (!raw) return;
    try {
      const context = JSON.parse(raw) as { projectId?: string; projectName?: string; episodeId?: string; episodeNumber?: number; context?: string; activatedAt?: string };
      if (!context.projectId || !context.episodeId || !context.context) return;
      const applyKey = `${context.projectId}:${context.episodeId}:${context.activatedAt || ""}`;
      if (window.sessionStorage.getItem("manjing-series-context-applied") === applyKey) return;
      window.sessionStorage.setItem("manjing-series-context-applied", applyKey);
      setProjectTitle(`${context.projectName || "系列项目"} · 第 ${context.episodeNumber || 1} 集`);
      setStory(context.context);
      setScriptImported(true);
      setCharacters([]);
      setScenes([]);
      setSelected(0);
      setPhase("idle");
      setProgress(0);
      setStatusText(`已同步“${context.projectName || "系列项目"}”第 ${context.episodeNumber || 1} 集、项目记忆和上一集状态`);
      try { window.localStorage.setItem("manjing-text-draft", context.context); } catch { window.sessionStorage.setItem("manjing-text-draft", context.context); }
      recordActivity("director", `已接收系列项目第 ${context.episodeNumber || 1} 集上下文，后续资产归属当前项目`, "done");
    } catch (reason) {
      setError(reason instanceof Error ? `项目同步失败：${reason.message}` : "项目同步失败");
    }
  }, [agentTeamLoaded]);

  useEffect(() => {
    const synchronizeSeriesContext = (event: Event) => {
      const context = (event as CustomEvent<{ projectId: string; projectName: string; episodeId: string; episodeNumber: number; context: string }>).detail;
      if (!context?.projectId || !context?.episodeId || !context.context) return;
      setProjectTitle(`${context.projectName || "系列项目"} · 第 ${context.episodeNumber || 1} 集`);
      setStory(context.context);
      setScriptImported(true);
      setCharacters([]);
      setScenes([]);
      setSelected(0);
      setPhase("idle");
      setProgress(0);
      setError("");
      setStatusText(`已切换到“${context.projectName || "系列项目"}”第 ${context.episodeNumber || 1} 集，项目记忆与资产归属已同步`);
      try { window.localStorage.setItem("manjing-text-draft", context.context); } catch { window.sessionStorage.setItem("manjing-text-draft", context.context); }
      recordActivity("director", `已在工作台切换至第 ${context.episodeNumber || 1} 集`, "done");
    };
    window.addEventListener("manjing-series-context-changed", synchronizeSeriesContext);
    return () => window.removeEventListener("manjing-series-context-changed", synchronizeSeriesContext);
  }, []);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const raw = window.localStorage.getItem("manjing-studio-library-import");
    if (!raw) return;
    window.localStorage.removeItem("manjing-studio-library-import");
    let ids: string[] = [];
    try { ids = JSON.parse(raw) as string[]; } catch { ids = []; }
    if (!Array.isArray(ids) || !ids.length) return;
    setImportMessage("正在从独立资产库载入选中资产…");
    void loadLibraryAssets(ids).then((items) => applyLibraryAssets(items)).catch((reason) => setError(reason instanceof Error ? reason.message : "资产库导入失败"));
  }, [agentTeamLoaded]);

  useEffect(() => {
    if (!agentTeamLoaded || (!characters.length && !scenes.length)) return;
    const reuseKey = `${characters.map((item) => `${item.id}:${item.name}:${Boolean(item.imageUrl)}`).join("|")}::${scenes.map((item) => `${item.id}:${item.title}:${item.environmentKey || ""}:${Boolean(item.imageUrl)}`).join("|")}`;
    if (assetReuseKeyRef.current === reuseKey) return;
    assetReuseKeyRef.current = reuseKey;
    void listLibraryAssets().then(async (library) => {
      const reusable = library.filter((asset) => asset.reusable !== false && asset.mediaType === "image").sort((a, b) => Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || (b.usageCount || 0) - (a.usageCount || 0));
      const selectedIds = new Set<string>();
      const characterMatches = new Map<string, LibraryAsset>();
      const sceneMatches = new Map<string, LibraryAsset>();
      for (const character of characters.filter((item) => isVisualCharacterAsset(item) && !item.imageUrl)) {
        const name = character.name.trim().toLocaleLowerCase("zh-CN");
        const match = reusable.find((asset) => asset.category === "character" && `${asset.name} ${asset.identityKey || ""} ${asset.lookName || ""} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(name));
        if (match) { characterMatches.set(character.id, match); selectedIds.add(match.id); }
      }
      for (const scene of scenes.filter((item) => !item.imageUrl)) {
        const terms = [scene.environmentKey, scene.title].map((item) => String(item || "").trim().toLocaleLowerCase("zh-CN")).filter((item) => item.length >= 2);
        const match = reusable.find((asset) => asset.category === "scene" && terms.some((term) => `${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(term)));
        if (match) { sceneMatches.set(scene.id, match); selectedIds.add(match.id); }
      }
      if (!selectedIds.size) return;
      const loaded = await loadLibraryAssets([...selectedIds]);
      const byId = new Map(loaded.map((asset) => [asset.id, asset]));
      setCharacters((items) => items.map((item) => { const match = characterMatches.get(item.id); const loadedAsset = match ? byId.get(match.id) : null; return !item.imageUrl && loadedAsset?.url ? { ...item, imageUrl: loadedAsset.url, arkAssetId: loadedAsset.arkAssetId, portraitAuthorizationStatus: loadedAsset.portraitAuthorizationStatus, status: "ready" } : item; }));
      setScenes((items) => items.map((item) => { const match = sceneMatches.get(item.id); const loadedAsset = match ? byId.get(match.id) : null; return !item.imageUrl && loadedAsset?.url ? { ...item, imageUrl: loadedAsset.url, status: "ready", model: "Agent 资产复用" } : item; }));
      await Promise.all([...selectedIds].map((id) => markLibraryAssetUsed(id)));
      setImportMessage(`Agent 已自动匹配并复用 ${selectedIds.size} 项人物或场景资产，缺少部分才会继续生成`);
      recordActivity("director", `已从资产库自动检索并复用 ${selectedIds.size} 项资产`, "done");
    }).catch((reason) => console.warn("[manjing asset reuse]", reason));
  }, [agentTeamLoaded, characters, scenes]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    void fetch("/api/desktop/volcengine-sdk", { cache: "no-store" }).then(async (response) => {
      if (response.ok) setVolcengineSdk(await response.json() as { installed: boolean; version: string; signerReady: boolean; note: string });
      else setVolcengineSdk({ installed: false, version: "", signerReady: false, note: "网页版不加载本机 SDK；Windows 独立版会自动检测。" });
    }).catch(() => setVolcengineSdk({ installed: false, version: "", signerReady: false, note: "网页版不加载本机 SDK；Windows 独立版会自动检测。" }));
  }, [agentTeamLoaded]);

  useEffect(() => {
    const refresh = () => setCustomModels(loadCustomModels());
    window.addEventListener("manjing-custom-models-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("manjing-custom-models-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
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
    if (agentTeamLoaded) window.localStorage.setItem("manjing-local-bridge", JSON.stringify({ url: bridgeUrl, token: bridgeToken, lipsync: lipsyncEnabled }));
  }, [bridgeUrl, bridgeToken, lipsyncEnabled, agentTeamLoaded]);

  useEffect(() => {
    if (agentTeamLoaded) window.localStorage.setItem("manjing-cloud-engines", JSON.stringify({ libtvKey: libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceKey: seedanceApiKey, seedanceModel, videoResolution }));
  }, [libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceApiKey, seedanceModel, videoResolution, agentTeamLoaded]);

  useEffect(() => {
    const producing = runRef.current !== 0 && !["idle", "ready", "error"].includes(phase);
    if (producing) window.localStorage.setItem("manjing-production-runtime-v1", JSON.stringify({ active: true, phase, progress, statusText, projectTitle, updatedAt: Date.now() }));
    else window.localStorage.removeItem("manjing-production-runtime-v1");
    const protectWindow = (event: BeforeUnloadEvent) => {
      if (!producing) return;
      event.preventDefault();
      event.returnValue = "漫剧仍在制作，关闭窗口会中断当前任务。";
    };
    window.addEventListener("beforeunload", protectWindow);
    return () => window.removeEventListener("beforeunload", protectWindow);
  }, [phase, progress, statusText, projectTitle]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const workspace = { projectTitle, story, style, targetDuration, aspect, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, scriptImported };
    window.localStorage.setItem("manjing-workspace", JSON.stringify(workspace));
    const timer = window.setTimeout(() => { void persistDesktopSettings().catch(() => undefined); }, 300);
    return () => window.clearTimeout(timer);
  }, [agentTeamLoaded, agentConfigs, customModels, apiKey, bridgeUrl, bridgeToken, lipsyncEnabled, libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceApiKey, seedanceModel, projectTitle, story, style, targetDuration, aspect, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, scriptImported]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const session: StudioSession = {
      version: 2,
      projectId: editorProjectIdRef.current,
      projectTitle,
      story,
      style,
      targetDuration,
      aspect,
      characters: characters.map(serializableCharacter),
      scenes: scenes.map(serializableScene),
      selected,
      phase,
      progress,
      statusText,
      activityLog: activityLog.slice(0, 120),
      musicPrompt,
      musicUrl: durableMediaUrl(musicUrl),
      exportUrl: durableMediaUrl(exportUrl),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(session));
    if (story.trim() || scenes.length || phase !== "idle") {
      try {
        const drafts = JSON.parse(window.localStorage.getItem(STUDIO_DRAFTS_KEY) || "{}") as Record<string, StudioSession>;
        drafts[session.projectId] = session;
        window.localStorage.setItem(STUDIO_DRAFTS_KEY, JSON.stringify(Object.fromEntries(Object.entries(drafts).sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt)).slice(0, 30))));
        const saved = JSON.parse(window.localStorage.getItem("manjing-projects") || "[]") as Array<{ id?: string }>;
        const card = { id: session.projectId, title: projectTitle || "未命名漫剧", story: story.trim().slice(0, 120) || `${scenes.length} 个分镜`, updatedAt: "刚刚", duration: formatTime(totalDuration || targetDuration), status: phase === "ready" ? "待精剪" : phase === "error" ? "制作中断" : "制作中", source: "studio" as const, durable: false };
        window.localStorage.setItem("manjing-projects", JSON.stringify([card, ...saved.filter((item) => item.id !== card.id)].slice(0, 30)));
      } catch { /* a private browsing quota should not interrupt production */ }
    }
  }, [agentTeamLoaded, projectTitle, story, style, targetDuration, aspect, characters, scenes, selected, phase, progress, statusText, activityLog, musicPrompt, musicUrl, exportUrl]);

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
    const custom = customModels.find((item) => item.role === role && item.id === presetId);
    if (custom) {
      setAgentConfigs((current) => ({ ...current, [role]: { preset: custom.id, adapter: custom.adapter, model: custom.model, endpoint: custom.endpoint, apiKey: custom.apiKey } }));
      if (custom.adapter !== "browser") setMode("cloud");
      return;
    }
    const previous = agentConfigs[role];
    const next = configFromPreset(role, presetId);
    if (next.adapter === "webhook") {
      next.endpoint = previous.endpoint;
      next.apiKey = previous.apiKey;
      if (previous.adapter === "webhook") next.model = previous.model;
    }
    if (next.adapter === "seedance") {
      next.apiKey = previous.adapter === "seedance" ? previous.apiKey : seedanceApiKey;
      next.model = previous.adapter === "seedance" ? previous.model : seedanceModel;
    }
    setAgentConfigs((current) => ({ ...current, [role]: next }));
    if (next.adapter !== "horde" && next.adapter !== "browser") setMode("cloud");
  }

  function updateAgentConfig(role: AgentRole, patch: Partial<AgentConfig>) {
    setAgentConfigs((current) => ({ ...current, [role]: { ...current[role], ...patch } }));
    setRoleSaveState({ role, state: "idle", message: "配置已修改，点击下方按钮保存并应用" });
  }

  function desktopSettingsPayload(configs = agentConfigs, models = customModels) {
    return {
      version: 1,
      agentConfigs: configs,
      customModels: models,
      pollinationsKey: apiKey,
      bridge: { url: bridgeUrl, token: bridgeToken, lipsync: lipsyncEnabled },
      cloudEngines: { libtvKey: libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceKey: seedanceApiKey, seedanceModel },
      workspace: { projectTitle, story, style, targetDuration, aspect, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, scriptImported },
      savedAt: new Date().toISOString(),
    };
  }

  async function persistDesktopSettings(configs = agentConfigs, models = customModels) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("/api/desktop/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(desktopSettingsPayload(configs, models)),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("本机配置写入超过 6 秒，操作已解除锁定，请重试");
      throw reason;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function changeDirectApiMode(role: AgentRole, adapter: DiscoverableApiMode) {
    const defaults: Record<AgentRole, string> = { director: "", writer: "", image: "", video: "seedance-2.0", voice: "tts", editor: "" };
    setAgentConfigs((current) => {
      const previous = current[role];
      return {
        ...current,
        [role]: {
          // Choosing an API mode starts a fresh direct-role configuration. Do
          // not silently overwrite whichever saved custom model happened to be
          // selected before the user opened this form.
          preset: `direct-${role}`,
          adapter,
          model: previous.adapter === adapter ? previous.model : defaults[role],
          endpoint: previous.adapter === adapter && previous.endpoint ? previous.endpoint : API_MODE_DEFAULT_ENDPOINTS[adapter],
          apiKey: previous.adapter === adapter ? previous.apiKey : "",
        },
      };
    });
    setMode("cloud");
    setRoleModelOptions((current) => ({ ...current, [role]: [] }));
    setRoleSaveState({ role, state: "idle", message: `已切换为${API_MODE_LABELS[adapter]}，填写后请点击保存并应用` });
  }

  async function discoverCurrentAgentModels(role: AgentRole) {
    const config = agentConfigs[role];
    if (!apiModesForRole(role).includes(config.adapter as DiscoverableApiMode)) return;
    const adapter = config.adapter as DiscoverableApiMode;
    const endpoint = config.endpoint || API_MODE_DEFAULT_ENDPOINTS[adapter];
    if (!validAgentEndpoint(endpoint)) {
      setRoleSaveState({ role, state: "error", message: "请先填写有效的 API 地址" });
      return;
    }
    setRoleModelLoading(role);
    setRoleSaveState({ role, state: "saving", message: "正在连接 API 并读取模型列表…" });
    try {
      const models = await discoverApiModels({ mode: adapter, endpoint, apiKey: config.apiKey || (adapter === "pollinations" ? apiKey : "") });
      setRoleModelOptions((current) => ({ ...current, [role]: models }));
      updateAgentConfig(role, { endpoint, model: models.some((item) => item.id === config.model) ? config.model : models[0].id });
      setRoleSaveState({ role, state: "idle", message: `已读取 ${models.length} 个模型，请选择后点击“保存此岗位 API 并立即应用”` });
    } catch (reason) {
      setRoleModelOptions((current) => ({ ...current, [role]: [] }));
      setRoleSaveState({ role, state: "error", message: reason instanceof Error ? reason.message : "读取模型失败" });
    } finally {
      setRoleModelLoading(null);
    }
  }

  async function saveCurrentAgentApi(role: AgentRole) {
    if (roleModelWriteRef.current) return;
    const config = agentConfigs[role];
    if (!config.model.trim()) {
      setRoleSaveState({ role, state: "error", message: "请先填写或选择模型 ID" });
      return;
    }
    if (apiModesForRole(role).includes(config.adapter as DiscoverableApiMode) && !validAgentEndpoint(config.endpoint || API_MODE_DEFAULT_ENDPOINTS[config.adapter as DiscoverableApiMode])) {
      setRoleSaveState({ role, state: "error", message: "请填写有效的 HTTPS API 地址或本机 localhost 地址" });
      return;
    }
    if (config.adapter === "pollinations" && !(config.apiKey || apiKey).startsWith("pk_")) {
      setRoleSaveState({ role, state: "error", message: "Pollinations 需要填写以 pk_ 开头的发布密钥" });
      return;
    }
    const normalized = {
      ...config,
      endpoint: config.endpoint || (apiModesForRole(role).includes(config.adapter as DiscoverableApiMode) ? API_MODE_DEFAULT_ENDPOINTS[config.adapter as DiscoverableApiMode] : ""),
    };
    const existing = customModels.find((item) => item.role === role && item.id === normalized.preset);
    const libraryId = existing?.id || `custom-${role}-direct`;
    const libraryModel: CustomModel = {
      id: libraryId,
      role,
      name: existing && existing.name !== existing.model ? existing.name : normalized.model,
      adapter: normalized.adapter as CustomModel["adapter"],
      model: normalized.model,
      endpoint: normalized.endpoint,
      apiKey: normalized.apiKey,
      note: existing?.note || "从岗位 API 设置保存",
    };
    const nextModels = [libraryModel, ...customModels.filter((item) => item.id !== libraryId)].slice(0, 60);
    const applied = { ...normalized, preset: libraryId };
    const next = { ...agentConfigs, [role]: applied };
    setMode(normalized.adapter === "horde" || normalized.adapter === "browser" ? mode : "cloud");
    setRoleSaveState({ role, state: "saving", message: "正在保存岗位配置并同步到“我的模型”…" });
    roleModelWriteRef.current = role;
    try {
      await persistDesktopSettings(next, nextModels);
      saveCustomModels(nextModels);
      setCustomModels(nextModels);
      setAgentConfigs(next);
      window.localStorage.setItem("manjing-agent-team", JSON.stringify(next));
      setRoleSaveState({ role, state: "saved", message: `${AGENT_ROLES.find((item) => item.id === role)?.title || "当前岗位"} API 已保存、立即应用并同步到“我的模型”，下次打开会自动恢复` });
      setError("");
    } catch (reason) {
      setRoleSaveState({ role, state: "error", message: reason instanceof Error ? `保存失败：${reason.message}` : "保存失败，请重试" });
    } finally {
      roleModelWriteRef.current = null;
    }
  }

  function toggleQuickModel(role: AgentRole) {
    if (quickModelRole === role) {
      setQuickModelRole(null);
      setQuickModelMessage("");
      setQuickModelOptions([]);
      return;
    }
    setQuickModelRole(role);
    setQuickModelDraft({ name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" });
    setQuickModelMessage("");
    setQuickModelOptions([]);
  }

  function changeQuickApiMode(adapter: DiscoverableApiMode) {
    setQuickModelDraft((value) => ({ ...value, adapter, endpoint: API_MODE_DEFAULT_ENDPOINTS[adapter], model: "" }));
    setQuickModelOptions([]);
    setQuickModelMessage("");
  }

  async function discoverQuickModels() {
    const endpoint = quickModelDraft.endpoint.trim() || API_MODE_DEFAULT_ENDPOINTS[quickModelDraft.adapter];
    if (!validAgentEndpoint(endpoint)) {
      setQuickModelMessage("请先填写有效的 HTTPS API 地址，或本机 localhost 地址");
      return;
    }
    setQuickModelLoading(true);
    setQuickModelMessage("正在连接接口并读取模型列表…");
    try {
      const models = await discoverApiModels({
        mode: quickModelDraft.adapter,
        endpoint,
        apiKey: quickModelDraft.apiKey.trim(),
      });
      setQuickModelOptions(models);
      setQuickModelDraft((value) => ({ ...value, endpoint, model: models.some((item) => item.id === value.model) ? value.model : models[0].id }));
      setQuickModelMessage(`连接成功，已读取 ${models.length} 个模型，请选择后保存`);
    } catch (reason) {
      setQuickModelOptions([]);
      setQuickModelMessage(reason instanceof Error ? reason.message : "读取模型失败，请检查 API 模式、地址和密钥");
    } finally {
      setQuickModelLoading(false);
    }
  }

  async function saveQuickModel(role: AgentRole) {
    if (quickModelSaveRef.current) return;
    const modelId = quickModelDraft.model.trim();
    const name = quickModelDraft.name.trim() || modelId;
    const endpoint = quickModelDraft.endpoint.trim() || API_MODE_DEFAULT_ENDPOINTS[quickModelDraft.adapter];
    const apiKeyValue = quickModelDraft.apiKey.trim();
    if (!modelId) {
      setQuickModelMessage("请先读取并选择模型，或手动填写模型 ID");
      return;
    }
    if (!validAgentEndpoint(endpoint)) {
      setQuickModelMessage("请填写有效的 HTTPS 接口，或本机 localhost 地址");
      return;
    }
    const custom: CustomModel = {
      id: `custom-${role}-${Date.now().toString(36)}`,
      role,
      name,
      adapter: quickModelDraft.adapter,
      model: modelId,
      endpoint,
      apiKey: apiKeyValue,
      note: quickModelDraft.note.trim() || "工作台内添加的自定义模型",
    };
    const next = [custom, ...customModels.filter((item) => item.id !== custom.id)].slice(0, 60);
    const nextConfigs = {
      ...agentConfigs,
      [role]: { preset: custom.id, adapter: custom.adapter, model: custom.model, endpoint: custom.endpoint, apiKey: custom.apiKey },
    };
    quickModelSaveRef.current = true;
    setQuickModelSaving(true);
    try {
      await persistDesktopSettings(nextConfigs, next);
      saveCustomModels(next);
      setCustomModels(next);
      setAgentConfigs(nextConfigs);
      window.localStorage.setItem("manjing-agent-team", JSON.stringify(nextConfigs));
      setMode("cloud");
      setQuickModelDraft({ name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" });
      setQuickModelOptions([]);
      setQuickModelMessage(`${custom.name} 已保存并应用到 ${AGENT_ROLES.find((item) => item.id === role)?.title || "当前岗位"}`);
      setError("");
    } catch {
      setQuickModelMessage("保存失败：本机模型库暂时不可写，请重启软件后重试");
    } finally {
      quickModelSaveRef.current = false;
      setQuickModelSaving(false);
    }
  }

  async function deleteRoleCustomModel(role: AgentRole, id: string) {
    if (roleModelWriteRef.current) return;
    const target = customModels.find((item) => item.id === id && item.role === role);
    if (!target) return;
    const nextModels = customModels.filter((item) => item.id !== id);
    const fallback = configFromPreset(role, AGENT_PRESETS[role][0].id);
    const nextConfigs = agentConfigs[role].preset === id ? { ...agentConfigs, [role]: fallback } : agentConfigs;
    setRoleSaveState({ role, state: "saving", message: `正在删除“${target.name}”并同步本机配置…` });
    roleModelWriteRef.current = role;
    try {
      await persistDesktopSettings(nextConfigs, nextModels);
      saveCustomModels(nextModels);
      setCustomModels(nextModels);
      setAgentConfigs(nextConfigs);
      window.localStorage.setItem("manjing-agent-team", JSON.stringify(nextConfigs));
      setRoleModelOptions((current) => ({ ...current, [role]: (current[role] || []).filter((item) => item.id !== target.id) }));
      setRoleSaveState({ role, state: "saved", message: agentConfigs[role].preset === id ? `已删除“${target.name}”，${AGENT_ROLES.find((item) => item.id === role)?.title}已自动切回免费默认模型` : `已删除“${target.name}”` });
    } catch (reason) {
      setRoleSaveState({ role, state: "error", message: reason instanceof Error ? `删除失败：${reason.message}` : "删除失败，请重试" });
    } finally {
      roleModelWriteRef.current = null;
    }
  }

  function applySeedanceEngine() {
    if (seedanceApiKey.trim().length < 8) {
      setError("请先填写火山方舟 API Key");
      return;
    }
    if (!/^(?:doubao-seedance-[a-z0-9-]+|ep-[a-z0-9-]+)$/i.test(seedanceModel.trim())) {
      setError("请填写正确的 Seedance 模型 ID 或 Endpoint ID");
      return;
    }
    const appliedModel = seedanceModel.trim();
    const appliedPreset = /^doubao-seedance-2-0-260128$/i.test(appliedModel) ? "volc-seedance" : "direct-video";
    if (/seedance-2-0-fast/i.test(appliedModel) && videoResolution === "1080p") setVideoResolution("720p");
    setAgentConfigs((current) => ({
      ...current,
      video: { preset: appliedPreset, adapter: "seedance", model: appliedModel, endpoint: "", apiKey: seedanceApiKey.trim() },
    }));
    setMode("cloud");
    setConfiguringRole(null);
    setError("");
  }

  function agentName(role: AgentRole) {
    const config = agentConfigs[role];
    return AGENT_PRESETS[role].find((item) => item.id === config.preset)?.name || customModels.find((item) => item.id === config.preset)?.name || config.model;
  }

  function agentKey(role: AgentRole) {
    return agentConfigs[role].apiKey.trim() || apiKey.trim();
  }

  function normalizedBridgeUrl() {
    return bridgeUrl.trim().replace(/\/+$/, "");
  }

  function applyBridgeRole(role: "image" | "video" | "voice") {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setError("请先填写有效的 HTTPS 桥接地址，或本机 localhost 地址");
      return;
    }
    const definitions = {
      image: { preset: "comfyui-image", model: "ComfyUI Image Workflow", path: "/v1/image" },
      video: { preset: "wan22-video", model: "Wan2.2 / ComfyUI", path: "/v1/video" },
      voice: { preset: "cosyvoice-voice", model: "CosyVoice", path: "/v1/audio" },
    } as const;
    const selected = definitions[role];
    setAgentConfigs((current) => ({ ...current, [role]: { preset: selected.preset, adapter: "webhook", model: selected.model, endpoint: `${base}${selected.path}`, apiKey: bridgeToken.trim() } }));
    setMode("cloud");
    setConfiguringRole(null);
    setError("");
  }

  function applyVibeVoiceRole() {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setError("请先填写有效的漫镜桥接地址");
      return;
    }
    setAgentConfigs((current) => ({
      ...current,
      voice: { preset: "vibevoice-realtime-voice", adapter: "webhook", model: "VibeVoice-Realtime-0.5B", endpoint: `${base}/v1/vibevoice/audio`, apiKey: bridgeToken.trim() },
    }));
    setMode("cloud");
    setConfiguringRole(null);
    setError("");
  }

  function applyBridgeStack() {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setError("请先填写有效的漫镜桥接地址");
      return;
    }
    setAgentConfigs((current) => ({
      ...current,
      image: { preset: "comfyui-image", adapter: "webhook", model: "ComfyUI Image Workflow", endpoint: `${base}/v1/image`, apiKey: bridgeToken.trim() },
      video: { preset: "wan22-video", adapter: "webhook", model: "Wan2.2 / ComfyUI", endpoint: `${base}/v1/video`, apiKey: bridgeToken.trim() },
      voice: { preset: "cosyvoice-voice", adapter: "webhook", model: "CosyVoice", endpoint: `${base}/v1/audio`, apiKey: bridgeToken.trim() },
    }));
    setMode("cloud");
    setLipsyncEnabled(true);
    setConfiguringRole(null);
    setError("");
  }

  async function testBridgeConnection() {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setBridgeHealth({ state: "error", message: "地址格式不正确" });
      return;
    }
    setBridgeHealth({ state: "testing", message: "正在检测本地节点" });
    try {
      const response = await fetch(`${base}/health`, { headers: bridgeToken.trim() ? { Authorization: `Bearer ${bridgeToken.trim()}` } : {} });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { nodes?: Record<string, boolean>; workflows?: Record<string, boolean> };
      const nodes = data.nodes || {};
      const workflows = data.workflows || {};
      const readyCount = Object.values(nodes).filter(Boolean).length;
      const totalCount = Object.keys(nodes).length;
      setBridgeHealth({ state: readyCount === totalCount && workflows.image && workflows.video ? "ready" : "partial", message: readyCount ? `${readyCount}/${totalCount} 个模型节点在线` : "桥接服务在线，但模型节点未启动", nodes, workflows });
    } catch (reason) {
      setBridgeHealth({ state: "error", message: reason instanceof Error ? reason.message : "无法连接桥接服务" });
    }
  }

  async function createLipSyncedVideo(scene: Scene) {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base) || !scene.audioUrl || (!scene.videoUrl && !scene.imageUrl)) return "";
    const [sourceResponse, audioResponse] = await Promise.all([fetch(scene.videoUrl || scene.imageUrl as string), fetch(scene.audioUrl)]);
    if (!sourceResponse.ok || !audioResponse.ok) throw new Error("口型增强无法读取镜头画面或配音");
    const sourceBlob = await sourceResponse.blob();
    const audioBlob = await audioResponse.blob();
    const form = new FormData();
    form.append("source", sourceBlob, `scene.${scene.videoUrl ? "mp4" : "png"}`);
    form.append("audio", audioBlob, "voice.wav");
    const response = await fetch(`${base}/v1/lipsync`, { method: "POST", headers: bridgeToken.trim() ? { Authorization: `Bearer ${bridgeToken.trim()}` } : {}, body: form });
    if (!response.ok) throw new Error(await responseError(response));
    if ((response.headers.get("content-type") || "").startsWith("video/")) return URL.createObjectURL(await response.blob());
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error("MuseTalk 没有返回口型视频");
    const output = await fetch(data.url, { headers: bridgeToken.trim() ? { Authorization: `Bearer ${bridgeToken.trim()}` } : {} });
    if (!output.ok) throw new Error("MuseTalk 输出视频无法读取");
    return URL.createObjectURL(await output.blob());
  }

  async function callAgentWebhook(role: AgentRole, payload: Record<string, unknown>) {
    const config = agentConfigs[role];
    if (!validAgentEndpoint(config.endpoint)) throw new Error(`${agentName(role)}需要填写 HTTPS 地址或本机 localhost 地址`);
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ role, model: config.model, ...payload }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return response;
  }

  async function customApiText(role: "director" | "writer" | "prompt" | "editor", payload: Record<string, unknown>) {
    const config = agentConfigs[role];
    const learned = agentContext(role).slice(0, 8);
    const learnedContext = learned.length ? `\n\n以下是用户已审核启用的岗位技能与记忆，请在适用时运用，并避免机械照抄：\n${learned.map((item) => `- [${item.kind === "skill" ? "技能" : "记忆"}] ${item.title}：${item.content}`).join("\n")}` : "";
    if (!CUSTOM_TEXT_ADAPTERS.includes(config.adapter)) throw new Error(`${agentName(role)}不支持当前文本任务`);
    if (!validAgentEndpoint(config.endpoint)) throw new Error(`${agentName(role)}需要填写 HTTPS API 地址或本机 localhost 地址`);
    const response = await fetch("/api/desktop/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: config.adapter,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        role,
        task: payload.task,
        system: `${String(payload.system || "")}${learnedContext}`,
        prompt: payload.prompt,
        payload,
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json() as { text?: string };
    const text = data.text;
    if (!text) throw new Error(`${agentName(role)}没有返回文本结果`);
    markContextUsed(learned.map((item) => item.id));
    return text;
  }

  async function webhookMedia(role: "image" | "video" | "voice", payload: Record<string, unknown>) {
    const memoryRole = role === "image" ? "director" : role;
    const learned = agentContext(memoryRole).slice(0, 8).map((item) => ({ type: item.kind, title: item.title, content: item.content }));
    const learnedPayload = learned.length ? { ...payload, agentLearning: learned } : payload;
    if (role === "video" && (/^agnes-video-/i.test(agentConfigs.video.model) || /agnes-ai\.com/i.test(agentConfigs.video.endpoint))) {
      const response = await fetch("/api/desktop/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "webhook", endpoint: agentConfigs.video.endpoint, apiKey: agentConfigs.video.apiKey, model: agentConfigs.video.model, ...learnedPayload }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { videoUrl?: string; dataUrl?: string };
      const remoteUrl = data.videoUrl || data.dataUrl || "";
      if (!remoteUrl) throw new Error("Agnes did not return a playable video URL");
      const mediaResponse = await fetch(remoteUrl);
      if (!mediaResponse.ok) throw new Error("Agnes generated the video, but the download failed");
      const blob = await mediaResponse.blob();
      if (!blob.type.startsWith("video/")) throw new Error("Agnes returned a non-video file");
      return { url: URL.createObjectURL(blob), blob, remoteUrl: data.videoUrl || "" };
    }
    const response = await callAgentWebhook(role, learnedPayload);
    let blob: Blob;
    let remoteUrl = "";
    if ((response.headers.get("content-type") || "").startsWith(role === "image" ? "image/" : role === "video" ? "video/" : "audio/")) {
      blob = await response.blob();
    } else {
      const data = await response.json() as { url?: string; dataUrl?: string };
      remoteUrl = data.url || data.dataUrl || "";
      if (!remoteUrl) throw new Error(`${agentName(role)}没有返回媒体地址`);
      const mediaResponse = await fetch(remoteUrl, { headers: agentConfigs[role].apiKey ? { Authorization: `Bearer ${agentConfigs[role].apiKey}` } : {} });
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

  async function pollinationsText(role: "director" | "writer" | "prompt" | "editor", system: string, user: string) {
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
    const minimumCount = sceneCountForDuration(productionDuration);
    const maximumCount = productionDuration <= 15 ? 1 : Math.min(16, minimumCount + 3);
    const config = agentConfigs.writer;
    const storyboardStory = compactStoryboardContext(story.trim());
    const sourceText = scriptImported ? `这是用户已经完成并锁定的剧本。不得改写剧情、人物关系或结局，只把原剧本结构化拆成分镜：\n${storyboardStory}` : storyboardStory;
    setStatusText(`${agentName("writer")}正在生成分镜 · 本次上下文 ${Math.ceil(storyboardStory.length / 1000)}K 字符`);
    if (config.adapter === "horde") {
      const task = await startHorde("story", { story: `${sourceText}\n\n${productionDuration <= 15 ? `目标只有 ${productionDuration} 秒，必须设计为一个连续完整镜头，不得拆镜。` : `请分析剧情节拍、场景变化、视角变化和动作复杂度，自主决定 ${minimumCount}–${maximumCount} 个镜头，并为每镜独立决定不同或相同的合理时长；不得机械平均。`} 每镜最多15秒，总时长必须等于目标时长。`, style, count: maximumCount, role: "writer", model: config.model });
      const result = await pollHorde("text", task.id, run, {
        maxAttempts: 30,
        timeoutMessage: "免费分镜模型排队超过 90 秒，请稍后重试或切换更快的编剧模型",
        onPending: (attempt) => {
          setProgress(Math.min(10, 4 + Math.ceil(attempt / 5)));
          setStatusText(`免费分镜 AI 正在排队 · 已等待 ${attempt * 3} 秒 / 最长 90 秒 · 上下文 ${Math.ceil(storyboardStory.length / 1000)}K 字符`);
        },
      });
      return String(result.text || "");
    }
    const system = `你是专业 AI 漫剧编剧和分镜师。${scriptImported ? "用户提供的是已经定稿的完整剧本，严禁改写剧情、角色关系、台词含义和结局，只做结构化拆镜。" : "把故事改编为可拍摄短剧。"}${productionDuration <= 15 ? `目标时长为 ${productionDuration} 秒，必须设计为一个连续完整镜头，禁止拆成多个镜头。` : `先分析剧情 Beat、场景/时空变化、视角变化、动作复杂度和情绪节奏，自主决定 ${minimumCount}–${maximumCount} 个镜头。每个镜头的时长由叙事需要独立决定，可以相同也可以不同，禁止机械平均；重要动作和情绪可更长，转场与反应可更短。`}每镜不得超过15秒，总时长必须精确等于目标时长。先为全剧建立场景身份：同一地点、时间、天气和布景必须复用同一个 environmentKey，并写出 environmentBible，固定空间布局、门窗方向、道具位置、主色调与光线方向。每镜必须写 continuity 说明如何承接上一镜，并用 endState 记录镜头结束时人物位置、朝向、手持道具和动作姿态；正式换景时明确说明。只返回 JSON，所有内容使用简体中文。结构：{"title":"标题","music":"无歌词配乐描述","shotPlan":{"count":镜头数,"reason":"拆镜或不拆镜的简短理由"},"characters":[{"name":"角色名","role":"身份","appearance":"固定五官、发型、服装、年龄和气质","voice":"nova|coral|onyx|echo"}],"scenes":[{"title":"镜头标题","environmentKey":"场景身份","environmentBible":"固定背景和空间规则","continuity":"与上一镜的关系或换景说明","endState":"镜头结束状态","characters":["角色名"],"shot":"景别","visual":"场景、构图、灯光与生图提示词","action":"人物连续动作、表情、互动与视频提示词","camera":"运镜","speaker":"说话角色","emotion":"台词情绪","dialogue":"自然简短台词","sfx":"环境音或动作音","duration":6}]}。角色外观与场景背景跨镜头必须一致；每镜都要推动剧情。`;
    const user = `视觉风格：${style}\n目标时长：${productionDuration} 秒\n资产规划要求：每个镜头的 visual 必须使用 [场景:场景身份] 标记固定场景，并用 [道具:道具1,道具2] 标记真正推动剧情或跨镜重复出现的重要道具；普通桌椅和无关装饰不要列为重要道具。分镜图必须组合已有的人物身份、当前造型、场景和道具资产，不得脱离资产重新设计。\n${scriptImported ? "用户定稿剧本" : "故事"}：${storyboardStory}`;
    const storyboardTask = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
      ? customApiText("writer", { task: "storyboard", system, prompt: user, minimumCount, maximumCount, duration: productionDuration })
      : pollinationsText("writer", system, user);
    const storyboardTimeoutMs = Math.min(600000, 180000 + Math.ceil(productionDuration / 30) * 60000);
    return withStageProgress(storyboardTask, storyboardTimeoutMs, `分镜模型连续 ${Math.round(storyboardTimeoutMs / 1000)} 秒没有返回，请检查接口状态或切换模型后重试`, (elapsed) => {
      setProgress(Math.min(12, 5 + Math.floor(elapsed / 45)));
      setStatusText(`${agentName("writer")}仍在生成完整分镜 · 已等待 ${elapsed} 秒${elapsed >= 120 ? " · 漫镜继续等待原请求，不会重复提交" : ""} · 上下文 ${Math.ceil(storyboardStory.length / 1000)}K 字符`);
    });
  }

  async function directorReview(draft: string, run: number) {
    const config = agentConfigs.director;
    const minimumCount = sceneCountForDuration(productionDuration);
    const maximumCount = productionDuration <= 15 ? 1 : Math.min(16, minimumCount + 3);
    setStatusText(`${agentName("director")}正在审查人物一致性、节奏和结尾钩子`);
    if (config.adapter === "horde") {
      const task = await startHorde("director", { story: story.trim(), style, draft, count: maximumCount, minCount: minimumCount, model: config.model });
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
    const system = `你是 AI 漫剧总导演。审查编剧交付的 JSON 分镜。${productionDuration <= 15 ? `目标时长为 ${productionDuration} 秒，最终必须只有一个连续完整镜头，发现拆镜必须合并。` : `根据剧情 Beat、场景变化、视角必要性、动作复杂度和情绪节奏，独立决定 ${minimumCount}–${maximumCount} 镜，并逐镜决定时长；可以相同也可以不同，但禁止机械平均。`}单镜不得超过15秒，总时长必须精确等于目标时长。检查每个 environmentKey 的 environmentBible 是否稳定，逐镜校验人物站位、朝向、视线、手持道具、动作方向、背景布局和光线连续性；判断 continuity 是连续动作、同场景换机位、反打还是正式换景，并保证上一镜 endState 能被下一镜自然承接。更新 shotPlan 后只返回完整 JSON，不要解释。`;
    const user = `原故事：${compactStoryboardContext(story.trim())}\n视觉风格：${style}\n编剧初稿：${draft}`;
    const reviewTask = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
      ? customApiText("director", { task: "review_storyboard", system, prompt: user, draft })
      : pollinationsText("director", system, user);
    return withStageProgress(reviewTask, 420000, "导演复核连续 420 秒没有返回，请检查导演模型接口", (elapsed) => {
      setStatusText(`${agentName("director")}正在复核分镜 · 已等待 ${elapsed} 秒 · 不会重复提交`);
    });
  }

  async function seedanceRequest(path: string, init: RequestInit, label: string, maxAttempts = 3) {
    let lastResponse: Response | null = null;
    const isCreateRequest = typeof init.body === "string" && /"action"\s*:\s*"create"/.test(init.body);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = path.includes("?url=") ? 380000 : isCreateRequest ? 205000 : 160000;
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const requestPaths = path.startsWith("/api/seedance")
          ? [path.replace("/api/seedance", "/api/desktop/seedance"), path]
          : [path];
        let response: Response | null = null;
        let desktopFailure: unknown = null;
        for (let pathIndex = 0; pathIndex < requestPaths.length; pathIndex += 1) {
          try {
            const candidate = await fetch(requestPaths[pathIndex], { ...init, cache: "no-store", signal: controller.signal });
            if (pathIndex === 0 && requestPaths.length > 1 && candidate.status === 404) continue;
            response = candidate;
            break;
          } catch (reason) {
            desktopFailure = reason;
            if (isCreateRequest) throw reason;
            if (pathIndex === requestPaths.length - 1) throw reason;
          }
        }
        if (!response) throw desktopFailure || new Error("内置 Seedance 通道没有返回响应");
        lastResponse = response;
        const transient = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const retryInfo = transient ? await response.clone().json().catch(() => null) as { done?: boolean; retryable?: boolean } | null : null;
        const shouldStop = Boolean(retryInfo?.done) || retryInfo?.retryable === false;
        if (!transient || shouldStop || attempt === maxAttempts - 1) return response;
        setStatusText(`${label}遇到网络波动，正在自动重连 ${attempt + 1}/${maxAttempts - 1}`);
      } catch (reason) {
        if (attempt === maxAttempts - 1) {
          const detail = reason instanceof DOMException && reason.name === "AbortError" ? `连接等待超过 ${Math.round(timeoutMs / 1000)} 秒` : "桌面端与内置 Seedance 通道的连接被中断";
          throw new Error(`${label}失败：${detail}。无需安装火山引擎 SDK；请检查网络或代理后再次点击“重新运行视频 AI”`);
        }
        setStatusText(`${label}连接中断，正在自动重连 ${attempt + 1}/${maxAttempts - 1}`);
      } finally {
        window.clearTimeout(timeout);
      }
      await wait(900 * (attempt + 1));
    }
    if (lastResponse) return lastResponse;
    throw new Error(`${label}失败：没有收到接口响应`);
  }

  async function extractVideoContinuityFrames(videoUrl: string, scene: Scene) {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`视频关键帧读取失败（${response.status}）`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = objectUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("视频关键帧解码失败"));
      });
      const duration = Number.isFinite(video.duration) ? video.duration : Math.max(1, scene.duration);
      const capture = async (time: number) => {
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error("视频关键帧定位失败"));
          video.currentTime = Math.max(0, Math.min(Math.max(0, duration - 0.05), time));
        });
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("视频关键帧画布不可用");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.9);
      };
      const middle = await capture(duration * 0.5);
      const end = await capture(Math.max(0, duration - 0.12));
      autoArchive(middle, `${projectTitle}-${scene.title}-视频关键帧`, "scene", 0, ["自动生成", "视频关键帧", scene.id, `asset:video-keyframe:${scene.id}:middle`]);
      autoArchive(end, `${projectTitle}-${scene.title}-镜尾连续帧`, "scene", 0, ["自动生成", "镜尾连续帧", scene.id, `asset:video-keyframe:${scene.id}:end`]);
      return { middle, end };
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function compileShotMotionPrompt(scene: Scene, sceneIndex: number, previousScene?: Scene) {
    const cast = characters.filter((character) => isVisualCharacterAsset(character) && scene.characters.includes(character.name));
    const props = labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具");
    const assetBindings = {
      characters: cast.map((character) => ({ name: character.name, assetId: character.arkAssetId || character.id, appearance: character.appearance })),
      scene: { id: scene.environmentKey || scene.title, bible: scene.environmentBible || scene.visual },
      props,
      startFrame: scene.remoteImageUrl || scene.imageUrl || "",
      previousEndFrame: previousScene?.remoteImageUrl || previousScene?.imageUrl || "",
    };
    const deterministic = `${motionVisualPrompt(style)}, preserve the exact character identities, facial geometry, facial landmarks, hair, body proportions and current costumes from the bound canonical assets. Environment ${scene.environmentKey || "current scene"}: ${scene.environmentBible || scene.visual}. Start state: ${scene.startState || previousScene?.endState || "establish the initial state from the canonical assets"}. ${previousScene ? `Continue exactly from the previous shot end frame and end state: ${previousScene.endState || previousScene.action}. Preserve every character's normalized screen position (left/center/right), depth layer (foreground/midground/background), facing direction, pose, hand occupancy and prop position unless the action explicitly changes it.` : "This is the opening shot."} Current action: ${scene.action}. Camera movement: ${scene.camera}. Important props that must remain visually identical and correctly placed: ${props.join(", ") || "none"}. End state: ${scene.endState || "finish in a stable state that the next shot can inherit"}. ${scene.speaker ? `${scene.speaker} performs with ${scene.emotion} emotion and natural mouth movement.` : "Natural performance and physically coherent motion."} Preserve architecture, prop positions, person count, weather, time, palette and light direction. Keep the canonical face stable in frontal, profile and moving views. One continuous cinematic shot, no unintended cuts, no subtitles, no duplicated people, no identity swap, no face morphing, no facial asymmetry, no deformed eyes or mouth, no extra fingers or limbs, no prop replacement, no sudden position jump.`;
    const config = agentConfigs.prompt;
    if (config.adapter === "browser") {
      recordActivity("prompt", `镜头 ${sceneIndex + 1} 已由本地镜头总控完成资产绑定与提示词编译`, "done");
      return deterministic;
    }
    const learned = agentContext("prompt").slice(0, 8);
    const system = `你是漫镜的镜头总控 Agent，位于导演与视频 Agent 之间。你不改写剧情，只负责绑定 Canonical 资产、继承 Start/End State、整合表演与运镜，并针对目标视频模型编译最终提示词。只返回 JSON：{"prompt":"最终视频提示词","negativePrompt":"必须避免的问题","assetBindings":["实际使用的资产ID"],"continuityCheck":"状态继承检查"}。提示词必须是一个连续镜头，禁止虚构未提供的资产。${learned.length ? `\n已启用技能：\n${learned.map((item) => `- ${item.title}：${item.content.slice(0, 900)}`).join("\n")}` : ""}`;
    const user = JSON.stringify({ targetAdapter: agentConfigs.video.adapter, targetModel: agentConfigs.video.model, duration: scene.duration, aspect, shot: { title: scene.title, visual: scene.visual, action: scene.action, camera: scene.camera, continuity: scene.continuity, startState: scene.startState || previousScene?.endState, endState: scene.endState, speaker: scene.speaker, emotion: scene.emotion }, assetBindings, deterministicFallback: deterministic });
    try {
      setStatusText(`${agentName("prompt")}正在为镜头 ${sceneIndex + 1} 绑定资产并编译最终提示词`);
      const raw = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
        ? await withStageTimeout(customApiText("prompt", { task: "compile_video_prompt", system, prompt: user, shot: scene, assets: assetBindings }), 60000, "镜头总控等待超过 60 秒")
        : await withStageTimeout(pollinationsText("prompt", system, user), 60000, "镜头总控等待超过 60 秒");
      const jsonText = raw.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*\}/)?.[0] || raw;
      const parsed = JSON.parse(jsonText) as { prompt?: string; negativePrompt?: string };
      const compiled = String(parsed.prompt || "").trim();
      if (!compiled) throw new Error("镜头总控没有返回最终提示词");
      markContextUsed(learned.map((item) => item.id));
      recordActivity("prompt", `镜头 ${sceneIndex + 1} 的资产、状态和运镜提示词已编译`, "done");
      return `${compiled}${parsed.negativePrompt ? ` Avoid: ${parsed.negativePrompt}` : ""}`;
    } catch (reason) {
      recordActivity("prompt", `镜头总控接口未完成，已安全降级到本地提示词编译：${reason instanceof Error ? reason.message : "未知错误"}`, "warning");
      return deterministic;
    }
  }

  async function videoReferences(scene: Scene, previousScene?: Scene) {
    const cast = characters.filter((character) => isVisualCharacterAsset(character) && scene.characters.includes(character.name));
    const previousTail = [previousScene?.remoteImageUrl, previousScene?.imageUrl].filter((value): value is string => Boolean(value));
    const currentAnchors = [scene.remoteImageUrl, scene.imageUrl, ...cast.flatMap((character) => [character.remoteUrl, character.imageUrl])].filter((value): value is string => Boolean(value));
    const trustedPortraits = agentConfigs.video.adapter === "seedance" ? cast
      .filter((character) => character.arkAssetId && character.portraitAuthorizationStatus === "authorized")
      .map((character) => `asset://${String(character.arkAssetId).replace(/^asset:\/\//i, "")}`) : [];
    const trustedVoices: string[] = [];
    const entityReferences: string[] = [];
    try {
      const library = await listLibraryAssets();
      const propNames = labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具");
      const environmentIdentity = (scene.environmentKey || scene.title).toLocaleLowerCase("zh-CN");
      const candidates = library.filter((asset) => {
        if (asset.mediaType !== "image" || asset.reusable === false) return false;
        const searchable = `${asset.name} ${asset.identityKey || ""} ${asset.lookName || ""} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN");
        if (asset.category === "character") return cast.some((character) => searchable.includes(character.name.toLocaleLowerCase("zh-CN")));
        if (asset.category === "scene") return Boolean(environmentIdentity && searchable.includes(environmentIdentity));
        if (asset.category === "prop") return propNames.some((name) => searchable.includes(name.toLocaleLowerCase("zh-CN")));
        return false;
      }).sort((a, b) => Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 6);
      const loadedEntities = await loadLibraryAssets(candidates.map((asset) => asset.id));
      for (const entity of loadedEntities) {
        if (!entity.url) continue;
        const response = await fetch(entity.url);
        if (!response.ok) continue;
        const dataUrl = await blobToDataUrl(await response.blob());
        if (dataUrl.startsWith("data:image/")) entityReferences.push(dataUrl);
      }
      await Promise.all(candidates.map((asset) => markLibraryAssetUsed(asset.id)));
      const voiceAssets = library.filter((asset) => asset.category === "audio" && asset.reusable !== false && scene.characters.some((name) => `${asset.identityKey || ""} ${asset.name} ${asset.tags.join(" ")}`.includes(name))).slice(0, 3);
      const loadedVoices = await loadLibraryAssets(voiceAssets.map((asset) => asset.id));
      for (const voice of loadedVoices) {
        if (!voice.url) continue;
        const response = await fetch(voice.url);
        if (!response.ok) continue;
        const dataUrl = await blobToDataUrl(await response.blob());
        if (dataUrl.startsWith("data:audio/")) trustedVoices.push(dataUrl);
      }
      await Promise.all(voiceAssets.map((asset) => markLibraryAssetUsed(asset.id)));
    } catch { /* voice reference is optional */ }
    const orderedReferences = [...previousTail, ...trustedPortraits, ...currentAnchors, ...entityReferences, ...trustedVoices];
    if (!scene.imageUrl) return [...new Set(orderedReferences)].slice(0, 10);
    try {
      const response = await fetch(scene.imageUrl);
      if (!response.ok) return [...new Set(orderedReferences)].slice(0, 10);
      const normalized = await normalizeImageBlobForAspect(await response.blob(), aspect);
      const dataUrl = await blobToDataUrl(normalized);
      return [...new Set(dataUrl.startsWith("data:image/") ? [...orderedReferences, dataUrl] : orderedReferences)].slice(0, 10);
    } catch {
      return [...new Set(orderedReferences)].slice(0, 10);
    }
  }

  function seedancePendingTasks() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SEEDANCE_PENDING_KEY) || "{}") as Record<string, SeedancePendingTask>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveSeedancePendingTask(key: string, task?: SeedancePendingTask) {
    const tasks = seedancePendingTasks();
    if (task) tasks[key] = task;
    else delete tasks[key];
    window.localStorage.setItem(SEEDANCE_PENDING_KEY, JSON.stringify(tasks));
  }

  async function seedanceVideo(prompt: string, options: { references?: string[]; duration?: number; resumeKey?: string } = {}) {
    const config = agentConfigs.video;
    if (config.apiKey.trim().length < 8) throw new Error("即梦 Seedance 需要火山方舟 API Key");
    const resumeKey = options.resumeKey || `${config.model}:${prompt.slice(0, 120)}`;
    const pending = seedancePendingTasks()[resumeKey];
    const canResume = Boolean(pending?.id && pending.model === config.model && Date.now() - pending.createdAt < 6 * 24 * 60 * 60 * 1000);
    let taskId = canResume ? pending.id : "";
    if (taskId) {
      setStatusText(`正在恢复上次中断的 Seedance 任务 ${taskId.slice(-8)}`);
      recordActivity("video", `已找到未完成任务 ${taskId.slice(-8)}，继续查询，不重复创建和扣费`, "warning");
    } else {
      const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : uid();
      window.localStorage.setItem("manjing-seedance-last-request-v146", JSON.stringify({ requestId, model: config.model, scene: options.resumeKey || "", createdAt: Date.now(), status: "submitting" }));
      const created = await seedanceRequest("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          requestId,
          apiKey: config.apiKey.trim(),
          model: config.model,
          resolution: videoResolution,
          prompt,
          ratio: aspect,
          duration: options.duration,
          imageUrl: options.references?.find((url) => !url.startsWith("asset://") && !url.startsWith("data:audio/")) || "",
          references: (options.references || []).map((url) => { const audio = url.startsWith("data:audio/"); return { kind: audio ? "audio" : "image", role: audio ? "reference_audio" : "reference_image", url, name: audio ? "角色固定声音" : url.startsWith("asset://") ? "方舟可信人像" : "镜头参考图" }; }),
          voiceover: { enabled: voiceEnabled, backgroundMusic: bgmEnabled, audioEnabled: true, language: "普通话", style: "保持角色声音身份、音色、年龄感、语速和情绪连续一致" },
        }),
      }, "创建 Seedance 视频任务", 1);
      if (!created.ok) throw new Error(await responseError(created));
      const task = await created.json() as { id?: string; requestId?: string };
      if (!task.id) throw new Error("即梦 Seedance 没有返回任务编号");
      taskId = task.id;
      window.localStorage.setItem("manjing-seedance-last-request-v146", JSON.stringify({ requestId: task.requestId || requestId, taskId, model: config.model, scene: options.resumeKey || "", createdAt: Date.now(), status: "created" }));
      saveSeedancePendingTask(resumeKey, { id: taskId, model: config.model, createdAt: Date.now() });
    }
    const activeRun = runRef.current;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (runRef.current !== activeRun) throw new Error("任务已取消");
      await wait(attempt === 0 ? 2500 : 6000);
      const checked = await seedanceRequest("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", apiKey: config.apiKey.trim(), id: taskId }),
      }, "查询 Seedance 任务");
      if (!checked.ok) {
        const data = await checked.clone().json().catch(() => null) as { done?: boolean } | null;
        if (checked.status === 400 || checked.status === 404 || data?.done) saveSeedancePendingTask(resumeKey);
        throw new Error(await responseError(checked));
      }
      const status = await checked.json() as { done?: boolean; status?: string; videoUrl?: string };
      setStatusText(`即梦 Seedance 正在生成动态镜头（${status.status === "running" ? "生成中" : "排队中"}）`);
      if (!status.done && !status.videoUrl) continue;
      if (!status.videoUrl) throw new Error("即梦 Seedance 任务完成但没有返回视频");
      const media = await seedanceRequest(`/api/seedance?url=${encodeURIComponent(status.videoUrl)}`, { method: "GET" }, "下载 Seedance 视频");
      if (!media.ok) throw new Error(await responseError(media));
      let blob: Blob;
      try {
        blob = await media.blob();
      } catch {
        throw new Error("Seedance 视频已生成，但下载内容在写入漫镜时中断；任务编号仍已保留，请重新运行视频 AI 继续下载");
      }
      if (!blob.type.startsWith("video/")) throw new Error("即梦 Seedance 返回的文件不是视频");
      saveSeedancePendingTask(resumeKey);
      return { url: URL.createObjectURL(blob), blob, remoteUrl: status.videoUrl };
    }
    throw new Error("即梦 Seedance 仍在生成；任务编号已经保存，再次点击“重新运行视频 AI”会继续查询，不会重复创建任务");
  }

  async function pollinationsMedia(
    kind: "image" | "audio" | "video",
    prompt: string,
    index = 0,
    options: { references?: string[]; voiceName?: string; duration?: number; music?: boolean; resumeKey?: string; imageAspect?: "9:16" | "16:9" } = {},
  ) {
    const role: "image" | "video" | "voice" = kind === "image" ? "image" : kind === "video" ? "video" : "voice";
    const config = agentConfigs[role];
    const mediaAspect = kind === "image" ? options.imageAspect || aspect : aspect;
    if (config.adapter === "openai") {
      if (kind !== "image") throw new Error("OpenAI 兼容图片接口只能用于生图岗位");
      if (!validAgentEndpoint(config.endpoint)) throw new Error("生图 AI 需要填写 OpenAI 兼容 API 地址");
      const response = await fetch("/api/desktop/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "openai", endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, prompt, aspect: mediaAspect }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { dataUrl?: string };
      if (!data.dataUrl?.startsWith("data:image/")) throw new Error("OpenAI 兼容生图接口没有返回图片");
      const blob = await normalizeImageBlobForAspect(await (await fetch(data.dataUrl)).blob(), mediaAspect);
      return { url: URL.createObjectURL(blob), blob };
    }
    if (config.adapter === "seedance") {
      if (kind !== "video") throw new Error("即梦 Seedance 只能用于视频岗位");
      return seedanceVideo(prompt, options);
    }
    if (config.adapter === "webhook") {
      const media = await webhookMedia(role, { task: kind, prompt, index, aspect: mediaAspect, resolution: kind === "video" ? videoResolution : undefined, ...options });
      if (kind !== "image") return media;
      const blob = await normalizeImageBlobForAspect(media.blob, mediaAspect);
      return { url: URL.createObjectURL(blob), blob, remoteUrl: "" };
    }
    if (config.adapter !== "pollinations") throw new Error(`${agentName(role)}不支持当前云端媒体任务`);
    const key = agentKey(role);
    if (!key.startsWith("pk_")) throw new Error(`${agentName(role)}需要 Pollinations 发布密钥`);
    const base = "https://gen.pollinations.ai";
    let url = "";
    if (kind === "image") {
      const params = new URLSearchParams({
        model: options.references?.length ? config.model || "kontext" : config.model === "kontext" ? "zimage" : config.model || "zimage",
        width: mediaAspect === "9:16" ? "720" : "1280",
        height: mediaAspect === "9:16" ? "1280" : "720",
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
    const receivedBlob = await response.blob();
    const expected = kind === "image" ? "image/" : kind === "audio" ? "audio/" : "video/";
    if (!receivedBlob.type.startsWith(expected)) throw new Error(`${kind === "image" ? "图片" : kind === "audio" ? "配音" : "视频"}服务返回了无效文件`);
    const blob = kind === "image" ? await normalizeImageBlobForAspect(receivedBlob, mediaAspect) : receivedBlob;
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

  async function makeImage(scene: Scene, index: number, run: number, characterGuide = "", outputAspect: "9:16" | "16:9" = aspect, promptOverride = "") {
    const prompt = promptOverride || `${frameVisualPrompt(style)}, one coherent scene rather than a comic page, ${scene.shot}, ${scene.visual}, ${scene.action}, ${characterGuide}, preserve the exact same faces, hair and costumes across every shot, correct anatomy and natural hands, layered foreground middle ground and background for camera motion, no typography, no speech bubbles, no panel borders`;
    if (["openai", "pollinations", "webhook"].includes(agentConfigs.image.adapter)) return (await pollinationsMedia("image", prompt, index, { imageAspect: outputAspect })).url;
    const task = await startHorde("image", { prompt, aspect: outputAspect, model: agentConfigs.image.model });
    const result = await pollHorde("image", task.id, run);
    const remote = String(result.imageUrl || "");
    const response = await fetch(`/api/media?url=${encodeURIComponent(remote)}`);
    if (!response.ok) throw new Error(await responseError(response));
    return URL.createObjectURL(await normalizeImageBlobForAspect(await response.blob(), outputAspect));
  }

  async function consistencyImage(url: string, label: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return null;
      return { url: await blobToDataUrl(blob), label };
    } catch { return null; }
  }

  async function reusableSceneResult(scene: Scene) {
    const identity = shotReuseIdentity(scene);
    const runtime = runtimeShotReuseRef.current.get(identity);
    if (runtime) return { url: runtime, id: "runtime" };
    const title = scene.title.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").trim();
    const candidates = (await listLibraryAssets()).filter((asset) => asset.category === "scene" && asset.mediaType === "image" && asset.reusable !== false && (asset.identityKey === identity || asset.tags.includes(`asset:${identity}`) || (asset.tags.includes("分镜") && title.length > 1 && asset.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").includes(title)))).sort((a, b) => Number(Boolean(b.canonical || b.locked)) - Number(Boolean(a.canonical || a.locked)) || b.createdAt.localeCompare(a.createdAt));
    const match = candidates[0];
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    runtimeShotReuseRef.current.set(identity, loaded.url);
    await markLibraryAssetUsed(match.id);
    return { url: loaded.url, id: match.id };
  }

  async function reusableVoiceResult(scene: Scene, voiceName: string) {
    const identity = voiceReuseIdentity(scene, voiceName);
    const runtime = runtimeVoiceReuseRef.current.get(identity);
    if (runtime) return runtime;
    const match = (await listLibraryAssets()).filter((asset) => asset.category === "audio" && asset.mediaType === "audio" && asset.reusable !== false && asset.identityKey === identity).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    const result = { url: loaded.url, duration: match.duration || scene.duration };
    runtimeVoiceReuseRef.current.set(identity, result);
    await markLibraryAssetUsed(match.id);
    return result;
  }

  async function evaluateShotConsistency(scene: Scene, imageUrl: string, castForScene: CharacterAsset[], previousScene: Scene | undefined, attempts: number): Promise<ConsistencyReport> {
    const stateInherited = !previousScene || scene.startState === previousScene.endState;
    const structuralScores: ConsistencyScores = { characterIdentity: null, costume: null, scene: scene.environmentKey && scene.environmentBible ? 96 : 82, props: null, spatialContinuity: previousScene ? (scene.continuity ? 92 : 76) : 100, shotContinuity: stateInherited ? 98 : 70, lighting: null };
    const structuralValues = Object.values(structuralScores).filter((value): value is number => typeof value === "number");
    const structuralOverall = Math.round(structuralValues.reduce((sum, value) => sum + value, 0) / Math.max(1, structuralValues.length));
    const fallback: ConsistencyReport = { scores: structuralScores, overall: structuralOverall, decision: structuralOverall >= 90 ? "pass" : structuralOverall >= 85 ? "review" : "reject", mode: "structural", findings: ["当前导演模型未执行视觉审核；人物身份、服装、道具和光线项目不计入总分。", ...(stateInherited ? [] : ["当前镜头 Start State 未完整继承上一镜 End State。"]), ...(!scene.environmentKey || !scene.environmentBible ? ["场景身份或场景圣经不完整。"] : [])], checkedAt: new Date().toISOString(), attempts };
    const config = agentConfigs.director;
    if (!['openai', 'pollinations'].includes(config.adapter)) return fallback;
    const current = await consistencyImage(imageUrl, "当前生成分镜");
    if (!current) return fallback;
    const references = (await Promise.all([...castForScene.slice(0, 4).map((character) => consistencyImage(character.imageUrl || "", `Canonical角色：${character.name}`)), previousScene?.imageUrl ? consistencyImage(previousScene.imageUrl, "上一镜结束画面") : Promise.resolve(null)])).filter(Boolean) as Array<{ url: string; label: string }>;
    try {
      const system = "你是影视连续性审核引擎。必须真实比较所给图片，不得因为提示词声称一致就直接给高分。只返回JSON。每项0-100；看不到、被遮挡、画外或没有依据的项必须返回null且不得写成缺陷。只审核本镜头景别和构图中实际可见、且剧本明确要求出现的内容，禁止要求一个近景同时展示完整房间、下装或所有场景锚点。旁白、广告声等无实体角色不审核人物和服装。新增耳饰、纹身、眼镜等标准图没有的身份特征属于真实偏差。";
      const prompt = `审核当前生成分镜与角色标准图、上一镜画面是否一致。镜头标题：${scene.title}。景别/机位：${scene.camera}。预期人物：${castForScene.map((item) => `${item.name}(${item.appearance})`).join("；") || "无实体人物"}。预期场景：${scene.environmentKey || scene.title}；${scene.environmentBible || scene.visual}。重要道具：${labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").join("、") || "无明确重要道具"}。Start State：${scene.startState || "首镜"}。动作：${scene.action}。先判断每项是否应在当前景别中可见，再检查人物身份、服装、场景、道具、空间关系、镜头承接和光线。未入镜的房门、床、窗户、下装或被遮挡的五官不得扣分；只有本镜头明确要求出现却缺失，或实际出现但与 Canonical 标准冲突时才扣分。返回：{"scores":{"characterIdentity":0,"costume":0,"scene":0,"props":0,"spatialContinuity":0,"shotContinuity":0,"lighting":0},"findings":["只写可见且可修复的具体偏差"]}`;
      const response = await fetch("/api/desktop/invoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: config.adapter, endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, role: "director", task: "consistency_check", system, prompt, images: [current, ...references] }) });
      if (!response.ok) return { ...fallback, findings: [...fallback.findings, `视觉审核接口不可用（${response.status}），已降级为结构检查。`] };
      const data = await response.json() as { text?: string };
      const clean = String(data.text || "").replace(/```json/gi, "").replace(/```/g, "");
      const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)) as { scores?: Partial<Record<keyof ConsistencyScores, number | null>>; findings?: string[] };
      const score = (key: keyof ConsistencyScores) => typeof parsed.scores?.[key] === "number" ? Math.max(0, Math.min(100, Math.round(parsed.scores[key] as number))) : null;
      const scores: ConsistencyScores = { characterIdentity: score("characterIdentity"), costume: score("costume"), scene: score("scene"), props: score("props"), spatialContinuity: score("spatialContinuity"), shotContinuity: score("shotContinuity"), lighting: score("lighting") };
      const values = Object.values(scores).filter((value): value is number => typeof value === "number");
      const overall = Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
      return { scores, overall, decision: overall >= 90 ? "pass" : overall >= 85 ? "review" : "reject", mode: "vision", findings: Array.isArray(parsed.findings) ? parsed.findings.map(String).slice(0, 8) : [], checkedAt: new Date().toISOString(), attempts };
    } catch {
      return { ...fallback, findings: [...fallback.findings, "视觉审核返回格式不可解析，已降级为结构检查。"] };
    }
  }

  async function applyEditorPlan(work: Scene[]) {
    const config = agentConfigs.editor;
    if (config.adapter === "browser") return work;
    setStatusText(`${agentName("editor")}正在分析镜头节奏和剪辑顺序`);
    const compactScenes = work.map((scene) => ({ id: scene.id, title: scene.title, action: scene.action, dialogue: scene.dialogue, duration: scene.duration }));
    const system = "你是短视频剪辑师。根据剧情调整镜头顺序和单镜头时长，只返回 JSON：{\"order\":[\"镜头id\"],\"durations\":{\"镜头id\":6}}。不要删除镜头；每镜 2–15 秒；长内容必须拆成多个分镜；总时长尽量接近目标。";
    const prompt = `目标时长：${productionDuration} 秒\n镜头：${JSON.stringify(compactScenes)}`;
    let raw = "";
    if (CUSTOM_TEXT_ADAPTERS.includes(config.adapter)) raw = await customApiText("editor", { task: "edit_plan", system, prompt, scenes: compactScenes, duration: productionDuration });
    else raw = await pollinationsText("editor", system, prompt);
    try {
      const parsed = JSON.parse(raw.replace(/```json/gi, "").replace(/```/g, "").trim()) as { order?: string[]; durations?: Record<string, number> };
      const byId = new Map(work.map((scene) => [scene.id, scene]));
      const order = Array.isArray(parsed.order) ? parsed.order.filter((id) => byId.has(id)) : [];
      const ordered = order.length === work.length ? order.map((id) => byId.get(id) as Scene) : work;
      return ordered.map((scene) => ({ ...scene, duration: Math.max(2, Math.min(15, Number(parsed.durations?.[scene.id]) || scene.duration)) }));
    } catch {
      return work;
    }
  }

  async function syncScenesToEditor(sourceScenes: Scene[], finalVideoUrl = "", source: "studio" | "libtv" = "studio", openEditor = false) {
    if (editorSyncRef.current) return false;
    if (!sourceScenes.length) {
      setError("还没有可导入剪辑台的镜头");
      return false;
    }
    editorSyncRef.current = true;
    setEditorSyncState("saving");
    setEditorSyncProgress(0);
    let start = 0;
    const clips: EditorProjectClip[] = [];
    for (const scene of sourceScenes) {
      const visualType = scene.videoUrl ? "video" : scene.imageUrl ? "image" : null;
      if (visualType) clips.push({
        id: `${scene.id}-visual`, name: scene.title, type: visualType, url: scene.videoUrl || scene.imageUrl,
        duration: scene.duration, sourceDuration: scene.duration, trimStart: 0, trimEnd: scene.duration, start,
        volume: scene.volume ?? 1, speed: scene.speed || 1, filter: scene.filter || "none", transition: scene.transition || "fade",
      });
      if (scene.audioUrl) clips.push({
        id: `${scene.id}-audio`, name: `${scene.speaker || "旁白"} · ${scene.title}`, type: "audio", url: scene.audioUrl,
        duration: scene.duration, sourceDuration: scene.duration, trimStart: 0, trimEnd: scene.duration, start,
        volume: scene.volume ?? 1, speed: 1, filter: "none", transition: "cut",
      });
      if (subtitleEnabled && scene.dialogue && scene.subtitleEnabled !== false) clips.push({
        id: `${scene.id}-subtitle`, name: `字幕 · ${scene.title}`, type: "text", text: scene.dialogue,
        duration: scene.duration, sourceDuration: scene.duration, trimStart: 0, trimEnd: scene.duration, start,
        volume: 1, speed: 1, filter: "none", transition: "cut",
      });
      start += scene.duration;
    }
    if (musicUrl) clips.push({
      id: "project-music", name: "项目配乐", type: "audio", url: musicUrl,
      duration: start, sourceDuration: start, trimStart: 0, trimEnd: start, start: 0,
      volume: musicVolume, speed: 1, filter: "none", transition: "cut",
    });
    try {
      await persistEditorProject({
        id: editorProjectIdRef.current,
        name: projectTitle || "未命名漫剧",
        aspect,
        source,
        clips,
        finalVideo: finalVideoUrl ? { url: finalVideoUrl } : undefined,
        editorNote: `${agentName("editor")}已完成镜头顺序、节奏、字幕与混音方案，可继续人工精剪。`,
        studioSnapshot: {
          version: 2, projectId: editorProjectIdRef.current, projectTitle, story, style, targetDuration, aspect,
          characters: characters.map(serializableCharacter), scenes: sourceScenes.map(serializableScene), selected,
          phase: finalVideoUrl ? "ready" : phase, progress: finalVideoUrl ? 100 : progress, statusText,
          activityLog: activityLog.slice(0, 120), musicPrompt, updatedAt: new Date().toISOString(),
        },
      }, {
        onProgress: ({ completed, total }) => setEditorSyncProgress(total ? Math.round((completed / total) * 100) : 100),
      });
      const savedProjects = localStorage.getItem("manjing-projects");
      let projects: Array<Record<string, unknown>> = [];
      try { projects = savedProjects ? JSON.parse(savedProjects) as Array<Record<string, unknown>> : []; } catch { projects = []; }
      const projectCard = { id: editorProjectIdRef.current, title: projectTitle || "未命名漫剧", story: story.trim().slice(0, 120), updatedAt: "刚刚", duration: formatTime(sourceScenes.reduce((sum, scene) => sum + scene.duration, 0)), status: finalVideoUrl ? "已完成" : "剪辑中", source, durable: true };
      localStorage.setItem("manjing-projects", JSON.stringify([projectCard, ...projects.filter((item) => item.id !== projectCard.id)].slice(0, 20)));
      setEditorSyncProgress(100);
      setEditorSyncState("ready");
      if (openEditor) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
        router.push("/editor");
      }
      return true;
    } catch (reason) {
      setEditorSyncState("error");
      setError(reason instanceof Error ? `导入剪辑台失败：${reason.message}` : "导入剪辑台失败");
      return false;
    } finally {
      editorSyncRef.current = false;
    }
  }

  async function openInProfessionalEditor() {
    await syncScenesToEditor(scenes, exportUrl, libtvSessionId && scenes.every((scene) => scene.model === "LibTV") ? "libtv" : "studio", true);
  }

  async function generateWithLibTv() {
    if (story.trim().length < 8 || libtvRunning || !["idle", "ready", "error"].includes(phase)) return;
    if (libtvAccessKey.trim().length < 8) {
      setError("请先填写 LibTV Access Key");
      return;
    }
    const run = Date.now();
    runRef.current = run;
    editorProjectIdRef.current = `libtv-${run.toString(36)}`;
    setLibtvRunning(true);
    setLibtvSessionId("");
    setLibtvProjectUrl("");
    setLibtvResults([]);
    setLibtvMessages([]);
    libtvPauseRef.current = false;
    setLibtvPollingPaused(false);
    setError("");
    setShowFilm(false);
    setPlaying(false);
    setTime(0);
    setActivityLog([]);
    setPhase("story");
    setProgress(4);
    setStatusText("LibTV 正在建立完整漫剧项目");
    recordActivity("director", "LibTV 总控开始拆解故事与制作目标");
    recordActivity("writer", "LibTV 编剧开始生成剧本、分镜和提示词");
    const message = [
      "请生成一部完整、真正会动的 AI 漫剧，不要只生成静态漫画。",
      `项目标题：${projectTitle || "漫镜作品"}`,
      `故事：${story.trim()}`,
      `视觉风格：${style}`,
      `画面比例：${aspect}`,
      `目标总时长：${productionDuration} 秒`,
      voiceEnabled
        ? "请完成剧本、固定角色设定、连续分镜、角色一致性图片、人物动态视频、中文配音、字幕、配乐和剪辑成片。人物说话时口型与配音同步。"
        : `不要生成任何人物对白、旁白或人声音轨；输出无配音成片。${bgmEnabled ? "可以保留无歌词背景音乐和环境音。" : "同时不要生成背景音乐。"}`,
      "镜头必须有动作、表情、运镜和连续表演。输出完整视频，并保留可下载的中间图片和视频素材。",
    ].join("\n");
    try {
      const created = await fetch("/api/libtv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", accessKey: libtvAccessKey.trim(), message }),
      });
      if (!created.ok) throw new Error(await responseError(created));
      const task = await created.json() as { sessionId?: string; projectUrl?: string };
      if (!task.sessionId) throw new Error("LibTV 没有返回任务编号");
      setLibtvSessionId(task.sessionId);
      setLibtvProjectUrl(task.projectUrl || "");
      setLibtvCanvasOpen(true);
      setProgress(8);
      recordActivity("director", "LibTV 项目已建立，可随时打开云端画布查看", "done");
      recordActivity("image", "LibTV 正在锁定角色形象并绘制连续关键帧");
      recordActivity("video", "LibTV 已排入动态视频与镜头表演任务");
      recordActivity("voice", voiceEnabled ? "LibTV 将在视频完成后生成配音和声音" : "一键漫剧配音已关闭，LibTV 将跳过人声", voiceEnabled ? "running" : "warning");
      recordActivity("editor", "LibTV 剪辑代理等待上游素材交付");

      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (runRef.current !== run) throw new Error("任务已取消");
        while (libtvPauseRef.current) {
          if (runRef.current !== run) throw new Error("任务已取消");
          await wait(700);
        }
        await wait(attempt === 0 ? 3500 : 10000);
        const checked = await fetch("/api/libtv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", accessKey: libtvAccessKey.trim(), sessionId: task.sessionId }),
        });
        if (!checked.ok) throw new Error(await responseError(checked));
        const status = await checked.json() as { done?: boolean; failed?: boolean; summary?: string; messageCount?: number; results?: LibTvResult[]; events?: LibTvMessage[] };
        if (status.failed && !(status.results || []).length) throw new Error(status.summary || "LibTV 生成失败，请在项目画布中查看原因");
        const results = status.results || [];
        setLibtvResults(results);
        setLibtvMessages(status.events || []);
        const hasImages = results.some((item) => item.kind === "image");
        setPhase(hasImages ? "video" : attempt > 2 ? "characters" : "story");
        setProgress(Math.min(94, 8 + Math.min(28, Number(status.messageCount || 0) * 2) + Math.round((attempt / 180) * 56)));
        setStatusText(status.summary || (hasImages ? "LibTV 已生成分镜素材，正在制作动态视频" : "LibTV 正在编写剧本并建立角色"));
        if (!status.done) continue;

        const videos = results.filter((item) => item.kind === "video");
        const images = results.filter((item) => item.kind === "image");
        const imported: Scene[] = videos.map((item, index) => ({
          id: uid(),
          title: `LibTV 成片 ${index + 1}`,
          visual: "LibTV 完整 AI 漫剧输出",
          action: voiceEnabled ? "已由 LibTV 完成动态表演、配音与剪辑" : "已由 LibTV 完成无配音动态表演与剪辑",
          shot: "成片",
          camera: "LibTV 自动导演",
          dialogue: "",
          speaker: "",
          emotion: "",
          sfx: "",
          characters: [],
          duration: Math.max(4, Math.round(productionDuration / Math.max(1, videos.length))),
          imageUrl: images[index]?.url ? `/api/libtv?url=${encodeURIComponent(images[index].url)}` : undefined,
          videoUrl: `/api/libtv?url=${encodeURIComponent(item.url)}`,
          status: "ready",
          model: "LibTV",
        }));
        setScenes(imported);
        setCharacters([]);
        setSelected(0);
        if (imported[0]?.videoUrl) {
          setExportUrl(imported[0].videoUrl);
          setShowFilm(true);
        }
        setPhase("ready");
        setProgress(100);
        setStatusText("LibTV 完整 AI 漫剧已生成，并已导入剪辑台");
        recordActivity("writer", "剧本与分镜已交付", "done");
        recordActivity("image", `${images.length} 项角色与分镜素材已交付`, "done");
        recordActivity("video", `${videos.length} 项动态视频已交付`, "done");
        recordActivity("voice", voiceEnabled ? "配音与声音已写入 LibTV 成片" : "已按设置跳过人声配音", "done");
        recordActivity("editor", "最终成片已导入漫镜剪辑台", "done");
        await syncScenesToEditor(imported, imported[0]?.videoUrl || "", "libtv");
        return;
      }
      throw new Error("LibTV 仍在制作中，请通过项目画布继续查看；任务不会丢失");
    } catch (reason) {
      if (runRef.current !== run) return;
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "LibTV 生成失败，请重试");
      setStatusText("LibTV 制作中断");
      recordActivity("director", reason instanceof Error ? `LibTV 中断：${reason.message}` : "LibTV 制作中断", "error");
    } finally {
      setLibtvRunning(false);
    }
  }

  async function refreshLibTvCanvas() {
    if (!libtvSessionId || libtvAccessKey.trim().length < 8 || libtvSending) return;
    setLibtvSending(true);
    try {
      const response = await fetch("/api/libtv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", accessKey: libtvAccessKey.trim(), sessionId: libtvSessionId }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const status = await response.json() as { summary?: string; results?: LibTvResult[]; events?: LibTvMessage[] };
      setLibtvResults(status.results || []);
      setLibtvMessages(status.events || []);
      if (status.summary) setStatusText(status.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新 LibTV 画布失败");
    } finally {
      setLibtvSending(false);
    }
  }

  async function sendLibTvInstruction() {
    const message = libtvInstruction.trim();
    if (message.length < 8 || !libtvSessionId || libtvSending) return;
    setLibtvSending(true);
    setError("");
    try {
      const response = await fetch("/api/libtv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", accessKey: libtvAccessKey.trim(), sessionId: libtvSessionId, message }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setLibtvInstruction("");
      setLibtvMessages((items) => [...items, { id: uid(), seq: (items.at(-1)?.seq || 0) + 1, role: "user", content: message }]);
      recordActivity("director", `用户向 LibTV 画布追加指令：${message.slice(0, 60)}`);
      window.setTimeout(() => { void refreshLibTvCanvas(); }, 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送 LibTV 指令失败");
    } finally {
      setLibtvSending(false);
    }
  }

  function toggleLibTvPolling() {
    const next = !libtvPauseRef.current;
    libtvPauseRef.current = next;
    setLibtvPollingPaused(next);
  }

  function createLibTvCanvas() {
    if (libtvSending) return;
    const document = createCanvasFromStudio({ title: projectTitle, story, characters, scenes });
    setStatusText("已创建本机制片画布，正在打开");
    recordActivity("director", "已把当前剧本、角色和分镜导入本机制片画布", "done");
    router.push(`/canvas?id=${encodeURIComponent(document.id)}`);
  }

  async function generateAll() {
    if (story.trim().length < 8 || !["idle", "ready", "error"].includes(phase)) return;
    const existingDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const hasLockedStoryboard = scenes.length > 0
      && Math.abs(existingDuration - productionDuration) < 0.5
      && (productionDuration > 15 || scenes.length === 1);
    const roleNeeded = (role: AgentRole) => {
      if (role === "writer" || role === "director") return !hasLockedStoryboard;
      if (role === "image") return !hasLockedStoryboard || characters.some((item) => !item.imageUrl) || scenes.some((item) => !item.imageUrl && !item.videoUrl);
      if (role === "video") return agentConfigs.video.adapter !== "browser" && (!hasLockedStoryboard || scenes.some((item) => !item.videoUrl));
      if (role === "voice") return voiceEnabled && agentConfigs.voice.adapter !== "browser" && (!hasLockedStoryboard || scenes.some((item) => item.dialogue.trim() && !item.audioUrl));
      return true;
    };
    const missingPollinationsKey = AGENT_ROLES.find(({ id }) => roleNeeded(id) && agentConfigs[id].adapter === "pollinations" && !agentKey(id).startsWith("pk_"));
    if (missingPollinationsKey) {
      setError(`${missingPollinationsKey.title}需要填写以 pk_ 开头的 Pollinations 发布密钥`);
      return;
    }
    if (roleNeeded("video") && agentConfigs.video.adapter === "seedance" && agentConfigs.video.apiKey.trim().length < 8) {
      setConfiguringRole("video");
      setError("即梦 Seedance 需要填写火山方舟 API Key");
      return;
    }
    const missingCustomApi = AGENT_ROLES.find(({ id }) => roleNeeded(id) && CUSTOM_TEXT_ADAPTERS.includes(agentConfigs[id].adapter) && !validAgentEndpoint(agentConfigs[id].endpoint));
    if (missingCustomApi) {
      setConfiguringRole(missingCustomApi.id);
      setError(`${missingCustomApi.title}需要填写 HTTPS API 地址或本机 localhost 地址`);
      return;
    }
    const run = Date.now();
    runRef.current = run;
    editorProjectIdRef.current = `studio-${run.toString(36)}`;
    setError("");
    setExportUrl("");
    setMusicUrl("");
    setShowFilm(false);
    setPlaying(false);
    setTime(0);
    setActivityLog([]);
    setPhase(hasLockedStoryboard ? "characters" : "story");
    setProgress(hasLockedStoryboard ? 15 : 5);
    setStatusText(hasLockedStoryboard ? "已锁定用户分镜，正在检查缺少的生产素材" : scriptImported ? "已导入剧本，AI 只负责结构化拆镜" : "AI 正在理解故事并编写分镜");
    recordActivity("writer", hasLockedStoryboard ? "用户分镜已锁定，跳过编剧岗位" : scriptImported ? "用户剧本已锁定，只拆分镜头，不改写剧情" : `${agentName("writer")}开始改编剧本和拆分镜头`, hasLockedStoryboard ? "done" : "running");
    let activeRole: AgentRole = hasLockedStoryboard ? "image" : "writer";
    try {
      let storyboard: Storyboard;
      if (hasLockedStoryboard) {
        storyboard = { title: projectTitle || "用户导入项目", music: musicPrompt || "cinematic instrumental soundtrack, no vocals", characters: characters.map((item) => ({ ...item })), scenes: scenes.map((item) => ({ ...item })) };
        recordActivity("director", "用户分镜视为已定稿，跳过导演复核", "done");
      } else {
        let raw = await generateStoryboard(run);
        recordActivity("writer", scriptImported ? "已按用户剧本交付结构化分镜" : "剧本初稿与分镜提示词已交付", "done");
        setProgress(10);
        activeRole = "director";
        recordActivity("director", `${agentName("director")}开始复核节奏、角色一致性和结尾钩子`);
        try {
          const reviewed = await directorReview(raw, run);
          parseStoryboard(reviewed, productionDuration, sceneCountForDuration(productionDuration), 8);
          raw = reviewed;
          recordActivity("director", "导演复核通过，已锁定制作稿", "done");
        } catch (reason) {
          if (runRef.current !== run) throw new Error("任务已取消");
          const detail = reason instanceof Error ? reason.message : "接口没有返回有效结果";
          setStatusText(`${agentName("director")}暂未完成复核，已保留编剧初稿并继续制作`);
          recordActivity("director", `${agentName("director")}复核未及时完成（${detail}），已安全降级采用编剧初稿，不中断后续制作`, "warning");
        }
        setProgress(15);
        try {
          storyboard = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8);
        } catch (reason) {
          if (agentConfigs.writer.adapter !== "horde") throw reason;
          let partial: Storyboard | null = null;
          try { partial = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8); } catch { partial = null; }
          setStatusText("免费编剧输出不完整，漫镜正在自动补全分镜");
          storyboard = completeFreeStoryboard(partial, story.trim(), style, productionDuration);
          recordActivity("writer", "免费输出被截断，漫镜已补齐缺失镜头", "warning");
        }
      }
      setProjectTitle(storyboard.title);
      setMusicPrompt(storyboard.music);
      let cast = storyboard.characters;
      let work = storyboard.scenes.map((scene, index, all) => ({ ...scene, startState: index === 0 ? (scene.startState || "首镜：按角色、场景和道具 Canonical 资产建立初始状态") : (all[index - 1].endState || scene.startState || "继承上一镜结束状态") }));
      setCharacters(cast);
      setScenes(work);
      setSelected(0);

      setPhase("characters");
      activeRole = "image";
      recordActivity("image", `${agentName("image")}开始生成角色设定与一致性参考`);
      let generatedCharacters = 0;
      const reusableProductionAssets = (await listLibraryAssets()).filter((asset) => asset.reusable !== false);
      for (let index = 0; index < cast.length; index += 1) {
        const character = cast[index];
        if (!isVisualCharacterAsset(character)) {
          cast = cast.map((item) => item.id === character.id ? { ...item, status: "ready" as const } : item);
          recordActivity("image", `“${character.name}”属于旁白、广告声或画外音，已保留声音设定并跳过人物图`, "done");
          continue;
        }
        if (!character.imageUrl) {
          const identity = `character:${stableReuseToken(`${character.name}|${character.appearance}`)}`;
          const name = character.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
          const existing = reusableProductionAssets.filter((asset) => asset.category === "character" && asset.mediaType === "image" && (asset.identityKey === identity || asset.tags.includes(`asset:${identity}`) || asset.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").includes(name))).sort((a, b) => Number(Boolean(b.canonical || b.locked)) - Number(Boolean(a.canonical || a.locked)) || b.createdAt.localeCompare(a.createdAt))[0];
          if (existing) {
            const [loaded] = await loadLibraryAssets([existing.id]);
            if (loaded?.url) {
              const response = await fetch(loaded.url);
              const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
              const remoteUrl = response.ok ? (uploadKey ? await uploadPollinationsMedia(await response.blob(), `canonical-character-${existing.id}.png`, uploadKey) : await blobToDataUrl(await response.blob())) : "";
              cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: loaded.url, remoteUrl, sheetVersion: 2 as const, status: "ready" as const } : item);
              await markLibraryAssetUsed(existing.id);
              recordActivity("image", `角色“${character.name}”身份与造型未变化，已直接复用人物资产`, "done");
            }
          }
        }
        const resolvedCharacter = cast.find((item) => item.id === character.id) || character;
        if (resolvedCharacter.imageUrl) {
          cast = cast.map((item) => item.id === character.id ? { ...item, status: "ready" as const } : item);
          setCharacters(cast);
          setProgress(10 + Math.round(((index + 1) / Math.max(1, cast.length)) * 16));
          continue;
        }
        setStatusText(`正在建立角色资产 ${index + 1}/${cast.length}：${character.name}`);
        cast = cast.map((item) => item.id === character.id ? { ...item, status: "generating" as const } : item);
        setCharacters(cast);
        const characterPrompt = characterSheetPrompt(style, character);
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", characterPrompt, 50 + index, { imageAspect: "16:9" });
          const assetUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : assetUploadKey ? await uploadPollinationsMedia(asset.blob, `character-${index + 1}.png`, assetUploadKey) : "";
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: asset.url, remoteUrl, sheetVersion: 2 as const, status: "ready" as const } : item);
          autoArchive(asset.url, `${projectTitle}-${character.name}-角色设定`, "character", 5, ["自动生成", "人物", character.id, `asset:character:${stableReuseToken(`${character.name}|${character.appearance}`)}`]);
        } else {
          const referenceScene: Scene = { id: uid(), title: character.name, visual: characterPrompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
          const imageUrl = await makeImage(referenceScene, 50 + index, run, "", "16:9", characterPrompt);
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl, sheetVersion: 2 as const, status: "ready" as const } : item);
          autoArchive(imageUrl, `${projectTitle}-${character.name}-角色设定`, "character", 5, ["自动生成", "人物", character.id, `asset:character:${stableReuseToken(`${character.name}|${character.appearance}`)}`]);
        }
        generatedCharacters += 1;
        setCharacters(cast);
        setProgress(10 + Math.round(((index + 1) / cast.length) * 16));
      }
      recordActivity("image", `${cast.length - generatedCharacters} 个用户角色资产已复用，${generatedCharacters} 个缺失角色已补齐；开始检查连续分镜`);

      setPhase("images");
      const sceneAssetReferences = new Map<string, string>();
      const propAssetReferences = new Map<string, string>();
      const environmentPlans = [...new Map(work.map((scene) => [scene.environmentKey || labeledVisualAssets(scene.visual, "场景")[0] || scene.title, scene])).entries()].slice(0, 16);
      const propNames = [...new Set(work.flatMap((scene) => labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具")))].slice(0, 16);
      recordActivity("image", `生图岗位已提取 ${environmentPlans.length} 个场景资产与 ${propNames.length} 个重要道具资产`);
      const reusablePropAssets = (await listLibraryAssets()).filter((asset) => asset.category === "prop" && asset.reusable !== false).sort((a, b) => Number(b.canonical) - Number(a.canonical) || Number(b.locked) - Number(a.locked));
      const propUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
      for (const prop of propNames) {
        const normalized = prop.trim().toLocaleLowerCase("zh-CN");
        const existing = reusablePropAssets.find((asset) => `${asset.identityKey || ""} ${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized));
        if (!existing) continue;
        const [loaded] = await loadLibraryAssets([existing.id]);
        if (!loaded?.url) continue;
        const response = await fetch(loaded.url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const reference = propUploadKey ? await uploadPollinationsMedia(blob, `canonical-prop-${existing.id}.png`, propUploadKey) : await blobToDataUrl(blob);
        propAssetReferences.set(prop, reference);
        await markLibraryAssetUsed(existing.id);
        recordActivity("image", `重要道具“${prop}”已绑定资产库 Canonical 版本，不再重新设计`, "done");
      }
      for (let index = 0; index < environmentPlans.length; index += 1) {
        const [environmentKey, scene] = environmentPlans[index];
        const normalizedEnvironment = environmentKey.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").trim();
        const existingEnvironment = reusableProductionAssets.filter((asset) => asset.category === "scene" && asset.mediaType === "image" && asset.tags.includes("场景设定") && (asset.identityKey === `scene:${environmentKey}` || asset.tags.includes(`asset:scene:${environmentKey}`) || asset.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").includes(normalizedEnvironment))).sort((a, b) => Number(Boolean(b.canonical || b.locked)) - Number(Boolean(a.canonical || a.locked)) || b.createdAt.localeCompare(a.createdAt))[0];
        if (existingEnvironment) {
          const [loaded] = await loadLibraryAssets([existingEnvironment.id]);
          if (loaded?.url) {
            const response = await fetch(loaded.url);
            if (response.ok) {
              const blob = await response.blob();
              const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
              const reference = uploadKey ? await uploadPollinationsMedia(blob, `canonical-scene-${existingEnvironment.id}.png`, uploadKey) : await blobToDataUrl(blob);
              sceneAssetReferences.set(environmentKey, reference);
              await markLibraryAssetUsed(existingEnvironment.id);
              recordActivity("image", `场景“${environmentKey}”状态未变化，已直接复用场景资产`, "done");
              continue;
            }
          }
        }
        const prompt = `${frameVisualPrompt(style)}, environment concept sheet for ${environmentKey}, ${scene.environmentBible || scene.visual}, empty set without people and without movable important story props, lock only architecture, doors, windows, fixed furniture, weather, time of day, palette and light direction; canonical props will be composited later from separate reference assets, do not invent or redesign them, cinematic production design reference, no text`;
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", prompt, 200 + index, { imageAspect: aspect });
          const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remote = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `environment-${index + 1}.png`, uploadKey) : "";
          if (remote) sceneAssetReferences.set(environmentKey, remote);
          autoArchive(asset.url, `${projectTitle}-${environmentKey}-场景设定`, "scene", 5, ["自动生成", "场景设定", environmentKey, `asset:scene:${environmentKey}`]);
        } else {
          const imageUrl = await makeImage(scene, 200 + index, run, "", aspect, prompt);
          autoArchive(imageUrl, `${projectTitle}-${environmentKey}-场景设定`, "scene", 5, ["自动生成", "场景设定", environmentKey, `asset:scene:${environmentKey}`]);
        }
      }
      for (let index = 0; index < propNames.length; index += 1) {
        const prop = propNames[index];
        if (propAssetReferences.has(prop)) continue;
        const ownerScenes = work.filter((scene) => labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").includes(prop));
        const prompt = `${frameVisualPrompt(style)}, production prop identity sheet for ${prop}, exact shape, material, color, scale and distinctive details, front side and three-quarter reference views, neutral background, no person, no redesign, no text`;
        const referenceScene = ownerScenes[0] || work[0];
        if (!referenceScene) continue;
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", prompt, 240 + index, { imageAspect: "16:9" });
          const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remote = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `prop-${index + 1}.png`, uploadKey) : "";
          if (remote) propAssetReferences.set(prop, remote);
          autoArchive(asset.url, `${projectTitle}-${prop}-道具设定`, "prop", 5, ["自动生成", "重要道具", prop, `asset:prop:${prop}`]);
        } else {
          const imageUrl = await makeImage(referenceScene, 240 + index, run, "", "16:9", prompt);
          autoArchive(imageUrl, `${projectTitle}-${prop}-道具设定`, "prop", 5, ["自动生成", "重要道具", prop, `asset:prop:${prop}`]);
        }
      }
      if (agentConfigs.video.adapter === "browser") {
      let generatedFrames = 0;
      for (let index = 0; index < work.length; index += 1) {
        const scene = work[index];
        if (scene.imageUrl || scene.videoUrl) {
          work = work.map((item) => item.id === scene.id ? { ...item, status: "ready" as SceneStatus } : item);
          setScenes(work);
          setProgress(26 + Math.round(((index + 1) / Math.max(1, work.length)) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
          continue;
        }
        const reusableFrame = await reusableSceneResult(scene);
        if (reusableFrame) {
          work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: reusableFrame.url, status: "ready" as SceneStatus } : item);
          setScenes(work);
          setProgress(26 + Math.round(((index + 1) / Math.max(1, work.length)) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
          recordActivity("image", `“${scene.title}”人物、场景、道具、动作与机位未变化，已直接复用分镜结果`, "done");
          continue;
        }
        setStatusText(`正在制作第 ${index + 1}/${work.length} 个一致性分镜`);
        updateScene(scene.id, { status: "painting" });
        const presentCast = cast.filter((character) => scene.characters.includes(character.name) || scene.speaker === character.name);
        const castForScene = presentCast.length ? presentCast : cast.slice(0, 2);
        const characterGuide = castForScene.map((character) => `${character.name}: ${character.appearance}`).join("; ");
        const previousScene = index > 0 ? work[index - 1] : undefined;
        const sameEnvironment = Boolean(previousScene && scene.environmentKey && previousScene.environmentKey === scene.environmentKey);
        const continuityGuide = sameEnvironment
          ? `Environment lock: ${scene.environmentBible || scene.visual}. Continue from the previous shot: ${previousScene?.endState || previousScene?.action}. Current continuity: ${scene.continuity || "preserve positions, directions and props"}. Keep the exact architecture, doors, windows, furniture, props, weather, time of day, color palette and light direction.`
          : `Environment definition: ${scene.environmentBible || scene.visual}. ${scene.continuity || (index === 0 ? "establish this location clearly" : "this is an intentional location or time change")}.`;
        if (agentConfigs.image.adapter !== "horde") {
          const sceneProps = labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具");
          const framePrompt = `${frameVisualPrompt(style)}, final storyboard frame assembled from locked character identity, current costume, environment and prop references; do not redesign referenced assets. ${continuityGuide} Important props: ${sceneProps.join(", ") || "none"}. Shot: ${scene.shot}. Visual: ${scene.visual}. Action: ${scene.action}. expressive face, natural anatomy and hands, layered depth for camera motion, coherent spatial layout, no text, no speech bubbles, no panel borders`;
          const environmentReference = sceneAssetReferences.get(scene.environmentKey || labeledVisualAssets(scene.visual, "场景")[0] || scene.title);
          const references = [...castForScene.map((item) => item.remoteUrl).filter(Boolean), ...sceneProps.map((prop) => propAssetReferences.get(prop)).filter(Boolean), ...(environmentReference ? [environmentReference] : []), ...(sameEnvironment && previousScene?.remoteImageUrl ? [previousScene.remoteImageUrl] : [])].filter((value, refIndex, all) => all.indexOf(value) === refIndex) as string[];
          const frame = await pollinationsMedia("image", framePrompt, index, { references });
          const frameUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : frameUploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${index + 1}.png`, frameUploadKey) : "";
          work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: frame.url, remoteImageUrl, status: "ready" as SceneStatus } : item);
          runtimeShotReuseRef.current.set(shotReuseIdentity(scene), frame.url);
          autoArchive(frame.url, `${projectTitle}-${scene.environmentKey || scene.title}-${scene.title}-分镜`, "scene", scene.duration, ["自动生成", "分镜", "分镜合成", scene.id, scene.environmentKey || "场景待定", `asset:${shotReuseIdentity(scene)}`, ...sceneProps.map((prop) => `prop:${prop}`)]);
        } else {
          const reusable = await reusableSceneResult(scene);
          if (reusable) {
            work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl: reusable.url, status: "ready" as SceneStatus } : item));
            recordActivity("image", `“${scene.title}”状态完全一致，已直接复用分镜结果，未调用生图模型`, "done");
          } else {
            const imageUrl = await makeImage(scene, index, run, `${characterGuide}; ${continuityGuide}`);
            runtimeShotReuseRef.current.set(shotReuseIdentity(scene), imageUrl);
            work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl, status: "ready" as SceneStatus } : item));
          }
        }
        let completedScene = work.find((item) => item.id === scene.id) || scene;
        let report = await evaluateShotConsistency(completedScene, completedScene.imageUrl || "", castForScene, previousScene, 1);
        if (report.mode === "vision" && report.overall < 85) {
          setStatusText(`镜头 ${index + 1} 一致性 ${report.overall} 分，正在进行唯一一次约束修复`);
          recordActivity("image", `“${scene.title}”一致性未达85分：${report.findings.join("；").slice(0, 180)}，自动修复一次`, "warning");
          const repairPrompt = `${frameVisualPrompt(style)}, regenerate this exact storyboard shot while correcting only visible, actionable failures: ${report.findings.join("; ")}. Canonical characters: ${characterGuide}. Match the supplied canonical face shape, facial proportions, hairstyle, age, fatigue details and costume exactly. Never add earrings, necklaces, glasses, tattoos, hair ornaments or other accessories unless explicitly present in the canonical asset or script. Locked environment: ${scene.environmentBible || scene.visual}. Preserve only environment anchors visible in this shot; do not widen or change the requested shot merely to reveal off-screen anchors. Start state that must be preserved: ${scene.startState}. Important props: ${labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").join(", ")}. Do not redesign faces, costumes, scene architecture or props. ${scene.action}, ${scene.camera}, no text`;
          const repairedUrl = await makeImage(scene, 500 + index, run, characterGuide, aspect, repairPrompt);
          completedScene = { ...completedScene, imageUrl: repairedUrl, remoteImageUrl: undefined };
          report = await evaluateShotConsistency(completedScene, repairedUrl, castForScene, previousScene, 2);
          work = work.map((item) => item.id === scene.id ? completedScene : item);
        }
        if (report.mode === "vision" && report.overall < 85) {
          setScenes(work.map((item) => item.id === scene.id ? { ...completedScene, consistencyReport: report, consistencyDecision: "reject", status: "error" as SceneStatus } : item));
          const approved = window.confirm(`AI 质检认为镜头“${scene.title}”仍未达到 85 分（当前 ${report.overall} 分）。\n\n${report.findings.slice(0, 5).join("\n")}\n\n是否删除当前不合格画面，并依据 Canonical 资产重新构建？\n选择“取消”会保留当前结果并标记为人工接受。`);
          if (approved) {
            setStatusText(`已获用户同意，正在删除并重构镜头 ${index + 1}：${scene.title}`);
            recordActivity("image", `用户同意删除“${scene.title}”的不合格结果，正在按 Canonical 资产重构`, "warning");
            if (completedScene.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(completedScene.imageUrl);
            const userApprovedPrompt = `${frameVisualPrompt(style)}, user approved a full rebuild of this rejected storyboard shot. Fix these visible failures: ${report.findings.join("; ")}. Canonical characters must match exactly: ${characterGuide}. Preserve identity, face shape, hairstyle, age, fatigue details, costume, locked props, environment architecture, light direction and Start State. Never add unapproved accessories. Keep the requested shot size and do not reveal off-screen anchors merely for inspection. ${scene.action}, ${scene.camera}, no text`;
            const rebuiltUrl = await makeImage(scene, 900 + index, run, characterGuide, aspect, userApprovedPrompt);
            completedScene = { ...completedScene, imageUrl: rebuiltUrl, remoteImageUrl: undefined, status: "ready" as SceneStatus };
            report = await evaluateShotConsistency(completedScene, rebuiltUrl, castForScene, previousScene, 3);
            work = work.map((item) => item.id === scene.id ? completedScene : item);
            recordActivity("image", `“${scene.title}”已完成用户批准的重构，新图片已写入资产库并重新质检为 ${report.overall} 分`, report.overall >= 85 ? "done" : "warning");
          } else {
            report = { ...report, decision: "review", findings: [...report.findings, "用户选择保留当前画面并人工接受。"] };
            recordActivity("image", `用户选择保留“${scene.title}”当前画面，已标记为人工接受`, "done");
          }
        }
        const finalDecision = report.mode === "structural" && report.decision === "reject" ? "review" : report.decision;
        work = work.map((item) => item.id === scene.id ? { ...item, consistencyReport: { ...report, decision: finalDecision }, consistencyDecision: finalDecision, status: finalDecision === "reject" ? "error" as SceneStatus : "ready" as SceneStatus } : item);
        generatedFrames += 1;
        setScenes(work);
        setProgress(26 + Math.round(((index + 1) / work.length) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
      }
      recordActivity("image", `${work.length - generatedFrames} 个用户画面/视频已复用，${generatedFrames} 张缺失画面已生成`, "done");
      } else {
        recordActivity("image", "原生视频直出模式：已跳过分镜图生成，将逐镜生成视频并从成片提取关键帧", "done");
      }

      if (agentConfigs.video.adapter !== "browser") {
        setPhase("video");
        activeRole = "video";
        recordActivity("video", `${agentName("video")}开始把关键帧生成原生动态镜头`);
        let generatedClips = 0;
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          if (scene.videoUrl) {
            work = work.map((item) => item.id === scene.id ? { ...item, status: "ready" as SceneStatus } : item);
            setScenes(work);
            setProgress(44 + Math.round(((index + 1) / Math.max(1, work.length)) * 26));
            continue;
          }
          setStatusText(`正在让镜头真正动起来 ${index + 1}/${work.length}：${scene.action}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
          setScenes(work);
          const previousScene = index > 0 ? work[index - 1] : undefined;
          const sameEnvironment = Boolean(previousScene && scene.environmentKey && previousScene.environmentKey === scene.environmentKey);
          try {
            const motionPrompt = await compileShotMotionPrompt(scene, index, previousScene);
            const clip = await pollinationsMedia("video", motionPrompt, index, { references: await videoReferences(scene, previousScene), duration: scene.duration, resumeKey: scene.id });
            let continuityFrames: { middle: string; end: string } | undefined;
            try {
              continuityFrames = await extractVideoContinuityFrames(clip.url, scene);
            } catch (reason) {
              recordActivity("video", `“${scene.title}”视频已生成，关键帧提取失败但不影响后续成片：${reason instanceof Error ? reason.message : "未知错误"}`, "warning");
            }
            work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: clip.url, imageUrl: continuityFrames?.middle || item.imageUrl, remoteImageUrl: continuityFrames?.end || item.remoteImageUrl, duration: Math.max(4, Math.min(15, scene.duration)), status: "ready" as SceneStatus, errorMessage: undefined } : item);
            autoArchive(clip.url, `${projectTitle}-${scene.title}-视频`, "video", Math.max(4, Math.min(15, scene.duration)), ["自动生成", "视频", scene.id]);
            generatedClips += 1;
            setScenes(work);
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : "视频模型没有返回结果";
            work = work.map((item) => item.id === scene.id ? { ...item, status: "error" as SceneStatus, errorMessage: message } : item);
            setScenes(work);
            recordActivity("video", `“${scene.title}”生成失败，已跳过并继续后续镜头：${message}`, "warning");
          }
          setProgress(44 + Math.round(((index + 1) / work.length) * 26));
        }
        recordActivity("video", `${work.length - generatedClips} 个用户视频已复用，${generatedClips} 个缺失动态镜头已生成`, "done");
      } else {
        recordActivity("video", "免费模式使用 2.5D 运镜、景深和光影动画，不包含人物肢体生成", "warning");
      }

      if (voiceEnabled && agentConfigs.voice.adapter !== "browser") {
        setPhase("voice");
        activeRole = "voice";
        recordActivity("voice", `${agentName("voice")}开始逐镜生成角色配音`);
        let generatedVoices = 0;
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          if (scene.audioUrl || !scene.dialogue.trim()) {
            setProgress(70 + Math.round(((index + 1) / Math.max(1, work.length)) * 13));
            continue;
          }
          setStatusText(`正在生成 ${scene.speaker} 的${scene.emotion}配音 ${index + 1}/${work.length}`);
          updateScene(scene.id, { status: "voicing" });
          const castVoice = cast.find((character) => character.name === scene.speaker)?.voice || voice;
          const reusedVoice = await reusableVoiceResult(scene, castVoice);
          if (reusedVoice) {
            work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: reusedVoice.url, duration: Math.max(item.duration, Math.ceil(reusedVoice.duration + 0.6)), status: "ready" as SceneStatus } : item);
            setScenes(work);
            recordActivity("voice", `“${scene.title}”台词、角色与音色未变化，已直接复用声音资产`, "done");
            continue;
          }
          const speech = await pollinationsMedia("audio", scene.dialogue, index, { voiceName: castVoice });
          const audioSeconds = await mediaDuration(speech.url);
          runtimeVoiceReuseRef.current.set(voiceReuseIdentity(scene, castVoice), { url: speech.url, duration: audioSeconds });
          work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: speech.url, duration: Math.max(item.duration, Math.ceil(audioSeconds + 0.6)), status: "ready" as SceneStatus } : item);
          autoArchive(speech.url, `${projectTitle}-${scene.title}-配音`, "audio", audioSeconds, ["自动生成", "配音", scene.id, scene.speaker, castVoice, `asset:${voiceReuseIdentity(scene, castVoice)}`]);
          generatedVoices += 1;
          setScenes(work);
          setProgress(70 + Math.round(((index + 1) / work.length) * 13));
        }
        recordActivity("voice", `${work.filter((item) => item.audioUrl).length - generatedVoices} 条用户音轨已复用，${generatedVoices} 条缺失配音已生成`, "done");
      } else if (voiceEnabled) {
        recordActivity("voice", "免费模式使用设备中文语音预览，不会写入可下载音轨", "warning");
      } else {
        recordActivity("voice", "用户已关闭自动配音", "warning");
      }

      if (lipsyncEnabled) {
        const eligible = work.filter((scene) => scene.audioUrl && (scene.videoUrl || scene.imageUrl));
        if (!eligible.length) {
          recordActivity("video", "已启用 MuseTalk，但当前没有可用的生成配音；跳过口型增强", "warning");
        } else {
          try {
            setPhase("video");
            activeRole = "video";
            recordActivity("video", `MuseTalk 开始为 ${eligible.length} 个镜头生成中文口型`);
            for (let index = 0; index < eligible.length; index += 1) {
              const scene = eligible[index];
              setStatusText(`MuseTalk 正在生成口型 ${index + 1}/${eligible.length}：${scene.title}`);
              work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
              setScenes(work);
              const lipVideo = await createLipSyncedVideo(scene);
              if (lipVideo) {
                if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
                work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: lipVideo, status: "ready" as SceneStatus, model: "MuseTalk 1.5" } : item);
                autoArchive(lipVideo, `${projectTitle}-${scene.title}-口型视频`, "video", scene.duration, ["自动生成", "口型", scene.id]);
                setScenes(work);
              }
            }
            recordActivity("video", "MuseTalk 口型增强已完成", "done");
          } catch (reason) {
            work = work.map((item) => item.status === "animating" ? { ...item, status: "ready" as SceneStatus } : item);
            setScenes(work);
            recordActivity("video", reason instanceof Error ? `口型增强跳过：${reason.message}` : "口型增强暂时不可用", "warning");
          }
        }
      }

      let generatedMusicUrl = "";
      if (bgmEnabled && agentConfigs.voice.adapter !== "browser") {
        setPhase("music");
        activeRole = "voice";
        setStatusText("正在生成与剧情节奏匹配的无歌词配乐");
        const soundtrack = await pollinationsMedia("audio", storyboard.music, 0, { music: true, duration: work.reduce((sum, item) => sum + item.duration, 0) });
        generatedMusicUrl = soundtrack.url;
        setMusicUrl(soundtrack.url);
      }
      activeRole = "editor";
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
      recordActivity(activeRole, reason instanceof Error ? `制作中断：${reason.message}` : "制作中断", "error");
    }
  }

  function cancelGeneration() {
    runRef.current = Date.now();
    setLibtvRunning(false);
    setRetryingRole(null);
    setPhase(scenes.length ? "ready" : "idle");
    setStatusText("已停止当前任务");
  }

  function roleConnectionProblem(role: AgentRole) {
    const config = agentConfigs[role];
    if (config.adapter === "pollinations" && !agentKey(role).startsWith("pk_")) return `${AGENT_ROLES.find((item) => item.id === role)?.title}需要填写 Pollinations 发布密钥`;
    if (config.adapter === "seedance" && config.apiKey.trim().length < 8) return "视频 AI 需要填写火山方舟 API Key";
    if (CUSTOM_TEXT_ADAPTERS.includes(config.adapter) && !validAgentEndpoint(config.endpoint)) return `${AGENT_ROLES.find((item) => item.id === role)?.title}需要填写 HTTPS API 地址或本机 localhost 地址`;
    return "";
  }

  function canRerunRole(role: AgentRole) {
    if (role === "writer") return story.trim().length >= 8;
    if (role === "director" || role === "image" || role === "voice") return scenes.length > 0;
    if (role === "video") return scenes.some((scene) => scene.imageUrl);
    return scenes.some((scene) => scene.imageUrl || scene.videoUrl);
  }

  async function rerunRole(role: AgentRole) {
    if (retryingRole || busy || !canRerunRole(role)) return;
    const connectionProblem = roleConnectionProblem(role);
    if (connectionProblem) {
      setConfiguringRole(role);
      setError(connectionProblem);
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setRetryingRole(role);
    setError("");
    setPlaying(false);
    setShowFilm(false);
    recordActivity(role, `${agentName(role)}正在从上次中断处重新运行`);
    try {
      if (role === "writer") {
        setPhase("story");
        setProgress(5);
        setStatusText("编剧 AI 正在重新生成剧本与分镜");
        const raw = await generateStoryboard(run);
        let next: Storyboard;
        try {
          next = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8);
        } catch (reason) {
          if (agentConfigs.writer.adapter !== "horde") throw reason;
          let partial: Storyboard | null = null;
          try { partial = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8); } catch { partial = null; }
          next = completeFreeStoryboard(partial, story.trim(), style, productionDuration);
        }
        invalidateExport();
        setMusicUrl("");
        setProjectTitle(next.title);
        setMusicPrompt(next.music);
        setCharacters(next.characters);
        setScenes(next.scenes);
        setSelected(0);
        setProgress(15);
        recordActivity("writer", `新剧本与 ${next.scenes.length} 个分镜已交付`, "done");
        (["director", "image", "video", "voice", "editor"] as AgentRole[]).forEach((downstream) => recordActivity(downstream, "上游剧本已更新，等待按需重新运行", "warning"));
        setStatusText("编剧已重新交付；可继续运行导演或其他岗位");
        setPhase("ready");
        return;
      }

      if (role === "director") {
        setPhase("story");
        setProgress(Math.max(10, progress));
        setStatusText("导演 AI 正在重新复核当前剧本与分镜");
        const reviewedRaw = await directorReview(storyboardDraft(projectTitle, musicPrompt, characters, scenes), run);
        const reviewed = mergeReviewedStoryboard(parseStoryboard(reviewedRaw, productionDuration, sceneCountForDuration(productionDuration), 8), characters, scenes);
        invalidateExport();
        setProjectTitle(reviewed.title);
        setMusicPrompt(reviewed.music);
        setCharacters(reviewed.characters);
        setScenes(reviewed.scenes);
        recordActivity("director", "导演复核已重新交付，现有图片、视频和配音均已保留", "done");
        recordActivity("image", "导演稿已更新，现有素材已保留；如画面不匹配可重新运行生图岗位", "warning");
        setStatusText("导演复核完成，现有素材没有被清空");
        setPhase("ready");
        return;
      }

      if (role === "image") {
        setPhase("images");
        let cast = characters.map((character) => ({ ...character }));
        let work = scenes.map((scene) => ({ ...scene }));
        const missingCharacters = cast.filter((character) => isVisualCharacterAsset(character) && (!character.imageUrl || character.status === "error" || character.sheetVersion !== 2));
        for (let targetIndex = 0; targetIndex < missingCharacters.length; targetIndex += 1) {
          const character = missingCharacters[targetIndex];
          setStatusText(`生图 AI 正在补跑角色资产 ${targetIndex + 1}/${missingCharacters.length}：${character.name}`);
          cast = cast.map((item) => item.id === character.id ? { ...item, status: "generating" as const } : item);
          setCharacters(cast);
          const prompt = characterSheetPrompt(style, character);
          if (agentConfigs.image.adapter !== "horde") {
            const asset = await pollinationsMedia("image", prompt, 50 + targetIndex, { imageAspect: "16:9" });
            const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
            const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `character-retry-${targetIndex + 1}.png`, uploadKey) : "";
            cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: asset.url, remoteUrl, sheetVersion: 2 as const, status: "ready" as const } : item);
            autoArchive(asset.url, `${projectTitle}-${character.name}-角色设定`, "character", 5, ["自动生成", "人物", character.id]);
          } else {
            const referenceScene: Scene = { id: uid(), title: character.name, visual: prompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
            const imageUrl = await makeImage(referenceScene, 50 + targetIndex, run, "", "16:9", prompt);
            cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl, sheetVersion: 2 as const, status: "ready" as const } : item);
          }
          setCharacters(cast);
        }
        let targets = work.filter((scene) => !scene.imageUrl || scene.status === "error").map((scene) => scene.id);
        if (!targets.length && work[selected]) targets = [work[selected].id];
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const sceneIndex = work.findIndex((scene) => scene.id === targets[targetIndex]);
          const scene = work[sceneIndex];
          if (!scene) continue;
          setStatusText(`生图 AI 正在补跑分镜 ${targetIndex + 1}/${targets.length}：${scene.title}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "painting" as SceneStatus } : item);
          setScenes(work);
          const presentCast = cast.filter((character) => scene.characters.includes(character.name) || scene.speaker === character.name);
          const castForScene = presentCast.length ? presentCast : cast.slice(0, 2);
          if (agentConfigs.image.adapter !== "horde") {
            const prompt = `${frameVisualPrompt(style)}, one coherent scene, exact identities and costumes from references, ${scene.shot}, ${scene.visual}, ${scene.action}, expressive face, natural anatomy and hands, layered depth, no text, no speech bubbles, no panel borders`;
            const frame = await pollinationsMedia("image", prompt, sceneIndex, { references: castForScene.map((item) => item.remoteUrl).filter(Boolean) as string[] });
            const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
            const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : uploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${sceneIndex + 1}-retry.png`, uploadKey) : "";
            if (scene.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.imageUrl);
            if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
            work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: frame.url, remoteImageUrl, videoUrl: undefined, status: "ready" as SceneStatus } : item);
            autoArchive(frame.url, `${projectTitle}-${scene.title}-分镜`, "scene", scene.duration, ["自动生成", "分镜", scene.id]);
          } else {
            const characterGuide = castForScene.map((character) => `${character.name}: ${character.appearance}`).join("; ");
            const imageUrl = await makeImage(scene, sceneIndex, run, characterGuide);
            if (scene.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.imageUrl);
            if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
            work = work.map((item) => item.id === scene.id ? { ...item, imageUrl, videoUrl: undefined, status: "ready" as SceneStatus } : item);
          }
          setScenes(work);
          setProgress(26 + Math.round(((targetIndex + 1) / targets.length) * 18));
        }
        invalidateExport();
        recordActivity("image", `生图岗位补跑完成：${missingCharacters.length} 个角色、${targets.length} 个分镜`, "done");
        setStatusText("生图岗位重新运行完成，其他已完成素材保持不变");
        setPhase("ready");
        return;
      }

      if (role === "video") {
        if (agentConfigs.video.adapter === "browser") {
          recordActivity("video", "本地 2.5D 运镜无需排队；重新合成时会自动应用", "warning");
          setStatusText("本地运镜已就绪，可重新运行剪辑岗位合成成片");
          setPhase("ready");
          return;
        }
        setPhase("video");
        let work = scenes.map((scene) => ({ ...scene }));
        let targets = work.filter((scene) => scene.imageUrl && (!scene.videoUrl || scene.status === "error")).map((scene) => scene.id);
        if (!targets.length) {
          const fallback = work[selected]?.imageUrl ? work[selected] : work.find((scene) => scene.imageUrl);
          if (fallback) targets = [fallback.id];
        }
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const sceneIndex = work.findIndex((scene) => scene.id === targets[targetIndex]);
          const scene = work[sceneIndex];
          if (!scene) continue;
          setStatusText(`视频 AI 正在补跑动态镜头 ${targetIndex + 1}/${targets.length}：${scene.title}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
          setScenes(work);
          const prompt = `${motionVisualPrompt(style)}, preserve exact character identity, face, hair and costume from the start frame. ${scene.action}. Camera: ${scene.camera}. ${scene.speaker} performs with ${scene.emotion} emotion and natural mouth movement. One continuous cinematic shot, coherent physics, no subtitles, no cuts.`;
          const clip = await pollinationsMedia("video", prompt, sceneIndex, { references: await videoReferences(scene), duration: scene.duration, resumeKey: scene.id });
          if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
          work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: clip.url, duration: Math.max(4, Math.min(15, scene.duration)), status: "ready" as SceneStatus } : item);
          autoArchive(clip.url, `${projectTitle}-${scene.title}-视频`, "video", Math.max(4, Math.min(15, scene.duration)), ["自动生成", "视频", scene.id]);
          setScenes(work);
          setProgress(44 + Math.round(((targetIndex + 1) / targets.length) * 26));
        }
        invalidateExport();
        recordActivity("video", `视频岗位补跑完成：${targets.length} 个动态镜头`, "done");
        setStatusText("视频岗位重新运行完成，已有图片和配音均已保留");
        setPhase("ready");
        return;
      }

      if (role === "voice") {
        if (!voiceEnabled) throw new Error("请先打开自动配音开关");
        if (agentConfigs.voice.adapter === "browser") {
          recordActivity("voice", "系统中文语音会在播放时即时朗读，无需云端重跑", "warning");
          setStatusText("设备语音已就绪；它不会生成可下载音轨");
          setPhase("ready");
          return;
        }
        setPhase("voice");
        let work = scenes.map((scene) => ({ ...scene }));
        let targets = work.filter((scene) => scene.dialogue.trim() && (!scene.audioUrl || scene.status === "error")).map((scene) => scene.id);
        if (!targets.length) {
          const fallback = work[selected]?.dialogue.trim() ? work[selected] : work.find((scene) => scene.dialogue.trim());
          if (fallback) targets = [fallback.id];
        }
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const sceneIndex = work.findIndex((scene) => scene.id === targets[targetIndex]);
          const scene = work[sceneIndex];
          if (!scene) continue;
          setStatusText(`配音 AI 正在补跑角色音轨 ${targetIndex + 1}/${targets.length}：${scene.speaker}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "voicing" as SceneStatus } : item);
          setScenes(work);
          const castVoice = characters.find((character) => character.name === scene.speaker)?.voice || voice;
          const reusedVoice = await reusableVoiceResult(scene, castVoice);
          if (reusedVoice) {
            work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: reusedVoice.url, duration: Math.max(item.duration, Math.ceil(reusedVoice.duration + 0.6)), status: "ready" as SceneStatus } : item);
            setScenes(work);
            recordActivity("voice", `“${scene.title}”已直接复用角色声音资产`, "done");
            continue;
          }
          const speech = await pollinationsMedia("audio", scene.dialogue, sceneIndex, { voiceName: castVoice });
          const audioSeconds = await mediaDuration(speech.url);
          runtimeVoiceReuseRef.current.set(voiceReuseIdentity(scene, castVoice), { url: speech.url, duration: audioSeconds });
          if (scene.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.audioUrl);
          work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: speech.url, duration: Math.max(item.duration, Math.ceil(audioSeconds + 0.6)), status: "ready" as SceneStatus } : item);
          autoArchive(speech.url, `${projectTitle}-${scene.title}-配音`, "audio", audioSeconds, ["自动生成", "配音", scene.id, scene.speaker, castVoice, `asset:${voiceReuseIdentity(scene, castVoice)}`]);
          setScenes(work);
          setProgress(70 + Math.round(((targetIndex + 1) / targets.length) * 13));
        }
        if (bgmEnabled && !musicUrl) {
          setStatusText("声音岗位正在补跑剧情配乐");
          const soundtrack = await pollinationsMedia("audio", musicPrompt || "cinematic instrumental soundtrack, no vocals", 0, { music: true, duration: work.reduce((sum, scene) => sum + scene.duration, 0) });
          setMusicUrl(soundtrack.url);
        }
        invalidateExport();
        recordActivity("voice", `配音岗位补跑完成：${targets.length} 条角色音轨${bgmEnabled ? "，配乐已检查" : ""}`, "done");
        setStatusText("配音岗位重新运行完成，已有画面和视频均已保留");
        setPhase("ready");
        return;
      }

      setPhase("exporting");
      setStatusText("剪辑 AI 正在重新分析节奏并合成成片");
      const edited = await applyEditorPlan(scenes.map((scene) => ({ ...scene })));
      setScenes(edited);
      const exported = await exportFilm(edited, true, musicUrl);
      if (!exported) throw new Error("剪辑合成未完成");
      recordActivity("editor", "剪辑岗位重新运行完成，新的成片已交付", "done");
    } catch (reason) {
      if (runRef.current !== run) return;
      if (role === "image") {
        setCharacters((items) => items.map((item) => item.status === "generating" ? { ...item, status: "error" as const } : item));
        setScenes((items) => items.map((item) => item.status === "painting" ? { ...item, status: "error" as SceneStatus } : item));
      }
      if (role === "video") setScenes((items) => items.map((item) => item.status === "animating" ? { ...item, status: "error" as SceneStatus } : item));
      if (role === "voice") setScenes((items) => items.map((item) => item.status === "voicing" ? { ...item, status: "error" as SceneStatus } : item));
      const message = reason instanceof Error ? reason.message : `${AGENT_ROLES.find((item) => item.id === role)?.title}重新运行失败`;
      setPhase("error");
      setError(message);
      setStatusText(`${AGENT_ROLES.find((item) => item.id === role)?.title}重新运行中断`);
      recordActivity(role, `重新运行中断：${message}`, "error");
    } finally {
      setRetryingRole(null);
    }
  }

  async function regenerateImage(scene: Scene, index: number) {
    if (sceneActionRef.current) return;
    if (agentConfigs.image.adapter === "pollinations" && !agentKey("image").startsWith("pk_")) {
      setError("生图 AI 需要先填写发布密钥");
      return;
    }
    if (agentConfigs.image.adapter === "webhook" && !validAgentEndpoint(agentConfigs.image.endpoint)) {
      setConfiguringRole("image");
      setError("请先配置生图 AI 的 Webhook");
      return;
    }
    const run = Date.now();
    const actionId = `image:${scene.id}`;
    sceneActionRef.current = actionId;
    setSceneAction({ id: scene.id, type: "image" });
    runRef.current = run;
    setError("");
    updateScene(scene.id, { status: "painting" });
    recordActivity("image", `${agentName("image")}正在重绘“${scene.title}”`);
    try {
      if (scene.imageUrl) URL.revokeObjectURL(scene.imageUrl);
      if (agentConfigs.image.adapter !== "horde") {
        const presentCast = characters.filter((character) => isVisualCharacterAsset(character) && (scene.characters.includes(character.name) || scene.speaker === character.name));
        const frame = await pollinationsMedia("image", `${frameVisualPrompt(style)}, one coherent scene, preserve the exact identities and costumes from references, ${scene.shot}, ${scene.visual}, ${scene.action}, expressive face, natural anatomy and hands, layered depth, no text, no speech bubbles, no panel borders`, index, { references: presentCast.map((item) => item.remoteUrl).filter(Boolean) as string[] });
        const revisionUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
        const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : revisionUploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${index + 1}-revision.png`, revisionUploadKey) : "";
        updateScene(scene.id, { imageUrl: frame.url, remoteImageUrl, videoUrl: undefined, status: "ready" });
        autoArchive(frame.url, `${projectTitle}-${scene.title}-分镜`, "scene", scene.duration, ["自动生成", "分镜", scene.id]);
      } else {
        const characterGuide = characters.filter((character) => isVisualCharacterAsset(character) && scene.characters.includes(character.name)).map((character) => `${character.name}: ${character.appearance}`).join("; ");
        const imageUrl = await makeImage(scene, index, run, characterGuide);
        updateScene(scene.id, { imageUrl, videoUrl: undefined, status: "ready" });
      }
      recordActivity("image", `“${scene.title}”的新画面已交付`, "done");
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "画面生成失败");
      recordActivity("image", `“${scene.title}”重绘失败`, "error");
    } finally {
      if (sceneActionRef.current === actionId) {
        sceneActionRef.current = "";
        setSceneAction(null);
      }
    }
  }

  async function generateVideo(scene: Scene) {
    if (sceneActionRef.current) return;
    if (agentConfigs.video.adapter === "browser") {
      setConfiguringRole("video");
      setError("当前是免费本地运镜样片，请为视频 AI 选择 Seedance 或自定义视频接口");
      return;
    }
    if (agentConfigs.video.adapter === "pollinations" && !agentKey("video").startsWith("pk_")) {
      setError("视频 AI 需要发布密钥");
      return;
    }
    if (agentConfigs.video.adapter === "seedance" && agentConfigs.video.apiKey.trim().length < 8) {
      setConfiguringRole("video");
      setError("即梦 Seedance 需要火山方舟 API Key");
      return;
    }
    if (agentConfigs.video.adapter === "webhook" && !validAgentEndpoint(agentConfigs.video.endpoint)) {
      setConfiguringRole("video");
      setError("请先配置视频 AI 的 Webhook");
      return;
    }
    const actionId = `video:${scene.id}`;
    sceneActionRef.current = actionId;
    setSceneAction({ id: scene.id, type: "video" });
    setError("");
    updateScene(scene.id, { status: "animating" });
    recordActivity("video", `${agentName("video")}正在重做“${scene.title}”的动态表演`);
    try {
      const clip = await pollinationsMedia("video", `${motionVisualPrompt(style)}, preserve exact character identity and costume. ${scene.action}. Camera: ${scene.camera}. Natural expressions and coherent motion, one continuous shot, no text.`, 0, { references: await videoReferences(scene), duration: scene.duration, resumeKey: scene.id });
      if (scene.videoUrl) URL.revokeObjectURL(scene.videoUrl);
      updateScene(scene.id, { videoUrl: clip.url, status: "ready", duration: Math.max(4, Math.min(15, scene.duration)) });
      autoArchive(clip.url, `${projectTitle}-${scene.title}-视频`, "video", Math.max(4, Math.min(15, scene.duration)), ["自动生成", "视频", scene.id]);
      recordActivity("video", `“${scene.title}”的原生动态镜头已交付`, "done");
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "动态镜头生成失败");
      recordActivity("video", `“${scene.title}”视频生成失败`, "error");
    } finally {
      if (sceneActionRef.current === actionId) {
        sceneActionRef.current = "";
        setSceneAction(null);
      }
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

  function importedScene(name: string, index: number): Scene {
    const lead = characters[0]?.name || "主角";
    return { id: uid(), title: name.replace(/\.[^.]+$/, "").slice(0, 60) || `导入镜头 ${index + 1}`, visual: "用户导入的镜头资产", action: "根据导入素材延续自然动作与镜头表现", shot: "中景", camera: "缓慢推进", dialogue: "", speaker: lead, emotion: "自然", sfx: "", characters: lead === "主角" ? [] : [lead], duration: 6, status: "ready", motion: "push", motionIntensity: 1, transition: "fade", filter: "none", speed: 1, volume: 1, subtitleEnabled: true, subtitlePosition: "bottom", model: "本机资产库" };
  }

  function applyLibraryAssets(imported: LibraryAsset[]) {
    if (!imported.length) return;
    let nextCharacters = characters.map((item) => ({ ...item }));
    let nextScenes = scenes.map((item) => ({ ...item }));
    let characterIndex = 0;
    let imageIndex = 0;
    let videoIndex = 0;
    let audioIndex = 0;
    for (const asset of imported) {
      if (!asset.url) continue;
      const looksLikeCharacter = asset.mediaType === "image" && (asset.category === "character" || /角色|人物|character|turnaround|三视图|四视图/i.test(asset.name));
      if (looksLikeCharacter) {
        const existing = nextCharacters[characterIndex];
        if (existing) nextCharacters[characterIndex] = { ...existing, imageUrl: asset.url, sheetVersion: 2, status: "ready" };
        else nextCharacters.push({ id: uid(), name: asset.name.replace(/\.[^.]+$/, "").slice(0, 30) || `角色 ${characterIndex + 1}`, role: "用户导入角色", appearance: "以用户导入的角色设定图为唯一外观参考", voice, imageUrl: asset.url, sheetVersion: 2, status: "ready" });
        characterIndex += 1;
        continue;
      }
      const field = asset.mediaType === "image" ? "imageUrl" : asset.mediaType === "video" ? "videoUrl" : "audioUrl";
      const slot = asset.mediaType === "image" ? imageIndex++ : asset.mediaType === "video" ? videoIndex++ : audioIndex++;
      while (nextScenes.length <= slot) nextScenes.push(importedScene(asset.name, nextScenes.length));
      const target = nextScenes[slot];
      nextScenes[slot] = { ...target, [field]: asset.url, duration: asset.duration > 0 ? Math.max(1, Math.min(30, asset.duration)) : target.duration, status: "ready", model: "本机资产库" };
    }
    setCharacters(nextCharacters);
    setScenes(nextScenes);
    setSelected(0);
    setPhase("ready");
    setError("");
    invalidateExport();
    setImportMessage(`已导入 ${imported.length} 项资产；角色图、分镜图、视频和音频会分别跳过对应生成步骤`);
    void Promise.all(imported.map((asset) => markLibraryAssetUsed(asset.id))).catch(() => undefined);
    recordActivity("image", `已从独立资产库导入 ${imported.filter((item) => item.mediaType === "image").length} 项图片资产`, "done");
    if (imported.some((item) => item.mediaType === "video")) recordActivity("video", "用户视频资产已锁定，生成时自动跳过已有镜头", "done");
    if (imported.some((item) => item.mediaType === "audio")) recordActivity("voice", "用户音频资产已锁定，配音时自动跳过已有音轨", "done");
  }

  async function importScriptFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      let content = text.trim();
      if (file.name.toLowerCase().endsWith(".json")) {
        const payload = JSON.parse(text) as Record<string, unknown>;
        content = String(payload.script || payload.story || payload.premise || payload.content || "").trim();
      }
      if (content.length < 8) throw new Error("剧本内容太短或文件格式不正确");
      setStory(content.slice(0, 50000));
      setScriptImported(true);
      setImportMessage(`已导入剧本“${file.name}”；AI 不再改写剧情，只在缺少分镜时负责结构化拆镜`);
      recordActivity("writer", "用户剧本已导入，原创编剧步骤已跳过", "done");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本导入失败");
    }
  }

  async function importStoryboardFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as Record<string, unknown>;
      const storyboard = parseStoryboard(text, Number(payload.duration) || productionDuration, 1);
      const rawScenes = Array.isArray(payload.scenes) ? payload.scenes as Array<Record<string, unknown>> : [];
      const rawCharacters = Array.isArray(payload.characters) ? payload.characters as Array<Record<string, unknown>> : [];
      const importedScenes = storyboard.scenes.map((scene, index) => {
        const source = rawScenes[index] || {};
        const imageUrl = String(source.imageUrl || source.image || "");
        const videoUrl = String(source.videoUrl || source.video || "");
        const audioUrl = String(source.audioUrl || source.audio || "");
        return { ...scene, imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined, videoUrl: /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined, audioUrl: /^https?:\/\//i.test(audioUrl) ? audioUrl : undefined, status: imageUrl || videoUrl || audioUrl ? "ready" as SceneStatus : "queued" as SceneStatus };
      });
      const importedCharacters = storyboard.characters.map((character, index) => {
        const reference = String(rawCharacters[index]?.imageUrl || rawCharacters[index]?.reference || "");
        return { ...character, imageUrl: /^https?:\/\//i.test(reference) ? reference : undefined, remoteUrl: /^https?:\/\//i.test(reference) ? reference : undefined, sheetVersion: reference ? 2 as const : undefined, status: reference ? "ready" as const : character.status };
      });
      setProjectTitle(String(payload.title || storyboard.title).slice(0, 60));
      if (payload.premise || payload.story) { setStory(String(payload.premise || payload.story).slice(0, 50000)); setScriptImported(true); }
      if (payload.aspect === "9:16" || payload.aspect === "16:9") setAspect(payload.aspect);
      if (typeof payload.style === "string" && STYLE_PROMPTS[payload.style]) setStyle(payload.style);
      setMusicPrompt(String(payload.music || storyboard.music));
      setCharacters(importedCharacters);
      setScenes(importedScenes);
      setSelected(0);
      setPhase("ready");
      setProgress(15);
      setError("");
      invalidateExport();
      setImportMessage(`已导入 ${importedScenes.length} 个分镜；编剧和导演步骤会自动跳过`);
      recordActivity("writer", "用户分镜已导入，编剧步骤已跳过", "done");
      recordActivity("director", "使用用户锁定分镜，导演复核步骤已跳过", "done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜导入失败");
    }
  }

  async function importProductionAssets(files: FileList | null) {
    if (!files?.length) return;
    try {
      setImportMessage("正在保存资产到独立资产库…");
      const imported: LibraryAsset[] = [];
      for (const file of Array.from(files).slice(0, 40)) {
        const category: LibraryAssetCategory = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : /角色|人物|character|turnaround|三视图|四视图/i.test(file.name) ? "character" : "scene";
        imported.push(await saveLibraryFile(file, { category }));
      }
      applyLibraryAssets(imported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产导入失败");
    }
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
    const payload = { format: "manjing-project", version: 1, savedAt: new Date().toISOString(), projectTitle, story, style, targetDuration, aspect, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, characters: characters.map(({ imageUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined })), scenes: scenes.map(({ imageUrl, videoUrl, audioUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined, videoUrl: videoUrl?.startsWith("http") ? videoUrl : undefined, audioUrl: audioUrl?.startsWith("http") ? audioUrl : undefined })) };
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
      setScriptImported(true);
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
    const exportRun = runRef.current;
    let activeStream: MediaStream | null = null;
    let activeAudioContext: AudioContext | null = null;
    let activeRecorder: MediaRecorder | null = null;
    let activeVisuals: Array<HTMLImageElement | HTMLVideoElement> = [];
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
      const visuals: Array<HTMLImageElement | HTMLVideoElement> = [];
      for (let index = 0; index < movieScenes.length; index += 1) {
        if (runRef.current !== exportRun) throw new Error("导出已取消");
        setStatusText(`正在加载剪辑素材 ${index + 1}/${movieScenes.length}`);
        visuals.push(await loadVisual(movieScenes[index]));
        if (index % 2 === 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      activeVisuals = visuals;
      const audioContext = new AudioContext();
      activeAudioContext = audioContext;
      const destination = audioContext.createMediaStreamDestination();
      const buffers: Array<AudioBuffer | null> = [];
      for (let index = 0; index < movieScenes.length; index += 1) {
        if (runRef.current !== exportRun) throw new Error("导出已取消");
        const scene = movieScenes[index];
          if (!voiceEnabled || !scene.audioUrl) buffers.push(null);
        else {
          const response = await fetch(scene.audioUrl);
          if (!response.ok) throw new Error(`无法读取第 ${index + 1} 个镜头的配音`);
          buffers.push(await audioContext.decodeAudioData(await response.arrayBuffer()));
        }
        if (index % 2 === 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      const soundtrackBuffer = sourceMusicUrl
        ? await audioContext.decodeAudioData(await (await fetch(sourceMusicUrl)).arrayBuffer())
        : null;
      const canvasStream = canvas.captureStream(30);
      const stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
      activeStream = stream;
      const choices = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
      const mimeType = choices.find((choice) => MediaRecorder.isTypeSupported(choice)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : undefined);
      activeRecorder = recorder;
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
      await new Promise<void>((resolve, reject) => {
        const render = (now: number) => {
          if (runRef.current !== exportRun) {
            reject(new Error("导出已取消"));
            return;
          }
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
          if (subtitleEnabled && scene.subtitleEnabled !== false && scene.dialogue) {
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
      activeRecorder = null;
      visuals.forEach((item) => { if (item instanceof HTMLVideoElement) item.pause(); });
      stream.getTracks().forEach((track) => track.stop());
      activeStream = null;
      await audioContext.close();
      activeAudioContext = null;
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
      await syncScenesToEditor(movieScenes, url, "studio");
      return true;
    } catch (reason) {
      if (runRef.current !== exportRun) {
        setPhase(movieScenes.length ? "ready" : "idle");
        setStatusText("已停止视频合成，现有镜头和素材均已保留");
        return false;
      }
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "视频导出失败");
      return false;
    } finally {
      activeVisuals.forEach((item) => { if (item instanceof HTMLVideoElement) item.pause(); });
      activeStream?.getTracks().forEach((track) => track.stop());
      if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop();
      if (activeAudioContext && activeAudioContext.state !== "closed") await activeAudioContext.close().catch(() => undefined);
    }
  }

  function downloadFilm() {
    if (!exportUrl) return;
    const anchor = document.createElement("a");
    anchor.href = exportUrl;
    anchor.download = `${projectTitle || "漫镜作品"}.${exportUrl && MediaRecorder.isTypeSupported("video/mp4") ? "mp4" : "webm"}`;
    anchor.click();
  }

  const busy = Boolean(retryingRole) || libtvRunning || !["idle", "ready", "error"].includes(phase);
  const visibleProgress = phase === "exporting" ? exportProgress : progress;
  const failedRole = AGENT_ROLES.find((role) => activityByRole[role.id]?.state === "error")?.id;
  const selectedScene = scenes[selected];
  const nativeVideoEnabled = agentConfigs.video.adapter !== "browser";
  const generatedVoiceEnabled = agentConfigs.voice.adapter !== "browser";
  const freeTeamActive = AGENT_ROLES.every(({ id }) => agentConfigs[id].preset === AGENT_PRESETS[id][0].id);
  const recommendedTeamActive = AGENT_ROLES.every(({ id }) => agentConfigs[id].preset === AGENT_PRESETS[id][1].id);
  const previewFilter = current?.filter === "warm" ? "sepia(.14) saturate(1.12)" : current?.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : current?.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";

  return (
    <main id="top" className={`${surface}-surface`}>
      <SiteNav current="studio" />
      <StudioProjectBinding />

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
            <textarea id="story" value={story} onChange={(event) => setStory(event.target.value)} maxLength={50000} placeholder="输入故事梗概，或者在下方直接导入完整剧本……" />
            <div className="text-meta"><button onClick={() => { setStory("末班地铁上，女孩发现对面的乘客竟是十年后的自己。车门打开前，她只有三分钟改变人生。"); setScriptImported(false); }}>换一个灵感</button><span>{story.length} / 50000</span></div>
          </div>
          <div className="settings-panel">
            <section className={`studio-voice-setting ${voiceEnabled ? "enabled" : "disabled"}`}>
              <header>
                <div><span>一键配音</span><b>一键漫剧自动配音</b><small>{voiceEnabled ? "已开启 · 生成分角色对白并写入最终成片" : "已关闭 · 不生成人物对白/旁白，仍保留环境音与背景音乐设置"}</small></div>
                <button type="button" className={`toggle ${voiceEnabled ? "on" : ""}`} aria-label="一键漫剧自动配音" aria-pressed={voiceEnabled} onClick={() => setVoiceEnabled((value) => !value)}><i /></button>
              </header>
              <div className="studio-voice-provider"><span>当前配音岗位</span><b>{agentName("voice")}</b><em>{generatedVoiceEnabled ? "生成可下载音轨" : "仅设备语音预览"}</em></div>
              {voiceEnabled && generatedVoiceEnabled && <label className="studio-voice-select">默认音色<select aria-label="一键漫剧配音音色" value={voice} onChange={(event) => setVoice(event.target.value)}>{VOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
              {voiceEnabled && !generatedVoiceEnabled && <p>免费默认配音只能在设备上预览；若要把声音写进成片，请在下方“配音 AI”岗位选择 Pollinations、CosyVoice、VibeVoice 或自定义配音接口。</p>}
            </section>
            <div className="style-library-head"><label>视觉风格</label><span>16 种 · 写实 / 动画 / 艺术</span></div>
            <div className="style-library" role="list" aria-label="漫剧视觉风格库">{STYLE_PRESETS.map((item) => <button type="button" role="listitem" key={item.name} className={`style-card ${style === item.name ? "active" : ""}`} onClick={() => setStyle(item.name)} aria-pressed={style === item.name}>
              <img src={item.preview} alt="" loading="lazy" />
              <span><b>{item.name}</b><em>{item.category}</em></span>
              <small>{item.description}</small>
            </button>)}</div>
            <div className="duration-setting">
              <div><label htmlFor="target-duration">目标时长</label><b>{targetDuration === 0 ? "自动" : formatTime(targetDuration)}</b></div>
              <input id="target-duration" type="range" min={0} max={120} step={5} value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))} />
              <small><span>0 秒</span><span>{targetDuration === 0 ? "自动判断剧情长度" : "拖动选择成片长度"}</span><span>2 分钟</span></small>
            </div>
            <div className="aspect-setting"><label>画面比例</label><select value={aspect} onChange={(event) => setAspect(event.target.value as "9:16" | "16:9")}><option value="9:16">竖屏 9:16</option><option value="16:9">横屏 16:9</option></select></div>
            <div className="aspect-setting"><label>视频清晰度</label><select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value as "480p" | "720p" | "1080p")}><option value="480p">流畅 480P</option><option value="720p">高清 720P</option><option value="1080p">全高清 1080P</option></select></div>
            <div className="voice-row"><div><label>背景音乐</label><small>独立控制无歌词 BGM；关闭人物配音后仍保留环境音效</small></div><button className={`toggle ${bgmEnabled ? "on" : ""}`} aria-label="切换背景音乐" onClick={() => setBgmEnabled((value) => !value)}><i /></button></div>
            <div className="voice-row subtitle-master-row"><div><label>成片字幕</label><small>独立控制预览、时间轴和最终视频字幕，不影响配音与原声</small></div><button className={`toggle ${subtitleEnabled ? "on" : ""}`} aria-label="切换成片字幕" aria-pressed={subtitleEnabled} onClick={() => setSubtitleEnabled((value) => !value)}><i /></button></div>
          </div>
        </div>

        <div className="production-import-hub">
          <div className="production-import-heading"><div><span>导入已有素材</span><h3>已有内容直接导入，不重复生成</h3><p>剧本、分镜、角色图、场景图、视频和配音都能作为生产起点；一键流程只补齐缺少的部分。</p></div><Link href="/assets">打开独立资产库 ↗</Link></div>
          <div className="production-import-actions">
            <label><i>文</i><span><b>导入剧本</b><small>TXT / MD / JSON · 跳过原创编剧</small></span><input type="file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onChange={(event) => { void importScriptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <label><i>镜</i><span><b>导入分镜</b><small>漫镜 JSON · 跳过编剧和导演</small></span><input type="file" accept=".json,application/json" onChange={(event) => { void importStoryboardFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <label><i>资</i><span><b>导入本机资产</b><small>图片 / 视频 / 音频 · 自动分类保存</small></span><input type="file" multiple accept="image/*,video/*,audio/*" onChange={(event) => { void importProductionAssets(event.target.files); event.currentTarget.value = ""; }} /></label>
          </div>
          <div className="production-import-state"><b>{scenes.length ? `${scenes.length} 个分镜` : scriptImported ? "剧本已锁定" : "等待导入"}</b><span>{importMessage}</span><div><em className={scriptImported ? "ready" : ""}>剧本</em><em className={scenes.length ? "ready" : ""}>分镜</em><em className={characters.some((item) => item.imageUrl) ? "ready" : ""}>角色</em><em className={scenes.some((item) => item.imageUrl) ? "ready" : ""}>画面</em><em className={scenes.some((item) => item.videoUrl) ? "ready" : ""}>视频</em><em className={scenes.some((item) => item.audioUrl) ? "ready" : ""}>声音</em></div></div>
        </div>

        <div className="ai-team">
          <div className="ai-team-heading"><div><span>AI 制片组</span><h3>六个岗位，各自调用自己的模型</h3><p>编剧先交稿，导演复核；画面、视频和声音分工生产，最后由剪辑 AI 形成成片。</p></div><div className="team-profiles"><button className={freeTeamActive ? "active" : ""} onClick={() => applyTeamProfile("free")}>免费默认阵容</button><button className={recommendedTeamActive ? "active" : ""} onClick={() => applyTeamProfile("pollinations")}>一键应用推荐阵容</button></div></div>
          <div className="agent-grid">
            {AGENT_ROLES.map((role) => {
              const config = agentConfigs[role.id];
              const presets = AGENT_PRESETS[role.id];
              const roleCustomModels = customModels.filter((item) => item.role === role.id);
              return <article key={role.id} className={`agent-card ${config.adapter}`}>
                <div className="agent-card-top"><i>{role.icon}</i><div><b>{role.title}</b><span>{role.duty}</span></div><em>{config.adapter === "horde" || config.adapter === "browser" ? "免费" : CUSTOM_TEXT_ADAPTERS.includes(config.adapter) ? "自定义" : config.adapter === "seedance" ? "官方" : "已托管"}</em></div>
                <select aria-label={`选择${role.title}`} value={config.preset} onChange={(event) => selectAgentPreset(role.id, event.target.value)}><optgroup label="漫镜预设">{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.model}</option>)}</optgroup>{config.preset === `direct-${role.id}` && <optgroup label="当前配置"><option value={config.preset}>{config.adapter === "seedance" ? `${/seedance-2/i.test(config.model) ? "Seedance 2.0" : "Seedance"} · 方舟 · ${config.model}` : `手动 API 配置 · ${config.model || "待选择模型"}`}</option></optgroup>}{roleCustomModels.length > 0 && <optgroup label="我的模型">{roleCustomModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.model}</option>)}</optgroup>}</select>
                <div className="agent-model"><span>当前模型</span><b>{config.model}</b><small>{presets.find((item) => item.id === config.preset)?.note || roleCustomModels.find((item) => item.id === config.preset)?.note}</small></div>
                <div className="recommend-row"><span>推荐</span>{role.recommends.map((item) => <i key={item}>{item}</i>)}</div>
                <button className="agent-config-button" onClick={() => setConfiguringRole(configuringRole === role.id ? null : role.id)}>{configuringRole === role.id ? "收起设置" : "配置模型与接口"}</button>
                {configuringRole === role.id && <div className="agent-config-panel">
                  <label>自定义 API 模式<select aria-label={`${role.title}自定义 API 模式`} value={apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode) ? config.adapter : ""} onChange={(event) => { if (event.target.value) changeDirectApiMode(role.id, event.target.value as DiscoverableApiMode); }}><option value="">请选择 API 模式</option>{apiModesForRole(role.id).map((modeName) => <option key={modeName} value={modeName}>{API_MODE_LABELS[modeName]}</option>)}</select></label>
                  <label>模型 ID<input value={config.model} onChange={(event) => updateAgentConfig(role.id, { model: event.target.value })} placeholder="模型名称或 ID" /></label>
                  {CUSTOM_TEXT_ADAPTERS.includes(config.adapter) && <label>API 地址<input value={config.endpoint} onChange={(event) => updateAgentConfig(role.id, { endpoint: event.target.value.trim() })} placeholder="https://... 或 http://localhost:端口" /></label>}
                  {(config.adapter === "pollinations" || CUSTOM_TEXT_ADAPTERS.includes(config.adapter) || config.adapter === "seedance") && <label>{config.adapter === "seedance" ? "火山方舟 API Key（必填）" : "岗位专用 API 密钥（可选）"}<input type="password" value={config.apiKey} onChange={(event) => updateAgentConfig(role.id, { apiKey: event.target.value.trim() })} onBlur={() => { if (config.apiKey.trim() && apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode)) void discoverCurrentAgentModels(role.id); }} placeholder={config.adapter === "pollinations" ? "留空则使用下方统一密钥" : config.adapter === "seedance" ? "火山方舟控制台生成的 API Key" : "粘贴后离开输入框将自动读取模型"} /></label>}
                  {apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode) && <button type="button" className="agent-api-discover" onClick={() => void discoverCurrentAgentModels(role.id)} disabled={roleModelLoading === role.id}>{roleModelLoading === role.id ? "正在连接并读取模型…" : "测试连接并读取该 API 的模型"}</button>}
                  {!!roleModelOptions[role.id]?.length && <label>该 API 返回的模型<select value={config.model} onChange={(event) => updateAgentConfig(role.id, { model: event.target.value })}>{roleModelOptions[role.id]?.map((item) => <option key={item.id} value={item.id}>{item.name === item.id ? item.id : `${item.name} · ${item.id}`}</option>)}</select></label>}
                  {["director", "writer", "editor"].includes(role.id) && CUSTOM_TEXT_ADAPTERS.includes(config.adapter) && <small>当前模式：{API_MODE_LABELS[config.adapter as DiscoverableApiMode]}。请求由独立版在本机直连；编剧/导演最长等待 120 秒，剪辑最长等待 90 秒，超时后可保留成果重新运行。</small>}
                  {role.id === "image" && config.adapter === "openai" && <small>OpenAI 生图模式会调用所填地址的 <code>/images/generations</code>，可用于 OpenAI 官方或兼容的生图服务。</small>}
                  {["image", "video", "voice"].includes(role.id) && config.adapter === "webhook" && <small>漫镜会 POST role、model、task 和输入内容；接口需返回媒体文件或可下载的 url。</small>}
                  {config.adapter === "seedance" && <small>通过漫镜的安全代理提交异步任务并轮询结果；密钥不写入网站服务器，只持久保存在这台电脑。</small>}
                  {apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode) && <button type="button" className="agent-api-save" onClick={() => void saveCurrentAgentApi(role.id)} disabled={roleSaveState.role === role.id && roleSaveState.state === "saving"}>{roleSaveState.role === role.id && roleSaveState.state === "saving" ? "正在保存…" : "保存此岗位 API 并立即应用"}</button>}
                  {roleSaveState.role === role.id && roleSaveState.message && <p className={`agent-api-status ${roleSaveState.state}`} role="status">{roleSaveState.message}</p>}
                  {roleCustomModels.length > 0 && <div className="agent-saved-models"><div><b>我的自定义模型</b><span>{roleCustomModels.length} 个</span></div>{roleCustomModels.map((model) => <article key={model.id}><span><b>{model.name}</b><small>{model.model} · {API_MODE_LABELS[model.adapter as DiscoverableApiMode] || model.adapter}</small></span><ConfirmButton onConfirm={() => deleteRoleCustomModel(role.id, model.id)} disabled={roleSaveState.role === role.id && roleSaveState.state === "saving"} ariaLabel={`删除自定义模型${model.name}`} confirmLabel="确认删除">删除</ConfirmButton></article>)}</div>}
                  <button type="button" className="add-custom-model-link" onClick={() => toggleQuickModel(role.id)}>{quickModelRole === role.id ? "－ 收起自定义模型" : `＋ 为${role.title}添加自定义模型`}</button>
                  {quickModelRole === role.id && <div className="quick-custom-model">
                    <div><b>添加到 {role.title}</b><small>选择模式 → 填写 API → 读取模型 → 提交应用</small></div>
                    <div className="quick-custom-grid">
                      <label>API 模式<select value={quickModelDraft.adapter} onChange={(event) => changeQuickApiMode(event.target.value as DiscoverableApiMode)}>{apiModesForRole(role.id).map((modeName) => <option key={modeName} value={modeName}>{API_MODE_LABELS[modeName]}</option>)}</select></label>
                      <label>API 接口地址<input value={quickModelDraft.endpoint} onChange={(event) => setQuickModelDraft((value) => ({ ...value, endpoint: event.target.value }))} placeholder={API_MODE_DEFAULT_ENDPOINTS[quickModelDraft.adapter] || "https://... 或 http://localhost:端口"} /></label>
                      <label>API Key（本机保存）<input type="password" value={quickModelDraft.apiKey} onChange={(event) => setQuickModelDraft((value) => ({ ...value, apiKey: event.target.value }))} onBlur={() => { if (quickModelDraft.apiKey.trim() && quickModelDraft.endpoint.trim()) void discoverQuickModels(); }} placeholder="粘贴后离开输入框将自动读取模型" /></label>
                      <button type="button" className="quick-model-discover" onClick={() => void discoverQuickModels()} disabled={quickModelLoading}>{quickModelLoading ? "正在连接并读取…" : "测试连接并读取模型列表"}</button>
                      {quickModelOptions.length > 0 && <label>接口返回的模型<select value={quickModelDraft.model} onChange={(event) => setQuickModelDraft((value) => ({ ...value, model: event.target.value }))}>{quickModelOptions.map((item) => <option key={item.id} value={item.id}>{item.name === item.id ? item.id : `${item.name} · ${item.id}`}</option>)}</select></label>}
                      <label>模型 ID（也可手动填写）<input value={quickModelDraft.model} onChange={(event) => setQuickModelDraft((value) => ({ ...value, model: event.target.value }))} placeholder="读取后自动填入，或手动输入" /></label>
                      <label>显示名称（可选）<input value={quickModelDraft.name} onChange={(event) => setQuickModelDraft((value) => ({ ...value, name: event.target.value }))} placeholder={`默认使用模型 ID，也可写“我的${role.title}”`} /></label>
                      <label>备注（可选）<input value={quickModelDraft.note} onChange={(event) => setQuickModelDraft((value) => ({ ...value, note: event.target.value }))} placeholder="能力或用途" /></label>
                    </div>
                    <button type="button" className="quick-custom-save" onClick={() => void saveQuickModel(role.id)} disabled={quickModelSaving || quickModelLoading}>{quickModelSaving ? "正在写入并应用…" : "提交、保存并应用到当前岗位"}</button>
                    {quickModelMessage && <p role="status" className="quick-custom-message">{quickModelMessage}</p>}
                  </div>}
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

        <div className="cloud-engine-hub">
          <div className="cloud-engine-heading"><div><span>制作引擎</span><h3>专业漫剧云引擎</h3><p>LibTV 负责从故事到成片的一键生产；Seedance 方舟 API 负责把单个分镜变成真正会动的视频。</p></div><em>配置持久保存在本机</em></div>
          <div className="cloud-engine-grid">
            <article className={`cloud-engine-card libtv-card ${libtvCanvasOpen && (libtvSessionId || libtvProjectUrl) ? "canvas-open" : ""}`}>
              <div className="engine-title"><i>剧</i><div><b>LibTV 一键漫剧</b><span>剧本 → 角色 → 分镜 → 视频 → 配音 → 成片</span></div><em>全流程</em></div>
              <p>直接调用 LibTV 官方 Agent 接口创建完整项目。生成过程可在漫镜查看，也可打开 LibTV 无限画布继续精修。</p>
              <label>LibTV Access Key<input type="password" value={libtvAccessKey} onChange={(event) => setLibtvAccessKey(event.target.value.trim())} placeholder="填写 LIBTV_ACCESS_KEY" /></label>
              <div className="engine-actions"><button onClick={() => void generateWithLibTv()} disabled={busy || story.trim().length < 8}>{libtvRunning ? "LibTV 正在制作…" : "一键生成完整 AI 漫剧"}</button><button className="secondary" onClick={createLibTvCanvas} disabled={libtvSending}>新建本机制片画布</button>{(libtvSessionId || libtvProjectUrl) && <button className="secondary" onClick={() => setLibtvCanvasOpen((value) => !value)}>{libtvCanvasOpen ? "收起 LibTV 进度" : "查看 LibTV 进度"}</button>}<a href="https://github.com/libtv-labs/libtv-skills" target="_blank" rel="noreferrer">官方 OpenAPI ↗</a></div>
              {libtvSessionId && <div className="engine-task"><b>云端任务已建立</b><span>{libtvSessionId}</span></div>}
              {!!libtvResults.length && <div className="engine-results">{libtvResults.slice(0, 8).map((item, index) => {
                const source = `/api/libtv?url=${encodeURIComponent(item.url)}`;
                return <a key={`${item.url}-${index}`} href={source} download={`libtv-${index + 1}.${item.kind === "video" ? "mp4" : "png"}`} title="下载素材">{item.kind === "video" ? <i className="video-thumbnail-placeholder">▶</i> : <img src={source} alt={`LibTV 生成素材 ${index + 1}`} loading="lazy" />}<span>{item.kind === "video" ? "视频" : "图片"} {index + 1}</span></a>;
              })}</div>}
              {libtvCanvasOpen && (libtvSessionId || libtvProjectUrl) && <div className="libtv-canvas">
                <div className="libtv-canvas-head"><div><span>实时生产画布</span><b>LibTV 制片画布</b><small>由官方会话消息与素材结果实时构建</small></div><div>{libtvRunning && <button onClick={toggleLibTvPolling}>{libtvPollingPaused ? "继续自动刷新" : "暂停自动刷新"}</button>}<button onClick={() => void refreshLibTvCanvas()} disabled={!libtvSessionId || libtvSending}>{libtvSending ? "刷新中…" : "立即刷新"}</button>{libtvProjectUrl && <a href={libtvProjectUrl} target="_blank" rel="noreferrer">进入官方无限画布 ↗</a>}</div></div>
                <div className="libtv-node-flow">
                  <article className={libtvMessages.length ? "done" : "running"}><i>1</i><b>剧本与导演</b><span>{libtvMessages.length ? "会话已建立" : "等待指令"}</span></article><em>→</em>
                  <article className={libtvResults.some((item) => item.kind === "image") ? "done" : libtvMessages.length ? "running" : ""}><i>2</i><b>角色与分镜</b><span>{libtvResults.filter((item) => item.kind === "image").length} 张画面</span></article><em>→</em>
                  <article className={libtvResults.some((item) => item.kind === "video") ? "done" : libtvResults.length ? "running" : ""}><i>3</i><b>动态与声音</b><span>{libtvResults.filter((item) => item.kind === "video").length} 段视频</span></article><em>→</em>
                  <article className={libtvResults.some((item) => item.kind === "video") ? "done" : ""}><i>4</i><b>剪辑与交付</b><span>{libtvResults.some((item) => item.kind === "video") ? "可导入剪辑台" : "等待上游"}</span></article>
                </div>
                <div className="libtv-canvas-grid"><div className="libtv-message-stream"><div><b>AI 工作过程</b><span>{libtvMessages.length} 条消息</span></div>{libtvMessages.length ? libtvMessages.slice(-20).reverse().map((message) => <p key={message.id} className={message.role}><i>{message.role === "user" ? "你" : "AI"}</i><span>{message.content}</span><small>#{message.seq}</small></p>) : <p className="empty"><i>AI</i><span>任务开始后，剧本、画面、视频和交付消息会显示在这里。</span></p>}</div><div className="libtv-command-panel"><b>继续指挥 LibTV</b><p>可在同一会话追加修改要求，例如重做某个镜头、换画风或调整节奏。</p><textarea value={libtvInstruction} onChange={(event) => setLibtvInstruction(event.target.value)} placeholder="例如：把第 3 个镜头改成近景，让角色有明显的转身和开口动作，并重新剪进成片。" /><button onClick={() => void sendLibTvInstruction()} disabled={libtvSending || libtvInstruction.trim().length < 8 || !libtvSessionId}>{libtvSending ? "正在发送…" : "发送到当前画布"}</button></div></div>
              </div>}
            </article>
            <article className="cloud-engine-card seedance-card">
              <div className="engine-title"><i>舞</i><div><b>Seedance · 火山方舟</b><span>官方文生视频 / 图生视频异步接口</span></div><em>镜头级</em></div>
              <p>应用到“视频 AI”岗位后，漫镜会把每张关键帧、人物动作和运镜提示逐镜提交给火山方舟。</p>
              <label>火山方舟 API Key<input type="password" value={seedanceApiKey} onChange={(event) => setSeedanceApiKey(event.target.value.trim())} placeholder="填写 ARK_API_KEY" /></label>
              <label>模型 ID 或 Endpoint ID<input value={seedanceModel} onChange={(event) => setSeedanceModel(event.target.value.trim())} placeholder="doubao-seedance-… 或 ep-…" /></label>
              <div className="engine-actions"><button onClick={applySeedanceEngine}>{agentConfigs.video.adapter === "seedance" ? "更新 Seedance 视频岗位" : "应用到视频 AI 岗位"}</button><a href="https://www.volcengine.com/docs/82379/1520758" target="_blank" rel="noreferrer">方舟官方 API ↗</a><a href="https://www.volcengine.com/docs/85621/1756900" target="_blank" rel="noreferrer">即梦视觉 API ↗</a></div>
              <div className={`engine-active ${agentConfigs.video.adapter === "seedance" ? "on" : ""}`}><i />{agentConfigs.video.adapter === "seedance" ? `已启用：${agentConfigs.video.model}` : "尚未应用，当前视频岗位保持不变"}</div>
              <div className={`volc-sdk-state ${volcengineSdk?.installed ? "ready" : "checking"}`}><i>{volcengineSdk?.installed ? "✓" : "…"}</i><span><b>{volcengineSdk?.installed ? `火山引擎官方 SDK ${volcengineSdk.version} 已内置` : "正在检测内置火山 SDK"}</b><small>{volcengineSdk?.note || "Windows 独立版启动后自动加载，不需要用户另外安装或升级。"}</small></span></div>
              <p className="api-identity-note"><b>认证别混用：</b>Seedance 方舟视频生成按官方接口填写 ARK_API_KEY；内置 SDK 同时提供 AK/SK 签名能力。用户不需要在电脑上另外安装 SDK。</p>
            </article>
          </div>
          <p className="cloud-engine-note"><b>真实能力边界：</b>LibTV 和即梦的接口代码可以接入，但云端生成需要平台有效额度；漫镜不会伪装成免费算力，也不会把访问密钥写进部署配置。</p>
        </div>

        <div className="opensource-hub">
          <div className="opensource-heading"><div><span>本地开源节点</span><h3>开源本地节点中心</h3><p>统一连接 ComfyUI/Wan2.2、CosyVoice、MuseTalk、MoneyPrinterTurbo 与 VibeVoice。</p></div><div><a href="/manjing-local-bridge.zip" download>下载本地桥接服务</a><button onClick={applyBridgeStack}>应用中文基础节点</button></div></div>
          <div className="bridge-config"><label>桥接服务地址<input value={bridgeUrl} onChange={(event) => { setBridgeUrl(event.target.value.trim()); setBridgeHealth({ state: "idle", message: "地址已修改，等待检测" }); }} placeholder="https://你的桥接地址 或 http://127.0.0.1:8765" /></label><label>桥接密钥<input type="password" value={bridgeToken} onChange={(event) => setBridgeToken(event.target.value.trim())} placeholder="与本地 .env 中的 BRIDGE_TOKEN 相同" /></label><button onClick={() => void testBridgeConnection()} disabled={bridgeHealth.state === "testing"}>{bridgeHealth.state === "testing" ? "检测中…" : "检测连接"}</button><em className={bridgeHealth.state}>{bridgeHealth.message}</em></div>
          <div className="opensource-nodes">
            <article className={bridgeHealth.nodes?.comfyui ? "online" : "offline"}><div className="node-top"><i>影</i><div><b>ComfyUI · Wan2.2</b><span>生图、角色一致性、图生视频与人物动画</span></div><em>{bridgeHealth.nodes?.comfyui ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.workflows?.image ? "ready" : ""}>生图工作流</span><span className={bridgeHealth.workflows?.video ? "ready" : ""}>视频工作流</span></div><div className="node-actions"><button onClick={() => applyBridgeRole("image")}>用于生图岗位</button><button onClick={() => applyBridgeRole("video")}>用于视频岗位</button><a href="https://github.com/Wan-Video/Wan2.2" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.cosyvoice ? "online" : "offline"}><div className="node-top"><i>声</i><div><b>CosyVoice</b><span>中文角色配音、情绪指令与声音复刻</span></div><em>{bridgeHealth.nodes?.cosyvoice ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.nodes?.cosyvoice ? "ready" : ""}>FastAPI 服务</span><span>本机生成音轨</span></div><div className="node-actions"><button onClick={() => applyBridgeRole("voice")}>用于配音岗位</button><a href="https://github.com/FunAudioLLM/CosyVoice" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.musetalk ? "online" : "offline"}><div className="node-top"><i>口</i><div><b>MuseTalk 1.5</b><span>在配音完成后，为人物镜头生成中文口型</span></div><em>{bridgeHealth.nodes?.musetalk ? "在线" : "未检测"}</em></div><div className="lipsync-toggle"><div><b>生成后自动做口型</b><span>失败时保留原视频，不中断整片</span></div><button className={`toggle ${lipsyncEnabled ? "on" : ""}`} onClick={() => setLipsyncEnabled((value) => !value)}><i /></button></div><div className="node-actions"><a href="https://github.com/TMElyralab/MuseTalk" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.moneyprinter ? "online" : "offline"}><div className="node-top"><i>剪</i><div><b>MoneyPrinterTurbo</b><span>把工作台素材顺序拼接、配音、字幕并自动出片</span></div><em>{bridgeHealth.nodes?.moneyprinter ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.nodes?.moneyprinter ? "ready" : ""}>官方任务 API</span><span>FFmpeg 成片</span></div><div className="node-actions"><a href="/editor">前往剪辑台使用</a><a href="https://github.com/harry0703/MoneyPrinterTurbo" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.vibevoice ? "online" : "offline"}><div className="node-top"><i>语</i><div><b>VibeVoice Realtime</b><span>微软 0.5B 流式配音，实验性英文单角色节点</span></div><em>{bridgeHealth.nodes?.vibevoice ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.nodes?.vibevoice ? "ready" : ""}>24 kHz 实时音频</span><span className={bridgeHealth.nodes?.vibevoice_asr ? "ready" : ""}>ASR 可选</span></div><div className="node-actions"><button onClick={applyVibeVoiceRole}>用于配音岗位</button><a href="https://github.com/microsoft/VibeVoice" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
          </div>
          <p className="opensource-note"><b>免费指代码或模型可自托管，不代表显卡与第三方服务免费。</b>VibeVoice Realtime 目前主要面向英文单角色；中文多角色优先使用 CosyVoice。MoneyPrinterTurbo 和大型视频模型需要本机 FFmpeg、模型与相应算力，所有开源节点均为可选。</p>
        </div>

        <div className="generate-row">
          <button className="generate-button" onClick={generateAll} disabled={busy || story.trim().length < 8}><span>✦</span>{busy ? "AI 制片组正在协作" : nativeVideoEnabled ? "让 AI 制片组生成漫剧" : "让免费 AI 制片组生成样片"}<small>导演审片 + 编剧分镜 + 图像 + 视频 + 配音 + 剪辑</small></button>
          {busy && <button className="cancel-button" onClick={cancelGeneration}>{phase === "exporting" ? "停止合成" : "停止"}</button>}
        </div>
        {(phase !== "idle" || error) && <div className={`job-status ${error ? "has-error" : ""}`}><div className="status-copy"><div><b>{error || statusText}</b><span>{error ? "已完成成果仍然保留，可重新运行中断的岗位。" : `${visibleProgress}%`}</span></div>{error && failedRole && <button type="button" className="job-retry-button" onClick={() => void rerunRole(failedRole)} disabled={busy}>{retryingRole === failedRole ? "重新运行中…" : `重新运行${AGENT_ROLES.find((role) => role.id === failedRole)?.title}`}</button>}</div><div className="status-bar"><i style={{ width: `${visibleProgress}%` }} /></div><div className="status-steps"><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>编剧</span><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>导演</span><span className={["characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>生图</span><span className={["video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>{nativeVideoEnabled ? "视频" : "运镜"}</span><span className={["voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>配音</span><span className={["exporting", "ready"].includes(phase) ? "active" : ""}>剪辑</span></div></div>}
        {(activityLog.length > 0 || busy) && <div className="workflow-monitor">
          <div className="workflow-heading"><div><b>AI 制作现场</b><span>每个岗位正在做什么、用了哪个模型、交付了什么，都实时记录</span></div><em>{busy ? "制作直播中" : "本次流程已保存"}</em></div>
          <div className="workflow-roles">{AGENT_ROLES.map((role) => {
            const latest = activityByRole[role.id];
            return <article key={role.id} className={latest?.state || "waiting"}><i>{role.icon}</i><div><b>{role.title}</b><span>{latest?.message || "等待上游交付"}</span><small>{agentName(role.id)}</small></div><aside><em>{latest?.state === "running" ? "工作中" : latest?.state === "done" ? "已交付" : latest?.state === "warning" ? "已降级" : latest?.state === "error" ? "中断" : "等待"}</em><button type="button" onClick={() => void rerunRole(role.id)} disabled={busy || !canRerunRole(role.id)} aria-label={`重新运行${role.title}`}>{retryingRole === role.id ? "运行中…" : latest?.state === "error" ? "重新运行" : "再运行"}</button></aside></article>;
          })}</div>
          <div className="workflow-log"><b>制作记录</b><div>{activityLog.length ? activityLog.map((item) => <p key={item.id} className={item.state}><time>{item.time}</time><span>{AGENT_ROLES.find((role) => role.id === item.role)?.title}</span>{item.message}</p>) : <p><time>--:--</time><span>制片组</span>任务开始后，这里会显示每一步真实进度</p>}</div></div>
        </div>}
      </section>

      <section className="production-pipeline-map section-shell" aria-label="漫剧生产流程">
        <header><div><span>PRODUCTION PIPELINE</span><h2>从剧本到成片，不再把每一镜当成独立抽卡</h2></div><p>镜头计划、资产标准、连续状态和声音档案贯穿整个项目；只有审核通过的结果才进入长期资产。</p></header>
        <div className="pipeline-stages">
          <article><i>01</i><b>项目圣经</b><small>世界观、人物关系、时间线、视觉与声音规则</small></article>
          <article><i>02</i><b>剧集拆解</b><small>场次、叙事节拍、对白、目标时长</small></article>
          <article><i>03</i><b>资产规划</b><small>角色身份、造型版本、地点、关键道具、角色声音</small></article>
          <article><i>04</i><b>镜头设计</b><small>景别、机位、调度、起止状态，不强制生成分镜图</small></article>
          <article><i>05</i><b>镜头生产</b><small>按模型能力选择文生视频、参考图或首尾帧模式</small></article>
          <article><i>06</i><b>连续性审核</b><small>身份、造型、空间、道具、动作与光线质量门</small></article>
          <article><i>07</i><b>声音后期</b><small>角色音色、对白、口型、音效、配乐与字幕</small></article>
          <article><i>08</i><b>剪辑交付</b><small>节奏调整、失败镜头替换、混音与成片导出</small></article>
        </div>
      </section>

      <section id="works" className="works section-shell">
        <div className="section-heading"><span>02</span><div><p>剪辑工作台</p><input className="workbench-project-title" aria-label="修改作品标题" value={scenes.length ? projectTitle : "生成后在这里剪辑"} disabled={!scenes.length} onChange={(event) => setProjectTitle(event.target.value)} onBlur={(event) => { const title = event.target.value.trim() || "未命名作品"; setProjectTitle(title); const raw = window.localStorage.getItem("manjing-active-series-context-v1"); if (raw) { try { const context = JSON.parse(raw); window.localStorage.setItem("manjing-active-series-context-v1", JSON.stringify({ ...context, productionTitle: title })); } catch { /* workspace autosave still preserves the title */ } } }} /></div><aside>{scenes.length ? `${scenes.length} 个镜头 · ${formatTime(totalDuration)}` : "尚无作品"}</aside></div>
        {scenes.some((scene) => scene.consistencyReport) && <div className="consistency-dashboard"><header><div><span>CONSISTENCY ENGINE</span><h3>镜头一致性报告</h3></div><b>{Math.round(scenes.filter((scene) => scene.consistencyReport).reduce((sum, scene) => sum + (scene.consistencyReport?.overall || 0), 0) / Math.max(1, scenes.filter((scene) => scene.consistencyReport).length))}<small>/100 平均</small></b></header><div>{scenes.filter((scene) => scene.consistencyReport).map((scene, index) => <article key={scene.id} className={scene.consistencyDecision || "review"}><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{scene.title}</strong><small>{scene.consistencyReport?.mode === "vision" ? "视觉审核" : "结构检查"} · {scene.consistencyReport?.findings[0] || "未发现明显问题"}</small></span><em>{scene.consistencyReport?.overall}</em><b>{scene.consistencyDecision?.toUpperCase()}</b></article>)}</div></div>}
        {characters.some(isVisualCharacterAsset) && <div className="production-assets">
          <div className="asset-heading"><div><b>角色资产库</b><span>仅为实际出镜人物生成大头照与正、侧、背三视图；旁白和广告声只保留声音档案</span></div><em>{characters.filter((item) => isVisualCharacterAsset(item) && item.status === "ready").length}/{characters.filter(isVisualCharacterAsset).length} 已锁定</em></div>
          <div className="character-list">{characters.filter(isVisualCharacterAsset).map((character) => <article key={character.id} className={character.status}>
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
            <button className="send-to-editor" onClick={() => void openInProfessionalEditor()} disabled={editorSyncState === "saving"}><i>剪</i><span><b>{editorSyncState === "saving" ? `正在逐个整理素材 ${editorSyncProgress}%` : "进入专业剪辑台"}</b><small>{editorSyncState === "ready" ? "AI 工程已同步，可继续精剪" : "自动带入视频、图片、配音和字幕"}</small></span></button>
          </div>
          <div className="media-bin">{scenes.map((scene, index) => <article key={scene.id} className={selected === index ? "selected" : ""} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}>
            <div className="media-bin-thumb">{scene.imageUrl ? <img src={scene.imageUrl} alt="" loading="lazy" /> : scene.videoUrl ? <span className="video-thumbnail-placeholder">▶</span> : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
            <div><b>{String(index + 1).padStart(2, "0")} · {scene.title}</b><small>{scene.videoUrl ? "原生视频" : scene.imageUrl ? "2.5D 图片镜头" : "等待画面"} · {scene.duration} 秒</small></div>
            <div className="media-downloads">{scene.imageUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.imageUrl as string, `${projectTitle}-${index + 1}-${scene.title}`, "png"); }}>图片</button>}{scene.videoUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.videoUrl as string, `${projectTitle}-${index + 1}-${scene.title}`, "mp4"); }}>视频</button>}{scene.audioUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.audioUrl as string, `${projectTitle}-${index + 1}-${scene.speaker}-配音`, "mp3"); }}>配音</button>}</div>
          </article>)}</div>
          <div className="delivery-note"><b>{nativeVideoEnabled ? "当前使用原生视频模型" : "为什么现在人物不会真正动？"}</b><span>{nativeVideoEnabled ? "每个带“原生视频”标记的镜头都由视频 AI 生成，可单独下载和替换。" : "免费默认视频岗位没有调用人物动画模型，只对静态图做 2.5D 推拉、横移、景深和光影动画。若需要人物口型、走路和表演，请把“视频 AI”切换到 Seedance 或自定义视频接口。"}</span></div>
        </div>}
        {!scenes.length ? <div className="empty-work"><div className="empty-orbit"><span>✦</span></div><h3>你的第一部漫剧还没开机</h3><p>在上方输入故事并点击“一键生成 AI 漫剧”，完成后这里会直接出现可播放成片。</p></div> : <><div className="workbench">
          <div className="preview-column">
            <div className={`stage ${aspect === "9:16" ? "portrait" : "landscape"} ${showFilm && exportUrl ? "film-ready" : ""}`}>
              {showFilm && exportUrl ? <video src={exportUrl} preload="metadata" controls autoPlay playsInline muted={!generatedVoiceEnabled || !voiceEnabled} /> : current?.videoUrl ? <video ref={videoRef} key={current.videoUrl} src={current.videoUrl} preload="metadata" muted loop playsInline style={{ filter: previewFilter }} /> : current?.imageUrl ? <img className={`motion-preview motion-${current.motion || "push"}`} key={current.imageUrl} src={current.imageUrl} alt={current.visual} style={{ filter: previewFilter, animationDuration: `${Math.max(3, current.duration)}s` }} /> : <div className="stage-placeholder"><span>{String(currentIndex + 1).padStart(2, "0")}</span><p>{current?.status === "animating" ? "视频 AI 正在生成角色动态表演" : current?.status === "painting" ? "生图 AI 正在绘制一致性关键帧" : "等待生成镜头"}</p></div>}
              {showFilm && exportUrl ? <div className="film-corner">AI 漫剧成片</div> : current && <><div className="stage-shade" /><div className="stage-label"><span>{String(currentIndex + 1).padStart(2, "0")}</span><b>{current.title}</b></div>{subtitleEnabled && current.subtitleEnabled !== false && <div className={`subtitle ${current.subtitlePosition || "bottom"}`} style={{ color: subtitleColor, fontSize: `${14 * subtitleScale}px` }}>“{current.dialogue}”</div>}</>}
            </div>
            {showFilm && exportUrl ? <div className="film-toolbar"><div><b>{nativeVideoEnabled ? "AI 漫剧成片已生成" : "低动态流程样片已生成"}</b><span>{nativeVideoEnabled ? `六岗位协作生成，动态镜头、字幕${generatedVoiceEnabled ? "、分角色配音" : ""}${musicUrl ? "与剧情配乐" : ""}已经合成` : "这是图片运镜预览，不是人物原生动画；可用于确认剧本、分镜与节奏"}</span></div><button className="secondary" onClick={() => setShowFilm(false)}>编辑分镜</button><button onClick={() => void openInProfessionalEditor()} disabled={editorSyncState === "saving"}>{editorSyncState === "saving" ? `整理素材 ${editorSyncProgress}%` : "进入专业剪辑台"}</button><button onClick={downloadFilm}>下载成片</button></div> : <>
              <div className="play-controls"><button onClick={() => setPlaying((value) => !value)} disabled={!scenes.length}>{playing ? "Ⅱ" : "▶"}</button><span>{formatTime(time)}</span><input type="range" aria-label="播放进度" min={0} max={100} value={totalDuration ? (time / totalDuration) * 100 : 0} onChange={(event) => seek(Number(event.target.value))} /><span>{formatTime(totalDuration)}</span><button onClick={() => { setPlaying(false); setTime(0); }}>↺</button></div>
              <div className="export-panel"><div><b>{nativeVideoEnabled ? "重新合成 AI 漫剧" : "重新生成流程样片"}</b><span>{nativeVideoEnabled && generatedVoiceEnabled && voiceEnabled ? "动态表演、字幕、分角色配音与配乐将写入视频" : "关键帧、运镜、转场和字幕将写入样片"}</span></div><button onClick={() => void exportFilm()} disabled={phase === "exporting"}>{phase === "exporting" ? `正在录制 ${exportProgress}%` : nativeVideoEnabled ? "生成 AI 漫剧成片" : "生成低动态样片"}</button></div>
              {exportUrl && <div className="export-result"><video src={exportUrl} preload="metadata" controls playsInline /><div><b>已有漫剧成片</b><span>可以返回成片模式播放，或重新剪辑。</span><button onClick={() => setShowFilm(true)}>播放成片</button><button onClick={downloadFilm}>下载成片</button></div></div>}
            </>}
          </div>

          <div className="timeline-panel">
            <div className="timeline-title"><div><b>智能分镜</b><span>点击选择，下面可编辑</span></div><button onClick={addScene}>＋ 新增镜头</button></div>
            <div className="scene-list">{scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}><div className="scene-thumb">{scene.imageUrl ? <img src={scene.imageUrl} alt="" loading="lazy" /> : scene.videoUrl ? <span className="video-thumbnail-placeholder">▶</span> : <span>{["painting", "animating"].includes(scene.status) ? "生成中" : String(index + 1).padStart(2, "0")}</span>}</div><div><b>{scene.title}</b><p>{scene.action}</p><small>{scene.duration} 秒 · {scene.videoUrl ? "AI 动态表演" : scene.imageUrl ? "一致性关键帧" : "待生成"} · {scene.camera}</small></div><i className={`scene-state ${scene.status}`} /></button>)}</div>
            {selectedScene && <div className="scene-editor">
              <div className="editor-heading"><b>镜头 {String(selected + 1).padStart(2, "0")} · 属性检查器</b><div><button onClick={() => moveScene(selected, -1)} disabled={selected === 0}>↑</button><button onClick={() => moveScene(selected, 1)} disabled={selected === scenes.length - 1}>↓</button><button onClick={() => duplicateScene(selected)}>复制</button><button className="danger" onClick={() => deleteScene(selected)}>删除</button></div></div>
              <div className="local-media-tools"><label>替换图片<input type="file" accept="image/*" onChange={(event) => { replaceSceneMedia(selectedScene, "image", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label>导入视频<input type="file" accept="video/*" onChange={(event) => { replaceSceneMedia(selectedScene, "video", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label>导入配音<input type="file" accept="audio/*" onChange={(event) => { replaceSceneMedia(selectedScene, "audio", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
              <label>镜头标题<input value={selectedScene.title} onChange={(event) => updateScene(selectedScene.id, { title: event.target.value })} /></label>
              <div className="editor-grid"><label>景别<input value={selectedScene.shot} onChange={(event) => updateScene(selectedScene.id, { shot: event.target.value })} /></label><label>文字运镜描述<input value={selectedScene.camera} onChange={(event) => updateScene(selectedScene.id, { camera: event.target.value })} /></label><label>说话角色<input value={selectedScene.speaker} onChange={(event) => updateScene(selectedScene.id, { speaker: event.target.value })} /></label><label>表演情绪<input value={selectedScene.emotion} onChange={(event) => updateScene(selectedScene.id, { emotion: event.target.value })} /></label></div>
              <label>场景与构图<textarea value={selectedScene.visual} onChange={(event) => updateScene(selectedScene.id, { visual: event.target.value })} /></label>
              <label>人物动作与表演<textarea value={selectedScene.action} onChange={(event) => updateScene(selectedScene.id, { action: event.target.value })} /></label>
              <label>角色台词<textarea value={selectedScene.dialogue} onChange={(event) => updateScene(selectedScene.id, { dialogue: event.target.value })} /></label>
              <div className="editor-grid"><label>2.5D 动态<select value={selectedScene.motion || "push"} onChange={(event) => updateScene(selectedScene.id, { motion: event.target.value as MotionPreset })}>{MOTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>转场<select value={selectedScene.transition || "fade"} onChange={(event) => updateScene(selectedScene.id, { transition: event.target.value as TransitionPreset })}>{TRANSITION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>画面滤镜<select value={selectedScene.filter || "none"} onChange={(event) => updateScene(selectedScene.id, { filter: event.target.value as VisualFilter })}><option value="none">原色</option><option value="warm">暖调电影感</option><option value="cool">冷调悬疑</option><option value="mono">黑白漫画</option></select></label><label>字幕位置<select value={selectedScene.subtitlePosition || "bottom"} onChange={(event) => updateScene(selectedScene.id, { subtitlePosition: event.target.value as SubtitlePosition })}><option value="top">顶部</option><option value="center">中央</option><option value="bottom">底部</option></select></label></div>
              <div className="editor-grid"><label>镜头时长<input type="number" min={1} max={15} step={0.5} value={selectedScene.duration} onChange={(event) => updateScene(selectedScene.id, { duration: Math.max(1, Math.min(15, Number(event.target.value))) })} /></label><label>视频速度<input type="number" min={0.5} max={2} step={0.1} value={selectedScene.speed || 1} onChange={(event) => updateScene(selectedScene.id, { speed: Math.max(0.5, Math.min(2, Number(event.target.value))) })} /></label><label>配音音量<input type="range" min={0} max={2} step={0.05} value={selectedScene.volume ?? 1} onChange={(event) => updateScene(selectedScene.id, { volume: Number(event.target.value) })} /></label><label>运镜强度<input type="range" min={0.35} max={1.8} step={0.05} value={selectedScene.motionIntensity || 1} onChange={(event) => updateScene(selectedScene.id, { motionIntensity: Number(event.target.value) })} /></label></div>
              <div className="subtitle-switch"><div><b>显示本镜字幕</b><span>关闭后对白仍保留在剧本中</span></div><button className={`toggle ${selectedScene.subtitleEnabled !== false ? "on" : ""}`} onClick={() => updateScene(selectedScene.id, { subtitleEnabled: selectedScene.subtitleEnabled === false })}><i /></button></div>
              <label>音效设计<input value={selectedScene.sfx} onChange={(event) => updateScene(selectedScene.id, { sfx: event.target.value })} /></label>
              <div className="editor-actions"><button onClick={() => void regenerateImage(selectedScene, selected)} disabled={busy || Boolean(sceneAction)}>{sceneAction?.id === selectedScene.id && sceneAction.type === "image" ? "生图 AI 正在重做…" : "让生图 AI 重做"}</button><button className="video-action" onClick={() => void generateVideo(selectedScene)} disabled={busy || Boolean(sceneAction)}>{sceneAction?.id === selectedScene.id && sceneAction.type === "video" ? "视频 AI 正在重做…" : nativeVideoEnabled ? "让视频 AI 重做" : "配置视频 AI"}</button></div>
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
                    <span className="clip-thumb">{scene.imageUrl ? <img src={scene.imageUrl} alt="" loading="lazy" /> : scene.videoUrl ? <i className="video-thumbnail-placeholder">▶</i> : <i>{String(index + 1).padStart(2, "0")}</i>}</span><b>{scene.title}</b><small>{scene.duration} 秒</small>
                  </button>)}
                </div>
                <div className="timeline-track voice-track">
                  {scenes.map((scene, index) => <button type="button" key={scene.id} className={`audio-clip ${selected === index ? "selected" : ""} ${!scene.audioUrl ? "device-voice" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }}><i><span /><span /><span /><span /><span /><span /></i><b>{scene.speaker || "旁白"}</b></button>)}
                </div>
                {subtitleEnabled && <div className="timeline-track subtitle-track">
                  {scenes.map((scene, index) => <button type="button" key={scene.id} className={`subtitle-clip ${selected === index ? "selected" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }} title={scene.dialogue}>{scene.dialogue || "（无台词）"}</button>)}
                </div>}
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
