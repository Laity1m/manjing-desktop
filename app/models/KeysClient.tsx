"use client";

import { useEffect, useRef, useState } from "react";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { API_MODE_DEFAULT_ENDPOINTS, API_MODE_LABELS, apiModesForRole, discoverApiModels, isDiscoverableApiMode, type DiscoverableApiMode, type DiscoveredModel } from "../lib/custom-api";
import { loadCustomModels, saveCustomModels, saveCustomModelsToDesktop, type CustomModel, type CustomModelAdapter, type CustomModelRole } from "../lib/custom-models";

type Provider = {
  id: string;
  badge: string;
  name: string;
  role: string;
  keyName: string;
  format: string;
  cost: string;
  color: string;
  docs: string;
  steps: string[];
  models: string[];
};

const PROVIDERS: Provider[] = [
  { id: "libtv", badge: "全流程", name: "LibTV", role: "一键完成剧本、分镜、视频和剪辑", keyName: "LIBTV_ACCESS_KEY", format: "平台签发的 Access Key", cost: "按平台额度", color: "violet", docs: "https://github.com/libtv-labs/libtv-skills", steps: ["登录 LibTV / LiblibAI 并开通 Agent 接口", "在开发者或 Agent 设置中创建 Access Key", "回到 AI 工作台的“LibTV 一键漫剧”卡片", "粘贴密钥后点击“一键生成完整 AI 漫剧”"], models: ["Seedance", "Kling", "Wan", "Seedream"] },
  { id: "seedance", badge: "视频", name: "Seedance · 方舟 API", role: "逐镜生成文生视频和图生视频", keyName: "ARK_API_KEY", format: "火山方舟 API Key", cost: "按视频生成计费", color: "orange", docs: "https://www.volcengine.com/docs/82379/1520758", steps: ["登录火山引擎并进入火山方舟控制台", "开通 Seedance 视频生成模型并创建 API Key", "复制模型 ID 或推理 Endpoint ID", "在 AI 工作台应用到“视频 AI”岗位"], models: ["Seedance Pro", "Seedance Lite I2V", "自建 Endpoint"] },
  { id: "jimeng", badge: "视觉 API", name: "即梦官方模型", role: "即梦同源生图与视频模型", keyName: "VOLC_ACCESS_KEY + VOLC_SECRET_KEY", format: "火山引擎 Access Key / Secret Key", cost: "按视觉 API 计费", color: "orange", docs: "https://www.volcengine.com/docs/85621/1756900", steps: ["登录火山引擎控制台", "在密钥管理创建 Access Key 与 Secret Key", "开通对应即梦视觉模型", "通过自定义 Webhook 或本地桥接完成签名调用"], models: ["即梦文生图 3.1", "即梦视频 Pro", "即梦视频 3.0"] },
  { id: "pollinations", badge: "综合", name: "Pollinations", role: "语言、生图、视频、配音的托管入口", keyName: "POLLINATIONS_KEY", format: "以 pk_ 开头", cost: "免费额度 / 付费额度", color: "blue", docs: "https://enter.pollinations.ai", steps: ["打开 Pollinations 账户页面", "创建以 pk_ 开头的发布密钥", "在工作台选择“推荐 AI 制片组”", "填入统一备用密钥或某个岗位专用密钥"], models: ["OpenAI compatible", "Kontext", "Seedance", "TTS"] },
  { id: "webhook", badge: "自定义", name: "通用 Webhook", role: "连接任意自建或第三方模型服务", keyName: "BEARER_TOKEN", format: "Bearer token，可选", cost: "由接口提供方决定", color: "green", docs: "/studio#provider", steps: ["准备一个支持 HTTPS 的生成接口", "选择对应 AI 岗位的“自定义接口”", "填写 Webhook 地址、模型 ID 和 Bearer Token", "使用“检测连接”确认返回格式"], models: ["OpenAI 兼容", "ComfyUI", "Veo", "Sora", "ElevenLabs"] },
  { id: "local", badge: "本地", name: "漫镜本地桥接", role: "统一连接视觉、视频、配音、口型与开源剪辑节点", keyName: "BRIDGE_TOKEN", format: "自己设置的本地密钥", cost: "模型免费，消耗本机算力", color: "teal", docs: "/manjing-local-bridge.zip", steps: ["下载并解压漫镜本地桥接服务", "按 README 启动需要的本地节点，不用的可以不启动", "设置 BRIDGE_TOKEN 并启动桥接服务", "在工作台填写地址、密钥并检测连接"], models: ["Wan2.2", "ComfyUI", "CosyVoice", "MuseTalk", "MoneyPrinterTurbo", "VibeVoice Realtime"] },
  { id: "moneyprinter", badge: "开源剪辑", name: "MoneyPrinterTurbo", role: "把漫镜时间线素材自动拼接、配音、加字幕并压制成片", keyName: "无需平台 Key", format: "本机 API · 默认 127.0.0.1:8080", cost: "代码免费，消耗本机算力及所选 TTS/LLM 额度", color: "green", docs: "https://github.com/harry0703/MoneyPrinterTurbo", steps: ["按官方 README 安装 MoneyPrinterTurbo 和 FFmpeg", "启动服务并确认 http://127.0.0.1:8080/docs 可访问", "在漫镜桥接 .env 中设置 MONEYPRINTER_URL", "把工作台作品导入剪辑台，点击“MPT 开源自动成片”"], models: ["本地素材顺序剪辑", "FFmpeg 压制", "TTS", "字幕", "BGM"] },
  { id: "vibevoice", badge: "实验配音", name: "Microsoft VibeVoice", role: "本机流式语音生成与可选 ASR 节点", keyName: "无需平台 Key", format: "本机 API · 默认 127.0.0.1:3000", cost: "模型免费，消耗本机 GPU/CPU", color: "violet", docs: "https://github.com/microsoft/VibeVoice", steps: ["按微软官方说明安装 VibeVoice 与 Realtime 0.5B 权重", "运行官方 realtime demo 并确认 /config 可访问", "在漫镜桥接 .env 中设置 VIBEVOICE_URL", "在开源节点中心检测后应用到配音 AI"], models: ["VibeVoice-Realtime-0.5B", "24 kHz PCM 流", "英文单角色（实验）", "VibeVoice-ASR（可选检测）"] },
  { id: "horde", badge: "免费", name: "AI Horde", role: "匿名社区编剧、导演和生图队列", keyName: "无需 Key", format: "默认即可使用", cost: "免费社区算力", color: "gray", docs: "https://github.com/Haidra-Org/AI-Horde", steps: ["进入 AI 工作台", "选择“免费默认阵容”", "输入故事并开始生成", "高峰期需要排队，输出可能被自动补全"], models: ["社区 LLM", "Stable Horde"] },
];

const ROLE_LABELS: Record<CustomModelRole, string> = { director: "导演 AI", writer: "编剧与分镜 AI", image: "生图 AI", video: "视频 AI", voice: "配音 AI", editor: "剪辑 AI" };
const EMPTY_MODEL: Omit<CustomModel, "id"> = { role: "writer", name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" };

export default function KeysClient() {
  const [selected, setSelected] = useState(PROVIDERS[0].id);
  const [copied, setCopied] = useState("");
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [draft, setDraft] = useState<Omit<CustomModel, "id">>(EMPTY_MODEL);
  const [modelMessage, setModelMessage] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelOptions, setModelOptions] = useState<DiscoveredModel[]>([]);
  const modelWriteRef = useRef(false);
  const provider = PROVIDERS.find((item) => item.id === selected) || PROVIDERS[0];

  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      setCustomModels(loadCustomModels());
      void fetch("/api/desktop/settings", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const settings = await response.json() as { customModels?: CustomModel[] };
        if (active && Array.isArray(settings.customModels)) setCustomModels(settings.customModels);
      }).catch(() => undefined);
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, []);

  async function copyKeyName(value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(value);
    window.setTimeout(() => setCopied(""), 1600);
  }

  function changeRole(role: CustomModelRole) {
    const adapter = apiModesForRole(role).includes(draft.adapter as DiscoverableApiMode) ? draft.adapter : "webhook";
    setDraft((value) => ({ ...value, role, adapter, endpoint: adapter === "webhook" ? "" : API_MODE_DEFAULT_ENDPOINTS[adapter as DiscoverableApiMode], model: "" }));
    setModelOptions([]);
    setModelMessage("");
  }

  function changeAdapter(adapter: CustomModelAdapter) {
    setDraft((value) => ({ ...value, adapter, endpoint: isDiscoverableApiMode(adapter) ? API_MODE_DEFAULT_ENDPOINTS[adapter] : "", model: "" }));
    setModelOptions([]);
    setModelMessage("");
  }

  async function discoverModels() {
    if (!isDiscoverableApiMode(draft.adapter)) return;
    const endpoint = draft.endpoint.trim() || API_MODE_DEFAULT_ENDPOINTS[draft.adapter];
    if (!/^https?:\/\//i.test(endpoint)) return setModelMessage("请先填写 http:// 或 https:// API 地址");
    setModelLoading(true);
    setModelMessage("正在测试连接并读取模型列表…");
    try {
      const models = await discoverApiModels({ mode: draft.adapter, endpoint, apiKey: draft.apiKey.trim() });
      setModelOptions(models);
      setDraft((value) => ({ ...value, endpoint, model: models.some((item) => item.id === value.model) ? value.model : models[0].id }));
      setModelMessage(`连接成功，读取到 ${models.length} 个模型`);
    } catch (reason) {
      setModelOptions([]);
      setModelMessage(reason instanceof Error ? reason.message : "读取模型失败，请检查模式、地址和 Key");
    } finally {
      setModelLoading(false);
    }
  }

  async function addCustomModel() {
    if (modelWriteRef.current) return;
    const modelId = draft.model.trim();
    if (!modelId) return setModelMessage("请先读取并选择模型，或手动填写模型 ID");
    if (isDiscoverableApiMode(draft.adapter) && !/^https?:\/\//i.test((draft.endpoint.trim() || API_MODE_DEFAULT_ENDPOINTS[draft.adapter]))) return setModelMessage("请填写 http:// 或 https:// API 地址");
    const model: CustomModel = { ...draft, id: `custom-${draft.role}-${Date.now().toString(36)}`, name: draft.name.trim() || modelId, model: modelId, endpoint: draft.endpoint.trim() || (isDiscoverableApiMode(draft.adapter) ? API_MODE_DEFAULT_ENDPOINTS[draft.adapter] : ""), apiKey: draft.apiKey.trim(), note: draft.note.trim() || "用户自定义模型" };
    const next = [model, ...customModels];
    modelWriteRef.current = true;
    setModelSaving(true);
    try {
      await saveCustomModelsToDesktop(next);
      saveCustomModels(next);
      setCustomModels(next);
      setDraft({ ...EMPTY_MODEL, role: draft.role });
      setModelOptions([]);
      setModelMessage(`${model.name} 已提交并加入 ${ROLE_LABELS[model.role]}，回到工作台即可选择。`);
    } catch {
      setModelMessage("提交失败：本机模型库暂时不可写，请重启软件后重试");
    } finally {
      modelWriteRef.current = false;
      setModelSaving(false);
    }
  }

  async function removeCustomModel(id: string) {
    if (modelWriteRef.current) return;
    const target = customModels.find((item) => item.id === id);
    if (!target) return;
    const next = customModels.filter((item) => item.id !== id);
    modelWriteRef.current = true;
    setModelSaving(true);
    try {
      await saveCustomModelsToDesktop(next, id);
      saveCustomModels(next);
      setCustomModels(next);
      setModelMessage(`已删除“${target.name}”；若岗位正在使用它，下次进入工作台会自动恢复默认模型`);
    } catch {
      setModelMessage("删除失败：独立版本机配置暂时无法写入，请重试");
    } finally {
      modelWriteRef.current = false;
      setModelSaving(false);
    }
  }

  return <main className="portal-page keys-page">
    <SiteNav current="models" />
    <header className="subpage-hero"><p>模型连接中心</p><h1>把每个 AI 岗位，接到最合适的模型。</h1><span>独立版会把密钥与模型配置持久保存在当前电脑，不会写入网站部署文件。正式生成仍会消耗对应平台额度。</span></header>
    <section className="keys-layout">
      <aside className="provider-list"><div><b>模型提供方</b><span>{PROVIDERS.length} 种连接方式</span></div>{PROVIDERS.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}><i className={item.color}>{item.name.slice(0, 1)}</i><span><b>{item.name}</b><small>{item.role}</small></span><em>{item.badge}</em></button>)}</aside>
      <div className="provider-detail">
        <div className="provider-detail-head"><div><span>{provider.badge}</span><h2>{provider.name}</h2><p>{provider.role}</p></div><a href={provider.docs} target={provider.docs.startsWith("http") ? "_blank" : undefined} rel="noreferrer">打开官方说明 ↗</a></div>
        <div className="key-spec-grid"><article><span>密钥名称</span><b>{provider.keyName}</b><button onClick={() => void copyKeyName(provider.keyName)}>{copied === provider.keyName ? "已复制" : "复制名称"}</button></article><article><span>常见格式</span><b>{provider.format}</b></article><article><span>费用说明</span><b>{provider.cost}</b></article></div>
        <div className="key-walkthrough"><div><span>接入教程</span><h3>四步完成接入</h3></div><ol>{provider.steps.map((step, index) => <li key={step}><i>{String(index + 1).padStart(2, "0")}</i><p>{step}</p></li>)}</ol></div>
        <div className="model-tags"><b>可用模型 / 能力</b><div>{provider.models.map((model) => <span key={model}>{model}</span>)}</div></div>
        <div className="key-safety"><i>!</i><div><b>密钥安全提醒</b><p>不要把 Key 发到群聊、截图或公开仓库；不要写进前端源码。漫镜只把你填写的 Key 用于当前请求，并保存在这台电脑的应用数据目录。</p></div></div>
        <a className="provider-apply" href="/studio">前往 AI 工作台配置 <span>→</span></a>
      </div>
    </section>
    <section id="custom" className="custom-model-builder">
      <div className="custom-model-heading"><div><span>我的模型库</span><h2>每个 AI 岗位，都能添加自己的模型</h2><p>保存后会直接出现在 AI 工作台对应岗位的下拉列表中，并在下次启动时自动恢复。</p></div><a href="/studio">返回 AI 工作台 →</a></div>
      <div className="custom-model-grid">
        <div className="custom-model-form">
          <div className="custom-role-tabs">{(Object.keys(ROLE_LABELS) as CustomModelRole[]).map((role) => <button key={role} className={draft.role === role ? "active" : ""} onClick={() => changeRole(role)}>{ROLE_LABELS[role]}</button>)}</div>
          <div className="custom-form-fields">
            <label>API 模式<select value={draft.adapter} onChange={(event) => changeAdapter(event.target.value as CustomModelAdapter)}>{apiModesForRole(draft.role).map((modeName) => <option key={modeName} value={modeName}>{API_MODE_LABELS[modeName]}</option>)}{draft.role === "video" && <option value="seedance">Seedance 方舟 API</option>}{["video", "editor"].includes(draft.role) && <option value="browser">浏览器本地处理</option>}</select></label>
            {isDiscoverableApiMode(draft.adapter) && <label>API 接口地址<input value={draft.endpoint} onChange={(event) => setDraft((value) => ({ ...value, endpoint: event.target.value }))} placeholder={API_MODE_DEFAULT_ENDPOINTS[draft.adapter] || "https://your-api.example/v1"} /></label>}
            {draft.adapter !== "browser" && <label>API 密钥 / 令牌<input type="password" value={draft.apiKey} onChange={(event) => setDraft((value) => ({ ...value, apiKey: event.target.value }))} onBlur={() => { if (isDiscoverableApiMode(draft.adapter) && draft.apiKey.trim() && draft.endpoint.trim()) void discoverModels(); }} placeholder="粘贴后离开输入框将自动读取模型" /></label>}
            {isDiscoverableApiMode(draft.adapter) && <button type="button" className="discover-custom-models" onClick={() => void discoverModels()} disabled={modelLoading}>{modelLoading ? "正在连接并读取…" : "测试连接并读取模型列表"}</button>}
            {modelOptions.length > 0 && <label>接口返回的模型<select value={draft.model} onChange={(event) => setDraft((value) => ({ ...value, model: event.target.value }))}>{modelOptions.map((item) => <option key={item.id} value={item.id}>{item.name === item.id ? item.id : `${item.name} · ${item.id}`}</option>)}</select></label>}
            <label>模型 ID（可手动填写）<input value={draft.model} onChange={(event) => setDraft((value) => ({ ...value, model: event.target.value }))} placeholder="读取后自动填入，或手动输入" /></label>
            <label>显示名称（可选）<input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder={`默认使用模型 ID，也可写“我的${ROLE_LABELS[draft.role]}”`} /></label>
            <label>备注<input value={draft.note} onChange={(event) => setDraft((value) => ({ ...value, note: event.target.value }))} placeholder="能力、费用或使用说明" /></label>
          </div>
          <button type="button" className="save-custom-model" onClick={() => void addCustomModel()} disabled={modelSaving || modelLoading}>{modelSaving ? "正在写入本机模型库…" : "＋ 提交并保存到我的模型库"}</button>
          {modelMessage && <p className="custom-model-message">{modelMessage}</p>}
        </div>
        <div className="custom-model-list"><div><b>已添加模型</b><span>{customModels.length} 个</span></div><small>这里保存的是你的模型库，可随时删除；服务商接口实时返回的模型列表不会被修改。</small>{customModels.length ? customModels.map((model) => <article key={model.id}><i>{ROLE_LABELS[model.role].slice(0, 1)}</i><div><b>{model.name}</b><span>{ROLE_LABELS[model.role]} · {model.adapter}</span><small>{model.model}{model.note ? ` · ${model.note}` : ""}</small></div><ConfirmButton onConfirm={() => removeCustomModel(model.id)} disabled={modelSaving} ariaLabel={`删除自定义模型${model.name}`} confirmLabel="确认删除">删除</ConfirmButton></article>) : <div className="custom-model-empty"><i>＋</i><p>还没有自定义模型<br />从左侧选择岗位并填写接口</p></div>}</div>
      </div>
    </section>
  </main>;
}
