import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const reuseSource = await readFile(new URL("../app/lib/asset-reuse.ts", import.meta.url), "utf8");
  const reuseOutput = ts.transpileModule(reuseSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const reuseUrl = `data:text/javascript;base64,${Buffer.from(reuseOutput).toString("base64")}`;
  const source = (await readFile(new URL("../app/lib/character-asset-deduplication.ts", import.meta.url), "utf8"))
    .replace('from "./asset-reuse"', `from "${reuseUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const { DUPLICATE_CHARACTER_ARCHIVE_TAG, planCharacterAssetDeduplication } = await loadModule();

function asset(id, overrides = {}) {
  return { id, category: "character", mediaType: "image", identityKey: "CASSIAN", lookName: "Base Look", projectId: "p1", scope: "project", sourceChoice: "ai", recognitionStatus: "recognized", assetState: "ready", canonical: false, locked: true, reusable: true, usageCount: 0, createdAt: `2026-08-${id === "new" ? "19" : "18"}T00:00:00.000Z`, tags: [], ...overrides };
}

test("duplicate base looks collapse to one project-scoped canonical card", () => {
  const plan = planCharacterAssetDeduplication([asset("old"), asset("new")]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].keep.id, "new");
  assert.deepEqual(plan[0].archive.map((item) => item.id), ["old"]);
});

test("user uploaded face wins over a later AI rendition", () => {
  const plan = planCharacterAssetDeduplication([asset("old", { sourceChoice: "upload", recognitionStatus: "confirmed" }), asset("new")]);
  assert.equal(plan[0].keep.id, "old");
});

test("different costumes, projects and archived history are not collapsed together", () => {
  const plan = planCharacterAssetDeduplication([
    asset("base"),
    asset("uniform", { lookName: "Uniform Look" }),
    asset("other-project", { projectId: "p2" }),
    asset("history", { tags: [DUPLICATE_CHARACTER_ARCHIVE_TAG] }),
  ]);
  assert.equal(plan.length, 0);
});
