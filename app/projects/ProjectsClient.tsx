"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { listEditorProjects } from "../lib/editor-project";
import { parseSkillFile } from "../agent-system/skill-file-import";
import { activateSeriesEpisode, analyzeSeriesScript, loadSeriesProjects, saveSeriesProjects, type SeriesProject } from "../lib/series-project";

export default function ProjectsClient() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [series, setSeries] = useState<SeriesProject[]>([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [message, setMessage] = useState("创建项目或导入总剧本开始");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const loaded = loadSeriesProjects();
    setSeries(loaded);
    setSelectedId(loaded[0]?.id || "");
    void listEditorProjects().then((items) => setLegacyCount(items.length)).catch(() => undefined);
  }, []);

  const selected = useMemo(() => series.find((item) => item.id === selectedId) || null, [series, selectedId]);

  function commit(next: SeriesProject[], focus = selectedId) {
    setSeries(next);
    saveSeriesProjects(next);
    setSelectedId(focus || next[0]?.id || "");
  }

  function createBlank() {
    const name = projectName.trim() || `新系列项目 ${series.length + 1}`;
    const project = analyzeSeriesScript(name, "手动创建", "第1集\n请在项目中导入或填写本集剧本。");
    commit([project, ...series], project.id);
    setProjectName("");
    setMessage(`已创建“${name}”，可以继续导入总剧本`);
  }

  async function importScript(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setMessage(`正在读取并分析 ${file.name}…`);
    try {
      const parsed = await parseSkillFile(file);
      const project = analyzeSeriesScript(projectName.trim() || parsed.title, file.name, parsed.content);
      commit([project, ...series], project.id);
      setProjectName("");
      setMessage(`已建立“${project.name}”：识别 ${project.episodes.length} 集、${project.characters.length} 个角色、${project.memories.length} 组项目记忆`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "总剧本导入失败");
    } finally { setBusy(false); }
  }

  function updateSelected(patch: Partial<SeriesProject>) {
    if (!selected) return;
    const next = { ...selected, ...patch, updatedAt: new Date().toISOString() };
    commit(series.map((item) => item.id === selected.id ? next : item), selected.id);
  }

  function startEpisode(episodeId: string) {
    if (!selected) return;
    const episode = selected.episodes.find((item) => item.id === episodeId);
    if (!episode) return;
    activateSeriesEpisode(selected, episode);
    updateSelected({ episodes: selected.episodes.map((item) => item.id === episode.id ? { ...item, status: "producing" } : item) });
    router.push("/studio");
  }

  function removeProject(id: string) {
    commit(series.filter((item) => item.id !== id), selectedId === id ? "" : selectedId);
    setMessage("系列项目已删除；已生成的公共素材和剪辑工程未被连带删除");
  }

  return <main className="portal-page series-project-page">
    <SiteNav current="projects" />
    <header className="series-hero">
      <div><span>SERIES PRODUCTION</span><h1>系列项目中心</h1><p>一部剧一个项目。总剧本、角色圣经、项目记忆、分集状态与专属资产在这里长期承接。</p></div>
      <div className="series-create"><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="输入项目名称" /><button onClick={createBlank} disabled={busy}>新建空白项目</button><button className="primary" onClick={() => inputRef.current?.click()} disabled={busy}>导入总剧本</button><input ref={inputRef} hidden type="file" accept=".docx,.pdf,.txt,.md,.markdown,.json,.yaml,.yml,.skill" onChange={(event) => { void importScript(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div>
    </header>
    <div className="series-status"><b>{series.length} 个系列项目</b><span>{message}</span><em>{legacyCount} 个已生成剪辑工程</em></div>
    {series.length ? <section className="series-shell">
      <aside className="series-list"><b>我的系列</b>{series.map((item) => <button key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.episodes.length} 集 · {item.characters.length} 个角色</small></div></button>)}</aside>
      {selected && <div className="series-workspace">
        <header><div><span>项目档案</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /><p>来源：{selected.sourceFileName} · 更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")}</p></div><ConfirmButton onConfirm={() => removeProject(selected.id)} ariaLabel={`删除项目 ${selected.name}`} confirmLabel="确认删除项目">删除项目</ConfirmButton></header>
        <section className="series-overview"><article><b>{selected.episodes.length}</b><span>剧集</span></article><article><b>{selected.characters.length}</b><span>角色</span></article><article><b>{selected.memories.length}</b><span>项目记忆</span></article><article><b>{selected.episodes.filter((item) => item.status === "done").length}</b><span>已完成</span></article></section>
        <section className="series-section"><header><div><span>EPISODES</span><h2>选择剧集开始制作</h2></div><small>工作台只读取本集、项目长期记忆、相关角色和上一集结束状态</small></header><div className="episode-grid">{selected.episodes.map((episode) => <article key={episode.id}><i>{String(episode.number).padStart(2, "0")}</i><div><b>{episode.title}</b><p>{episode.summary}</p><small>{episode.status === "producing" ? "制作中" : episode.status === "done" ? "已完成" : "待制作"}</small></div><button onClick={() => startEpisode(episode.id)}>制作本集</button></article>)}</div></section>
        <section className="series-columns">
          <div className="series-section character-bible"><header><div><span>CHARACTER BIBLE</span><h2>角色圣经</h2></div></header>{selected.characters.length ? selected.characters.map((character) => <article key={character.id}><input value={character.name} onChange={(event) => updateSelected({ characters: selected.characters.map((item) => item.id === character.id ? { ...item, name: event.target.value } : item) })} /><textarea value={character.description} onChange={(event) => updateSelected({ characters: selected.characters.map((item) => item.id === character.id ? { ...item, description: event.target.value } : item) })} /><input value={character.relationship} onChange={(event) => updateSelected({ characters: selected.characters.map((item) => item.id === character.id ? { ...item, relationship: event.target.value } : item) })} /></article>) : <p>尚未识别人物，可在剧本中使用“角色名：台词”或人物介绍格式。</p>}</div>
          <div className="series-section memory-bible"><header><div><span>PROJECT MEMORY</span><h2>项目记忆</h2></div></header>{selected.memories.map((memory) => <article key={memory.id}><div><input value={memory.title} onChange={(event) => updateSelected({ memories: selected.memories.map((item) => item.id === memory.id ? { ...item, title: event.target.value } : item) })} /><button className={memory.locked ? "locked" : ""} onClick={() => updateSelected({ memories: selected.memories.map((item) => item.id === memory.id ? { ...item, locked: !item.locked } : item) })}>{memory.locked ? "已锁定" : "可演化"}</button></div><textarea value={memory.content} onChange={(event) => updateSelected({ memories: selected.memories.map((item) => item.id === memory.id ? { ...item, content: event.target.value } : item) })} /></article>)}</div>
        </section>
      </div>}
    </section> : <section className="series-empty"><span>01—40</span><h2>导入一整部剧本</h2><p>漫镜会自动拆分剧集，提取角色、背景故事、人物关系和连续性规则，再让你选择任意一集进入 AI 工作台。</p><button onClick={() => inputRef.current?.click()}>选择总剧本文件</button></section>}
  </main>;
}
