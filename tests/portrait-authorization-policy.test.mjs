import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadPolicy() {
  const source = await readFile(new URL("../app/lib/portrait-authorization-policy.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("trusted portrait authorization applies to live action but not 3D animation", async () => {
  const { styleRequiresTrustedPortrait } = await loadPolicy();
  assert.equal(styleRequiresTrustedPortrait("写实"), true);
  assert.equal(styleRequiresTrustedPortrait("动画"), false);
  assert.equal(styleRequiresTrustedPortrait("艺术"), false);
});

test("a portrait blocker from project A cannot stop project B", async () => {
  const { portraitBlockReferencesForProject } = await loadPolicy();
  const block = { projectId: "project-a", blockedReferences: [{ kind: "image", name: "A角色", identityKey: "A角色", libraryAssetId: "asset-a" }] };
  assert.deepEqual(portraitBlockReferencesForProject(block, "project-b", [{ name: "B角色", libraryAssetId: "asset-b" }]), []);
});

test("legacy blockers only apply to an exact asset in the current cast", async () => {
  const { portraitBlockReferencesForProject } = await loadPolicy();
  const block = { blockedReferences: [{ kind: "image", name: "苏梨", identityKey: "苏梨", libraryAssetId: "asset-a" }] };
  assert.deepEqual(portraitBlockReferencesForProject(block, "project-b", [{ name: "林婉", libraryAssetId: "asset-b" }]), []);
  assert.equal(portraitBlockReferencesForProject(block, "project-a", [{ name: "苏梨", libraryAssetId: "asset-a" }]).length, 1);
});

