export interface MemoryStore {
  user: Record<string, unknown>;
  agents: Record<string, { memory: string[] }>;
  projects: Record<string, unknown>;
}

const USER_KEY = "manjing-memory-user-v1";
const AGENT_KEY = "manjing-memory-agent-v1";
const PROJECT_KEY = "manjing-memory-project-v1";

export function readMemoryStore(): MemoryStore {
  const user = safeLoad<Record<string, unknown>>(USER_KEY, {});
  const agents = safeLoad<Record<string, { memory: string[] }>>(AGENT_KEY, {});
  const projects = safeLoad<Record<string, unknown>>(PROJECT_KEY, {});
  return { user, agents, projects };
}

export function writeMemoryStore(store: MemoryStore) {
  localStorage.setItem(USER_KEY, JSON.stringify(store.user));
  localStorage.setItem(AGENT_KEY, JSON.stringify(store.agents));
  localStorage.setItem(PROJECT_KEY, JSON.stringify(store.projects));
  window.dispatchEvent(new CustomEvent("manjing-memory-changed"));
}

export function writeLayer(key: keyof MemoryStore, value: Record<string, unknown>) {
  localStorage.setItem(memoryKey(key), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("manjing-memory-changed"));
}

function memoryKey(key: keyof MemoryStore) {
  if (key === "user") return USER_KEY;
  if (key === "agents") return AGENT_KEY;
  return PROJECT_KEY;
}

function safeLoad<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}
