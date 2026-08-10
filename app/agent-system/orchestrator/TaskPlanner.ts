export type StoryPhase =
  | "writer"
  | "director"
  | "character"
  | "scene"
  | "video"
  | "editor";

export interface UserGoal {
  text: string;
  createdAt: string;
}

export interface ProducedTask {
  id: string;
  role: StoryPhase;
  priority: number;
  instruction: string;
}

const ROLE_KEYWORDS: Array<[StoryPhase, string[]]> = [
  ["writer", ["剧本", "脚本", "台词", "改编", "写作", "内容"]],
  ["director", ["分镜", "节奏", "剧情", "风格", "视角", "镜头"]],
  ["character", ["角色", "人物", "人设", "对白"]],
  ["scene", ["场景", "地点", "布景", "道具"]],
  ["video", ["视频", "动态", "动画", "镜头", "运动"]],
  ["editor", ["剪辑", "节奏", "字幕", "混音", "片段", "片头"]],
];

export function planTasks(goal: UserGoal): ProducedTask[] {
  const text = goal.text.toLowerCase();
  const tasks: ProducedTask[] = [];
  const now = Date.now();

  for (const [role, keywords] of ROLE_KEYWORDS) {
    const matched = keywords.some((keyword) => text.includes(keyword));
    if (matched) {
      tasks.push({
        id: `goal-${goal.createdAt}-${role}`,
        role,
        priority: rolePriority(role),
        instruction: `${role} 岗位：基于目标 "${goal.text}" 执行对应工作流`,
      });
    }
  }

  if (!tasks.length) {
    tasks.push(
      {
        id: `goal-${goal.createdAt}-writer`,
        role: "writer",
        priority: 1,
        instruction: `写作岗位：基于目标 "${goal.text}" 进行剧本与任务拆解`,
      },
      {
        id: `goal-${goal.createdAt}-director`,
        role: "director",
        priority: 2,
        instruction: `导演岗位：基于目标 "${goal.text}" 生成风格与节奏建议`,
      },
      {
        id: `goal-${goal.createdAt}-video`,
        role: "video",
        priority: 3,
        instruction: `视频岗位：基于目标 "${goal.text}" 输出拍摄与动作要点`,
      },
    );
  }

  return tasks
    .sort((a, b) => a.priority - b.priority)
    .map((task, index) => ({
      ...task,
      id: `${task.id}-${now}-${index}`,
    }));
}

function rolePriority(role: StoryPhase): number {
  if (role === "writer") return 1;
  if (role === "director") return 2;
  if (role === "character") return 3;
  if (role === "scene") return 4;
  if (role === "video") return 5;
  return 6;
}
