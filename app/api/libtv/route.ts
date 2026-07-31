const LIBTV_API = "https://im.liblib.tv";
const LIBTV_MEDIA_HOST = "libtv-res.liblib.art";
const SESSION_PATTERN = /^[0-9a-f-]{24,64}$/i;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function upstreamMessage(value: unknown) {
  if (!value || typeof value !== "object") return "LibTV 暂时没有返回可用结果";
  const data = value as { error?: unknown; message?: unknown; msg?: unknown };
  return String(data.error || data.message || data.msg || "LibTV 暂时没有返回可用结果").slice(0, 300);
}

function extractMedia(messages: Array<Record<string, unknown>>) {
  const results: Array<{ kind: "image" | "video"; url: string }> = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    const url = String(raw || "").trim();
    if (!/^https:\/\/libtv-res\.liblib\.art\//i.test(url) || seen.has(url)) return;
    const clean = url.split(/[\s\"'<>]/)[0];
    const kind = /\.(?:mp4|mov|webm)(?:\?|$)/i.test(clean) ? "video" : /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(clean) ? "image" : null;
    if (!kind) return;
    seen.add(clean);
    results.push({ kind, url: clean });
  };

  for (const message of messages) {
    const content = message.content;
    if (typeof content !== "string") continue;
    try {
      const parsed = JSON.parse(content) as { task_result?: { images?: Array<{ previewPath?: string }>; videos?: Array<{ previewPath?: string; url?: string }> } };
      parsed.task_result?.images?.forEach((item) => add(item.previewPath));
      parsed.task_result?.videos?.forEach((item) => add(item.previewPath || item.url));
    } catch {
      for (const match of content.matchAll(/https:\/\/libtv-res\.liblib\.art\/[^\s\"'<>]+\.(?:png|jpe?g|webp|mp4|mov|webm)(?:\?[^\s\"'<>]*)?/gi)) add(match[0]);
    }
  }
  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const accessKey = String(body.accessKey || "").trim();
    if (accessKey.length < 8 || accessKey.length > 500) return json({ error: "请填写有效的 LibTV Access Key" }, 400);
    const headers = { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" };

    if (body.action === "create") {
      const message = String(body.message || "").trim().slice(0, 5000);
      if (message.length < 8) return json({ error: "漫剧创作指令至少需要 8 个字" }, 400);
      const upstream = await fetch(`${LIBTV_API}/openapi/session`, { method: "POST", headers, body: JSON.stringify({ message }) });
      const payload = await upstream.json() as { data?: { projectUuid?: string; sessionId?: string }; error?: unknown; message?: unknown };
      if (!upstream.ok || !payload.data?.sessionId) return json({ error: upstreamMessage(payload) }, upstream.status || 502);
      const projectUuid = String(payload.data.projectUuid || "");
      return json({ sessionId: payload.data.sessionId, projectUuid, projectUrl: projectUuid ? `https://www.liblib.tv/canvas?projectId=${encodeURIComponent(projectUuid)}` : "" }, 202);
    }

    if (body.action === "status") {
      const sessionId = String(body.sessionId || "").trim();
      if (!SESSION_PATTERN.test(sessionId)) return json({ error: "LibTV 任务编号无效" }, 400);
      const upstream = await fetch(`${LIBTV_API}/openapi/session/${encodeURIComponent(sessionId)}`, { headers });
      const payload = await upstream.json() as { data?: { messages?: Array<Record<string, unknown>> }; error?: unknown; message?: unknown };
      if (!upstream.ok) return json({ error: upstreamMessage(payload) }, upstream.status || 502);
      const messages = Array.isArray(payload.data?.messages) ? payload.data.messages : [];
      const results = extractMedia(messages);
      const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant" && typeof item.content === "string");
      const summary = typeof lastAssistant?.content === "string" ? lastAssistant.content.replace(/https?:\/\/\S+/g, "").trim().slice(0, 240) : "LibTV 正在编排剧本、分镜和视频";
      const failed = messages.some((item) => typeof item.content === "string" && /(?:生成失败|任务失败|failed|error)/i.test(item.content));
      return json({ done: results.some((item) => item.kind === "video"), failed, results, summary, messageCount: messages.length });
    }

    return json({ error: "不支持的 LibTV 操作" }, 400);
  } catch {
    return json({ error: "LibTV 请求格式不正确" }, 400);
  }
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return json({ error: "缺少 LibTV 媒体地址" }, 400);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "LibTV 媒体地址无效" }, 400);
  }
  if (target.protocol !== "https:" || target.hostname !== LIBTV_MEDIA_HOST) return json({ error: "不允许的 LibTV 媒体来源" }, 403);
  try {
    const upstream = await fetch(target, { redirect: "follow" });
    if (!upstream.ok || !upstream.body) return json({ error: "LibTV 媒体已失效，请重新生成" }, 502);
    return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "private, max-age=1800" } });
  } catch {
    return json({ error: "读取 LibTV 媒体失败" }, 502);
  }
}
