import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const reuseSource = await readFile(new URL("../app/lib/asset-reuse.ts", import.meta.url), "utf8");
  const reuseOutput = ts.transpileModule(reuseSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const reuseUrl = `data:text/javascript;base64,${Buffer.from(reuseOutput).toString("base64")}`;
  const source = (await readFile(new URL("../app/lib/character-asset-reconciliation.ts", import.meta.url), "utf8"))
    .replace('from "./asset-reuse"', `from "${reuseUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const uploaded = {
  id: "uploaded-suli",
  name: "苏梨",
  identityName: "苏梨",
  lookName: "基础版",
  libraryAssetId: "asset-suli",
  imageUrl: "blob:uploaded-suli",
  reviewDecision: "approved",
  status: "ready",
};

test("reanalysis is idempotent for an already uploaded exact character look", async () => {
  const { reconcileAnalyzedCharacterAssets } = await loadModule();
  const analyzed = [{ id: "new-frame", name: "苏梨", identityName: "苏梨", lookName: "基础造型", role: "女主", status: "queued" }];
  const result = reconcileAnalyzedCharacterAssets([uploaded], analyzed);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, uploaded.id);
  assert.equal(result[0].libraryAssetId, uploaded.libraryAssetId);
  assert.equal(result[0].imageUrl, uploaded.imageUrl);
  assert.equal(result[0].status, "ready");
});

test("a new outfit keeps the uploaded face as an identity baseline instead of dropping it", async () => {
  const { reconcileAnalyzedCharacterAssets } = await loadModule();
  const newLook = { id: "white-look", name: "苏梨", identityName: "苏梨", lookName: "白衣版", status: "queued" };
  const result = reconcileAnalyzedCharacterAssets([uploaded], [newLook]);
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.id === uploaded.id)?.identityBaseline, true);
  assert.equal(result.find((item) => item.id === "white-look")?.imageUrl, undefined);
});

test("assets from unrelated identities are never retained by a new analysis", async () => {
  const { reconcileAnalyzedCharacterAssets } = await loadModule();
  const result = reconcileAnalyzedCharacterAssets([uploaded], [{ id: "lin", name: "林婉", identityName: "林婉", lookName: "基础版", status: "queued" }]);
  assert.equal(result.some((item) => item.id === uploaded.id), false);
});
