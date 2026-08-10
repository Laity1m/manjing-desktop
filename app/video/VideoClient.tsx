"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteNav from "../components/SiteNav";
import { saveLibraryFile } from "../lib/asset-library";
import {
  activateEditorProject,
  listEditorProjects,
  loadEditorProjectById,
  persistEditorProject,
  type EditorProject,
  type EditorProjectClip,
} from "../lib/editor-project";
import {
  loadCustomModels,
  saveCustomModels,
  saveCustomModelsToDesktop,
  type CustomModel,
  type CustomModelAdapter,
} from "../lib/custom-models";

type VideoAdapter = "browser" | "pollinations" | "seedance" | "webhook";
type ReferenceKind = "image" | "video" | "audio";
type ReferenceRole = "character" | "scene" | "style" | "first_frame" | "last_frame" | "motion" | "camera" | "edit" | "rhythm" | "voice" | "sound";
type VideoConfig = {
  preset: string;
  adapter: VideoAdapter;
  model: string;
  endpoint: string;
  apiKey: string;
};
type ReferenceItem = {
  id: string;
  name: string;
  kind: ReferenceKind;
  role: ReferenceRole;
  sourceUrl: string;
  previewUrl: string;
  weight: number;
  file?: File;
  enabled: boolean;
};
type VideoResult = {
  projectId: string;
  createdAt: string;
  model: string;
  url: string;
  name: string;
  referenceCount: number;
  voiceEnabled: boolean;
};
type SeedanceTask = {
  id: string;
  model: string;
  prompt: string;
  createdAt: number;
  references: Array<{
    name: string;
    kind: ReferenceKind;
    role: string;
    sourceUrl: string;
    weight: number;
  }>;
};

const STYLE_PRESETS = ["cinematic", "realistic", "anime", "comics", "3d", "documentary", "cartoon"];
const STYLE_PRESET_LABELS: Record<string, string> = {
  cinematic: "电影感",
  realistic: "写实风",
  anime: "动漫风",
  comics: "漫画感",
  "3d": "3D",
  documentary: "纪录风",
  cartoon: "卡通风",
};
const BASE_MODELS: Array<{ id: string; name: string; note: string; config: VideoConfig }> = [
  {
    id: "browser-video",
    name: "Browser 2.5D（本地）",
    note: "本地 2.5D 画布渲染器，用于快速预览与参考查看",
    config: {
      preset: "browser-video",
      adapter: "browser",
      model: "browser-video",
      endpoint: "",
      apiKey: "",
    },
  },
  {
    id: "pollinations-video",
    name: "Pollinations 云端",
    note: "文本生成视频，支持可选首帧图片",
    config: {
      preset: "pollinations-video",
      adapter: "pollinations",
      model: "seedance-2.0",
      endpoint: "https://gen.pollinations.ai",
      apiKey: "",
    },
  },
  {
    id: "volc-seedance",
    name: "Seedance（火山）",
    note: "火山 ARK 引擎；支持文本与多模态参考输入",
    config: {
      preset: "volc-seedance",
      adapter: "seedance",
      model: "doubao-seedance-1-5-pro-251215",
      endpoint: "",
      apiKey: "",
    },
  },
];

const ROLE_OPTIONS: Record<ReferenceKind, Array<{ value: ReferenceRole; label: string }>> = {
  image: [
    { value: "character", label: "角色正脸/全身" },
    { value: "scene", label: "场景构图" },
    { value: "style", label: "风格参考" },
    { value: "first_frame", label: "第一帧" },
    { value: "last_frame", label: "结尾帧" },
  ],
  video: [
    { value: "motion", label: "动作示例" },
    { value: "camera", label: "镜头运动" },
    { value: "edit", label: "剪辑节奏" },
  ],
  audio: [
    { value: "rhythm", label: "节奏参考" },
    { value: "voice", label: "配音参考" },
    { value: "sound", label: "音效参考" },
  ],
};

const ROLE_LABEL: Record<ReferenceRole, string> = Object.fromEntries(
  Object.values(ROLE_OPTIONS).flat().map((item) => [item.value, item.label]),
) as Record<ReferenceRole, string>;

const DRAFT_KEY = "manjing-video-draft-v2";
const CONFIG_KEY = "manjing-video-config-v2";
const SETTINGS_KEY = "manjing-agent-team";
const CONFIG_PREVIEW_TASK_KEY = "manjing-video-preview-task";

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function fileKind(file: File): ReferenceKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function asError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function buildPrompt(prompt: string, style: string, voiceEnabled: boolean, language: string, styleHint: string, script: string) {
  const base = `${style}：${prompt}`;
  if (!voiceEnabled) return base;
  const extra = script.trim() ? `（配音文本：${script.trim()}）` : "";
  return `${base} + 配音 [语言=${language}, 风格=${styleHint}]${extra}`;
}

function videoCapability(config: VideoConfig) {
  if (config.adapter === "seedance") {
    return { image: 9, video: 3, audio: 3, full: true, label: "完整多模态输入：图片/视频/音频均可参考" };
  }
  if (config.adapter === "pollinations") {
    return { image: 1, video: 0, audio: 0, full: false, label: "文本生成 + 可选首帧图片" };
  }
  if (config.adapter === "webhook") {
    return { image: 5, video: 2, audio: 1, full: false, label: "自定义 API 格式，按接入规则提交参数" };
  }
  return { image: 0, video: 0, audio: 0, full: false, label: "仅本地渲染（浏览器/本机）" };
}

const ADAPTER_LABELS: Record<VideoAdapter, string> = {
  browser: "本地渲染",
  pollinations: "Pollinations",
  seedance: "火山 Seedance",
  webhook: "Webhook",
};

export default function VideoClient() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("16秒短片：一个人物在黄昏时分，镜头慢慢推进并完成情绪转折。");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [style, setStyle] = useState("cinematic");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState("720p");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState("中文");
  const [voiceStyle, setVoiceStyle] = useState("温和叙述");
  const [voiceScript, setVoiceScript] = useState("");

  const [config, setConfig] = useState<VideoConfig>(BASE_MODELS[0].config);
  const [selectedPreset, setSelectedPreset] = useState(BASE_MODELS[0].id);
  const [history, setHistory] = useState<EditorProject[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>([]);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteKind, setRemoteKind] = useState<ReferenceKind>("image");

  const [result, setResult] = useState<VideoResult | null>(null);
  const [status, setStatus] = useState("就绪");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [customName, setCustomName] = useState("");
  const [customModelId, setCustomModelId] = useState("seedance-video-pro");
  const [customAdapter, setCustomAdapter] = useState<VideoAdapter>("webhook");
  const [customEndpoint, setCustomEndpoint] = useState("https://api.openai.com/v1");
  const [customKey, setCustomKey] = useState("");
  const [customSaveMessage, setCustomSaveMessage] = useState("");

  const [pendingSeedance, setPendingSeedance] = useState<SeedanceTask | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveDraftRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const draftRef = useRef<string | null>(null);
  const refKindCount = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0 };
    for (const item of referenceItems) c[item.kind] += 1;
    return c;
  }, [referenceItems]);

  const capability = useMemo(() => videoCapability(config), [config]);
  const hasCustomModels = customModels.some((item) => item.role === "video");

  const modelList = useMemo(() => {
    const custom = customModels
      .filter((item) => item.role === "video")
      .map((item) => ({
        id: item.id,
        name: `${item.name}（自定义）`,
        note: item.note || `${item.adapter}/${item.model}`,
        config: {
          preset: item.id,
          adapter: (item.adapter as VideoAdapter) || "webhook",
          model: item.model || "gpt-image-1",
          endpoint: item.endpoint || "",
          apiKey: item.apiKey || "",
        },
      }));
    return [...BASE_MODELS, ...custom];
  }, [customModels]);

  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as {
        video?: VideoConfig;
      };
      if (settings.video) setConfig(settings.video);
      const match = modelList.find((item) => item.config.preset === settings.video?.preset);
      if (match) setSelectedPreset(match.id);

      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") as Partial<{
        prompt: string;
        negativePrompt: string;
        style: string;
        aspect: "9:16" | "16:9";
        duration: number;
        resolution: string;
        voiceLanguage: string;
        voiceStyle: string;
        voiceScript: string;
      }>;
      if (draft.prompt) setPrompt(draft.prompt);
      if (draft.negativePrompt) setNegativePrompt(draft.negativePrompt);
      if (draft.style) setStyle(draft.style);
      if (draft.aspect) setAspect(draft.aspect);
      if (draft.duration) setDuration(draft.duration);
      if (draft.resolution) setResolution(draft.resolution);
      if (draft.voiceLanguage) setVoiceLanguage(draft.voiceLanguage);
      if (draft.voiceStyle) setVoiceStyle(draft.voiceStyle);
      if (draft.voiceScript) setVoiceScript(draft.voiceScript);

      const saved = localStorage.getItem(CONFIG_PREVIEW_TASK_KEY);
      if (saved) setPendingSeedance(JSON.parse(saved) as SeedanceTask);

      setCustomModels(loadCustomModels());
      void fetch("/api/desktop/settings", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as { customModels?: CustomModel[]; agentConfigs?: { video?: VideoConfig } };
        if (Array.isArray(payload.customModels)) setCustomModels(payload.customModels);
        if (payload.agentConfigs?.video) {
          setConfig(payload.agentConfigs.video);
          const matched = modelList.find((item) => item.config.preset === payload.agentConfigs?.video?.preset || item.config.model === payload.agentConfigs?.video?.model);
          if (matched) setSelectedPreset(matched.id);
        }
      }).catch(() => undefined);
      void fetchHistory();
    } catch {
      setCustomModels(loadCustomModels());
      void fetchHistory();
    }
  }, []);

  useEffect(() => {
    if (saveDraftRef.current) window.clearTimeout(saveDraftRef.current);
    saveDraftRef.current = window.setTimeout(() => {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          prompt,
          negativePrompt,
          style,
          aspect,
          duration,
          resolution,
          voiceLanguage,
          voiceStyle,
          voiceScript,
        }),
      );
      try {
        const settings = { ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"), video: config };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // ignore local storage failure
      }
    }, 450);
  }, [prompt, negativePrompt, style, aspect, duration, resolution, voiceLanguage, voiceStyle, voiceScript, config]);

  useEffect(() => () => {
    if (saveDraftRef.current) window.clearTimeout(saveDraftRef.current);
  }, []);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: ReferenceItem[] = [];
    const limits = { image: 9, video: 3, audio: 3 };
    const current = { image: 0, video: 0, audio: 0 };
    for (const item of referenceItems) current[item.kind] += 1;
    for (const file of Array.from(files)) {
      const kind = fileKind(file);
      if (!kind) continue;
      if (current[kind] >= limits[kind]) continue;
      current[kind] += 1;
      next.push({
        id: uid(),
        name: file.name,
        kind,
        role: ROLE_OPTIONS[kind][0].value,
        sourceUrl: "",
        previewUrl: URL.createObjectURL(file),
        weight: 80,
        file,
        enabled: true,
      });
    }
    if (!next.length) {
        setError("无法添加素材：文件类型不支持或已到达上限");
      return;
    }
    setReferenceItems((value) => [...value, ...next]);
  };

  const addRemoteReference = () => {
    if (!remoteUrl) return;
    try {
      const parsed = new URL(remoteUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("仅支持 http/https 链接");
      const kindLimit = remoteKind === "image" ? 9 : 3;
      if (referenceItems.filter((item) => item.kind === remoteKind).length >= kindLimit) {
        setError("该类型素材已达上限");
        return;
      }
      const item: ReferenceItem = {
        id: uid(),
        name: parsed.pathname.split("/").pop() || `${remoteKind}-reference`,
        kind: remoteKind,
        role: ROLE_OPTIONS[remoteKind][0].value,
        sourceUrl: parsed.href,
        previewUrl: parsed.href,
        weight: 70,
        enabled: true,
      };
      setReferenceItems((value) => [...value, item]);
      setRemoteUrl("");
      setError("");
    } catch {
      setError("请输入有效的 http(s) 链接");
    }
  };

  const removeReference = (id: string) => {
    setReferenceItems((value) => {
      const next = value.filter((item) => item.id !== id);
      const removed = value.find((item) => item.id === id);
      if (removed?.file) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const toggleReference = (id: string, enabled: boolean) => {
    setReferenceItems((value) => value.map((item) => (item.id === id ? { ...item, enabled } : item)));
  };

  const changeRole = (id: string, role: ReferenceRole) => {
    setReferenceItems((value) => value.map((item) => (item.id === id ? { ...item, role } : item)));
  };

  const changeReferenceWeight = (id: string, weight: number) => {
    setReferenceItems((value) => value.map((item) => (item.id === id ? { ...item, weight } : item)));
  };

  const mention = (item: ReferenceItem) => {
    const handle = `@R${referenceItems.findIndex((i) => i.id === item.id) + 1}`;
    setPrompt((value) => {
      const hasSpace = value.endsWith(" ") || value.length === 0;
      return `${value}${hasSpace ? "" : " "}${handle} `;
    });
  };

  const saveVideoConfig = async () => {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Record<string, unknown>;
      await fetch("/api/desktop/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, savedAt: new Date().toISOString(), agentConfigs: { ...((settings as Record<string, unknown>).agentConfigs as Record<string, unknown>), video: config } }),
      }).catch(() => undefined);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, video: config }));
      setError("");
      setStatus("配置已保存");
      window.setTimeout(() => setStatus("就绪"), 1000);
    } catch {
      setError("保存配置失败");
    }
  };

  const addCustomModel = async () => {
    if (!customName.trim() || !customModelId.trim()) {
      setCustomSaveMessage("请填写模型名称和模型 ID");
      return;
    }
    if (!["webhook", "seedance", "browser", "pollinations"].includes(customAdapter)) {
      setCustomSaveMessage("不支持的适配器类型");
      return;
    }
    const id = `custom-video-${Date.now().toString(36)}`;
    const model: CustomModel = {
      id,
      name: customName.trim(),
      role: "video",
      adapter: customAdapter as CustomModelAdapter,
      model: customModelId.trim(),
      endpoint: customEndpoint.trim(),
      apiKey: customKey.trim(),
      note: "user custom",
    };
    const next = [model, ...customModels];
    setCustomModels(next);
    saveCustomModels(next);
    draftRef.current = localStorage.getItem("manjing-custom-models");
    setCustomSaveMessage("模型已添加");
    setCustomName("");
    setCustomModelId("");
    setCustomEndpoint("");
    setCustomKey("");
    try {
      await saveCustomModelsToDesktop(next);
      localStorage.setItem("manjing-custom-models", JSON.stringify(next));
      setCustomSaveMessage("模型已添加，并同步到桌面配置");
    } catch {
      setCustomSaveMessage("本地保存成功，桌面同步失败，请稍后重试");
    }
  };

  const removeCustomModel = async (id: string) => {
    const next = customModels.filter((item) => item.id !== id);
    setCustomModels(next);
    saveCustomModels(next);
      setCustomSaveMessage("模型已移除");
    try {
      await saveCustomModelsToDesktop(next, id);
      localStorage.setItem("manjing-custom-models", JSON.stringify(next));
      if (selectedPreset === id) {
        const nextConfig = BASE_MODELS[0].config;
        setConfig(nextConfig);
        setSelectedPreset(nextConfig.preset);
      }
      setCustomSaveMessage("模型已移除，并同步到桌面配置");
    } catch {
      setCustomSaveMessage("本地已移除，桌面同步失败");
    }
  };

  const refreshHistory = async () => {
    setHistoryLoading(true);
    try {
      const items = await listEditorProjects();
      setHistory(items.filter((item) => item.source === "video"));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchHistory = () => {
    void refreshHistory();
  };

  const createSeedanceTask = async (payload: {
    prompt: string;
    references: ReferenceItem[];
  }): Promise<SeedanceTask> => {
    if (!config.apiKey?.trim()) throw new Error("请先填写 Seedance API Key");
    const items = [];
    for (const item of payload.references) {
      if (!item.enabled) continue;
      if (items.length > 20) break;
      let sourceUrl = item.sourceUrl;
      if (item.file && !sourceUrl) {
        sourceUrl = await toDataUrl(item.file);
      }
      items.push({
        kind: item.kind,
        role: item.role,
        name: item.name,
        weight: item.weight,
        sourceUrl,
      });
    }

    const requestBody = {
      action: "create",
      model: config.model,
      prompt: payload.prompt,
      negativePrompt,
      ratio: aspect,
      duration,
      resolution,
      apiKey: config.apiKey,
      references: items,
      voiceover: {
        enabled: voiceEnabled,
        language: voiceLanguage,
        style: voiceStyle,
        script: voiceScript,
      },
      requestId: uid(),
    };
    const response = await fetch("/api/seedance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const raw = await response.json().catch(() => ({}));
      throw new Error((raw as { error?: string }).error || `发起任务失败（${response.status}）`);
    }
    const payloadData = (await response.json()) as { id?: string };
    if (!payloadData.id) throw new Error("未返回任务 ID");
    return {
      id: payloadData.id,
      model: config.model,
      prompt: payload.prompt,
      createdAt: Date.now(),
      references: items,
    };
  };

  const pollSeedance = async (task: SeedanceTask, runId: number): Promise<string> => {
    for (let i = 0; i < 160; i += 1) {
      if (runRef.current !== runId) throw new Error("已取消生成");
      const response = await fetch("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", id: task.id, apiKey: config.apiKey }),
      });
      if (!response.ok) {
        const raw = await response.json().catch(() => ({}));
        const msg = (raw as { error?: string }).error || `查询状态失败（${response.status}）`;
        throw new Error(msg);
      }
      const statusData = await response.json() as {
        done?: boolean;
        status?: string;
        videoUrl?: string;
        error?: string;
      };
    if (statusData.status) setStatus(`任务状态：${statusData.status}`);
      if (statusData.error) throw new Error(statusData.error);
      if (statusData.done && statusData.videoUrl) return statusData.videoUrl;
      setProgress(clamp(Math.min(92, i * 0.6 + 5), 0, 92));
      await delay(2500);
    }
    throw new Error("视频生成超时（请稍后重试）");
  };

  const generateWebhook = async (promptText: string, references: ReferenceItem[]) => {
    if (!config.endpoint) throw new Error("请先配置 Webhook 接口地址");
    const payloadRefs = [];
    for (const item of references) {
      if (!item.enabled) continue;
      let sourceUrl = item.sourceUrl;
      if (!sourceUrl && item.file) sourceUrl = await toDataUrl(item.file);
      payloadRefs.push({
        kind: item.kind,
        role: item.role,
        name: item.name,
        weight: item.weight,
        sourceUrl,
      });
    }
    if (/^agnes-video-/i.test(config.model) || /agnes-ai\.com/i.test(config.endpoint)) {
      setStatus("Agnes 已创建异步任务，正在等待视频生成");
      const response = await fetch("/api/desktop/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "webhook", endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, prompt: promptText, negativePrompt, duration, aspect, resolution, references: payloadRefs.map((item) => ({ ...item, url: item.sourceUrl })) }),
      });
      if (!response.ok) {
        const raw = await response.json().catch(() => ({}));
        throw new Error((raw as { error?: string }).error || `Agnes 请求失败（${response.status}）`);
      }
      const data = await response.json() as { videoUrl?: string; dataUrl?: string };
      const url = data.videoUrl || data.dataUrl;
      if (!url) throw new Error("Agnes 任务完成但没有返回视频地址");
      return url;
    }
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        prompt: promptText,
        negativePrompt,
        style,
        duration,
        aspect,
        resolution,
        adapter: "video",
        references: payloadRefs,
        voiceover: {
          enabled: voiceEnabled,
          language: voiceLanguage,
          style: voiceStyle,
          script: voiceScript,
        },
      }),
    });
    if (!response.ok) {
      const raw = await response.json().catch(() => ({}));
      throw new Error((raw as { error?: string }).error || `Webhook 请求失败（${response.status}）`);
    }
    const data = (await response.json()) as { videoUrl?: string; url?: string; dataUrl?: string };
    const url = data.videoUrl || data.url || data.dataUrl;
    if (!url) throw new Error("Webhook 返回未包含可用视频地址");
    return url;
  };

  const generatePollinations = async (promptText: string, references: ReferenceItem[]) => {
    if (!config.apiKey?.trim()) throw new Error("请先填写 Pollinations Key");
    const imgRef = references.find((item) => item.enabled && item.kind === "image");
    let image = "";
    if (imgRef) {
      image = imgRef.sourceUrl;
      if (imgRef.file && !imgRef.sourceUrl) image = await toDataUrl(imgRef.file);
    }
    const request = new URL(`${config.endpoint.replace(/\/$/, "")}/video`);
    const params = new URLSearchParams({
      model: config.model || "seedance-2.0",
      duration: String(clamp(duration, 4, 15)),
      ratio: aspect,
      width: resolution === "1080p" ? "1920" : resolution === "720p" ? "1280" : "960",
      fps: "24",
      safe: "true",
    });
    const target = `${request.toString()}/${encodeURIComponent(promptText)}?${params.toString()}`;
    const headers = { Authorization: `Bearer ${config.apiKey}` } as Record<string, string>;
    const response = await fetch(target, {
      method: "GET",
      headers,
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `Pollinations 调用失败（${response.status}）`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("未返回可播放内容");
    return URL.createObjectURL(blob);
  };

  const importToEditor = async (projectId = result?.projectId) => {
    if (!projectId) return;
    try {
      await activateEditorProject(projectId);
      router.push("/editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入剪辑台失败");
    }
  };

  const openHistoryItem = async (project: EditorProject) => {
    setHistoryLoading(true);
    try {
      const data = await loadEditorProjectById(project.id);
      const url = data?.finalVideo?.url || data?.clips.find((item) => item.url)?.url;
      if (!url) throw new Error("未找到可播放文件");
      setResult({
        projectId: project.id,
        createdAt: project.createdAt,
        model: project.editorNote || "Video project",
        name: project.name,
        url,
        referenceCount: project.clips.length,
        voiceEnabled: true,
      });
      setStatus("历史记录已加载");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载历史失败");
    } finally {
      setHistoryLoading(false);
    }
  };

  const saveVideoResult = async (sourceUrl: string, references: ReferenceItem[]) => {
    const name = prompt.trim().slice(0, 24) || "AI 视频成片";
    const projectId = uid();
    const clip: EditorProjectClip = {
      id: uid(),
      name,
      type: "video",
      url: sourceUrl,
      duration,
      sourceDuration: duration,
      trimStart: 0,
      trimEnd: duration,
      start: 0,
      volume: 1,
      speed: 1,
      filter: "none",
      transition: "cut",
      text: `Generated via ${config.model} with ${references.filter((item) => item.enabled).length} refs`,
    };
    const saved = await persistEditorProject({
      id: projectId,
      name,
      aspect,
      source: "video",
      clips: [clip],
      finalVideo: { url: sourceUrl },
      studioSnapshot: { source: "video-lab", createdBy: "video module", referenceCount: references.length, count: refsCount(referenceItems) },
      editorNote: JSON.stringify({
        model: config.model,
        adapter: config.adapter,
        refs: references.filter((item) => item.enabled).length,
        hasVoice: voiceEnabled,
      }),
    });
    try {
      const archivedResponse = await fetch(sourceUrl);
      if (archivedResponse.ok) {
        const archivedBlob = await archivedResponse.blob();
        const archivedFile = new File([archivedBlob], `${name || "AI视频"}-${Date.now()}.mp4`, { type: archivedBlob.type || "video/mp4" });
        await saveLibraryFile(archivedFile, { category: "video", duration, tags: ["自动生成", "AI视频", config.model] });
      }
    } catch (archiveError) {
      console.warn("[manjing video archive]", archiveError);
    }
    setResult({
      projectId,
      createdAt: saved.createdAt || new Date().toISOString(),
      model: config.model,
      url: sourceUrl,
      name,
      referenceCount: references.length,
      voiceEnabled,
    });
    await refreshHistory();
    setStatus("已保存到项目和资产库");
    setProgress(100);
  };

  const generateVideo = async () => {
    if (busy) return;
    if (!prompt.trim() || prompt.trim().length < 6) {
      setError("提示词过短，请补充更多细节");
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    setBusy(true);
    setError("");
    setProgress(0);
    setStatus("准备中");
    try {
      const enabled = referenceItems.filter((item) => item.enabled);
      const finalPrompt = buildPrompt(prompt, style, voiceEnabled, voiceLanguage, voiceStyle, voiceScript);
      if (config.adapter === "seedance") {
        const task = await createSeedanceTask({ prompt: finalPrompt, references: enabled });
        setPendingSeedance(task);
        localStorage.setItem(CONFIG_PREVIEW_TASK_KEY, JSON.stringify(task));
        setStatus("已提交 Seedance 任务");
        setProgress(15);
        const outputUrl = await pollSeedance(task, runId);
        setPendingSeedance(null);
        localStorage.removeItem(CONFIG_PREVIEW_TASK_KEY);
        setStatus("结果下载中");
        await saveVideoResult(outputUrl, enabled);
        return;
      }
      if (config.adapter === "pollinations") {
        setStatus("等待 Pollinations 任务返回");
        const generated = await generatePollinations(finalPrompt, enabled);
        setStatus("保存生成结果");
        await saveVideoResult(generated, enabled);
        return;
      }
      const generated = await generateWebhook(finalPrompt, enabled);
      setStatus("保存生成结果");
      await saveVideoResult(generated, enabled);
    } catch (reason) {
      if (runRef.current === runId) {
      setError(asError(reason));
      setStatus("生成失败");
      }
    } finally {
      if (runRef.current === runId) setBusy(false);
      setProgress((v) => (v >= 100 ? 100 : Math.max(6, v)));
    }
  };

  const resumeSeedance = async () => {
    if (!pendingSeedance) return;
    const runId = runRef.current + 1;
    runRef.current = runId;
    setBusy(true);
    setError("");
    try {
      const url = await pollSeedance(pendingSeedance, runId);
      await saveVideoResult(url, []);
      setPendingSeedance(null);
      localStorage.removeItem(CONFIG_PREVIEW_TASK_KEY);
    } catch (reason) {
      setError(asError(reason));
    } finally {
      if (runRef.current === runId) setBusy(false);
    }
  };

  const changePreset = (presetId: string) => {
    const found = modelList.find((item) => item.id === presetId);
    if (!found) return;
    setSelectedPreset(presetId);
    setConfig(found.config);
  };

  const enabledReferences = referenceItems.filter((item) => item.enabled);
  const mentionItems = useMemo(
    () =>
      referenceItems.map((item) => ({
        ...item,
        handle: `@R${referenceItems.findIndex((entry) => entry.id === item.id) + 1}`,
      })),
    [referenceItems],
  );

  const downloadResult = () => {
    if (!result?.url) return;
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = `${result.name}.mp4`;
    anchor.click();
  };

  const refsCount = (items: ReferenceItem[]) => items.reduce((acc, item) => acc + item.weight, 0);

  return (
    <main className="video-lab-page">
      <SiteNav current="video" />
      <header className="video-lab-hero">
        <div>
          <span>AI 视频工作室</span>
          <h1>
            AI 一键视频 <em>独立模块</em>
          </h1>
          <p>
            支持可选模型、独立配置、参考素材导入（图片/视频/音频），生成后可直接导入剪辑台。
          </p>
        </div>
        <aside>
          <i>📺</i>
          <div>
            <b>当前模型能力</b>
            <span>{capability.label}</span>
          </div>
          <em>独立工作流</em>
        </aside>
      </header>

      <section className="video-lab-layout">
        <aside className="video-model-panel video-engine-panel">
          <div className="video-panel-title">
            <span>01 / 引擎面板</span>
            <h2>引擎选择</h2>
            <div className="video-panel-note">可在基础引擎与自定义模型间快速切换</div>
          </div>
          <div className="video-engine-grid">
            {modelList.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`video-engine-card ${selectedPreset === model.id ? "active" : ""}`}
                onClick={() => changePreset(model.id)}
              >
                <i />
                <div>
                  <b>{model.name}</b>
                  <small>{ADAPTER_LABELS[(model.config.adapter || "webhook") as VideoAdapter] || model.config.adapter}</small>
                  <span>{model.note}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="video-capability">
            <i />
            <div>
              <b>当前引擎能力</b>
              <span>{config.adapter ? ADAPTER_LABELS[config.adapter] : "未设置"}</span>
            </div>
          </div>
          <dl className="video-engine-meta">
            <div>
              <dt>适配器</dt>
              <dd>{ADAPTER_LABELS[config.adapter] || config.adapter}</dd>
            </div>
            <div>
              <dt>模型 ID</dt>
              <dd>{config.model}</dd>
            </div>
            <div>
              <dt>接口密钥</dt>
              <dd>{config.apiKey ? "已填写" : "未填写"}</dd>
            </div>
            <div>
              <dt>接口地址</dt>
              <dd>{config.endpoint || "—"}</dd>
            </div>
          </dl>
          <button type="button" onClick={() => void saveVideoConfig()} className="video-save-config">
            保存并应用设置
          </button>
          <Link className="video-model-link" href="/models">
            进入模型配置页面
          </Link>
        </aside>

        <section className="video-compose-panel">
          <div className="video-panel-title">
            <span>02 / 生成参数</span>
            <h2>生成参数</h2>
          </div>
          <textarea
            value={prompt}
            maxLength={1800}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="在这里输入你的分镜脚本，使用 @ 引用素材可增强关联性"
            rows={10}
          />
          <div className="video-prompt-meta">
            <span>{prompt.length} / 1800</span>
            <button type="button" onClick={() => setPrompt(`${style} ${prompt}`.trim())}>
              填充风格前缀
            </button>
          </div>

          {mentionItems.length > 0 ? (
            <div className="video-mention-bar">
              <span>可插入引用标记：</span>
              {mentionItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.enabled ? "" : "disabled"}
                  onClick={() => mention(item)}
                  disabled={!item.enabled}
                >
                  {item.handle}
                  <small>{ROLE_LABEL[item.role]}</small>
                </button>
              ))}
            </div>
          ) : null}

          <div className="video-style-row">
            {STYLE_PRESETS.map((item) => (
              <button
                key={item}
                type="button"
                className={style === item ? "active" : ""}
                onClick={() => setStyle(item)}
              >
                {STYLE_PRESET_LABELS[item]}
              </button>
            ))}
          </div>

          <div className="video-output-settings">
            <label>
              画面比例
              <select value={aspect} onChange={(event) => setAspect(event.target.value as "9:16" | "16:9")}>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
            <label>
              分辨率
              <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                <option>480p</option>
                <option>720p</option>
                <option>1080p</option>
              </select>
            </label>
            <label className="video-duration">
              时长
              <b>{duration} 秒</b>
              <input
                type="range"
                min={4}
                max={15}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
          </div>

          <section className={`video-audio-setting ${voiceEnabled ? "enabled" : "disabled"}`}>
            <header>
                <div>
                <span>配音设置</span>
                <b>配音开关</b>
                <small>{voiceEnabled ? "已开启配音" : "未开启配音"}</small>
              </div>
              <button
                type="button"
                className={`toggle ${voiceEnabled ? "on" : ""}`}
                aria-pressed={voiceEnabled}
                onClick={() => setVoiceEnabled((value) => !value)}
              >
                <i />
              </button>
            </header>
            {voiceEnabled && (
              <div className="video-voice-options">
                <label>
                  语言
                  <select value={voiceLanguage} onChange={(event) => setVoiceLanguage(event.target.value)}>
                    <option>中文</option>
                    <option>中文粤语</option>
                    <option>英语</option>
                    <option>日语</option>
                    <option>韩语</option>
                  </select>
                </label>
                <label>
                  语气
                  <select value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value)}>
                    <option>温和叙述</option>
                    <option>激昂澎湃</option>
                    <option>轻松活泼</option>
                    <option>专业解说</option>
                    <option>冷峻纪录片</option>
                  </select>
                </label>
                <label className="video-voice-script">
                  配音文本
                  <textarea
                    value={voiceScript}
                    maxLength={500}
                    onChange={(event) => setVoiceScript(event.target.value)}
                    placeholder="可填写与画面一致的配音文本，不填则自动生成"
                  />
                </label>
              </div>
            )}
          </section>

          <label className="video-negative">
            反向提示词
            <textarea
              value={negativePrompt}
              maxLength={400}
              onChange={(event) => setNegativePrompt(event.target.value)}
              placeholder="可选，避免不希望出现的元素"
            />
          </label>

          <div className="omni-reference-head">
            <div>
              <span>03 / 素材参考</span>
              <h2>素材参考</h2>
            </div>
            <b>{enabledReferences.length} / {refKindCount.image + refKindCount.video + refKindCount.audio}</b>
          </div>
          <label className="omni-dropzone">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              onChange={(event) => {
                handleFiles(event.target.files);
                if (event.currentTarget) event.currentTarget.value = "";
              }}
            />
            点击上传图片 / 视频 / 音频素材，支持拖拽引用
          </label>
          <div className="omni-url-row">
            <select value={remoteKind} onChange={(event) => setRemoteKind(event.target.value as ReferenceKind)}>
              <option value="image">图片</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
            </select>
            <input
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder="输入 http(s) 远程地址"
            />
            <button type="button" onClick={addRemoteReference}>
              添加
            </button>
          </div>

          {referenceItems.length ? (
            <div className="omni-reference-list">
              {referenceItems.map((item, index) => (
                <article key={item.id}>
                  <div className={`omni-preview ${item.kind}`}>
                    {item.kind === "image" ? (
                      <img src={item.previewUrl} alt={item.name} />
                    ) : item.kind === "video" ? (
                      <video src={item.previewUrl} muted />
                    ) : (
                      <span>音频</span>
                    )}
                    <em>{index + 1}</em>
                  </div>
                  <div className="omni-reference-info">
                    <b title={item.name}>{item.name}</b>
                    <button type="button" onClick={() => mention(item)}>
                      引用该素材
                    </button>
                  </div>
                  <select
                    value={item.role}
                    onChange={(event) => changeRole(item.id, event.target.value as ReferenceRole)}
                  >
                    {ROLE_OPTIONS[item.kind].map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <label className="omni-weight">
                    <span>权重 {item.weight}%</span>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={item.weight}
                      onChange={(event) => changeReferenceWeight(item.id, Number(event.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleReference(item.id, !item.enabled)}
                    className={item.enabled ? "enabled" : ""}
                  >
                    {item.enabled ? "启用" : "停用"}
                  </button>
                  <button type="button" onClick={() => removeReference(item.id)}>
                    删除
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="omni-empty">
              还没添加素材，可先不加直接文生视频，或补充参考素材提高一致性。
            </div>
          )}
        </section>

        <aside className="video-result-panel">
          <div className="video-panel-title">
            <span>04 / 结果面板</span>
            <h2>生成与交付</h2>
          </div>
          <div className="video-result-stage">
            {result?.url ? (
              <video src={result.url} controls playsInline />
            ) : (
              <div>
                <i>🎬</i>
                <b>尚未生成结果</b>
                <span>生成成功后自动进入剪辑可导入流程</span>
              </div>
            )}
            {result?.voiceEnabled && <em className="video-audio-badge on">配音已开启</em>}
          </div>
          <div className="video-progress">
            <div>
              <span>{status}</span>
              <b>{progress}%</b>
            </div>
            <i>
              <em style={{ width: `${progress}%` }} />
            </i>
          </div>

          {error && (
            <div className="video-error">
              <b>异常</b>
              <p>{error}</p>
            </div>
          )}

          {pendingSeedance && (
            <div className="video-pending">
              <b>待续任务</b>
              <span>{pendingSeedance.id}</span>
              <button type="button" onClick={() => void resumeSeedance()}>
                继续重试
              </button>
            </div>
          )}

          <div className="video-generate-actions">
            <button type="button" className="generate" onClick={() => void generateVideo()} disabled={busy}>
              {busy ? "生成中..." : "立即生成"}
            </button>
            <button type="button" className="stop" onClick={() => { runRef.current += 1; setBusy(false); setStatus("已取消"); }}>
              停止
            </button>
          </div>

          {result && (
            <div className="video-result-actions">
              <button type="button" onClick={downloadResult}>
                下载 MP4
              </button>
              <button type="button" onClick={() => void importToEditor()}>
                导入剪辑台
              </button>
            </div>
          )}

          <section className="video-history">
            <header>
              <b>最近作品</b>
              <span>可恢复并二次剪辑</span>
            </header>
            {historyLoading ? (
              <p>加载中…</p>
            ) : history.length ? (
              history.slice(0, 8).map((item) => (
                <article key={item.id}>
                  <button type="button" onClick={() => void openHistoryItem(item)} disabled={historyLoading}>
                    <i>{new Date(item.createdAt).toLocaleString("zh-CN")}</i>
                    <span>
                      <b>{item.name}</b>
                      <small>模型：{item.editorNote || "未命名模型"}</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => void importToEditor(item.id)}>
                    导入编辑
                  </button>
                </article>
              ))
            ) : (
              <p>暂无历史作品</p>
            )}
          </section>
        </aside>

        <aside className="video-model-panel video-custom-model-panel">
          <div className="video-panel-title">
            <span>05 / 自定义模型</span>
            <h2>自定义视频模型</h2>
            <div className="video-panel-note">支持独立保存并管理 AI 视频模型，重启后自动恢复</div>
          </div>
          <div className="video-form-grid">
            <label>模型名</label>
            <div className="video-field-tip">方便识别的显示名称，如：我的 Seedance 配置</div>
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder="如：我的Seedance模型"
            />
            <label>模型 ID</label>
            <div className="video-field-tip">模型服务侧返回的模型标识</div>
            <input
              value={customModelId}
              onChange={(event) => setCustomModelId(event.target.value)}
              placeholder="如：doubao-seedance-1-5-pro-251215"
            />
            <label>模型类型</label>
            <div className="video-field-tip">决定调用参数格式与能力边界</div>
            <select
              value={customAdapter}
              onChange={(event) => setCustomAdapter(event.target.value as VideoAdapter)}
            >
              <option value="seedance">火山 Seedance</option>
              <option value="pollinations">Pollinations</option>
              <option value="webhook">Webhook</option>
              <option value="browser">本地渲染</option>
            </select>
            <label>接口地址</label>
            <div className="video-field-tip">如留空将按适配器默认地址请求</div>
            <input value={customEndpoint} onChange={(event) => setCustomEndpoint(event.target.value)} />
            <label>API 密钥 / Token</label>
            <div className="video-field-tip">仅保留在本机，不会上传</div>
            <input
              type="password"
              value={customKey}
              onChange={(event) => setCustomKey(event.target.value)}
            />
            <button type="button" className="video-save-config" onClick={() => void addCustomModel()}>
              保存并添加自定义模型
            </button>
          </div>
          {customSaveMessage && <p className="video-config-message">{customSaveMessage}</p>}
          <div className="video-model-help">
            <b>说明</b>
            <p>保存后会加入本地自定义模型列表，页面会自动刷新选项，当前模型不影响工作台的 AI 角色配置。</p>
          </div>
          <div className="video-custom-model-list">
            {customModels.length
              ? customModels
                  .filter((item) => item.role === "video")
                  .map((item) => (
                    <article key={item.id} className="video-custom-item">
                      <div className="video-custom-item-head">
                        <b>{item.name}</b>
                        <small>{ADAPTER_LABELS[(item.adapter as VideoAdapter) || "webhook"] || item.adapter}</small>
                      </div>
                      <small className="video-custom-model-id">{item.model}</small>
                      <small className={`video-custom-model-state ${selectedPreset === item.id ? "current" : ""}`}>{selectedPreset === item.id ? "当前模型" : "未选中"}</small>
                      <button type="button" className="video-custom-model-remove" onClick={() => removeCustomModel(item.id)}>
                        删除模型
                      </button>
                      <button type="button" className="video-custom-model-use" onClick={() => changePreset(item.id)}>
                        切换到此模型
                      </button>
                    </article>
                  ))
              : <p className="video-model-empty">暂未添加</p>}
            </div>
          <Link href="/studio" className="video-model-link">
            回到AI工作台
          </Link>
        </aside>
      </section>
    </main>
  );
}
