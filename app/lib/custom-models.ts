export type CustomModelRole = "director" | "writer" | "image" | "video" | "voice" | "editor";
export type CustomModelAdapter = "pollinations" | "seedance" | "browser" | "webhook";

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
