# 漫镜本地桥接服务

这个小服务把 ComfyUI/Wan2.2、CosyVoice、MuseTalk、MoneyPrinterTurbo 与 VibeVoice Realtime 的不同接口统一成漫镜能够调用的格式。它不包含模型，也不会替你下载模型；所有节点都可以按需启动。

## 准备

1. 安装并启动需要的开源服务：ComfyUI（默认 8188）、CosyVoice FastAPI（默认 50000）、MuseTalk API（默认 8000）、MoneyPrinterTurbo API（默认 8080）或 VibeVoice Realtime（默认 3000）。不用的服务可以不启动。
2. 把 ComfyUI 的 API 格式工作流放进 `workflows`，具体见 `workflows/README.md`。
3. Windows 右键使用 PowerShell 运行 `start.ps1`。首次启动会创建 `.env` 并安装桥接依赖。
4. 编辑 `.env`，确认服务地址、说话人名称和 `BRIDGE_TOKEN`。
5. 重新运行 `start.ps1`，打开 `http://127.0.0.1:8765/health` 检查节点。健康检查会并行检测已经配置的服务，不会因为某个模型离线而阻塞其他节点。

## MoneyPrinterTurbo 自动成片

1. 按 MoneyPrinterTurbo 官方 README 完成本地安装并启动 API/WebUI，确认 `http://127.0.0.1:8080/docs` 可以打开。
2. 在 `.env` 中保留 `MONEYPRINTER_URL=http://127.0.0.1:8080`，然后重启漫镜桥接。
3. 在漫镜剪辑台导入工作台工程后，点击“MoneyPrinter 自动成片”。漫镜会把时间线中的图片/视频逐个上传为本地素材，创建顺序拼接任务并显示真实进度。
4. 任务完成后，成片会回到剪辑台预览区，可下载，也不会替换原来的可编辑时间线。

MoneyPrinterTurbo 自身仍需要 FFmpeg，并可能使用其配置的 TTS、字幕和素材处理能力。漫镜只调用官方 `/api/v1/video_materials`、`/api/v1/videos` 与 `/api/v1/tasks/{id}` 接口，不读取它的本地文件系统。

## VibeVoice 实验性配音

1. 按微软 VibeVoice 官方说明安装仓库与 `VibeVoice-Realtime-0.5B` 权重。
2. 在 VibeVoice 仓库运行 `python demo/vibevoice_realtime_demo.py --model_path microsoft/VibeVoice-Realtime-0.5B`，确认 `http://127.0.0.1:3000/config` 能返回音色列表。
3. 重启漫镜桥接，在工作台“开源节点中心”对 VibeVoice 卡片点击“应用到配音 AI”。桥接会读取官方 WebSocket PCM 流并封装为 24 kHz WAV。

当前官方 Realtime 0.5B 主要面向英文、单角色流式配音，因此本节点标记为“实验”。中文多角色项目仍建议优先使用 CosyVoice。VibeVoice-ASR 可以通过 `VIBEVOICE_ASR_URL` 加入健康检查，但不同 ASR 部署的接口尚未统一，本版不会假装兼容未经确认的第三方请求格式。

## 让网页访问本机

漫镜网站使用 HTTPS。最稳妥的方式是给 8765 端口配置 HTTPS 反向代理或临时安全隧道，然后把得到的 HTTPS 地址填进漫镜的“开源节点中心”。如果你的浏览器允许 HTTPS 页面访问 localhost，也可以直接尝试 `http://127.0.0.1:8765`。

不要把未设置 `BRIDGE_TOKEN` 的服务直接暴露到公网。输出文件默认保存在本目录的 `outputs` 文件夹。

## 漫镜统一接口

- `GET /health`：并行检查五个本地节点、可选 ASR 节点和两个 ComfyUI 工作流。
- `POST /v1/image`：运行 `workflows/image.json`。
- `POST /v1/video`：运行 `workflows/video.json`。
- `POST /v1/audio`：调用 CosyVoice；带 `reference_audio + referenceText` 时自动走 zero-shot 人物音色克隆，检测到 FFmpeg 时输出 MP3。
- `POST /v1/voice-profiles/extract`：从用户指定的单人物对白视频片段提取、降噪并响度标准化为 MP3；多人混音需先做说话人分离。
- `POST /v1/vibevoice/audio`：调用 VibeVoice Realtime WebSocket 并输出 WAV。
- `POST /v1/lipsync`：上传画面与音频并调用 MuseTalk。
- `POST /v1/moneyprinter/materials`：向 MoneyPrinterTurbo 上传一个剪辑素材。
- `POST /v1/moneyprinter/videos`：用已上传素材创建自动成片任务。
- `GET /v1/moneyprinter/tasks/{task_id}`：查询自动成片的真实状态和进度。
- `GET /v1/moneyprinter/tasks/{task_id}/result`：把完成的视频复制到桥接输出目录并返回播放地址。

所有受保护请求使用 `Authorization: Bearer <BRIDGE_TOKEN>`。

## 开源项目

- ComfyUI: https://github.com/comfy-org/ComfyUI
- Wan2.2: https://github.com/Wan-Video/Wan2.2
- CosyVoice: https://github.com/FunAudioLLM/CosyVoice
- MuseTalk: https://github.com/TMElyralab/MuseTalk
- MoneyPrinterTurbo: https://github.com/harry0703/MoneyPrinterTurbo
- VibeVoice: https://github.com/microsoft/VibeVoice

请分别遵守各项目、模型权重和依赖项的许可证。本桥接服务自身按 MIT 许可证使用。
