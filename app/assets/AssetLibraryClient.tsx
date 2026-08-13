"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import EnterpriseAssetPanel from "./EnterpriseAssetPanel";
import { attachLibraryFileToPlaceholder, deleteLibraryAsset, listLibraryAssets, loadLibraryAssets, saveLibraryFile, updateLibraryAsset, type LibraryAsset, type LibraryAssetCategory } from "../lib/asset-library";
import { loadSeriesProjects, type SeriesProject } from "../lib/series-project";
import { characterAssetDisplayName } from "../lib/character-asset-naming";

const CATEGORY_LABELS: Record<LibraryAssetCategory, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  video: "视频",
  audio: "音色",
  other: "其他",
};

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function durationOf(file: File) {
  if (file.type.startsWith("image/")) return Promise.resolve(5);
  return new Promise<number>((resolve) => {
    const element = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(element.duration) ? element.duration : 0);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    element.src = url;
  });
}

export default function AssetLibraryClient() {
  const router = useRouter();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [seriesProjects, setSeriesProjects] = useState<SeriesProject[]>([]);
  const [assetProjectId, setAssetProjectId] = useState("all");
  const [expandedProjectId, setExpandedProjectId] = useState("");
  const [filter, setFilter] = useState<"all" | LibraryAssetCategory>("all");
  const [category, setCategory] = useState<LibraryAssetCategory>("character");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("正在读取资产库…");
  const [busy, setBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const list = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.category !== "audio");
    setAssets(list);
    setMessage(list.length ? `已加载 ${list.length} 个资产` : "当前还没有资产。");
    const loaded = await loadLibraryAssets(list.slice(0, 80).map((item) => item.id));
    setPreviews((current) => {
      Object.values(current).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
      return Object.fromEntries(loaded.filter((item) => item.url).map((item) => [item.id, item.url as string]));
    });
  }

  useEffect(() => {
    const projects = loadSeriesProjects();
    const requestedProject = new URLSearchParams(window.location.search).get("project") || "";
    const requestedFilter = new URLSearchParams(window.location.search).get("filter") || "";
    queueMicrotask(() => {
      setSeriesProjects(projects);
      if (requestedFilter === "audio") { setFilter("audio"); setCategory("audio"); }
      if (requestedProject && projects.some((item) => item.id === requestedProject)) {
        setAssetProjectId(requestedProject);
        setExpandedProjectId(requestedProject);
      }
      void refresh().catch((reason) => setMessage(reason instanceof Error ? reason.message : "资产库加载失败"));
    });
    return () => { Object.values(previews).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }); };
  }, []);

  const visible = useMemo(() => assets.filter((asset) => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return (filter === "all" || asset.category === filter) && (!keyword || `${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(keyword));
  }), [assets, filter, query]);

  async function importFiles(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setMessage("正在导入…");
    let completed = 0;
    try {
      for (const file of Array.from(files).slice(0, 40)) {
        if (file.type.startsWith("audio/")) throw new Error("音频请前往独立音色库上传");
        const resolvedCategory: LibraryAssetCategory = category === "audio" ? "other" : category;
        await saveLibraryFile(file, { category: resolvedCategory, duration: await durationOf(file) });
        completed += 1;
      setMessage(`已导入 ${completed}/${Math.min(files.length, 40)}`);
      }
      await refresh();
      setMessage(`已导入 ${completed} 个文件并同步到项目。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await deleteLibraryAsset(id);
      setSelected((items) => items.filter((item) => item !== id));
      await refresh();
      setMessage("已移除该资产。");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (busy || !selected.length) return;
    const removing = [...selected];
    setBusy(true);
    setMessage(`正在删除 ${removing.length} 个资产…`);
    try {
      for (const id of removing) await deleteLibraryAsset(id);
      setSelected([]);
      await refresh();
      setMessage(`已批量删除 ${removing.length} 个资产。`);
    } finally {
      setBusy(false);
    }
  }

  async function changeCategory(asset: LibraryAsset, next: LibraryAssetCategory) {
    await updateLibraryAsset(asset.id, { category: next });
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, category: next } : item));
  }

  async function editAsset(asset: LibraryAsset, patch: Parameters<typeof updateLibraryAsset>[1]) {
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, ...patch } : item));
    await updateLibraryAsset(asset.id, patch);
    setMessage(`已更新“${asset.name}”，Agent 下次创作会读取新设置。`);
  }

  async function editCharacterIdentity(asset: LibraryAsset, identityKey: string) {
    const identity = identityKey.trim() || asset.identityKey || asset.name;
    await editAsset(asset, { identityKey: identity, entityId: identity, name: characterAssetDisplayName(identity, asset.lookName) });
  }

  async function editCharacterLook(asset: LibraryAsset, lookName: string) {
    const look = lookName.trim() || "基础版";
    const identity = asset.identityKey?.trim() || asset.name;
    await editAsset(asset, { lookName: look, variantName: look, name: characterAssetDisplayName(identity, look) });
  }

  async function setCanonical(asset: LibraryAsset) {
    if (asset.category === "audio" && asset.voiceConsent !== "confirmed") {
      setMessage("请先确认你拥有该声音的使用和克隆授权，再设为 Canonical 音色。");
      return;
    }
    const identity = (asset.identityKey || asset.tags.find((tag) => !tag.startsWith("generated:")) || asset.name).trim().toLocaleLowerCase("zh-CN");
    const look = asset.category === "character" ? characterAssetDisplayName(identity, asset.lookName).toLocaleLowerCase("zh-CN") : "";
    const related = assets.filter((item) => item.id !== asset.id && item.category === asset.category && (item.identityKey || item.tags.find((tag) => !tag.startsWith("generated:")) || item.name).trim().toLocaleLowerCase("zh-CN") === identity && (asset.category !== "character" || characterAssetDisplayName(identity, item.lookName).toLocaleLowerCase("zh-CN") === look) && item.canonical);
    await Promise.all(related.map((item) => updateLibraryAsset(item.id, { canonical: false })));
    await updateLibraryAsset(asset.id, { canonical: true, locked: true, reusable: true });
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, canonical: true, locked: true, reusable: true } : related.some((old) => old.id === item.id) ? { ...item, canonical: false } : item));
    setMessage(`已将“${asset.name}”设为 Canonical 标准资产，后续 Agent 将优先引用。`);
  }

  function sendToStudio() {
    if (!selected.length) { setMessage("请先选择要发送到工作台的资产"); return; }
    try {
      if (JSON.parse(localStorage.getItem("manjing-production-runtime-v1") || "null")?.active === true) {
        setMessage("当前漫剧仍在后台制作，完成或停止后才能切换工作台资产");
        return;
      }
    } catch { /* Invalid runtime metadata must not block a valid asset handoff. */ }
    localStorage.setItem("manjing-studio-library-import", JSON.stringify(selected));
    router.push("/studio");
  }

  async function download(asset: LibraryAsset) {
    const [loaded] = await loadLibraryAssets([asset.id]);
    if (!loaded?.url) return;
    const anchor = document.createElement("a");
    anchor.href = loaded.url;
    anchor.download = asset.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(loaded.url as string), 1000);
  }

  async function bindPlaceholderFile(asset: LibraryAsset, file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setMessage(`正在为“${asset.name}”绑定用户图片…`);
    try {
      await attachLibraryFileToPlaceholder(asset.id, file, "upload");
      await updateLibraryAsset(asset.id, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "upload" });
      await refresh();
      setMessage(`“${asset.name}”已绑定用户图片，并设为当前 Canonical 资产。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "资产图片绑定失败");
    } finally {
      setBusy(false);
    }
  }

  function generatePlaceholder(asset: LibraryAsset) {
    localStorage.setItem("manjing-studio-blueprint-generate", asset.id);
    setMessage(`正在把“${asset.name}”发送到工作台的生图 AI…`);
    router.push(`/studio?blueprint=${encodeURIComponent(asset.id)}`);
  }

  const projectVisible = assetProjectId === "all" ? visible : visible.filter((asset) => assetProjectId === "global" ? !asset.projectId || asset.scope === "global" : asset.projectId === assetProjectId || asset.scope === "global");
  const projectGroups = [...seriesProjects.map((project) => ({ id: project.id, name: project.name, episodes: project.episodes.length, count: assets.filter((asset) => asset.projectId === project.id).length })), { id: "global", name: "全局与未归档资产", episodes: 0, count: assets.filter((asset) => !asset.projectId || asset.scope === "global").length }];

  return <main className="portal-page asset-library-page">
    <SiteNav current="assets" />
    <header className="asset-library-hero"><div><p>复用视觉素材库</p><h1>资产库</h1><span>只管理人物、造型、场景、道具和视频；音色已迁移到独立音色库。导入剧本后，未生成图片的资产框架也会显示在这里。</span></div><div className="asset-library-primary"><button onClick={() => inputRef.current?.click()} disabled={busy}>导入素材</button><button className="secondary" onClick={() => router.push("/voices")}>打开音色库</button><button className="secondary" onClick={sendToStudio} disabled={busy}>发送到工作台</button>{selected.length > 0 && <ConfirmButton onConfirm={removeSelected} disabled={busy} ariaLabel={`批量删除 ${selected.length} 个资产`} confirmLabel={`确认删除 ${selected.length} 个`}>批量删除</ConfirmButton>}<input ref={inputRef} hidden multiple type="file" accept="image/*,video/*" onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /></div></header>
    <EnterpriseAssetPanel />
    <section className="asset-project-browser" aria-label="按项目查看资产"><header><div><span>PROJECT ASSETS</span><h2>项目资产</h2><p>一个项目对应一套独立资产，Agent 只调用当前绑定项目与全局资产。</p></div><button type="button" className={assetProjectId === "all" ? "asset-project-all active" : "asset-project-all"} onClick={() => { setAssetProjectId("all"); setExpandedProjectId(""); setSelected([]); }}><b>全部资产</b><small>{assets.length} 项</small></button></header><div className="asset-project-list">{projectGroups.map((group, index) => <article key={group.id} className={`${assetProjectId === group.id ? "active" : ""} ${expandedProjectId === group.id ? "expanded" : ""}`}><button type="button" className="asset-project-main" onClick={() => setExpandedProjectId((value) => value === group.id ? "" : group.id)}><i className="asset-project-cover"><small>{group.id === "global" ? "GLOBAL" : "PROJECT"}</small><b>{group.id === "global" ? "∞" : String(index + 1).padStart(2, "0")}</b></i><span><b>{group.name}</b><small>{group.count} 项资产{group.episodes ? ` · ${group.episodes} 集` : ""}</small></span><em aria-label={expandedProjectId === group.id ? "收起" : "展开"}>{expandedProjectId === group.id ? "−" : "+"}</em></button>{expandedProjectId === group.id && <div className="asset-project-actions"><button type="button" onClick={() => { setAssetProjectId(group.id); setSelected([]); }}>打开项目资产</button><button type="button" onClick={() => setExpandedProjectId("")}>收起</button></div>}</article>)}</div></section>
    <section className="asset-library-controls"><div className="asset-kind-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).filter((key) => key !== "audio").map((key) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{CATEGORY_LABELS[key]}</button>)}</div><label>分类<select value={category === "audio" ? "other" : category} onChange={(event) => setCategory(event.target.value as LibraryAssetCategory)}>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).filter((key) => key !== "audio").map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select></label><label className="asset-library-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材" /></label></section>
    <p className="asset-library-message" role="status"><b>{selected.length ? `${selected.length} 个已选` : "0 个已选"}</b> {message}</p>
    <section className="asset-batch-toolbar" aria-label="资产批量管理"><div className="asset-batch-copy"><strong>批量管理</strong><span>{selected.length > 0 ? `已选择 ${selected.length} 项资产` : "点击资产卡片右上角的 + 进行多选"}</span></div><div className="asset-batch-actions"><button type="button" onClick={() => setSelected(projectVisible.map((asset) => asset.id))} disabled={projectVisible.length === 0}>全选当前</button><button type="button" onClick={() => setSelected([])} disabled={selected.length === 0}>取消选择</button>{selected.length > 0 && <ConfirmButton onConfirm={removeSelected} disabled={busy} ariaLabel={`删除已选择的 ${selected.length} 项资产`} confirmLabel={`确认删除 ${selected.length} 项`}>删除已选（{selected.length}）</ConfirmButton>}</div></section>
    {projectVisible.length ? <section className="asset-library-grid">{projectVisible.map((asset) => <article key={asset.id} className={`${selected.includes(asset.id) ? "selected" : ""} ${asset.assetState === "placeholder" ? "placeholder" : ""}`}>
      <div className="asset-library-preview">{asset.canonical && <strong className="canonical-badge">CANONICAL</strong>}{previews[asset.id] ? asset.mediaType === "image" ? <button type="button" className="asset-preview-open" onClick={() => setImagePreview({ url: previews[asset.id], name: asset.name })} aria-label={`预览${asset.name}大图`}><img src={previews[asset.id]} alt={asset.name} loading="lazy" /><span>点击预览</span></button> : asset.mediaType === "video" ? <video src={previews[asset.id]} preload="metadata" muted /> : <span className="audio-preview">音色</span> : asset.assetState === "placeholder" ? <span className="asset-placeholder-preview"><b>{asset.category === "character" ? "人" : asset.category === "prop" ? "具" : "景"}</b><small>资产框架<br />尚无图片</small></span> : <span>{asset.mediaType === "video" ? "视频" : asset.mediaType === "audio" ? "音色" : "图片"}</span>}<button type="button" className="asset-select-toggle" onClick={() => toggle(asset.id)} aria-pressed={selected.includes(asset.id)}>{selected.includes(asset.id) ? "✓" : "+"}</button></div><div className="asset-library-copy">{asset.category === "audio" && previews[asset.id] && <audio className="voice-library-player" src={previews[asset.id]} controls preload="metadata" />}<input className="asset-title-input" value={asset.name} title="资产名称" onChange={(event) => setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, name: event.target.value } : item))} onBlur={(event) => void editAsset(asset, { name: event.target.value })} /><small>{asset.assetState === "placeholder" ? "等待用户选择素材来源" : `${sizeLabel(asset.size)}${asset.duration ? ` / ${asset.duration.toFixed(1)}秒` : ""} · 已引用 ${asset.usageCount || 0} 次`}</small>{asset.assetState === "placeholder" && <div className="asset-placeholder-description">{asset.semanticDescription || "等待补充资产描述"}</div>}<select value={asset.category} onChange={(event) => void changeCategory(asset, event.target.value as LibraryAssetCategory)}>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select><input value={asset.tags.join("，")} placeholder="标签：角色名、场景、集数" onChange={(event) => setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, tags: event.target.value.split(/[，,]/) } : item))} onBlur={(event) => void editAsset(asset, { tags: event.target.value.split(/[，,]/) })} />{asset.category === "character" && <><input value={asset.identityKey || ""} placeholder="人物名字，例如：林辰" onChange={(event) => setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, identityKey: event.target.value } : item))} onBlur={(event) => void editCharacterIdentity(asset, event.target.value)} /><input value={asset.lookName || ""} placeholder="服装或状态，例如：西装版、颓废版" onChange={(event) => setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, lookName: event.target.value } : item))} onBlur={(event) => void editCharacterLook(asset, event.target.value)} /><input value={asset.arkAssetId || ""} placeholder="方舟可信人像 Asset ID" onChange={(event) => setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, arkAssetId: event.target.value } : item))} onBlur={(event) => void editAsset(asset, { arkAssetId: event.target.value, portraitAuthorizationStatus: event.target.value.trim() ? "pending" : "unbound" })} /><select value={asset.portraitAuthorizationStatus || "unbound"} onChange={(event) => void editAsset(asset, { portraitAuthorizationStatus: event.target.value as "unbound" | "pending" | "authorized" })}><option value="unbound">未绑定可信人像</option><option value="pending">已填写，等待/未确认授权</option><option value="authorized">已在方舟完成本人授权</option></select>{asset.arkAssetId && <small>Seedance 引用：asset://{asset.arkAssetId.replace(/^asset:\/\//i, "")}</small>}</>}{asset.assetState === "placeholder" ? <div className="asset-placeholder-actions"><label>上传已有图片<input type="file" accept="image/*" disabled={busy} onChange={(event) => { void bindPlaceholderFile(asset, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button type="button" onClick={() => generatePlaceholder(asset)} disabled={busy}>让 AI 生成</button></div> : <><div className="asset-policy-actions"><button className={asset.canonical ? "active" : ""} onClick={() => void setCanonical(asset)}>{asset.canonical ? "✓ Canonical" : "设为 Canonical"}</button><button className={asset.reusable !== false ? "active" : ""} onClick={() => void editAsset(asset, { reusable: asset.reusable === false })}>{asset.reusable !== false ? "Agent 可复用" : "禁止复用"}</button><button className={asset.locked ? "active" : ""} onClick={() => void editAsset(asset, { locked: !asset.locked })}>{asset.locked ? "已锁定" : "未锁定"}</button></div><div><button onClick={() => void download(asset)}>下载</button><ConfirmButton onConfirm={() => remove(asset.id)} disabled={busy} ariaLabel={`删除 ${asset.name}`} confirmLabel="确认删除">删除</ConfirmButton></div></>} {asset.assetState === "placeholder" && <ConfirmButton onConfirm={() => remove(asset.id)} disabled={busy} ariaLabel={`删除 ${asset.name}`} confirmLabel="确认删除框架">删除框架</ConfirmButton>}</div></article>)}</section> : <section className="asset-library-empty"><i>∅</i><h2>{assets.length ? "没有匹配的资产" : "暂无资产框架或素材"}</h2><p>导入剧本后，人物与道具框架会先出现在这里；可先上传已有资产，再一键生成缺失项。</p><button onClick={() => inputRef.current?.click()}>选择文件</button></section>}
    {imagePreview && <div className="asset-image-lightbox" role="dialog" aria-modal="true" aria-label={`${imagePreview.name}图片预览`} onClick={() => setImagePreview(null)}><button type="button" onClick={() => setImagePreview(null)} aria-label="关闭图片预览">×</button><figure onClick={(event) => event.stopPropagation()}><img src={imagePreview.url} alt={imagePreview.name} /><figcaption>{imagePreview.name}</figcaption></figure></div>}
  </main>;
}
