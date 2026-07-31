# 漫镜本地桥接服务

这个小服务把 ComfyUI/Wan2.2、CosyVoice 和 MuseTalk 的不同接口统一成漫镜能够调用的格式。它不包含模型，也不会替你下载模型。

## 准备

1. 安装并启动需要的开源服务：ComfyUI（默认 8188）、CosyVoice FastAPI（默认 50000）、MuseTalk API（默认 8000）。不用的服务可以不启动。
2. 把 ComfyUI 的 API 格式工作流放进 `workflows`，具体见 `workflows/README.md`。
3. Windows 右键使用 PowerShell 运行 `start.ps1`。首次启动会创建 `.env` 并安装桥接依赖。
4. 编辑 `.env`，确认服务地址、说话人名称和 `BRIDGE_TOKEN`。
5. 重新运行 `start.ps1`，打开 `http://127.0.0.1:8765/health` 检查节点。

## 让网页访问本机

漫镜网站使用 HTTPS。最稳妥的方式是给 8765 端口配置 HTTPS 反向代理或临时安全隧道，然后把得到的 HTTPS 地址填进漫镜的“开源节点中心”。如果你的浏览器允许 HTTPS 页面访问 localhost，也可以直接尝试 `http://127.0.0.1:8765`。

不要把未设置 `BRIDGE_TOKEN` 的服务直接暴露到公网。输出文件默认保存在本目录的 `outputs` 文件夹。

## 漫镜统一接口

- `GET /health`：检查三个本地节点和两个 ComfyUI 工作流。
- `POST /v1/image`：运行 `workflows/image.json`。
- `POST /v1/video`：运行 `workflows/video.json`。
- `POST /v1/audio`：调用 CosyVoice。
- `POST /v1/lipsync`：上传画面与音频并调用 MuseTalk。

所有受保护请求使用 `Authorization: Bearer <BRIDGE_TOKEN>`。

## 开源项目

- ComfyUI: https://github.com/comfy-org/ComfyUI
- Wan2.2: https://github.com/Wan-Video/Wan2.2
- CosyVoice: https://github.com/FunAudioLLM/CosyVoice
- MuseTalk: https://github.com/TMElyralab/MuseTalk

请分别遵守各项目、模型权重和依赖项的许可证。本桥接服务自身按 MIT 许可证使用。
