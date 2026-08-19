export type PortraitProjectReference = {
  libraryAssetId?: string;
  identityKey?: string;
  name: string;
  kind?: string;
};

export type ProjectPortraitBlock = {
  projectId?: string;
  blockedReferences: PortraitProjectReference[];
};

function identity(value: string) {
  return String(value || "").replace(/^.*?：/, "").replace(/；.*$/, "").trim().toLocaleLowerCase("zh-CN").replace(/[\s_·•—–-]+/g, "");
}

/** Trusted-portrait enrollment is a live-action policy, not an animation requirement. */
export function styleRequiresTrustedPortrait(styleCategory: string) {
  return styleCategory.trim() === "写实";
}

/**
 * Keep a provider portrait blocker inside the production project that created
 * it. Legacy blockers without a project id only apply when one of their exact
 * references is present in the current cast.
 */
export function portraitBlockReferencesForProject(
  block: ProjectPortraitBlock | null | undefined,
  projectId: string,
  cast: Array<{ libraryAssetId?: string; identityName?: string; name: string }>,
) {
  if (!block?.blockedReferences?.length) return [];
  if (block.projectId && projectId && block.projectId !== projectId) return [];
  return block.blockedReferences.filter((reference) => {
    if (reference.kind && reference.kind !== "image") return false;
    const referenceIdentity = identity(reference.identityKey || reference.name);
    return cast.some((character) => character.libraryAssetId === reference.libraryAssetId
      || identity(character.identityName || character.name) === referenceIdentity);
  });
}

