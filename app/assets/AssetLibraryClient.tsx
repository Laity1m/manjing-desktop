"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { deleteLibraryAsset, listLibraryAssets, loadLibraryAssets, saveLibraryFile, updateLibraryAsset, type LibraryAsset, type LibraryAssetCategory } from "../lib/asset-library";

const CATEGORY_LABELS: Record<LibraryAssetCategory, string> = {
  character: "角色设定",
  scene: "场景 / 分镜",
  video: "视频镜头",
  audio: "配音 / 音频",
  other: "其他素材",
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
    element.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(element.duration) ? element.duration : 0); };
    element.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    element.src = url;
  });
}

export default function AssetLibraryClient() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | LibraryAssetCategory>("all");
  const [category, setCategory] = useState<LibraryAssetCategory>("character");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("正在读取本机资产库…");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const list = await listLibraryAssets();
    setAssets(list);
    setMessage(list.length ? `${list.length} 项资产已保存在当前电脑` : "资产库为空，可以导入角色图、场景图、视频或音频");
    const loaded = await loadLibraryAssets(list.slice(0, 80).map((item) => item.id));
    setPreviews((current) => {
      Object.values(current).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
      return Object.fromEntries(loaded.filter((item) => item.url).map((item) => [item.id, item.url as string]));
    });
  }

  useEffect(() => {
    void refresh().catch((reason) => setMessage(reason instanceof Error ? reason.message : "资产库读取失败"));
    return () => { Object.values(previews).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }); };
    // Previews are revoked whenever refresh replaces them; unmount cleanup is best-effort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => assets.filter((asset) => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return (filter === "all" || asset.category === filter) && (!keyword || `${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(keyword));
  }), [assets, filter, query]);

  async function importFiles(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setMessage("正在把资产写入本机资产库…");
    let completed = 0;
    try {
      for (const file of Array.from(files).slice(0, 40)) {
        await saveLibraryFile(file, { category, duration: await durationOf(file) });
        completed += 1;
        setMessage(`正在保存 ${completed}/${Math.min(files.length, 40)}：${file.name}`);
      }
      await refresh();
      setMessage(`已永久保存 ${completed} 项资产，可跨项目复用`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "资产导入失败");
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
      setMessage("资产已从独立资产库移除");
    } finally {
      setBusy(false);
    }
  }

  async function changeCategory(asset: LibraryAsset, next: LibraryAssetCategory) {
    await updateLibraryAsset(asset.id, { category: next });
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, category: next } : item));
  }

  function sendToStudio() {
    if (!selected.length) { setMessage("请先勾选要交给 AI 工作台的资产"); return; }
    localStorage.setItem("manjing-studio-library-import", JSON.stringify(selected));
    window.location.assign("/studio");
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

  return <main className="portal-page asset-library-page">
    <SiteNav current="assets" />
    <header className="subpage-hero asset-library-hero"><div><p>REUSABLE ASSET VAULT</p><h1>独立资产库</h1><span>角色、场景、视频、配音一次保存，之后的每个项目都能直接复用。</span></div><div className="asset-library-primary"><button onClick={() => inputRef.current?.click()} disabled={busy}>＋ 导入本机资产</button><button className="secondary" onClick={sendToStudio} disabled={busy}>把选中资产交给工作台</button><input ref={inputRef} hidden multiple type="file" accept="image/*,video/*,audio/*" onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /></div></header>
    <section className="asset-library-controls"><div className="asset-kind-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{CATEGORY_LABELS[key]}</button>)}</div><label>新导入资产归类<select value={category} onChange={(event) => setCategory(event.target.value as LibraryAssetCategory)}>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select></label><label className="asset-library-search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或标签" /></label></section>
    <p className="asset-library-message" role="status"><b>{selected.length ? `已选 ${selected.length} 项` : "本机持久存储"}</b>{message}</p>
    {visible.length ? <section className="asset-library-grid">{visible.map((asset) => <article key={asset.id} className={selected.includes(asset.id) ? "selected" : ""}>
      <button className="asset-library-preview" onClick={() => toggle(asset.id)} aria-pressed={selected.includes(asset.id)}>{previews[asset.id] ? asset.mediaType === "image" ? <img src={previews[asset.id]} alt={asset.name} loading="lazy" /> : asset.mediaType === "video" ? <video src={previews[asset.id]} preload="metadata" muted /> : <span className="audio-preview">♫</span> : <span>{asset.mediaType === "image" ? "图" : asset.mediaType === "video" ? "影" : "声"}</span>}<i>{selected.includes(asset.id) ? "✓" : "+"}</i></button>
      <div className="asset-library-copy"><b title={asset.name}>{asset.name}</b><small>{sizeLabel(asset.size)}{asset.duration ? ` · ${asset.duration.toFixed(1)} 秒` : ""}</small><select value={asset.category} onChange={(event) => void changeCategory(asset, event.target.value as LibraryAssetCategory)}>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select><div><button onClick={() => void download(asset)}>下载</button><ConfirmButton onConfirm={() => remove(asset.id)} disabled={busy} ariaLabel={`移除资产${asset.name}`} confirmLabel="确认移除">移除</ConfirmButton></div></div>
    </article>)}</section> : <section className="asset-library-empty"><i>库</i><h2>{assets.length ? "没有匹配的资产" : "建立你的第一个可复用资产"}</h2><p>可导入 PNG/JPG/WebP 角色图和场景图、MP4/WebM 视频、MP3/WAV 音频；文件会保存在这台电脑。</p><button onClick={() => inputRef.current?.click()}>选择文件</button></section>}
  </main>;
}
