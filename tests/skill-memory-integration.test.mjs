import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("all production text channels resolve project-scoped skills", async () => {
  const [studio, horde, learning] = await Promise.all([
    readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/horde/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/agent-system/learning-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(learning, /export function resolveAgentContext/);
  assert.match(learning, /item\.scope === "project" && item\.projectId === projectId/);
  assert.match(studio, /task: `horde_\$\{action\}`/);
  assert.match(studio, /skillContext: resolution\.text/);
  assert.match(studio, /resolvedSystem = resolution\.text/);
  assert.match(studio, /recordSkillInvocation/);
  assert.match(horde, /Approved project skills and memory for this task/);
});

test("approved shots write a project event ledger consumed by episode context", async () => {
  const [studio, series] = await Promise.all([
    readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/series-project.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /recordSeriesShotEvent\(seriesContext\.projectId/);
  assert.match(series, /【已批准制作事件账本】/);
  assert.match(series, /relevantEvents/);
  assert.match(series, /syncSeriesNarrativeMemory/);
});

test("public documentation is v0.0.1-only and every README image exists", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const notes = await readFile(new URL("../RELEASE_NOTES_0.0.1.md", import.meta.url), "utf8");
  assert.doesNotMatch(`${readme}\n${notes}`, /v1\.[0-9]|1\.5\.|1\.4\./i);
  const images = [...readme.matchAll(/!\[[^\]]*\]\((README-media\/[^)]+)\)/g)].map((match) => match[1]);
  assert.ok(images.length >= 3);
  await Promise.all(images.map((path) => access(new URL(`../${path}`, import.meta.url))));
});
