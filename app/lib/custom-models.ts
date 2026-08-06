export type CustomModelRole = "director" | "writer" | "image" | "video" | "voice" | "editor";
export type CustomModelAdapter = "openai" | "anthropic" | "gemini" | "pollinations" | "seedance" | "browser" | "webhook";

export type CustomModel = {
  id: string;
  role: CustomModelRole;
  name: string;
  adapter: CustomModelAdapter;
  model: string;
  endpoint: string;
  apiKey: string;
  note: string;
};

export const CUSTOM_MODELS_KEY = "manjing-custom-models";

export function loadCustomModels(): CustomModel[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_MODELS_KEY) || "[]") as CustomModel[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.role && item?.name && item?.model) : [];
  } catch {
    return [];
  }
}

export function saveCustomModels(models: CustomModel[]) {
  localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(models.slice(0, 60)));
  window.dispatchEvent(new CustomEvent("manjing-custom-models-changed"));
}

async function desktopSettingsRequest(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("本机配置写入超过 6 秒，操作已解除锁定，请重试");
    throw reason;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function saveCustomModelsToDesktop(models: CustomModel[], removedId = "") {
  let settings: Record<string, unknown> = {};
  try {
    const current = await desktopSettingsRequest("/api/desktop/settings", { cache: "no-store" }, 3000);
    if (current.ok) settings = await current.json() as Record<string, unknown>;
  } catch {
    settings = {};
  }
  const agentConfigs = { ...((settings.agentConfigs || {}) as Record<string, { preset?: string }>) };
  if (removedId) {
    for (const [role, config] of Object.entries(agentConfigs)) {
      if (config?.preset === removedId) delete agentConfigs[role];
    }
  }
  const response = await desktopSettingsRequest("/api/desktop/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...settings, agentConfigs, customModels: models.slice(0, 60), savedAt: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("独立版本机模型库保存失败");
}
