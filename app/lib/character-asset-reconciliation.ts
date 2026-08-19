import { normalizeAssetIdentity, normalizeAssetLook } from "./asset-reuse";

export type ReconciliableCharacterAsset = {
  id: string;
  name: string;
  identityName?: string;
  lookName?: string;
  libraryAssetId?: string;
  imageUrl?: string;
  remoteUrl?: string;
  arkAssetId?: string;
  portraitAuthorizationStatus?: "unbound" | "pending" | "authorized";
  sheetVersion?: 2 | 3;
  reviewDecision?: "pending" | "approved" | "rejected";
  assetMatchKind?: "exact" | "look-candidate";
  status: "queued" | "generating" | "ready" | "error";
  identityBaseline?: boolean;
};

function identityOf(asset: ReconciliableCharacterAsset) {
  return normalizeAssetIdentity(asset.identityName || asset.name);
}

function lookOf(asset: ReconciliableCharacterAsset) {
  return normalizeAssetLook(asset.lookName);
}

function keyOf(asset: ReconciliableCharacterAsset) {
  return `${identityOf(asset)}::${lookOf(asset)}`;
}

function hasUserOrApprovedMedia(asset: ReconciliableCharacterAsset) {
  return Boolean(asset.imageUrl || asset.libraryAssetId) && asset.reviewDecision !== "rejected";
}

/**
 * Reconcile a new script analysis with assets the user has already approved.
 *
 * Identity and episode look deliberately have different lifetimes: analysis may
 * add/remove outfit frames, but it must never detach the only approved face for
 * a person. Exact looks keep their media in place. An unmatched approved look is
 * retained as an identity-only baseline so a newly required outfit can use that
 * face as its real image-model reference instead of recasting the character.
 */
export function reconcileAnalyzedCharacterAssets<T extends ReconciliableCharacterAsset>(previous: T[], analyzed: T[]): T[] {
  const exactPrevious = new Map(previous.map((asset) => [keyOf(asset), asset]));
  const analyzedKeys = new Set(analyzed.map(keyOf));
  const analyzedIdentities = new Set(analyzed.map(identityOf));

  const reconciled = analyzed.map((asset) => {
    const existing = exactPrevious.get(keyOf(asset));
    if (!existing) return asset;
    return {
      ...asset,
      id: existing.id,
      libraryAssetId: existing.libraryAssetId,
      imageUrl: existing.imageUrl,
      remoteUrl: existing.remoteUrl,
      arkAssetId: existing.arkAssetId,
      portraitAuthorizationStatus: existing.portraitAuthorizationStatus,
      sheetVersion: existing.sheetVersion,
      reviewDecision: existing.reviewDecision,
      assetMatchKind: existing.assetMatchKind,
      identityBaseline: existing.identityBaseline,
      status: existing.imageUrl ? "ready" as const : asset.status,
    } as T;
  });

  for (const existing of previous) {
    const identity = identityOf(existing);
    if (!identity || !analyzedIdentities.has(identity) || analyzedKeys.has(keyOf(existing)) || !hasUserOrApprovedMedia(existing)) continue;
    reconciled.push({ ...existing, identityBaseline: true, status: existing.imageUrl ? "ready" : existing.status } as T);
  }

  const unique = new Map<string, T>();
  for (const asset of reconciled) {
    const key = keyOf(asset);
    const current = unique.get(key);
    if (!current || (!current.imageUrl && asset.imageUrl)) unique.set(key, asset);
  }
  return [...unique.values()];
}
