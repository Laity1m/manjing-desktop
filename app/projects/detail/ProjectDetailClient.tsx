"use client";

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
  return source === "studio" ? "AI 漫剧工作台" : source === "libtv" ? "LibTV 制片" : source === "video" ? "自主 AI 视频" : "专业剪辑台";
}

export default function ProjectDetailClient() {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [draft, setDraft] = useState<DraftProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [message, setMessage] = useState("");
  const projectId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("id") || "";

  useEffect(() => {
    let active = true;
    if (!projectId) { setLoading(false); setMessage("没有指定项目"); return; }
    void getEditorProjectMetadataById(projectId).then((stored) => {
      if (!active) return;
      if (stored) { setProject(stored); return; }
      try {
        const drafts = JSON.parse(localStorage.getItem("manjing-projects") || "[]") as DraftProject[];
        setDraft(drafts.find((item) => item.id === projectId) || null);
      } catch { setDraft(null); }
    }).catch((reason) => { if (active) setMessage(reason instanceof Error ? reason.message : "读取项目失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
    setAction("editor"); setMessage("正在准备剪辑工程；进入剪辑台后会逐项恢复素材…");
    try { await activateEditorProject(project.id); window.location.assign("/editor"); }
    catch (reason) { setAction(""); setMessage(reason instanceof Error ? `恢复失败：${reason.message}` : "恢复失败，请重试"); }
  }

  function continueProject() {
    if (action) return;
    if (!project) {
      if (draft?.id) localStorage.setItem("manjing-studio-open-project", draft.id);
      window.location.assign("/studio");
      return;
    }
    if (project.source === "studio" || project.source === "libtv") {
      localStorage.setItem("manjing-studio-open-project", project.id);
      window.location.assign("/studio");
      return;
    }
    if (project.source === "video") {
      void openEditor();
      return;
    }
    void openEditor();
  }

  async function remove() {
    if (!project || action) return;
    setAction("delete");
    try { await deleteEditorProject(project.id); window.location.assign("/projects"); }
    catch (reason) { setAction(""); setMessage(reason instanceof Error ? `删除失败：${reason.message}` : "删除失败"); }
  }

  return <main className="portal-page project-detail-page">
    <SiteNav current="projects" />
    <header className="project-detail-header"><a href="/projects">← 返回项目资产</a><span>PROJECT DETAIL</span></header>
    {loading ? <section className="project-detail-loading"><i />正在读取项目索引，不会同时加载全部视频…</section> : project ? <>
      <section className="project-detail-hero"><div><span>{sourceName(project.source)}</span><h1>{project.name}</h1><p>{project.editorNote || "这个项目的工程与媒体素材已保存在当前设备。"}</p><small>创建于 {new Date(project.createdAt).toLocaleString("zh-CN")}</small></div><aside><b>{project.finalVideo?.mediaId || project.finalVideo?.url ? "已完成" : "制作中"}</b><span>{time(counts.duration)}</span></aside></section>
      <section className="project-detail-metrics"><article><b>{counts.video}</b><span>视频片段</span></article><article><b>{counts.image}</b><span>图片镜头</span></article><article><b>{counts.audio}</b><span>音频素材</span></article><article><b>{counts.text}</b><span>字幕片段</span></article></section>
      <section className="project-detail-grid">
        <div className="project-detail-assets"><header><div><span>ASSETS</span><h2>项目素材清单</h2></div><b>{project.clips.length} 项</b></header>{project.clips.length ? project.clips.map((clip, index) => <article key={clip.id}><i>{clip.type === "video" ? "影" : clip.type === "image" ? "图" : clip.type === "audio" ? "声" : "字"}</i><span><b>{clip.name}</b><small>{clip.type.toUpperCase()} · {time(clip.duration)} · {clip.mediaId ? "已保存本机" : clip.url ? "远程素材" : "文本资产"}</small></span><em>{String(index + 1).padStart(2, "0")}</em></article>) : <p>项目还没有生成可剪辑素材。</p>}</div>
        <aside className="project-detail-actions"><span>NEXT STEP</span><h2>继续制作</h2><p>查看详情不会加载视频解码器。只有进入剪辑台后，素材才会按顺序恢复，并显示进度。</p><button className="primary" onClick={continueProject} disabled={Boolean(action)}>{action === "editor" ? "正在准备…" : project.source === "studio" || project.source === "libtv" ? "回到漫剧工作台" : "恢复并进入剪辑台"}</button><button onClick={() => { localStorage.setItem("manjing-editor-active-project", project.id); localStorage.setItem("manjing-canvas-import-project", project.id); window.location.assign("/canvas"); }} disabled={Boolean(action)}>导入制片画布</button><button onClick={openEditor} disabled={Boolean(action)}>直接进入剪辑台</button><ConfirmButton className="danger" onConfirm={remove} disabled={Boolean(action)} ariaLabel={`删除项目${project.name}`} confirmLabel="确认删除项目">{action === "delete" ? "正在删除…" : "删除项目"}</ConfirmButton>{message && <p className="project-detail-message">{message}</p>}</aside>
      </section>
    </> : draft ? <section className="project-draft-detail"><span>制作中草稿</span><h1>{draft.title}</h1><p>{draft.story}</p><div><b>{draft.duration}</b><em>{draft.status}</em></div><button onClick={continueProject}>继续在 AI 工作台制作</button><small>该草稿还没有生成可剪辑媒体，因此不会错误地跳进空剪辑台。</small></section> : <section className="project-detail-missing"><i>?</i><h1>项目不存在或已删除</h1><p>{message || "返回项目资产重新选择。"}</p><a href="/projects">返回项目资产</a></section>}
  </main>;
}
