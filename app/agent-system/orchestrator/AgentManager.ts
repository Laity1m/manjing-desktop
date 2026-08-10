export interface AgentInfo {
  id: string;
  role: string;
  skills: string[];
}

export interface Agent {
  info: AgentInfo;
  execute(task: string): Promise<string>;
}

export interface ProducerTask {
  id: string;
  role: string;
  prompt: string;
  status: "pending" | "running" | "done" | "failed";
  result?: string;
  error?: string;
}

export class AgentManager {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.info.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  findByRole(role: string): Agent[] {
    return this.list().filter((agent) => agent.info.role === role);
  }

  async run(agentId: string, prompt: string): Promise<ProducerTask> {
    const agent = this.get(agentId);
    if (!agent) throw new Error(`未找到智能体：${agentId}`);

    const task: ProducerTask = {
      id: `task-${Date.now()}-${agentId}`,
      role: agent.info.role,
      prompt,
      status: "running",
    };

    try {
      task.result = await agent.execute(prompt);
      task.status = "done";
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : `${error}`;
    }

    return task;
  }
}
