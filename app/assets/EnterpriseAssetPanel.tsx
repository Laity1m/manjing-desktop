"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listLibraryAssets, loadLibraryAssets, updateLibraryAsset, type LibraryAsset } from "../lib/asset-library";

type EnterpriseSession = {
  localAssetId: string;
  identityKey: string;
  name: string;
  state: "unbound" | "awaiting_actor" | "validated" | "processing" | "active" | "failed";
  h5Link?: string;
  groupId?: string;
  arkAssetId?: string;
  arkStatus?: string;
  error?: string;
  needsMedia?: boolean;
};

type EnterpriseState = {
  configured: boolean;
  companyName: string;
  plan: "advanced" | "premium";
  accessKeyHint: string;
  projectName: string;
  callbackUrl: string;
  tosBucket: string;
  tosRegion: string;
  tosEndpoint: string;
  sessions: EnterpriseSession[];
};

const EMPTY_STATE: EnterpriseState = {
  configured: false,
  companyName: "",
  plan: "advanced",
  accessKeyHint: "",
  projectName: "default",
  callbackUrl: "https://console.volcengine.com/ark",
  tosBucket: "",
  tosRegion: "cn-beijing",
  tosEndpoint: "tos-cn-beijing.volces.com",
  sessions: [],
};

function normalizedIdentity(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/[\s_·•—–-]+/g, "");
}

async function api(input?: Record<string, unknown>) {
  const response = await fetch("/api/desktop/enterprise-assets", input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : undefined);
  let data: Record<string, unknown> = {};
  try { data = await response.json() as Record<string, unknown>; } catch { /* The browser edition does not expose the desktop bridge. */ }
  if (!response.ok) throw new Error(String(data.error || "企业可信人物接口不可用，请使用 Windows 安装版"));
  return data;
}

function imageAsDataUrl(asset: LibraryAsset) {
  return loadLibraryAssets([asset.id]).then(async ([loaded]) => {
    if (!loaded?.url) throw new Error(`“${asset.name}”没有可提交的本地图片`);
    const response = await fetch(loaded.url);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error(`“${asset.name}”不是图片资产`);
    if (blob.size > 24 * 1024 * 1024) throw new Error(`“${asset.name}”超过方舟可信人物单图 24MB 限制`);
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取人物图片失败"));
      reader.readAsDataURL(blob);
    });
  });
}

function stateLabel(state?: EnterpriseSession["state"]) {
  if (state === "awaiting_actor") return "等待本人授权";
  if (state === "validated") return "授权完成，等待上传";
  if (state === "processing") return "方舟审核处理中";
  if (state === "active") return "已授权并可引用";
  if (state === "failed") return "处理失败";
  return "尚未发起";
}

export default function EnterpriseAssetPanel({ onAssetUpdated }: { onAssetUpdated?: () => void }) {
  const router = useRouter();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [enterprise, setEnterprise] = useState<EnterpriseState>(EMPTY_STATE);
  const [form, setForm] = useState({ ...EMPTY_STATE, accessKeyId: "", secretKey: "" });
  const [editing, setEditing] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("企业高级/Premium 可在软件内完成可信人物入库；演员本人授权仍由方舟页面完成。");
  const polling = useRef(new Set<string>());

  async function refresh() {
    const [library, remote] = await Promise.all([listLibraryAssets({ allProjects: true }), api()]);
    const next = { ...EMPTY_STATE, ...remote, sessions: Array.isArray(remote.sessions) ? remote.sessions : [] } as EnterpriseState;
    setAssets(library.filter((asset) => asset.category === "character" && asset.mediaType === "image" && asset.assetState !== "placeholder"));
    setEnterprise(next);
    setForm((current) => ({ ...current, ...next, accessKeyId: "", secretKey: "" }));
    setEditing(!next.configured);
  }

  useEffect(() => {
    void refresh().catch((reason) => setStatus(reason instanceof Error ? reason.message : "企业可信人物中心加载失败"));
  }, []);

  async function saveConfig() {
    setBusyId("config");
    try {
      const next = await api({ action: "save-config", ...form });
      setEnterprise({ ...EMPTY_STATE, ...next, sessions: Array.isArray(next.sessions) ? next.sessions : [] } as EnterpriseState);
      setForm((current) => ({ ...current, secretKey: "", accessKeyId: "" }));
      setEditing(false);
      setStatus("企业接入信息已由 Windows 系统加密保存。现在可逐个人物发起可信人物授权。");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "企业信息保存失败");
    } finally { setBusyId(""); }
  }

  async function testConfig() {
    setBusyId("probe");
    try {
      await api({ action: "probe" });
      setStatus("Assets API 连接与权限检测通过。");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "权限检测失败"); }
    finally { setBusyId(""); }
  }

  async function start(asset: LibraryAsset) {
    setBusyId(asset.id);
    try {
      const session = await api({ action: "start", localAssetId: asset.id, identityKey: asset.identityKey || asset.entityId || asset.name, name: asset.name }) as unknown as EnterpriseSession;
      await updateLibraryAsset(asset.id, { portraitAuthorizationStatus: "pending", arkAssetStatus: session.state, arkAssetGroupId: session.groupId || "", arkAssetError: "", arkAssetSyncedAt: new Date().toISOString() });
      await refresh();
      setStatus(session.h5Link ? `已为“${asset.name}”创建本人授权页面，请让该演员在 30 分钟内完成。` : `已复用“${asset.identityKey || asset.name}”的人物组，无需重复真人验证。`);
      if (session.h5Link) window.open(session.h5Link, "_blank", "noopener,noreferrer");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "发起授权失败"); }
    finally { setBusyId(""); }
  }

  async function maybeResumeStudio(updatedAssetId: string) {
    try {
      const block = JSON.parse(localStorage.getItem("manjing-seedance-portrait-block-v1") || "null") as { blockedReferences?: Array<{ libraryAssetId?: string; identityKey?: string; name?: string }> } | null;
      if (!block?.blockedReferences?.length) return;
      const library = await listLibraryAssets({ allProjects: true });
      const unresolved = block.blockedReferences.filter((reference) => {
        const identity = normalizedIdentity(reference.identityKey || String(reference.name || "").replace(/^.*?：/, "").replace(/；.*$/, ""));
        const match = library.find((asset) => asset.category === "character" && (asset.id === reference.libraryAssetId || normalizedIdentity(asset.identityKey || asset.entityId || asset.name) === identity));
        return !match?.arkAssetId || match.portraitAuthorizationStatus !== "authorized";
      });
      if (!unresolved.length) {
        localStorage.removeItem("manjing-seedance-portrait-block-v1");
        localStorage.setItem("manjing-studio-resume-video-after-portrait-v1", updatedAssetId);
        setStatus("所有被拦截人物均已通过授权，正在返回工作台并从中断镜头恢复视频生成…");
        window.setTimeout(() => router.push("/studio"), 900);
      }
    } catch { /* A stale blocker must not invalidate a successful Ark asset. */ }
  }

  async function advance(asset: LibraryAsset, quiet = false) {
    if (polling.current.has(asset.id)) return;
    polling.current.add(asset.id);
    if (!quiet) setBusyId(asset.id);
    try {
      let session = await api({ action: "advance", localAssetId: asset.id }) as unknown as EnterpriseSession;
      if (session.needsMedia) {
        if (!quiet) setStatus(`正在把“${asset.name}”安全上传到企业 TOS，并提交方舟审核…`);
        session = await api({ action: "advance", localAssetId: asset.id, mediaDataUrl: await imageAsDataUrl(asset) }) as unknown as EnterpriseSession;
      }
      await updateLibraryAsset(asset.id, {
        arkAssetId: session.arkAssetId || "",
        portraitAuthorizationStatus: session.state === "active" ? "authorized" : "pending",
        arkAssetGroupId: session.groupId || "",
        arkAssetStatus: session.state,
        arkAssetError: session.error || "",
        arkAssetSyncedAt: new Date().toISOString(),
      });
      setEnterprise((current) => ({ ...current, sessions: [...current.sessions.filter((item) => item.localAssetId !== asset.id), session] }));
      if (session.state === "active") {
        setStatus(`“${asset.name}”已取得 Asset ID，将自动按 asset://${session.arkAssetId} 供 Seedance 全能参考引用。`);
        onAssetUpdated?.();
        await maybeResumeStudio(asset.id);
      } else if (!quiet) setStatus(`“${asset.name}”：${stateLabel(session.state)}${session.error ? `；${session.error}` : ""}`);
    } catch (reason) {
      if (!quiet) setStatus(reason instanceof Error ? reason.message : "可信人物状态同步失败");
    } finally {
      polling.current.delete(asset.id);
      if (!quiet) setBusyId("");
    }
  }

  async function reset(asset: LibraryAsset) {
    setBusyId(asset.id);
    try {
      await api({ action: "reset", localAssetId: asset.id });
      await updateLibraryAsset(asset.id, { arkAssetId: "", portraitAuthorizationStatus: "unbound", arkAssetGroupId: "", arkAssetStatus: "unbound", arkAssetError: "" });
      await refresh();
      setStatus(`已清除“${asset.name}”的过期任务，可重新发起。`);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "重置失败"); }
    finally { setBusyId(""); }
  }

  useEffect(() => {
    if (!enterprise.configured || !enterprise.sessions.some((item) => ["awaiting_actor", "validated", "processing"].includes(item.state))) return;
    const timer = window.setInterval(() => {
      enterprise.sessions.filter((item) => ["awaiting_actor", "validated", "processing"].includes(item.state)).forEach((session) => {
        const asset = assets.find((item) => item.id === session.localAssetId);
        if (asset) void advance(asset, true);
      });
    }, 7000);
    return () => window.clearInterval(timer);
  }, [assets, enterprise.configured, enterprise.sessions]);

  const box = { border: "1px solid #d8cec0", borderRadius: 22, padding: 24, margin: "0 clamp(18px,4vw,64px) 26px", background: "linear-gradient(135deg,#fffdf9,#f3eee6)" } as const;
  const input = { padding: 11, border: "1px solid #d8cec0", borderRadius: 10, background: "white", minWidth: 0 } as const;
  const button = { padding: "10px 14px", border: 0, borderRadius: 10, background: "#262126", color: "white", cursor: "pointer" } as const;

  return <section style={box} aria-label="企业可信人物自动接入">
    <header style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}><div><p style={{ color: "#b75e37", fontWeight: 800, letterSpacing: ".15em" }}>VOLCENGINE TRUSTED PORTRAITS</p><h2 style={{ fontSize: 30, margin: "8px 0" }}>企业可信人物自动接入</h2><p style={{ maxWidth: 820, lineHeight: 1.7 }}>只需一次填写企业方舟与 TOS 信息。漫镜会自动创建授权任务、上传本地人物图、轮询审核并回写 Asset ID；同一人物的多套造型复用同一个人物组。</p></div>{enterprise.configured && <button type="button" style={{ ...button, background: "white", color: "#332a27", border: "1px solid #cbbfb2" }} onClick={() => setEditing((value) => !value)}>{editing ? "收起企业设置" : "修改企业设置"}</button>}</header>
    {editing && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, margin: "20px 0" }}>
      <input style={input} value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} placeholder="企业名称" />
      <select style={input} value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value as "advanced" | "premium" })}><option value="advanced">企业高级</option><option value="premium">企业 Premium</option></select>
      <input style={input} value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} placeholder={enterprise.accessKeyHint ? `Access Key ID（已保存 ${enterprise.accessKeyHint}，不改可留空）` : "Access Key ID"} />
      <input style={input} type="password" value={form.secretKey} onChange={(event) => setForm({ ...form, secretKey: event.target.value })} placeholder={enterprise.configured ? "Secret Key（不改可留空）" : "Secret Key"} />
      <input style={input} value={form.projectName} onChange={(event) => setForm({ ...form, projectName: event.target.value })} placeholder="方舟项目名，默认 default" />
      <input style={input} value={form.tosBucket} onChange={(event) => setForm({ ...form, tosBucket: event.target.value })} placeholder="企业 TOS Bucket" />
      <input style={input} value={form.tosRegion} onChange={(event) => setForm({ ...form, tosRegion: event.target.value })} placeholder="TOS 地域，例如 cn-beijing" />
      <input style={input} value={form.tosEndpoint} onChange={(event) => setForm({ ...form, tosEndpoint: event.target.value })} placeholder="TOS Endpoint" />
      <input style={{ ...input, gridColumn: "1/-1" }} value={form.callbackUrl} onChange={(event) => setForm({ ...form, callbackUrl: event.target.value })} placeholder="本人授权完成后的 HTTPS 回跳地址" />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button type="button" style={button} disabled={Boolean(busyId)} onClick={() => void saveConfig()}>{busyId === "config" ? "正在加密保存…" : "保存企业信息"}</button>{enterprise.configured && <button type="button" style={{ ...button, background: "#bd6b43" }} disabled={Boolean(busyId)} onClick={() => void testConfig()}>{busyId === "probe" ? "正在检测…" : "检测 Assets API 权限"}</button>}</div>
    </div>}
    {!editing && <p style={{ padding: 12, borderRadius: 10, background: "#fff" }}><b>{enterprise.companyName}</b> · {enterprise.plan === "premium" ? "Premium" : "高级"} · {enterprise.projectName} · TOS {enterprise.tosBucket || "未配置"} · 凭据已系统加密</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 12, marginTop: 18 }}>
      {assets.map((asset) => { const session = enterprise.sessions.find((item) => item.localAssetId === asset.id); const state = session?.state || asset.arkAssetStatus || (asset.portraitAuthorizationStatus === "authorized" ? "active" : "unbound"); return <article key={asset.id} style={{ border: `1px solid ${state === "active" ? "#8bc7a9" : state === "failed" ? "#d48b7a" : "#d8cec0"}`, borderRadius: 15, background: "rgba(255,255,255,.78)", padding: 16 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><strong>{asset.identityKey || asset.name}</strong><small style={{ display: "block", marginTop: 5, color: "#766b66" }}>{asset.lookName || "基础版"} · {stateLabel(state as EnterpriseSession["state"])}</small></div><span style={{ color: state === "active" ? "#287a54" : state === "failed" ? "#a13f30" : "#7b5caa", fontWeight: 800 }}>{state === "active" ? "✓ ACTIVE" : state.toUpperCase()}</span></div>{(session?.arkAssetId || asset.arkAssetId) && <code style={{ display: "block", margin: "12px 0", overflowWrap: "anywhere" }}>asset://{session?.arkAssetId || asset.arkAssetId}</code>}{session?.error && <p style={{ color: "#a13f30" }}>{session.error}</p>}<div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>{state === "unbound" && <button type="button" style={button} disabled={!enterprise.configured || Boolean(busyId)} onClick={() => void start(asset)}>{busyId === asset.id ? "正在创建…" : "发起本人授权"}</button>}{session?.h5Link && state === "awaiting_actor" && <a href={session.h5Link} target="_blank" rel="noreferrer" style={{ ...button, textDecoration: "none", background: "#bd6b43" }}>打开本人授权页面 ↗</a>}{["awaiting_actor", "validated", "processing"].includes(state) && <button type="button" style={button} disabled={Boolean(busyId)} onClick={() => void advance(asset)}>{busyId === asset.id ? "正在同步…" : "立即同步状态"}</button>}{state === "failed" && <button type="button" style={button} disabled={Boolean(busyId)} onClick={() => void reset(asset)}>清除并重新发起</button>}</div></article>; })}
    </div>
    {!assets.length && <p style={{ padding: 18, background: "white", borderRadius: 12 }}>当前没有带图片的人物资产。请先上传或生成角色图，再回来发起可信人物授权。</p>}
    <p role="status" style={{ padding: 12, background: "white", borderRadius: 10, marginTop: 16 }}>{status}</p>
    <small style={{ lineHeight: 1.7 }}>安全说明：AK/SK 只写入 Windows 系统加密设置，不存入浏览器 localStorage；授权令牌保存在本机加密区。方舟要求演员本人完成活体授权，软件不能合法代替本人操作。</small>
  </section>;
}
