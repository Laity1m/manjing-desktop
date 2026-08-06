"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { activateEditorProject, deleteEditorProject, listEditorProjects } from "../lib/editor-project";

type ProjectCard = {
  id: string;
  title: string;
  story: string;
  updatedAt: string;
  duration: string;
  status: string;
  source?: "studio" | "libtv" | "manual" | "video";
  durable?: boolean;
};

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export default function ProjectsClient() {
  const router = useRouter();
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
          return {
            id: project.id,
            title: project.name,
            story: `${project.source === "libtv" ? "LibTV" : project.source === "studio" ? "AI 漫剧工作台" : project.source === "video" ? "AI 视频" : "剪辑台"} | 场景 ${visuals.length} 个`,
            updatedAt: new Date(project.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            duration: formatDuration(duration),
            status: project.finalVideo?.mediaId || project.finalVideo?.url ? "已完成" : "制作中",
            source: project.source,
            durable: true,
          } satisfies ProjectCard;
        });
        const story = localStorage.getItem("manjing-text-draft") || "";
        const saved = localStorage.getItem("manjing-projects");
        let items: ProjectCard[] = [];
        try {
          items = saved ? JSON.parse(saved) as ProjectCard[] : [];
        } catch {
          items = [];
        }
        if (story.trim() && !items.length) {
          items = [{ id: "current", title: "当前草稿", story: story.slice(0, 90), updatedAt: "now", duration: "00:30", status: "草稿中", source: "studio", durable: false }];
        }
        const durableIds = new Set(durable.map((item) => item.id));
        setProjects([...durable, ...items.filter((item) => !durableIds.has(item.id))]);
      }).catch(() => setProjects([]));
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
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
      if (id === "current") localStorage.removeItem("manjing-text-draft");
      setProjectMessage(`已删除 ${target.title}`);
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
        router.push("/studio");
        return;
      }
      await activateEditorProject(project.id);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      router.push("/editor");
    } catch (reason) {
      setProjectMessage(reason instanceof Error ? `打开失败：${reason.message}` : "打开失败，请重试");
      projectActionRef.current = false;
      setProjectAction(null);
    }
  }

  function createSimilar() {
    if (projectActionRef.current) return;
    localStorage.setItem("manjing-new-studio", "1");
    localStorage.removeItem("manjing-studio-session-v2");
    localStorage.removeItem("manjing-text-draft");
    router.push("/studio?new=1");
  }

  const visibleProjects = projects.filter((project) => {
    const matchesFilter = filter === "all" || (filter === "done" ? project.status === "已完成" : project.status !== "已完成");
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return matchesFilter && (!keyword || `${project.title} ${project.story}`.toLocaleLowerCase("zh-CN").includes(keyword));
  });

  return <main className="portal-page projects-page">
    <SiteNav current="projects" />
    <header className="subpage-hero projects-hero">
      <div>
        <p>项目库</p>
        <h1>项目与资产</h1>
        <span>集中查看漫剧、AI 视频和剪辑工程。</span>
      </div>
      <div className="project-create-actions">
        <button onClick={createSimilar}>＋ 新建漫剧</button>
        <Link href="/video">＋ 自主视频</Link>
      </div>
    </header>

    <section className="project-toolbar">
      <div>
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部项目</button>
        <button className={filter === "working" ? "active" : ""} onClick={() => setFilter("working")}>制作中</button>
        <button className={filter === "done" ? "active" : ""} onClick={() => setFilter("done")}>已完成</button>
      </div>
      <label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label>
    </section>

    {projectMessage && <p className="project-action-message" role="status">{projectMessage}</p>}

    {projects.length ? (
      visibleProjects.length ? (
        <section className="project-grid">
          {visibleProjects.map((project, index) => (
            <article key={project.id}>
              <Link className={`project-cover cover-${index % 3}`} href={`/projects/detail?id=${encodeURIComponent(project.id)}`}>
                <span>场景 {String(index + 1).padStart(2, "0")}</span>
                <i>{project.source === "video" ? "AI 视频" : "AI 漫剧"}</i>
                <em>{project.duration}</em>
              </Link>
              <div className="project-card-copy">
                <div>
                  <Link href={`/projects/detail?id=${encodeURIComponent(project.id)}`}>
                    <b>{project.title}</b>
                  </Link>
                  <span>{project.status}</span>
                </div>
                <p>{project.story}</p>
                <small>更新：{project.updatedAt}</small>
                <div>
                  <button onClick={createSimilar}>克隆为新项目</button>
                  <Link href={`/projects/detail?id=${encodeURIComponent(project.id)}`}>查看项目详情</Link>
                  <button onClick={() => void openProject(project)} disabled={Boolean(projectAction)}>
                    {projectAction?.id === project.id && projectAction.type === "open" ? "正在打开…" : project.durable ? "打开" : "恢复并打开"}
                  </button>
                  <ConfirmButton onConfirm={() => removeProject(project.id)} disabled={Boolean(projectAction)} ariaLabel={`删除项目${project.title}`} confirmLabel="确认删除">
                    {projectAction?.id === project.id && projectAction.type === "delete" ? "正在删除…" : "删除"}
                  </ConfirmButton>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="project-empty">
          <i>🗂️</i>
          <h2>未匹配到项目</h2>
          <p>当前筛选条件下无结果。请尝试调整关键字或状态。</p>
          <button onClick={createSimilar}>清空筛选并新建</button>
        </section>
      )
    ) : (
      <section className="project-empty">
        <i>🗂️</i>
        <h2>还没有项目</h2>
        <p>先创建一个漫剧项目或 AI 视频项目开始制作。</p>
        <button onClick={createSimilar}>创建第一个作品</button>
      </section>
    )}
  </main>;
}
