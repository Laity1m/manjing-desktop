"use client";

import { deleteLibraryAssetsByProject } from "../lib/asset-library";

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
  const [expandedId, setExpandedId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [message, setMessage] = useState("创建项目或导入总剧本开始");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const loaded = loadSeriesProjects();
    queueMicrotask(() => {
      setSeries(loaded);
      setSelectedId(loaded[0]?.id || "");
      setExpandedId(loaded[0]?.id || "");
    });
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

  function openProject(id: string) {
    const project = series.find((item) => item.id === id);
    setSelectedId(id);
    setExpandedId(id);
    setMessage(project ? `已打开“${project.name}”，可选择剧集、编辑角色圣经和项目记忆` : "已切换项目");
    window.setTimeout(() => document.querySelector(".series-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function startEpisode(episodeId: string) {
    if (!selected) return;
    const episode = selected.episodes.find((item) => item.id === episodeId);
    if (!episode) return;
    const normalizedContent = episode.content.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
    if (!normalizedContent || /请在项目中导入或填写本集剧本/.test(normalizedContent)) {
      setMessage("当前剧集还没有真实剧本，请先导入总剧本后再进入制作");
      return;
    }
    try {
      if (JSON.parse(localStorage.getItem("manjing-production-runtime-v1") || "null")?.active === true) {
        setMessage("当前工作台任务仍在后台制作，请等待完成或停止任务后再切换剧集");
        return;
      }
    } catch { /* Invalid runtime metadata must not block a valid handoff. */ }
    activateSeriesEpisode(selected, episode);
    const nextProject = { ...selected, updatedAt: new Date().toISOString(), episodes: selected.episodes.map((item) => item.id === episode.id ? { ...item, status: "producing" as const } : item) };
    const nextSeries = series.map((item) => item.id === selected.id ? nextProject : item);
    setSeries(nextSeries);
    try { saveSeriesProjects(nextSeries); } catch { /* never block navigation after the episode handoff has been saved */ }
    router.push("/studio");
  }

  async function removeProject(id: string) {
    const removedAssetCount = await deleteLibraryAssetsByProject(id);
    const next = series.filter((item) => item.id !== id);
    const focus = selectedId === id ? next[0]?.id || "" : selectedId;
    commit(next, focus);
    setExpandedId(focus);
    setMessage(`系列项目已删除，并同步移除 ${removedAssetCount} 项项目专属资产；全局公共资产未受影响`);
  }

  return <main className="portal-page series-project-page">
    <SiteNav current="projects" />
    <header className="series-hero">
      <div><span>SERIES PRODUCTION</span><h1>系列项目中心</h1><p>一部剧一个项目。总剧本、角色圣经、项目记忆、分集状态与专属资产在这里长期承接。</p></div>
      <div className="series-create"><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="输入项目名称" /><button type="button" onClick={createBlank} disabled={busy}>新建空白项目</button><button type="button" className="primary" onClick={() => inputRef.current?.click()} disabled={busy}>导入总剧本</button><input ref={inputRef} hidden type="file" accept=".docx,.pdf,.txt,.md,.markdown,.json,.yaml,.yml,.skill" onChange={(event) => { void importScript(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div>
    </header>
    <div className="series-status"><b>{series.length} 个系列项目</b><span>{message}</span><em>{legacyCount} 个已生成剪辑工程</em></div>
    {series.length ? <section className="series-shell">
      <aside className="series-list"><b>我的系列</b>{series.map((item, index) => <article key={item.id} className={`${item.id === selectedId ? "active" : ""} ${expandedId === item.id ? "expanded" : ""}`}><button type="button" className="series-project-main" onClick={() => expandedId === item.id ? setExpandedId("") : openProject(item.id)} aria-current={item.id === selectedId ? "page" : undefined}><span className="series-project-cover"><i>SERIES</i><b>{String(index + 1).padStart(2, "0")}</b></span><div><strong>{item.name}</strong><small><span>{item.episodes.length} 集</span><span>{item.characters.length} 个角色</span></small></div><em aria-label={expandedId === item.id ? "收起项目" : "展开项目"}>{expandedId === item.id ? "−" : "+"}</em></button>{expandedId === item.id && <div className="series-project-actions"><button type="button" onClick={() => openProject(item.id)}>打开项目</button><a href={`/assets?project=${encodeURIComponent(item.id)}`}>项目资产</a><ConfirmButton onConfirm={() => removeProject(item.id)} ariaLabel={`删除项目 ${item.name}`} confirmLabel="确认删除">删除</ConfirmButton></div>}</article>)}</aside>
      {selected && expandedId === selected.id && <div className="series-workspace">
        <header><div><span>项目档案</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /><p>来源：{selected.sourceFileName} · 更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")}</p></div><div className="series-workspace-actions"><button type="button" onClick={() => setExpandedId("")}>折叠项目</button><a href={`/assets?project=${encodeURIComponent(selected.id)}`}>进入项目资产</a><ConfirmButton onConfirm={() => removeProject(selected.id)} ariaLabel={`删除项目 ${selected.name}`} confirmLabel="确认删除项目">删除项目</ConfirmButton></div></header>
        <section className="series-overview"><article><b>{selected.episodes.length}</b><span>剧集</span></article><article><b>{selected.characters.length}</b><span>角色</span></article><article><b>{selected.memories.length}</b><span>项目记忆</span></article><article><b>{selected.episodes.filter((item) => item.status === "done").length}</b><span>已完成</span></article></section>
        <section className="series-section production-history"><header><div><span>APPROVED EVENT LEDGER</span><h2>已批准制作事件账本</h2></div><small>只有用户批准的视频镜头才会写入，并供后续镜头和下一集检索</small></header>{selected.events?.length ? <div>{selected.events.slice(0, 12).map((event) => <article key={event.id}><i>记</i><span><b>{event.episodeNumber ? `第 ${event.episodeNumber} 集 · ` : ""}{event.shotTitle}</b><small>{event.environmentKey || "未指定场景"} · {event.characters.map((item) => `${item.name}/${item.lookName}`).join("、") || "无出镜人物"} · {event.endState}</small></span></article>)}</div> : <p>尚无已批准镜头。用户批准第一条视频后，人物位置、造型、道具和结束状态会自动记录在这里。</p>}</section>
        <section className="series-section production-history"><header><div><span>PRODUCTION HISTORY</span><h2>历史成片与生成记录</h2></div><a href={`/assets?project=${encodeURIComponent(selected.id)}`}>查看全部项目资产</a></header>{selected.productions?.length ? <div>{selected.productions.map((record) => <article key={record.id}><i>▶</i><span><b>{record.title}</b><small>{record.episodeNumber ? `第 ${record.episodeNumber} 集 · ` : ""}{Math.round(record.duration)} 秒 · {new Date(record.createdAt).toLocaleString("zh-CN")}</small></span><a href={`/assets?project=${encodeURIComponent(selected.id)}&asset=${encodeURIComponent(record.assetId)}`}>查看成片</a></article>)}</div> : <p>这个项目还没有完成的成片。工作台完成合成后会自动记录在这里。</p>}</section>
        <section className="series-section"><header><div><span>EPISODES</span><h2>选择剧集开始制作</h2></div><small>工作台只读取本集、项目长期记忆、相关角色和上一集结束状态</small></header><div className="episode-grid">{selected.episodes.map((episode) => <article key={episode.id} className="episode-card" role="button" tabIndex={0} onClick={() => startEpisode(episode.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); startEpisode(episode.id); } }}><i>{String(episode.number).padStart(2, "0")}</i><div><b>{episode.title}</b><p>{episode.summary}</p><small>{episode.status === "producing" ? "制作中" : episode.status === "done" ? "已完成" : "待制作"}</small></div><button type="button" onClick={(event) => { event.stopPropagation(); startEpisode(episode.id); }}>进入制作</button></article>)}</div></section>
        <section className="series-columns">
          <div className="series-section character-bible"><header><div><span>CHARACTER BIBLE</span><h2>角色圣经</h2></div></header>{selected.characters.length ? selected.characters.map((character) => <article key={character.id}><input value={character.name} onChange={(event) => updateSelected({ characters: selected.characters.map((item) => item.id === character.id ? { ...item, name: event.target.value } : item) })} /><textarea value={character.description} onChange={(event) => updateSelected({ characters: selected.characters.map((item) => item.id === character.id ? { ...item, description: event.target.value } : item) })} /><input value={character.relationship} onChange={(event) => updateSelected({ characters: selected.characters.map((item) => item.id === character.id ? { ...item, relationship: event.target.value } : item) })} /></article>) : <p>尚未识别人物，可在剧本中使用“角色名：台词”或人物介绍格式。</p>}</div>
          <div className="series-section memory-bible"><header><div><span>PROJECT MEMORY</span><h2>项目记忆</h2></div></header>{selected.memories.map((memory) => <article key={memory.id}><div><input value={memory.title} onChange={(event) => updateSelected({ memories: selected.memories.map((item) => item.id === memory.id ? { ...item, title: event.target.value } : item) })} /><button type="button" className={memory.locked ? "locked" : ""} onClick={() => updateSelected({ memories: selected.memories.map((item) => item.id === memory.id ? { ...item, locked: !item.locked } : item) })}>{memory.locked ? "已锁定" : "可演化"}</button></div><textarea value={memory.content} onChange={(event) => updateSelected({ memories: selected.memories.map((item) => item.id === memory.id ? { ...item, content: event.target.value } : item) })} /></article>)}</div>
        </section>
      </div>}
    </section> : <section className="series-empty"><span>01—40</span><h2>导入一整部剧本</h2><p>漫镜会自动拆分剧集，提取角色、背景故事、人物关系和连续性规则，再让你选择任意一集进入 AI 工作台。</p><button onClick={() => inputRef.current?.click()}>选择总剧本文件</button></section>}
  </main>;
}
