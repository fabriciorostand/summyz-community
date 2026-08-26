from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
from pathlib import Path
from threading import Lock
from typing import Annotated

import ctranslate2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel
from faster_whisper.utils import download_model
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("summyz.faster_whisper")
app = FastAPI(title="Summyz faster-whisper sidecar", docs_url=None, redoc_url=None)

MODEL_ROOT = Path(os.environ.get("SUMMYZ_MODEL_DIR", "/models/managed")).resolve()
TEMP_ROOT = Path("/tmp/summyz-audio").resolve()
MODEL_ROOT.mkdir(parents=True, exist_ok=True)
TEMP_ROOT.mkdir(parents=True, exist_ok=True)

model_lock = Lock()
loaded_model: WhisperModel | None = None
loaded_model_name: str | None = None
loaded_device: str | None = None


class ModelRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._/-]+$")


class ModelStatus(BaseModel):
    device: str
    model: str
    status: str


def model_directory(model: str) -> Path:
    digest = hashlib.sha256(model.encode("utf-8")).hexdigest()
    directory = (MODEL_ROOT / digest).resolve()
    if directory.parent != MODEL_ROOT:
        raise ValueError("Managed model path escaped its root")
    return directory


def unload_model() -> None:
    global loaded_model, loaded_model_name, loaded_device
    loaded_model = None
    loaded_model_name = None
    loaded_device = None


def load_model(model: str) -> tuple[WhisperModel, str]:
    global loaded_model, loaded_model_name, loaded_device
    with model_lock:
        if loaded_model is not None and loaded_model_name == model and loaded_device is not None:
            return loaded_model, loaded_device

        directory = model_directory(model)
        directory.mkdir(parents=True, exist_ok=True)
        download_model(model, output_dir=str(directory))
        unload_model()

        if ctranslate2.get_cuda_device_count() > 0:
            try:
                loaded_model = WhisperModel(str(directory), device="cuda", compute_type="float16")
                loaded_model_name = model
                loaded_device = "cuda"
                logger.info("Model loaded with CUDA", extra={"model": model})
                return loaded_model, loaded_device
            except Exception as error:
                logger.warning(
                    "CUDA model loading failed; falling back to CPU",
                    extra={"error_type": type(error).__name__, "model": model},
                )

        loaded_model = WhisperModel(str(directory), device="cpu", compute_type="int8")
        loaded_model_name = model
        loaded_device = "cpu"
        logger.info("Model loaded with CPU", extra={"model": model})
        return loaded_model, loaded_device


def remove_model(model: str) -> None:
    with model_lock:
        if loaded_model_name == model:
            unload_model()
        directory = model_directory(model)
        if directory.exists():
            shutil.rmtree(directory)
            logger.warning("Rejected model removed from managed storage", extra={"model": model})


def transcribe_audio(
    whisper: WhisperModel, path: Path, language: str
) -> tuple[list[str], list[dict[str, object]]]:
    segments, _ = whisper.transcribe(
        str(path),
        language=None if language == "auto" else language,
        word_timestamps=True,
        vad_filter=True,
    )
    words: list[dict[str, object]] = []
    text_parts: list[str] = []
    for segment in segments:
        text_parts.append(segment.text.strip())
        for word in segment.words or []:
            words.append({"end": word.end, "start": word.start, "word": word.word.strip()})
    return text_parts, words


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/hardware")
async def hardware() -> dict[str, int]:
    return {
        "cpuCores": os.cpu_count() or 1,
        "cudaDevices": ctranslate2.get_cuda_device_count(),
    }


@app.post("/models/prepare", response_model=ModelStatus)
async def prepare_model(request: ModelRequest) -> ModelStatus:
    try:
        _, device = await run_in_threadpool(load_model, request.model)
        return ModelStatus(device=device, model=request.model, status="ready")
    except Exception as error:
        await run_in_threadpool(remove_model, request.model)
        logger.error(
            "Model preparation failed",
            extra={"error_type": type(error).__name__, "model": request.model},
        )
        raise HTTPException(status_code=422, detail="The model could not be prepared") from error


@app.post("/models/delete")
async def delete_model(request: ModelRequest) -> dict[str, str]:
    await run_in_threadpool(remove_model, request.model)
    return {"status": "deleted"}


@app.post("/transcribe")
async def transcribe(
    audio: Annotated[UploadFile, File()],
    model: Annotated[str, Form(min_length=1, max_length=200)],
    language: Annotated[str, Form(min_length=2, max_length=35)] = "auto",
) -> dict[str, object]:
    suffix = Path(audio.filename or "audio.wav").suffix.lower()
    if suffix not in {".ogg", ".wav"}:
        raise HTTPException(status_code=415, detail="Unsupported audio format")

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=TEMP_ROOT, suffix=suffix, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            while chunk := await audio.read(1024 * 1024):
                temporary.write(chunk)
        whisper, device = await run_in_threadpool(load_model, model)
        text_parts, words = await run_in_threadpool(
            transcribe_audio, whisper, temporary_path, language
        )
        logger.info(
            "Audio transcription completed",
            extra={"device": device, "model": model, "word_count": len(words)},
        )
        return {"text": " ".join(part for part in text_parts if part), "words": words}
    except HTTPException:
        raise
    except Exception as error:
        logger.error(
            "Audio transcription failed",
            extra={"error_type": type(error).__name__, "model": model},
        )
        raise HTTPException(status_code=503, detail="Transcription is unavailable") from error
    finally:
        await audio.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
