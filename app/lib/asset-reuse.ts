export type ReusableAssetRecord = {
  id: string;
  name: string;
  category: string;
  mediaType: string;
  tags: string[];
  reusable?: boolean;
  locked?: boolean;
  canonical?: boolean;
  identityKey?: string;
  entityId?: string;
  lookName?: string;
  variantName?: string;
  assetState?: string;
  projectId?: string;
  scope?: string;
  usageCount?: number;
  createdAt: string;
};

export type ReusableAssetRequest = {
  category: "character" | "scene" | "prop" | "audio";
  identityKey: string;
  lookName?: string;
  projectId?: string;
  mediaType?: "image" | "audio";
  allowCrossProject?: boolean;
};

export function normalizeAssetIdentity(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/^(?:scene|character|prop|角色|人物|场景|道具)[:：]/iu, "")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/[\s_\-—·•:：/\\()[\]{}]+/gu, "");
}

export function normalizeAssetLook(value?: string) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/^(?:造型|状态|服装|look|costume|variant)[:：]?/iu, "")
    .replace(/[\s_\-—·•:：/\\()[\]{}]+/gu, "")
    .replace(/(?:版本|version)$/iu, "");
  if (!normalized || /^(?:基础|基础版|基础造型|默认|默认版|默认造型|当前|当前版|当前造型|本集|本集版|本集造型|标准|标准版|标准造型|原始|原始版|常规|常规版|普通|普通版|base|baselook|default|defaultlook|current|currentlook|currentepisodelook|episodelook|standard|standardlook|original|originallook|regular|regularlook|canonical|canonicallook)$/iu.test(normalized)) return "base";
  return normalized.replace(/版$/u, "");
}

function assetIdentityStrength(asset: ReusableAssetRecord, requestedIdentity: string, requestedLook: string) {
  const identity = normalizeAssetIdentity(asset.identityKey || "");
  if (identity && identity === requestedIdentity) return 90;
  const entity = normalizeAssetIdentity(asset.entityId || "");
  if (entity && entity === requestedIdentity) return 82;
  const entityTag = asset.tags.find((tag) => /^entity[:：]/iu.test(tag));
  if (entityTag && normalizeAssetIdentity(entityTag.replace(/^entity[:：]/iu, "")) === requestedIdentity) return 76;
  const name = normalizeAssetIdentity(asset.name.replace(/\.[a-z0-9]{2,8}$/iu, ""));
  const removableSuffixes = [
    "角色设定", "人物设定", "角色资产", "人物资产", "角色", "人物", "character", "charactersheet",
    "场景设定", "空场景", "场景", "scene", "environment",
    "道具设定", "道具", "prop",
  ];
  if (name === requestedIdentity) return 70;
  for (const suffix of removableSuffixes) {
    if (name.endsWith(normalizeAssetIdentity(suffix)) && name.slice(0, -normalizeAssetIdentity(suffix).length) === requestedIdentity) return 68;
  }
  if (requestedLook !== "base") {
    const withoutLook = name.endsWith(requestedLook) ? name.slice(0, -requestedLook.length) : "";
    if (withoutLook === requestedIdentity) return 66;
  } else {
    for (const suffix of ["基础版", "基础造型", "默认版", "默认造型", "baselook", "defaultlook"]) {
      const normalizedSuffix = normalizeAssetIdentity(suffix);
      if (name.endsWith(normalizedSuffix) && name.slice(0, -normalizedSuffix.length) === requestedIdentity) return 64;
    }
  }
  return 0;
}

export function findReusableLibraryAsset<T extends ReusableAssetRecord>(assets: T[], request: ReusableAssetRequest): T | undefined {
  const requestedIdentity = normalizeAssetIdentity(request.identityKey);
  const requestedLook = normalizeAssetLook(request.lookName);
  const requestedProject = String(request.projectId || "").trim();
  if (!requestedIdentity) return undefined;
  return assets.map((asset) => {
    if (asset.category !== request.category || asset.reusable === false || asset.assetState === "placeholder") return null;
    if (request.mediaType && asset.mediaType !== request.mediaType) return null;
    const sameProject = Boolean(requestedProject && asset.projectId === requestedProject);
    const globalAsset = !asset.projectId || asset.scope === "global";
    if (!sameProject && !globalAsset && !request.allowCrossProject) return null;
    const identityStrength = assetIdentityStrength(asset, requestedIdentity, requestedLook);
    if (!identityStrength) return null;
    if (request.category === "character") {
      const assetLook = normalizeAssetLook(asset.lookName || asset.variantName);
      if (requestedLook !== assetLook) return null;
    }
    const projectScore = sameProject ? 60 : globalAsset ? 28 : 8;
    const policyScore = Number(Boolean(asset.canonical)) * 18 + Number(Boolean(asset.locked)) * 10;
    const stateScore = asset.assetState === "ready" ? 8 : 2;
    return { asset, score: identityStrength + projectScore + policyScore + stateScore + Math.min(8, asset.usageCount || 0) };
  }).filter((item): item is { asset: T; score: number } => Boolean(item)).sort((left, right) => right.score - left.score || right.asset.createdAt.localeCompare(left.asset.createdAt))[0]?.asset;
}
