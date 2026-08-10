"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import { parseSkillFile } from "../agent-system/skill-file-import";
import { AGENT_PROFILES, LearnedItem, MemoryClass, archiveLearnedItem, createLearnedItem, mergeLearnedItems, readLearnedItems, restoreLearnedItem, writeLearnedItems } from "../agent-system/learning-store";

type VaultTab = "skill" | "memory" | "archive";
const MEMORY_LABELS: Record<MemoryClass, string> = { experience: "经历", permanent: "永久", reflection: "复盘", identity: "自我认知", anchor: "工作锚点" };

export default function SkillsPage() {
  const [agentId, setAgentId] = useState("director");
  const [tab, setTab] = useState<VaultTab>("skill");
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draft, setDraft] = useState("");
  const [importStatus, setImportStatus] = useState("");
  useEffect(() => { const sync = () => setItems(readLearnedItems()); sync(); window.addEventListener("manjing-learning-changed", sync); return () => window.removeEventListener("manjing-learning-changed", sync); }, []);
  const agent = AGENT_PROFILES.find((item) => item.id === agentId) || AGENT_PROFILES[0];
  const visible = useMemo(() => items.filter((item) => item.agentId === agentId && (tab === "archive" ? item.status === "archived" : item.status === "approved" && item.kind === tab)), [items, agentId, tab]);
  const preview = items.find((item) => item.id === previewId);
  function persist(next: LearnedItem[]) { const merged = mergeLearnedItems([], next); setItems(merged); writeLearnedItems(merged); }
  function patch(id: string, changes: Partial<LearnedItem>) { persist(items.map((item) => item.id === id ? { ...item, ...changes, version: changes.content !== undefined && changes.content !== item.content ? item.version + 1 : item.version, updatedAt: new Date().toISOString() } : item)); }
  function add() { const value = draft.trim(); if (!value || tab === "archive") return; const kind = tab; persist([...items, createLearnedItem({ agentId, kind, title: draftName.trim() || (kind === "skill" ? "自定义技能" : "手动记忆"), content: value, source: "用户编辑", confidence: 100, enabled: true, status: "approved", memoryClass: kind === "skill" ? "permanent" : "experience", importance: kind === "skill" ? 8 : 6, whyRemembered: "用户手动加入岗位档案" })]); setDraftName(""); setDraft(""); }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setImportStatus(`正在读取 ${files.length} 个技能文件…`);
    const imported: LearnedItem[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const document = await parseSkillFile(file);
        imported.push(createLearnedItem({ agentId, kind: "skill", title: document.title, content: document.content, source: document.source, confidence: 100, enabled: true, status: "approved", memoryClass: "permanent", importance: 8, tags: document.tags, whyRemembered: "用户导入的完整技能文档" }));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${file.name} 导入失败`);
      }
    }
    if (imported.length) persist([...items, ...imported]);
    setTab("skill");
    setImportStatus(errors.length ? `成功导入 ${imported.length} 个；${errors.join("；")}` : `成功导入 ${imported.length} 个完整技能`);
  }
  return <main className="skill-vault-page"><SiteNav current="skills" />
    <section className="skill-vault-hero"><div><span>AGENT CAPABILITY VAULT</span><h1>技能与记忆</h1><p>每个技能都是一份完整方法。导入、预览、命名、编辑和版本管理都在这里完成。</p></div><div className="skill-hero-actions"><label>导入技能文件<input type="file" multiple accept=".skill,.md,.markdown,.txt,.json,.yaml,.yml,.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /></label><Link href="/learning">前往学习中心</Link></div></section>
    <section className="skill-vault-shell"><aside className="skill-agent-list"><b>选择 Agent</b>{AGENT_PROFILES.map((item) => { const count = items.filter((entry) => entry.agentId === item.id && entry.status === "approved").length; return <button key={item.id} className={item.id === agentId ? "active" : ""} onClick={() => setAgentId(item.id)}><i>{item.icon}</i><span>{item.name}<small>{count} 项能力已同步</small></span></button>; })}</aside>
      <section className="skill-vault-content"><header><div><span>当前档案</span><h2>{agent.name}</h2></div><nav><button className={tab === "skill" ? "active" : ""} onClick={() => setTab("skill")}>完整技能</button><button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}>长期记忆</button><button className={tab === "archive" ? "active" : ""} onClick={() => setTab("archive")}>归档</button><Link href="/learning">候选审核</Link></nav></header>
        <div className="skill-toolbar"><div><h3>{tab === "skill" ? "岗位技能库" : tab === "memory" ? "长期记忆库" : "归档内容"}</h3><p>{tab === "skill" ? "支持 Word、PDF、Markdown、Skill、TXT、JSON 和 YAML。每个文件导入为一个完整技能。" : tab === "archive" ? "归档内容不会进入 Agent 上下文。" : "启用的记忆会按重要度和使用情况自动检索。"}</p></div><span>{visible.length} 项</span></div>
        {importStatus && <div className="skill-import-status">{importStatus}</div>}
        <div className="skill-document-grid">{visible.map((item, index) => <article key={item.id} className={`skill-document-card ${item.enabled ? "" : "disabled"}`}><header><i>{String(index + 1).padStart(2, "0")}</i><em>{item.kind === "skill" ? "SKILL" : MEMORY_LABELS[item.memoryClass]}</em></header><div className="skill-document-icon">{item.pinned ? "锚" : item.kind === "skill" ? "技" : "记"}</div><h3>{item.title}</h3><p>{item.content.replace(/^#+\s*/gm, "").slice(0, 150)}{item.content.length > 150 ? "…" : ""}</p><div className="skill-document-meta"><span>v{item.version}</span><span>重要度 {item.importance}</span><span>{item.source}</span></div><footer><button className="primary" onClick={() => setPreviewId(item.id)}>预览与编辑</button>{tab === "archive" ? <><button onClick={() => patch(item.id, restoreLearnedItem(item))}>恢复</button><button className="danger" onClick={() => persist(items.filter((entry) => entry.id !== item.id))}>删除</button></> : <><button onClick={() => patch(item.id, { enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</button><button onClick={() => patch(item.id, { pinned: !item.pinned, memoryClass: !item.pinned ? "anchor" : item.kind === "skill" ? "permanent" : "experience" })}>{item.pinned ? "取消钉选" : "钉选"}</button><button className="danger" onClick={() => patch(item.id, archiveLearnedItem(item))}>归档</button></>}</footer></article>)}</div>
        {!visible.length && <div className="skill-empty"><i>{tab === "skill" ? "技" : tab === "memory" ? "记" : "档"}</i><h3>这里还没有内容</h3><p>{tab === "skill" ? "导入一份完整技能文件，或在下方手动创建。" : tab === "archive" ? "被归档的技能和记忆会保留在这里。" : "可以手动添加，也可以让 Agent 通过学习中心积累。"}</p></div>}
        {tab !== "archive" && <div className="skill-create-panel"><input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={tab === "skill" ? "技能名称" : "记忆名称"} /><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={tab === "skill" ? "写下这项技能的完整步骤、规则、检查项和输出格式…" : "写下一条需要长期保留的完整记忆…"} /><button onClick={add}>创建完整{tab === "skill" ? "技能" : "记忆"}</button></div>}
      </section>
    </section>
    {preview && <div className="skill-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewId(""); }}><section className="skill-preview-modal"><header><div><span>FULL SKILL PREVIEW</span><input value={preview.title} onChange={(event) => patch(preview.id, { title: event.target.value })} aria-label="技能名称" /></div><button onClick={() => setPreviewId("")}>关闭</button></header><div className="skill-preview-source"><b>{preview.source}</b><span>版本 {preview.version} · 使用 {preview.activationCount} 次</span>{preview.sourceUrl && <a href={preview.sourceUrl} target="_blank" rel="noreferrer">查看来源</a>}</div><textarea value={preview.content} onChange={(event) => patch(preview.id, { content: event.target.value })} /><footer><label>重要度<input type="number" min={1} max={10} value={preview.importance} onChange={(event) => patch(preview.id, { importance: Math.max(1, Math.min(10, Number(event.target.value))) })} /></label><button onClick={() => patch(preview.id, { enabled: !preview.enabled })}>{preview.enabled ? "已启用，点击停用" : "已停用，点击启用"}</button><button className="primary" onClick={() => setPreviewId("")}>完成</button></footer></section></div>}
  </main>;
}
