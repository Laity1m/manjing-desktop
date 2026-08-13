import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadNamingModule() {
  const source = await readFile(new URL("../app/lib/character-asset-naming.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "character-asset-naming.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("uses the character name alone for a base look", async () => {
  const { characterAssetNaming } = await loadNamingModule();
  assert.deepEqual(characterAssetNaming({ name: "林辰", appearance: "黑色短发，神情沉稳" }), {
    identityKey: "林辰",
    lookName: "基础版",
    variantName: "基础版",
    displayName: "林辰",
  });
});

test("adds clothing and state variants to the character name", async () => {
  const { characterAssetNaming } = await loadNamingModule();
  assert.equal(characterAssetNaming({ name: "林辰", appearance: "穿剪裁利落的深色西装" }).displayName, "林辰西装版");
  assert.equal(characterAssetNaming({ name: "林辰", appearance: "胡茬明显，神情颓废" }).displayName, "林辰颓废版");
  assert.equal(characterAssetNaming({ name: "林辰", appearance: "运动服与跑鞋" }).displayName, "林辰运动版");
  assert.equal(characterAssetNaming({ name: "林辰", appearance: "西装，面容憔悴而颓废" }).displayName, "林辰西装颓废版");
});

test("explicit outfit and state labels take priority", async () => {
  const { characterAssetNaming } = await loadNamingModule();
  assert.equal(characterAssetNaming({ name: "林辰", appearance: "服装：白色礼服；状态：富有" }).displayName, "林辰白色礼服富有版");
});

test("uses the script agent's identity and per-episode look as the authoritative asset name", async () => {
  const { characterAssetNaming } = await loadNamingModule();
  assert.deepEqual(characterAssetNaming({ name: "男主", identityName: "男主", lookName: "白衣版", appearance: "平时穿黑衣，本集穿白衣" }), {
    identityKey: "男主",
    lookName: "白衣版",
    variantName: "白衣版",
    displayName: "男主-白衣版",
  });
});
