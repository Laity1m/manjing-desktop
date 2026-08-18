import { normalizeAssetIdentity, normalizeAssetLook } from "./asset-reuse";

export type CharacterIdentityReferenceCandidate = {
  id: string;
  name: string;
  identityName?: string;
  lookName?: string;
  imageUrl?: string;
  remoteUrl?: string;
  reviewDecision?: "pending" | "approved" | "rejected";
  assetMatchKind?: "exact" | "look-candidate";
};

export type LibraryCharacterIdentityAnchor = {
  id: string;
  name: string;
  identityKey?: string;
  entityId?: string;
  lookName?: string;
  variantName?: string;
  category: string;
  mediaType: string;
  reusable?: boolean;
  locked?: boolean;
  canonical?: boolean;
  assetState?: string;
  createdAt: string;
};

function identityOf(candidate: CharacterIdentityReferenceCandidate) {
  return normalizeAssetIdentity(candidate.identityName || candidate.name);
}

function referenceScore(candidate: CharacterIdentityReferenceCandidate, targetId: string) {
  const approved = candidate.reviewDecision === "approved" ? 1000 : candidate.reviewDecision === "pending" ? 300 : 0;
  const baseLook = normalizeAssetLook(candidate.lookName || "基础版") === "base" ? 80 : 0;
  const exactAsset = candidate.assetMatchKind === "exact" ? 40 : 0;
  const publicReference = /^https:\/\//i.test(candidate.remoteUrl || "") ? 20 : 0;
  const currentCard = candidate.id === targetId ? 10 : 0;
  return approved + baseLook + exactAsset + publicReference + currentCard;
}

export function selectCharacterIdentityReference<T extends CharacterIdentityReferenceCandidate>(target: T, candidates: T[]) {
  const identity = identityOf(target);
  return candidates
    .filter((candidate) => identityOf(candidate) === identity)
    .filter((candidate) => candidate.reviewDecision !== "rejected")
    .filter((candidate) => Boolean(candidate.remoteUrl || candidate.imageUrl))
    .map((candidate, index) => ({ candidate, index, score: referenceScore(candidate, target.id) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.candidate;
}

/**
 * Selects one permanent face anchor for an identity across app versions and
 * outfit variants. Canonical/base assets outrank newer look-specific assets;
 * ties deliberately prefer the oldest approved anchor so an app update cannot
 * silently replace a person's face with the newest generation.
 */
export function selectLibraryCharacterIdentityAnchor<T extends LibraryCharacterIdentityAnchor>(identityName: string, assets: T[]) {
  const identity = normalizeAssetIdentity(identityName);
  return assets
    .filter((asset) => asset.category === "character" && asset.mediaType === "image")
    .filter((asset) => asset.reusable !== false && asset.assetState !== "placeholder")
    .filter((asset) => normalizeAssetIdentity(asset.identityKey || asset.entityId || asset.name) === identity)
    .map((asset) => {
      const baseLook = normalizeAssetLook(asset.lookName || asset.variantName || "基础版") === "base";
      const score = Number(Boolean(asset.canonical)) * 1000 + Number(Boolean(asset.locked)) * 300 + Number(asset.assetState === "ready") * 120 + Number(baseLook) * 80;
      return { asset, score };
    })
    .sort((left, right) => right.score - left.score || left.asset.createdAt.localeCompare(right.asset.createdAt))[0]?.asset;
}

export function characterIdentityLockInstruction(identity: string, lookName: string, hasReference: boolean) {
  if (!hasReference) return "";
  return `REFERENCE IMAGE 1 IS THE PERMANENT CANONICAL FACE ANCHOR FOR ${identity}. Copy the same person, not a similar casting: preserve skull silhouette, facial thirds, eye shape and spacing, eyebrows, nose bridge and tip, philtrum, mouth width, jaw, cheek structure, ears, age, skin tone, hairline and stable identifying marks. Change only the episode look to ${lookName}; old clothing and state are not identity. Do not average this face with another reference, beautify it into a generic face, or redesign any landmark. Keep the requested character-reference composition while using reference image 1 as the single face authority.`;
}
