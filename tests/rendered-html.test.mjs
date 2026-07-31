import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the Simplified Chinese multi-page motion-comic portal", async () => {
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>漫镜 · AI 漫剧创作与剪辑工作台<\/title>/);
  assert.match(html, /到一部/);
  assert.match(html, /真正会动/);
  assert.match(html, /进入 AI 工作台/);
  assert.match(html, /打开专业剪辑台/);
  assert.match(html, /模型与 Key/);
  assert.match(html, /项目资产/);
  assert.match(html, /0–120s/);
  assert.match(html, /href="\/studio"/);
  assert.match(html, /href="\/editor"/);
  assert.match(html, /href="\/models"/);
  assert.match(html, /href="\/projects"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/);
});

test("renders every primary product route", async () => {
  const cases = [
    ["/studio", /一键生成完整 AI 漫剧/],
    ["/editor", /保存工程/],
    ["/models", /模型与 Key/],
    ["/projects", /项目与资产/],
  ];
  for (const [path, marker] of cases) {
    const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, ctx);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), marker);
  }
});

test("rejects an incomplete director review before contacting providers", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/horde", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "director", story: "这是一个足够长的故事梗概", draft: "{}" }),
  }), env, ctx);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "导演复核缺少完整剧本" });
});

test("keeps anonymous AI Horde text jobs inside the free token allowance", async () => {
  const source = await readFile(new URL("../app/api/horde/route.ts", import.meta.url), "utf8");
  assert.equal(source.match(/max_length:\s*480/g)?.length, 2);
  assert.match(source, /Math\.min\(4, Number\(body\.count\)/);
});

test("timeboxes the optional free director review instead of blocking production", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(source, /maxAttempts:\s*6/);
  assert.match(source, /超过 18 秒将自动采用编剧初稿/);
  assert.match(source, /if \(runRef\.current !== run\) throw new Error\("任务已取消"\)/);
});

test("completes truncated free storyboards instead of aborting production", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(source, /parseStoryboard\(raw, productionDuration, 1\)/);
  assert.match(source, /completeFreeStoryboard\(partial, story\.trim\(\), style, productionDuration\)/);
  assert.match(source, /免费编剧输出不完整，漫镜正在自动补全分镜/);
});

test("ships a user-editable multitrack workbench and downloadable deliverables", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(source, /AI 制作现场/);
  assert.match(source, /下载剧本/);
  assert.match(source, /下载分镜/);
  assert.match(source, /保存工程/);
  assert.match(source, /替换图片/);
  assert.match(source, /导入视频/);
  assert.match(source, /导入配音/);
  assert.match(source, /2\.5D 动态/);
  assert.match(source, /subtitlePosition/);
  assert.match(source, /musicVolume/);
});

test("improves the free image and motion pipeline without presenting it as native animation", async () => {
  const page = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const horde = await readFile(new URL("../app/api/horde/route.ts", import.meta.url), "utf8");
  assert.match(page, /layered foreground middle ground and background for 2\.5D motion/);
  assert.match(page, /人物本身不会产生走路、口型等新动作/);
  assert.match(page, /function drawMovingShot/);
  assert.match(horde, /width: aspect === "9:16" \? 448 : 704/);
  assert.match(horde, /height: aspect === "9:16" \? 704 : 384/);
});

test("connects self-hosted ComfyUI, Wan, CosyVoice and MuseTalk nodes", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(source, /开源本地节点中心/);
  assert.match(source, /\/v1\/image/);
  assert.match(source, /\/v1\/video/);
  assert.match(source, /\/v1\/audio/);
  assert.match(source, /\/v1\/lipsync/);
  assert.match(source, /createLipSyncedVideo/);
  assert.match(source, /validAgentEndpoint/);
});

test("connects official LibTV orchestration and Volcengine Seedance jobs", async () => {
  const page = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const libtv = await readFile(new URL("../app/api/libtv/route.ts", import.meta.url), "utf8");
  const seedance = await readFile(new URL("../app/api/seedance/route.ts", import.meta.url), "utf8");
  assert.match(page, /generateWithLibTv/);
  assert.match(page, /applySeedanceEngine/);
  assert.match(page, /LibTV 正在建立完整漫剧项目/);
  assert.match(libtv, /https:\/\/im\.liblib\.tv/);
  assert.match(libtv, /Authorization: `Bearer \$\{accessKey\}`/);
  assert.match(seedance, /contents\/generations\/tasks/);
  assert.match(seedance, /return_last_frame: true/);
});

test("ships an interactive browser video editor instead of a decorative shell", async () => {
  const editor = await readFile(new URL("../app/editor/EditorClient.tsx", import.meta.url), "utf8");
  assert.match(editor, /async function importFiles/);
  assert.match(editor, /function splitAtPlayhead/);
  assert.match(editor, /function reorderVisual/);
  assert.match(editor, /function undo/);
  assert.match(editor, /function redo/);
  assert.match(editor, /canvas\.captureStream\(30\)/);
  assert.match(editor, /new MediaRecorder/);
  assert.match(editor, /setSnapEnabled/);
  assert.match(editor, /setPreviewScale/);
});

test("documents provider keys and keeps project search controls interactive", async () => {
  const keys = await readFile(new URL("../app/models/KeysClient.tsx", import.meta.url), "utf8");
  const projects = await readFile(new URL("../app/projects/ProjectsClient.tsx", import.meta.url), "utf8");
  assert.match(keys, /LIBTV_ACCESS_KEY/);
  assert.match(keys, /ARK_API_KEY/);
  assert.match(keys, /POLLINATIONS_KEY/);
  assert.match(keys, /复制名称/);
  assert.match(projects, /setFilter\("working"\)/);
  assert.match(projects, /setQuery\(event\.target\.value\)/);
});

test("cloud engine proxies reject missing credentials and untrusted media hosts", async () => {
  const libtvMissingKey = await worker.fetch(new Request("http://localhost/api/libtv", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create", message: "生成一部完整的 AI 漫剧" }),
  }), env, ctx);
  assert.equal(libtvMissingKey.status, 400);

  const seedanceMissingKey = await worker.fetch(new Request("http://localhost/api/seedance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create", prompt: "让人物自然地走向镜头" }),
  }), env, ctx);
  assert.equal(seedanceMissingKey.status, 400);

  const untrustedLibtv = await worker.fetch(new Request("http://localhost/api/libtv?url=https%3A%2F%2Fexample.com%2Fvideo.mp4"), env, ctx);
  const untrustedSeedance = await worker.fetch(new Request("http://localhost/api/seedance?url=https%3A%2F%2Fexample.com%2Fvideo.mp4"), env, ctx);
  assert.equal(untrustedLibtv.status, 403);
  assert.equal(untrustedSeedance.status, 403);
});

test("ships a downloadable local bridge with unified media endpoints", async () => {
  const bridge = await readFile(new URL("../tools/manjing-local-bridge/app.py", import.meta.url), "utf8");
  assert.match(bridge, /@app\.post\("\/v1\/image"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/video"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/audio"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/lipsync"\)/);
  const archive = await stat(new URL("../public/manjing-local-bridge.zip", import.meta.url));
  assert.ok(archive.size > 1000);
});

test("rejects invalid generation requests before contacting providers", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/horde", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "story", story: "太短" }),
  }), env, ctx);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "故事至少需要 8 个字" });
});

test("media proxy blocks untrusted hosts", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/media?url=https%3A%2F%2Fexample.com%2Fimage.png"), env, ctx);
  assert.equal(response.status, 403);
});
