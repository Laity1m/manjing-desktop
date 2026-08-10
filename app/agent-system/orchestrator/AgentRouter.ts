import type { AgentManager, ProducerTask } from "./AgentManager";
import { planTasks, type ProducedTask, type UserGoal } from "./TaskPlanner";

export interface RouteResult {
  goal: string;
  tasks: ProducedTask[];
  outputs: ProducerTask[];
}

export async function routeAndRun(input: {
  text: string;
  manager: AgentManager;
}) {
  const goal: UserGoal = {
    text: input.text.trim(),
    createdAt: new Date().toISOString(),
  };

  const tasks = planTasks(goal);
  const outputs: ProducerTask[] = [];

  for (const task of tasks) {
    const agent = input.manager.findByRole(task.role)[0];
    if (!agent) continue;

    const routed = await input.manager.run(agent.info.id, task.instruction);
    outputs.push(routed);
  }

  return {
    goal: goal.text,
    tasks,
    outputs,
  } as RouteResult;
}
