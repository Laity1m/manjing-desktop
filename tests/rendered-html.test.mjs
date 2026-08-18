import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

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
  assert.match(html, /<title>漫镜 —— AI 漫剧与视频工作台<\/title>/);
  assert.match(html, /从剧本到成片/);
  assert.match(html, /快速创作 AI 漫剧与 AI 视频/);
  assert.match(html, /进入 AI 工作台/);
  assert.match(html, /打开剪辑编辑/);
  assert.match(html, /模型中心/);
  assert.match(html, /项目/);
  assert.match(html, /href="\/studio"/);
  assert.match(html, /href="\/editor"/);
  assert.match(html, /href="\/models"/);
  assert.match(html, /href="\/projects"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/);
});

test("renders every primary product route", async () => {
  const cases = [
    ["/studio", /一键生成完整 AI 漫剧/],
    ["/video", /AI 视频工作室/],
    ["/canvas", /正在恢复本机画布/],
    ["/editor", /保存工程/],
    ["/models", /模型中心/],
    ["/projects", /系列项目中心/],
    ["/assets", /复用视觉素材库/],
    ["/projects/detail?id=missing", /项目详情/],
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
  assert.match(source, /parseStoryboard\(raw, productionDuration, sceneCountForDuration\(productionDuration\), 8\)/);
  assert.match(source, /completeFreeStoryboard\(partial, story\.trim\(\), style, productionDuration\)/);
  assert.match(source, /免费编剧输出不完整，漫镜正在自动补全分镜/);
});

test("ships a user-editable multitrack workbench and downloadable deliverables", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(source, /AI 制作现场/);
  assert.match(source, /下载剧本/);
  assert.match(source, /下载镜头计划/);
  assert.match(source, /保存工程/);
  assert.match(source, /替换图片/);
  assert.match(source, /导入视频/);
  assert.match(source, /导入配音/);
  assert.match(source, /2\.5D 动态/);
  assert.match(source, /subtitlePosition/);
  assert.match(source, /musicVolume/);
  assert.match(source, /aria-label="一键漫剧自动配音"/);
  assert.match(source, /aria-pressed=\{voiceEnabled\}/);
  assert.match(source, /一键漫剧配音已关闭，LibTV 将跳过人声/);
  assert.match(source, /if \(!voiceEnabled \|\| !scene\.audioUrl\) buffers\.push\(null\)/);
  assert.match(source, /voiceEnabled/);
  assert.match(source, /bgmEnabled/);
});

test("retries timed-out AI departments without clearing completed upstream assets", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /async function rerunRole\(role: AgentRole\)/);
  assert.match(source, /function canRerunRole\(role: AgentRole\)/);
  assert.match(source, /正在从上次中断处重新运行/);
  assert.match(source, /已完成成果仍然保留，可重新运行中断的岗位/);
  assert.match(source, /重新运行\$\{role\.title\}/);
  assert.match(source, /directorReview\(storyboardDraft/);
  assert.match(source, /\$\{agentName\("director"\)\}复核未及时完成/);
  assert.match(source, /免费导演 AI 正在排队复核/);
  assert.doesNotMatch(source, /recordActivity\("director", "免费导演未及时交稿/);
  assert.match(source, /filter\(\(scene\) => !scene\.imageUrl \|\| scene\.status === "error"\)/);
  assert.match(source, /const sequentialPlan = planSequentialVideo\(work\)/);
  assert.match(source, /sequentialPlan\.kind === "generate" \? \[sequentialPlan\.sceneId\] : \[\]/);
  assert.match(source, /filter\(\(scene\) => scene\.dialogue\.trim\(\) && \(!scene\.audioUrl \|\| scene\.status === "error"\)\)/);
  assert.match(source, /recordActivity\(activeRole,/);
  assert.match(source, /sceneActionRef\.current/);
  assert.match(source, /disabled=\{busy \|\| Boolean\(sceneAction\)\}/);
  assert.match(styles, /\.job-retry-button/);
  assert.match(styles, /workflow-roles article > aside button/);
});

test("improves the free image and motion pipeline without presenting it as native animation", async () => {
  const page = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const horde = await readFile(new URL("../app/api/horde/route.ts", import.meta.url), "utf8");
  assert.match(page, /layered foreground middle ground and background for camera motion/);
  assert.match(page, /normalizeImageBlobForAspect/);
  assert.match(page, /width: mediaAspect === "9:16" \? "720" : "1280"/);
  assert.match(page, /height: mediaAspect === "9:16" \? "1280" : "720"/);
  assert.match(page, /references: await videoReferences\(scene, previousScene/);
  assert.match(page, /canvas\.toBlob\(resolve, "image\/jpeg", 0\.94\)/);
  assert.match(page, /function characterSheetPrompt/);
  assert.match(page, /one large eye-level strict frontal head-and-shoulders portrait/);
  assert.match(page, /one head-to-toe front view in the exact \$\{look\} costume/);
  assert.match(page, /imageAspect: "16:9"/);
  assert.match(page, /Create one polished 16:9 production character reference/);
  assert.match(page, /missingCharacters = cast\.filter\(\(character\) => isVisualCharacterAsset\(character\) && !character\.imageUrl\)/);
  assert.doesNotMatch(page, /character\.sheetVersion !== 2/);
  assert.match(page, /sheetVersion: 2 as const/);
  assert.match(page, /人物本身不会产生走路、口型等新动作/);
  assert.match(page, /function drawMovingShot/);
  assert.match(horde, /width: aspect === "9:16" \? 448 : 704/);
  assert.match(horde, /height: aspect === "9:16" \? 704 : 384/);
});

test("ships a visual style library whose live-action presets stay photorealistic", async () => {
  const page = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const name of ["电影写实", "都市生活写实", "古装剧写实", "港风复古", "国漫电影感", "3D 动画", "黏土定格", "油画奇幻"]) assert.match(page, new RegExp(name));
  assert.match(page, /real Chinese actors/);
  assert.match(page, /not illustration, not anime, not comic, not 3D/);
  assert.match(page, /function characterVisualPrompt/);
  assert.match(page, /function frameVisualPrompt/);
  assert.match(page, /function motionVisualPrompt/);
  assert.doesNotMatch(page, /STYLE_PROMPTS\[style\].*premium animated film keyframe/);
  assert.match(styles, /\.style-library/);
  const preview = await stat(new URL("../public/styles/cinematic-photoreal.webp", import.meta.url));
  assert.ok(preview.size > 10_000);
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
  assert.match(page, /LibTV 制片画布/);
  assert.match(page, /sendLibTvInstruction/);
  assert.match(page, /syncScenesToEditor/);
  assert.match(libtv, /https:\/\/im\.liblib\.tv/);
  assert.match(libtv, /Authorization: `Bearer \$\{accessKey\}`/);
  assert.match(libtv, /openapi\/session\/change-project/);
  assert.match(libtv, /body\.action === "message"/);
  assert.match(libtv, /events/);
  assert.match(seedance, /contents\/generations\/tasks/);
  assert.match(seedance, /return_last_frame: false/);
  assert.match(page, /referenceMode: "omni"/);
  assert.match(seedance, /TRANSIENT_STATUSES/);
  assert.match(seedance, /为避免重复创建和扣费/);
  assert.match(seedance, /resolution, ratio, duration, watermark: false/);
  assert.match(page, /manjing-seedance-pending-v1/);
  assert.match(page, /继续查询，不重复创建和扣费/);
  assert.match(page, /无需安装火山引擎 SDK/);
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
  assert.match(editor, /aiEditAndExport/);
  assert.match(editor, /loadEditorProject/);
  assert.match(editor, /当前浏览器不支持本地视频导出/);
  assert.match(editor, /setSnapEnabled/);
  assert.match(editor, /setPreviewScale/);
  assert.match(editor, /正在逐个恢复剪辑素材/);
  assert.match(editor, /video-asset-placeholder/);
  assert.doesNotMatch(editor, /asset\.type === "video" \? <video src=\{asset\.url\}/);
  assert.match(editor, /function cancelEditorExport\(\)/);
  assert.match(editor, /已停止导出，时间线和素材均已保留/);
  assert.match(editor, /savingProjectRef\.current/);
});

test("keeps bulk motion-comic lists free of simultaneous video decoders", async () => {
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(studio, /video-thumbnail-placeholder/);
  assert.doesNotMatch(studio, /scene\.videoUrl \? <video src=\{scene\.videoUrl\}/);
  assert.doesNotMatch(studio, /item\.kind === "video" \? <video/);
  assert.match(styles, /\.video-thumbnail-placeholder/);
});

test("documents provider keys and keeps project search controls interactive", async () => {
  const keys = await readFile(new URL("../app/models/KeysClient.tsx", import.meta.url), "utf8");
  const projects = await readFile(new URL("../app/projects/ProjectsClient.tsx", import.meta.url), "utf8");
  assert.match(keys, /LIBTV_ACCESS_KEY/);
  assert.match(keys, /ARK_API_KEY/);
  assert.match(keys, /POLLINATIONS_KEY/);
  assert.match(keys, /VOLC_ACCESS_KEY \+ VOLC_SECRET_KEY/);
  assert.match(keys, /复制名称/);
  assert.match(keys, /addCustomModel/);
  assert.match(keys, /保存到我的模型库/);
  assert.match(projects, /series-overview/);
  assert.match(projects, /function createBlank/);
});

test("persists generated media across the studio and editor routes", async () => {
  const handoff = await readFile(new URL("../app/lib/editor-project.ts", import.meta.url), "utf8");
  const models = await readFile(new URL("../app/lib/custom-models.ts", import.meta.url), "utf8");
  assert.match(handoff, /indexedDB\.open/);
  assert.match(handoff, /manjing-editor-handoff/);
  assert.match(handoff, /persistEditorProject/);
  assert.match(handoff, /loadEditorProject/);
  assert.match(handoff, /PROJECT_STORE_NAME = "projects"/);
  assert.match(handoff, /listEditorProjects/);
  assert.match(handoff, /activateEditorProject/);
  assert.match(handoff, /MAX_PERSISTED_MEDIA_BYTES/);
  assert.match(handoff, /for \(const clip of project\.clips\)/);
  assert.match(handoff, /for \(const clip of stored\.clips\)/);
  assert.match(handoff, /const references = new Map<string, MediaReference>/);
  assert.match(handoff, /clip\.mediaId \? \{ mediaId: clip\.mediaId \}/);
  assert.match(handoff, /本机素材库正被另一个漫镜窗口占用/);
  assert.match(handoff, /removeUnreferencedMedia/);
  assert.doesNotMatch(handoff, /Promise\.all\(project\.clips/);
  assert.doesNotMatch(handoff, /Promise\.all\(stored\.clips/);
  assert.match(models, /manjing-custom-models/);
  assert.match(models, /saveCustomModels/);
  assert.match(models, /saveCustomModelsToDesktop/);
  assert.match(models, /removedId/);
  assert.match(models, /config\?\.preset === removedId/);
});

test("adds a director custom model inline without cross-page navigation", async () => {
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const customApi = await readFile(new URL("../app/lib/custom-api.ts", import.meta.url), "utf8");
  assert.match(studio, /function toggleQuickModel\(role: AgentRole\)/);
  assert.match(studio, /function saveQuickModel\(role: AgentRole\)/);
  assert.match(studio, /saveCustomModels\(next\)/);
  assert.match(studio, /提交、保存并应用到当前岗位/);
  assert.match(studio, /保存失败：本机模型库暂时不可写/);
  assert.match(studio, /测试连接并读取模型列表/);
  assert.match(customApi, /OpenAI（兼容文本 \/ 生图接口）/);
  assert.match(customApi, /Anthropic \/ Claude/);
  assert.match(customApi, /Google Gemini/);
  assert.match(customApi, /role === "image"\) return \["openai", "pollinations", "webhook"\]/);
  assert.match(studio, /customApiText/);
  assert.match(studio, /保存此岗位 API 并立即应用/);
  assert.match(studio, /const libraryId = existing\?\.id \|\| `custom-\$\{role\}-direct`/);
  assert.match(studio, /preset: `direct-\$\{role\}`/);
  assert.match(studio, /roleModelWriteRef\.current/);
  assert.match(studio, /同步到“我的模型”/);
  assert.match(studio, /async function deleteRoleCustomModel/);
  assert.match(studio, /删除自定义模型/);
  assert.match(studio, /editorSyncRef\.current/);
  assert.match(studio, /正在逐个整理素材/);
  assert.match(studio, /已停止视频合成，现有镜头和素材均已保留/);
  assert.doesNotMatch(studio, /const visuals = await Promise\.all\(movieScenes\.map\(loadVisual\)\)/);
  const keys = await readFile(new URL("../app/models/KeysClient.tsx", import.meta.url), "utf8");
  assert.match(keys, /saveCustomModelsToDesktop\(next, id\)/);
  assert.match(keys, /自动恢复默认模型/);
  assert.match(studio, /自定义 API 模式/);
  assert.doesNotMatch(studio, /className="add-custom-model-link" href=/);
});

test("keeps model deletion, settings writes, and desktop navigation non-blocking", async () => {
  const confirmation = await readFile(new URL("../app/components/ConfirmButton.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../app/components/SiteNav.tsx", import.meta.url), "utf8");
  const modelsPage = await readFile(new URL("../app/models/KeysClient.tsx", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const customModels = await readFile(new URL("../app/lib/custom-models.ts", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  const destructivePages = await Promise.all([
    "../app/models/KeysClient.tsx",
    "../app/studio-client.tsx",
    "../app/assets/AssetLibraryClient.tsx",
    "../app/projects/ProjectsClient.tsx",
    "../app/projects/detail/ProjectDetailClient.tsx",
    "../app/canvas/CanvasClient.tsx",
  ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));

  assert.match(confirmation, /window\.setTimeout\(\(\) => setArmed\(false\), 5000\)/);
  assert.match(confirmation, /aria-pressed=\{armed\}/);
  assert.match(modelsPage, /confirmLabel="确认删除"/);
  assert.match(studio, /confirmLabel="确认删除"/);
  destructivePages.forEach((source) => assert.doesNotMatch(source, /window\.confirm/));
  assert.match(navigation, /next\/link/);
  assert.match(navigation, /<Link prefetch=\{false\} key=\{item\.id\}/);
  assert.match(customModels, /controller\.abort\(\), timeoutMs/);
  assert.match(customModels, /操作已解除锁定/);
  assert.match(studio, /本机配置写入超过 6 秒，操作已解除锁定/);
  assert.match(runtime, /function localFileDeadline/);
  assert.match(runtime, /本机设置异常过大，已拒绝写入以避免界面卡死/);
  assert.match(studio, /doubao-seedance-2-0-260128/);
});

test("discovers provider models and invokes compatible text APIs through the desktop runtime", async () => {
  const runtimeSource = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  assert.match(runtimeSource, /const TEXT_ROLE_TIMEOUT_MS = \{/);
  assert.match(runtimeSource, /writer: 420000/);
  assert.match(runtimeSource, /已保留现有成果，请检查地址、网络或服务商队列后重新运行该岗位/);
  const { discoverRemoteModels, invokeTextModel } = require("../windows-app/desktop-runtime.js");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "writer-pro" }, { id: "director-fast" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"title\":\"测试剧本\"}" } }] }), { status: 200 });
  };
  const discovered = await discoverRemoteModels({ mode: "openai", endpoint: "https://api.example.com/v1/chat/completions", apiKey: "secret" }, fetchImpl);
  assert.deepEqual(discovered.models.map((item) => item.id), ["writer-pro", "director-fast"]);
  assert.equal(calls[0].url, "https://api.example.com/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");

  const invoked = await invokeTextModel({ mode: "openai", endpoint: "https://api.example.com/v1", apiKey: "secret", model: "writer-pro", system: "只返回 JSON", prompt: "写分镜" }, fetchImpl);
  assert.equal(invoked.text, "{\"title\":\"测试剧本\"}");
  assert.equal(calls[1].url, "https://api.example.com/v1/chat/completions");

  const retryCalls = [];
  const recovered = await invokeTextModel({ mode: "openai", endpoint: "https://relay.example.com/v1/responses", apiKey: "secret", model: "writer-pro", role: "writer", task: "storyboard", system: "只返回 JSON", prompt: "重新写分镜" }, async (url) => {
    retryCalls.push(String(url));
    if (retryCalls.length <= 2) return new Response(JSON.stringify({ error: { message: "upstream connection timeout" } }), { status: 500, headers: { "Retry-After": "0" } });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"title\":\"备用协议恢复\"}" } }] }), { status: 200 });
  });
  assert.equal(recovered.text, "{\"title\":\"备用协议恢复\"}");
  assert.deepEqual(retryCalls, [
    "https://relay.example.com/v1/responses",
    "https://relay.example.com/v1/responses",
    "https://relay.example.com/v1/chat/completions",
  ]);
});

test("explicit AI redraws use a fresh image seed instead of reproducing the same pixels", async () => {
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(studio, /variationSeed\?: number/);
  assert.match(studio, /options\.variationSeed \?\? Math\.abs\(story\.length \* 97 \+ index \* 7919\)/);
  assert.match(studio, /const redoRequested = Boolean\(character\.imageUrl\)/);
  assert.match(studio, /characterIdentitySeed\(characterIdentity\(character\)\)/);
  assert.match(studio, /const redoRequested = Boolean\(prop\.imageUrl\)/);
  assert.match(studio, /const redoRequested = Boolean\(sceneAsset\.imageUrl\)/);
  assert.match(studio, /REDO REQUEST: create a genuinely new sampled result/);
});

test("invokes OpenAI-compatible image APIs and saves desktop settings across restarts", async () => {
  const { invokeImageModel, readDesktopSettings, writeDesktopSettings } = require("../windows-app/desktop-runtime.js");
  const calls = [];
  const image = await invokeImageModel({ mode: "openai", endpoint: "https://api.example.com/v1", apiKey: "secret", model: "gpt-image-test", prompt: "雨夜里的女剑客", aspect: "9:16" }, async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), { status: 200 });
  });
  assert.equal(image.dataUrl, "data:image/png;base64,aW1hZ2U=");
  assert.equal(calls[0].url, "https://api.example.com/v1/images/generations");
  assert.equal(JSON.parse(calls[0].init.body).size, "1024x1536");

  let transientCalls = 0;
  await assert.rejects(() => invokeImageModel({ mode: "openai", endpoint: "https://api.example.com/v1", apiKey: "secret", model: "gpt-image-test", prompt: "不重复提交生图", aspect: "16:9" }, async () => {
    transientCalls += 1;
    return new Response(JSON.stringify({ error: { message: "upstream connection termination" } }), { status: 503, headers: { "Retry-After": "0" } });
  }), /接口返回 503/);
  assert.equal(transientCalls, 1);

  let exhaustedCalls = 0;
  await assert.rejects(() => invokeImageModel({ mode: "openai", endpoint: "https://api.example.com/v1", apiKey: "secret", model: "gpt-image-test", prompt: "持续断线", aspect: "9:16" }, async () => {
    exhaustedCalls += 1;
    return new Response(JSON.stringify({ error: { message: "upstream connection termination" } }), { status: 503, headers: { "Retry-After": "0" } });
  }), /接口返回 503/);
  assert.equal(exhaustedCalls, 1);

  let authenticationCalls = 0;
  await assert.rejects(() => invokeImageModel({ mode: "openai", endpoint: "https://api.example.com/v1", apiKey: "bad", model: "gpt-image-test", prompt: "鉴权错误", aspect: "9:16" }, async () => {
    authenticationCalls += 1;
    return new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
  }), /接口返回 401/);
  assert.equal(authenticationCalls, 1);

  const directory = await mkdtemp(join(tmpdir(), "manjing-settings-test-"));
  try {
    await writeDesktopSettings(directory, { agentConfigs: { editor: { adapter: "openai", model: "gpt-editor" } } });
    await writeDesktopSettings(directory, { customModels: [{ id: "saved-model" }] });
    const saved = await readDesktopSettings(directory);
    assert.equal(saved.agentConfigs.editor.model, "gpt-editor");
    assert.equal(saved.customModels[0].id, "saved-model");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("lets the configured GPT or compatible editor AI control the local timeline", async () => {
  const editor = await readFile(new URL("../app/editor/EditorClient.tsx", import.meta.url), "utf8");
  assert.match(editor, /fetch\("\/api\/desktop\/settings"/);
  assert.match(editor, /fetch\("\/api\/desktop\/invoke"/);
  assert.match(editor, /\["openai", "anthropic", "gemini", "pollinations", "webhook"\]/);
  assert.match(editor, /GPT \/ AI 剪辑并出片/);
  assert.match(editor, /order\?\: string\[\]/);
  assert.match(editor, /commit\(edited\)/);
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

test("retries interrupted Seedance status checks and sends current official task fields", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  try {
    let statusCalls = 0;
    globalThis.fetch = async () => {
      statusCalls += 1;
      if (statusCalls < 3) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ status: "succeeded", content: { video_url: "https://example.volces.com/result.mp4" } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const statusResponse = await worker.fetch(new Request("http://localhost/api/seedance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "status", apiKey: "test-seedance-key", id: "cgt-abcdefgh" }),
    }), env, ctx);
    assert.equal(statusResponse.status, 200);
    assert.equal(statusCalls, 3);
    assert.equal((await statusResponse.json()).done, true);

    let createBody = null;
    globalThis.fetch = async (_url, init) => {
      createBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ id: "cgt-created1" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const createResponse = await worker.fetch(new Request("http://localhost/api/seedance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", requestId: "request-1234", apiKey: "test-seedance-key", model: "doubao-seedance-1-5-pro-251215", prompt: "让人物在雨夜自然走向镜头", ratio: "9:16", duration: 8, resolution: "720p" }),
    }), env, ctx);
    assert.equal(createResponse.status, 202);
    assert.equal(createBody.model, "doubao-seedance-1-5-pro-251215");
    assert.equal(createBody.ratio, "9:16");
    assert.equal(createBody.duration, 10);
    assert.equal(createBody.resolution, "720p");
    assert.equal(createBody.generate_audio, true);
    assert.equal(createBody.watermark, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the buffered desktop Seedance channel for resume queries and interrupted downloads", async () => {
  const runtimeSource = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const video = await readFile(new URL("../app/video/VideoClient.tsx", import.meta.url), "utf8");
  assert.match(runtimeSource, /\/api\/desktop\/seedance/);
  assert.match(runtimeSource, /Buffer\.from\(await response\.arrayBuffer\(\)\)/);
  assert.match(runtimeSource, /任务编号仍已保留，请稍后重新运行视频 AI 继续下载/);
  assert.match(studio, /path\.replace\("\/api\/seedance", "\/api\/desktop\/seedance"\)/);
  assert.match(studio, /任务编号仍已保留，请重新运行视频 AI 继续下载/);
  assert.match(video, /pollSeedance/);

  const { invokeSeedance, downloadSeedanceMedia } = require("../windows-app/desktop-runtime.js");
  let statusUrl = "";
  const status = await invokeSeedance({ action: "status", apiKey: "test-seedance-key", id: "cgt-abcdefgh" }, async (url) => {
    statusUrl = String(url);
    return new Response(JSON.stringify({ status: "succeeded", content: { video_url: "https://media.volces.com/final.mp4" } }), { status: 200 });
  });
  assert.match(statusUrl, /contents\/generations\/tasks\/cgt-abcdefgh$/);
  assert.equal(status.done, true);
  assert.equal(status.videoUrl, "https://media.volces.com/final.mp4");

  let downloadCalls = 0;
  const media = await downloadSeedanceMedia("https://media.volces.com/final.mp4", async () => {
    downloadCalls += 1;
    if (downloadCalls === 1) {
      return { ok: true, status: 200, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: async () => { throw new TypeError("terminated"); } };
    }
    return new Response(Uint8Array.from([0, 1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
  });
  assert.equal(downloadCalls, 2);
  assert.equal(media.contentType, "video/mp4");
  assert.deepEqual([...media.bytes], [0, 1, 2, 3]);
  await assert.rejects(() => downloadSeedanceMedia("https://example.com/video.mp4", async () => new Response()), /来源不受信任/);
});

test("ships a downloadable local bridge with unified media endpoints", async () => {
  const bridge = await readFile(new URL("../tools/manjing-local-bridge/app.py", import.meta.url), "utf8");
  assert.match(bridge, /@app\.post\("\/v1\/image"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/video"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/audio"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/lipsync"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/vibevoice\/audio"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/moneyprinter\/materials"\)/);
  assert.match(bridge, /@app\.post\("\/v1\/moneyprinter\/videos"\)/);
  assert.match(bridge, /@app\.get\("\/v1\/moneyprinter\/tasks\/\{task_id\}\/result"\)/);
  const archive = await stat(new URL("../public/manjing-local-bridge.zip", import.meta.url));
  assert.ok(archive.size > 1000);
});

test("lets the editor send its real timeline to MoneyPrinterTurbo and restore the result", async () => {
  const editor = await readFile(new URL("../app/editor/EditorClient.tsx", import.meta.url), "utf8");
  assert.match(editor, /moneyPrinterAutoEdit/);
  assert.match(editor, /\/v1\/moneyprinter\/materials/);
  assert.match(editor, /\/v1\/moneyprinter\/videos/);
  assert.match(editor, /MoneyPrinterTurbo 正在剪辑、配音和压制/);
  assert.match(editor, /persistEditorProject/);
  assert.match(editor, /MPT 开源自动成片/);
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

test("ships an independent free-video page with explicit multimodal @ references", async () => {
  const video = await readFile(new URL("../app/video/VideoClient.tsx", import.meta.url), "utf8");
  const seedance = await readFile(new URL("../app/api/seedance/route.ts", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  assert.match(video, /accept="image\/\*,video\/\*,audio\/\*"/);
  assert.match(video, /可插入引用标记/);
  assert.match(video, /引用该素材/);
  assert.match(video, /const mention =/);
  assert.match(video, /const enabled = referenceItems\.filter/);
  assert.match(video, /createSeedanceTask/);
  assert.match(video, /generatePollinations/);
  assert.match(video, /generateWebhook/);
  assert.match(video, /aria-label="生成视频配音"/);
  assert.match(video, /enabled: voiceEnabled/);
  assert.match(video, /function buildPrompt/);
  assert.match(video, /voiceover: \{/);
  assert.match(video, /voiceLanguage, voiceStyle, voiceScript/);
  assert.match(video, /导入剪辑台/);
  assert.match(video, /source: "video"/);
  assert.match(seedance, /reference_image/);
  assert.match(seedance, /reference_video/);
  assert.match(seedance, /reference_audio/);
  assert.match(seedance, /generate_audio: audioEnabled/);
  assert.match(seedance, /counts = \{ image: 0, video: 0, audio: 0 \}/);
  assert.match(runtime, /invokeVideoModel/);
  assert.match(runtime, /\/api\/desktop\/video/);
  assert.match(runtime, /voiceover/);
});

test("keeps modules on independent routes and restores project state without eager media decoding", async () => {
  const nav = await readFile(new URL("../app/components/SiteNav.tsx", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const projects = await readFile(new URL("../app/projects/ProjectsClient.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/projects/detail/ProjectDetailClient.tsx", import.meta.url), "utf8");
  const handoff = await readFile(new URL("../app/lib/editor-project.ts", import.meta.url), "utf8");
  assert.match(nav, /href: "\/video"/);
  assert.match(nav, /href: "\/canvas"/);
  assert.match(studio, /manjing-studio-session-v2/);
  assert.match(studio, /loadEditorProjectById/);
  assert.match(studio, /studioSnapshot/);
  assert.match(projects, /打开项目/);
  assert.match(projects, /activateSeriesEpisode/);
  assert.match(projects, /startEpisode/);
  assert.match(detail, /getEditorProjectMetadataById/);
  assert.doesNotMatch(detail, /<video/);
  assert.match(handoff, /manjing-editor-active-project/);
  assert.match(handoff, /getEditorProjectMetadataById/);
});

test("ships a persistent interactive production canvas that never requires a cloud key", async () => {
  const canvas = await readFile(new URL("../app/canvas/CanvasClient.tsx", import.meta.url), "utf8");
  const storage = await readFile(new URL("../app/lib/production-canvas.ts", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(canvas, /＋ 新建画布/);
  assert.match(canvas, /onPointerDown/);
  assert.match(canvas, /连接节点/);
  assert.match(canvas, /从当前项目导入/);
  assert.match(canvas, /导出画布 JSON/);
  assert.match(canvas, /saveProductionCanvases/);
  assert.match(canvas, /getEditorProjectMetadataById/);
  assert.match(storage, /manjing-production-canvases-v1/);
  assert.match(storage, /createCanvasFromStudio/);
  assert.match(studio, /createCanvasFromStudio/);
  assert.match(studio, /新建本机制片画布/);
  assert.doesNotMatch(studio.match(/function createLibTvCanvas\(\)[\s\S]*?\n  }/)?.[0] || "", /accessKey|fetch\(/);
});

test("imports existing production materials, skips completed stages, and persists reusable assets", async () => {
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const library = await readFile(new URL("../app/lib/asset-library.ts", import.meta.url), "utf8");
  const editorStorage = await readFile(new URL("../app/lib/editor-project.ts", import.meta.url), "utf8");
  const assetPage = await readFile(new URL("../app/assets/AssetLibraryClient.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../app/components/SiteNav.tsx", import.meta.url), "utf8");

  assert.match(navigation, /href: "\/assets"/);
  assert.match(studio, /function importScriptFile/);
  assert.match(studio, /function importStoryboardFile/);
  assert.match(studio, /function importProductionAssets/);
  assert.match(studio, /const hasLockedStoryboard = scenes\.length > 0/);
  assert.match(studio, /if \(character\.imageUrl\)/);
  assert.match(studio, /if \(scene\.imageUrl \|\| scene\.videoUrl\)/);
  assert.match(studio, /if \(scene\.videoUrl\)/);
  assert.match(studio, /if \(scene\.audioUrl \|\| !scene\.dialogue\.trim\(\)\)/);
  assert.match(studio, /manjing-studio-library-import/);
  assert.match(assetPage, /saveLibraryFile/);
  assert.match(assetPage, /loadLibraryAssets/);
  assert.match(library, /const DATABASE_VERSION = 3/);
  assert.match(editorStorage, /indexedDB\.open\(DATABASE_NAME, 3\)/);
  assert.match(library, /const ASSET_STORE_NAME = "library-assets"/);
  assert.match(library, /export async function saveLibraryFile/);
  assert.match(library, /export async function listLibraryAssets/);
  assert.match(library, /export async function deleteLibraryAsset/);
});

test("bundles the official Volcengine SDK while keeping Seedance on Ark API-key transport", async () => {
  const runtimeSource = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../windows-app/main.js", import.meta.url), "utf8");
  const desktopPackage = JSON.parse(await readFile(new URL("../windows-app/package.json", import.meta.url), "utf8"));
  const { volcengineSdkStatus } = require("../windows-app/desktop-runtime.js");
  const status = volcengineSdkStatus();

  assert.equal(desktopPackage.dependencies["@volcengine/openapi"], "1.36.2");
  assert.equal(status.installed, true);
  assert.equal(status.version, "1.36.2");
  assert.equal(status.signerReady, true);
  assert.equal(status.seedanceTransport, "Ark API Key");
  assert.match(runtimeSource, /\/api\/desktop\/volcengine-sdk/);
  assert.match(main, /火山引擎 SDK 内置自检失败/);
});

test("Windows app directly loads the bundled app without an iframe or local web server", async () => {
  const main = await readFile(new URL("../windows-app/main.js", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  const desktopPackage = JSON.parse(await readFile(new URL("../windows-app/package.json", import.meta.url), "utf8"));

  assert.match(main, /const APP_URL = "manjing:\/\/app\/"/);
  assert.match(main, /--smoke-editor-handoff/);
  assert.match(main, /--smoke-canvas/);
  assert.match(main, /--smoke-project-workflow/);
  assert.match(main, /--smoke-video-audio/);
  assert.match(main, /--smoke-studio-voice/);
  assert.match(main, /MANJING_EDITOR_HANDOFF_OK/);
  assert.match(main, /MANJING_CANVAS_OK/);
  assert.match(main, /MANJING_PROJECT_WORKFLOW_OK/);
  assert.match(main, /MANJING_VIDEO_AUDIO_OK/);
  assert.match(main, /MANJING_STUDIO_VOICE_OK/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /生图创建请求单次提交保护自检失败/);
  assert.match(main, /attempts !== 1/);
  assert.match(main, /protocol\.handle\(APP_SCHEME, runtime\.handle\)/);
  assert.match(main, /mainWindow\.loadURL\(initialUrl\)/);
  assert.doesNotMatch(main, /loadFile\(|shell\.html|iframe|127\.0\.0\.1|chatgpt\.site/);
  assert.doesNotMatch(runtime, /createServer|server\.listen|chatgpt\.site/);
  assert.equal(desktopPackage.version, "1.5.2");
  assert.match(main, /dataRoot: app\.getPath\("userData"\)/);
  assert.match(runtime, /manjing-settings\.json/);
  assert.match(runtime, /\/api\/desktop\/settings/);
  assert.match(runtime, /\/api\/desktop\/image/);
  assert.match(runtime, /\/api\/desktop\/seedance/);
  assert.match(runtime, /TRANSIENT_PROVIDER_STATUSES/);
  assert.match(runtime, /maxAttempts: 3/);
  assert.match(runtime, /invokeImageModel[\s\S]*maxAttempts: 1/);
  assert.deepEqual(desktopPackage.build.files, [
    "main.js",
    "preload.js",
    "desktop-runtime.js",
    "enterprise-assets.js",
    "build/icon.svg",
    "build/icon.png",
    "package.json",
  ]);
  assert.equal(desktopPackage.build.extraResources[0].to, "desktop-app");
});
