# 漫镜 Manjing

漫镜是一套面向 AI 漫剧、短剧和视频创作者的 Windows 桌面工作环境。它把 Agent 对话、剧本创作、分镜设计、图片与视频生成、配音、素材管理和剪辑交付放在同一个项目中。

> 当前版本：1.4.4

## 1.4.4 新功能

### 独立 Agent 聊天区

导演、编剧、分镜、视频、配音和剪辑岗位都拥有自己的 Agent 对话空间。用户可以选择岗位进行持续交流，并把有效的工作方法保存为记忆或技能。

- 岗位 Agent 独立切换
- 多轮对话与项目上下文
- 将回复保存为长期记忆
- 将成功方法保存为技能
- 将对话结果发送到 AI 工作台
- 支持 Word、PDF、TXT、Markdown 和 Skill 文件投喂入口

### 技能与记忆区

每个 Agent 拥有独立的能力档案，学习到的技能和长期记忆会同步到对应岗位。

- 查看和管理 Agent 技能
- 编辑、添加和删除长期记忆
- 管理投喂资料
- 查看 Agent 学习记录
- 区分系统技能、聊天学习和资料学习

### Agnes 视频模型适配

1.4.4 修复了 AI 工作台和独立 AI 视频页面接入 Agnes Video 时的兼容问题。

- 使用 `POST /v1/videos` 创建异步视频任务
- 读取 Agnes 返回的 `video_id`
- 使用 `/agnesapi?video_id=...` 查询生成结果
- 兼容旧版 `/v1/videos/{task_id}` 查询方式
- 通过桌面代理调用，避免浏览器跨域限制

推荐配置：

```text
接口地址：https://apihub.agnes-ai.com/v1
模型 ID：agnes-video-v2.0
鉴权方式：Bearer API Key
适配方式：自定义 Webhook
```

## 原有功能完整保留

1.4.4 基于 1.4.3 更新，没有删除原有生产功能：

- AI 工作台：剧本、角色、分镜和多岗位 AI 协作
- AI 视频：文生视频、图生视频、参考素材和自定义模型
- 画布：节点式生产流程与镜头编排
- 编辑器：素材剪辑、转场、音轨和导出
- 资产库：图片、视频和音频素材管理
- 模型中心：API Key、预设模型和自定义模型配置
- 项目：草稿、历史记录和成片管理

## 支持的模型与接口

- Agnes Video
- 火山方舟 Seedance
- OpenAI 兼容接口
- Anthropic 兼容接口
- Gemini
- Pollinations
- 本地模型和自定义 Webhook

不同模型服务可能具有独立的参数、额度和计费规则，请以服务商控制台为准。

## 下载与安装

前往 [Releases](https://github.com/Laity1m/manjing-desktop/releases/latest) 下载最新 Windows x64 安装包：

```text
manjing-standalone-1.4.4-x64.exe
```

1. 完全退出旧版漫镜。
2. 卸载旧版本，避免旧安装目录或快捷方式继续启动旧程序。
3. 安装最新版本。
4. 从开始菜单重新打开漫镜。

## 1.4.4 文件校验

```text
SHA256: F3FFC6087A9B004E3F359CF4427CDACD2C396504D28E4400282FF7E9C206CDD8
```

## 数据与隐私

- 项目数据默认保存在本地。
- API Key 仅用于用户配置的模型服务。
- 不会把用户 Key 提交到本仓库。
- 投喂资料和 Agent 记忆应由用户自行确认其内容和授权范围。

## 反馈

发现安装、模型接入或生成流程问题时，请在 [GitHub Issues](https://github.com/Laity1m/manjing-desktop/issues) 提交反馈，并附上版本号、模型名称、接口地址格式和脱敏后的错误信息。
