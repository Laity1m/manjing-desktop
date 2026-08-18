import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

async function loadFlowModule() {
  const source = await readFile(new URL("../app/lib/sequential-video-flow.ts", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
}

test("approved first shot advances to the first genuinely missing shot", async () => {
  const { planSequentialVideo } = await loadFlowModule();
  assert.deepEqual(planSequentialVideo([
    { id: "shot-1", videoUrl: "asset://approved-1", videoReviewDecision: "approved", status: "ready" },
    { id: "shot-2", status: "queued" },
    { id: "shot-3", status: "queued" },
  ]), { kind: "generate", index: 1, sceneId: "shot-2" });
});

test("pending candidate blocks duplicate paid generation", async () => {
  const { planSequentialVideo } = await loadFlowModule();
  assert.deepEqual(planSequentialVideo([
    { id: "shot-1", candidateVideoUrl: "asset://candidate-1", videoReviewDecision: "pending" },
    { id: "shot-2" },
  ]), { kind: "review", index: 0, sceneId: "shot-1" });
});

test("all approved or imported shots complete the sequential video stage", async () => {
  const { planSequentialVideo } = await loadFlowModule();
  assert.deepEqual(planSequentialVideo([
    { id: "shot-1", videoUrl: "asset://approved-1", videoReviewDecision: "approved" },
    { id: "shot-2", videoUrl: "asset://imported-2", videoReviewDecision: "approved" },
  ]), { kind: "complete", index: -1, sceneId: "" });
});

test("approval uses cached QA frames and resumes video role instead of rebuilding the whole pipeline", async () => {
  const source = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(source, /scene\.videoStartFrameUrl \|\| ""/);
  assert.match(source, /质检缩略图补取失败但不再阻塞下一镜/);
  assert.match(source, /if \(nextPlan\.kind === "generate"\) void rerunRole\("video"\)/);
  assert.match(source, /planSequentialVideo\(work\)/);
  assert.match(source, /继续生成第 \{sequentialVideoPlan\.index \+ 1\} 镜/);
});
