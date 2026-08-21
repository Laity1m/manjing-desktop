# 漫镜 Manjing

面向 AI 漫剧、AI 动画短剧和系列视频制作的 Windows 桌面工作台。当前公开版本为 **v0.0.1**。

![漫镜工作台总览](README-media/漫镜视觉-01.png)

## 它能做什么

漫镜把一部剧本拆成可持续制作的项目：剧本只做一次权威资产分析，人物、造型、场景、道具和音色进入项目资产库；后续 Agent 在同一份项目记忆、Canonical 资产和已批准镜头状态上协作。

- 中文、英文剧本与多集总剧本导入
- 导演、编剧、镜头总控、生图、视频、配音与剪辑 Agent
- 人物不同服装/状态独立命名，例如“苏梨-破院居家版”
- 项目级人物、场景、道具、视频和音色资产隔离
- 已有资产先匹配，只有真正缺失的资产才进入生成
- 图片和视频大窗预览、逐项审核、填写修改要求后重做
- Seedance 全能参考：人物、精确造型、场景、道具、音色和上一镜已批准视频
- 不生成分镜首帧图，不把抽取的首帧/尾帧图片提交给视频模型
- 人物空间锚点、构图边界、Start State / End State 和逐镜一致性检查
- 首次对白音色提取并保存到当前项目音色库

![Agent 团队](README-media/漫镜-Agent团队.png)

## 项目记忆与 Skill

v0.0.1 使用三层制作上下文：

1. **项目长期记忆**：世界观、背景、固定人物关系、Canonical 资产。
2. **分集上下文**：当前集剧本、相关角色、上一集结束状态。
3. **已批准镜头事件账本**：人物造型、归一化位置、朝向、道具、动作和镜头结束状态。

所有文本模型通道通过同一套 Skill 解析规则，按照当前项目、岗位、任务相关度和长度预算检索已启用 Skill。制作记录会显示本次真正调用的 Skill/记忆；外部媒体 Webhook 同时收到编译后的岗位知识。

![技能与记忆](README-media/漫镜-技能记忆.png)

## 标准制作流程

```text
导入总剧本
  → 一次性全文分析并确认项目圣经/资产清单
  → 匹配当前项目及公共资产
  → 生成真正缺失的人物、场景与道具
  → 结构化拆镜与导演复核（不得重建资产）
  → 逐镜全能参考视频生成
  → 用户预览、批准或填写要求修改
  → 批准结果写入事件账本并生成下一镜
  → 配音、剪辑与成片归档
```

![资产与逐镜生产](README-media/漫镜视觉-03.png)

## 连续性原则

- 同一人物身份只绑定一份当前任务 Canonical 基准；不同造型共用身份脸，但服装和状态独立。
- 同一场景继承归一化人物坐标、景深、朝向、左右顺序和构图边界。
- 位置冻结时禁止无理由自动居中、换边、横移、环绕、推拉和重新裁切。
- 上一镜已批准视频可以作为普通 `@Video` 全能参考；抽帧只用于本地质检。
- 一致性检查失败会进入修改/人工审核，不会污染下一镜参考。

生成式视频模型仍然存在随机性，结构化约束和审核流程可以显著降低漂移，但不能承诺像传统 3D 引擎一样绝对锁定几何位置。

## 支持的视觉方向

包含国漫、日漫、欧美 2D 动画、欧美成人动画、欧美 3D 动漫、欧美动画电影、欧美写实、电影写实、水彩、黏土、赛博朋克等默认方向。人物生成会应用选角美感、差异化脸部设计和质量闸门。

![视觉风格](README-media/漫镜视觉-02.png)

## 安装

1. 打开 [v0.0.1 Release](https://github.com/Laity1m/manjing-desktop/releases/tag/v0.0.1)。
2. 下载 `漫镜-0.0.1-Windows-x64.exe`。
3. 安装后在“模型中心”配置自己的接口和密钥。
4. 在“项目”中导入总剧本，选择剧集进入工作台。

Windows 10/11 x64。模型调用可能产生第三方费用，请以对应服务商为准。

## Seedance 接入

- 在模型中心填写火山方舟 API Key 和已开通的 Seedance 模型/Endpoint ID。
- 采用原生异步任务创建、查询和结果下载。
- 创建请求不盲目重试，避免重复任务和重复计费。
- 真人写实参考可能需要火山侧可信人物授权；动画和 3D 动漫项目不会继承其他项目的真人授权阻断。

## 数据与密钥

- 项目、聊天、Skill、记忆与媒体资产默认保存在用户本机。
- 项目专属资产只能在当前项目使用；公共资产必须由用户明确设为公共。
- API Key 通过桌面设置通道保存，不写入 Git 仓库、README 或导出的工程文件。
- 不建议在客户端内置企业主密钥；生产环境应通过用户自己的服务端代理签名和轮换。

## 技术栈

- TypeScript、React 19
- Next.js 16 / Vinext / Vite
- Electron 43、electron-builder、NSIS
- IndexedDB / localStorage 本地项目与资产元数据
- 火山方舟 Seedance、OpenAI 兼容 API、Pollinations、AI Horde、自定义 Webhook

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

检查与构建：

```bash
npm run check
npm run build
cd windows-app
npm install
npm run dist
```

## 仓库结构

```text
app/            桌面 Web UI、Agent、项目、资产与生产流程
tests/          回归测试
windows-app/    Electron 主进程与 Windows 安装包配置
tools/          可选本地桥接服务
skills/         可导入的默认 Skill 源文件
README-media/   README 截图
```

## 反馈

- [提交 Issue](https://github.com/Laity1m/manjing-desktop/issues)
- [查看 v0.0.1 Release](https://github.com/Laity1m/manjing-desktop/releases/tag/v0.0.1)

详细变更见 [RELEASE_NOTES_0.0.1.md](RELEASE_NOTES_0.0.1.md)。
