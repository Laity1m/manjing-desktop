# 漫镜 Manjing

漫镜是一款面向 AI 漫剧创作的 Windows 桌面工作台，将故事创作、角色设定、智能分镜、画面生成、动态视频、配音和剪辑整合到一套创作流程中。

## 核心能力

- 从故事文本生成剧本、角色与结构化分镜
- 为角色建立可复用的视觉参考，保持连续镜头一致性
- 支持文生图、图生视频、配音、字幕和多轨剪辑
- 支持火山方舟 Seedance 原生异步多媒体生成任务
- 支持自定义 OpenAI 兼容接口、Pollinations 与通用 Webhook
- 本地保存模型配置和项目数据

## 火山方舟原生支持

1. 在“视频 AI”岗位选择“火山方舟多媒体任务”。
2. 填写官方任务地址、API Key 和 Seedance 模型 ID 或 Endpoint ID。
3. 运行配置校验后保存。
4. 生成时，漫镜直接提交方舟原生 `model + content[]` 请求并轮询异步任务状态，不经过通用 Webhook 参数转换。

官方任务地址：

```text
https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
```

## 下载

请在 [Releases](https://github.com/Laity1m/manjing-desktop/releases/latest) 下载最新 Windows x64 独立安装包。

当前版本：`1.3.9`

安装包 SHA256：

```text
57DC52F89CEA4CB5008071435C11B108051D10CC58B8184B06571322680ADFAD
```

## 说明

- 视频、图片、语音等云端模型可能按服务商规则产生费用。
- API Key 仅用于对应服务请求，请勿提交到公开仓库或分享给他人。
- 若显卡驱动兼容性较差，可使用 `--software-rendering` 启动参数。

## 版本记录

详见各版本的 GitHub Release 发布说明。
