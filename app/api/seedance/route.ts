const ARK_API = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const TASK_PATTERN = /^cgt-[a-z0-9-]{8,100}$/i;
const MODEL_PATTERN = /^(?:doubao-seedance-[a-z0-9-]+|ep-[a-z0-9-]+)$/i;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function safeError(value: unknown) {
  if (!value || typeof value !== "object") return "即梦 Seedance 暂时不可用";
  const data = value as { error?: { message?: unknown }; message?: unknown };
  return String(data.error?.message || data.message || "即梦 Seedance 暂时不可用").slice(0, 300);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const apiKey = String(body.apiKey || "").trim();
    if (apiKey.length < 8 || apiKey.length > 500) return json({ error: "请填写有效的火山方舟 API Key" }, 400);
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    if (body.action === "create") {
      const prompt = String(body.prompt || "").trim().slice(0, 1800);
      const model = String(body.model || "doubao-seedance-1-0-pro-250528").trim();
      if (prompt.length < 8) return json({ error: "视频提示词至少需要 8 个字" }, 400);
      if (!MODEL_PATTERN.test(model)) return json({ error: "Seedance 模型 ID 或 Endpoint ID 格式不正确" }, 400);
      const ratio = body.ratio === "16:9" ? "16:9" : "9:16";
      const duration = Number(body.duration) >= 8 ? 10 : 5;
      const text = `${prompt} --ratio ${ratio} --resolution 720p --dur ${duration} --watermark false`;
      const content: Array<Record<string, unknown>> = [{ type: "text", text }];
      const imageUrl = String(body.imageUrl || "").trim();
      if (/^https:\/\//i.test(imageUrl)) content.push({ type: "image_url", image_url: { url: imageUrl } });
      const upstream = await fetch(ARK_API, { method: "POST", headers, body: JSON.stringify({ model, content, return_last_frame: true }) });
      const payload = await upstream.json() as { id?: string; error?: { message?: unknown }; message?: unknown };
      if (!upstream.ok || !payload.id) return json({ error: safeError(payload) }, upstream.status || 502);
      return json({ id: payload.id, status: "queued" }, 202);
    }

    if (body.action === "status") {
      const id = String(body.id || "").trim();
      if (!TASK_PATTERN.test(id)) return json({ error: "Seedance 任务编号无效" }, 400);
      const upstream = await fetch(`${ARK_API}/${encodeURIComponent(id)}`, { headers });
      const payload = await upstream.json() as { status?: string; content?: { video_url?: string; last_frame_url?: string }; error?: { message?: unknown }; message?: unknown };
      if (!upstream.ok) return json({ error: safeError(payload) }, upstream.status || 502);
      if (payload.status === "failed" || payload.status === "cancelled") return json({ error: safeError(payload), done: true, status: payload.status }, 502);
      return json({ done: payload.status === "succeeded", status: payload.status || "queued", videoUrl: payload.content?.video_url || "", lastFrameUrl: payload.content?.last_frame_url || "" });
    }

    return json({ error: "不支持的 Seedance 操作" }, 400);
  } catch {
    return json({ error: "Seedance 请求格式不正确" }, 400);
  }
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return json({ error: "缺少 Seedance 媒体地址" }, 400);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "Seedance 媒体地址无效" }, 400);
  }
  const trusted = target.hostname === "volces.com" || target.hostname.endsWith(".volces.com") || target.hostname === "volcengine.com" || target.hostname.endsWith(".volcengine.com");
  if (target.protocol !== "https:" || !trusted) return json({ error: "不允许的 Seedance 媒体来源" }, 403);
  try {
    const upstream = await fetch(target, { redirect: "follow" });
    if (!upstream.ok || !upstream.body) return json({ error: "Seedance 视频已失效，请重新生成" }, 502);
    return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("Content-Type") || "video/mp4", "Cache-Control": "private, max-age=1800" } });
  } catch {
    return json({ error: "下载 Seedance 视频失败" }, 502);
  }
}
