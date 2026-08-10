"use client";

import { PRESET_SKILLS } from "./preset-skills";

export type LearningKind = "skill" | "memory";
export type MemoryClass = "experience" | "permanent" | "reflection" | "identity" | "anchor";
export type LearningScope = "agent" | "project" | "user";
export type LearningStatus = "candidate" | "approved" | "archived";

export interface AgentProfile {
  id: string;
  name: string;
  icon: string;
  duty: string;
}

export interface LearnedItem {
  id: string;
  agentId: string;
  kind: LearningKind;
  title: string;
  content: string;
  source: string;
  sourceUrl?: string;
  confidence: number;
  enabled: boolean;
  status: LearningStatus;
  memoryClass: MemoryClass;
  scope: LearningScope;
  projectId?: string;
  importance: number;
  tags: string[];
  whyRemembered: string;
  version: number;
  pinned: boolean;
  activationCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  sourceHash: string;
}

export interface LearnedItemInput {
  agentId: string;
  kind: LearningKind;
  title: string;
  content: string;
  source: string;
  sourceUrl?: string;
  confidence: number;
  enabled: boolean;
  status: LearningStatus;
  memoryClass?: MemoryClass;
  scope?: LearningScope;
  projectId?: string;
  importance?: number;
  tags?: string[];
  whyRemembered?: string;
  version?: number;
  pinned?: boolean;
}

export const AGENT_PROFILES: AgentProfile[] = [
  { id: "director", name: "导演 Agent", icon: "导", duty: "统筹风格、表演和镜头语言" },
  { id: "writer", name: "编剧 Agent", icon: "编", duty: "学习剧情、对白和人物弧光" },
  { id: "storyboard", name: "分镜 Agent", icon: "镜", duty: "拆解场次、景别和节奏" },
  { id: "video", name: "视频 Agent", icon: "影", duty: "学习动态提示词和模型适配" },
  { id: "voice", name: "配音 Agent", icon: "声", duty: "学习声音、情绪和对白表演" },
  { id: "editor", name: "剪辑 Agent", icon: "剪", duty: "学习剪辑、字幕、音效和完播节奏" },
];

const STORE_KEY = "manjing-agent-learning-v145";
const PRESET_KEY = "manjing-agent-preset-skills-v1";

export function readLearnedItems(): LearnedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    const current = Array.isArray(parsed) ? parsed.map(normalizeLearnedItem).filter(Boolean) as LearnedItem[] : [];
    if (localStorage.getItem(PRESET_KEY) === "1") return current;
    const presets = PRESET_SKILLS.map((preset) => ({
      ...createLearnedItem({
        agentId: preset.agentId,
        kind: "skill",
        title: preset.title,
        content: preset.content,
        source: preset.source,
        sourceUrl: preset.sourceUrl,
        confidence: 100,
        enabled: true,
        status: "approved" as const,
        memoryClass: "permanent" as const,
        scope: "agent" as const,
        importance: 8,
        tags: preset.tags,
        whyRemembered: "漫镜内置岗位基础技能，用户可以编辑、停用、钉选、归档或删除",
      }),
      id: `preset-${preset.id}`,
      sourceHash: `preset-${preset.id}`,
    }));
    const seeded = mergeLearnedItems(current, presets);
    localStorage.setItem(STORE_KEY, JSON.stringify(seeded));
    localStorage.setItem(PRESET_KEY, "1");
    return seeded;
  } catch {
    return [];
  }
}

export function writeLearnedItems(items: LearnedItem[]) {
  const normalized = mergeLearnedItems([], items).slice(-2000);
  localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("manjing-learning-changed"));
}

export function createLearnedItem(input: LearnedItemInput): LearnedItem {
  const now = new Date().toISOString();
  const content = input.content.trim();
  return {
    ...input,
    content,
    title: input.title.trim() || (input.kind === "skill" ? "未命名技能" : "未命名记忆"),
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    memoryClass: input.memoryClass || (input.kind === "skill" ? "permanent" : "experience"),
    scope: input.scope || "agent",
    importance: clamp(input.importance ?? (input.kind === "skill" ? 8 : 5), 1, 10),
    tags: uniqueStrings(input.tags || []),
    whyRemembered: input.whyRemembered?.trim() || "",
    version: Math.max(1, input.version || 1),
    pinned: Boolean(input.pinned),
    activationCount: 0,
    createdAt: now,
    updatedAt: now,
    sourceHash: fingerprint(`${input.agentId}|${input.kind}|${content}`),
  };
}

export function mergeLearnedItems(current: LearnedItem[], incoming: LearnedItem[]): LearnedItem[] {
  const merged = new Map<string, LearnedItem>();
  for (const raw of [...current, ...incoming]) {
    const item = normalizeLearnedItem(raw);
    if (!item) continue;
    const key = `${item.agentId}|${item.kind}|${item.sourceHash}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...previous,
      ...item,
      id: previous.id,
      createdAt: previous.createdAt,
      confidence: Math.max(previous.confidence, item.confidence),
      activationCount: Math.max(previous.activationCount, item.activationCount),
      tags: uniqueStrings([...previous.tags, ...item.tags]),
      version: item.content === previous.content ? previous.version : previous.version + 1,
      updatedAt: new Date().toISOString(),
    });
  }
  return [...merged.values()];
}

export function agentContext(agentId: string, limit = 20, projectId = "") {
  const now = Date.now();
  return readLearnedItems()
    .filter((item) => item.status === "approved" && item.enabled && !item.archivedAt)
    .filter((item) => item.agentId === agentId || item.scope === "user" || (item.scope === "project" && item.projectId === projectId))
    .sort((a, b) => contextScore(b, now) - contextScore(a, now))
    .slice(0, limit);
}

export function markContextUsed(ids: string[]) {
  if (!ids.length || typeof window === "undefined") return;
  const used = new Set(ids);
  const now = new Date().toISOString();
  writeLearnedItems(readLearnedItems().map((item) => used.has(item.id) ? {
    ...item,
    activationCount: item.activationCount + 1,
    lastUsedAt: now,
    updatedAt: now,
  } : item));
}

export function archiveLearnedItem(item: LearnedItem): LearnedItem {
  const now = new Date().toISOString();
  return { ...item, status: "archived", enabled: false, archivedAt: now, updatedAt: now };
}

export function restoreLearnedItem(item: LearnedItem): LearnedItem {
  const now = new Date().toISOString();
  const { archivedAt: _archivedAt, ...rest } = item;
  return { ...rest, status: "approved", enabled: true, updatedAt: now };
}

function normalizeLearnedItem(raw: Partial<LearnedItem>): LearnedItem | null {
  if (!raw || !raw.agentId || !raw.kind || !raw.content) return null;
  const createdAt = raw.createdAt || new Date().toISOString();
  const status: LearningStatus = raw.archivedAt ? "archived" : raw.status === "candidate" || raw.status === "archived" ? raw.status : "approved";
  return {
    id: raw.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    agentId: raw.agentId,
    kind: raw.kind,
    title: raw.title || (raw.kind === "skill" ? "未命名技能" : "未命名记忆"),
    content: raw.content,
    source: raw.source || "历史数据",
    sourceUrl: raw.sourceUrl || "",
    confidence: clamp(raw.confidence ?? 70, 0, 100),
    enabled: raw.enabled !== false && status === "approved",
    status,
    memoryClass: raw.memoryClass || (raw.kind === "skill" ? "permanent" : "experience"),
    scope: raw.scope || "agent",
    projectId: raw.projectId || "",
    importance: clamp(raw.importance ?? (raw.kind === "skill" ? 8 : 5), 1, 10),
    tags: uniqueStrings(Array.isArray(raw.tags) ? raw.tags : []),
    whyRemembered: raw.whyRemembered || "",
    version: Math.max(1, raw.version || 1),
    pinned: Boolean(raw.pinned),
    activationCount: Math.max(0, raw.activationCount || 0),
    lastUsedAt: raw.lastUsedAt,
    createdAt,
    updatedAt: raw.updatedAt || createdAt,
    archivedAt: raw.archivedAt,
    sourceHash: raw.sourceHash || fingerprint(`${raw.agentId}|${raw.kind}|${raw.content}`),
  };
}

function contextScore(item: LearnedItem, now: number) {
  const timestamp = Date.parse(item.lastUsedAt || item.updatedAt || item.createdAt) || now;
  const ageDays = Math.max(0, (now - timestamp) / 86400000);
  const recency = Math.exp(-0.02 * ageDays) * 15;
  const activation = Math.pow(Math.max(1, item.activationCount), 0.3) * 4;
  const stable = item.pinned || item.memoryClass === "permanent" || item.memoryClass === "anchor" ? 100 : 0;
  return stable + item.importance * 10 + recency + activation + item.confidence / 10;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function fingerprint(value: string) {
  let hash = 2166136261;
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
