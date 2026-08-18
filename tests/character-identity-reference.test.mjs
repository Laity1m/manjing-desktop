import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadReferenceModule() {
  const reuseSource = await readFile(new URL("../app/lib/asset-reuse.ts", import.meta.url), "utf8");
  const reuseOutput = ts.transpileModule(reuseSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const reuseUrl = `data:text/javascript;base64,${Buffer.from(reuseOutput).toString("base64")}`;
  const source = (await readFile(new URL("../app/lib/character-identity-reference.ts", import.meta.url), "utf8"))
    .replace('from "./asset-reuse"', `from "${reuseUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const base = { id: "base", name: "苏梨", identityName: "苏梨", lookName: "基础版", imageUrl: "blob:base", reviewDecision: "approved" };

test("a new outfit selects the approved same-person face instead of generating identity from text", async () => {
  const { selectCharacterIdentityReference } = await loadReferenceModule();
  const target = { id: "night", name: "苏梨", identityName: "苏梨", lookName: "夜间居家服" };
  const wrongPerson = { ...base, id: "other", name: "林婉", identityName: "林婉", remoteUrl: "https://example.com/other.png" };
  assert.equal(selectCharacterIdentityReference(target, [wrongPerson, base])?.id, "base");
});

test("approved identity references outrank pending alternatives and rejected faces are ignored", async () => {
  const { selectCharacterIdentityReference } = await loadReferenceModule();
  const target = { id: "court", name: "苏梨", identityName: "苏梨", lookName: "官服" };
  const pending = { ...base, id: "pending", lookName: "白衣版", reviewDecision: "pending" };
  const rejected = { ...base, id: "rejected", reviewDecision: "rejected", remoteUrl: "https://example.com/rejected.png" };
  assert.equal(selectCharacterIdentityReference(target, [pending, rejected, base])?.id, "base");
});

test("library identity anchors remain stable across app versions and outfit variants", async () => {
  const { selectLibraryCharacterIdentityAnchor } = await loadReferenceModule();
  const assets = [
    { id: "new-look", name: "苏梨-战损版", identityKey: "苏梨", lookName: "战损版", category: "character", mediaType: "image", reusable: true, locked: true, canonical: true, assetState: "ready", createdAt: "2026-08-18T00:00:00.000Z" },
    { id: "original-face", name: "苏梨-基础版", identityKey: "苏梨", lookName: "基础版", category: "character", mediaType: "image", reusable: true, locked: true, canonical: true, assetState: "ready", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "other-person", name: "萧玦-基础版", identityKey: "萧玦", lookName: "基础版", category: "character", mediaType: "image", reusable: true, locked: true, canonical: true, assetState: "ready", createdAt: "2025-01-01T00:00:00.000Z" },
  ];
  assert.equal(selectLibraryCharacterIdentityAnchor("苏梨", assets)?.id, "original-face");
});

test("identity anchors are scoped to one task and periodic re-anchors are deterministic", async () => {
  const { CHARACTER_REFERENCE_POLICY, selectTaskScopedLibraryCharacterIdentityAnchor, shouldReanchorCharacterIdentity, shouldReanchorSpatialLayout } = await loadReferenceModule();
  const original = { id: "original", name: "苏梨-基础版", identityKey: "苏梨", lookName: "基础版", category: "character", mediaType: "image", reusable: true, locked: true, canonical: true, assetState: "ready", createdAt: "2026-01-01T00:00:00.000Z" };
  const newer = { ...original, id: "newer", name: "苏梨-新版", lookName: "新版", canonical: false, createdAt: "2026-08-18T00:00:00.000Z" };
  const bindings = new Map();
  assert.equal(selectTaskScopedLibraryCharacterIdentityAnchor("task-a", "苏梨", [original, newer], bindings)?.id, "original");
  const promoted = { ...newer, canonical: true };
  const demotedOriginal = { ...original, canonical: false, locked: false };
  assert.equal(selectTaskScopedLibraryCharacterIdentityAnchor("task-a", "苏梨", [demotedOriginal, promoted], bindings)?.id, "original");
  assert.equal(selectTaskScopedLibraryCharacterIdentityAnchor("task-b", "苏梨", [demotedOriginal, promoted], bindings)?.id, "newer");
  assert.equal(CHARACTER_REFERENCE_POLICY.faceRelativePriority, 1.2);
  assert.equal(CHARACTER_REFERENCE_POLICY.multiviewRelativePriority, 1.05);
  assert.equal(CHARACTER_REFERENCE_POLICY.providerGuidanceCap, 1.5);
  assert.equal(shouldReanchorCharacterIdentity(0), true);
  assert.equal(shouldReanchorCharacterIdentity(4), true);
  assert.equal(shouldReanchorCharacterIdentity(5), false);
  assert.equal(shouldReanchorSpatialLayout(6), true);
});

test("identity-lock prompt changes only the look while preserving exact facial geometry", async () => {
  const { characterIdentityLockInstruction } = await loadReferenceModule();
  const instruction = characterIdentityLockInstruction("苏梨", "夜间居家服", true);
  assert.match(instruction, /TASK-SCOPED CANONICAL IDENTITY BASELINE/);
  assert.match(instruction, /not a claim of permanent engine-level identity locking/);
  assert.match(instruction, /same person, not a similar casting/);
  assert.match(instruction, /Change only the episode look to 夜间居家服/);
});

test("all character generation paths submit the canonical identity image as a real model reference", async () => {
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  const horde = await readFile(new URL("../app/api/horde/route.ts", import.meta.url), "utf8");
  assert.match(studio, /characterGenerationRequest\(character, cast\)/);
  assert.match(studio, /references: characterRequest\.references/);
  assert.match(studio, /sourceImage = dataUrl\.replace/);
  assert.match(horde, /source_processing: "img2img"/);
  assert.match(horde, /denoising_strength: 0\.55/);
});
