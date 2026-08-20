import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../app/studio-client.tsx", import.meta.url);
const source = await readFile(sourcePath, "utf8");

test("Western 3D anime preset is CGI animation rather than a graphic-novel preset", async () => {
  assert.match(source, /name: "欧美3D动漫"/);
  assert.match(source, /preview: "\/styles\/western-3d-anime\.webp"/);
  assert.match(source, /toon and PBR hybrid materials/);
  assert.doesNotMatch(source, /name: "欧美3D图像小说"/);
  await access(new URL("../public/styles/western-3d-anime.webp", import.meta.url));
  assert.match(source, /animation-reference-fallback/);
  assert.match(source, /styleRequiresTrustedPortrait\(visualStyle\(style\)\.category\)/);
  assert.match(source, /3D漫剧/);
  assert.match(source, /const activePortraitBlock = trustedPortraitRequired/);
  assert.match(source, /saved\.projectId === projectId && requiresTrustedPortrait/);
  assert.doesNotMatch(source, /处理可信人物（\{seedancePortraitBlock\.blockedReferences/);
});

test("generated assets enter a non-blocking incremental review queue", () => {
  assert.doesNotMatch(source, /window\.confirm\(/);
  assert.match(source, /逐项审核队列/);
  assert.match(source, /videoReviewDecision: "pending"/);
  assert.match(source, /audioReviewDecision: "pending"/);
  assert.match(source, /还有 \$\{pendingReviewCount\} 项素材等待逐项审核/);
});

test("imported scripts create editable asset skeletons before any image generation", () => {
  assert.match(source, /剧本资产框架/);
  assert.match(source, /AI 先区分简介、背景故事、实际人物、对白和重要道具/);
  assert.match(source, /await analyzeScriptAssetBlueprint\(content, file\.name\)/);
  assert.match(source, /splitScriptForAssetAnalysis\(content\)/);
  assert.doesNotMatch(source, /analyzeScriptAssetBlueprint\(content\.slice\(/);
  assert.match(source, /上传已有图片/);
  assert.match(source, /让 AI 生成/);
  assert.match(source, /配对后生成真正缺失项/);
  assert.match(source, /asset-image-lightbox/);
  assert.match(source, /manjing-script-memory-v1/);
  assert.match(source, /persistScriptAssetBlueprint/);
  assert.match(source, /saveLibraryPlaceholder/);
  assert.match(source, /资产准备尚未完成：\$\{unresolvedCharacters\.length\} 个人物、\$\{unresolvedProps\.length\} 个道具仍需上传图片，或让 AI 生成后采用/);
  assert.match(source, /“小传\/人物小传\/角色小传”等栏目标题绝对不是人物/);
  assert.match(source, /VO、V\.O\.、-VO-、OS、O\.S\. 是附着在真实角色名后的画外音\/声音位置扩展/);
  assert.match(source, /removeMisclassifiedNarrativeAssets\(\)/);
});

test("all character generation paths use the concise default aesthetic director", () => {
  assert.match(source, /CHARACTER_AESTHETIC_VERSION = "manjing-character-art-direction-v5"/);
  assert.match(source, /const CURATED_FACE_DESIGNS = \[/);
  assert.match(source, /one memorable primary feature and two quieter supporting features/);
  assert.match(source, /harmonious large-medium-small shape rhythm/);
  assert.match(source, /SCREEN-APPEAL CONTRACT/);
  assert.match(source, /FIXED FOUR-ZONE LAYOUT/);
  assert.match(source, /left 35%-40%/);
  assert.match(source, /top = front full-body, middle = 45-degree side full-body, bottom = back full-body/);
  assert.match(source, /evaluateCharacterReferenceCard/);
  assert.match(source, /negative_prompt", CHARACTER_IMAGE_NEGATIVE_PROMPT/);
  assert.doesNotMatch(source, /Enabled Image Agent Skill/);
});

test("four-zone cards receive multi-angle checks and video continuity stays omni-only", () => {
  assert.match(source, /frontalFace: number \| null/);
  assert.match(source, /profileSilhouette: number \| null/);
  assert.match(source, /backSilhouette: number \| null/);
  assert.match(source, /facialFeatures: number \| null/);
  assert.match(source, /bodyProportion: number \| null/);
  assert.match(source, /costumeConsistency: number \| null/);
  assert.match(source, /正面全身、45度侧面全身、背面全身/);
  assert.match(source, /全能参考连续性（已锁定）/);
  assert.match(source, /抽取首尾帧仅用于本地质检，绝不送入模型/);
  assert.doesNotMatch(source, /pushReference\(\{ kind: "image"[^\n]+videoEndFrameUrl/);
  assert.match(source, /const pendingCharacterCards = cast\.filter/);
  assert.match(source, /四区角色卡等待用户批准，未提交视频任务/);
});

test("pairs existing assets before image generation and opens review videos in a large preview", () => {
  assert.match(source, /pairExistingBlueprintAssets/);
  assert.match(source, /只有缺失项才允许进入生图 Agent/);
  assert.match(source, /先配对已有资产/);
  assert.match(source, /video-review-lightbox/);
  assert.match(source, /大窗预览视频/);
});

test("batch image generation cannot restart itself and exposes provider failures", () => {
  assert.match(source, /const batchAssetGenerationRef = useRef\(false\)/);
  assert.match(source, /if \(assetAction \|\| batchAssetGenerationRef\.current\) return/);
  assert.match(source, /batchAssetGenerationRef\.current = true/);
  assert.match(source, /if \(!autoAdopt\) setAssetAction\(actionId\)/);
  assert.match(source, /withStageProgress\([\s\S]*210000/);
  assert.match(source, /批量补齐结束：成功/);
  assert.match(source, /失败原因已写入制作记录/);
  assert.match(source, /fetchWithHardTimeout/);
  assert.match(source, /controller\.abort\(\)/);
});

test("splits episode character looks and binds exactly one look to each shot", () => {
  assert.match(source, /identityName\?: string/);
  assert.match(source, /lookName\?: string/);
  assert.match(source, /characterLooks\?: Record<string, string>/);
  assert.match(source, /function charactersForScene/);
  assert.match(source, /人物身份与人物造型必须分层/);
  assert.match(source, /每镜必须用 characterLooks 显式指定/);
  assert.match(source, /人物造型资产 · \{character\.episodeScope/);
  assert.match(source, /当前任务 Canonical 人物四区角色卡：\$\{characterAssetNaming\(character\)\.displayName\}/);
});

test("creates user-selectable canonical scene images for omni-reference-only video", () => {
  assert.match(source, /type SceneAsset =/);
  assert.match(source, /Canonical 空场景/);
  assert.match(source, /uploadSceneBlueprint/);
  assert.match(source, /generateSceneBlueprint/);
  assert.match(source, /approveSceneBlueprint/);
  assert.match(source, /category: "scene"/);
  assert.match(source, /Canonical 空场景：\$\{canonicalSceneAsset\.name\}/);
  assert.match(source, /抽取首尾帧只用于质检，不送入模型/);
  assert.match(source, /禁止提交首帧或尾帧图片/);
});
