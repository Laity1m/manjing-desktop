export type ConsistencyScoreKey = "characterIdentity" | "castIntegrity" | "costume" | "visualStyle" | "scene" | "props" | "spatialContinuity" | "shotContinuity" | "lighting";

export type ConsistencyGateReport = {
  scores: Record<ConsistencyScoreKey, number | null>;
  overall: number;
  mode: "vision" | "structural";
};

const RECOMMENDED_LIMITS: Array<[ConsistencyScoreKey, number]> = [
  ["costume", 88], ["visualStyle", 92], ["scene", 88], ["props", 85], ["spatialContinuity", 88], ["shotContinuity", 90], ["lighting", 85],
];

const SCORE_LABELS: Record<ConsistencyScoreKey, string> = {
  characterIdentity: "人物身份",
  castIntegrity: "人物数量",
  costume: "服装",
  visualStyle: "画风",
  scene: "场景",
  props: "道具",
  spatialContinuity: "空间连续性",
  shotContinuity: "镜头承接",
  lighting: "光线",
};

export function consistencyGateWarnings(report: ConsistencyGateReport, hasVisibleCharacters: boolean) {
  const warnings: string[] = [];
  const score = (key: ConsistencyScoreKey) => report.scores[key];
  if (report.mode !== "vision") warnings.push("本次仅完成结构检查，未执行视觉单项审核");
  if (hasVisibleCharacters && (score("characterIdentity") === null || Number(score("characterIdentity")) < 90)) warnings.push("人物身份低于建议值 90");
  if (hasVisibleCharacters && (score("castIntegrity") === null || Number(score("castIntegrity")) < 95)) warnings.push("人物数量或身份映射低于建议值 95");
  for (const [key, limit] of RECOMMENDED_LIMITS) if (score(key) !== null && Number(score(key)) < limit) warnings.push(`${SCORE_LABELS[key]}低于建议值 ${limit}`);
  return warnings;
}

export function videoConsistencyAccepted(report: ConsistencyGateReport, _hasVisibleCharacters?: boolean) {
  void _hasVisibleCharacters;
  // 单项建议值仍会展示给用户，但不再覆盖总分造成“95 分仍 REJECT”。
  return report.overall >= 90;
}

export function videoPreflightAccepted(manualOverride: unknown, report: ConsistencyGateReport, hasVisibleCharacters?: boolean) {
  return Boolean(manualOverride) || videoConsistencyAccepted(report, hasVisibleCharacters);
}
