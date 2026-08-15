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
  allowLookFallback?: boolean;
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

const IDENTITY_SUFFIXES = [
  "角色设定图", "人物设定图", "角色标准图", "人物标准图", "角色参考图", "人物参考图", "角色三视图", "人物三视图", "角色四视图", "人物四视图",
  "角色设定", "人物设定", "角色资产", "人物资产", "角色卡", "人物卡", "角色形象", "人物形象", "角色", "人物", "角色图", "人物图",
  "charactersheet", "characterreference", "characterref", "turnaround", "character",
  "场景设定图", "空场景设定图", "场景参考图", "环境设定图", "场景设定", "空场景", "环境图", "场景图", "场景", "environmentreference", "environment", "scene",
  "道具设定图", "道具参考图", "道具设定", "道具图", "道具", "propreference", "propsheet", "prop",
] as const;

const BASE_LOOK_SUFFIXES = [
  "基础版", "基础造型", "默认版", "默认造型", "标准版", "标准造型", "常规版", "普通版", "原始版", "baselook", "defaultlook", "standardlook", "regularlook",
] as const;

function normalizedNameStem(asset: ReusableAssetRecord) {
  return normalizeAssetIdentity(asset.name.replace(/\.[a-z0-9]{2,8}$/iu, ""));
}

function stripKnownSuffixes(value: string) {
  const candidates = new Set([value]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of [...candidates]) {
      for (const suffix of IDENTITY_SUFFIXES) {
        const normalizedSuffix = normalizeAssetIdentity(suffix);
        if (candidate.endsWith(normalizedSuffix) && candidate.length > normalizedSuffix.length) {
          const stripped = candidate.slice(0, -normalizedSuffix.length);
          if (!candidates.has(stripped)) {
            candidates.add(stripped);
            changed = true;
          }
        }
      }
    }
  }
  return [...candidates];
}

function prefixedIdentityTagStrength(asset: ReusableAssetRecord, requestedIdentity: string) {
  for (const tag of asset.tags || []) {
    const value = tag.replace(/^(?:entity|identity|name|asset(?::(?:character|scene|prop))?|character|scene|prop|角色|人物|场景|道具)[:：]/iu, "");
    if (value !== tag && normalizeAssetIdentity(value) === requestedIdentity) return 76;
    if (normalizeAssetIdentity(tag) === requestedIdentity) return 72;
  }
  return 0;
}

function categoryCompatible(asset: ReusableAssetRecord, requestedCategory: ReusableAssetRequest["category"]) {
  if (asset.category === requestedCategory) return true;
  if (asset.category !== "other") return false;
  const evidence = `${asset.name} ${(asset.tags || []).join(" ")}`.toLocaleLowerCase("zh-CN");
  if (requestedCategory === "character") return /角色|人物|character|turnaround|三视图|四视图|purpose:(?:identity|face|hair|costume|body)/iu.test(evidence);
  if (requestedCategory === "scene") return /场景|空景|环境|scene|environment|purpose:(?:scene-layout|lighting|spatial-anchor)/iu.test(evidence);
  if (requestedCategory === "prop") return /道具|prop|purpose:(?:prop-geometry|prop-material)/iu.test(evidence);
  return requestedCategory === "audio" && /音色|配音|声音|voice|purpose:voice/iu.test(evidence);
}

function assetIdentityStrength(asset: ReusableAssetRecord, requestedIdentity: string, requestedLook: string) {
  const identity = normalizeAssetIdentity(asset.identityKey || "");
  if (identity && identity === requestedIdentity) return 90;
  const entity = normalizeAssetIdentity(asset.entityId || "");
  if (entity && entity === requestedIdentity) return 82;
  const tagStrength = prefixedIdentityTagStrength(asset, requestedIdentity);
  if (tagStrength) return tagStrength;
  const name = normalizedNameStem(asset);
  if (name === requestedIdentity) return 70;
  for (const candidate of stripKnownSuffixes(name)) {
    if (candidate === requestedIdentity) return 68;
    if (requestedLook !== "base") {
      if (candidate.startsWith(requestedIdentity) && normalizeAssetLook(candidate.slice(requestedIdentity.length)) === requestedLook) return 66;
    } else {
      for (const suffix of BASE_LOOK_SUFFIXES) {
        const normalizedSuffix = normalizeAssetIdentity(suffix);
        if (candidate.endsWith(normalizedSuffix) && candidate.slice(0, -normalizedSuffix.length) === requestedIdentity) return 64;
      }
    }
  }
  return 0;
}

function inferredCharacterLook(asset: ReusableAssetRecord, requestedIdentity: string) {
  const explicit = asset.lookName || asset.variantName;
  if (explicit) return normalizeAssetLook(explicit);
  const tagged = (asset.tags || []).find((tag) => /^(?:造型|状态|服装|look|costume|variant)[:：]/iu.test(tag));
  if (tagged) return normalizeAssetLook(tagged);
  for (const candidate of stripKnownSuffixes(normalizedNameStem(asset)).sort((left, right) => left.length - right.length)) {
    if (!candidate.startsWith(requestedIdentity)) continue;
    const suffix = candidate.slice(requestedIdentity.length);
    if (!suffix) return "base";
    return normalizeAssetLook(suffix);
  }
  return "base";
}

export function findReusableLibraryAsset<T extends ReusableAssetRecord>(assets: T[], request: ReusableAssetRequest): T | undefined {
  const requestedIdentity = normalizeAssetIdentity(request.identityKey);
  const requestedLook = normalizeAssetLook(request.lookName);
  const requestedProject = String(request.projectId || "").trim();
  if (!requestedIdentity) return undefined;
  return assets.map((asset) => {
    if (!categoryCompatible(asset, request.category) || asset.reusable === false || asset.assetState === "placeholder") return null;
    if (request.mediaType && asset.mediaType !== request.mediaType) return null;
    const sameProject = Boolean(requestedProject && asset.projectId === requestedProject);
    const globalAsset = !asset.projectId || asset.scope === "global";
    if (!sameProject && !globalAsset && !request.allowCrossProject) return null;
    const identityStrength = assetIdentityStrength(asset, requestedIdentity, requestedLook);
    if (!identityStrength) return null;
    let lookScore = 0;
    if (request.category === "character") {
      const assetLook = inferredCharacterLook(asset, requestedIdentity);
      if (requestedLook !== assetLook && !request.allowLookFallback) return null;
      lookScore = requestedLook === assetLook ? 24 : -24;
    }
    const projectScore = sameProject ? 60 : globalAsset ? 28 : 8;
    const policyScore = Number(Boolean(asset.canonical)) * 18 + Number(Boolean(asset.locked)) * 10 + Number(asset.category === request.category) * 6;
    const stateScore = asset.assetState === "ready" ? 8 : 2;
    return { asset, score: identityStrength + lookScore + projectScore + policyScore + stateScore + Math.min(8, asset.usageCount || 0) };
  }).filter((item): item is { asset: T; score: number } => Boolean(item)).sort((left, right) => right.score - left.score || right.asset.createdAt.localeCompare(left.asset.createdAt))[0]?.asset;
}
