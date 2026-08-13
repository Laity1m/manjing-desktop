export type CharacterNamingInput = { name: string; identityName?: string; lookName?: string; appearance?: string; role?: string };

const BASE_VARIANTS = /^(?:基础|基础版|基础造型|默认|默认版|默认造型|base|default|base look|default look)$/i;

function cleanVariantLabel(value: string) {
  return value
    .replace(/[“”"'【】\[\]()（）]/g, "")
    .replace(/^(?:服装|造型|状态|形象|look|outfit|state)\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

function localizedVariant(labelZh: string, labelEn: string, chinese: boolean) {
  return chinese ? labelZh : labelEn;
}

export function inferCharacterVariant(input: CharacterNamingInput) {
  const appearance = String(input.appearance || "").trim();
  const source = `${appearance} ${input.role || ""}`;
  const chinese = /[\u3400-\u9fff]/.test(`${input.name}${source}`);
  const explicit: string[] = [];
  const explicitPattern = /(?:服装|造型|状态|形象|look|outfit|state)\s*[:：]\s*([^，,；;。.!！\n]{1,24})/gi;
  for (const match of source.matchAll(explicitPattern)) {
    const label = cleanVariantLabel(String(match[1] || ""));
    if (label && !BASE_VARIANTS.test(label)) explicit.push(label);
  }
  if (explicit.length) {
    const label = [...new Set(explicit)].slice(0, 2).join(chinese ? "" : " ");
    return /(?:版|look|version)$/i.test(label) ? label : `${label}${chinese ? "版" : " Look"}`;
  }

  const candidates = [
    { pattern: /西装|正装|商务套装|business suit|tailored suit|formal suit/i, zh: "西装版", en: "Suit Look" },
    { pattern: /运动装|运动服|健身服|球衣|sportswear|athletic wear|gym wear|tracksuit/i, zh: "运动版", en: "Sports Look" },
    { pattern: /颓废|落魄|憔悴|邋遢|疲惫不堪|disheveled|run-down|exhausted look|haggard/i, zh: "颓废版", en: "Disheveled Look" },
    { pattern: /富有|富贵|奢华|贵气|珠光宝气|wealthy|affluent|luxury look|opulent/i, zh: "富有版", en: "Wealthy Look" },
    { pattern: /战损|负伤|伤痕累累|battle-damaged|battle damaged|wounded/i, zh: "战损版", en: "Battle-Damaged Look" },
    { pattern: /校服|学生制服|school uniform/i, zh: "校服版", en: "School Uniform Look" },
    { pattern: /婚纱|wedding dress|bridal gown/i, zh: "婚纱版", en: "Wedding Look" },
    { pattern: /礼服|晚礼服|evening gown|formal dress/i, zh: "礼服版", en: "Formal Look" },
    { pattern: /古装|汉服|长袍|historical costume|period costume|hanfu/i, zh: "古装版", en: "Period Look" },
    { pattern: /制服|军装|警服|uniform|military dress/i, zh: "制服版", en: "Uniform Look" },
    { pattern: /休闲装|便装|居家服|casual wear|streetwear|loungewear/i, zh: "休闲版", en: "Casual Look" },
  ];
  const matches = [...new Set(candidates.filter((item) => item.pattern.test(source)).map((item) => localizedVariant(item.zh, item.en, chinese)))].slice(0, 2);
  if (!matches.length) return chinese ? "基础版" : "Base Look";
  return chinese && matches.length > 1 ? `${matches.map((item) => item.replace(/版$/, "")).join("")}版` : matches.join(" ");
}

export function characterAssetDisplayName(characterName: string, variantName?: string) {
  const name = characterName.trim() || "未命名人物";
  const variant = cleanVariantLabel(String(variantName || ""));
  if (!variant || BASE_VARIANTS.test(variant)) return name;
  if (variant.toLocaleLowerCase().startsWith(name.toLocaleLowerCase())) return variant;
  const joiner = /[\u3400-\u9fff]/.test(`${name}${variant}`) ? "" : " ";
  return `${name}${joiner}${variant}`.slice(0, 120);
}

export function characterAssetNaming(input: CharacterNamingInput) {
  const identityKey = String(input.identityName || input.name).trim() || "未命名人物";
  const explicitLook = cleanVariantLabel(String(input.lookName || ""));
  const lookName = explicitLook || inferCharacterVariant({ ...input, name: identityKey });
  const inferredDisplayName = characterAssetDisplayName(identityKey, lookName);
  const displayName = explicitLook && inferredDisplayName !== identityKey && !explicitLook.toLocaleLowerCase().startsWith(identityKey.toLocaleLowerCase())
    ? `${identityKey}-${explicitLook}`.slice(0, 120)
    : inferredDisplayName;
  return { identityKey, lookName, variantName: lookName, displayName };
}
