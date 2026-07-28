import assert from "node:assert/strict";
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
  assert.match(html, /<title>漫镜 · AI 一键生成漫剧<\/title>/);
  assert.match(html, /一键生成 AI 漫剧/);
  assert.match(html, /免费社区模式/);
  assert.match(html, /动态镜头生成/);
  assert.match(html, /自动剪辑成片/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/);
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
