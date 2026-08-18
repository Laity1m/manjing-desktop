import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
const library = await readFile(new URL("../app/lib/asset-library.ts", import.meta.url), "utf8");
const libraryUi = await readFile(new URL("../app/assets/AssetLibraryClient.tsx", import.meta.url), "utf8");
const voiceUi = await readFile(new URL("../app/voices/VoiceLibraryClient.tsx", import.meta.url), "utf8");
const bridge = await readFile(new URL("../tools/manjing-local-bridge/app.py", import.meta.url), "utf8");
const seedanceRoute = await readFile(new URL("../app/api/seedance/route.ts", import.meta.url), "utf8");
const desktopRuntime = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");

test("extracts each character's first generated-video dialogue into the voice library", () => {
  assert.match(studio, /extractGeneratedVideoVoice/);
  assert.match(studio, /persistCanonicalVoiceProfile\(scene, audioBlob/);
  assert.match(studio, /video-extracted/);
  assert.match(studio, /recordVideoAudioTrack/);
  assert.match(studio, /MediaRecorder\(destination\.stream/);
  assert.match(studio, /approvedForProjectReuse = true/);
  assert.match(studio, /scope: "project"/);
  assert.match(studio, /本集后续镜头立即引用/);
  assert.match(library, /voiceSource\?: "generated-dialogue" \| "video-extracted" \| "user-uploaded"/);
  assert.match(library, /voiceConsent\?: "pending" \| "confirmed" \| "revoked"/);
});

test("pauses after every generated shot for approve-or-revise review", () => {
  assert.match(studio, /尚未生成后续镜头/);
  assert.match(studio, /不合格，按评分原因修改/);
  assert.match(studio, /合格，批准并生成下一镜/);
  assert.match(studio, /reviseCandidateVideo/);
  assert.match(studio, /setSequentialResumeToken/);
});

test("enforces distinct cast faces and varied motivated camera choreography", () => {
  assert.match(studio, /characterFaceSignature/);
  assert.match(studio, /must not share a generic model face/);
  assert.match(studio, /cinematicCameraPlan/);
  assert.match(studio, /肩后横移/);
  assert.match(studio, /弧形环绕/);
  assert.match(studio, /升降摇臂/);
});

test("reuses canonical voice audio in TTS and multimodal video references", () => {
  assert.match(studio, /role: "reference_audio"/);
  assert.match(studio, /referenceText: voiceReference\?\.referenceText/);
  assert.match(studio, /全模态视频将优先引用/);
  assert.match(studio, /voiceAssets = library\.filter/);
});

test("ships an auditable voice library and optional video-to-MP3 extraction", () => {
  assert.match(libraryUi, /音色已迁移到独立音色库/);
  assert.match(voiceUi, /公共音色库/);
  assert.match(voiceUi, /确认授权并设为 Canonical/);
  assert.match(voiceUi, /让 AI 生成参考音色/);
  assert.match(bridge, /@app\.post\("\/v1\/voice-profiles\/extract"\)/);
  assert.match(bridge, /inference_zero_shot/);
  assert.match(bridge, /"-b:a", "128k"/);
  assert.match(studio, /本地桥接摘取不可用，正在自动改用软件内置音轨解码/);
  assert.match(studio, /audioBufferToWav\(decoded, duration\)/);
  assert.doesNotMatch(studio, /从视频摘取 MP3 音色需要先在开源节点中心配置/);
});

test("creates project voice placeholders from speaking script characters", () => {
  assert.match(studio, /firstDialogueForCharacter/);
  assert.match(studio, /category: "audio"/);
  assert.match(studio, /blueprintKey: `script:voice:/);
  assert.match(library, /assetState\?: "placeholder"/);
  assert.match(library, /saveLibraryPlaceholder/);
});

test("preflights reusable assets before every Seedance video path", () => {
  assert.match(studio, /preflightReusableVideoAssets/);
  assert.match(studio, /资产预检完成/);
  assert.match(studio, /agentConfigs\.video\.adapter === "seedance" \? previousScene\?\.remoteVideoUrl/);
  assert.match(studio, /方舟不接受本机\/data 视频作为 @Video/);
  assert.match(studio, /role: "reference_video"/);
});

test("direct video workflow skips storyboard images and uses approved videos without tail frames", () => {
  assert.match(studio, /const directVideoWorkflow = agentConfigs\.video\.adapter !== "browser"/);
  assert.match(studio, /跳过分镜图，直接进入全能参考视频/);
  assert.match(studio, /previousEpisodeVideoReference/);
  assert.match(studio, /continuityReferenceDecision: "cross-episode-video"/);
  assert.match(studio, /上一镜已批准视频连续性/);
  assert.doesNotMatch(studio, /function persistTailFrameAsset/);
  assert.doesNotMatch(studio, /function shouldInheritTailFrame/);
});

test("keeps extracted frames for QA only and never submits them as generation references", () => {
  assert.match(studio, /videoStartFrameUrl: inspection\.frames\.start/);
  assert.match(studio, /videoEndFrameUrl: inspection\.frames\.end/);
  assert.doesNotMatch(studio, /上一镜视频截取首帧/);
  assert.doesNotMatch(studio, /上一镜视频截取尾帧/);
  assert.doesNotMatch(studio, /tags: \["视频截帧", "镜头尾帧"/);
  assert.match(studio, /role: "reference_image"/);
  assert.match(seedanceRoute, /const role = kind === "image" \? "reference_image"/);
  assert.match(desktopRuntime, /const role = kind === "image" \? "reference_image"/);
  assert.match(seedanceRoute, /return_last_frame: false/);
});
