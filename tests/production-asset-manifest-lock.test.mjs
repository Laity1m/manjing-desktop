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
