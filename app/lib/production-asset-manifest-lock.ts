import { normalizeAssetIdentity, normalizeAssetLook } from "./asset-reuse";
import { canonicalCharacterLookName, isReusableSceneAssetCandidate } from "./script-asset-manifest";
import { isGenericNonAssetCharacter } from "./series-project";

export type ProductionManifestCharacter = {
  name: string;
  identityName?: string;
  lookName?: string;
  appearance?: string;
};

export type ProductionManifestScene = {
  title?: string;
  visual?: string;
  action?: string;
  characters: string[];
  speaker?: string;
  characterLooks?: Record<string, string>;
};

export type ProductionManifestEnvironment = {
  name: string;
  environmentKey: string;
  description?: string;
  sceneHints?: string[];
};

type EnvironmentStoryboardScene = {
  title?: string;
  visual?: string;
  action?: string;
  environmentKey?: string;
  environmentBible?: string;
};

function normalizedEnvironment(value: unknown) {
  return normalizeAssetIdentity(String(value || "").replace(/^scene:/i, ""));
}

function labeledScene(text: string) {
  return String(text || "").match(/\[场景[：:]([^\]]+)\]/i)?.[1]?.split(/[，,、]/)[0]?.trim() || "";
}

/**
 * Bind storyboard shots to the one scene manifest approved during import.
 * Shot titles and dramatic beats are never promoted into scene assets.
 */
export function lockStoryboardScenesToAssetManifest<TScene extends EnvironmentStoryboardScene>(scenes: TScene[], approvedScenes: ProductionManifestEnvironment[]) {
  const environments = approvedScenes.filter((item) => isReusableSceneAssetCandidate(item.environmentKey, item.name));
  const remapped: string[] = [];
  const blocked: string[] = [];
  const lockedScenes = scenes.map((scene) => {
    const explicit = String(scene.environmentKey || labeledScene(scene.visual || "") || "").trim();
    const normalizedExplicit = normalizedEnvironment(explicit);
    let match = normalizedExplicit ? environments.find((item) => [item.environmentKey, item.name].some((value) => normalizedEnvironment(value) === normalizedExplicit)) : undefined;
    if (!match) {
      const sceneText = `${scene.title || ""} ${scene.visual || ""} ${scene.action || ""}`.toLocaleLowerCase("zh-CN");
      const ranked = environments.map((item, index) => {
        const names = [item.environmentKey, item.name].map((value) => String(value || "").trim()).filter(Boolean);
        const nameScore = names.reduce((score, name) => score + (sceneText.includes(name.toLocaleLowerCase("zh-CN")) ? 100 : 0), 0);
        const hintScore = (item.sceneHints || []).reduce((score, hint) => score + (hint && sceneText.includes(hint.toLocaleLowerCase("zh-CN")) ? 30 : 0), 0);
        return { item, index, score: nameScore + hintScore };
      }).sort((left, right) => right.score - left.score || left.index - right.index);
      if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score || 0)) match = ranked[0].item;
    }
    if (!match && environments.length === 1) match = environments[0];
    if (!match) {
      blocked.push(explicit && isReusableSceneAssetCandidate(explicit, explicit) ? explicit : `镜头“${scene.title || "未命名"}”缺少可确认地点`);
      return scene;
    }
    if (explicit && normalizedEnvironment(explicit) !== normalizedEnvironment(match.environmentKey)) remapped.push(`${explicit}→${match.environmentKey}`);
    return { ...scene, environmentKey: match.environmentKey, environmentBible: scene.environmentBible || match.description || "按已确认的 Canonical 场景保持空间布局与光线" } as TScene;
  });
  return { scenes: lockedScenes, remapped: [...new Set(remapped)], blocked: [...new Set(blocked)] };
}

function identityOf(value: ProductionManifestCharacter) {
  return normalizeAssetIdentity(value.identityName || value.name);
}

function plannedLookScore(requested: string, candidate: ProductionManifestCharacter, sceneText: string) {
  const candidateLook = normalizeAssetLook(canonicalCharacterLookName(candidate.lookName, candidate.appearance));
  if (candidateLook === requested) return 1000;
  if (candidateLook.includes(requested) || requested.includes(candidateLook)) return 500;
  const display = `${candidate.lookName || ""} ${candidate.appearance || ""}`.toLocaleLowerCase("zh-CN");
  const tokens = [...new Set(`${requested} ${sceneText}`.match(/[\u3400-\u9fff]{2,6}|[a-z]{3,}/giu) || [])];
  return tokens.reduce((score, token) => score + (display.includes(token.toLocaleLowerCase("zh-CN")) ? 20 : 0), 0)
    + (candidateLook === "base" ? 2 : 0);
}

function selectPlannedLook(requestedLook: string, candidates: ProductionManifestCharacter[], sceneText: string) {
  const requested = normalizeAssetLook(canonicalCharacterLookName(requestedLook));
  return candidates
    .map((candidate, index) => ({ candidate, index, score: plannedLookScore(requested, candidate, sceneText) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.candidate;
}

/**
 * Imported scripts have one authoritative asset manifest. Storyboard agents may
 * choose from it, but cannot create a second set of people or costume labels.
 */
export function lockStoryboardToAssetManifest<
  TCharacter extends ProductionManifestCharacter,
  TScene extends ProductionManifestScene,
>(storyboardCharacters: TCharacter[], scenes: TScene[], approvedManifest: TCharacter[]) {
  const plannedByIdentity = new Map<string, TCharacter[]>();
  for (const item of approvedManifest) {
    const identity = identityOf(item);
    if (!identity) continue;
    plannedByIdentity.set(identity, [...(plannedByIdentity.get(identity) || []), item]);
  }
  const canonicalIdentityName = new Map([...plannedByIdentity.entries()].map(([identity, items]) => [identity, items[0].identityName || items[0].name]));
  const remapped: string[] = [];
  const blocked: string[] = [];
  const lockedCharacters: TCharacter[] = [];
  for (const character of storyboardCharacters) {
    if (isGenericNonAssetCharacter(character.identityName || character.name)) continue;
    const identity = identityOf(character);
    const candidates = plannedByIdentity.get(identity) || [];
    if (!candidates.length) {
      blocked.push(character.identityName || character.name);
      continue;
    }
    const sceneText = scenes.filter((scene) => scene.characters.some((name) => normalizeAssetIdentity(name) === identity)).map((scene) => `${scene.title || ""} ${scene.visual || ""} ${scene.action || ""}`).join(" ");
    const planned = selectPlannedLook(character.lookName || "基础版", candidates, sceneText) || candidates[0];
    const requested = canonicalCharacterLookName(character.lookName, character.appearance);
    const selected = canonicalCharacterLookName(planned.lookName, planned.appearance);
    if (normalizeAssetLook(requested) !== normalizeAssetLook(selected)) remapped.push(`${planned.identityName || planned.name}：${requested}→${selected}`);
    lockedCharacters.push({ ...character, name: planned.identityName || planned.name, identityName: planned.identityName || planned.name, lookName: planned.lookName || selected } as TCharacter);
  }
  const lockedScenes = scenes.map((scene) => {
    const sceneText = `${scene.title || ""} ${scene.visual || ""} ${scene.action || ""}`;
    const characters = scene.characters.flatMap((name) => {
      if (isGenericNonAssetCharacter(name)) return [];
      const identityName = canonicalIdentityName.get(normalizeAssetIdentity(name));
      if (identityName) return [identityName];
      blocked.push(name);
      return [];
    });
    const speaker = scene.speaker ? canonicalIdentityName.get(normalizeAssetIdentity(scene.speaker)) || scene.speaker : scene.speaker;
    const characterLooks = Object.fromEntries(Object.entries(scene.characterLooks || {}).flatMap(([name, requestedLook]) => {
      if (isGenericNonAssetCharacter(name)) return [];
      const identity = normalizeAssetIdentity(name);
      const candidates = plannedByIdentity.get(identity) || [];
      const identityName = canonicalIdentityName.get(identity);
      if (!identityName || !candidates.length) {
        blocked.push(name);
        return [];
      }
      const planned = selectPlannedLook(requestedLook, candidates, sceneText) || candidates[0];
      const requested = canonicalCharacterLookName(requestedLook);
      const selected = canonicalCharacterLookName(planned.lookName, planned.appearance);
      if (normalizeAssetLook(requested) !== normalizeAssetLook(selected)) remapped.push(`${identityName}：${requested}→${selected}`);
      return [[identityName, planned.lookName || selected]];
    }));
    return { ...scene, characters: [...new Set(characters)], speaker, characterLooks } as TScene;
  });
  return { characters: lockedCharacters, scenes: lockedScenes, remapped: [...new Set(remapped)], blocked: [...new Set(blocked)] };
}
