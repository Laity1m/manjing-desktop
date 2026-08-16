const ARK_API = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const TASK_PATTERN = /^cgt-[a-z0-9-]{8,100}$/i;
const MODEL_PATTERN = /^(?:doubao-seedance-[a-z0-9-]+|ep-[a-z0-9-]+)$/i;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const createCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
type OmniReference = { kind?: unknown; role?: unknown; url?: unknown; name?: unknown; weight?: unknown };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function safeError(value: unknown) {
  if (!value || typeof value !== "object") return "Seedance 方舟接口暂时不可用";
  const data = value as { error?: { message?: unknown }; message?: unknown };
  return String(data.error?.message || data.message || "Seedance 方舟接口暂时不可用").slice(0, 300);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArk(url: string, init: RequestInit, action: "create" | "status") {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      lastResponse = response;
      if (!TRANSIENT_STATUSES.has(response.status) || attempt === 2) return response;
    } catch (error) {
      if (action === "create") {
        const reason = error instanceof DOMException && error.name === "AbortError" ? "连接等待超过 45 秒" : "网络连接被中断";
        throw new Error(`Seedance 创建请求${reason}；为避免重复创建和扣费，漫镜没有向方舟自动重复提交`);
      }
      if (attempt === 2) {
        const reason = error instanceof DOMException && error.name === "AbortError" ? "连接等待超过 45 秒" : "网络连接被中断";
        throw new Error(`Seedance 任务查询${reason}`);
      }
    } finally {
      clearTimeout(timeout);
    }
    await delay(700 * (attempt + 1));
  }
  if (lastResponse) return lastResponse;
  throw new Error("Seedance 方舟接口没有返回响应");
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Seedance 请求格式不正确", retryable: false }, 400);
  }
  try {
    const apiKey = String(body.apiKey || "").trim();
    if (apiKey.length < 8 || apiKey.length > 500) return json({ error: "请填写有效的火山方舟 API Key" }, 400);
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    if (body.action === "create") {
      const prompt = String(body.prompt || "").trim().slice(0, 1800);
      const negativePrompt = String(body.negativePrompt || "").trim().slice(0, 800);
      const model = String(body.model || "doubao-seedance-1-5-pro-251215").trim();
      if (prompt.length < 8) return json({ error: "视频提示词至少需要 8 个字" }, 400);
      if (!MODEL_PATTERN.test(model)) return json({ error: "Seedance 模型 ID 或 Endpoint ID 格式不正确" }, 400);
      const ratio = body.ratio === "16:9" ? "16:9" : "9:16";
      const isOmniModel = String(body.referenceMode || "").toLowerCase() === "omni" || /seedance-2/i.test(model);
      const duration = isOmniModel ? Math.max(4, Math.min(15, Math.round(Number(body.duration) || 8))) : Number(body.duration) >= 8 ? 10 : 5;
      const resolution = ["480p", "720p", "1080p"].includes(String(body.resolution)) ? String(body.resolution) : "720p";
      const rawVoiceover = body.voiceover && typeof body.voiceover === "object" ? body.voiceover as Record<string, unknown> : {};
      const voiceEnabled = rawVoiceover.enabled === true;
      const audioEnabled = rawVoiceover.audioEnabled !== false;
      const backgroundMusic = rawVoiceover.backgroundMusic === true;
      const voiceInstruction = voiceEnabled
        ? `\n生成原生音轨；配音语言：${String(rawVoiceover.language || "普通话").slice(0, 30)}；人声风格：${String(rawVoiceover.style || "自然对白").slice(0, 60)}；${rawVoiceover.script ? `准确台词：${String(rawVoiceover.script).slice(0, 500)}` : "根据画面生成一句简短自然的对白或旁白"}；人物口型与声音同步。`
        : audioEnabled ? `\n不生成人物对白或旁白；保留动作音效和环境声。${backgroundMusic ? "生成符合剧情节奏的无歌词背景音乐。" : "不要生成背景音乐。"}` : "\n输出静音视频，不生成对白、旁白、音乐或环境音。";
      let text = `${prompt}${voiceInstruction}${negativePrompt ? `\n避免：${negativePrompt}` : ""}`;
      const content: Array<Record<string, unknown>> = [{ type: "text", text }];
      const rawReferences = Array.isArray(body.references) ? body.references as OmniReference[] : [];
      const counts = { image: 0, video: 0, audio: 0 };
      const accepted: Array<{ kind: string; role: string; token?: string; name: string }> = [];
      const referenceUrl = (value: unknown) => {
        const raw = String(value || "").trim();
        return /^(?:https:\/\/|data:(?:image|video|audio)\/|asset:\/\/)/i.test(raw) ? raw : "";
      };
      if (isOmniModel) {
        for (const reference of rawReferences) {
          const kind = ["image", "video", "audio"].includes(String(reference.kind)) ? String(reference.kind) as "image" | "video" | "audio" : "image";
          const limit = kind === "image" ? 9 : 3;
          const url = referenceUrl(reference.url);
          if (!url || accepted.length >= 12 || counts[kind] >= limit) continue;
          counts[kind] += 1;
          // Seedance 2.0 first/last-frame control is mutually exclusive with
          // omni-reference media. Manjing uses omni-reference mode exclusively:
          // continuity frames are ordinary @Image references too.
          const role = kind === "image" ? "reference_image" : kind === "video" ? "reference_video" : "reference_audio";
          content.push({ type: `${kind}_url`, [`${kind}_url`]: { url }, role });
          accepted.push({ kind, role, token: `@${kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio"}${counts[kind]}`, name: String(reference.name || `${kind}-${counts[kind]}`).slice(0, 120) });
        }
      }
      if (accepted.length) {
        const bindings = accepted.map((reference) => {
          const purpose = reference.role === "reference_video" ? "参考动作、镜头速度和上一镜时间连续性，不复制原剧情" : reference.role === "reference_audio" ? "锁定对应人物音色、年龄感、语速和口音" : "锁定对应人物身份与造型、场景、道具或全片风格";
          return `${reference.token || "@Image1"} = ${reference.name}；用途：${purpose}`;
        }).join("\n");
        text += `\n\n多模态资产绑定清单（必须逐项使用）：\n${bindings}\n所有图片都只作为 @Image 全能参考，绝不作为首帧控制。引用优先级：Canonical 人物身份与服装 > 场景和关键道具 > 全片风格 > 连续状态与动作参考。不得重新设计已绑定资产。`;
        content[0] = { type: "text", text };
      }
      const requestId = String(body.requestId || "").trim();
      const cached = requestId && /^[a-z0-9-]{8,80}$/i.test(requestId) ? createCache.get(requestId) : undefined;
      if (cached && cached.expiresAt > Date.now()) return json(cached.payload, 202);
      const upstream = await fetchArk(ARK_API, { method: "POST", headers, body: JSON.stringify({ model, content, resolution, ratio, duration, watermark: false, return_last_frame: true, generate_audio: audioEnabled }) }, "create");
      const payload = await upstream.json().catch(() => ({ message: `Seedance 方舟接口返回了无法解析的内容（${upstream.status}）` })) as { id?: string; error?: { message?: unknown }; message?: unknown };
      if (!upstream.ok || !payload.id) return json({ error: safeError(payload) }, upstream.status || 502);
      const result = { id: payload.id, status: "queued", acceptedReferences: accepted, ignoredReferences: Math.max(0, rawReferences.length - accepted.length) };
      if (requestId && /^[a-z0-9-]{8,80}$/i.test(requestId)) {
        createCache.set(requestId, { expiresAt: Date.now() + 30 * 60 * 1000, payload: result });
        if (createCache.size > 80) for (const [key, value] of createCache) if (value.expiresAt <= Date.now()) createCache.delete(key);
      }
      return json(result, 202);
    }

    if (body.action === "status") {
      const id = String(body.id || "").trim();
      if (!TASK_PATTERN.test(id)) return json({ error: "Seedance 任务编号无效" }, 400);
      const upstream = await fetchArk(`${ARK_API}/${encodeURIComponent(id)}`, { headers }, "status");
      const payload = await upstream.json().catch(() => ({ message: `Seedance 方舟接口返回了无法解析的内容（${upstream.status}）` })) as { status?: string; content?: { video_url?: string; last_frame_url?: string }; error?: { message?: unknown }; message?: unknown };
      if (!upstream.ok) return json({ error: safeError(payload) }, upstream.status || 502);
      if (payload.status === "failed" || payload.status === "cancelled") return json({ error: safeError(payload), done: true, status: payload.status }, 502);
      return json({ done: payload.status === "succeeded", status: payload.status || "queued", videoUrl: payload.content?.video_url || "", lastFrameUrl: payload.content?.last_frame_url || "" });
    }

    return json({ error: "不支持的 Seedance 操作" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seedance 方舟接口暂时无法连接";
    const uncertainCreate = body.action === "create" && /避免重复创建和扣费/.test(message);
    return json({ error: message.slice(0, 300), retryable: !uncertainCreate }, uncertainCreate ? 502 : 503);
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const upstream = await fetch(target, { redirect: "follow" });
      if (upstream.ok && upstream.body) {
        const declaredLength = Number(upstream.headers.get("Content-Length") || 0);
        if (declaredLength > 256 * 1024 * 1024) return json({ error: "Seedance 视频超过 256MB，无法导入漫镜" }, 413);
        const bytes = await upstream.arrayBuffer();
        if (bytes.byteLength > 256 * 1024 * 1024) return json({ error: "Seedance 视频超过 256MB，无法导入漫镜" }, 413);
        return new Response(bytes, { headers: { "Content-Type": upstream.headers.get("Content-Type") || "video/mp4", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, max-age=1800" } });
      }
      if (!TRANSIENT_STATUSES.has(upstream.status)) return json({ error: "Seedance 视频已失效，请重新生成" }, 502);
    } catch {
      if (attempt === 2) return json({ error: "下载 Seedance 视频失败，已自动重试 3 次" }, 503);
    }
    await delay(700 * (attempt + 1));
  }
  return json({ error: "下载 Seedance 视频失败，已自动重试 3 次" }, 503);
}
