"use client";

import { useEffect, useRef, useState } from "react";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { activateEditorProject, deleteEditorProject, listEditorProjects } from "../lib/editor-project";

type ProjectCard = { id: string; title: string; story: string; updatedAt: string; duration: string; status: string; source?: "studio" | "libtv" | "manual" | "video"; durable?: boolean };

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export default function ProjectsClient() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [filter, setFilter] = useState<"all" | "working" | "done">("all");
  const [query, setQuery] = useState("");
  const [projectAction, setProjectAction] = useState<{ id: string; type: "open" | "delete" } | null>(null);
  const [projectMessage, setProjectMessage] = useState("");
  const projectActionRef = useRef(false);

  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      void listEditorProjects().then((history) => {
        if (!active) return;
        const durable = history.map((project) => {
          const visuals = project.clips.filter((clip) => clip.type === "video" || clip.type === "image");
          const duration = visuals.reduce((sum, clip) => sum + clip.duration, 0);
          return { id: project.id, title: project.name, story: `${project.source === "libtv" ? "LibTV" : project.source === "studio" ? "AI 工作台" : project.source === "video" ? "自主视频" : "专业剪辑台"}工程 · ${visuals.length} 个画面片段，媒体已保存在本机`, updatedAt: new Date(project.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }), duration: formatDuration(duration), status: project.finalVideo?.mediaId || project.finalVideo?.url ? "已完成" : "剪辑中", source: project.source, durable: true } satisfies ProjectCard;
        });
        const story = localStorage.getItem("manjing-text-draft") || "";
        const saved = localStorage.getItem("manjing-projects");
        let items: ProjectCard[] = [];
        try { items = saved ? JSON.parse(saved) as ProjectCard[] : []; } catch { items = []; }
        if (story.trim() && !items.length) items = [{ id: "current", title: "未命名漫剧", story: story.slice(0, 90), updatedAt: "刚刚", duration: "00:30", status: "创作中" }];
        const durableIds = new Set(durable.map((item) => item.id));
        setProjects([...durable, ...items.filter((item) => !durableIds.has(item.id))]);
      }).catch(() => setProjects([]));
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, []);

  async function removeProject(id: string) {
    if (projectActionRef.current) return;
    const target = projects.find((item) => item.id === id);
    if (!target) return;
    projectActionRef.current = true;
    setProjectAction({ id, type: "delete" });
    setProjectMessage("");
    try {
      if (target.durable) await deleteEditorProject(id);
      const next = projects.filter((item) => item.id !== id);
      setProjects(next);
      localStorage.setItem("manjing-projects", JSON.stringify(next));
      try {
        const drafts = JSON.parse(localStorage.getItem("manjing-studio-drafts-v1") || "{}") as Record<string, unknown>;
        delete drafts[id];
        localStorage.setItem("manjing-studio-drafts-v1", JSON.stringify(drafts));
      } catch { /* an invalid draft index should not block project deletion */ }
      if (id === "current") localStorage.removeItem("manjing-text-draft");
      setProjectMessage(`已删除“${target.title}”`);
    } catch (reason) {
      setProjectMessage(reason instanceof Error ? `删除失败：${reason.message}` : "删除失败，请重试");
    } finally {
      projectActionRef.current = false;
      setProjectAction(null);
    }
  }

  async function openProject(project: ProjectCard) {
    if (projectActionRef.current) return;
    projectActionRef.current = true;
    setProjectAction({ id: project.id, type: "open" });
    setProjectMessage("");
    try {
      if (!project.durable) {
        localStorage.setItem("manjing-studio-open-project", project.id);
        window.location.assign("/studio");
        return;
      }
      await activateEditorProject(project.id);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      window.location.assign("/editor");
    } catch (reason) {
      setProjectMessage(reason instanceof Error ? `恢复失败：${reason.message}` : "恢复工程失败，请重试");
      projectActionRef.current = false;
      setProjectAction(null);
    }
  }

  function createSimilar() {
    if (projectActionRef.current) return;
    localStorage.setItem("manjing-new-studio", "1");
    localStorage.removeItem("manjing-studio-session-v2");
    localStorage.removeItem("manjing-text-draft");
    window.location.assign("/studio?new=1");
  }

  const visibleProjects = projects.filter((project) => {
    const matchesFilter = filter === "all" || (filter === "done" ? project.status === "已完成" : project.status !== "已完成");
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return matchesFilter && (!keyword || `${project.title} ${project.story}`.toLocaleLowerCase("zh-CN").includes(keyword));
  });

  return <main className="portal-page projects-page">
    <SiteNav current="projects" />
    <header className="subpage-hero projects-hero"><div><p>PROJECT LIBRARY</p><h1>项目与资产</h1><span>在当前设备管理漫剧、AI 视频、素材和剪辑工程。</span></div><div className="project-create-actions"><button onClick={createSimilar}>＋ 新建漫剧</button><a href="/video">＋ 自主视频</a></div></header>
    <section className="project-toolbar"><div><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部项目</button><button className={filter === "working" ? "active" : ""} onClick={() => setFilter("working")}>创作中</button><button className={filter === "done" ? "active" : ""} onClick={() => setFilter("done")}>已完成</button></div><label>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label></section>
    {projectMessage && <p className="project-action-message" role="status">{projectMessage}</p>}
    {projects.length ? visibleProjects.length ? <section className="project-grid">{visibleProjects.map((project, index) => <article key={project.id}><a className={`project-cover cover-${index % 3}`} href={`/projects/detail?id=${encodeURIComponent(project.id)}`}><span>SCENE {String(index + 1).padStart(2, "0")}</span><i>{project.source === "video" ? "影" : "漫"}</i><em>{project.duration}</em></a><div className="project-card-copy"><div><a href={`/projects/detail?id=${encodeURIComponent(project.id)}`}><b>{project.title}</b></a><span>{project.status}</span></div><p>{project.story}</p><small>更新于 {project.updatedAt}</small><div><button onClick={createSimilar}>新建同类作品</button><a href={`/projects/detail?id=${encodeURIComponent(project.id)}`}>查看项目详情</a><button onClick={() => void openProject(project)} disabled={Boolean(projectAction)}>{projectAction?.id === project.id && projectAction.type === "open" ? "正在恢复…" : project.durable ? "恢复并进入剪辑" : "继续制作"}</button><ConfirmButton onConfirm={() => removeProject(project.id)} disabled={Boolean(projectAction)} ariaLabel={`删除项目${project.title}`} confirmLabel="确认删除">{projectAction?.id === project.id && projectAction.type === "delete" ? "正在删除…" : "删除"}</ConfirmButton></div></div></article>)}</section> : <section className="project-empty compact"><i>⌕</i><h2>没有找到匹配的项目</h2><p>换一个关键词或筛选条件试试。</p><button onClick={() => { setFilter("all"); setQuery(""); }}>清除筛选</button></section> : <section className="project-empty"><i>片</i><h2>还没有保存的项目</h2><p>从 AI 工作台生成第一组剧本和分镜，项目会出现在这里。</p><button onClick={createSimilar}>创建第一部漫剧</button></section>}
  </main>;
}
