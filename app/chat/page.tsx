"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import { AGENT_PROFILES, type LearnedItem, createLearnedItem, mergeLearnedItems, readLearnedItems, recordSkillInvocation, resolveAgentContext, writeLearnedItems } from "../agent-system/learning-store";

type Message = { from: "user" | "agent"; text: string; error?: boolean };
type AgentChats = Record<string, Message[]>;
type SavedAgentConfig = { adapter?: string; endpoint?: string; apiKey?: string; model?: string };
type SavedAgentConfigs = Record<string, SavedAgentConfig>;

const CHAT_KEY = "manjing-agent-chats-v145";
const CONFIG_KEY = "manjing-agent-team";
const DISPATCH_KEY = "manjing-producer-dispatch-v147";
const PRODUCER_CONFIG_KEY = "manjing-producer-model-v147";
const PROMPT_DEFAULT_CONFIG: SavedAgentConfig = { adapter: "openai", endpoint: "https://api.openai.com/v1", apiKey: "", model: "gpt-5" };
const TEXT_MODES = new Set(["openai", "anthropic", "gemini", "pollinations", "webhook"]);
const welcome = (): Message[] => [{ from: "agent", text: "我已准备好。你可以和我讨论创作、修改方案、交代任务，也可以把重要结论保存为我的长期记忆或技能。" }];

function readAgentConfigs(): SavedAgentConfigs {
  const defaultProducer = { adapter: "pollinations", endpoint: "https://text.pollinations.ai/openai", apiKey: "", model: "openai" };
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    const team = value && typeof value === "object" ? value as SavedAgentConfigs : {};
    const producer = JSON.parse(localStorage.getItem(PRODUCER_CONFIG_KEY) || "null") as SavedAgentConfig | null;
    return { ...team, producer: producer || defaultProducer };
  } catch {
    return { producer: defaultProducer };
  }
}

function conversationConfig(agentId: string, configs: SavedAgentConfigs) {
  const own = ["producer", "director", "writer", "prompt", "editor"].includes(agentId) ? configs[agentId] : undefined;
  if (own && TEXT_MODES.has(String(own.adapter || "")) && own.model) return own;
  for (const fallback of [configs.writer, configs.director, configs.editor]) {
    if (fallback && TEXT_MODES.has(String(fallback.adapter || "")) && fallback.model) return fallback;
  }
  return { adapter: "pollinations", endpoint: "https://text.pollinations.ai/openai", apiKey: "", model: "openai" };
}

async function responseError(response: Response) {
  const data = await response.clone().json().catch(() => null) as { error?: string } | null;
  return data?.error || `聊天接口返回 ${response.status}`;
}

function dispatchProducerKnowledge(text: string) {
  if (!/记住|以后|必须|需要|保持|统一|规则|技能|要求|设定|标准|流程/.test(text)) return [] as string[];
  const routes = [
    { id: "image", name: "生图 Agent", test: /生图|人物图|角色图|场景图|道具图|分镜图|参考图|画面生成|图像一致性/ },
    { id: "prompt", name: "镜头总控 Agent", test: /提示词|资产调用|Canonical|Start State|End State|Seedance|运镜|镜头状态|参考资产/ },
    { id: "writer", name: "编剧 Agent", test: /剧本|剧情|台词|人物关系|故事|角色弧光/ },
    { id: "director", name: "导演 Agent", test: /导演|表演|风格|调度|一致性|换装|造型/ },
    { id: "storyboard", name: "分镜 Agent", test: /分镜|镜头|场景|构图|道具|景别|机位/ },
    { id: "video", name: "视频 Agent", test: /视频|动态|动作|运镜|Seedance|时长|清晰度/ },
    { id: "voice", name: "配音 Agent", test: /配音|声音|音色|对白|旁白|口型|音乐/ },
    { id: "editor", name: "剪辑 Agent", test: /剪辑|字幕|转场|节奏|成片|导出/ },
  ];
  let selected = routes.filter((route) => route.test.test(text));
  if (!selected.length) selected = routes;
  const kind = /技能|方法|流程|标准|怎么做/.test(text) ? "skill" as const : "memory" as const;
  const current = readLearnedItems();
  const dispatched = selected.map((route) => createLearnedItem({ agentId: route.id, kind, title: `总制片派送：${text.slice(0, 28)}`, content: text, source: "总制片 Agent 派送", confidence: 100, enabled: true, status: "approved", memoryClass: kind === "skill" ? "permanent" : "anchor", scope: "agent", importance: 9, tags: ["总制片派送", "跨岗位协作"], whyRemembered: "用户向总制片明确提出了需要长期执行的创作要求" }));
  writeLearnedItems(mergeLearnedItems(current, dispatched));
  let history: unknown[] = [];
  try { const saved = JSON.parse(localStorage.getItem(DISPATCH_KEY) || "[]"); history = Array.isArray(saved) ? saved : []; } catch {}
  localStorage.setItem(DISPATCH_KEY, JSON.stringify([{ id: crypto.randomUUID(), text, targets: selected.map((item) => item.id), createdAt: new Date().toISOString() }, ...history].slice(0, 200)));
  return selected.map((route) => route.name);
}

export default function ChatPage() {
  const [agentId, setAgentId] = useState("director");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [chats, setChats] = useState<AgentChats>({});
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const [producerConfig, setProducerConfig] = useState<SavedAgentConfig>({ adapter: "pollinations", endpoint: "https://text.pollinations.ai/openai", apiKey: "", model: "openai" });
  const [promptConfig, setPromptConfig] = useState<SavedAgentConfig>(PROMPT_DEFAULT_CONFIG);

  useEffect(() => {
    const sync = () => setItems(readLearnedItems());
    sync();
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_KEY) || "{}");
      if (saved && typeof saved === "object") setChats(saved);
      const producer = JSON.parse(localStorage.getItem(PRODUCER_CONFIG_KEY) || "null");
      if (producer && typeof producer === "object") setProducerConfig(producer as SavedAgentConfig);
      const prompt = readAgentConfigs().prompt;
      if (prompt && typeof prompt === "object") setPromptConfig({ ...PROMPT_DEFAULT_CONFIG, ...prompt });
    } catch {}
    window.addEventListener("manjing-learning-changed", sync);
    return () => window.removeEventListener("manjing-learning-changed", sync);
  }, []);

  useEffect(() => {
    const focusComposer = () => {
      if (window.location.hash === "#agent-chat-input") window.setTimeout(() => inputRef.current?.focus(), 30);
    };
    focusComposer();
    window.addEventListener("hashchange", focusComposer);
    return () => window.removeEventListener("hashchange", focusComposer);
  }, []);

  const agent = AGENT_PROFILES.find((item) => item.id === agentId) || AGENT_PROFILES[0];
  const context = useMemo(() => items.filter((item) => item.agentId === agentId && item.status === "approved" && item.enabled), [items, agentId]);
  const messages = chats[agentId] || welcome();

  function saveMessages(next: Message[]) {
    setChats((current) => {
      const updated = { ...current, [agentId]: next.slice(-200) };
      localStorage.setItem(CHAT_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  function updateProducerConfig(patch: SavedAgentConfig) {
    setProducerConfig((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(PRODUCER_CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }

  function updatePromptConfig(patch: SavedAgentConfig) {
    setPromptConfig((current) => {
      const next = { ...current, ...patch };
      let team: SavedAgentConfigs = {};
      try { team = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); } catch {}
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...team, prompt: next }));
      return next;
    });
  }

  const independentConfig = agentId === "prompt" ? promptConfig : producerConfig;
  const updateIndependentConfig = agentId === "prompt" ? updatePromptConfig : updateProducerConfig;

  function deleteMessage(index: number) {
    if (!window.confirm("只删除这条聊天记录吗？已经另存为技能或记忆的内容不会被删除。")) return;
    saveMessages(messages.filter((_, messageIndex) => messageIndex !== index));
  }

  function clearCurrentChat() {
    if (!window.confirm(`清空与“${agent.name}”的全部聊天记录吗？该岗位已经保存的技能和长期记忆会保留。`)) return;
    saveMessages([]);
  }

  function clearAllChats() {
    if (!window.confirm("清空所有 Agent 的聊天记录吗？技能、记忆和工作区成果不会被删除。")) return;
    setChats({});
    localStorage.removeItem(CHAT_KEY);
  }

  async function send() {
    const value = message.trim();
    if (!value || busy) return;
    const userMessage: Message = { from: "user", text: value };
    const pending = [...messages, userMessage];
    saveMessages(pending);
    setMessage("");
    setBusy(true);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const resolution = resolveAgentContext({ agentId, task: "agent_chat", query: value, limit: 10, maxCharacters: 10000 });
    const used = resolution.items;
    const config = conversationConfig(agentId, readAgentConfigs());
    const history = messages.slice(-12).map((item) => `${item.from === "user" ? "用户" : agent.name}：${item.text}`).join("\n");
    const learned = used.length ? used.map((item) => `- [${item.kind === "skill" ? "技能" : "记忆"}] ${item.title}：${item.content.slice(0, 1200)}`).join("\n") : "暂无已启用的岗位技能或长期记忆。";
    const system = `你是漫镜创作团队中的${agent.name}。岗位职责：${agent.duty}。你正在与用户进行独立、连续的真实对话。\n直接理解并回答用户当前的问题；问候就自然问候，询问能力就具体介绍能力，创作问题就给出可执行方案。不要机械复述技能名称，不要每次都说“已检索并参考”，不要声称已经执行用户没有要求或尚未完成的操作。只有相关时才自然运用记忆和技能。回答使用简体中文。\n\n该岗位已启用的技能与记忆：\n${learned}`;
    const prompt = `${history ? `最近对话：\n${history}\n\n` : ""}用户最新消息：${value}`;
    try {
      const response = await fetch("/api/desktop/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: config.adapter, endpoint: config.endpoint || "", apiKey: config.apiKey || "", model: config.model || "openai", role: agentId, task: "agent_chat", system, prompt }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { text?: string };
      if (!data.text?.trim()) throw new Error("模型没有返回可用回复");
      const targets = agentId === "producer" ? dispatchProducerKnowledge(value) : [];
      const dispatchNote = targets.length ? `\n\n已派送到：${targets.join("、")}。你可以在“技能与记忆”中编辑、停用或删除。` : "";
      saveMessages([...pending, { from: "agent", text: `${data.text.trim()}${dispatchNote}` }]);
      recordSkillInvocation({ agentId, task: "agent_chat", projectId: resolution.projectId, channel: config.adapter || "chat", items: used });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        saveMessages([...pending, { from: "agent", text: "本次回复已停止。你可以修改问题后继续发送。" }]);
        return;
      }
      const detail = reason instanceof Error ? reason.message : "未知错误";
      saveMessages([...pending, { from: "agent", text: `这次没有生成有效回复：${detail}\n\n请在“模型中心”或 AI 工作台为编剧、导演或剪辑岗位配置可用的文本模型后重试。`, error: true }]);
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
      setBusy(false);
    }
  }

  function stopReply() {
    requestControllerRef.current?.abort();
  }

  function remember(text: string, kind: "skill" | "memory") {
    const next = mergeLearnedItems(readLearnedItems(), [createLearnedItem({ agentId, kind, title: kind === "skill" ? text.slice(0, 36) : "对话记忆", content: text, source: "Agent 对话", confidence: 100, enabled: true, status: "approved", memoryClass: kind === "skill" ? "permanent" : "experience", importance: kind === "skill" ? 8 : 6, whyRemembered: "用户在岗位对话中明确要求保存" })]);
    writeLearnedItems(next);
    setItems(next);
  }

  return <main className="agent-chat-page"><SiteNav current="chat" /><section className="agent-chat-shell">
    <aside className="agent-roster"><header><span>AGENT TEAM</span><h1>创作团队</h1><p>每个岗位拥有独立对话、技能与长期记忆。</p></header><nav>{AGENT_PROFILES.map((item) => <button key={item.id} className={item.id === agentId ? "active" : ""} onClick={() => setAgentId(item.id)}><i>{item.icon}</i><span><b>{item.name}</b><small>{item.duty}</small></span><em>{item.id === agentId ? "在线" : ""}</em></button>)}</nav><Link className="agent-new-button" href="/learning">＋ 创建学习任务</Link></aside>
    <section className="agent-conversation"><header><div className="agent-avatar">{agent.icon}</div><div><span>当前对话</span><h2>{agent.name}</h2></div><aside><button onClick={() => setAgentId("producer")}>总制片</button><button onClick={() => setAgentId("director")}>导演对话</button><Link href="/learning">让它去学习</Link><Link href="/studio">转到工作区</Link></aside></header><div className="agent-context-strip"><span>已载入</span><b>{context.filter((item) => item.kind === "memory").length} 条记忆 · {context.filter((item) => item.kind === "skill").length} 个技能{["producer", "prompt"].includes(agentId) ? ` · 当前模型 ${independentConfig.model || "未配置"}` : ""}</b><div className="chat-history-actions"><button disabled={busy || !messages.length} onClick={clearCurrentChat}>清空当前</button><button disabled={busy || !Object.keys(chats).length} onClick={clearAllChats}>清空全部</button></div></div>
      <div className="agent-message-list"><div className="agent-day">今天</div>{messages.map((item, index) => <article key={index} className={`${item.from}${item.error ? " error" : ""}`}><i>{item.from === "agent" ? agent.icon : "我"}</i><div><b>{item.from === "agent" ? agent.name : "你"}</b><button className="message-delete" disabled={busy} onClick={() => deleteMessage(index)} title="删除这条聊天记录">删除</button><p>{item.text}</p>{item.from === "agent" && !item.error && <footer><button onClick={() => remember(item.text, "memory")}>记住这条</button><button onClick={() => remember(item.text, "skill")}>保存为技能</button><Link href="/studio">用于工作区</Link></footer>}</div></article>)}</div>
      <div className="agent-composer"><textarea id="agent-chat-input" ref={inputRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!busy) void send(); } }} placeholder={busy ? `${agent.name} 正在回复，你仍然可以输入下一条消息…` : `给 ${agent.name} 发送消息…`} /><div><Link href="/learning">MCP 搜索 / 本地视频学习</Link><span>{busy ? "正在生成回复，可随时停止" : `已启用上下文 ${context.length} 条`}</span><button className={busy ? "stop" : ""} onClick={() => busy ? stopReply() : void send()}>{busy ? "停止回复" : "发送"}<b>{busy ? "■" : "→"}</b></button></div></div>
    </section>
    <aside className="agent-inspector"><header><span>AGENT PROFILE</span><h2>{agent.name}</h2><p>{agent.duty}</p></header>{["producer", "prompt"].includes(agentId) && <section className="producer-model-config"><div><b>{agentId === "prompt" ? "镜头总控独立 API" : "总制片独立 API"}</b><em>自动保存</em></div><label>接口模式<select value={independentConfig.adapter === "openai" ? (independentConfig.endpoint || "").includes("api.openai.com") ? "openai-official" : "openai-custom" : independentConfig.adapter || "pollinations"} onChange={(event) => { const mode = event.target.value; if (mode === "openai-official") updateIndependentConfig({ adapter: "openai", endpoint: "https://api.openai.com/v1", model: independentConfig.model && independentConfig.model !== "your-model" ? independentConfig.model : "gpt-5" }); else if (mode === "openai-custom") updateIndependentConfig({ adapter: "openai", endpoint: (independentConfig.endpoint || "").includes("api.openai.com") ? "" : independentConfig.endpoint, model: independentConfig.model || "your-model" }); else updateIndependentConfig({ adapter: mode }); }}><option value="pollinations">Pollinations</option><option value="openai-official">OpenAI 官方 API</option><option value="openai-custom">OpenAI 兼容自定义接口</option><option value="anthropic">Anthropic 兼容</option><option value="gemini">Gemini</option><option value="webhook">通用 Webhook</option></select></label><label>Base URL<input value={independentConfig.endpoint || ""} onChange={(event) => updateIndependentConfig({ endpoint: event.target.value })} placeholder={independentConfig.adapter === "openai" ? "https://api.openai.com/v1" : "https://..."} /></label><label>API Key<input type="password" value={independentConfig.apiKey || ""} onChange={(event) => updateIndependentConfig({ apiKey: event.target.value })} placeholder="仅保存在本机" /></label><label>模型 ID<input value={independentConfig.model || ""} onChange={(event) => updateIndependentConfig({ model: event.target.value })} placeholder={agentId === "prompt" ? "例如 gpt-5" : "模型 ID"} /></label><small>{agentId === "prompt" ? "镜头总控的聊天与工作台提示词编译共用此配置，不借用其他岗位 API。" : "总制片只使用这里配置的文本模型，不再隐式借用其他岗位 API。"}</small></section>}<section><div><b>本次可调用能力</b><Link href="/skills">管理全部</Link></div>{context.slice(0, 8).map((item, index) => <article key={item.id}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.title}</b><small>{item.source} · 自动检索</small></span><em>{item.kind === "skill" ? "技能" : "记忆"}</em></article>)}</section><footer><i /> 本地记忆已同步</footer></aside>
  </section></main>;
}
