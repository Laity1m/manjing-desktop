# ComfyUI 工作流

在 ComfyUI 中准备好生图或 Wan2.2 图生视频工作流后，选择“保存（API 格式）”，分别保存为：

- `image.json`
- `video.json`

在工作流输入值中使用以下占位符，桥接服务会在每次任务中自动替换：

- `{{PROMPT}}`：正向提示词
- `{{NEGATIVE_PROMPT}}`：负向提示词
- `{{INPUT_IMAGE}}`：上传到 ComfyUI 的参考图片文件名
- `{{WIDTH}}` / `{{HEIGHT}}`：目标尺寸
- `{{DURATION}}`：目标秒数
- `{{FRAMES}}`：按 16fps 计算的帧数
- `{{SEED}}`：随机种子

只需要替换工作流中实际使用的字段，不要求全部出现。工作流最后必须包含 SaveImage、SaveAnimatedWEBP、VHS_VideoCombine 或其他能在 `/history` 返回媒体文件的输出节点。
