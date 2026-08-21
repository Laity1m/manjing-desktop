"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../components/SiteNav";
import ConfirmButton from "../components/ConfirmButton";
import { attachLibraryFileToPlaceholder, deleteLibraryAsset, listLibraryAssets, loadLibraryAssets, saveLibraryFile, updateLibraryAsset, type LibraryAsset } from "../lib/asset-library";
import { loadSeriesProjects, type SeriesProject } from "../lib/series-project";

function durationOf(file: File) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(audio.duration) ? audio.duration : 0); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    audio.src = url;
  });
}

function VoicePreview({ url, name, onMessage }: { url?: string; name: string; onMessage: (message: string) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setPlaying(false); setReady(false); setFailed(false); }, [url]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio || !url) { onMessage(`“${name}”还没有可试听的音频，请重新上传或生成。`); return; }
    if (!audio.paused) { audio.pause(); setPlaying(false); return; }
    document.querySelectorAll<HTMLAudioElement>("audio[data-voice-preview]").forEach((item) => { if (item !== audio) item.pause(); });
    try {
      await audio.play();
      setPlaying(true);
      onMessage(`正在试听“${name}”`);
    } catch (reason) {
      setFailed(true);
      onMessage(`“${name}”无法播放：${reason instanceof Error ? reason.message : "音频编码不受支持，请换成 MP3 或 WAV"}`);
    }
  }

  return <div className={`voice-preview ${failed ? "failed" : ready ? "ready" : "loading"}`}>
    <button type="button" onClick={() => void toggle()} disabled={!url}>{playing ? "暂停试听" : ready ? "▶ 试听音色" : url ? "正在加载音色…" : "暂无可试听音频"}</button>
    {url && <audio ref={audioRef} data-voice-preview src={url} controls preload="auto" onCanPlay={() => { setReady(true); setFailed(false); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setFailed(true); setReady(false); onMessage(`“${name}”音频解码失败，请重新上传 MP3、WAV、M4A、OGG 或 WebM 音频。`); }} />}
    <small>{failed ? "解码失败，可在下方重新上传替换" : ready ? "已就绪，可试听" : url ? "正在恢复本机音频" : "资产框架尚未绑定声音"}</small>
  </div>;
}

export default function VoiceLibraryClient() {
  const router = useRouter();
  const [voices, setVoices] = useState<LibraryAsset[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<SeriesProject[]>([]);
  const [scope, setScope] = useState("global");
  const [message, setMessage] = useState("正在读取音色库…");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const list = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.category === "audio");
    const loaded = await loadLibraryAssets(list.map((asset) => asset.id));
    const urls = new Map(loaded.map((asset) => [asset.id, asset.url]));
    setVoices(list.map((asset) => ({ ...asset, url: urls.get(asset.id) || asset.url })));
    setPreviews(Object.fromEntries(loaded.filter((asset) => asset.url).map((asset) => [asset.id, asset.url as string])));
    setMessage(list.length ? `已加载 ${list.length} 个音色/音色框架` : "暂无音色；导入剧本后会自动建立人物音色框架。" );
  }

  useEffect(() => {
    const list = loadSeriesProjects();
    const requested = new URLSearchParams(window.location.search).get("project") || "";
    setProjects(list);
    if (requested && list.some((project) => project.id === requested)) setScope(requested);
    void refresh().catch((reason) => setMessage(reason instanceof Error ? reason.message : "音色库读取失败"));
  }, []);

  async function importVoices(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 20)) {
        if (!file.type.startsWith("audio/")) throw new Error(`“${file.name}”不是音频文件`);
        const stem = file.name.replace(/\.[^.]+$/, "");
        await saveLibraryFile(file, { name: file.name, category: "audio", duration: await durationOf(file), tags: ["用户上传", scope === "global" ? "公共音色" : "项目音色"], identityKey: stem, entityId: stem, lookName: "标准音色", variantName: "标准音色", voiceSource: "user-uploaded", voiceConsent: "pending", projectId: scope === "global" ? "" : scope, scope: scope === "global" ? "global" : "project", reusable: false, locked: true });
      }
      await refresh();
      setMessage("音色已上传；请填写人物名、参考台词并确认声音授权后再设为 Canonical。" );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "音色上传失败");
    } finally { setBusy(false); }
  }

  async function edit(asset: LibraryAsset, patch: Parameters<typeof updateLibraryAsset>[1]) {
    await updateLibraryAsset(asset.id, patch);
    await refresh();
  }

  async function bind(asset: LibraryAsset, file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await attachLibraryFileToPlaceholder(asset.id, file, "upload");
      await edit(asset, { assetState: "ready", sourceChoice: "upload", reusable: false, voiceConsent: "pending" });
      setMessage(`已为“${asset.identityKey || asset.name}”绑定音频；确认授权后即可复用。`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "绑定音色失败"); }
    finally { setBusy(false); }
  }

  function generate(asset: LibraryAsset) {
    localStorage.setItem("manjing-studio-blueprint-generate", asset.id);
    router.push(`/studio?blueprint=${encodeURIComponent(asset.id)}`);
  }

  async function confirmVoice(asset: LibraryAsset) {
    if (asset.assetState === "placeholder") { setMessage("请先上传音频或让 AI 生成参考音色。" ); return; }
    const identity = (asset.identityKey || asset.name).trim().toLocaleLowerCase("zh-CN");
    const related = voices.filter((item) => item.id !== asset.id && item.projectId === asset.projectId && (item.identityKey || item.name).trim().toLocaleLowerCase("zh-CN") === identity && item.canonical);
    await Promise.all(related.map((item) => updateLibraryAsset(item.id, { canonical: false })));
    await updateLibraryAsset(asset.id, { voiceConsent: "confirmed", canonical: true, reusable: true, locked: true, assetState: "ready" });
    await refresh();
    setMessage(`“${asset.identityKey || asset.name}”已确认授权并设为 Canonical 音色。`);
  }

  async function remove(asset: LibraryAsset) {
    await deleteLibraryAsset(asset.id);
    await refresh();
  }

  const knownProjectIds = new Set(projects.map((project) => project.id));
  const standaloneGroups = [...new Set(voices.map((voice) => voice.projectId).filter((id): id is string => Boolean(id) && !knownProjectIds.has(String(id))))].map((id, index) => ({ id, name: `独立剧本 ${index + 1}` }));
  const groups = [{ id: "global", name: "公共音色库" }, ...projects.map((project) => ({ id: project.id, name: project.name })), ...standaloneGroups];
  return <main className="portal-page voice-library-page">
    <SiteNav current="voices" />
    <header className="asset-library-hero voice-library-hero"><div><p>PROJECT VOICE PROFILES</p><h1>音色库</h1><span>音色与视觉资产分开管理。导入剧本后按人物建立音色框架；视频生成前优先引用当前项目音色，再补充公共音色。</span></div><div className="asset-library-primary"><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="global">上传到公共音色库</option>{projects.map((project) => <option key={project.id} value={project.id}>上传到：{project.name}</option>)}</select><button onClick={() => inputRef.current?.click()} disabled={busy}>上传音色</button><button className="secondary" onClick={() => router.push("/assets")}>返回资产库</button><input ref={inputRef} hidden multiple type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" onChange={(event) => { void importVoices(event.target.files); event.currentTarget.value = ""; }} /></div></header>
    <p className="asset-library-message" role="status"><b>{voices.length} 个</b> {message}</p>
    {groups.map((group) => {
      const items = voices.filter((voice) => group.id === "global" ? !voice.projectId || voice.scope === "global" : voice.projectId === group.id && voice.scope !== "global");
      const people = [...items.reduce((map, voice) => {
        const identity = (voice.identityKey || voice.entityId || voice.name || "未命名人物").trim();
        map.set(identity, [...(map.get(identity) || []), voice]);
        return map;
      }, new Map<string, LibraryAsset[]>()).entries()];
      return <section key={group.id} className="voice-project-group">
        <header><div><span>{group.id === "global" ? "PUBLIC" : "PROJECT"}</span><h2>{group.name}</h2><p>{group.id === "global" ? "所有项目都可以按人物名引用；仅上传你有权使用或克隆的声音。" : "由该项目剧本分析生成的人物音色框架和已确认音色。"}</p></div><b>{items.length} 项</b></header>
        {people.length ? people.map(([identity, personVoices]) => <section key={identity} className="voice-person-group" aria-label={`${identity}专属音色`}>
          <header><div><span>CHARACTER VOICE</span><h3>{identity}</h3><p>该人物在本项目中的音色版本；同一时间只使用一个 Canonical。</p></div><b>{personVoices.length} 个版本</b></header>
          <div className="voice-card-grid">{personVoices.map((voice) => <article key={voice.id} className={voice.assetState === "placeholder" ? "placeholder" : "ready"}><div className="voice-card-head"><i>声</i><span><b>{voice.identityKey || voice.name}</b><small>{voice.lookName || "标准音色"} · {voice.assetState === "placeholder" ? "等待选择来源" : voice.canonical ? "Canonical" : "待确认"}</small></span></div><VoicePreview url={previews[voice.id]} name={voice.identityKey || voice.name} onMessage={setMessage} /><input value={voice.identityKey || ""} placeholder="人物名字" onChange={(event) => setVoices((current) => current.map((item) => item.id === voice.id ? { ...item, identityKey: event.target.value } : item))} onBlur={(event) => void edit(voice, { identityKey: event.target.value, entityId: event.target.value })} /><textarea value={voice.referenceText || ""} placeholder="参考音频中的准确台词" onChange={(event) => setVoices((current) => current.map((item) => item.id === voice.id ? { ...item, referenceText: event.target.value } : item))} onBlur={(event) => void edit(voice, { referenceText: event.target.value })} /><p>{voice.semanticDescription}</p>{voice.assetState === "placeholder" ? <div className="voice-source-actions"><label>上传已有音色<input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" onChange={(event) => { void bind(voice, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button onClick={() => generate(voice)}>让 AI 生成参考音色</button></div> : <><div className="voice-source-actions"><button className={voice.canonical ? "active" : ""} onClick={() => void confirmVoice(voice)}>{voice.canonical ? "✓ 已确认 Canonical" : "确认授权并设为 Canonical"}</button><button onClick={() => void edit(voice, { voiceConsent: "revoked", reusable: false, canonical: false })}>撤销授权</button></div><label className="voice-replace-action">重新上传并替换<input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" onChange={(event) => { void bind(voice, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></>}<ConfirmButton onConfirm={() => remove(voice)} disabled={busy} ariaLabel={`删除音色 ${voice.name}`} confirmLabel="确认删除">删除</ConfirmButton></article>)}</div>
        </section>) : <div className="voice-project-empty">这个分组还没有音色或音色框架。</div>}
      </section>;
    })}
  </main>;
}
