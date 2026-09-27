from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal, Never, Protocol

import ctranslate2
import numpy as np
from execution_policy import (
    AccelerationUnavailableError,
    DevicePreference,
    FallbackPreference,
    RuntimeDevice,
    load_with_device_policy,
)
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import BatchedInferencePipeline, WhisperModel
from model_capability import require_multilingual_capability
from model_downloads import ModelDownloads, catalog, installed_models, is_installed
from pydantic import BaseModel, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool
from structured_logging import configure_structured_logging
from transcription_options import create_transcription_options

configure_structured_logging()
logger = logging.getLogger("summyz.faster_whisper")
app = FastAPI(title="Summyz faster-whisper sidecar", docs_url=None, redoc_url=None)

MODEL_ROOT = Path(os.environ.get("SUMMYZ_MODEL_DIR", "/models/managed")).resolve()
TEMP_ROOT = Path("/tmp/summyz-audio").resolve()
MODEL_ROOT.mkdir(parents=True, exist_ok=True)
TEMP_ROOT.mkdir(parents=True, exist_ok=True)

model_lock = Lock()
downloads = ModelDownloads(MODEL_ROOT)


class Transcriber(Protocol):
    def transcribe(
        self, audio: object, **kwargs: object
    ) -> tuple[Iterable[TranscriptionSegment], TranscriptionInfo]: ...


class TranscriptionWord(Protocol):
    end: float
    start: float
    word: str


class TranscriptionSegment(Protocol):
    text: str
    words: Iterable[TranscriptionWord] | None


class TranscriptionInfo(Protocol):
    language: str
    language_probability: float


@dataclass(frozen=True)
class LoadedRuntime:
    batch_size: int
    compute_type: str
    device: RuntimeDevice
    fallback_applied: bool
    model: WhisperModel
    multilingual: bool
    transcriber: Transcriber


loaded_runtime: LoadedRuntime | None = None
loaded_key: tuple[str, str | None, DevicePreference, FallbackPreference, int] | None = None


class ModelRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._/-]+$")
    revision: str | None = Field(default=None, pattern=r"^[a-f0-9]{40}$")
    device: DevicePreference = "auto"
    fallback: FallbackPreference = "none"
    batchSize: int = Field(default=0, ge=0, le=64)


class ModelStatus(BaseModel):
    batchSize: int
    computeType: str
    device: Literal["cpu", "cuda"]
    fallbackApplied: bool
    model: str
    multilingual: bool
    status: Literal["ready"]


class VadOptionsRequest(BaseModel):
    enabled: bool = True
    maxSpeechDurationSeconds: Literal["auto"] | float = "auto"
    minSilenceDurationMs: Literal["auto"] | int = "auto"
    minSpeechDurationMs: int = Field(default=0, ge=0, le=2_000)
    negativeSpeechThreshold: Literal["auto"] | float = "auto"
    speechPadMs: int = Field(default=400, ge=0, le=5_000)
    threshold: float = Field(default=0.5, ge=0, le=1)

    @model_validator(mode="after")
    def validate_ranges(self) -> VadOptionsRequest:
        if isinstance(self.maxSpeechDurationSeconds, float) and not (
            0 < self.maxSpeechDurationSeconds <= 86_400
        ):
            raise ValueError("Invalid maximum speech duration")
        if isinstance(self.minSilenceDurationMs, int) and not (
            0 <= self.minSilenceDurationMs <= 10_000
        ):
            raise ValueError("Invalid minimum silence duration")
        if isinstance(self.negativeSpeechThreshold, float) and not (
            0 <= self.negativeSpeechThreshold <= 1
        ):
            raise ValueError("Invalid negative speech threshold")
        return self


def model_directory(model: str) -> Path:
    digest = hashlib.sha256(model.encode("utf-8")).hexdigest()
    directory = (MODEL_ROOT / digest).resolve()
    if directory.parent != MODEL_ROOT:
        raise ValueError("Managed model path escaped its root")
    return directory


def unload_model() -> None:
    global loaded_key, loaded_runtime
    loaded_runtime = None
    loaded_key = None


def create_runtime(directory: Path, device: RuntimeDevice, batch_size: int) -> LoadedRuntime:
    compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel(str(directory), device=device, compute_type=compute_type)
    transcriber: Transcriber = BatchedInferencePipeline(model=model) if batch_size > 0 else model
    warm_up(transcriber, batch_size)
    return LoadedRuntime(
        batch_size=batch_size,
        compute_type=compute_type,
        device=device,
        fallback_applied=False,
        model=model,
        multilingual=require_multilingual_capability(model.model),
        transcriber=transcriber,
    )


def warm_up(transcriber: Transcriber, batch_size: int) -> None:
    options: dict[str, object] = {
        "language": "en",
        "vad_filter": False,
        "word_timestamps": True,
    }
    if batch_size > 0:
        options["batch_size"] = batch_size
    segments, _ = transcriber.transcribe(np.zeros(16_000, dtype=np.float32), **options)
    list(segments)  # faster-whisper inference is lazy until segments are consumed.


def load_model(
    model: str,
    revision: str | None,
    device: DevicePreference,
    fallback: FallbackPreference,
    batch_size: int,
) -> LoadedRuntime:
    global loaded_key, loaded_runtime
    key = (model, revision, device, fallback, batch_size)
    with model_lock:
        if loaded_runtime is not None and loaded_key == key:
            return loaded_runtime

        directory = model_directory(f"{model}@{revision or 'default'}")
        if not is_installed(directory):
            raise FileNotFoundError("The selected model is not installed")
        unload_model()

        runtime, active_device, fallback_applied = load_with_device_policy(
            device,
            fallback,
            ctranslate2.get_cuda_device_count(),
            lambda candidate: create_runtime(directory, candidate, batch_size),
        )
        loaded_runtime = LoadedRuntime(
            batch_size=runtime.batch_size,
            compute_type=runtime.compute_type,
            device=active_device,
            fallback_applied=fallback_applied,
            model=runtime.model,
            multilingual=runtime.multilingual,
            transcriber=runtime.transcriber,
        )
        loaded_key = key
        logger.info(
            "Model initialized",
            extra={
                "batch_size": batch_size,
                "compute_type": loaded_runtime.compute_type,
                "device": active_device,
                "fallback_applied": fallback_applied,
                "model": model,
                "multilingual": loaded_runtime.multilingual,
            },
        )
        return loaded_runtime


def remove_model(model: str, revision: str | None = None) -> None:
    with model_lock:
        if loaded_key is not None and loaded_key[0] == model:
            unload_model()
        directory = model_directory(f"{model}@{revision or 'default'}")
        if directory.exists():
            shutil.rmtree(directory)
            logger.warning("Rejected model removed from managed storage", extra={"model": model})


def transcribe_audio(
    runtime: LoadedRuntime,
    path: Path,
    language: str,
    prompt: str | None,
    vad_options: dict[str, object],
) -> tuple[list[str], list[dict[str, object]], TranscriptionInfo]:
    options = create_transcription_options(language, runtime.batch_size, prompt, vad_options)
    segments, info = runtime.transcriber.transcribe(str(path), **options)
    words: list[dict[str, object]] = []
    text_parts: list[str] = []
    for segment in segments:
        text_parts.append(segment.text.strip())
        for word in segment.words or []:
            words.append({"end": word.end, "start": word.start, "word": word.word.strip()})
    return text_parts, words, info


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "loaded": loaded_runtime is not None,
        **({} if loaded_runtime is None else {"device": loaded_runtime.device}),
    }


@app.get("/hardware")
async def hardware() -> dict[str, int]:
    return {
        "cpuCores": os.cpu_count() or 1,
        "cudaDevices": ctranslate2.get_cuda_device_count(),
    }


@app.post("/models/prepare", response_model=ModelStatus)
async def prepare_model(request: ModelRequest) -> ModelStatus:
    try:
        runtime = await run_in_threadpool(
            load_model,
            request.model,
            request.revision,
            request.device,
            request.fallback,
            request.batchSize,
        )
        return ModelStatus(
            batchSize=runtime.batch_size,
            computeType=runtime.compute_type,
            device=runtime.device,
            fallbackApplied=runtime.fallback_applied,
            model=request.model,
            multilingual=runtime.multilingual,
            status="ready",
        )
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=409, detail="The selected model is not installed"
        ) from error
    except AccelerationUnavailableError as error:
        logger.error(
            "Required acceleration is unavailable",
            extra={"error_type": type(error).__name__, "model": request.model},
        )
        raise HTTPException(
            status_code=409, detail="Required GPU acceleration is unavailable"
        ) from error
    except Exception as error:
        logger.error(
            "Model preparation failed",
            extra={"error_type": type(error).__name__, "model": request.model},
        )
        raise HTTPException(status_code=422, detail="The model could not be prepared") from error


@app.post("/models/delete")
async def delete_model(request: ModelRequest) -> dict[str, str]:
    await run_in_threadpool(remove_model, request.model, request.revision)
    return {"status": "deleted"}


@app.get("/models")
async def list_models() -> dict[str, object]:
    return {"models": await run_in_threadpool(installed_models, MODEL_ROOT)}


@app.get("/models/catalog")
async def list_model_catalog() -> dict[str, object]:
    return {"items": await run_in_threadpool(catalog)}


@app.post("/models/download")
async def start_model_download(request: ModelRequest) -> dict[str, object]:
    try:
        return downloads.start(request.model, request.revision)
    except ValueError as error:
        raise HTTPException(status_code=409, detail="The model download cannot start") from error


@app.post("/models/download/status")
async def model_download_status(request: ModelRequest) -> dict[str, object]:
    return downloads.status(request.model, request.revision)


@app.post("/models/download/cancel")
async def cancel_model_download(request: ModelRequest) -> dict[str, object]:
    result = await run_in_threadpool(downloads.cancel, request.model, request.revision)
    return dict(result)


@app.post("/transcribe")
async def transcribe(
    audio: Annotated[UploadFile, File()],
    model: Annotated[str, Form(min_length=1, max_length=200)],
    revision: Annotated[str | None, Form(pattern=r"^[a-f0-9]{40}$")] = None,
    language: Annotated[str, Form(min_length=2, max_length=35)] = "auto",
    device: Annotated[DevicePreference, Form()] = "auto",
    fallback: Annotated[FallbackPreference, Form()] = "none",
    batch_size: Annotated[int, Form(alias="batchSize", ge=0, le=64)] = 0,
    prompt: Annotated[str | None, Form(min_length=1, max_length=20_000)] = None,
    vad_options_json: Annotated[str, Form(alias="vadOptions", max_length=2_000)] = "{}",
) -> dict[str, object]:
    temporary_path: Path | None = None
    try:
        suffix = require_audio_suffix(audio.filename)
        vad_options = parse_vad_options(vad_options_json)
        temporary_path = await save_upload(audio, suffix)
        return await run_transcription(
            temporary_path,
            model,
            revision,
            language,
            device,
            fallback,
            batch_size,
            prompt,
            vad_options,
        )
    except HTTPException:
        raise
    except AccelerationUnavailableError as error:
        raise_acceleration_unavailable(error, model)
    except Exception as error:
        raise_transcription_unavailable(error, model)
    finally:
        await audio.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def require_audio_suffix(filename: str | None) -> str:
    suffix = Path(filename or "audio.wav").suffix.lower()
    if suffix not in {".ogg", ".wav"}:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    return suffix


def parse_vad_options(value: str) -> dict[str, object]:
    try:
        options = VadOptionsRequest.model_validate_json(value)
        return {
            "enabled": options.enabled,
            "maxSpeechDurationSeconds": options.maxSpeechDurationSeconds,
            "minSilenceDurationMs": options.minSilenceDurationMs,
            "minSpeechDurationMs": options.minSpeechDurationMs,
            "negativeSpeechThreshold": options.negativeSpeechThreshold,
            "speechPadMs": options.speechPadMs,
            "threshold": options.threshold,
        }
    except ValidationError as error:
        raise HTTPException(status_code=422, detail="Invalid VAD configuration") from error


async def save_upload(audio: UploadFile, suffix: str) -> Path:
    with tempfile.NamedTemporaryFile(dir=TEMP_ROOT, suffix=suffix, delete=False) as temporary:
        path = Path(temporary.name)
        while chunk := await audio.read(1024 * 1024):
            temporary.write(chunk)
    return path


async def run_transcription(
    path: Path,
    model: str,
    revision: str | None,
    language: str,
    device: DevicePreference,
    fallback: FallbackPreference,
    batch_size: int,
    prompt: str | None,
    vad_options: dict[str, object],
) -> dict[str, object]:
    runtime = await run_in_threadpool(load_model, model, revision, device, fallback, batch_size)
    text_parts, words, info = await run_in_threadpool(
        transcribe_audio, runtime, path, language, prompt, vad_options
    )
    logger.info(
        "Audio transcription completed",
        extra={
            "batch_size": runtime.batch_size,
            "device": runtime.device,
            "fallback_applied": runtime.fallback_applied,
            "model": model,
            "word_count": len(words),
        },
    )
    return {
        "language": info.language,
        "languageProbability": info.language_probability,
        "text": " ".join(part for part in text_parts if part),
        "words": words,
    }


def raise_acceleration_unavailable(error: AccelerationUnavailableError, model: str) -> Never:
    logger.error(
        "Required acceleration is unavailable",
        extra={"error_type": type(error).__name__, "model": model},
    )
    raise HTTPException(
        status_code=409, detail="Required GPU acceleration is unavailable"
    ) from error


def raise_transcription_unavailable(error: Exception, model: str) -> Never:
    logger.error(
        "Audio transcription failed",
        extra={"error_type": type(error).__name__, "model": model},
    )
    raise HTTPException(status_code=503, detail="Transcription is unavailable") from error
