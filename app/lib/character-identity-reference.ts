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

export function characterIdentityLockInstruction(identity: string, lookName: string, hasReference: boolean) {
  if (!hasReference) return "";
  return `REFERENCE IMAGE 1 IS THE LOCKED CANONICAL IDENTITY FOR ${identity}. Use its exact face as an image identity constraint: preserve the same skull and face shape, eyes and spacing, eyebrows, nose, mouth, jaw, cheek structure, ears, age, skin tone, hairline and stable identifying marks. This is the same person, not a similar casting. Change only the episode look to ${lookName}: replace the old clothing, grooming, injuries and state only where the new look requires it. Do not blend the old and new outfits. Keep the required character-sheet layout while copying the identity from reference image 1.`;
}
