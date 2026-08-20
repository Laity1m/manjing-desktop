import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function transpiledUrl(path, replacements = []) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

async function loadModule() {
  const seriesUrl = await transpiledUrl("../app/lib/series-project.ts");
  const reuseUrl = await transpiledUrl("../app/lib/asset-reuse.ts");
  const manifestUrl = await transpiledUrl("../app/lib/script-asset-manifest.ts", [['from "./series-project"', `from "${seriesUrl}"`]]);
  const moduleUrl = await transpiledUrl("../app/lib/production-asset-manifest-lock.ts", [
    ['from "./asset-reuse"', `from "${reuseUrl}"`],
    ['from "./script-asset-manifest"', `from "${manifestUrl}"`],
    ['from "./series-project"', `from "${seriesUrl}"`],
  ]);
  return import(moduleUrl);
}

test("formal production reuses the approved visible look instead of creating scene aliases", async () => {
  const { lockStoryboardToAssetManifest } = await loadModule();
  const approved = [{ name: "苏梨", identityName: "苏梨", lookName: "居家版", appearance: "淡棕粉色家常衫和深灰长裙" }];
  const result = lockStoryboardToAssetManifest(
    [{ name: "苏梨", identityName: "苏梨", lookName: "破院居家版", appearance: "同一套家常衫" }],
    [{ title: "夜归破院", visual: "苏梨回到破院", action: "推门", characters: ["苏梨"], speaker: "苏梨", characterLooks: { 苏梨: "夜间居家版" } }],
    approved,
  );
  assert.deepEqual(result.blocked, []);
  assert.equal(result.characters[0].lookName, "居家版");
  assert.equal(result.scenes[0].characterLooks.苏梨, "居家版");
});

test("formal production blocks people outside the approved full-script manifest", async () => {
  const { lockStoryboardToAssetManifest } = await loadModule();
  const result = lockStoryboardToAssetManifest(
    [{ name: "神秘新角色", identityName: "神秘新角色", lookName: "基础版" }],
    [{ title: "错误镜头", characters: ["神秘新角色"], characterLooks: { 神秘新角色: "基础版" } }],
    [{ name: "苏梨", identityName: "苏梨", lookName: "居家版" }],
  );
  assert.deepEqual(result.blocked, ["神秘新角色"]);
  assert.equal(result.characters.length, 0);
});

test("scene-only cast cannot bypass the approved manifest lock", async () => {
  const { lockStoryboardToAssetManifest } = await loadModule();
  const result = lockStoryboardToAssetManifest(
    [],
    [{ title: "错误镜头", characters: ["临时群演"], characterLooks: { 临时群演: "夜间版" } }],
    [{ name: "苏梨", identityName: "苏梨", lookName: "居家版" }],
  );
  assert.deepEqual(result.blocked, ["临时群演"]);
  assert.deepEqual(result.scenes[0].characters, []);
});

test("generic extras remain staging directions and never block or become canonical people", async () => {
  const { lockStoryboardToAssetManifest } = await loadModule();
  const result = lockStoryboardToAssetManifest(
    [
      { name: "苏梨", identityName: "苏梨", lookName: "居家版" },
      { name: "群演甲", identityName: "群演甲", lookName: "基础版" },
    ],
    [{ title: "官署大厅", characters: ["苏梨", "群演甲", "路人A"], speaker: "苏梨", characterLooks: { 苏梨: "居家版", 群演甲: "基础版", 路人A: "基础版" } }],
    [{ name: "苏梨", identityName: "苏梨", lookName: "居家版" }],
  );
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.characters.map((item) => item.name), ["苏梨"]);
  assert.deepEqual(result.scenes[0].characters, ["苏梨"]);
  assert.deepEqual(result.scenes[0].characterLooks, { 苏梨: "居家版" });
});

test("storyboard beats bind to approved environments and never become new scene assets", async () => {
  const { lockStoryboardScenesToAssetManifest } = await loadModule();
  const approved = [{ name: "户部公廨大厅", environmentKey: "户部公廨大厅", description: "正面公廨大门，东西两列书案", sceneHints: ["查账"] }];
  const result = lockStoryboardScenesToAssetManifest([
    { title: "异样开场", visual: "建立故事空间", action: "苏梨进入", environmentKey: "异样开场" },
    { title: "线索逼近", visual: "苏梨在户部公廨大厅查账", action: "翻开账册" },
  ], approved);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.scenes.map((item) => item.environmentKey), ["户部公廨大厅", "户部公廨大厅"]);
  assert.match(result.scenes[0].environmentBible, /东西两列书案/);
});

test("unknown storyboard environments stop production without mutating the manifest", async () => {
  const { lockStoryboardScenesToAssetManifest } = await loadModule();
  const approved = [
    { name: "户部公廨大厅", environmentKey: "户部公廨大厅" },
    { name: "苏梨破院", environmentKey: "苏梨破院" },
  ];
  const result = lockStoryboardScenesToAssetManifest([{ title: "换景", visual: "陌生码头", environmentKey: "海港码头" }], approved);
  assert.deepEqual(result.blocked, ["海港码头"]);
  assert.equal(result.scenes[0].environmentKey, "海港码头");
  assert.equal(approved.length, 2);
});
