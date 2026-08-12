"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SiteNav from "../../components/SiteNav";
import ConfirmButton from "../../components/ConfirmButton";
import { activateEditorProject, deleteEditorProject, getEditorProjectMetadataById, type EditorProject } from "../../lib/editor-project";

type DraftProject = { id: string; title: string; story: string; updatedAt: string; duration: string; status: string };

function time(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function sourceName(source?: EditorProject["source"]) {
  return source === "studio" ? "AI 漫剧工作台" : source === "libtv" ? "LibTV 画布" : source === "video" ? "自主 AI 视频" : "剪辑台";
}

export default function ProjectDetailClient() {
  const router = useRouter();
  const [project, setProject] = useState<EditorProject | null>(null);
  const [draft, setDraft] = useState<DraftProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [message, setMessage] = useState("");
  const projectId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("id") || "";

  useEffect(() => {
    let active = true;
    if (!projectId) {
      queueMicrotask(() => {
        if (!active) return;
        setLoading(false);
        setMessage("未指定项目");
      });
      return;
    }
    void getEditorProjectMetadataById(projectId).then((stored) => {
      if (!active) return;
      if (stored) {
        setProject(stored);
        return;
      }
      try {
        const drafts = JSON.parse(localStorage.getItem("manjing-projects") || "[]") as DraftProject[];
        setDraft(drafts.find((item) => item.id === projectId) || null);
      } catch {
        setDraft(null);
      }
    }).catch((reason) => {
      if (active) setMessage(reason instanceof Error ? reason.message : "读取项目失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const counts = useMemo(() => {
    const clips = project?.clips || [];
    return {
      video: clips.filter((item) => item.type === "video").length,
      image: clips.filter((item) => item.type === "image").length,
      audio: clips.filter((item) => item.type === "audio").length,
      text: clips.filter((item) => item.type === "text").length,
      duration: clips.filter((item) => item.type === "video" || item.type === "image").reduce((sum, item) => sum + item.duration, 0),
    };
  }, [project]);

  async function openEditor() {
    if (!project || action) return;
    setAction("editor");
    setMessage("正在准备剪辑台");
    try {
      await activateEditorProject(project.id);
      router.push("/editor");
    } catch (reason) {
      setAction("");
      setMessage(reason instanceof Error ? `进入失败：${reason.message}` : "进入失败，请重试");
    }
  }

  function continueProject() {
    if (action) return;
    try {
      if (JSON.parse(localStorage.getItem("manjing-production-runtime-v1") || "null")?.active === true) {
        setMessage("当前漫剧仍在后台制作，完成或停止后才能切换工程");
        return;
      }
    } catch { /* Invalid runtime metadata must not block an explicit project action. */ }
    if (!project) {
      if (draft?.id) localStorage.setItem("manjing-studio-open-project", draft.id);
      router.push("/studio");
      return;
    }
    if (project.source === "studio" || project.source === "libtv") {
      localStorage.setItem("manjing-studio-open-project", project.id);
      router.push("/studio");
      return;
    }
    void openEditor();
  }

  async function remove() {
    if (!project || action) return;
    setAction("delete");
    try {
      await deleteEditorProject(project.id);
      router.push("/projects");
    } catch (reason) {
      setAction("");
      setMessage(reason instanceof Error ? `删除失败：${reason.message}` : "删除失败");
    }
  }

  return <main className="portal-page project-detail-page">
    <SiteNav current="projects" />
    <header className="project-detail-header"><Link href="/projects">返回项目资产</Link><span>项目详情</span></header>
    {loading ? <section className="project-detail-loading"><i />正在读取项目详情…</section> : project ? <>
      <section className="project-detail-hero">
        <div>
          <span>{sourceName(project.source)}</span>
          <h1>{project.name}</h1>
          <p>{project.editorNote || "该项目已进入资产与输出流程。"}</p>
          <small>{new Date(project.createdAt).toLocaleString("zh-CN")}</small>
        </div>
        <aside>
          <b>{project.finalVideo?.mediaId || project.finalVideo?.url ? "已生成" : "已建"}</b>
          <span>{time(counts.duration)}</span>
        </aside>
      </section>
      <section className="project-detail-metrics">
        <article><b>{counts.video}</b><span>视频片段</span></article>
        <article><b>{counts.image}</b><span>图片片段</span></article>
        <article><b>{counts.audio}</b><span>音频片段</span></article>
        <article><b>{counts.text}</b><span>字幕文本</span></article>
      </section>
      <section className="project-detail-grid">
        <div className="project-detail-assets">
          <header><div><span>素材列表</span><h2>项目素材清单</h2></div><b>{project.clips.length} 个片段</b></header>
          {project.clips.length ? project.clips.map((clip, index) => <article key={clip.id}><i>{clip.type}</i><span><b>{clip.name}</b><small>{clip.type === "video" ? "视频" : clip.type === "image" ? "图片" : clip.type === "audio" ? "音频" : "字幕"} / {time(clip.duration)} / {clip.mediaId ? "远程素材" : clip.url ? "本地素材" : "文本素材"}</small></span><em>{String(index + 1).padStart(2, "0")}</em></article>) : <p>项目素材暂未生成</p>}
        </div>
        <aside className="project-detail-actions">
          <span>下一步</span>
          <h2>继续处理</h2>
          <p>按当前进度回到对应模块继续制作。</p>
          <button className="primary" onClick={continueProject} disabled={Boolean(action)}>
            {action === "editor" ? "正在进入" : (project.source === "studio" || project.source === "libtv") ? "回到 AI 漫剧工作台" : "进入剪辑台"}
          </button>
          <button
            onClick={() => {
              localStorage.setItem("manjing-editor-active-project", project.id);
              localStorage.setItem("manjing-canvas-import-project", project.id);
              router.push("/canvas");
            }}
            disabled={Boolean(action)}
          >
            导入制片画布
          </button>
          <button onClick={openEditor} disabled={Boolean(action)}>直接进入剪辑台</button>
          <ConfirmButton className="danger" onConfirm={remove} disabled={Boolean(action)} ariaLabel={`删除项目${project.name}`} confirmLabel="确认删除项目">
            {action === "delete" ? "正在删除…" : "删除项目"}
          </ConfirmButton>
          {message && <p className="project-detail-message">{message}</p>}
        </aside>
      </section>
    </> : draft ? <section className="project-draft-detail">
      <span>草稿</span>
      <h1>{draft.title}</h1>
      <p>{draft.story}</p>
      <div><b>{draft.duration}</b><em>{draft.status}</em></div>
      <button onClick={continueProject}>继续生成 AI 漫剧</button>
      <small>该草稿还没有生成可剪辑媒体，不会直接进入剪辑台。</small>
    </section> : <section className="project-detail-missing">
      <i>?</i>
      <h1>项目不存在或已删除</h1>
      <p>{message || "返回项目资产重新选择。"}</p>
      <Link href="/projects">返回项目资产</Link>
    </section>}
  </main>;
}
