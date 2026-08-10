# 漫镜 1.4.4

本版本基于《manjing-desktop AI Agent OS 扩展开发需求文档》执行第一阶段架构补齐，保持 1.4.3 既有功能与修复不变。

## 主要更新

- 增加 `agent-system` 基础层，开始建立 Multi-Agent Orchestrator 代码骨架（不影响现有工作台功能）。
- 增加 Agent 管理器与执行流水线：
  - `app/agent-system/orchestrator/AgentManager.ts`
  - `app/agent-system/orchestrator/TaskPlanner.ts`
  - `app/agent-system/orchestrator/AgentRouter.ts`
- 增加 Skill 模块定义与解析能力：
  - `app/agent-system/skills.ts`
- 增加三层记忆模型与本地持久化模型：
  - `app/agent-system/types.ts`
  - `app/agent-system/memory/index.ts`
- 保持视频与桌面运行时模型接入修复（沿用 1.4.3 可用基础）。

## 安装包

- Windows：`manjing-standalone-1.4.4-x64.exe`
