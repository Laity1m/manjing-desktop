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
  assert.equal(findReusableLibraryAsset([asset()], { category: "character", identityKey: "ADRIAN", lookName: "Current Episode Look", mediaType: "image", allowCrossProject: true })?.id, "asset-1");
});

test("prefers the current project and ignores similarly named people", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const current = asset({ id: "current", projectId: "project-a", canonical: false });
  const global = asset({ id: "global", projectId: undefined, scope: "global", canonical: true });
  const otherName = asset({ id: "other", identityKey: "ADRIANA", name: "ADRIANA" });
  const match = findReusableLibraryAsset([global, otherName, current], { category: "character", identityKey: "ADRIAN", lookName: "基础版", projectId: "project-a", mediaType: "image", allowCrossProject: true });
  assert.equal(match?.id, "current");
});

test("project assets never auto-pair into an unrelated project unless cross-project reuse is explicit", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const unrelated = asset({ id: "unrelated", projectId: "series-b", scope: "project" });
  const request = { category: "character", identityKey: "ADRIAN", lookName: "基础版", projectId: "series-a", mediaType: "image" };
  assert.equal(findReusableLibraryAsset([unrelated], request), undefined);
  assert.equal(findReusableLibraryAsset([unrelated], { ...request, allowCrossProject: true })?.id, "unrelated");
});

test("reuses scene and prop assets by exact normalized entity identity", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const scene = asset({ id: "scene", category: "scene", identityKey: "scene:wooden ship deck", entityId: "Wooden Ship Deck", name: "Wooden Ship Deck 场景设定", lookName: undefined });
  const prop = asset({ id: "prop", category: "prop", identityKey: "Cyclops Sword", entityId: "Cyclops Sword", name: "Cyclops Sword", lookName: undefined });
  assert.equal(findReusableLibraryAsset([scene], { category: "scene", identityKey: "WOODEN-SHIP_DECK", mediaType: "image", allowCrossProject: true })?.id, "scene");
  assert.equal(findReusableLibraryAsset([prop], { category: "prop", identityKey: "cyclops sword", mediaType: "image", allowCrossProject: true })?.id, "prop");
});

test("reuses legacy character files whose variant is stored only in the filename", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const legacy = asset({ id: "legacy-look", name: "林辰-白衣版-角色设定图.png", identityKey: undefined, entityId: undefined, lookName: undefined, variantName: undefined, tags: ["人物"] });
  assert.equal(findReusableLibraryAsset([legacy], { category: "character", identityKey: "林辰", lookName: "白衣版", mediaType: "image", allowCrossProject: true })?.id, "legacy-look");
  assert.equal(findReusableLibraryAsset([legacy], { category: "character", identityKey: "林辰", lookName: "黑衣版", mediaType: "image", allowCrossProject: true }), undefined);
});

test("recognizes legacy standard/reference suffixes and identity tags", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const standard = asset({ id: "standard", name: "林辰-人物标准图.png", identityKey: undefined, entityId: undefined, lookName: undefined, variantName: undefined, tags: [] });
  const opaque = asset({ id: "opaque", name: "旧版导出.png", identityKey: "character:a8c014", entityId: undefined, tags: ["人物:林辰"], lookName: "基础版" });
  assert.equal(findReusableLibraryAsset([standard], { category: "character", identityKey: "林辰", lookName: "基础版", mediaType: "image", allowCrossProject: true })?.id, "standard");
  assert.equal(findReusableLibraryAsset([opaque], { category: "character", identityKey: "林辰", lookName: "基础版", mediaType: "image", allowCrossProject: true })?.id, "opaque");
});

test("can recover categorized legacy images imported as other when semantic evidence is present", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const character = asset({ id: "other-character", category: "other", name: "林辰-角色参考图.png", identityKey: undefined, entityId: undefined, lookName: undefined, tags: ["purpose:identity"] });
  const scene = asset({ id: "other-scene", category: "other", name: "船舱-空场景设定图.png", identityKey: undefined, entityId: undefined, lookName: undefined, tags: ["场景设定"] });
  assert.equal(findReusableLibraryAsset([character], { category: "character", identityKey: "林辰", lookName: "基础版", mediaType: "image", allowCrossProject: true })?.id, "other-character");
  assert.equal(findReusableLibraryAsset([scene], { category: "scene", identityKey: "船舱", mediaType: "image", allowCrossProject: true })?.id, "other-scene");
});

test("can deliberately reuse an accepted identity image when a new look has no exact asset", async () => {
  const { findReusableLibraryAsset } = await loadReuseModule();
  const base = asset({ id: "accepted-base", name: "苏梨-基础版-角色设定图.png", identityKey: "苏梨", lookName: "基础版", canonical: true });
  assert.equal(findReusableLibraryAsset([base], { category: "character", identityKey: "苏梨", lookName: "夜间居家服", mediaType: "image", allowCrossProject: true }), undefined);
  assert.equal(findReusableLibraryAsset([base], { category: "character", identityKey: "苏梨", lookName: "夜间居家服", mediaType: "image", allowCrossProject: true, allowLookFallback: true })?.id, "accepted-base");
});

test("image-agent reruns never regenerate a visible legacy character asset", async () => {
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(studio, /missingCharacters = cast\.filter\(\(character\) => isVisualCharacterAsset\(character\) && !character\.imageUrl\)/);
  assert.doesNotMatch(studio, /character\.sheetVersion !== 2/);
});
