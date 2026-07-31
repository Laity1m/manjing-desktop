"use client";

import { useState } from "react";
import SiteNav from "../components/SiteNav";

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
  { id: "seedance", badge: "视频", name: "即梦 · Seedance", role: "逐镜生成文生视频和图生视频", keyName: "ARK_API_KEY", format: "火山方舟 API Key", cost: "按视频生成计费", color: "orange", docs: "https://www.volcengine.com/docs/82379/1520757", steps: ["登录火山引擎并进入火山方舟控制台", "开通视频生成模型并创建 API Key", "复制模型 ID 或推理 Endpoint ID", "在 AI 工作台应用到“视频 AI”岗位"], models: ["Seedance Pro", "Seedance Lite I2V", "自建 Endpoint"] },
  { id: "pollinations", badge: "综合", name: "Pollinations", role: "语言、生图、视频、配音的托管入口", keyName: "POLLINATIONS_KEY", format: "以 pk_ 开头", cost: "免费额度 / 付费额度", color: "blue", docs: "https://enter.pollinations.ai", steps: ["打开 Pollinations 账户页面", "创建以 pk_ 开头的发布密钥", "在工作台选择“推荐 AI 制片组”", "填入统一备用密钥或某个岗位专用密钥"], models: ["OpenAI compatible", "Kontext", "Seedance", "TTS"] },
  { id: "webhook", badge: "自定义", name: "通用 Webhook", role: "连接任意自建或第三方模型服务", keyName: "BEARER_TOKEN", format: "Bearer token，可选", cost: "由接口提供方决定", color: "green", docs: "/studio#provider", steps: ["准备一个支持 HTTPS 的生成接口", "选择对应 AI 岗位的“自定义接口”", "填写 Webhook 地址、模型 ID 和 Bearer Token", "使用“检测连接”确认返回格式"], models: ["OpenAI 兼容", "ComfyUI", "Veo", "Sora", "ElevenLabs"] },
  { id: "local", badge: "本地", name: "漫镜本地桥接", role: "连接 ComfyUI、Wan2.2、CosyVoice、MuseTalk", keyName: "BRIDGE_TOKEN", format: "自己设置的本地密钥", cost: "模型免费，消耗本机算力", color: "teal", docs: "/manjing-local-bridge.zip", steps: ["下载并解压漫镜本地桥接服务", "按 README 启动所需的本地模型节点", "设置 BRIDGE_TOKEN 并启动桥接服务", "在工作台填写地址、密钥并检测连接"], models: ["Wan2.2", "ComfyUI", "CosyVoice", "MuseTalk"] },
  { id: "horde", badge: "免费", name: "AI Horde", role: "匿名社区编剧、导演和生图队列", keyName: "无需 Key", format: "默认即可使用", cost: "免费社区算力", color: "gray", docs: "https://github.com/Haidra-Org/AI-Horde", steps: ["进入 AI 工作台", "选择“免费默认阵容”", "输入故事并开始生成", "高峰期需要排队，输出可能被自动补全"], models: ["社区 LLM", "Stable Horde"] },
];

export default function KeysClient() {
  const [selected, setSelected] = useState(PROVIDERS[0].id);
  const [copied, setCopied] = useState("");
  const provider = PROVIDERS.find((item) => item.id === selected) || PROVIDERS[0];

  async function copyKeyName(value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(value);
    window.setTimeout(() => setCopied(""), 1600);
  }

  return <main className="portal-page keys-page">
    <SiteNav current="models" />
    <header className="subpage-hero"><p>MODEL CONNECTIONS</p><h1>把每个 AI 岗位，接到最合适的模型。</h1><span>所有密钥只保存在当前浏览器，不会写入网站部署文件。正式生成仍会消耗对应平台额度。</span></header>
    <section className="keys-layout">
      <aside className="provider-list"><div><b>模型提供方</b><span>{PROVIDERS.length} 种连接方式</span></div>{PROVIDERS.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}><i className={item.color}>{item.name.slice(0, 1)}</i><span><b>{item.name}</b><small>{item.role}</small></span><em>{item.badge}</em></button>)}</aside>
      <div className="provider-detail">
        <div className="provider-detail-head"><div><span>{provider.badge}</span><h2>{provider.name}</h2><p>{provider.role}</p></div><a href={provider.docs} target={provider.docs.startsWith("http") ? "_blank" : undefined} rel="noreferrer">打开官方说明 ↗</a></div>
        <div className="key-spec-grid"><article><span>密钥名称</span><b>{provider.keyName}</b><button onClick={() => void copyKeyName(provider.keyName)}>{copied === provider.keyName ? "已复制" : "复制名称"}</button></article><article><span>常见格式</span><b>{provider.format}</b></article><article><span>费用说明</span><b>{provider.cost}</b></article></div>
        <div className="key-walkthrough"><div><span>HOW TO CONNECT</span><h3>四步完成接入</h3></div><ol>{provider.steps.map((step, index) => <li key={step}><i>{String(index + 1).padStart(2, "0")}</i><p>{step}</p></li>)}</ol></div>
        <div className="model-tags"><b>可用模型 / 能力</b><div>{provider.models.map((model) => <span key={model}>{model}</span>)}</div></div>
        <div className="key-safety"><i>!</i><div><b>密钥安全提醒</b><p>不要把 Key 发到群聊、截图或公开仓库；不要写进前端源码。漫镜只把你填写的 Key 用于当前请求和当前浏览器的本地保存。</p></div></div>
        <a className="provider-apply" href="/studio">前往 AI 工作台配置 <span>→</span></a>
      </div>
    </section>
  </main>;
}
