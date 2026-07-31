"use client";

import { useEffect, useState } from "react";
import SiteNav from "../components/SiteNav";

type ProjectCard = { id: string; title: string; story: string; updatedAt: string; duration: string; status: string };

export default function ProjectsClient() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [filter, setFilter] = useState<"all" | "working" | "done">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const story = localStorage.getItem("manjing-text-draft") || "";
      const saved = localStorage.getItem("manjing-projects");
      let items: ProjectCard[] = [];
      try { items = saved ? JSON.parse(saved) as ProjectCard[] : []; } catch { items = []; }
      if (story.trim() && !items.length) items = [{ id: "current", title: "未命名漫剧", story: story.slice(0, 90), updatedAt: "刚刚", duration: "00:30", status: "创作中" }];
      setProjects(items);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function removeProject(id: string) {
    const next = projects.filter((item) => item.id !== id);
    setProjects(next);
    localStorage.setItem("manjing-projects", JSON.stringify(next));
    if (id === "current") localStorage.removeItem("manjing-text-draft");
  }

  const visibleProjects = projects.filter((project) => {
    const matchesFilter = filter === "all" || (filter === "done" ? project.status === "已完成" : project.status !== "已完成");
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return matchesFilter && (!keyword || `${project.title} ${project.story}`.toLocaleLowerCase("zh-CN").includes(keyword));
  });

  return <main className="portal-page projects-page">
    <SiteNav current="projects" />
    <header className="subpage-hero projects-hero"><div><p>PROJECT LIBRARY</p><h1>项目与资产</h1><span>在当前设备管理剧本草稿、角色资产、分镜和剪辑工程。</span></div><a href="/studio">＋ 新建漫剧</a></header>
    <section className="project-toolbar"><div><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部项目</button><button className={filter === "working" ? "active" : ""} onClick={() => setFilter("working")}>创作中</button><button className={filter === "done" ? "active" : ""} onClick={() => setFilter("done")}>已完成</button></div><label>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label></section>
    {projects.length ? visibleProjects.length ? <section className="project-grid">{visibleProjects.map((project, index) => <article key={project.id}><div className={`project-cover cover-${index % 3}`}><span>SCENE {String(index + 1).padStart(2, "0")}</span><i>漫</i><em>{project.duration}</em></div><div className="project-card-copy"><div><b>{project.title}</b><span>{project.status}</span></div><p>{project.story}</p><small>更新于 {project.updatedAt}</small><div><a href="/studio">继续生成</a><a href="/editor">进入剪辑</a><button onClick={() => removeProject(project.id)}>删除</button></div></div></article>)}</section> : <section className="project-empty compact"><i>⌕</i><h2>没有找到匹配的项目</h2><p>换一个关键词或筛选条件试试。</p><button onClick={() => { setFilter("all"); setQuery(""); }}>清除筛选</button></section> : <section className="project-empty"><i>片</i><h2>还没有保存的项目</h2><p>从 AI 工作台生成第一组剧本和分镜，项目会出现在这里。</p><a href="/studio">创建第一部漫剧</a></section>}
  </main>;
}
