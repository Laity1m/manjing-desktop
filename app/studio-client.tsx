"use client";

import { appendSeriesProductionRecord, isGenericNonAssetCharacter, isNonCharacterLabel } from "./lib/series-project";

import StudioProjectBinding from "./components/StudioProjectBinding";

import { agentContext, markContextUsed } from "./agent-system/learning-store";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteNav from "./components/SiteNav";
import ConfirmButton from "./components/ConfirmButton";
import { API_MODE_DEFAULT_ENDPOINTS, API_MODE_LABELS, apiModesForRole, discoverApiModels, type DiscoverableApiMode, type DiscoveredModel } from "./lib/custom-api";
import { loadEditorProjectById, persistEditorProject, type EditorProjectClip } from "./lib/editor-project";
import { loadCustomModels, saveCustomModels, type CustomModel } from "./lib/custom-models";
import { createCanvasFromStudio } from "./lib/production-canvas";
import { attachLibraryFileToPlaceholder, consolidateDuplicateCharacterAssets, deleteLibraryAsset, listLibraryAssets, loadLibraryAssets, markLibraryAssetUsed, saveLibraryFile, saveLibraryPlaceholder, updateLibraryAsset, type LibraryAsset, type LibraryAssetCategory } from "./lib/asset-library";
import { findReusableLibraryAsset, normalizeAssetIdentity, normalizeAssetLook } from "./lib/asset-reuse";
import { CHARACTER_REFERENCE_POLICY, characterIdentityLockInstruction, selectCharacterIdentityReference, selectTaskScopedLibraryCharacterIdentityAnchor, shouldReanchorCharacterIdentity, shouldReanchorSpatialLayout, taskIdentityAnchorKey } from "./lib/character-identity-reference";
import { videoConsistencyAccepted } from "./lib/consistency-gate";
import { planSequentialVideo } from "./lib/sequential-video-flow";
import { characterAssetDisplayName, characterAssetNaming } from "./lib/character-asset-naming";
import { fallbackScriptAssetManifest, isReusableSceneAssetCandidate, localizedSceneDisplayName, mergeScriptAssetManifests, parseScriptAssetManifest, splitScriptForAssetAnalysis } from "./lib/script-asset-manifest";
import { reconcileAnalyzedCharacterAssets } from "./lib/character-asset-reconciliation";
import { lockStoryboardScenesToAssetManifest, lockStoryboardToAssetManifest } from "./lib/production-asset-manifest-lock";
import { portraitBlockReferencesForProject, styleRequiresTrustedPortrait } from "./lib/portrait-authorization-policy";
import { assignSpatialLayouts, positionLockRequested, spatialLayoutSummary, type SpatialAnchor } from "./lib/spatial-continuity";

type GeneratedAssetMetadata = { displayName?: string; identityKey?: string; lookName?: string; entityId?: string; variantName?: string };

async function archiveGeneratedAsset(url: string, name: string, category: LibraryAssetCategory, duration: number, tags: string[], metadata: GeneratedAssetMetadata = {}) {
  if (!url) return;
  const archiveKey = `generated:${tags.join(":")}:${name}`.slice(0, 160);
  const existing = await listLibraryAssets();
  if (existing.some((item) => item.tags.includes(archiveKey))) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`生成资产归档失败（${response.status}）`);
  const blob = await response.blob();
  const extension = blob.type.startsWith("image/") ? (blob.type.includes("jpeg") ? "jpg" : "png") : blob.type.startsWith("audio/") ? (blob.type.includes("mpeg") ? "mp3" : "wav") : "mp4";
  const file = new File([blob], `${name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120)}.${extension}`, { type: blob.type || (category === "video" ? "video/mp4" : category === "audio" ? "audio/wav" : "image/png") });
  const identityTag = tags.find((tag) => tag.startsWith("asset:"));
  const identityKey = metadata.identityKey?.trim() || identityTag?.slice("asset:".length) || (category === "prop" ? tags.find((tag) => tag !== "自动生成" && tag !== "重要道具") : undefined);
  if (identityKey) {
    const matching = existing.find((asset) => asset.category === category
      && asset.reusable !== false
      && normalizeAssetIdentity(asset.identityKey || asset.entityId || "") === normalizeAssetIdentity(identityKey)
      && (category !== "character" || normalizeAssetLook(asset.lookName || asset.variantName || "基础版") === normalizeAssetLook(metadata.lookName || "基础版")));
    if (matching) { await markLibraryAssetUsed(matching.id); return; }
  }
  const locked = Boolean(identityKey && ["character", "prop", "scene", "audio"].includes(category));
  const saved = await saveLibraryFile(file, { name: metadata.displayName, category, duration, tags: [...tags, archiveKey], identityKey, lookName: metadata.lookName, entityId: metadata.entityId, variantName: metadata.variantName, locked });
  if (identityKey) await updateLibraryAsset(saved.id, { canonical: category === "prop" || (category === "character" && tags.includes("用户批准")), locked, reusable: true, identityKey, ...(metadata.lookName ? { lookName: metadata.lookName } : {}), ...(metadata.entityId ? { entityId: metadata.entityId } : {}), ...(metadata.variantName ? { variantName: metadata.variantName } : {}) });
}

function autoArchive(url: string, name: string, category: LibraryAssetCategory, duration: number, tags: string[], metadata: GeneratedAssetMetadata = {}) {
  void archiveGeneratedAsset(url, name, category, duration, tags, metadata).catch((error) => console.warn("[manjing asset archive]", error));
}

function labeledVisualAssets(text: string, label: "场景" | "道具") {
  const values: string[] = [];
  const pattern = new RegExp(`\\[${label}[：:]([^\\]]+)\\]`, "gi");
  for (const match of text.matchAll(pattern)) values.push(...String(match[1] || "").split(/[，,、]/));
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, label === "场景" ? 1 : 6);
}

type Mode = "community" | "cloud";
type Phase = "idle" | "story" | "characters" | "images" | "video" | "voice" | "music" | "ready" | "exporting" | "error";
type SceneStatus = "queued" | "writing" | "painting" | "animating" | "voicing" | "ready" | "error";
type UserReviewDecision = "pending" | "approved" | "rejected";
type AgentRole = "director" | "writer" | "prompt" | "image" | "video" | "voice" | "editor";
type AgentAdapter = "horde" | "openai" | "anthropic" | "gemini" | "pollinations" | "seedance" | "browser" | "webhook";
type MotionPreset = "push" | "pull" | "pan-left" | "pan-right" | "float";
type TransitionPreset = "fade" | "cut" | "flash";
type VisualFilter = "none" | "warm" | "cool" | "mono";
type SubtitlePosition = "top" | "center" | "bottom";
type FrameContinuityMode = "identity-first";

function characterSheetVersionFromLibrary(asset: Pick<LibraryAsset, "tags">): 2 | 3 {
  return asset.tags.some((tag) => /四区角色卡|大头照|正侧背三视图|character-card-v3/i.test(tag)) ? 3 : 2;
}
type ActivityState = "running" | "done" | "warning" | "error";
type ActivityEvent = { id: string; role: AgentRole; state: ActivityState; message: string; time: string };
type BridgeHealth = { state: "idle" | "testing" | "ready" | "partial" | "error"; message: string; nodes?: Record<string, boolean>; workflows?: Record<string, boolean> };
type AgentConfig = { preset: string; adapter: AgentAdapter; model: string; endpoint: string; apiKey: string };
type AgentPreset = { id: string; adapter: AgentAdapter; name: string; model: string; note: string; badge?: string; endpoint?: string };
type QuickModelDraft = { name: string; adapter: DiscoverableApiMode; model: string; endpoint: string; apiKey: string; note: string };
type RoleSaveState = { role: AgentRole | null; state: "idle" | "saving" | "saved" | "error"; message: string };
type SceneAction = { id: string; type: "image" | "video" };
type CharacterReferenceScores = { frontalFace: number | null; profileSilhouette: number | null; backSilhouette: number | null; facialFeatures: number | null; bodyProportion: number | null; costumeConsistency: number | null };
type CharacterReferenceReport = { scores: CharacterReferenceScores; overall: number; decision: "pass" | "review" | "reject"; mode: "vision" | "structural"; findings: string[]; checkedAt: string };
type CharacterAsset = {
  id: string;
  libraryAssetId?: string;
  name: string;
  identityName?: string;
  lookName?: string;
  episodeScope?: string;
  sceneHints?: string[];
  role: string;
  appearance: string;
  visualEvidence?: string;
  requiresVisualAsset?: boolean;
  voice: string;
  needsVoice?: boolean;
  firstDialogue?: string;
  imageUrl?: string;
  remoteUrl?: string;
  arkAssetId?: string;
  portraitAuthorizationStatus?: "unbound" | "pending" | "authorized";
  sheetVersion?: 2 | 3;
  referenceCardReport?: CharacterReferenceReport;
  reviewDecision?: UserReviewDecision;
  assetMatchKind?: "exact" | "look-candidate";
  identityBaseline?: boolean;
  status: "queued" | "generating" | "ready" | "error";
};
type PropAsset = {
  id: string;
  libraryAssetId?: string;
  name: string;
  description: string;
  importance: "hero" | "recurring" | "story";
  reason: string;
  imageUrl?: string;
  remoteUrl?: string;
  reviewDecision?: UserReviewDecision;
  status: "queued" | "generating" | "ready" | "error";
};
type SceneAsset = {
  id: string;
  libraryAssetId?: string;
  name: string;
  environmentKey: string;
  description: string;
  timeWeather: string;
  episodeScope: string;
  sceneHints: string[];
  reason: string;
  imageUrl?: string;
  remoteUrl?: string;
  reviewDecision?: UserReviewDecision;
  status: "queued" | "generating" | "ready" | "error";
};
type AssetAnalysisState = "idle" | "analyzing" | "ready" | "error";
type ScriptNarrativeMemory = { synopsis: string; background: string; updatedAt: string };
type ConsistencyScores = { characterIdentity: number | null; castIntegrity: number | null; costume: number | null; visualStyle: number | null; aestheticQuality: number | null; scene: number | null; props: number | null; spatialContinuity: number | null; shotContinuity: number | null; lighting: number | null };
type ConsistencyReport = { scores: ConsistencyScores; overall: number; decision: "pass" | "review" | "reject"; mode: "vision" | "structural"; findings: string[]; checkedAt: string; attempts: number };
type Scene = {
  id: string;
  title: string;
  visual: string;
  action: string;
  shot: string;
  camera: string;
  dialogue: string;
  speaker: string;
  emotion: string;
  sfx: string;
  characters: string[];
  spatialLayout?: Record<string, SpatialAnchor>;
  characterLooks?: Record<string, string>;
  duration: number;
  environmentKey?: string;
  environmentBible?: string;
  continuity?: string;
  startState?: string;
  endState?: string;
  consistencyReport?: ConsistencyReport;
  consistencyDecision?: "pass" | "review" | "reject";
  preflightOverride?: "continue" | "reuse";
  imageReviewDecision?: UserReviewDecision;
  videoReviewDecision?: UserReviewDecision;
  audioReviewDecision?: UserReviewDecision;
  imageUrl?: string;
  videoPosterUrl?: string;
  remoteImageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  remoteVideoUrl?: string;
  videoAssetId?: string;
  candidateVideoAssetId?: string;
  videoStartFrameUrl?: string;
  videoEndFrameUrl?: string;
  tailFrameAssetId?: string;
  continuityReferenceDecision?: "previous-video" | "asset-only" | "cross-episode-video";
  candidateVideoUrl?: string;
  videoRevisionRequest?: string;
  status: SceneStatus;
  errorMessage?: string;
  model?: string;
  motion?: MotionPreset;
  motionIntensity?: number;
  transition?: TransitionPreset;
  filter?: VisualFilter;
  speed?: number;
  volume?: number;
  subtitleEnabled?: boolean;
  subtitlePosition?: SubtitlePosition;
};
type StudioSession = {
  version: 2;
  projectId: string;
  projectTitle: string;
  story: string;
  style: string;
  targetDuration: number;
  aspect: "9:16" | "16:9";
  frameContinuityMode?: FrameContinuityMode;
  characters: CharacterAsset[];
  propAssets: PropAsset[];
  sceneAssets: SceneAsset[];
  scenes: Scene[];
  selected: number;
  phase: Phase;
  progress: number;
  statusText: string;
  activityLog: ActivityEvent[];
  musicPrompt: string;
  musicUrl?: string;
  exportUrl?: string;
  updatedAt: string;
};

function characterIdentity(character: CharacterAsset) {
  return String(character.identityName || character.name).trim();
}

function characterLook(character: CharacterAsset) {
  return characterAssetNaming(character).lookName;
}

function normalizedCharacterLook(value: string) {
  return normalizeAssetLook(value);
}

function characterAssetKey(character: CharacterAsset) {
  return `${normalizeAssetIdentity(characterIdentity(character))}::${normalizedCharacterLook(characterLook(character))}`;
}

function deduplicateCharacterAssets(items: CharacterAsset[]) {
  const unique: CharacterAsset[] = [];
  for (const item of items) {
    if (!isVisualCharacterAsset(item)) continue;
    const key = characterAssetKey(item);
    const existingIndex = unique.findIndex((candidate) => characterAssetKey(candidate) === key
      || Boolean(item.libraryAssetId && candidate.libraryAssetId === item.libraryAssetId)
      || Boolean(item.imageUrl && candidate.imageUrl === item.imageUrl));
    if (existingIndex < 0) {
      unique.push(item);
      continue;
    }
    const existing = unique[existingIndex];
    const preferred = existing.imageUrl ? existing : item.imageUrl ? item : existing;
    const secondary = preferred === existing ? item : existing;
    unique[existingIndex] = {
      ...secondary,
      ...preferred,
      id: preferred.id || secondary.id,
      libraryAssetId: preferred.libraryAssetId || secondary.libraryAssetId,
      imageUrl: preferred.imageUrl || secondary.imageUrl,
      remoteUrl: preferred.remoteUrl || secondary.remoteUrl,
      arkAssetId: preferred.arkAssetId || secondary.arkAssetId,
      portraitAuthorizationStatus: preferred.portraitAuthorizationStatus || secondary.portraitAuthorizationStatus,
      sceneHints: [...new Set([...(existing.sceneHints || []), ...(item.sceneHints || [])])].slice(0, 20),
      needsVoice: existing.needsVoice !== false || item.needsVoice !== false,
      firstDialogue: existing.firstDialogue || item.firstDialogue,
      status: preferred.imageUrl || secondary.imageUrl ? "ready" : preferred.status,
    };
  }
  return unique;
}

function charactersForScene(allCharacters: CharacterAsset[], scene: Scene) {
  const wanted = [...new Set([...scene.characters, scene.speaker].map((name) => String(name || "").trim()).filter(Boolean))];
  const sceneText = [scene.title, scene.visual, scene.action, scene.startState, scene.endState, scene.continuity, ...(Object.values(scene.characterLooks || {}))].join(" ").toLocaleLowerCase("zh-CN");
  const selected: CharacterAsset[] = [];
  for (const wantedName of wanted) {
    const normalizedWanted = wantedName.toLocaleLowerCase("zh-CN");
    const candidates = allCharacters.filter((character) => {
      const identity = characterIdentity(character).toLocaleLowerCase("zh-CN");
      const display = characterAssetNaming(character).displayName.toLocaleLowerCase("zh-CN");
      return identity === normalizedWanted || display === normalizedWanted;
    });
    if (!candidates.length) continue;
    const requestedLook = Object.entries(scene.characterLooks || {}).find(([identity]) => identity.trim().toLocaleLowerCase("zh-CN") === characterIdentity(candidates[0]).toLocaleLowerCase("zh-CN"))?.[1]?.trim().toLocaleLowerCase("zh-CN") || "";
    const ranked = candidates.map((character, index) => {
      const look = characterLook(character).toLocaleLowerCase("zh-CN");
      const hintMatches = (character.sceneHints || []).filter((hint) => sceneText.includes(hint.toLocaleLowerCase("zh-CN"))).length;
      const exactLook = requestedLook && normalizedCharacterLook(look) === normalizedCharacterLook(requestedLook);
      const lookWords = look.replace(/(?:基础|默认|版|look|base|default)/giu, " ").split(/[\s,，、/;；-]+/).filter((word) => word.length >= 2);
      const textualMatches = lookWords.filter((word) => sceneText.includes(word)).length;
      return { character, score: (exactLook ? 100 : 0) + hintMatches * 12 + textualMatches * 4 + (/^(?:基础版|默认版|base look)$/iu.test(look) ? 3 : 0) - index * 0.001 };
    }).sort((left, right) => right.score - left.score);
    selected.push(ranked[0].character);
  }
  return [...new Map(selected.map((character) => [character.id, character])).values()];
}

function stableReuseToken(value: string) {
  let hash = 2166136261;
  const normalized = value.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
  for (let index = 0; index < normalized.length; index += 1) { hash ^= normalized.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function characterIdentitySeed(identity: string) {
  const parsed = Number.parseInt(stableReuseToken(identity), 36);
  return (Number.isFinite(parsed) ? parsed % 2147483646 : 0) + 1;
}

function shotReuseIdentity(scene: Scene) {
  return `shot:${stableReuseToken([scene.title, scene.visual, scene.action, scene.camera, scene.environmentKey, scene.startState, scene.endState].join("|"))}`;
}

function voiceReuseIdentity(scene: Scene, voiceName: string) {
  return `voice:${stableReuseToken([scene.speaker, voiceName, scene.emotion, scene.dialogue].join("|"))}`;
}

const CHARACTER_AESTHETIC_VERSION = "manjing-character-art-direction-v5";
const CHARACTER_IMAGE_NEGATIVE_PROMPT = "multiple people, different identities across card views, low quality, ugly or uncanny face, deformed profile, inconsistent left-right facial geometry, incoherent facial proportions, generic cloned face, influencer same-face, pointed V-line jaw, oversized vacant eyes, swollen lips, waxy plastic skin, gray muddy skin, excessive beauty filter, stiff smile, crossed eyes, deformed iris, bad anatomy, bad hands, missing hands, missing feet, extra fingers, duplicate body, cropped limbs, perspective distortion, complex background, heavy shadow, random jewelry or props, exaggerated action pose, chibi proportions, blur, text, logo, watermark, border decoration";

const CURATED_FACE_DESIGNS = [
  "a refined oval facial structure with softly defined cheekbones; the primary memory feature is calm almond-shaped eyes, supported by a natural straight nose and a balanced relaxed mouth; a subtle beauty mark below one eye",
  "a compact soft-square facial structure with a clean jaw and gentle cheek volume; the primary memory feature is expressive deep-set eyes, supported by a broad natural nose and a wide restrained mouth; one faint eyebrow notch",
  "an elegant heart-shaped facial structure with a defined but not pointed chin; the primary memory feature is slightly upturned hooded eyes, supported by a softly sculpted nose and a clear cupid's-bow lip line; naturally asymmetric brows",
  "a youthful round-oval facial structure with smooth transitions through the cheek and jaw; the primary memory feature is bright wide-set eyes, supported by a softly rounded nose and balanced full lips; light freckles across the nose",
  "a mature oblong facial structure with a composed forehead-to-jaw rhythm; the primary memory feature is a strong thoughtful brow and narrow eyes, supported by a subtly aquiline nose and a straight expressive mouth; a distinct widow's peak",
  "a high-cheekbone diamond facial structure with a graceful tapered jaw; the primary memory feature is elongated monolid eyes, supported by a low natural bridge and a small controlled mouth; a subtle chin cleft",
  "a broad oval facial structure with grounded cheek and jaw planes; the primary memory feature is warm deep-set eyes, supported by a strong straight nose and an asymmetric expressive mouth; slightly uneven brows",
  "a slender soft-angular facial structure with a clean lower-face silhouette; the primary memory feature is downturned story-rich eyes, supported by a short straight nose and a gently full lower lip; a small cheek dimple visible only in expression",
  "a balanced trapezoid facial structure with a confident lower jaw; the primary memory feature is close-set focused eyes, supported by a broad bridge and a long restrained lip line; a faint scar through one eyebrow when compatible with the script",
  "a short oval facial structure with softly lifted cheek planes; the primary memory feature is rounded hooded eyes, supported by a petite natural nose and a compact bow-shaped mouth; a subtle off-center hairline",
  "a long heart-oval facial structure with elegant vertical proportions; the primary memory feature is wide-set elongated eyes, supported by a defined natural nose tip and a softly asymmetric mouth; sparse freckles at the cheekbones",
  "a sturdy rounded-square facial structure with believable cheek and jaw weight; the primary memory feature is clear almond eyes beneath a strong brow, supported by a softly aquiline nose and a broad balanced mouth; one small chin cleft",
];

function characterFaceSignature(name: string) {
  const seed = Number.parseInt(stableReuseToken(name).slice(0, 7), 36) || 1;
  return `${CURATED_FACE_DESIGNS[seed % CURATED_FACE_DESIGNS.length]}. Keep natural human asymmetry and role-appropriate age, heritage, skin texture, fatigue, scars and life experience. The design must feel intentionally cast and visually harmonious, not cosmetically perfected or made into a generic beauty-filter face`;
}

function characterAestheticDirection(styleName: string) {
  const preset = visualStyle(styleName);
  if (preset.category === "写实") return `DEFAULT AESTHETIC DIRECTION ${CHARACTER_AESTHETIC_VERSION}: premium feature-film casting appeal that remains faithful to age, role and lived experience; coherent facial proportions with one memorable primary feature and two quieter supporting features; natural asymmetry, believable bone structure, real skin texture, individually groomed hair and restrained role-appropriate makeup. Light the close-up with a large soft key 30 degrees camera-left, gentle eye catchlights, controlled fill and a subtle rim separation; use an eye-level 85mm portrait perspective with flattering but truthful facial geometry, clean exposure and restrained editorial color. Attractive means intentional, expressive and well-cast, never identical, airbrushed, influencer-like or youth-filtered`;
  if (/3D|三维|CG/i.test(`${styleName} ${preset.base}`)) return `DEFAULT AESTHETIC DIRECTION ${CHARACTER_AESTHETIC_VERSION}: high-end animation character appeal with a clear silhouette, harmonious large-medium-small shape rhythm, readable brow-eye-nose-mouth hierarchy and one memorable primary facial feature; sculpted planes transition cleanly, eyes have controlled size and focused catchlights, mouth corners and cheeks support nuanced acting, and the face remains rig-friendly from every angle. Use soft studio key light, clean fill and a restrained rim to reveal form and materials. Preserve age and role; avoid uncanny human skin, doll-like blankness, swollen rounded features, generic family-film sameness and over-cute proportions`;
  return `DEFAULT AESTHETIC DIRECTION ${CHARACTER_AESTHETIC_VERSION}: professional animation model-sheet appeal built from a distinctive readable silhouette, harmonious facial construction, one dominant memory feature, two supporting features, clear shape language and a controlled character-specific palette. Eyes, brows and mouth must support nuanced acting while staying anatomically coherent in this style. Preserve age and role; avoid generic template faces, same-face casting, random feature collisions, excessive cuteness, muddy color and noisy costume detail`;
}

function screenCastingBeautyContract(styleName: string) {
  const preset = visualStyle(styleName);
  const medium = preset.category === "写实" ? "feature-film casting" : preset.category === "动画" ? "premium animation character design" : "illustrative character design";
  return `SCREEN-APPEAL CONTRACT: create a ${medium} that audiences can recognize and enjoy watching for many episodes. “Good-looking” means harmonious facial proportions, focused lively eyes, a relaxed expressive mouth, clean face-to-hair silhouette, healthy role-appropriate complexion, coherent grooming, flattering truthful light, and one memorable feature; it never means an interchangeable influencer face. Preserve story-required age, ethnicity, fatigue, scars, body type and social identity. Use a restrained character-specific palette and remove decorative noise that competes with the face.`;
}

function firstDialogueForCharacter(script: string, characterName: string) {
  const escaped = characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const colon = script.match(new RegExp(`^\\s*${escaped}\\s*[：:]\\s*(.+)$`, "im"))?.[1];
  if (colon?.trim()) return colon.trim().replace(/^[-—\s]+/, "").slice(0, 500);
  const screenplay = script.match(new RegExp(`^\\s*${escaped}(?:\\s*\\([^\\n)]*\\))?\\s*$\\r?\\n\\s*(?!INT\\.|EXT\\.|内景|外景)(.+)$`, "im"))?.[1];
  return screenplay?.trim().replace(/^[-—\s]+/, "").slice(0, 500) || "";
}

function spatialContinuityContract(scene: Scene, previousScene?: Scene) {
  const castAnchors = spatialLayoutSummary(scene);
  const props = labeledVisualAssets([scene.visual, scene.action, scene.startState, scene.endState].filter(Boolean).join(" "), "道具");
  const propAnchors = props.map((name) => `${name}: preserve the exact canonical shape, owner and hand/attachment defined by the locked prop asset and scripted start state; never switch hands, teleport, duplicate or respawn`).join(" | ");
  const freeze = positionLockRequested(scene)
    ? " POSITION FREEZE OVERRIDE: the user explicitly requires the composition from shot one/previous approved shot. Keep every named character's normalized x/y center and apparent scale inside the exact written tolerance bounds for the entire clip. Lock crop boundaries, focal length, horizon and headroom. No lane swap, re-centering, body translation, crop jump, shot-size change, orbit, pan, dolly, zoom or reframing that changes these coordinates; permit only scripted limb, facial and lip motion."
    : "";
  return `SPATIAL CONTINUITY LOCK: Use the persistent project spatial map; never recalculate positions from the current cast count and never automatically center a lone character. A previous accepted shot VIDEO may be used as an ordinary @Video all-reference for motion, blocking, palette and camera continuity. Never use an extracted first frame, last frame or tail image as generation input or frame control. Scene world anchor: ${scene.environmentKey || scene.environmentBible || scene.visual}. Start state: ${scene.startState || previousScene?.endState || "inherit every visible character, prop and environment state from the previous accepted shot"}. End state required: ${scene.endState || "preserve all unchanged world states"}. Character anchors: ${castAnchors || "no visible cast; do not invent people"}. Prop anchors: ${propAnchors || "preserve every visible fixed prop and do not invent handheld objects"}. Keep left/right order, foreground/background depth, occlusion, relative distance, eyelines, body pose and prop ownership continuous. No person or object may materialize, morph, duplicate, swap sides, change hands or disappear; entrances and exits must occur naturally through a frame edge, doorway or justified occlusion. Respect the 180-degree line of action.${freeze}`;
}
type Storyboard = { title: string; characters: CharacterAsset[]; music: string; scenes: Scene[] };
type LibTvResult = { kind: "image" | "video"; url: string };
type LibTvMessage = { id: string; seq: number; role: "user" | "assistant"; content: string };
type SeedancePendingTask = { id: string; model: string; createdAt: number; promptSignature?: string };
type SeedanceBlockedReference = { contentIndex: number; kind: string; role?: string; name: string; libraryAssetId?: string; identityKey?: string; lookName?: string };
type SeedancePortraitBlock = { requestId?: string; sceneId?: string; projectId?: string; styleName?: string; blockedReferences: SeedanceBlockedReference[]; createdAt: number };

class SeedanceRequestError extends Error {
  failureKind: string;
  retryable: boolean;
  requestId: string;
  blockedReferences: SeedanceBlockedReference[];
  constructor(message: string, details: { failureKind?: string; retryable?: boolean; requestId?: string; blockedReferences?: SeedanceBlockedReference[] } = {}) {
    super(message);
    this.name = "SeedanceRequestError";
    this.failureKind = details.failureKind || "";
    this.retryable = details.retryable !== false;
    this.requestId = details.requestId || "";
    this.blockedReferences = details.blockedReferences || [];
  }
}

const SAMPLE_STORY = "雨夜，女孩在即将关门的旧书店前，遇见了消失三年的恋人。他带着一封从未寄出的信，藏着两人错过彼此的真相。";
const STUDIO_SESSION_KEY = "manjing-studio-session-v2";
const STUDIO_DRAFTS_KEY = "manjing-studio-drafts-v1";
const NEW_STUDIO_KEY = "manjing-new-studio";
const OPEN_STUDIO_PROJECT_KEY = "manjing-studio-open-project";
const SEEDANCE_PENDING_KEY = "manjing-seedance-pending-v1";
const SEEDANCE_PORTRAIT_BLOCK_KEY = "manjing-seedance-portrait-block-v1";

function durableMediaUrl(url?: string) {
  return url && !url.startsWith("blob:") ? url : undefined;
}

function serializableScene(scene: Scene): Scene {
  return { ...scene, imageUrl: durableMediaUrl(scene.imageUrl), videoPosterUrl: durableMediaUrl(scene.videoPosterUrl), audioUrl: durableMediaUrl(scene.audioUrl), videoUrl: durableMediaUrl(scene.videoUrl), candidateVideoUrl: durableMediaUrl(scene.candidateVideoUrl) };
}

function separateVideoPosterFromLegacyFirstFrame(scene: Scene): Scene {
  if (!scene.imageUrl || scene.videoPosterUrl || (!scene.videoStartFrameUrl && !scene.videoEndFrameUrl)) return scene;
  return { ...scene, videoPosterUrl: scene.imageUrl, imageUrl: undefined };
}

function serializableCharacter(character: CharacterAsset): CharacterAsset {
  return { ...character, imageUrl: durableMediaUrl(character.imageUrl) };
}

function serializableProp(prop: PropAsset): PropAsset {
  return { ...prop, imageUrl: durableMediaUrl(prop.imageUrl) };
}

function serializableSceneAsset(sceneAsset: SceneAsset): SceneAsset {
  return { ...sceneAsset, imageUrl: durableMediaUrl(sceneAsset.imageUrl) };
}
type VisualStylePreset = {
  name: string;
  category: "写实" | "动画" | "艺术";
  description: string;
  preview: string;
  base: string;
  character: string;
  frame: string;
  motion: string;
};

const STYLE_PRESETS: VisualStylePreset[] = [
  {
    name: "电影写实", category: "写实", description: "真人演员、电影镜头与自然皮肤质感", preview: "/styles/cinematic-photoreal.webp",
    base: "photorealistic cinematic live-action, real Chinese actors, natural skin pores and fine facial details, physically accurate lighting, realistic fabric and environment textures, correct anatomy and natural hands, restrained feature-film color grade, 35mm cinema lens, not illustration, not anime, not comic, not 3D",
    character: "live-action casting and wardrobe reference sheet, natural facial asymmetry, realistic hair strands, full body and clean face close-up",
    frame: "live-action feature film still, subtle acting, practical lighting, believable set dressing, shallow depth of field, cinematic composition",
    motion: "realistic actor performance, natural blinking and breathing, subtle facial micro-expressions, physically believable hair and cloth motion",
  },
  {
    name: "欧美电影写实", category: "写实", description: "欧美电影选角、自然多肤色还原与克制胶片质感", preview: "/styles/western-cinematic-realism.webp",
    base: "photorealistic Western live-action feature film, authentic diverse European and North American adult casting, natural individual facial structure and skin texture across all complexions, practical locations and production design, motivated key light and practical sources, wide dynamic range, organic 35mm film texture, restrained cinematic contrast and saturation, natural lens falloff, not illustration, not animation, not comic, not plastic CGI",
    character: "Western live-action feature-film casting and wardrobe continuity sheet, authentic adult facial anatomy and natural asymmetry, accurate complexion and hair texture, clean face close-up plus exact front, side and back full-body wardrobe turnaround",
    frame: "single Western live-action feature-film still, motivated practical lighting, natural skin color, organic highlight roll-off, layered production design, selective cinematic depth of field and emotionally grounded composition",
    motion: "nuanced Western live-action screen performance, natural eye focus, breathing and facial micro-expression, physically believable body mechanics, hair and wardrobe motion, motivated dolly, Steadicam or restrained handheld camera",
  },
  {
    name: "欧美剧集写实", category: "写实", description: "现代欧美生活空间、实用光源与高级流媒体剧集质感", preview: "/styles/western-series-realism.webp",
    base: "photorealistic contemporary Western premium streaming drama, authentic diverse adult ensemble, truthful modern European or North American locations and wardrobe, grounded practical-driven lighting, natural skin tones across all complexions, consistent show LUT, simple readable blocking, elegant restrained camera movement, filmic digital texture, not illustration, not anime, not CGI",
    character: "contemporary Western television casting and wardrobe continuity reference, authentic adult appearance, natural expression and grooming, clean face close-up plus full-body seasonal wardrobe model",
    frame: "single premium Western drama-series frame, believable lived-in location, practical-source lighting, stable show color palette, natural skin rendering, simple blocking and elevated observational composition",
    motion: "truthful conversational acting, restrained gestures and eye-lines, realistic blocking through practical light, elegant subtle camera movement, stable exposure, skin color and show LUT across cuts",
  },
  {
    name: "都市生活写实", category: "写实", description: "当代城市、自然光与生活流表演", preview: "/styles/urban-realism.webp",
    base: "photorealistic contemporary Chinese urban drama, real actors, documentary-level natural detail, soft available light, authentic modern locations and wardrobe, realistic skin and anatomy, understated color grade, not illustration, not anime, not CGI",
    character: "modern live-action casting photo and wardrobe continuity reference, natural expression, full body and face close-up",
    frame: "naturalistic urban television drama frame, believable daily-life production design, observational camera, realistic depth",
    motion: "restrained natural acting, conversational gestures, realistic eye focus, breathing and fabric physics",
  },
  {
    name: "古装剧写实", category: "写实", description: "真人古装、考究服化道与历史氛围", preview: "/styles/historical-live-action.webp",
    base: "photorealistic Chinese historical costume drama, real Chinese actors, period-accurate layered silk and linen costumes, detailed hair ornaments, authentic architecture and props, cinematic practical lighting, natural skin texture, not animation, not illustration",
    character: "live-action historical casting and costume continuity reference, intricate period hairstyle, full body and clean face close-up",
    frame: "prestige historical drama film still, atmospheric lantern light, authentic production design, elegant widescreen composition",
    motion: "graceful but physically realistic period performance, subtle sleeves and hair ornaments moving naturally, restrained facial acting",
  },
  {
    name: "港风复古", category: "写实", description: "90 年代胶片、霓虹街景与浓郁情绪", preview: "/styles/hong-kong-retro.webp",
    base: "photorealistic 1990s Hong Kong cinema, real Chinese actors, 35mm film grain, neon reflected on wet streets, warm tungsten interiors, deep green and red color palette, cinematic halation, realistic anatomy, not illustration",
    character: "live-action Hong Kong film casting portrait and retro wardrobe continuity sheet, natural textured hair and skin",
    frame: "moody 1990s Hong Kong film still, expressive practical neon, subtle film grain, intimate cinematic blocking",
    motion: "natural live-action performance, handheld camera energy, realistic rain, smoke, hair and fabric movement",
  },
  {
    name: "国漫电影感", category: "动画", description: "写意国漫电影、绘制感 CG 与精致漫画线条", preview: "/styles/chinese-animation.webp",
    base: "premium cinematic Chinese animation, stylized painterly CG rendering, refined manhua line language, expressive color design, clearly animated and non-photographic, coherent cinematic art direction",
    character: "Chinese animation character design sheet, painterly stylized rendering, refined line language, consistent face shapes and costume construction across close-up, front, side and back views",
    frame: "cinematic Chinese animation frame, painterly CG and manhua aesthetics, expressive controlled lighting, stable character design, clearly non-live-action",
    motion: "cinematic Chinese animation, stable illustrated character design, expressive but controlled acting, graceful animated camera movement",
  },
  {
    name: "半写实3D国漫", category: "动画", description: "动漫五官、细腻 CG 建模与真实发丝服饰质感", preview: "/styles/chinese-animation.webp",
    base: "premium semi-realistic stylized 3D Chinese animation and CG guoman, anime-informed facial proportions, smooth porcelain toon skin, realistic individual hair strands and fabric texture, PBR-toon hybrid rendering, elegant Chinese cinematic lighting, non-photographic and never live-action",
    character: "semi-realistic 3D Chinese animation production character sheet on a clean neutral background, one large facial close-up plus exact front, side and back full-body turnaround, identical facial topology, hairstyle, costume cut, fabric and accessories in every view",
    frame: "semi-realistic 3D CG guoman film frame, elegant anime-informed face, smooth stylized skin, detailed realistic hair and costume material, locked character topology, clearly animated rather than live-action",
    motion: "high-end semi-realistic 3D Chinese animation, stable stylized facial topology, natural restrained acting, preserved costume construction, cinematic CG camera movement, no photorealistic human conversion",
  },
  {
    name: "日系清新", category: "动画", description: "轻盈日漫、柔和天光与青春气息", preview: "/styles/japanese-anime.webp",
    base: "fresh Japanese anime feature style, delicate clean line art, soft daylight, airy pastel colors, expressive but consistent faces, correct anatomy",
    character: "anime production character sheet, clean cel shading, full body and facial expression close-up",
    frame: "single polished anime film keyframe, poetic light, detailed painted background, cinematic composition",
    motion: "smooth anime acting, subtle eye and mouth animation, gentle wind through hair and clothes",
  },
  {
    name: "美式漫画", category: "动画", description: "大胆墨线、网点与英雄式构图", preview: "/styles/american-comic.webp",
    base: "bold American graphic novel art, confident ink contours, controlled halftone texture, expressive shadows, saturated accent colors, strong anatomy, sophisticated comic illustration",
    character: "graphic novel character design sheet, bold silhouette, full body and expressive portrait",
    frame: "one cinematic graphic-novel frame without panel borders, dynamic perspective, dramatic inked lighting",
    motion: "stylized graphic-novel motion, strong readable poses, controlled parallax and energetic camera movement",
  },
  {
    name: "欧美二维动画", category: "动画", description: "清晰轮廓、平涂色块与富有弹性的角色表演", preview: "/styles/western-2d-animation.webp",
    base: "premium Western 2D television animation, separated clean line-art and controlled color-art language, official locked character color models, graphic cel-shaded color blocks, distinctive silhouette-driven design, strong line of action, elastic but anatomically coherent poses, readable staging, polished hand-drawn production finish, explicitly Western animation and not anime, not manhua, not live action",
    character: "Western 2D animation production model sheet on a clean neutral background, one expressive face close-up plus exact front, side and back full-body turnaround, identical proportions, facial construction, silhouette, costume shapes, line weights and master palette in every view",
    frame: "single polished Western 2D animated-series frame without panels or text, clean line hierarchy, locked master palette and graphic cel shading, instantly readable silhouettes, layered painted background and cinematic staging",
    motion: "fluid Western 2D character animation built from strong readable key poses and line of action, expressive squash and stretch used with restraint, stable facial construction and line weight, temporally coherent color fills, lively timing and clean continuous camera movement",
  },
  {
    name: "欧美院线动画", category: "动画", description: "风格化三维角色、电影灯光与细腻家庭冒险表演", preview: "/styles/western-feature-animation.webp",
    base: "premium Western stylized 3D animated feature, appealing simplified sculpted character shapes, expressive non-anime facial design, locked silhouette and color model, physically based but intentionally stylized materials, soft global illumination, cinematic color scripting, visually clear storybook environments, clearly animated and never photorealistic or live action",
    character: "Western feature-animation character model sheet on a neutral studio background, expressive facial close-up plus exact front, side and back full-body turnaround, locked sculpted facial topology, body proportions, costume construction, materials and palette",
    frame: "single theatrical Western 3D animation frame, sculpted stylized characters, controlled material complexity, rich global illumination, character-specific color scripting, cinematic depth, story-driven composition and production-quality rendering",
    motion: "high-end Western feature animation performance, nuanced readable facial acting, appealing pose rhythm, believable stylized body mechanics, stable topology and materials across time, natural secondary motion and motivated cinematic camera movement",
  },
  {
    name: "欧美3D动漫", category: "动画", description: "欧美剧集式三维角色、利落造型与动作冒险表演", preview: "/styles/western-3d-anime.webp",
    base: "premium Western stylized 3D animated-series CGI, action-adventure tone for teen and adult audiences, sharp graphic silhouettes, animation-ready proportions, expressive rig-friendly faces, clean stable topology, controlled costume detail, toon and PBR hybrid materials, dimensional cinematic lighting, efficient episodic production design, clearly three-dimensional animation, not a graphic novel, not print or comic art, not Japanese anime, not photorealistic live action, not an overly rounded family-feature look",
    character: "Western 3D animated-series production model sheet on a neutral studio background, expressive facial close-up plus exact front, side and back full-body turnaround, locked rig-ready facial topology, mature stylized proportions, clean deformation-friendly costume construction, identical materials and master palette in every view, no comic ink or halftone texture",
    frame: "single polished Western 3D animated-series frame, clearly dimensional CGI characters and environment, sharp readable silhouettes, toon-PBR hybrid surfaces, controlled material complexity, cinematic depth and motivated lighting, dynamic episodic action-adventure staging, no panels, captions, ink outlines, halftones or paper texture",
    motion: "high-quality Western 3D series animation with stable rigged topology, expressive facial and full-body acting, strong readable key poses, believable stylized mechanics, temporally coherent toon-PBR materials, production-friendly secondary motion and continuous dimensional camera movement, no texture crawling, shape popping or live-action conversion",
  },
  {
    name: "欧美成人动画", category: "动画", description: "成熟造型、克制配色与锐利都市黑色幽默", preview: "/styles/western-adult-animation.webp",
    base: "sophisticated Western adult 2D animation, mature angular character proportions and instantly readable silhouettes, crisp economical linework, locked restrained editorial color models, dry cinematic staging, expressive acting without childish cuteness, contemporary urban production design, not anime, not children's cartoon, not live action",
    character: "Western adult-animation production character sheet, mature facial proportions and angular silhouette, restrained cel shading, expressive portrait plus exact front, side and back full-body turnaround with locked wardrobe and palette",
    frame: "single cinematic Western adult-animation frame without captions or panel borders, crisp linework, restrained colors, mature visual tone, readable urban staging and controlled dramatic lighting",
    motion: "controlled Western adult-animation acting, strong key poses with dry precise timing, subtle facial expressions, stable mature proportions, temporally coherent linework and palette, economical gestures and deliberate cinematic camera movement",
  },
  {
    name: "赛博朋克", category: "动画", description: "雨夜霓虹、未来城市与强轮廓光", preview: "/styles/cyberpunk.webp",
    base: "cinematic cyberpunk animation, neon megacity at night, wet reflections, holographic glow, strong rim light, detailed technology, coherent faces and anatomy",
    character: "cyberpunk character design sheet, distinctive futuristic wardrobe and accessories, full body and face close-up",
    frame: "single premium cyberpunk animated-film keyframe, volumetric neon, layered city depth, no comic panels",
    motion: "cinematic cyberpunk performance, animated neon and rain, realistic secondary motion and continuous camera movement",
  },
  {
    name: "3D 动画", category: "动画", description: "院线级三维角色、材质与柔和表演", preview: "/styles/feature-3d.webp",
    base: "polished stylized 3D animated feature, appealing Chinese character design, physically based materials, soft global illumination, detailed environments, correct anatomy, cinematic rendering",
    character: "3D feature-animation character model reference, full body and expressive face close-up, consistent materials and proportions",
    frame: "single theatrical 3D animation frame, cinematic lighting, volumetric depth, production-quality render",
    motion: "appealing 3D character acting, smooth facial animation, believable body mechanics, hair and cloth simulation",
  },
  {
    name: "黑白漫画", category: "动画", description: "高反差墨稿、速度线与日式网点", preview: "/styles/american-comic.webp",
    base: "high-contrast black and white manga, professional ink linework, screentone shading, expressive faces, precise anatomy, crisp white paper texture",
    character: "black-and-white manga character reference sheet, clean contours, full body and facial expression close-up",
    frame: "one complete manga cinematic frame without borders or speech bubbles, dramatic blacks, controlled screentones",
    motion: "dynamic manga-inspired animation, controlled camera movement, ink accents and subtle parallax without text",
  },
  {
    name: "水墨古风", category: "艺术", description: "东方留白、宣纸墨韵与诗意云雾", preview: "/styles/ink-wash.webp",
    base: "Chinese ink-wash animation, expressive brush texture on xuan paper, elegant restrained color accents, poetic mist and negative space, coherent faces and anatomy",
    character: "ink-wash character design reference, expressive brush contours, full body and face study",
    frame: "single poetic Chinese ink-wash animated keyframe, layered mountains and mist, cinematic visual rhythm",
    motion: "flowing ink-wash animation, drifting mist and brush textures, graceful continuous character movement",
  },
  {
    name: "绘本水彩", category: "艺术", description: "透明水色、纸张纹理与温柔叙事", preview: "/styles/watercolor.webp",
    base: "delicate watercolor storybook illustration, transparent pigments, visible cold-press paper texture, gentle edges, luminous color washes, consistent appealing characters",
    character: "watercolor storybook character reference sheet, full body and expressive portrait, clean readable silhouette",
    frame: "single complete watercolor storybook scene, cinematic composition, layered washes and atmospheric depth",
    motion: "gentle storybook animation, subtle watercolor blooms, natural character gestures and slow cinematic camera",
  },
  {
    name: "黏土定格", category: "艺术", description: "手工黏土、微缩布景与定格质感", preview: "/styles/clay-stop-motion.webp",
    base: "handcrafted clay stop-motion film, tactile fingerprints in clay, miniature practical sets, warm studio lighting, charming consistent puppets, realistic material texture",
    character: "clay puppet model sheet, handcrafted wardrobe, full body and face close-up, consistent proportions",
    frame: "single premium stop-motion film frame, miniature set depth, practical light and tactile surfaces",
    motion: "expressive stop-motion puppet acting, deliberate frame-by-frame movement, physical miniature effects",
  },
  {
    name: "油画奇幻", category: "艺术", description: "古典油画笔触与史诗奇幻光线", preview: "/styles/watercolor.webp",
    base: "cinematic fantasy oil painting, rich impasto brushwork, classical chiaroscuro, luminous atmosphere, elegant detailed characters, epic environmental depth",
    character: "fantasy oil-painted character design study, full body and portrait, ornate consistent costume",
    frame: "single cinematic fantasy oil-painting scene, dramatic classical lighting, layered atmospheric perspective",
    motion: "painterly cinematic motion, subtle living brush texture, majestic natural gestures and drifting atmosphere",
  },
  {
    name: "暗黑奇幻", category: "艺术", description: "哥特建筑、低调光影与神秘史诗", preview: "/styles/cyberpunk.webp",
    base: "dark gothic fantasy cinematic art, monumental architecture, moody low-key lighting, intricate costumes, atmospheric fog, sophisticated restrained palette, coherent anatomy",
    character: "dark-fantasy character design sheet, ornate silhouette, full body and expressive portrait",
    frame: "single gothic fantasy cinematic keyframe, deep atmospheric perspective, dramatic motivated light",
    motion: "weighty dark-fantasy performance, believable cloth and fog motion, slow ominous camera movement",
  },
  {
    name: "治愈插画", category: "艺术", description: "温暖色彩、柔软造型与轻松日常", preview: "/styles/watercolor.webp",
    base: "warm healing editorial illustration, soft rounded shapes, gentle textured brushwork, harmonious warm palette, expressive friendly characters, cozy detailed environment",
    character: "warm illustrated character design sheet, approachable silhouette, full body and facial expression close-up",
    frame: "single cozy illustrated film frame, soft light, readable staging and layered environment",
    motion: "gentle charming character animation, relaxed gestures, soft environmental movement and calm camera drift",
  },
];

const STYLE_PROMPTS: Record<string, string> = Object.fromEntries(STYLE_PRESETS.map((preset) => [preset.name, preset.base]));

function normalizedVisualStyleName(name: string) {
  const raw = String(name || "").trim();
  if (STYLE_PROMPTS[raw]) return raw;
  // Older project snapshots and user-entered labels may say “3D漫剧” rather
  // than the exact preset name. They must never fall through to a live-action
  // historical preset, because that incorrectly enables portrait enrollment.
  if (/(?:欧美|western).*(?:3d|三维|cg)|(?:3d|三维|cg).*(?:欧美|western)/iu.test(raw)) return "欧美3D动漫";
  if (/(?:3d|三维|cg|3D漫剧)/iu.test(raw)) return "3D 动画";
  if (/(?:真人|实拍|写实|live[ -]?action|photoreal)/iu.test(raw)) return "电影写实";
  return "国漫电影感";
}

function visualStyle(name: string) {
  const normalized = normalizedVisualStyleName(name);
  return STYLE_PRESETS.find((preset) => preset.name === normalized)
    || STYLE_PRESETS.find((preset) => preset.name === "国漫电影感")
    || STYLE_PRESETS[0];
}

function scriptLanguage(value: string) {
  const latinWords = value.match(/\b[A-Za-z][A-Za-z'’-]*\b/g)?.length || 0;
  const hanCharacters = value.match(/[\u3400-\u9fff]/g)?.length || 0;
  return latinWords >= 12 && latinWords * 2 > hanCharacters ? "English" : "Simplified Chinese";
}

function characterVisualPrompt(name: string) {
  const preset = visualStyle(name);
  return `${preset.base}, ${preset.character}`;
}

type ImageSkillPurpose = "character" | "frame" | "quality";

const IMAGE_SKILLS_BY_PURPOSE: Record<ImageSkillPurpose, string[]> = {
  character: ["preset-image-character-casting-beauty", "preset-image-aesthetic-art-direction"],
  frame: ["preset-image-aesthetic-art-direction", "preset-image-reference-identity-lock"],
  quality: ["preset-image-human-preference-quality-gate"],
};

function configuredImageSkillPrompt(purpose: ImageSkillPurpose) {
  const wanted = new Set(IMAGE_SKILLS_BY_PURPOSE[purpose]);
  const skills = agentContext("image", 250).filter((item) => wanted.has(item.id));
  return {
    ids: skills.map((item) => item.id),
    content: skills.map((item) => item.content.trim()).filter(Boolean).join("\n"),
  };
}

function characterSheetPrompt(styleName: string, character: Pick<CharacterAsset, "name" | "identityName" | "lookName" | "episodeScope" | "role" | "appearance">) {
  const identity = String(character.identityName || character.name).trim();
  const look = characterAssetNaming(character).lookName;
  const aesthetic = configuredImageSkillPrompt("character");
  if (aesthetic.ids.length) markContextUsed(aesthetic.ids);
  return `Create one polished 16:9 production Canonical character card for ${identity}, role: ${character.role}. Current episode look: ${look}. Script facts: ${character.appearance}. Visual medium: ${characterVisualPrompt(styleName)}. ${screenCastingBeautyContract(styleName)} ${characterAestheticDirection(styleName)}. Curated facial design ${stableReuseToken(identity)}: ${characterFaceSignature(identity)}. ${aesthetic.content || "角色必须好看、耐看、符合剧情身份且不与其他角色同脸。"}

FIXED FOUR-ZONE LAYOUT: pure white seamless background, flat even studio illumination, no cast shadow and no environmental distraction. The left 35%-40% of the canvas is one large eye-level strict frontal head-and-shoulders portrait: complete clear facial features, direct focused gaze, relaxed neutral expression, both eyes and both jaw sides visible, face sharp and unobstructed. The right 60%-65% is a vertically ordered three-view turnaround of the exact same person: top = front full-body, middle = 45-degree side full-body, bottom = back full-body. Every full-body view uses the same natural slight T-pose, same height and head-to-body ratio, complete hands and feet, no cropping, no action pose and no perspective distortion. All four zones must depict one identity with identical age, skin tone, skull and hair silhouette, hairline, hairstyle and exact ${look} costume construction, colors, materials and accessories. The frontal close-up is the facial identity authority; relative face attention priority 1.2. The three-view turnaround is the body, hair and costume authority; relative multiview attention priority 1.05. Provider guidance must remain at or below 1.5; these are relative workflow priorities and must not be serialized as unsupported API fields. Use refined color harmony, believable materials and natural anatomy. No extra person, alternate face, left-right inconsistency, head tilt, hair over an eye, hand near face, props, scenery, furniture, text, watermark, labels, border decoration, chibi proportions or cropped limbs. Different cast members must differ in skull silhouette, eyes, nose, mouth, brows, age rhythm and primary memory feature. Extreme high/low-angle or rear three-quarter shots still require an additional matching-angle user reference; this card reduces drift but cannot guarantee engine-level identity invariance.`;
}

function isVisualCharacterAsset(character: Pick<CharacterAsset, "name" | "role" | "appearance">) {
  const name = character.name.trim();
  const role = character.role.trim();
  const description = `${role} ${character.appearance}`;
  const voiceOnlyRole = /^(?:纯)?(?:旁白|画外音|广告声|广播声|系统音|系统播报|提示音|播音|解说|声音|男声|女声|电话声|narrator|voice\s*over|announcer|system\s*voice)$/i.test(role);
  const explicitlyInvisible = /无实体|不出镜|仅声音|只闻其声|画外传来|未实体化|voice[- ]?only|never\s+seen/i.test(description);
  return !isNonCharacterLabel(name) && !isGenericNonAssetCharacter(name) && !voiceOnlyRole && !explicitlyInvisible;
}

function frameVisualPrompt(name: string) {
  const preset = visualStyle(name);
  const aesthetic = configuredImageSkillPrompt("frame");
  return `${preset.base}, ${preset.frame}${aesthetic.content ? `. 默认画面审美指令：${aesthetic.content}` : ""}`;
}

function motionVisualPrompt(name: string) {
  const preset = visualStyle(name);
  return `${preset.base}, ${preset.motion}`;
}

function shotContinuityRule(scene: Scene, previousScene?: Scene) {
  if (!previousScene) return "Opening shot: establish geography, screen direction and the first stable state clearly.";
  const sameEnvironment = Boolean(scene.environmentKey && previousScene.environmentKey === scene.environmentKey);
  const sameSpeakerExchange = Boolean(scene.speaker && previousScene.speaker && scene.speaker !== previousScene.speaker && sameEnvironment);
  const actionCarry = Boolean(previousScene.endState && (scene.startState || scene.action));
  if (!sameEnvironment) return "Scene change: preserve recurring identities and costumes, then use a short restrained fade-in; do not pretend the old location continues.";
  if (sameSpeakerExchange) return "Dialogue coverage: use a clean hard cut or reaction shot, preserve the 180-degree axis, eyelines, screen direction and relative left/right positions.";
  if (actionCarry) return "Match on action: reserve the final 0.5 seconds in a readable transition pose and begin this shot by continuing that pose for about 0.5 seconds; use at most a 0.1-0.2 second soft blend only when needed.";
  return "Same-scene continuation: prefer a clean hard cut. Preserve the fixed environment floor plan, doors, windows, furniture, important-prop coordinates, character blocking zones, geography, exposure, palette, motion amplitude and camera-direction logic.";
}

function cinematicCameraPlan(scene: Pick<Scene, "camera" | "action" | "dialogue" | "shot" | "videoRevisionRequest" | "consistencyReport">, sceneIndex: number, previousScene?: Pick<Scene, "camera">) {
  if (positionLockRequested(scene)) return "LOCKED CAMERA AND CROP OVERRIDE：固定机位、固定焦段、固定裁切边界、地平线和头部留白，保持上一条已批准视频/分镜一的归一化 x/y 坐标与人物画面比例；禁止横移、环绕、推拉、变焦、升降、景别变化、重新取景和自动居中，只允许不改变人物坐标区间的轻微自然呼吸感";
  const requested = String(scene.camera || "").trim();
  const context = `${scene.action} ${scene.dialogue} ${scene.shot}`;
  const generic = !requested || /^(?:缓慢)?(?:推进|推近|拉远|固定镜头|镜头)$/i.test(requested) || /^(?:slow )?(?:push|pull|zoom)(?: in| out)?$/i.test(requested);
  const plans = /追|跑|走|进入|离开|跟随|follow|walk|run/i.test(context)
    ? ["稳定器侧后方跟拍，保持人物速度，动作结束时轻柔横移到侧面构图", "与人物平行的横向轨道跟拍，利用前景遮挡自然擦镜衔接"]
    : /对话|质问|回答|说|沉默|看向|dialogue|talk|reply/i.test(context)
      ? ["沿180度轴做克制的肩后横移，在说话人与反应者之间完成视线引导", "慢速弧形环绕15至25度，保持眼线与左右关系，不做直线推拉"]
      : /发现|揭示|出现|打开|抬头|俯视|reveal|discover|open/i.test(context)
        ? ["从前景遮挡后横摇揭示主体，随后短距离升降稳定落位", "低位滑轨横移配合轻微上摇，在动作发生点完成构图揭示"]
        : /冲突|打斗|转身|跌落|抓住|奔跑|fight|turn|fall|grab/i.test(context)
          ? ["受控手持跟随并在关键动作处做半环绕，保持地平线和人物拓扑稳定", "斜向轨道移动配合短促摇镜跟动作，不使用变焦推拉"]
          : ["前景视差横向滑轨，镜头速度缓入缓出并在结尾稳定停住", "小幅升降摇臂结合横摇，利用空间层次改变构图", "围绕主体做20度以内克制弧线运动，保持背景几何连续", "静态机位起步后缓慢侧移，让人物动作而非变焦推动画面"];
  let chosen = plans[sceneIndex % plans.length];
  if (previousScene?.camera && previousScene.camera.includes(chosen.slice(0, 4))) chosen = plans[(sceneIndex + 1) % plans.length];
  const base = generic ? chosen : requested;
  return `${base}；使用 ease-in/ease-out，镜头开头继承上一镜运动方向和速度，结尾预留约0.4秒稳定姿态供下一镜衔接；禁止无动机的反复推进、拉远或突然变焦`;
}
const VOICES = [
  { value: "nova", label: "温柔女声" },
  { value: "coral", label: "叙事女声" },
  { value: "onyx", label: "沉稳男声" },
  { value: "echo", label: "青年男声" },
];
const MOTION_OPTIONS: Array<{ value: MotionPreset; label: string }> = [
  { value: "push", label: "缓慢推进" },
  { value: "pull", label: "拉远揭示" },
  { value: "pan-left", label: "向左横移" },
  { value: "pan-right", label: "向右横移" },
  { value: "float", label: "悬浮手持感" },
];
const TRANSITION_OPTIONS: Array<{ value: TransitionPreset; label: string }> = [
  { value: "fade", label: "叠化" },
  { value: "cut", label: "硬切" },
  { value: "flash", label: "闪白" },
];

const AGENT_ROLES: Array<{ id: AgentRole; icon: string; title: string; duty: string; recommends: string[] }> = [
  { id: "director", icon: "导", title: "导演 AI", duty: "审片、纠错、统一风格与节奏", recommends: ["GPT-5.6 Terra", "Gemini 3 Pro", "Qwen 3.5"] },
  { id: "writer", icon: "编", title: "编剧与分镜 AI", duty: "剧本改编、分镜表、提示词", recommends: ["GPT-5.6 Luna", "Gemini 3 Flash", "DeepSeek"] },
  { id: "prompt", icon: "控", title: "镜头总控 AI", duty: "调用资产、继承状态、整合最终视频提示词", recommends: ["GPT-5.6 Luna", "Gemini 3 Flash", "Qwen 3.5"] },
  { id: "image", icon: "图", title: "生图 AI", duty: "角色设定、场景与一致性关键帧", recommends: ["GPT Image 2", "Nano Banana", "FLUX"] },
  { id: "video", icon: "影", title: "视频 AI", duty: "文生视频、图生视频、参考图生视频", recommends: ["Veo 3.1", "Sora 2", "Seedance 2.0"] },
  { id: "voice", icon: "声", title: "配音 AI", duty: "角色音色、情绪、对白与旁白", recommends: ["Eleven v3", "Gemini TTS", "OpenAI Speech"] },
  { id: "editor", icon: "剪", title: "剪辑 AI", duty: "节奏、镜头排序、字幕与混音", recommends: ["漫镜智能剪辑", "GPT-5.6 Terra", "自定义工作流"] },
];
const CUSTOM_TEXT_ADAPTERS: AgentAdapter[] = ["openai", "anthropic", "gemini", "webhook"];

const AGENT_PRESETS: Record<AgentRole, AgentPreset[]> = {
  director: [
    { id: "horde-director", adapter: "horde", name: "AI Horde 导演", model: "Qwen 自动调度", note: "免费默认 · 独立复核剧本", badge: "免费" },
    { id: "pollinations-director", adapter: "pollinations", name: "Pollinations 导演", model: "openai", note: "推荐 · 需要发布密钥", badge: "推荐" },
    { id: "webhook-director", adapter: "webhook", name: "自定义导演接口", model: "your-director-model", note: "漫镜通用 Webhook" },
  ],
  writer: [
    { id: "horde-writer", adapter: "horde", name: "AI Horde 编剧", model: "Gemma 自动调度", note: "免费默认 · 剧本与分镜", badge: "免费" },
    { id: "pollinations-writer", adapter: "pollinations", name: "Pollinations 编剧", model: "openai", note: "推荐 · JSON 分镜", badge: "推荐" },
    { id: "webhook-writer", adapter: "webhook", name: "自定义语言模型", model: "your-llm", note: "OpenAI 兼容或自建转接" },
  ],
  prompt: [
    { id: "browser-prompt", adapter: "browser", name: "漫镜本地镜头总控", model: "Manjing Shot Compiler", note: "免费默认 · 资产绑定、状态继承与提示词编译", badge: "内置" },
    { id: "pollinations-prompt", adapter: "pollinations", name: "Pollinations 镜头总控", model: "openai", note: "推荐 · 智能整合 Seedance 提示词", badge: "推荐" },
    { id: "openai-prompt", adapter: "openai", name: "OpenAI 官方镜头总控", model: "gpt-5", endpoint: "https://api.openai.com/v1", note: "OpenAI 官方 API · 独立 Key 与模型 ID", badge: "官方" },
    { id: "openai-compatible-prompt", adapter: "openai", name: "OpenAI 兼容自定义接口", model: "your-model", endpoint: "", note: "自定义 Base URL、API Key 与模型 ID" },
    { id: "webhook-prompt", adapter: "webhook", name: "自定义镜头总控接口", model: "your-prompt-model", note: "OpenAI 兼容或自建提示词模型" },
  ],
  image: [
    { id: "horde-image", adapter: "horde", name: "AI Horde 生图", model: "Stable Horde", note: "免费默认 · 需要排队", badge: "免费" },
    { id: "pollinations-image", adapter: "pollinations", name: "Pollinations 生图", model: "kontext", note: "推荐 · 支持角色参考图", badge: "推荐" },
    { id: "comfyui-image", adapter: "webhook", name: "本地 ComfyUI 生图", model: "ComfyUI Image Workflow", note: "开源节点 · 通过漫镜桥接服务调用" },
    { id: "webhook-image", adapter: "webhook", name: "自定义生图接口", model: "gpt-image-2", note: "可接 GPT Image、FLUX 等" },
  ],
  video: [
    { id: "browser-video", adapter: "browser", name: "本地 2.5D 运镜", model: "Depth Motion", note: "免费默认 · 推拉/横移/景深光效，人物不会生成新动作", badge: "免费" },
    { id: "pollinations-video", adapter: "pollinations", name: "Pollinations 视频", model: "seedance-2.0", note: "推荐 · 文/图/参考图生视频", badge: "推荐" },
    { id: "volc-seedance", adapter: "seedance", name: "Seedance 2.0 · 方舟", model: "doubao-seedance-2-0-260128", note: "火山方舟 Ark API · 文生视频、图生视频与原生音轨", badge: "官方" },
    { id: "wan22-video", adapter: "webhook", name: "本地 Wan2.2 视频", model: "Wan2.2 / ComfyUI", note: "开源节点 · 真实图生视频，需要本机 GPU" },
    { id: "webhook-video", adapter: "webhook", name: "自定义视频接口", model: "veo-3.1", note: "可接 Veo、Sora、Seedance" },
  ],
  voice: [
    { id: "browser-voice", adapter: "browser", name: "系统中文语音", model: "Web Speech", note: "免费默认 · 使用本机音色", badge: "免费" },
    { id: "pollinations-voice", adapter: "pollinations", name: "Pollinations 配音", model: "tts", note: "推荐 · 分角色生成音轨", badge: "推荐" },
    { id: "cosyvoice-voice", adapter: "webhook", name: "本地 CosyVoice", model: "CosyVoice", note: "开源节点 · 中文情绪配音与声音复刻" },
    { id: "vibevoice-realtime-voice", adapter: "webhook", name: "VibeVoice Realtime", model: "VibeVoice-Realtime-0.5B", note: "微软开源实验节点 · 英文单角色流式配音" },
    { id: "webhook-voice", adapter: "webhook", name: "自定义配音接口", model: "eleven-v3", note: "可接 ElevenLabs、Gemini TTS" },
  ],
  editor: [
    { id: "browser-editor", adapter: "browser", name: "漫镜智能剪辑", model: "AutoCut v1", note: "免费默认 · 本地合成", badge: "免费" },
    { id: "pollinations-editor", adapter: "pollinations", name: "Pollinations 剪辑师", model: "openai", note: "推荐 · AI 先给节奏方案", badge: "推荐" },
    { id: "webhook-editor", adapter: "webhook", name: "自定义剪辑接口", model: "your-editor-agent", note: "返回镜头顺序与时长" },
  ],
};

function configFromPreset(role: AgentRole, presetId: string): AgentConfig {
  const preset = AGENT_PRESETS[role].find((item) => item.id === presetId) || AGENT_PRESETS[role][0];
  return { preset: preset.id, adapter: preset.adapter, model: preset.model, endpoint: preset.endpoint || "", apiKey: "" };
}

function makeTeam(profile: "free" | "pollinations"): Record<AgentRole, AgentConfig> {
  return Object.fromEntries(AGENT_ROLES.map(({ id }) => [id, configFromPreset(id, profile === "free" ? AGENT_PRESETS[id][0].id : AGENT_PRESETS[id][1].id)])) as Record<AgentRole, AgentConfig>;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clipStoryboardText(value: string, limit: number) {
  const text = value.trim();
  if (text.length <= limit) return text;
  const headLength = Math.floor(limit * 0.68);
  const tailLength = Math.max(0, limit - headLength - 32);
  return `${text.slice(0, headLength)}\n\n【中段已压缩，保留结尾】\n\n${text.slice(-tailLength)}`;
}

function compactStoryboardContext(value: string, limit = 14000) {
  const text = value.trim();
  if (text.length <= limit) return text;
  const marker = "【本集完整剧本】";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return clipStoryboardText(text, limit);
  const rules = text.slice(0, markerIndex).trim();
  const episode = text.slice(markerIndex + marker.length).trim();
  const rulesBudget = Math.min(3200, Math.floor(limit * 0.24));
  const compactRules = clipStoryboardText(rules, rulesBudget);
  const episodeBudget = Math.max(8000, limit - compactRules.length - marker.length - 8);
  return `${compactRules}\n\n${marker}\n${clipStoryboardText(episode, episodeBudget)}`;
}

async function withStageTimeout<T>(task: Promise<T>, timeoutMs: number, message: string) {
  let timer = 0;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

async function withStageProgress<T>(task: Promise<T>, hardTimeoutMs: number, timeoutMessage: string, onTick: (elapsedSeconds: number) => void) {
  const startedAt = Date.now();
  const ticker = window.setInterval(() => onTick(Math.floor((Date.now() - startedAt) / 1000)), 10000);
  try {
    return await withStageTimeout(task, hardTimeoutMs, timeoutMessage);
  } finally {
    window.clearInterval(ticker);
  }
}

async function fetchWithHardTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, timeoutMessage: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (reason) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw reason;
  } finally {
    window.clearTimeout(timer);
  }
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function responseError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error || data.message || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

async function responseFailure(response: Response) {
  try {
    const data = (await response.json()) as { error?: string; message?: string; failureKind?: string; retryable?: boolean; requestId?: string; blockedReferences?: SeedanceBlockedReference[] };
    return new SeedanceRequestError(data.error || data.message || `请求失败（${response.status}）`, data);
  } catch {
    return new SeedanceRequestError(`请求失败（${response.status}）`, { retryable: response.status >= 500 });
  }
}

function validAgentEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function closeTruncatedJson(source: string) {
  const start = source.indexOf("{");
  if (start < 0) return "";
  let repaired = source.slice(start).trim();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of repaired) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" && stack.at(-1) === "{") stack.pop();
    else if (character === "]" && stack.at(-1) === "[") stack.pop();
  }
  if (inString) {
    if (escaped) repaired = repaired.slice(0, -1);
    repaired += '"';
  }
  repaired = repaired.trimEnd();
  if (repaired.endsWith(":")) repaired += "null";
  else if (repaired.endsWith(",")) repaired = repaired.slice(0, -1);
  while (stack.length) repaired += stack.pop() === "{" ? "}" : "]";
  return repaired;
}

function sceneCountForDuration(seconds: number) {
  return Math.max(1, Math.min(8, Math.ceil(Math.max(1, seconds) / 15)));
}

function normalizeSceneDurations(items: Array<Record<string, unknown>>, targetSeconds: number) {
  if (!items.length) return [];
  if (targetSeconds <= 15) return [Math.max(1, Math.round(targetSeconds))];
  const target = Math.max(items.length, Math.round(targetSeconds));
  const raw = items.map((item) => Math.max(1, Math.min(15, Number(item.duration) || target / items.length)));
  const rawTotal = raw.reduce((sum, value) => sum + value, 0) || 1;
  const durations = raw.map((value) => Math.max(1, Math.min(15, Math.round(value * target / rawTotal))));
  let delta = target - durations.reduce((sum, value) => sum + value, 0);
  while (delta !== 0) {
    let changed = false;
    for (let index = 0; index < durations.length && delta !== 0; index += 1) {
      if (delta > 0 && durations[index] < 15) {
        durations[index] += 1;
        delta -= 1;
        changed = true;
      } else if (delta < 0 && durations[index] > 1) {
        durations[index] -= 1;
        delta += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return durations;
}

function parseStoryboard(raw: string, targetSeconds: number, minimumScenes = 1, maximumScenes = 8): Storyboard {
  const unfenced = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0) throw new Error("AI 没有返回可识别的剧本，请重试");
  let parsed: Record<string, unknown> | null = null;
  try {
    if (end > start) parsed = JSON.parse(unfenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(closeTruncatedJson(unfenced)) as Record<string, unknown>;
    } catch {
      throw new Error("免费模型的剧本输出被截断，请再次生成");
    }
  }
  // Models in the configured text-agent ecosystem commonly use shots,
  // storyboard or frames despite being asked for scenes. Treat these as the
  // same production unit instead of discarding an otherwise valid response.
  const storyboardPayload = parsed.storyboard && typeof parsed.storyboard === "object" && !Array.isArray(parsed.storyboard)
    ? parsed.storyboard as Record<string, unknown>
    : parsed;
  const sceneSource = ([storyboardPayload.scenes, storyboardPayload.s, storyboardPayload.shots, storyboardPayload.frames, parsed.shots, parsed.frames]
    .find((value): value is unknown[] => Array.isArray(value)) || [])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  if (sceneSource.length < minimumScenes) throw new Error("AI 没有生成足够的完整分镜，请再次生成");
  const picked = sceneSource.slice(0, targetSeconds <= 15 ? 1 : Math.max(minimumScenes, Math.min(16, maximumScenes)));
  const normalizedDurations = normalizeSceneDurations(picked, targetSeconds);
  const characterSource = ([storyboardPayload.characters, storyboardPayload.c, storyboardPayload.cast, parsed.characters, parsed.cast]
    .find((value): value is unknown[] => Array.isArray(value)) || [])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const rawCharacters = characterSource.slice(0, 16);
  const characters: CharacterAsset[] = deduplicateCharacterAssets(rawCharacters.map((item, index) => ({
    id: uid(),
    name: String(item.identityName || item.identity || item.name || item.n || `角色 ${index + 1}`).slice(0, 24),
    identityName: String(item.identityName || item.identity || item.name || item.n || `角色 ${index + 1}`).slice(0, 24),
    lookName: String(item.lookName || item.look || item.variant || "基础版").slice(0, 40),
    episodeScope: String(item.episodeScope || item.episode || "当前集").slice(0, 60),
    sceneHints: Array.isArray(item.sceneHints) ? item.sceneHints.map(String).slice(0, 20) : [],
    role: String(item.role || item.r || (index === 0 ? "主角" : "重要角色")).slice(0, 24),
    appearance: String(item.appearance || item.a || "具有鲜明辨识度的年轻角色，固定发型、五官与服装").slice(0, 260),
    voice: ["nova", "coral", "onyx", "echo"].includes(String(item.voice || item.v)) ? String(item.voice || item.v) : VOICES[index % VOICES.length].value,
    status: "queued" as const,
  })));
  if (!characters.length) characters.push({ id: uid(), name: "主角", role: "故事主角", appearance: "与剧情匹配、具有鲜明辨识度的年轻角色，固定五官、发型和服装", voice: "nova", status: "queued" });
  return {
    title: String(storyboardPayload.title || storyboardPayload.t || parsed.title || parsed.t || "未命名漫剧").slice(0, 32),
    characters,
    music: String(storyboardPayload.music || storyboardPayload.m || parsed.music || parsed.m || "cinematic emotional Chinese animation soundtrack, instrumental, no vocals").slice(0, 220),
    scenes: picked.map((item, index) => ({
      id: uid(),
      title: String(item.title || item.t || `镜头 ${index + 1}`).slice(0, 32),
      visual: String(item.visual || item.v || item.description || "电影感人物场景").slice(0, 520),
      action: String(item.action || item.a || "角色做出符合剧情的自然动作与表情变化").slice(0, 220),
      shot: String(item.shot || item.h || "中景").slice(0, 24),
      camera: String(item.camera || item.k || "缓慢推进").slice(0, 60),
      dialogue: String(item.dialogue || item.d || "……").replace(/^[“\"']|[”\"']$/g, "").slice(0, 120),
      speaker: String(item.speaker || item.p || characters[0].name).slice(0, 16),
      emotion: String(item.emotion || item.e || "克制").slice(0, 24),
      sfx: String(item.sfx || item.x || "环境氛围声").slice(0, 80),
      characters: Array.isArray(item.characters) ? item.characters.map(String).slice(0, 8) : Array.isArray(item.c) ? item.c.map(String).slice(0, 8) : [String(item.speaker || item.p || characters[0].name)],
      characterLooks: item.characterLooks && typeof item.characterLooks === "object" && !Array.isArray(item.characterLooks)
        ? Object.fromEntries(Object.entries(item.characterLooks as Record<string, unknown>).map(([name, look]) => [name.slice(0, 24), String(look).slice(0, 40)]))
        : item.looks && typeof item.looks === "object" && !Array.isArray(item.looks)
          ? Object.fromEntries(Object.entries(item.looks as Record<string, unknown>).map(([name, look]) => [name.slice(0, 24), String(look).slice(0, 40)]))
          : undefined,
      duration: normalizedDurations[index],
      environmentKey: String(item.environmentKey || item.location || item.l || item.environment || `场景-${index + 1}`).slice(0, 60),
      environmentBible: String(item.environmentBible || item.background || item.b || item.visual || "保持场景空间布局、固定道具、光线方向与时间天气一致").slice(0, 520),
      continuity: String(item.continuity || item.link || (index === 0 ? "开场建立镜头" : "承接上一镜结束状态，保持人物位置、朝向、道具和动作方向连续")).slice(0, 260),
      endState: String(item.endState || item.end || "记录人物最终位置、朝向、手持道具与动作结束姿态").slice(0, 260),
      status: "queued",
      motion: (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4],
      motionIntensity: 1,
      transition: index === 0 ? "cut" : "fade",
      filter: "none",
      speed: 1,
      volume: 1,
      subtitleEnabled: true,
      subtitlePosition: "bottom",
    })),
  };
}

function storyboardDraft(title: string, music: string, cast: CharacterAsset[], work: Scene[]) {
  return JSON.stringify({
    title,
    music,
    characters: cast.map((character) => ({ name: character.name, identityName: characterIdentity(character), lookName: characterLook(character), episodeScope: character.episodeScope, sceneHints: character.sceneHints, role: character.role, appearance: character.appearance, voice: character.voice })),
    scenes: work.map((scene) => ({ id: scene.id, title: scene.title, characters: scene.characters, characterLooks: scene.characterLooks, shot: scene.shot, visual: scene.visual, action: scene.action, camera: scene.camera, speaker: scene.speaker, emotion: scene.emotion, dialogue: scene.dialogue, sfx: scene.sfx, duration: scene.duration })),
  });
}

function mergeReviewedStoryboard(reviewed: Storyboard, previousCast: CharacterAsset[], previousScenes: Scene[]) {
  const characters = reviewed.characters.map((character, index) => {
    const previous = previousCast.find((item) => characterIdentity(item) === characterIdentity(character) && characterLook(item) === characterLook(character)) || previousCast[index];
    return previous ? { ...character, id: previous.id, imageUrl: previous.imageUrl, remoteUrl: previous.remoteUrl, arkAssetId: previous.arkAssetId, portraitAuthorizationStatus: previous.portraitAuthorizationStatus, status: previous.status } : character;
  });
  const scenes = reviewed.scenes.map((scene, index) => {
    const previous = previousScenes[index];
    if (!previous) return scene;
    return {
      ...previous,
      ...scene,
      id: previous.id,
      imageUrl: previous.imageUrl,
      remoteImageUrl: previous.remoteImageUrl,
      audioUrl: previous.audioUrl,
      videoUrl: previous.videoUrl,
      status: previous.videoUrl || previous.imageUrl ? "ready" as SceneStatus : "queued" as SceneStatus,
    };
  });
  return { ...reviewed, characters, scenes };
}

function completeFreeStoryboard(partial: Storyboard | null, story: string, visualStyle: string, targetSeconds: number): Storyboard {
  const count = targetSeconds <= 15 ? 1 : Math.max(sceneCountForDuration(targetSeconds), partial?.scenes.length || 0);
  const premise = story.replace(/\s+/g, " ").slice(0, 140);
  const characters: CharacterAsset[] = partial?.characters?.length ? partial.characters : [
    { id: uid(), name: "主角", role: "故事推动者", appearance: `${visualStyle}风格，具有明确五官、固定发型和标志性服装的年轻主角`, voice: "nova", status: "queued" as const },
    { id: uid(), name: "关键人物", role: "冲突与秘密的承载者", appearance: `${visualStyle}风格，与主角形成轮廓和色彩对比，固定服装与神态`, voice: "onyx", status: "queued" as const },
  ];
  const beats = [
    { title: "异样开场", shot: "全景转中景", camera: "缓慢推进", visual: `建立故事空间与时间，围绕“${premise}”呈现一个反常细节，电影感光影和明确前后景`, action: "主角进入环境并注意到异常，先停顿观察，再主动靠近关键线索", dialogue: "这里，和我记得的不一样。", emotion: "警觉", sfx: "环境底噪渐弱，细微提示音出现" },
    { title: "线索逼近", shot: "双人中景", camera: "跟拍后轻微环绕", visual: "关键人物或关键物件进入画面，构图把双方关系和隐藏信息同时交代清楚", action: "主角试探，对方回避，动作和视线逐步暴露双方掌握的信息并不对等", dialogue: "你是不是早就知道了？", emotion: "克制质问", sfx: "脚步、衣料摩擦与短促停顿" },
    { title: "冲突反转", shot: "近景与特写", camera: "快速推近后停住", visual: "矛盾在同一空间内爆发，通过表情、手部动作和关键证据形成视觉反转", action: "关键人物揭开部分真相，主角从拒绝相信转为必须立即作出选择", dialogue: "如果现在不选，就再也来不及了。", emotion: "急迫", sfx: "低频冲击后瞬间安静" },
    { title: "悬念收束", shot: "特写转远景", camera: "拉远并留下空镜", visual: "主角做出第一步选择，但画面边缘出现新的代价或更大秘密，形成下一集钩子", action: "主角伸手触碰关键物件，画面在结果揭晓前切黑，只留下新的异常信号", dialogue: "原来，这才是开始。", emotion: "震惊后坚定", sfx: "心跳、信号声与切黑余响" },
  ];
  const existing = partial?.scenes?.filter(Boolean) || [];
  const durationSources = Array.from({ length: count }, (_, index) => ({ duration: existing[index]?.duration || targetSeconds / count }));
  const normalizedDurations = normalizeSceneDurations(durationSources, targetSeconds);
  const names = [...new Map(characters.map((character) => [characterIdentity(character), character.name])).values()].slice(0, 2);
  const scenes: Scene[] = Array.from({ length: count }, (_, index) => {
    const source = existing[index];
    // The fallback beat library is intentionally reusable. Long productions
    // often need more than four shots; cycling prevents the fifth generated
    // shell from becoming undefined while keeping the dramatic progression.
    const beat = beats[index % beats.length];
    return source ? { ...source, duration: normalizedDurations[index], motion: source.motion || (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4], motionIntensity: source.motionIntensity || 1, transition: source.transition || (index === 0 ? "cut" : "fade"), filter: source.filter || "none", speed: source.speed || 1, volume: source.volume ?? 1, subtitleEnabled: source.subtitleEnabled !== false, subtitlePosition: source.subtitlePosition || "bottom" } : {
      id: uid(),
      title: beat.title,
      visual: beat.visual,
      action: beat.action,
      shot: beat.shot,
      camera: beat.camera,
      dialogue: beat.dialogue,
      speaker: characters[0].name,
      emotion: beat.emotion,
      sfx: beat.sfx,
      characters: names,
      duration: normalizedDurations[index],
      status: "queued" as SceneStatus,
      motion: (["push", "pan-right", "pull", "pan-left"] as MotionPreset[])[index % 4],
      motionIntensity: 1,
      transition: (index === 0 ? "cut" : "fade") as TransitionPreset,
      filter: "none" as VisualFilter,
      speed: 1,
      volume: 1,
      subtitleEnabled: true,
      subtitlePosition: "bottom" as SubtitlePosition,
    };
  });
  return {
    title: partial?.title || "自动补全漫剧",
    characters,
    music: partial?.music || "cinematic emotional Chinese animation soundtrack, instrumental, rising tension, no vocals",
    scenes,
  };
}

async function mediaDuration(url: string) {
  return new Promise<number>((resolve) => {
    const audio = new Audio(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
  });
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3) {
  let line = "";
  let row = 0;
  for (const char of text) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + row * lineHeight);
      line = char;
      row += 1;
      if (row >= maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && row < maxLines) ctx.fillText(line, x, y + row * lineHeight);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  width: number,
  height: number,
  zoom = 1,
  panX = 0,
  panY = 0,
  opacity = 1,
) {
  const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media instanceof HTMLImageElement ? media.naturalWidth : width;
  const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media instanceof HTMLImageElement ? media.naturalHeight : height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * zoom;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const overflowX = Math.max(0, drawWidth - width);
  const overflowY = Math.max(0, drawHeight - height);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(
    media,
    (width - drawWidth) / 2 + panX * overflowX * 0.46,
    (height - drawHeight) / 2 + panY * overflowY * 0.46,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
}

async function normalizeImageBlobForAspect(blob: Blob, aspect: "9:16" | "16:9", purpose: "standard" | "character-card" = "standard") {
  const bitmap = await createImageBitmap(blob);
  const width = purpose === "character-card" ? 1792 : aspect === "9:16" ? 720 : 1280;
  const height = purpose === "character-card" ? 1024 : aspect === "9:16" ? 1280 : 720;
  const targetRatio = width / height;
  const sourceRatio = bitmap.width / bitmap.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;
  if (sourceRatio > targetRatio) {
    sourceWidth = bitmap.height * targetRatio;
    sourceX = (bitmap.width - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = bitmap.width / targetRatio;
    sourceY = (bitmap.height - sourceHeight) / 2;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("无法建立视频关键帧画布");
  }
  context.fillStyle = "#111";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  bitmap.close();
  const normalized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  if (!normalized) throw new Error("无法把生图结果转换为视频关键帧尺寸");
  return normalized;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("关键帧读取失败"));
    reader.readAsDataURL(blob);
  });
}

function drawMovingShot(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  width: number,
  height: number,
  index: number,
  progress: number,
  opacity = 1,
  motion: MotionPreset = "push",
  intensity = 1,
) {
  const eased = 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, progress))) / 2;
  const strength = Math.max(0.35, Math.min(1.8, intensity));
  let panX = 0;
  let panY = 0;
  let zoom = 1.05 + eased * 0.08 * strength;
  if (motion === "pull") zoom = 1.16 - eased * 0.1 * strength;
  if (motion === "pan-left") { panX = 1 - eased * 2; zoom = 1.11; }
  if (motion === "pan-right") { panX = eased * 2 - 1; zoom = 1.11; }
  if (motion === "float") {
    panX = Math.sin((progress * 2 + index) * Math.PI) * 0.24 * strength;
    panY = Math.cos((progress * 1.6 + index) * Math.PI) * 0.18 * strength;
    zoom = 1.085 + Math.sin(progress * Math.PI) * 0.025 * strength;
  }
  if (!(media instanceof HTMLVideoElement)) {
    ctx.save();
    ctx.filter = "blur(18px) saturate(.82) brightness(.58)";
    drawCover(ctx, media, width, height, 1.22, -panX * 0.2, -panY * 0.2, opacity);
    ctx.restore();
  }
  drawCover(ctx, media, width, height, zoom, panX, panY, opacity);
  if (!(media instanceof HTMLVideoElement)) {
    const lightX = width * (-0.25 + progress * 1.5);
    const glow = ctx.createRadialGradient(lightX, height * 0.22, 0, lightX, height * 0.22, width * 0.7);
    glow.addColorStop(0, `rgba(210,190,255,${0.11 * opacity})`);
    glow.addColorStop(1, "rgba(210,190,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
}

export default function StudioClient({ surface = "studio" }: { surface?: "studio" | "legacy-editor" }) {
  const router = useRouter();
  const [story, setStory] = useState(SAMPLE_STORY);
  const [projectTitle, setProjectTitle] = useState("雨夜重逢");
  const [style, setStyle] = useState("国漫电影感");
  const [targetDuration, setTargetDuration] = useState(30);
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [mode, setMode] = useState<Mode>("community");
  const [apiKey, setApiKey] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voice, setVoice] = useState("nova");
  const [bgmEnabled, setBgmEnabled] = useState(true);
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [propAssets, setPropAssets] = useState<PropAsset[]>([]);
  const [sceneAssets, setSceneAssets] = useState<SceneAsset[]>([]);
  const [voiceProfiles, setVoiceProfiles] = useState<LibraryAsset[]>([]);
  const [assetAnalysisState, setAssetAnalysisState] = useState<AssetAnalysisState>("idle");
  const [assetAction, setAssetAction] = useState("");
  const [assetImagePreview, setAssetImagePreview] = useState<{ url: string; name: string } | null>(null);
  const [assetPairingSummary, setAssetPairingSummary] = useState("尚未执行生成前资产配对");
  const [videoReviewPreview, setVideoReviewPreview] = useState<{ url: string; name: string } | null>(null);
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [musicReviewDecision, setMusicReviewDecision] = useState<UserReviewDecision>("approved");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("等待创作");
  const [error, setError] = useState("");
  const [seedancePortraitBlock, setSeedancePortraitBlock] = useState<SeedancePortraitBlock | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [exportUrl, setExportUrl] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [showFilm, setShowFilm] = useState(false);
  const [agentConfigs, setAgentConfigs] = useState<Record<AgentRole, AgentConfig>>(() => makeTeam("free"));
  const [agentTeamLoaded, setAgentTeamLoaded] = useState(false);
  const [configuringRole, setConfiguringRole] = useState<AgentRole | null>(null);
  const [quickModelRole, setQuickModelRole] = useState<AgentRole | null>(null);
  const [quickModelDraft, setQuickModelDraft] = useState<QuickModelDraft>({ name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" });
  const [quickModelMessage, setQuickModelMessage] = useState("");
  const [quickModelLoading, setQuickModelLoading] = useState(false);
  const [quickModelSaving, setQuickModelSaving] = useState(false);
  const [quickModelOptions, setQuickModelOptions] = useState<DiscoveredModel[]>([]);
  const [roleSaveState, setRoleSaveState] = useState<RoleSaveState>({ role: null, state: "idle", message: "" });
  const [roleModelOptions, setRoleModelOptions] = useState<Partial<Record<AgentRole, DiscoveredModel[]>>>({});
  const [roleModelLoading, setRoleModelLoading] = useState<AgentRole | null>(null);
  const [retryingRole, setRetryingRole] = useState<AgentRole | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [draggingScene, setDraggingScene] = useState<number | null>(null);
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [musicVolume, setMusicVolume] = useState(0.16);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [bridgeUrl, setBridgeUrl] = useState("");
  const [bridgeToken, setBridgeToken] = useState("");
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealth>({ state: "idle", message: "尚未检测" });
  const [lipsyncEnabled, setLipsyncEnabled] = useState(false);
  const [libtvAccessKey, setLibtvAccessKey] = useState("");
  const [libtvSessionId, setLibtvSessionId] = useState("");
  const [libtvProjectUrl, setLibtvProjectUrl] = useState("");
  const [libtvResults, setLibtvResults] = useState<LibTvResult[]>([]);
  const [libtvRunning, setLibtvRunning] = useState(false);
  const [libtvMessages, setLibtvMessages] = useState<LibTvMessage[]>([]);
  const [libtvInstruction, setLibtvInstruction] = useState("");
  const [libtvCanvasOpen, setLibtvCanvasOpen] = useState(false);
  const [libtvPollingPaused, setLibtvPollingPaused] = useState(false);
  const [libtvSending, setLibtvSending] = useState(false);
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [editorSyncState, setEditorSyncState] = useState<"idle" | "saving" | "ready" | "error">("idle");
  const [editorSyncProgress, setEditorSyncProgress] = useState(0);
  const [sceneAction, setSceneAction] = useState<SceneAction | null>(null);
  const [sequentialResumeToken, setSequentialResumeToken] = useState(0);
  const [seedanceApiKey, setSeedanceApiKey] = useState("");
  const [seedanceModel, setSeedanceModel] = useState("doubao-seedance-2-0-260128");
  const [videoResolution, setVideoResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [frameContinuityMode, setFrameContinuityMode] = useState<FrameContinuityMode>("identity-first");
  const [importMessage, setImportMessage] = useState("可按需导入，已具备的环节会自动跳过");
  const [scriptImported, setScriptImported] = useState(false);
  const [scriptMemory, setScriptMemory] = useState<ScriptNarrativeMemory>({ synopsis: "", background: "", updatedAt: "" });
  const [volcengineSdk, setVolcengineSdk] = useState<{ installed: boolean; version: string; signerReady: boolean; note: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const assetReuseKeyRef = useRef("");
  const batchAssetGenerationRef = useRef(false);
  const runRef = useRef(0);
  const portraitResumeStartedRef = useRef(false);
  const editorSyncRef = useRef(false);
  const quickModelSaveRef = useRef(false);
  const roleModelWriteRef = useRef<AgentRole | null>(null);
  const sceneActionRef = useRef("");
  const seedanceRequestControllerRef = useRef<AbortController | null>(null);
  const editorProjectIdRef = useRef(`studio-${Date.now().toString(36)}`);
  const libtvPauseRef = useRef(false);
  const runtimeShotReuseRef = useRef(new Map<string, string>());
  const runtimeVoiceReuseRef = useRef(new Map<string, { url: string; duration: number }>());
  const canonicalVoiceAudioRef = useRef(new Map<string, string>());
  const canonicalVoiceVideoRef = useRef(new Map<string, string>());
  const videoAssetPreflightRef = useRef(new Set<string>());
  const sceneReviewPatchesRef = useRef(new Map<string, Partial<Scene>>());
  const characterReviewPatchesRef = useRef(new Map<string, Partial<CharacterAsset>>());
  const taskCharacterIdentityAnchorsRef = useRef(new Map<string, string>());

  function activeAssetProjectId() {
    try {
      const active = JSON.parse(window.localStorage.getItem("manjing-active-series-context-v1") || "{}") as { projectId?: string };
      return active.projectId || editorProjectIdRef.current;
    } catch { return editorProjectIdRef.current; }
  }

  function activeGenerationTaskId() {
    try {
      const active = JSON.parse(window.localStorage.getItem("manjing-active-series-context-v1") || "{}") as { projectId?: string; episodeId?: string; activatedAt?: string };
      return [active.projectId || editorProjectIdRef.current, active.episodeId || "standalone", active.activatedAt || "current-session"].join(":");
    } catch { return `${editorProjectIdRef.current}:standalone:current-session`; }
  }

  async function loadReusableBlueprintAsset(category: "character" | "scene" | "prop", identityKey: string, lookName?: string) {
    const projectId = activeAssetProjectId();
    const library = await listLibraryAssets({ allProjects: true });
    const match = findReusableLibraryAsset(library, { category, identityKey, lookName, projectId, mediaType: "image", allowCrossProject: false, allowLookFallback: false });
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    await markLibraryAssetUsed(match.id);
    return loaded;
  }

  async function prepareCharacterIdentityReference(url: string, identity: string) {
    if (!url || agentConfigs.image.adapter !== "pollinations" || /^https:\/\//i.test(url)) return url;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`人物“${identity}”的 Canonical 身份参考图无法读取`);
    return uploadPollinationsMedia(await response.blob(), `identity-${stableReuseToken(identity)}.png`, agentKey("image"));
  }

  async function loadCharacterIdentityReference(character: CharacterAsset, workingCharacters = characters) {
    const identity = characterIdentity(character);
    const taskId = activeGenerationTaskId();
    const bindingKey = taskIdentityAnchorKey(taskId, identity);
    const boundId = taskCharacterIdentityAnchorsRef.current.get(bindingKey);
    const boundInMemory = boundId ? workingCharacters.find((candidate) => candidate.id === boundId && candidate.reviewDecision === "approved" && Boolean(candidate.remoteUrl || candidate.imageUrl)) : undefined;
    if (boundInMemory) {
      const url = await prepareCharacterIdentityReference(boundInMemory.remoteUrl || boundInMemory.imageUrl || "", identity);
      if (url) return { url, source: characterAssetNaming(boundInMemory).displayName, taskId };
    }
    const approvedCandidates = workingCharacters.filter((candidate) => candidate.reviewDecision === "approved");
    const inMemory = selectCharacterIdentityReference(character, approvedCandidates);
    if (inMemory) {
      const url = await prepareCharacterIdentityReference(inMemory.remoteUrl || inMemory.imageUrl || "", identity);
      if (url) {
        taskCharacterIdentityAnchorsRef.current.set(bindingKey, inMemory.id);
        return { url, source: characterAssetNaming(inMemory).displayName, taskId };
      }
    }
    const projectId = activeAssetProjectId();
    const library = (await listLibraryAssets({ allProjects: true })).filter((asset) => !asset.projectId || asset.scope === "global" || asset.projectId === projectId);
    const match = selectTaskScopedLibraryCharacterIdentityAnchor(taskId, identity, library, taskCharacterIdentityAnchorsRef.current);
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    await markLibraryAssetUsed(match.id);
    return { url: await prepareCharacterIdentityReference(loaded.url, identity), source: match.name, taskId };
  }

  async function characterGenerationRequest(character: CharacterAsset, workingCharacters = characters) {
    const identityReference = await loadCharacterIdentityReference(character, workingCharacters);
    const prompt = `${characterSheetPrompt(style, character)}${identityReference ? `\n${characterIdentityLockInstruction(characterIdentity(character), characterLook(character), true)}` : ""}`;
    if (identityReference) recordActivity("image", `人物“${characterIdentity(character)}”已在当前任务内绑定单一 Canonical 基准“${identityReference.source}”；新任务会重新选择，不声明引擎永久锁脸`, "done");
    return { prompt, references: identityReference ? [identityReference.url] : [] };
  }

  async function pairExistingBlueprintAssets(characterItems = characters, propItems = propAssets, sceneItems = sceneAssets, options: { allowCharacterLookCandidates?: boolean } = {}) {
    setStatusText("正在生成前配对资产库：先找已有图片，再确定真正缺失项");
    sceneItems = sceneItems.filter((item) => isReusableSceneAssetCandidate(item.environmentKey, item.name));
    const projectId = activeAssetProjectId();
    const library = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.mediaType === "image" && asset.reusable !== false && asset.assetState !== "placeholder");
    const characterMatches = new Map<string, LibraryAsset>();
    const characterLookCandidates = new Set<string>();
    const propMatches = new Map<string, LibraryAsset>();
    const sceneMatches = new Map<string, LibraryAsset>();
    for (const character of characterItems.filter(isVisualCharacterAsset)) {
      if (character.imageUrl) continue;
      const naming = characterAssetNaming(character);
      const exact = findReusableLibraryAsset(library, { category: "character", identityKey: naming.identityKey, lookName: naming.lookName, projectId, mediaType: "image", allowCrossProject: false, allowLookFallback: false });
      const candidate = exact || (options.allowCharacterLookCandidates
        ? findReusableLibraryAsset(library, { category: "character", identityKey: naming.identityKey, lookName: naming.lookName, projectId, mediaType: "image", allowCrossProject: false, allowLookFallback: true })
        : undefined);
      if (candidate) {
        characterMatches.set(character.id, candidate);
        if (!exact) characterLookCandidates.add(character.id);
      }
    }
    for (const prop of propItems) {
      if (prop.imageUrl) continue;
      const match = findReusableLibraryAsset(library, { category: "prop", identityKey: prop.name, projectId, mediaType: "image", allowCrossProject: false });
      if (match) propMatches.set(prop.id, match);
    }
    for (const sceneAsset of sceneItems) {
      if (sceneAsset.imageUrl) continue;
      const match = findReusableLibraryAsset(library, { category: "scene", identityKey: sceneAsset.environmentKey || sceneAsset.name, projectId, mediaType: "image", allowCrossProject: false });
      if (match) sceneMatches.set(sceneAsset.id, match);
    }
    const matchedIds = [...new Set([...characterMatches.values(), ...propMatches.values(), ...sceneMatches.values()].map((asset) => asset.id))];
    const loaded = await loadLibraryAssets(matchedIds);
    const byId = new Map(loaded.map((asset) => [asset.id, asset]));
    const nextCharacters = deduplicateCharacterAssets(characterItems.map((character) => {
      const match = characterMatches.get(character.id);
      const asset = match ? byId.get(match.id) : undefined;
      const lookCandidate = characterLookCandidates.has(character.id);
      return !character.imageUrl && asset?.url ? { ...character, libraryAssetId: lookCandidate ? character.libraryAssetId : asset.id, imageUrl: asset.url, remoteUrl: asset.url.startsWith("https://") ? asset.url : character.remoteUrl, arkAssetId: asset.arkAssetId, portraitAuthorizationStatus: asset.portraitAuthorizationStatus, sheetVersion: characterSheetVersionFromLibrary(asset), assetMatchKind: lookCandidate ? "look-candidate" as const : "exact" as const, reviewDecision: lookCandidate || asset.assetState === "review" ? "pending" as const : "approved" as const, status: "ready" as const } : character;
    }));
    const nextProps = propItems.map((prop) => { const match = propMatches.get(prop.id); const asset = match ? byId.get(match.id) : undefined; return !prop.imageUrl && asset?.url ? { ...prop, libraryAssetId: asset.id, imageUrl: asset.url, remoteUrl: asset.url.startsWith("https://") ? asset.url : prop.remoteUrl, reviewDecision: asset.assetState === "review" ? "pending" as const : "approved" as const, status: "ready" as const } : prop; });
    const nextScenes = sceneItems.map((sceneAsset) => { const match = sceneMatches.get(sceneAsset.id); const asset = match ? byId.get(match.id) : undefined; return !sceneAsset.imageUrl && asset?.url ? { ...sceneAsset, libraryAssetId: asset.id, imageUrl: asset.url, remoteUrl: asset.url.startsWith("https://") ? asset.url : sceneAsset.remoteUrl, reviewDecision: asset.assetState === "review" ? "pending" as const : "approved" as const, status: "ready" as const } : sceneAsset; });
    setCharacters(nextCharacters);
    setPropAssets(nextProps);
    setSceneAssets(nextScenes);
    await Promise.all(matchedIds.map((id) => markLibraryAssetUsed(id)));
    const paired = characterMatches.size + propMatches.size + sceneMatches.size;
    const lookCandidateCount = characterLookCandidates.size;
    const missing = nextCharacters.filter((item) => isVisualCharacterAsset(item) && !item.imageUrl).length + nextProps.filter((item) => !item.imageUrl).length + nextScenes.filter((item) => !item.imageUrl).length;
    const summary = `配对完成：复用 ${paired - lookCandidateCount} 项精确资产${lookCandidateCount ? `，找到 ${lookCandidateCount} 项同人物造型候选待确认` : ""}，确认 ${missing} 项确实缺失`;
    setAssetPairingSummary(summary);
    setImportMessage(`${summary}；只有缺失项才允许进入生图 Agent`);
    recordActivity("image", summary, paired ? "done" : "warning");
    return { characters: nextCharacters, props: nextProps, scenes: nextScenes, paired, lookCandidateCount, missing };
  }

  function persistScriptMemory(memory: Omit<ScriptNarrativeMemory, "updatedAt">) {
    const next = { ...memory, updatedAt: new Date().toISOString() };
    setScriptMemory(next);
    try { window.localStorage.setItem(`manjing-script-memory-v1:${activeAssetProjectId()}`, JSON.stringify(next)); } catch { /* Current state still retains the memory. */ }
    return next;
  }

  function activeSeriesContext() {
    try {
      return JSON.parse(window.localStorage.getItem("manjing-active-series-context-v1") || "{}") as { projectId?: string; projectName?: string; episodeId?: string; episodeNumber?: number };
    } catch { return {} as { projectId?: string; projectName?: string; episodeId?: string; episodeNumber?: number }; }
  }

  async function previousEpisodeVideoReference() {
    const context = activeSeriesContext();
    if (!context.projectId || !context.episodeNumber || context.episodeNumber <= 1) return null;
    const previousNumber = context.episodeNumber - 1;
    const candidate = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.projectId === context.projectId && asset.category === "video" && asset.mediaType === "video" && asset.assetState === "ready" && asset.tags.includes("已批准分镜视频") && asset.tags.includes(`episode-number:${previousNumber}`)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!candidate) return null;
    const [loaded] = await loadLibraryAssets([candidate.id]);
    if (!loaded?.url) return null;
    await markLibraryAssetUsed(candidate.id);
    return loaded;
  }

  async function refreshVoiceProfiles() {
    const projectId = activeAssetProjectId();
    const assets = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.category === "audio" && asset.mediaType === "audio" && asset.assetState !== "placeholder" && Boolean(asset.identityKey) && (!asset.projectId || asset.scope === "global" || asset.projectId === projectId));
    const loaded = await loadLibraryAssets(assets.slice(0, 80).map((asset) => asset.id));
    const urls = new Map(loaded.map((asset) => [asset.id, asset.url]));
    setVoiceProfiles(assets.map((asset) => ({ ...asset, url: urls.get(asset.id) || asset.url })));
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refreshVoiceProfiles().catch(() => undefined); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SEEDANCE_PORTRAIT_BLOCK_KEY) || "null") as SeedancePortraitBlock | null;
      const projectId = activeAssetProjectId();
      const requiresTrustedPortrait = styleRequiresTrustedPortrait(visualStyle(style).category);
      // A pre-project legacy blocker cannot safely be attributed to the
      // current script. Clear it rather than making a new 3D project wait for
      // somebody else's real-person authorization.
      if (!saved?.projectId) {
        if (saved) window.localStorage.removeItem(SEEDANCE_PORTRAIT_BLOCK_KEY);
        setSeedancePortraitBlock(null);
        return;
      }
      if (saved.blockedReferences?.length && saved.projectId === projectId && requiresTrustedPortrait) {
        setSeedancePortraitBlock(saved);
      } else {
        if (saved.projectId === projectId && !requiresTrustedPortrait) window.localStorage.removeItem(SEEDANCE_PORTRAIT_BLOCK_KEY);
        setSeedancePortraitBlock(null);
      }
    } catch { window.localStorage.removeItem(SEEDANCE_PORTRAIT_BLOCK_KEY); setSeedancePortraitBlock(null); }
  }, [style]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`manjing-script-memory-v1:${activeAssetProjectId()}`) || "null") as ScriptNarrativeMemory | null;
      if (saved?.synopsis || saved?.background) setScriptMemory(saved);
    } catch { /* A new analysis will rebuild the memory. */ }
  }, [scriptImported]);

  const totalDuration = useMemo(() => scenes.reduce((sum, item) => sum + item.duration, 0), [scenes]);
  const productionDuration = targetDuration || 30;
  const offsets = useMemo(() => scenes.map((_, index) => scenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0)), [scenes]);
  const timelineWidth = Math.max(720, totalDuration * 34 * timelineZoom);
  const currentIndex = scenes.length
    ? Math.max(0, scenes.findIndex((scene, index) => time >= offsets[index] && time < offsets[index] + scene.duration))
    : 0;
  const current = scenes[currentIndex] || scenes[selected];
  const activityByRole = useMemo(() => Object.fromEntries(AGENT_ROLES.map(({ id }) => [id, activityLog.find((item) => item.role === id)])) as Partial<Record<AgentRole, ActivityEvent>>, [activityLog]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        type SavedSettings = {
          agentConfigs?: Partial<Record<AgentRole, AgentConfig>>;
          customModels?: CustomModel[];
          pollinationsKey?: string;
          bridge?: { url?: string; token?: string; lipsync?: boolean };
          cloudEngines?: { libtvKey?: string; libtvSessionId?: string; libtvProjectUrl?: string; seedanceKey?: string; seedanceModel?: string; videoResolution?: "480p" | "720p" | "1080p" };
          workspace?: { projectTitle?: string; story?: string; style?: string; targetDuration?: number; aspect?: "9:16" | "16:9"; frameContinuityMode?: FrameContinuityMode; voiceEnabled?: boolean; bgmEnabled?: boolean; subtitleEnabled?: boolean; voice?: string; musicPrompt?: string; subtitleScale?: number; subtitleColor?: string; musicVolume?: number; scriptImported?: boolean };
        };
        const startingFresh = window.localStorage.getItem(NEW_STUDIO_KEY) === "1";
        const requestedProjectId = window.localStorage.getItem(OPEN_STUDIO_PROJECT_KEY) || "";
        if (startingFresh) {
          window.localStorage.removeItem(NEW_STUDIO_KEY);
          window.localStorage.removeItem(STUDIO_SESSION_KEY);
          window.localStorage.removeItem("manjing-text-draft");
          setStory("");
          setScriptImported(false);
          setPropAssets([]);
          setSceneAssets([]);
          setAssetAnalysisState("idle");
          setProjectTitle("未命名项目");
          editorProjectIdRef.current = `studio-${Date.now().toString(36)}`;
        }
        if (requestedProjectId) window.localStorage.removeItem(OPEN_STUDIO_PROJECT_KEY);
        let savedSession: StudioSession | null = null;
        if (!startingFresh) {
          try { savedSession = JSON.parse(window.localStorage.getItem(STUDIO_SESSION_KEY) || "null") as StudioSession | null; } catch { savedSession = null; }
        }
        let restoredProject = null as Awaited<ReturnType<typeof loadEditorProjectById>>;
        const mediaProjectId = requestedProjectId || savedSession?.projectId || "";
        if (mediaProjectId) restoredProject = await loadEditorProjectById(mediaProjectId).catch(() => null);
        let desktop: SavedSettings = {};
        try {
          const response = await fetch("/api/desktop/settings", { cache: "no-store" });
          if (response.ok) desktop = await response.json() as SavedSettings;
        } catch {
          desktop = {};
        }
        if (!active) return;
        const savedKey = desktop.pollinationsKey || window.localStorage.getItem("manjing-pollinations-key") || "";
        const savedDraft = startingFresh ? "" : window.localStorage.getItem("manjing-text-draft");
        const savedAgents = desktop.agentConfigs || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-agent-team") || "null") as Partial<Record<AgentRole, AgentConfig>> | null; } catch { return null; }
        })();
        const savedBridge = desktop.bridge || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-local-bridge") || "null") as SavedSettings["bridge"]; } catch { return undefined; }
        })();
        const savedCloudEngines = desktop.cloudEngines || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-cloud-engines") || "null") as SavedSettings["cloudEngines"]; } catch { return undefined; }
        })();
        const savedWorkspace = startingFresh ? undefined : desktop.workspace || (() => {
          try { return JSON.parse(window.localStorage.getItem("manjing-workspace") || "null") as SavedSettings["workspace"]; } catch { return undefined; }
        })();
        if (savedKey) setApiKey(savedKey);
        if (savedWorkspace?.story || savedDraft) setStory(savedWorkspace?.story || savedDraft || SAMPLE_STORY);
        if (savedAgents) {
          const merged = { ...makeTeam("free"), ...savedAgents };
          setAgentConfigs(merged);
          setMode(AGENT_ROLES.some(({ id }) => !["horde", "browser"].includes(merged[id].adapter)) ? "cloud" : "community");
        }
        if (savedBridge) {
          setBridgeUrl(savedBridge.url || "");
          setBridgeToken(savedBridge.token || "");
          setLipsyncEnabled(Boolean(savedBridge.lipsync));
        }
        if (savedCloudEngines) {
          setLibtvAccessKey(savedCloudEngines.libtvKey || "");
          setLibtvSessionId(savedCloudEngines.libtvSessionId || "");
          setLibtvProjectUrl(savedCloudEngines.libtvProjectUrl || "");
          setSeedanceApiKey(savedCloudEngines.seedanceKey || "");
          setSeedanceModel(savedCloudEngines.seedanceModel || "doubao-seedance-2-0-260128");
          setVideoResolution(savedCloudEngines.videoResolution || "720p");
        }
        if (savedWorkspace) {
          if (savedWorkspace.projectTitle) setProjectTitle(savedWorkspace.projectTitle);
          if (savedWorkspace.style && STYLE_PROMPTS[savedWorkspace.style]) setStyle(savedWorkspace.style);
          if (typeof savedWorkspace.targetDuration === "number") setTargetDuration(savedWorkspace.targetDuration);
          if (savedWorkspace.aspect === "9:16" || savedWorkspace.aspect === "16:9") setAspect(savedWorkspace.aspect);
          if (savedWorkspace.frameContinuityMode) setFrameContinuityMode("identity-first");
          if (typeof savedWorkspace.voiceEnabled === "boolean") setVoiceEnabled(savedWorkspace.voiceEnabled);
          if (typeof savedWorkspace.bgmEnabled === "boolean") setBgmEnabled(savedWorkspace.bgmEnabled);
          if (typeof savedWorkspace.subtitleEnabled === "boolean") setSubtitleEnabled(savedWorkspace.subtitleEnabled);
          if (savedWorkspace.voice) setVoice(savedWorkspace.voice);
          if (savedWorkspace.musicPrompt) setMusicPrompt(savedWorkspace.musicPrompt);
          if (typeof savedWorkspace.subtitleScale === "number") setSubtitleScale(savedWorkspace.subtitleScale);
          if (savedWorkspace.subtitleColor) setSubtitleColor(savedWorkspace.subtitleColor);
          if (typeof savedWorkspace.musicVolume === "number") setMusicVolume(savedWorkspace.musicVolume);
          setScriptImported(savedWorkspace.scriptImported === true);
        }
        if (requestedProjectId && !restoredProject) {
          try {
            const drafts = JSON.parse(window.localStorage.getItem(STUDIO_DRAFTS_KEY) || "{}") as Record<string, StudioSession>;
            if (drafts[requestedProjectId]) savedSession = drafts[requestedProjectId];
          } catch { /* keep the latest session fallback */ }
        }
        const snapshot = (requestedProjectId && restoredProject?.studioSnapshot ? restoredProject.studioSnapshot : savedSession) as Partial<StudioSession> | null;
        if (snapshot && !startingFresh) {
          const sessionScenes = Array.isArray(snapshot.scenes) ? snapshot.scenes as Scene[] : [];
          const durableVideoAssets = await loadLibraryAssets(sessionScenes.flatMap((scene) => [scene.videoAssetId, scene.candidateVideoAssetId]).filter((id): id is string => Boolean(id)));
          const durableVideoById = new Map(durableVideoAssets.map((asset) => [asset.id, asset.url]));
          const restoredScenes = sessionScenes.map((scene) => {
            const visual = restoredProject?.clips.find((clip) => clip.id === `${scene.id}-visual`);
            const audio = restoredProject?.clips.find((clip) => clip.id === `${scene.id}-audio`);
            const normalizedScene = separateVideoPosterFromLegacyFirstFrame(scene);
            return {
              ...normalizedScene,
              imageUrl: visual?.type === "image" ? visual.url : durableMediaUrl(normalizedScene.imageUrl),
              videoPosterUrl: durableMediaUrl(normalizedScene.videoPosterUrl),
              videoUrl: visual?.type === "video" ? visual.url : (scene.videoAssetId ? durableVideoById.get(scene.videoAssetId) : undefined) || durableMediaUrl(scene.videoUrl),
              candidateVideoUrl: scene.candidateVideoAssetId ? durableVideoById.get(scene.candidateVideoAssetId) : durableMediaUrl(scene.candidateVideoUrl),
              audioUrl: audio?.url || durableMediaUrl(scene.audioUrl),
            };
          });
          if (snapshot.projectId || restoredProject?.id) editorProjectIdRef.current = String(restoredProject?.id || snapshot.projectId);
          if (snapshot.projectTitle) setProjectTitle(snapshot.projectTitle);
          if (snapshot.story) setStory(snapshot.story);
          if (snapshot.style && STYLE_PROMPTS[snapshot.style]) setStyle(snapshot.style);
          if (typeof snapshot.targetDuration === "number") setTargetDuration(snapshot.targetDuration);
          if (snapshot.aspect === "9:16" || snapshot.aspect === "16:9") setAspect(snapshot.aspect);
          if (snapshot.frameContinuityMode) setFrameContinuityMode("identity-first");
          if (Array.isArray(snapshot.characters)) setCharacters(deduplicateCharacterAssets(snapshot.characters as CharacterAsset[]));
          if (Array.isArray(snapshot.propAssets)) { setPropAssets(snapshot.propAssets as PropAsset[]); setAssetAnalysisState("ready"); }
          if (Array.isArray(snapshot.sceneAssets)) {
            const storedScenes = snapshot.sceneAssets as SceneAsset[];
            const localizedScenes = storedScenes
              .filter((item) => isReusableSceneAssetCandidate(item.environmentKey, item.name))
              .map((item, index) => ({ ...item, name: localizedSceneDisplayName(item, index) }));
            setSceneAssets(localizedScenes);
            setAssetAnalysisState("ready");
            const storedSceneNames = new Map(storedScenes.map((item) => [item.id, item.name]));
            void Promise.all(localizedScenes.map((item) => item.libraryAssetId && item.name !== storedSceneNames.get(item.id)
              ? updateLibraryAsset(item.libraryAssetId, { name: item.name })
              : Promise.resolve())).catch(() => undefined);
          }
          if (restoredScenes.length) setScenes(assignSpatialLayouts(restoredScenes));
          if (typeof snapshot.selected === "number") setSelected(Math.max(0, Math.min(restoredScenes.length - 1, snapshot.selected)));
          if (snapshot.phase) setPhase(snapshot.phase as Phase);
          if (typeof snapshot.progress === "number") setProgress(snapshot.progress);
          if (snapshot.statusText) setStatusText(snapshot.statusText);
          if (Array.isArray(snapshot.activityLog)) setActivityLog(snapshot.activityLog as ActivityEvent[]);
          if (snapshot.musicPrompt) setMusicPrompt(snapshot.musicPrompt);
          setMusicUrl(restoredProject?.clips.find((clip) => clip.id === "project-music")?.url || durableMediaUrl(snapshot.musicUrl) || "");
          setExportUrl(restoredProject?.finalVideo?.url || durableMediaUrl(snapshot.exportUrl) || "");
        } else if (requestedProjectId && restoredProject) {
          editorProjectIdRef.current = restoredProject.id;
          const visuals = restoredProject.clips.filter((clip) => clip.type === "video" || clip.type === "image");
          const reconstructed = visuals.map((clip, index) => ({ id: clip.id.replace(/-visual$/, ""), title: clip.name, visual: clip.name, action: "已保存的生成镜头", shot: "镜头", camera: "保持原镜头", dialogue: "", speaker: "", emotion: "自然", sfx: "", characters: [], duration: clip.duration, imageUrl: clip.type === "image" ? clip.url : undefined, videoUrl: clip.type === "video" ? clip.url : undefined, status: "ready" as SceneStatus }));
          setProjectTitle(restoredProject.name); setScenes(assignSpatialLayouts(reconstructed)); setPhase("ready"); setProgress(100); setStatusText("已从项目资产恢复镜头"); setExportUrl(restoredProject.finalVideo?.url || "");
        }
        const models = Array.isArray(desktop.customModels) ? desktop.customModels.filter((item) => item?.id && item?.role && item?.model) : loadCustomModels();
        setCustomModels(models);
        if (desktop.customModels) {
          try { saveCustomModels(models); } catch { /* localStorage fallback is optional in the desktop app */ }
        }
        setAgentTeamLoaded(true);
      })();
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const raw = window.sessionStorage.getItem("manjing-active-series-context-v1") || window.localStorage.getItem("manjing-active-series-context-v1");
    if (!raw) return;
    try {
      const context = JSON.parse(raw) as { projectId?: string; projectName?: string; episodeId?: string; episodeNumber?: number; context?: string; activatedAt?: string };
      if (!context.projectId || !context.episodeId || !context.context) return;
      const applyKey = `${context.projectId}:${context.episodeId}:${context.activatedAt || ""}`;
      if (window.sessionStorage.getItem("manjing-series-context-applied") === applyKey) return;
      window.sessionStorage.setItem("manjing-series-context-applied", applyKey);
      queueMicrotask(() => {
        setProjectTitle(`${context.projectName || "系列项目"} · 第 ${context.episodeNumber || 1} 集`);
        setStory(context.context || "");
        setScriptImported(true);
        setCharacters([]);
        setPropAssets([]);
        setSceneAssets([]);
        setAssetAnalysisState("idle");
        setScenes([]);
        setSelected(0);
        setPhase("idle");
        setProgress(0);
        setStatusText(`已同步“${context.projectName || "系列项目"}”第 ${context.episodeNumber || 1} 集、项目记忆和上一集状态`);
        try { window.localStorage.setItem("manjing-text-draft", context.context || ""); } catch { window.sessionStorage.setItem("manjing-text-draft", context.context || ""); }
        recordActivity("director", `已接收系列项目第 ${context.episodeNumber || 1} 集上下文，后续资产归属当前项目`, "done");
      });
    } catch (reason) {
      queueMicrotask(() => setError(reason instanceof Error ? `项目同步失败：${reason.message}` : "项目同步失败"));
    }
  }, [agentTeamLoaded]);

  useEffect(() => {
    const synchronizeSeriesContext = (event: Event) => {
      const context = (event as CustomEvent<{ projectId: string; projectName: string; episodeId: string; episodeNumber: number; context: string }>).detail;
      if (!context?.projectId || !context?.episodeId || !context.context) return;
      setProjectTitle(`${context.projectName || "系列项目"} · 第 ${context.episodeNumber || 1} 集`);
      setStory(context.context);
      setScriptImported(true);
      setCharacters([]);
      setPropAssets([]);
      setSceneAssets([]);
      setAssetAnalysisState("idle");
      setScenes([]);
      setSelected(0);
      setPhase("idle");
      setProgress(0);
      setError("");
      setStatusText(`已切换到“${context.projectName || "系列项目"}”第 ${context.episodeNumber || 1} 集，项目记忆与资产归属已同步`);
      try { window.localStorage.setItem("manjing-text-draft", context.context); } catch { window.sessionStorage.setItem("manjing-text-draft", context.context); }
      recordActivity("director", `已在工作台切换至第 ${context.episodeNumber || 1} 集`, "done");
    };
    window.addEventListener("manjing-series-context-changed", synchronizeSeriesContext);
    return () => window.removeEventListener("manjing-series-context-changed", synchronizeSeriesContext);
  }, []);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const raw = window.localStorage.getItem("manjing-studio-library-import");
    if (!raw) return;
    window.localStorage.removeItem("manjing-studio-library-import");
    let ids: string[] = [];
    try { ids = JSON.parse(raw) as string[]; } catch { ids = []; }
    if (!Array.isArray(ids) || !ids.length) return;
    queueMicrotask(() => {
      setImportMessage("正在从独立资产库载入选中资产…");
      void loadLibraryAssets(ids).then((items) => applyLibraryAssets(items)).catch((reason) => setError(reason instanceof Error ? reason.message : "资产库导入失败"));
    });
  }, [agentTeamLoaded]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const assetId = window.localStorage.getItem("manjing-studio-blueprint-generate") || new URLSearchParams(window.location.search).get("blueprint") || "";
    if (!assetId) return;
    window.localStorage.removeItem("manjing-studio-blueprint-generate");
    queueMicrotask(() => {
      void loadLibraryAssets([assetId]).then(async ([asset]) => {
        if (!asset || asset.assetState !== "placeholder") throw new Error("该资产框架已经生成、被删除或无法读取");
        setScriptImported(true);
        setAssetAnalysisState("ready");
        if (asset.category === "character") {
          const character: CharacterAsset = { id: uid(), libraryAssetId: asset.id, name: asset.identityKey || asset.name, role: "剧本人物", appearance: asset.semanticDescription || "等待补充人物外观", voice, status: "queued" };
          setCharacters((items) => items.some((item) => item.libraryAssetId === asset.id) ? items : [...items, character]);
          setImportMessage(`已从资产库选择“${asset.name}”，正在调用人物生图 AI；生成后仍需用户采用。`);
          await generateCharacterBlueprint(character);
        } else if (asset.category === "prop") {
          const prop: PropAsset = { id: uid(), libraryAssetId: asset.id, name: asset.identityKey || asset.name, description: asset.semanticDescription || "等待补充道具外观", importance: "story", reason: "剧本资产框架", status: "queued" };
          setPropAssets((items) => items.some((item) => item.libraryAssetId === asset.id) ? items : [...items, prop]);
          setImportMessage(`已从资产库选择“${asset.name}”，正在调用道具生图 AI；生成后仍需用户采用。`);
          await generatePropBlueprint(prop, propAssets.length);
        } else if (asset.category === "scene") {
          const environmentKey = String(asset.entityId || asset.identityKey || asset.name).replace(/^scene:/i, "").trim();
          if (!isReusableSceneAssetCandidate(environmentKey, asset.name)) throw new Error(`“${asset.name}”是镜头功能或叙事节拍，不是可复用场景资产`);
          const description = asset.semanticDescription || "等待补充场景建筑、空间布局、固定陈设和光线";
          const timeWeather = asset.variantName || "按剧本确定";
          const sceneAsset: SceneAsset = { id: uid(), libraryAssetId: asset.id, name: localizedSceneDisplayName({ name: asset.name, environmentKey, description, timeWeather }), environmentKey, description, timeWeather, episodeScope: "当前集", sceneHints: [], reason: "剧本场景资产框架", status: "queued" };
          setSceneAssets((items) => items.some((item) => item.libraryAssetId === asset.id) ? items : [...items, sceneAsset]);
          setImportMessage(`已从资产库选择“${asset.name}”，正在调用场景生图 AI；生成后仍需用户采用。`);
          await generateSceneBlueprint(sceneAsset, sceneAssets.length);
        } else if (asset.category === "audio") {
          const referenceText = asset.referenceText?.trim() || "这是我的标准参考音色，后续请保持同一个人物声音。";
          const voiceScene: Scene = { id: uid(), title: `${asset.identityKey || asset.name}-音色参考`, visual: "人物音色框架", action: asset.generationPrompt || "自然清晰地说出参考台词", shot: "声音资产", camera: "无", dialogue: referenceText, speaker: asset.identityKey || asset.name, emotion: "自然", sfx: "", characters: [asset.identityKey || asset.name], duration: 6, status: "voicing" };
          setImportMessage(`正在为“${asset.identityKey || asset.name}”调用配音 AI 生成参考音色；生成后请到音色库试听并确认授权。`);
          const generated = await pollinationsMedia("audio", referenceText, 950, { voiceName: voice });
          await attachLibraryFileToPlaceholder(asset.id, new File([generated.blob], `${asset.identityKey || asset.name}-标准音色.mp3`, { type: generated.blob.type || "audio/mpeg" }), "ai");
          await updateLibraryAsset(asset.id, { assetState: "review", sourceChoice: "ai", reusable: false, canonical: false, voiceConsent: "pending", referenceText: voiceScene.dialogue });
          recordActivity("voice", `“${asset.identityKey || asset.name}”的参考音色已生成并进入独立音色库，等待试听和授权确认`, "done");
          window.location.href = "/voices";
        } else {
          throw new Error("当前框架类型暂不支持 AI 生成");
        }
        document.querySelector(".script-asset-blueprint")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }).catch((reason) => setError(reason instanceof Error ? reason.message : "资产框架生图启动失败"));
    });
  }, [agentTeamLoaded]);

  useEffect(() => {
    if (!agentTeamLoaded || (!characters.length && !scenes.length)) return;
    const reuseKey = `${characters.map((item) => `${item.id}:${item.name}:${Boolean(item.imageUrl)}`).join("|")}::${scenes.map((item) => `${item.id}:${item.title}:${item.environmentKey || ""}:${Boolean(item.imageUrl)}`).join("|")}`;
    if (assetReuseKeyRef.current === reuseKey) return;
    assetReuseKeyRef.current = reuseKey;
    void listLibraryAssets({ allProjects: true }).then(async (library) => {
      const reusable = library.filter((asset) => asset.reusable !== false && asset.mediaType === "image").sort((a, b) => Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || (b.usageCount || 0) - (a.usageCount || 0));
      const projectId = activeAssetProjectId();
      const selectedIds = new Set<string>();
      const characterMatches = new Map<string, LibraryAsset>();
      const sceneMatches = new Map<string, LibraryAsset>();
      for (const character of characters.filter((item) => isVisualCharacterAsset(item) && !item.imageUrl)) {
        const naming = characterAssetNaming(character);
        const match = findReusableLibraryAsset(reusable, { category: "character", identityKey: naming.identityKey, lookName: naming.lookName, projectId, mediaType: "image", allowCrossProject: false, allowLookFallback: false });
        if (match) { characterMatches.set(character.id, match); selectedIds.add(match.id); }
      }
      for (const scene of scenes.filter((item) => !item.imageUrl)) {
        const match = findReusableLibraryAsset(reusable, { category: "scene", identityKey: scene.environmentKey || scene.title, projectId, mediaType: "image", allowCrossProject: false });
        if (match) { sceneMatches.set(scene.id, match); selectedIds.add(match.id); }
      }
      if (!selectedIds.size) return;
      const loaded = await loadLibraryAssets([...selectedIds]);
      const byId = new Map(loaded.map((asset) => [asset.id, asset]));
      setCharacters((items) => items.map((item) => { const match = characterMatches.get(item.id); const loadedAsset = match ? byId.get(match.id) : null; return !item.imageUrl && loadedAsset?.url ? { ...item, libraryAssetId: loadedAsset.id, imageUrl: loadedAsset.url, arkAssetId: loadedAsset.arkAssetId, portraitAuthorizationStatus: loadedAsset.portraitAuthorizationStatus, reviewDecision: loadedAsset.assetState === "review" ? "pending" : "approved", status: "ready" } : item; }));
      setScenes((items) => items.map((item) => { const match = sceneMatches.get(item.id); const loadedAsset = match ? byId.get(match.id) : null; return !item.imageUrl && loadedAsset?.url ? { ...item, imageUrl: loadedAsset.url, status: "ready", model: "Agent 资产复用" } : item; }));
      await Promise.all([...selectedIds].map((id) => markLibraryAssetUsed(id)));
      setImportMessage(`Agent 已自动匹配并复用 ${selectedIds.size} 项人物或场景资产，缺少部分才会继续生成`);
      recordActivity("director", `已从资产库自动检索并复用 ${selectedIds.size} 项资产`, "done");
    }).catch((reason) => console.warn("[manjing asset reuse]", reason));
  }, [agentTeamLoaded, characters, scenes]);

  useEffect(() => {
    if (!characters.length) return;
    const unique = deduplicateCharacterAssets(characters);
    if (unique.length === characters.length) return;
    setCharacters(unique);
    setImportMessage(`已清理或合并 ${characters.length - unique.length} 张无效/重复人物卡片；栏目标题和 VO 标记不会进入人物资产`);
  }, [characters]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    void removeMisclassifiedNarrativeAssets().catch((reason) => console.warn("[manjing invalid script assets]", reason));
    void consolidateDuplicateCharacterAssets().then(({ archived, groups }) => {
      if (!archived) return;
      setImportMessage(`已把 ${archived} 张重复人物图收纳为 ${groups} 组历史版本；用户上传或已确认资产优先保留为主卡`);
      recordActivity("image", `资产库去重完成：${archived} 张重复人物图已归入版本历史`, "done");
    }).catch((reason) => console.warn("[manjing duplicate character assets]", reason));
    // This cleanup intentionally runs only once after the persisted agent team is restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentTeamLoaded]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    void fetch("/api/desktop/volcengine-sdk", { cache: "no-store" }).then(async (response) => {
      if (response.ok) setVolcengineSdk(await response.json() as { installed: boolean; version: string; signerReady: boolean; note: string });
      else setVolcengineSdk({ installed: false, version: "", signerReady: false, note: "网页版不加载本机 SDK；Windows 独立版会自动检测。" });
    }).catch(() => setVolcengineSdk({ installed: false, version: "", signerReady: false, note: "网页版不加载本机 SDK；Windows 独立版会自动检测。" }));
  }, [agentTeamLoaded]);

  useEffect(() => {
    const refresh = () => setCustomModels(loadCustomModels());
    window.addEventListener("manjing-custom-models-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("manjing-custom-models-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("manjing-text-draft", story);
  }, [story]);

  useEffect(() => {
    window.localStorage.removeItem("manjing-pollinations-key");
  }, [apiKey]);

  useEffect(() => {
    if (agentTeamLoaded) window.localStorage.setItem("manjing-agent-team", JSON.stringify(Object.fromEntries(Object.entries(agentConfigs).map(([role, config]) => [role, { ...config, apiKey: "" }]))));
  }, [agentConfigs, agentTeamLoaded]);

  useEffect(() => {
    if (agentTeamLoaded) window.localStorage.setItem("manjing-local-bridge", JSON.stringify({ url: bridgeUrl, token: "", lipsync: lipsyncEnabled }));
  }, [bridgeUrl, bridgeToken, lipsyncEnabled, agentTeamLoaded]);

  useEffect(() => {
    if (agentTeamLoaded) window.localStorage.setItem("manjing-cloud-engines", JSON.stringify({ libtvKey: "", libtvSessionId, libtvProjectUrl, seedanceKey: "", seedanceModel, videoResolution }));
  }, [libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceApiKey, seedanceModel, videoResolution, agentTeamLoaded]);

  useEffect(() => {
    const producing = runRef.current !== 0 && !["idle", "ready", "error"].includes(phase);
    if (producing) window.localStorage.setItem("manjing-production-runtime-v1", JSON.stringify({ active: true, phase, progress, statusText, projectTitle, updatedAt: Date.now() }));
    else window.localStorage.removeItem("manjing-production-runtime-v1");
    const protectWindow = (event: BeforeUnloadEvent) => {
      if (!producing) return;
      event.preventDefault();
      event.returnValue = "漫剧仍在制作，关闭窗口会中断当前任务。";
    };
    window.addEventListener("beforeunload", protectWindow);
    return () => window.removeEventListener("beforeunload", protectWindow);
  }, [phase, progress, statusText, projectTitle]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const workspace = { projectTitle, story, style, targetDuration, aspect, frameContinuityMode, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, scriptImported };
    window.localStorage.setItem("manjing-workspace", JSON.stringify(workspace));
    const timer = window.setTimeout(() => { void persistDesktopSettings().catch(() => undefined); }, 300);
    return () => window.clearTimeout(timer);
  }, [agentTeamLoaded, agentConfigs, customModels, apiKey, bridgeUrl, bridgeToken, lipsyncEnabled, libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceApiKey, seedanceModel, projectTitle, story, style, targetDuration, aspect, frameContinuityMode, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, scriptImported]);

  useEffect(() => {
    if (!agentTeamLoaded) return;
    const session: StudioSession = {
      version: 2,
      projectId: editorProjectIdRef.current,
      projectTitle,
      story,
      style,
      targetDuration,
      aspect,
      frameContinuityMode,
      characters: characters.map(serializableCharacter),
      propAssets: propAssets.map(serializableProp),
      sceneAssets: sceneAssets.map(serializableSceneAsset),
      scenes: scenes.map(serializableScene),
      selected,
      phase,
      progress,
      statusText,
      activityLog: activityLog.slice(0, 120),
      musicPrompt,
      musicUrl: durableMediaUrl(musicUrl),
      exportUrl: durableMediaUrl(exportUrl),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(session));
    if (story.trim() || scenes.length || phase !== "idle") {
      try {
        const drafts = JSON.parse(window.localStorage.getItem(STUDIO_DRAFTS_KEY) || "{}") as Record<string, StudioSession>;
        drafts[session.projectId] = session;
        window.localStorage.setItem(STUDIO_DRAFTS_KEY, JSON.stringify(Object.fromEntries(Object.entries(drafts).sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt)).slice(0, 30))));
        const saved = JSON.parse(window.localStorage.getItem("manjing-projects") || "[]") as Array<{ id?: string }>;
        const card = { id: session.projectId, title: projectTitle || "未命名漫剧", story: story.trim().slice(0, 120) || `${scenes.length} 个分镜`, updatedAt: "刚刚", duration: formatTime(totalDuration || targetDuration), status: phase === "ready" ? "待精剪" : phase === "error" ? "制作中断" : "制作中", source: "studio" as const, durable: false };
        window.localStorage.setItem("manjing-projects", JSON.stringify([card, ...saved.filter((item) => item.id !== card.id)].slice(0, 30)));
      } catch { /* a private browsing quota should not interrupt production */ }
    }
  }, [agentTeamLoaded, projectTitle, story, style, targetDuration, aspect, frameContinuityMode, characters, propAssets, sceneAssets, scenes, selected, phase, progress, statusText, activityLog, musicPrompt, musicUrl, exportUrl]);

  useEffect(() => {
    if (!playing || !totalDuration) return;
    const started = performance.now() - time * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const next = (now - started) / 1000;
      if (next >= totalDuration) {
        setTime(0);
        setPlaying(false);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalDuration]);

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (!playing || !current || !voiceEnabled) return;
    if (current.audioUrl) {
      const audio = new Audio(current.audioUrl);
      audioRef.current = audio;
      void audio.play().catch(() => undefined);
    } else if ("speechSynthesis" in window) {
      const speech = new SpeechSynthesisUtterance(current.dialogue);
      speech.lang = "zh-CN";
      speech.rate = 0.92;
      window.speechSynthesis.speak(speech);
    }
    return () => {
      audioRef.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [currentIndex, playing, voiceEnabled, current]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = current?.speed || 1;
    if (playing) void videoRef.current.play().catch(() => undefined);
    else videoRef.current.pause();
  }, [playing, currentIndex, current?.speed]);

  function recordActivity(role: AgentRole, message: string, state: ActivityState = "running") {
    setActivityLog((items) => [{ id: uid(), role, message, state, time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...items].slice(0, 30));
  }

  function invalidateExport() {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function updateScene(id: string, patch: Partial<Scene>) {
    setScenes((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    invalidateExport();
  }

  function publishScenes(items: Scene[]) {
    setScenes(assignSpatialLayouts(items.map((item) => ({ ...item, ...(sceneReviewPatchesRef.current.get(item.id) || {}) }))));
  }

  function publishCharacters(items: CharacterAsset[]) {
    setCharacters(items.map((item) => ({ ...item, ...(characterReviewPatchesRef.current.get(item.id) || {}) })));
  }

  function patchSceneReview(id: string, patch: Partial<Scene>) {
    const next = { ...(sceneReviewPatchesRef.current.get(id) || {}), ...patch };
    sceneReviewPatchesRef.current.set(id, next);
    setScenes((items) => items.map((item) => item.id === id ? { ...item, ...next } : item));
    invalidateExport();
  }

  function patchCharacterReview(id: string, patch: Partial<CharacterAsset>) {
    const next = { ...(characterReviewPatchesRef.current.get(id) || {}), ...patch };
    characterReviewPatchesRef.current.set(id, next);
    setCharacters((items) => items.map((item) => item.id === id ? { ...item, ...next } : item));
  }

  async function approveCharacterAsset(character: CharacterAsset) {
    if (!character.imageUrl) return;
    const naming = characterAssetNaming(character);
    if (character.libraryAssetId) {
      try {
        const response = await fetch(character.imageUrl);
        if (!response.ok) throw new Error("无法读取待采用的人物图片");
        const blob = await response.blob();
        const sourceChoice = character.assetMatchKind === "look-candidate" ? "upload" : "ai";
        await attachLibraryFileToPlaceholder(character.libraryAssetId, new File([blob], `${naming.displayName}.png`, { type: blob.type || "image/png" }), sourceChoice);
        const [stored] = character.sheetVersion === 3 ? await loadLibraryAssets([character.libraryAssetId]) : [];
        await updateLibraryAsset(character.libraryAssetId, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice, ...(character.sheetVersion === 3 ? { tags: [...new Set([...(stored?.tags || []), "四区角色卡", "大头照", "正侧背三视图", "character-card-v3"])] } : {}) });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "人物资产入库失败");
        return;
      }
    } else {
      try {
        await archiveGeneratedAsset(character.imageUrl, naming.displayName, "character", 5, ["用户批准", "人物", character.name, `造型:${naming.lookName}`, ...(character.sheetVersion === 3 ? ["四区角色卡", "大头照", "正侧背三视图", "character-card-v3"] : []), character.id, `asset:character:${stableReuseToken(`${character.name}|${character.appearance}`)}`], { ...naming, entityId: naming.identityKey });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "人物资产入库失败");
        return;
      }
    }
    patchCharacterReview(character.id, { reviewDecision: "approved", assetMatchKind: character.assetMatchKind === "look-candidate" ? "exact" : character.assetMatchKind, status: "ready" });
    taskCharacterIdentityAnchorsRef.current.set(taskIdentityAnchorKey(activeGenerationTaskId(), characterIdentity(character)), character.libraryAssetId || character.id);
    recordActivity("director", `角色“${character.name}”已由用户逐项批准并绑定到当前任务；新任务不会沿用内存绑定`, "done");
  }

  function rejectCharacterAsset(character: CharacterAsset) {
    if (character.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(character.imageUrl);
    patchCharacterReview(character.id, { imageUrl: undefined, remoteUrl: undefined, assetMatchKind: undefined, reviewDecision: "rejected", status: "error" });
    recordActivity("director", `角色“${character.name}”已被用户删除，未进入资产库`, "warning");
  }

  function approveSceneAsset(scene: Scene, kind: "image" | "audio") {
    if (kind === "image" && scene.imageUrl) {
      patchSceneReview(scene.id, { imageReviewDecision: "approved" });
      recordActivity("director", `镜头“${scene.title}”的画面已由用户逐项批准`, "done");
    }
    if (kind === "audio" && scene.audioUrl) {
      patchSceneReview(scene.id, { audioReviewDecision: "approved" });
      const castVoice = characters.find((character) => character.name === scene.speaker)?.voice || voice;
      void persistCanonicalVoiceProfile(scene, scene.audioUrl, scene.duration, castVoice).catch(() => undefined);
      autoArchive(scene.audioUrl, `${projectTitle}-${scene.title}-配音`, "audio", scene.duration, ["用户批准", "配音", scene.id, scene.speaker], { identityKey: voiceReuseIdentity(scene, castVoice), entityId: scene.speaker, lookName: "对白片段", variantName: castVoice });
      recordActivity("director", `镜头“${scene.title}”的配音已由用户逐项批准并进入资产库`, "done");
    }
  }

  function rejectSceneAsset(scene: Scene, kind: "image" | "audio") {
    const url = kind === "image" ? scene.imageUrl : scene.audioUrl;
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    if (kind === "image") patchSceneReview(scene.id, { imageUrl: undefined, remoteImageUrl: undefined, imageReviewDecision: "rejected", status: scene.videoUrl ? "ready" : "queued" });
    else patchSceneReview(scene.id, { audioUrl: undefined, audioReviewDecision: "rejected" });
    recordActivity("director", `镜头“${scene.title}”的${kind === "image" ? "画面" : "配音"}已被用户删除`, "warning");
  }

  function approveMusicAsset() {
    if (!musicUrl) return;
    setMusicReviewDecision("approved");
    autoArchive(musicUrl, `${projectTitle}-剧情配乐`, "audio", totalDuration, ["用户批准", "配乐"]);
    recordActivity("director", "剧情配乐已由用户逐项批准并进入资产库", "done");
  }

  function rejectMusicAsset() {
    if (musicUrl.startsWith("blob:")) URL.revokeObjectURL(musicUrl);
    setMusicUrl("");
    setMusicReviewDecision("rejected");
    invalidateExport();
    recordActivity("director", "剧情配乐已被用户删除", "warning");
  }

  function applyTeamProfile(profile: "free" | "pollinations") {
    setAgentConfigs(makeTeam(profile));
    setMode(profile === "free" ? "community" : "cloud");
    setConfiguringRole(null);
  }

  function selectAgentPreset(role: AgentRole, presetId: string) {
    const custom = customModels.find((item) => item.role === role && item.id === presetId);
    if (custom) {
      setAgentConfigs((current) => ({ ...current, [role]: { preset: custom.id, adapter: custom.adapter, model: custom.model, endpoint: custom.endpoint, apiKey: custom.apiKey } }));
      if (custom.adapter !== "browser") setMode("cloud");
      return;
    }
    const previous = agentConfigs[role];
    const next = configFromPreset(role, presetId);
    if (next.adapter === "webhook") {
      next.endpoint = previous.endpoint;
      next.apiKey = previous.apiKey;
      if (previous.adapter === "webhook") next.model = previous.model;
    }
    if (next.adapter === "seedance") {
      next.apiKey = previous.adapter === "seedance" ? previous.apiKey : seedanceApiKey;
      next.model = previous.adapter === "seedance" ? previous.model : seedanceModel;
    }
    setAgentConfigs((current) => ({ ...current, [role]: next }));
    if (next.adapter !== "horde" && next.adapter !== "browser") setMode("cloud");
  }

  function updateAgentConfig(role: AgentRole, patch: Partial<AgentConfig>) {
    setAgentConfigs((current) => ({ ...current, [role]: { ...current[role], ...patch } }));
    setRoleSaveState({ role, state: "idle", message: "配置已修改，点击下方按钮保存并应用" });
  }

  function desktopSettingsPayload(configs = agentConfigs, models = customModels) {
    return {
      version: 1,
      agentConfigs: configs,
      customModels: models,
      pollinationsKey: apiKey,
      bridge: { url: bridgeUrl, token: bridgeToken, lipsync: lipsyncEnabled },
      cloudEngines: { libtvKey: libtvAccessKey, libtvSessionId, libtvProjectUrl, seedanceKey: seedanceApiKey, seedanceModel },
      workspace: { projectTitle, story, style, targetDuration, aspect, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, scriptImported },
      savedAt: new Date().toISOString(),
    };
  }

  async function persistDesktopSettings(configs = agentConfigs, models = customModels) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("/api/desktop/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(desktopSettingsPayload(configs, models)),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("本机配置写入超过 6 秒，操作已解除锁定，请重试");
      throw reason;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function changeDirectApiMode(role: AgentRole, adapter: DiscoverableApiMode) {
    const defaults: Record<AgentRole, string> = { director: "", writer: "", prompt: "", image: "", video: "seedance-2.0", voice: "tts", editor: "" };
    setAgentConfigs((current) => {
      const previous = current[role];
      return {
        ...current,
        [role]: {
          // Choosing an API mode starts a fresh direct-role configuration. Do
          // not silently overwrite whichever saved custom model happened to be
          // selected before the user opened this form.
          preset: `direct-${role}`,
          adapter,
          model: previous.adapter === adapter ? previous.model : defaults[role],
          endpoint: previous.adapter === adapter && previous.endpoint ? previous.endpoint : API_MODE_DEFAULT_ENDPOINTS[adapter],
          apiKey: previous.adapter === adapter ? previous.apiKey : "",
        },
      };
    });
    setMode("cloud");
    setRoleModelOptions((current) => ({ ...current, [role]: [] }));
    setRoleSaveState({ role, state: "idle", message: `已切换为${API_MODE_LABELS[adapter]}，填写后请点击保存并应用` });
  }

  async function discoverCurrentAgentModels(role: AgentRole) {
    const config = agentConfigs[role];
    if (!apiModesForRole(role).includes(config.adapter as DiscoverableApiMode)) return;
    const adapter = config.adapter as DiscoverableApiMode;
    const endpoint = config.endpoint || API_MODE_DEFAULT_ENDPOINTS[adapter];
    if (!validAgentEndpoint(endpoint)) {
      setRoleSaveState({ role, state: "error", message: "请先填写有效的 API 地址" });
      return;
    }
    setRoleModelLoading(role);
    setRoleSaveState({ role, state: "saving", message: "正在连接 API 并读取模型列表…" });
    try {
      const models = await discoverApiModels({ mode: adapter, endpoint, apiKey: config.apiKey || (adapter === "pollinations" ? apiKey : "") });
      setRoleModelOptions((current) => ({ ...current, [role]: models }));
      updateAgentConfig(role, { endpoint, model: models.some((item) => item.id === config.model) ? config.model : models[0].id });
      setRoleSaveState({ role, state: "idle", message: `已读取 ${models.length} 个模型，请选择后点击“保存此岗位 API 并立即应用”` });
    } catch (reason) {
      setRoleModelOptions((current) => ({ ...current, [role]: [] }));
      setRoleSaveState({ role, state: "error", message: reason instanceof Error ? reason.message : "读取模型失败" });
    } finally {
      setRoleModelLoading(null);
    }
  }

  async function saveCurrentAgentApi(role: AgentRole) {
    if (roleModelWriteRef.current) return;
    const config = agentConfigs[role];
    if (!config.model.trim()) {
      setRoleSaveState({ role, state: "error", message: "请先填写或选择模型 ID" });
      return;
    }
    if (apiModesForRole(role).includes(config.adapter as DiscoverableApiMode) && !validAgentEndpoint(config.endpoint || API_MODE_DEFAULT_ENDPOINTS[config.adapter as DiscoverableApiMode])) {
      setRoleSaveState({ role, state: "error", message: "请填写有效的 HTTPS API 地址或本机 localhost 地址" });
      return;
    }
    if (config.adapter === "pollinations" && !(config.apiKey || apiKey).startsWith("pk_")) {
      setRoleSaveState({ role, state: "error", message: "Pollinations 需要填写以 pk_ 开头的发布密钥" });
      return;
    }
    const normalized = {
      ...config,
      endpoint: config.endpoint || (apiModesForRole(role).includes(config.adapter as DiscoverableApiMode) ? API_MODE_DEFAULT_ENDPOINTS[config.adapter as DiscoverableApiMode] : ""),
    };
    const existing = customModels.find((item) => item.role === role && item.id === normalized.preset);
    const libraryId = existing?.id || `custom-${role}-direct`;
    const libraryModel: CustomModel = {
      id: libraryId,
      role,
      name: existing && existing.name !== existing.model ? existing.name : normalized.model,
      adapter: normalized.adapter as CustomModel["adapter"],
      model: normalized.model,
      endpoint: normalized.endpoint,
      apiKey: normalized.apiKey,
      note: existing?.note || "从岗位 API 设置保存",
    };
    const nextModels = [libraryModel, ...customModels.filter((item) => item.id !== libraryId)].slice(0, 60);
    const applied = { ...normalized, preset: libraryId };
    const next = { ...agentConfigs, [role]: applied };
    setMode(normalized.adapter === "horde" || normalized.adapter === "browser" ? mode : "cloud");
    setRoleSaveState({ role, state: "saving", message: "正在保存岗位配置并同步到“我的模型”…" });
    roleModelWriteRef.current = role;
    try {
      await persistDesktopSettings(next, nextModels);
      saveCustomModels(nextModels);
      setCustomModels(nextModels);
      setAgentConfigs(next);
      window.localStorage.setItem("manjing-agent-team", JSON.stringify(next));
      setRoleSaveState({ role, state: "saved", message: `${AGENT_ROLES.find((item) => item.id === role)?.title || "当前岗位"} API 已保存、立即应用并同步到“我的模型”，下次打开会自动恢复` });
      setError("");
    } catch (reason) {
      setRoleSaveState({ role, state: "error", message: reason instanceof Error ? `保存失败：${reason.message}` : "保存失败，请重试" });
    } finally {
      roleModelWriteRef.current = null;
    }
  }

  function toggleQuickModel(role: AgentRole) {
    if (quickModelRole === role) {
      setQuickModelRole(null);
      setQuickModelMessage("");
      setQuickModelOptions([]);
      return;
    }
    setQuickModelRole(role);
    setQuickModelDraft({ name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" });
    setQuickModelMessage("");
    setQuickModelOptions([]);
  }

  function changeQuickApiMode(adapter: DiscoverableApiMode) {
    setQuickModelDraft((value) => ({ ...value, adapter, endpoint: API_MODE_DEFAULT_ENDPOINTS[adapter], model: "" }));
    setQuickModelOptions([]);
    setQuickModelMessage("");
  }

  async function discoverQuickModels() {
    const endpoint = quickModelDraft.endpoint.trim() || API_MODE_DEFAULT_ENDPOINTS[quickModelDraft.adapter];
    if (!validAgentEndpoint(endpoint)) {
      setQuickModelMessage("请先填写有效的 HTTPS API 地址，或本机 localhost 地址");
      return;
    }
    setQuickModelLoading(true);
    setQuickModelMessage("正在连接接口并读取模型列表…");
    try {
      const models = await discoverApiModels({
        mode: quickModelDraft.adapter,
        endpoint,
        apiKey: quickModelDraft.apiKey.trim(),
      });
      setQuickModelOptions(models);
      setQuickModelDraft((value) => ({ ...value, endpoint, model: models.some((item) => item.id === value.model) ? value.model : models[0].id }));
      setQuickModelMessage(`连接成功，已读取 ${models.length} 个模型，请选择后保存`);
    } catch (reason) {
      setQuickModelOptions([]);
      setQuickModelMessage(reason instanceof Error ? reason.message : "读取模型失败，请检查 API 模式、地址和密钥");
    } finally {
      setQuickModelLoading(false);
    }
  }

  async function saveQuickModel(role: AgentRole) {
    if (quickModelSaveRef.current) return;
    const modelId = quickModelDraft.model.trim();
    const name = quickModelDraft.name.trim() || modelId;
    const endpoint = quickModelDraft.endpoint.trim() || API_MODE_DEFAULT_ENDPOINTS[quickModelDraft.adapter];
    const apiKeyValue = quickModelDraft.apiKey.trim();
    if (!modelId) {
      setQuickModelMessage("请先读取并选择模型，或手动填写模型 ID");
      return;
    }
    if (!validAgentEndpoint(endpoint)) {
      setQuickModelMessage("请填写有效的 HTTPS 接口，或本机 localhost 地址");
      return;
    }
    const custom: CustomModel = {
      id: `custom-${role}-${Date.now().toString(36)}`,
      role,
      name,
      adapter: quickModelDraft.adapter,
      model: modelId,
      endpoint,
      apiKey: apiKeyValue,
      note: quickModelDraft.note.trim() || "工作台内添加的自定义模型",
    };
    const next = [custom, ...customModels.filter((item) => item.id !== custom.id)].slice(0, 60);
    const nextConfigs = {
      ...agentConfigs,
      [role]: { preset: custom.id, adapter: custom.adapter, model: custom.model, endpoint: custom.endpoint, apiKey: custom.apiKey },
    };
    quickModelSaveRef.current = true;
    setQuickModelSaving(true);
    try {
      await persistDesktopSettings(nextConfigs, next);
      saveCustomModels(next);
      setCustomModels(next);
      setAgentConfigs(nextConfigs);
      window.localStorage.setItem("manjing-agent-team", JSON.stringify(nextConfigs));
      setMode("cloud");
      setQuickModelDraft({ name: "", adapter: "webhook", model: "", endpoint: "", apiKey: "", note: "" });
      setQuickModelOptions([]);
      setQuickModelMessage(`${custom.name} 已保存并应用到 ${AGENT_ROLES.find((item) => item.id === role)?.title || "当前岗位"}`);
      setError("");
    } catch {
      setQuickModelMessage("保存失败：本机模型库暂时不可写，请重启软件后重试");
    } finally {
      quickModelSaveRef.current = false;
      setQuickModelSaving(false);
    }
  }

  async function deleteRoleCustomModel(role: AgentRole, id: string) {
    if (roleModelWriteRef.current) return;
    const target = customModels.find((item) => item.id === id && item.role === role);
    if (!target) return;
    const nextModels = customModels.filter((item) => item.id !== id);
    const fallback = configFromPreset(role, AGENT_PRESETS[role][0].id);
    const nextConfigs = agentConfigs[role].preset === id ? { ...agentConfigs, [role]: fallback } : agentConfigs;
    setRoleSaveState({ role, state: "saving", message: `正在删除“${target.name}”并同步本机配置…` });
    roleModelWriteRef.current = role;
    try {
      await persistDesktopSettings(nextConfigs, nextModels);
      saveCustomModels(nextModels);
      setCustomModels(nextModels);
      setAgentConfigs(nextConfigs);
      window.localStorage.setItem("manjing-agent-team", JSON.stringify(nextConfigs));
      setRoleModelOptions((current) => ({ ...current, [role]: (current[role] || []).filter((item) => item.id !== target.id) }));
      setRoleSaveState({ role, state: "saved", message: agentConfigs[role].preset === id ? `已删除“${target.name}”，${AGENT_ROLES.find((item) => item.id === role)?.title}已自动切回免费默认模型` : `已删除“${target.name}”` });
    } catch (reason) {
      setRoleSaveState({ role, state: "error", message: reason instanceof Error ? `删除失败：${reason.message}` : "删除失败，请重试" });
    } finally {
      roleModelWriteRef.current = null;
    }
  }

  function applySeedanceEngine() {
    if (seedanceApiKey.trim().length < 8) {
      setError("请先填写火山方舟 API Key");
      return;
    }
    if (!/^(?:doubao-seedance-[a-z0-9-]+|ep-[a-z0-9-]+)$/i.test(seedanceModel.trim())) {
      setError("请填写正确的 Seedance 模型 ID 或 Endpoint ID");
      return;
    }
    const appliedModel = seedanceModel.trim();
    const appliedPreset = /^doubao-seedance-2-0-260128$/i.test(appliedModel) ? "volc-seedance" : "direct-video";
    if (/seedance-2-0-fast/i.test(appliedModel) && videoResolution === "1080p") setVideoResolution("720p");
    setAgentConfigs((current) => ({
      ...current,
      video: { preset: appliedPreset, adapter: "seedance", model: appliedModel, endpoint: "", apiKey: seedanceApiKey.trim() },
    }));
    setMode("cloud");
    setConfiguringRole(null);
    setError("");
  }

  function agentName(role: AgentRole) {
    const config = agentConfigs[role];
    return AGENT_PRESETS[role].find((item) => item.id === config.preset)?.name || customModels.find((item) => item.id === config.preset)?.name || config.model;
  }

  function agentKey(role: AgentRole) {
    return agentConfigs[role].apiKey.trim() || apiKey.trim();
  }

  function normalizedBridgeUrl() {
    return bridgeUrl.trim().replace(/\/+$/, "");
  }

  function applyBridgeRole(role: "image" | "video" | "voice") {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setError("请先填写有效的 HTTPS 桥接地址，或本机 localhost 地址");
      return;
    }
    const definitions = {
      image: { preset: "comfyui-image", model: "ComfyUI Image Workflow", path: "/v1/image" },
      video: { preset: "wan22-video", model: "Wan2.2 / ComfyUI", path: "/v1/video" },
      voice: { preset: "cosyvoice-voice", model: "CosyVoice", path: "/v1/audio" },
    } as const;
    const selected = definitions[role];
    setAgentConfigs((current) => ({ ...current, [role]: { preset: selected.preset, adapter: "webhook", model: selected.model, endpoint: `${base}${selected.path}`, apiKey: bridgeToken.trim() } }));
    setMode("cloud");
    setConfiguringRole(null);
    setError("");
  }

  function applyVibeVoiceRole() {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setError("请先填写有效的漫镜桥接地址");
      return;
    }
    setAgentConfigs((current) => ({
      ...current,
      voice: { preset: "vibevoice-realtime-voice", adapter: "webhook", model: "VibeVoice-Realtime-0.5B", endpoint: `${base}/v1/vibevoice/audio`, apiKey: bridgeToken.trim() },
    }));
    setMode("cloud");
    setConfiguringRole(null);
    setError("");
  }

  function applyBridgeStack() {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setError("请先填写有效的漫镜桥接地址");
      return;
    }
    setAgentConfigs((current) => ({
      ...current,
      image: { preset: "comfyui-image", adapter: "webhook", model: "ComfyUI Image Workflow", endpoint: `${base}/v1/image`, apiKey: bridgeToken.trim() },
      video: { preset: "wan22-video", adapter: "webhook", model: "Wan2.2 / ComfyUI", endpoint: `${base}/v1/video`, apiKey: bridgeToken.trim() },
      voice: { preset: "cosyvoice-voice", adapter: "webhook", model: "CosyVoice", endpoint: `${base}/v1/audio`, apiKey: bridgeToken.trim() },
    }));
    setMode("cloud");
    setLipsyncEnabled(true);
    setConfiguringRole(null);
    setError("");
  }

  async function testBridgeConnection() {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base)) {
      setBridgeHealth({ state: "error", message: "地址格式不正确" });
      return;
    }
    setBridgeHealth({ state: "testing", message: "正在检测本地节点" });
    try {
      const response = await fetch(`${base}/health`, { headers: bridgeToken.trim() ? { Authorization: `Bearer ${bridgeToken.trim()}` } : {} });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { nodes?: Record<string, boolean>; workflows?: Record<string, boolean> };
      const nodes = data.nodes || {};
      const workflows = data.workflows || {};
      const readyCount = Object.values(nodes).filter(Boolean).length;
      const totalCount = Object.keys(nodes).length;
      setBridgeHealth({ state: readyCount === totalCount && workflows.image && workflows.video ? "ready" : "partial", message: readyCount ? `${readyCount}/${totalCount} 个模型节点在线` : "桥接服务在线，但模型节点未启动", nodes, workflows });
    } catch (reason) {
      setBridgeHealth({ state: "error", message: reason instanceof Error ? reason.message : "无法连接桥接服务" });
    }
  }

  async function createLipSyncedVideo(scene: Scene) {
    const base = normalizedBridgeUrl();
    if (!validAgentEndpoint(base) || !scene.audioUrl || (!scene.videoUrl && !scene.imageUrl)) return "";
    const [sourceResponse, audioResponse] = await Promise.all([fetch(scene.videoUrl || scene.imageUrl as string), fetch(scene.audioUrl)]);
    if (!sourceResponse.ok || !audioResponse.ok) throw new Error("口型增强无法读取镜头画面或配音");
    const sourceBlob = await sourceResponse.blob();
    const audioBlob = await audioResponse.blob();
    const form = new FormData();
    form.append("source", sourceBlob, `scene.${scene.videoUrl ? "mp4" : "png"}`);
    form.append("audio", audioBlob, "voice.wav");
    const response = await fetch(`${base}/v1/lipsync`, { method: "POST", headers: bridgeToken.trim() ? { Authorization: `Bearer ${bridgeToken.trim()}` } : {}, body: form });
    if (!response.ok) throw new Error(await responseError(response));
    if ((response.headers.get("content-type") || "").startsWith("video/")) return URL.createObjectURL(await response.blob());
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error("MuseTalk 没有返回口型视频");
    const output = await fetch(data.url, { headers: bridgeToken.trim() ? { Authorization: `Bearer ${bridgeToken.trim()}` } : {} });
    if (!output.ok) throw new Error("MuseTalk 输出视频无法读取");
    return URL.createObjectURL(await output.blob());
  }

  async function callAgentWebhook(role: AgentRole, payload: Record<string, unknown>) {
    const config = agentConfigs[role];
    if (!validAgentEndpoint(config.endpoint)) throw new Error(`${agentName(role)}需要填写 HTTPS 地址或本机 localhost 地址`);
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ role, model: config.model, ...payload }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return response;
  }

  async function customApiText(role: "director" | "writer" | "prompt" | "editor", payload: Record<string, unknown>) {
    const config = agentConfigs[role];
    // The prompt controller already receives a curated skill summary in its system
    // prompt. Appending the full skill bodies again can multiply the request size and
    // make otherwise healthy OpenAI-compatible endpoints miss the UI deadline.
    const learned = payload.task === "compile_video_prompt" ? [] : agentContext(role).slice(0, 8);
    const learnedContext = learned.length ? `\n\n以下是用户已审核启用的岗位技能与记忆，请在适用时运用，并避免机械照抄：\n${learned.map((item) => `- [${item.kind === "skill" ? "技能" : "记忆"}] ${item.title}：${item.content.slice(0, 1200)}`).join("\n")}` : "";
    if (!CUSTOM_TEXT_ADAPTERS.includes(config.adapter)) throw new Error(`${agentName(role)}不支持当前文本任务`);
    if (!validAgentEndpoint(config.endpoint)) throw new Error(`${agentName(role)}需要填写 HTTPS API 地址或本机 localhost 地址`);
    const response = await fetch("/api/desktop/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: config.adapter,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        role,
        task: payload.task,
        system: `${String(payload.system || "")}${learnedContext}`,
        prompt: payload.prompt,
        payload,
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json() as { text?: string };
    const text = data.text;
    if (!text) throw new Error(`${agentName(role)}没有返回文本结果`);
    markContextUsed(learned.map((item) => item.id));
    return text;
  }

  async function webhookMedia(role: "image" | "video" | "voice", payload: Record<string, unknown>) {
    const memoryRole = role === "image" ? "director" : role;
    const learned = agentContext(memoryRole).slice(0, 8).map((item) => ({ type: item.kind, title: item.title, content: item.content }));
    const learnedPayload = learned.length ? { ...payload, agentLearning: learned } : payload;
    if (role === "video" && (/^agnes-video-/i.test(agentConfigs.video.model) || /agnes-ai\.com/i.test(agentConfigs.video.endpoint))) {
      const response = await fetch("/api/desktop/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "webhook", endpoint: agentConfigs.video.endpoint, apiKey: agentConfigs.video.apiKey, model: agentConfigs.video.model, ...learnedPayload }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { videoUrl?: string; dataUrl?: string };
      const remoteUrl = data.videoUrl || data.dataUrl || "";
      if (!remoteUrl) throw new Error("Agnes did not return a playable video URL");
      const mediaResponse = await fetch(remoteUrl);
      if (!mediaResponse.ok) throw new Error("Agnes generated the video, but the download failed");
      const blob = await mediaResponse.blob();
      if (!blob.type.startsWith("video/")) throw new Error("Agnes returned a non-video file");
      return { url: URL.createObjectURL(blob), blob, remoteUrl: data.videoUrl || "" };
    }
    const response = await callAgentWebhook(role, learnedPayload);
    let blob: Blob;
    let remoteUrl = "";
    if ((response.headers.get("content-type") || "").startsWith(role === "image" ? "image/" : role === "video" ? "video/" : "audio/")) {
      blob = await response.blob();
    } else {
      const data = await response.json() as { url?: string; dataUrl?: string };
      remoteUrl = data.url || data.dataUrl || "";
      if (!remoteUrl) throw new Error(`${agentName(role)}没有返回媒体地址`);
      const mediaResponse = await fetch(remoteUrl, { headers: agentConfigs[role].apiKey ? { Authorization: `Bearer ${agentConfigs[role].apiKey}` } : {} });
      if (!mediaResponse.ok) throw new Error(`${agentName(role)}返回的媒体无法读取`);
      blob = await mediaResponse.blob();
    }
    const expected = role === "image" ? "image/" : role === "video" ? "video/" : "audio/";
    if (!blob.type.startsWith(expected)) throw new Error(`${agentName(role)}返回的文件类型不正确`);
    return { url: URL.createObjectURL(blob), blob, remoteUrl };
  }

  async function startHorde(action: "story" | "director" | "assets" | "image", payload: Record<string, unknown>) {
    const response = await fetch("/api/horde", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return (await response.json()) as { id: string; kind: "text" | "image" };
  }

  async function pollHorde(
    kind: "text" | "image",
    id: string,
    run: number,
    options: { maxAttempts?: number; onPending?: (attempt: number, data: Record<string, unknown>) => void; timeoutMessage?: string } = {},
  ) {
    const maxAttempts = options.maxAttempts || 160;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (runRef.current !== run) throw new Error("任务已取消");
      const response = await fetch(`/api/horde?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.error) throw new Error(String(data.error || `生成失败（${response.status}）`));
      if (data.done) return data;
      options.onPending?.(attempt + 1, data);
      if (kind === "image" && typeof data.wait_time === "number") setStatusText(`社区队列处理中，预计等待 ${data.wait_time} 秒`);
      await wait(kind === "image" ? 4200 : 3000);
    }
    throw new Error(options.timeoutMessage || "生成等待超时，请稍后重试");
  }

  async function pollinationsText(role: "director" | "writer" | "prompt" | "editor", system: string, user: string) {
    const key = agentKey(role);
    if (!key.startsWith("pk_")) throw new Error(`${agentName(role)}需要 Pollinations 发布密钥`);
    const response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: agentConfigs[role].model || "openai",
        temperature: 0.7,
        safe: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("云端模型没有返回剧本");
    return content;
  }

  async function generateStoryboard(run: number) {
    const minimumCount = sceneCountForDuration(productionDuration);
    const maximumCount = productionDuration <= 15 ? 1 : Math.min(16, minimumCount + 3);
    const config = agentConfigs.writer;
    const storyboardStory = compactStoryboardContext(story.trim());
    const sourceText = scriptImported ? `这是用户已经完成并锁定的剧本。不得改写剧情、人物关系或结局，只把原剧本结构化拆成分镜：\n${storyboardStory}` : storyboardStory;
    setStatusText(`${agentName("writer")}正在生成分镜 · 本次上下文 ${Math.ceil(storyboardStory.length / 1000)}K 字符`);
    if (config.adapter === "horde") {
      const task = await startHorde("story", { story: `${sourceText}\n\n${productionDuration <= 15 ? `目标只有 ${productionDuration} 秒，必须设计为一个连续完整镜头，不得拆镜。` : `请分析剧情节拍、场景变化、视角变化和动作复杂度，自主决定 ${minimumCount}–${maximumCount} 个镜头，并为每镜独立决定不同或相同的合理时长；不得机械平均。`} 每镜最多15秒，总时长必须等于目标时长。`, style, count: maximumCount, role: "writer", model: config.model });
      const result = await pollHorde("text", task.id, run, {
        maxAttempts: 30,
        timeoutMessage: "免费分镜模型排队超过 90 秒，请稍后重试或切换更快的编剧模型",
        onPending: (attempt) => {
          setProgress(Math.min(10, 4 + Math.ceil(attempt / 5)));
          setStatusText(`免费分镜 AI 正在排队 · 已等待 ${attempt * 3} 秒 / 最长 90 秒 · 上下文 ${Math.ceil(storyboardStory.length / 1000)}K 字符`);
        },
      });
      return String(result.text || "");
    }
    const sourceLanguage = scriptLanguage(storyboardStory);
    const languageRule = sourceLanguage === "English"
      ? "The source screenplay is English. Preserve every character name and spoken line in English; never translate dialogue or proper names into Chinese. JSON keys must remain exactly as specified. Descriptive production fields may use concise English."
      : "源剧本为中文。角色名、对白和制作描述使用简体中文。";
    const system = `你是专业 AI 漫剧编剧和分镜师。${scriptImported ? "用户提供的是已经定稿的完整剧本，严禁改写剧情、角色关系、台词含义和结局，只做结构化拆镜。导入阶段已经生成并由用户确认唯一资产清单；本阶段只能逐字引用清单中的 identityName、lookName 和 environmentKey，严禁重新分析、改名或新增人物造型。地点、昼夜和镜号不是人物造型。" : "把故事改编为可拍摄短剧。"}${productionDuration <= 15 ? `目标时长为 ${productionDuration} 秒，必须设计为一个连续完整镜头，禁止拆成多个镜头。` : `先分析剧情 Beat、场景/时空变化、视角变化、动作复杂度和情绪节奏，自主决定 ${minimumCount}–${maximumCount} 个镜头。每个镜头的时长由叙事需要独立决定，可以相同也可以不同，禁止机械平均；重要动作和情绪可更长，转场与反应可更短。`}每镜不得超过15秒，总时长必须精确等于目标时长。先为全剧建立场景身份：同一地点、时间、天气和布景必须复用同一个 environmentKey，并写出 environmentBible，固定空间布局、门窗方向、道具位置、主色调与光线方向。人物身份和本集造型必须分层：同一个 identityName 保持同一张脸；剧本中每一种实际出镜的服装、妆发、受伤或贫富状态都在 characters 中建立独立 lookName 资产，appearance 只描述该造型，禁止把白衣和黑衣等互斥造型揉成一张图。每镜必须用 characterLooks 显式指定每个出镜人物当前引用的 lookName，例如 {"男主":"白衣版"}，且只能引用 characters 已列出的对应造型。不同人物必须有明显不同的脸型、眼型、鼻形、嘴形、眉形、年龄感、体型和辨识标记，禁止同脸。每镜必须写 continuity 说明如何承接上一镜，并用 endState 记录镜头结束时人物位置、朝向、手持道具和动作姿态；正式换景时明确说明。camera 必须根据动作从横向轨道、稳定器跟拍、肩后横移、弧形环绕、摇镜揭示、升降摇臂、受控手持、前景擦镜等技巧中选择，连续镜头不得重复只写推进或拉远，并写明缓入缓出和动作匹配点。${languageRule} 只返回 JSON。结构：{"title":"标题","music":"无歌词配乐描述","shotPlan":{"count":镜头数,"reason":"拆镜或不拆镜的简短理由"},"characters":[{"name":"角色身份名","identityName":"角色身份名","lookName":"本集服装/状态名","episodeScope":"当前集或集数","sceneHints":["使用镜头或剧情短语"],"role":"身份","appearance":"固定身份特征加当前造型，且与其他人物有明显差异","voice":"nova|coral|onyx|echo"}],"scenes":[{"title":"镜头标题","environmentKey":"场景身份","environmentBible":"固定背景和空间规则","continuity":"与上一镜的关系或换景说明","endState":"镜头结束状态","characters":["角色身份名"],"characterLooks":{"角色身份名":"该镜造型名"},"shot":"景别","visual":"场景、构图、灯光与生图提示词","action":"人物连续动作、表情、互动与视频提示词","camera":"具体运镜轨迹、速度变化和衔接点","speaker":"说话角色","emotion":"台词情绪","dialogue":"自然简短台词","sfx":"环境音或动作音","duration":6}]}。角色身份、当镜造型与场景背景必须一致；每镜都要推动剧情。`;
  const user = `视觉风格：${style}\n目标时长：${productionDuration} 秒\n已锁定剧本简介：${scriptMemory.synopsis || "未单独提供，以完整剧本为准"}\n已锁定背景故事/世界记忆：${scriptMemory.background || "未单独提供，以完整剧本为准"}\n已锁定人物造型清单（只能选择，禁止新增或改名）：${characters.length ? JSON.stringify(characters.filter(isVisualCharacterAsset).map((item) => ({ identityName: characterIdentity(item), lookName: characterLook(item), appearance: item.appearance, sceneHints: item.sceneHints }))) : "未导入剧本时可按故事规划"}\n已规划 Canonical 场景（environmentKey 必须逐字选用，禁止另起同义名称）：${sceneAssets.length ? JSON.stringify(sceneAssets.map((item) => ({ environmentKey: item.environmentKey, name: item.name, description: item.description, timeWeather: item.timeWeather, sceneHints: item.sceneHints }))) : "尚无预分析场景，以剧本实际地点建立稳定键"}\n资产规划要求：每个镜头的 visual 必须使用 [场景:场景身份] 标记固定场景，并用 [道具:道具1,道具2] 标记真正推动剧情或跨镜重复出现的重要道具；普通桌椅和无关装饰不要列为重要道具。后续跳过分镜图片，视频模型只通过全能参考组合已锁定的人物身份、当前造型、Canonical 场景图、道具、音色和上一镜已批准视频；禁止提交首帧或尾帧图片，不得脱离资产重新设计。\n${scriptImported ? "用户定稿剧本" : "故事"}：${storyboardStory}`;
    const storyboardTask = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
      ? customApiText("writer", { task: "storyboard", system, prompt: user, minimumCount, maximumCount, duration: productionDuration })
      : pollinationsText("writer", system, user);
    const storyboardTimeoutMs = Math.min(600000, 180000 + Math.ceil(productionDuration / 30) * 60000);
    return withStageProgress(storyboardTask, storyboardTimeoutMs, `分镜模型连续 ${Math.round(storyboardTimeoutMs / 1000)} 秒没有返回，请检查接口状态或切换模型后重试`, (elapsed) => {
      setProgress(Math.min(12, 5 + Math.floor(elapsed / 45)));
      setStatusText(`${agentName("writer")}仍在生成完整分镜 · 已等待 ${elapsed} 秒${elapsed >= 120 ? " · 漫镜继续等待原请求，不会重复提交" : ""} · 上下文 ${Math.ceil(storyboardStory.length / 1000)}K 字符`);
    });
  }

  async function directorReview(draft: string, run: number) {
    const config = agentConfigs.director;
    const minimumCount = sceneCountForDuration(productionDuration);
    const maximumCount = productionDuration <= 15 ? 1 : Math.min(16, minimumCount + 3);
    setStatusText(`${agentName("director")}正在审查人物一致性、节奏和结尾钩子`);
    if (config.adapter === "horde") {
      const task = await startHorde("director", { story: story.trim(), style, draft, count: maximumCount, minCount: minimumCount, model: config.model });
      const result = await pollHorde("text", task.id, run, {
        maxAttempts: 6,
        timeoutMessage: "导演复核排队超时",
        onPending: (attempt) => {
          setProgress(Math.min(14, 10 + Math.ceil(attempt / 2)));
          setStatusText(`免费导演 AI 正在排队复核（已等待 ${attempt * 3} 秒），超过 18 秒将自动采用编剧初稿`);
        },
      });
      return String(result.text || draft);
    }
    const system = `你是 AI 漫剧总导演。审查编剧交付的 JSON 分镜。${productionDuration <= 15 ? `目标时长为 ${productionDuration} 秒，最终必须只有一个连续完整镜头，发现拆镜必须合并。` : `根据剧情 Beat、场景变化、视角必要性、动作复杂度和情绪节奏，独立决定 ${minimumCount}–${maximumCount} 镜，并逐镜决定时长；可以相同也可以不同，但禁止机械平均。`}单镜不得超过15秒，总时长必须精确等于目标时长。检查同一 identityName 的脸部身份保持不变、每个本集服装/状态均有独立 lookName 资产，并确保每镜 characterLooks 只引用该镜剧情实际需要的造型；不得把同一人物的多套互斥服装同时引用。检查每个 environmentKey 的 environmentBible 是否稳定，逐镜校验人物站位、朝向、视线、手持道具、动作方向、背景布局和光线连续性；判断 continuity 是连续动作、同场景换机位、反打还是正式换景，并保证上一镜 endState 能被下一镜自然承接。更新 shotPlan 后只返回完整 JSON，不要解释。`;
    const user = `原故事：${compactStoryboardContext(story.trim())}\n视觉风格：${style}\n编剧初稿：${draft}`;
    const reviewTask = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
      ? customApiText("director", { task: "review_storyboard", system, prompt: user, draft })
      : pollinationsText("director", system, user);
    return withStageProgress(reviewTask, 420000, "导演复核连续 420 秒没有返回，请检查导演模型接口", (elapsed) => {
      setStatusText(`${agentName("director")}正在复核分镜 · 已等待 ${elapsed} 秒 · 不会重复提交`);
    });
  }

  async function seedanceRequest(path: string, init: RequestInit, label: string, maxAttempts = 3) {
    let lastResponse: Response | null = null;
    const isCreateRequest = typeof init.body === "string" && /"action"\s*:\s*"create"/.test(init.body);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      seedanceRequestControllerRef.current = controller;
      const timeoutMs = path.includes("?url=") ? 380000 : isCreateRequest ? 205000 : 160000;
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const requestPaths = path.startsWith("/api/seedance")
          ? [path.replace("/api/seedance", "/api/desktop/seedance"), path]
          : [path];
        let response: Response | null = null;
        let desktopFailure: unknown = null;
        for (let pathIndex = 0; pathIndex < requestPaths.length; pathIndex += 1) {
          try {
            const candidate = await fetch(requestPaths[pathIndex], { ...init, cache: "no-store", signal: controller.signal });
            if (pathIndex === 0 && requestPaths.length > 1 && candidate.status === 404) continue;
            response = candidate;
            break;
          } catch (reason) {
            desktopFailure = reason;
            if (isCreateRequest) throw reason;
            if (pathIndex === requestPaths.length - 1) throw reason;
          }
        }
        if (!response) throw desktopFailure || new Error("内置 Seedance 通道没有返回响应");
        lastResponse = response;
        const transient = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const retryInfo = transient ? await response.clone().json().catch(() => null) as { done?: boolean; retryable?: boolean } | null : null;
        const shouldStop = Boolean(retryInfo?.done) || retryInfo?.retryable === false;
        if (!transient || shouldStop || attempt === maxAttempts - 1) return response;
        setStatusText(`${label}遇到网络波动，正在自动重连 ${attempt + 1}/${maxAttempts - 1}`);
      } catch (reason) {
        const cancelledByUser = controller.signal.aborted && seedanceRequestControllerRef.current !== controller;
        if (cancelledByUser) throw new Error("任务已取消");
        if (attempt === maxAttempts - 1) {
          const detail = reason instanceof DOMException && reason.name === "AbortError" ? `连接等待超过 ${Math.round(timeoutMs / 1000)} 秒` : "桌面端与内置 Seedance 通道的连接被中断";
          throw new Error(`${label}失败：${detail}。无需安装火山引擎 SDK；请检查网络或代理后再次点击“重新运行视频 AI”`);
        }
        setStatusText(`${label}连接中断，正在自动重连 ${attempt + 1}/${maxAttempts - 1}`);
      } finally {
        window.clearTimeout(timeout);
        if (seedanceRequestControllerRef.current === controller) seedanceRequestControllerRef.current = null;
      }
      await wait(900 * (attempt + 1));
    }
    if (lastResponse) return lastResponse;
    throw new Error(`${label}失败：没有收到接口响应`);
  }

  async function extractVideoContinuityFrames(videoUrl: string, scene: Scene) {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`视频关键帧读取失败（${response.status}）`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = objectUrl;
    try {
      await withStageTimeout(new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("视频关键帧解码失败"));
      }), 30000, "视频关键帧解码等待超过 30 秒");
      const duration = Number.isFinite(video.duration) ? video.duration : Math.max(1, scene.duration);
      const capture = async (time: number) => {
        await withStageTimeout(new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error("视频关键帧定位失败"));
          video.currentTime = Math.max(0, Math.min(Math.max(0, duration - 0.05), time));
        }), 15000, "视频关键帧定位等待超过 15 秒");
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("视频关键帧画布不可用");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.9);
      };
      const sampleTimes = [0.05, 0.25, 0.5, 0.75, 0.98].map((ratio) => duration * ratio);
      const samples: string[] = [];
      for (const sampleTime of sampleTimes) samples.push(await capture(sampleTime));
      const auditCanvas = document.createElement("canvas");
      auditCanvas.width = 1440;
      auditCanvas.height = 540;
      const auditContext = auditCanvas.getContext("2d");
      if (!auditContext) throw new Error("视频一致性检查画布不可用");
      auditContext.fillStyle = "#111";
      auditContext.fillRect(0, 0, auditCanvas.width, auditCanvas.height);
      for (let index = 0; index < samples.length; index += 1) {
        const image = new Image();
        image.src = samples[index];
        await withStageTimeout(new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("视频一致性样本解码失败"));
        }), 15000, "视频一致性样本解码等待超过 15 秒");
        const column = index % 3;
        const row = Math.floor(index / 3);
        auditContext.drawImage(image, column * 480, row * 270, 480, 270);
        auditContext.fillStyle = "rgba(0,0,0,.72)";
        auditContext.fillRect(column * 480, row * 270, 86, 28);
        auditContext.fillStyle = "#fff";
        auditContext.font = "16px sans-serif";
        auditContext.fillText(`${Math.round(sampleTimes[index] / Math.max(duration, 0.01) * 100)}%`, column * 480 + 12, row * 270 + 20);
      }
      return { start: samples[0], middle: samples[2], end: samples[4], audit: auditCanvas.toDataURL("image/jpeg", 0.9), samples };
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  function audioBufferToWav(buffer: AudioBuffer, maxSeconds = 12) {
    const sampleCount = Math.min(buffer.length, Math.floor(buffer.sampleRate * Math.max(2, maxSeconds)));
    const channels = Math.min(2, buffer.numberOfChannels);
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const output = new ArrayBuffer(44 + sampleCount * blockAlign);
    const view = new DataView(output);
    const writeText = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * blockAlign, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleCount * blockAlign, true);
    let offset = 44;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const value = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[sample] || 0));
        view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([output], { type: "audio/wav" });
  }

  async function recordVideoAudioTrack(videoBlob: Blob, maxSeconds = 12) {
    const objectUrl = URL.createObjectURL(videoBlob);
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.src = objectUrl;
    const context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((item) => MediaRecorder.isTypeSupported(item)) || "";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
    try {
      await withStageTimeout(new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("无法读取分镜视频音轨"));
      }), 30000, "分镜视频音轨读取等待超过 30 秒");
      const seconds = Math.max(2, Math.min(14, maxSeconds, Number.isFinite(video.duration) ? video.duration : maxSeconds));
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start(250);
      await context.resume();
      await video.play();
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, seconds * 1000);
        video.onended = () => { window.clearTimeout(timeout); resolve(); };
      });
      video.pause();
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (!audio.size) throw new Error("分镜视频没有可截取的有效音轨");
      return { blob: audio, duration: seconds };
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
      destination.stream.getTracks().forEach((track) => track.stop());
      source.disconnect();
      await context.close().catch(() => undefined);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function extractGeneratedVideoVoice(scene: Scene, videoUrl: string) {
    const voiceover = sceneVoiceover(scene);
    if (!voiceEnabled || voiceover.mode !== "onscreen_dialogue" || !voiceover.speaker || !voiceover.script) return null;
    if (await canonicalVoiceProfile(scene)) return null;
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) throw new Error("无法读取首条人物对白视频");
    const videoBlob = await videoResponse.blob();
    let audioBlob: Blob | null = null;
    if (validAgentEndpoint(bridgeUrl)) {
      const form = new FormData();
      form.append("video", new File([videoBlob], `${scene.title || "scene"}.mp4`, { type: videoBlob.type || "video/mp4" }));
      form.append("speaker", voiceover.speaker);
      form.append("start", "0");
      form.append("duration", String(Math.max(2, Math.min(12, scene.duration))));
      const response = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/v1/voice-profiles/extract`, { method: "POST", headers: bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}, body: form });
      if (response.ok) {
        const data = await response.json() as { url?: string };
        if (data.url) {
          const extracted = await fetch(data.url);
          if (extracted.ok) audioBlob = await extracted.blob();
        }
      }
    }
    if (!audioBlob) {
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(await videoBlob.arrayBuffer());
        audioBlob = audioBufferToWav(decoded, Math.max(2, Math.min(12, scene.duration)));
      } catch {
        const recorded = await recordVideoAudioTrack(videoBlob, Math.max(2, Math.min(12, scene.duration)));
        audioBlob = recorded.blob;
      } finally {
        await context.close().catch(() => undefined);
      }
    }
    const voiceName = characters.find((item) => item.name === voiceover.speaker)?.voice || voice;
    const saved = await persistCanonicalVoiceProfile(scene, audioBlob, Math.max(2, Math.min(12, scene.duration)), voiceName, "video-extracted", scene.remoteVideoUrl);
    if (saved?.url) canonicalVoiceAudioRef.current.set(voiceover.speaker, saved.url);
    recordActivity("voice", `已从 ${voiceover.speaker} 的首条视频对白提取音色；本集后续镜头立即引用，跨项目复用前仍需在音色库确认`, "done");
    return saved;
  }

  async function persistSceneVideoAsset(scene: Scene, videoUrl: string, state: "candidate" | "approved") {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error("视频已生成，但无法写入本地持久化资产库");
    const blob = await response.blob();
    if (!blob.type.startsWith("video/")) throw new Error("视频模型返回的媒体格式无效");
    const context = activeSeriesContext();
    const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : "mp4";
    const saved = await saveLibraryFile(new File([blob], `${scene.title || scene.id}-${state}.${extension}`, { type: blob.type }), {
      name: `${projectTitle || "未命名项目"}-${scene.title}-${state === "approved" ? "已批准" : "待审核"}`,
      category: "video",
      duration: scene.duration,
      tags: [state === "approved" ? "已批准分镜视频" : "待审核分镜视频", context.episodeNumber ? `episode-number:${context.episodeNumber}` : "单集项目", `scene-id:${scene.id}`],
      reusable: state === "approved",
      locked: true,
      identityKey: `shot:${context.projectId || activeAssetProjectId()}:${context.episodeId || "standalone"}:${scene.id}`,
      entityId: scene.id,
      purposes: ["shot-continuity"],
      semanticDescription: state === "approved" ? "用户已批准的分镜视频，可作为后续镜头的 @Video 全能参考；不得拆出首尾帧作为生成参考" : "待用户逐镜审核的视频候选，不得被后续镜头引用",
      projectId: context.projectId || activeAssetProjectId(),
      episodeId: context.episodeId,
    });
    if (state === "candidate" && scene.candidateVideoAssetId && scene.candidateVideoAssetId !== saved.id) await deleteLibraryAsset(scene.candidateVideoAssetId).catch(() => undefined);
    return saved;
  }

  type VideoReference = {
    kind: "image" | "video" | "audio";
    role: "reference_image" | "reference_video" | "reference_audio";
    url: string;
    name: string;
    referenceText?: string;
    libraryAssetId?: string;
    identityKey?: string;
    lookName?: string;
  };
  type MediaReference = string | VideoReference;

  type SceneVoiceover = { script: string; speaker: string; mode: "onscreen_dialogue" | "inner_monologue" | "voice_over" | "none" };

  function sceneVoiceover(scene: Scene): SceneVoiceover {
    const script = scene.dialogue.trim();
    if (!script) return { script: "", speaker: scene.speaker || "", mode: "none" };
    const context = `${scene.speaker} ${scene.action} ${scene.visual}`;
    if (/(?:内心|心声|心里|独白|\bOS\b)/i.test(context)) return { script, speaker: scene.speaker || "内心 OS", mode: "inner_monologue" };
    if (/(?:旁白|画外|广播|广告声|系统声|播报|解说)/i.test(context)) return { script, speaker: scene.speaker || "旁白", mode: "voice_over" };
    return { script, speaker: scene.speaker || "角色", mode: "onscreen_dialogue" };
  }

  function rememberCanonicalVoiceAudio(scene: Scene, audioUrl: string | undefined) {
    const voiceover = sceneVoiceover(scene);
    if (!audioUrl || !voiceover.script || !voiceover.speaker || canonicalVoiceAudioRef.current.has(voiceover.speaker)) return;
    canonicalVoiceAudioRef.current.set(voiceover.speaker, audioUrl);
    recordActivity("voice", `已将 ${voiceover.speaker} 的独立音轨登记为 Canonical 声音参考`, "done");
  }

  async function canonicalVoiceProfile(scene: Scene) {
    const speaker = sceneVoiceover(scene).speaker.trim();
    if (!speaker) return null;
    const normalized = speaker.toLocaleLowerCase("zh-CN");
    const projectId = activeAssetProjectId();
    const candidates = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.category === "audio" && asset.mediaType === "audio" && asset.assetState !== "placeholder" && asset.reusable !== false && asset.voiceConsent !== "revoked" && (!asset.projectId || asset.scope === "global" || asset.projectId === projectId) && String(asset.identityKey || "").trim().toLocaleLowerCase("zh-CN") === normalized).sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId) || Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || b.createdAt.localeCompare(a.createdAt));
    const match = candidates[0];
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    canonicalVoiceAudioRef.current.set(speaker, loaded.url);
    if (loaded.referenceMediaUrl) canonicalVoiceVideoRef.current.set(speaker, loaded.referenceMediaUrl);
    return { ...match, url: loaded.url };
  }

  async function registerSeedancePortraitBlock(reason: unknown, sceneId = "") {
    if (!(reason instanceof SeedanceRequestError) || reason.failureKind !== "portrait_authorization") return false;
    const preset = visualStyle(style);
    if (!styleRequiresTrustedPortrait(preset.category)) {
      setError(`方舟把当前“${style}”动画参考误判为真人。漫镜不会要求动画角色办理真人加白；已隔离本次误判，不会影响其他剧本。请重新运行，系统会移除被误判的单项图片参考并保留其余全能参考。`);
      recordActivity("video", `“${style}”属于${preset.category}风格，本次真人识别属于供应商误判；未写入可信人物阻断`, "warning");
      return true;
    }
    const block: SeedancePortraitBlock = { requestId: reason.requestId, sceneId, projectId: activeAssetProjectId(), styleName: style, blockedReferences: reason.blockedReferences, createdAt: Date.now() };
    setSeedancePortraitBlock(block);
    window.localStorage.setItem(SEEDANCE_PORTRAIT_BLOCK_KEY, JSON.stringify(block));
    const ids = new Set(reason.blockedReferences.map((item) => item.libraryAssetId).filter(Boolean));
    if (ids.size) {
      const library = await listLibraryAssets({ allProjects: true }).catch(() => [] as LibraryAsset[]);
      await Promise.all(library.filter((asset) => ids.has(asset.id)).map((asset) => updateLibraryAsset(asset.id, { tags: [...new Set([...asset.tags, "Seedance真人拦截", "待绑定可信人像"])] }).catch(() => undefined)));
    }
    const names = reason.blockedReferences.map((item) => item.identityKey || item.name.replace(/^.*?：/, "").replace(/；.*$/, "")).filter(Boolean).join("、") || "被拦截的人物参考图";
    setError(`${names} 被方舟识别为可能包含真人。系统已停止重复提交；请到可信人物中心为对应人物完成授权并绑定 Asset ID`);
    recordActivity("video", `已将 ${names} 精确定位到可信人物中心；授权完成前不会再次提交相同图片`, "error");
    return true;
  }

  async function persistCanonicalVoiceProfile(scene: Scene, source: Blob | string, duration: number, voiceName: string, voiceSource: "generated-dialogue" | "video-extracted" | "user-uploaded" = "generated-dialogue", referenceMediaUrl = "") {
    const speaker = sceneVoiceover(scene).speaker.trim();
    const isCharacter = characters.some((character) => character.name.trim().toLocaleLowerCase("zh-CN") === speaker.toLocaleLowerCase("zh-CN")) || scene.characters.some((name) => name.trim().toLocaleLowerCase("zh-CN") === speaker.toLocaleLowerCase("zh-CN"));
    if (!speaker || !isCharacter) return null;
    const existing = await canonicalVoiceProfile(scene);
    if (existing) return existing;
    const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
    if (!blob.type.startsWith("audio/")) return null;
    const isMp3 = /(?:mpeg|mp3)/i.test(blob.type);
    const extension = isMp3 ? "mp3" : blob.type.includes("wav") ? "wav" : blob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `${speaker}-标准音色.${extension}`, { type: blob.type });
    const context = activeSeriesContext();
    const projectId = context.projectId || activeAssetProjectId();
    const saved = await saveLibraryFile(file, {
      name: `${speaker}-标准音色.${extension}`,
      category: "audio",
      duration,
      tags: ["自动生成", "人物音色", speaker, `声音:${voiceName}`, isMp3 ? "MP3参考" : "原始音频参考"],
      reusable: true,
      locked: true,
      identityKey: speaker,
      entityId: speaker,
      lookName: "标准音色",
      variantName: voiceName,
      purposes: ["voice"],
      semanticDescription: `${speaker} 的 Canonical 标准音色，供后续配音和全模态视频参考使用`,
      referenceText: scene.dialogue,
      referenceMediaUrl,
      voiceSource,
      voiceConsent: voiceSource === "video-extracted" ? "pending" : "confirmed",
      projectId,
      episodeId: context.episodeId,
      scope: "project",
      recognitionStatus: "confirmed",
      recognitionConfidence: 1,
    });
    // Video-extracted voices are immediately reusable inside this project so
    // the next line by the same character can reference them. They remain
    // project-scoped and require explicit consent before any global reuse.
    const approvedForProjectReuse = true;
    await updateLibraryAsset(saved.id, { canonical: approvedForProjectReuse, locked: true, reusable: approvedForProjectReuse, scope: "project", projectId });
    canonicalVoiceAudioRef.current.set(speaker, saved.url || URL.createObjectURL(blob));
    if (/^https:\/\//i.test(referenceMediaUrl)) canonicalVoiceVideoRef.current.set(speaker, referenceMediaUrl);
    await refreshVoiceProfiles();
    recordActivity("voice", voiceSource === "video-extracted" ? `已从 ${speaker} 首次说话的分镜视频截取 ${Math.min(14, duration).toFixed(1)} 秒以内音色并放入项目音色库；后续镜头立即引用，转入公共库前仍需确认授权` : `已把 ${speaker} 的第一条独立对白保存为${isMp3 ? " MP3 " : ""}标准音色；后续配音与全模态视频将优先引用`, "done");
    return { ...saved, canonical: approvedForProjectReuse, reusable: approvedForProjectReuse, projectId, scope: "project" as const };
  }

  async function voiceReferenceForScene(scene: Scene): Promise<VideoReference | null> {
    const voiceover = sceneVoiceover(scene);
    if (!voiceover.speaker || !voiceover.script) return null;
    let source = canonicalVoiceAudioRef.current.get(voiceover.speaker) || "";
    let referenceText = "";
    if (!source) {
      const profile = await canonicalVoiceProfile(scene);
      source = profile?.url || "";
      referenceText = profile?.referenceText || "";
    }
    if (!source) return null;
    return { kind: "audio", role: "reference_audio", url: source, name: `Canonical 人物音色：${voiceover.speaker}`, referenceText };
  }

  async function compileShotMotionPrompt(scene: Scene, sceneIndex: number, previousScene?: Scene) {
    const cast = charactersForScene(characters, scene).filter(isVisualCharacterAsset);
    const props = labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具");
    const continuityRule = shotContinuityRule(scene, previousScene);
    const anchoredScene = assignSpatialLayouts([...(previousScene ? [previousScene] : []), scene]).at(-1) || scene;
    const cameraPlan = cinematicCameraPlan(anchoredScene, sceneIndex, previousScene);
    const voiceover = sceneVoiceover(scene);
    const stylePreset = visualStyle(style);
    const westernAnimation = style.startsWith("欧美") && STYLE_PRESETS.find((item) => item.name === style)?.category === "动画";
    const styleExclusions = westernAnimation
      ? "Keep the exact Western animation design language in every frame. Absolutely no Japanese anime or manga facial grammar, Chinese donghua or manhua styling, live-action actors, photographic skin, generic children's clip-art, technique switching, or redesign of character proportions and costumes."
      : style === "国漫电影感" || style === "半写实3D国漫"
      ? "This must remain unmistakably stylized 3D/CG Chinese animation in every frame. Absolutely no live-action actor, photographic skin, skin pores, real-camera portrait, costume redesign, realistic human face replacement or drift toward television-drama photography."
      : stylePreset.category === "动画"
        ? "Absolutely no live action, photographic skin, real actors or drift into a different animation technique."
        : stylePreset.category === "艺术"
          ? "Absolutely no live action, photographic realism or replacement with a generic digital illustration style."
          : "Absolutely no animation, anime, comic rendering or plastic CGI skin.";
    const styleBible = `STYLE CONSISTENCY CONSTRAINT (${style}): ${stylePreset.base}; ${stylePreset.frame}; ${stylePreset.motion}. Keep the rendering language, line treatment, material shading, facial design language, color palette, contrast and lighting model as consistent as the model permits. ${styleExclusions}\n${spatialContinuityContract(anchoredScene, previousScene)}`;
    const styleNegative = westernAnimation ? "anime, manga, donghua, manhua, live action, photorealistic skin, generic children's clip-art, wrong animation technique, style drift, character redesign, costume redesign" : style === "国漫电影感" || style === "半写实3D国漫" ? "live action, photorealistic person, photographic skin, skin pores, real actress, television drama, costume redesign, generic realistic face, style drift" : "wrong rendering style, style drift, costume redesign";
    const priorFailureConstraints = scene.consistencyDecision === "reject" && scene.consistencyReport?.findings.length
      ? `REPAIR THE PREVIOUS REJECTED CANDIDATE: ${scene.consistencyReport.findings.join("; ")}. Correct these failures without changing the script, cast, costume, environment or camera intent.`
      : "";
    const vocalDirection = voiceover.mode === "onscreen_dialogue"
      ? `${voiceover.speaker} says exactly “${voiceover.script}” in ${scriptLanguage(voiceover.script)}. Preserve the source language and wording exactly. Use restrained syllable-sized lip motion, stable jaw width and cheeks, natural blinking and eye focus; no rubber mouth, oversized mouth opening, frozen stare or exaggerated expression.`
      : voiceover.mode === "inner_monologue"
        ? `Play “${voiceover.script}” as ${voiceover.speaker}'s internal monologue voice-over; visible mouths remain closed.`
        : voiceover.mode === "voice_over"
          ? `Play “${voiceover.script}” as an off-screen voice-over by ${voiceover.speaker}; do not create a narrator image or animate visible lips.`
          : "No spoken dialogue or narration; retain appropriate ambience and action sounds.";
    const physicalContinuity = "At frame zero, every visible person and every important prop must already exist in a physically plausible position. If the script explicitly requires a later entrance, keep that subject off-screen at frame zero and show a complete physical entrance from a frame edge, doorway, behind an occluder, or through a motivated camera pan/dolly reveal. People and objects must never materialize, fade in, grow out of a screen, morph into existence, teleport, duplicate, swap identity, or disappear without a visible exit or an intentional cut. Props may enter only through a visible hand, container, doorway, or continuous physical movement. Preserve exact person count, hand occupancy, left/right screen position, depth layer and prop ownership until the scripted action visibly changes them.";
    const performanceLock = "IDENTITY AND PERFORMANCE CONSTRAINT: current-task canonical character cards are the only identity sources. Preserve skull silhouette, facial landmarks, eye spacing, eyelid shape, nose bridge, mouth width, jawline, ears, hairstyle, age, body proportions and costume as closely as the model permits. Previous approved video and textual state control blocking and pose only; they must not override the task-scoped identity baseline. Use subtle continuous micro-expressions, one primary body action at a time, realistic weight shift, stable shoulders and neck, anatomically plausible hands, limited head rotation, smooth acceleration and deceleration. Reduce temporal facial drift during speech and movement. No beauty-filter face, generic AI face, face replacement, identity blending, face melting, asymmetrical eyes, warped teeth, rubber lips, stiff mannequin pose, twitching, floating limbs or impossible joints.";
    const identityReanchor = shouldReanchorCharacterIdentity(sceneIndex)
      ? `TASK IDENTITY RE-ANCHOR CHECKPOINT (shot ${sceneIndex + 1}): re-read each supplied Canonical four-zone card. Give the left 35%-40% frontal close-up relative identity priority ${CHARACTER_REFERENCE_POLICY.faceRelativePriority} and the right front/45-degree-side/back turnaround relative body-costume priority ${CHARACTER_REFERENCE_POLICY.multiviewRelativePriority}; keep provider guidance at or below ${CHARACTER_REFERENCE_POLICY.providerGuidanceCap}. This periodic re-attachment reduces long-sequence drift but does not guarantee permanent identity.`
      : "Continue from the current task-scoped Canonical identity baseline; do not introduce an alternate historical face reference.";
    const spatialReanchor = shouldReanchorSpatialLayout(sceneIndex)
      ? `SPATIAL RE-ANCHOR CHECKPOINT (shot ${sceneIndex + 1}): reconstruct the written screen-left/right order, foreground/midground/background depth, facing, hand occupancy and prop ownership before starting the action. These are strong prompt constraints, not absolute geometry locks.`
      : "Preserve the written spatial state as a strong prompt constraint; generative drift remains possible and must be caught by review.";
    const frameContinuityTradeoff = "IDENTITY-FIRST MODE: do not submit extracted first/end-frame images to the generation model; extraction is for QA only. Preserve continuity through canonical assets, approved prior @Video and explicit physical state.";
    const assetBindings = {
      characters: cast.map((character) => ({ name: characterIdentity(character), lookName: characterLook(character), displayName: characterAssetNaming(character).displayName, assetId: character.arkAssetId || character.id, appearance: character.appearance })),
      scene: { id: scene.environmentKey || scene.title, bible: scene.environmentBible || scene.visual },
      props,
      frameContinuityMode,
      continuityReference: scene.remoteImageUrl || "",
      previousApprovedVideoReference: previousScene?.videoReviewDecision === "approved" ? previousScene.remoteVideoUrl || "" : "",
      spatialLayout: anchoredScene.spatialLayout || {},
    };
    const deterministic = `${styleBible} ${performanceLock} ${identityReanchor} ${spatialReanchor} ${frameContinuityTradeoff} ${priorFailureConstraints} Environment ${scene.environmentKey || "current scene"}: ${scene.environmentBible || scene.visual}. Start state: ${scene.startState || previousScene?.endState || "establish the initial state from the canonical assets"}. ${previousScene ? `Continue blocking and physical state from the previous shot's approved video/text state: ${previousScene.endState || previousScene.action}. Strongly preserve screen position, depth, facing direction, hand occupancy and prop position unless the action visibly changes it; this reduces drift but cannot absolutely lock a generative model.` : "This is the opening shot."} Persistent spatial map: ${spatialLayoutSummary(anchoredScene) || "no visible cast"}. Continuity rule: ${continuityRule} Current action: ${scene.action}. Camera choreography: ${cameraPlan}. Execute the action in three readable phases: stable hold, one motivated action, stable hold. Avoid complex chained actions; split them into short shots. Use restrained breathing, stable hair and cloth amplitude, smooth camera speed, matching exposure, contrast, saturation and light direction. Canonical props: ${props.join(", ") || "none"}. End state: ${scene.endState || "finish in a stable state for the next shot"}. ${vocalDirection} One continuous cinematic shot, no unintended cuts, no subtitles. ${physicalContinuity} Avoid: ${styleNegative}.`;
    const config = agentConfigs.prompt;
    if (config.adapter === "browser") {
      recordActivity("prompt", `镜头 ${sceneIndex + 1} 已由本地镜头总控完成资产绑定与提示词编译`, "done");
      return `${deterministic} Voice direction: ${vocalDirection}`;
    }
    const learned = agentContext("prompt").slice(0, 6);
    const system = `你是漫镜的镜头总控 Agent，位于导演与视频 Agent 之间。你不改写剧情，只负责绑定 Canonical 资产、继承 Start/End State、整合表演与运镜，并针对目标视频模型编译最终提示词。只返回 JSON：{"prompt":"最终视频提示词","negativePrompt":"必须避免的问题","assetBindings":["实际使用的资产ID"],"continuityCheck":"状态继承检查"}。提示词必须是一个连续镜头，禁止虚构未提供的资产。${learned.length ? `\n已启用技能：\n${learned.map((item) => `- ${item.title}：${item.content.slice(0, 900)}`).join("\n")}` : ""}`;
    const user = JSON.stringify({ targetAdapter: agentConfigs.video.adapter, targetModel: agentConfigs.video.model, duration: scene.duration, aspect, styleBible, productionStandard: { transitionRule: continuityRule, physicalContinuity, performanceLock, identityReanchor, spatialReanchor, frameContinuityMode, frameContinuityTradeoff, motionTreatment: cameraPlan, colorContinuity: "strongly preserve style, exposure, white balance, contrast and saturation; verify drift during review", stateHandoffSeconds: 0.5 }, shot: { title: scene.title, visual: scene.visual, action: scene.action, camera: cameraPlan, continuity: scene.continuity, startState: scene.startState || previousScene?.endState, endState: scene.endState, speaker: scene.speaker, dialogue: scene.dialogue, voiceMode: voiceover.mode, emotion: scene.emotion }, assetBindings, deterministicFallback: deterministic });
    try {
      setStatusText(`${agentName("prompt")}正在为镜头 ${sceneIndex + 1} 绑定资产并编译最终提示词`);
      const raw = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
        ? await withStageTimeout(customApiText("prompt", { task: "compile_video_prompt", system, prompt: user }), 195000, "镜头总控等待超过 195 秒")
        : await withStageTimeout(pollinationsText("prompt", system, user), 120000, "镜头总控等待超过 120 秒");
      const jsonText = raw.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*\}/)?.[0] || raw;
      const parsed = JSON.parse(jsonText) as { prompt?: string; negativePrompt?: string };
      const compiled = String(parsed.prompt || "").trim();
      if (!compiled) throw new Error("镜头总控没有返回最终提示词");
      markContextUsed(learned.map((item) => item.id));
      recordActivity("prompt", `镜头 ${sceneIndex + 1} 的资产、状态和运镜提示词已编译`, "done");
      return `${styleBible} ${performanceLock} ${identityReanchor} ${spatialReanchor} ${frameContinuityTradeoff} ${priorFailureConstraints} ${compiled}${parsed.negativePrompt ? ` Avoid: ${parsed.negativePrompt}` : ""} Avoid: ${styleNegative}. Voice direction: ${vocalDirection}. Physical continuity constraints: ${physicalContinuity}`;
    } catch (reason) {
      recordActivity("prompt", `镜头总控接口未完成，已安全降级到本地提示词编译：${reason instanceof Error ? reason.message : "未知错误"}`, "warning");
      return `${deterministic} Voice direction: ${vocalDirection}`;
    }
  }

  async function videoReferences(scene: Scene, previousScene?: Scene, castOverride = characters, propOverride = propAssets, sceneIndex = scenes.findIndex((item) => item.id === scene.id)): Promise<VideoReference[]> {
    const cast = charactersForScene(castOverride, scene).filter(isVisualCharacterAsset);
    const propNames = labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具");
    const references: VideoReference[] = [];
    const seen = new Set<string>();
    const counts = { image: 0, video: 0, audio: 0 };
    const pushReference = (reference: VideoReference) => {
      const limit = reference.kind === "image" ? 9 : 3;
      if (!reference.url) return;
      const existing = references.find((item) => item.url === reference.url);
      if (existing) {
        if (!existing.name.includes(reference.name)) existing.name = `${existing.name} + ${reference.name}`;
        return;
      }
      if (seen.has(reference.url) || references.length >= 15 || counts[reference.kind] >= limit) return;
      seen.add(reference.url);
      counts[reference.kind] += 1;
      references.push(reference);
    };
    const voiceover = sceneVoiceover(scene);
    const usableReferenceUrl = async (raw: string | undefined, normalizeFrame = false, expectedKind: "image" | "audio" | "video" = "image") => {
      const value = String(raw || "").trim();
      if (!value) return "";
      if (/^(?:https:\/\/|data:(?:image|video|audio)\/|asset:\/\/)/i.test(value)) return value;
      try {
        const response = await fetch(value);
        if (!response.ok) return "";
        const blob = await response.blob();
        if (!blob.type.startsWith(`${expectedKind}/`)) return "";
        return blobToDataUrl(normalizeFrame && expectedKind === "image" ? await normalizeImageBlobForAspect(blob, aspect) : blob);
      } catch {
        return "";
      }
    };

    const canonicalVoiceReference = await voiceReferenceForScene(scene);
    if (canonicalVoiceReference) {
      const audioUrl = await usableReferenceUrl(canonicalVoiceReference.url, false, "audio");
      if (audioUrl && (agentConfigs.video.adapter !== "seedance" || /^(?:https:\/\/|asset:\/\/)/i.test(audioUrl))) {
        pushReference({ ...canonicalVoiceReference, url: audioUrl });
      } else if (agentConfigs.video.adapter === "seedance") {
        const voiceVideoUrl = canonicalVoiceVideoRef.current.get(voiceover.speaker) || "";
        if (/^https:\/\//i.test(voiceVideoUrl)) {
          pushReference({ kind: "video", role: "reference_video", url: voiceVideoUrl, name: `Canonical 人物音色来源视频：${voiceover.speaker}（只参考人声，不复制画面剧情）` });
          recordActivity("video", `${voiceover.speaker} 的截取音色已保存在项目音色库；方舟不接收本机音频 URL，本镜改用其首条对白公网视频作为 @Video 全能参考锁定音色`, "done");
        } else {
          recordActivity("video", `${voiceover.speaker} 的音色已在本机音色库，但没有可供方舟读取的 HTTPS 音频或来源视频；本镜不会谎报 @Audio 已绑定`, "warning");
        }
      }
    }

    const previousVideoSource = agentConfigs.video.adapter === "seedance" ? previousScene?.remoteVideoUrl : previousScene?.remoteVideoUrl || previousScene?.videoUrl;
    const previousVideoUrl = previousScene?.videoReviewDecision === "approved"
      ? await usableReferenceUrl(previousVideoSource, false, "video")
      : "";
    if (previousVideoUrl) pushReference({ kind: "video", role: "reference_video", url: previousVideoUrl, name: `上一镜已批准视频连续性：${previousScene?.title || "前镜"}（仅作 @Video 全能参考，不锁首尾帧）` });
    else if (previousScene?.videoReviewDecision === "approved" && agentConfigs.video.adapter === "seedance") {
      recordActivity("video", `上一镜“${previousScene.title}”只有本机视频、没有仍可访问的公网 HTTPS 地址；方舟不接受本机/data 视频作为 @Video，已自动跳过该项并继续使用人物、场景、道具和状态提示生成`, "warning");
    }
    // Extracted start/end frames are quality-inspection artifacts only. They
    // are deliberately never submitted to Seedance; continuity uses approved
    // @Video plus canonical character/scene/prop references exclusively.
    if (!previousScene) {
      const previousEpisodeVideo = await previousEpisodeVideoReference();
      const crossEpisodeUrl = agentConfigs.video.adapter === "seedance" && !/^https:\/\//i.test(previousEpisodeVideo?.url || "") ? "" : await usableReferenceUrl(previousEpisodeVideo?.url, false, "video");
      if (crossEpisodeUrl) pushReference({ kind: "video", role: "reference_video", url: crossEpisodeUrl, name: "上一集最后一个已批准分镜视频（@Video 全能参考，不锁首尾帧）" });
    }

    for (const character of cast) {
      const reanchorLabel = shouldReanchorCharacterIdentity(sceneIndex) ? `；第 ${sceneIndex + 1} 镜任务内周期重锚` : "";
      if (agentConfigs.video.adapter === "seedance" && character.arkAssetId && character.portraitAuthorizationStatus === "authorized") {
        pushReference({ kind: "image", role: "reference_image", url: `asset://${String(character.arkAssetId).replace(/^asset:\/\//i, "")}`, name: `当前任务 Canonical 人物四区角色卡：${characterAssetNaming(character).displayName}${reanchorLabel}`, libraryAssetId: character.libraryAssetId, identityKey: characterIdentity(character), lookName: characterLook(character) });
      } else {
        const characterUrl = await usableReferenceUrl(character.remoteUrl || character.imageUrl);
        if (!characterUrl) continue;
        pushReference({ kind: "image", role: "reference_image", url: characterUrl, name: `当前任务 Canonical 人物四区角色卡：${characterAssetNaming(character).displayName}${reanchorLabel}`, libraryAssetId: character.libraryAssetId, identityKey: characterIdentity(character), lookName: characterLook(character) });
      }
    }

    if (scene.imageReviewDecision === "approved" && scene.imageUrl) {
      const compositionUrl = await usableReferenceUrl(scene.remoteImageUrl || scene.imageUrl);
      if (compositionUrl) pushReference({ kind: "image", role: "reference_image", url: compositionUrl, name: `用户批准的重要镜头构图参考：${scene.title}（仅作 @Image 全能参考，不作为首帧）` });
    }

    for (const prop of propOverride.filter((item) => propNames.includes(item.name))) {
      const propUrl = await usableReferenceUrl(prop.remoteUrl || prop.imageUrl);
      if (propUrl) pushReference({ kind: "image", role: "reference_image", url: propUrl, name: `Canonical 道具：${prop.name}` });
    }

    const requestedEnvironment = String(scene.environmentKey || labeledVisualAssets(scene.visual, "场景")[0] || scene.title).trim().toLocaleLowerCase("zh-CN");
    const canonicalSceneAsset = sceneAssets.find((item) => item.environmentKey.trim().toLocaleLowerCase("zh-CN") === requestedEnvironment || item.name.trim().toLocaleLowerCase("zh-CN") === requestedEnvironment);
    if (canonicalSceneAsset) {
      const sceneUrl = await usableReferenceUrl(canonicalSceneAsset.remoteUrl || canonicalSceneAsset.imageUrl);
      if (sceneUrl) pushReference({ kind: "image", role: "reference_image", url: sceneUrl, name: `Canonical 空场景：${canonicalSceneAsset.name}（${canonicalSceneAsset.environmentKey}）` });
    }

    try {
      const projectId = activeAssetProjectId();
      const library = (await listLibraryAssets({ allProjects: true })).filter((asset) => !asset.projectId || asset.scope === "global" || asset.projectId === projectId);
      const environmentIdentity = (scene.environmentKey || scene.title).toLocaleLowerCase("zh-CN");
      const candidates = library.filter((asset) => {
        if (asset.mediaType !== "image" || asset.reusable === false) return false;
        const searchable = `${asset.name} ${asset.identityKey || ""} ${asset.lookName || ""} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN");
        // Current character, scene and prop cards were already added above as
        // the single authority for each semantic role. Adding historical
        // library duplicates here lets multiple faces/outfit revisions compete
        // in one Seedance request and is a major source of identity blending.
        if (asset.category === "character") return false;
        if (asset.category === "scene") return !canonicalSceneAsset && Boolean(environmentIdentity && searchable.includes(environmentIdentity));
        if (asset.category === "prop") return propNames.some((name) => !propOverride.some((prop) => prop.name === name && Boolean(prop.remoteUrl || prop.imageUrl)) && searchable.includes(name.toLocaleLowerCase("zh-CN")));
        return false;
      }).sort((a, b) => Number(videoAssetPreflightRef.current.has(b.id)) - Number(videoAssetPreflightRef.current.has(a.id)) || Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 8);
      const loadedEntities = await loadLibraryAssets(candidates.map((asset) => asset.id));
      for (const entity of loadedEntities) {
        const entityUrl = await usableReferenceUrl(entity.url);
        if (!entityUrl) continue;
        const metadata = candidates.find((asset) => asset.id === entity.id);
        pushReference({ kind: "image", role: "reference_image", url: entityUrl, name: metadata ? `${metadata.category === "character" ? "人物" : metadata.category === "prop" ? "道具" : "场景"}锁定资产：${metadata.name}` : "锁定视觉资产" });
      }
      await Promise.all(candidates.map((asset) => markLibraryAssetUsed(asset.id)));

      const normalizedSpeaker = voiceover.speaker.trim().toLocaleLowerCase("zh-CN");
      const voiceAssets = canonicalVoiceReference ? [] : library.filter((asset) => asset.category === "audio" && asset.reusable !== false && asset.voiceConsent !== "revoked" && String(asset.identityKey || "").trim().toLocaleLowerCase("zh-CN") === normalizedSpeaker).sort((a, b) => Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked))).slice(0, 1);
      const loadedVoices = await loadLibraryAssets(voiceAssets.map((asset) => asset.id));
      for (const voiceAsset of loadedVoices) {
        const voiceUrl = await usableReferenceUrl(voiceAsset.url, false, "audio");
        if (voiceUrl.startsWith("data:audio/") || voiceUrl.startsWith("https://")) pushReference({ kind: "audio", role: "reference_audio", url: voiceUrl, name: "角色固定声音" });
      }
      await Promise.all(voiceAssets.map((asset) => markLibraryAssetUsed(asset.id)));
    } catch {
      recordActivity("video", `“${scene.title}”的部分资产库参考暂时无法读取，将继续使用已加载的 Canonical 资产`, "warning");
    }
    return references;
  }

  async function preflightReusableVideoAssets(work: Scene[], cast: CharacterAsset[]) {
    setStatusText("视频生成前正在预检资产库：人物、造型、场景、道具和音色");
    const projectId = activeAssetProjectId();
    const library = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.reusable !== false && asset.assetState !== "placeholder" && (!asset.projectId || asset.scope === "global" || asset.projectId === projectId));
    const characterNames = new Set(cast.filter(isVisualCharacterAsset).map((item) => item.name.trim().toLocaleLowerCase("zh-CN")));
    const environmentNames = new Set(work.map((scene) => (scene.environmentKey || scene.title).trim().toLocaleLowerCase("zh-CN")).filter(Boolean));
    const propNames = new Set(work.flatMap((scene) => labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具")).map((item) => item.toLocaleLowerCase("zh-CN")));
    const voiceNames = new Set(work.flatMap((scene) => [scene.speaker, ...scene.characters]).map((item) => item.trim().toLocaleLowerCase("zh-CN")).filter(Boolean));
    const matches = library.filter((asset) => {
      const searchable = `${asset.identityKey || ""} ${asset.entityId || ""} ${asset.name} ${asset.lookName || ""} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN");
      if (asset.category === "character") return [...characterNames].some((name) => searchable.includes(name));
      if (asset.category === "scene") return [...environmentNames].some((name) => searchable.includes(name));
      if (asset.category === "prop") return [...propNames].some((name) => searchable.includes(name));
      if (asset.category === "audio") return asset.voiceConsent !== "revoked" && [...voiceNames].some((name) => searchable.includes(name));
      return false;
    });
    const characterAssets = library.filter((asset) => asset.category === "character" && asset.mediaType === "image");
    const preparedCast = cast.map((character) => {
      const identity = normalizeAssetIdentity(characterIdentity(character));
      const look = normalizeAssetLook(characterLook(character));
      const candidates = characterAssets.filter((asset) => normalizeAssetIdentity(asset.identityKey || asset.entityId || asset.name) === identity);
      const exact = candidates.filter((asset) => normalizeAssetLook(asset.lookName || asset.variantName || "基础版") === look);
      const matched = (exact.length ? exact : candidates).sort((a, b) => Number(b.portraitAuthorizationStatus === "authorized" && Boolean(b.arkAssetId)) - Number(a.portraitAuthorizationStatus === "authorized" && Boolean(a.arkAssetId)) || Number(Boolean(b.canonical)) - Number(Boolean(a.canonical)) || Number(Boolean(b.locked)) - Number(Boolean(a.locked)) || b.createdAt.localeCompare(a.createdAt))[0];
      if (!matched) return character;
      return { ...character, libraryAssetId: matched.id, arkAssetId: matched.arkAssetId || character.arkAssetId, portraitAuthorizationStatus: matched.portraitAuthorizationStatus || character.portraitAuthorizationStatus };
    });
    if (preparedCast.some((item, index) => item.libraryAssetId !== cast[index]?.libraryAssetId || item.arkAssetId !== cast[index]?.arkAssetId || item.portraitAuthorizationStatus !== cast[index]?.portraitAuthorizationStatus)) {
      setCharacters((items) => items.map((item) => preparedCast.find((prepared) => prepared.id === item.id) || item));
      recordActivity("video", "已在提交前重新读取资产库，并把人物的方舟 Asset ID 与授权状态同步到当前镜头", "done");
    }
    let storedBlock: SeedancePortraitBlock | null = seedancePortraitBlock;
    if (!storedBlock) {
      try { storedBlock = JSON.parse(window.localStorage.getItem(SEEDANCE_PORTRAIT_BLOCK_KEY) || "null") as SeedancePortraitBlock | null; } catch { storedBlock = null; }
    }
    const relevantBlockedReferences = portraitBlockReferencesForProject(storedBlock, projectId, preparedCast) as SeedanceBlockedReference[];
    if (styleRequiresTrustedPortrait(visualStyle(style).category) && relevantBlockedReferences.length) {
      const unresolved = relevantBlockedReferences.filter((blocked) => {
        const identity = normalizeAssetIdentity(blocked.identityKey || blocked.name.replace(/^.*?：/, "").replace(/；.*$/, ""));
        const matchingCharacter = preparedCast.find((character) => normalizeAssetIdentity(characterIdentity(character)) === identity || character.libraryAssetId === blocked.libraryAssetId);
        return !matchingCharacter?.arkAssetId || matchingCharacter.portraitAuthorizationStatus !== "authorized";
      });
      if (unresolved.length) {
        const names = unresolved.map((item) => item.identityKey || item.name.replace(/^.*?：/, "").replace(/；.*$/, "")).join("、");
        throw new SeedanceRequestError(`生成前检查已阻止无效重试：${names} 仍未绑定已授权的方舟可信人像 Asset ID。请先前往可信人物中心处理`, { failureKind: "portrait_authorization", retryable: false, requestId: storedBlock?.requestId, blockedReferences: unresolved });
      }
      window.localStorage.removeItem(SEEDANCE_PORTRAIT_BLOCK_KEY);
      setSeedancePortraitBlock(null);
      recordActivity("video", "此前被拦截的人物现已全部绑定可信 Asset ID，本次会改用 asset:// 引用并恢复生成", "done");
    } else if (storedBlock?.projectId === projectId && !styleRequiresTrustedPortrait(visualStyle(style).category)) {
      window.localStorage.removeItem(SEEDANCE_PORTRAIT_BLOCK_KEY);
      setSeedancePortraitBlock(null);
      recordActivity("video", `当前“${style}”为动画/艺术风格，已忽略并清除本项目遗留的真人授权阻断`, "done");
    }
    videoAssetPreflightRef.current = new Set(matches.map((asset) => asset.id));
    const summary = {
      character: matches.filter((asset) => asset.category === "character").length,
      scene: matches.filter((asset) => asset.category === "scene").length,
      prop: matches.filter((asset) => asset.category === "prop").length,
      audio: matches.filter((asset) => asset.category === "audio").length,
    };
    recordActivity("video", `资产预检完成：优先复用 ${summary.character} 个人物/造型、${summary.scene} 个场景、${summary.prop} 个道具、${summary.audio} 个音色；后续镜头只叠加上一镜已批准视频作为 @Video 全能参考，不使用首尾帧图片`, matches.length ? "done" : "warning");
    return { ...summary, cast: preparedCast };
  }

  function seedancePendingTasks() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SEEDANCE_PENDING_KEY) || "{}") as Record<string, SeedancePendingTask>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveSeedancePendingTask(key: string, task?: SeedancePendingTask) {
    const tasks = seedancePendingTasks();
    if (task) tasks[key] = task;
    else delete tasks[key];
    window.localStorage.setItem(SEEDANCE_PENDING_KEY, JSON.stringify(tasks));
  }

  async function seedanceVideo(prompt: string, options: { references?: VideoReference[]; duration?: number; resumeKey?: string; voiceover?: SceneVoiceover } = {}) {
    const config = agentConfigs.video;
    if (config.apiKey.trim().length < 8) throw new Error("即梦 Seedance 需要火山方舟 API Key");
    const resumeKey = options.resumeKey || `${config.model}:${prompt.slice(0, 120)}`;
    const promptSignature = stableReuseToken(JSON.stringify({
      model: config.model,
      prompt,
      duration: options.duration,
      references: (options.references || []).map((reference) => ({ kind: reference.kind, role: reference.role, name: reference.name, url: reference.url.slice(0, 160) })),
      voiceover: options.voiceover,
    }));
    const pending = seedancePendingTasks()[resumeKey];
    const canResume = Boolean(pending?.id && pending.model === config.model && (!pending.promptSignature || pending.promptSignature === promptSignature) && Date.now() - pending.createdAt < 6 * 24 * 60 * 60 * 1000);
    if (pending?.id && !canResume) saveSeedancePendingTask(resumeKey);
    let taskId = canResume ? pending.id : "";
    if (taskId) {
      setStatusText(`正在恢复上次中断的 Seedance 任务 ${taskId.slice(-8)}`);
      recordActivity("video", `已找到未完成任务 ${taskId.slice(-8)}，继续查询，不重复创建和扣费`, "warning");
    } else {
      let requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : uid();
      let submittedReferences = [...(options.references || [])];
      window.localStorage.setItem("manjing-seedance-last-request-v146", JSON.stringify({ requestId, model: config.model, scene: options.resumeKey || "", createdAt: Date.now(), status: "submitting" }));
      const createSeedanceTask = (references: VideoReference[], currentRequestId: string) => seedanceRequest("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          requestId: currentRequestId,
          apiKey: config.apiKey.trim(),
          model: config.model,
          resolution: videoResolution,
          prompt,
          ratio: aspect,
          duration: options.duration,
          referenceMode: "omni",
          imageUrl: "",
          references,
          voiceover: { enabled: Boolean(options.voiceover?.script), backgroundMusic: bgmEnabled && options.voiceover?.mode !== "onscreen_dialogue", audioEnabled: true, language: "普通话", script: options.voiceover?.script || "", speaker: options.voiceover?.speaker || "", mode: options.voiceover?.mode || "none", style: "保持角色声音身份、音色、年龄感、语速、口音和情绪连续一致" },
        }),
      }, "创建 Seedance 视频任务", 1);
      let created = await createSeedanceTask(submittedReferences, requestId);
      if (!created.ok) {
        const failure = await responseFailure(created);
        if (failure.failureKind !== "portrait_authorization" || styleRequiresTrustedPortrait(visualStyle(style).category)) throw failure;
        const blockedIds = new Set(failure.blockedReferences.map((item) => item.libraryAssetId).filter(Boolean));
        const blockedIdentities = new Set(failure.blockedReferences.map((item) => normalizeAssetIdentity(item.identityKey || item.name.replace(/^.*?：/, "").replace(/；.*$/, ""))).filter(Boolean));
        const filtered = submittedReferences.filter((reference) => reference.kind !== "image"
          || !(blockedIds.has(reference.libraryAssetId) || blockedIdentities.has(normalizeAssetIdentity(reference.identityKey || reference.name.replace(/^.*?：/, "").replace(/；.*$/, "")))));
        submittedReferences = filtered.length < submittedReferences.length
          ? filtered
          : submittedReferences.filter((reference) => reference.kind !== "image" || !reference.identityKey);
        if (submittedReferences.length === (options.references || []).length) throw failure;
        requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : uid();
        window.localStorage.setItem("manjing-seedance-last-request-v146", JSON.stringify({ requestId, model: config.model, scene: options.resumeKey || "", createdAt: Date.now(), status: "animation-reference-fallback" }));
        recordActivity("video", `方舟把“${style}”中的 ${failure.blockedReferences.length || 1} 项动画人物图误判为真人；本次 400 未创建付费任务，已自动移除被误判图片并保留场景、道具、音色和上一镜 @Video 全能参考后重提`, "warning");
        created = await createSeedanceTask(submittedReferences, requestId);
        if (!created.ok) throw await responseFailure(created);
      }
      const task = await created.json() as { id?: string; requestId?: string; acceptedReferences?: Array<{ kind: string; role: string; name: string }>; referenceFallback?: boolean };
      if (!task.id) throw new Error("即梦 Seedance 没有返回任务编号");
      if (task.acceptedReferences?.length) {
        const firstFrameCount = task.acceptedReferences.filter((reference) => reference.role === "first_frame").length;
        if (firstFrameCount) throw new Error("Seedance 返回了首帧模式确认；漫镜已中止该请求，避免按首帧生成视频");
        const lockedAssetCount = task.acceptedReferences.filter((reference) => reference.role === "reference_image").length;
        recordActivity("video", `Seedance 已按全能参考、不送首尾帧模式接收 ${task.acceptedReferences.length} 项素材：${lockedAssetCount} 项人物/场景/道具/构图参考已绑定`, "done");
      }
      if (task.referenceFallback) recordActivity("video", "上一镜视频或音色公网地址已失效；方舟明确拒绝后，漫镜仅重提一次人物、场景、道具 Canonical 图片与完整状态提示词，当前镜头继续生成", "warning");
      taskId = task.id;
      window.localStorage.setItem("manjing-seedance-last-request-v146", JSON.stringify({ requestId: task.requestId || requestId, taskId, model: config.model, scene: options.resumeKey || "", createdAt: Date.now(), status: "created" }));
      saveSeedancePendingTask(resumeKey, { id: taskId, model: config.model, createdAt: Date.now(), promptSignature });
    }
    const activeRun = runRef.current;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (runRef.current !== activeRun) throw new Error("任务已取消");
      await wait(attempt === 0 ? 2500 : 6000);
      const checked = await seedanceRequest("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", apiKey: config.apiKey.trim(), id: taskId }),
      }, "查询 Seedance 任务");
      if (!checked.ok) {
        const data = await checked.clone().json().catch(() => null) as { done?: boolean } | null;
        if (checked.status === 400 || checked.status === 404 || data?.done) saveSeedancePendingTask(resumeKey);
        throw new Error(await responseError(checked));
      }
      const status = await checked.json() as { done?: boolean; status?: string; videoUrl?: string; lastFrameUrl?: string };
      setStatusText(`即梦 Seedance 正在生成动态镜头（${status.status === "running" ? "生成中" : "排队中"}）`);
      if (!status.done && !status.videoUrl) continue;
      if (!status.videoUrl) throw new Error("即梦 Seedance 任务完成但没有返回视频");
      const media = await seedanceRequest(`/api/seedance?url=${encodeURIComponent(status.videoUrl)}`, { method: "GET" }, "下载 Seedance 视频");
      if (!media.ok) throw new Error(await responseError(media));
      let blob: Blob;
      try {
        blob = await media.blob();
      } catch {
        throw new Error("Seedance 视频已生成，但下载内容在写入漫镜时中断；任务编号仍已保留，请重新运行视频 AI 继续下载");
      }
      if (!blob.type.startsWith("video/")) throw new Error("即梦 Seedance 返回的文件不是视频");
      saveSeedancePendingTask(resumeKey);
      return { url: URL.createObjectURL(blob), blob, remoteUrl: status.videoUrl, lastFrameUrl: status.lastFrameUrl || "" };
    }
    throw new Error("即梦 Seedance 仍在生成；任务编号已经保存，再次点击“重新运行视频 AI”会继续查询，不会重复创建任务");
  }

  async function pollinationsMedia(
    kind: "image" | "audio" | "video",
    prompt: string,
    index = 0,
    options: { references?: MediaReference[]; voiceName?: string; duration?: number; music?: boolean; resumeKey?: string; imageAspect?: "9:16" | "16:9"; imagePurpose?: "standard" | "character-card"; voiceover?: SceneVoiceover; referenceText?: string; variationSeed?: number } = {},
  ) {
    const role: "image" | "video" | "voice" = kind === "image" ? "image" : kind === "video" ? "video" : "voice";
    const config = agentConfigs[role];
    const mediaAspect = kind === "image" ? options.imageAspect || aspect : aspect;
    const referenceUrls = (options.references || []).map((reference) => typeof reference === "string" ? reference : reference.url).filter(Boolean);
    const transferableImageReferences = kind === "image" ? await Promise.all(referenceUrls.slice(0, 6).map(async (reference) => {
      if (!reference.startsWith("blob:")) return reference;
      const response = await fetch(reference);
      if (!response.ok) throw new Error("人物参考图读取失败，已停止生成，避免重新设计人物");
      return blobToDataUrl(await response.blob());
    })) : referenceUrls;
    const pollinationsImageReferences = kind === "image" && config.adapter === "pollinations" ? await Promise.all(referenceUrls.slice(0, 6).map(async (reference, referenceIndex) => {
      if (/^https:\/\//i.test(reference)) return reference;
      const response = await fetch(reference);
      if (!response.ok) throw new Error(`第 ${referenceIndex + 1} 张人物参考图读取失败，已停止生成以避免换脸`);
      return uploadPollinationsMedia(await response.blob(), `image-reference-${referenceIndex + 1}.png`, agentKey("image"));
    })) : transferableImageReferences;
    const transferableMediaReferences = kind === "image" ? transferableImageReferences : await Promise.all((options.references || []).map(async (reference) => {
      if (typeof reference === "string") {
        if (!reference.startsWith("blob:")) return reference;
        const response = await fetch(reference);
        return response.ok ? blobToDataUrl(await response.blob()) : reference;
      }
      if (!reference.url.startsWith("blob:")) return reference;
      const response = await fetch(reference.url);
      return response.ok ? { ...reference, url: await blobToDataUrl(await response.blob()) } : reference;
    }));
    if (config.adapter === "openai") {
      if (kind !== "image") throw new Error("OpenAI 兼容图片接口只能用于生图岗位");
      if (!validAgentEndpoint(config.endpoint)) throw new Error("生图 AI 需要填写 OpenAI 兼容 API 地址");
      const response = await fetchWithHardTimeout(
        "/api/desktop/image",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "openai", endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, prompt, aspect: mediaAspect, references: transferableImageReferences }),
        },
        195000,
        "生图模型等待超过 195 秒，已停止本次请求；请检查生图模型接口后重试",
      );
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { dataUrl?: string };
      if (!data.dataUrl?.startsWith("data:image/")) throw new Error("OpenAI 兼容生图接口没有返回图片");
      const blob = await normalizeImageBlobForAspect(await (await fetch(data.dataUrl)).blob(), mediaAspect, options.imagePurpose);
      return { url: URL.createObjectURL(blob), blob };
    }
    if (config.adapter === "seedance") {
      if (kind !== "video") throw new Error("即梦 Seedance 只能用于视频岗位");
      const structuredReferences = (options.references || []).map((reference, referenceIndex): VideoReference => {
        if (typeof reference !== "string") return reference;
        const audio = reference.startsWith("data:audio/");
        return { kind: audio ? "audio" : "image", role: audio ? "reference_audio" : "reference_image", url: reference, name: audio ? "角色固定声音" : `视觉参考 ${referenceIndex + 1}` };
      });
      return seedanceVideo(prompt, { ...options, references: structuredReferences });
    }
    if (config.adapter === "webhook") {
      const media = await webhookMedia(role, { task: kind, prompt, index, aspect: mediaAspect, resolution: kind === "video" ? videoResolution : undefined, responseFormat: kind === "audio" ? "mp3" : undefined, ...options, references: transferableMediaReferences });
      if (kind !== "image") return media;
      const blob = await normalizeImageBlobForAspect(media.blob, mediaAspect, options.imagePurpose);
      return { url: URL.createObjectURL(blob), blob, remoteUrl: "" };
    }
    if (config.adapter !== "pollinations") throw new Error(`${agentName(role)}不支持当前云端媒体任务`);
    const key = agentKey(role);
    if (!key.startsWith("pk_")) throw new Error(`${agentName(role)}需要 Pollinations 发布密钥`);
    const base = "https://gen.pollinations.ai";
    let url = "";
    if (kind === "image") {
      const imageModel = options.references?.length ? config.model || "kontext" : config.model === "kontext" ? "zimage" : config.model || "zimage";
      const params = new URLSearchParams({
        model: imageModel,
        width: options.imagePurpose === "character-card" ? "1792" : mediaAspect === "9:16" ? "720" : "1280",
        height: options.imagePurpose === "character-card" ? "1024" : mediaAspect === "9:16" ? "1280" : "720",
        seed: String(options.variationSeed ?? Math.abs(story.length * 97 + index * 7919)),
        enhance: "true",
        safe: "true",
      });
      if (/^(?:flux|zimage)$/i.test(imageModel)) params.set("negative_prompt", CHARACTER_IMAGE_NEGATIVE_PROMPT);
      if (pollinationsImageReferences.length) params.set("image", pollinationsImageReferences.join("|"));
      url = `${base}/image/${encodeURIComponent(prompt)}?${params}`;
    } else if (kind === "audio") {
      const params = new URLSearchParams({ response_format: "mp3", safe: "true" });
      if (options.music) {
        params.set("model", "elevenmusic");
        params.set("duration", String(Math.max(6, Math.min(180, Math.round(options.duration || targetDuration)))));
        params.set("instrumental", "true");
      } else {
        if (config.model && config.model !== "tts") params.set("model", config.model);
        params.set("voice", options.voiceName || voice);
      }
      url = `${base}/audio/${encodeURIComponent(prompt)}?${params}`;
    } else {
      const params = new URLSearchParams({
        model: config.model || "seedance-2.0",
        duration: String(Math.max(4, Math.min(10, Math.round(options.duration || 6)))),
        aspectRatio: aspect,
        audio: "false",
        safe: "true",
      });
      url = `${base}/video/${encodeURIComponent(prompt)}?${params}`;
    }
    const response = await fetchWithHardTimeout(
      url,
      { headers: { Authorization: `Bearer ${key}` } },
      180000,
      `${kind === "image" ? "图片" : kind === "audio" ? "配音" : "视频"}服务等待超过 180 秒，已停止本次请求；请检查模型服务后重试`,
    );
    if (!response.ok) throw new Error(await responseError(response));
    const receivedBlob = await response.blob();
    const expected = kind === "image" ? "image/" : kind === "audio" ? "audio/" : "video/";
    if (!receivedBlob.type.startsWith(expected)) throw new Error(`${kind === "image" ? "图片" : kind === "audio" ? "配音" : "视频"}服务返回了无效文件`);
    const blob = kind === "image" ? await normalizeImageBlobForAspect(receivedBlob, mediaAspect, options.imagePurpose) : receivedBlob;
    return { url: URL.createObjectURL(blob), blob };
  }

  async function uploadPollinationsMedia(blob: Blob, filename: string, uploadKey = agentKey("image")) {
    const form = new FormData();
    form.append("file", blob, filename);
    const response = await fetchWithHardTimeout(
      "https://gen.pollinations.ai/upload",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${uploadKey}` },
        body: form,
      },
      120000,
      "参考素材上传等待超过 120 秒，已停止本次请求；请检查网络或素材服务后重试",
    );
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error("角色参考素材上传失败");
    return data.url;
  }

  async function makeImage(scene: Scene, index: number, run: number, characterGuide = "", outputAspect: "9:16" | "16:9" = aspect, promptOverride = "", references: MediaReference[] = [], imagePurpose: "standard" | "character-card" = "standard") {
    const prompt = promptOverride || `${frameVisualPrompt(style)}, one coherent scene rather than a comic page, ${scene.shot}, ${scene.visual}, ${scene.action}, ${characterGuide}, preserve the exact same faces, hair and costumes across every shot, correct anatomy and natural hands, layered foreground middle ground and background for camera motion, no typography, no speech bubbles, no panel borders`;
    if (["openai", "pollinations", "webhook"].includes(agentConfigs.image.adapter)) return (await pollinationsMedia("image", prompt, index, { imageAspect: outputAspect, imagePurpose, references })).url;
    const referenceUrl = references.map((reference) => typeof reference === "string" ? reference : reference.url).find(Boolean) || "";
    let sourceImage = "";
    if (referenceUrl) {
      const response = await fetch(referenceUrl);
      if (!response.ok) throw new Error("Canonical 人物参考图读取失败，已停止免费生图以避免换脸");
      const dataUrl = await blobToDataUrl(await response.blob());
      sourceImage = dataUrl.replace(/^data:image\/[^;]+;base64,/i, "");
    }
    const task = await startHorde("image", { prompt, aspect: outputAspect, model: agentConfigs.image.model, sourceImage });
    const result = await pollHorde("image", task.id, run);
    const remote = String(result.imageUrl || "");
    const response = await fetch(`/api/media?url=${encodeURIComponent(remote)}`);
    if (!response.ok) throw new Error(await responseError(response));
    return URL.createObjectURL(await normalizeImageBlobForAspect(await response.blob(), outputAspect, imagePurpose));
  }

  async function consistencyImage(url: string, label: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return null;
      return { url: await blobToDataUrl(blob), label };
    } catch { return null; }
  }

  async function evaluateCharacterReferenceCard(character: CharacterAsset, imageUrl: string): Promise<CharacterReferenceReport> {
    const emptyScores: CharacterReferenceScores = { frontalFace: null, profileSilhouette: null, backSilhouette: null, facialFeatures: null, bodyProportion: null, costumeConsistency: null };
    const fallback: CharacterReferenceReport = {
      scores: emptyScores,
      overall: 0,
      decision: "review",
      mode: "structural",
      findings: ["当前导演模型未执行多角度视觉识别；请人工确认左侧大头照与右侧正面、45°侧面、背面全身属于同一人物。"],
      checkedAt: new Date().toISOString(),
    };
    const config = agentConfigs.director;
    if (!["openai", "pollinations"].includes(config.adapter)) return fallback;
    const card = await consistencyImage(imageUrl, `角色标准卡：${characterAssetNaming(character).displayName}`);
    if (!card) return { ...fallback, findings: ["角色标准卡无法读取，未执行多角度视觉校验。"] };
    try {
      const system = "你是角色标准参考卡的多角度视觉质检员。只根据实际可见内容评分，不得因为提示词声称合格就给高分。标准布局是左侧35%-40%大正脸特写，右侧从上到下依次为正面全身、45度侧面全身、背面全身；纯白背景、均匀平光、自然轻微T-pose、手脚完整。分别检查正脸、侧面轮廓、背面轮廓、五官身份、头身比、三视图服装的一致性。任何区域缺失、出现不同人物、侧脸畸变、背面发型或服装结构冲突、肢体截断、左右翻转冲突都必须明确指出。只返回JSON。";
      const prompt = `审核这张 ${characterAssetNaming(character).displayName} Canonical 角色卡。人物事实：${character.appearance}。当前造型：${characterLook(character)}。返回：{"scores":{"frontalFace":0,"profileSilhouette":0,"backSilhouette":0,"facialFeatures":0,"bodyProportion":0,"costumeConsistency":0},"findings":["只写可见且可修复的问题"]}`;
      const response = await fetchWithHardTimeout("/api/desktop/invoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: config.adapter, endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, role: "director", task: "character_reference_card_check", system, prompt, images: [card] }) }, 90000, "角色多角度质检等待超过 90 秒");
      if (!response.ok) return { ...fallback, findings: [`角色多角度视觉质检接口不可用（${response.status}），请人工审核。`] };
      const data = await response.json() as { text?: string };
      const clean = String(data.text || "").replace(/```json/gi, "").replace(/```/g, "");
      const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)) as { scores?: Partial<Record<keyof CharacterReferenceScores, number | null>>; findings?: string[] };
      const score = (key: keyof CharacterReferenceScores) => typeof parsed.scores?.[key] === "number" ? Math.max(0, Math.min(100, Math.round(parsed.scores[key] as number))) : null;
      const scores: CharacterReferenceScores = { frontalFace: score("frontalFace"), profileSilhouette: score("profileSilhouette"), backSilhouette: score("backSilhouette"), facialFeatures: score("facialFeatures"), bodyProportion: score("bodyProportion"), costumeConsistency: score("costumeConsistency") };
      const values = Object.values(scores).filter((value): value is number => typeof value === "number");
      const overall = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      const required = [scores.frontalFace, scores.profileSilhouette, scores.backSilhouette, scores.facialFeatures, scores.bodyProportion, scores.costumeConsistency];
      const pass = overall >= 90 && required.every((value) => typeof value === "number" && value >= 86) && Number(scores.frontalFace) >= 92 && Number(scores.facialFeatures) >= 92;
      return { scores, overall, decision: pass ? "pass" : overall >= 82 ? "review" : "reject", mode: "vision", findings: Array.isArray(parsed.findings) ? parsed.findings.map(String).slice(0, 8) : [], checkedAt: new Date().toISOString() };
    } catch (reason) {
      return { ...fallback, findings: [`角色多角度视觉质检未完成：${reason instanceof Error ? reason.message : "返回格式不可解析"}`] };
    }
  }

  async function reusableSceneResult(scene: Scene) {
    const identity = shotReuseIdentity(scene);
    const runtime = runtimeShotReuseRef.current.get(identity);
    if (runtime) return { url: runtime, id: "runtime" };
    const title = scene.title.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").trim();
    const candidates = (await listLibraryAssets()).filter((asset) => asset.category === "scene" && asset.mediaType === "image" && asset.reusable !== false && (asset.identityKey === identity || asset.tags.includes(`asset:${identity}`) || (asset.tags.includes("分镜") && title.length > 1 && asset.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").includes(title)))).sort((a, b) => Number(Boolean(b.canonical || b.locked)) - Number(Boolean(a.canonical || a.locked)) || b.createdAt.localeCompare(a.createdAt));
    const match = candidates[0];
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    runtimeShotReuseRef.current.set(identity, loaded.url);
    await markLibraryAssetUsed(match.id);
    return { url: loaded.url, id: match.id };
  }

  async function reusableVoiceResult(scene: Scene, voiceName: string) {
    const identity = voiceReuseIdentity(scene, voiceName);
    const runtime = runtimeVoiceReuseRef.current.get(identity);
    if (runtime) return runtime;
    const match = (await listLibraryAssets()).filter((asset) => asset.category === "audio" && asset.mediaType === "audio" && asset.reusable !== false && asset.identityKey === identity).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!match) return null;
    const [loaded] = await loadLibraryAssets([match.id]);
    if (!loaded?.url) return null;
    const result = { url: loaded.url, duration: match.duration || scene.duration };
    runtimeVoiceReuseRef.current.set(identity, result);
    await markLibraryAssetUsed(match.id);
    return result;
  }

  async function evaluateShotConsistency(scene: Scene, imageUrl: string, castForScene: CharacterAsset[], previousScene: Scene | undefined, attempts: number, evaluationMode: "frame" | "video-strip" = "frame"): Promise<ConsistencyReport> {
    const stateInherited = !previousScene || scene.startState === previousScene.endState;
    const structuralScores: ConsistencyScores = { characterIdentity: null, castIntegrity: null, costume: null, visualStyle: null, aestheticQuality: null, scene: scene.environmentKey && scene.environmentBible ? 96 : 82, props: null, spatialContinuity: previousScene ? (scene.continuity ? 92 : 76) : 100, shotContinuity: stateInherited ? 98 : 70, lighting: null };
    const structuralValues = Object.values(structuralScores).filter((value): value is number => typeof value === "number");
    const structuralOverall = Math.round(structuralValues.reduce((sum, value) => sum + value, 0) / Math.max(1, structuralValues.length));
    const fallback: ConsistencyReport = { scores: structuralScores, overall: structuralOverall, decision: structuralOverall >= 90 ? "pass" : structuralOverall >= 85 ? "review" : "reject", mode: "structural", findings: ["当前导演模型未执行视觉审核；人物身份、服装、道具和光线项目不计入总分。", ...(stateInherited ? [] : ["当前镜头 Start State 未完整继承上一镜 End State。"]), ...(!scene.environmentKey || !scene.environmentBible ? ["场景身份或场景圣经不完整。"] : [])], checkedAt: new Date().toISOString(), attempts };
    const config = agentConfigs.director;
    if (!['openai', 'pollinations'].includes(config.adapter)) return fallback;
    const current = await consistencyImage(imageUrl, evaluationMode === "video-strip" ? "当前视频按时间排列的五点抽帧（5%、25%、50%、75%、98%）" : "当前生成分镜");
    if (!current) return fallback;
    const references = (await Promise.all([
      ...castForScene.slice(0, 3).map((character) => consistencyImage(character.imageUrl || "", `Canonical角色：${character.name}`)),
      scene.imageUrl && scene.imageUrl !== imageUrl ? consistencyImage(scene.imageUrl, "本镜已批准视觉参考") : Promise.resolve(null),
      previousScene?.videoReviewDecision === "approved" && (previousScene.videoEndFrameUrl || previousScene.videoPosterUrl) ? consistencyImage(previousScene.videoEndFrameUrl || previousScene.videoPosterUrl || "", "上一镜已批准视频的结束位置参考（仅用于QA，不提交视频生成）") : Promise.resolve(null),
      previousScene?.remoteImageUrl || previousScene?.imageUrl ? consistencyImage(previousScene.remoteImageUrl || previousScene.imageUrl || "", "上一镜通过审核的视觉参考") : Promise.resolve(null),
    ])).filter(Boolean).slice(0, 7) as Array<{ url: string; label: string }>;
    try {
      const aestheticGate = configuredImageSkillPrompt("quality");
      const system = `你是影视连续性与审美审核引擎。必须真实比较所给图片，不得因为提示词声称一致就直接给高分。只返回JSON。每项0-100；看不到、被遮挡、画外或没有依据的项必须返回null且不得写成缺陷。castIntegrity 检查预期出镜人数、每个人的身份映射以及是否出现角色复制、角色替换、陌生人、同脸双人或人物凭空出现/消失；预期有人物时不得返回 null。spatialContinuity 必须逐人比较屏幕横向位置、左右次序、前中后景、朝向和相对距离；若剧本没有明确移动而人物换边、重新居中或明显漂移，该项不得高于70。visualStyle 必须始终依据用户指定的风格文字和风格参考图评分，不得返回 null；动画变真人、真人变动画、2D变3D或整体渲染语言变化都属于严重偏差。aestheticQuality 必须始终评分，检查主体吸引力与可读性、人物脸部协调和眼神、构图焦点、光色材质、解剖手部与可见生成瑕疵；人物好看但不符合角色身份也不能给高分。默认审美闸门：${aestheticGate.content || "拒绝脸崩、空洞眼神、网红同脸、杂乱构图、塑料材质和明显技术畸形。"} 只审核本镜头景别和构图中实际可见、且剧本明确要求出现的内容，禁止要求一个近景同时展示完整房间、下装或所有场景锚点。旁白、广告声等无实体角色不审核人物和服装。新增耳饰、纹身、眼镜等标准图没有的身份特征属于真实偏差。${evaluationMode === "video-strip" ? "第一张图是同一段视频按时间从左到右、从上到下排列的五个抽帧，不是同一画面出现五个重复人物；必须检查五个时间点之间是否换脸、换装、变风格、肢体畸变、道具凭空出现或空间跳变。若另有上一镜已批准视频的结束位置参考，必须将当前视频开头与它逐人比较；无剧本移动却改变位置即判定空间连续性失败。" : ""}`;
      const prompt = `审核${evaluationMode === "video-strip" ? "当前视频五点抽帧" : "当前生成分镜"}与 Canonical 参考、上一镜画面是否一致。镜头标题：${scene.title}。景别/机位：${scene.camera}。预期空间锚点与允许区间：${spatialLayoutSummary(scene) || "无可见人物"}。预期出镜人数：${castForScene.length}。预期人物：${castForScene.map((item) => `${item.name}(${item.appearance})`).join("；") || "无实体人物"}。全片固定风格：${style}；${visualStyle(style).base}。预期场景：${scene.environmentKey || scene.title}；${scene.environmentBible || scene.visual}。重要道具：${labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").join("、") || "无明确重要道具"}。Start State：${scene.startState || "首镜"}。动作：${scene.action}。先核对人物数量和逐人身份映射，再检查人物身份、服装、画风还原、审美完成度、场景、道具、空间关系、镜头承接和光线。未入镜或被遮挡的内容不得扣分；除 castIntegrity、visualStyle 和 aestheticQuality 外，没有 Canonical 图像依据的项目返回 null。返回：{"scores":{"characterIdentity":0,"castIntegrity":0,"costume":0,"visualStyle":0,"aestheticQuality":0,"scene":0,"props":0,"spatialContinuity":0,"shotContinuity":0,"lighting":0},"findings":["只写可见且可修复的具体偏差"]}`;
      const response = await fetch("/api/desktop/invoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: config.adapter, endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, role: "director", task: "consistency_check", system, prompt, images: [current, ...references] }) });
      if (!response.ok) return { ...fallback, findings: [...fallback.findings, `视觉审核接口不可用（${response.status}），已降级为结构检查。`] };
      const data = await response.json() as { text?: string };
      const clean = String(data.text || "").replace(/```json/gi, "").replace(/```/g, "");
      const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)) as { scores?: Partial<Record<keyof ConsistencyScores, number | null>>; findings?: string[] };
      const score = (key: keyof ConsistencyScores) => typeof parsed.scores?.[key] === "number" ? Math.max(0, Math.min(100, Math.round(parsed.scores[key] as number))) : null;
      const scores: ConsistencyScores = { characterIdentity: score("characterIdentity"), castIntegrity: score("castIntegrity"), costume: score("costume"), visualStyle: score("visualStyle"), aestheticQuality: score("aestheticQuality"), scene: score("scene"), props: score("props"), spatialContinuity: score("spatialContinuity"), shotContinuity: score("shotContinuity"), lighting: score("lighting") };
      const values = Object.values(scores).filter((value): value is number => typeof value === "number");
      const overall = Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
      return { scores, overall, decision: overall >= 90 ? "pass" : overall >= 85 ? "review" : "reject", mode: "vision", findings: Array.isArray(parsed.findings) ? parsed.findings.map(String).slice(0, 8) : [], checkedAt: new Date().toISOString(), attempts };
    } catch {
      return { ...fallback, findings: [...fallback.findings, "视觉审核返回格式不可解析，已降级为结构检查。"] };
    }
  }

  async function inspectGeneratedVideo(scene: Scene, videoUrl: string, castForScene: CharacterAsset[], previousScene?: Scene, attempts = 1) {
    const frames = await extractVideoContinuityFrames(videoUrl, scene);
    const report = await evaluateShotConsistency(scene, frames.audit, castForScene, previousScene, attempts, "video-strip");
    return { frames, report, accepted: videoConsistencyAccepted(report, castForScene.length > 0) };
  }

  async function generateInspectedVideoWithOneRepair(scene: Scene, sceneIndex: number, previousScene: Scene | undefined, preparedCharacters: CharacterAsset[], preparedProps: PropAsset[]) {
    const visibleCast = charactersForScene(preparedCharacters, scene).filter(isVisualCharacterAsset);
    let attemptScene = scene;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const prompt = await compileShotMotionPrompt(attemptScene, sceneIndex, previousScene);
      const clip = await pollinationsMedia("video", prompt, sceneIndex, { references: await videoReferences(scene, previousScene, preparedCharacters, preparedProps, sceneIndex), duration: scene.duration, resumeKey: scene.id, voiceover: sceneVoiceover(scene) });
      const durableCandidate = await persistSceneVideoAsset(scene, clip.url, "candidate");
      const inspection = await withStageTimeout(inspectGeneratedVideo(attemptScene, durableCandidate.url, visibleCast, previousScene, attempt), 120000, "视频已生成，但一致性检查等待超过 120 秒；请重试该镜头");
      const canAutoRepair = !inspection.accepted && inspection.report.mode === "vision" && attempt === 1;
      if (!canAutoRepair) return { clip, durableCandidate, inspection };
      recordActivity("video", `“${scene.title}”首次一致性检查未通过（${inspection.report.overall} 分），正在按可见偏差自动重生成 1 次`, "warning");
      setStatusText(`镜头 ${sceneIndex + 1} 发现人物位置/身份/画面连续性偏差，正在自动修复 1/1`);
      await deleteLibraryAsset(durableCandidate.id).catch(() => undefined);
      if (durableCandidate.url.startsWith("blob:")) URL.revokeObjectURL(durableCandidate.url);
      attemptScene = { ...scene, consistencyDecision: "reject", consistencyReport: { ...inspection.report, attempts: attempt } };
    }
    throw new Error("视频自动修复流程未返回结果");
  }

  async function applyEditorPlan(work: Scene[]) {
    const config = agentConfigs.editor;
    if (config.adapter === "browser") return work;
    setStatusText(`${agentName("editor")}正在分析镜头节奏和剪辑顺序`);
    const compactScenes = work.map((scene) => ({ id: scene.id, title: scene.title, action: scene.action, dialogue: scene.dialogue, duration: scene.duration }));
    const system = "你是短视频剪辑师。根据剧情调整镜头顺序和单镜头时长，只返回 JSON：{\"order\":[\"镜头id\"],\"durations\":{\"镜头id\":6}}。不要删除镜头；每镜 2–15 秒；长内容必须拆成多个分镜；总时长尽量接近目标。";
    const prompt = `目标时长：${productionDuration} 秒\n镜头：${JSON.stringify(compactScenes)}`;
    let raw = "";
    if (CUSTOM_TEXT_ADAPTERS.includes(config.adapter)) raw = await customApiText("editor", { task: "edit_plan", system, prompt, scenes: compactScenes, duration: productionDuration });
    else raw = await pollinationsText("editor", system, prompt);
    try {
      const parsed = JSON.parse(raw.replace(/```json/gi, "").replace(/```/g, "").trim()) as { order?: string[]; durations?: Record<string, number> };
      const byId = new Map(work.map((scene) => [scene.id, scene]));
      const order = Array.isArray(parsed.order) ? parsed.order.filter((id) => byId.has(id)) : [];
      const ordered = order.length === work.length ? order.map((id) => byId.get(id) as Scene) : work;
      return ordered.map((scene) => ({ ...scene, duration: Math.max(2, Math.min(15, Number(parsed.durations?.[scene.id]) || scene.duration)) }));
    } catch {
      return work;
    }
  }

  async function syncScenesToEditor(sourceScenes: Scene[], finalVideoUrl = "", source: "studio" | "libtv" = "studio", openEditor = false) {
    if (editorSyncRef.current) return false;
    if (!sourceScenes.length) {
      setError("还没有可导入剪辑台的镜头");
      return false;
    }
    editorSyncRef.current = true;
    setEditorSyncState("saving");
    setEditorSyncProgress(0);
    let start = 0;
    const clips: EditorProjectClip[] = [];
    for (const scene of sourceScenes) {
      const visualType = scene.videoUrl ? "video" : scene.imageUrl ? "image" : null;
      if (visualType) clips.push({
        id: `${scene.id}-visual`, name: scene.title, type: visualType, url: scene.videoUrl || scene.imageUrl,
        duration: scene.duration, sourceDuration: scene.duration, trimStart: 0, trimEnd: scene.duration, start,
        volume: scene.volume ?? 1, speed: scene.speed || 1, filter: scene.filter || "none", transition: scene.transition || "fade",
      });
      if (scene.audioUrl) clips.push({
        id: `${scene.id}-audio`, name: `${scene.speaker || "旁白"} · ${scene.title}`, type: "audio", url: scene.audioUrl,
        duration: scene.duration, sourceDuration: scene.duration, trimStart: 0, trimEnd: scene.duration, start,
        volume: scene.volume ?? 1, speed: 1, filter: "none", transition: "cut",
      });
      if (subtitleEnabled && scene.dialogue && scene.subtitleEnabled !== false) clips.push({
        id: `${scene.id}-subtitle`, name: `字幕 · ${scene.title}`, type: "text", text: scene.dialogue,
        duration: scene.duration, sourceDuration: scene.duration, trimStart: 0, trimEnd: scene.duration, start,
        volume: 1, speed: 1, filter: "none", transition: "cut",
      });
      start += scene.duration;
    }
    if (musicUrl) clips.push({
      id: "project-music", name: "项目配乐", type: "audio", url: musicUrl,
      duration: start, sourceDuration: start, trimStart: 0, trimEnd: start, start: 0,
      volume: musicVolume, speed: 1, filter: "none", transition: "cut",
    });
    try {
      await persistEditorProject({
        id: editorProjectIdRef.current,
        name: projectTitle || "未命名漫剧",
        aspect,
        source,
        clips,
        finalVideo: finalVideoUrl ? { url: finalVideoUrl } : undefined,
        editorNote: `${agentName("editor")}已完成镜头顺序、节奏、字幕与混音方案，可继续人工精剪。`,
        studioSnapshot: {
          version: 2, projectId: editorProjectIdRef.current, projectTitle, story, style, targetDuration, aspect, frameContinuityMode,
          characters: characters.map(serializableCharacter), propAssets: propAssets.map(serializableProp), sceneAssets: sceneAssets.map(serializableSceneAsset), scenes: sourceScenes.map(serializableScene), selected,
          phase: finalVideoUrl ? "ready" : phase, progress: finalVideoUrl ? 100 : progress, statusText,
          activityLog: activityLog.slice(0, 120), musicPrompt, updatedAt: new Date().toISOString(),
        },
      }, {
        onProgress: ({ completed, total }) => setEditorSyncProgress(total ? Math.round((completed / total) * 100) : 100),
      });
      const savedProjects = localStorage.getItem("manjing-projects");
      let projects: Array<Record<string, unknown>> = [];
      try { projects = savedProjects ? JSON.parse(savedProjects) as Array<Record<string, unknown>> : []; } catch { projects = []; }
      const projectCard = { id: editorProjectIdRef.current, title: projectTitle || "未命名漫剧", story: story.trim().slice(0, 120), updatedAt: "刚刚", duration: formatTime(sourceScenes.reduce((sum, scene) => sum + scene.duration, 0)), status: finalVideoUrl ? "已完成" : "剪辑中", source, durable: true };
      localStorage.setItem("manjing-projects", JSON.stringify([projectCard, ...projects.filter((item) => item.id !== projectCard.id)].slice(0, 20)));
      setEditorSyncProgress(100);
      setEditorSyncState("ready");
      if (openEditor) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
        router.push("/editor");
      }
      return true;
    } catch (reason) {
      setEditorSyncState("error");
      setError(reason instanceof Error ? `导入剪辑台失败：${reason.message}` : "导入剪辑台失败");
      return false;
    } finally {
      editorSyncRef.current = false;
    }
  }

  async function openInProfessionalEditor() {
    await syncScenesToEditor(scenes, exportUrl, libtvSessionId && scenes.every((scene) => scene.model === "LibTV") ? "libtv" : "studio", true);
  }

  async function generateWithLibTv() {
    if (story.trim().length < 8 || libtvRunning || !["idle", "ready", "error"].includes(phase)) return;
    if (libtvAccessKey.trim().length < 8) {
      setError("请先填写 LibTV Access Key");
      return;
    }
    const run = Date.now();
    runRef.current = run;
    editorProjectIdRef.current = `libtv-${run.toString(36)}`;
    setLibtvRunning(true);
    setLibtvSessionId("");
    setLibtvProjectUrl("");
    setLibtvResults([]);
    setLibtvMessages([]);
    libtvPauseRef.current = false;
    setLibtvPollingPaused(false);
    setError("");
    setShowFilm(false);
    setPlaying(false);
    setTime(0);
    setActivityLog([]);
    setPhase("story");
    setProgress(4);
    setStatusText("LibTV 正在建立完整漫剧项目");
    recordActivity("director", "LibTV 总控开始拆解故事与制作目标");
    recordActivity("writer", "LibTV 编剧开始生成剧本、分镜和提示词");
    const message = [
      "请生成一部完整、真正会动的 AI 漫剧，不要只生成静态漫画。",
      `项目标题：${projectTitle || "漫镜作品"}`,
      `故事：${story.trim()}`,
      `视觉风格：${style}`,
      `画面比例：${aspect}`,
      `目标总时长：${productionDuration} 秒`,
      voiceEnabled
        ? "请完成剧本、固定角色设定、连续分镜、角色一致性图片、人物动态视频、中文配音、字幕、配乐和剪辑成片。人物说话时口型与配音同步。"
        : `不要生成任何人物对白、旁白或人声音轨；输出无配音成片。${bgmEnabled ? "可以保留无歌词背景音乐和环境音。" : "同时不要生成背景音乐。"}`,
      "镜头必须有动作、表情、运镜和连续表演。输出完整视频，并保留可下载的中间图片和视频素材。",
    ].join("\n");
    try {
      const created = await fetch("/api/libtv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", accessKey: libtvAccessKey.trim(), message }),
      });
      if (!created.ok) throw new Error(await responseError(created));
      const task = await created.json() as { sessionId?: string; projectUrl?: string };
      if (!task.sessionId) throw new Error("LibTV 没有返回任务编号");
      setLibtvSessionId(task.sessionId);
      setLibtvProjectUrl(task.projectUrl || "");
      setLibtvCanvasOpen(true);
      setProgress(8);
      recordActivity("director", "LibTV 项目已建立，可随时打开云端画布查看", "done");
      recordActivity("image", "LibTV 正在锁定角色形象并绘制连续关键帧");
      recordActivity("video", "LibTV 已排入动态视频与镜头表演任务");
      recordActivity("voice", voiceEnabled ? "LibTV 将在视频完成后生成配音和声音" : "一键漫剧配音已关闭，LibTV 将跳过人声", voiceEnabled ? "running" : "warning");
      recordActivity("editor", "LibTV 剪辑代理等待上游素材交付");

      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (runRef.current !== run) throw new Error("任务已取消");
        while (libtvPauseRef.current) {
          if (runRef.current !== run) throw new Error("任务已取消");
          await wait(700);
        }
        await wait(attempt === 0 ? 3500 : 10000);
        const checked = await fetch("/api/libtv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", accessKey: libtvAccessKey.trim(), sessionId: task.sessionId }),
        });
        if (!checked.ok) throw new Error(await responseError(checked));
        const status = await checked.json() as { done?: boolean; failed?: boolean; summary?: string; messageCount?: number; results?: LibTvResult[]; events?: LibTvMessage[] };
        if (status.failed && !(status.results || []).length) throw new Error(status.summary || "LibTV 生成失败，请在项目画布中查看原因");
        const results = status.results || [];
        setLibtvResults(results);
        setLibtvMessages(status.events || []);
        const hasImages = results.some((item) => item.kind === "image");
        setPhase(hasImages ? "video" : attempt > 2 ? "characters" : "story");
        setProgress(Math.min(94, 8 + Math.min(28, Number(status.messageCount || 0) * 2) + Math.round((attempt / 180) * 56)));
        setStatusText(status.summary || (hasImages ? "LibTV 已生成分镜素材，正在制作动态视频" : "LibTV 正在编写剧本并建立角色"));
        if (!status.done) continue;

        const videos = results.filter((item) => item.kind === "video");
        const images = results.filter((item) => item.kind === "image");
        const imported: Scene[] = videos.map((item, index) => ({
          id: uid(),
          title: `LibTV 成片 ${index + 1}`,
          visual: "LibTV 完整 AI 漫剧输出",
          action: voiceEnabled ? "已由 LibTV 完成动态表演、配音与剪辑" : "已由 LibTV 完成无配音动态表演与剪辑",
          shot: "成片",
          camera: "LibTV 自动导演",
          dialogue: "",
          speaker: "",
          emotion: "",
          sfx: "",
          characters: [],
          duration: Math.max(4, Math.round(productionDuration / Math.max(1, videos.length))),
          imageUrl: images[index]?.url ? `/api/libtv?url=${encodeURIComponent(images[index].url)}` : undefined,
          videoUrl: `/api/libtv?url=${encodeURIComponent(item.url)}`,
          status: "ready",
          model: "LibTV",
        }));
        setScenes(assignSpatialLayouts(imported));
        setCharacters([]);
        setSelected(0);
        if (imported[0]?.videoUrl) {
          setExportUrl(imported[0].videoUrl);
          setShowFilm(true);
        }
        setPhase("ready");
        setProgress(100);
        setStatusText("LibTV 完整 AI 漫剧已生成，并已导入剪辑台");
        recordActivity("writer", "剧本与分镜已交付", "done");
        recordActivity("image", `${images.length} 项角色与分镜素材已交付`, "done");
        recordActivity("video", `${videos.length} 项动态视频已交付`, "done");
        recordActivity("voice", voiceEnabled ? "配音与声音已写入 LibTV 成片" : "已按设置跳过人声配音", "done");
        recordActivity("editor", "最终成片已导入漫镜剪辑台", "done");
        await syncScenesToEditor(imported, imported[0]?.videoUrl || "", "libtv");
        return;
      }
      throw new Error("LibTV 仍在制作中，请通过项目画布继续查看；任务不会丢失");
    } catch (reason) {
      if (runRef.current !== run) return;
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "LibTV 生成失败，请重试");
      setStatusText("LibTV 制作中断");
      recordActivity("director", reason instanceof Error ? `LibTV 中断：${reason.message}` : "LibTV 制作中断", "error");
    } finally {
      setLibtvRunning(false);
    }
  }

  async function refreshLibTvCanvas() {
    if (!libtvSessionId || libtvAccessKey.trim().length < 8 || libtvSending) return;
    setLibtvSending(true);
    try {
      const response = await fetch("/api/libtv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", accessKey: libtvAccessKey.trim(), sessionId: libtvSessionId }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const status = await response.json() as { summary?: string; results?: LibTvResult[]; events?: LibTvMessage[] };
      setLibtvResults(status.results || []);
      setLibtvMessages(status.events || []);
      if (status.summary) setStatusText(status.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新 LibTV 画布失败");
    } finally {
      setLibtvSending(false);
    }
  }

  async function sendLibTvInstruction() {
    const message = libtvInstruction.trim();
    if (message.length < 8 || !libtvSessionId || libtvSending) return;
    setLibtvSending(true);
    setError("");
    try {
      const response = await fetch("/api/libtv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", accessKey: libtvAccessKey.trim(), sessionId: libtvSessionId, message }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setLibtvInstruction("");
      setLibtvMessages((items) => [...items, { id: uid(), seq: (items.at(-1)?.seq || 0) + 1, role: "user", content: message }]);
      recordActivity("director", `用户向 LibTV 画布追加指令：${message.slice(0, 60)}`);
      window.setTimeout(() => { void refreshLibTvCanvas(); }, 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送 LibTV 指令失败");
    } finally {
      setLibtvSending(false);
    }
  }

  function toggleLibTvPolling() {
    const next = !libtvPauseRef.current;
    libtvPauseRef.current = next;
    setLibtvPollingPaused(next);
  }

  function createLibTvCanvas() {
    if (libtvSending) return;
    const document = createCanvasFromStudio({ title: projectTitle, story, characters, scenes });
    setStatusText("已创建本机制片画布，正在打开");
    recordActivity("director", "已把当前剧本、角色和分镜导入本机制片画布", "done");
    router.push(`/canvas?id=${encodeURIComponent(document.id)}`);
  }

  async function generateAll() {
    if (story.trim().length < 8 || !["idle", "ready", "error"].includes(phase)) return;
    if (scriptImported) {
      if (assetAnalysisState === "analyzing") {
        setError("AI 仍在分析剧本人物与道具，请等待资产框架建立完成");
        return;
      }
      if (assetAnalysisState === "idle") {
        setError("请先运行剧本资产分析，确认人物与道具框架后再开始制片");
        return;
      }
      const unresolvedCharacters = characters.filter((item) => isVisualCharacterAsset(item) && (!item.imageUrl || item.reviewDecision === "pending"));
      const unresolvedProps = propAssets.filter((item) => !item.imageUrl || item.reviewDecision === "pending");
      const unresolvedScenes = sceneAssets.filter((item) => !item.imageUrl || item.reviewDecision === "pending");
      if (unresolvedCharacters.length || unresolvedProps.length || unresolvedScenes.length) {
        setError(`资产准备尚未完成：${unresolvedCharacters.length} 个人物、${unresolvedProps.length} 个道具仍需上传图片，或让 AI 生成后采用；另有 ${unresolvedScenes.length} 个 Canonical 场景需要上传或生成并采用（人物数量按本集独立服装/状态造型计算）`);
        setStatusText("制片尚未开始，不会自动生成未确认的人物或道具图片");
        document.querySelector(".script-asset-blueprint")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    const existingDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const hasLockedStoryboard = scenes.length > 0
      && Math.abs(existingDuration - productionDuration) < 0.5
      && (productionDuration > 15 || scenes.length === 1);
    const roleNeeded = (role: AgentRole) => {
      if (role === "writer" || role === "director") return !hasLockedStoryboard;
      if (role === "image") return !hasLockedStoryboard || characters.some((item) => isVisualCharacterAsset(item) && !item.imageUrl) || sceneAssets.some((item) => !item.imageUrl) || propAssets.some((item) => !item.imageUrl);
      if (role === "video") return agentConfigs.video.adapter !== "browser" && (!hasLockedStoryboard || scenes.some((item) => !item.videoUrl));
      if (role === "voice") return agentConfigs.voice.adapter !== "browser" && (bgmEnabled || (voiceEnabled && agentConfigs.video.adapter !== "seedance")) && (!hasLockedStoryboard || bgmEnabled || scenes.some((item) => item.dialogue.trim() && !item.audioUrl));
      return true;
    };
    const missingPollinationsKey = AGENT_ROLES.find(({ id }) => roleNeeded(id) && agentConfigs[id].adapter === "pollinations" && !agentKey(id).startsWith("pk_"));
    if (missingPollinationsKey) {
      setError(`${missingPollinationsKey.title}需要填写以 pk_ 开头的 Pollinations 发布密钥`);
      return;
    }
    if (roleNeeded("video") && agentConfigs.video.adapter === "seedance" && agentConfigs.video.apiKey.trim().length < 8) {
      setConfiguringRole("video");
      setError("即梦 Seedance 需要填写火山方舟 API Key");
      return;
    }
    const missingCustomApi = AGENT_ROLES.find(({ id }) => roleNeeded(id) && CUSTOM_TEXT_ADAPTERS.includes(agentConfigs[id].adapter) && !validAgentEndpoint(agentConfigs[id].endpoint));
    if (missingCustomApi) {
      setConfiguringRole(missingCustomApi.id);
      setError(`${missingCustomApi.title}需要填写 HTTPS API 地址或本机 localhost 地址`);
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setError("");
    setExportUrl("");
    setMusicUrl("");
    setMusicReviewDecision("approved");
    setShowFilm(false);
    setPlaying(false);
    setTime(0);
    setActivityLog([]);
    setPhase(hasLockedStoryboard ? "characters" : "story");
    setProgress(hasLockedStoryboard ? 15 : 5);
    setStatusText(hasLockedStoryboard ? "已锁定用户分镜，正在检查缺少的生产素材" : scriptImported ? "已导入剧本，AI 只负责结构化拆镜" : "AI 正在理解故事并编写分镜");
    recordActivity("writer", hasLockedStoryboard ? "用户分镜已锁定，跳过编剧岗位" : scriptImported ? "用户剧本已锁定，只拆分镜头，不改写剧情" : `${agentName("writer")}开始改编剧本和拆分镜头`, hasLockedStoryboard ? "done" : "running");
    let activeRole: AgentRole = hasLockedStoryboard ? "image" : "writer";
    try {
      let storyboard: Storyboard;
      if (hasLockedStoryboard) {
        storyboard = { title: projectTitle || "用户导入项目", music: musicPrompt || "cinematic instrumental soundtrack, no vocals", characters: characters.map((item) => ({ ...item })), scenes: scenes.map((item) => ({ ...item })) };
        recordActivity("director", "用户分镜视为已定稿，跳过导演复核", "done");
      } else {
        let raw = await generateStoryboard(run);
        recordActivity("writer", scriptImported ? "已按用户剧本交付结构化分镜" : "剧本初稿与分镜提示词已交付", "done");
        setProgress(10);
        activeRole = "director";
        recordActivity("director", `${agentName("director")}开始复核节奏、角色一致性和结尾钩子`);
        try {
          const reviewed = await directorReview(raw, run);
          parseStoryboard(reviewed, productionDuration, sceneCountForDuration(productionDuration), 8);
          raw = reviewed;
          recordActivity("director", "导演复核通过，已锁定制作稿", "done");
        } catch (reason) {
          if (runRef.current !== run) throw new Error("任务已取消");
          const detail = reason instanceof Error ? reason.message : "接口没有返回有效结果";
          setStatusText(`${agentName("director")}暂未完成复核，已保留编剧初稿并继续制作`);
          recordActivity("director", `${agentName("director")}复核未及时完成（${detail}），已安全降级采用编剧初稿，不中断后续制作`, "warning");
        }
        setProgress(15);
        try {
          storyboard = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8);
        } catch (reason) {
          let partial: Storyboard | null = null;
          try { partial = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8); } catch { partial = null; }
          // A returned storyboard can be valid but use a different field name,
          // or contain fewer shots than a longer target duration needs. Parse
          // its usable portion first, then add only the missing shot shells.
          if (!partial) {
            try { partial = parseStoryboard(raw, productionDuration, 1, 16); } catch { partial = null; }
          }
          if (scriptImported) {
            partial = {
              ...(partial || { title: projectTitle || "用户导入项目", music: "cinematic instrumental soundtrack, no vocals", scenes: [] }),
              characters: characters.map((item) => ({ ...item })),
            };
          }
          setStatusText("编剧输出镜头不足或字段不一致，漫镜正在保留可解析内容并补全分镜");
          storyboard = completeFreeStoryboard(partial, story.trim(), style, productionDuration);
          recordActivity("writer", `${agentName("writer")}输出镜头不足或字段不一致；已保留有效内容并补齐缺失镜头，不中断制作`, "warning");
        }
      }
      if (scriptImported) {
        const locked = lockStoryboardToAssetManifest(storyboard.characters, storyboard.scenes, characters);
        if (locked.blocked.length) {
          setAssetAnalysisState("ready");
          document.querySelector(".script-asset-blueprint")?.scrollIntoView({ behavior: "smooth", block: "start" });
          throw new Error(`正式拆镜发现首次全文资产清单之外的人物：${locked.blocked.join("、")}。系统已停止制片且不会自动生图；请回到资产清单确认剧本原文是否确有遗漏`);
        }
        const sceneLock = lockStoryboardScenesToAssetManifest(locked.scenes, sceneAssets);
        if (sceneLock.blocked.length) {
          setAssetAnalysisState("ready");
          document.querySelector(".script-asset-blueprint")?.scrollIntoView({ behavior: "smooth", block: "start" });
          throw new Error(`分镜引用了首次资产清单中没有的场景：${sceneLock.blocked.join("、")}。系统已停止且不会把镜头标题建立成场景资产；请重新运行全文资产分析或修正原场景清单`);
        }
        storyboard = { ...storyboard, characters: locked.characters, scenes: sceneLock.scenes };
        if (locked.remapped.length) recordActivity("director", `已阻止二次资产命名并重新绑定首次清单：${locked.remapped.slice(0, 8).join("；")}`, "done");
        if (sceneLock.remapped.length) recordActivity("director", `已把分镜场景别名重新绑定首次 Canonical 清单：${sceneLock.remapped.slice(0, 8).join("；")}`, "done");
      }
      setProjectTitle(storyboard.title);
      setMusicPrompt(storyboard.music);
      const blueprintCharacters = new Map(characters.map((item) => [characterAssetKey(item), item]));
      let cast: CharacterAsset[] = storyboard.characters.map((item) => {
        const blueprint = blueprintCharacters.get(characterAssetKey(item));
        return blueprint ? { ...item, id: blueprint.id, libraryAssetId: blueprint.libraryAssetId, name: characterIdentity(blueprint), identityName: characterIdentity(blueprint), lookName: characterLook(blueprint), episodeScope: blueprint.episodeScope || item.episodeScope, sceneHints: blueprint.sceneHints?.length ? blueprint.sceneHints : item.sceneHints, role: blueprint.role || item.role, appearance: blueprint.appearance || item.appearance, voice: blueprint.voice || item.voice, imageUrl: blueprint.imageUrl, remoteUrl: blueprint.remoteUrl, arkAssetId: blueprint.arkAssetId, portraitAuthorizationStatus: blueprint.portraitAuthorizationStatus, sheetVersion: blueprint.sheetVersion, reviewDecision: blueprint.reviewDecision, identityBaseline: blueprint.identityBaseline, status: blueprint.imageUrl ? "ready" as const : item.status } : item;
      });
      const storyboardLooks = new Set(cast.map(characterAssetKey));
      cast.push(...characters.filter((item) => !storyboardLooks.has(characterAssetKey(item))).map((item) => ({ ...item })));
      cast = deduplicateCharacterAssets(cast);
      let work: Scene[] = storyboard.scenes.map((scene, index, all) => ({ ...scene, startState: index === 0 ? (scene.startState || "首镜：按角色、场景和道具 Canonical 资产建立初始状态") : (all[index - 1].endState || scene.startState || "继承上一镜结束状态") }));
      publishCharacters(cast);
      publishScenes(work);
      setSelected(0);

      if (scriptImported) {
        const unresolvedAfterStoryboard = cast.filter((item) => isVisualCharacterAsset(item) && (!item.imageUrl || item.reviewDecision === "pending"));
        if (unresolvedAfterStoryboard.length) {
          setAssetAnalysisState("ready");
          document.querySelector(".script-asset-blueprint")?.scrollIntoView({ behavior: "smooth", block: "start" });
          throw new Error(`资产清单锁定检查未通过：${unresolvedAfterStoryboard.map((item) => characterAssetNaming(item).displayName).join("、")} 尚未确认。系统不会在开拍后补建人物框架或自动换脸`);
        }
        recordActivity("image", `正式拆镜已逐项绑定首次确认的 ${cast.filter(isVisualCharacterAsset).length} 套人物造型；未创建任何二次人物框架`, "done");
      }

      setPhase("characters");
      activeRole = "image";
      recordActivity("image", `${agentName("image")}开始生成角色设定与一致性参考`);
      let generatedCharacters = 0;
      const reusableProductionAssets = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.reusable !== false);
      const productionProjectId = activeAssetProjectId();
      for (let index = 0; index < cast.length; index += 1) {
        const character = cast[index];
        if (!isVisualCharacterAsset(character)) {
          cast = cast.map((item) => item.id === character.id ? { ...item, status: "ready" as const } : item);
          recordActivity("image", `“${character.name}”属于旁白、广告声或画外音，已保留声音设定并跳过人物图`, "done");
          continue;
        }
        if (!character.imageUrl) {
          const identity = `character:${stableReuseToken(`${character.name}|${character.appearance}`)}`;
          const naming = characterAssetNaming(character);
          const existing = findReusableLibraryAsset(reusableProductionAssets, { category: "character", identityKey: naming.identityKey, lookName: naming.lookName, projectId: productionProjectId, mediaType: "image", allowCrossProject: false, allowLookFallback: false })
            || reusableProductionAssets.find((asset) => asset.category === "character" && asset.mediaType === "image" && asset.tags.includes(`asset:${identity}`) && asset.assetState !== "placeholder");
          if (existing) {
            const [loaded] = await loadLibraryAssets([existing.id]);
            if (loaded?.url) {
              const response = await fetch(loaded.url);
              const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
              const remoteUrl = response.ok ? (uploadKey ? await uploadPollinationsMedia(await response.blob(), `canonical-character-${existing.id}.png`, uploadKey) : await blobToDataUrl(await response.blob())) : "";
              cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: loaded.url, remoteUrl, sheetVersion: characterSheetVersionFromLibrary(loaded), status: "ready" as const } : item);
              await markLibraryAssetUsed(existing.id);
              recordActivity("image", `人物造型“${characterAssetNaming(character).displayName}”未变化，已直接复用资产`, "done");
            }
          }
        }
        const resolvedCharacter = cast.find((item) => item.id === character.id) || character;
        if (resolvedCharacter.imageUrl) {
          cast = cast.map((item) => item.id === character.id ? { ...item, status: "ready" as const } : item);
          publishCharacters(cast);
          setProgress(10 + Math.round(((index + 1) / Math.max(1, cast.length)) * 16));
          continue;
        }
        setStatusText(`正在建立人物造型资产 ${index + 1}/${cast.length}：${characterAssetNaming(character).displayName}`);
        cast = cast.map((item) => item.id === character.id ? { ...item, status: "generating" as const } : item);
        publishCharacters(cast);
        const characterRequest = await characterGenerationRequest(character, cast);
        const characterPrompt = characterRequest.prompt;
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", characterPrompt, 50 + index, { imageAspect: "16:9", imagePurpose: "character-card", references: characterRequest.references });
          const assetUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : assetUploadKey ? await uploadPollinationsMedia(asset.blob, `character-${index + 1}.png`, assetUploadKey) : "";
          characterReviewPatchesRef.current.set(character.id, { reviewDecision: "pending" });
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: asset.url, remoteUrl, sheetVersion: 3 as const, reviewDecision: "pending" as const, status: "ready" as const } : item);
        } else {
          const referenceScene: Scene = { id: uid(), title: character.name, visual: characterPrompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
          const imageUrl = await makeImage(referenceScene, 50 + index, run, "", "16:9", characterPrompt, characterRequest.references, "character-card");
          characterReviewPatchesRef.current.set(character.id, { reviewDecision: "pending" });
          cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl, sheetVersion: 3 as const, reviewDecision: "pending" as const, status: "ready" as const } : item);
        }
        const generatedCharacter = cast.find((item) => item.id === character.id);
        if (generatedCharacter?.imageUrl) {
          const referenceCardReport = await evaluateCharacterReferenceCard(generatedCharacter, generatedCharacter.imageUrl);
          characterReviewPatchesRef.current.set(character.id, { ...(characterReviewPatchesRef.current.get(character.id) || {}), referenceCardReport, reviewDecision: "pending" });
          cast = cast.map((item) => item.id === character.id ? { ...item, referenceCardReport } : item);
          recordActivity("director", `人物“${characterAssetNaming(generatedCharacter).displayName}”角色卡已完成正脸、侧脸、背面轮廓、五官、头身比和服装一致性${referenceCardReport.mode === "vision" ? `视觉校验（${referenceCardReport.overall}分）` : "结构登记，等待人工视觉确认"}`, referenceCardReport.decision === "pass" ? "done" : "warning");
        }
        generatedCharacters += 1;
        publishCharacters(cast);
        setProgress(10 + Math.round(((index + 1) / cast.length) * 16));
      }
      recordActivity("image", `${cast.length - generatedCharacters} 个用户角色资产已复用，${generatedCharacters} 个缺失角色已补齐；开始检查连续分镜`);
      const pendingCharacterCards = cast.filter((character) => isVisualCharacterAsset(character) && character.imageUrl && character.reviewDecision === "pending");
      if (pendingCharacterCards.length) {
        publishCharacters(cast);
        setPhase("ready");
        setProgress(26);
        setStatusText(`已生成 ${pendingCharacterCards.length} 张四区角色卡；请先逐项检查正脸、侧面、背面、头身比和服装并批准，再继续视频生产`);
        recordActivity("director", `生产暂停：${pendingCharacterCards.map((item) => characterAssetNaming(item).displayName).join("、")} 的四区角色卡等待用户批准，未提交视频任务`, "warning");
        return;
      }

      const videoPropAssets = propAssets.map((item) => ({ ...item }));
      const directVideoWorkflow = agentConfigs.video.adapter !== "browser";
      if (directVideoWorkflow) {
        setPhase("characters");
        setStatusText("正在确认人物与道具资产，随后直接生成第一段视频");
        const storyboardEnvironmentKeys = [...new Set(work.map((scene) => String(scene.environmentKey || labeledVisualAssets(scene.visual, "场景")[0] || "").trim()).filter((value) => isReusableSceneAssetCandidate(value, value)))].slice(0, 30);
        const knownEnvironmentKeys = new Set(sceneAssets.flatMap((item) => [item.environmentKey, item.name]).map((value) => value.trim().toLocaleLowerCase("zh-CN")));
        const newlyDiscoveredScenes = storyboardEnvironmentKeys.filter((key) => !knownEnvironmentKeys.has(key.toLocaleLowerCase("zh-CN")));
        if (scriptImported && newlyDiscoveredScenes.length) {
          setAssetAnalysisState("ready");
          throw new Error(`分镜引用了首次全文资产清单之外的场景（${newlyDiscoveredScenes.join("、")}）；系统未建立新框架，请回到剧本分析修正后再开始视频`);
        }
        const storyboardPropNames = [...new Set(work.flatMap((scene) => labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具")))].slice(0, 24);
        const knownPropNames = new Set(videoPropAssets.map((item) => item.name.trim().toLocaleLowerCase("zh-CN")));
        const newlyDiscoveredProps = storyboardPropNames.filter((name) => !knownPropNames.has(name.trim().toLocaleLowerCase("zh-CN")));
        if (scriptImported && newlyDiscoveredProps.length) {
          const context = activeSeriesContext();
          const additions = await Promise.all(newlyDiscoveredProps.map(async (name) => {
            const saved = await saveLibraryPlaceholder({ name, category: "prop", identityKey: name, semanticDescription: "分镜结构化时发现的剧情道具，等待上传已有图片或让 AI 生成", tags: ["剧本分析", "重要道具"], projectId: context.projectId || activeAssetProjectId(), episodeId: context.episodeId, generationPrompt: `${frameVisualPrompt(style)}, production prop identity sheet for ${name}, exact shape, material, color and scale, neutral background, no person, no text` });
            return { id: uid(), libraryAssetId: saved.id, name, description: "分镜结构化时发现的剧情道具，等待补充外观、材质、尺寸和状态", importance: "story" as const, reason: "分镜分析补充发现", status: "queued" as const };
          }));
          setPropAssets((items) => [...items, ...additions]);
          setAssetAnalysisState("ready");
          throw new Error(`发现 ${newlyDiscoveredProps.length} 个新道具（${newlyDiscoveredProps.join("、")}），已在资产库建立空框；请上传或让 AI 生成后再开始视频，系统不会先画分镜图`);
        }
        const reusableProps = (await listLibraryAssets({ allProjects: true })).filter((asset) => asset.category === "prop" && asset.mediaType === "image" && asset.assetState !== "placeholder" && asset.reusable !== false);
        for (let index = 0; index < videoPropAssets.length; index += 1) {
          const prop = videoPropAssets[index];
          if (prop.imageUrl) continue;
          const normalized = prop.name.trim().toLocaleLowerCase("zh-CN");
          const reusable = reusableProps.find((asset) => `${asset.identityKey || ""} ${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized));
          if (reusable) {
            const [loaded] = await loadLibraryAssets([reusable.id]);
            if (loaded?.url) {
              videoPropAssets[index] = { ...prop, imageUrl: loaded.url, libraryAssetId: reusable.id, reviewDecision: "approved", status: "ready" };
              await markLibraryAssetUsed(reusable.id);
              continue;
            }
          }
          setStatusText(`正在生成视频所需道具资产 ${index + 1}/${videoPropAssets.length}：${prop.name}`);
          const prompt = `${frameVisualPrompt(style)}, production prop identity sheet for ${prop.name}, ${prop.description}, exact shape, material, color, scale and distinctive details, neutral background, no person, no text`;
          const referenceScene = work.find((scene) => labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").includes(prop.name)) || work[0];
          const generated = agentConfigs.image.adapter !== "horde"
            ? await pollinationsMedia("image", prompt, 240 + index, { imageAspect: "16:9" })
            : { url: await makeImage(referenceScene, 240 + index, run, "", "16:9", prompt), blob: null as Blob | null };
          const response = generated.blob ? null : await fetch(generated.url);
          const blob = generated.blob || (response?.ok ? await response.blob() : null);
          if (!blob) throw new Error(`道具“${prop.name}”已生成但无法写入资产库`);
          const file = new File([blob], `${prop.name}-道具.png`, { type: blob.type || "image/png" });
          const saved = prop.libraryAssetId
            ? await attachLibraryFileToPlaceholder(prop.libraryAssetId, file, "ai")
            : await saveLibraryFile(file, { name: prop.name, category: "prop", tags: ["自动生成", "重要道具"], identityKey: prop.name, locked: true, reusable: true });
          videoPropAssets[index] = { ...prop, imageUrl: saved.url || generated.url, remoteUrl: "remoteUrl" in generated ? String(generated.remoteUrl || "") || undefined : undefined, libraryAssetId: saved.id, reviewDecision: "pending", status: "ready" };
        }
        setPropAssets(videoPropAssets);
        const missingCharacterAssets = cast.filter((character) => isVisualCharacterAsset(character) && !character.imageUrl && !character.remoteUrl);
        if (missingCharacterAssets.length) throw new Error(`直接生成视频前仍缺少人物资产：${missingCharacterAssets.map((item) => item.name).join("、")}`);
        const missingSceneAssets = sceneAssets.filter((item) => !item.imageUrl && !item.remoteUrl);
        if (missingSceneAssets.length) throw new Error(`直接生成视频前仍缺少场景资产：${missingSceneAssets.map((item) => item.name).join("、")}`);
        const previousEpisodeVideo = await previousEpisodeVideoReference();
        if (previousEpisodeVideo && work[0]) {
          work = work.map((scene, index) => index === 0 ? { ...scene, continuityReferenceDecision: "cross-episode-video" as const, startState: `${scene.startState || ""}；参考上一集最后一个已批准分镜视频的人物位置、服装、道具和场景状态；身份优先模式不提交抽取首尾帧` } : scene);
          recordActivity("video", "已找到上一集最后一个已批准分镜视频，本集首镜将把它作为 @Video 全能参考", "done");
        } else if ((activeSeriesContext().episodeNumber || 1) > 1) {
          recordActivity("video", "本集不是第一集，但资产库中没有上一集已批准分镜视频；首镜将只引用人物、道具、场景和音色资产", "warning");
        }
        publishScenes(work);
        recordActivity("image", `已为当前任务绑定 ${cast.filter(isVisualCharacterAsset).length} 个人物、${sceneAssets.filter((item) => item.imageUrl || item.remoteUrl).length} 个 Canonical 场景和 ${videoPropAssets.filter((item) => item.imageUrl).length} 个道具资产；跳过分镜首帧图，直接进入全能参考视频；抽取首尾帧只用于质检，不送入模型`, "done");
      } else {
      setPhase("images");
      const sceneAssetReferences = new Map<string, string>();
      const propAssetReferences = new Map<string, string>();
      const environmentPlans = [...new Map(work.map((scene) => [scene.environmentKey || labeledVisualAssets(scene.visual, "场景")[0] || scene.title, scene])).entries()].slice(0, 16);
      const storyboardPropNames = [...new Set(work.flatMap((scene) => labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具")))];
      const propNames = [...new Set([...propAssets.map((item) => item.name), ...storyboardPropNames])].slice(0, 24);
      const knownPropNames = new Set(propAssets.map((item) => item.name.trim().toLocaleLowerCase()));
      const newlyDiscoveredProps = storyboardPropNames.filter((name) => !knownPropNames.has(name.trim().toLocaleLowerCase()));
      if (scriptImported && newlyDiscoveredProps.length) {
        setPropAssets((items) => [...items, ...newlyDiscoveredProps.map((name) => ({ id: uid(), name, description: "分镜结构化时发现的剧情道具，等待补充外观、材质、尺寸和状态", importance: "story" as const, reason: "分镜分析补充发现", status: "queued" as const }))]);
        setAssetAnalysisState("ready");
        throw new Error(`分镜阶段补充发现 ${newlyDiscoveredProps.length} 个道具（${newlyDiscoveredProps.join("、")}）；已建立资产卡，请先上传或生成并采用，未自动出图`);
      }
      const propUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
      for (const prop of propAssets.filter((item) => item.imageUrl)) {
        if (prop.remoteUrl) { propAssetReferences.set(prop.name, prop.remoteUrl); continue; }
        const response = await fetch(prop.imageUrl as string);
        if (!response.ok) continue;
        const blob = await response.blob();
        const reference = propUploadKey ? await uploadPollinationsMedia(blob, `prop-${prop.id}.png`, propUploadKey) : await blobToDataUrl(blob);
        propAssetReferences.set(prop.name, reference);
      }
      recordActivity("image", `生图岗位已提取 ${environmentPlans.length} 个场景资产与 ${propNames.length} 个重要道具资产`);
      const reusablePropAssets = (await listLibraryAssets()).filter((asset) => asset.category === "prop" && asset.reusable !== false).sort((a, b) => Number(b.canonical) - Number(a.canonical) || Number(b.locked) - Number(a.locked));
      for (const prop of propNames) {
        const normalized = prop.trim().toLocaleLowerCase("zh-CN");
        const existing = reusablePropAssets.find((asset) => `${asset.identityKey || ""} ${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized));
        if (!existing) continue;
        const [loaded] = await loadLibraryAssets([existing.id]);
        if (!loaded?.url) continue;
        const response = await fetch(loaded.url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const reference = propUploadKey ? await uploadPollinationsMedia(blob, `canonical-prop-${existing.id}.png`, propUploadKey) : await blobToDataUrl(blob);
        propAssetReferences.set(prop, reference);
        await markLibraryAssetUsed(existing.id);
        recordActivity("image", `重要道具“${prop}”已绑定资产库 Canonical 版本，不再重新设计`, "done");
      }
      for (let index = 0; index < environmentPlans.length; index += 1) {
        const [environmentKey, scene] = environmentPlans[index];
        const normalizedEnvironment = environmentKey.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").trim();
        const existingEnvironment = reusableProductionAssets.filter((asset) => asset.category === "scene" && asset.mediaType === "image" && asset.tags.includes("场景设定") && (asset.identityKey === `scene:${environmentKey}` || asset.tags.includes(`asset:scene:${environmentKey}`) || asset.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").includes(normalizedEnvironment))).sort((a, b) => Number(Boolean(b.canonical || b.locked)) - Number(Boolean(a.canonical || a.locked)) || b.createdAt.localeCompare(a.createdAt))[0];
        if (existingEnvironment) {
          const [loaded] = await loadLibraryAssets([existingEnvironment.id]);
          if (loaded?.url) {
            const response = await fetch(loaded.url);
            if (response.ok) {
              const blob = await response.blob();
              const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
              const reference = uploadKey ? await uploadPollinationsMedia(blob, `canonical-scene-${existingEnvironment.id}.png`, uploadKey) : await blobToDataUrl(blob);
              sceneAssetReferences.set(environmentKey, reference);
              await markLibraryAssetUsed(existingEnvironment.id);
              recordActivity("image", `场景“${environmentKey}”状态未变化，已直接复用场景资产`, "done");
              continue;
            }
          }
        }
        const prompt = `${frameVisualPrompt(style)}, environment concept sheet for ${environmentKey}, ${scene.environmentBible || scene.visual}, empty set without people and without movable important story props, lock only architecture, doors, windows, fixed furniture, weather, time of day, palette and light direction; canonical props will be composited later from separate reference assets, do not invent or redesign them, cinematic production design reference, no text`;
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", prompt, 200 + index, { imageAspect: aspect });
          const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remote = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `environment-${index + 1}.png`, uploadKey) : "";
          if (remote) sceneAssetReferences.set(environmentKey, remote);
          autoArchive(asset.url, `${projectTitle}-${environmentKey}-场景设定`, "scene", 5, ["自动生成", "场景设定", environmentKey, `asset:scene:${environmentKey}`]);
        } else {
          const imageUrl = await makeImage(scene, 200 + index, run, "", aspect, prompt);
          autoArchive(imageUrl, `${projectTitle}-${environmentKey}-场景设定`, "scene", 5, ["自动生成", "场景设定", environmentKey, `asset:scene:${environmentKey}`]);
        }
      }
      for (let index = 0; index < propNames.length; index += 1) {
        const prop = propNames[index];
        if (propAssetReferences.has(prop)) continue;
        const ownerScenes = work.filter((scene) => labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").includes(prop));
        const prompt = `${frameVisualPrompt(style)}, production prop identity sheet for ${prop}, exact shape, material, color, scale and distinctive details, front side and three-quarter reference views, neutral background, no person, no redesign, no text`;
        const referenceScene = ownerScenes[0] || work[0];
        if (!referenceScene) continue;
        if (agentConfigs.image.adapter !== "horde") {
          const asset = await pollinationsMedia("image", prompt, 240 + index, { imageAspect: "16:9" });
          const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remote = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `prop-${index + 1}.png`, uploadKey) : "";
          if (remote) propAssetReferences.set(prop, remote);
          autoArchive(asset.url, `${projectTitle}-${prop}-道具设定`, "prop", 5, ["自动生成", "重要道具", prop, `asset:prop:${prop}`]);
        } else {
          const imageUrl = await makeImage(referenceScene, 240 + index, run, "", "16:9", prompt);
          autoArchive(imageUrl, `${projectTitle}-${prop}-道具设定`, "prop", 5, ["自动生成", "重要道具", prop, `asset:prop:${prop}`]);
        }
      }
      {
      let generatedFrames = 0;
      for (let index = 0; index < work.length; index += 1) {
        const scene = work[index];
        if (agentConfigs.video.adapter === "seedance" && !scene.imageUrl && !scene.videoUrl) {
          work = work.map((item) => item.id === scene.id ? { ...item, status: "queued" as SceneStatus } : item);
          publishScenes(work);
          setProgress(26 + Math.round(((index + 1) / Math.max(1, work.length)) * 18));
          continue;
        }
        if (scene.imageUrl || scene.videoUrl) {
          work = work.map((item) => item.id === scene.id ? { ...item, status: "ready" as SceneStatus } : item);
          publishScenes(work);
          setProgress(26 + Math.round(((index + 1) / Math.max(1, work.length)) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
          continue;
        }
        const reusableFrame = await reusableSceneResult(scene);
        if (reusableFrame) {
          work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: reusableFrame.url, status: "ready" as SceneStatus } : item);
          publishScenes(work);
          setProgress(26 + Math.round(((index + 1) / Math.max(1, work.length)) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
          recordActivity("image", `“${scene.title}”人物、场景、道具、动作与机位未变化，已直接复用分镜结果`, "done");
          continue;
        }
        setStatusText(`正在制作第 ${index + 1}/${work.length} 个一致性分镜`);
        updateScene(scene.id, { status: "painting" });
        const presentCast = charactersForScene(cast, scene);
        const castForScene = presentCast;
        const characterGuide = castForScene.map((character) => `${characterAssetNaming(character).displayName}: ${character.appearance}`).join("; ");
        const previousScene = index > 0 ? work[index - 1] : undefined;
        const sameEnvironment = Boolean(previousScene && scene.environmentKey && previousScene.environmentKey === scene.environmentKey);
        const continuityGuide = sameEnvironment
          ? `Environment lock: ${scene.environmentBible || scene.visual}. Continue from the previous shot: ${previousScene?.endState || previousScene?.action}. Current continuity: ${scene.continuity || "preserve positions, directions and props"}. Keep the exact architecture, doors, windows, furniture, props, weather, time of day, color palette and light direction.`
          : `Environment definition: ${scene.environmentBible || scene.visual}. ${scene.continuity || (index === 0 ? "establish this location clearly" : "this is an intentional location or time change")}.`;
        if (agentConfigs.image.adapter !== "horde") {
          const sceneProps = labeledVisualAssets(`${scene.visual} ${scene.action} ${scene.environmentBible || ""}`, "道具");
          const framePrompt = `${frameVisualPrompt(style)}, final low-motion storyboard image, assembled from locked character identity, current costume, environment and prop references; do not redesign referenced assets. ${continuityGuide} Important props: ${sceneProps.join(", ") || "none"}. Shot: ${scene.shot}. Visual: ${scene.visual}. Action: ${scene.action}. expressive face, natural anatomy and hands, layered depth for camera motion, coherent spatial layout, no text, no speech bubbles, no panel borders`;
          const environmentReference = sceneAssetReferences.get(scene.environmentKey || labeledVisualAssets(scene.visual, "场景")[0] || scene.title);
          const characterReferences = castForScene.map((item) => item.remoteUrl || item.imageUrl).filter(Boolean) as string[];
          if (castForScene.length && characterReferences.length !== castForScene.length) throw new Error(`低动态分镜图缺少人物参考图：${castForScene.filter((item) => !item.remoteUrl && !item.imageUrl).map((item) => item.name).join("、")}；已停止生成，避免换脸或换装`);
          const references = [...characterReferences, ...sceneProps.map((prop) => propAssetReferences.get(prop)).filter(Boolean), ...(environmentReference ? [environmentReference] : []), ...(sameEnvironment && (previousScene?.remoteImageUrl || previousScene?.imageUrl) ? [previousScene.remoteImageUrl || previousScene.imageUrl] : [])].filter((value, refIndex, all) => Boolean(value) && all.indexOf(value) === refIndex) as string[];
          const frame = await pollinationsMedia("image", framePrompt, index, { references });
          const frameUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
          const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : frameUploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${index + 1}.png`, frameUploadKey) : "";
	          sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), imageReviewDecision: "pending" });
	          work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: frame.url, remoteImageUrl, imageReviewDecision: "pending" as const, status: "ready" as SceneStatus } : item);
          runtimeShotReuseRef.current.set(shotReuseIdentity(scene), frame.url);
        } else {
          const reusable = await reusableSceneResult(scene);
          if (reusable) {
            work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl: reusable.url, status: "ready" as SceneStatus } : item));
            recordActivity("image", `“${scene.title}”状态完全一致，已直接复用分镜结果，未调用生图模型`, "done");
          } else {
            const imageUrl = await makeImage(scene, index, run, `${characterGuide}; ${continuityGuide}`);
            runtimeShotReuseRef.current.set(shotReuseIdentity(scene), imageUrl);
	            sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), imageReviewDecision: "pending" });
	            work = work.map((item) => (item.id === scene.id ? { ...item, imageUrl, imageReviewDecision: "pending" as const, status: "ready" as SceneStatus } : item));
          }
        }
        let completedScene = work.find((item) => item.id === scene.id) || scene;
        let report = await evaluateShotConsistency(completedScene, completedScene.imageUrl || "", castForScene, previousScene, 1);
        const framePassesGate = () => report.mode !== "vision" || report.overall >= 85;
        if (!framePassesGate()) {
          setStatusText(`镜头 ${index + 1} 的低动态分镜图未通过质检，正在进行一次低成本修复`);
          recordActivity("image", `“${scene.title}”低动态分镜图未达到合成标准：${report.findings.join("；").slice(0, 180)}，正在修复`, "warning");
          const repairPrompt = `${frameVisualPrompt(style)}, regenerate this exact storyboard shot while correcting only visible, actionable failures: ${report.findings.join("; ")}. Canonical characters: ${characterGuide}. Match the supplied canonical face shape, facial proportions, hairstyle, age, fatigue details and costume exactly. Never add earrings, necklaces, glasses, tattoos, hair ornaments or other accessories unless explicitly present in the canonical asset or script. Locked environment: ${scene.environmentBible || scene.visual}. Preserve only environment anchors visible in this shot; do not widen or change the requested shot merely to reveal off-screen anchors. Start state that must be preserved: ${scene.startState}. Important props: ${labeledVisualAssets(`${scene.visual} ${scene.action}`, "道具").join(", ")}. Do not redesign faces, costumes, scene architecture or props. ${scene.action}, ${scene.camera}, no text`;
          const repairedUrl = await makeImage(scene, 500 + index, run, characterGuide, aspect, repairPrompt);
          completedScene = { ...completedScene, imageUrl: repairedUrl, remoteImageUrl: undefined };
          report = await evaluateShotConsistency(completedScene, repairedUrl, castForScene, previousScene, 2);
          work = work.map((item) => item.id === scene.id ? completedScene : item);
        }
        if (!framePassesGate()) {
          report = { ...report, decision: "review", findings: [...report.findings, "已加入逐项审核队列；生产继续运行，不再阻塞等待全部资产。"] };
          recordActivity("image", `“${scene.title}”未通过自动质检，已立即进入逐项审核队列；其他素材继续生成`, "warning");
        }
        const finalDecision = report.mode === "structural" && report.decision === "reject" ? "review" : report.decision;
        work = work.map((item) => item.id === scene.id ? { ...item, imageReviewDecision: "pending" as const, consistencyReport: { ...report, decision: finalDecision }, consistencyDecision: finalDecision, status: "ready" as SceneStatus } : item);
        generatedFrames += 1;
          publishScenes(work);
        setProgress(26 + Math.round(((index + 1) / work.length) * (agentConfigs.video.adapter !== "browser" ? 18 : 48)));
      }
      recordActivity("image", `${work.length - generatedFrames} 个用户画面/视频已复用，${generatedFrames} 张缺失画面已生成`, "done");
      }
      }

      if (agentConfigs.video.adapter !== "browser") {
        const videoPreflight = await preflightReusableVideoAssets(work, cast);
        cast = videoPreflight.cast;
        publishCharacters(cast);
        setPhase("video");
        activeRole = "video";
        recordActivity("video", `${agentName("video")}开始使用人物、道具、场景、音色和上一镜已批准视频进行全能参考生成；抽帧只用于质检，不作为生成输入`);
        let generatedClips = 0;
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          if (scene.candidateVideoUrl && scene.videoReviewDecision === "pending") {
            setPhase("ready");
            setStatusText(`请先审核第 ${index + 1} 个分镜“${scene.title}”；批准或按评分原因修改后，才会生成下一镜`);
            setSelected(index);
            return;
          }
          if (scene.videoUrl) {
            work = work.map((item) => item.id === scene.id ? { ...item, status: "ready" as SceneStatus } : item);
          publishScenes(work);
            setProgress(44 + Math.round(((index + 1) / Math.max(1, work.length)) * 26));
            continue;
          }
          setStatusText(`正在直接生成分镜视频 ${index + 1}/${work.length}：${scene.action}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
          publishScenes(work);
          const previousScene = index > 0 ? work[index - 1] : undefined;
          try {
            const { clip, durableCandidate, inspection } = await generateInspectedVideoWithOneRepair(scene, index, previousScene, cast, videoPropAssets);
            if (!inspection.accepted) {
              const message = `五点视频一致性检查仅 ${inspection.report.overall} 分或存在单项硬失败，已拒绝进入资产库和成片`;
	              sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), videoReviewDecision: "pending" });
	              work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: undefined, remoteVideoUrl: undefined, candidateVideoUrl: durableCandidate.url, candidateVideoAssetId: durableCandidate.id, videoReviewDecision: "pending" as const, consistencyReport: inspection.report, consistencyDecision: "reject" as const, status: "error" as SceneStatus, errorMessage: message } : item);
              publishScenes(work);
              recordActivity("video", `“${scene.title}”${message}`, "warning");
              setSelected(index);
              setPhase("ready");
              setProgress(44 + Math.round(((index + 1) / work.length) * 26));
              setStatusText(`第 ${index + 1} 个分镜未通过质检，请按评分原因修改；修改合格或人工批准后才会生成下一镜`);
              return;
            }
	            sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), videoReviewDecision: "pending" });
	            work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: undefined, remoteVideoUrl: "remoteUrl" in clip ? String(clip.remoteUrl || "") || undefined : undefined, candidateVideoUrl: durableCandidate.url, candidateVideoAssetId: durableCandidate.id, videoReviewDecision: "pending" as const, videoPosterUrl: inspection.frames.middle || item.videoPosterUrl, remoteImageUrl: undefined, videoStartFrameUrl: inspection.frames.start, videoEndFrameUrl: inspection.frames.end, tailFrameAssetId: undefined, continuityReferenceDecision: index > 0 ? "previous-video" as const : "asset-only" as const, consistencyReport: inspection.report, consistencyDecision: "pass" as const, duration: Math.max(4, Math.min(15, scene.duration)), status: "ready" as SceneStatus, errorMessage: undefined } : item);
            generatedClips += 1;
          publishScenes(work);
            setSelected(index);
            setPhase("ready");
            setProgress(44 + Math.round(((index + 1) / work.length) * 26));
            setStatusText(`第 ${index + 1} 个分镜已生成，请立即审核；批准或修改完成后才会生成第 ${index + 2} 镜`);
            recordActivity("director", `生产已暂停在“${scene.title}”等待逐镜审核，尚未生成后续镜头`, "warning");
            return;
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : "视频模型没有返回结果";
            work = work.map((item) => item.id === scene.id ? { ...item, status: "error" as SceneStatus, errorMessage: message } : item);
          publishScenes(work);
            setSelected(index);
            setPhase("ready");
            setStatusText(`第 ${index + 1} 个分镜生成失败，请修改或重试；后续镜头尚未生成`);
            recordActivity("video", `“${scene.title}”生成失败，生产已暂停且没有跳过到后续镜头：${message}`, "warning");
            return;
          }
          setProgress(44 + Math.round(((index + 1) / work.length) * 26));
        }
        recordActivity("video", `${work.length - generatedClips} 个用户视频已复用，${generatedClips} 个缺失动态镜头已生成`, "done");
      } else {
        recordActivity("video", "免费模式使用 2.5D 运镜、景深和光影动画，不包含人物肢体生成", "warning");
      }

      if (voiceEnabled && agentConfigs.voice.adapter !== "browser" && agentConfigs.video.adapter !== "seedance") {
        setPhase("voice");
        activeRole = "voice";
        recordActivity("voice", `${agentName("voice")}开始逐镜生成角色配音`);
        let generatedVoices = 0;
        for (let index = 0; index < work.length; index += 1) {
          const scene = work[index];
          if (scene.audioUrl || !scene.dialogue.trim()) {
            setProgress(70 + Math.round(((index + 1) / Math.max(1, work.length)) * 13));
            continue;
          }
          setStatusText(`正在生成 ${scene.speaker} 的${scene.emotion}配音 ${index + 1}/${work.length}`);
          updateScene(scene.id, { status: "voicing" });
          const castVoice = cast.find((character) => character.name === scene.speaker)?.voice || voice;
          const reusedVoice = await reusableVoiceResult(scene, castVoice);
          if (reusedVoice) {
            rememberCanonicalVoiceAudio(scene, reusedVoice.url);
            work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: reusedVoice.url, duration: Math.max(item.duration, Math.ceil(reusedVoice.duration + 0.6)), status: "ready" as SceneStatus } : item);
          publishScenes(work);
            recordActivity("voice", `“${scene.title}”台词、角色与音色未变化，已直接复用声音资产`, "done");
            continue;
          }
          const voiceReference = await voiceReferenceForScene(scene);
          const speech = await pollinationsMedia("audio", scene.dialogue, index, { voiceName: castVoice, references: voiceReference ? [voiceReference] : [], referenceText: voiceReference?.referenceText });
          const audioSeconds = await mediaDuration(speech.url);
          rememberCanonicalVoiceAudio(scene, speech.url);
          await persistCanonicalVoiceProfile(scene, speech.blob, audioSeconds, castVoice);
          runtimeVoiceReuseRef.current.set(voiceReuseIdentity(scene, castVoice), { url: speech.url, duration: audioSeconds });
	          sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), audioReviewDecision: "pending" });
	          work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: speech.url, audioReviewDecision: "pending" as const, duration: Math.max(item.duration, Math.ceil(audioSeconds + 0.6)), status: "ready" as SceneStatus } : item);
          generatedVoices += 1;
          publishScenes(work);
          setProgress(70 + Math.round(((index + 1) / work.length) * 13));
        }
        recordActivity("voice", `${work.filter((item) => item.audioUrl).length - generatedVoices} 条用户音轨已复用，${generatedVoices} 条缺失配音已生成`, "done");
      } else if (voiceEnabled && agentConfigs.video.adapter === "seedance") {
        recordActivity("voice", "Seedance 已在每段视频中直接生成人物对白；不再叠加独立 TTS，首条人物对白已用于建立后续镜头音色参考", "done");
      } else if (voiceEnabled) {
        recordActivity("voice", "免费模式使用设备中文语音预览，不会写入可下载音轨", "warning");
      } else {
        recordActivity("voice", "用户已关闭自动配音", "warning");
      }

      if (lipsyncEnabled) {
        const eligible = work.filter((scene) => scene.audioUrl && (scene.videoUrl || scene.imageUrl));
        if (!eligible.length) {
          recordActivity("video", "已启用 MuseTalk，但当前没有可用的生成配音；跳过口型增强", "warning");
        } else {
          try {
            setPhase("video");
            activeRole = "video";
            recordActivity("video", `MuseTalk 开始为 ${eligible.length} 个镜头生成中文口型`);
            for (let index = 0; index < eligible.length; index += 1) {
              const scene = eligible[index];
              setStatusText(`MuseTalk 正在生成口型 ${index + 1}/${eligible.length}：${scene.title}`);
              work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
          publishScenes(work);
              const lipVideo = await createLipSyncedVideo(scene);
              if (lipVideo) {
                if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
	                sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), videoReviewDecision: "pending" });
	                work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: undefined, candidateVideoUrl: lipVideo, videoReviewDecision: "pending" as const, status: "ready" as SceneStatus, model: "MuseTalk 1.5" } : item);
          publishScenes(work);
              }
            }
            recordActivity("video", "MuseTalk 口型增强已完成", "done");
          } catch (reason) {
            work = work.map((item) => item.status === "animating" ? { ...item, status: "ready" as SceneStatus } : item);
          publishScenes(work);
            recordActivity("video", reason instanceof Error ? `口型增强跳过：${reason.message}` : "口型增强暂时不可用", "warning");
          }
        }
      }

      let generatedMusicUrl = "";
      if (bgmEnabled && agentConfigs.voice.adapter !== "browser") {
        setPhase("music");
        activeRole = "voice";
        setStatusText("正在生成与剧情节奏匹配的无歌词配乐");
        const soundtrack = await pollinationsMedia("audio", storyboard.music, 0, { music: true, duration: work.reduce((sum, item) => sum + item.duration, 0) });
        generatedMusicUrl = soundtrack.url;
        setMusicUrl(soundtrack.url);
        setMusicReviewDecision("pending");
      }
      const reviewedCast = cast.map((item) => ({ ...item, ...(characterReviewPatchesRef.current.get(item.id) || {}) }));
      const reviewedWork = work.map((item) => ({ ...item, ...(sceneReviewPatchesRef.current.get(item.id) || {}) }));
      publishCharacters(reviewedCast);
      publishScenes(reviewedWork);
      const pendingReviewTotal = reviewedCast.filter((item) => item.imageUrl && item.reviewDecision === "pending").length
        + reviewedWork.filter((item) => item.imageUrl && item.imageReviewDecision === "pending").length
        + reviewedWork.filter((item) => item.candidateVideoUrl && item.videoReviewDecision === "pending").length
        + reviewedWork.filter((item) => item.audioUrl && item.audioReviewDecision === "pending").length
        + (generatedMusicUrl ? 1 : 0);
      if (pendingReviewTotal > 0) {
        setPhase("ready");
        setProgress(92);
        setStatusText(`素材已全部生成，仍有 ${pendingReviewTotal} 项等待逐项审核；审核期间生产没有被阻塞`);
        recordActivity("editor", `等待用户完成 ${pendingReviewTotal} 项逐项审核，批准后即可合成成片`, "warning");
        return;
      }
      work = reviewedWork;
      activeRole = "editor";
      recordActivity("editor", `${agentName("editor")}开始调整顺序、节奏、字幕和混音`);
      work = await applyEditorPlan(work);
          publishScenes(work);
      setProgress(88);
      setStatusText(agentConfigs.video.adapter !== "browser" ? "AI 制片组已完成素材，正在合成最终漫剧" : "免费制片组已完成，正在生成低动态样片");
      const exported = await exportFilm(work, true, generatedMusicUrl);
      if (!exported) return;
      recordActivity("editor", "剪辑完成，成片和全部中间素材均可下载", "done");
    } catch (reason) {
      if (runRef.current !== run) return;
      setPhase("error");
      const portraitBlocked = await registerSeedancePortraitBlock(reason, scenes[selected]?.id || "");
      if (!portraitBlocked) setError(reason instanceof Error ? reason.message : "生成失败，请重试");
      setStatusText("生成中断");
      recordActivity(activeRole, reason instanceof Error ? `制作中断：${reason.message}` : "制作中断", "error");
    }
  }

  function cancelGeneration() {
    runRef.current = Date.now();
    seedanceRequestControllerRef.current?.abort();
    seedanceRequestControllerRef.current = null;
    sceneActionRef.current = "";
    setSceneAction(null);
    setLibtvRunning(false);
    setRetryingRole(null);
    setPhase(scenes.length ? "ready" : "idle");
    setStatusText("已停止当前任务");
  }

  function roleConnectionProblem(role: AgentRole) {
    const config = agentConfigs[role];
    if (config.adapter === "pollinations" && !agentKey(role).startsWith("pk_")) return `${AGENT_ROLES.find((item) => item.id === role)?.title}需要填写 Pollinations 发布密钥`;
    if (config.adapter === "seedance" && config.apiKey.trim().length < 8) return "视频 AI 需要填写火山方舟 API Key";
    if (CUSTOM_TEXT_ADAPTERS.includes(config.adapter) && !validAgentEndpoint(config.endpoint)) return `${AGENT_ROLES.find((item) => item.id === role)?.title}需要填写 HTTPS API 地址或本机 localhost 地址`;
    return "";
  }

  function canRerunRole(role: AgentRole) {
    if (role === "writer") return story.trim().length >= 8;
    if (role === "director" || role === "image" || role === "voice") return scenes.length > 0;
    if (role === "video") return scenes.length > 0 && !activePortraitBlock && (agentConfigs.video.adapter !== "browser" || scenes.some((scene) => scene.imageUrl));
    return scenes.some((scene) => scene.imageUrl || scene.videoUrl);
  }

  function openTrustedPortraitCenter() {
    const blocked = activePortraitBlock?.blockedReferences.map((item) => item.libraryAssetId || item.identityKey).filter(Boolean).join(",") || "";
    router.push(`/assets?trusted=1&project=${encodeURIComponent(activeAssetProjectId())}&blocked=${encodeURIComponent(blocked)}`);
  }

  async function rerunRole(role: AgentRole) {
    if (retryingRole || busy || !canRerunRole(role)) return;
    const connectionProblem = roleConnectionProblem(role);
    if (connectionProblem) {
      setConfiguringRole(role);
      setError(connectionProblem);
      return;
    }
    const run = Date.now();
    runRef.current = run;
    setRetryingRole(role);
    setError("");
    setPlaying(false);
    setShowFilm(false);
    recordActivity(role, `${agentName(role)}正在从上次中断处重新运行`);
    try {
      if (role === "writer") {
        setPhase("story");
        setProgress(5);
        setStatusText("编剧 AI 正在重新生成剧本与分镜");
        const raw = await generateStoryboard(run);
        let next: Storyboard;
        try {
          next = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8);
        } catch (reason) {
          if (agentConfigs.writer.adapter !== "horde") throw reason;
          let partial: Storyboard | null = null;
          try { partial = parseStoryboard(raw, productionDuration, sceneCountForDuration(productionDuration), 8); } catch { partial = null; }
          next = completeFreeStoryboard(partial, story.trim(), style, productionDuration);
        }
        invalidateExport();
        setMusicUrl("");
        setProjectTitle(next.title);
        setMusicPrompt(next.music);
        setCharacters(next.characters);
        setScenes(assignSpatialLayouts(next.scenes));
        setSelected(0);
        setProgress(15);
        recordActivity("writer", `新剧本与 ${next.scenes.length} 个分镜已交付`, "done");
        (["director", "image", "video", "voice", "editor"] as AgentRole[]).forEach((downstream) => recordActivity(downstream, "上游剧本已更新，等待按需重新运行", "warning"));
        setStatusText("编剧已重新交付；可继续运行导演或其他岗位");
        setPhase("ready");
        return;
      }

      if (role === "director") {
        setPhase("story");
        setProgress(Math.max(10, progress));
        setStatusText("导演 AI 正在重新复核当前剧本与分镜");
        const reviewedRaw = await directorReview(storyboardDraft(projectTitle, musicPrompt, characters, scenes), run);
        const reviewed = mergeReviewedStoryboard(parseStoryboard(reviewedRaw, productionDuration, sceneCountForDuration(productionDuration), 8), characters, scenes);
        invalidateExport();
        setProjectTitle(reviewed.title);
        setMusicPrompt(reviewed.music);
        setCharacters(reviewed.characters);
        setScenes(assignSpatialLayouts(reviewed.scenes));
        recordActivity("director", "导演复核已重新交付，现有图片、视频和配音均已保留", "done");
        recordActivity("image", "导演稿已更新，现有素材已保留；如画面不匹配可重新运行生图岗位", "warning");
        setStatusText("导演复核完成，现有素材没有被清空");
        setPhase("ready");
        return;
      }

      if (role === "image") {
        setPhase("images");
        let cast = characters.map((character) => ({ ...character }));
        let work = scenes.map((scene) => ({ ...scene }));
        const paired = await pairExistingBlueprintAssets(cast, propAssets, sceneAssets, { allowCharacterLookCandidates: true });
        cast = paired.characters;
        setPropAssets(paired.props);
        setSceneAssets(paired.scenes);
        // Any visible user/library image is already an accepted character asset.
        // Legacy assets may not carry sheetVersion; metadata age must never trigger
        // a paid regeneration when the actual image is present.
        const missingCharacters = cast.filter((character) => isVisualCharacterAsset(character) && !character.imageUrl);
        for (let targetIndex = 0; targetIndex < missingCharacters.length; targetIndex += 1) {
          const character = missingCharacters[targetIndex];
          setStatusText(`生图 AI 正在补跑角色资产 ${targetIndex + 1}/${missingCharacters.length}：${character.name}`);
          cast = cast.map((item) => item.id === character.id ? { ...item, status: "generating" as const } : item);
	          publishCharacters(cast);
          const characterRequest = await characterGenerationRequest(character, cast);
          const prompt = characterRequest.prompt;
          if (agentConfigs.image.adapter !== "horde") {
            const asset = await pollinationsMedia("image", prompt, 50 + targetIndex, { imageAspect: "16:9", imagePurpose: "character-card", references: characterRequest.references });
            const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
            const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `character-retry-${targetIndex + 1}.png`, uploadKey) : "";
	            characterReviewPatchesRef.current.set(character.id, { reviewDecision: "pending" });
	            cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl: asset.url, remoteUrl, sheetVersion: 3 as const, reviewDecision: "pending" as const, status: "ready" as const } : item);
          } else {
            const referenceScene: Scene = { id: uid(), title: character.name, visual: prompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
            const imageUrl = await makeImage(referenceScene, 50 + targetIndex, run, "", "16:9", prompt, characterRequest.references, "character-card");
	            characterReviewPatchesRef.current.set(character.id, { reviewDecision: "pending" });
	            cast = cast.map((item) => item.id === character.id ? { ...item, imageUrl, sheetVersion: 3 as const, reviewDecision: "pending" as const, status: "ready" as const } : item);
          }
	          const generatedCharacter = cast.find((item) => item.id === character.id);
	          if (generatedCharacter?.imageUrl) {
	            const referenceCardReport = await evaluateCharacterReferenceCard(generatedCharacter, generatedCharacter.imageUrl);
	            characterReviewPatchesRef.current.set(character.id, { ...(characterReviewPatchesRef.current.get(character.id) || {}), referenceCardReport, reviewDecision: "pending" });
	            cast = cast.map((item) => item.id === character.id ? { ...item, referenceCardReport } : item);
	          }
	          publishCharacters(cast);
        }
        let targets = agentConfigs.video.adapter === "browser" ? work.filter((scene) => !scene.imageUrl || scene.status === "error").map((scene) => scene.id) : [];
        if (agentConfigs.video.adapter === "browser" && !targets.length && work[selected]) targets = [work[selected].id];
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const sceneIndex = work.findIndex((scene) => scene.id === targets[targetIndex]);
          const scene = work[sceneIndex];
          if (!scene) continue;
          setStatusText(`生图 AI 正在补跑分镜 ${targetIndex + 1}/${targets.length}：${scene.title}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "painting" as SceneStatus } : item);
          publishScenes(work);
          const presentCast = charactersForScene(cast, scene);
          const castForScene = presentCast.length ? presentCast : cast.slice(0, 2);
          if (agentConfigs.image.adapter !== "horde") {
            const prompt = `${frameVisualPrompt(style)}, one coherent scene, exact identities and costumes from references, ${scene.shot}, ${scene.visual}, ${scene.action}, expressive face, natural anatomy and hands, layered depth, no text, no speech bubbles, no panel borders`;
            const frame = await pollinationsMedia("image", prompt, sceneIndex, { references: castForScene.map((item) => item.remoteUrl || item.imageUrl).filter(Boolean) as string[] });
            const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
            const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : uploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${sceneIndex + 1}-retry.png`, uploadKey) : "";
            if (scene.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.imageUrl);
            if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
	            sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), imageReviewDecision: "pending", videoReviewDecision: "rejected" });
	            work = work.map((item) => item.id === scene.id ? { ...item, imageUrl: frame.url, remoteImageUrl, videoUrl: undefined, candidateVideoUrl: undefined, imageReviewDecision: "pending" as const, videoReviewDecision: "rejected" as const, status: "ready" as SceneStatus } : item);
          } else {
            const characterGuide = castForScene.map((character) => `${characterAssetNaming(character).displayName}: ${character.appearance}`).join("; ");
            const imageUrl = await makeImage(scene, sceneIndex, run, characterGuide);
            if (scene.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.imageUrl);
            if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
	            sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), imageReviewDecision: "pending", videoReviewDecision: "rejected" });
	            work = work.map((item) => item.id === scene.id ? { ...item, imageUrl, videoUrl: undefined, candidateVideoUrl: undefined, imageReviewDecision: "pending" as const, videoReviewDecision: "rejected" as const, status: "ready" as SceneStatus } : item);
          }
          publishScenes(work);
          setProgress(26 + Math.round(((targetIndex + 1) / targets.length) * 18));
        }
        invalidateExport();
        recordActivity("image", agentConfigs.video.adapter === "browser" ? `生图岗位补跑完成：${missingCharacters.length} 个角色、${targets.length} 个分镜` : `生图岗位只补齐了 ${missingCharacters.length} 个人物资产；原生视频流程保持全能参考、不送首尾帧`, "done");
        setStatusText(agentConfigs.video.adapter === "browser" ? "生图岗位重新运行完成，其他已完成素材保持不变" : "人物资产检查完成；未生成或提交任何镜头首尾帧");
        setPhase("ready");
        return;
      }

      if (role === "video") {
        if (agentConfigs.video.adapter === "browser") {
          recordActivity("video", "本地 2.5D 运镜无需排队；重新合成时会自动应用", "warning");
          setStatusText("本地运镜已就绪，可重新运行剪辑岗位合成成片");
          setPhase("ready");
          return;
        }
        setPhase("video");
        let work = scenes.map((scene) => ({ ...scene }));
        const videoPreflight = await preflightReusableVideoAssets(work, characters);
        const preparedCharacters = videoPreflight.cast;
        const sequentialPlan = planSequentialVideo(work);
        if (sequentialPlan.kind === "review") {
          setSelected(sequentialPlan.index);
          setStatusText(`请先审核第 ${sequentialPlan.index + 1} 个分镜，批准或修改后再生成下一镜`);
          setPhase("ready");
          return;
        }
        let targets = sequentialPlan.kind === "generate" ? [sequentialPlan.sceneId] : [];
        if (sequentialPlan.kind === "complete") {
          const fallback = work[selected] || work[0];
          if (fallback) targets = [fallback.id];
        }
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const sceneIndex = work.findIndex((scene) => scene.id === targets[targetIndex]);
          const scene = work[sceneIndex];
          if (!scene) continue;
          setStatusText(`视频 AI 正在补跑动态镜头 ${targetIndex + 1}/${targets.length}：${scene.title}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "animating" as SceneStatus } : item);
          publishScenes(work);
          const previousScene = sceneIndex > 0 ? work[sceneIndex - 1] : undefined;
          const { clip, durableCandidate, inspection } = await generateInspectedVideoWithOneRepair(scene, sceneIndex, previousScene, preparedCharacters, propAssets);
          if (!inspection.accepted) {
            const message = `五点视频一致性检查仅 ${inspection.report.overall} 分或存在单项硬失败，补跑结果已拒绝`;
	            sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), videoReviewDecision: "pending" });
	            work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: undefined, remoteVideoUrl: undefined, candidateVideoUrl: durableCandidate.url, candidateVideoAssetId: durableCandidate.id, videoReviewDecision: "pending" as const, consistencyReport: inspection.report, consistencyDecision: "reject" as const, status: "error" as SceneStatus, errorMessage: message } : item);
            publishScenes(work);
            recordActivity("video", `“${scene.title}”${message}`, "warning");
            setSelected(sceneIndex);
            setStatusText(`“${scene.title}”未通过质检，请先按原因修改`);
            setPhase("ready");
            return;
          }

          if (scene.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.videoUrl);
	          sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), videoReviewDecision: "pending" });
	          work = work.map((item) => item.id === scene.id ? { ...item, videoUrl: undefined, remoteVideoUrl: "remoteUrl" in clip ? String(clip.remoteUrl || "") || undefined : undefined, candidateVideoUrl: durableCandidate.url, candidateVideoAssetId: durableCandidate.id, videoReviewDecision: "pending" as const, videoPosterUrl: inspection.frames.middle || item.videoPosterUrl, remoteImageUrl: undefined, videoStartFrameUrl: inspection.frames.start, videoEndFrameUrl: inspection.frames.end, tailFrameAssetId: undefined, continuityReferenceDecision: sceneIndex > 0 ? "previous-video" as const : "asset-only" as const, consistencyReport: inspection.report, consistencyDecision: "pass" as const, duration: Math.max(4, Math.min(15, scene.duration)), status: "ready" as SceneStatus, errorMessage: undefined } : item);
          publishScenes(work);
          setSelected(sceneIndex);
          setStatusText(`“${scene.title}”已生成，请审核后再继续下一镜`);
          setProgress(44 + Math.round(((targetIndex + 1) / targets.length) * 26));
          setPhase("ready");
          return;
        }
        invalidateExport();
        recordActivity("video", `视频岗位补跑完成：${targets.length} 个动态镜头`, "done");
        setStatusText("视频岗位重新运行完成，已有图片和配音均已保留");
        setPhase("ready");
        return;
      }

      if (role === "voice") {
        if (!voiceEnabled) throw new Error("请先打开自动配音开关");
        if (agentConfigs.voice.adapter === "browser") {
          recordActivity("voice", "系统中文语音会在播放时即时朗读，无需云端重跑", "warning");
          setStatusText("设备语音已就绪；它不会生成可下载音轨");
          setPhase("ready");
          return;
        }
        setPhase("voice");
        let work = scenes.map((scene) => ({ ...scene }));
        let targets = work.filter((scene) => scene.dialogue.trim() && (!scene.audioUrl || scene.status === "error")).map((scene) => scene.id);
        if (!targets.length) {
          const fallback = work[selected]?.dialogue.trim() ? work[selected] : work.find((scene) => scene.dialogue.trim());
          if (fallback) targets = [fallback.id];
        }
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const sceneIndex = work.findIndex((scene) => scene.id === targets[targetIndex]);
          const scene = work[sceneIndex];
          if (!scene) continue;
          setStatusText(`配音 AI 正在补跑角色音轨 ${targetIndex + 1}/${targets.length}：${scene.speaker}`);
          work = work.map((item) => item.id === scene.id ? { ...item, status: "voicing" as SceneStatus } : item);
          publishScenes(work);
          const castVoice = characters.find((character) => character.name === scene.speaker)?.voice || voice;
          const reusedVoice = await reusableVoiceResult(scene, castVoice);
          if (reusedVoice) {
            rememberCanonicalVoiceAudio(scene, reusedVoice.url);
            work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: reusedVoice.url, duration: Math.max(item.duration, Math.ceil(reusedVoice.duration + 0.6)), status: "ready" as SceneStatus } : item);
          publishScenes(work);
            recordActivity("voice", `“${scene.title}”已直接复用角色声音资产`, "done");
            continue;
          }
          const voiceReference = await voiceReferenceForScene(scene);
          const speech = await pollinationsMedia("audio", scene.dialogue, sceneIndex, { voiceName: castVoice, references: voiceReference ? [voiceReference] : [], referenceText: voiceReference?.referenceText });
          const audioSeconds = await mediaDuration(speech.url);
          rememberCanonicalVoiceAudio(scene, speech.url);
          await persistCanonicalVoiceProfile(scene, speech.blob, audioSeconds, castVoice);
          runtimeVoiceReuseRef.current.set(voiceReuseIdentity(scene, castVoice), { url: speech.url, duration: audioSeconds });
          if (scene.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(scene.audioUrl);
	          sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), audioReviewDecision: "pending" });
	          work = work.map((item) => item.id === scene.id ? { ...item, audioUrl: speech.url, audioReviewDecision: "pending" as const, duration: Math.max(item.duration, Math.ceil(audioSeconds + 0.6)), status: "ready" as SceneStatus } : item);
          publishScenes(work);
          setProgress(70 + Math.round(((targetIndex + 1) / targets.length) * 13));
        }
        if (bgmEnabled && !musicUrl) {
          setStatusText("声音岗位正在补跑剧情配乐");
          const soundtrack = await pollinationsMedia("audio", musicPrompt || "cinematic instrumental soundtrack, no vocals", 0, { music: true, duration: work.reduce((sum, scene) => sum + scene.duration, 0) });
          setMusicUrl(soundtrack.url);
          setMusicReviewDecision("pending");
        }
        invalidateExport();
        recordActivity("voice", `配音岗位补跑完成：${targets.length} 条角色音轨${bgmEnabled ? "，配乐已检查" : ""}`, "done");
        setStatusText("配音岗位重新运行完成，已有画面和视频均已保留");
        setPhase("ready");
        return;
      }

      setPhase("exporting");
      setStatusText("剪辑 AI 正在重新分析节奏并合成成片");
      const edited = await applyEditorPlan(scenes.map((scene) => ({ ...scene })));
      setScenes(assignSpatialLayouts(edited));
      const exported = await exportFilm(edited, true, musicUrl);
      if (!exported) throw new Error("剪辑合成未完成");
      recordActivity("editor", "剪辑岗位重新运行完成，新的成片已交付", "done");
    } catch (reason) {
      if (runRef.current !== run) return;
      if (role === "image") {
        setCharacters((items) => items.map((item) => item.status === "generating" ? { ...item, status: "error" as const } : item));
        setScenes((items) => items.map((item) => item.status === "painting" ? { ...item, status: "error" as SceneStatus } : item));
      }
      if (role === "video") setScenes((items) => items.map((item) => item.status === "animating" ? { ...item, status: "error" as SceneStatus } : item));
      if (role === "voice") setScenes((items) => items.map((item) => item.status === "voicing" ? { ...item, status: "error" as SceneStatus } : item));
      const message = reason instanceof Error ? reason.message : `${AGENT_ROLES.find((item) => item.id === role)?.title}重新运行失败`;
      setPhase("error");
      const portraitBlocked = role === "video" && await registerSeedancePortraitBlock(reason, scenes[selected]?.id || "");
      if (!portraitBlocked) setError(message);
      setStatusText(`${AGENT_ROLES.find((item) => item.id === role)?.title}重新运行中断`);
      recordActivity(role, `重新运行中断：${message}`, "error");
    } finally {
      setRetryingRole(null);
    }
  }

  async function regenerateImage(scene: Scene, index: number) {
    if (sceneActionRef.current) return;
    if (agentConfigs.image.adapter === "pollinations" && !agentKey("image").startsWith("pk_")) {
      setError("生图 AI 需要先填写发布密钥");
      return;
    }
    if (agentConfigs.image.adapter === "webhook" && !validAgentEndpoint(agentConfigs.image.endpoint)) {
      setConfiguringRole("image");
      setError("请先配置生图 AI 的 Webhook");
      return;
    }
    const run = Date.now();
    const actionId = `image:${scene.id}`;
    sceneActionRef.current = actionId;
    setSceneAction({ id: scene.id, type: "image" });
    runRef.current = run;
    setError("");
    updateScene(scene.id, { status: "painting", preflightOverride: undefined, consistencyDecision: undefined, consistencyReport: undefined, errorMessage: undefined });
    recordActivity("image", `${agentName("image")}正在重绘“${scene.title}”`);
    try {
      if (scene.imageUrl) URL.revokeObjectURL(scene.imageUrl);
      if (agentConfigs.image.adapter !== "horde") {
        const presentCast = charactersForScene(characters, scene).filter(isVisualCharacterAsset);
        const frame = await pollinationsMedia("image", `${frameVisualPrompt(style)}, one coherent scene, preserve the exact identities and costumes from references, ${scene.shot}, ${scene.visual}, ${scene.action}, expressive face, natural anatomy and hands, layered depth, no text, no speech bubbles, no panel borders`, index, { references: presentCast.map((item) => item.remoteUrl).filter(Boolean) as string[] });
        const revisionUploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
        const remoteImageUrl = "remoteUrl" in frame && frame.remoteUrl ? frame.remoteUrl : revisionUploadKey ? await uploadPollinationsMedia(frame.blob, `scene-${index + 1}-revision.png`, revisionUploadKey) : "";
        sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), imageReviewDecision: "pending", videoReviewDecision: "rejected" });
        patchSceneReview(scene.id, { imageUrl: frame.url, remoteImageUrl, videoUrl: undefined, candidateVideoUrl: undefined, imageReviewDecision: "pending", videoReviewDecision: "rejected", status: "ready" });
      } else {
        const characterGuide = charactersForScene(characters, scene).filter(isVisualCharacterAsset).map((character) => `${characterAssetNaming(character).displayName}: ${character.appearance}`).join("; ");
        const imageUrl = await makeImage(scene, index, run, characterGuide);
        sceneReviewPatchesRef.current.set(scene.id, { ...(sceneReviewPatchesRef.current.get(scene.id) || {}), imageReviewDecision: "pending", videoReviewDecision: "rejected" });
        patchSceneReview(scene.id, { imageUrl, videoUrl: undefined, candidateVideoUrl: undefined, imageReviewDecision: "pending", videoReviewDecision: "rejected", status: "ready" });
      }
      recordActivity("image", `“${scene.title}”的新画面已交付`, "done");
    } catch (reason) {
      updateScene(scene.id, { status: "error" });
      setError(reason instanceof Error ? reason.message : "画面生成失败");
      recordActivity("image", `“${scene.title}”重绘失败`, "error");
    } finally {
      if (sceneActionRef.current === actionId) {
        sceneActionRef.current = "";
        setSceneAction(null);
      }
    }
  }

  async function generateVideo(scene: Scene) {
    if (sceneActionRef.current) return;
    if (agentConfigs.video.adapter === "browser") {
      setConfiguringRole("video");
      setError("当前是免费本地运镜样片，请为视频 AI 选择 Seedance 或自定义视频接口");
      return;
    }
    if (agentConfigs.video.adapter === "pollinations" && !agentKey("video").startsWith("pk_")) {
      setError("视频 AI 需要发布密钥");
      return;
    }
    if (agentConfigs.video.adapter === "seedance" && agentConfigs.video.apiKey.trim().length < 8) {
      setConfiguringRole("video");
      setError("即梦 Seedance 需要火山方舟 API Key");
      return;
    }
    if (agentConfigs.video.adapter === "webhook" && !validAgentEndpoint(agentConfigs.video.endpoint)) {
      setConfiguringRole("video");
      setError("请先配置视频 AI 的 Webhook");
      return;
    }
    const actionId = `video:${scene.id}`;
    const actionRun = runRef.current;
    const previousCandidateUrl = scene.candidateVideoUrl;
    sceneActionRef.current = actionId;
    setSceneAction({ id: scene.id, type: "video" });
    setError("");
    // Keep the last candidate playable until its replacement succeeds.
    updateScene(scene.id, { status: "animating" });
    recordActivity("video", `${agentName("video")}正在重做“${scene.title}”的动态表演`);
    try {
      const videoPreflight = await preflightReusableVideoAssets(scenes.length ? scenes : [scene], characters);
      const preparedCharacters = videoPreflight.cast;
      const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
      const previousScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : undefined;
      const { clip, durableCandidate, inspection } = await generateInspectedVideoWithOneRepair(scene, Math.max(0, sceneIndex), previousScene, preparedCharacters, propAssets);
      if (!inspection.accepted) {
        patchSceneReview(scene.id, { videoUrl: undefined, remoteVideoUrl: undefined, candidateVideoUrl: durableCandidate.url, candidateVideoAssetId: durableCandidate.id, videoReviewDecision: "pending", consistencyReport: inspection.report, consistencyDecision: "reject", status: "error" });
        if (previousCandidateUrl?.startsWith("blob:") && previousCandidateUrl !== durableCandidate.url) URL.revokeObjectURL(previousCandidateUrl);
        throw new Error(`五点视频一致性检查仅 ${inspection.report.overall} 分或存在单项硬失败，结果未进入资产库和成片`);
      }
      if (scene.videoUrl) URL.revokeObjectURL(scene.videoUrl);
      patchSceneReview(scene.id, { videoUrl: undefined, remoteVideoUrl: "remoteUrl" in clip ? String(clip.remoteUrl || "") || undefined : undefined, candidateVideoUrl: durableCandidate.url, candidateVideoAssetId: durableCandidate.id, videoReviewDecision: "pending", videoPosterUrl: inspection.frames.middle || scene.videoPosterUrl, remoteImageUrl: undefined, videoStartFrameUrl: inspection.frames.start, videoEndFrameUrl: inspection.frames.end, tailFrameAssetId: undefined, continuityReferenceDecision: sceneIndex > 0 ? "previous-video" : "asset-only", consistencyReport: inspection.report, consistencyDecision: "pass", status: "ready", duration: Math.max(4, Math.min(15, scene.duration)) });
      if (previousCandidateUrl?.startsWith("blob:") && previousCandidateUrl !== durableCandidate.url) URL.revokeObjectURL(previousCandidateUrl);
      recordActivity("video", `“${scene.title}”的原生动态镜头已生成，正在等待你的逐项批准`, "done");
    } catch (reason) {
      if (runRef.current !== actionRun) return;
      updateScene(scene.id, { status: "error" });
      const portraitBlocked = await registerSeedancePortraitBlock(reason, scene.id);
      if (!portraitBlocked) setError(reason instanceof Error ? reason.message : "动态镜头生成失败");
      recordActivity("video", `“${scene.title}”视频生成失败`, "error");
    } finally {
      if (sceneActionRef.current === actionId) {
        sceneActionRef.current = "";
        setSceneAction(null);
      }
    }
  }

  async function approveCandidateVideo(scene: Scene) {
    if (!scene.candidateVideoUrl || sceneActionRef.current) return;
    const actionId = `candidate:${scene.id}`;
    sceneActionRef.current = actionId;
    setSceneAction({ id: scene.id, type: "video" });
    setError("");
    try {
      const approvedSceneIndex = scenes.findIndex((item) => item.id === scene.id);
      let frames = { start: scene.videoStartFrameUrl || "", middle: scene.videoPosterUrl || "", end: scene.videoEndFrameUrl || "" };
      if (!frames.start && !frames.middle && !frames.end) {
        try {
          const extracted = await withStageTimeout(extractVideoContinuityFrames(scene.candidateVideoUrl, scene), 20000, "视频质检帧补取等待超过 20 秒");
          frames = { start: extracted.start, middle: extracted.middle, end: extracted.end };
        } catch (reason) {
          recordActivity("video", `“${scene.title}”已批准；质检缩略图补取失败但不再阻塞下一镜：${reason instanceof Error ? reason.message : "视频解码器不可用"}`, "warning");
        }
      }
      let approvedAssetId = scene.candidateVideoAssetId;
      if (approvedAssetId) {
        const candidateMetadata = (await listLibraryAssets({ allProjects: true })).find((asset) => asset.id === approvedAssetId);
        await updateLibraryAsset(approvedAssetId, { reusable: true, locked: true, assetState: "ready", tags: [...new Set([...(candidateMetadata?.tags || []), "已批准分镜视频"])].filter((tag) => tag !== "待审核分镜视频") });
      } else {
        const approved = await persistSceneVideoAsset(scene, scene.candidateVideoUrl, "approved");
        approvedAssetId = approved.id;
      }
      patchSceneReview(scene.id, {
        videoUrl: scene.candidateVideoUrl,
        videoAssetId: approvedAssetId,
        candidateVideoAssetId: undefined,
        candidateVideoUrl: undefined,
        videoPosterUrl: frames.middle || scene.videoPosterUrl,
        remoteImageUrl: undefined,
        videoStartFrameUrl: frames.start,
        videoEndFrameUrl: frames.end,
        tailFrameAssetId: undefined,
        continuityReferenceDecision: approvedSceneIndex > 0 ? "previous-video" : "asset-only",
        consistencyDecision: "review",
        videoReviewDecision: "approved",
        status: "ready",
        errorMessage: "用户已人工批准待复核候选",
      });
      if (voiceEnabled && sceneVoiceover(scene).mode === "onscreen_dialogue" && !canonicalVoiceAudioRef.current.has(sceneVoiceover(scene).speaker)) {
        await extractGeneratedVideoVoice(scene, scene.candidateVideoUrl).catch((reason) => { recordActivity("voice", `“${scene.title}”批准后音色提取失败：${reason instanceof Error ? reason.message : "音轨不可读"}`, "warning"); return null; });
      }
      recordActivity("director", `“${scene.title}”待复核候选已由用户人工批准并进入成片`, "warning");
      const nextPlan = planSequentialVideo(scenes.map((item) => item.id === scene.id ? { ...item, videoUrl: scene.candidateVideoUrl, candidateVideoUrl: undefined, videoReviewDecision: "approved" as const, status: "ready" } : item));
      setStatusText(nextPlan.kind === "generate" ? `“${scene.title}”已批准，正在生成第 ${nextPlan.index + 1} 镜` : `“${scene.title}”已批准，全部镜头视频已完成`);
      setSequentialResumeToken((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? `候选视频处理失败：${reason.message}` : "候选视频处理失败");
    } finally {
      if (sceneActionRef.current === actionId) {
        sceneActionRef.current = "";
        setSceneAction(null);
      }
    }
  }

  function discardCandidateVideo(scene: Scene) {
    if (!scene.candidateVideoUrl || sceneActionRef.current) return;
    if (scene.candidateVideoUrl.startsWith("blob:")) URL.revokeObjectURL(scene.candidateVideoUrl);
    if (scene.candidateVideoAssetId) void deleteLibraryAsset(scene.candidateVideoAssetId).catch(() => undefined);
    patchSceneReview(scene.id, { candidateVideoUrl: undefined, candidateVideoAssetId: undefined, videoUrl: undefined, remoteVideoUrl: undefined, videoReviewDecision: "rejected", status: scene.imageUrl ? "ready" : "queued", errorMessage: "候选已由用户删除" });
    recordActivity("director", `“${scene.title}”未通过候选已删除，不会进入资产库、后续镜头或成片`, "done");
  }

  function moveScene(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    reorderScene(index, nextIndex);
  }

  function reorderScene(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= scenes.length || to >= scenes.length) return;
    setScenes((items) => {
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setTime(next.slice(0, to).reduce((sum, item) => sum + item.duration, 0));
      return assignSpatialLayouts(next);
    });
    setSelected(to);
    setPlaying(false);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function deleteScene(index: number) {
    const item = scenes[index];
    if (item?.imageUrl && !scenes.some((scene, sceneIndex) => sceneIndex !== index && scene.imageUrl === item.imageUrl)) URL.revokeObjectURL(item.imageUrl);
    if (item?.audioUrl && !scenes.some((scene, sceneIndex) => sceneIndex !== index && scene.audioUrl === item.audioUrl)) URL.revokeObjectURL(item.audioUrl);
    if (item?.videoUrl && !scenes.some((scene, sceneIndex) => sceneIndex !== index && scene.videoUrl === item.videoUrl)) URL.revokeObjectURL(item.videoUrl);
    setScenes((items) => assignSpatialLayouts(items.filter((_, itemIndex) => itemIndex !== index)));
    setSelected(Math.max(0, Math.min(selected, scenes.length - 2)));
    setPlaying(false);
    setTime(0);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function splitAtPlayhead() {
    const index = scenes.findIndex((scene, sceneIndex) => {
      const localTime = time - offsets[sceneIndex];
      return localTime >= 2 && localTime <= scene.duration - 2;
    });
    if (index < 0) {
      setError("请把播放头移到镜头内部，且距离片段两端至少 2 秒后再分割");
      return;
    }
    const scene = scenes[index];
    const firstDuration = Number((time - offsets[index]).toFixed(1));
    const secondDuration = Number((scene.duration - firstDuration).toFixed(1));
    const first = { ...scene, duration: firstDuration };
    const second = { ...scene, id: uid(), title: `${scene.title} · 后段`, duration: secondDuration };
    setScenes((items) => assignSpatialLayouts([...items.slice(0, index), first, second, ...items.slice(index + 1)]));
    setSelected(index + 1);
    setPlaying(false);
    setError("");
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl("");
    setShowFilm(false);
  }

  function addScene() {
    const lead = characters[0]?.name || "主角";
    setScenes((items) => assignSpatialLayouts([...items, { id: uid(), title: "新镜头", visual: "描述场景、构图和光线", action: "描述角色连续动作和表情变化", shot: "中景", camera: "缓慢推进", dialogue: "输入角色台词", speaker: lead, emotion: "自然", sfx: "环境氛围声", characters: [lead], duration: 6, status: "queued", motion: "push", motionIntensity: 1, transition: "fade", filter: "none", speed: 1, volume: 1, subtitleEnabled: true, subtitlePosition: "bottom" }]));
    setSelected(scenes.length);
    invalidateExport();
  }

  function duplicateScene(index: number) {
    const source = scenes[index];
    if (!source) return;
    const copy = { ...source, id: uid(), title: `${source.title} · 副本` };
    setScenes((items) => assignSpatialLayouts([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]));
    setSelected(index + 1);
    invalidateExport();
    recordActivity("editor", `已复制镜头“${source.title}”`, "done");
  }

  function importedScene(name: string, index: number): Scene {
    const lead = characters[0]?.name || "主角";
    return { id: uid(), title: name.replace(/\.[^.]+$/, "").slice(0, 60) || `导入镜头 ${index + 1}`, visual: "用户导入的镜头资产", action: "根据导入素材延续自然动作与镜头表现", shot: "中景", camera: "缓慢推进", dialogue: "", speaker: lead, emotion: "自然", sfx: "", characters: lead === "主角" ? [] : [lead], duration: 6, status: "ready", motion: "push", motionIntensity: 1, transition: "fade", filter: "none", speed: 1, volume: 1, subtitleEnabled: true, subtitlePosition: "bottom", model: "本机资产库" };
  }

  function applyLibraryAssets(imported: LibraryAsset[]) {
    if (!imported.length) return;
    const nextCharacters = characters.map((item) => ({ ...item }));
    const nextProps = propAssets.map((item) => ({ ...item }));
    const nextSceneAssets = sceneAssets.map((item) => ({ ...item }));
    const nextScenes = scenes.map((item) => ({ ...item }));
    let characterIndex = 0;
    let imageIndex = 0;
    let videoIndex = 0;
    let audioIndex = 0;
    for (const asset of imported) {
      if (!asset.url) continue;
      const normalizedAssetName = asset.name.replace(/\.[^.]+$/, "").trim().toLocaleLowerCase();
      const looksLikeSceneAsset = asset.mediaType === "image" && asset.category === "scene" && (asset.tags.includes("场景设定") || String(asset.identityKey || "").startsWith("scene:"));
      if (looksLikeSceneAsset) {
        const identity = String(asset.entityId || asset.identityKey || asset.name).replace(/^scene:/i, "").trim();
        const exactIndex = nextSceneAssets.findIndex((item) => item.environmentKey.trim().toLocaleLowerCase() === identity.toLocaleLowerCase() || item.name.trim().toLocaleLowerCase() === normalizedAssetName);
        const targetIndex = exactIndex >= 0 ? exactIndex : nextSceneAssets.findIndex((item) => !item.imageUrl);
        if (targetIndex >= 0) nextSceneAssets[targetIndex] = { ...nextSceneAssets[targetIndex], libraryAssetId: asset.id, imageUrl: asset.url, reviewDecision: "approved", status: "ready" };
        else nextSceneAssets.push({ id: uid(), libraryAssetId: asset.id, name: asset.name.replace(/\.[^.]+$/, ""), environmentKey: identity, description: asset.semanticDescription || "用户从资产库导入的 Canonical 空场景", timeWeather: asset.variantName || "按图片确定", episodeScope: "当前集", sceneHints: [], reason: "用户指定场景资产", imageUrl: asset.url, reviewDecision: "approved", status: "ready" });
        continue;
      }
      const looksLikeProp = asset.mediaType === "image" && asset.category === "prop";
      if (looksLikeProp) {
        const exactIndex = nextProps.findIndex((item) => item.name.trim().toLocaleLowerCase() === normalizedAssetName);
        const targetIndex = exactIndex >= 0 ? exactIndex : nextProps.findIndex((item) => !item.imageUrl);
        if (targetIndex >= 0) nextProps[targetIndex] = { ...nextProps[targetIndex], imageUrl: asset.url, reviewDecision: "approved", status: "ready" };
        else nextProps.push({ id: uid(), name: asset.name.replace(/\.[^.]+$/, "").slice(0, 40) || `道具 ${nextProps.length + 1}`, description: "用户从资产库导入的重要道具", importance: "story", reason: "用户指定资产", imageUrl: asset.url, reviewDecision: "approved", status: "ready" });
        continue;
      }
      const looksLikeCharacter = asset.mediaType === "image" && (asset.category === "character" || /角色|人物|character|turnaround|三视图|四视图/i.test(asset.name));
      if (looksLikeCharacter) {
        const assetIdentity = normalizeAssetIdentity(asset.identityKey || asset.entityId || asset.name.replace(/\.[^.]+$/, ""));
        const assetLook = normalizeAssetLook(asset.lookName || asset.variantName || "基础版");
        const exactIndex = nextCharacters.findIndex((item) => normalizeAssetIdentity(characterIdentity(item)) === assetIdentity && normalizeAssetLook(characterLook(item)) === assetLook);
        const targetIndex = exactIndex >= 0 ? exactIndex : nextCharacters.findIndex((item) => !item.imageUrl);
        const existing = nextCharacters[targetIndex];
        if (existing) nextCharacters[targetIndex] = { ...existing, libraryAssetId: asset.id, identityName: asset.identityKey || existing.identityName || existing.name, lookName: asset.lookName || existing.lookName, imageUrl: asset.url, sheetVersion: characterSheetVersionFromLibrary(asset), reviewDecision: "approved", status: "ready" };
        else nextCharacters.push({ id: uid(), libraryAssetId: asset.id, name: asset.identityKey || asset.name.replace(/\.[^.]+$/, "").slice(0, 30) || `角色 ${characterIndex + 1}`, identityName: asset.identityKey, lookName: asset.lookName, role: "用户导入角色", appearance: "以用户导入的角色设定图为唯一外观参考", voice, imageUrl: asset.url, sheetVersion: characterSheetVersionFromLibrary(asset), reviewDecision: "approved", status: "ready" });
        characterIndex += 1;
        continue;
      }
      const looksLikeVoiceProfile = asset.mediaType === "audio" && asset.category === "audio" && Boolean(asset.identityKey) && !String(asset.identityKey).startsWith("voice:");
      if (looksLikeVoiceProfile) {
        if (asset.voiceConsent !== "revoked") canonicalVoiceAudioRef.current.set(String(asset.identityKey), asset.url);
        continue;
      }
      const field = asset.mediaType === "image" ? "imageUrl" : asset.mediaType === "video" ? "videoUrl" : "audioUrl";
      const slot = asset.mediaType === "image" ? imageIndex++ : asset.mediaType === "video" ? videoIndex++ : audioIndex++;
      while (nextScenes.length <= slot) nextScenes.push(importedScene(asset.name, nextScenes.length));
      const target = nextScenes[slot];
      nextScenes[slot] = { ...target, [field]: asset.url, duration: asset.duration > 0 ? Math.max(1, Math.min(30, asset.duration)) : target.duration, status: "ready", model: "本机资产库" };
    }
    setCharacters(nextCharacters);
    setPropAssets(nextProps);
    setSceneAssets(nextSceneAssets);
    void refreshVoiceProfiles().catch(() => undefined);
    setScenes(assignSpatialLayouts(nextScenes));
    setSelected(0);
    setPhase("ready");
    setError("");
    invalidateExport();
    setImportMessage(`已导入 ${imported.length} 项资产；人物、场景和道具会优先匹配剧本资产框架，其余素材跳过对应生成步骤`);
    void Promise.all(imported.map((asset) => markLibraryAssetUsed(asset.id))).catch(() => undefined);
    recordActivity("image", `已从独立资产库导入 ${imported.filter((item) => item.mediaType === "image").length} 项图片资产`, "done");
    if (imported.some((item) => item.mediaType === "video")) recordActivity("video", "用户视频资产已锁定，生成时自动跳过已有镜头", "done");
    if (imported.some((item) => item.mediaType === "audio")) recordActivity("voice", "用户音频资产已锁定，配音时自动跳过已有音轨", "done");
  }

  async function reviseCandidateVideo(scene: Scene) {
    if (!scene.candidateVideoUrl || sceneActionRef.current) return;
    const findings = scene.consistencyReport?.findings?.filter(Boolean) || [];
    const userRequest = String(scene.videoRevisionRequest || "").trim().slice(0, 600);
    const repairFindings = [
      ...(userRequest ? [`用户明确修改要求：${userRequest}`] : []),
      ...(findings.length ? findings : ["用户判定当前候选不合格，需要保持剧本与资产不变并修正人物、动作、运镜和镜头衔接"]),
    ];
    const repairReport: ConsistencyReport = scene.consistencyReport
      ? { ...scene.consistencyReport, decision: "reject", findings: repairFindings }
      : { scores: { characterIdentity: null, castIntegrity: null, costume: null, visualStyle: null, aestheticQuality: null, scene: null, props: null, spatialContinuity: null, shotContinuity: null, lighting: null }, overall: 0, decision: "reject", mode: "structural", findings: repairFindings, checkedAt: new Date().toISOString(), attempts: 1 };
    const repairScene: Scene = { ...scene, videoRevisionRequest: userRequest, consistencyDecision: "reject", consistencyReport: repairReport, videoReviewDecision: "rejected", errorMessage: `按用户与审核原因修改：${repairFindings.join("；")}` };
    patchSceneReview(scene.id, repairScene);
    saveSeedancePendingTask(scene.id);
    recordActivity("director", `“${scene.title}”被标记为不合格，视频 Agent 将按用户要求和评分原因修改：${repairFindings.join("；").slice(0, 220)}`, "warning");
    await generateVideo(repairScene);
  }

  function isMisclassifiedNarrativeAsset(asset: LibraryAsset) {
    if (/^script:scene:/i.test(asset.blueprintKey || "")) {
      const environmentKey = String(asset.entityId || asset.identityKey || asset.name).replace(/^scene:/i, "").trim();
      return asset.assetState === "placeholder" && !isReusableSceneAssetCandidate(environmentKey, asset.name);
    }
    if (!/^script:(?:character|voice):/i.test(asset.blueprintKey || "")) return false;
    const label = String(asset.identityKey || asset.name || "").replace(/[-—_ ]*(?:标准音色|基础版)$/u, "").trim();
    const semantic = String(asset.semanticDescription || "");
    return !isVisualCharacterAsset({ name: label, role: semantic.split(/[。.;；]/)[0] || "", appearance: semantic });
  }

  async function removeMisclassifiedNarrativeAssets(projectId?: string, episodeId?: string) {
    const obsolete = (await listLibraryAssets({ allProjects: true })).filter((asset) =>
      isMisclassifiedNarrativeAsset(asset)
      && (!projectId || asset.projectId === projectId)
      && (!episodeId || !asset.episodeId || asset.episodeId === episodeId));
    await Promise.all(obsolete.map((asset) => deleteLibraryAsset(asset.id)));
    if (obsolete.length) recordActivity("writer", `已清理 ${obsolete.length} 个把栏目、镜头/声音标记或无名群演误当成人物/音色的旧框架`, "done");
  }

  async function persistScriptAssetBlueprint(characterItems: CharacterAsset[], propItems: PropAsset[], sceneItems: SceneAsset[], scriptContent: string) {
    let activeContext: { projectId?: string; episodeId?: string } = {};
    try { activeContext = JSON.parse(window.localStorage.getItem("manjing-active-series-context-v1") || "{}"); } catch { activeContext = {}; }
    const projectId = activeContext.projectId || editorProjectIdRef.current;
    const episodeId = activeContext.episodeId;
    await removeMisclassifiedNarrativeAssets(projectId, episodeId);
    const validCharacterItems = deduplicateCharacterAssets(characterItems);
    const savedCharacters = await Promise.all(validCharacterItems.map(async (character) => {
      const naming = characterAssetNaming(character);
      const saved = await saveLibraryPlaceholder({
        name: naming.displayName,
        category: "character",
        identityKey: naming.identityKey,
        lookName: naming.lookName,
        semanticDescription: `${character.role}。${character.appearance}${character.visualEvidence ? `。出镜依据：${character.visualEvidence}` : ""}`,
        generationPrompt: characterSheetPrompt(style, character),
        tags: ["剧本人物", naming.identityKey, `造型:${naming.lookName}`, `集数:${character.episodeScope || "当前集"}`, ...(character.sceneHints || []).slice(0, 6).map((hint) => `镜头:${hint}`)],
        blueprintKey: `script:character:${naming.identityKey}:${naming.lookName}`,
        projectId,
        episodeId,
      });
      const [loaded] = saved.assetState !== "placeholder" ? await loadLibraryAssets([saved.id]) : [];
      return loaded?.url ? { ...character, libraryAssetId: saved.id, imageUrl: loaded.url, remoteUrl: loaded.url.startsWith("https://") ? loaded.url : character.remoteUrl, arkAssetId: loaded.arkAssetId, portraitAuthorizationStatus: loaded.portraitAuthorizationStatus, reviewDecision: loaded.assetState === "review" ? "pending" as const : "approved" as const, sheetVersion: characterSheetVersionFromLibrary(loaded), status: "ready" as const } : { ...character, libraryAssetId: saved.id };
    }));
    const savedProps = await Promise.all(propItems.map(async (prop) => {
      const saved = await saveLibraryPlaceholder({
        name: prop.name,
        category: "prop",
        identityKey: prop.name,
        semanticDescription: `${prop.description}。${prop.reason}`,
        generationPrompt: `${frameVisualPrompt(style)}, production prop identity sheet for ${prop.name}, ${prop.description}, exact shape, material, color, scale and story state, front side and three-quarter reference views, neutral background, no person, no redesign, no text`,
        tags: ["剧本道具", "重要道具", prop.name, `重要度:${prop.importance}`],
        blueprintKey: `script:prop:${prop.name}`,
        projectId,
        episodeId,
      });
      const [loaded] = saved.assetState !== "placeholder" ? await loadLibraryAssets([saved.id]) : [];
      return loaded?.url ? { ...prop, libraryAssetId: saved.id, imageUrl: loaded.url, remoteUrl: loaded.url.startsWith("https://") ? loaded.url : prop.remoteUrl, reviewDecision: loaded.assetState === "review" ? "pending" as const : "approved" as const, status: "ready" as const } : { ...prop, libraryAssetId: saved.id };
    }));
    const validSceneItems = sceneItems.filter((item) => isReusableSceneAssetCandidate(item.environmentKey, item.name));
    const savedScenes = await Promise.all(validSceneItems.map(async (sceneAsset) => {
      const saved = await saveLibraryPlaceholder({
        name: sceneAsset.name,
        category: "scene",
        identityKey: `scene:${sceneAsset.environmentKey}`,
        entityId: sceneAsset.environmentKey,
        semanticDescription: `${sceneAsset.description}。时间天气：${sceneAsset.timeWeather}。${sceneAsset.reason}`,
        generationPrompt: `${frameVisualPrompt(style)}, canonical empty environment reference for ${sceneAsset.name}, ${sceneAsset.description}, ${sceneAsset.timeWeather}, lock architecture, doors, windows, fixed furniture, spatial layout, palette and light direction, no people, no movable story props, no text`,
        tags: ["剧本场景", "场景设定", sceneAsset.environmentKey, `集数:${sceneAsset.episodeScope || "当前集"}`, ...(sceneAsset.sceneHints || []).slice(0, 8).map((hint) => `镜头:${hint}`)],
        blueprintKey: `script:scene:${sceneAsset.environmentKey}`,
        projectId,
        episodeId,
      });
      const [loaded] = saved.assetState !== "placeholder" ? await loadLibraryAssets([saved.id]) : [];
      return loaded?.url ? { ...sceneAsset, libraryAssetId: saved.id, imageUrl: loaded.url, remoteUrl: loaded.url.startsWith("https://") ? loaded.url : sceneAsset.remoteUrl, reviewDecision: loaded.assetState === "review" ? "pending" as const : "approved" as const, status: "ready" as const } : { ...sceneAsset, libraryAssetId: saved.id };
    }));
    const speakingCharacters = [...new Map(validCharacterItems.map((character) => {
      const identity = characterIdentity(character);
      return [identity.toLocaleLowerCase("zh-CN"), { character: { ...character, name: identity, identityName: identity }, referenceText: character.firstDialogue || firstDialogueForCharacter(scriptContent, identity) }] as const;
    }).filter(([, item]) => item.character.needsVoice !== false && item.referenceText)).values()];
    const savedVoices = await Promise.all(speakingCharacters.map(async ({ character, referenceText }) => {
      return saveLibraryPlaceholder({
        name: `${character.name}-标准音色`,
        category: "audio",
        identityKey: character.name,
        lookName: "标准音色",
        semanticDescription: `${character.name}（${character.role}）的人物声音框架。${referenceText ? `首条参考台词：${referenceText}` : "等待用户上传授权音频或调用配音 AI 生成参考音色。"}`,
        generationPrompt: `${character.role}；${character.appearance}；声音需与年龄、性格和剧情身份匹配，保持自然、清晰、可长期跨镜复用`,
        referenceText,
        tags: ["剧本音色", "人物音色", character.name],
        blueprintKey: `script:voice:${character.name}`,
        projectId,
        episodeId,
      });
    }));
    return { characters: savedCharacters, props: savedProps, scenes: savedScenes, voices: savedVoices };
  }

  async function analyzeScriptAssetBlueprint(content: string, filename = "导入剧本") {
    const run = Date.now();
    runRef.current = run;
    setAssetAnalysisState("analyzing");
    setStatusText("AI 正在区分简介、背景设定、人物造型、场景、对白与重要道具");
    setImportMessage(`正在分析“${filename}”：此阶段不会生成任何图片或消耗生图额度`);
    recordActivity("writer", "开始分析导入剧本中的人物、服装状态、可复用场景与重要道具");
    const system = `你是影视制片的剧本拆解师。只分析，不改写剧本，不生成图片。先区分元数据、剧本简介、背景故事/世界观、人物表、场景标题、动作和真正的角色对白。完整提取所有实际需要视觉出镜的具名人物、每个需要稳定复用的拍摄场景，以及推动剧情、被人物持有或穿戴、发生状态变化、跨镜重复出现的重要道具。场景资产不是分镜图：每个不同地点/布景/时代状态建立一张没有人物、没有可移动剧情道具的 Canonical 空场景参考图，用于无首尾帧、无分镜图时仍能通过全能参考锁定建筑、门窗、固定陈设、空间布局、天气、时段、色调和光线方向；同一场景只建一次，可跨镜复用，发生实质改造/灾后/季节变化时才拆成独立 environmentKey。“异样开场、线索逼近、冲突反转、悬念收束、高潮、转场、特写、反打”等是叙事节拍或镜头功能，绝对不是场景资产，禁止写入 scenes。中文剧本中的场景 name 必须使用简短自然的中文，例如“苏梨破院”“户部公廨大厅”，严禁把 EP01_ENV_... 一类英文机器编码填进 name；environmentKey 是内部稳定复用键，可保持已有值，但新建时也优先使用简短中文。人物身份与人物造型必须分层：同一人物仍使用同一个 identityName，但本集每一种实际出镜的服装、妆发或剧情状态都要分别输出一条人物造型资产，例如男主平时黑衣、本集先穿白衣后受伤，就输出男主/白衣版和男主/白衣战损版；禁止把多个互斥造型揉在一张图里。lookName 必须短而明确，使用“白衣版、黑衣常服版、西装版、颓废版、战损版”等可直接显示和引用的名字；sceneHints 写明使用该造型或场景的标题、镜号或可检索剧情短语。没有明确变化时只输出基础版。人物 appearance 必须先忠实提取剧本明确的年龄感、族裔、体型、脸部与妆造信息；如果剧本没有写具体五官，可以根据身份和性格补充一套协调而有美感的角色设计方向：一个主要面部记忆点、两个辅助五官、清晰脸型与轮廓、角色专属发型妆面和克制配色。美感必须服务年龄、身份和剧情，不得把老人、反派、伤病或疲惫状态统一美化成年轻网红脸，也不得随机拼凑互相冲突的五官。系列项目、当前制作、剧本简介、背景故事、项目长期记忆、角色圣经、上一集结束状态、“小传/人物小传/角色小传”等栏目标题绝对不是人物或场景；片名、题材、时长、作者、编剧、人物关系、场次、镜号、景别、运镜、情绪、转场、音效、配乐、字幕、MONTAGE、FLASHBACK、CUT TO、TITLE CARD、SFX 等制片字段和剧本技术标记也绝对不是人物。VO、V.O.、-VO-、OS、O.S. 是附着在真实角色名后的画外音/声音位置扩展：如“苏梨（V.O.）”应识别为苏梨，但孤立的 VO/OS 绝对不是人物名。群演甲、路人A、众人、群众、男声、女声、系统声等没有稳定身份且不需要跨镜一致性的对象不得建立人物资产。每个人物必须给出可核对的 visualEvidence；只有剧本明确出镜或明确要求稳定视觉形象时 requiresVisualAsset 才能为 true，纯声音、栏目标题、舞台说明和技术标记必须为 false。普通桌椅和无剧情意义装饰也不是资产。只有实际说过台词的具名人物才需要建立音色框架；同一人物无论多少造型只共用一个音色。只返回 JSON：{"synopsis":"剧本简介或根据剧情提炼的简明故事梗概","background":"背景故事、时代地点、世界规则、主要关系与前史；没有明确内容就如实概括","characters":[{"name":"实际人物名（与 identityName 相同，不含 VO/OS 扩展）","identityName":"人物固定身份名","lookName":"当前服装/状态造型名","episodeScope":"第几集或当前集","sceneHints":["使用该造型的镜号、场景标题或剧情短语"],"role":"身份/关系","appearance":"人物固定身份特征、成套协调的脸型/主要记忆点/辅助五官，以及仅当前造型的服装、妆发和状态；缺失部分按角色身份克制补全，不得网红化或抹去年龄和剧情状态","reason":"该造型在何处出镜的依据","requiresVisualAsset":true或false,"visualEvidence":"证明该人物实际出镜或需要稳定视觉形象的原文场景/动作证据","needsVoice":true或false,"firstDialogue":"该人物第一句真实台词；没说话则为空"}],"scenes":[{"name":"便于用户识别的中文场景名（中文剧本严禁使用英文机器编码）","environmentKey":"稳定且唯一的场景身份，新建中文剧本优先使用短中文","description":"建筑、空间布局、门窗方向、固定陈设、主色调与光线方向","timeWeather":"时间、季节、天气和环境状态","episodeScope":"第几集或当前集","sceneHints":["使用该场景的镜号或剧情短语"],"reason":"需要建立并复用场景图的原因"}],"props":[{"name":"道具名","description":"剧本明确的形状、材质、颜色、尺寸和状态；没有依据就写待补充","importance":"hero|recurring|story","reason":"需要道具资产的原因"}]}。`;
    const chunks = splitScriptForAssetAnalysis(content);
    const promptHeader = "请分析下面这部分剧本并建立资产候选清单。保持原文人物名和语言；同一人物的称谓合并为同一 identityName。只有服装、妆发、伤势、年龄或身体状态出现可见变化时才拆分 lookName；地点、昼夜、场次和镜头编号绝对不能成为人物造型名。没有明确换装时，破院居家、夜间居家等场景描述必须合并为同一个居家造型。还要提取实际需要的 Canonical 空场景图并建立唯一 environmentKey。所有人物造型和场景都给出 sceneHints。";
    let usedFallback = false;
    try {
      const languageRole = (["writer", "prompt", "director", "editor"] as const).find((role) => {
        const candidate = agentConfigs[role];
        if (candidate.adapter === "browser") return false;
        if (candidate.adapter === "horde") return true;
        if (candidate.adapter === "pollinations") return agentKey(role).startsWith("pk_");
        if (CUSTOM_TEXT_ADAPTERS.includes(candidate.adapter)) return validAgentEndpoint(candidate.endpoint);
        return false;
      }) || "writer";
      const config = agentConfigs[languageRole];
      const manifests = [];
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        setStatusText(`AI 正在完整分析剧本 ${chunkIndex + 1}/${chunks.length}：人物造型、场景、道具与对白`);
        const prompt = `${promptHeader}\n这是全文的第 ${chunkIndex + 1}/${chunks.length} 部分；只提取本部分有原文证据的内容，跨部分结果稍后由程序统一合并。\n\n${chunk}`;
        let raw = "";
        if (config.adapter === "horde") {
          const task = await startHorde("assets", { story: prompt, model: config.model });
          const result = await pollHorde("text", task.id, run, { maxAttempts: 40, timeoutMessage: `免费资产分析第 ${chunkIndex + 1} 部分排队超过 120 秒` });
          raw = String(result.text || "");
        } else {
          const task = CUSTOM_TEXT_ADAPTERS.includes(config.adapter)
            ? customApiText(languageRole, { task: "script_asset_manifest", system, prompt })
            : pollinationsText(languageRole, system, prompt);
          raw = await withStageTimeout(task, 180000, `剧本资产分析第 ${chunkIndex + 1}/${chunks.length} 部分超过 180 秒，请检查编剧模型接口`);
        }
        manifests.push(parseScriptAssetManifest(raw, chunk));
      }
      const manifest = mergeScriptAssetManifests(manifests);
      persistScriptMemory({ synopsis: manifest.synopsis, background: manifest.background });
      const previousCharacters = new Map(characters.map((item) => [characterAssetKey(item), item]));
      const previousProps = new Map(propAssets.map((item) => [item.name.toLocaleLowerCase(), item]));
      const previousScenes = new Map(sceneAssets.map((item) => [item.environmentKey.toLocaleLowerCase("zh-CN"), item]));
      const analyzedCharacters: CharacterAsset[] = manifest.characters.map((item) => {
        const previous = previousCharacters.get(`${normalizeAssetIdentity(item.identityName)}::${normalizedCharacterLook(item.lookName)}`);
        return { id: previous?.id || uid(), name: item.identityName, identityName: item.identityName, lookName: item.lookName, episodeScope: item.episodeScope, sceneHints: item.sceneHints, role: item.role, appearance: item.appearance, visualEvidence: item.visualEvidence, requiresVisualAsset: item.requiresVisualAsset, voice: previous?.voice || voice, needsVoice: item.needsVoice, firstDialogue: item.firstDialogue, status: "queued" as const };
      });
      const nextCharacters = reconcileAnalyzedCharacterAssets(characters, analyzedCharacters);
      const nextProps = manifest.props.map((item) => {
        const previous = previousProps.get(item.name.toLocaleLowerCase());
        return { id: previous?.id || uid(), libraryAssetId: previous?.libraryAssetId, ...item, imageUrl: previous?.imageUrl, remoteUrl: previous?.remoteUrl, reviewDecision: previous?.reviewDecision, status: previous?.imageUrl ? "ready" as const : "queued" as const };
      });
      const nextScenes = manifest.scenes.map((item) => {
        const previous = previousScenes.get(item.environmentKey.toLocaleLowerCase("zh-CN"));
        return { id: previous?.id || uid(), libraryAssetId: previous?.libraryAssetId, ...item, imageUrl: previous?.imageUrl, remoteUrl: previous?.remoteUrl, reviewDecision: previous?.reviewDecision, status: previous?.imageUrl ? "ready" as const : "queued" as const };
      });
      const persisted = await persistScriptAssetBlueprint(nextCharacters, nextProps, nextScenes, content);
      setCharacters(persisted.characters);
      setPropAssets(persisted.props);
      setSceneAssets(persisted.scenes);
      setAssetAnalysisState("ready");
      const identityCount = new Set(manifest.characters.map((item) => item.identityName.toLocaleLowerCase("zh-CN"))).size;
      setStatusText(`已识别简介与背景记忆，并建立 ${identityCount} 个人物的 ${manifest.characters.length} 套本集造型、${manifest.scenes.length} 个场景、${manifest.props.length} 个道具、${persisted.voices.length} 个实际说话人物音色框架`);
      setImportMessage(`AI 已区分“${filename}”中的故事设定、人物、道具和对白；可先上传已有资产，再一键生成其余缺失图片`);
      recordActivity("writer", `${agentName(languageRole)}已分 ${chunks.length} 段无遗漏通读全文并锁定唯一资产清单：${identityCount} 个人物、${manifest.characters.length} 套可见服装/状态造型、${manifest.scenes.length} 个 Canonical 场景、${manifest.props.length} 个重要道具、${persisted.voices.length} 个实际对白人物音色；地点和昼夜未作为人物造型`, "done");
    } catch (reason) {
      usedFallback = true;
      const manifest = fallbackScriptAssetManifest(content);
      persistScriptMemory({ synopsis: manifest.synopsis, background: manifest.background });
      const localCharacters = reconcileAnalyzedCharacterAssets(characters, manifest.characters.map((item) => ({ id: uid(), name: item.name, identityName: item.identityName || item.name, lookName: item.lookName || "基础版", role: item.role, appearance: item.appearance, visualEvidence: item.visualEvidence, requiresVisualAsset: item.requiresVisualAsset, voice, needsVoice: item.needsVoice, firstDialogue: item.firstDialogue, status: "queued" as const })));
      const localProps = manifest.props.map((item) => ({ id: uid(), ...item, status: "queued" as const }));
      const localScenes = manifest.scenes.map((item) => ({ id: uid(), ...item, status: "queued" as const }));
      const persisted = await persistScriptAssetBlueprint(localCharacters, localProps, localScenes, content);
      setCharacters(persisted.characters);
      setPropAssets(persisted.props);
      setSceneAssets(persisted.scenes);
      setAssetAnalysisState("ready");
      setStatusText("云端分析暂不可用，已用本地规则建立可编辑资产框架");
      setImportMessage(`已建立本地资产框架并同步到资产库；可编辑后上传或生成。${reason instanceof Error ? ` 云端原因：${reason.message}` : ""}`);
      recordActivity("writer", "云端资产分析未完成，已降级为本地人物/场景/道具提取；仍未生成图片", "warning");
    } finally {
      if (!usedFallback) setError("");
    }
  }

  function updateCharacterAsset(id: string, patch: Partial<CharacterAsset>) {
    setCharacters((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updatePropAsset(id: string, patch: Partial<PropAsset>) {
    setPropAssets((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateSceneAsset(id: string, patch: Partial<SceneAsset>) {
    setSceneAssets((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function uploadCharacterBlueprint(character: CharacterAsset, file?: File) {
    if (!file) return;
    const actionId = `character-upload:${character.id}`;
    setAssetAction(actionId);
    try {
      const naming = characterAssetNaming(character);
      const saved = character.libraryAssetId
        ? await attachLibraryFileToPlaceholder(character.libraryAssetId, file, "upload")
        : await saveLibraryFile(file, { name: naming.displayName, category: "character", duration: 5, tags: ["用户上传", "人物", character.name, `造型:${naming.lookName}`], identityKey: naming.identityKey, lookName: naming.lookName, entityId: naming.identityKey, variantName: naming.variantName, locked: true });
      await updateLibraryAsset(saved.id, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "upload" });
      const referenceCardReport = await evaluateCharacterReferenceCard(character, saved.url);
      updateCharacterAsset(character.id, { libraryAssetId: saved.id, imageUrl: saved.url, sheetVersion: referenceCardReport.mode === "vision" && referenceCardReport.decision === "pass" ? 3 : 2, referenceCardReport, reviewDecision: "approved", identityBaseline: character.identityBaseline, status: "ready" });
      recordActivity("image", `人物“${character.name}”已绑定用户上传资产；${referenceCardReport.mode === "vision" ? `多角度角色卡校验 ${referenceCardReport.overall} 分` : "未声明为标准三视图，极端角度镜头仍需补充参考"}`, referenceCardReport.decision === "reject" ? "warning" : "done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "人物资产上传失败");
    } finally { setAssetAction(""); }
  }

  async function generateCharacterBlueprint(character: CharacterAsset, autoAdopt = false) {
    if (assetAction && !autoAdopt) return;
    const redoRequested = Boolean(character.imageUrl);
    // All looks of one identity start from the same latent seed. A manual redo
    // gets a new sample, while the current/Canonical image is still submitted as
    // the hard face reference so clothes and state can change without recasting.
    const variationSeed = redoRequested ? Math.floor(Math.random() * 2147483646) + 1 : characterIdentitySeed(characterIdentity(character));
    const actionId = `character-generate:${character.id}`;
    const run = Date.now();
    runRef.current = run;
    if (!autoAdopt) setAssetAction(actionId);
    updateCharacterAsset(character.id, { status: "generating" });
    try {
      if (!character.imageUrl) {
        const naming = characterAssetNaming(character);
        const reused = await loadReusableBlueprintAsset("character", naming.identityKey, naming.lookName);
        if (reused?.url) {
          updateCharacterAsset(character.id, { libraryAssetId: reused.id, imageUrl: reused.url, remoteUrl: reused.url.startsWith("https://") ? reused.url : character.remoteUrl, arkAssetId: reused.arkAssetId, portraitAuthorizationStatus: reused.portraitAuthorizationStatus, sheetVersion: characterSheetVersionFromLibrary(reused), reviewDecision: reused.assetState === "review" ? "pending" : "approved", status: "ready" });
          recordActivity("image", `生图前二次检索命中“${naming.displayName}”，已复用资产库图片并取消重复生图`, "done");
          return true;
        }
      }
      const characterRequest = await characterGenerationRequest(character, characters);
      const prompt = `${characterRequest.prompt}${redoRequested ? "\nREDO REQUEST: create a genuinely new sampled result. Keep the locked identity and required character facts unchanged, but do not return the previous pixels; refresh the pose, expression micro-detail, lighting treatment and secondary presentation details." : ""}`;
      let generatedUrl = "";
      let generatedBlob: Blob | null = null;
      let generatedRemoteUrl = "";
      if (agentConfigs.image.adapter !== "horde") {
        const asset = await pollinationsMedia("image", prompt, 700 + characters.findIndex((item) => item.id === character.id), { imageAspect: "16:9", imagePurpose: "character-card", references: characterRequest.references, variationSeed });
        const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
        const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `character-blueprint-${character.id}.png`, uploadKey) : "";
        generatedUrl = asset.url;
        generatedBlob = asset.blob;
        generatedRemoteUrl = remoteUrl;
      } else {
        const referenceScene: Scene = { id: uid(), title: character.name, visual: prompt, action: "静态角色设定", shot: "角色设定图", camera: "固定镜头", dialogue: "", speaker: character.name, emotion: "中性", sfx: "", characters: [character.name], duration: 4, status: "painting" };
        generatedUrl = await makeImage(referenceScene, 700 + characters.findIndex((item) => item.id === character.id), run, "", "16:9", prompt, characterRequest.references, "character-card");
        const response = await fetch(generatedUrl);
        if (response.ok) generatedBlob = await response.blob();
      }
      const referenceCardReport = await evaluateCharacterReferenceCard(character, generatedUrl);
      const visualCardPass = referenceCardReport.mode === "vision" && referenceCardReport.decision === "pass";
      if (autoAdopt && generatedBlob) {
        const naming = characterAssetNaming(character);
        const file = new File([generatedBlob], `${naming.displayName}.png`, { type: generatedBlob.type || "image/png" });
        const saved = character.libraryAssetId
          ? await attachLibraryFileToPlaceholder(character.libraryAssetId, file, "ai")
          : await saveLibraryFile(file, { name: naming.displayName, category: "character", tags: ["AI生成", "人物", character.name, "四区角色卡", "大头照", "正侧背三视图", "character-card-v3"], identityKey: naming.identityKey, lookName: naming.lookName, locked: true, reusable: true });
        const [stored] = await loadLibraryAssets([saved.id]);
        await updateLibraryAsset(saved.id, { canonical: visualCardPass, reusable: visualCardPass, locked: true, assetState: visualCardPass ? "ready" : "review", sourceChoice: "ai", tags: [...new Set([...(stored?.tags || []), "四区角色卡", "大头照", "正侧背三视图", "character-card-v3"])] });
        updateCharacterAsset(character.id, { libraryAssetId: saved.id, imageUrl: saved.url || generatedUrl, remoteUrl: generatedRemoteUrl, sheetVersion: 3, referenceCardReport, reviewDecision: visualCardPass ? "approved" : "pending", status: "ready" });
        recordActivity("image", visualCardPass ? `人物“${character.name}”四区角色卡已通过多角度视觉校验并入库` : `人物“${character.name}”四区角色卡已生成，但多角度校验未自动通过，等待用户采用或重做`, visualCardPass ? "done" : "warning");
      } else {
        updateCharacterAsset(character.id, { imageUrl: generatedUrl, remoteUrl: generatedRemoteUrl, sheetVersion: 3, referenceCardReport, reviewDecision: "pending", status: "ready" });
        recordActivity("image", `人物“${character.name}”四区角色卡已生成，等待用户结合多角度质检结果采用或上传替换`, referenceCardReport.decision === "pass" ? "done" : "warning");
      }
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "人物资产生成失败";
      updateCharacterAsset(character.id, { status: "error" });
      setError(message);
      recordActivity("image", `人物“${character.name}”生成失败：${message}`, "error");
      if (autoAdopt) throw new Error(message);
      return false;
    } finally { if (!autoAdopt) setAssetAction(""); }
  }

  async function uploadPropBlueprint(prop: PropAsset, file?: File) {
    if (!file) return;
    const actionId = `prop-upload:${prop.id}`;
    setAssetAction(actionId);
    try {
      const saved = prop.libraryAssetId
        ? await attachLibraryFileToPlaceholder(prop.libraryAssetId, file, "upload")
        : await saveLibraryFile(file, { name: prop.name, category: "prop", duration: 5, tags: ["用户上传", "重要道具", prop.name], identityKey: prop.name, entityId: prop.name, variantName: "基础版", locked: true });
      await updateLibraryAsset(saved.id, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "upload" });
      updatePropAsset(prop.id, { imageUrl: saved.url, reviewDecision: "approved", status: "ready" });
      recordActivity("image", `道具“${prop.name}”已绑定用户上传资产`, "done");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "道具资产上传失败"); }
    finally { setAssetAction(""); }
  }

  async function generatePropBlueprint(prop: PropAsset, index: number, autoAdopt = false) {
    if (assetAction && !autoAdopt) return;
    const redoRequested = Boolean(prop.imageUrl);
    const variationSeed = redoRequested ? Math.floor(Math.random() * 2147483646) + 1 : undefined;
    const actionId = `prop-generate:${prop.id}`;
    const run = Date.now();
    runRef.current = run;
    if (!autoAdopt) setAssetAction(actionId);
    updatePropAsset(prop.id, { status: "generating" });
    try {
      if (!prop.imageUrl) {
        const reused = await loadReusableBlueprintAsset("prop", prop.name);
        if (reused?.url) {
          updatePropAsset(prop.id, { libraryAssetId: reused.id, imageUrl: reused.url, remoteUrl: reused.url.startsWith("https://") ? reused.url : prop.remoteUrl, reviewDecision: reused.assetState === "review" ? "pending" : "approved", status: "ready" });
          recordActivity("image", `生图前二次检索命中道具“${prop.name}”，已复用资产库图片并取消重复生图`, "done");
          return true;
        }
      }
      const prompt = `${frameVisualPrompt(style)}, production prop identity sheet for ${prop.name}, ${prop.description}, exact shape, material, color, scale and story state, front side and three-quarter reference views, neutral background, no person, no redesign, no text${redoRequested ? ", REDO REQUEST: generate a genuinely new sample rather than returning the previous pixels; preserve the prop identity but refresh lighting and secondary presentation details" : ""}`;
      let generatedUrl = "";
      let generatedBlob: Blob | null = null;
      let generatedRemoteUrl = "";
      if (agentConfigs.image.adapter !== "horde") {
        const asset = await pollinationsMedia("image", prompt, 800 + index, { imageAspect: "16:9", variationSeed });
        const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
        const remoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `prop-blueprint-${prop.id}.png`, uploadKey) : "";
        generatedUrl = asset.url;
        generatedBlob = asset.blob;
        generatedRemoteUrl = remoteUrl;
      } else {
        const referenceScene: Scene = { id: uid(), title: prop.name, visual: prompt, action: "静态道具设定", shot: "道具设定图", camera: "固定镜头", dialogue: "", speaker: "", emotion: "中性", sfx: "", characters: [], duration: 4, status: "painting" };
        generatedUrl = await makeImage(referenceScene, 800 + index, run, "", "16:9", prompt);
        const response = await fetch(generatedUrl);
        if (response.ok) generatedBlob = await response.blob();
      }
      if (autoAdopt && generatedBlob) {
        const file = new File([generatedBlob], `${prop.name}.png`, { type: generatedBlob.type || "image/png" });
        const saved = prop.libraryAssetId
          ? await attachLibraryFileToPlaceholder(prop.libraryAssetId, file, "ai")
          : await saveLibraryFile(file, { name: prop.name, category: "prop", tags: ["AI生成", "重要道具", prop.name], identityKey: prop.name, locked: true, reusable: true });
        await updateLibraryAsset(saved.id, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "ai" });
        updatePropAsset(prop.id, { libraryAssetId: saved.id, imageUrl: saved.url || generatedUrl, remoteUrl: generatedRemoteUrl, reviewDecision: "approved", status: "ready" });
        recordActivity("image", `道具“${prop.name}”已一键生成并入库；不满意可直接上传图片替换`, "done");
      } else {
        updatePropAsset(prop.id, { imageUrl: generatedUrl, remoteUrl: generatedRemoteUrl, reviewDecision: "pending", status: "ready" });
        recordActivity("image", `道具“${prop.name}”资产图已生成，等待用户采用或上传替换`, "done");
      }
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "道具资产生成失败";
      updatePropAsset(prop.id, { status: "error" });
      setError(message);
      recordActivity("image", `道具“${prop.name}”生成失败：${message}`, "error");
      if (autoAdopt) throw new Error(message);
      return false;
    } finally { if (!autoAdopt) setAssetAction(""); }
  }

  async function uploadSceneBlueprint(sceneAsset: SceneAsset, file?: File) {
    if (!file) return;
    const actionId = `scene-upload:${sceneAsset.id}`;
    setAssetAction(actionId);
    try {
      const saved = sceneAsset.libraryAssetId
        ? await attachLibraryFileToPlaceholder(sceneAsset.libraryAssetId, file, "upload")
        : await saveLibraryFile(file, { name: sceneAsset.name, category: "scene", duration: 5, tags: ["用户上传", "场景设定", sceneAsset.environmentKey], identityKey: `scene:${sceneAsset.environmentKey}`, entityId: sceneAsset.environmentKey, variantName: sceneAsset.timeWeather || "基础版", locked: true, reusable: true });
      await updateLibraryAsset(saved.id, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "upload", identityKey: `scene:${sceneAsset.environmentKey}`, entityId: sceneAsset.environmentKey });
      updateSceneAsset(sceneAsset.id, { libraryAssetId: saved.id, imageUrl: saved.url, reviewDecision: "approved", status: "ready" });
      recordActivity("image", `场景“${sceneAsset.name}”已绑定用户上传图片并进入资产库`, "done");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "场景资产上传失败"); }
    finally { setAssetAction(""); }
  }

  async function generateSceneBlueprint(sceneAsset: SceneAsset, index: number, autoAdopt = false) {
    if (assetAction && !autoAdopt) return;
    const redoRequested = Boolean(sceneAsset.imageUrl);
    const variationSeed = redoRequested ? Math.floor(Math.random() * 2147483646) + 1 : undefined;
    const actionId = `scene-generate:${sceneAsset.id}`;
    const run = Date.now();
    runRef.current = run;
    if (!autoAdopt) setAssetAction(actionId);
    updateSceneAsset(sceneAsset.id, { status: "generating" });
    try {
      if (!sceneAsset.imageUrl) {
        const reused = await loadReusableBlueprintAsset("scene", sceneAsset.environmentKey || sceneAsset.name);
        if (reused?.url) {
          updateSceneAsset(sceneAsset.id, { libraryAssetId: reused.id, imageUrl: reused.url, remoteUrl: reused.url.startsWith("https://") ? reused.url : sceneAsset.remoteUrl, reviewDecision: reused.assetState === "review" ? "pending" : "approved", status: "ready" });
          recordActivity("image", `生图前二次检索命中场景“${sceneAsset.name}”，已复用资产库图片并取消重复生图`, "done");
          return true;
        }
      }
      const prompt = `${frameVisualPrompt(style)}, canonical empty environment reference for ${sceneAsset.name}, environment identity ${sceneAsset.environmentKey}, ${sceneAsset.description}, ${sceneAsset.timeWeather}. Lock the exact architecture, room proportions, doors, windows, pathways, fixed furniture, spatial layout, palette, weather, time of day and light direction. No people, silhouettes, crowds, animals, movable story props, text, labels, storyboard panels or camera collage. One clean cinematic establishing reference image for repeated multimodal @Image use.${redoRequested ? " REDO REQUEST: create a genuinely new sample instead of returning the previous pixels; preserve the environment identity and layout while refreshing the camera presentation and secondary lighting detail." : ""}`;
      let generatedUrl = "";
      let generatedBlob: Blob | null = null;
      let generatedRemoteUrl = "";
      if (agentConfigs.image.adapter !== "horde") {
        const asset = await pollinationsMedia("image", prompt, 850 + index, { imageAspect: aspect, variationSeed });
        const uploadKey = agentConfigs.image.adapter === "pollinations" ? agentKey("image") : agentConfigs.video.adapter === "pollinations" ? agentKey("video") : "";
        generatedRemoteUrl = "remoteUrl" in asset && asset.remoteUrl ? asset.remoteUrl : uploadKey ? await uploadPollinationsMedia(asset.blob, `scene-blueprint-${sceneAsset.id}.png`, uploadKey) : "";
        generatedUrl = asset.url;
        generatedBlob = asset.blob;
      } else {
        const referenceScene: Scene = { id: uid(), title: sceneAsset.name, visual: prompt, action: "静态空场景设定", shot: "场景设定图", camera: "固定建立镜头", dialogue: "", speaker: "", emotion: "中性", sfx: "", characters: [], duration: 4, environmentKey: sceneAsset.environmentKey, environmentBible: sceneAsset.description, status: "painting" };
        generatedUrl = await makeImage(referenceScene, 850 + index, run, "", aspect, prompt);
        const response = await fetch(generatedUrl);
        if (response.ok) generatedBlob = await response.blob();
      }
      if (autoAdopt && generatedBlob) {
        const file = new File([generatedBlob], `${sceneAsset.name}-场景设定.png`, { type: generatedBlob.type || "image/png" });
        const saved = sceneAsset.libraryAssetId
          ? await attachLibraryFileToPlaceholder(sceneAsset.libraryAssetId, file, "ai")
          : await saveLibraryFile(file, { name: sceneAsset.name, category: "scene", tags: ["AI生成", "场景设定", sceneAsset.environmentKey], identityKey: `scene:${sceneAsset.environmentKey}`, entityId: sceneAsset.environmentKey, locked: true, reusable: true });
        await updateLibraryAsset(saved.id, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "ai", identityKey: `scene:${sceneAsset.environmentKey}`, entityId: sceneAsset.environmentKey });
        updateSceneAsset(sceneAsset.id, { libraryAssetId: saved.id, imageUrl: saved.url || generatedUrl, remoteUrl: generatedRemoteUrl, reviewDecision: "approved", status: "ready" });
        recordActivity("image", `场景“${sceneAsset.name}”已一键生成并进入资产库；后续分镜按 environmentKey 引用`, "done");
      } else {
        updateSceneAsset(sceneAsset.id, { imageUrl: generatedUrl, remoteUrl: generatedRemoteUrl, reviewDecision: "pending", status: "ready" });
        recordActivity("image", `场景“${sceneAsset.name}”已生成，等待用户采用或上传替换`, "done");
      }
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "场景资产生成失败";
      updateSceneAsset(sceneAsset.id, { status: "error" });
      setError(message);
      recordActivity("image", `场景“${sceneAsset.name}”生成失败：${message}`, "error");
      if (autoAdopt) throw new Error(message);
      return false;
    } finally { if (!autoAdopt) setAssetAction(""); }
  }

  async function generateAllMissingBlueprints() {
    if (assetAction || batchAssetGenerationRef.current) return;
    batchAssetGenerationRef.current = true;
    setAssetAction("pair-assets");
    setError("");
    let paired;
    try {
      paired = await pairExistingBlueprintAssets();
    } catch (reason) {
      batchAssetGenerationRef.current = false;
      setAssetAction("");
      setError(reason instanceof Error ? reason.message : "生成前资产配对失败");
      return;
    }
    const missingCharacters = paired.characters.filter((item) => isVisualCharacterAsset(item) && !item.imageUrl);
    const missingProps = paired.props.filter((item) => !item.imageUrl);
    const missingScenes = paired.scenes.filter((item) => !item.imageUrl);
    if (!missingCharacters.length && !missingProps.length && !missingScenes.length) {
      batchAssetGenerationRef.current = false;
      setAssetAction("");
      setStatusText("资产配对后图片已经齐全，未调用生图模型");
      return;
    }
    setAssetAction("batch-generate");
    recordActivity("image", `开始补齐 ${missingCharacters.length} 套人物造型、${missingScenes.length} 个场景和 ${missingProps.length} 个道具；每一项都会在调用生图模型前再次检索全资产库，只有确实缺失的才生成`);
    try {
      let attempted = 0;
      const total = missingCharacters.length + missingScenes.length + missingProps.length;
      const failures: string[] = [];
      const runMissingAsset = async (label: string, task: Promise<boolean | undefined>) => {
        try {
          await withStageProgress(
            task,
            210000,
            `${label}生成超过 210 秒，已停止等待；请检查生图模型接口后重试`,
            (elapsedSeconds) => setStatusText(`一键生成缺失资产 ${attempted + 1}/${total}：${label}（已等待 ${elapsedSeconds} 秒，请勿重复启动）`),
          );
        } catch (reason) {
          failures.push(`${label}：${reason instanceof Error ? reason.message : "生成失败"}`);
        } finally {
          attempted += 1;
        }
      };
      for (const character of missingCharacters) {
        setStatusText(`一键生成缺失资产 ${attempted + 1}/${total}：人物“${character.name}”`);
        await runMissingAsset(`人物“${character.name}”`, generateCharacterBlueprint(character, true));
      }
      for (const prop of missingProps) {
        setStatusText(`一键生成缺失资产 ${attempted + 1}/${total}：道具“${prop.name}”`);
        await runMissingAsset(`道具“${prop.name}”`, generatePropBlueprint(prop, propAssets.findIndex((item) => item.id === prop.id), true));
      }
      for (const sceneAsset of missingScenes) {
        setStatusText(`一键生成缺失资产 ${attempted + 1}/${total}：场景“${sceneAsset.name}”`);
        await runMissingAsset(`场景“${sceneAsset.name}”`, generateSceneBlueprint(sceneAsset, sceneAssets.findIndex((item) => item.id === sceneAsset.id), true));
      }
      if (failures.length) {
        const summary = `批量补齐结束：成功 ${total - failures.length}/${total}，失败 ${failures.length}；失败原因已写入制作记录`;
        setStatusText(summary);
        setError(failures.join("\n"));
        setImportMessage("已有资产仍会保留；失败项目不会被假装成已完成，可修正模型配置后重新运行");
        recordActivity("image", `${summary}。${failures.slice(0, 3).join("；")}`, "error");
      } else {
        setStatusText(`一键补齐完成：成功 ${total}/${total}；命中已有资产的项目未调用生图模型`);
        setImportMessage("已保留并复用资产库已有图片，只为二次检索后仍缺失的人物、场景和道具调用 AI");
        recordActivity("image", `批量补齐完成：${total} 项缺失资产均已生成并入库`, "done");
      }
    } finally {
      batchAssetGenerationRef.current = false;
      setAssetAction("");
    }
  }

  async function runAssetPairingOnly() {
    if (assetAction) return;
    setAssetAction("pair-assets");
    setError("");
    try {
      const result = await pairExistingBlueprintAssets(characters, propAssets, sceneAssets, { allowCharacterLookCandidates: true });
      setStatusText(result.lookCandidateCount ? `已找到 ${result.lookCandidateCount} 项同人物候选，请逐项预览并确认造型；不合适可删除后再上传或生成` : result.missing ? `资产配对完成，还有 ${result.missing} 项可选择上传或交给 AI 生成` : "资产配对完成，全部使用已有资产，无需生图");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产配对失败");
    } finally {
      setAssetAction("");
    }
  }

  async function approvePropBlueprint(prop: PropAsset) {
    if (!prop.imageUrl) return;
    updatePropAsset(prop.id, { reviewDecision: "approved", status: "ready" });
    if (prop.libraryAssetId) {
      try {
        const response = await fetch(prop.imageUrl);
        if (!response.ok) throw new Error("无法读取待采用的道具图片");
        const blob = await response.blob();
        await attachLibraryFileToPlaceholder(prop.libraryAssetId, new File([blob], `${prop.name}.png`, { type: blob.type || "image/png" }), "ai");
        await updateLibraryAsset(prop.libraryAssetId, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "ai" });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "道具资产入库失败");
        return;
      }
    } else {
      autoArchive(prop.imageUrl, prop.name, "prop", 5, ["用户批准", "重要道具", prop.name, `asset:prop:${stableReuseToken(`${prop.name}|${prop.description}`)}`], { displayName: prop.name, identityKey: prop.name, entityId: prop.name, variantName: "基础版" });
    }
    recordActivity("director", `道具“${prop.name}”已采用并进入资产库`, "done");
  }

  function rejectPropBlueprint(prop: PropAsset) {
    if (prop.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(prop.imageUrl);
    updatePropAsset(prop.id, { imageUrl: undefined, remoteUrl: undefined, reviewDecision: "rejected", status: "queued" });
  }

  async function approveSceneBlueprint(sceneAsset: SceneAsset) {
    if (!sceneAsset.imageUrl) return;
    updateSceneAsset(sceneAsset.id, { reviewDecision: "approved", status: "ready" });
    try {
      const response = await fetch(sceneAsset.imageUrl);
      if (!response.ok) throw new Error("无法读取待采用的场景图片");
      const blob = await response.blob();
      if (sceneAsset.libraryAssetId) {
        await attachLibraryFileToPlaceholder(sceneAsset.libraryAssetId, new File([blob], `${sceneAsset.name}-场景设定.png`, { type: blob.type || "image/png" }), "ai");
        await updateLibraryAsset(sceneAsset.libraryAssetId, { canonical: true, reusable: true, locked: true, assetState: "ready", sourceChoice: "ai", identityKey: `scene:${sceneAsset.environmentKey}`, entityId: sceneAsset.environmentKey });
      } else {
        const file = new File([blob], `${sceneAsset.name}-场景设定.png`, { type: blob.type || "image/png" });
        const saved = await saveLibraryFile(file, { name: sceneAsset.name, category: "scene", tags: ["用户批准", "场景设定", sceneAsset.environmentKey], identityKey: `scene:${sceneAsset.environmentKey}`, entityId: sceneAsset.environmentKey, locked: true, reusable: true });
        updateSceneAsset(sceneAsset.id, { libraryAssetId: saved.id, imageUrl: saved.url || sceneAsset.imageUrl });
      }
      recordActivity("director", `场景“${sceneAsset.name}”已采用并进入资产库`, "done");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "场景资产入库失败"); }
  }

  function rejectSceneBlueprint(sceneAsset: SceneAsset) {
    if (sceneAsset.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(sceneAsset.imageUrl);
    updateSceneAsset(sceneAsset.id, { imageUrl: undefined, remoteUrl: undefined, reviewDecision: "rejected", status: "queued" });
  }

  async function importScriptFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      let content = text.trim();
      if (file.name.toLowerCase().endsWith(".json")) {
        const payload = JSON.parse(text) as Record<string, unknown>;
        content = String(payload.script || payload.story || payload.premise || payload.content || "").trim();
      }
      if (content.length < 8) throw new Error("剧本内容太短或文件格式不正确");
      setStory(content);
      setScriptImported(true);
      setScenes([]);
      setSelected(0);
      setExportUrl("");
      await analyzeScriptAssetBlueprint(content, file.name);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本导入失败");
    }
  }

  async function importStoryboardFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as Record<string, unknown>;
      const storyboard = parseStoryboard(text, Number(payload.duration) || productionDuration, 1);
      const rawScenes = Array.isArray(payload.scenes) ? payload.scenes as Array<Record<string, unknown>> : [];
      const rawCharacters = Array.isArray(payload.characters) ? payload.characters as Array<Record<string, unknown>> : [];
      const rawProps = Array.isArray(payload.props) ? payload.props as Array<Record<string, unknown>> : Array.isArray(payload.propAssets) ? payload.propAssets as Array<Record<string, unknown>> : [];
      const importedScenes = storyboard.scenes.map((scene, index) => {
        const source = rawScenes[index] || {};
        const imageUrl = String(source.imageUrl || source.image || "");
        const videoUrl = String(source.videoUrl || source.video || "");
        const audioUrl = String(source.audioUrl || source.audio || "");
        return { ...scene, imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined, videoUrl: /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined, audioUrl: /^https?:\/\//i.test(audioUrl) ? audioUrl : undefined, status: imageUrl || videoUrl || audioUrl ? "ready" as SceneStatus : "queued" as SceneStatus };
      });
      const importedCharacters = storyboard.characters.map((character, index) => {
        const reference = String(rawCharacters[index]?.imageUrl || rawCharacters[index]?.reference || "");
        return { ...character, imageUrl: /^https?:\/\//i.test(reference) ? reference : undefined, remoteUrl: /^https?:\/\//i.test(reference) ? reference : undefined, sheetVersion: reference ? 2 as const : undefined, status: reference ? "ready" as const : character.status };
      });
      const importedProps = rawProps.slice(0, 40).map((item) => {
        const reference = String(item.imageUrl || item.reference || "");
        const importance = ["hero", "recurring", "story"].includes(String(item.importance)) ? String(item.importance) as PropAsset["importance"] : "story";
        return { id: uid(), name: String(item.name || "未命名道具").slice(0, 60), description: String(item.description || "等待补充道具外观、材质、尺寸和状态").slice(0, 360), importance, reason: String(item.reason || "分镜文件中的重要道具").slice(0, 180), imageUrl: /^https?:\/\//i.test(reference) ? reference : undefined, remoteUrl: /^https?:\/\//i.test(reference) ? reference : undefined, reviewDecision: reference ? "approved" as const : undefined, status: reference ? "ready" as const : "queued" as const };
      });
      setProjectTitle(String(payload.title || storyboard.title).slice(0, 60));
      if (payload.premise || payload.story) { setStory(String(payload.premise || payload.story).slice(0, 50000)); setScriptImported(true); }
      if (payload.aspect === "9:16" || payload.aspect === "16:9") setAspect(payload.aspect);
      if (typeof payload.style === "string" && STYLE_PROMPTS[payload.style]) setStyle(payload.style);
      setMusicPrompt(String(payload.music || storyboard.music));
      setCharacters(importedCharacters);
      setPropAssets(importedProps);
      setAssetAnalysisState(importedCharacters.length || importedProps.length ? "ready" : "idle");
      setScenes(assignSpatialLayouts(importedScenes));
      setSelected(0);
      setPhase("ready");
      setProgress(15);
      setError("");
      invalidateExport();
      setImportMessage(`已导入 ${importedScenes.length} 个分镜；编剧和导演步骤会自动跳过`);
      recordActivity("writer", "用户分镜已导入，编剧步骤已跳过", "done");
      recordActivity("director", "使用用户锁定分镜，导演复核步骤已跳过", "done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜导入失败");
    }
  }

  async function importProductionAssets(files: FileList | null) {
    if (!files?.length) return;
    try {
      setImportMessage("正在保存资产到独立资产库…");
      const imported: LibraryAsset[] = [];
      for (const file of Array.from(files).slice(0, 40)) {
        const category: LibraryAssetCategory = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : /角色|人物|character|turnaround|三视图|四视图/i.test(file.name) ? "character" : "scene";
        imported.push(await saveLibraryFile(file, { category }));
      }
      applyLibraryAssets(imported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产导入失败");
    }
  }

  function replaceSceneMedia(scene: Scene, kind: "image" | "video" | "audio", file?: File) {
    if (!file) return;
    const field = kind === "image" ? "imageUrl" : kind === "video" ? "videoUrl" : "audioUrl";
    const previous = scene[field];
    if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    const reviewField = kind === "image" ? "imageReviewDecision" : kind === "video" ? "videoReviewDecision" : "audioReviewDecision";
    patchSceneReview(scene.id, { [field]: url, [reviewField]: "approved", ...(kind === "video" ? { candidateVideoUrl: undefined } : {}), status: "ready", model: "本地导入" });
    recordActivity("editor", `已为“${scene.title}”替换${kind === "image" ? "画面" : kind === "video" ? "视频" : "配音"}`, "done");
  }

  async function extractVoiceProfileFromScene(scene: Scene) {
    if (!scene.videoUrl || !scene.speaker.trim()) return;
    setAssetAction(`voice-extract:${scene.id}`);
    setError("");
    setStatusText(`正在从“${scene.title}”的视频中摘取 ${scene.speaker} 音色`);
    try {
      const videoResponse = await fetch(scene.videoUrl);
      if (!videoResponse.ok) throw new Error("无法读取当前镜头视频");
      const videoBlob = await videoResponse.blob();
      const duration = Math.max(2, Math.min(14, scene.duration));
      let audioBlob: Blob | null = null;
      if (validAgentEndpoint(bridgeUrl)) {
        try {
          const form = new FormData();
          form.append("video", new File([videoBlob], `${scene.title || "scene"}.mp4`, { type: videoBlob.type || "video/mp4" }));
          form.append("speaker", scene.speaker);
          form.append("start", "0");
          form.append("duration", String(duration));
          const response = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/v1/voice-profiles/extract`, { method: "POST", headers: bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}, body: form });
          if (response.ok) {
            const data = await response.json() as { url?: string };
            if (data.url) {
              const extracted = await fetch(data.url);
              if (extracted.ok) audioBlob = await extracted.blob();
            }
          }
        } catch {
          recordActivity("voice", "本地桥接摘取不可用，正在自动改用软件内置音轨解码", "warning");
        }
      }
      if (!audioBlob) {
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(await videoBlob.arrayBuffer());
          audioBlob = audioBufferToWav(decoded, duration);
        } catch {
          const recorded = await recordVideoAudioTrack(videoBlob, duration);
          audioBlob = recorded.blob;
        } finally {
          await context.close().catch(() => undefined);
        }
      }
      const saved = await persistCanonicalVoiceProfile(scene, audioBlob, duration, characters.find((item) => item.name === scene.speaker)?.voice || voice, "video-extracted");
      if (!saved) throw new Error("当前视频没有可保存的人物音轨，或该人物已有 Canonical 音色");
      setImportMessage(`已摘取“${scene.speaker}”音色并保存到项目音色库，可在音色库试听和确认授权`);
      setStatusText(`“${scene.speaker}”音色摘取完成`);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "从视频提取人物音色失败");
    } finally {
      setAssetAction("");
    }
  }

  function safeFilename(value: string) {
    return (value || "漫镜素材").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadAsset(url: string, filename: string, fallbackExtension: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("素材读取失败");
      const blob = await response.blob();
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : blob.type.includes("jpeg") ? "jpg" : blob.type.includes("mp4") ? "mp4" : blob.type.includes("mpeg") ? "mp3" : blob.type.includes("wav") ? "wav" : blob.type.includes("webm") ? "webm" : fallbackExtension;
      saveBlob(blob, `${safeFilename(filename)}.${extension}`);
    } catch {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFilename(filename)}.${fallbackExtension}`;
      anchor.target = "_blank";
      anchor.click();
    }
  }

  function downloadScript() {
    const content = [
      `《${projectTitle || "未命名漫剧"}》`,
      `原始梗概：${story.trim()}`,
      `画面风格：${style}｜比例：${aspect}｜总时长：${totalDuration} 秒`,
      "",
      ...scenes.flatMap((scene, index) => [
        `第 ${index + 1} 镜｜${scene.title}｜${scene.duration} 秒`,
        `场景：${scene.visual}`,
        `表演：${scene.action}`,
        `镜头：${scene.shot}，${scene.camera}`,
        `对白：${scene.speaker}（${scene.emotion}）：${scene.dialogue}`,
        `声音：${scene.sfx}`,
        "",
      ]),
    ].join("\n");
    saveBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), `${safeFilename(projectTitle)}-剧本.txt`);
  }

  function downloadStoryboard() {
    const payload = { title: projectTitle, premise: story.trim(), style, aspect, duration: totalDuration, music: musicPrompt, characters: characters.map((character) => ({ id: character.id, name: character.name, role: character.role, appearance: character.appearance, voice: character.voice, status: character.status, reference: character.remoteUrl || "" })), props: propAssets.map((prop) => ({ id: prop.id, name: prop.name, description: prop.description, importance: prop.importance, reason: prop.reason, status: prop.status, reference: prop.remoteUrl || "" })), sceneAssets: sceneAssets.map((item) => ({ ...item, reference: item.remoteUrl || "" })), scenes: scenes.map(({ imageUrl, videoUrl, audioUrl, ...scene }, index) => ({ order: index + 1, ...scene, image: imageUrl?.startsWith("http") ? imageUrl : "", video: videoUrl?.startsWith("http") ? videoUrl : "", audio: audioUrl?.startsWith("http") ? audioUrl : "" })) };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFilename(projectTitle)}-分镜.json`);
  }

  function downloadProject() {
    const payload = { format: "manjing-project", version: 2, savedAt: new Date().toISOString(), projectTitle, story, style, targetDuration, aspect, frameContinuityMode, voiceEnabled, bgmEnabled, subtitleEnabled, voice, musicPrompt, subtitleScale, subtitleColor, musicVolume, assetAnalysisState, characters: characters.map(({ imageUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined })), propAssets: propAssets.map(({ imageUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined })), sceneAssets: sceneAssets.map(({ imageUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined })), scenes: scenes.map(({ imageUrl, videoUrl, audioUrl, ...item }) => ({ ...item, imageUrl: imageUrl?.startsWith("http") ? imageUrl : undefined, videoUrl: videoUrl?.startsWith("http") ? videoUrl : undefined, audioUrl: audioUrl?.startsWith("http") ? audioUrl : undefined })) };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFilename(projectTitle)}-漫镜工程.json`);
  }

  async function importProject(file?: File) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>;
      if (payload.format !== "manjing-project" || !Array.isArray(payload.scenes)) throw new Error("这不是有效的漫镜工程文件");
      const importedScenes = (payload.scenes as Scene[]).slice(0, 50).map((scene, index) => ({ ...scene, id: uid(), title: String(scene.title || `镜头 ${index + 1}`), duration: Math.max(1, Math.min(30, Number(scene.duration) || 6)), status: scene.imageUrl || scene.videoUrl ? "ready" as SceneStatus : "queued" as SceneStatus }));
      setProjectTitle(String(payload.projectTitle || "导入的漫镜工程").slice(0, 60));
      setStory(String(payload.story || "导入工程的故事梗概"));
      setScriptImported(true);
      if (typeof payload.style === "string" && STYLE_PROMPTS[payload.style]) setStyle(payload.style);
      if (payload.aspect === "9:16" || payload.aspect === "16:9") setAspect(payload.aspect);
      if (payload.frameContinuityMode) setFrameContinuityMode("identity-first");
      setTargetDuration(Number(payload.targetDuration) || 0);
      setScenes(assignSpatialLayouts(importedScenes));
      const importedCharacters = deduplicateCharacterAssets(Array.isArray(payload.characters) ? (payload.characters as CharacterAsset[]).slice(0, 40).map((item) => ({ ...item, id: uid() })) : []);
      setCharacters(importedCharacters);
      const importedProps = Array.isArray(payload.propAssets) ? (payload.propAssets as PropAsset[]).slice(0, 40).map((item) => ({ ...item, id: uid() })) : [];
      setPropAssets(importedProps);
      const importedSceneAssets = Array.isArray(payload.sceneAssets) ? (payload.sceneAssets as SceneAsset[]).slice(0, 30).filter((item) => isReusableSceneAssetCandidate(item.environmentKey, item.name)).map((item, index) => ({ ...item, id: uid(), name: localizedSceneDisplayName(item, index) })) : [];
      setSceneAssets(importedSceneAssets);
      setAssetAnalysisState(importedProps.length || importedSceneAssets.length || importedCharacters.length ? "ready" : "idle");
      setMusicPrompt(String(payload.musicPrompt || ""));
      setSubtitleScale(Math.max(0.7, Math.min(1.6, Number(payload.subtitleScale) || 1)));
      setSubtitleColor(typeof payload.subtitleColor === "string" ? payload.subtitleColor : "#ffffff");
      setMusicVolume(Math.max(0, Math.min(0.8, Number(payload.musicVolume) || 0.16)));
      setSelected(0);
      setTime(0);
      setPhase("ready");
      setError("");
      invalidateExport();
      recordActivity("editor", `已导入工程，共 ${importedScenes.length} 个镜头`, "done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工程文件导入失败");
    }
  }

  function seek(value: number) {
    setPlaying(false);
    setTime((value / 100) * totalDuration);
  }

  async function loadVisual(scene: Scene) {
    if (scene.videoUrl) {
      const video = document.createElement("video");
      video.src = scene.videoUrl;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.playbackRate = scene.speed || 1;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("动态镜头加载失败"));
      });
      return video;
    }
    if (!scene.imageUrl) throw new Error(`“${scene.title}”还没有生成画面`);
    const image = new Image();
    image.src = scene.imageUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("生成图片加载失败"));
    });
    return image;
  }

  async function exportFilm(sourceScenes: Scene[] = scenes, automatic = false, sourceMusicUrl = musicUrl) {
    const movieScenes = sourceScenes;
    if (pendingReviewCount > 0) {
      setError(`还有 ${pendingReviewCount} 项素材等待逐项审核；请先批准或删除这些素材，再合成成片`);
      setStatusText("成片合成已暂停，等待逐项审核完成");
      return false;
    }
    if (!movieScenes.length || !movieScenes.every((scene) => scene.imageUrl || scene.videoUrl)) {
      setError("请先为所有镜头生成画面");
      return false;
    }
    if (!("MediaRecorder" in window)) {
      setError("当前浏览器不支持视频导出，请使用最新版 Chrome 或 Edge");
      return false;
    }
    const movieOffsets = movieScenes.map((_, index) => movieScenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0));
    const movieDuration = movieScenes.reduce((sum, item) => sum + item.duration, 0);
    const exportRun = runRef.current;
    let activeStream: MediaStream | null = null;
    let activeAudioContext: AudioContext | null = null;
    let activeRecorder: MediaRecorder | null = null;
    let activeVisuals: Array<HTMLImageElement | HTMLVideoElement> = [];
    setPlaying(false);
    setShowFilm(false);
    setPhase("exporting");
    setExportProgress(0);
    setError("");
    if (!automatic) setStatusText("正在重新剪辑漫剧成片");
    try {
      const landscapeSize = videoResolution === "1080p" ? [1920, 1080] : videoResolution === "480p" ? [854, 480] : [1280, 720];
      const width = aspect === "9:16" ? landscapeSize[1] : landscapeSize[0];
      const height = aspect === "9:16" ? landscapeSize[0] : landscapeSize[1];
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建视频画布");
      const visuals: Array<HTMLImageElement | HTMLVideoElement> = [];
      for (let index = 0; index < movieScenes.length; index += 1) {
        if (runRef.current !== exportRun) throw new Error("导出已取消");
        setStatusText(`正在加载剪辑素材 ${index + 1}/${movieScenes.length}`);
        visuals.push(await loadVisual(movieScenes[index]));
        if (index % 2 === 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      activeVisuals = visuals;
      const audioContext = new AudioContext();
      activeAudioContext = audioContext;
      const destination = audioContext.createMediaStreamDestination();
      const nativeAudioNodes: MediaElementAudioSourceNode[] = [];
      visuals.forEach((visual, index) => {
        if (!(visual instanceof HTMLVideoElement) || (voiceEnabled && Boolean(movieScenes[index].audioUrl))) return;
        try {
          visual.muted = false;
          const source = audioContext.createMediaElementSource(visual);
          const gain = audioContext.createGain();
          gain.gain.value = Math.max(0, Math.min(2, movieScenes[index].volume ?? 1));
          source.connect(gain).connect(destination);
          nativeAudioNodes.push(source);
        } catch {
          visual.muted = true;
        }
      });
      const buffers: Array<AudioBuffer | null> = [];
      for (let index = 0; index < movieScenes.length; index += 1) {
        if (runRef.current !== exportRun) throw new Error("导出已取消");
        const scene = movieScenes[index];
          if (!voiceEnabled || !scene.audioUrl) buffers.push(null);
        else {
          const response = await fetch(scene.audioUrl);
          if (!response.ok) throw new Error(`无法读取第 ${index + 1} 个镜头的配音`);
          buffers.push(await audioContext.decodeAudioData(await response.arrayBuffer()));
        }
        if (index % 2 === 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      const soundtrackBuffer = sourceMusicUrl
        ? await audioContext.decodeAudioData(await (await fetch(sourceMusicUrl)).arrayBuffer())
        : null;
      const canvasStream = canvas.captureStream(30);
      const stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
      activeStream = stream;
      const choices = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      const mimeType = choices.find((choice) => MediaRecorder.isTypeSupported(choice)) || "";
      const bitrate = videoResolution === "1080p" ? 10_000_000 : videoResolution === "480p" ? 3_000_000 : 6_000_000;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: bitrate } : undefined);
      activeRecorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.start(500);
      await audioContext.resume();
      const audioStart = audioContext.currentTime + 0.12;
      let audioOffset = 0;
      buffers.forEach((buffer, index) => {
        if (buffer) {
          const source = audioContext.createBufferSource();
          const voiceGain = audioContext.createGain();
          source.buffer = buffer;
          voiceGain.gain.value = Math.max(0, Math.min(2, movieScenes[index].volume ?? 1));
          source.connect(voiceGain).connect(destination);
          source.start(audioStart + audioOffset);
        }
        audioOffset += movieScenes[index].duration;
      });
      if (soundtrackBuffer) {
        const soundtrack = audioContext.createBufferSource();
        const soundtrackGain = audioContext.createGain();
        soundtrack.buffer = soundtrackBuffer;
        soundtrack.loop = soundtrackBuffer.duration < movieDuration;
        soundtrackGain.gain.value = Math.max(0, Math.min(0.8, musicVolume));
        soundtrack.connect(soundtrackGain).connect(destination);
        soundtrack.start(audioStart);
        soundtrack.stop(audioStart + movieDuration);
      }
      const started = performance.now() + 120;
      let visualIndex = -1;
      await new Promise<void>((resolve, reject) => {
        const render = (now: number) => {
          if (runRef.current !== exportRun) {
            reject(new Error("导出已取消"));
            return;
          }
          const elapsed = Math.max(0, (now - started) / 1000);
          if (elapsed >= movieDuration) {
            resolve();
            return;
          }
          const index = Math.max(0, movieScenes.findIndex((scene, sceneIndex) => elapsed >= movieOffsets[sceneIndex] && elapsed < movieOffsets[sceneIndex] + scene.duration));
          const scene = movieScenes[index];
          const local = (elapsed - movieOffsets[index]) / scene.duration;
          const visual = visuals[index];
          if (index !== visualIndex) {
            visuals.forEach((item, itemIndex) => {
              if (item instanceof HTMLVideoElement && itemIndex !== index) item.pause();
            });
            if (visual instanceof HTMLVideoElement) {
              visual.currentTime = 0;
              void visual.play().catch(() => undefined);
            }
            visualIndex = index;
          }
          ctx.fillStyle = "#0d0b12";
          ctx.fillRect(0, 0, width, height);
          const transitionMode = scene.transition || "fade";
          const transitionSeconds = transitionMode === "flash" ? 0.12 : Math.min(0.35, Math.max(0.18, scene.duration * 0.05));
          const transitionProgress = index === 0 || transitionMode === "cut"
            ? 1
            : Math.min(1, (local * scene.duration) / transitionSeconds);
          const transition = transitionProgress * transitionProgress * (3 - 2 * transitionProgress);
          const filter = scene.filter === "warm" ? "sepia(.14) saturate(1.12)" : scene.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : scene.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";
          if (index > 0 && transition < 1) {
            const previous = movieScenes[index - 1];
            ctx.save();
            ctx.filter = previous.filter === "warm" ? "sepia(.14) saturate(1.12)" : previous.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : previous.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";
            drawMovingShot(ctx, visuals[index - 1], width, height, index - 1, 1, 1, previous.motion, previous.motionIntensity);
            ctx.restore();
          }
          ctx.save();
          ctx.filter = filter;
          drawMovingShot(ctx, visual, width, height, index, local, transition, scene.motion, scene.motionIntensity);
          ctx.restore();
          if (transitionMode === "flash" && local < 0.14) {
            ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.75 - local * 5.3)})`;
            ctx.fillRect(0, 0, width, height);
          }
          const shade = ctx.createLinearGradient(0, height * 0.48, 0, height);
          shade.addColorStop(0, "rgba(9,7,12,0)");
          shade.addColorStop(1, "rgba(9,7,12,.88)");
          ctx.fillStyle = shade;
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "rgba(255,255,255,.72)";
          ctx.font = `${Math.round(width * 0.022)}px Microsoft YaHei, sans-serif`;
          ctx.fillText(`${String(index + 1).padStart(2, "0")}  ${scene.title}`, width * 0.07, height * 0.09);
          if (subtitleEnabled && scene.subtitleEnabled !== false && scene.dialogue) {
            const subtitleY = scene.subtitlePosition === "top" ? height * 0.18 : scene.subtitlePosition === "center" ? height * 0.5 : height * 0.86;
            ctx.textAlign = "center";
            ctx.fillStyle = subtitleColor;
            ctx.font = `600 ${Math.round(width * 0.044 * subtitleScale)}px Microsoft YaHei, sans-serif`;
            ctx.shadowColor = "rgba(0,0,0,.92)";
            ctx.shadowBlur = Math.round(width * 0.012);
            wrapCanvasText(ctx, `“${scene.dialogue}”`, width / 2, subtitleY, width * 0.78, width * 0.06 * subtitleScale, 3);
            ctx.shadowBlur = 0;
          }
          ctx.textAlign = "left";
          setExportProgress(Math.min(99, Math.round((elapsed / movieDuration) * 100)));
          requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
      });
      recorder.stop();
      await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      activeRecorder = null;
      visuals.forEach((item) => { if (item instanceof HTMLVideoElement) item.pause(); });
      stream.getTracks().forEach((track) => track.stop());
      activeStream = null;
      await audioContext.close();
      activeAudioContext = null;
      const finalType = recorder.mimeType || "video/webm";
      const blob = new Blob(chunks, { type: finalType });
      const finalExtension = finalType.includes("mp4") ? "mp4" : "webm";
      const finalAsset = await saveLibraryFile(new File([blob], `${safeFilename(projectTitle)}-最终成片.${finalExtension}`, { type: finalType }), { name: `${projectTitle || "未命名漫剧"}-最终成片`, category: "video", duration: movieDuration, tags: ["最终成片", "生成记录", `作品:${projectTitle || "未命名漫剧"}`], reusable: false, locked: true });
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
      setShowFilm(true);
      setExportProgress(100);
      setProgress(100);
      setPhase("ready");
      setStatusText(buffers.some(Boolean) ? `AI 漫剧已生成，动态镜头、字幕、配音${soundtrackBuffer ? "和配乐" : ""}均已写入` : "免费流程样片已生成，可直接播放或下载");
      await syncScenesToEditor(movieScenes, url, "studio");
      try {
        const active = JSON.parse(localStorage.getItem("manjing-active-series-context-v1") || "{}") as { projectId?: string; episodeId?: string; episodeNumber?: number };
        if (active.projectId) appendSeriesProductionRecord(active.projectId, { episodeId: active.episodeId, episodeNumber: active.episodeNumber, title: projectTitle || "未命名漫剧", duration: movieDuration, assetId: finalAsset.id, editorProjectId: editorProjectIdRef.current, status: "completed" });
      } catch { /* Final asset remains safely archived even if the project record is unavailable. */ }
      return true;
    } catch (reason) {
      if (runRef.current !== exportRun) {
        setPhase(movieScenes.length ? "ready" : "idle");
        setStatusText("已停止视频合成，现有镜头和素材均已保留");
        return false;
      }
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "视频导出失败");
      return false;
    } finally {
      activeVisuals.forEach((item) => { if (item instanceof HTMLVideoElement) item.pause(); });
      activeStream?.getTracks().forEach((track) => track.stop());
      if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop();
      if (activeAudioContext && activeAudioContext.state !== "closed") await activeAudioContext.close().catch(() => undefined);
    }
  }

  async function downloadFilm() {
    if (!exportUrl) return;
    const response = await fetch(exportUrl);
    if (!response.ok) throw new Error("成片文件读取失败");
    const blob = await response.blob();
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    saveBlob(blob, `${safeFilename(projectTitle || "漫镜作品")}.${extension}`);
  }

  const busy = Boolean(retryingRole) || Boolean(sceneAction) || libtvRunning || !["idle", "ready", "error"].includes(phase);
  const visibleProgress = phase === "exporting" ? exportProgress : progress;
  const failedRole = AGENT_ROLES.find((role) => activityByRole[role.id]?.state === "error")?.id;
  const selectedScene = scenes[selected];
  const nativeVideoEnabled = agentConfigs.video.adapter !== "browser";
  const generatedVoiceEnabled = agentConfigs.voice.adapter !== "browser";
  const freeTeamActive = AGENT_ROLES.every(({ id }) => agentConfigs[id].preset === AGENT_PRESETS[id][0].id);
  const recommendedTeamActive = AGENT_ROLES.every(({ id }) => agentConfigs[id].preset === AGENT_PRESETS[id][1].id);
  const previewFilter = current?.filter === "warm" ? "sepia(.14) saturate(1.12)" : current?.filter === "cool" ? "hue-rotate(176deg) saturate(.9) brightness(.96)" : current?.filter === "mono" ? "grayscale(1) contrast(1.1)" : "none";
  const pendingCharacterReviews = characters.filter((item) => item.imageUrl && item.reviewDecision === "pending");
  const pendingImageReviews = scenes.filter((item) => item.imageUrl && item.imageReviewDecision === "pending");
  const pendingVideoReviews = scenes.filter((item) => item.candidateVideoUrl && item.videoReviewDecision === "pending");
  const pendingAudioReviews = scenes.filter((item) => item.audioUrl && item.audioReviewDecision === "pending");
  const pendingMusicReviews = musicUrl && musicReviewDecision === "pending" ? 1 : 0;
  const pendingReviewCount = pendingCharacterReviews.length + pendingImageReviews.length + pendingVideoReviews.length + pendingAudioReviews.length + pendingMusicReviews;
  const sequentialVideoPlan = planSequentialVideo(scenes);
  const trustedPortraitRequired = styleRequiresTrustedPortrait(visualStyle(style).category);
  const activePortraitBlock = trustedPortraitRequired && seedancePortraitBlock?.projectId === activeAssetProjectId()
    ? seedancePortraitBlock
    : null;

  useEffect(() => {
    if (!sequentialResumeToken) return;
    const timeout = window.setTimeout(() => {
      const nextPlan = planSequentialVideo(scenes);
      if (nextPlan.kind === "review") return;
      if (nextPlan.kind === "generate") void rerunRole("video");
      else void generateAll();
    }, 250);
    return () => window.clearTimeout(timeout);
    // Only an approval token may start another paid generation. Depending on
    // scene/function identities here would replay the request on ordinary renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequentialResumeToken]);

  useEffect(() => {
    if (!agentTeamLoaded || busy || !scenes.length || activePortraitBlock || portraitResumeStartedRef.current) return;
    const resumeAssetId = window.localStorage.getItem("manjing-studio-resume-video-after-portrait-v1");
    if (!resumeAssetId) return;
    portraitResumeStartedRef.current = true;
    window.localStorage.removeItem("manjing-studio-resume-video-after-portrait-v1");
    setStatusText("可信人物授权已完成，正在从中断镜头恢复视频生成");
    const timeout = window.setTimeout(() => void rerunRole("video"), 350);
    return () => window.clearTimeout(timeout);
    // This one-shot flag is written only after the user completes Ark's actor
    // authorization flow. Ordinary renders must never replay a paid request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentTeamLoaded, busy, scenes.length, activePortraitBlock]);

  return (
    <main id="top" className={`${surface}-surface`}>
      <SiteNav current="studio" />
      <StudioProjectBinding />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">真实生成 · 真实播放 · 真实导出</p>
          <h1>把一句故事，<br /><em>做成能播放的漫剧。</em></h1>
          <p className="subhead">先锁定角色，再生成连续表演：剧本、角色资产、分镜视频、分角色配音、配乐与自动剪辑组成一条真实漫剧生产线。</p>
          <a className="hero-cta" href="#studio">开始创作 <span>↘</span></a>
        </div>
        <div className="hero-card" aria-hidden="true">
          <div className="card-number">01 — 04</div>
          <div className="card-scene"><div className="card-moon" /><div className="card-rain" /><b>雨夜重逢</b><p>“这一次，别再错过了。”</p></div>
          <div className="card-track"><span /><span /><span /><span /></div>
        </div>
      </section>

      <section id="studio" className="studio section-shell">
        <div className="section-heading"><span>01</span><div><p>创作输入</p><h2>先告诉 AI，你想讲什么</h2></div></div>
        <div className="creation-grid">
          <div className="story-panel">
            <label htmlFor="story">故事梗概</label>
            <textarea id="story" value={story} onChange={(event) => setStory(event.target.value)} maxLength={50000} placeholder="输入故事梗概，或者在下方直接导入完整剧本……" />
            <div className="text-meta"><button onClick={() => { setStory("末班地铁上，女孩发现对面的乘客竟是十年后的自己。车门打开前，她只有三分钟改变人生。"); setScriptImported(false); }}>换一个灵感</button><span>{story.length} / 50000</span></div>
          </div>
          <div className="settings-panel">
            <section className={`studio-voice-setting ${voiceEnabled ? "enabled" : "disabled"}`}>
              <header>
                <div><span>一键配音</span><b>一键漫剧自动配音</b><small>{voiceEnabled ? "已开启 · 生成分角色对白并写入最终成片" : "已关闭 · 不生成人物对白/旁白，仍保留环境音与背景音乐设置"}</small></div>
                <button type="button" className={`toggle ${voiceEnabled ? "on" : ""}`} aria-label="一键漫剧自动配音" aria-pressed={voiceEnabled} onClick={() => setVoiceEnabled((value) => !value)}><i /></button>
              </header>
              <div className="studio-voice-provider"><span>当前配音岗位</span><b>{agentName("voice")}</b><em>{generatedVoiceEnabled ? "生成可下载音轨" : "仅设备语音预览"}</em></div>
              {voiceEnabled && generatedVoiceEnabled && <label className="studio-voice-select">默认音色<select aria-label="一键漫剧配音音色" value={voice} onChange={(event) => setVoice(event.target.value)}>{VOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
              <div className="voice-library-inline"><div><span>独立人物音色库</span><b>{voiceProfiles.filter((item) => item.canonical && item.voiceConsent !== "revoked").length} 个 Canonical 音色</b><small>按项目/剧本和公共库分组；视频全能参考会先查当前项目，再引用公共音色。</small></div><Link href="/voices">管理音色库 ↗</Link>{voiceProfiles.filter((item) => item.canonical && item.voiceConsent !== "revoked").slice(0, 3).map((profile) => <article key={profile.id}><i>声</i><span><b>{profile.identityKey}</b><small>{profile.lookName || "标准音色"} · 已引用 {profile.usageCount || 0} 次</small></span>{profile.url && <audio src={profile.url} controls preload="metadata" />}</article>)}</div>
              {voiceEnabled && !generatedVoiceEnabled && <p>免费默认配音只能在设备上预览；若要把声音写进成片，请在下方“配音 AI”岗位选择 Pollinations、CosyVoice、VibeVoice 或自定义配音接口。</p>}
            </section>
            <div className="style-library-head"><label>视觉风格</label><span>{STYLE_PRESETS.length} 种 · 默认启用角色美术指导与防同脸设计</span></div>
            <div className="style-library" role="list" aria-label="漫剧视觉风格库">{STYLE_PRESETS.map((item) => <button type="button" role="listitem" key={item.name} className={`style-card ${style === item.name ? "active" : ""}`} onClick={() => setStyle(item.name)} aria-pressed={style === item.name}>
              <img src={item.preview} alt="" loading="lazy" />
              <span><b>{item.name}</b><em>{item.category}</em></span>
              <small>{item.description}</small>
            </button>)}</div>
            <div className="duration-setting">
              <div><label htmlFor="target-duration">目标时长</label><b>{targetDuration === 0 ? "自动" : formatTime(targetDuration)}</b></div>
              <input id="target-duration" type="range" min={0} max={120} step={5} value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))} />
              <small><span>0 秒</span><span>{targetDuration === 0 ? "自动判断剧情长度" : "拖动选择成片长度"}</span><span>2 分钟</span></small>
            </div>
            <div className="aspect-setting"><label>画面比例</label><select value={aspect} onChange={(event) => setAspect(event.target.value as "9:16" | "16:9")}><option value="9:16">竖屏 9:16</option><option value="16:9">横屏 16:9</option></select></div>
            <div className="aspect-setting"><label>视频清晰度</label><select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value as "480p" | "720p" | "1080p")}><option value="480p">流畅 480P</option><option value="720p">高清 720P</option><option value="1080p">全高清 1080P</option></select></div>
            <div className="aspect-setting"><label>分镜画面继承</label><div className="locked-setting">全能参考连续性（已锁定）</div><small>只提交人物、场景、道具、音色和已批准上一镜视频作为全能参考；抽取首尾帧仅用于本地质检，绝不送入模型。</small></div>
            <div className="voice-row"><div><label>背景音乐</label><small>独立控制无歌词 BGM；关闭人物配音后仍保留环境音效</small></div><button className={`toggle ${bgmEnabled ? "on" : ""}`} aria-label="切换背景音乐" onClick={() => setBgmEnabled((value) => !value)}><i /></button></div>
            <div className="voice-row subtitle-master-row"><div><label>成片字幕</label><small>独立控制预览、时间轴和最终视频字幕，不影响配音与原声</small></div><button className={`toggle ${subtitleEnabled ? "on" : ""}`} aria-label="切换成片字幕" aria-pressed={subtitleEnabled} onClick={() => setSubtitleEnabled((value) => !value)}><i /></button></div>
          </div>
        </div>

        <div className="production-import-hub">
          <div className="production-import-heading"><div><span>导入已有素材</span><h3>已有内容直接导入，不重复生成</h3><p>剧本、分镜、角色图、场景图、视频和配音都能作为生产起点；一键流程只补齐缺少的部分。</p></div><Link href="/assets">打开独立资产库 ↗</Link></div>
          <div className="production-import-actions">
            <label><i>文</i><span><b>导入剧本</b><small>TXT / MD / JSON · 跳过原创编剧</small></span><input type="file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onChange={(event) => { void importScriptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <label><i>镜</i><span><b>导入分镜</b><small>漫镜 JSON · 跳过编剧和导演</small></span><input type="file" accept=".json,application/json" onChange={(event) => { void importStoryboardFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <label><i>资</i><span><b>导入本机资产</b><small>图片 / 视频 / 音频 · 自动分类保存</small></span><input type="file" multiple accept="image/*,video/*,audio/*" onChange={(event) => { void importProductionAssets(event.target.files); event.currentTarget.value = ""; }} /></label>
          </div>
          <div className="production-import-state"><b>{scenes.length ? `${scenes.length} 个分镜` : scriptImported ? "剧本已锁定" : "等待导入"}</b><span>{importMessage}</span><div><em className={scriptImported ? "ready" : ""}>剧本</em><em className={scenes.length ? "ready" : ""}>分镜</em><em className={characters.some((item) => item.imageUrl) ? "ready" : ""}>角色</em><em className={scenes.some((item) => item.imageUrl) ? "ready" : ""}>画面</em><em className={scenes.some((item) => item.videoUrl) ? "ready" : ""}>视频</em><em className={scenes.some((item) => item.audioUrl) ? "ready" : ""}>声音</em></div></div>
        </div>

        {scriptImported && <section className={`script-asset-blueprint ${assetAnalysisState}`}>
          <header><div><span>SCRIPT ASSET BREAKDOWN</span><h3>剧本资产框架 · 人物造型、场景与道具</h3><p>AI 先区分简介、背景故事、实际人物、对白和重要道具，同时提取可复用场景；场景图是无人物的 Canonical 空场景参考，不是分镜图，即使不用首尾帧也会供全能参考引用。</p></div><div><b>{characters.length + sceneAssets.length + propAssets.length}</b><small>项视觉资产候选</small><button onClick={() => void analyzeScriptAssetBlueprint(story, "当前剧本")} disabled={assetAnalysisState === "analyzing" || Boolean(assetAction)}>{assetAnalysisState === "analyzing" ? "正在分析…" : "重新分析"}</button></div></header>
          {assetAnalysisState === "analyzing" ? <div className="asset-blueprint-loading"><i /><b>AI 正在通读剧本</b><span>识别人物身份、换装/状态、可复用场景和剧情关键道具；此步骤不会请求生图模型。</span></div> : assetAnalysisState === "idle" ? <div className="asset-blueprint-loading"><b>尚未建立资产框架</b><button onClick={() => void analyzeScriptAssetBlueprint(story, "当前剧本")}>开始分析</button></div> : <>
            <div className="script-memory-panel"><label><span>剧本简介</span><textarea value={scriptMemory.synopsis} placeholder="AI 将提取或概括故事主线" onChange={(event) => persistScriptMemory({ synopsis: event.target.value, background: scriptMemory.background })} /></label><label><span>背景故事与世界记忆</span><textarea value={scriptMemory.background} placeholder="时代、地点、世界规则、关系与前史会持续用于后续分镜和剧集" onChange={(event) => persistScriptMemory({ synopsis: scriptMemory.synopsis, background: event.target.value })} /></label></div>
            <div className="asset-blueprint-summary"><span>人物 {new Set(characters.map(characterIdentity)).size}</span><span>本集人物造型 {characters.length}</span><span>Canonical 场景 {sceneAssets.length}</span><span>有对白人物音色 {new Set(characters.filter((item) => Boolean(item.firstDialogue || firstDialogueForCharacter(story, characterIdentity(item)))).map(characterIdentity)).size}</span><span>重要道具 {propAssets.length}</span><strong>{assetPairingSummary}</strong><em>{characters.filter((item) => item.imageUrl && item.reviewDecision !== "pending").length + sceneAssets.filter((item) => item.imageUrl && item.reviewDecision !== "pending").length + propAssets.filter((item) => item.imageUrl && item.reviewDecision !== "pending").length}/{characters.length + sceneAssets.length + propAssets.length} 已准备</em><button type="button" className="asset-pair-button" onClick={() => void runAssetPairingOnly()} disabled={Boolean(assetAction)}>{assetAction === "pair-assets" ? "正在配对…" : "先配对已有资产"}</button><button type="button" onClick={() => void generateAllMissingBlueprints()} disabled={Boolean(assetAction) || (!characters.some((item) => !item.imageUrl) && !sceneAssets.some((item) => !item.imageUrl) && !propAssets.some((item) => !item.imageUrl))}>{assetAction === "batch-generate" || assetAction.includes("-generate:") ? "正在批量生成…" : `配对后生成真正缺失项（${characters.filter((item) => !item.imageUrl).length + sceneAssets.filter((item) => !item.imageUrl).length + propAssets.filter((item) => !item.imageUrl).length}）`}</button></div>
            <div className="asset-blueprint-grid">
              {characters.map((character) => <article key={character.id} className={`asset-blueprint-card ${character.status}`}>
                <div className="asset-blueprint-preview">{character.imageUrl ? <button type="button" onClick={() => setAssetImagePreview({ url: character.imageUrl as string, name: characterAssetNaming(character).displayName })} aria-label={`预览${characterAssetNaming(character).displayName}大图`}><img src={character.imageUrl} alt={characterAssetNaming(character).displayName} /><i>点击预览</i></button> : <span><i>人</i><small>仅框架<br />尚无图片</small></span>}</div>
                <div className="asset-blueprint-fields"><em>人物造型资产 · {character.episodeScope || "当前集"}</em><input value={characterIdentity(character)} aria-label="人物身份名" placeholder="例如：男主" onChange={(event) => updateCharacterAsset(character.id, { name: event.target.value, identityName: event.target.value })} /><input value={characterLook(character)} aria-label="服装或状态造型名" placeholder="例如：白衣版" onChange={(event) => updateCharacterAsset(character.id, { lookName: event.target.value })} /><input value={character.role} aria-label="人物身份" placeholder="身份或人物关系" onChange={(event) => updateCharacterAsset(character.id, { role: event.target.value })} /><textarea value={character.appearance} aria-label="人物视觉描述" placeholder="不变的身份特征 + 当前造型的服装、妆发和状态" onChange={(event) => updateCharacterAsset(character.id, { appearance: event.target.value })} /><small>{character.visualEvidence ? `出镜依据：${character.visualEvidence}` : character.sceneHints?.length ? `使用镜头：${character.sceneHints.join("、")}` : "未指定镜头时，将按分镜文字匹配此造型"}</small></div>
                <p>{character.imageUrl ? character.assetMatchKind === "look-candidate" ? `资产库中找到同一人物候选；请确认是否符合“${characterLook(character)}”` : character.reviewDecision === "pending" ? "AI 四区角色卡待采用" : "已有可用人物资产" : "等待用户选择资产来源"}{character.referenceCardReport && <><br /><strong>{character.referenceCardReport.mode === "vision" ? `多角度质检 ${character.referenceCardReport.overall} 分` : "待人工多角度质检"} · 正脸 / 45°侧面 / 背面轮廓 / 五官 / 头身比 / 服装{character.referenceCardReport.findings[0] ? ` · ${character.referenceCardReport.findings[0]}` : ""}</strong></>}</p>
                <footer>{character.reviewDecision === "pending" && character.imageUrl ? <><button onClick={() => approveCharacterAsset(character)}>{character.assetMatchKind === "look-candidate" ? "确认造型并配对" : "采用并入库"}</button><label className={assetAction ? "disabled" : ""}>上传图片替换<input type="file" accept="image/*" disabled={Boolean(assetAction)} onChange={(event) => { void uploadCharacterBlueprint(character, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="danger" onClick={() => rejectCharacterAsset(character)}>{character.assetMatchKind === "look-candidate" ? "不匹配，移除候选" : "删除图片"}</button></> : <><label className={assetAction ? "disabled" : ""}>上传已有角色卡<input type="file" accept="image/*" disabled={Boolean(assetAction)} onChange={(event) => { void uploadCharacterBlueprint(character, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button onClick={() => void generateCharacterBlueprint(character)} disabled={Boolean(assetAction)}>{assetAction === `character-generate:${character.id}` ? "生成中…" : character.imageUrl ? "让 AI 重做四区角色卡" : "生成大头照＋正侧背三视图"}</button></>}<button className="plain-danger" onClick={() => setCharacters((items) => items.filter((item) => item.id !== character.id))} disabled={Boolean(assetAction)}>删除框架</button></footer>
              </article>)}
              {sceneAssets.map((sceneAsset, index) => <article key={sceneAsset.id} className={`asset-blueprint-card scene ${sceneAsset.status}`}>
                <div className="asset-blueprint-preview">{sceneAsset.imageUrl ? <button type="button" onClick={() => setAssetImagePreview({ url: sceneAsset.imageUrl as string, name: sceneAsset.name })} aria-label={`预览${sceneAsset.name}场景大图`}><img src={sceneAsset.imageUrl} alt={sceneAsset.name} /><i>点击预览</i></button> : <span><i>景</i><small>仅框架<br />尚无图片</small></span>}</div>
                <div className="asset-blueprint-fields"><em>Canonical 空场景 · {sceneAsset.episodeScope || "当前集"}</em><input value={sceneAsset.name} aria-label="场景中文名称" placeholder="例如：摄政王府书房" onChange={(event) => updateSceneAsset(sceneAsset.id, { name: event.target.value })} /><details className="scene-identity-key"><summary>内部复用键（通常无需修改）</summary><input value={sceneAsset.environmentKey} aria-label="场景内部复用键" placeholder="同一场景跨镜保持一致" onChange={(event) => updateSceneAsset(sceneAsset.id, { environmentKey: event.target.value })} /></details><textarea value={sceneAsset.description} aria-label="场景视觉描述" placeholder="建筑、空间布局、门窗、固定陈设、色调与光线" onChange={(event) => updateSceneAsset(sceneAsset.id, { description: event.target.value })} /><input value={sceneAsset.timeWeather} aria-label="时间天气" placeholder="时间、季节、天气与环境状态" onChange={(event) => updateSceneAsset(sceneAsset.id, { timeWeather: event.target.value })} /><small>{sceneAsset.sceneHints?.length ? `使用镜头：${sceneAsset.sceneHints.join("、")}` : sceneAsset.reason}</small></div>
                <p>{sceneAsset.imageUrl ? sceneAsset.reviewDecision === "pending" ? "AI 场景图待采用" : "已有可用场景资产，将按 environmentKey 引用" : "等待用户上传或让 AI 生成空场景图"}</p>
                <footer>{sceneAsset.reviewDecision === "pending" && sceneAsset.imageUrl ? <><button onClick={() => void approveSceneBlueprint(sceneAsset)}>采用并入库</button><label className={assetAction ? "disabled" : ""}>上传图片替换<input type="file" accept="image/*" disabled={Boolean(assetAction)} onChange={(event) => { void uploadSceneBlueprint(sceneAsset, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="danger" onClick={() => rejectSceneBlueprint(sceneAsset)}>删除图片</button></> : <><label className={assetAction ? "disabled" : ""}>上传已有场景图<input type="file" accept="image/*" disabled={Boolean(assetAction)} onChange={(event) => { void uploadSceneBlueprint(sceneAsset, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button onClick={() => void generateSceneBlueprint(sceneAsset, index)} disabled={Boolean(assetAction)}>{assetAction === `scene-generate:${sceneAsset.id}` ? "生成中…" : sceneAsset.imageUrl ? "让 AI 重做" : "让 AI 生成"}</button></>}<button className="plain-danger" onClick={() => setSceneAssets((items) => items.filter((item) => item.id !== sceneAsset.id))} disabled={Boolean(assetAction)}>删除框架</button></footer>
              </article>)}
              {propAssets.map((prop, index) => <article key={prop.id} className={`asset-blueprint-card prop ${prop.status}`}>
                <div className="asset-blueprint-preview">{prop.imageUrl ? <button type="button" onClick={() => setAssetImagePreview({ url: prop.imageUrl as string, name: prop.name })} aria-label={`预览${prop.name}大图`}><img src={prop.imageUrl} alt={prop.name} /><i>点击预览</i></button> : <span><i>具</i><small>仅框架<br />尚无图片</small></span>}</div>
                <div className="asset-blueprint-fields"><em>道具资产 · {prop.importance === "hero" ? "核心" : prop.importance === "recurring" ? "重复" : "剧情"}</em><input value={prop.name} aria-label="道具名称" onChange={(event) => updatePropAsset(prop.id, { name: event.target.value })} /><textarea value={prop.description} aria-label="道具视觉描述" placeholder="形状、材质、颜色、尺寸和状态" onChange={(event) => updatePropAsset(prop.id, { description: event.target.value })} /><small>{prop.reason}</small></div>
                <p>{prop.imageUrl ? prop.reviewDecision === "pending" ? "AI 图片待采用" : "已有可用道具资产" : "等待用户选择资产来源"}</p>
                <footer>{prop.reviewDecision === "pending" && prop.imageUrl ? <><button onClick={() => approvePropBlueprint(prop)}>采用并入库</button><label className={assetAction ? "disabled" : ""}>上传图片替换<input type="file" accept="image/*" disabled={Boolean(assetAction)} onChange={(event) => { void uploadPropBlueprint(prop, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="danger" onClick={() => rejectPropBlueprint(prop)}>删除图片</button></> : <><label className={assetAction ? "disabled" : ""}>上传已有图片<input type="file" accept="image/*" disabled={Boolean(assetAction)} onChange={(event) => { void uploadPropBlueprint(prop, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button onClick={() => void generatePropBlueprint(prop, index)} disabled={Boolean(assetAction)}>{assetAction === `prop-generate:${prop.id}` ? "生成中…" : prop.imageUrl ? "让 AI 重做" : "让 AI 生成"}</button></>}<button className="plain-danger" onClick={() => setPropAssets((items) => items.filter((item) => item.id !== prop.id))} disabled={Boolean(assetAction)}>删除框架</button></footer>
              </article>)}
            </div>
            {!characters.length && !sceneAssets.length && !propAssets.length && <div className="asset-blueprint-loading"><b>AI 没有发现需要建立视觉资产的人物、场景或重要道具</b><span>你可以编辑剧本标注“人物：”“场景：”或“道具：”后重新分析。</span></div>}
          </>}
        </section>}

        <div className="ai-team">
          <div className="ai-team-heading"><div><span>AI 制片组</span><h3>六个岗位，各自调用自己的模型</h3><p>编剧先交稿，导演复核；画面、视频和声音分工生产，最后由剪辑 AI 形成成片。</p></div><div className="team-profiles"><button className={freeTeamActive ? "active" : ""} onClick={() => applyTeamProfile("free")}>免费默认阵容</button><button className={recommendedTeamActive ? "active" : ""} onClick={() => applyTeamProfile("pollinations")}>一键应用推荐阵容</button></div></div>
          <div className="agent-grid">
            {AGENT_ROLES.map((role) => {
              const config = agentConfigs[role.id];
              const presets = AGENT_PRESETS[role.id];
              const roleCustomModels = customModels.filter((item) => item.role === role.id);
              return <article key={role.id} className={`agent-card ${config.adapter}`}>
                <div className="agent-card-top"><i>{role.icon}</i><div><b>{role.title}</b><span>{role.duty}</span></div><em>{config.adapter === "horde" || config.adapter === "browser" ? "免费" : CUSTOM_TEXT_ADAPTERS.includes(config.adapter) ? "自定义" : config.adapter === "seedance" ? "官方" : "已托管"}</em></div>
                <select aria-label={`选择${role.title}`} value={config.preset} onChange={(event) => selectAgentPreset(role.id, event.target.value)}><optgroup label="漫镜预设">{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.model}</option>)}</optgroup>{config.preset === `direct-${role.id}` && <optgroup label="当前配置"><option value={config.preset}>{config.adapter === "seedance" ? `${/seedance-2/i.test(config.model) ? "Seedance 2.0" : "Seedance"} · 方舟 · ${config.model}` : `手动 API 配置 · ${config.model || "待选择模型"}`}</option></optgroup>}{roleCustomModels.length > 0 && <optgroup label="我的模型">{roleCustomModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.model}</option>)}</optgroup>}</select>
                <div className="agent-model"><span>当前模型</span><b>{config.model}</b><small>{presets.find((item) => item.id === config.preset)?.note || roleCustomModels.find((item) => item.id === config.preset)?.note}</small></div>
                <div className="recommend-row"><span>推荐</span>{role.recommends.map((item) => <i key={item}>{item}</i>)}</div>
                <button className="agent-config-button" onClick={() => setConfiguringRole(configuringRole === role.id ? null : role.id)}>{configuringRole === role.id ? "收起设置" : "配置模型与接口"}</button>
                {configuringRole === role.id && <div className="agent-config-panel">
                  {role.id === "prompt" && <div className="prompt-api-mode-switch"><span>镜头总控 API</span><div><button type="button" className={config.adapter === "openai" && config.endpoint.includes("api.openai.com") ? "active" : ""} onClick={() => changeDirectApiMode("prompt", "openai")}>OpenAI 官方</button><button type="button" className={config.adapter === "openai" && !config.endpoint.includes("api.openai.com") ? "active" : ""} onClick={() => updateAgentConfig("prompt", { preset: "direct-prompt", adapter: "openai", endpoint: "", model: config.model === "gpt-5" ? "" : config.model })}>OpenAI 兼容自定义</button><button type="button" className={config.adapter === "webhook" ? "active" : ""} onClick={() => changeDirectApiMode("prompt", "webhook")}>通用 Webhook</button></div><small>官方模式自动使用 api.openai.com；兼容模式可填写任意 OpenAI 格式 Base URL。</small></div>}
                  <label>自定义 API 模式<select aria-label={`${role.title}自定义 API 模式`} value={apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode) ? config.adapter : ""} onChange={(event) => { if (event.target.value) changeDirectApiMode(role.id, event.target.value as DiscoverableApiMode); }}><option value="">请选择 API 模式</option>{apiModesForRole(role.id).map((modeName) => <option key={modeName} value={modeName}>{API_MODE_LABELS[modeName]}</option>)}</select></label>
                  <label>模型 ID<input value={config.model} onChange={(event) => updateAgentConfig(role.id, { model: event.target.value })} placeholder="模型名称或 ID" /></label>
                  {CUSTOM_TEXT_ADAPTERS.includes(config.adapter) && <label>API 地址<input value={config.endpoint} onChange={(event) => updateAgentConfig(role.id, { endpoint: event.target.value.trim() })} placeholder="https://... 或 http://localhost:端口" /></label>}
                  {(config.adapter === "pollinations" || CUSTOM_TEXT_ADAPTERS.includes(config.adapter) || config.adapter === "seedance") && <label>{config.adapter === "seedance" ? "火山方舟 API Key（必填）" : "岗位专用 API 密钥（可选）"}<input type="password" value={config.apiKey} onChange={(event) => updateAgentConfig(role.id, { apiKey: event.target.value.trim() })} onBlur={() => { if (config.apiKey.trim() && apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode)) void discoverCurrentAgentModels(role.id); }} placeholder={config.adapter === "pollinations" ? "留空则使用下方统一密钥" : config.adapter === "seedance" ? "火山方舟控制台生成的 API Key" : "粘贴后离开输入框将自动读取模型"} /></label>}
                  {apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode) && <button type="button" className="agent-api-discover" onClick={() => void discoverCurrentAgentModels(role.id)} disabled={roleModelLoading === role.id}>{roleModelLoading === role.id ? "正在连接并读取模型…" : "测试连接并读取该 API 的模型"}</button>}
                  {!!roleModelOptions[role.id]?.length && <label>该 API 返回的模型<select value={config.model} onChange={(event) => updateAgentConfig(role.id, { model: event.target.value })}>{roleModelOptions[role.id]?.map((item) => <option key={item.id} value={item.id}>{item.name === item.id ? item.id : `${item.name} · ${item.id}`}</option>)}</select></label>}
                  {["director", "writer", "editor"].includes(role.id) && CUSTOM_TEXT_ADAPTERS.includes(config.adapter) && <small>当前模式：{API_MODE_LABELS[config.adapter as DiscoverableApiMode]}。请求由独立版在本机直连；编剧/导演最长等待 120 秒，剪辑最长等待 90 秒，超时后可保留成果重新运行。</small>}
                  {role.id === "image" && config.adapter === "openai" && <small>OpenAI 生图模式会调用所填地址的 <code>/images/generations</code>，可用于 OpenAI 官方或兼容的生图服务。</small>}
                  {role.id === "prompt" && config.adapter === "openai" && <small>镜头总控将通过 OpenAI Chat Completions 兼容协议整理资产引用、镜头状态和最终视频提示词。</small>}
                  {["image", "video", "voice"].includes(role.id) && config.adapter === "webhook" && <small>漫镜会 POST role、model、task 和输入内容；接口需返回媒体文件或可下载的 url。</small>}
                  {config.adapter === "seedance" && <small>通过漫镜的安全代理提交异步任务并轮询结果；密钥不写入网站服务器，只持久保存在这台电脑。</small>}
                  {apiModesForRole(role.id).includes(config.adapter as DiscoverableApiMode) && <button type="button" className="agent-api-save" onClick={() => void saveCurrentAgentApi(role.id)} disabled={roleSaveState.role === role.id && roleSaveState.state === "saving"}>{roleSaveState.role === role.id && roleSaveState.state === "saving" ? "正在保存…" : "保存此岗位 API 并立即应用"}</button>}
                  {roleSaveState.role === role.id && roleSaveState.message && <p className={`agent-api-status ${roleSaveState.state}`} role="status">{roleSaveState.message}</p>}
                  {roleCustomModels.length > 0 && <div className="agent-saved-models"><div><b>我的自定义模型</b><span>{roleCustomModels.length} 个</span></div>{roleCustomModels.map((model) => <article key={model.id}><span><b>{model.name}</b><small>{model.model} · {API_MODE_LABELS[model.adapter as DiscoverableApiMode] || model.adapter}</small></span><ConfirmButton onConfirm={() => deleteRoleCustomModel(role.id, model.id)} disabled={roleSaveState.role === role.id && roleSaveState.state === "saving"} ariaLabel={`删除自定义模型${model.name}`} confirmLabel="确认删除">删除</ConfirmButton></article>)}</div>}
                  <button type="button" className="add-custom-model-link" onClick={() => toggleQuickModel(role.id)}>{quickModelRole === role.id ? "－ 收起自定义模型" : `＋ 为${role.title}添加自定义模型`}</button>
                  {quickModelRole === role.id && <div className="quick-custom-model">
                    <div><b>添加到 {role.title}</b><small>选择模式 → 填写 API → 读取模型 → 提交应用</small></div>
                    <div className="quick-custom-grid">
                      <label>API 模式<select value={quickModelDraft.adapter} onChange={(event) => changeQuickApiMode(event.target.value as DiscoverableApiMode)}>{apiModesForRole(role.id).map((modeName) => <option key={modeName} value={modeName}>{API_MODE_LABELS[modeName]}</option>)}</select></label>
                      <label>API 接口地址<input value={quickModelDraft.endpoint} onChange={(event) => setQuickModelDraft((value) => ({ ...value, endpoint: event.target.value }))} placeholder={API_MODE_DEFAULT_ENDPOINTS[quickModelDraft.adapter] || "https://... 或 http://localhost:端口"} /></label>
                      <label>API Key（本机保存）<input type="password" value={quickModelDraft.apiKey} onChange={(event) => setQuickModelDraft((value) => ({ ...value, apiKey: event.target.value }))} onBlur={() => { if (quickModelDraft.apiKey.trim() && quickModelDraft.endpoint.trim()) void discoverQuickModels(); }} placeholder="粘贴后离开输入框将自动读取模型" /></label>
                      <button type="button" className="quick-model-discover" onClick={() => void discoverQuickModels()} disabled={quickModelLoading}>{quickModelLoading ? "正在连接并读取…" : "测试连接并读取模型列表"}</button>
                      {quickModelOptions.length > 0 && <label>接口返回的模型<select value={quickModelDraft.model} onChange={(event) => setQuickModelDraft((value) => ({ ...value, model: event.target.value }))}>{quickModelOptions.map((item) => <option key={item.id} value={item.id}>{item.name === item.id ? item.id : `${item.name} · ${item.id}`}</option>)}</select></label>}
                      <label>模型 ID（也可手动填写）<input value={quickModelDraft.model} onChange={(event) => setQuickModelDraft((value) => ({ ...value, model: event.target.value }))} placeholder="读取后自动填入，或手动输入" /></label>
                      <label>显示名称（可选）<input value={quickModelDraft.name} onChange={(event) => setQuickModelDraft((value) => ({ ...value, name: event.target.value }))} placeholder={`默认使用模型 ID，也可写“我的${role.title}”`} /></label>
                      <label>备注（可选）<input value={quickModelDraft.note} onChange={(event) => setQuickModelDraft((value) => ({ ...value, note: event.target.value }))} placeholder="能力或用途" /></label>
                    </div>
                    <button type="button" className="quick-custom-save" onClick={() => void saveQuickModel(role.id)} disabled={quickModelSaving || quickModelLoading}>{quickModelSaving ? "正在写入并应用…" : "提交、保存并应用到当前岗位"}</button>
                    {quickModelMessage && <p role="status" className="quick-custom-message">{quickModelMessage}</p>}
                  </div>}
                </div>}
              </article>;
            })}
          </div>
        </div>

        <div id="provider" className="provider-box">
          <div className="provider-tabs">
            <button className={freeTeamActive ? "active" : ""} onClick={() => applyTeamProfile("free")}><b>免费多 AI 流程</b><span>Horde 编剧/导演/生图 · 本地配音剪辑</span></button>
            <button className={recommendedTeamActive ? "active" : ""} onClick={() => applyTeamProfile("pollinations")}><b>推荐 AI 制片组</b><span>独立导演 · 编剧 · 生图 · 视频 · 配音 · 剪辑</span></button>
          </div>
          {freeTeamActive ? <p className="provider-note"><b>免费边界：</b>语言和生图岗位使用社区算力，画质与一致性会随在线模型变化；视频岗位只做 2.5D 推拉、横移、景深和光影动画，人物本身不会产生走路、口型等新动作。可只替换“生图 AI”或“视频 AI”，不必整套更换。</p> : <div className="key-panel"><div><b>统一备用密钥</b><span>未填写岗位专用密钥时使用这里的 Pollinations 密钥；所有密钥只保存在当前设备。</span></div><div className="key-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder="pk_..." aria-label="Pollinations 发布密钥" /><a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">获取密钥 ↗</a></div></div>}
        </div>

        <div className="cloud-engine-hub">
          <div className="cloud-engine-heading"><div><span>制作引擎</span><h3>专业漫剧云引擎</h3><p>LibTV 负责从故事到成片的一键生产；Seedance 方舟 API 负责把单个分镜变成真正会动的视频。</p></div><em>配置持久保存在本机</em></div>
          <div className="cloud-engine-grid">
            <article className={`cloud-engine-card libtv-card ${libtvCanvasOpen && (libtvSessionId || libtvProjectUrl) ? "canvas-open" : ""}`}>
              <div className="engine-title"><i>剧</i><div><b>LibTV 一键漫剧</b><span>剧本 → 角色 → 分镜 → 视频 → 配音 → 成片</span></div><em>全流程</em></div>
              <p>直接调用 LibTV 官方 Agent 接口创建完整项目。生成过程可在漫镜查看，也可打开 LibTV 无限画布继续精修。</p>
              <label>LibTV Access Key<input type="password" value={libtvAccessKey} onChange={(event) => setLibtvAccessKey(event.target.value.trim())} placeholder="填写 LIBTV_ACCESS_KEY" /></label>
              <div className="engine-actions"><button onClick={() => void generateWithLibTv()} disabled={busy || story.trim().length < 8}>{libtvRunning ? "LibTV 正在制作…" : "一键生成完整 AI 漫剧"}</button><button className="secondary" onClick={createLibTvCanvas} disabled={libtvSending}>新建本机制片画布</button>{(libtvSessionId || libtvProjectUrl) && <button className="secondary" onClick={() => setLibtvCanvasOpen((value) => !value)}>{libtvCanvasOpen ? "收起 LibTV 进度" : "查看 LibTV 进度"}</button>}<a href="https://github.com/libtv-labs/libtv-skills" target="_blank" rel="noreferrer">官方 OpenAPI ↗</a></div>
              {libtvSessionId && <div className="engine-task"><b>云端任务已建立</b><span>{libtvSessionId}</span></div>}
              {!!libtvResults.length && <div className="engine-results">{libtvResults.slice(0, 8).map((item, index) => {
                const source = `/api/libtv?url=${encodeURIComponent(item.url)}`;
                return <a key={`${item.url}-${index}`} href={source} download={`libtv-${index + 1}.${item.kind === "video" ? "mp4" : "png"}`} title="下载素材">{item.kind === "video" ? <i className="video-thumbnail-placeholder">▶</i> : <img src={source} alt={`LibTV 生成素材 ${index + 1}`} loading="lazy" />}<span>{item.kind === "video" ? "视频" : "图片"} {index + 1}</span></a>;
              })}</div>}
              {libtvCanvasOpen && (libtvSessionId || libtvProjectUrl) && <div className="libtv-canvas">
                <div className="libtv-canvas-head"><div><span>实时生产画布</span><b>LibTV 制片画布</b><small>由官方会话消息与素材结果实时构建</small></div><div>{libtvRunning && <button onClick={toggleLibTvPolling}>{libtvPollingPaused ? "继续自动刷新" : "暂停自动刷新"}</button>}<button onClick={() => void refreshLibTvCanvas()} disabled={!libtvSessionId || libtvSending}>{libtvSending ? "刷新中…" : "立即刷新"}</button>{libtvProjectUrl && <a href={libtvProjectUrl} target="_blank" rel="noreferrer">进入官方无限画布 ↗</a>}</div></div>
                <div className="libtv-node-flow">
                  <article className={libtvMessages.length ? "done" : "running"}><i>1</i><b>剧本与导演</b><span>{libtvMessages.length ? "会话已建立" : "等待指令"}</span></article><em>→</em>
                  <article className={libtvResults.some((item) => item.kind === "image") ? "done" : libtvMessages.length ? "running" : ""}><i>2</i><b>角色与分镜</b><span>{libtvResults.filter((item) => item.kind === "image").length} 张画面</span></article><em>→</em>
                  <article className={libtvResults.some((item) => item.kind === "video") ? "done" : libtvResults.length ? "running" : ""}><i>3</i><b>动态与声音</b><span>{libtvResults.filter((item) => item.kind === "video").length} 段视频</span></article><em>→</em>
                  <article className={libtvResults.some((item) => item.kind === "video") ? "done" : ""}><i>4</i><b>剪辑与交付</b><span>{libtvResults.some((item) => item.kind === "video") ? "可导入剪辑台" : "等待上游"}</span></article>
                </div>
                <div className="libtv-canvas-grid"><div className="libtv-message-stream"><div><b>AI 工作过程</b><span>{libtvMessages.length} 条消息</span></div>{libtvMessages.length ? libtvMessages.slice(-20).reverse().map((message) => <p key={message.id} className={message.role}><i>{message.role === "user" ? "你" : "AI"}</i><span>{message.content}</span><small>#{message.seq}</small></p>) : <p className="empty"><i>AI</i><span>任务开始后，剧本、画面、视频和交付消息会显示在这里。</span></p>}</div><div className="libtv-command-panel"><b>继续指挥 LibTV</b><p>可在同一会话追加修改要求，例如重做某个镜头、换画风或调整节奏。</p><textarea value={libtvInstruction} onChange={(event) => setLibtvInstruction(event.target.value)} placeholder="例如：把第 3 个镜头改成近景，让角色有明显的转身和开口动作，并重新剪进成片。" /><button onClick={() => void sendLibTvInstruction()} disabled={libtvSending || libtvInstruction.trim().length < 8 || !libtvSessionId}>{libtvSending ? "正在发送…" : "发送到当前画布"}</button></div></div>
              </div>}
            </article>
            <article className="cloud-engine-card seedance-card">
              <div className="engine-title"><i>舞</i><div><b>Seedance · 火山方舟</b><span>官方文生视频 / 图生视频异步接口</span></div><em>镜头级</em></div>
              <p>应用到“视频 AI”岗位后，漫镜会跳过分镜图，把人物、场景、道具、音色和上一镜已批准视频作为全能参考逐镜提交给火山方舟，绝不提交首尾帧图片。</p>
              <div className="seedance-reference-plan">
                <b>生成前资产预检 → Seedance 全能参考</b>
                <span><i>@人物</i><i>@场景</i><i>@道具</i><i>@音色</i><i>@上一镜视频</i></span>
                <small>先匹配当前项目与公共库资产；同场景通过上一镜已批准视频和文字 End State 继承动作/机位，最后以短时逐帧平滑混合消除硬接缝。</small>
              </div>
              <label>火山方舟 API Key<input type="password" value={seedanceApiKey} onChange={(event) => setSeedanceApiKey(event.target.value.trim())} placeholder="填写 ARK_API_KEY" /></label>
              <label>模型 ID 或 Endpoint ID<input value={seedanceModel} onChange={(event) => setSeedanceModel(event.target.value.trim())} placeholder="doubao-seedance-… 或 ep-…" /></label>
              <div className="engine-actions"><button onClick={applySeedanceEngine}>{agentConfigs.video.adapter === "seedance" ? "更新 Seedance 视频岗位" : "应用到视频 AI 岗位"}</button><a href="https://www.volcengine.com/docs/82379/1520758" target="_blank" rel="noreferrer">方舟官方 API ↗</a><a href="https://www.volcengine.com/docs/85621/1756900" target="_blank" rel="noreferrer">即梦视觉 API ↗</a></div>
              <div className={`engine-active ${agentConfigs.video.adapter === "seedance" ? "on" : ""}`}><i />{agentConfigs.video.adapter === "seedance" ? `已启用：${agentConfigs.video.model}` : "尚未应用，当前视频岗位保持不变"}</div>
              <div className={`volc-sdk-state ${volcengineSdk?.installed ? "ready" : "checking"}`}><i>{volcengineSdk?.installed ? "✓" : "…"}</i><span><b>{volcengineSdk?.installed ? `火山引擎官方 SDK ${volcengineSdk.version} 已内置` : "正在检测内置火山 SDK"}</b><small>{volcengineSdk?.note || "Windows 独立版启动后自动加载，不需要用户另外安装或升级。"}</small></span></div>
              <p className="api-identity-note"><b>认证别混用：</b>Seedance 方舟视频生成按官方接口填写 ARK_API_KEY；内置 SDK 同时提供 AK/SK 签名能力。用户不需要在电脑上另外安装 SDK。</p>
            </article>
          </div>
          <p className="cloud-engine-note"><b>真实能力边界：</b>LibTV 和即梦的接口代码可以接入，但云端生成需要平台有效额度；漫镜不会伪装成免费算力，也不会把访问密钥写进部署配置。</p>
        </div>

        <div className="opensource-hub">
          <div className="opensource-heading"><div><span>本地开源节点</span><h3>开源本地节点中心</h3><p>统一连接 ComfyUI/Wan2.2、CosyVoice、MuseTalk、MoneyPrinterTurbo 与 VibeVoice。</p></div><div><a href="/manjing-local-bridge.zip" download>下载本地桥接服务</a><button onClick={applyBridgeStack}>应用中文基础节点</button></div></div>
          <div className="bridge-config"><label>桥接服务地址<input value={bridgeUrl} onChange={(event) => { setBridgeUrl(event.target.value.trim()); setBridgeHealth({ state: "idle", message: "地址已修改，等待检测" }); }} placeholder="https://你的桥接地址 或 http://127.0.0.1:8765" /></label><label>桥接密钥<input type="password" value={bridgeToken} onChange={(event) => setBridgeToken(event.target.value.trim())} placeholder="与本地 .env 中的 BRIDGE_TOKEN 相同" /></label><button onClick={() => void testBridgeConnection()} disabled={bridgeHealth.state === "testing"}>{bridgeHealth.state === "testing" ? "检测中…" : "检测连接"}</button><em className={bridgeHealth.state}>{bridgeHealth.message}</em></div>
          <div className="opensource-nodes">
            <article className={bridgeHealth.nodes?.comfyui ? "online" : "offline"}><div className="node-top"><i>影</i><div><b>ComfyUI · Wan2.2</b><span>生图、角色一致性、图生视频与人物动画</span></div><em>{bridgeHealth.nodes?.comfyui ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.workflows?.image ? "ready" : ""}>生图工作流</span><span className={bridgeHealth.workflows?.video ? "ready" : ""}>视频工作流</span></div><div className="node-actions"><button onClick={() => applyBridgeRole("image")}>用于生图岗位</button><button onClick={() => applyBridgeRole("video")}>用于视频岗位</button><a href="https://github.com/Wan-Video/Wan2.2" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.cosyvoice ? "online" : "offline"}><div className="node-top"><i>声</i><div><b>CosyVoice</b><span>中文角色配音、情绪指令与声音复刻</span></div><em>{bridgeHealth.nodes?.cosyvoice ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.nodes?.cosyvoice ? "ready" : ""}>FastAPI 服务</span><span>本机生成音轨</span></div><div className="node-actions"><button onClick={() => applyBridgeRole("voice")}>用于配音岗位</button><a href="https://github.com/FunAudioLLM/CosyVoice" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.musetalk ? "online" : "offline"}><div className="node-top"><i>口</i><div><b>MuseTalk 1.5</b><span>在配音完成后，为人物镜头生成中文口型</span></div><em>{bridgeHealth.nodes?.musetalk ? "在线" : "未检测"}</em></div><div className="lipsync-toggle"><div><b>生成后自动做口型</b><span>失败时保留原视频，不中断整片</span></div><button className={`toggle ${lipsyncEnabled ? "on" : ""}`} onClick={() => setLipsyncEnabled((value) => !value)}><i /></button></div><div className="node-actions"><a href="https://github.com/TMElyralab/MuseTalk" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.moneyprinter ? "online" : "offline"}><div className="node-top"><i>剪</i><div><b>MoneyPrinterTurbo</b><span>把工作台素材顺序拼接、配音、字幕并自动出片</span></div><em>{bridgeHealth.nodes?.moneyprinter ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.nodes?.moneyprinter ? "ready" : ""}>官方任务 API</span><span>FFmpeg 成片</span></div><div className="node-actions"><a href="/editor">前往剪辑台使用</a><a href="https://github.com/harry0703/MoneyPrinterTurbo" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
            <article className={bridgeHealth.nodes?.vibevoice ? "online" : "offline"}><div className="node-top"><i>语</i><div><b>VibeVoice Realtime</b><span>微软 0.5B 流式配音，实验性英文单角色节点</span></div><em>{bridgeHealth.nodes?.vibevoice ? "在线" : "未检测"}</em></div><div className="node-checks"><span className={bridgeHealth.nodes?.vibevoice ? "ready" : ""}>24 kHz 实时音频</span><span className={bridgeHealth.nodes?.vibevoice_asr ? "ready" : ""}>ASR 可选</span></div><div className="node-actions"><button onClick={applyVibeVoiceRole}>用于配音岗位</button><a href="https://github.com/microsoft/VibeVoice" target="_blank" rel="noreferrer">项目说明 ↗</a></div></article>
          </div>
          <p className="opensource-note"><b>免费指代码或模型可自托管，不代表显卡与第三方服务免费。</b>VibeVoice Realtime 目前主要面向英文单角色；中文多角色优先使用 CosyVoice。MoneyPrinterTurbo 和大型视频模型需要本机 FFmpeg、模型与相应算力，所有开源节点均为可选。</p>
        </div>

        <div className="generate-row">
          <button className="generate-button" onClick={generateAll} disabled={busy || story.trim().length < 8}><span>✦</span>{busy ? "AI 制片组正在协作" : nativeVideoEnabled ? "让 AI 制片组生成漫剧" : "让免费 AI 制片组生成样片"}<small>导演审片 + 编剧分镜 + 图像 + 视频 + 配音 + 剪辑</small></button>
          {busy && <button className="cancel-button" onClick={cancelGeneration}>{phase === "exporting" ? "停止合成" : "停止"}</button>}
        </div>
        {(phase !== "idle" || error) && <div className={`job-status ${error ? "has-error" : ""}`}><div className="status-copy"><div><b>{error || statusText}</b><span>{activePortraitBlock ? "方舟真人安全拦截不是网络故障；授权完成前已禁止重复付费提交。" : error ? "已完成成果仍然保留，可重新运行中断的岗位。" : `${visibleProgress}%`}</span></div>{activePortraitBlock ? <button type="button" className="job-retry-button portrait-center-button" onClick={openTrustedPortraitCenter} disabled={busy}>处理可信人物（{activePortraitBlock.blockedReferences.length || 1}）</button> : error && failedRole ? <button type="button" className="job-retry-button" onClick={() => void rerunRole(failedRole)} disabled={busy}>{retryingRole === failedRole ? "重新运行中…" : `重新运行${AGENT_ROLES.find((role) => role.id === failedRole)?.title}`}</button> : null}{!error && nativeVideoEnabled && phase === "ready" && sequentialVideoPlan.kind === "generate" && <button type="button" className="job-retry-button" onClick={() => void rerunRole("video")} disabled={busy}>继续生成第 {sequentialVideoPlan.index + 1} 镜</button>}</div><div className="status-bar"><i style={{ width: `${visibleProgress}%` }} /></div><div className="status-steps"><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>编剧</span><span className={["story", "characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>导演</span><span className={["characters", "images", "video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>生图</span><span className={["video", "voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>{nativeVideoEnabled ? "视频" : "运镜"}</span><span className={["voice", "music", "exporting", "ready"].includes(phase) ? "active" : ""}>配音</span><span className={["exporting", "ready"].includes(phase) ? "active" : ""}>剪辑</span></div></div>}
        {(activityLog.length > 0 || busy) && <div className="workflow-monitor">
          <div className="workflow-heading"><div><b>AI 制作现场</b><span>每个岗位正在做什么、用了哪个模型、交付了什么，都实时记录</span></div><em>{busy ? "制作直播中" : "本次流程已保存"}</em></div>
          <div className="workflow-roles">{AGENT_ROLES.map((role) => {
            const latest = activityByRole[role.id];
            return <article key={role.id} className={latest?.state || "waiting"}><i>{role.icon}</i><div><b>{role.title}</b><span>{latest?.message || "等待上游交付"}</span><small>{agentName(role.id)}</small></div><aside><em>{latest?.state === "running" ? "工作中" : latest?.state === "done" ? "已交付" : latest?.state === "warning" ? "已降级" : latest?.state === "error" ? "中断" : "等待"}</em><button type="button" onClick={() => void rerunRole(role.id)} disabled={busy || !canRerunRole(role.id)} aria-label={`重新运行${role.title}`}>{retryingRole === role.id ? "运行中…" : latest?.state === "error" ? "重新运行" : "再运行"}</button></aside></article>;
          })}</div>
          <div className="workflow-log"><b>制作记录</b><div>{activityLog.length ? activityLog.map((item) => <p key={item.id} className={item.state}><time>{item.time}</time><span>{AGENT_ROLES.find((role) => role.id === item.role)?.title}</span>{item.message}</p>) : <p><time>--:--</time><span>制片组</span>任务开始后，这里会显示每一步真实进度</p>}</div></div>
        </div>}
      </section>

      <section className="production-pipeline-map section-shell" aria-label="漫剧生产流程">
        <header><div><span>PRODUCTION PIPELINE</span><h2>从剧本到成片，不再把每一镜当成独立抽卡</h2></div><p>镜头计划、资产标准、连续状态和声音档案贯穿整个项目；只有审核通过的结果才进入长期资产。</p></header>
        <div className="pipeline-stages">
          <article><i>01</i><b>项目圣经</b><small>世界观、人物关系、时间线、视觉与声音规则</small></article>
          <article><i>02</i><b>剧集拆解</b><small>场次、叙事节拍、对白、目标时长</small></article>
          <article><i>03</i><b>资产规划</b><small>角色身份、造型版本、地点、关键道具、角色声音</small></article>
          <article><i>04</i><b>镜头设计</b><small>只输出景别、机位、调度和起止状态，不生成分镜图</small></article>
          <article><i>05</i><b>直接生成视频</b><small>每镜只走全能参考：人物、造型、场景、道具、音色和前序视频</small></article>
          <article><i>06</i><b>连续性审核</b><small>身份、造型、空间、道具、动作与光线质量门</small></article>
          <article><i>07</i><b>声音后期</b><small>角色音色、对白、口型、音效、配乐与字幕</small></article>
          <article><i>08</i><b>剪辑交付</b><small>节奏调整、失败镜头替换、混音与成片导出</small></article>
        </div>
      </section>

      <section className="production-standard-deck section-shell" aria-label="当前作品生产标准">
        <header><div><span>LIVE PRODUCTION STANDARD</span><h2>本片生产标准</h2></div><div className="production-live-state"><i /><b>{phase === "idle" ? "等待开机" : statusText}</b><em>{progress}%</em></div></header>
        <div className="production-standard-grid">
          <article><span>视觉锁</span><b>{style}</b><small>{aspect} 画幅 · 同项目统一画风、色调与光线逻辑</small></article>
          <article><span>节奏策略</span><b>{targetDuration === 0 ? "AI 自动判断" : `${targetDuration} 秒目标`}</b><small>由剧情节拍分配镜长，每个视频镜头不超过 15 秒</small></article>
          <article><span>连续性锁</span><b>前序视频全能参考</b><small>不提交首尾帧；身份、造型、轴线、位置、动作、道具和曝光逐镜继承</small></article>
          <article><span>声音交付</span><b>{voiceEnabled ? "角色配音开启" : "保留原生声音"}</b><small>{bgmEnabled ? "连续 BGM" : "无 BGM"} · {subtitleEnabled ? "统一字幕" : "无字幕"}</small></article>
        </div>
      </section>

      <section id="works" className="works section-shell">
        <div className="section-heading"><span>02</span><div><p>剪辑工作台</p><input className="workbench-project-title" aria-label="修改作品标题" value={scenes.length ? projectTitle : "生成后在这里剪辑"} disabled={!scenes.length} onChange={(event) => setProjectTitle(event.target.value)} onBlur={(event) => { const title = event.target.value.trim() || "未命名作品"; setProjectTitle(title); const raw = window.localStorage.getItem("manjing-active-series-context-v1"); if (raw) { try { const context = JSON.parse(raw); window.localStorage.setItem("manjing-active-series-context-v1", JSON.stringify({ ...context, productionTitle: title })); } catch { /* workspace autosave still preserves the title */ } } }} /></div><aside>{scenes.length ? `${scenes.length} 个镜头 · ${formatTime(totalDuration)}` : "尚无作品"}</aside></div>
        {pendingReviewCount > 0 && <section className="incremental-review" aria-live="polite"><header><div><span>LIVE REVIEW</span><h3>逐镜生成与审核</h3><p>当前分镜一生成就立即暂停；可批准、按评分原因修改或删除，确认可用后才会生成下一镜。</p></div><b>{pendingReviewCount}<small> 项待审</small></b></header><div className="incremental-review-grid">
          {pendingCharacterReviews.map((character) => <article key={`character-${character.id}`}><div className="review-media">{character.imageUrl && <img src={character.imageUrl} alt={character.name} />}</div><div><small>角色设定</small><b>{character.name}</b><p>{character.appearance}</p></div><footer><button onClick={() => approveCharacterAsset(character)}>批准入库</button><button className="danger" onClick={() => rejectCharacterAsset(character)}>删除</button></footer></article>)}
          {pendingImageReviews.map((scene) => <article key={`image-${scene.id}`}><div className="review-media">{scene.imageUrl && <img src={scene.imageUrl} alt={scene.title} />}</div><div><small>镜头画面</small><b>{scene.title}</b><p>{scene.consistencyReport?.findings[0] || scene.visual}</p></div><footer><button onClick={() => approveSceneAsset(scene, "image")}>批准画面</button><button className="danger" onClick={() => rejectSceneAsset(scene, "image")}>删除</button></footer></article>)}
          {pendingVideoReviews.map((scene) => <article key={`video-${scene.id}`}><button type="button" className="review-media review-video-open" onClick={() => scene.candidateVideoUrl && setVideoReviewPreview({ url: scene.candidateVideoUrl, name: scene.title })} aria-label={`大窗预览${scene.title}`}><video src={scene.candidateVideoUrl} muted preload="metadata" /><i>点击大窗预览</i></button><div><small>{scene.consistencyDecision === "pass" ? "视频 · AI质检通过" : "视频 · 需修改"}</small><b>{scene.title}</b><p>{scene.consistencyReport?.findings.join("；") || "动态镜头已生成，等待你的审核。"}</p><textarea className="video-revision-input" value={scene.videoRevisionRequest || ""} onChange={(event) => updateScene(scene.id, { videoRevisionRequest: event.target.value })} placeholder="输入你的修改要求，例如：人物不要回头，镜头改为缓慢横向跟拍，道具始终拿在右手。" aria-label={`${scene.title}的视频修改要求`} /></div><footer><button onClick={() => scene.candidateVideoUrl && setVideoReviewPreview({ url: scene.candidateVideoUrl, name: scene.title })}>预览视频</button><button onClick={() => void approveCandidateVideo(scene)}>合格，批准入片</button><button className="candidate-rebuild" onClick={() => void reviseCandidateVideo(scene)} disabled={Boolean(sceneAction)}>不合格，按评分原因修改（可填写要求）</button><button className="danger" onClick={() => discardCandidateVideo(scene)}>删除</button></footer></article>)}
          {pendingAudioReviews.map((scene) => <article key={`audio-${scene.id}`}><div className="review-media audio">声音</div><div><small>角色配音</small><b>{scene.title} · {scene.speaker}</b><p>{scene.dialogue}</p><audio src={scene.audioUrl} controls preload="metadata" /></div><footer><button onClick={() => approveSceneAsset(scene, "audio")}>批准入库</button><button className="danger" onClick={() => rejectSceneAsset(scene, "audio")}>删除</button></footer></article>)}
          {pendingMusicReviews > 0 && <article><div className="review-media audio">BGM</div><div><small>剧情配乐</small><b>{projectTitle}</b><p>{musicPrompt}</p><audio src={musicUrl} controls preload="metadata" /></div><footer><button onClick={approveMusicAsset}>批准入库</button><button className="danger" onClick={rejectMusicAsset}>删除</button></footer></article>}
        </div></section>}
        {scenes.some((scene) => scene.consistencyReport) && <div className="consistency-dashboard"><header><div><span>CONSISTENCY ENGINE</span><h3>镜头一致性报告</h3><small>总分达到 90 自动进入视频生成；低于 90 可由用户决定重做、继续或复用。</small></div><b>{Math.round(scenes.filter((scene) => scene.consistencyReport).reduce((sum, scene) => sum + (scene.consistencyReport?.overall || 0), 0) / Math.max(1, scenes.filter((scene) => scene.consistencyReport).length))}<small>/100 平均</small></b></header><div>{scenes.filter((scene) => scene.consistencyReport).map((scene, index) => { const automaticPass = (scene.consistencyReport?.overall || 0) >= 90 && !scene.candidateVideoUrl; const displayDecision = scene.preflightOverride ? "review" : automaticPass ? "pass" : scene.consistencyDecision || "review"; return <article key={scene.id} className={displayDecision}><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{scene.title}</strong><small>{scene.consistencyReport?.mode === "vision" ? "视觉审核" : "结构检查"} · {scene.consistencyReport?.findings[0] || "未发现明显问题"}</small></span><em>{scene.consistencyReport?.overall}</em><b>{scene.preflightOverride ? "MANUAL" : automaticPass ? "PASS" : displayDecision.toUpperCase()}</b></article>; })}</div></div>}
        {characters.some(isVisualCharacterAsset) && <div className="production-assets">
          <div className="asset-heading"><div><b>角色资产库</b><span>仅为实际出镜人物生成大头照与正、侧、背三视图；旁白和广告声只保留声音档案</span></div><em>{characters.filter((item) => isVisualCharacterAsset(item) && item.status === "ready").length}/{characters.filter(isVisualCharacterAsset).length} 已锁定</em></div>
          <div className="character-list">{characters.filter(isVisualCharacterAsset).map((character) => <article key={character.id} className={character.status}>
            <div className="character-portrait">{character.imageUrl ? <img src={character.imageUrl} alt={`${character.name}角色设定`} /> : <span>{character.status === "generating" ? "生成中" : character.name.slice(0, 1)}</span>}</div>
            <div><b>{character.name}</b><small>{character.role} · {VOICES.find((item) => item.value === character.voice)?.label || "角色音色"}</small><p>{character.appearance}</p>{character.imageUrl && <button className="asset-download-mini" onClick={() => void downloadAsset(character.imageUrl as string, `${projectTitle}-${character.name}-角色设定`, "png")}>下载角色图</button>}</div>
          </article>)}</div>
          <div className="quality-gates">
            <span className={characters.every((item) => item.imageUrl) ? "passed" : ""}>角色参考</span>
            <span className={scenes.some((item) => item.videoUrl || item.candidateVideoUrl) ? "passed" : ""}>全能参考视频链</span>
            <span className={nativeVideoEnabled && scenes.every((item) => item.videoUrl) ? "passed" : ""}>动态表演</span>
            <span className={generatedVoiceEnabled && voiceEnabled && scenes.every((item) => item.audioUrl) ? "passed" : ""}>分角色配音</span>
            <span className={generatedVoiceEnabled && bgmEnabled && !!musicUrl ? "passed" : ""}>剧情配乐</span>
            <span className={!!exportUrl ? "passed" : ""}>最终成片</span>
          </div>
        </div>}
        {!!scenes.length && <div className="delivery-center">
          <div className="delivery-heading"><div><b>交付物与素材库</b><span>剧本、镜头计划、角色/场景/道具图、逐镜视频、音色和成片均可独立管理；视频只使用全能参考，不建立首尾帧资产</span></div><label className="project-import">导入漫镜工程<input type="file" accept="application/json,.json" onChange={(event) => { void importProject(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
          <div className="delivery-actions">
            <button onClick={downloadScript}><i>文</i><span><b>下载剧本</b><small>TXT · 含对白、动作和声音</small></span></button>
            <button onClick={downloadStoryboard}><i>镜</i><span><b>下载镜头计划</b><small>JSON · 不包含分镜图片资产</small></span></button>
            <button onClick={downloadProject}><i>工</i><span><b>保存工程</b><small>JSON · 保留剪辑参数，稍后再改</small></span></button>
            <button onClick={downloadFilm} disabled={!exportUrl}><i>片</i><span><b>下载成片</b><small>{exportUrl ? "视频文件已就绪" : "重新合成后可下载"}</small></span></button>
            <button className="send-to-editor" onClick={() => void openInProfessionalEditor()} disabled={editorSyncState === "saving"}><i>剪</i><span><b>{editorSyncState === "saving" ? `正在逐个整理素材 ${editorSyncProgress}%` : "进入专业剪辑台"}</b><small>{editorSyncState === "ready" ? "AI 工程已同步，可继续精剪" : "自动带入视频、图片、配音和字幕"}</small></span></button>
          </div>
          <div className="media-bin">{scenes.map((scene, index) => <article key={scene.id} className={selected === index ? "selected" : ""} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}>
            <div className="media-bin-thumb">{scene.videoUrl || scene.candidateVideoUrl ? <span className="video-thumbnail-placeholder">▶</span> : !nativeVideoEnabled && scene.imageUrl ? <img src={scene.imageUrl} alt="" loading="lazy" /> : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
            <div><b>{String(index + 1).padStart(2, "0")} · {scene.title}</b><small>{scene.videoUrl ? "原生视频" : scene.candidateVideoUrl ? "视频待审核" : !nativeVideoEnabled && scene.imageUrl ? "2.5D 图片镜头" : nativeVideoEnabled ? "等待直接生成视频" : "等待画面"} · {scene.duration} 秒</small></div>
            <div className="media-downloads">{scene.imageUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.imageUrl as string, `${projectTitle}-${index + 1}-${scene.title}`, "png"); }}>图片</button>}{scene.videoUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.videoUrl as string, `${projectTitle}-${index + 1}-${scene.title}`, "mp4"); }}>视频</button>}{scene.audioUrl && <button onClick={(event) => { event.stopPropagation(); void downloadAsset(scene.audioUrl as string, `${projectTitle}-${index + 1}-${scene.speaker}-配音`, "mp3"); }}>配音</button>}</div>
          </article>)}</div>
          <div className="delivery-note"><b>{nativeVideoEnabled ? "当前使用原生视频模型" : "为什么现在人物不会真正动？"}</b><span>{nativeVideoEnabled ? "每个带“原生视频”标记的镜头都由视频 AI 生成，可单独下载和替换。" : "免费默认视频岗位没有调用人物动画模型，只对静态图做 2.5D 推拉、横移、景深和光影动画。若需要人物口型、走路和表演，请把“视频 AI”切换到 Seedance 或自定义视频接口。"}</span></div>
        </div>}
        {!scenes.length ? <div className="empty-work"><div className="empty-orbit"><span>✦</span></div><h3>你的第一部漫剧还没开机</h3><p>在上方输入故事并点击“一键生成 AI 漫剧”，完成后这里会直接出现可播放成片。</p></div> : <><div className="workbench">
          <div className="preview-column">
            <div className={`stage ${aspect === "9:16" ? "portrait" : "landscape"} ${showFilm && exportUrl ? "film-ready" : ""}`}>
              {showFilm && exportUrl ? <video src={exportUrl} preload="metadata" controls autoPlay playsInline /> : current?.videoUrl || current?.candidateVideoUrl ? <video ref={videoRef} key={current.videoUrl || current.candidateVideoUrl} src={current.videoUrl || current.candidateVideoUrl} preload="metadata" controls={Boolean(current.candidateVideoUrl && !current.videoUrl)} muted={Boolean(current.audioUrl)} loop playsInline style={{ filter: previewFilter }} /> : current?.imageUrl ? <img className={`motion-preview motion-${current.motion || "push"}`} key={current.imageUrl} src={current.imageUrl} alt={current.visual} style={{ filter: previewFilter, animationDuration: `${Math.max(3, current.duration)}s` }} /> : <div className="stage-placeholder"><span>{String(currentIndex + 1).padStart(2, "0")}</span><p>{current?.status === "animating" ? "视频 AI 正在生成角色动态表演" : current?.status === "painting" ? "生图 AI 正在绘制一致性关键帧" : "等待生成镜头"}</p></div>}
              {showFilm && exportUrl ? <div className="film-corner">AI 漫剧成片</div> : current && <><div className="stage-shade" /><div className="stage-label"><span>{String(currentIndex + 1).padStart(2, "0")}</span><b>{current.title}</b></div>{current.candidateVideoUrl && !current.videoUrl && <div className="film-corner">待复核候选 · 未进入成片</div>}{subtitleEnabled && current.subtitleEnabled !== false && <div className={`subtitle ${current.subtitlePosition || "bottom"}`} style={{ color: subtitleColor, fontSize: `${14 * subtitleScale}px` }}>“{current.dialogue}”</div>}</>}
            </div>
            {!showFilm && current?.candidateVideoUrl && !current.videoUrl && <div className="candidate-review-panel">
              <div><span>LIVE REVIEW</span><b>{current.consistencyDecision === "pass" ? "视频已生成，等待你逐项批准" : "这个镜头需要你的判断"}</b><p>{current.consistencyReport?.findings.slice(0, 2).join("；") || "人物、服装、画风或镜头连续性需要人工复核。"}</p></div>
              <strong>{current.consistencyReport?.overall ?? "--"}<small>/100</small></strong>
              <label className="candidate-revision-field"><b>你的修改要求（可与 AI 评分原因一起提交）</b><textarea value={current.videoRevisionRequest || ""} onChange={(event) => updateScene(current.id, { videoRevisionRequest: event.target.value })} placeholder="例如：人物不要回头；改为缓慢横向跟拍；右手道具保持不变；台词语速慢一点。" /></label>
              <div className="candidate-review-actions"><button onClick={() => current.candidateVideoUrl && setVideoReviewPreview({ url: current.candidateVideoUrl, name: current.title })}>大窗预览视频</button><button className="candidate-rebuild" onClick={() => void reviseCandidateVideo(current)} disabled={busy || Boolean(sceneAction)}>不合格，按评分原因修改（可填写要求）</button><button onClick={() => void approveCandidateVideo(current)} disabled={Boolean(sceneAction)}>合格，批准并生成下一镜</button><button className="candidate-delete" onClick={() => discardCandidateVideo(current)} disabled={Boolean(sceneAction)}>删除候选</button></div>
            </div>}
            {showFilm && exportUrl ? <div className="film-toolbar"><div><b>{nativeVideoEnabled ? "AI 漫剧成片已生成" : "低动态流程样片已生成"}</b><span>{nativeVideoEnabled ? `六岗位协作生成，动态镜头、字幕${generatedVoiceEnabled ? "、分角色配音" : ""}${musicUrl ? "与剧情配乐" : ""}已经合成` : "这是图片运镜预览，不是人物原生动画；可用于确认剧本、分镜与节奏"}</span></div><button className="secondary" onClick={() => setShowFilm(false)}>编辑分镜</button><button onClick={() => void openInProfessionalEditor()} disabled={editorSyncState === "saving"}>{editorSyncState === "saving" ? `整理素材 ${editorSyncProgress}%` : "进入专业剪辑台"}</button><button onClick={downloadFilm}>下载成片</button></div> : <>
              <div className="play-controls"><button onClick={() => setPlaying((value) => !value)} disabled={!scenes.length}>{playing ? "Ⅱ" : "▶"}</button><span>{formatTime(time)}</span><input type="range" aria-label="播放进度" min={0} max={100} value={totalDuration ? (time / totalDuration) * 100 : 0} onChange={(event) => seek(Number(event.target.value))} /><span>{formatTime(totalDuration)}</span><button onClick={() => { setPlaying(false); setTime(0); }}>↺</button></div>
              <div className="export-panel"><div><b>{nativeVideoEnabled ? "重新合成 AI 漫剧" : "重新生成流程样片"}</b><span>{nativeVideoEnabled && generatedVoiceEnabled && voiceEnabled ? "动态表演、字幕、分角色配音与配乐将写入视频" : "关键帧、运镜、转场和字幕将写入样片"}</span></div><button onClick={() => void exportFilm()} disabled={phase === "exporting"}>{phase === "exporting" ? `正在录制 ${exportProgress}%` : nativeVideoEnabled ? "生成 AI 漫剧成片" : "生成低动态样片"}</button></div>
              {exportUrl && <div className="export-result"><video src={exportUrl} preload="metadata" controls playsInline /><div><b>已有漫剧成片</b><span>可以返回成片模式播放，或重新剪辑。</span><button onClick={() => setShowFilm(true)}>播放成片</button><button onClick={downloadFilm}>下载成片</button></div></div>}
            </>}
          </div>

          <div className="timeline-panel">
            <div className="timeline-title"><div><b>智能镜头计划</b><span>点击选择，下面可编辑</span></div><button onClick={addScene}>＋ 新增镜头</button></div>
            <div className="scene-list">{scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }}><div className="scene-thumb">{scene.videoUrl || scene.candidateVideoUrl ? <span className="video-thumbnail-placeholder">▶</span> : !nativeVideoEnabled && scene.imageUrl ? <img src={scene.imageUrl} alt="" loading="lazy" /> : <span>{["painting", "animating"].includes(scene.status) ? "生成中" : String(index + 1).padStart(2, "0")}</span>}</div><div><b>{scene.title}</b><p>{scene.action}</p><small>{scene.duration} 秒 · {scene.videoUrl ? "AI 动态表演" : scene.candidateVideoUrl ? "视频待审核" : !nativeVideoEnabled && scene.imageUrl ? "导入图片镜头" : nativeVideoEnabled ? "待直接生成视频" : "待生成"} · {scene.camera}</small></div><i className={`scene-state ${scene.status}`} /></button>)}</div>
            {selectedScene && <div className="scene-editor">
              <div className="editor-heading"><b>镜头 {String(selected + 1).padStart(2, "0")} · 属性检查器</b><div><button onClick={() => moveScene(selected, -1)} disabled={selected === 0}>↑</button><button onClick={() => moveScene(selected, 1)} disabled={selected === scenes.length - 1}>↓</button><button onClick={() => duplicateScene(selected)}>复制</button><button className="danger" onClick={() => deleteScene(selected)}>删除</button></div></div>
              <div className="local-media-tools">{!nativeVideoEnabled && <label>替换图片<input type="file" accept="image/*" onChange={(event) => { replaceSceneMedia(selectedScene, "image", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>}<label>导入视频<input type="file" accept="video/*" onChange={(event) => { replaceSceneMedia(selectedScene, "video", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label>导入配音<input type="file" accept="audio/*" onChange={(event) => { replaceSceneMedia(selectedScene, "audio", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>{selectedScene.videoUrl && selectedScene.speaker && <button type="button" onClick={() => void extractVoiceProfileFromScene(selectedScene)} disabled={Boolean(assetAction)}>{assetAction === `voice-extract:${selectedScene.id}` ? "正在摘取音色…" : `摘取${selectedScene.speaker}音色`}</button>}</div>
              <label>镜头标题<input value={selectedScene.title} onChange={(event) => updateScene(selectedScene.id, { title: event.target.value })} /></label>
              <div className="editor-grid"><label>景别<input value={selectedScene.shot} onChange={(event) => updateScene(selectedScene.id, { shot: event.target.value })} /></label><label>文字运镜描述<input value={selectedScene.camera} onChange={(event) => updateScene(selectedScene.id, { camera: event.target.value })} /></label><label>说话角色<input value={selectedScene.speaker} onChange={(event) => updateScene(selectedScene.id, { speaker: event.target.value })} /></label><label>表演情绪<input value={selectedScene.emotion} onChange={(event) => updateScene(selectedScene.id, { emotion: event.target.value })} /></label></div>
              <label>场景与构图<textarea value={selectedScene.visual} onChange={(event) => updateScene(selectedScene.id, { visual: event.target.value })} /></label>
              <label>人物动作与表演<textarea value={selectedScene.action} onChange={(event) => updateScene(selectedScene.id, { action: event.target.value })} /></label>
              <label>角色台词<textarea value={selectedScene.dialogue} onChange={(event) => updateScene(selectedScene.id, { dialogue: event.target.value })} /></label>
              <div className="editor-grid"><label>2.5D 动态<select value={selectedScene.motion || "push"} onChange={(event) => updateScene(selectedScene.id, { motion: event.target.value as MotionPreset })}>{MOTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>转场<select value={selectedScene.transition || "fade"} onChange={(event) => updateScene(selectedScene.id, { transition: event.target.value as TransitionPreset })}>{TRANSITION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>画面滤镜<select value={selectedScene.filter || "none"} onChange={(event) => updateScene(selectedScene.id, { filter: event.target.value as VisualFilter })}><option value="none">原色</option><option value="warm">暖调电影感</option><option value="cool">冷调悬疑</option><option value="mono">黑白漫画</option></select></label><label>字幕位置<select value={selectedScene.subtitlePosition || "bottom"} onChange={(event) => updateScene(selectedScene.id, { subtitlePosition: event.target.value as SubtitlePosition })}><option value="top">顶部</option><option value="center">中央</option><option value="bottom">底部</option></select></label></div>
              <div className="editor-grid"><label>镜头时长<input type="number" min={1} max={15} step={0.5} value={selectedScene.duration} onChange={(event) => updateScene(selectedScene.id, { duration: Math.max(1, Math.min(15, Number(event.target.value))) })} /></label><label>视频速度<input type="number" min={0.5} max={2} step={0.1} value={selectedScene.speed || 1} onChange={(event) => updateScene(selectedScene.id, { speed: Math.max(0.5, Math.min(2, Number(event.target.value))) })} /></label><label>配音音量<input type="range" min={0} max={2} step={0.05} value={selectedScene.volume ?? 1} onChange={(event) => updateScene(selectedScene.id, { volume: Number(event.target.value) })} /></label><label>运镜强度<input type="range" min={0.35} max={1.8} step={0.05} value={selectedScene.motionIntensity || 1} onChange={(event) => updateScene(selectedScene.id, { motionIntensity: Number(event.target.value) })} /></label></div>
              <div className="subtitle-switch"><div><b>显示本镜字幕</b><span>关闭后对白仍保留在剧本中</span></div><button className={`toggle ${selectedScene.subtitleEnabled !== false ? "on" : ""}`} onClick={() => updateScene(selectedScene.id, { subtitleEnabled: selectedScene.subtitleEnabled === false })}><i /></button></div>
              <label>音效设计<input value={selectedScene.sfx} onChange={(event) => updateScene(selectedScene.id, { sfx: event.target.value })} /></label>
              <div className="editor-actions">{!nativeVideoEnabled && <button onClick={() => void regenerateImage(selectedScene, selected)} disabled={busy || Boolean(sceneAction)}>{sceneAction?.id === selectedScene.id && sceneAction.type === "image" ? "生图 AI 正在重做…" : "让生图 AI 重做"}</button>}<button className="video-action" onClick={() => void generateVideo(selectedScene)} disabled={busy || Boolean(sceneAction)}>{sceneAction?.id === selectedScene.id && sceneAction.type === "video" ? "视频 AI 正在重做…" : nativeVideoEnabled ? "全能参考重做视频" : "配置视频 AI"}</button></div>
            </div>}
          </div>
        </div>

        <div className="nle-workspace">
          <div className="nle-toolbar">
            <div><b>多轨剪辑台</b><span>像剪映一样拖动片段排序，移动播放头后可以分割</span></div>
            <div className="nle-actions">
              <button onClick={() => setPlaying((value) => !value)}>{playing ? "暂停" : "播放"}</button>
              <button onClick={splitAtPlayhead}>分割</button>
              <button onClick={() => deleteScene(selected)} disabled={!selectedScene}>删除片段</button>
              <label>缩放<input type="range" aria-label="时间轴缩放" min={0.6} max={2.4} step={0.2} value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} /></label>
              <label>字幕<input type="range" aria-label="字幕大小" min={0.7} max={1.6} step={0.1} value={subtitleScale} onChange={(event) => { setSubtitleScale(Number(event.target.value)); invalidateExport(); }} /></label>
              <label className="color-tool">颜色<input type="color" aria-label="字幕颜色" value={subtitleColor} onChange={(event) => { setSubtitleColor(event.target.value); invalidateExport(); }} /></label>
              <label>BGM<input type="range" aria-label="背景音乐音量" min={0} max={0.8} step={0.02} value={musicVolume} onChange={(event) => { setMusicVolume(Number(event.target.value)); invalidateExport(); }} /></label>
            </div>
          </div>
          <div className="nle-grid">
            <div className="track-labels"><span className="ruler-label">时间</span><span>视频</span><span>配音</span><span>字幕</span><span>配乐</span></div>
            <div className="timeline-scroll">
              <div className="timeline-canvas" style={{ width: timelineWidth }}>
                <div className="time-ruler">
                  {Array.from({ length: Math.floor(totalDuration / 5) + 1 }, (_, index) => <i key={index} style={{ left: `${totalDuration ? (index * 5 / totalDuration) * 100 : 0}%` }}><span>{formatTime(index * 5)}</span></i>)}
                </div>
                <input className="timeline-scrubber" type="range" aria-label="时间轴播放头" min={0} max={totalDuration || 1} step={0.1} value={Math.min(time, totalDuration)} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); setShowFilm(false); }} />
                <div className="playhead" style={{ left: totalDuration ? (time / totalDuration) * timelineWidth : 0 }}><i /></div>
                <div className="timeline-track video-track">
                  {scenes.map((scene, index) => <button type="button" draggable key={scene.id} className={`video-clip ${selected === index ? "selected" : ""} ${draggingScene === index ? "dragging" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onDragStart={() => setDraggingScene(index)} onDragEnd={() => setDraggingScene(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingScene !== null) reorderScene(draggingScene, index); setDraggingScene(null); }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); setShowFilm(false); }} aria-label={`选择并拖动镜头 ${scene.title}`}>
                    <span className="clip-thumb">{scene.videoUrl || scene.candidateVideoUrl ? <i className="video-thumbnail-placeholder">▶</i> : !nativeVideoEnabled && scene.imageUrl ? <img src={scene.imageUrl} alt="" loading="lazy" /> : <i>{String(index + 1).padStart(2, "0")}</i>}</span><b>{scene.title}</b><small>{scene.duration} 秒</small>
                  </button>)}
                </div>
                <div className="timeline-track voice-track">
                  {scenes.map((scene, index) => <button type="button" key={scene.id} className={`audio-clip ${selected === index ? "selected" : ""} ${!scene.audioUrl ? "device-voice" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }}><i><span /><span /><span /><span /><span /><span /></i><b>{scene.speaker || "旁白"}</b></button>)}
                </div>
                {subtitleEnabled && <div className="timeline-track subtitle-track">
                  {scenes.map((scene, index) => <button type="button" key={scene.id} className={`subtitle-clip ${selected === index ? "selected" : ""}`} style={{ width: Math.max(50, (scene.duration / Math.max(totalDuration, 1)) * timelineWidth) }} onClick={() => { setSelected(index); setTime(offsets[index]); setPlaying(false); }} title={scene.dialogue}>{scene.dialogue || "（无台词）"}</button>)}
                </div>}
                <div className="timeline-track music-track"><div className={`music-clip ${musicUrl ? "ready" : ""}`}><i>♪</i><span>{musicUrl ? musicPrompt || "剧情配乐" : bgmEnabled ? "配乐将在生成后进入这里" : "配乐已关闭"}</span></div></div>
              </div>
            </div>
          </div>
          <div className="nle-footer"><span>播放头 <b>{formatTime(time)}</b></span><span>选中 <b>{selectedScene?.title}</b></span><span>成片 <b>{formatTime(totalDuration)}</b></span><button onClick={() => void exportFilm()} disabled={phase === "exporting"}>{phase === "exporting" ? `正在合成 ${exportProgress}%` : "重新合成成片"}</button></div>
        </div></>}
      </section>

      <section id="capabilities" className="capabilities section-shell">
        <div className="section-heading"><span>03</span><div><p>能力说明</p><h2>每个按钮背后，都有真实结果</h2></div></div>
        <div className="capability-grid"><article><i>人</i><b>角色资产锁定</b><p>先生成固定人设，后续关键帧和视频都引用同一角色资产。</p></article><article><i>演</i><b>分镜级动态表演</b><p>完整模式以关键帧驱动视频模型，生成人物动作、表情和运镜。</p></article><article><i>声</i><b>角色声音设计</b><p>按说话角色匹配音色，并生成剧情配乐后自动混音。</p></article><article><i>片</i><b>自动剪辑成片</b><p>字幕、镜头衔接、声音和视频真正写入可下载的成片。</p></article></div>
      </section>

      {assetImagePreview && <div className="asset-image-lightbox" role="dialog" aria-modal="true" aria-label={`${assetImagePreview.name}图片预览`} onClick={() => setAssetImagePreview(null)}><button type="button" onClick={() => setAssetImagePreview(null)} aria-label="关闭图片预览">×</button><figure onClick={(event) => event.stopPropagation()}><img src={assetImagePreview.url} alt={assetImagePreview.name} /><figcaption>{assetImagePreview.name}</figcaption></figure></div>}
      {videoReviewPreview && <div className="video-review-lightbox" role="dialog" aria-modal="true" aria-label={`${videoReviewPreview.name}视频预览`} onClick={() => setVideoReviewPreview(null)}><button type="button" onClick={() => setVideoReviewPreview(null)} aria-label="关闭视频预览">×</button><figure onClick={(event) => event.stopPropagation()}><video src={videoReviewPreview.url} controls autoPlay playsInline preload="auto" /><figcaption><b>{videoReviewPreview.name}</b><span>请完整播放并检查人物、动作、运镜、声音和镜头衔接后再批准。</span></figcaption></figure></div>}

      <footer><div className="brand"><span>漫</span><strong>漫镜</strong></div><p>让每一个好故事，都真正被看见。</p><small>生成服务可能排队或限流，失败会如实提示。</small></footer>
    </main>
  );
}
