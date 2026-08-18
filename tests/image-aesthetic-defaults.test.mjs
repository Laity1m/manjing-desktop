import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const presets = await readFile(new URL("../app/agent-system/preset-skills.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../app/agent-system/learning-store.ts", import.meta.url), "utf8");
const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");

test("seeds editable image-agent art direction and quality-gate skills for existing users", () => {
  assert.match(presets, /id: "image-aesthetic-art-direction"/);
  assert.match(presets, /id: "image-character-casting-beauty"/);
  assert.match(presets, /id: "image-reference-identity-lock"/);
  assert.match(presets, /id: "image-human-preference-quality-gate"/);
  assert.match(store, /manjing-agent-preset-skills-v5/);
  assert.match(presets, /左侧35%-40%/);
  assert.match(presets, /正面全身、45°侧面全身、背面全身/);
  assert.match(presets, /每4镜重新挂载/);
});

test("uses the concise editable defaults instead of appending the legacy full face skill", () => {
  assert.match(studio, /configuredImageSkillPrompt\("character"\)/);
  assert.match(studio, /configuredImageSkillPrompt\("frame"\)/);
  assert.doesNotMatch(studio, /Enabled Image Agent Skill/);
  assert.doesNotMatch(studio, /const faceSkill = agentContext\("image"\)/);
});

test("adds an explicit aesthetic dimension to visual review and blocks low-aesthetic auto pass", () => {
  assert.match(studio, /aestheticQuality 必须始终评分/);
  assert.match(studio, /"aestheticQuality":0/);
  assert.match(studio, /score\("aestheticQuality"\)/);
});
