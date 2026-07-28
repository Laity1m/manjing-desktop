const ALLOWED_HORDE_HOST = /^[a-f0-9]+\.r2\.cloudflarestorage\.com$/i;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "缺少媒体地址" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Response.json({ error: "媒体地址无效" }, { status: 400 });
  }

  if (target.protocol !== "https:" || !ALLOWED_HORDE_HOST.test(target.hostname) || !target.pathname.startsWith("/stable-horde/")) {
    return Response.json({ error: "不允许的媒体来源" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target, { redirect: "follow" });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "生成图片已经失效，请重新生成" }, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "image/webp",
        "Cache-Control": "private, max-age=1800",
      },
    });
  } catch {
    return Response.json({ error: "下载生成图片失败" }, { status: 502 });
  }
}
