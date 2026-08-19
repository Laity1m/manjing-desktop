import { normalizeAssetIdentity, normalizeAssetLook } from "./asset-reuse";

export const DUPLICATE_CHARACTER_ARCHIVE_TAG = "重复人物版本归档";

export type CharacterAssetDeduplicationCandidate = {
  id: string;
  category: string;
  mediaType: string;
  identityKey?: string;
  lookName?: string;
  projectId?: string;
  scope?: "project" | "global";
  sourceChoice?: "unselected" | "upload" | "ai";
  recognitionStatus?: "pending" | "recognized" | "confirmed" | "rejected";
  assetState?: "placeholder" | "generating" | "review" | "ready";
  canonical?: boolean;
  locked?: boolean;
  reusable?: boolean;
  usageCount?: number;
  createdAt: string;
  tags: string[];
};

function duplicateKey(asset: CharacterAssetDeduplicationCandidate) {
  if (asset.category !== "character" || asset.mediaType !== "image" || !asset.identityKey?.trim()) return "";
  const scope = asset.scope === "global" || !asset.projectId ? "global" : `project:${asset.projectId}`;
  return `${scope}::${normalizeAssetIdentity(asset.identityKey)}::${normalizeAssetLook(asset.lookName || "基础版")}`;
}

function priority(asset: CharacterAssetDeduplicationCandidate) {
  // A user supplied or explicitly confirmed identity is never displaced by a
  // later AI rendition. Other signals only break ties within the same source.
  return (asset.sourceChoice === "upload" ? 1_000_000 : 0)
    + (asset.recognitionStatus === "confirmed" ? 300_000 : 0)
    + (asset.canonical ? 100_000 : 0)
    + (asset.assetState === "ready" ? 40_000 : 0)
    + (asset.locked ? 10_000 : 0)
    + (asset.reusable !== false ? 5_000 : 0)
    + Math.min(4_999, Math.max(0, asset.usageCount || 0));
}

export function planCharacterAssetDeduplication<T extends CharacterAssetDeduplicationCandidate>(assets: T[]) {
  const groups = new Map<string, T[]>();
  for (const asset of assets) {
    if (asset.tags.includes(DUPLICATE_CHARACTER_ARCHIVE_TAG)) continue;
    const key = duplicateKey(asset);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(asset);
    groups.set(key, group);
  }
  const result: Array<{ key: string; keep: T; archive: T[] }> = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((left, right) => priority(right) - priority(left)
      || right.createdAt.localeCompare(left.createdAt)
      || left.id.localeCompare(right.id));
    result.push({ key, keep: ranked[0], archive: ranked.slice(1) });
  }
  return result;
}
