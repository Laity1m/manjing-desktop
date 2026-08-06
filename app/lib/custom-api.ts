import type { CustomModelAdapter, CustomModelRole } from "./custom-models";

export type DiscoverableApiMode = Extract<CustomModelAdapter, "openai" | "anthropic" | "gemini" | "pollinations" | "webhook">;
export type DiscoveredModel = { id: string; name: string };

export const API_MODE_LABELS: Record<DiscoverableApiMode, string> = {
  openai: "OpenAI（兼容文本 / 生图接口）",
  anthropic: "Anthropic / Claude",
  gemini: "Google Gemini",
  pollinations: "Pollinations",
  webhook: "通用 Webhook",
};

export const API_MODE_DEFAULT_ENDPOINTS: Record<DiscoverableApiMode, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  pollinations: "https://gen.pollinations.ai/v1",
  webhook: "",
};

const TEXT_ROLES: CustomModelRole[] = ["director", "writer", "editor"];

export function apiModesForRole(role: CustomModelRole): DiscoverableApiMode[] {
  if (TEXT_ROLES.includes(role)) return ["openai", "anthropic", "gemini", "pollinations", "webhook"];
  if (role === "image") return ["openai", "pollinations", "webhook"];
  return ["pollinations", "webhook"];
}

export function isDiscoverableApiMode(value: CustomModelAdapter): value is DiscoverableApiMode {
  return ["openai", "anthropic", "gemini", "pollinations", "webhook"].includes(value);
}

export function endpointForMode(mode: DiscoverableApiMode, current = "") {
  return current.trim() || API_MODE_DEFAULT_ENDPOINTS[mode];
}

export async function discoverApiModels(input: { mode: DiscoverableApiMode; endpoint: string; apiKey: string }): Promise<DiscoveredModel[]> {
  const response = await fetch("/api/desktop/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as { models?: DiscoveredModel[]; error?: string };
  if (!response.ok) throw new Error(data.error || `读取模型失败（${response.status}）`);
  const models = Array.isArray(data.models) ? data.models.filter((item) => item?.id) : [];
  if (!models.length) throw new Error("接口连接成功，但没有返回可用模型");
  return models;
}
