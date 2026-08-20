export type SeriesEpisodeStatus = "draft" | "ready" | "producing" | "done";

export type SeriesEpisode = {
  id: string;
  number: number;
  title: string;
  content: string;
  summary: string;
  endState: string;
  status: SeriesEpisodeStatus;
};

export type SeriesCharacter = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  relationship: string;
  canonicalAssetId?: string;
  voiceAssetId?: string;
};

export type SeriesMemory = {
  id: string;
  type: "world" | "background" | "relationship" | "timeline" | "rule";
  title: string;
  content: string;
  locked: boolean;
};

export type SeriesProductionRecord = {
  id: string;
  episodeId?: string;
  episodeNumber?: number;
  title: string;
  createdAt: string;
  duration: number;
  assetId: string;
  editorProjectId?: string;
  status: "completed" | "failed";
};

export type SeriesProject = {
  version: 1;
  id: string;
  name: string;
  sourceFileName: string;
  sourceText: string;
  createdAt: string;
  updatedAt: string;
  episodes: SeriesEpisode[];
  characters: SeriesCharacter[];
  memories: SeriesMemory[];
  productions?: SeriesProductionRecord[];
};

export const SERIES_PROJECTS_KEY = "manjing-series-projects-v1";
export const ACTIVE_SERIES_CONTEXT_KEY = "manjing-active-series-context-v1";

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanText(value: string) {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function chineseNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    return (left ? digits[left] || 0 : 1) * 10 + (right ? digits[right] || 0 : 0);
  }
  return [...value].reduce((sum, item) => sum * 10 + (digits[item] || 0), 0);
}

function episodeSummary(content: string) {
  return content.replace(/^(?:第[^\n]{0,20}集|(?:episode|ep\.?|chapter|part)\s*\d+)[^\n]*\n?/i, "").replace(/\s+/g, " ").slice(0, 260);
}

function episodeEndState(content: string) {
  const lines = content.split(/\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-4).join("；").slice(0, 360) || "继承本集最后场景、人物位置、服装、道具和情绪状态";
}

export function splitEpisodes(source: string): SeriesEpisode[] {
  const text = cleanText(source);
  const marker = /(?:^|\n)\s*(?:第\s*([0-9一二两三四五六七八九十百]+)\s*集|(?:episode|ep\.?|chapter|part)\s*(?:#\s*)?(\d+))\s*([^\n]*)/gim;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) return [{ id: uid("episode"), number: 1, title: "第 1 集", content: text, summary: episodeSummary(text), endState: episodeEndState(text), status: "ready" }];
  return matches.map((match, index) => {
    const number = Math.max(1, chineseNumber(match[1] || match[2]) || index + 1);
    const start = match.index || 0;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    const subtitle = String(match[3] || "").replace(/^[:：·\-—\s]+/, "").trim();
    return { id: uid("episode"), number, title: subtitle || `第 ${number} 集`, content, summary: episodeSummary(content), endState: episodeEndState(content), status: "ready" as const };
  }).sort((a, b) => a.number - b.number);
}

const NON_CHARACTER_LABELS = new Set(["时间", "地点", "场景", "内景", "外景", "画面", "镜头", "旁白", "画外音", "解说", "独白", "内心独白", "字幕", "动作", "音效", "音乐", "备注", "人物", "角色", "人物表", "角色表", "演员表", "小传", "人物小传", "角色小传", "人物介绍", "角色介绍", "人物简介", "角色简介", "剧情", "导演", "剧本简介", "故事简介", "剧情简介", "内容简介", "项目简介", "系列项目", "当前制作", "当前剧集", "全剧背景故事", "背景故事", "故事背景", "世界观", "世界背景", "项目长期记忆", "本集相关角色圣经", "上一集结束状态", "本集完整剧本", "人物关系与隐藏信息", "世界规则与连续性约束", "分集时间线", "time", "location", "scene", "interior", "exterior", "shot", "narrator", "voice over", "voiceover", "vo", "v.o.", "v/o", "os", "o.s.", "o/s", "subtitle", "action", "sound", "music", "note", "character", "cast", "character list", "cast list", "character bio", "character biography", "director", "synopsis", "logline", "summary", "project", "series project", "current episode", "current production", "background", "backstory", "story background", "worldbuilding", "world bible", "project memory", "previous episode end state", "full script", "cut to", "fade in", "fade out", "dissolve to"]);

const NON_CHARACTER_COMPACT_LABELS = new Set([
  "片名", "剧名", "标题", "副标题", "题材", "类型", "标签", "时长", "集数", "作者", "原著", "编剧", "导演", "制片", "版本", "日期", "受众", "卖点", "主题", "基调", "风格", "参考", "备注", "说明", "创作说明", "核心梗概", "故事梗概", "剧情梗概", "人物设定", "角色设定", "人物关系", "角色关系", "主要人物", "次要人物", "登场人物", "出场人物", "场次", "场号", "镜号", "镜次", "景别", "机位", "运镜", "转场", "动作", "表演", "情绪", "台词", "对白", "音效", "环境音", "拟音", "配乐", "音乐", "字幕", "屏幕文字", "画面文字", "同期声", "后期备注",
  "title", "subtitle", "genre", "format", "runtime", "duration", "author", "writer", "screenwriter", "writtenby", "director", "producer", "draft", "version", "date", "theme", "tone", "style", "reference", "notes", "description", "treatment", "outline", "beat", "beats", "characters", "characterbreakdown", "castbreakdown", "scenelist", "shotlist", "dialogue", "parenthetical", "transition", "camera", "sfx", "fx", "bgm", "musiccue", "soundcue", "ambience", "amb", "super", "superimpose", "chyron", "insert", "intercut", "montage", "flashback", "flashforward", "coldopen", "teaser", "tag", "theend",
  "more", "contd", "continued", "omitted", "revised", "revision", "angle", "onscreen", "offscreen", "oc", "op", "filter", "lens", "framerate", "aspectratio", "resolution", "boom", "bang", "crash", "thud", "knock", "ring", "ringing", "silence",
]);

const SCREENPLAY_STRUCTURE_PATTERN = /^(?:(?:第\s*[0-9一二两三四五六七八九十百]+\s*(?:场|幕|镜|集|章))|(?:场次|场号|镜头|镜号|镜次)\s*[#第]?[0-9一二两三四五六七八九十百]+|序幕|楔子|尾声|开场|结尾|黑场|白场|闪回|闪前|梦境|蒙太奇|转场|切至|淡入|淡出|叠化|硬切|空镜|特写|近景|中景|全景|远景|俯拍|仰拍|主观镜头|客观镜头|片头|片尾|字幕卡|标题卡|同期声|画外|电话中|广播中|(?:(?:scene|shot|act|sequence)\s*[#.]?\s*[0-9ivx]+|fade\s+(?:in|out|to\s+black)|cut\s+to|smash\s+cut|match\s+cut|jump\s+cut|dissolve\s+to|wipe\s+to|back\s+to|end\s+of\s+act|black\s+screen|white\s+screen|title\s+card|series\s+of\s+shots|moving\s+shot|close\s+on|angle\s+on|p\.?o\.?v\.?|establishing\s+shot|flashback|flash\s+forward|montage|intercut|insert|super(?:impose)?|chyron|teaser|cold\s+open|tag|continuous|later|same\s+time|day|night|morning|evening|the\s+end))\s*[:：-]?$/i;

export function isNonCharacterLabel(value: string) {
  const normalized = String(value || "").trim().toLocaleLowerCase("zh-CN");
  const unwrapped = normalized.replace(/^[\s\-—_./\\:：()（）\[\]【】]+|[\s\-—_./\\:：()（）\[\]【】]+$/g, "").trim();
  const compact = unwrapped.replace(/[\s._/\\\-—:：()（）\[\]【】]/g, "");
  return !unwrapped
    || NON_CHARACTER_LABELS.has(normalized)
    || NON_CHARACTER_LABELS.has(unwrapped)
    || ["vo", "os", "voiceover", "narrator", "旁白", "画外音", "解说", "独白", "内心独白"].includes(compact)
    || NON_CHARACTER_COMPACT_LABELS.has(compact)
    || SCREENPLAY_STRUCTURE_PATTERN.test(unwrapped)
    || /^(?:基本|项目|剧本|故事|剧情|本集|全剧|世界|人物|角色|场景|镜头|画面|制作|创作|视觉|声音|音频|视频|后期|前情|核心|主要|目标|预计|单集|总)(?:信息|名称|标题|类型|题材|格式|时长|集数|受众|卖点|主题|基调|风格|参考|说明|备注|梗概|大纲|提要|看点|冲突|设定|背景|关系|列表|清单|描述|要求|规则|参数|状态|记忆|档案|资料|总结|摘要)$/.test(unwrapped)
    || /^(?:一句话|一行)(?:梗概|简介|故事)$/.test(unwrapped)
    || /^(?:project|series|episode|script|story|character|cast|scene|shot|camera|sound|music|production|visual)(?:title|name|type|genre|format|duration|runtime|count|number|summary|synopsis|description|notes|list|breakdown|bible|profile|bio|biography|relationship|setting|style|tone|reference|instructions?)$/.test(compact)
    || /(?:剧本|故事|剧情|内容|项目|人物|角色)(?:简介|介绍|小传|列表|表)$/.test(unwrapped)
    || /(?:简介|背景故事|世界观|长期记忆|结束状态|完整剧本|角色圣经|时间线)$/.test(unwrapped);
}

export function isGenericNonAssetCharacter(value: string) {
  const normalized = String(value || "").trim().toLocaleLowerCase("zh-CN").replace(/^[\s\-—_./\\:：()（）\[\]【】]+|[\s\-—_./\\:：()（）\[\]【】]+$/g, "");
  return /^(?:众人|人群|群众|群演|全体|所有人|一群人|路人|行人|围观者|男声|女声|童声|声音|电话声|广播声|系统声|提示音|画外声|门外声|远处声音|crowd|all|everyone|extras?|people|passers?-?by|voices?|male voice|female voice|computer voice|system voice)$/i.test(normalized)
    || /^(?:群演|群众|路人|行人|百姓|村民|宾客|食客|顾客|乘客|观众|学生|同学|员工|职员|士兵|侍卫|侍从|家丁|丫鬟|仆人|记者|警察|医生|护士|孩子|小孩|男人|女人|黑衣人)(?:甲|乙|丙|丁|戊|[a-z]|\d+|一|二|三|若干|们)$/i.test(normalized)
    || /^(?:man|woman|boy|girl|guard|soldier|cop|officer|reporter|student|worker|passenger|customer|waiter|nurse|doctor|extra|voice|caller|radio|tv|intercom|computer|system)\s*(?:#?\d+|[a-z])$/i.test(normalized);
}

export function normalizeScriptCharacterName(value: string) {
  return value
    .replace(/\s*[（(][^）)]*(?:v\.?o\.?|v\s*\/\s*o|o\.?s\.?|o\s*\/\s*s|voice[ -]?over|off[ -]?screen|cont['’]?d|continued|whispering|shouting)[^）)]*[）)]\s*$/i, "")
    .replace(/^\s*[-—_]+|[-—_]+\s*$/g, "")
    .replace(/([\u3400-\u9fffA-Za-zÀ-ÖØ-öø-ÿ'’])\s*[-—_/]?\s*(?:v\.?o\.?|v\s*\/\s*o|o\.?s\.?|o\s*\/\s*s|voice[ -]?over)\s*$/i, "$1")
    .replace(/^\s*[-—_]+|[-—_]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function looksLikeSceneHeading(value: string) {
  return /^(?:INT\.?|EXT\.?|INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\.?\s*\/\s*E\.?|SCENE\s+\d+|ACT\s+[IVX\d]+|CUT TO|FADE (?:IN|OUT)|DISSOLVE TO)\b/i.test(value);
}

export function extractCharacters(text: string): SeriesCharacter[] {
  const descriptions = new Map<string, string[]>();
  const lines = text.split(/\n/).map((item) => item.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[【\[].+[】\]]$/.test(line) || /^[-—]\s*(?:剧本简介|故事简介|剧情简介|背景故事|全剧背景故事|项目长期记忆|当前制作|系列项目)\s*$/i.test(line)) continue;
    const leadingField = line.match(/^([^：:]{1,32})[：:]/)?.[1]?.trim() || "";
    if (leadingField && !/^(?:人物|角色|character|cast)$/i.test(leadingField) && isNonCharacterLabel(leadingField)) continue;
    const dialogue = line.match(/^([\u4e00-\u9fa5A-Za-zÀ-ÖØ-öø-ÿ'’·.\- ]{2,40})(?:\s*[（(][^）)]*[）)])?\s*[：:]\s*(.*)$/);
    const screenplayCue = line.match(/^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’.\- ]{1,38})(?:\s*[（(][^）)]*[）)])?\s*\^?$/);
    const fountainCue = line.match(/^@([\u3400-\u9fffA-Za-zÀ-ÖØ-öø-ÿ'’·.\- ]{1,40})(?:\s*[（(][^）)]*[）)])?\s*\^?$/);
    const profile = line.match(/^(?:(?:人物|角色|character|cast)\s*[-—:]?\s*)?([\u4e00-\u9fa5A-Za-zÀ-ÖØ-öø-ÿ'’·.\- ]{2,40})\s*[：:（(]\s*(.{4,240})/i);
    const candidate = profile?.[1] || dialogue?.[1] || screenplayCue?.[1] || fountainCue?.[1] || "";
    const name = normalizeScriptCharacterName(String(candidate));
    const normalized = name.toLowerCase().replace(/[.：:]/g, "").trim();
    const nextLine = lines[index + 1] || "";
    const cueHasDialogue = !(screenplayCue || fountainCue) || Boolean(nextLine && !looksLikeSceneHeading(nextLine) && !isNonCharacterLabel(nextLine) && !/^@?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’.\- ]{1,38}(?:\s*[（(][^）)]*[）)])?\s*\^?$/.test(nextLine));
    if (!name || name.length > 40 || isNonCharacterLabel(normalized) || isGenericNonAssetCharacter(name) || !cueHasDialogue || /第.+集|^(?:episode|ep\.?|chapter|part)\s*\d+/i.test(name) || looksLikeSceneHeading(line)) continue;
    const current = descriptions.get(name) || [];
    const detail = profile?.[2] || dialogue?.[2];
    if (detail && current.length < 4 && !screenplayCue) current.push(detail.trim());
    descriptions.set(name, current);
  }
  return [...descriptions.entries()].slice(0, 40).map(([name, details]) => ({ id: uid("character"), name, aliases: [], description: details.join("；") || "由 Agent 根据各集剧本持续补充人物身份、外貌、性格和人物弧光", relationship: "等待从剧情关系中确认" }));
}

function extractMemories(text: string, episodes: SeriesEpisode[]): SeriesMemory[] {
  const lines = text.split(/\n/).map((item) => item.trim()).filter((item) => item.length >= 6 && item.length <= 260);
  const pick = (pattern: RegExp, limit: number) => lines.filter((line) => pattern.test(line)).slice(0, limit);
  const background = pick(/世界观|背景|年代|时代|城市|国家|家族|公司|学校|过去|秘密|world|background|setting|era|century|city|country|kingdom|family|company|school|history|secret/i, 14);
  const relationships = pick(/关系|父亲|母亲|哥哥|姐姐|弟弟|妹妹|恋人|夫妻|朋友|敌人|同事|上司|下属|relationship|father|mother|brother|sister|lover|husband|wife|friend|enemy|rival|colleague|boss|partner/i, 14);
  const rules = pick(/必须|始终|不能|从不|一直|设定|规则|固定|习惯|口头禅|must|always|never|cannot|can't|rule|fixed|habit|catchphrase|continuity/i, 12);
  return [
    { id: uid("memory"), type: "background", title: "全剧背景故事", content: background.join("\n") || text.slice(0, 1200), locked: true },
    { id: uid("memory"), type: "relationship", title: "人物关系与隐藏信息", content: relationships.join("\n") || "等待 Agent 在分集制作中持续归纳", locked: false },
    { id: uid("memory"), type: "rule", title: "世界规则与连续性约束", content: rules.join("\n") || "人物身份、时代背景、核心关系和已确认 Canonical 资产不得无故改变", locked: true },
    { id: uid("memory"), type: "timeline", title: "分集时间线", content: episodes.map((item) => `第 ${item.number} 集：${item.summary}`).join("\n"), locked: false },
  ];
}

export function analyzeSeriesScript(name: string, sourceFileName: string, source: string): SeriesProject {
  const sourceText = cleanText(source);
  const episodes = splitEpisodes(sourceText);
  const now = new Date().toISOString();
  return { version: 1, id: uid("series"), name: name.trim() || sourceFileName.replace(/\.[^.]+$/, "") || "未命名系列项目", sourceFileName, sourceText: "", createdAt: now, updatedAt: now, episodes, characters: extractCharacters(sourceText), memories: extractMemories(sourceText, episodes), productions: [] };
}

export function appendSeriesProductionRecord(projectId: string, record: Omit<SeriesProductionRecord, "id" | "createdAt">) {
  const projects = loadSeriesProjects();
  const now = new Date().toISOString();
  const next = projects.map((project) => project.id === projectId ? { ...project, updatedAt: now, productions: [{ ...record, id: uid("production"), createdAt: now }, ...(project.productions || [])].slice(0, 80) } : project);
  saveSeriesProjects(next);
}

export function completeSeriesEpisode(projectId: string, episodeId: string | undefined, endState: string) {
  if (!projectId.trim() || !episodeId?.trim()) return;
  const projects = loadSeriesProjects();
  const now = new Date().toISOString();
  const normalizedEndState = endState.replace(/\s+/g, " ").trim().slice(0, 600);
  const next = projects.map((project) => project.id !== projectId ? project : {
    ...project,
    updatedAt: now,
    episodes: project.episodes.map((episode) => episode.id !== episodeId ? episode : {
      ...episode,
      status: "done" as const,
      endState: normalizedEndState || episode.endState,
    }),
  });
  saveSeriesProjects(next);
}

export function loadSeriesProjects(): SeriesProject[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(SERIES_PROJECTS_KEY) || "[]") as SeriesProject[];
    return Array.isArray(value) ? value.filter((item) => item?.version === 1).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch { return []; }
}

export function saveSeriesProjects(projects: SeriesProject[]) {
  const compact = projects.slice(0, 12).map((project) => ({ ...project, sourceText: "" }));
  localStorage.setItem(SERIES_PROJECTS_KEY, JSON.stringify(compact));
  window.dispatchEvent(new CustomEvent("manjing-series-projects-changed"));
}

export function buildEpisodeContext(project: SeriesProject, episode: SeriesEpisode) {
  const previous = project.episodes.filter((item) => item.number < episode.number).sort((a, b) => b.number - a.number)[0];
  const names = project.characters.filter((item) => episode.content.includes(item.name));
  return [
    `系列项目：${project.name}`,
    `当前制作：第 ${episode.number} 集 · ${episode.title}`,
    "【项目长期记忆】",
    ...project.memories.filter((item) => item.locked || item.type !== "timeline").map((item) => `${item.title}：\n${item.content}`),
    "【本集相关角色圣经】",
    ...(names.length ? names : project.characters.slice(0, 8)).map((item) => `${item.name}：${item.description}；关系：${item.relationship}`),
    previous ? `【上一集结束状态】\n${previous.endState}` : "【上一集结束状态】\n首集，按项目 Canonical 资产建立初始状态",
    "【本集完整剧本】",
    episode.content,
  ].join("\n\n");
}

export function activateSeriesEpisode(project: SeriesProject, episode: SeriesEpisode) {
  const rawContext = buildEpisodeContext(project, episode);
  const contextLimit = 60000;
  const compactContext = rawContext.length <= contextLimit
    ? rawContext
    : `${rawContext.slice(0, 40000)}\n\n【超长本集上下文已压缩，完整原文仍保留在项目库】\n\n${rawContext.slice(-19500)}`;
  const context = { projectId: project.id, projectName: project.name, episodeId: episode.id, episodeNumber: episode.number, episodeTitle: episode.title, context: compactContext, activatedAt: new Date().toISOString() };
  const compactMetadata = { projectId: context.projectId, projectName: context.projectName, episodeId: context.episodeId, episodeNumber: context.episodeNumber, episodeTitle: context.episodeTitle, activatedAt: context.activatedAt };
  sessionStorage.setItem(ACTIVE_SERIES_CONTEXT_KEY, JSON.stringify(context));
  try { localStorage.setItem(ACTIVE_SERIES_CONTEXT_KEY, JSON.stringify(compactMetadata)); } catch { /* Session context remains authoritative for this production run. */ }
  try { localStorage.setItem("manjing-text-draft", context.context); } catch { sessionStorage.setItem("manjing-text-draft", context.context); }
  window.dispatchEvent(new CustomEvent("manjing-active-series-context-changed", { detail: compactMetadata }));
  try { localStorage.setItem("manjing-new-studio", "1"); } catch { /* Optional navigation hint. */ }
  localStorage.removeItem("manjing-studio-open-project");
  const workspace = (() => { try { return JSON.parse(localStorage.getItem("manjing-workspace") || "{}"); } catch { return {}; } })();
  try { localStorage.setItem("manjing-workspace", JSON.stringify({ ...workspace, projectTitle: `${project.name} · 第 ${episode.number} 集`, scriptImported: true })); } catch { /* Studio consumes the full session handoff. */ }
  return context;
}
