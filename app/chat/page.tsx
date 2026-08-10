"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import { AGENT_PROFILES, LearnedItem, agentContext, createLearnedItem, markContextUsed, mergeLearnedItems, readLearnedItems, writeLearnedItems } from "../agent-system/learning-store";

type Message = { from: "user" | "agent"; text: string };
type AgentChats = Record<string, Message[]>;
const CHAT_KEY = "manjing-agent-chats-v145";
const welcome = (): Message[] => [{ from: "agent", text: "我已准备好。你可以直接交代任务，也可以让我去学习中心搜索和整理新方法。" }];

export default function ChatPage() {
  const [agentId, setAgentId] = useState("director");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [chats, setChats] = useState<AgentChats>({});
  useEffect(() => { const sync = () => setItems(readLearnedItems()); sync(); try { const saved = JSON.parse(localStorage.getItem(CHAT_KEY) || "{}"); if (saved && typeof saved === "object") setChats(saved); } catch {} window.addEventListener("manjing-learning-changed", sync); return () => window.removeEventListener("manjing-learning-changed", sync); }, []);
  const agent = AGENT_PROFILES.find((item) => item.id === agentId) || AGENT_PROFILES[0];
  const context = useMemo(() => items.filter((item) => item.agentId === agentId && item.status === "approved" && item.enabled), [items, agentId]);
  const messages = chats[agentId] || welcome();
  function saveMessages(next: Message[]) { const updated = { ...chats, [agentId]: next.slice(-200) }; setChats(updated); localStorage.setItem(CHAT_KEY, JSON.stringify(updated)); }
  function send() {
    const value = message.trim(); if (!value) return;
    const used = agentContext(agentId).slice(0, 5);
    const note = used.length ? `本次已检索并参考：${used.map((item) => item.title).join("、")}。` : "当前还没有启用的岗位记忆，我会先按基础职责处理。";
    saveMessages([...messages, { from: "user", text: value }, { from: "agent", text: `${note}\n\n我会以“${agent.duty}”为目标执行。你可以把有效结论保存为技能或长期记忆。` }]); markContextUsed(used.map((item) => item.id)); setMessage("");
  }
  function remember(text: string, kind: "skill" | "memory") {
    const next = mergeLearnedItems(readLearnedItems(), [createLearnedItem({ agentId, kind, title: kind === "skill" ? text.slice(0, 36) : "对话记忆", content: text, source: "Agent 对话", confidence: 100, enabled: true, status: "approved", memoryClass: kind === "skill" ? "permanent" : "experience", importance: kind === "skill" ? 8 : 6, whyRemembered: "用户在岗位对话中明确要求保存" })]);
    writeLearnedItems(next); setItems(next);
  }
  return <main className="agent-chat-page"><SiteNav current="chat" /><section className="agent-chat-shell">
    <aside className="agent-roster"><header><span>AGENT TEAM</span><h1>创作团队</h1><p>每个岗位拥有独立对话、技能与长期记忆。</p></header><nav>{AGENT_PROFILES.map((item) => <button key={item.id} className={item.id === agentId ? "active" : ""} onClick={() => setAgentId(item.id)}><i>{item.icon}</i><span><b>{item.name}</b><small>{item.duty}</small></span><em>{item.id === agentId ? "在线" : ""}</em></button>)}</nav><Link className="agent-new-button" href="/learning">＋ 创建学习任务</Link></aside>
    <section className="agent-conversation"><header><div className="agent-avatar">{agent.icon}</div><div><span>当前对话</span><h2>{agent.name}</h2></div><aside><Link href="/learning">让它去学习</Link><Link href="/studio">转到工作区</Link></aside></header><div className="agent-context-strip"><span>已载入</span><b>{context.filter((item) => item.kind === "memory").length} 条记忆 · {context.filter((item) => item.kind === "skill").length} 个技能</b></div>
      <div className="agent-message-list"><div className="agent-day">今天</div>{messages.map((item, index) => <article key={index} className={item.from}><i>{item.from === "agent" ? agent.icon : "我"}</i><div><b>{item.from === "agent" ? agent.name : "你"}</b><p>{item.text}</p>{item.from === "agent" && <footer><button onClick={() => remember(item.text, "memory")}>记住这条</button><button onClick={() => remember(item.text, "skill")}>保存为技能</button><Link href="/studio">用于工作区</Link></footer>}</div></article>)}</div>
      <div className="agent-composer"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={`给 ${agent.name} 发送消息…`} /><div><Link href="/learning">MCP 搜索 / 本地视频学习</Link><span>已启用上下文 {context.length} 条</span><button onClick={send}>发送 <b>→</b></button></div></div>
    </section>
    <aside className="agent-inspector"><header><span>AGENT PROFILE</span><h2>{agent.name}</h2><p>{agent.duty}</p></header><section><div><b>本次可调用能力</b><Link href="/skills">管理全部</Link></div>{context.slice(0, 8).map((item, index) => <article key={item.id}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.title}</b><small>{item.source} · 自动检索</small></span><em>{item.kind === "skill" ? "技能" : "记忆"}</em></article>)}</section><footer><i /> 本地记忆已同步</footer></aside>
  </section></main>;
}
