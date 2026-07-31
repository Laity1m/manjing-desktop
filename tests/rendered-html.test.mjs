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
