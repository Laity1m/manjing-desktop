import test from "node:test";
import assert from "node:assert/strict";
import { consistencyGateWarnings, videoConsistencyAccepted, videoPreflightAccepted } from "../app/lib/consistency-gate.ts";

const scores = {
  characterIdentity: null,
  castIntegrity: null,
  costume: null,
  visualStyle: null,
  scene: 96,
  props: null,
  spatialContinuity: 92,
  shotContinuity: 98,
  lighting: null,
};

test("a 90+ structural report automatically proceeds to video", () => {
  const report = { scores, overall: 95, mode: "structural" };
  assert.equal(videoConsistencyAccepted(report, true), true);
  assert.equal(videoPreflightAccepted(undefined, report, true), true);
  assert.match(consistencyGateWarnings(report, true).join("；"), /结构检查/);
});

test("a sub-90 report pauses unless the user explicitly approves it", () => {
  const report = { scores, overall: 89, mode: "structural" };
  assert.equal(videoConsistencyAccepted(report, true), false);
  assert.equal(videoPreflightAccepted(undefined, report, true), false);
  assert.equal(videoPreflightAccepted("continue", report, true), true);
  assert.equal(videoPreflightAccepted("reuse", report, true), true);
});
