# 漫镜 Manjing

![Manjing 悬浮封面](README-media/漫镜视觉-01.png)

漫镜是一套面向 AI 漫剧创作的 Windows 桌面工作台。  
你可以在一个界面里完成故事生成、角色设定、分镜编排、图像生成、动态视频合成、配音和剪辑。

![工作界面预览一](README-media/漫镜视觉-02.png)

![工作界面预览二](README-media/漫镜视觉-03.png)

## 为什么你可能会喜欢它

- 一次创作，多模型联动：文本、图片、视频、音频在同一项目中承接。
- 本地项目配置持久化，创作参数可复用、可追溯。
- 支持火山方舟、OpenAI 兼容、Pollinations 与自定义 Webhook。
- Windows 平台独立安装版，开箱即用。

## 快速开始

1. 在 [Releases](https://github.com/Laity1m/manjing-desktop/releases/latest) 下载最新版 Windows x64 安装包并安装。
2. 第一次启动后进入设置页，填入你使用的模型服务参数。
3. 使用“AI 写作”生成剧本和分镜，再进入“自主视频”完成可视化创作。
4. 通过“任务面板”查看生成进度，导出成片并做二次剪辑。

## 火山方舟（Seedance / Agnes）原生适配

#### 自动模式改为“原生通道”并修复兼容问题

- 新增“火山方舟多媒体任务”，避免通过通用 Webhook 转换参数。
- 任务提交与轮询统一走原生接口，模型参数与官方约定对齐。
- “测试连接”只用于配置校验，不会触发实际消耗。

#### 正确 Base URL

在页面中请不要在 Base URL 末尾手动加 `/v1`，  
软件内部会自动拼接 `/videos`，否则会被路由为 `.../v1/videos` 导致 404。

推荐写法：

```text
https://apihub.agnes-ai.com
```

### 常用端点

- 方舟多媒体任务（Seedance 原生）：`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- Agnes 任务基座：`https://apihub.agnes-ai.com`

## 版本说明

当前版本：`v1.4.0`  
发布说明文件：`修复说明-1.4.0.md`

安装包：`Manjing-Setup-1.4.0-x64.exe`  
SHA256：

```text
0E145CB96089A04B25094FB631137538FD455C38E287C4B3AC42E35CA497BFFE
```

## 常见问题

- 生成进度卡在 5% 的情况：该阶段为排队 + 任务预热，当前默认 5 秒轮询，60 秒超时，已做本地降级展示，通常会自动继续。
- API 返回 400 且提示 content 缺失：通常是参数包格式不兼容，请确认已使用“火山方舟多媒体任务”而不是通用 Webhook。
- 需要更高稳定性：建议使用更小尺寸的参考图，逐步叠加风格提示词。

## 下载与反馈

- 主页：`https://github.com/Laity1m/manjing-desktop`
- 反馈渠道：仓库 Issues

## 安全与隐私

- Key 仅用于用户所配置的服务，不会上传到第三方用于分析。
- 所有项目数据默认保留在本地环境。
- 第三方模型服务可能产生使用费用，请按服务商计费说明确认后使用。
