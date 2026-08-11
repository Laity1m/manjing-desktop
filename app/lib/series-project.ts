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
  return content.replace(/^第[^\n]{0,20}集[^\n]*\n?/, "").replace(/\s+/g, " ").slice(0, 260);
}

function episodeEndState(content: string) {
  const lines = content.split(/\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-4).join("；").slice(0, 360) || "继承本集最后场景、人物位置、服装、道具和情绪状态";
}

function splitEpisodes(source: string): SeriesEpisode[] {
  const text = cleanText(source);
  const marker = /(?:^|\n)\s*第\s*([0-9一二两三四五六七八九十百]+)\s*集\s*([^\n]*)/g;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) return [{ id: uid("episode"), number: 1, title: "第 1 集", content: text, summary: episodeSummary(text), endState: episodeEndState(text), status: "ready" }];
  return matches.map((match, index) => {
    const number = Math.max(1, chineseNumber(match[1]) || index + 1);
    const start = match.index || 0;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    const subtitle = String(match[2] || "").replace(/^[:：·\-—\s]+/, "").trim();
    return { id: uid("episode"), number, title: subtitle || `第 ${number} 集`, content, summary: episodeSummary(content), endState: episodeEndState(content), status: "ready" };
  }).sort((a, b) => a.number - b.number);
}

const NON_CHARACTER_LABELS = new Set(["时间", "地点", "场景", "内景", "外景", "画面", "镜头", "旁白", "字幕", "动作", "音效", "音乐", "备注", "人物", "角色", "剧情", "导演"]);

function extractCharacters(text: string): SeriesCharacter[] {
  const descriptions = new Map<string, string[]>();
  for (const line of text.split(/\n/).map((item) => item.trim()).filter(Boolean)) {
    const dialogue = line.match(/^([\u4e00-\u9fa5A-Za-z·]{2,12})\s*[：:]/);
    const profile = line.match(/^(?:人物|角色)?\s*([\u4e00-\u9fa5A-Za-z·]{2,12})\s*[：:（(]\s*(.{4,240})/);
    const name = String(dialogue?.[1] || profile?.[1] || "").trim();
    if (!name || NON_CHARACTER_LABELS.has(name) || /第.+集/.test(name)) continue;
    const current = descriptions.get(name) || [];
    if (profile?.[2] && current.length < 4) current.push(profile[2].trim());
    descriptions.set(name, current);
  }
  return [...descriptions.entries()].slice(0, 40).map(([name, details]) => ({ id: uid("character"), name, aliases: [], description: details.join("；") || "由 Agent 根据各集剧本持续补充人物身份、外貌、性格和人物弧光", relationship: "等待从剧情关系中确认" }));
}

function extractMemories(text: string, episodes: SeriesEpisode[]): SeriesMemory[] {
  const lines = text.split(/\n/).map((item) => item.trim()).filter((item) => item.length >= 6 && item.length <= 260);
  const pick = (pattern: RegExp, limit: number) => lines.filter((line) => pattern.test(line)).slice(0, limit);
  const background = pick(/世界观|背景|年代|时代|城市|国家|家族|公司|学校|过去|秘密/, 14);
  const relationships = pick(/关系|父亲|母亲|哥哥|姐姐|弟弟|妹妹|恋人|夫妻|朋友|敌人|同事|上司|下属/, 14);
  const rules = pick(/必须|始终|不能|从不|一直|设定|规则|固定|习惯|口头禅/, 12);
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
  return { version: 1, id: uid("series"), name: name.trim() || sourceFileName.replace(/\.[^.]+$/, "") || "未命名系列项目", sourceFileName, sourceText: "", createdAt: now, updatedAt: now, episodes, characters: extractCharacters(sourceText), memories: extractMemories(sourceText, episodes) };
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
  try { localStorage.setItem("manjing-new-studio", "1"); } catch { /* Optional navigation hint. */ }
  localStorage.removeItem("manjing-studio-open-project");
  const workspace = (() => { try { return JSON.parse(localStorage.getItem("manjing-workspace") || "{}"); } catch { return {}; } })();
  try { localStorage.setItem("manjing-workspace", JSON.stringify({ ...workspace, projectTitle: `${project.name} · 第 ${episode.number} 集`, scriptImported: true })); } catch { /* Studio consumes the full session handoff. */ }
  return context;
}
