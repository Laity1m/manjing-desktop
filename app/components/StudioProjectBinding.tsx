"use client";

import { useEffect, useMemo, useState } from "react";
import { activateSeriesEpisode, loadSeriesProjects, type SeriesProject } from "../lib/series-project";

type ActiveContext = { projectId?: string; episodeId?: string; projectName?: string; episodeNumber?: number };

export default function StudioProjectBinding() {
  const [projects, setProjects] = useState<SeriesProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [message, setMessage] = useState("可在工作台直接绑定或切换系列项目");

  useEffect(() => {
    const loaded = loadSeriesProjects();
    let active: ActiveContext = {};
    try { active = JSON.parse(sessionStorage.getItem("manjing-active-series-context-v1") || localStorage.getItem("manjing-active-series-context-v1") || "{}"); } catch { /* Use the first available project. */ }
    const initialProject = loaded.find((item) => item.id === active.projectId) || loaded[0];
    const initialEpisode = initialProject?.episodes.find((item) => item.id === active.episodeId) || initialProject?.episodes[0];
    queueMicrotask(() => {
    setProjects(loaded);
    setProjectId(initialProject?.id || "");
    setEpisodeId(initialEpisode?.id || "");
    if (active.projectId && initialProject) setMessage(`当前已绑定：${initialProject.name} · 第 ${active.episodeNumber || initialEpisode?.number || 1} 集`);
    });
  }, []);

  useEffect(() => {
    const refresh = () => {
      const loaded = loadSeriesProjects();
      setProjects(loaded);
      setProjectId((current) => loaded.some((item) => item.id === current) ? current : loaded[0]?.id || "");
      setEpisodeId((current) => loaded.some((item) => item.episodes.some((episode) => episode.id === current)) ? current : loaded[0]?.episodes[0]?.id || "");
    };
    const refreshFromStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "manjing-series-projects-v1") refresh();
    };
    window.addEventListener("manjing-series-projects-changed", refresh);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      window.removeEventListener("manjing-series-projects-changed", refresh);
      window.removeEventListener("storage", refreshFromStorage);
    };
  }, []);
  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const episode = useMemo(() => project?.episodes.find((item) => item.id === episodeId), [project, episodeId]);

  function chooseProject(nextId: string) {
    const next = projects.find((item) => item.id === nextId);
    setProjectId(nextId);
    setEpisodeId(next?.episodes[0]?.id || "");
    setMessage(next ? `已选择“${next.name}”，请选择要制作的剧集` : "请选择项目");
  }

  function bindProject() {
    if (!project || !episode) { setMessage("请先选择项目和剧集"); return; }
    try {
      if (JSON.parse(localStorage.getItem("manjing-production-runtime-v1") || "null")?.active === true) {
        setMessage("当前漫剧仍在后台制作，请等待完成或先停止任务后再切换项目");
        return;
      }
    } catch { /* Invalid runtime metadata must not block an explicit project binding. */ }    try {
      const context = activateSeriesEpisode(project, episode);
      window.dispatchEvent(new CustomEvent("manjing-series-context-changed", { detail: context }));
      window.localStorage.removeItem("manjing-new-studio");
      setMessage(`已绑定“${project.name}”第 ${episode.number} 集，工作台内容和资产归属已同步`);
    } catch (reason) {
      setMessage(reason instanceof Error ? `绑定失败：${reason.message}` : "绑定失败，请重试");
    }
  }

  return <section className="studio-project-binding" aria-label="当前项目与剧集">
    <div className="binding-summary"><span>PROJECT BINDING</span><b>{project ? project.name : "尚未绑定系列项目"}</b><small>{message}</small></div>
    {projects.length ? <div className="binding-controls">
      <label><span>当前项目</span><select value={projectId} onChange={(event) => chooseProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>当前剧集</span><select value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>{project?.episodes.map((item) => <option key={item.id} value={item.id}>第 {item.number} 集 · {item.title}</option>)}</select></label>
      <button type="button" onClick={bindProject} disabled={!episode}>绑定并同步到工作台</button>
    </div> : <a className="binding-empty" href="/projects">先到项目中心创建或导入总剧本</a>}
  </section>;
}
