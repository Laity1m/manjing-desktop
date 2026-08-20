import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadSpatialModule() {
  const source = await readFile(new URL("../app/lib/spatial-continuity.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "spatial-continuity.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("inherits the first established screen position instead of re-centering a lone character", async () => {
  const { assignSpatialLayouts } = await loadSpatialModule();
  const scenes = assignSpatialLayouts([
    { environmentKey: "hall", characters: ["苏梨", "萧玦"], visual: "二人在厅中对话" },
    { environmentKey: "hall", characters: ["苏梨"], visual: "苏梨继续说话" },
  ]);
  assert.equal(scenes[0].spatialLayout["苏梨"].x, 0.32);
  assert.equal(scenes[1].spatialLayout["苏梨"].x, 0.32);
  assert.equal(scenes[1].spatialLayout["苏梨"].y, scenes[0].spatialLayout["苏梨"].y);
  assert.equal(scenes[1].spatialLayout["苏梨"].scale, scenes[0].spatialLayout["苏梨"].scale);
  assert.ok(scenes[1].spatialLayout["苏梨"].bounds.xMin < scenes[1].spatialLayout["苏梨"].bounds.xMax);
  assert.equal(scenes[1].spatialLayout["苏梨"].source, "inherited");
});

test("keeps stable left-right lanes when cast membership changes", async () => {
  const { assignSpatialLayouts } = await loadSpatialModule();
  const scenes = assignSpatialLayouts([
    { environmentKey: "courtyard", characters: ["甲", "乙"], visual: "甲和乙站定" },
    { environmentKey: "courtyard", characters: ["乙", "丙"], visual: "丙进入，乙留在原地" },
    { environmentKey: "courtyard", characters: ["甲", "乙", "丙"], visual: "三人对峙" },
  ]);
  assert.equal(scenes[2].spatialLayout["甲"].x, scenes[0].spatialLayout["甲"].x);
  assert.equal(scenes[2].spatialLayout["乙"].x, scenes[0].spatialLayout["乙"].x);
  assert.equal(scenes[2].spatialLayout["丙"].x, scenes[1].spatialLayout["丙"].x);
});

test("honors explicit script positions and detects a user position-lock revision", async () => {
  const { assignSpatialLayouts, positionLockRequested } = await loadSpatialModule();
  const [scene] = assignSpatialLayouts([{ environmentKey: "room", characters: ["苏梨"], visual: "苏梨站在画面右侧前景", videoRevisionRequest: "人物位置一直在变动，请按照分镜一的位置保持不变" }]);
  assert.equal(scene.spatialLayout["苏梨"].x, 0.72);
  assert.equal(scene.spatialLayout["苏梨"].depth, "foreground");
  assert.equal(positionLockRequested(scene), true);
});

test("does not carry a location-specific spatial map into another environment", async () => {
  const { assignSpatialLayouts } = await loadSpatialModule();
  const scenes = assignSpatialLayouts([
    { environmentKey: "hall", characters: ["苏梨", "萧玦"], visual: "厅中" },
    { environmentKey: "garden", characters: ["苏梨"], visual: "花园中" },
  ]);
  assert.equal(scenes[0].spatialLayout["苏梨"].x, 0.32);
  assert.equal(scenes[1].spatialLayout["苏梨"].x, 0.5);
});
