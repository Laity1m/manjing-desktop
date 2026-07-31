const HORDE_API = "https://aihorde.net/api/v2";
const CLIENT_AGENT = "ManjingStudio:2.0:https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeMessage(value: unknown) {
  if (!value || typeof value !== "object") return "免费生成服务暂时不可用";
  const candidate = value as { message?: unknown; rc?: unknown };
  const message = String(candidate.message || candidate.rc || "免费生成服务暂时不可用").slice(0, 240);
  if (/kudos|heavy demand|over 512 tokens/i.test(message)) return "免费社区当前负载较高，请稍后重试；漫镜已将匿名请求限制在免费额度内";
  return message;
}

function repairUtf8Mojibake(value: string) {
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(Array.from(value), (character) => character.charCodeAt(0));
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u4e00-\u9fff]/.test(repaired) ? repaired : value;
  } catch {
    return value;
  }
}

async function chooseChineseTextModel(role: "writer" | "director" = "writer") {
  const preferred = role === "director" ? [
    "koboldcpp/Qwen/Qwen3.5-0.8B",
    "koboldcpp/Qwen_Qwen3-0.6B-IQ4_XS",
    "google/gemma-4-31b",
  ] : [
    "google/gemma-4-31b",
    "koboldcpp/Gemma-4-26B",
    "koboldcpp/gemma-4-26B-A4B-it-UD-Q4_K_S",
    "koboldcpp/Qwen/Qwen3.5-0.8B",
  ];
  try {
    const response = await fetch(`${HORDE_API}/status/models?type=text`);
    const models = (await response.json()) as Array<{ name?: string; count?: number }>;
    return preferred.find((name) => models.some((model) => model.name === name && Number(model.count) > 0));
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;
    const story = String(body.story || "").trim().slice(0, 1200);

    if (action === "story") {
      if (story.length < 8) return json({ error: "故事至少需要 8 个字" }, 400);
      const count = Math.max(3, Math.min(4, Number(body.count) || 3));
      const style = String(body.style || "国漫电影感").slice(0, 40);
      const prompt = [
        "You are a professional Chinese motion-comic storyboard writer.",
        `Turn the following story into exactly ${count} connected scenes in the visual style: ${style}.`,
        "Return ONLY one minified JSON object on a single line. Use Simplified Chinese. No markdown and no explanation.",
        "Keep every value concise. Use at most 2 characters. Establish fixed appearances, dramatic conflict, concrete acting and a closing hook.",
        'Compact schema: {"t":"标题","m":"配乐","c":[{"n":"姓名","r":"身份","a":"外观","v":"nova"}],"s":[{"t":"镜头","c":["姓名"],"h":"景别","v":"场景","a":"动作","k":"运镜","p":"说话者","e":"情绪","d":"台词","x":"音效","u":6}]}',
        `故事：${story}`,
      ].join("\n");
      const requestedModel = String(body.model || "").trim().slice(0, 160);
      const selectedModel = requestedModel && !/自动调度|Stable Horde/i.test(requestedModel) ? requestedModel : await chooseChineseTextModel("writer");
      const upstream = await fetch(`${HORDE_API}/generate/text/async`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "0000000000",
          "Client-Agent": CLIENT_AGENT,
        },
        body: JSON.stringify({
          prompt,
          params: {
            n: 1,
            max_context_length: 4096,
            max_length: 480,
            temperature: 0.65,
            top_p: 0.9,
            rep_pen: 1.12,
          },
          ...(selectedModel ? { models: [selectedModel] } : {}),
          trusted_workers: false,
          validated_backends: true,
          slow_workers: true,
        }),
      });
      const data = await upstream.json();
      if (!upstream.ok || !data?.id) return json({ error: safeMessage(data) }, upstream.status || 502);
      return json({ id: data.id, kind: "text" }, 202);
    }

    if (action === "director") {
      const draft = String(body.draft || "").trim().slice(0, 10000);
      if (story.length < 8 || draft.length < 20) return json({ error: "导演复核缺少完整剧本" }, 400);
      const count = Math.max(3, Math.min(4, Number(body.count) || 3));
      const style = String(body.style || "国漫电影感").slice(0, 40);
      const prompt = [
        "You are the supervising director of a Chinese AI motion-comic production.",
        `Review the writer draft for exactly ${count} scenes and style ${style}. Fix JSON syntax, character consistency, dramatic pacing, visual prompts and the ending hook.`,
        "Return ONLY the complete minified JSON object. Keep the same compact schema and use Simplified Chinese. No markdown or explanation.",
        `原故事：${story}`,
        `编剧初稿：${draft}`,
      ].join("\n");
      const requestedModel = String(body.model || "").trim().slice(0, 160);
      const selectedModel = requestedModel && !/自动调度/i.test(requestedModel) ? requestedModel : await chooseChineseTextModel("director");
      const upstream = await fetch(`${HORDE_API}/generate/text/async`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: "0000000000", "Client-Agent": CLIENT_AGENT },
        body: JSON.stringify({
          prompt,
          params: { n: 1, max_context_length: 8192, max_length: 480, temperature: 0.45, top_p: 0.88, rep_pen: 1.08 },
          ...(selectedModel ? { models: [selectedModel] } : {}),
          trusted_workers: false,
          validated_backends: true,
          slow_workers: true,
        }),
      });
      const data = await upstream.json();
      if (!upstream.ok || !data?.id) return json({ error: safeMessage(data) }, upstream.status || 502);
      return json({ id: data.id, kind: "text" }, 202);
    }

    if (action === "image") {
      const prompt = String(body.prompt || "").trim().slice(0, 1800);
      const aspect = body.aspect === "16:9" ? "16:9" : "9:16";
      const requestedModel = String(body.model || "").trim().slice(0, 160);
      if (prompt.length < 8) return json({ error: "画面描述太短" }, 400);
      const fullPrompt = [
        prompt,
        "cinematic Chinese manhua panel, professional composition, expressive characters, coherent anatomy, dramatic lighting, highly detailed, no text, no caption",
        "### low quality, blurry, watermark, logo, letters, text, deformed hands, extra fingers, duplicate people",
      ].join(", ");
      const upstream = await fetch(`${HORDE_API}/generate/async`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "0000000000",
          "Client-Agent": CLIENT_AGENT,
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          params: {
            n: 1,
            width: aspect === "9:16" ? 448 : 704,
            height: aspect === "9:16" ? 704 : 384,
            steps: 24,
            sampler_name: "k_euler_a",
            cfg_scale: 7,
          },
          nsfw: false,
          censor_nsfw: true,
          shared: true,
          r2: true,
          trusted_workers: false,
          validated_backends: true,
          slow_workers: true,
          ...(requestedModel && !/Stable Horde|自动调度/i.test(requestedModel) ? { models: [requestedModel] } : {}),
        }),
      });
      const data = await upstream.json();
      if (!upstream.ok || !data?.id) return json({ error: safeMessage(data) }, upstream.status || 502);
      return json({ id: data.id, kind: "image" }, 202);
    }

    return json({ error: "不支持的生成任务" }, 400);
  } catch {
    return json({ error: "请求格式不正确" }, 400);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const kind = url.searchParams.get("kind");
  if (!UUID_PATTERN.test(id) || (kind !== "text" && kind !== "image")) {
    return json({ error: "任务编号无效" }, 400);
  }

  try {
    const headers = { "Client-Agent": CLIENT_AGENT };
    if (kind === "image") {
      const checkResponse = await fetch(`${HORDE_API}/generate/check/${id}`, { headers });
      const check = await checkResponse.json();
      if (!checkResponse.ok) return json({ error: safeMessage(check) }, checkResponse.status);
      if (!check.done) return json({ done: false, ...check });
      const resultResponse = await fetch(`${HORDE_API}/generate/status/${id}`, { headers });
      const result = await resultResponse.json();
      const generation = result?.generations?.[0];
      if (!resultResponse.ok || !generation?.img) {
        return json({ error: safeMessage(result), done: true }, resultResponse.status || 502);
      }
      return json({
        done: true,
        imageUrl: generation.img,
        seed: generation.seed,
        model: generation.model,
        censored: Boolean(generation.censored),
      });
    }

    const resultResponse = await fetch(`${HORDE_API}/generate/text/status/${id}`, { headers });
    const result = await resultResponse.json();
    if (!resultResponse.ok) return json({ error: safeMessage(result) }, resultResponse.status);
    if (!result.done) return json({ done: false, ...result });
    const generation = result?.generations?.[0];
    if (!generation || typeof generation.text !== "string" || !generation.text.trim()) {
      return json({ error: "模型没有返回可用剧本，请重试", done: true }, 502);
    }
    return json({ done: true, text: repairUtf8Mojibake(generation.text), model: generation.model });
  } catch {
    return json({ error: "无法连接免费生成服务，请稍后重试" }, 502);
  }
}
