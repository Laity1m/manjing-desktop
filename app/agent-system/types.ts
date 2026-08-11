export type AgentRole = "producer" | "writer" | "director" | "character" | "scene" | "storyboard" | "prompt" | "image" | "video" | "voice" | "editor";

export interface Agent {
  id: string;
  role: AgentRole;
  skills: string[];
  memory: string[];
}

export interface Task {
  id: string;
  role: AgentRole;
  prompt: string;
}

export interface Result {
  content: string;
  confidence?: number;
}

export interface AgentInstance {
  id: string;
  role: AgentRole;
  skills: string[];
  memory: string[];
  execute(task: Task): Promise<Result>;
}

export type UserMemory = Record<string, unknown>;
export type AgentMemory = Record<string, { memory: string[] }>;
export type ProjectMemory = Record<string, unknown>;
