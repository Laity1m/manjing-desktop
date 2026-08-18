import { extractCharacters, isGenericNonAssetCharacter, isNonCharacterLabel, normalizeScriptCharacterName } from "./series-project";

export type ScriptCharacterCandidate = {
  name: string;
  identityName: string;
  lookName: string;
  episodeScope: string;
  sceneHints: string[];
  role: string;
  appearance: string;
  reason: string;
  requiresVisualAsset: boolean;
  visualEvidence: string;
  needsVoice: boolean;
  firstDialogue: string;
};

export type ScriptPropCandidate = {
  name: string;
  description: string;
  importance: "hero" | "recurring" | "story";
  reason: string;
};

export type ScriptSceneCandidate = {
  name: string;
  environmentKey: string;
  description: string;
  timeWeather: string;
  episodeScope: string;
  sceneHints: string[];
  reason: string;
};

export type ScriptAssetManifest = {
  characters: ScriptCharacterCandidate[];
  props: ScriptPropCandidate[];
  scenes: ScriptSceneCandidate[];
  synopsis: string;
  background: string;
};

function clean(value: unknown, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function containsChinese(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function isMachineSceneName(value: string) {
  const normalized = clean(value, 120);
  return !containsChinese(normalized) && (
    /^(?:EP\d+_)?(?:ENV|SCENE|LOCATION)_[A-Z0-9_]+$/i.test(normalized)
    || /^[A-Z0-9]+(?:_[A-Z0-9]+){2,}$/.test(normalized)
  );
}

function chineseLocationFromDescription(description: string) {
  const locationNoun = "(?:院落|庭院|天井|大厅|正厅|偏厅|书房|卧房|客厅|房间|屋内|办公室|公廨|走廊|厨房|街道|巷口|城门|宫殿|府邸|王府|宅院|码头|客栈|酒楼|茶馆|山林|树林|河岸|船舱|甲板|广场|寺庙|牢房|营帐|作坊|仓库|店铺|车站|站台|学校|教室|医院|病房)";
  for (const clause of clean(description, 400).split(/[，,。；;：:]/)) {
    if (!containsChinese(clause) || !new RegExp(locationNoun).test(clause)) continue;
    const afterParticle = clause.includes("的") ? clause.slice(clause.lastIndexOf("的") + 1) : clause;
    const normalized = afterParticle
      .replace(/^(?:场景|地点|空间|画面|位于|是在|是一个|是一处|为一座|为一处|为一个)/, "")
      .replace(/(?:之中|内部|内景|外景)$/, "")
      .trim();
    const match = normalized.match(new RegExp(`([\\u3400-\\u9fff]{0,12}${locationNoun})`));
    if (match?.[1]) return match[1].slice(-16);
  }
  return "";
}

function chineseLocationFromMachineKey(environmentKey: string) {
  const source = clean(environmentKey, 120)
    .replace(/^EP\d+_/, "")
    .replace(/^(?:ENV|SCENE|LOCATION)_/, "");
  const replacements: Array<[RegExp, string]> = [
    [/MINISTRY_REVENUE/g, "户部"],
    [/OFFICE_HALL/g, "公廨大厅"],
    [/DILAPIDATED_COURTYARD/g, "破败庭院"],
    [/COURTYARD/g, "庭院"],
    [/SU_LI/g, "苏梨"],
    [/STUDY_ROOM/g, "书房"],
    [/BED_ROOM|BEDROOM/g, "卧房"],
    [/LIVING_ROOM/g, "客厅"],
    [/OFFICE/g, "办公室"],
    [/HALL/g, "大厅"],
    [/STREET/g, "街道"],
    [/ALLEY/g, "巷口"],
    [/PALACE/g, "宫殿"],
    [/MANSION/g, "府邸"],
    [/FOREST/g, "山林"],
    [/RIVER_BANK/g, "河岸"],
    [/DAY/g, "日"],
    [/NIGHT/g, "夜"],
    [/RAIN(?:Y)?/g, "雨"],
    [/SUNNY/g, "晴"],
  ];
  let translated = source;
  for (const [pattern, replacement] of replacements) translated = translated.replace(pattern, replacement);
  const parts = translated.split(/_+/).filter((part) => containsChinese(part));
  if (!parts.length) return "";
  const time = parts.filter((part) => /^(?:日|夜|雨|晴)$/.test(part)).join("");
  const location = parts.filter((part) => !/^(?:日|夜|雨|晴)$/.test(part)).join("");
  return location ? `${location}${time ? `·${time}` : ""}` : "";
}

/** Keep environmentKey stable for reuse, but never expose a machine identifier as the scene title. */
export function localizedSceneDisplayName(scene: Pick<ScriptSceneCandidate, "name" | "environmentKey" | "description" | "timeWeather">, index = 0) {
  const current = clean(scene.name, 80);
  if (current && !isMachineSceneName(current)) return current;
  const fromDescription = chineseLocationFromDescription(scene.description);
  if (fromDescription) return fromDescription;
  const fromKey = chineseLocationFromMachineKey(scene.environmentKey || current);
  if (fromKey) return fromKey;
  const timeWeather = clean(scene.timeWeather, 20);
  return `场景${String(index + 1).padStart(2, "0")}${containsChinese(timeWeather) && !/按剧本|待补充/.test(timeWeather) ? `·${timeWeather}` : ""}`;
}

function isNarrativeLabel(value: string) {
  return isNonCharacterLabel(value) || /^(?:系列项目|当前制作|当前剧集|剧本简介|故事简介|剧情简介|内容简介|项目简介|全剧背景故事|背景故事|故事背景|世界观|世界背景|项目长期记忆|本集相关角色圣经|上一集结束状态|本集完整剧本|人物关系与隐藏信息|世界规则与连续性约束|分集时间线|series project|current production|current episode|synopsis|logline|summary|background|backstory|worldbuilding|world bible|project memory|previous episode end state|full script)$/i.test(value.trim());
}

function isNonVisualCharacterRecord(item: Pick<ScriptCharacterCandidate, "name" | "role" | "appearance" | "requiresVisualAsset">) {
  const role = clean(item.role, 120);
  const description = `${role} ${clean(item.appearance, 420)}`;
  const nonCharacterRole = /^(?:metadata|heading|section|label|audio cue|sound cue|sound effect|stage direction|transition|camera direction|production note|栏目|标题|字段|元数据|音频标记|声音标记|音效|舞台说明|镜头说明|制作备注)$/i.test(role);
  const voiceOnly = /无实体|不出镜|仅声音|纯声音|只闻其声|画外传来|未实体化|voice[- ]?only|never\s+seen/i.test(description);
  return !item.requiresVisualAsset || isNarrativeLabel(item.name) || isGenericNonAssetCharacter(item.name) || nonCharacterRole || voiceOnly;
}

function jsonObject(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("资产分析没有返回 JSON");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

export function fallbackScriptAssetManifest(script: string): ScriptAssetManifest {
  const characters = extractCharacters(script).map((item) => {
    const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cue = `${escapedName}(?:\\s*[（(]\\s*(?:V\\.?O\\.?|V\\s*\\/\\s*O|O\\.?S\\.?|O\\s*\\/\\s*S|VOICE[ -]?OVER|OFF[ -]?SCREEN|CONT['’]?D)\\s*[）)])?`;
    const colonDialogue = script.match(new RegExp(`^\\s*${cue}\\s*[：:]\\s*(.+)$`, "im"))?.[1];
    const screenplayDialogue = script.match(new RegExp(`^\\s*${cue}\\s*$\\n(?:\\s*[（(][^）)]+[）)]\\s*\\n)?\\s*([^\\n]+)`, "im"))?.[1];
    const firstDialogue = clean(colonDialogue || screenplayDialogue, 500);
    return {
      name: clean(item.name, 60),
      identityName: clean(item.name, 60),
      lookName: "基础版",
      episodeScope: "当前集",
      sceneHints: [] as string[],
      role: "剧本角色",
      appearance: clean(item.description, 360) || "等待用户补充人物外貌、年龄、发型、服装和状态",
      reason: "在剧本人物表或对白中出现",
      requiresVisualAsset: true,
      visualEvidence: "本地解析在人物表或实际对白中找到具名人物证据",
      needsVoice: Boolean(firstDialogue),
      firstDialogue,
    };
  });
  const propValues: string[] = [];
  for (const match of script.matchAll(/\[道具[：:]([^\]]+)\]/gi)) propValues.push(...String(match[1] || "").split(/[，,、]/));
  for (const match of script.matchAll(/^(?:重要)?道具\s*[：:]\s*(.+)$/gim)) propValues.push(...String(match[1] || "").split(/[，,、;；]/));
  for (const match of script.matchAll(/^props?\s*[:：]\s*(.+)$/gim)) propValues.push(...String(match[1] || "").split(/[,;]/));
  const props = [...new Set(propValues.map((item) => clean(item, 60)).filter(Boolean))].slice(0, 40).map((name) => ({
    name,
    description: "剧本明确标注的重要道具，等待用户补充外观、材质、尺寸和状态",
    importance: "story" as const,
    reason: "剧本明确标注",
  }));
  const sceneValues: Array<{ name: string; description: string }> = [];
  for (const match of script.matchAll(/\[场景[：:]([^\]]+)\]/gi)) sceneValues.push({ name: clean(match[1], 80), description: clean(match[1], 320) });
  for (const line of script.split(/\n/)) {
    const match = line.match(/^\s*(?:INT\.?|EXT\.?|内景|外景|场景)\s*[.：:\-— ]+\s*(.+)$/i);
    if (!match) continue;
    const source = clean(match[1], 180);
    const name = clean(source.split(/[—\-－|｜]/)[0], 80);
    if (name) sceneValues.push({ name, description: source });
  }
  const scenes = [...new Map(sceneValues.filter((item) => item.name).map((item) => [item.name.toLocaleLowerCase(), {
    name: item.name,
    environmentKey: item.name,
    description: item.description || "等待用户补充场景空间布局、建筑、固定陈设和光线",
    timeWeather: "按剧本场景标题与正文确定",
    episodeScope: "当前集",
    sceneHints: [item.name],
    reason: "剧本明确标注的拍摄地点",
  }])).values()].slice(0, 30);
  const section = (labels: string[]) => {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[【\\[]\\s*)?(?:${labels.join("|")})(?:\\s*[】\\]])?\\s*[：:]?\\s*(?:\\n|$)([\\s\\S]*?)(?=\\n\\s*(?:[【\\[][^\\n]{2,40}[】\\]]|(?:第\\s*[0-9一二两三四五六七八九十百]+\\s*集|episode\\s*\\d+)|(?:人物|角色|道具|场景|剧本|剧情|背景|世界观|本集)[^\\n]{0,20}[：:])|$)`, "i");
    return clean(script.match(pattern)?.[1], 1800);
  };
  const explicitSynopsis = section(["剧本简介", "故事简介", "剧情简介", "内容简介", "项目简介", "synopsis", "logline", "summary"]);
  const explicitBackground = section(["全剧背景故事", "背景故事", "故事背景", "世界观", "世界背景", "background", "backstory", "worldbuilding", "world bible"]);
  const narrativeLines = script.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 10 && !/^[【\[].+[】\]]$/.test(line) && !/^[^：:]{1,40}[：:]/.test(line) && !/^(?:INT\.?|EXT\.?|第.+集|episode\s*\d+)/i.test(line));
  return { characters: characters.slice(0, 40), props, scenes, synopsis: explicitSynopsis || clean(narrativeLines.slice(0, 3).join(" "), 900), background: explicitBackground || clean(narrativeLines.filter((line) => /背景|世界|时代|城市|国家|家族|公司|学校|过去|秘密|background|world|era|city|country|family|history/i.test(line)).slice(0, 8).join(" "), 1800) };
}

export function parseScriptAssetManifest(raw: string, script: string): ScriptAssetManifest {
  const payload = jsonObject(raw);
  const rawCharacters = Array.isArray(payload.characters) ? payload.characters : Array.isArray(payload.c) ? payload.c : [];
  const rawProps = Array.isArray(payload.props) ? payload.props : Array.isArray(payload.p) ? payload.p : [];
  const rawScenes = Array.isArray(payload.scenes) ? payload.scenes : Array.isArray(payload.environments) ? payload.environments : Array.isArray(payload.locations) ? payload.locations : [];
  const synopsis = clean(payload.synopsis || payload.summary || payload.logline, 1200);
  const background = clean(payload.background || payload.backstory || payload.world || payload.worldBible, 2400);
  const characters = rawCharacters.map((item) => {
    const value = item as Record<string, unknown>;
    const identityName = normalizeScriptCharacterName(clean(value.identityName || value.identity || value.characterName || value.name || value.n, 60));
    const lookName = clean(value.lookName || value.look || value.variant || value.outfit || value.state, 60) || "基础版";
    const rawSceneHints = Array.isArray(value.sceneHints) ? value.sceneHints : Array.isArray(value.scenes) ? value.scenes : [];
    return {
      name: identityName,
      identityName,
      lookName,
      episodeScope: clean(value.episodeScope || value.episode || value.episodeName, 80) || "当前集",
      sceneHints: rawSceneHints.map((hint) => clean(hint, 80)).filter(Boolean).slice(0, 20),
      role: clean(value.role || value.r, 120) || "剧本角色",
      appearance: clean(value.appearance || value.a || value.description, 420) || "等待用户补充人物外貌、年龄、发型、服装和状态",
      reason: clean(value.reason || value.why, 180) || "剧本中需要稳定视觉身份",
      requiresVisualAsset: value.requiresVisualAsset !== false && value.visualAsset !== false && value.isVisual !== false && value.voiceOnly !== true,
      visualEvidence: clean(value.visualEvidence || value.onScreenEvidence || value.evidence || value.reason || value.why, 240),
      needsVoice: value.needsVoice === true || value.speaks === true || Boolean(clean(value.firstDialogue || value.dialogue || value.referenceText, 500)),
      firstDialogue: clean(value.firstDialogue || value.dialogue || value.referenceText, 500),
    };
  }).filter((item) => item.name && !isNonVisualCharacterRecord(item));
  const props = rawProps.map((item) => {
    const value = item as Record<string, unknown>;
    const importance = clean(value.importance || value.level, 20).toLowerCase();
    return {
      name: clean(value.name || value.n, 60),
      description: clean(value.description || value.d || value.appearance, 360) || "等待补充道具外观、材质、尺寸和状态",
      importance: (["hero", "recurring", "story"].includes(importance) ? importance : "story") as ScriptPropCandidate["importance"],
      reason: clean(value.reason || value.why, 180) || "推动剧情或跨镜头重复出现",
    };
  }).filter((item) => item.name);
  const scenes = rawScenes.map((item, index) => {
    const value = item as Record<string, unknown>;
    const name = clean(value.name || value.environmentKey || value.location || value.n, 80);
    const rawSceneHints = Array.isArray(value.sceneHints) ? value.sceneHints : Array.isArray(value.shots) ? value.shots : [];
    const scene = {
      name,
      environmentKey: clean(value.environmentKey || value.key || name, 80) || name,
      description: clean(value.description || value.environmentBible || value.appearance || value.d, 600) || "等待补充场景空间布局、建筑、固定陈设和光线",
      timeWeather: clean(value.timeWeather || value.time || value.weather, 160) || "按剧本确定时间、天气和光线",
      episodeScope: clean(value.episodeScope || value.episode, 80) || "当前集",
      sceneHints: rawSceneHints.map((hint) => clean(hint, 80)).filter(Boolean).slice(0, 20),
      reason: clean(value.reason || value.why, 180) || "本集分镜需要稳定复用该场景",
    };
    return { ...scene, name: localizedSceneDisplayName(scene, index) };
  }).filter((item) => item.name && !isNarrativeLabel(item.name));
  const fallback = fallbackScriptAssetManifest(script);
  // A successful language-agent result is authoritative. Local regex extraction
  // must not add headings such as “剧本简介” or “全剧背景故事” back as people.
  const characterSource = characters.length ? characters : fallback.characters;
  const propSource = props.length ? props : fallback.props;
  const sceneSource = scenes.length ? scenes : fallback.scenes;
  const characterMap = new Map(characterSource.map((item) => [`${item.identityName.toLocaleLowerCase()}::${item.lookName.toLocaleLowerCase()}`, item]));
  const propMap = new Map(propSource.map((item) => [item.name.toLocaleLowerCase(), item]));
  const sceneMap = new Map(sceneSource.map((item) => [item.environmentKey.toLocaleLowerCase(), item]));
  const uniqueCharacters = [...characterMap.values()].slice(0, 40);
  const uniqueProps = [...propMap.values()].slice(0, 40);
  const uniqueScenes = [...sceneMap.values()].slice(0, 30);
  return { characters: uniqueCharacters, props: uniqueProps, scenes: uniqueScenes, synopsis: synopsis || fallback.synopsis, background: background || fallback.background };
}
