import test from "node:test";
import assert from "node:assert/strict";
import { consistencyGateWarnings, videoConsistencyAccepted, videoPreflightAccepted } from "../app/lib/consistency-gate.ts";

const scores = {
  characterIdentity: null,
  castIntegrity: null,
  costume: null,
  visualStyle: null,
  aestheticQuality: null,
  scene: 96,
  props: null,
  spatialContinuity: 92,
  shotContinuity: 98,
  lighting: null,
};

test("a structural-only report pauses for human review even when its aggregate is high", () => {
  const report = { scores, overall: 95, mode: "structural" };
  assert.equal(videoConsistencyAccepted(report, true), false);
  assert.equal(videoPreflightAccepted(undefined, report, true), false);
  assert.equal(videoPreflightAccepted("continue", report, true), true);
  assert.match(consistencyGateWarnings(report, true).join("；"), /结构检查/);
});

test("vision reports must satisfy the aggregate and every hard consistency dimension", () => {
  const report = { scores: { characterIdentity: 94, castIntegrity: 98, costume: 92, visualStyle: 95, aestheticQuality: 91, scene: 93, props: 90, spatialContinuity: 92, shotContinuity: 94, lighting: 90 }, overall: 94, mode: "vision" };
  assert.equal(videoConsistencyAccepted(report, true), true);
  assert.equal(videoConsistencyAccepted({ ...report, scores: { ...report.scores, visualStyle: 91 } }, true), false);
  assert.equal(videoConsistencyAccepted({ ...report, scores: { ...report.scores, aestheticQuality: 85 } }, true), false);
});

test("a sub-90 report pauses unless the user explicitly approves it", () => {
  const report = { scores, overall: 89, mode: "structural" };
  assert.equal(videoConsistencyAccepted(report, true), false);
  assert.equal(videoPreflightAccepted(undefined, report, true), false);
  assert.equal(videoPreflightAccepted("continue", report, true), true);
  assert.equal(videoPreflightAccepted("reuse", report, true), true);
});
