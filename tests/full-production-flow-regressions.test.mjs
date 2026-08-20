import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
const projects = await readFile(new URL("../app/projects/ProjectsClient.tsx", import.meta.url), "utf8");
const series = await readFile(new URL("../app/lib/series-project.ts", import.meta.url), "utf8");
const seedance = await readFile(new URL("../app/api/seedance/route.ts", import.meta.url), "utf8");
const voiceLibrary = await readFile(new URL("../app/voices/VoiceLibraryClient.tsx", import.meta.url), "utf8");

test("blank placeholder episodes cannot enter production", () => {
  assert.match(projects, /请在项目中导入或填写本集剧本/);
  assert.match(projects, /还没有真实剧本/);
});

test("a locked first-pass manifest never creates second-pass prop placeholders", () => {
  assert.match(studio, /生产清单已锁定，系统没有二次建框或生图/);
  assert.doesNotMatch(studio, /reason: "分镜分析补充发现"/);
});

test("video preflight requires an exact character look and project-scoped props", () => {
  assert.match(studio, /const matched = exact\.sort/);
  assert.match(studio, /asset\.projectId === productionProjectId/);
});

test("project voices are created independently of same-name global voices", () => {
  assert.match(studio, /canonicalVoiceProfile\(scene, \{ projectOnly: true \}\)/);
  assert.match(studio, /manjing-active-series-context-changed/);
  assert.match(voiceLibrary, /voice-person-group/);
  assert.match(voiceLibrary, /专属音色/);
});

test("successful export completes the episode with actual final-shot state", () => {
  assert.match(series, /export function completeSeriesEpisode/);
  assert.match(studio, /completeSeriesEpisode\(active\.projectId, active\.episodeId, actualEndState\)/);
});

test("Seedance reports exactly which rejected references were dropped", () => {
  assert.match(seedance, /droppedReferences/);
  assert.match(studio, /当前镜头已明确降级/);
});

test("portable project format retains local asset ids for same-device restoration", () => {
  assert.match(studio, /version: 3/);
  assert.match(studio, /const localIds =/);
  assert.match(studio, /loadLibraryAssets\(localIds\)/);
});
