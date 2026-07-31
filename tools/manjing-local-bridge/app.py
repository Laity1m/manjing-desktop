from __future__ import annotations

import io
import json
import mimetypes
import os
import secrets
import time
import wave
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

load_dotenv()

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs"
WORKFLOW_DIR = ROOT / "workflows"
OUTPUT_DIR.mkdir(exist_ok=True)
WORKFLOW_DIR.mkdir(exist_ok=True)

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
COSYVOICE_URL = os.getenv("COSYVOICE_URL", "http://127.0.0.1:50000").rstrip("/")
MUSETALK_URL = os.getenv("MUSETALK_URL", "http://127.0.0.1:8000").rstrip("/")
BRIDGE_TOKEN = os.getenv("BRIDGE_TOKEN", "").strip()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
COSYVOICE_MODE = os.getenv("COSYVOICE_MODE", "sft").strip().lower()
COSYVOICE_SPK_ID = os.getenv("COSYVOICE_SPK_ID", "中文女").strip()
COSYVOICE_SAMPLE_RATE = int(os.getenv("COSYVOICE_SAMPLE_RATE", "22050"))

app = FastAPI(title="漫镜本地桥接服务", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in os.getenv("ALLOW_ORIGINS", "*").split(",") if item.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Manjing-Node"],
)


def authorize(authorization: str | None) -> None:
    if not BRIDGE_TOKEN:
        return
    if authorization != f"Bearer {BRIDGE_TOKEN}":
        raise HTTPException(status_code=401, detail="桥接密钥不正确")


def public_url(request: Request, filename: str) -> str:
    base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return f"{base}/files/{filename}"


def workflow_path(kind: str) -> Path:
    configured = os.getenv(f"COMFYUI_{kind.upper()}_WORKFLOW", "").strip()
    return Path(configured).expanduser() if configured else WORKFLOW_DIR / f"{kind}.json"


def replace_tokens(value: Any, replacements: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: replace_tokens(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [replace_tokens(item, replacements) for item in value]
    if isinstance(value, str):
        if value in replacements:
            return replacements[value]
        result = value
        for token, replacement in replacements.items():
            result = result.replace(token, str(replacement))
        return result
    return value


async def upload_comfy_reference(client: httpx.AsyncClient, reference_url: str) -> str:
    if not reference_url:
        return ""
    source = await client.get(reference_url, follow_redirects=True)
    source.raise_for_status()
    content_type = source.headers.get("content-type", "image/png").split(";")[0]
    extension = mimetypes.guess_extension(content_type) or ".png"
    name = f"manjing-{secrets.token_hex(8)}{extension}"
    uploaded = await client.post(
        f"{COMFYUI_URL}/upload/image",
        files={"image": (name, source.content, content_type)},
        data={"overwrite": "true", "type": "input"},
    )
    uploaded.raise_for_status()
    data = uploaded.json()
    subfolder = str(data.get("subfolder") or "").strip("/")
    return f"{subfolder}/{data.get('name', name)}" if subfolder else str(data.get("name", name))


def find_comfy_output(history: dict[str, Any], prompt_id: str) -> dict[str, Any]:
    record = history.get(prompt_id, history)
    outputs = record.get("outputs", {}) if isinstance(record, dict) else {}
    for node in outputs.values():
        if not isinstance(node, dict):
            continue
        for key in ("videos", "gifs", "images", "audio"):
            items = node.get(key)
            if isinstance(items, list) and items:
                return items[0]
    raise HTTPException(status_code=502, detail="ComfyUI 工作流没有返回媒体文件")


async def run_comfy(kind: str, payload: dict[str, Any], request: Request) -> dict[str, str]:
    path = workflow_path(kind)
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"请先把 ComfyUI API 工作流保存为 {path.name}")
    prompt = str(payload.get("prompt") or "").strip()
    references = payload.get("references") if isinstance(payload.get("references"), list) else []
    aspect = str(payload.get("aspect") or "9:16")
    width, height = (704, 1280) if aspect == "9:16" else (1280, 704)
    duration = max(1, min(30, float(payload.get("duration") or 6)))
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=1200.0)) as client:
        image_name = await upload_comfy_reference(client, str(references[0])) if references else ""
        workflow = json.loads(path.read_text(encoding="utf-8"))
        workflow = replace_tokens(workflow, {
            "{{PROMPT}}": prompt,
            "{{NEGATIVE_PROMPT}}": "blurry, low quality, deformed anatomy, extra fingers, watermark, text, subtitles",
            "{{INPUT_IMAGE}}": image_name,
            "{{WIDTH}}": width,
            "{{HEIGHT}}": height,
            "{{DURATION}}": duration,
            "{{FRAMES}}": max(17, int(duration * 16) + 1),
            "{{SEED}}": secrets.randbelow(2_147_483_647),
        })
        queued = await client.post(f"{COMFYUI_URL}/prompt", json={"prompt": workflow})
        queued.raise_for_status()
        prompt_id = str(queued.json().get("prompt_id") or "")
        if not prompt_id:
            raise HTTPException(status_code=502, detail="ComfyUI 没有返回任务编号")
        deadline = time.monotonic() + 1200
        history: dict[str, Any] = {}
        while time.monotonic() < deadline:
            response = await client.get(f"{COMFYUI_URL}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            if prompt_id in history or history.get("outputs"):
                break
            await __import__("asyncio").sleep(2)
        else:
            raise HTTPException(status_code=504, detail="ComfyUI 生成超过 20 分钟")
        media = find_comfy_output(history, prompt_id)
        output = await client.get(f"{COMFYUI_URL}/view", params={
            "filename": media.get("filename", ""),
            "subfolder": media.get("subfolder", ""),
            "type": media.get("type", "output"),
        })
        output.raise_for_status()
        content_type = output.headers.get("content-type", "application/octet-stream").split(";")[0]
        extension = Path(str(media.get("filename") or "")).suffix or mimetypes.guess_extension(content_type) or (".mp4" if kind == "video" else ".png")
        filename = f"{kind}-{secrets.token_hex(10)}{extension}"
        (OUTPUT_DIR / filename).write_bytes(output.content)
        return {"url": public_url(request, filename), "kind": kind, "provider": "ComfyUI"}


@app.get("/health")
async def health(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    authorize(authorization)
    async with httpx.AsyncClient(timeout=3.0) as client:
        async def reachable(url: str) -> bool:
            try:
                return (await client.get(url)).status_code < 500
            except Exception:
                return False
        return {
            "status": "healthy",
            "nodes": {
                "comfyui": await reachable(f"{COMFYUI_URL}/system_stats"),
                "cosyvoice": await reachable(f"{COSYVOICE_URL}/docs"),
                "musetalk": await reachable(f"{MUSETALK_URL}/health"),
            },
            "workflows": {kind: workflow_path(kind).exists() for kind in ("image", "video")},
        }


@app.post("/v1/image")
async def image(request: Request, authorization: str | None = Header(default=None)) -> dict[str, str]:
    authorize(authorization)
    return await run_comfy("image", await request.json(), request)


@app.post("/v1/video")
async def video(request: Request, authorization: str | None = Header(default=None)) -> dict[str, str]:
    authorize(authorization)
    return await run_comfy("video", await request.json(), request)


@app.post("/v1/audio")
async def audio(request: Request, authorization: str | None = Header(default=None)) -> dict[str, str]:
    authorize(authorization)
    payload = await request.json()
    text = str(payload.get("prompt") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="配音文本不能为空")
    form = {"tts_text": text, "spk_id": COSYVOICE_SPK_ID}
    endpoint = "/inference_sft"
    if COSYVOICE_MODE == "instruct":
        endpoint = "/inference_instruct"
        form["instruct_text"] = str(payload.get("emotion") or payload.get("model") or "自然、清晰地说")
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=600.0)) as client:
        response = await client.post(f"{COSYVOICE_URL}{endpoint}", data=form)
        response.raise_for_status()
    wav_bytes = io.BytesIO()
    with wave.open(wav_bytes, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(COSYVOICE_SAMPLE_RATE)
        wav.writeframes(response.content)
    filename = f"voice-{secrets.token_hex(10)}.wav"
    (OUTPUT_DIR / filename).write_bytes(wav_bytes.getvalue())
    return {"url": public_url(request, filename), "kind": "audio", "provider": "CosyVoice"}


@app.post("/v1/lipsync")
async def lipsync(
    request: Request,
    source: UploadFile = File(...),
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize(authorization)
    source_bytes = await source.read()
    audio_bytes = await audio.read()
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=1800.0)) as client:
        generated = await client.post(
            f"{MUSETALK_URL}/generate",
            files={
                "source": (source.filename or "source.mp4", source_bytes, source.content_type or "application/octet-stream"),
                "audio": (audio.filename or "voice.wav", audio_bytes, audio.content_type or "audio/wav"),
            },
            data={"enhance": "true", "fps": "25", "batch_size": "8"},
        )
        generated.raise_for_status()
        result = generated.json()
        download_url = str(result.get("download_url") or "")
        if not download_url:
            raise HTTPException(status_code=502, detail="MuseTalk 没有返回下载地址")
        output = await client.get(urljoin(f"{MUSETALK_URL}/", download_url.lstrip("/")))
        output.raise_for_status()
    filename = f"lipsync-{secrets.token_hex(10)}.mp4"
    (OUTPUT_DIR / filename).write_bytes(output.content)
    return {"url": public_url(request, filename), "kind": "video", "provider": "MuseTalk"}


@app.get("/files/{filename}")
async def files(filename: str, authorization: str | None = Header(default=None)) -> FileResponse:
    authorize(authorization)
    safe_name = Path(filename).name
    path = OUTPUT_DIR / safe_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path)

