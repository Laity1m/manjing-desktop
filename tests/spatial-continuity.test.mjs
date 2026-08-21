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

test("projects a draggable 2.5D stage and camera into deterministic screen anchors", async () => {
  const { defaultStageLayout, projectStageLayout } = await loadSpatialModule();
  const layout = defaultStageLayout(["甲", "乙"]);
  const before = projectStageLayout(layout);
  layout.actors["甲"].x += 0.08;
  const after = projectStageLayout(layout);
  assert.notEqual(after["甲"].x, before["甲"].x);
  assert.equal(after["乙"].x, before["乙"].x);
  assert.ok(after["甲"].bounds.xMin < after["甲"].bounds.xMax);
  assert.equal(layout.frozen, true);
  assert.equal(layout.enabled, false);
  assert.equal(layout.confirmed, false);
});

test("does not mistake ordinary props for fixed stage anchors", async () => {
  const { assignSpatialLayouts, spatialLayoutSummary } = await loadSpatialModule();
  const scenes = assignSpatialLayouts([
    { environmentKey: "study", characters: ["苏梨"], visual: "苏梨站在书桌旁 [道具:书桌,官印]" },
    { environmentKey: "study", characters: ["苏梨"], visual: "苏梨继续说话" },
  ]);
  assert.deepEqual(scenes[0].stageLayout.objects, {});
  assert.deepEqual(scenes[1].stageLayout.objects, {});
  assert.equal(spatialLayoutSummary(scenes[0]), "");
});

test("removes legacy auto-placed prop coordinates without activating draft positions", async () => {
  const { assignSpatialLayouts, defaultStageLayout, spatialLayoutSummary } = await loadSpatialModule();
  const legacy = defaultStageLayout(["苏梨"]);
  delete legacy.version;
  legacy.enabled = true;
  legacy.confirmed = undefined;
  legacy.objects = { "洗得发白的官服": { x: 0.5, y: 0.3, facing: 180, size: 1 } };
  const [scene] = assignSpatialLayouts([{ environmentKey: "room", characters: ["苏梨"], visual: "苏梨在房内", stageLayout: legacy }]);
  assert.deepEqual(scene.stageLayout.objects, {});
  assert.equal(scene.stageLayout.confirmed, undefined);
  assert.equal(spatialLayoutSummary(scene), "");
});

test("only a confirmed fixed-fixture layout is injected and inherited", async () => {
  const { assignSpatialLayouts, defaultStageLayout, projectStageObjects, spatialLayoutSummary } = await loadSpatialModule();
  const layout = defaultStageLayout(["苏梨"]);
  layout.enabled = true;
  layout.confirmed = true;
  layout.objects["固定书桌"] = { x: 0.24, y: 0.36, facing: 180, size: 1 };
  const scenes = assignSpatialLayouts([
    { environmentKey: "study", characters: ["苏梨"], visual: "苏梨站在书桌旁 [固定物体:固定书桌]", stageLayout: layout },
    { environmentKey: "study", characters: ["苏梨"], visual: "苏梨继续说话" },
  ]);
  assert.deepEqual(scenes[1].stageLayout.objects, scenes[0].stageLayout.objects);
  assert.match(spatialLayoutSummary(scenes[0]), /USER-CONFIRMED/);
  const before = projectStageObjects(scenes[0].stageLayout)["固定书桌"].x;
  scenes[0].stageLayout.objects["固定书桌"].x += 0.1;
  assert.notEqual(projectStageObjects(scenes[0].stageLayout)["固定书桌"].x, before);
});
