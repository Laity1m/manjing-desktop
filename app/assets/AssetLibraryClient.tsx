"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { deleteLibraryAsset, listLibraryAssets, loadLibraryAssets, saveLibraryFile, updateLibraryAsset, type LibraryAsset, type LibraryAssetCategory } from "../lib/asset-library";

const CATEGORY_LABELS: Record<LibraryAssetCategory, string> = {
  character: "角色",
  scene: "场景",
  video: "视频",
  audio: "音频",
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
  const [filter, setFilter] = useState<"all" | LibraryAssetCategory>("all");
  const [category, setCategory] = useState<LibraryAssetCategory>("character");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("正在读取资产库…");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const list = await listLibraryAssets();
    setAssets(list);
    setMessage(list.length ? `已加载 ${list.length} 个资产` : "当前还没有资产。");
    const loaded = await loadLibraryAssets(list.slice(0, 80).map((item) => item.id));
    setPreviews((current) => {
      Object.values(current).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
      return Object.fromEntries(loaded.filter((item) => item.url).map((item) => [item.id, item.url as string]));
    });
  }

  useEffect(() => {
    void refresh().catch((reason) => setMessage(reason instanceof Error ? reason.message : "资产库加载失败"));
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
        await saveLibraryFile(file, { category, duration: await durationOf(file) });
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

  async function changeCategory(asset: LibraryAsset, next: LibraryAssetCategory) {
    await updateLibraryAsset(asset.id, { category: next });
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, category: next } : item));
  }

  function sendToStudio() {
    if (!selected.length) { setMessage("请先选择要发送到工作台的资产"); return; }
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

  return <main className="portal-page asset-library-page">
    <SiteNav current="assets" />
    <header className="asset-library-hero"><div><p>复用素材库</p><h1>资产库</h1><span>为后续项目持续沉淀角色、场景与素材。</span></div><div className="asset-library-primary"><button onClick={() => inputRef.current?.click()} disabled={busy}>导入素材</button><button className="secondary" onClick={sendToStudio} disabled={busy}>发送到工作台</button><input ref={inputRef} hidden multiple type="file" accept="image/*,video/*,audio/*" onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /></div></header>
    <section className="asset-library-controls"><div className="asset-kind-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{CATEGORY_LABELS[key]}</button>)}</div><label>分类<select value={category} onChange={(event) => setCategory(event.target.value as LibraryAssetCategory)}>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select></label><label className="asset-library-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材" /></label></section>
    <p className="asset-library-message" role="status"><b>{selected.length ? `${selected.length} 个已选` : "0 个已选"}</b> {message}</p>
    {visible.length ? <section className="asset-library-grid">{visible.map((asset) => <article key={asset.id} className={selected.includes(asset.id) ? "selected" : ""}>
      <button className="asset-library-preview" onClick={() => toggle(asset.id)} aria-pressed={selected.includes(asset.id)}>{previews[asset.id] ? asset.mediaType === "image" ? <img src={previews[asset.id]} alt={asset.name} loading="lazy" /> : asset.mediaType === "video" ? <video src={previews[asset.id]} preload="metadata" muted /> : <span className="audio-preview">音频</span> : <span>{asset.mediaType === "video" ? "视频" : asset.mediaType === "audio" ? "音频" : "图片"}</span>}<i>{selected.includes(asset.id) ? "✓" : "+"}</i></button><div className="asset-library-copy"><b title={asset.name}>{asset.name}</b><small>{sizeLabel(asset.size)}{asset.duration ? ` / ${asset.duration.toFixed(1)}秒` : ""}</small><select value={asset.category} onChange={(event) => void changeCategory(asset, event.target.value as LibraryAssetCategory)}>{(Object.keys(CATEGORY_LABELS) as LibraryAssetCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select><div><button onClick={() => void download(asset)}>下载</button><ConfirmButton onConfirm={() => remove(asset.id)} disabled={busy} ariaLabel={`删除 ${asset.name}`} confirmLabel="确认删除">删除</ConfirmButton></div></div></article>)}</section> : <section className="asset-library-empty"><i>∅</i><h2>{assets.length ? "没有匹配的资产" : "暂无资产"}</h2><p>上传图片、视频或音频，沉淀成可复用素材库。</p><button onClick={() => inputRef.current?.click()}>选择文件</button></section>}
  </main>;
}
