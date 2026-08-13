import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadReuseModule() {
  const source = await readFile(new URL("../app/lib/asset-reuse.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "asset-reuse.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const asset = (patch = {}) => ({ id: "asset-1", name: "ADRIAN", category: "character", mediaType: "image", tags: [], reusable: true, locked: true, canonical: false, identityKey: "Adrian", lookName: "基础造型", assetState: "ready", projectId: "older-episode", scope: "project", usageCount: 0, createdAt: "2026-08-01T00:00:00.000Z", ...patch });

test("reuses an exact character identity across episodes without case sensitivity", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const match = findReusableLibraryAsset([asset({ locked: false, canonical: false })], { category: "character", identityKey: "ADRIAN", lookName: "Base Look", projectId: "current-episode", mediaType: "image", allowCrossProject: true });
  assert.equal(match?.id, "asset-1");
});

test("treats base look labels as the same look but never mixes real variants", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  assert.equal(findReusableLibraryAsset([asset()], { category: "character", identityKey: "ADRIAN", lookName: "基础版", mediaType: "image", allowCrossProject: true })?.id, "asset-1");
  assert.equal(findReusableLibraryAsset([asset({ lookName: "白衣版" })], { category: "character", identityKey: "ADRIAN", lookName: "黑衣版", mediaType: "image", allowCrossProject: true }), undefined);
});

test("prefers the current project and ignores similarly named people", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const current = asset({ id: "current", projectId: "project-a", canonical: false });
  const global = asset({ id: "global", projectId: undefined, scope: "global", canonical: true });
  const otherName = asset({ id: "other", identityKey: "ADRIANA", name: "ADRIANA" });
  const match = findReusableLibraryAsset([global, otherName, current], { category: "character", identityKey: "ADRIAN", lookName: "基础版", projectId: "project-a", mediaType: "image", allowCrossProject: true });
  assert.equal(match?.id, "current");
});

test("reuses scene and prop assets by exact normalized entity identity", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const scene = asset({ id: "scene", category: "scene", identityKey: "scene:wooden ship deck", entityId: "Wooden Ship Deck", name: "Wooden Ship Deck 场景设定", lookName: undefined });
  const prop = asset({ id: "prop", category: "prop", identityKey: "Cyclops Sword", entityId: "Cyclops Sword", name: "Cyclops Sword", lookName: undefined });
  assert.equal(findReusableLibraryAsset([scene], { category: "scene", identityKey: "WOODEN-SHIP_DECK", mediaType: "image", allowCrossProject: true })?.id, "scene");
  assert.equal(findReusableLibraryAsset([prop], { category: "prop", identityKey: "cyclops sword", mediaType: "image", allowCrossProject: true })?.id, "prop");
});
