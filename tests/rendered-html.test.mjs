import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the Simplified Chinese motion-comic studio", async () => {
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>漫镜 · 多 AI 协作生成漫剧<\/title>/);
  assert.match(html, /一键生成 AI 漫剧/);
  assert.match(html, /免费多 AI 流程/);
  assert.match(html, /推荐 AI 制片组/);
  assert.match(html, /AI 制片组/);
  assert.match(html, /六个岗位，各自调用自己的模型/);
  assert.match(html, /导演 AI/);
  assert.match(html, /编剧与分镜 AI/);
  assert.match(html, /生图 AI/);
  assert.match(html, /视频 AI/);
  assert.match(html, /配音 AI/);
  assert.match(html, /剪辑 AI/);
  assert.match(html, /min="0" max="120"/);
  assert.match(html, /角色资产锁定/);
  assert.match(html, /分镜级动态表演/);
  assert.match(html, /自动剪辑成片/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/);
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
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /maxAttempts:\s*6/);
  assert.match(source, /超过 18 秒将自动采用编剧初稿/);
  assert.match(source, /if \(runRef\.current !== run\) throw new Error\("任务已取消"\)/);
});

test("completes truncated free storyboards instead of aborting production", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /parseStoryboard\(raw, productionDuration, 1\)/);
  assert.match(source, /completeFreeStoryboard\(partial, story\.trim\(\), style, productionDuration\)/);
  assert.match(source, /免费编剧输出不完整，漫镜正在自动补全分镜/);
});

test("ships a user-editable multitrack workbench and downloadable deliverables", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const horde = await readFile(new URL("../app/api/horde/route.ts", import.meta.url), "utf8");
  assert.match(page, /layered foreground middle ground and background for 2\.5D motion/);
  assert.match(page, /人物本身不会产生走路、口型等新动作/);
  assert.match(page, /function drawMovingShot/);
  assert.match(horde, /width: aspect === "9:16" \? 448 : 704/);
  assert.match(horde, /height: aspect === "9:16" \? 704 : 384/);
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
