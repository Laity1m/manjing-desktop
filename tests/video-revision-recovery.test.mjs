import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studio = readFileSync(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
const library = readFileSync(new URL("../app/lib/asset-library.ts", import.meta.url), "utf8");

test("video review accepts user-authored revision instructions", () => {
  assert.match(studio, /videoRevisionRequest\?: string/);
  assert.match(studio, /用户明确修改要求/);
  assert.match(studio, /可填写要求/);
});

test("a revised Seedance prompt cannot silently resume an incompatible task", () => {
  assert.match(studio, /promptSignature\?: string/);
  assert.match(studio, /pending\.promptSignature === promptSignature/);
  assert.match(studio, /saveSeedancePendingTask\(scene\.id\)/);
});

test("native video reruns do not require a storyboard image and remain cancellable", () => {
  assert.match(studio, /role === "video"\) return scenes\.length > 0/);
  assert.match(studio, /seedanceRequestControllerRef\.current\?\.abort\(\)/);
  assert.match(studio, /Boolean\(sceneAction\)/);
});

test("character blueprint reuse remains exact for costume and state", () => {
  assert.match(library, /allowLookFallback: false/);
});
